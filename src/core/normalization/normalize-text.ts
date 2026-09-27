/**
 * Text normalization. Two forms, never mixed up:
 *   normalizeText          → display form: whitespace cleaned, punctuation and case kept
 *   normalizeForComparison → comparison form: NFKC, lower-case, single-spaced
 * Inputs are never modified.
 */

/** Unicode whitespace incl. NBSP, zero-width space/joiners, BOM. */
const WHITESPACE = /[\s\u00a0\u1680\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff]+/g;
const ZERO_WIDTH = /\u200c|\u200d|\u2060/g;

export function normalizeText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = value.normalize('NFKC').replace(ZERO_WIDTH, '').replace(WHITESPACE, ' ').trim();
  return text.length > 0 ? text : null;
}

export function normalizeForComparison(value: string | null | undefined): string | null {
  const text = normalizeText(value);
  return text === null ? null : text.toLowerCase();
}

/** Punctuation trimmed from token edges; inner punctuation (20mg/ml, 40%, w/w) is kept. */
const EDGE_PUNCTUATION = /^[\s,.;:!?()[\]{}"'“”‘’«»|]+|[\s,.;:!?()[\]{}"'“”‘’«»|]+$/g;

/**
 * Conservative keyword tokens: comparison form split on whitespace, edge
 * punctuation trimmed, empties and duplicates dropped, order kept. No
 * stemming, stop-word removal or synonyms.
 */
export function tokenize(value: string | null | undefined): string[] {
  const text = normalizeForComparison(value);
  if (text === null) return [];
  const seen = new Set<string>();
  for (const part of text.split(' ')) {
    const token = part.replace(EDGE_PUNCTUATION, '');
    if (token) seen.add(token);
  }
  return [...seen];
}

/** Lookup key for alias tables: comparison form without diacritics, dots or "the ". */
export function aliasKey(value: string | null | undefined): string | null {
  const text = normalizeForComparison(value);
  if (text === null) return null;
  const key = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\./g, '')
    .replace(/&/g, ' and ')
    .replace(/[\s_-]+/g, ' ')
    .trim()
    .replace(/^the /, '');
  return key.length > 0 ? key : null;
}
