import type { Lead } from '../types/lead';
import { NORMALIZATION_VERSION, type NormalizedLead } from './normalization-types';
import { normalizeBuyerProducts } from './normalize-buyer-products';
import { normalizeContact } from './normalize-contact';
import { normalizeCountry } from './normalize-country';
import { normalizeDosageForm } from './normalize-dosage-form';
import { normalizeLeadAge } from './normalize-lead-age';
import { normalizeMeasure } from './normalize-quantity';
import { normalizeStrength } from './normalize-strength';
import { normalizeForComparison, normalizeText, tokenize } from './normalize-text';

export interface NormalizeOptions {
  /** Metadata only (normalization.normalizedAt); never used in any value. */
  readonly normalizedAt: number;
}

/**
 * Extracted Lead → canonical, filter-ready NormalizedLead.
 *
 * Pure and deterministic: no DOM, no clock (normalizedAt is supplied), no
 * network, no shared state. The same Lead always gives the same result apart
 * from normalizedAt. Raw values are copied, never altered. Parse problems
 * become normalization warnings; this function does not throw on odd input.
 */
export function normalizeLead(lead: Lead, options: NormalizeOptions): NormalizedLead {
  const country = normalizeCountry(lead.country);
  const quantity = normalizeMeasure('quantity', lead.quantityRaw);
  const perStrip = normalizeMeasure('quantityPerStrip', lead.quantityPerStripRaw);
  const strength = normalizeStrength(lead.strengthRaw);
  const dosageForm = normalizeDosageForm(lead.dosageForm);
  const buys = normalizeBuyerProducts(lead.buysRaw, lead.buys);
  const leadAge = normalizeLeadAge(lead.rawLeadAge);

  return {
    id: lead.id,
    fingerprint: lead.fingerprint,
    title: {
      raw: lead.rawTitle,
      normalized: normalizeForComparison(lead.rawTitle),
      tokens: tokenize(lead.rawTitle),
    },
    country: country.value,
    quantity: quantity.value,
    strength: strength.value,
    dosageForm: dosageForm.value,
    quantityPerStrip: perStrip.value,
    category: normalizeText(lead.category),
    productCategory: normalizeText(lead.productCategory),
    breadcrumbs: lead.breadcrumbs
      .map((b) => normalizeText(b))
      .filter((b): b is string => b !== null),
    buys: buys.value,
    engagement: {
      requirements: lead.engagement.requirements,
      calls: lead.engagement.calls,
      replies: lead.engagement.replies,
      verified: lead.engagement.verified,
    },
    contact: normalizeContact(lead.contact),
    leadAge: leadAge.value,
    normalization: {
      warnings: [
        ...country.warnings,
        ...quantity.warnings,
        ...perStrip.warnings,
        ...strength.warnings,
        ...dosageForm.warnings,
        ...buys.warnings,
        ...leadAge.warnings,
      ],
      normalizedAt: options.normalizedAt,
      version: NORMALIZATION_VERSION,
    },
  };
}
