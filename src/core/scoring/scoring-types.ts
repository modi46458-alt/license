/**
 * Phase 5 scoring model. Score = lead quality under the configured business
 * rules (0–100). It is not a confidence or a probability.
 */

export const SCORING_CONFIG_VERSION = 1;

export type ScoreComponent =
  | 'country'
  | 'quantity'
  | 'mobile'
  | 'whatsapp'
  | 'email'
  | 'keyword'
  | 'category'
  | 'buyerProducts'
  | 'leadAge';

export const SCORE_COMPONENTS: readonly ScoreComponent[] = [
  'country',
  'quantity',
  'mobile',
  'whatsapp',
  'email',
  'keyword',
  'category',
  'buyerProducts',
  'leadAge',
];

export interface ScoringConfig {
  readonly version: typeof SCORING_CONFIG_VERSION;
  /** Off: matched leads are UNSCORED (not LOW); rejected leads stay REJECTED. */
  readonly enabled: boolean;
  /** Points per component. Any total > 0 works; the score is scaled to 0–100. */
  readonly weights: Readonly<Record<ScoreComponent, number>>;
  /** Minimum score for each priority. critical > high > medium > 0. */
  readonly thresholds: {
    readonly critical: number;
    readonly high: number;
    readonly medium: number;
  };
  /** Quantity earns its full weight at this number (any unit) and scales linearly below it. */
  readonly quantityForFullPoints: number;
  /** Months/years ages are approximate; only scored when this is true. */
  readonly allowApproximateLeadAge: boolean;
}

export type ScoredPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
/**
 * Six states that never collapse into each other:
 *   REJECTED  — failed the Phase 4 filters; never scored
 *   UNSCORED  — matched, but scoring is off
 *   CRITICAL / HIGH / MEDIUM / LOW — matched and scored
 */
export type LeadPriority = ScoredPriority | 'REJECTED' | 'UNSCORED';

export interface ScoreReason {
  readonly type: ScoreComponent;
  /** Points earned (0 … maxPoints), before scaling to 0–100. Two decimals. */
  readonly points: number;
  readonly maxPoints: number;
  readonly message: string;
}

interface ResultBase {
  /** Metadata only: never used to compute the score. */
  readonly calculatedAt: number;
}

export type LeadScoreResult =
  | (ResultBase & {
      readonly kind: 'SCORED';
      readonly eligible: true;
      /** Integer 0–100. */
      readonly score: number;
      /** Sum of reason points before scaling (two decimals). */
      readonly rawScore: number;
      readonly maxRawScore: number;
      readonly priority: ScoredPriority;
      readonly reasons: readonly ScoreReason[];
    })
  | (ResultBase & {
      readonly kind: 'UNSCORED';
      readonly eligible: true;
      readonly score: null;
      readonly priority: 'UNSCORED';
      readonly reasons: readonly [];
    })
  | (ResultBase & {
      readonly kind: 'REJECTED';
      readonly eligible: false;
      readonly score: null;
      readonly priority: 'REJECTED';
      readonly reasons: readonly [];
    });
