/**
 * Phase 4 filter model. Pure data: no functions, no DOM, JSON-serialisable
 * so it can live in chrome.storage.sync.
 */

export const FILTER_CONFIG_VERSION = 1;

/** A configured term that can be switched off without deleting it. */
export interface FilterTerm {
  readonly value: string;
  readonly enabled: boolean;
}

export type TextField = 'title' | 'productCategory' | 'category' | 'buyerProducts';
export const TEXT_FIELDS: readonly TextField[] = [
  'title',
  'productCategory',
  'category',
  'buyerProducts',
];

/**
 * ANY: at least one enabled term must match (terms are OR-ed).
 * ALL: every enabled term must match (terms are AND-ed).
 */
export type TermMode = 'ANY' | 'ALL';

/**
 * AND: every enabled positive group must pass.
 * OR:  at least one enabled positive group must pass.
 * Excluded keywords are a NOT group applied in both modes: any hit rejects.
 */
export type LogicMode = 'AND' | 'OR';

export interface FilterConfig {
  readonly version: typeof FILTER_CONFIG_VERSION;
  /** Master switch. Off: every lead is MATCHED with a FILTER_DISABLED reason. */
  readonly enabled: boolean;
  readonly countries: {
    readonly enabled: boolean;
    readonly mode: TermMode;
    readonly values: readonly FilterTerm[];
  };
  readonly keywords: {
    readonly enabled: boolean;
    readonly mode: TermMode;
    readonly values: readonly FilterTerm[];
    readonly fields: readonly TextField[];
  };
  readonly negativeKeywords: {
    readonly enabled: boolean;
    readonly values: readonly FilterTerm[];
    readonly fields: readonly TextField[];
  };
  readonly quantity: {
    readonly enabled: boolean;
    readonly min: number | null;
    readonly max: number | null;
  };
  readonly contact: {
    readonly enabled: boolean;
    readonly mode: TermMode;
    readonly mobile: boolean;
    readonly whatsapp: boolean;
    readonly email: boolean;
  };
  readonly leadAge: {
    readonly enabled: boolean;
    readonly minMinutes: number | null;
    readonly maxMinutes: number | null;
  };
  readonly logic: { readonly mode: LogicMode };
}

/* ------------------------------------------------------------------ */
/* Evaluation                                                           */
/* ------------------------------------------------------------------ */

export type FilterGroup =
  'countries' | 'keywords' | 'negativeKeywords' | 'quantity' | 'contact' | 'leadAge';

/** pass/fail decide the result; info never does (warnings, skipped groups). */
export type ReasonOutcome = 'pass' | 'fail' | 'info';

interface ReasonBase {
  readonly group: FilterGroup | 'filters';
  readonly outcome: ReasonOutcome;
  /** Human-readable, e.g. "Quantity 10 < minimum 20". */
  readonly message: string;
}

export type FilterReason =
  | (ReasonBase & { readonly type: 'FILTER_DISABLED' })
  | (ReasonBase & { readonly type: 'GROUP_EMPTY' })
  | (ReasonBase & {
      readonly type: 'COUNTRY_MATCH';
      readonly value: string;
      readonly code: string | null;
    })
  | (ReasonBase & {
      readonly type: 'COUNTRY_MISMATCH';
      readonly value: string;
      readonly expected: string;
    })
  | (ReasonBase & { readonly type: 'COUNTRY_MISSING' })
  | (ReasonBase & {
      readonly type: 'KEYWORD_MATCH';
      readonly keyword: string;
      readonly field: TextField;
      readonly matchedText: string;
    })
  | (ReasonBase & { readonly type: 'KEYWORD_MISMATCH'; readonly keywords: readonly string[] })
  | (ReasonBase & {
      readonly type: 'NEGATIVE_KEYWORD';
      readonly keyword: string;
      readonly field: TextField;
      readonly matchedText: string;
    })
  | (ReasonBase & { readonly type: 'NEGATIVE_CLEAR' })
  | (ReasonBase & { readonly type: 'QUANTITY_PASS'; readonly value: number })
  | (ReasonBase & {
      readonly type: 'QUANTITY_TOO_LOW';
      readonly value: number;
      readonly expected: number;
    })
  | (ReasonBase & {
      readonly type: 'QUANTITY_TOO_HIGH';
      readonly value: number;
      readonly expected: number;
    })
  | (ReasonBase & { readonly type: 'QUANTITY_MISSING'; readonly raw: string | null })
  | (ReasonBase & { readonly type: 'CONTACT_PASS'; readonly channels: readonly ContactChannel[] })
  | (ReasonBase & {
      readonly type: 'CONTACT_MISSING';
      readonly channels: readonly ContactChannel[];
    })
  | (ReasonBase & { readonly type: 'LEAD_AGE_PASS'; readonly value: number })
  | (ReasonBase & {
      readonly type: 'LEAD_AGE_TOO_OLD';
      readonly value: number;
      readonly expected: number;
    })
  | (ReasonBase & {
      readonly type: 'LEAD_AGE_TOO_NEW';
      readonly value: number;
      readonly expected: number;
    })
  | (ReasonBase & { readonly type: 'LEAD_AGE_MISSING'; readonly raw: string | null })
  | (ReasonBase & { readonly type: 'LEAD_AGE_APPROXIMATE' });

export type FilterReasonType = FilterReason['type'];
export type ContactChannel = 'mobile' | 'whatsapp' | 'email';

export type FilterStatus = 'MATCHED' | 'REJECTED';

export interface FilterEvaluation {
  readonly status: FilterStatus;
  readonly passed: boolean;
  /** Every enabled group is evaluated; nothing stops at the first failure. */
  readonly reasons: readonly FilterReason[];
  readonly matchedKeywords: readonly string[];
  readonly matchedCountries: readonly string[];
  readonly negativeKeywords: readonly string[];
  /** Groups that failed, e.g. ["countries", "quantity"]. */
  readonly failedConditions: readonly FilterGroup[];
  readonly logic: LogicMode;
  readonly configVersion: number;
  /** Metadata only: never used to decide the result. */
  readonly evaluatedAt: number;
}
