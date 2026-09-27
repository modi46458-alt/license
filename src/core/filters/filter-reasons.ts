import type { FilterEvaluation, FilterReason } from './filter-types';

/** ✓ pass, ✕ fail, ⚠ info — for compact UI and log rendering. */
export function reasonSymbol(reason: FilterReason): '✓' | '✕' | '⚠' {
  return reason.outcome === 'pass' ? '✓' : reason.outcome === 'fail' ? '✕' : '⚠';
}

/**
 * Concise explanation for the live log: for a match, what passed; for a
 * rejection, only what failed. "Nothing selected" notes and the "no excluded
 * keywords" confirmation are left out to keep lines short.
 */
export function explainEvaluation(evaluation: FilterEvaluation, max = 4): string {
  const wanted = evaluation.passed ? 'pass' : 'fail';
  const parts = evaluation.reasons
    .filter((r) => r.outcome === wanted && r.type !== 'NEGATIVE_CLEAR')
    .map((r) => r.message);
  const shown = parts.slice(0, max);
  if (parts.length > max) shown.push(`+${parts.length - max} more`);
  if (evaluation.reasons.some((r) => r.type === 'FILTER_DISABLED')) return 'filters are off';
  return shown.join('; ');
}
