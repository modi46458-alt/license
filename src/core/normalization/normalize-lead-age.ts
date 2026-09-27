import type { Normalized, NormalizedLeadAge } from './normalization-types';
import { normalizeForComparison } from './normalize-text';

const EXACT: ReadonlyArray<readonly [RegExp, number]> = [
  [/^(?:s|sec|secs|second|seconds)$/, 1 / 60],
  [/^(?:m|min|mins|minute|minutes)$/, 1],
  [/^(?:h|hr|hrs|hour|hours)$/, 60],
  [/^(?:d|day|days)$/, 1440],
  [/^(?:w|wk|wks|week|weeks)$/, 10080],
];
/** Calendar units: only approximately convertible (30-day month, 365-day year). */
const APPROXIMATE: ReadonlyArray<readonly [RegExp, number]> = [
  [/^(?:mo|mos|month|months)$/, 43200],
  [/^(?:y|yr|yrs|year|years)$/, 525600],
];

const EMPTY = (raw: string | null): NormalizedLeadAge => ({
  raw,
  minutes: null,
  approximate: false,
});

/**
 * "22 mins ago" → 22, "1 hour ago" → 60, "1 day ago" → 1440, "just now" → 0,
 * "an hour ago" → 60. Never reads the clock: "yesterday" and absolute dates
 * ("12 Sep") cannot be converted without it, so they return null + warning.
 */
export function normalizeLeadAge(raw: string | null): Normalized<NormalizedLeadAge> {
  const text = normalizeForComparison(raw);
  if (text === null) return { value: EMPTY(raw), warnings: [] };
  if (text === 'just now' || text === 'now') {
    return { value: { raw, minutes: 0, approximate: false }, warnings: [] };
  }
  if (text === 'yesterday' || text === 'today') {
    return { value: EMPTY(raw), warnings: ['leadAge: imprecise (needs current date)'] };
  }

  const match = /^(\d+|an?|one)\s*([a-z]+)\s+ago$/.exec(text);
  if (!match) return { value: EMPTY(raw), warnings: ['leadAge: unrecognized format'] };
  const amount = /^\d+$/.test(match[1] ?? '') ? Number(match[1]) : 1;
  const unit = match[2] ?? '';

  const exact = EXACT.find(([p]) => p.test(unit))?.[1];
  if (exact !== undefined) {
    return {
      value: { raw, minutes: Math.round(amount * exact), approximate: false },
      warnings: [],
    };
  }
  const approx = APPROXIMATE.find(([p]) => p.test(unit))?.[1];
  if (approx !== undefined) {
    return {
      value: { raw, minutes: amount * approx, approximate: true },
      warnings: ['leadAge: approximate (calendar unit)'],
    };
  }
  return { value: EMPTY(raw), warnings: ['leadAge: unrecognized unit'] };
}
