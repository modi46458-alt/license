import { describe, expect, it } from 'vitest';
import { makeNormalized, type LeadSpec } from '@/tests/fixtures/lead-factory';
import {
  DEFAULT_FILTER_CONFIG,
  compileFilter,
  evaluateLead,
  explainEvaluation,
  type FilterConfig,
  type FilterEvaluation,
  type FilterReasonType,
} from './index';

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

const terms = (...values: string[]) => values.map((value) => ({ value, enabled: true }));

/** Everything off except what the test turns on. */
const NONE: FilterConfig = {
  ...DEFAULT_FILTER_CONFIG,
  countries: { ...DEFAULT_FILTER_CONFIG.countries, enabled: false },
  keywords: { ...DEFAULT_FILTER_CONFIG.keywords, enabled: false },
  negativeKeywords: { ...DEFAULT_FILTER_CONFIG.negativeKeywords, enabled: false },
  quantity: { ...DEFAULT_FILTER_CONFIG.quantity, enabled: false },
  contact: { ...DEFAULT_FILTER_CONFIG.contact, enabled: false },
  leadAge: { ...DEFAULT_FILTER_CONFIG.leadAge, enabled: false },
};

type Patch = {
  [K in keyof FilterConfig]?: FilterConfig[K] extends object
    ? Partial<FilterConfig[K]>
    : FilterConfig[K];
};

function config(patch: Patch = {}, base: FilterConfig = NONE): FilterConfig {
  const merged = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    const current = merged[key];
    merged[key] =
      typeof value === 'object' && value !== null && typeof current === 'object' && current !== null
        ? { ...current, ...value }
        : value;
  }
  return merged as unknown as FilterConfig;
}

function evaluate(lead: LeadSpec, cfg: FilterConfig): FilterEvaluation {
  return evaluateLead(makeNormalized(lead), compileFilter(cfg), { evaluatedAt: 0 });
}

const types = (e: FilterEvaluation): FilterReasonType[] => e.reasons.map((r) => r.type);
const messages = (e: FilterEvaluation) => e.reasons.map((r) => r.message);

/* ------------------------------------------------------------------ */
/* Countries                                                            */
/* ------------------------------------------------------------------ */

describe('countries', () => {
  const only = (values: string[], mode: 'ANY' | 'ALL' = 'ANY') =>
    config({ countries: { enabled: true, mode, values: terms(...values) } });

  it.each([
    ['USA', 'United States'],
    ['US', 'United States'],
    ['United States', 'USA'],
    ['U.S.A.', 'US'],
    ['UK', 'United Kingdom'],
    ['United Kingdom', 'UK'],
    ['Great Britain', 'GB'],
    ['Canada', 'Canada'],
    ['canada', 'CANADA'],
    ['  New   Zealand ', 'new zealand'],
    ['Holland', 'Netherlands'],
  ])('lead %j matches configured %j (ISO/alias)', (leadCountry, configured) => {
    const e = evaluate({ country: leadCountry }, only([configured]));
    expect(e.status).toBe('MATCHED');
    expect(types(e)).toEqual(['COUNTRY_MATCH']);
  });

  it('reports the normalized country name', () => {
    const e = evaluate({ country: 'USA' }, only(['Canada', 'United States']));
    expect(e.matchedCountries).toEqual(['United States']);
    expect(messages(e)).toEqual(['Country matched: United States']);
  });

  it.each(['Saudi Arabia', 'Qatar', 'Spain', 'Singapore'])(
    '%s is rejected when not configured',
    (c) => {
      const e = evaluate({ country: c }, only(['USA', 'Canada']));
      expect(e.status).toBe('REJECTED');
      expect(e.failedConditions).toEqual(['countries']);
      expect(messages(e)).toEqual([`Country not allowed: ${c}`]);
    },
  );

  it('missing country never matches', () => {
    const e = evaluate({ country: null }, only(['USA']));
    expect(e.status).toBe('REJECTED');
    expect(types(e)).toEqual(['COUNTRY_MISSING']);
    expect(messages(e)).toEqual(['Country unavailable']);
  });

  it('unknown countries only match the same unknown text, never fuzzily', () => {
    expect(evaluate({ country: 'Atlantis' }, only(['Atlantis'])).status).toBe('MATCHED');
    expect(evaluate({ country: 'Atlantis' }, only(['Atlant'])).status).toBe('REJECTED');
    expect(evaluate({ country: 'Congo' }, only(['DR Congo'])).status).toBe('REJECTED');
    expect(evaluate({ country: 'United Arab Emirates' }, only(['United States'])).status).toBe(
      'REJECTED',
    );
  });

  it('ANY = OR: one country is enough', () => {
    expect(evaluate({ country: 'Canada' }, only(['USA', 'Canada', 'UK'])).status).toBe('MATCHED');
  });

  it('ALL with several countries can never pass (a lead has one country)', () => {
    const e = evaluate({ country: 'USA' }, only(['USA', 'Canada'], 'ALL'));
    expect(e.status).toBe('REJECTED');
    expect(messages(e)[0]).toMatch(/cannot match all of/);
    expect(evaluate({ country: 'USA' }, only(['US'], 'ALL')).status).toBe('MATCHED');
  });

  it('disabled terms are ignored', () => {
    const cfg = config({
      countries: {
        enabled: true,
        mode: 'ANY',
        values: [
          { value: 'USA', enabled: false },
          { value: 'Canada', enabled: true },
        ],
      },
    });
    expect(evaluate({ country: 'USA' }, cfg).status).toBe('REJECTED');
  });

  it('enabled with no countries selected is skipped, not failed', () => {
    const e = evaluate(
      { country: 'Qatar' },
      config({ countries: { enabled: true, mode: 'ANY', values: [] } }),
    );
    expect(e.status).toBe('MATCHED');
    expect(types(e)).toEqual(['GROUP_EMPTY']);
  });
});

/* ------------------------------------------------------------------ */
/* Keywords                                                             */
/* ------------------------------------------------------------------ */

describe('keywords', () => {
  const kw = (
    values: string[],
    mode: 'ANY' | 'ALL' = 'ANY',
    fields: FilterConfig['keywords']['fields'] = [
      'title',
      'productCategory',
      'category',
      'buyerProducts',
    ],
  ) => config({ keywords: { enabled: true, mode, values: terms(...values), fields } });

  it.each([
    ['Planep 25 mg Tablet', 'Tablet'],
    ['Propranolol Tablets', 'tablet'],
    ['Methylprednisolone Tablets 16 Mg', 'TABLET'],
    ['Pharmaceutical Tablets', 'Tablets'],
    ['Super Bimix Injections', 'Injection'],
    ['Pfizer Growtropin 10 Iu Somatropin Injection', 'injection'],
    ['Generic Medicines Supply', 'Medicine'],
    ['Omega Capsule', 'Capsules'],
    ['Pain  remedies  pack', 'remedy'],
    ['Paracetamol Tablet for Personal Use', 'personal use'],
    ['PERSONAL   USE tablet', 'Personal Use'],
  ])('%j matches keyword %j', (title, keyword) => {
    const e = evaluate({ title }, kw([keyword]));
    expect(e.status).toBe('MATCHED');
    expect(e.matchedKeywords).toEqual([keyword]);
  });

  it.each([
    ['Tabletop Organiser', 'Tablet'],
    ['Kozicare Skin Lightning Soap', 'Tablet'],
    ['Capsulated Machine', 'Capsule'],
    ['Personal User Guide', 'Personal Use'],
    ['Use Personal', 'Personal Use'],
    ['250ml Sevitrue Sevoflurane Syrup', 'Medicine'],
  ])('%j does not match %j (whole words only)', (title, keyword) => {
    const e = evaluate({ title }, kw([keyword]));
    expect(e.status).toBe('REJECTED');
    expect(types(e)).toEqual(['KEYWORD_MISMATCH']);
    expect(messages(e)).toEqual(['No keyword matched']);
  });

  it('reports keyword, field and matched text', () => {
    const e = evaluate({ title: 'Planep 25 mg Tablets' }, kw(['Tablet']));
    expect(e.reasons[0]).toMatchObject({
      type: 'KEYWORD_MATCH',
      keyword: 'Tablet',
      field: 'title',
      matchedText: 'tablets',
      message: 'Keyword matched: Tablet (title)',
    });
  });

  it('ANY: one of several keywords is enough, all hits are reported', () => {
    const e = evaluate({ title: 'Tablet and Capsule kit' }, kw(['Medicine', 'Tablet', 'Capsule']));
    expect(e.status).toBe('MATCHED');
    expect(e.matchedKeywords).toEqual(['Tablet', 'Capsule']);
  });

  it('ALL: every keyword must be found', () => {
    expect(
      evaluate({ title: 'Tablet and Capsule kit' }, kw(['Tablet', 'Capsule'], 'ALL')).status,
    ).toBe('MATCHED');
    const e = evaluate({ title: 'Tablet only' }, kw(['Tablet', 'Capsule', 'Medicine'], 'ALL'));
    expect(e.status).toBe('REJECTED');
    expect(messages(e).at(-1)).toBe('Keywords not found: Capsule, Medicine');
  });

  it('ALL can be satisfied across different fields', () => {
    const e = evaluate(
      {
        title: 'Propranolol 40',
        productCategory: 'Propranolol Tablets',
        category: 'Blood Pressure Medicine',
      },
      kw(['Tablet', 'Medicine'], 'ALL'),
    );
    expect(e.status).toBe('MATCHED');
  });

  it.each([
    ['productCategory', { title: 'Planep 25', productCategory: 'Antidepressant Tablets' }],
    ['category', { title: 'Planep 25', category: 'Pharmaceutical Tablets' }],
    ['buyerProducts', { title: 'Planep 25', buys: ['Dutasteride Tablet', 'Drop Shippers'] }],
  ] as const)('matches in %s', (field, lead) => {
    const e = evaluate(lead, kw(['Tablet'], 'ANY', [field]));
    expect(e.status).toBe('MATCHED');
    expect(e.reasons[0]).toMatchObject({ field });
  });

  it('only searches the selected fields', () => {
    const lead = { title: 'Planep 25', productCategory: 'Antidepressant Tablets' };
    expect(evaluate(lead, kw(['Tablet'], 'ANY', ['title'])).status).toBe('REJECTED');
  });

  it('a phrase never spans two buyer products', () => {
    const e = evaluate(
      { title: 'X', buys: ['Paracetamol Personal', 'Use Case'] },
      kw(['Personal Use'], 'ANY', ['buyerProducts']),
    );
    expect(e.status).toBe('REJECTED');
  });

  it('disabled keyword filter is ignored', () => {
    const cfg = config({
      keywords: { enabled: false, mode: 'ANY', values: terms('Tablet'), fields: ['title'] },
    });
    expect(evaluate({ title: 'Soap' }, cfg).status).toBe('MATCHED');
  });

  it('no fields selected skips the group', () => {
    const e = evaluate({ title: 'Soap' }, kw(['Tablet'], 'ANY', []));
    expect(e.status).toBe('MATCHED');
    expect(types(e)).toEqual(['GROUP_EMPTY']);
  });

  it('keywords made only of punctuation are ignored', () => {
    expect(evaluate({ title: 'Soap' }, kw(['--', '!!'])).status).toBe('MATCHED');
  });
});

/* ------------------------------------------------------------------ */
/* Negative keywords                                                    */
/* ------------------------------------------------------------------ */

describe('negative keywords', () => {
  const neg = (values: string[], fields: FilterConfig['negativeKeywords']['fields'] = ['title']) =>
    config({ negativeKeywords: { enabled: true, values: terms(...values), fields } });

  it.each([
    ['Paracetamol Retail Pack', 'Retail'],
    ['Tablet for Personal Use', 'Personal Use'],
    ['Home Use BP Monitor', 'Home Use'],
    ['RETAIL tablets', 'retail'],
    ['for personal   use only', 'PERSONAL USE'],
  ])('%j is excluded by %j', (title, keyword) => {
    const e = evaluate({ title }, neg([keyword]));
    expect(e.status).toBe('REJECTED');
    expect(e.negativeKeywords).toEqual([keyword]);
    expect(e.failedConditions).toEqual(['negativeKeywords']);
  });

  it('reports every excluded keyword found', () => {
    const e = evaluate(
      { title: 'Retail pack for Personal Use' },
      neg(['Retail', 'Personal Use', 'Home Use']),
    );
    expect(e.negativeKeywords).toEqual(['Retail', 'Personal Use']);
    expect(types(e)).toEqual(['NEGATIVE_KEYWORD', 'NEGATIVE_KEYWORD']);
  });

  it('clear leads get a pass reason', () => {
    const e = evaluate({ title: 'Bulk Tablets' }, neg(['Retail']));
    expect(e.status).toBe('MATCHED');
    expect(types(e)).toEqual(['NEGATIVE_CLEAR']);
  });

  it('whole words only: "retailer" is not "retail"', () => {
    expect(evaluate({ title: 'Retailers welcome' }, neg(['Retail'])).status).toBe('MATCHED');
  });

  it('overrides a positive keyword match', () => {
    const cfg = config({
      keywords: { enabled: true, mode: 'ANY', values: terms('Tablet'), fields: ['title'] },
      negativeKeywords: { enabled: true, values: terms('Personal Use'), fields: ['title'] },
    });
    const e = evaluate({ title: 'Paracetamol Tablet for Personal Use' }, cfg);
    expect(e.status).toBe('REJECTED');
    expect(e.matchedKeywords).toEqual(['Tablet']);
    expect(e.negativeKeywords).toEqual(['Personal Use']);
  });

  it('overrides in OR mode too', () => {
    const cfg = config({
      logic: { mode: 'OR' },
      countries: { enabled: true, mode: 'ANY', values: terms('USA') },
      negativeKeywords: { enabled: true, values: terms('Retail'), fields: ['title'] },
    });
    expect(evaluate({ title: 'Retail tablets', country: 'USA' }, cfg).status).toBe('REJECTED');
  });

  it('respects selected fields', () => {
    expect(
      evaluate({ title: 'Tablets', buys: ['Retail Bags'] }, neg(['Retail'], ['title'])).status,
    ).toBe('MATCHED');
    expect(
      evaluate({ title: 'Tablets', buys: ['Retail Bags'] }, neg(['Retail'], ['buyerProducts']))
        .status,
    ).toBe('REJECTED');
  });
});

/* ------------------------------------------------------------------ */
/* Quantity                                                             */
/* ------------------------------------------------------------------ */

describe('quantity', () => {
  const qty = (min: number | null, max: number | null = null) =>
    config({ quantity: { enabled: true, min, max } });

  it.each([
    ['20 Strip', 20, null, 'MATCHED'],
    ['19 Strip', 20, null, 'REJECTED'],
    ['30 Box', 20, null, 'MATCHED'],
    ['100 Vial', 20, 100, 'MATCHED'],
    ['101 Vial', 20, 100, 'REJECTED'],
    ['5 Bottle', 20, null, 'REJECTED'],
    ['1 Kg', 20, null, 'REJECTED'],
    ['50 Strip', null, 50, 'MATCHED'],
    ['51 Strip', null, 50, 'REJECTED'],
    ['7 Box', null, null, 'MATCHED'],
    ['2.5 Kg', 2, 3, 'MATCHED'],
  ] as const)('%s with min %s max %s → %s', (quantity, min, max, status) => {
    expect(evaluate({ quantity }, qty(min, max)).status).toBe(status);
  });

  it('reasons: too low / too high / pass', () => {
    expect(messages(evaluate({ quantity: '10 Strip' }, qty(20)))).toEqual([
      'Quantity 10 < minimum 20',
    ]);
    expect(messages(evaluate({ quantity: '200 Strip' }, qty(20, 100)))).toEqual([
      'Quantity 200 > maximum 100',
    ]);
    expect(messages(evaluate({ quantity: '30 Strip' }, qty(20)))).toEqual([
      'Quantity 30 Strip ≥ 20',
    ]);
    expect(evaluate({ quantity: '10 Strip' }, qty(20)).reasons[0]).toMatchObject({
      type: 'QUANTITY_TOO_LOW',
      value: 10,
      expected: 20,
    });
  });

  it('missing quantity cannot pass and is never guessed', () => {
    const e = evaluate({ quantity: null, title: '12 Tablets' }, qty(1));
    expect(e.status).toBe('REJECTED');
    expect(messages(e)).toEqual(['Quantity unavailable']);
  });

  it.each(['10-20 Strips', 'Bulk', '10 to 20 Boxes'])(
    'range/text %j is rejected, not guessed',
    (quantity) => {
      const e = evaluate({ quantity }, qty(1));
      expect(e.status).toBe('REJECTED');
      expect(messages(e)).toEqual([`Quantity not a single number: ${quantity}`]);
    },
  );

  it('disabled quantity filter ignores quantity entirely', () => {
    expect(
      evaluate({ quantity: null }, config({ quantity: { enabled: false, min: 20 } })).status,
    ).toBe('MATCHED');
  });
});

/* ------------------------------------------------------------------ */
/* Contact                                                              */
/* ------------------------------------------------------------------ */

describe('contact', () => {
  const ct = (mode: 'ANY' | 'ALL', mobile = true, whatsapp = true, email = true) =>
    config({ contact: { enabled: true, mode, mobile, whatsapp, email } });
  const lead = (mobile: boolean, whatsapp: boolean, email: boolean) => ({
    mobile,
    whatsapp,
    email,
  });

  it.each([
    [lead(true, false, false), 'ANY', 'MATCHED'],
    [lead(false, true, false), 'ANY', 'MATCHED'],
    [lead(false, false, true), 'ANY', 'MATCHED'],
    [lead(false, false, false), 'ANY', 'REJECTED'],
    [lead(true, true, true), 'ALL', 'MATCHED'],
    [lead(true, false, true), 'ALL', 'REJECTED'],
    [lead(false, false, false), 'ALL', 'REJECTED'],
  ] as const)('%j %s → %s', (l, mode, status) => {
    expect(evaluate(l, ct(mode)).status).toBe(status);
  });

  it('ALL names the missing channel', () => {
    const e = evaluate(lead(true, false, true), ct('ALL'));
    expect(messages(e)).toEqual(['Contact requirement failed: WhatsApp unavailable']);
    expect(e.reasons[0]).toMatchObject({ type: 'CONTACT_MISSING', channels: ['whatsapp'] });
  });

  it('ANY lists what is available', () => {
    expect(messages(evaluate(lead(false, true, true), ct('ANY')))).toEqual([
      'Contact: WhatsApp, Email available',
    ]);
  });

  it('only selected channels count', () => {
    // WhatsApp required, lead has only email.
    expect(evaluate(lead(false, false, true), ct('ANY', false, true, false)).status).toBe(
      'REJECTED',
    );
    // ALL over mobile+email only.
    expect(evaluate(lead(true, false, true), ct('ALL', true, false, true)).status).toBe('MATCHED');
  });

  it('no channels selected skips the group', () => {
    const e = evaluate(lead(false, false, false), ct('ALL', false, false, false));
    expect(e.status).toBe('MATCHED');
    expect(types(e)).toEqual(['GROUP_EMPTY']);
  });

  it('disabled contact filter is ignored', () => {
    expect(
      evaluate(lead(false, false, false), config({ contact: { enabled: false } })).status,
    ).toBe('MATCHED');
  });
});

/* ------------------------------------------------------------------ */
/* Lead age                                                             */
/* ------------------------------------------------------------------ */

describe('lead age', () => {
  const age = (minMinutes: number | null, maxMinutes: number | null) =>
    config({ leadAge: { enabled: true, minMinutes, maxMinutes } });

  it.each([
    ['22 mins ago', null, 60, 'MATCHED'],
    ['1 hour ago', null, 60, 'MATCHED'],
    ['3 hours ago', null, 60, 'REJECTED'],
    ['just now', 5, null, 'REJECTED'],
    ['10 mins ago', 5, 60, 'MATCHED'],
    ['5 mins ago', 5, 60, 'MATCHED'],
  ] as const)('%s with min %s max %s → %s', (raw, min, max, status) => {
    expect(evaluate({ age: raw }, age(min, max)).status).toBe(status);
  });

  it('reasons for too old / too new', () => {
    expect(messages(evaluate({ age: '3 hours ago' }, age(null, 60)))).toEqual([
      'Lead age 180 min > maximum 60 min',
    ]);
    expect(messages(evaluate({ age: 'just now' }, age(5, null)))).toEqual([
      'Lead age 0 min < minimum 5 min',
    ]);
  });

  it.each([
    [null, 'Lead age unavailable'],
    ['yesterday', 'Lead age not convertible: yesterday'],
  ])('missing/unconvertible %j → rejected', (raw, message) => {
    const e = evaluate({ age: raw }, age(null, 60));
    expect(e.status).toBe('REJECTED');
    expect(messages(e)).toEqual([message]);
  });

  it('approximate ages carry a warning', () => {
    const e = evaluate({ age: '2 months ago' }, age(null, null));
    expect(e.status).toBe('MATCHED');
    expect(types(e)).toEqual(['LEAD_AGE_APPROXIMATE', 'LEAD_AGE_PASS']);
  });

  it('disabled lead-age filter is ignored', () => {
    expect(evaluate({ age: null }, NONE).status).toBe('MATCHED');
  });
});

/* ------------------------------------------------------------------ */
/* Logic                                                                */
/* ------------------------------------------------------------------ */

describe('logic', () => {
  const both = (mode: 'AND' | 'OR') =>
    config({
      logic: { mode },
      countries: { enabled: true, mode: 'ANY', values: terms('USA') },
      quantity: { enabled: true, min: 20, max: null },
    });

  it.each([
    ['AND', 'USA', '30 Box', 'MATCHED'],
    ['AND', 'USA', '10 Box', 'REJECTED'],
    ['AND', 'Qatar', '30 Box', 'REJECTED'],
    ['OR', 'USA', '10 Box', 'MATCHED'],
    ['OR', 'Qatar', '30 Box', 'MATCHED'],
    ['OR', 'Qatar', '10 Box', 'REJECTED'],
  ] as const)('%s: %s + %s → %s', (mode, country, quantity, status) => {
    expect(evaluate({ country, quantity }, both(mode)).status).toBe(status);
  });

  it('OR still lists the groups that failed', () => {
    const e = evaluate({ country: 'USA', quantity: '10 Box' }, both('OR'));
    expect(e.status).toBe('MATCHED');
    expect(e.failedConditions).toEqual(['quantity']);
  });

  it('no filters enabled → matched', () => {
    const e = evaluate({ country: null, quantity: null }, NONE);
    expect(e.status).toBe('MATCHED');
    expect(e.reasons).toEqual([]);
  });

  it('master switch off → matched with FILTER_DISABLED', () => {
    const e = evaluate({ country: 'Qatar' }, { ...DEFAULT_FILTER_CONFIG, enabled: false });
    expect(e.status).toBe('MATCHED');
    expect(types(e)).toEqual(['FILTER_DISABLED']);
    expect(explainEvaluation(e)).toBe('filters are off');
  });

  it('multiple failures are all reported, nothing stops early', () => {
    const cfg = config({
      countries: { enabled: true, mode: 'ANY', values: terms('USA', 'Canada') },
      quantity: { enabled: true, min: 20, max: null },
      negativeKeywords: { enabled: true, values: terms('Personal Use'), fields: ['title'] },
    });
    const e = evaluate(
      { country: 'Saudi Arabia', quantity: '10 Strip', title: 'Tablet Personal Use' },
      cfg,
    );
    expect(e.status).toBe('REJECTED');
    expect(e.failedConditions).toEqual(['countries', 'quantity', 'negativeKeywords']);
    expect(messages(e)).toEqual([
      'Country not allowed: Saudi Arabia',
      'Quantity 10 < minimum 20',
      'Excluded keyword detected: Personal Use (title)',
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* The spec's worked examples on the default config                     */
/* ------------------------------------------------------------------ */

describe('default configuration examples', () => {
  const run = (lead: LeadSpec) => evaluate(lead, DEFAULT_FILTER_CONFIG);

  it('Propranolol Tablets, United States, 30 Strip, WhatsApp+Email → MATCHED', () => {
    const e = run({
      title: 'Propranolol Tablets',
      country: 'United States',
      quantity: '30 Strip',
      mobile: false,
      whatsapp: true,
      email: true,
    });
    expect(e.status).toBe('MATCHED');
    expect(explainEvaluation(e)).toBe(
      'Country matched: United States; Keyword matched: Tablet (title); Quantity 30 Strip ≥ 20; Contact: WhatsApp, Email available',
    );
  });

  it('Propranolol Tablet Personal Use → REJECTED by exclusion alone', () => {
    const e = run({
      title: 'Propranolol Tablet Personal Use',
      country: 'USA',
      quantity: '30 Strip',
    });
    expect(e.status).toBe('REJECTED');
    expect(e.failedConditions).toEqual(['negativeKeywords']);
    expect(explainEvaluation(e)).toBe('Excluded keyword detected: Personal Use (title)');
  });

  it.each<[LeadSpec, string]>([
    [
      {
        title: 'Pfizer Growtropin 10 Iu Somatropin Injection',
        country: 'Spain',
        quantity: '10 Vial',
      },
      'REJECTED',
    ],
    [
      { title: '250ml Sevitrue Sevoflurane Syrup', country: 'Singapore', quantity: '2 Bottle' },
      'REJECTED',
    ],
    [{ title: 'Planep 25 mg Tablet', country: 'Saudi Arabia', quantity: '10 Strip' }, 'REJECTED'],
    [{ title: 'CLOBETASAL Propionate 30mg', country: 'USA', quantity: '1 Kg' }, 'REJECTED'],
    [{ title: 'Super Bimix Injections', country: 'UK', quantity: '3 Vial' }, 'REJECTED'],
    [{ title: 'Super Bimix Injections', country: 'UK', quantity: '30 Vial' }, 'MATCHED'],
    [{ title: 'K-s-a-l-o-l Tablets', country: 'New Zealand', quantity: null }, 'REJECTED'],
    [
      { title: 'Kozicare Skin Lightning Soap', country: 'Australia', quantity: '50 Piece' },
      'REJECTED',
    ],
    [{ title: 'Tadalafil 5mg Cialis Tablet', country: 'Qatar', quantity: '1 Box' }, 'REJECTED'],
    [
      {
        title: 'Methylprednisolone Tablets 16 Mg',
        country: 'Canada',
        quantity: '20 Strip',
        mobile: false,
        whatsapp: false,
        email: true,
      },
      'MATCHED',
    ],
  ])('%j → %s', (lead, status) => {
    expect(run(lead).status).toBe(status);
  });
});

/* ------------------------------------------------------------------ */
/* Invariants (property-style over a grid of generated leads)           */
/* ------------------------------------------------------------------ */

describe('invariants', () => {
  const titles = [
    'Propranolol Tablets',
    'Retail Tablets',
    'Home Use Kit',
    'Skin Soap',
    'Injection Pack',
  ];
  const countries = ['USA', 'Canada', 'Qatar', null, 'Atlantis'];
  const quantities = ['5 Box', '20 Strip', '30 Vial', null, '10-20 Strips'];
  const contacts = [
    { mobile: false, whatsapp: false, email: false },
    { mobile: true, whatsapp: false, email: false },
    { mobile: true, whatsapp: true, email: true },
  ];
  const leads: LeadSpec[] = titles.flatMap((title) =>
    countries.flatMap((country) =>
      quantities.flatMap((quantity) => contacts.map((c) => ({ title, country, quantity, ...c }))),
    ),
  );
  const configs: FilterConfig[] = [
    DEFAULT_FILTER_CONFIG,
    { ...DEFAULT_FILTER_CONFIG, logic: { mode: 'OR' } },
    { ...DEFAULT_FILTER_CONFIG, contact: { ...DEFAULT_FILTER_CONFIG.contact, mode: 'ALL' } },
  ];

  it(`checked over ${leads.length * configs.length} lead/config pairs`, () => {
    for (const cfg of configs) {
      const compiled = compileFilter(cfg);
      for (const spec of leads) {
        const lead = makeNormalized(spec);
        const e = evaluateLead(lead, compiled, { evaluatedAt: 0 });

        // 1. an excluded keyword never matches
        if (e.negativeKeywords.length > 0) expect(e.status).toBe('REJECTED');
        // 2. below minimum never matches under AND
        if (cfg.logic.mode === 'AND' && lead.quantity.value !== null && lead.quantity.value < 20) {
          expect(e.status).toBe('REJECTED');
        }
        // 3. ALL contact requirement unmet never matches under AND
        if (cfg.logic.mode === 'AND' && cfg.contact.mode === 'ALL') {
          const all =
            lead.contact.mobileAvailable &&
            lead.contact.whatsappAvailable &&
            lead.contact.emailAvailable;
          if (!all) expect(e.status).toBe('REJECTED');
        }
        // 4. AND: no failed condition ⇔ matched
        if (cfg.logic.mode === 'AND') expect(e.passed).toBe(e.failedConditions.length === 0);
        // status and passed agree
        expect(e.passed).toBe(e.status === 'MATCHED');
        // 5. deterministic
        expect(evaluateLead(lead, compiled, { evaluatedAt: 0 })).toEqual(e);
      }
    }
  });

  it('6. fields the config does not look at never change the result', () => {
    const compiled = compileFilter(DEFAULT_FILTER_CONFIG);
    const base = evaluateLead(makeNormalized({}), compiled, { evaluatedAt: 0 });
    for (const spec of [
      { strength: '36 IU (12 mg)' },
      { dosageForm: 'Cream' },
      { age: '3 years ago' },
      { strength: 'garbage', dosageForm: 'Unknown' },
    ]) {
      expect(evaluateLead(makeNormalized(spec), compiled, { evaluatedAt: 0 })).toEqual(base);
    }
  });

  it('evaluatedAt is metadata only', () => {
    const compiled = compileFilter(DEFAULT_FILTER_CONFIG);
    const lead = makeNormalized({});
    const a = evaluateLead(lead, compiled, { evaluatedAt: 1 });
    const b = evaluateLead(lead, compiled, { evaluatedAt: 2 });
    expect({ ...a, evaluatedAt: 0 }).toEqual({ ...b, evaluatedAt: 0 });
  });

  it('does not mutate the lead or the config', () => {
    const lead = makeNormalized({});
    const cfg = structuredClone(DEFAULT_FILTER_CONFIG);
    const leadCopy = structuredClone(lead);
    evaluateLead(lead, compileFilter(cfg), { evaluatedAt: 0 });
    expect(lead).toEqual(leadCopy);
    expect(cfg).toEqual(DEFAULT_FILTER_CONFIG);
  });

  it('is fast: well under 0.1 ms per lead', () => {
    const compiled = compileFilter(DEFAULT_FILTER_CONFIG);
    const lead = makeNormalized({
      buys: ['Dutasteride Tablet', 'Medicine Drop Shippers', 'Finasteride Tablet'],
    });
    for (let i = 0; i < 500; i++) evaluateLead(lead, compiled, { evaluatedAt: 0 });
    const start = performance.now();
    for (let i = 0; i < 5000; i++) evaluateLead(lead, compiled, { evaluatedAt: 0 });
    expect((performance.now() - start) / 5000).toBeLessThan(0.1);
  });
});
