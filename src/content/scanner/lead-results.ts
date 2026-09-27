import type { LeadFacts, MatchEvent } from '@/core/actions';
import {
  compileFilter,
  evaluateLead,
  summarizeFilterConfig,
  type CompiledFilter,
  type FilterConfig,
  type FilterEvaluation,
  type FilterGroup,
  type FilterReasonType,
} from '@/core/filters';
import type { NormalizedLead } from '@/core/normalization';
import {
  DEFAULT_SCORING_CONFIG,
  compileScoring,
  scoreLead,
  summarizeScoringConfig,
  type CompiledScoring,
  type LeadPriority,
  type LeadScoreResult,
  type ScoringConfig,
} from '@/core/scoring';
import type { FilterDiagnostics, LeadResult, ScoringDiagnostics } from '@/core/types/scanner';
import { Ring } from './scanner-metrics';

interface Stored {
  readonly lead: NormalizedLead;
  evaluation: FilterEvaluation;
  /** null only when scoring threw (counted as an error). */
  score: LeadScoreResult | null;
}

export interface Verdict {
  readonly evaluation: FilterEvaluation;
  /** Set when this evaluation produced MATCHED (a new, unique matchEventId). */
  readonly matchEvent: MatchEvent | null;
  readonly score: LeadScoreResult | null;
  readonly previousStatus: FilterEvaluation['status'] | null;
  readonly previousPriority: LeadPriority | null;
}

const PRIORITIES: readonly LeadPriority[] = [
  'CRITICAL',
  'HIGH',
  'MEDIUM',
  'LOW',
  'UNSCORED',
  'REJECTED',
];

function bump<K>(map: Map<K, number>, key: K, by: number): void {
  const next = (map.get(key) ?? 0) + by;
  if (next <= 0) map.delete(key);
  else map.set(key, next);
}

const round = (n: number) => Math.round(n * 1000) / 1000;

function label(lead: NormalizedLead): string {
  return lead.title.raw?.replace(/\s+/g, ' ').trim() || lead.productCategory || 'Untitled lead';
}

/**
 * Identity keys for the contacted ledger: lead id, fingerprint, and a hash of
 * title + country (so a re-rendered or reloaded copy of a contacted lead is
 * recognised even when its id differs). Hashes only; no raw text is stored.
 */
function toFacts(stored: Stored): LeadFacts {
  const { lead, evaluation } = stored;
  return {
    leadId: lead.id,
    fingerprint: lead.fingerprint,
    title: lead.title.raw,
    status: evaluation.status,
  };
}

/** "m-<random session>-<counter>": unique per page session and across tabs. */
function defaultMatchEventIds(): () => string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const session = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  let seq = 0;
  return () => `m-${session}-${++seq}`;
}

/** Invalid initial scoring config → defaults (stored configs are validated anyway). */
function safeCompileScoring(config: ScoringConfig): CompiledScoring {
  try {
    return compileScoring(config);
  } catch {
    return compileScoring(DEFAULT_SCORING_CONFIG);
  }
}

/** A scoring failure never loses the lead: it shows as UNSCORED and is counted. */
function priorityOf(stored: Pick<Stored, 'score'>): LeadPriority {
  return stored.score?.priority ?? 'UNSCORED';
}

/**
 * Current verdict for every remembered lead: Phase 4 filter evaluation and
 * Phase 5 score, plus counters, reason statistics, score statistics and a
 * short list of recent results for the popup. Counters always describe the
 * current configs: changing filters or scoring re-evaluates instead of
 * double-counting. Rejected leads are never counted as score 0.
 */
export class LeadResults {
  private filter: CompiledFilter;
  private scoring: CompiledScoring;
  private readonly leads = new Map<string, Stored>();

  private matchedCount = 0;
  private rejectedCount = 0;
  private readonly matchReasons = new Map<FilterReasonType, number>();
  private readonly rejectionReasons = new Map<FilterGroup, number>();
  private readonly priorityCounts = new Map<LeadPriority, number>();
  private scoreSum = 0;
  private scoredCount = 0;

  private recentResults: LeadResult[] = [];

  private evaluations = 0;
  private filterErrors = 0;
  private filterTimeTotal = 0;
  private filterTimeMax = 0;

  private scorings = 0;
  private scoringErrors = 0;
  private scoringTimeTotal = 0;
  private scoringTimeMax = 0;
  private readonly scoringTimes = new Ring(200);

  constructor(
    filterConfig: FilterConfig,
    scoringConfig: ScoringConfig,
    private readonly clock: () => number,
    private readonly now: () => number,
    private readonly maxLeads = 5000,
    private readonly maxRecent = 20,
    private readonly newMatchEventId: () => string = defaultMatchEventIds(),
  ) {
    this.filter = compileFilter(filterConfig);
    this.scoring = safeCompileScoring(scoringConfig);
  }

  get matched(): number {
    return this.matchedCount;
  }
  get rejected(): number {
    return this.rejectedCount;
  }

  /** Filter, then score, a new or updated lead. */
  evaluate(lead: NormalizedLead): Verdict {
    const evaluation = this.timedFilter(lead);
    const score = this.timedScore(lead, evaluation);
    const existing = this.leads.get(lead.id);
    const previousStatus = existing?.evaluation.status ?? null;
    const previousPriority = existing ? priorityOf(existing) : null;
    if (existing) {
      this.count(existing, -1);
      this.leads.delete(lead.id); // re-insert as most recent
    }
    const stored: Stored = { lead, evaluation, score };
    this.leads.set(lead.id, stored);
    this.count(stored, +1);
    this.evict();
    this.remember(stored);
    const matchEvent =
      evaluation.status === 'MATCHED'
        ? this.matchEvent(lead, existing ? 'updated' : 'detected')
        : null;
    return { evaluation, score, previousStatus, previousPriority, matchEvent };
  }

  recordFilterError(): void {
    this.filterErrors++;
  }

  /** New filters: re-filter and re-score every remembered lead. */
  setFilterConfig(config: FilterConfig): {
    matched: number;
    rejected: number;
    changed: number;
    /** Leads that newly match under the new filters: one match event each. */
    newlyMatched: MatchEvent[];
  } {
    this.filter = compileFilter(config);
    let changed = 0;
    const newlyMatched: MatchEvent[] = [];
    this.recompute((stored) => {
      const evaluation = this.timedFilter(stored.lead);
      if (evaluation.status !== stored.evaluation.status) changed++;
      if (evaluation.status === 'MATCHED' && stored.evaluation.status !== 'MATCHED') {
        newlyMatched.push(this.matchEvent(stored.lead, 'filters'));
      }
      stored.evaluation = evaluation;
      stored.score = this.timedScore(stored.lead, evaluation);
    });
    return { matched: this.matchedCount, rejected: this.rejectedCount, changed, newlyMatched };
  }

  /** A new, unique id for a MATCHED evaluation: never the lead id, never reused. */
  private matchEvent(lead: NormalizedLead, trigger: MatchEvent['trigger']): MatchEvent {
    return {
      matchEventId: this.newMatchEventId(),
      leadId: lead.id,
      fingerprint: lead.fingerprint,
      title: lead.title.raw,
      trigger,
      at: this.now(),
    };
  }

  /** New scoring: re-score every remembered lead (filter verdicts unchanged). */
  setScoringConfig(config: ScoringConfig): {
    scored: number;
    averageScore: number | null;
    changed: number;
  } {
    this.scoring = compileScoring(config); // throws on an invalid config: the previous one stays
    let changed = 0;
    this.recompute((stored) => {
      const before = stored.score?.score ?? null;
      const beforePriority = priorityOf(stored);
      stored.score = this.timedScore(stored.lead, stored.evaluation);
      if (stored.score?.score !== before || priorityOf(stored) !== beforePriority) changed++;
    });
    return { scored: this.scoredCount, averageScore: this.averageScore(), changed };
  }

  /** Facts for the auto-click engine (latest verdict of one lead). */
  factsFor(leadId: string): LeadFacts | null {
    const stored = this.leads.get(leadId);
    return stored ? toFacts(stored) : null;
  }

  allFacts(): LeadFacts[] {
    return [...this.leads.values()].map(toFacts);
  }

  recent(): readonly LeadResult[] {
    return this.recentResults;
  }

  filterDiagnostics(): FilterDiagnostics {
    return {
      configSummary: summarizeFilterConfig(this.filter.config),
      evaluations: this.evaluations,
      matched: this.matchedCount,
      rejected: this.rejectedCount,
      errors: this.filterErrors,
      averageTimeMs: this.evaluations === 0 ? 0 : round(this.filterTimeTotal / this.evaluations),
      maxTimeMs: round(this.filterTimeMax),
      matchReasons: Object.fromEntries(this.matchReasons),
      rejectionReasons: Object.fromEntries(this.rejectionReasons),
    };
  }

  scoringDiagnostics(): ScoringDiagnostics {
    let min: number | null = null;
    let max: number | null = null;
    for (const stored of this.leads.values()) {
      const s = stored.score?.score;
      if (s === null || s === undefined) continue;
      min = min === null ? s : Math.min(min, s);
      max = max === null ? s : Math.max(max, s);
    }
    const counts = Object.fromEntries(
      PRIORITIES.map((p) => [p, this.priorityCounts.get(p) ?? 0]),
    ) as Record<LeadPriority, number>;
    return {
      configSummary: summarizeScoringConfig(this.scoring.config),
      eligible: this.matchedCount,
      scored: this.scoredCount,
      rejectedFromScoring: this.rejectedCount,
      priorityCounts: counts,
      averageScore: this.averageScore(),
      minScore: min,
      maxScore: max,
      timing: {
        count: this.scorings,
        averageMs: this.scorings === 0 ? 0 : round(this.scoringTimeTotal / this.scorings),
        p95Ms: round(this.scoringTimes.percentile(95)),
        maxMs: round(this.scoringTimeMax),
      },
      errors: this.scoringErrors,
    };
  }

  /* ---------------------------------------------------------------- */

  private averageScore(): number | null {
    return this.scoredCount === 0 ? null : Math.round((this.scoreSum / this.scoredCount) * 10) / 10;
  }

  /** Apply `update` to every stored lead, keeping counters and recent results consistent. */
  private recompute(update: (stored: Stored) => void): void {
    for (const stored of this.leads.values()) {
      this.count(stored, -1);
      update(stored);
      this.count(stored, +1);
    }
    this.recentResults = this.recentResults.map((r) => {
      const stored = this.leads.get(r.leadId);
      return stored ? this.result(stored) : r;
    });
  }

  private timedFilter(lead: NormalizedLead): FilterEvaluation {
    const started = this.clock();
    const evaluation = evaluateLead(lead, this.filter, { evaluatedAt: this.now() });
    const ms = this.clock() - started;
    this.evaluations++;
    this.filterTimeTotal += ms;
    this.filterTimeMax = Math.max(this.filterTimeMax, ms);
    return evaluation;
  }

  private timedScore(lead: NormalizedLead, evaluation: FilterEvaluation): LeadScoreResult | null {
    const started = this.clock();
    try {
      const result = scoreLead(lead, evaluation, this.scoring, { calculatedAt: this.now() });
      if (result.kind === 'SCORED') {
        const ms = this.clock() - started;
        this.scorings++;
        this.scoringTimeTotal += ms;
        this.scoringTimeMax = Math.max(this.scoringTimeMax, ms);
        this.scoringTimes.push(ms);
      }
      return result;
    } catch {
      this.scoringErrors++;
      return null;
    }
  }

  private count(stored: Stored, by: 1 | -1): void {
    const { evaluation } = stored;
    if (evaluation.passed) {
      this.matchedCount += by;
      for (const r of evaluation.reasons)
        if (r.outcome === 'pass') bump(this.matchReasons, r.type, by);
    } else {
      this.rejectedCount += by;
      for (const g of evaluation.failedConditions) bump(this.rejectionReasons, g, by);
    }
    bump(this.priorityCounts, priorityOf(stored), by);
    const s = stored.score?.score;
    if (s !== null && s !== undefined) {
      this.scoreSum += by * s;
      this.scoredCount += by;
    }
  }

  private evict(): void {
    while (this.leads.size > this.maxLeads) {
      const oldest = this.leads.keys().next().value;
      if (oldest === undefined) return;
      const stored = this.leads.get(oldest);
      if (stored) this.count(stored, -1);
      this.leads.delete(oldest);
    }
  }

  private result(stored: Stored): LeadResult {
    const { lead, evaluation, score } = stored;
    return {
      leadId: lead.id,
      label: label(lead),
      country: lead.country.normalized,
      quantity: lead.quantity.raw,
      status: evaluation.status,
      reasons: evaluation.reasons
        .filter((r) => r.type !== 'NEGATIVE_CLEAR')
        .map((r) => ({ outcome: r.outcome, message: r.message })),
      evaluatedAt: evaluation.evaluatedAt,
      score: score?.score ?? null,
      priority: priorityOf(stored),
      scoreReasons:
        score?.kind === 'SCORED'
          ? score.reasons.map((r) => ({ points: r.points, message: r.message }))
          : [],
    };
  }

  private remember(stored: Stored): void {
    const entry = this.result(stored);
    this.recentResults = [
      entry,
      ...this.recentResults.filter((r) => r.leadId !== entry.leadId),
    ].slice(0, this.maxRecent);
  }
}
