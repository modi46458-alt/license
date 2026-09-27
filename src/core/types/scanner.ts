import type { AutomationEvent, MatchEvent } from '../actions/automation-types';
import type {
  FilterEvaluation,
  FilterGroup,
  FilterReasonType,
  ReasonOutcome,
} from '../filters/filter-types';
import type { NormalizedLead } from '../normalization/normalization-types';
import type { LeadPriority, LeadScoreResult } from '../scoring/scoring-types';
import type { Lead, LeadExtractionInfo, LeadField } from './lead';

/** locked: the license is not ACTIVE, so nothing is observed or processed. */
export type ScannerStatus = 'idle' | 'starting' | 'scanning' | 'stopped' | 'error' | 'locked';

export interface ScannerState {
  readonly status: ScannerStatus;
  /** true while the current page is supported and shows a lead list. */
  readonly pageActive: boolean;
  /** Unique leads found. */
  readonly detected: number;
  /** Cards that went through the pipeline: new, updated, duplicate or failed. */
  readonly processed: number;
  readonly duplicates: number;
  readonly extractionFailures: number;
  /** Unique leads currently passing the filters. matched + rejected = evaluated leads. */
  readonly matched: number;
  /** Unique leads currently rejected by the filters. */
  readonly rejected: number;
  readonly lastScanAt: number | null;
  readonly averageProcessingTimeMs: number;
  readonly startedAt: number | null;
  readonly lastError: string | null;
}

export interface ScannerDiagnostics {
  readonly mutationCount: number;
  readonly batchCount: number;
  readonly candidateCount: number;
  readonly cardsResolved: number;
  readonly rejectedCandidates: number;
  readonly averageProcessingTimeMs: number;
  readonly p95ProcessingTimeMs: number;
  readonly maxProcessingTimeMs: number;
  /** Average extraction confidence (reliability of the fields present). */
  readonly averageConfidence: number;
  /** Average share of core fields present. */
  readonly averageCompleteness: number;
  /** Fields present in the DOM whose selectors all failed. */
  readonly selectorFailures: Readonly<Record<string, number>>;
  /** FIELD_EXTRACTION_FAILED counts. */
  readonly failedFields: Readonly<Partial<Record<LeadField, number>>>;
  /** FIELD_MISSING counts (normal; shows what IndiaMART omits). */
  readonly missingFields: Readonly<Partial<Record<LeadField, number>>>;
  /** Non-error diagnostics, e.g. "category: page-level breadcrumb unavailable for card". */
  readonly notes: Readonly<Record<string, number>>;
  readonly errors: number;
  readonly selectorMapVersion: string;
  readonly normalization: NormalizationDiagnostics;
  /** DOM extraction time per card (ms), from a bounded recent sample. */
  readonly extraction: {
    readonly averageMs: number;
    readonly p50Ms: number;
    readonly p95Ms: number;
    readonly maxMs: number;
  };
  /** Nodes waiting in the mutation queue for the next batch. */
  readonly queueSize: number;
  readonly filter: FilterDiagnostics;
  readonly scoring: ScoringDiagnostics;
  readonly contactButton: ContactButtonDiagnostics;
  /** Last few cards, newest last: how well each one was read. */
  readonly recentExtractions: readonly ExtractionSample[];
}

export interface ExtractionSample {
  readonly label: string;
  readonly outcome: 'new' | 'updated' | 'failed';
  readonly cardConfidence: number;
  readonly extractionConfidence: number;
  readonly completeness: number;
  readonly failedFields: readonly LeadField[];
  readonly missingFields: readonly LeadField[];
  /** Contact Buyer button check (read-only): found, or why it was not. */
  readonly contactButton: 'found' | 'ACTION_NOT_FOUND' | 'IDENTITY_MISMATCH' | 'not-checked';
  readonly timestamp: number;
}

/** Read-only Contact Buyer resolution results across new/updated cards. */
export interface ContactButtonDiagnostics {
  readonly found: number;
  readonly notFound: number;
  readonly identityMismatch: number;
  /** Found via the verified reference structure vs the text fallback. */
  readonly byReference: number;
  readonly byText: number;
  readonly lastFailure: string | null;
}

export interface ScannerSnapshot {
  readonly state: ScannerState;
  readonly diagnostics: ScannerDiagnostics;
  /** Most recent filter results, newest first (bounded). */
  readonly results: readonly LeadResult[];
}

/** Compact per-lead filter result for the popup. No contact values. */
export interface LeadResult {
  readonly leadId: string;
  readonly label: string;
  readonly country: string | null;
  readonly quantity: string | null;
  readonly status: FilterEvaluation['status'];
  readonly reasons: readonly { readonly outcome: ReasonOutcome; readonly message: string }[];
  readonly evaluatedAt: number;
  /** Integer 0–100 for scored leads; null when REJECTED or UNSCORED. */
  readonly score: number | null;
  readonly priority: LeadPriority;
  readonly scoreReasons: readonly { readonly points: number; readonly message: string }[];
}

export type PriorityCounts = Readonly<Record<LeadPriority, number>>;

export interface ScoringDiagnostics {
  readonly configSummary: string;
  /** Matched leads (eligible for scoring). */
  readonly eligible: number;
  /** Matched leads that have a score (scoring on). */
  readonly scored: number;
  /** Rejected leads (excluded from scoring). */
  readonly rejectedFromScoring: number;
  readonly priorityCounts: PriorityCounts;
  /** Over scored leads only; rejected leads are never counted as 0. */
  readonly averageScore: number | null;
  readonly minScore: number | null;
  readonly maxScore: number | null;
  readonly timing: {
    readonly count: number;
    readonly averageMs: number;
    readonly p95Ms: number;
    readonly maxMs: number;
  };
  readonly errors: number;
}

export interface FilterDiagnostics {
  readonly configSummary: string;
  readonly evaluations: number;
  readonly matched: number;
  readonly rejected: number;
  readonly errors: number;
  readonly averageTimeMs: number;
  readonly maxTimeMs: number;
  /** Pass reasons across currently matched leads, by type. */
  readonly matchReasons: Readonly<Partial<Record<FilterReasonType, number>>>;
  /** Failed conditions across currently rejected leads, by group. */
  readonly rejectionReasons: Readonly<Partial<Record<FilterGroup, number>>>;
}

export type ScanLogLevel = 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR';

export interface ScanLog {
  readonly id: number;
  readonly timestamp: number;
  readonly level: ScanLogLevel;
  readonly event: ScannerEventType | AutomationEvent['type'];
  readonly leadId?: string;
  readonly message: string;
}

export type { LeadExtractionInfo };

export interface CardDetection {
  /** Summed weight of the signals present in the card, 0..1. */
  readonly confidence: number;
  readonly signals: readonly string[];
  /** 'container' = verified wrapper selector; 'walk' = upward signal walk. */
  readonly method: 'container' | 'walk';
  readonly depth: number;
}

interface EventBase {
  readonly timestamp: number;
}

export type ScannerEvent =
  | (EventBase & {
      readonly type: 'SCAN_STARTED';
      readonly reason: 'start' | 'navigation' | 'activation';
    })
  | (EventBase & { readonly type: 'LEAD_CANDIDATE_FOUND'; readonly detection: CardDetection })
  | (EventBase & {
      readonly type: 'LEAD_DETECTED';
      readonly leadId: string;
      readonly fingerprint: string;
    })
  | (EventBase & {
      readonly type: 'LEAD_DUPLICATE';
      readonly leadId: string;
      readonly fingerprint: string;
    })
  | (EventBase & {
      readonly type: 'LEAD_EXTRACTION_FAILED';
      readonly leadId: string | null;
      readonly error: string;
      readonly failedFields: readonly LeadField[];
    })
  | (EventBase & {
      readonly type: 'LEAD_PROCESSED';
      readonly lead: Lead;
      /** Canonical form (Phase 3); null only if normalization itself failed. */
      readonly normalized: NormalizedLead | null;
      /** Filter result (Phase 4); null only if there is no normalized form. */
      readonly filter: FilterEvaluation | null;
      /** Score (Phase 5): REJECTED/UNSCORED/SCORED; null only without a filter result. */
      readonly score: LeadScoreResult | null;
      readonly detection: CardDetection;
      readonly processingTimeMs: number;
    })
  | (EventBase & {
      /** Same logical lead with new information (progressive render, re-render). Same lead id. */
      readonly type: 'LEAD_UPDATED';
      readonly leadId: string;
      readonly fingerprint: string;
      readonly lead: Lead;
      readonly normalized: NormalizedLead | null;
      readonly filter: FilterEvaluation | null;
      /** Status before this update, when the lead had been evaluated. */
      readonly previousStatus: FilterEvaluation['status'] | null;
      readonly score: LeadScoreResult | null;
      readonly previousPriority: LeadPriority | null;
      /** Information keys this rendering revealed (e.g. "quantity", "mobile"). */
      readonly revealed: readonly string[];
    })
  | (EventBase & {
      readonly type: 'SCAN_COMPLETED';
      readonly newLeads: number;
      readonly durationMs: number;
      readonly initial: boolean;
    })
  | (EventBase & {
      /** Filter config changed: every remembered lead was evaluated again. */
      readonly type: 'FILTERS_APPLIED';
      readonly matched: number;
      readonly rejected: number;
      readonly changed: number;
      readonly summary: string;
    })
  | (EventBase & {
      /** Scoring config changed: every matched lead was scored again. */
      readonly type: 'SCORING_APPLIED';
      readonly scored: number;
      readonly averageScore: number | null;
      readonly changed: number;
      readonly summary: string;
    })
  | (EventBase & { readonly type: 'SCANNER_ERROR'; readonly error: string })
  | (EventBase & { readonly type: 'SCANNER_LOCKED'; readonly reason: string })
  | (EventBase & {
      /** A genuine filter evaluation produced MATCHED: one Auto-Click action per event. */
      readonly type: 'LEAD_MATCHED';
      readonly event: MatchEvent;
    })
  | (EventBase & { readonly type: 'SCANNER_STOPPED' })
  | (EventBase & { readonly type: 'PAGE_INACTIVE'; readonly url: string });

export type ScannerEventType = ScannerEvent['type'];

export interface NormalizationDiagnostics {
  readonly version: string;
  readonly normalized: number;
  readonly errors: number;
  readonly averageTimeMs: number;
  readonly maxTimeMs: number;
  /** Warning text → count, e.g. "country: not in alias map". */
  readonly warnings: Readonly<Record<string, number>>;
}
