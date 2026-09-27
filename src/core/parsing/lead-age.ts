/**
 * Converts IndiaMART relative ages ("22 mins ago", "1 hr ago", "3 days ago",
 * "just now", "yesterday") to minutes. Months/years are approximate (30 d /
 * 365 d). Returns null when the text is not a recognised relative age.
 */
const UNIT_MINUTES: ReadonlyArray<readonly [RegExp, number]> = [
  [/^(?:s|sec|secs|second|seconds)$/, 1 / 60],
  [/^(?:m|min|mins|minute|minutes)$/, 1],
  [/^(?:h|hr|hrs|hour|hours)$/, 60],
  [/^(?:d|day|days)$/, 1440],
  [/^(?:w|wk|wks|week|weeks)$/, 10080],
  [/^(?:mo|month|months)$/, 43200],
  [/^(?:y|yr|yrs|year|years)$/, 525600],
];

export function parseLeadAgeMinutes(raw: string | null | undefined): number | null {
  const text = (raw ?? '')
    .replace(/[\s\u00a0]+/g, ' ')
    .trim()
    .toLowerCase();
  if (text === 'just now') return 0;
  if (text === 'yesterday') return 1440;

  const match = /^(\d+)\s*([a-z]+)\s+ago$/.exec(text);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2] ?? '';
  const factor = UNIT_MINUTES.find(([pattern]) => pattern.test(unit))?.[1];
  return factor === undefined ? null : Math.round(amount * factor);
}
