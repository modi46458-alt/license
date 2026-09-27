import { normalizeLead } from '@/core/normalization';
import type { NormalizedLead } from '@/core/normalization';
import type { Lead } from '@/core/types/lead';

/** Plain inputs for building leads in unit tests (no DOM involved). */
export interface LeadSpec {
  title?: string | null;
  country?: string | null;
  quantity?: string | null;
  category?: string | null;
  productCategory?: string | null;
  buys?: readonly string[];
  mobile?: boolean;
  whatsapp?: boolean;
  email?: boolean;
  age?: string | null;
  strength?: string | null;
  dosageForm?: string | null;
}

export function makeLead(spec: LeadSpec = {}): Lead {
  const buys = spec.buys ?? [];
  return {
    id: 'lead_test',
    fingerprint: 'fp_test',
    rawTitle: spec.title === undefined ? 'Propranolol Tablets' : spec.title,
    normalizedTitle: null,
    country: spec.country === undefined ? 'USA' : spec.country,
    rawLeadAge: spec.age === undefined ? '22 mins ago' : spec.age,
    leadAgeMinutes: null,
    category: spec.category ?? null,
    productCategory: spec.productCategory ?? null,
    breadcrumbs: [spec.category, spec.productCategory].filter((c): c is string => !!c),
    quantity: null,
    quantityUnit: null,
    quantityRaw: spec.quantity === undefined ? '30 Strip' : spec.quantity,
    strengthRaw: spec.strength ?? null,
    strengthValue: null,
    strengthUnit: null,
    dosageForm: spec.dosageForm ?? null,
    quantityPerStripRaw: null,
    quantityPerStripValue: null,
    quantityPerStripUnit: null,
    buysRaw: buys.length > 0 ? buys.join(', ') : null,
    buys,
    engagement: { requirements: null, calls: null, replies: null, verified: false, raw: null },
    contact: {
      mobileAvailable: spec.mobile ?? false,
      mobileNumber: null,
      whatsappAvailable: spec.whatsapp ?? true,
      emailAvailable: spec.email ?? true,
      email: null,
    },
    extraction: {
      confidence: 1,
      completeness: 1,
      fields: {} as Lead['extraction']['fields'],
      failedFields: [],
      missingFields: [],
      warnings: [],
      notes: [],
    },
    detectedAt: 0,
  };
}

export function makeNormalized(spec: LeadSpec = {}): NormalizedLead {
  return normalizeLead(makeLead(spec), { normalizedAt: 0 });
}
