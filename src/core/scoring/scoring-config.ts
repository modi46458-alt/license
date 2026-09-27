import {
  SCORE_COMPONENTS,
  SCORING_CONFIG_VERSION,
  type ScoreComponent,
  type ScoringConfig,
} from './scoring-types';

export const SCORING_LIMITS = { maxWeight: 100, maxQuantityForFullPoints: 1_000_000 } as const;

/**
 * Defaults total exactly 100, so the score equals the points earned.
 * Country 25, quantity 20, WhatsApp 15, mobile 10, email 10, keyword 8,
 * category 5, lead age 4, buyer products 3.
 */
export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  version: SCORING_CONFIG_VERSION,
  enabled: true,
  weights: {
    country: 25,
    quantity: 20,
    mobile: 10,
    whatsapp: 15,
    email: 10,
    keyword: 8,
    category: 5,
    buyerProducts: 3,
    leadAge: 4,
  },
  thresholds: { critical: 90, high: 75, medium: 50 },
  quantityForFullPoints: 100,
  allowApproximateLeadAge: false,
};

export function totalWeight(weights: Readonly<Record<ScoreComponent, number>>): number {
  return SCORE_COMPONENTS.reduce((sum, c) => sum + weights[c], 0);
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNumberIn = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

/**
 * Strict parse. Null for anything invalid: unsupported version, negative /
 * NaN / Infinity / oversized weights, a zero total, thresholds that are not
 * integers with 0 < medium < high < critical ≤ 100, or a non-positive
 * quantity reference.
 */
export function parseScoringConfig(input: unknown): ScoringConfig | null {
  if (!isObj(input) || input.version !== SCORING_CONFIG_VERSION) return null;
  if (typeof input.enabled !== 'boolean' || typeof input.allowApproximateLeadAge !== 'boolean') {
    return null;
  }
  const { weights: w, thresholds: t } = input;
  if (!isObj(w) || !isObj(t)) return null;

  const weights = {} as Record<ScoreComponent, number>;
  for (const c of SCORE_COMPONENTS) {
    const v = w[c];
    if (!isNumberIn(v, 0, SCORING_LIMITS.maxWeight)) return null;
    weights[c] = v;
  }
  if (Object.keys(w).some((k) => !SCORE_COMPONENTS.includes(k as ScoreComponent))) return null;
  if (totalWeight(weights) <= 0) return null;

  const { critical, high, medium } = t;
  const isThreshold = (v: unknown): v is number => isNumberIn(v, 1, 100) && Number.isInteger(v);
  if (!isThreshold(critical) || !isThreshold(high) || !isThreshold(medium)) return null;
  if (!(critical > high && high > medium)) return null;

  if (
    !isNumberIn(
      input.quantityForFullPoints,
      Number.MIN_VALUE,
      SCORING_LIMITS.maxQuantityForFullPoints,
    )
  ) {
    return null;
  }

  return {
    version: SCORING_CONFIG_VERSION,
    enabled: input.enabled,
    weights,
    thresholds: { critical, high, medium },
    quantityForFullPoints: input.quantityForFullPoints,
    allowApproximateLeadAge: input.allowApproximateLeadAge,
  };
}

export function scoringConfigOrDefault(input: unknown): {
  config: ScoringConfig;
  fromDefaults: boolean;
} {
  const parsed = parseScoringConfig(input);
  return parsed
    ? { config: parsed, fromDefaults: false }
    : { config: DEFAULT_SCORING_CONFIG, fromDefaults: true };
}

export function summarizeScoringConfig(config: ScoringConfig): string {
  if (!config.enabled) return 'Scoring off';
  const { critical, high, medium } = config.thresholds;
  const total = totalWeight(config.weights);
  return `weights ${total}${total === 100 ? '' : ' (scaled)'} · critical ≥ ${critical} · high ≥ ${high} · medium ≥ ${medium}`;
}
