import type { ExtractedLead } from '../types/lead';
import { normalizeText } from '../parsing/text';
import { cyrb53 } from './hash';

/**
 * Deterministic lead identity from stable business fields.
 *
 * Included: normalised title, country, quantity, product category, buyer's
 * product interests. Excluded on purpose: lead age (ticks every minute),
 * engagement counts (change as sellers respond), contact availability, and
 * anything positional in the DOM.
 *
 * Returns null when no identity field is present; such a card cannot be
 * deduplicated reliably and is reported as an extraction failure.
 */
export function canonicalLeadKey(lead: ExtractedLead): string | null {
  const parts = {
    t: lead.normalizedTitle,
    c: normalizeText(lead.country),
    q: normalizeText(lead.quantityRaw),
    p: normalizeText(lead.productCategory),
    b: lead.buys.length > 0 ? lead.buys.map((b) => normalizeText(b)).join('|') : null,
  };
  if (parts.t === null && parts.p === null) return null;
  return Object.entries(parts)
    .map(([key, value]) => `${key}=${value ?? ''}`)
    .join('\u241f');
}

export function createLeadFingerprint(lead: ExtractedLead): string | null {
  const key = canonicalLeadKey(lead);
  return key === null ? null : `fp_${cyrb53(key)}`;
}

export function leadIdFromFingerprint(fingerprint: string): string {
  return `lead_${fingerprint.slice(3)}`;
}

/**
 * What a lead is about, independent of its details: normalised title, else
 * product category. Used to tell "this card finished rendering" (same
 * identity, new fingerprint) from "this element now shows another lead".
 */
export function leadIdentityKey(
  lead: Pick<ExtractedLead, 'normalizedTitle' | 'productCategory'>,
): string | null {
  return lead.normalizedTitle ?? normalizeText(lead.productCategory);
}
