/**
 * Canonical, filter-ready lead (Phase 3). Built from an extracted Lead by pure
 * functions; every raw value is kept next to its normalized form.
 */

export const NORMALIZATION_VERSION = '1.0.0';

export interface NormalizedTitle {
  readonly raw: string | null;
  /** Comparison form (lower-case, single-spaced). */
  readonly normalized: string | null;
  /** Conservative keyword tokens for later matching. */
  readonly tokens: readonly string[];
}

export interface NormalizedCountry {
  readonly raw: string | null;
  /** Canonical name ("United States"), or the cleaned input when unknown. */
  readonly normalized: string | null;
  /** ISO 3166-1 alpha-2, or null when the country is not in the alias map. */
  readonly code: string | null;
}

export interface NormalizedMeasure {
  readonly raw: string | null;
  readonly value: number | null;
  /** Unit as written ("Boxes"). */
  readonly unit: string | null;
  /** Canonical singular lower-case unit ("box"); never converted between units. */
  readonly normalizedUnit: string | null;
}

export interface NormalizedStrength {
  readonly raw: string | null;
  /** Primary value/unit, e.g. 36 IU in "36 IU (12 mg)". */
  readonly value: number | null;
  readonly unit: string | null;
  /** Second quantity in combined/equivalent formats, e.g. 12 mg. */
  readonly secondaryValue: number | null;
  readonly secondaryUnit: string | null;
  /** true for combined or equivalent formats that need care when compared. */
  readonly complex: boolean;
}

export interface NormalizedDosageForm {
  readonly raw: string | null;
  readonly normalized: string | null;
}

export interface NormalizedBuys {
  readonly raw: string | null;
  /** Display form, order kept. */
  readonly products: readonly string[];
  /** Comparison form of each product, same order. */
  readonly normalizedProducts: readonly string[];
}

export interface NormalizedEngagement {
  readonly requirements: number | null;
  readonly calls: number | null;
  readonly replies: number | null;
  readonly verified: boolean;
}

/** Availability only. Actual numbers/addresses are never produced here. */
export interface NormalizedContact {
  readonly mobileAvailable: boolean;
  readonly whatsappAvailable: boolean;
  readonly emailAvailable: boolean;
}

export interface NormalizedLeadAge {
  readonly raw: string | null;
  readonly minutes: number | null;
  /** true when the unit is only approximately convertible (months, years). */
  readonly approximate: boolean;
}

export interface NormalizationInfo {
  /** "field: problem" — raw values are not repeated here (they are kept on the field). */
  readonly warnings: readonly string[];
  readonly normalizedAt: number;
  readonly version: string;
}

export interface NormalizedLead {
  readonly id: string;
  readonly fingerprint: string;
  readonly title: NormalizedTitle;
  readonly country: NormalizedCountry;
  readonly quantity: NormalizedMeasure;
  readonly strength: NormalizedStrength;
  readonly dosageForm: NormalizedDosageForm;
  readonly quantityPerStrip: NormalizedMeasure;
  readonly category: string | null;
  readonly productCategory: string | null;
  readonly breadcrumbs: readonly string[];
  readonly buys: NormalizedBuys;
  readonly engagement: NormalizedEngagement;
  readonly contact: NormalizedContact;
  readonly leadAge: NormalizedLeadAge;
  readonly normalization: NormalizationInfo;
}

/** Each field normalizer returns its value and any warnings, nothing else. */
export interface Normalized<T> {
  readonly value: T;
  readonly warnings: readonly string[];
}
