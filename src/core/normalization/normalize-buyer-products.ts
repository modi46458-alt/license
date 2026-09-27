import type { Normalized, NormalizedBuys } from './normalization-types';
import { normalizeForComparison, normalizeText } from './normalize-text';

/**
 * Uses the product list already split by the extractor (the DOM layer owns
 * splitting). Cleans each item for display and comparison; never filters.
 */
export function normalizeBuyerProducts(
  raw: string | null,
  products: readonly string[],
): Normalized<NormalizedBuys> {
  const display = products.map((p) => normalizeText(p)).filter((p): p is string => p !== null);
  return {
    value: {
      raw,
      products: display,
      normalizedProducts: display.map((p) => normalizeForComparison(p) ?? p),
    },
    warnings: raw !== null && display.length === 0 ? ['buys: no products in value'] : [],
  };
}
