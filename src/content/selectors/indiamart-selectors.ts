/**
 * IndiaMART DOM adapter.
 *
 * This is the ONLY module that knows IndiaMART class names, IDs, label texts
 * and URL patterns. When IndiaMART changes its markup, update this file and
 * the fixture in src/tests/fixtures — nothing else should need to change.
 *
 * Every field is described as an ordered chain of strategies:
 *   primary CSS  →  semantic/text fallback  →  structural fallback
 * Each strategy carries a confidence (0..1) that flows into the lead's
 * extraction confidence. Resolution lives in selector-resolver.ts.
 *
 * Rules (enforced by selector-map.test.ts):
 *   - no :nth-child / :nth-of-type
 *   - no generated numeric IDs
 *   - no long copied CSS paths (max 3 descendant hops)
 *
 * Provenance: selectors marked `verified: true` come from DOM the user
 * inspected in the live Lead Manager. `verified: false` means the text was
 * observed but the surrounding markup was not supplied, so the strategy is
 * text-only until someone inspects it.
 */

export const SELECTOR_MAP_VERSION = '2026.09.3';

/**
 * The breadcrumb id repeats once per card, so it is matched as an attribute
 * ([id="…"]), which every engine resolves within the queried subtree. Some
 * engines take a document-wide getElementById shortcut for "#id" that misses
 * the second and later copies.
 */

/* ------------------------------------------------------------------ */
/* Strategy types                                                      */
/* ------------------------------------------------------------------ */

export type SelectorStrategy =
  | {
      readonly kind: 'css';
      readonly selector: string;
      readonly confidence: number;
      /** Element text must match this pattern for the strategy to count. */
      readonly textMatch?: RegExp;
      /** Element text must NOT match this pattern (e.g. country vs timestamp). */
      readonly textExclude?: RegExp;
      /** Skip elements with empty text. Implied by textMatch/textExclude. */
      readonly requireText?: boolean;
      /**
       * 'full' (default): the element's whole text.
       * 'leading': the first meaningful text node inside the element. Use when
       * the value shares its element with hint/tooltip/link text.
       */
      readonly textMode?: 'full' | 'leading';
    }
  | {
      /** Search descendants of `scope` whose own text matches `pattern`. */
      readonly kind: 'text';
      readonly scope: string;
      readonly pattern: RegExp;
      readonly confidence: number;
    };

export interface FieldSelector {
  readonly id: string;
  readonly description: string;
  readonly verified: boolean;
  /** Tried in order; first strategy that yields an element wins. */
  readonly strategies: readonly SelectorStrategy[];
  /** true → the field may legitimately match several elements (breadcrumbs). */
  readonly multiple?: boolean;
  /**
   * Structure that shows the field is present in a card. If it exists but no
   * strategy yields a value, the field FAILED; if it does not exist, the
   * field is MISSING (normal). Without it, an unresolved field is MISSING.
   */
  readonly presenceSelector?: string;
  /** Elements matching presenceSelector whose text matches this do not count as presence. */
  readonly presenceTextExclude?: RegExp;
}

/**
 * A "label : value" row, e.g.
 *   <li><span>Quantity</span><small>:</small><strong>10 Strip</strong></li>
 * Rows are read semantically: the label is the direct child whose text equals
 * a known label, the value is the next direct child that is not a separator.
 * No positional selectors are involved.
 */
export interface LabeledRowSelector {
  readonly rowSelector: string;
}

export interface LabeledField {
  readonly id: string;
  /** Case-insensitive, whitespace-normalised label texts accepted for this field. */
  readonly labels: readonly string[];
  readonly verified: boolean;
}

/* ------------------------------------------------------------------ */
/* Shared text patterns                                                */
/* ------------------------------------------------------------------ */

/** "22 mins ago", "1 hr ago", "3 days ago", "just now", "yesterday". */
export const RELATIVE_TIME_PATTERN =
  /^\s*(?:\d+\s*(?:sec|secs|second|seconds|min|mins|minute|minutes|hr|hrs|hour|hours|day|days|week|weeks|month|months|year|years)\s+ago|just\s+now|yesterday|today)\s*$/i;

/**
 * Hint text IndiaMART renders inside value elements (tooltips, link titles).
 * Stripped from extracted text. Observed live: a country element whose text
 * reads "CanadaClick here to view BuyLeads from Canada".
 */
export const TEXT_NOISE_PATTERNS: readonly RegExp[] = [/\s*Click here to view BuyLeads\b.*$/i];

/* ------------------------------------------------------------------ */
/* Page detection                                                      */
/* ------------------------------------------------------------------ */

export interface PageConfig {
  readonly hostPattern: RegExp;
  /**
   * Paths on which the scanner may run. The exact Lead Manager / Buy Leads
   * paths are NOT yet confirmed, so this is empty: an empty list means "any
   * path on the host, but only while lead-list signals are present in the
   * DOM". Add confirmed patterns here to restrict further.
   */
  readonly supportedPaths: readonly RegExp[];
  /** Present on pages that render lead cards. */
  readonly leadListSignals: readonly string[];
}

export const INDIAMART_PAGE: PageConfig = {
  /** Must stay in sync with manifest.json host_permissions / content_scripts. */
  hostPattern: /^https:\/\/seller\.indiamart\.com\//,
  supportedPaths: [],
  leadListSignals: ['.BuyLdC_Gtc1', '.BuyLdC_isqdet', '[id="breadcrum_pmcat_div"]'],
};

/* ------------------------------------------------------------------ */
/* Lead card detection                                                 */
/* ------------------------------------------------------------------ */

export interface CardSignal {
  readonly id: string;
  /** Weight toward the card confidence; weights across signals sum to 1. */
  readonly weight: number;
  /** null = markup not verified yet; the signal never fires. */
  readonly selector: string | null;
  /** The matched element's text must not match this (country vs timestamp). */
  readonly textExclude?: RegExp;
  /** The signal only fires if this labeled field is present (quantity). */
  readonly labeledField?: LabeledFieldId;
}

export interface LeadCardConfig {
  /**
   * Verified card wrapper selector. The real wrapper has NOT been captured,
   * so this is null and cards are found by walking up from anchors. When the
   * outerHTML is available, set it here; the detector uses it first and falls
   * back to the upward walk. Unstable selectors are rejected at runtime.
   */
  readonly containerSelector: string | null;
  /** Elements that start a card search. One card contains several. */
  readonly anchors: readonly string[];
  /** An ancestor containing more than one of any of these is a list, not a card. */
  readonly uniquePerCard: readonly string[];
  readonly signals: readonly CardSignal[];
  /** Minimum summed signal weight for an ancestor to count as a lead card. */
  readonly threshold: number;
  /** Stop walking after this many ancestors. */
  readonly maxAncestorDepth: number;
}

/**
 * The card is found structurally: walk up from an anchor, score each
 * ancestor by the independent signals it contains, stop at the first
 * ancestor that holds more than one card title. The smallest ancestor with
 * the highest score (and at least `threshold`) is the card.
 */
export const LEAD_CARD: LeadCardConfig = {
  containerSelector: null,
  anchors: ['.BuyLdC_Gtc1', '.BuyLdC_m6', '.BuyLdC_isqdet', '.BuyLdC_isqByrDtls'],
  // Observed once per card. Several of any of them means we reached the list.
  uniquePerCard: ['.BuyLdC_Gtc1', '.BuyLdC_m6', '.BuyLdC_time_loc', '[id="breadcrum_pmcat_div"]'],
  signals: [
    { id: 'title', weight: 0.25, selector: '.BuyLdC_m6' },
    {
      id: 'country',
      weight: 0.2,
      selector: '.BuyLdC_time_loc strong',
      textExclude: RELATIVE_TIME_PATTERN,
    },
    { id: 'quantity', weight: 0.15, selector: '.BuyLdC_isqdet', labeledField: 'quantity' },
    { id: 'buyer', weight: 0.15, selector: '.BuyLdC_isqByrDtls' },
    { id: 'category', weight: 0.1, selector: '[id="breadcrum_pmcat_div"] span[title]' },
    // Engagement markup not verified: weight reserved, signal never fires.
    { id: 'engagement', weight: 0.1, selector: null },
    { id: 'contact', weight: 0.05, selector: 'p.tooltip_vfr' },
  ],
  threshold: 0.5,
  maxAncestorDepth: 10,
};

/* ------------------------------------------------------------------ */
/* Scalar fields                                                       */
/* ------------------------------------------------------------------ */

export const FIELD_SELECTORS = {
  title: {
    id: 'title',
    description: 'Lead title, e.g. "Propanolol 20mg Tablets From Europe to Europe"',
    verified: true,
    strategies: [
      { kind: 'css', selector: '.BuyLdC_Gtc1 .BuyLdC_m6', requireText: true, confidence: 1 },
      { kind: 'css', selector: '.BuyLdC_m6', requireText: true, confidence: 0.9 },
      // Structural: the bold 18px heading span inside the title column.
      { kind: 'css', selector: '.BuyLdC_brd > span.SLC_fwb', requireText: true, confidence: 0.6 },
    ],
  },
  country: {
    id: 'country',
    description: 'Buyer country inside the time/location block, e.g. "Luxembourg"',
    verified: true,
    // A non-time <strong> in the time/location block is the country slot.
    presenceSelector: '.BuyLdC_time_loc strong',
    presenceTextExclude: RELATIVE_TIME_PATTERN,
    strategies: [
      {
        kind: 'css',
        selector: '.BuyLdC_time_loc strong',
        textMode: 'leading',
        textExclude: RELATIVE_TIME_PATTERN,
        confidence: 1,
      },
    ],
  },
  timestamp: {
    id: 'timestamp',
    description: 'Relative lead age, e.g. "22 mins ago"',
    verified: true,
    presenceSelector: '.MrLdsB_m1',
    strategies: [
      {
        kind: 'css',
        selector: '.BuyLdC_time_loc strong.SLC_f14',
        textMatch: RELATIVE_TIME_PATTERN,
        confidence: 1,
      },
      {
        kind: 'css',
        selector: '.MrLdsB_m1 strong',
        textMatch: RELATIVE_TIME_PATTERN,
        confidence: 0.8,
      },
      // Semantic: any short strong/span in the card that reads like a relative time.
      { kind: 'text', scope: 'strong, span', pattern: RELATIVE_TIME_PATTERN, confidence: 0.6 },
    ],
  },
  categoryBreadcrumb: {
    id: 'categoryBreadcrumb',
    description: 'Category trail, e.g. ["Blood Pressure Medicine", "Propranolol Tablets"]',
    verified: true,
    multiple: true,
    presenceSelector: '[id="breadcrum_pmcat_div"]',
    strategies: [
      {
        kind: 'css',
        selector: '[id="breadcrum_pmcat_div"] li span[title]',
        requireText: true,
        confidence: 1,
      },
      {
        kind: 'css',
        selector: '[id="breadcrum_pmcat_div"] span[title]',
        requireText: true,
        confidence: 0.8,
      },
    ],
  },
} as const satisfies Record<string, FieldSelector>;

export type ScalarFieldId = keyof typeof FIELD_SELECTORS;

/* ------------------------------------------------------------------ */
/* Labeled fields (semantic extraction — never nth-child)              */
/* ------------------------------------------------------------------ */

export const LABELED_ROWS: readonly LabeledRowSelector[] = [
  // Product specification rows (ISQ = IndiaMART Specific Questions).
  { rowSelector: '.BuyLdC_isqdet' },
  // Buyer detail rows ("Buys").
  { rowSelector: '.BuyLdC_isqByrDtls' },
];

/** Direct children whose text is only this are separators, not values. */
export const LABEL_SEPARATOR_PATTERN = /^[:\-–—]?$/;

export const LABELED_FIELDS = {
  quantity: { id: 'quantity', labels: ['Quantity', 'Qty'], verified: true },
  strength: { id: 'strength', labels: ['Strength'], verified: true },
  dosageForm: { id: 'dosageForm', labels: ['Dosage Form'], verified: true },
  quantityPerStrip: { id: 'quantityPerStrip', labels: ['Quantity per Strip'], verified: true },
  buyerProducts: { id: 'buyerProducts', labels: ['Buys'], verified: true },
} as const satisfies Record<string, LabeledField>;

export type LabeledFieldId = keyof typeof LABELED_FIELDS;

/** Separator for multi-value labeled fields such as "Buys". */
export const LIST_VALUE_SEPARATOR = /\s*,\s*/;

/* ------------------------------------------------------------------ */
/* Engagement                                                          */
/* ------------------------------------------------------------------ */

export interface EngagementConfig {
  /**
   * Verified container holding "Requirements / Calls / Replies". Not captured
   * yet, so null: the extractor returns nulls with verified=false rather than
   * guessing from free text. Set this once the markup is inspected.
   */
  readonly containerSelector: string | null;
  readonly requirements: RegExp;
  readonly calls: RegExp;
  readonly replies: RegExp;
}

/** Observed text: "Requirements: 8", "Calls: 3", "Replies: 126". */
export const ENGAGEMENT_PATTERNS = {
  verified: false,
  requirements: /\bRequirements?\s*:?\s*(\d[\d,]*)/i,
  calls: /\bCalls?\s*:?\s*(\d[\d,]*)/i,
  replies: /\bRepl(?:y|ies)\s*:?\s*(\d[\d,]*)/i,
} as const;

export const ENGAGEMENT: EngagementConfig = {
  containerSelector: null,
  requirements: ENGAGEMENT_PATTERNS.requirements,
  calls: ENGAGEMENT_PATTERNS.calls,
  replies: ENGAGEMENT_PATTERNS.replies,
};

/* ------------------------------------------------------------------ */
/* Contact availability                                                */
/* ------------------------------------------------------------------ */

/**
 * These markers mean a contact channel EXISTS for the buyer. They never
 * contain the number or address itself. Do not fabricate values.
 */
export const CONTACT_AVAILABILITY = {
  markerSelector: 'p.tooltip_vfr',
  fallbackScope: 'p, span, div',
  mobile: /\bMobile\s+Number\s+Available\b/i,
  whatsapp: /\bWhats\s*App\s+Available\b/i,
  email: /\bEmail(?:\s+ID)?\s+Available\b/i,
} as const;

/* ------------------------------------------------------------------ */
/* Card actions (exposed to the user; never auto-clicked)              */
/* ------------------------------------------------------------------ */

export const ACTION_SELECTORS = {
  shortlist: {
    id: 'shortlist',
    description: 'Shortlist button',
    verified: true,
    strategies: [{ kind: 'css', selector: '.BuyLdC_Shrtlst', confidence: 1 }],
  },
  hide: {
    id: 'hide',
    description: 'Hide button',
    verified: true,
    strategies: [{ kind: 'css', selector: '.BuyLdC_Hide', confidence: 1 }],
  },
  notRelevant: {
    id: 'notRelevant',
    description: 'Not relevant button',
    verified: true,
    strategies: [{ kind: 'css', selector: '.BuyLdC_NtRlvnt', confidence: 1 }],
  },
  viewSimilar: {
    id: 'viewSimilar',
    description: 'View similar link (href extracted)',
    verified: true,
    strategies: [
      { kind: 'css', selector: '.BuyLdC_VwSimlr a[href]', confidence: 1 },
      { kind: 'css', selector: '.BuyLdC_VwSimlr a', confidence: 0.7 },
    ],
  },
} as const satisfies Record<string, FieldSelector>;

export type ActionSelectorId = keyof typeof ACTION_SELECTORS;

/* ------------------------------------------------------------------ */
/* Contact Buyer (resolution only; nothing here clicks)                */
/* ------------------------------------------------------------------ */

/** Button text that identifies the Contact Buyer action. */
export const CONTACT_BUYER_TEXT = /\bContact\s+Buyer\b/i;

/**
 * Contact Buyer button, resolved inside one lead card only.
 *
 * Verified reference, copied from the live Lead Manager by the user
 * (2026-09): `#BLCard1 > div.SLC_dflx.SLC_.pr > button > strong`
 *
 * - The number in "BLCard1" is the card's position and changes, so it is
 *   never used. The id pattern tells us the card wrapper, though: the button
 *   row is a direct child of an element whose id starts with "BLCard".
 * - ".SLC_.pr" means two classes, "SLC_" and "pr". IndiaMART elsewhere uses
 *   the single class "SLC_pr" (Shortlist), so this may be a copy artefact.
 *   The reference strategy is kept exactly as given; the text strategy finds
 *   the button either way. To be confirmed from the button row's outerHTML.
 */
export const CONTACT_BUYER = {
  reference: '#BLCard1 > div.SLC_dflx.SLC_.pr > button > strong',
  verified: true,
  /** Card wrapper id pattern from the reference (never a specific number). */
  cardContainer: '[id^="BLCard"]',
  /** One title per card: used to prove the button belongs to the intended lead. */
  titleAnchor: '.BuyLdC_m6',
  selector: {
    id: 'contactBuyer',
    description: 'Contact Buyer button (card-scoped)',
    verified: true,
    strategies: [
      // The verified structure, scoped to the card (no #BLCardN).
      {
        kind: 'css',
        selector: 'div.SLC_dflx.SLC_.pr > button',
        textMatch: CONTACT_BUYER_TEXT,
        confidence: 1,
      },
      // Semantic fallback: a button in the card whose text is Contact Buyer.
      { kind: 'text', scope: 'button', pattern: CONTACT_BUYER_TEXT, confidence: 0.8 },
    ],
  },
} as const satisfies { selector: FieldSelector } & Record<string, unknown>;
