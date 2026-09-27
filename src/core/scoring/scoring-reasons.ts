import type { LeadScoreResult, ScoreComponent, ScoreReason } from './scoring-types';

const SHORT: Readonly<Record<ScoreComponent, string>> = {
  country: 'country',
  quantity: 'quantity',
  mobile: 'mobile',
  whatsapp: 'WhatsApp',
  email: 'email',
  keyword: 'keyword',
  category: 'category',
  buyerProducts: 'buyer products',
  leadAge: 'lead age',
};

export function formatPoints(points: number): string {
  const shown = Number.isInteger(points) ? String(points) : points.toFixed(1);
  return `+${shown}`;
}

/** "+25 Country matched: United States" */
export function formatScoreReason(reason: ScoreReason): string {
  return `${formatPoints(reason.points)} ${reason.message}`;
}

/**
 * One concise log line: "Score 87/100 (HIGH): +25 country, +20 quantity, …".
 * Only components that earned points are listed, largest first.
 */
export function explainScore(result: LeadScoreResult): string {
  if (result.kind === 'REJECTED') return 'Not scored: rejected by filters';
  if (result.kind === 'UNSCORED') return 'Not scored: scoring is off';
  const earned = result.reasons
    .filter((r) => r.points > 0)
    .sort((a, b) => b.points - a.points)
    .map((r) => `${formatPoints(r.points)} ${SHORT[r.type]}`);
  return `Score ${result.score}/100 (${result.priority})${earned.length > 0 ? `: ${earned.join(', ')}` : ''}`;
}
