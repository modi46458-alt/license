import type { FilterEvaluation } from '../filters/filter-types';
import type { NormalizedLead } from '../normalization/normalization-types';
import { parseScoringConfig, totalWeight } from './scoring-config';
import type {
  LeadScoreResult,
  ScoreComponent,
  ScoredPriority,
  ScoreReason,
  ScoringConfig,
} from './scoring-types';

/**
 * Lead scoring (Phase 5). Runs only on leads the Phase 4 filters MATCHED.
 *
 *   points(c)  = weight(c) × fraction(c)          fraction ∈ [0, 1]
 *   rawScore   = Σ points(c)
 *   score      = round(rawScore / Σ weight × 100)  → integer 0–100
 *   priority   = CRITICAL ≥ critical, HIGH ≥ high, MEDIUM ≥ medium, else LOW
 *
 * fraction(c):
 *   country        1 if the filter matched the country (or, with the country
 *                  filter off, if the lead has a country); else 0
 *   quantity       min(quantity / quantityForFullPoints, 1); 0 if unknown.
 *                  Unit-agnostic: 50 Kg and 50 Box count the same.
 *   mobile/whatsapp/email  1 if available
 *   keyword        1 if the filter matched at least one keyword (capped: many
 *                  keywords still give the weight once); 0 otherwise
 *   category       1 if category or product category is present (once)
 *   buyerProducts  1 if the buyer lists at least one product
 *   leadAge        ≤15 min 1, ≤60 0.75, ≤180 0.5, ≤1440 0.25, older 0;
 *                  0 if unknown, or if approximate and not allowed
 *
 * Rounding: points are kept to 2 decimals (integer hundredths, so sums are
 * exact); the final score uses Math.round (halves round up). Pure and
 * deterministic: no DOM, clock (calculatedAt is metadata) or randomness.
 */

export interface CompiledScoring {
  readonly config: ScoringConfig;
  readonly total: number;
}

/** Throws on an invalid config (callers keep their previous or the default config). */
export function compileScoring(config: ScoringConfig): CompiledScoring {
  const valid = parseScoringConfig(config);
  if (valid === null) throw new RangeError('Invalid scoring configuration');
  return { config: valid, total: totalWeight(valid.weights) };
}

export function priorityFor(
  score: number,
  thresholds: ScoringConfig['thresholds'],
): ScoredPriority {
  if (score >= thresholds.critical) return 'CRITICAL';
  if (score >= thresholds.high) return 'HIGH';
  if (score >= thresholds.medium) return 'MEDIUM';
  return 'LOW';
}

/** Lead-age fraction tiers: [maximum minutes, fraction]. */
export const LEAD_AGE_TIERS: ReadonlyArray<readonly [number, number]> = [
  [15, 1],
  [60, 0.75],
  [180, 0.5],
  [1440, 0.25],
];

const hundredths = (n: number) => Math.round(n * 100);
const fromHundredths = (n: number) => n / 100;
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

interface Part {
  readonly fraction: number;
  readonly message: string;
}

function countryPart(lead: NormalizedLead, filter: FilterEvaluation): Part {
  const name = lead.country.normalized;
  const reason = filter.reasons.find(
    (r) =>
      r.type === 'COUNTRY_MATCH' || r.type === 'COUNTRY_MISMATCH' || r.type === 'COUNTRY_MISSING',
  );
  if (reason?.type === 'COUNTRY_MATCH')
    return { fraction: 1, message: `Country matched: ${reason.value}` };
  if (reason)
    return { fraction: 0, message: `Country not in the filter list: ${name ?? 'unknown'}` };
  // Country filter off or empty: presence of a normalized country counts.
  return name === null
    ? { fraction: 0, message: 'Country unavailable' }
    : { fraction: 1, message: `Country: ${name}` };
}

function quantityPart(lead: NormalizedLead, config: ScoringConfig): Part {
  const value = lead.quantity.value;
  if (value === null) {
    return {
      fraction: 0,
      message:
        lead.quantity.raw === null
          ? 'Quantity unavailable'
          : `Quantity not a single number: ${lead.quantity.raw}`,
    };
  }
  const fraction = Math.min(Math.max(value, 0) / config.quantityForFullPoints, 1);
  return {
    fraction,
    message: `Quantity ${fmt(value)}${lead.quantity.unit ? ` ${lead.quantity.unit}` : ''} (${fmt(Math.min(value, config.quantityForFullPoints))}/${fmt(config.quantityForFullPoints)})`,
  };
}

function keywordPart(filter: FilterEvaluation): Part {
  const [first, ...rest] = filter.matchedKeywords;
  if (first !== undefined) {
    return {
      fraction: 1,
      message: `Keyword matched: ${first}${rest.length > 0 ? ` (+${rest.length} more)` : ''}`,
    };
  }
  const keywordGroupRan = filter.reasons.some(
    (r) => r.group === 'keywords' && r.type !== 'GROUP_EMPTY',
  );
  return { fraction: 0, message: keywordGroupRan ? 'No keyword matched' : 'Keyword filter off' };
}

function leadAgePart(lead: NormalizedLead, config: ScoringConfig): Part {
  const { minutes, approximate, raw } = lead.leadAge;
  if (minutes === null) return { fraction: 0, message: 'Lead age unavailable' };
  if (approximate && !config.allowApproximateLeadAge) {
    return { fraction: 0, message: `Lead age approximate, not scored: ${raw ?? ''}`.trim() };
  }
  const tier = LEAD_AGE_TIERS.find(([max]) => minutes <= max);
  return { fraction: tier?.[1] ?? 0, message: `Lead age ${fmt(minutes)} min` };
}

function parts(
  lead: NormalizedLead,
  filter: FilterEvaluation,
  config: ScoringConfig,
): Record<ScoreComponent, Part> {
  const { mobileAvailable, whatsappAvailable, emailAvailable } = lead.contact;
  const hasCategory = lead.category !== null || lead.productCategory !== null;
  return {
    country: countryPart(lead, filter),
    quantity: quantityPart(lead, config),
    mobile: {
      fraction: mobileAvailable ? 1 : 0,
      message: mobileAvailable ? 'Mobile available' : 'Mobile unavailable',
    },
    whatsapp: {
      fraction: whatsappAvailable ? 1 : 0,
      message: whatsappAvailable ? 'WhatsApp available' : 'WhatsApp unavailable',
    },
    email: {
      fraction: emailAvailable ? 1 : 0,
      message: emailAvailable ? 'Email available' : 'Email unavailable',
    },
    keyword: keywordPart(filter),
    category: {
      fraction: hasCategory ? 1 : 0,
      message: hasCategory
        ? `Category: ${lead.productCategory ?? lead.category ?? ''}`
        : 'Category unavailable',
    },
    buyerProducts: {
      fraction: lead.buys.normalizedProducts.length > 0 ? 1 : 0,
      message:
        lead.buys.normalizedProducts.length > 0
          ? `Buyer products listed: ${lead.buys.normalizedProducts.length}`
          : 'No buyer products listed',
    },
    leadAge: leadAgePart(lead, config),
  };
}

export interface ScoreOptions {
  /** Metadata only. */
  readonly calculatedAt: number;
}

/**
 * REJECTED leads get { score: null, priority: REJECTED }, never 0/LOW.
 * Matched leads with scoring off get { score: null, priority: UNSCORED }.
 */
export function scoreLead(
  lead: NormalizedLead,
  filter: FilterEvaluation,
  scoring: CompiledScoring,
  options: ScoreOptions,
): LeadScoreResult {
  const { calculatedAt } = options;
  if (filter.status !== 'MATCHED') {
    return {
      kind: 'REJECTED',
      eligible: false,
      score: null,
      priority: 'REJECTED',
      reasons: [],
      calculatedAt,
    };
  }
  const { config, total } = scoring;
  if (!config.enabled) {
    return {
      kind: 'UNSCORED',
      eligible: true,
      score: null,
      priority: 'UNSCORED',
      reasons: [],
      calculatedAt,
    };
  }

  const byComponent = parts(lead, filter, config);
  const reasons: ScoreReason[] = [];
  let rawHundredths = 0;
  for (const type of Object.keys(byComponent) as ScoreComponent[]) {
    const weight = config.weights[type];
    if (weight === 0) continue; // a component switched off contributes nothing and is not listed
    const { fraction, message } = byComponent[type];
    // Defensive clamp: every fraction is already in [0, 1] by construction.
    const safe = Number.isFinite(fraction) ? Math.min(Math.max(fraction, 0), 1) : 0;
    const earned = hundredths(weight * safe);
    rawHundredths += earned;
    reasons.push({ type, points: fromHundredths(earned), maxPoints: weight, message });
  }

  const score = Math.min(100, Math.max(0, Math.round(rawHundredths / total)));
  return {
    kind: 'SCORED',
    eligible: true,
    score,
    rawScore: fromHundredths(rawHundredths),
    maxRawScore: total,
    priority: priorityFor(score, config.thresholds),
    reasons,
    calculatedAt,
  };
}
