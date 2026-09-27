import {
  DEFAULT_AUTOMATION_CONFIG,
  checkEligibility,
  type ActionErrorCode,
  type ActionRecord,
  type AutomationConfig,
  type AutomationEvent,
  type AutomationSnapshot,
  type AutomationState,
  type LeadFacts,
  type MatchEvent,
} from '@/core/actions';
import { clickContactBuyer, type ClickOutcome } from './contact-buyer-executor';
import {
  resolveContactBuyer,
  type ContactBuyerResolution,
  type ResolveContactBuyerOptions,
} from './contact-buyer-resolver';

/**
 * Event-based Auto-Click engine (Contact Buyer only).
 *
 *   genuine MATCHED evaluation → matchEventId → one action → checks → CLICK
 *
 * - Each matchEventId is one action. Delivering the same id again does
 *   nothing (idempotent); a different id is a separate action, even for the
 *   same logical lead. There is no permanent "already contacted" rule.
 * - MATCHED events that arrive while Auto-Click is OFF, locked or on standby
 *   are not queued.
 * - One click at a time: the first immediately, the next after the delay.
 * - Before each click: Auto-Click ON, license ACTIVE (fresh server answer),
 *   lead still on the page and still MATCHED, and the Contact Buyer resolver
 *   proves the button belongs to that lead and is visible + enabled.
 *   Any failed check → no click, reason recorded.
 * - The queue lives in memory only: nothing resumes after a page reload.
 */

export interface LeadSource {
  getCard(leadId: string): Element | null;
  getFacts(leadId: string): LeadFacts | null;
}

/** License gate as the engine sees it. */
export interface EngineLicense {
  isLicenseActive(): boolean;
  /** true when the last server answer is too old to click on without asking again. */
  needsValidation?(): boolean;
  /** Ask the server now; resolves when the gate has the answer. */
  validate?(): Promise<void>;
}

export interface EngineOptions {
  readonly leads: LeadSource;
  readonly config?: AutomationConfig;
  readonly now?: () => number;
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
  readonly newId?: () => string;
  /** Injectable for tests; production uses the verified resolver and executor. */
  readonly resolve?: (card: Element, options: ResolveContactBuyerOptions) => ContactBuyerResolution;
  readonly performClick?: (button: Element, guard: () => string | null) => ClickOutcome;
  readonly isVisible?: (element: Element) => boolean;
  readonly maxHistory?: number;
  /** Without an ACTIVE license nothing is queued or clicked. */
  readonly license?: EngineLicense;
}

type Listener = (event: AutomationEvent) => void;

/** Failures that may clear up on their own (still rendering / re-rendering). */
const RETRYABLE: ReadonlySet<ActionErrorCode> = new Set(['STALE_LEAD', 'ACTION_NOT_FOUND']);
/** matchEventIds remembered for idempotency (bounded). */
const MAX_SEEN_EVENTS = 20_000;

export class AutoClickEngine {
  private config: AutomationConfig;
  /** Another tab holds the automation lock: stay passive. */
  private standby = false;
  private licensed: boolean;
  private readonly records = new Map<string, ActionRecord>();
  private queue: string[] = [];
  /** Every matchEventId already turned into an action (idempotency). */
  private readonly seenEvents = new Set<string>();
  private clicked = 0;
  private eventsAccepted = 0;
  private timer: unknown = null;
  private nextActionAt: number | null = null;
  private current: ActionRecord | null = null;
  private lastError: string | null = null;
  private readonly listeners = new Set<Listener>();
  private idCounter = 0;

  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly newId: () => string;
  private readonly resolve: NonNullable<EngineOptions['resolve']>;
  private readonly performClick: NonNullable<EngineOptions['performClick']>;
  private readonly maxHistory: number;

  constructor(private readonly options: EngineOptions) {
    this.config = options.config ?? DEFAULT_AUTOMATION_CONFIG;
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer =
      options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.newId = options.newId ?? (() => `act_${this.now().toString(36)}_${++this.idCounter}`);
    this.resolve = options.resolve ?? resolveContactBuyer;
    this.performClick = options.performClick ?? clickContactBuyer;
    this.maxHistory = options.maxHistory ?? 100;
    this.licensed = options.license?.isLicenseActive() ?? true;
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): AutomationState {
    if (!this.licensed) return 'LOCKED';
    if (!this.config.autoClickEnabled) return 'OFF';
    return this.standby ? 'STANDBY' : 'ON';
  }

  private get active(): boolean {
    return this.config.autoClickEnabled && !this.standby && this.licensed;
  }

  /* ---------------------------------------------------------------- */
  /* Commands                                                          */
  /* ---------------------------------------------------------------- */

  /** ON → act on MATCHED events from now on. OFF → cancel everything pending. */
  setConfig(config: AutomationConfig): void {
    const wasActive = this.active;
    this.config = config;
    this.transition(wasActive, 'disabled');
  }

  /** true while another tab holds the automation lock. */
  setStandby(standby: boolean): void {
    const wasActive = this.active;
    this.standby = standby;
    this.transition(wasActive, 'standby');
  }

  /**
   * License changed. Not ACTIVE: cancel the queue, the pending click and
   * any retry at once. ACTIVE again: new MATCHED events are acted on.
   */
  setLicensed(licensed: boolean): void {
    const wasActive = this.active;
    this.licensed = licensed;
    this.transition(wasActive, 'license');
  }

  /** Emergency STOP. The caller also saves Auto-Click OFF so it stays off after a reload. */
  stop(): void {
    const wasActive = this.active;
    this.config = { ...this.config, autoClickEnabled: false };
    this.transition(wasActive, 'user');
  }

  /**
   * A genuine MATCHED evaluation. One action per matchEventId; the same id
   * again is ignored. Returns true when an action was queued.
   */
  onMatchEvent(event: MatchEvent): boolean {
    if (!this.active) return false; // OFF / locked / standby: MATCHED → no click
    if (this.seenEvents.has(event.matchEventId)) return false;
    this.rememberEvent(event.matchEventId);
    this.eventsAccepted++;
    const record: ActionRecord = {
      actionId: this.newId(),
      matchEventId: event.matchEventId,
      leadId: event.leadId,
      fingerprint: event.fingerprint,
      actionType: 'CONTACT_BUYER',
      status: 'QUEUED',
      attempt: 0,
      maxRetries: this.config.maxRetries,
      createdAt: this.now(),
      startedAt: null,
      completedAt: null,
      errorCode: null,
      errorMessage: null,
      resolverResult: null,
      leadLabel: event.title ?? event.leadId,
    };
    this.remember(record);
    this.queue.push(record.actionId);
    this.emit({ type: 'ACTION_QUEUED', timestamp: this.now(), action: { ...record } });
    this.pump();
    return true;
  }

  snapshot(): AutomationSnapshot {
    return {
      state: this.getState(),
      config: this.config,
      clicked: this.clicked,
      events: this.eventsAccepted,
      queueLength: this.queue.length,
      current: this.current ? { ...this.current } : null,
      nextActionAt: this.nextActionAt,
      history: [...this.records.values()]
        .reverse()
        .slice(0, 20)
        .map((r) => ({ ...r })),
      lastError: this.lastError,
    };
  }

  private transition(
    wasActive: boolean,
    reason: 'user' | 'disabled' | 'standby' | 'license',
  ): void {
    if (!wasActive && this.active) {
      this.emit({ type: 'AUTOMATION_STARTED', timestamp: this.now(), queued: 0 });
      this.pump();
    } else if (wasActive && !this.active) {
      if (this.timer !== null) this.clearTimer(this.timer);
      this.timer = null;
      this.nextActionAt = null;
      const cancelled = this.cancelQueue(
        reason === 'license' ? 'LICENSE_INACTIVE' : 'AUTOMATION_DISABLED',
      );
      this.emit({ type: 'AUTOMATION_STOPPED', timestamp: this.now(), reason, cancelled });
    }
  }

  /* ---------------------------------------------------------------- */
  /* Queue                                                             */
  /* ---------------------------------------------------------------- */

  private rememberEvent(id: string): void {
    this.seenEvents.add(id);
    if (this.seenEvents.size > MAX_SEEN_EVENTS) {
      const oldest = this.seenEvents.values().next().value;
      if (oldest !== undefined) this.seenEvents.delete(oldest);
    }
  }

  private cancelQueue(code: ActionErrorCode): number {
    let cancelled = 0;
    for (const id of this.queue) {
      const record = this.records.get(id);
      if (!record) continue;
      this.finish(
        record,
        'CANCELLED',
        code,
        code === 'LICENSE_INACTIVE' ? 'license not active' : 'Auto-Click switched off',
      );
      cancelled++;
    }
    this.queue = [];
    return cancelled;
  }

  /** Schedule the next click: now if the delay has passed, else when it has. */
  private pump(): void {
    if (!this.active || this.timer !== null || this.current !== null) return;
    if (this.queue.length === 0) {
      this.nextActionAt = null;
      return;
    }
    const at = Math.max(this.nextActionAt ?? this.now(), this.now());
    this.nextActionAt = at;
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.runNext();
    }, at - this.now());
  }

  private runNext(): void {
    if (!this.active) return;
    const id = this.queue.shift();
    const record = id === undefined ? undefined : this.records.get(id);
    if (!record) return this.pump();
    this.current = record; // blocks any other action until this one is done

    const license = this.options.license;
    if (license?.needsValidation?.() && license.validate) {
      // Last server answer too old: ask again before clicking (never per lead).
      license
        .validate()
        .catch(() => undefined)
        .finally(() => this.executeAndContinue(record));
      return;
    }
    this.executeAndContinue(record);
  }

  private executeAndContinue(record: ActionRecord): void {
    try {
      if (!this.active) {
        // Stopped / locked while waiting for the license answer.
        if (record.status === 'QUEUED' || record.status === 'RETRYING') {
          this.finish(
            record,
            'CANCELLED',
            this.licensed ? 'AUTOMATION_DISABLED' : 'LICENSE_INACTIVE',
            'stopped before the click',
          );
        }
      } else {
        this.execute(record);
      }
    } finally {
      this.current = null;
      this.nextActionAt = this.now() + this.config.delayBetweenActionsMs;
      this.pump();
    }
  }

  /* ---------------------------------------------------------------- */
  /* One action                                                        */
  /* ---------------------------------------------------------------- */

  private execute(record: ActionRecord): void {
    record.status = 'RUNNING';
    record.attempt++;
    record.startedAt = this.now();
    this.emit({ type: 'ACTION_STARTED', timestamp: this.now(), action: { ...record } });

    // Lead still on the page and still MATCHED; Auto-Click ON.
    const facts = this.options.leads.getFacts(record.leadId);
    const check = checkEligibility(facts, this.config);
    if (!check.eligible) {
      if (check.code === 'STALE_LEAD') return this.fail(record, check.code, check.reason);
      return this.finish(record, 'SKIPPED', check.code, check.reason);
    }
    const lead = facts as LeadFacts;

    const card = this.options.leads.getCard(record.leadId);
    if (card === null || !card.isConnected) {
      return this.fail(record, 'STALE_LEAD', 'lead card is no longer on the page');
    }

    // The button belongs to this lead (title check), exists, is visible and enabled.
    const resolution = this.resolve(card, {
      expectedTitle: lead.title,
      ...(this.options.isVisible ? { isVisible: this.options.isVisible } : {}),
    });
    record.resolverResult = resolution.ok
      ? resolution.strategyIndex === 0
        ? 'FOUND_REFERENCE'
        : 'FOUND_TEXT'
      : resolution.code;
    if (!resolution.ok) return this.fail(record, resolution.code, resolution.reason);

    const outcome = this.performClick(resolution.button, () => this.finalGuard(record.leadId));
    if (outcome.ok) {
      this.clicked++;
      return this.finish(record, 'SUCCESS', null, null);
    }
    if (outcome.clicked) {
      // The click may have happened: never retried.
      return this.finish(record, 'FAILED', 'CLICK_FAILED', outcome.reason);
    }
    const code: ActionErrorCode = this.licensed ? 'AUTOMATION_DISABLED' : 'LICENSE_INACTIVE';
    return this.finish(record, 'SKIPPED', code, outcome.reason);
  }

  /** Last check, in the same turn as the click. */
  private finalGuard(leadId: string): string | null {
    // The gate is asked directly: a grace period may have ended since the last update.
    if (this.options.license && !this.options.license.isLicenseActive()) {
      this.setLicensed(false);
      return 'license not active';
    }
    if (!this.active) return 'Auto-Click is off';
    if (this.options.leads.getFacts(leadId)?.status !== 'MATCHED')
      return 'lead is no longer matched';
    return null;
  }

  private fail(record: ActionRecord, code: ActionErrorCode, message: string): void {
    const canRetry = RETRYABLE.has(code) && record.attempt <= record.maxRetries && this.active;
    if (!canRetry) return this.finish(record, 'FAILED', code, message);
    record.status = 'RETRYING';
    record.errorCode = code;
    record.errorMessage = message;
    this.queue.unshift(record.actionId); // tried again after the delay
    this.emit({ type: 'ACTION_RETRYING', timestamp: this.now(), action: { ...record } });
  }

  private finish(
    record: ActionRecord,
    status: 'SUCCESS' | 'FAILED' | 'SKIPPED' | 'CANCELLED',
    code: ActionErrorCode | null,
    message: string | null,
  ): void {
    record.status = status;
    record.completedAt = this.now();
    record.errorCode = code;
    record.errorMessage = message;
    if (status === 'FAILED') this.lastError = `${code ?? 'FAILED'}: ${message ?? ''}`;
    const type =
      status === 'SUCCESS'
        ? 'ACTION_SUCCESS'
        : status === 'FAILED'
          ? 'ACTION_FAILED'
          : status === 'SKIPPED'
            ? 'ACTION_SKIPPED'
            : 'ACTION_CANCELLED';
    this.emit({ type, timestamp: this.now(), action: { ...record } });
  }

  private remember(record: ActionRecord): void {
    this.records.set(record.actionId, record);
    while (this.records.size > this.maxHistory) {
      const oldest = [...this.records.values()].find(
        (r) => r.status !== 'QUEUED' && r.status !== 'RUNNING' && r.status !== 'RETRYING',
      );
      if (!oldest) break;
      this.records.delete(oldest.actionId);
    }
  }

  private emit(event: AutomationEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* a listener must never break automation */
      }
    }
  }
}
