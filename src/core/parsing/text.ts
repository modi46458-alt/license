/** Collapse whitespace (incl. NBSP), trim. Returns null for empty input. */
export function cleanOrNull(value: string | null | undefined): string | null {
  const text = (value ?? '').replace(/[\s\u00a0]+/g, ' ').trim();
  return text.length > 0 ? text : null;
}

/** Comparison form: Unicode-normalised, lower-cased, single-spaced. Never shown to users. */
export function normalizeText(value: string | null | undefined): string | null {
  const text = cleanOrNull(value?.normalize('NFKC'));
  return text === null ? null : text.toLowerCase();
}

/** Split a comma-separated list, trimming items and dropping empties. Order preserved. */
export function splitList(value: string | null | undefined, separator: RegExp = /,/): string[] {
  if (!value) return [];
  return value
    .split(separator)
    .map((item) => cleanOrNull(item))
    .filter((item): item is string => item !== null);
}
