/**
 * Lead as produced by the Phase 2 extraction pipeline. Every field may be
 * missing on a real card, so partial leads are normal. Raw values are always
 * kept next to parsed values; parsing never overwrites the original text.
 * Scoring/classification fields are added in later phases.
 */

/** Fields that describe the lead itself and count toward completeness. */
export type CoreLeadField = 'title' | 'country' | 'leadAge' | 'category' | 'quantity' | 'buys';

/** Every field the extractor reports a state for. */
export type LeadField =
  CoreLeadField | 'strength' | 'dosageForm' | 'quantityPerStrip' | 'engagement' | 'contact';

/**
 * found   — read successfully
 * missing — FIELD_MISSING: not in this card's DOM (normal; IndiaMART omits rows)
 * failed  — FIELD_EXTRACTION_FAILED: present in the DOM but could not be read
 *           or parsed. Only this state is an extraction problem.
 */
export type FieldState = 'found' | 'missing' | 'failed';

export interface LeadEngagement {
  readonly requirements: number | null;
  readonly calls: number | null;
  readonly replies: number | null;
  /** true only when read from verified markup. */
  readonly verified: boolean;
  readonly raw: string | null;
}

/**
 * Availability flags come from IndiaMART markers ("Mobile Number Available").
 * They do NOT mean the value is on the page; values stay null unless IndiaMART
 * actually renders them after a legitimate user action. Never fabricated.
 */
export interface LeadContact {
  readonly emailAvailable: boolean;
  readonly email: string | null;
  readonly mobileAvailable: boolean;
  readonly mobileNumber: string | null;
  readonly whatsappAvailable: boolean;
}

export interface LeadExtractionInfo {
  /**
   * 0..1: how reliably the fields that ARE present were read (failed fields
   * and weaker selector strategies lower it). Absent fields do not.
   */
  readonly confidence: number;
  /** 0..1: share of core fields present and read. Informational only. */
  readonly completeness: number;
  readonly fields: Readonly<Record<LeadField, FieldState>>;
  /** FIELD_EXTRACTION_FAILED fields only. */
  readonly failedFields: readonly LeadField[];
  /** FIELD_MISSING fields: absent from this card. Not a problem. */
  readonly missingFields: readonly LeadField[];
  /** Actionable problems (one per failure, plus parse details). */
  readonly warnings: readonly string[];
  /** Non-error diagnostics, e.g. unverified engagement, page-level breadcrumb. */
  readonly notes: readonly string[];
}

export interface Lead {
  readonly id: string;
  readonly fingerprint: string;

  readonly rawTitle: string | null;
  readonly normalizedTitle: string | null;

  readonly country: string | null;

  readonly rawLeadAge: string | null;
  readonly leadAgeMinutes: number | null;

  readonly category: string | null;
  readonly productCategory: string | null;
  readonly breadcrumbs: readonly string[];

  readonly quantity: number | null;
  readonly quantityUnit: string | null;
  readonly quantityRaw: string | null;

  readonly strengthRaw: string | null;
  readonly strengthValue: number | null;
  readonly strengthUnit: string | null;

  readonly dosageForm: string | null;

  readonly quantityPerStripRaw: string | null;
  readonly quantityPerStripValue: number | null;
  readonly quantityPerStripUnit: string | null;

  readonly buysRaw: string | null;
  readonly buys: readonly string[];

  readonly engagement: LeadEngagement;
  readonly contact: LeadContact;
  readonly extraction: LeadExtractionInfo;

  readonly detectedAt: number;
}

/** A lead before identity is assigned (fingerprint needs the extracted fields). */
export type ExtractedLead = Omit<Lead, 'id' | 'fingerprint'>;
