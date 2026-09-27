import { describe, expect, it } from 'vitest';
import { makeNormalized, type LeadSpec } from '@/tests/fixtures/lead-factory';
import {
  DEFAULT_FILTER_CONFIG,
  compileFilter,
  evaluateLead,
  type FilterConfig,
  type FilterEvaluation,
} from '../filters';
import type { NormalizedLead } from '../normalization';
import {
  DEFAULT_SCORING_CONFIG,
  compileScoring,
  explainScore,
  formatScoreReason,
  priorityFor,
  scoreLead,
  type LeadScoreResult,
  type ScoreComponent,
  type ScoringConfig,
} from './index';

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

/** Filters that let everything through (so scoring is always reached). */
const PASS_ALL: FilterConfig = {
  ...DEFAULT_FILTER_CONFIG,
  countries: { ...DEFAULT_FILTER_CONFIG.countries, enabled: false },
  keywords: { ...DEFAULT_FILTER_CONFIG.keywords, enabled: false },
  negativeKeywords: { ...DEFAULT_FILTER_CONFIG.negativeKeywords, enabled: false },
  quantity: { ...DEFAULT_FILTER_CONFIG.quantity, enabled: false },
  contact: { ...DEFAULT_FILTER_CONFIG.contact, enabled: false },
};

/** Weights with only one component switched on (weight 100). */
function only(component: ScoreComponent, extra: Partial<ScoringConfig> = {}): ScoringConfig {
  const weights = { ...DEFAULT_SCORING_CONFIG.weights };
  for (const key of Object.keys(weights) as ScoreComponent[]) weights[key] = 0;
  weights[component] = 100;
  return { ...DEFAULT_SCORING_CONFIG, weights, ...extra };
}

function run(
  spec: LeadSpec,
  scoring: ScoringConfig = DEFAULT_SCORING_CONFIG,
  filters: FilterConfig = PASS_ALL,
): { lead: NormalizedLead; filter: FilterEvaluation; result: LeadScoreResult } {
  const lead = makeNormalized(spec);
  const filter = evaluateLead(lead, compileFilter(filters), { evaluatedAt: 0 });
  const result = scoreLead(lead, filter, compileScoring(scoring), { calculatedAt: 0 });
  return { lead, filter, result };
}

const scoreOf = (spec: LeadSpec, scoring?: ScoringConfig, filters?: FilterConfig) =>
  run(spec, scoring, filters).result.score;

function points(result: LeadScoreResult, type: ScoreComponent): number | undefined {
  return result.reasons.find((r) => r.type === type)?.points;
}

/** A lead with everything present and recent. */
const RICH: LeadSpec = {
  title: 'Propranolol Tablets',
  country: 'USA',
  quantity: '100 Strip',
  mobile: true,
  whatsapp: true,
  email: true,
  category: 'Blood Pressure Medicine',
  productCategory: 'Propranolol Tablets',
  buys: ['Dutasteride Tablet'],
  age: '10 mins ago',
};

/* ------------------------------------------------------------------ */
/* Eligibility                                                          */
/* ------------------------------------------------------------------ */

describe('eligibility', () => {
  it('a matched lead is scored', () => {
    const { result } = run(RICH, DEFAULT_SCORING_CONFIG, DEFAULT_FILTER_CONFIG);
    expect(result.kind).toBe('SCORED');
    expect(result.eligible).toBe(true);
    expect(result).toMatchObject({ score: 100, priority: 'CRITICAL' }); // every component earned
  });

  it('a rejected lead is never scored: score null, priority REJECTED', () => {
    const { filter, result } = run(
      { ...RICH, country: 'Qatar' },
      DEFAULT_SCORING_CONFIG,
      DEFAULT_FILTER_CONFIG,
    );
    expect(filter.status).toBe('REJECTED');
    expect(result).toEqual({
      kind: 'REJECTED',
      eligible: false,
      score: null,
      priority: 'REJECTED',
      reasons: [],
      calculatedAt: 0,
    });
  });

  it('scoring off: matched → UNSCORED (not LOW), rejected stays REJECTED', () => {
    const off = { ...DEFAULT_SCORING_CONFIG, enabled: false };
    expect(run(RICH, off).result).toMatchObject({
      kind: 'UNSCORED',
      score: null,
      priority: 'UNSCORED',
      eligible: true,
    });
    expect(run({ ...RICH, country: 'Qatar' }, off, DEFAULT_FILTER_CONFIG).result.priority).toBe(
      'REJECTED',
    );
  });

  it('the six states stay distinct', () => {
    const states = new Set<string>([
      run({ ...RICH, country: 'Qatar' }, DEFAULT_SCORING_CONFIG, DEFAULT_FILTER_CONFIG).result
        .priority,
      run(RICH, { ...DEFAULT_SCORING_CONFIG, enabled: false }).result.priority,
      priorityFor(10, DEFAULT_SCORING_CONFIG.thresholds),
      priorityFor(60, DEFAULT_SCORING_CONFIG.thresholds),
      priorityFor(80, DEFAULT_SCORING_CONFIG.thresholds),
      priorityFor(95, DEFAULT_SCORING_CONFIG.thresholds),
    ]);
    expect([...states].sort()).toEqual([
      'CRITICAL',
      'HIGH',
      'LOW',
      'MEDIUM',
      'REJECTED',
      'UNSCORED',
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* Components                                                           */
/* ------------------------------------------------------------------ */

describe('country', () => {
  it('matched by the filter → full weight', () => {
    const { result } = run(RICH, DEFAULT_SCORING_CONFIG, DEFAULT_FILTER_CONFIG);
    expect(points(result, 'country')).toBe(25);
    expect(result.reasons.find((r) => r.type === 'country')?.message).toBe(
      'Country matched: United States',
    );
  });

  it('filter off but country present → full weight', () => {
    const { result } = run({ country: 'Qatar' });
    expect(points(result, 'country')).toBe(25);
    expect(result.reasons[0]?.message).toBe('Country: Qatar');
  });

  it('missing country → 0', () => {
    expect(points(run({ country: null }).result, 'country')).toBe(0);
  });

  it('OR logic: matched lead whose country failed the filter → 0', () => {
    const or: FilterConfig = { ...DEFAULT_FILTER_CONFIG, logic: { mode: 'OR' } };
    const { filter, result } = run({ ...RICH, country: 'Qatar' }, DEFAULT_SCORING_CONFIG, or);
    expect(filter.status).toBe('MATCHED');
    expect(points(result, 'country')).toBe(0);
  });
});

describe('quantity (unit-agnostic, linear up to quantityForFullPoints)', () => {
  it.each([
    ['0 Box', 0],
    ['1 Box', 1],
    ['10 Strip', 10],
    ['50 Vial', 50],
    ['100 Strip', 100],
    ['500 Kg', 100],
    ['2.5 Kg', 2.5],
  ])('%s → %d% of the weight', (quantity, percent) => {
    expect(points(run({ quantity }, only('quantity')).result, 'quantity')).toBe(percent);
  });

  it('uses the configured reference quantity', () => {
    expect(
      points(
        run({ quantity: '10 Box' }, only('quantity', { quantityForFullPoints: 20 })).result,
        'quantity',
      ),
    ).toBe(50);
  });

  it.each([null, '10-20 Strips', 'Bulk'])('%j → 0, never guessed', (quantity) => {
    const { result } = run({ quantity }, only('quantity'));
    expect(points(result, 'quantity')).toBe(0);
    expect(result.score).toBe(0);
  });

  it('message shows the ratio', () => {
    const { result } = run({ quantity: '40 Strip' });
    expect(formatScoreReason(result.reasons.find((r) => r.type === 'quantity')!)).toBe(
      '+8 Quantity 40 Strip (40/100)',
    );
  });
});

describe('contact', () => {
  it.each([
    [false, false, false, 0],
    [true, false, false, 10],
    [false, true, false, 15],
    [false, false, true, 10],
    [true, true, false, 25],
    [true, false, true, 20],
    [false, true, true, 25],
    [true, true, true, 35],
  ])('mobile %s whatsapp %s email %s → %d points', (mobile, whatsapp, email, expected) => {
    const { result } = run({ mobile, whatsapp, email });
    const sum = (['mobile', 'whatsapp', 'email'] as const).reduce(
      (s, c) => s + (points(result, c) ?? 0),
      0,
    );
    expect(sum).toBe(expected);
  });

  it('reasons never contain contact values', () => {
    const { result } = run(RICH);
    expect(result.reasons.map((r) => r.message).join(' ')).not.toMatch(/\d{6,}|@/);
  });
});

describe('keyword (reuses the Phase 4 match, capped)', () => {
  const kw = (values: string[]): FilterConfig => ({
    ...PASS_ALL,
    keywords: {
      ...DEFAULT_FILTER_CONFIG.keywords,
      enabled: true,
      values: values.map((value) => ({ value, enabled: true })),
    },
  });

  it('one keyword → full weight', () => {
    const { result } = run({ title: 'Planep Tablet' }, DEFAULT_SCORING_CONFIG, kw(['Tablet']));
    expect(points(result, 'keyword')).toBe(8);
  });

  it('several keywords → still the weight once', () => {
    const { filter, result } = run(
      { title: 'Tablet Capsule Injection' },
      DEFAULT_SCORING_CONFIG,
      kw(['Tablet', 'Capsule', 'Injection']),
    );
    expect(filter.matchedKeywords).toHaveLength(3);
    expect(points(result, 'keyword')).toBe(8);
    expect(result.reasons.find((r) => r.type === 'keyword')?.message).toBe(
      'Keyword matched: Tablet (+2 more)',
    );
  });

  it('no keyword matched (OR mode lets the lead through) → 0', () => {
    const or: FilterConfig = {
      ...kw(['Tablet']),
      logic: { mode: 'OR' },
      countries: { ...DEFAULT_FILTER_CONFIG.countries },
    };
    const { filter, result } = run(
      { title: 'Skin Soap', country: 'USA' },
      DEFAULT_SCORING_CONFIG,
      or,
    );
    expect(filter.status).toBe('MATCHED');
    expect(points(result, 'keyword')).toBe(0);
    expect(result.reasons.find((r) => r.type === 'keyword')?.message).toBe('No keyword matched');
  });

  it('keyword filter off → 0 with a clear message', () => {
    expect(run({ title: 'Tablet' }).result.reasons.find((r) => r.type === 'keyword')).toMatchObject(
      {
        points: 0,
        message: 'Keyword filter off',
      },
    );
  });
});

describe('category', () => {
  it.each([
    [{ category: 'Medicine' }, 5],
    [{ productCategory: 'Propranolol Tablets' }, 5],
    [{ category: 'Medicine', productCategory: 'Propranolol Tablets' }, 5],
    [{}, 0],
  ])('%j → %d (never double counted)', (spec, expected) => {
    expect(points(run(spec).result, 'category')).toBe(expected);
  });
});

describe('buyer products', () => {
  it.each([
    [['Dutasteride Tablet'], 3],
    [['A', 'B', 'C'], 3],
    [[], 0],
  ])('%j → %d', (buys, expected) => {
    expect(points(run({ buys }).result, 'buyerProducts')).toBe(expected);
  });
});

describe('lead age', () => {
  it.each([
    ['just now', 100],
    ['15 mins ago', 100],
    ['16 mins ago', 75],
    ['1 hour ago', 75],
    ['3 hours ago', 50],
    ['1 day ago', 25],
    ['2 days ago', 0],
    ['3 weeks ago', 0],
  ])('%s → %d%', (age, percent) => {
    expect(points(run({ age }, only('leadAge')).result, 'leadAge')).toBe(percent);
  });

  it.each([null, 'yesterday'])('%j → 0, never guessed', (age) => {
    expect(points(run({ age }, only('leadAge')).result, 'leadAge')).toBe(0);
  });

  it('approximate ages only count when allowed', () => {
    const lead = { age: '1 month ago' };
    expect(run(lead, only('leadAge')).result.reasons[0]?.message).toMatch(
      /approximate, not scored/,
    );
    // allowed, but a month is older than every tier → still 0, now with the age shown
    expect(
      run(lead, only('leadAge', { allowApproximateLeadAge: true })).result.reasons[0]?.message,
    ).toBe('Lead age 43200 min');
  });
});

/* ------------------------------------------------------------------ */
/* Priority and scaling                                                 */
/* ------------------------------------------------------------------ */

describe('priority thresholds (90 / 75 / 50)', () => {
  it.each([
    [0, 'LOW'],
    [49, 'LOW'],
    [50, 'MEDIUM'],
    [74, 'MEDIUM'],
    [75, 'HIGH'],
    [89, 'HIGH'],
    [90, 'CRITICAL'],
    [100, 'CRITICAL'],
  ] as const)('%d → %s', (score, priority) => {
    expect(priorityFor(score, DEFAULT_SCORING_CONFIG.thresholds)).toBe(priority);
  });

  it('custom thresholds', () => {
    const t = { critical: 80, high: 60, medium: 40 };
    expect([39, 40, 59, 60, 79, 80].map((s) => priorityFor(s, t))).toEqual([
      'LOW',
      'MEDIUM',
      'MEDIUM',
      'HIGH',
      'HIGH',
      'CRITICAL',
    ]);
  });

  it('end to end: quantity alone decides the band', () => {
    expect(run({ quantity: '49 Box' }, only('quantity')).result).toMatchObject({
      score: 49,
      priority: 'LOW',
    });
    expect(run({ quantity: '50 Box' }, only('quantity')).result).toMatchObject({
      score: 50,
      priority: 'MEDIUM',
    });
    expect(run({ quantity: '90 Box' }, only('quantity')).result).toMatchObject({
      score: 90,
      priority: 'CRITICAL',
    });
  });
});

describe('scaling to 0–100', () => {
  it('weights totalling 100: score = points', () => {
    const { result } = run(RICH);
    expect(result.kind === 'SCORED' && result.rawScore).toBe(result.score);
    expect(result.kind === 'SCORED' && result.maxRawScore).toBe(100);
  });

  it('weights totalling 110 are scaled', () => {
    const weights = { ...DEFAULT_SCORING_CONFIG.weights, keyword: 10, leadAge: 2, quantity: 30 };
    const cfg = { ...DEFAULT_SCORING_CONFIG, weights };
    const { result } = run({ ...RICH, quantity: '100 Strip' }, cfg);
    // raw = 110 - 10 (keyword filter off) = 100 → 100/110 → 90.9 → 91
    expect(result.kind === 'SCORED' && result.rawScore).toBe(100);
    expect(result.score).toBe(91);
  });

  it('weights totalling less than 100 are scaled up', () => {
    const weights = { ...only('quantity').weights, quantity: 10, mobile: 10 };
    const { result } = run(
      { quantity: '100 Box', mobile: true },
      { ...DEFAULT_SCORING_CONFIG, weights },
    );
    expect(result.score).toBe(100);
  });

  it('rounds halves up, deterministically', () => {
    // quantity weight 1, others 0 except email weight 1: total 2 → 1 of 2 → 50
    const weights = { ...only('quantity').weights, quantity: 1, email: 1 };
    expect(
      scoreOf({ quantity: '0 Box', email: true }, { ...DEFAULT_SCORING_CONFIG, weights }),
    ).toBe(50);
    // 0.5 of weight 1 + 0 over total 1 → 50
    const half = { ...only('quantity').weights, quantity: 1 };
    expect(scoreOf({ quantity: '50 Box' }, { ...DEFAULT_SCORING_CONFIG, weights: half })).toBe(50);
    // 89.5 points of 100 → 90 (half up) → CRITICAL
    const w = { ...only('quantity').weights, quantity: 99, email: 1 };
    const r = run(
      { quantity: '90.40 Box', email: false },
      { ...DEFAULT_SCORING_CONFIG, weights: w, quantityForFullPoints: 100 },
    ).result;
    expect(r.kind === 'SCORED' && r.rawScore).toBe(89.5);
    expect(r).toMatchObject({ score: 90, priority: 'CRITICAL' });
  });

  it('zero-weight components are not listed', () => {
    const { result } = run(RICH, only('email'));
    expect(result.reasons.map((r) => r.type)).toEqual(['email']);
  });
});

describe('explanations', () => {
  it('log line lists earned points, largest first', () => {
    const { result } = run(RICH, DEFAULT_SCORING_CONFIG, DEFAULT_FILTER_CONFIG);
    expect(explainScore(result)).toBe(
      'Score 100/100 (CRITICAL): +25 country, +20 quantity, +15 WhatsApp, +10 mobile, +10 email, +8 keyword, +5 category, +4 lead age, +3 buyer products',
    );
  });

  it('rejected and unscored explain themselves', () => {
    expect(
      explainScore(
        run({ ...RICH, country: 'Qatar' }, DEFAULT_SCORING_CONFIG, DEFAULT_FILTER_CONFIG).result,
      ),
    ).toBe('Not scored: rejected by filters');
    expect(explainScore(run(RICH, { ...DEFAULT_SCORING_CONFIG, enabled: false }).result)).toBe(
      'Not scored: scoring is off',
    );
  });

  it('README example: USA, Tablet, 50, WhatsApp + Email', () => {
    const { result } = run(
      {
        title: 'Propranolol Tablets',
        country: 'USA',
        quantity: '50 Strip',
        mobile: false,
        whatsapp: true,
        email: true,
        age: null,
      },
      DEFAULT_SCORING_CONFIG,
      DEFAULT_FILTER_CONFIG,
    );
    expect(result.reasons.map(formatScoreReason)).toEqual([
      '+25 Country matched: United States',
      '+10 Quantity 50 Strip (50/100)',
      '+0 Mobile unavailable',
      '+15 WhatsApp available',
      '+10 Email available',
      '+8 Keyword matched: Tablet',
      '+0 Category unavailable',
      '+0 No buyer products listed',
      '+0 Lead age unavailable',
    ]);
    expect(result).toMatchObject({ score: 68, priority: 'MEDIUM' });
  });
});

/* ------------------------------------------------------------------ */
/* Invariants                                                           */
/* ------------------------------------------------------------------ */

describe('invariants', () => {
  const quantities = [
    null,
    '0 Box',
    '1 Box',
    '19 Box',
    '20 Box',
    '99 Box',
    '100 Box',
    '5000 Box',
    '10-20 Strips',
  ];
  const countries = ['USA', 'Qatar', null, 'Atlantis'];
  const ages = [null, 'just now', '1 hour ago', '2 days ago', '2 months ago'];
  const contacts = [
    { mobile: false, whatsapp: false, email: false },
    { mobile: true, whatsapp: false, email: true },
    { mobile: true, whatsapp: true, email: true },
  ];
  const specs: LeadSpec[] = quantities.flatMap((quantity) =>
    countries.flatMap((country) =>
      ages.flatMap((age) => contacts.map((c) => ({ ...RICH, quantity, country, age, ...c }))),
    ),
  );
  const scorings: ScoringConfig[] = [
    DEFAULT_SCORING_CONFIG,
    { ...DEFAULT_SCORING_CONFIG, weights: { ...DEFAULT_SCORING_CONFIG.weights, country: 60 } },
    { ...DEFAULT_SCORING_CONFIG, allowApproximateLeadAge: true, quantityForFullPoints: 7 },
  ];
  const filterSets = [DEFAULT_FILTER_CONFIG, PASS_ALL];

  it(`hold over ${specs.length * scorings.length * filterSets.length} combinations`, () => {
    for (const scoring of scorings) {
      const compiled = compileScoring(scoring);
      for (const filters of filterSets) {
        const compiledFilter = compileFilter(filters);
        for (const spec of specs) {
          const lead = makeNormalized(spec);
          const filter = evaluateLead(lead, compiledFilter, { evaluatedAt: 0 });
          const r = scoreLead(lead, filter, compiled, { calculatedAt: 0 });
          if (filter.status === 'REJECTED') {
            expect(r.score).toBeNull(); // 3
            expect(r.priority).toBe('REJECTED'); // 4
            continue;
          }
          expect(r.eligible).toBe(true); // 5
          expect(r.score).toBeGreaterThanOrEqual(0); // 1
          expect(r.score).toBeLessThanOrEqual(100); // 2
          expect(Number.isInteger(r.score)).toBe(true);
          for (const reason of r.reasons) {
            expect(reason.points).toBeGreaterThanOrEqual(0);
            expect(reason.points).toBeLessThanOrEqual(reason.maxPoints);
          }
          expect(scoreLead(lead, filter, compiled, { calculatedAt: 0 })).toEqual(r); // 6
        }
      }
    }
  });

  it('7. more quantity never lowers the quantity contribution', () => {
    let previous = -1;
    for (const q of [0, 1, 5, 19, 20, 50, 99, 100, 101, 1000]) {
      const p = points(run({ quantity: `${q} Box` }).result, 'quantity') ?? -1;
      expect(p).toBeGreaterThanOrEqual(previous);
      previous = p;
    }
  });

  it('8. adding an available contact method never lowers the score', () => {
    const base = { mobile: false, whatsapp: false, email: false };
    for (const channel of ['mobile', 'whatsapp', 'email'] as const) {
      expect(scoreOf({ ...base, [channel]: true })).toBeGreaterThanOrEqual(scoreOf(base) ?? 0);
    }
  });

  it('9. unrelated changes leave other contributions untouched', () => {
    const a = run(RICH).result;
    const b = run({ ...RICH, email: false }).result;
    for (const type of [
      'country',
      'quantity',
      'mobile',
      'whatsapp',
      'keyword',
      'category',
      'buyerProducts',
      'leadAge',
    ] as const) {
      expect(points(b, type)).toBe(points(a, type));
    }
    expect(points(b, 'email')).toBe(0);
  });

  it('calculatedAt is metadata only', () => {
    const lead = makeNormalized(RICH);
    const filter = evaluateLead(lead, compileFilter(PASS_ALL), { evaluatedAt: 0 });
    const compiled = compileScoring(DEFAULT_SCORING_CONFIG);
    const a = scoreLead(lead, filter, compiled, { calculatedAt: 1 });
    const b = scoreLead(lead, filter, compiled, { calculatedAt: 2 });
    expect({ ...a, calculatedAt: 0 }).toEqual({ ...b, calculatedAt: 0 });
  });

  it('is fast: well under 0.1 ms per lead', () => {
    const lead = makeNormalized(RICH);
    const filter = evaluateLead(lead, compileFilter(DEFAULT_FILTER_CONFIG), { evaluatedAt: 0 });
    const compiled = compileScoring(DEFAULT_SCORING_CONFIG);
    for (let i = 0; i < 500; i++) scoreLead(lead, filter, compiled, { calculatedAt: 0 });
    const start = performance.now();
    for (let i = 0; i < 5000; i++) scoreLead(lead, filter, compiled, { calculatedAt: 0 });
    expect((performance.now() - start) / 5000).toBeLessThan(0.1);
  });
});
