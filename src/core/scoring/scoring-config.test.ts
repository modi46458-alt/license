import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCORING_CONFIG,
  SCORE_COMPONENTS,
  SCORING_CONFIG_VERSION,
  parseScoringConfig,
  scoringConfigOrDefault,
  summarizeScoringConfig,
  totalWeight,
  type ScoringConfig,
} from './index';

const base = (): Record<string, unknown> => ({ ...structuredClone(DEFAULT_SCORING_CONFIG) });
const withWeights = (patch: Record<string, unknown>) => ({
  ...base(),
  weights: { ...DEFAULT_SCORING_CONFIG.weights, ...patch },
});
const withThresholds = (patch: Record<string, unknown>) => ({
  ...base(),
  thresholds: { ...DEFAULT_SCORING_CONFIG.thresholds, ...patch },
});

describe('default scoring config', () => {
  it('weights total exactly 100', () => {
    expect(totalWeight(DEFAULT_SCORING_CONFIG.weights)).toBe(100);
  });

  it('has the documented weights and thresholds', () => {
    expect(DEFAULT_SCORING_CONFIG.weights).toEqual({
      country: 25,
      quantity: 20,
      mobile: 10,
      whatsapp: 15,
      email: 10,
      keyword: 8,
      category: 5,
      buyerProducts: 3,
      leadAge: 4,
    });
    expect(DEFAULT_SCORING_CONFIG.thresholds).toEqual({ critical: 90, high: 75, medium: 50 });
    expect(DEFAULT_SCORING_CONFIG.version).toBe(SCORING_CONFIG_VERSION);
    expect(DEFAULT_SCORING_CONFIG.enabled).toBe(true);
  });

  it('is itself valid and fits storage.sync', () => {
    expect(parseScoringConfig(DEFAULT_SCORING_CONFIG)).toEqual(DEFAULT_SCORING_CONFIG);
    expect(JSON.stringify(DEFAULT_SCORING_CONFIG).length).toBeLessThan(8192);
  });

  it('summary', () => {
    expect(summarizeScoringConfig(DEFAULT_SCORING_CONFIG)).toBe(
      'weights 100 · critical ≥ 90 · high ≥ 75 · medium ≥ 50',
    );
    expect(summarizeScoringConfig({ ...DEFAULT_SCORING_CONFIG, enabled: false })).toBe(
      'Scoring off',
    );
    const heavy = parseScoringConfig(withWeights({ country: 35 })) as ScoringConfig;
    expect(summarizeScoringConfig(heavy)).toMatch(/^weights 110 \(scaled\)/);
  });
});

describe('parseScoringConfig accepts', () => {
  it.each([
    ['weights over 100 in total', withWeights({ country: 50 })],
    ['a zero weight', withWeights({ leadAge: 0 })],
    ['fractional weights', withWeights({ category: 2.5 })],
    ['tight thresholds', withThresholds({ critical: 3, high: 2, medium: 1 })],
    ['scoring off', { ...base(), enabled: false }],
  ])('%s', (_, input) => {
    expect(parseScoringConfig(input)).not.toBeNull();
  });
});

describe('parseScoringConfig rejects', () => {
  const cases: Array<[string, unknown]> = [
    ['null', null],
    ['string', 'scoring'],
    ['array', []],
    ['wrong version', { ...base(), version: 2 }],
    ['missing version', { ...base(), version: undefined }],
    ['enabled not boolean', { ...base(), enabled: 1 }],
    ['approximate flag missing', { ...base(), allowApproximateLeadAge: undefined }],
    ['negative weight', withWeights({ country: -1 })],
    ['NaN weight', withWeights({ quantity: Number.NaN })],
    ['Infinity weight', withWeights({ email: Number.POSITIVE_INFINITY })],
    ['weight over 100', withWeights({ country: 101 })],
    ['string weight', withWeights({ mobile: '10' })],
    [
      'missing weight',
      { ...base(), weights: { ...DEFAULT_SCORING_CONFIG.weights, leadAge: undefined } },
    ],
    ['unknown weight', withWeights({ loyalty: 5 })],
    [
      'all weights zero',
      { ...base(), weights: Object.fromEntries(SCORE_COMPONENTS.map((c) => [c, 0])) },
    ],
    ['reversed thresholds', withThresholds({ critical: 50, high: 75, medium: 90 })],
    ['equal thresholds', withThresholds({ high: 90 })],
    ['critical over 100', withThresholds({ critical: 101 })],
    ['medium zero', withThresholds({ medium: 0 })],
    ['fractional threshold', withThresholds({ high: 75.5 })],
    ['NaN threshold', withThresholds({ medium: Number.NaN })],
    ['zero full-points quantity', { ...base(), quantityForFullPoints: 0 }],
    ['negative full-points quantity', { ...base(), quantityForFullPoints: -5 }],
    [
      'Infinity full-points quantity',
      { ...base(), quantityForFullPoints: Number.POSITIVE_INFINITY },
    ],
  ];
  it.each(cases)('%s', (_, input) => {
    expect(parseScoringConfig(input)).toBeNull();
    expect(scoringConfigOrDefault(input)).toEqual({
      config: DEFAULT_SCORING_CONFIG,
      fromDefaults: true,
    });
  });
});
