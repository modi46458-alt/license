import { normalizeForComparison } from '../normalization/normalize-text';

/**
 * Keyword matching on whole words. Text and keywords are split into word
 * tokens (letters and digits); a keyword matches when its tokens appear
 * consecutively in the text. Each token comparison tolerates the regular
 * English plural: "tablet" ⇄ "tablets", "box" ⇄ "boxes", "remedy" ⇄ "remedies".
 *
 * So "tablet" matches "Planep 25 mg Tablet" and "Propranolol Tablets", but
 * never "Tabletop"; "personal use" matches "for Personal Use" but not
 * "personal user". No stemming beyond plurals, no synonyms, no fuzzy match.
 */

const WORD = /[\p{L}\p{N}]+/gu;

export function wordTokens(text: string | null | undefined): string[] {
  const normalized = normalizeForComparison(text);
  return normalized === null ? [] : (normalized.match(WORD) ?? []);
}

export function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (long === `${short}s` || long === `${short}es`) return true;
  return short.endsWith('y') && long === `${short.slice(0, -1)}ies`;
}

export interface CompiledKeyword {
  /** As configured, for display. */
  readonly label: string;
  readonly tokens: readonly string[];
}

export function compileKeyword(value: string): CompiledKeyword | null {
  const tokens = wordTokens(value);
  return tokens.length === 0 ? null : { label: value.trim(), tokens };
}

/** Index of the first occurrence of the keyword in `words`, or -1. */
export function findKeyword(words: readonly string[], keyword: CompiledKeyword): number {
  const n = keyword.tokens.length;
  outer: for (let i = 0; i + n <= words.length; i++) {
    for (let j = 0; j < n; j++) {
      if (!sameWord(words[i + j] ?? '', keyword.tokens[j] ?? '')) continue outer;
    }
    return i;
  }
  return -1;
}
