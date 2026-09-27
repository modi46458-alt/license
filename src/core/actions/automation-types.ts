/**
 * Auto-Click (Contact Buyer only). Pure types: no DOM here.
 *
 * Event-based: every genuine filter evaluation that produces MATCHED gets a
 * unique matchEventId, and each matchEventId is one Contact Buyer action.
 * The same matchEventId delivered twice is one action; different events are
 * separate actions, even for the same logical lead. Clicks run one at a time
 * with a short delay, and only when the button is proven to be that lead's.
 */

export const AUTOMATION_CONFIG_VERSION = 2;

export type ActionType = 'CONTACT_BUYER';

export interface AutomationConfig {
  readonly version: typeof AUTOMATION_CONFIG_VERSION;
  /** ON by default. ON: matched leads are contacted automatically. OFF: no clicks. */
  readonly autoClickEnabled: boolean;
  /** Gap between two clicks so they can never happen together. */
  readonly delayBetweenActionsMs: number;
  /** Retries while the button is not found yet / the card re-renders. Never after a click. */
  readonly maxRetries: number;
}

/** QUEUED → RUNNING → SUCCESS | FAILED | RETRYING | SKIPPED | CANCELLED */
export type ActionStatus =
  'QUEUED' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'RETRYING' | 'SKIPPED' | 'CANCELLED';

export type ActionErrorCode =
  // pre-click checks
  | 'AUTOMATION_DISABLED'
  | 'LICENSE_INACTIVE'
  | 'STALE_LEAD'
  | 'NOT_MATCHED'
  // Contact Buyer resolver
  | 'ACTION_NOT_FOUND'
  | 'IDENTITY_MISMATCH'
  // the click itself
  | 'CLICK_FAILED';

/** How the Contact Buyer resolver answered for this action (last attempt). */
export type ResolverResult =
  'FOUND_REFERENCE' | 'FOUND_TEXT' | 'ACTION_NOT_FOUND' | 'IDENTITY_MISMATCH' | null;

export interface ActionRecord {
  readonly actionId: string;
  /** The MATCHED evaluation this action belongs to (one action per event). */
  readonly matchEventId: string;
  readonly leadId: string;
  /** Logical lead fingerprint at the time of the event. */
  readonly fingerprint: string;
  readonly actionType: ActionType;
  status: ActionStatus;
  /** Executions so far (1 = first try). At most maxRetries + 1. */
  attempt: number;
  readonly maxRetries: number;
  readonly createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  errorCode: ActionErrorCode | null;
  errorMessage: string | null;
  resolverResult: ResolverResult;
  /** Display only: lead title. No contact data. */
  readonly leadLabel: string;
}

/**
 * A genuine filter evaluation that produced MATCHED. Created by the scanner
 * for new and updated leads, and for leads that newly match after a filter
 * change; never for duplicate cards or unchanged DOM mutations.
 */
export interface MatchEvent {
  readonly matchEventId: string;
  readonly leadId: string;
  readonly fingerprint: string;
  readonly title: string | null;
  readonly trigger: 'detected' | 'updated' | 'filters';
  readonly at: number;
}

/** What the engine needs to know about a lead: its latest filter verdict. */
export interface LeadFacts {
  readonly leadId: string;
  readonly fingerprint: string;
  readonly title: string | null;
  readonly status: 'MATCHED' | 'REJECTED';
}

/**
 * ON: contacting matched leads. OFF: switched off (or STOP pressed).
 * STANDBY: ON, but another IndiaMART tab is already doing the clicking.
 * LOCKED: the license is not ACTIVE; nothing is queued or clicked.
 */
export type AutomationState = 'ON' | 'OFF' | 'STANDBY' | 'LOCKED';

export interface AutomationSnapshot {
  readonly state: AutomationState;
  readonly config: AutomationConfig;
  /** Successful clicks on this page since it loaded. */
  readonly clicked: number;
  /** MATCHED events received while Auto-Click could act (queued or done). */
  readonly events: number;
  readonly queueLength: number;
  readonly current: ActionRecord | null;
  /** When the next click may happen (delay between clicks), if one is waiting. */
  readonly nextActionAt: number | null;
  /** Most recent first, bounded. */
  readonly history: readonly ActionRecord[];
  readonly lastError: string | null;
}

export type AutomationEvent =
  | { readonly type: 'AUTOMATION_STARTED'; readonly timestamp: number; readonly queued: number }
  | {
      readonly type: 'AUTOMATION_STOPPED';
      readonly timestamp: number;
      readonly reason: 'user' | 'disabled' | 'standby' | 'license';
      readonly cancelled: number;
    }
  | { readonly type: 'ACTION_QUEUED'; readonly timestamp: number; readonly action: ActionRecord }
  | { readonly type: 'ACTION_STARTED'; readonly timestamp: number; readonly action: ActionRecord }
  | { readonly type: 'ACTION_SUCCESS'; readonly timestamp: number; readonly action: ActionRecord }
  | { readonly type: 'ACTION_FAILED'; readonly timestamp: number; readonly action: ActionRecord }
  | { readonly type: 'ACTION_RETRYING'; readonly timestamp: number; readonly action: ActionRecord }
  | { readonly type: 'ACTION_SKIPPED'; readonly timestamp: number; readonly action: ActionRecord }
  | {
      readonly type: 'ACTION_CANCELLED';
      readonly timestamp: number;
      readonly action: ActionRecord;
    };
