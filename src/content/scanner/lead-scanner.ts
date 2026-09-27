import { createLeadFingerprint, leadIdentityKey } from '@/core/fingerprint/lead-fingerprint';
import { cyrb53 } from '@/core/fingerprint/hash';
import { LeadRegistry, leadInfo } from '@/core/fingerprint/lead-registry';
import type { LeadFacts, MatchEvent } from '@/core/actions';
import { DEFAULT_FILTER_CONFIG, summarizeFilterConfig, type FilterConfig } from '@/core/filters';
import { normalizeLead, type NormalizedLead } from '@/core/normalization';
import { DEFAULT_SCORING_CONFIG, summarizeScoringConfig, type ScoringConfig } from '@/core/scoring';
import type { Lead } from '@/core/types/lead';
import type {
  CardDetection,
  ScannerEvent,
  ScannerSnapshot,
  ScannerState,
  ScannerStatus,
} from '@/core/types/scanner';
import {
  extractLead,
  leadLabel,
  type ExtractionResult,
  type ExtractOptions,
} from '../extraction/lead-extractor';
import {
  ENGAGEMENT,
  INDIAMART_PAGE,
  LEAD_CARD,
  type EngagementConfig,
  type LeadCardConfig,
  type PageConfig,
} from '../selectors/indiamart-selectors';
import { detectPage, hasLeadList } from './indiamart-page-detector';
import { anchorSelector, collectAnchors, findLeadCard, holdsSeveralCards } from './lead-detector';
import {
  MutationQueue,
  frameScheduler,
  type MutationBatch,
  type Scheduler,
} from './mutation-queue';
import { resolveContactBuyer } from '../automation/contact-buyer-resolver';
import { LeadResults, type Verdict } from './lead-results';
import { ScannerMetrics } from './scanner-metrics';

export type ScannerListener = (event: ScannerEvent) => void;

export type CandidateOutcome =
  'new' | 'updated' | 'duplicate' | 'unchanged' | 'rejected' | 'failed';

export interface LeadScannerOptions {
  readonly document: Document;
  readonly getUrl: () => string;
  readonly schedule?: Scheduler;
  /** Wall clock for timestamps. */
  readonly now?: () => number;
  /** Monotonic clock for latency. */
  readonly clock?: () => number;
  /** Max work per batch before yielding to the page. */
  readonly frameBudgetMs?: number;
  /** Leads remembered for de-duplication (least recently seen dropped first). */
  readonly maxRememberedLeads?: number;
  readonly cardConfig?: LeadCardConfig;
  readonly pageConfig?: PageConfig;
  readonly engagement?: EngagementConfig;
  /** Injectable for tests (error isolation). */
  readonly extract?: (card: Element, options: ExtractOptions) => ExtractionResult;
  /** License gate: without an ACTIVE license the scanner stays locked. */
  readonly license?: { isLicenseActive(): boolean };
  /** Visibility test for the Contact Buyer check (injectable: jsdom has no layout). */
  readonly isElementVisible?: (element: Element) => boolean;
  /** Initial filter configuration (defaults when omitted). */
  readonly filterConfig?: FilterConfig;
  /** Initial scoring configuration (defaults when omitted). */
  readonly scoringConfig?: ScoringConfig;
  /** Injectable for tests (normalization error isolation). */
  readonly normalizeLead?: typeof normalizeLead;
}

/** Card fingerprint markers for cards that produced no lead. */
const UNIDENTIFIED = '\u0000unidentified';
const FAILED = '\u0000failed';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Read-only IndiaMART lead scanner.
 *
 *   MutationObserver → MutationQueue (Sets, one scheduled flush)
 *     → anchors in added subtrees + known cards that changed
 *     → findLeadCard → extractLead → fingerprint → de-dup → events
 *
 * Never clicks, focuses, scrolls, or modifies the page. Each card is processed
 * in isolation: an exception in one card is reported and the scan continues.
 */
export class LeadScanner {
  private readonly doc: Document;
  private readonly getUrl: () => string;
  private readonly now: () => number;
  private readonly clock: () => number;
  private readonly frameBudgetMs: number;
  private readonly cardConfig: LeadCardConfig;
  private readonly pageConfig: PageConfig;
  private readonly engagement: EngagementConfig;
  private readonly extract: (card: Element, options: ExtractOptions) => ExtractionResult;
  private readonly normalizeFn: typeof normalizeLead;
  private readonly isElementVisible: ((element: Element) => boolean) | undefined;
  private readonly license: { isLicenseActive(): boolean } | undefined;

  private readonly queue: MutationQueue;
  private readonly metrics = new ScannerMetrics();
  private readonly listeners = new Set<ScannerListener>();

  private observer: MutationObserver | null = null;
  private detachNavigation: (() => void) | null = null;

  private status: ScannerStatus = 'idle';
  private pageActive = false;
  private lastHref = '';
  private startedAt: number | null = null;
  private lastScanAt: number | null = null;
  private lastError: string | null = null;
  private detected = 0;
  private processed = 0;
  private duplicates = 0;
  private extractionFailures = 0;

  private knownCards = new WeakSet<Element>();
  private announcedCards = new WeakSet<Element>();
  private cardDetections = new WeakMap<Element, CardDetection>();
  /** Per card: fingerprint + information hash last processed (or a failure marker). */
  private cardFingerprints = new WeakMap<Element, string>();
  /** Lead id and identity (title/product) first assigned to a card element. */
  private cardLeads = new WeakMap<Element, { leadId: string; titleKey: string }>();
  private readonly registry: LeadRegistry;
  private readonly results: LeadResults;
  private readonly leadCards = new Map<string, WeakRef<Element>>();

  private readonly pending = new Map<Element, CardDetection | null>();
  private currentScan: { startedAt: number; newLeads: number; initial: boolean } | null = null;

  constructor(options: LeadScannerOptions) {
    this.doc = options.document;
    this.getUrl = options.getUrl;
    this.now = options.now ?? Date.now;
    this.clock = options.clock ?? (() => performance.now());
    this.frameBudgetMs = options.frameBudgetMs ?? 12;
    this.registry = new LeadRegistry(options.maxRememberedLeads ?? 5000);
    this.results = new LeadResults(
      options.filterConfig ?? DEFAULT_FILTER_CONFIG,
      options.scoringConfig ?? DEFAULT_SCORING_CONFIG,
      this.clock,
      this.now,
      options.maxRememberedLeads ?? 5000,
    );
    this.cardConfig = options.cardConfig ?? LEAD_CARD;
    this.pageConfig = options.pageConfig ?? INDIAMART_PAGE;
    this.engagement = options.engagement ?? ENGAGEMENT;
    this.extract = options.extract ?? extractLead;
    this.normalizeFn = options.normalizeLead ?? normalizeLead;
    this.isElementVisible = options.isElementVisible;
    this.license = options.license;
    this.queue = new MutationQueue(
      (batch) => this.flush(batch),
      options.schedule ?? frameScheduler,
    );
  }

  /* ---------------------------------------------------------------- */
  /* Lifecycle                                                         */
  /* ---------------------------------------------------------------- */

  /** Idempotent: a running scanner keeps its single observer. */
  start(): void {
    if (this.observer) return;
    if (!this.licensed()) {
      // No license, no observer: nothing on the page is read.
      this.lock('license not active');
      return;
    }
    this.status = 'starting';
    this.lastError = null;
    try {
      const root = this.doc.body ?? this.doc.documentElement;
      this.observer = new MutationObserver((records) => {
        this.metrics.mutationCount += records.length;
        this.queue.push(records);
      });
      this.observer.observe(root, { childList: true, subtree: true });
      this.attachNavigationListeners();
      this.startedAt = this.now();
      this.lastHref = this.getUrl();
      this.status = 'scanning';
      this.emit({ type: 'SCAN_STARTED', reason: 'start', timestamp: this.now() });
      this.evaluatePage('start');
    } catch (error) {
      this.fail(error);
      this.teardown();
    }
  }

  /** Idempotent: disconnects the observer and drops queued work. */
  stop(): void {
    if (!this.observer && this.status === 'stopped') return;
    this.teardown();
    this.status = 'stopped';
    this.pageActive = false;
    this.emit({ type: 'SCANNER_STOPPED', timestamp: this.now() });
  }

  /**
   * License no longer ACTIVE: disconnect the observer, drop every queued
   * candidate and stop processing at once. start() works again once the
   * license is ACTIVE.
   */
  lock(reason = 'license not active'): void {
    const wasLocked = this.status === 'locked' && !this.observer;
    this.teardown();
    this.status = 'locked';
    this.pageActive = false;
    if (!wasLocked) this.emit({ type: 'SCANNER_LOCKED', reason, timestamp: this.now() });
  }

  private licensed(): boolean {
    return this.license?.isLicenseActive() ?? true;
  }

  /** Stop and start again. De-duplication memory is kept for the session. */
  restart(): void {
    this.stop();
    this.start();
  }

  /** Scan every lead currently in the document (one query, not per mutation). */
  scanExisting(initial = true): void {
    if (!this.pageActive) return;
    let anchors: Element[];
    try {
      anchors = Array.from(this.doc.querySelectorAll(anchorSelector(this.cardConfig)));
    } catch (error) {
      this.fail(error);
      return;
    }
    this.beginScan(initial);
    this.enqueueAnchors(anchors);
    this.drain();
  }

  /** Resolve and process one element immediately, bypassing the queue. */
  processCandidate(element: Element): CandidateOutcome {
    if (!this.licensed()) {
      this.lock();
      return 'rejected';
    }
    this.metrics.candidateCount++;
    const known = this.knownCardFor(element);
    if (known) return this.processCard(known, this.cardDetections.get(known) ?? null);
    const match = this.safeFindCard(element);
    if (!match) {
      this.metrics.rejectedCandidates++;
      return 'rejected';
    }
    this.registerCard(match.card, match.detection);
    return this.processCard(match.card, match.detection);
  }

  on(listener: ScannerListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): ScannerState {
    return {
      status: this.status,
      pageActive: this.pageActive,
      detected: this.detected,
      processed: this.processed,
      duplicates: this.duplicates,
      extractionFailures: this.extractionFailures,
      matched: this.results.matched,
      rejected: this.results.rejected,
      lastScanAt: this.lastScanAt,
      averageProcessingTimeMs: this.metrics.averageLatency,
      startedAt: this.startedAt,
      lastError: this.lastError,
    };
  }

  getSnapshot(): ScannerSnapshot {
    this.metrics.queueSize = this.queue.size;
    return {
      state: this.getState(),
      diagnostics: {
        ...this.metrics.snapshot(),
        filter: this.results.filterDiagnostics(),
        scoring: this.results.scoringDiagnostics(),
      },
      results: this.results.recent(),
    };
  }

  /**
   * Apply a new filter configuration. Every remembered lead is evaluated
   * again, so matched/rejected always reflect the current filters.
   */
  setFilterConfig(config: FilterConfig, options: { announce?: boolean } = {}): void {
    try {
      const { matched, rejected, changed, newlyMatched } = this.results.setFilterConfig(config);
      if (options.announce !== false) {
        this.emit({
          type: 'FILTERS_APPLIED',
          matched,
          rejected,
          changed,
          summary: summarizeFilterConfig(config),
          timestamp: this.now(),
        });
      }
      for (const event of newlyMatched) this.emitMatch(event);
    } catch (error) {
      this.results.recordFilterError();
      this.fail(error);
    }
  }

  /** Apply a new scoring configuration: every matched lead is scored again. */
  setScoringConfig(config: ScoringConfig, options: { announce?: boolean } = {}): void {
    try {
      const { scored, averageScore, changed } = this.results.setScoringConfig(config);
      if (options.announce === false) return;
      this.emit({
        type: 'SCORING_APPLIED',
        scored,
        averageScore,
        changed,
        summary: summarizeScoringConfig(config),
        timestamp: this.now(),
      });
    } catch (error) {
      this.fail(error);
    }
  }

  /** Test hook: true while a batch is scheduled. */
  get hasPendingWork(): boolean {
    return this.queue.pending || this.pending.size > 0;
  }

  /* ---------------------------------------------------------------- */
  /* Batching                                                          */
  /* ---------------------------------------------------------------- */

  private flush(batch: MutationBatch): void {
    if (!this.observer) return;
    if (!this.licensed()) return this.lock();
    this.metrics.batchCount++;
    try {
      const href = this.getUrl();
      if (href !== this.lastHref) {
        this.lastHref = href;
        this.pending.clear();
        this.currentScan = null;
        this.pageActive = false;
        this.evaluatePage('navigation');
        return;
      }
      if (!this.pageActive) {
        // Only look at the document once an added subtree carries lead-list markup.
        if (this.batchShowsLeadList(batch)) this.evaluatePage('activation');
        return;
      }
      if (batch.overflow) {
        this.scanExisting(false);
        return;
      }

      const anchors: Element[] = [];
      for (const node of batch.added) {
        if (node.isConnected) anchors.push(...collectAnchors(node, this.cardConfig));
      }
      const changedCards: Element[] = [];
      for (const target of batch.targets) {
        const card = this.knownCardFor(target);
        if (card?.isConnected) changedCards.push(card);
      }
      if (anchors.length > 0 || changedCards.length > 0 || this.pending.size > 0) {
        this.beginScan(false);
        this.enqueueAnchors(anchors);
        for (const card of changedCards) {
          if (!this.pending.has(card)) this.pending.set(card, null);
        }
        this.drain();
      }
    } catch (error) {
      this.fail(error);
    }
  }

  private evaluatePage(reason: 'start' | 'navigation' | 'activation'): void {
    const page = detectPage(this.getUrl(), this.doc, this.pageConfig);
    if (page.active) {
      this.pageActive = true;
      if (reason !== 'start') this.emit({ type: 'SCAN_STARTED', reason, timestamp: this.now() });
      this.scanExisting(true);
    } else if (reason !== 'activation') {
      this.emit({ type: 'PAGE_INACTIVE', url: this.getUrl(), timestamp: this.now() });
    }
  }

  private batchShowsLeadList(batch: MutationBatch): boolean {
    for (const node of batch.added) {
      if (node.isConnected && hasLeadList(node, this.pageConfig, true)) return true;
    }
    return false;
  }

  private beginScan(initial: boolean): void {
    this.currentScan ??= { startedAt: this.clock(), newLeads: 0, initial };
    if (initial) this.currentScan.initial = true;
  }

  private enqueueAnchors(anchors: readonly Element[]): void {
    for (const anchor of anchors) {
      this.metrics.candidateCount++;
      const known = this.knownCardFor(anchor);
      if (known) {
        if (!this.pending.has(known)) this.pending.set(known, null);
        continue;
      }
      const match = this.safeFindCard(anchor);
      if (!match) {
        this.metrics.rejectedCandidates++;
        continue;
      }
      this.registerCard(match.card, match.detection);
      this.pending.set(match.card, match.detection);
    }
  }

  /** Process pending cards within the frame budget; yield and resume if exceeded. */
  private drain(): void {
    const frameStart = this.clock();
    let handled = 0;
    for (const [card, detection] of this.pending) {
      if (handled > 0 && this.clock() - frameStart > this.frameBudgetMs) {
        this.queue.request();
        return;
      }
      this.pending.delete(card);
      handled++;
      if (this.processCard(card, detection) === 'new' && this.currentScan) {
        this.currentScan.newLeads++;
      }
    }
    if (this.currentScan) {
      const scan = this.currentScan;
      this.currentScan = null;
      this.lastScanAt = this.now();
      this.emit({
        type: 'SCAN_COMPLETED',
        newLeads: scan.newLeads,
        durationMs: this.clock() - scan.startedAt,
        initial: scan.initial,
        timestamp: this.now(),
      });
    }
  }

  /* ---------------------------------------------------------------- */
  /* Per-card processing (isolated)                                    */
  /* ---------------------------------------------------------------- */

  private processCard(card: Element, detection: CardDetection | null): CandidateOutcome {
    const started = this.clock();
    const cardDetection = detection ?? this.cardDetections.get(card);
    if (cardDetection && !this.announcedCards.has(card)) {
      this.announcedCards.add(card);
      this.emit({ type: 'LEAD_CANDIDATE_FOUND', detection: cardDetection, timestamp: this.now() });
    }
    const previous = this.cardFingerprints.get(card);

    let result: ExtractionResult;
    try {
      const extractStarted = this.clock();
      result = this.extract(card, { now: this.now(), engagement: this.engagement });
      this.metrics.recordExtractionTime(this.clock() - extractStarted);
    } catch (error) {
      if (previous === FAILED) return 'failed';
      this.cardFingerprints.set(card, FAILED);
      this.extractionFailures++;
      this.processed++;
      this.metrics.errors++;
      this.sample(card, 'failed', null);
      this.emit({
        type: 'LEAD_EXTRACTION_FAILED',
        leadId: null,
        error: errorMessage(error),
        failedFields: [],
        timestamp: this.now(),
      });
      return 'failed';
    }

    const { lead: extracted } = result;
    const fingerprint = createLeadFingerprint(extracted);
    if (fingerprint === null) {
      if (previous === UNIDENTIFIED) return 'failed';
      this.cardFingerprints.set(card, UNIDENTIFIED);
      this.extractionFailures++;
      this.processed++;
      this.sample(card, 'failed', extracted);
      this.metrics.recordExtraction(extracted.extraction, result.selectorFailures);
      this.emit({
        type: 'LEAD_EXTRACTION_FAILED',
        leadId: null,
        error: 'no title or product category to identify the lead',
        failedFields: extracted.extraction.failedFields,
        timestamp: this.now(),
      });
      return 'failed';
    }

    // Identity + visible information. Lead age is not part of it, so the
    // ticking "22 → 23 mins ago" leaves the card unchanged.
    const signature = `${fingerprint}#${cyrb53(JSON.stringify(leadInfo(extracted)))}`;
    if (previous === signature) return 'unchanged';
    this.cardFingerprints.set(card, signature);

    // Same element still showing the same title → same logical lead.
    const titleKey = leadIdentityKey(extracted);
    const cardLead = this.cardLeads.get(card);
    const sameCardLead = cardLead && cardLead.titleKey === titleKey ? cardLead.leadId : null;
    const resolution = this.registry.resolve(extracted, fingerprint, sameCardLead);
    if (titleKey !== null) this.cardLeads.set(card, { leadId: resolution.leadId, titleKey });
    this.rememberLeadCard(resolution.leadId, card);

    const lead: Lead = { ...extracted, id: resolution.leadId, fingerprint };
    const normalized = resolution.kind === 'duplicate' ? null : this.normalize(lead);
    const verdict = normalized ? this.applyFilters(normalized) : null;
    const processingTimeMs = this.clock() - started;
    this.metrics.recordLatency(processingTimeMs);
    this.processed++;

    if (resolution.kind === 'duplicate') {
      this.duplicates++;
      this.emit({
        type: 'LEAD_DUPLICATE',
        leadId: resolution.leadId,
        fingerprint,
        timestamp: this.now(),
      });
      return 'duplicate';
    }

    if (resolution.kind === 'updated') {
      this.sample(card, 'updated', lead, verdict?.evaluation.status === 'MATCHED');
      this.emit({
        type: 'LEAD_UPDATED',
        leadId: resolution.leadId,
        fingerprint,
        lead,
        normalized,
        filter: verdict?.evaluation ?? null,
        previousStatus: verdict?.previousStatus ?? null,
        score: verdict?.score ?? null,
        previousPriority: verdict?.previousPriority ?? null,
        revealed: resolution.added,
        timestamp: this.now(),
      });
      // A re-evaluation that produced MATCHED is a new, genuine match event.
      this.emitMatch(verdict?.matchEvent);
      return 'updated';
    }

    this.metrics.recordExtraction(lead.extraction, result.selectorFailures);
    this.detected++;
    this.sample(card, 'new', lead, verdict?.evaluation.status === 'MATCHED');
    this.emit({ type: 'LEAD_DETECTED', leadId: lead.id, fingerprint, timestamp: this.now() });
    this.emit({
      type: 'LEAD_PROCESSED',
      lead,
      normalized,
      filter: verdict?.evaluation ?? null,
      score: verdict?.score ?? null,
      detection: cardDetection ?? { confidence: 0, signals: [], method: 'walk', depth: 0 },
      processingTimeMs,
      timestamp: this.now(),
    });
    this.emitMatch(verdict?.matchEvent);
    return 'new';
  }

  /* ---------------------------------------------------------------- */
  /* Helpers                                                           */
  /* ---------------------------------------------------------------- */

  /**
   * Pure normalization, timed and isolated: a failure here never loses the
   * extracted lead; the event carries normalized: null instead.
   */
  private normalize(lead: Lead): NormalizedLead | null {
    const started = this.clock();
    try {
      const normalized = this.normalizeFn(lead, { normalizedAt: this.now() });
      this.metrics.recordNormalization(this.clock() - started, normalized.normalization.warnings);
      return normalized;
    } catch (error) {
      this.metrics.recordNormalizationError();
      this.lastError = `normalization: ${errorMessage(error)}`;
      return null;
    }
  }

  /** Latest card element per lead (weakly held, bounded) for the action engine. */
  private rememberLeadCard(leadId: string, card: Element): void {
    this.leadCards.delete(leadId);
    this.leadCards.set(leadId, new WeakRef(card));
    if (this.leadCards.size > 5000) {
      const oldest = this.leadCards.keys().next().value;
      if (oldest !== undefined) this.leadCards.delete(oldest);
    }
  }

  /** Current card element of a lead, or null when it left the page. */
  getCardForLead(leadId: string): Element | null {
    const card = this.leadCards.get(leadId)?.deref();
    return card?.isConnected ? card : null;
  }

  getLeadFacts(leadId: string): LeadFacts | null {
    return this.results.factsFor(leadId);
  }

  listLeadFacts(): LeadFacts[] {
    return this.results.allFacts();
  }

  private emitMatch(event: MatchEvent | null | undefined): void {
    if (event) this.emit({ type: 'LEAD_MATCHED', event, timestamp: this.now() });
  }

  /** Filter + score, isolated: an error leaves the lead unfiltered, never lost. */
  private applyFilters(normalized: NormalizedLead): Verdict | null {
    try {
      return this.results.evaluate(normalized);
    } catch (error) {
      this.results.recordFilterError();
      this.metrics.errors++;
      this.lastError = `filter: ${errorMessage(error)}`;
      return null;
    }
  }

  /**
   * Read-only check that the Contact Buyer button can be identified for this
   * lead (diagnostics for the future action engine). Never clicks.
   */
  private checkContactButton(
    card: Element,
    lead: Pick<Lead, 'rawTitle'>,
  ): 'found' | 'ACTION_NOT_FOUND' | 'IDENTITY_MISMATCH' {
    try {
      const result = resolveContactBuyer(card, {
        expectedTitle: lead.rawTitle,
        ...(this.isElementVisible ? { isVisible: this.isElementVisible } : {}),
      });
      this.metrics.recordContactButton(result);
      return result.ok ? 'found' : result.code;
    } catch {
      return 'ACTION_NOT_FOUND';
    }
  }

  private sample(
    card: Element,
    outcome: 'new' | 'updated' | 'failed',
    lead: Pick<Lead, 'rawTitle' | 'productCategory' | 'extraction'> | null,
    matched = false,
  ): void {
    // Only matched leads can be clicked, so only they are checked: the check
    // reads layout (visibility) and is the costliest per-card diagnostic.
    const contactButton = lead && matched ? this.checkContactButton(card, lead) : 'not-checked';
    this.metrics.recordSample({
      label: lead ? leadLabel(lead) : 'Unreadable card',
      contactButton,
      outcome,
      cardConfidence: this.cardDetections.get(card)?.confidence ?? 0,
      extractionConfidence: lead?.extraction.confidence ?? 0,
      completeness: lead?.extraction.completeness ?? 0,
      failedFields: lead?.extraction.failedFields ?? [],
      missingFields: lead?.extraction.missingFields ?? [],
      timestamp: this.now(),
    });
  }

  private safeFindCard(element: Element) {
    try {
      return findLeadCard(element, this.cardConfig);
    } catch (error) {
      this.metrics.errors++;
      this.lastError = errorMessage(error);
      return null;
    }
  }

  private registerCard(card: Element, detection: CardDetection): void {
    this.knownCards.add(card);
    this.cardDetections.set(card, detection);
    this.metrics.cardsResolved++;
  }

  /** Nearest known card containing `el`, walking a bounded number of ancestors. */
  private knownCardFor(el: Element): Element | null {
    let current: Element | null = el;
    for (let i = 0; current && i <= this.cardConfig.maxAncestorDepth + 1; i++) {
      if (this.knownCards.has(current)) {
        // A "card" that now holds several cards (more loaded into it) is stale.
        if (holdsSeveralCards(current, this.cardConfig)) {
          this.knownCards.delete(current);
          return null;
        }
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  private attachNavigationListeners(): void {
    const win = this.doc.defaultView;
    if (!win) return;
    const onNavigate = () => this.queue.request();
    win.addEventListener('popstate', onNavigate);
    win.addEventListener('hashchange', onNavigate);
    // Navigation API (Chrome 102+) catches pushState-driven SPA route changes.
    const navigation = (win as unknown as { navigation?: EventTarget }).navigation;
    navigation?.addEventListener('navigatesuccess', onNavigate);
    this.detachNavigation = () => {
      win.removeEventListener('popstate', onNavigate);
      win.removeEventListener('hashchange', onNavigate);
      navigation?.removeEventListener('navigatesuccess', onNavigate);
    };
  }

  private teardown(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.detachNavigation?.();
    this.detachNavigation = null;
    this.queue.clear();
    this.pending.clear();
    this.currentScan = null;
  }

  private fail(error: unknown): void {
    this.metrics.errors++;
    this.lastError = errorMessage(error);
    if (!this.observer) this.status = 'error';
    this.emit({ type: 'SCANNER_ERROR', error: this.lastError, timestamp: this.now() });
  }

  private emit(event: ScannerEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // A failing listener (UI, log) must never affect scanning.
      }
    }
  }
}
