import { useEffect, useRef } from 'react';
import { formatPoints, type LeadPriority } from '@/core/scoring';
import type { LeadResult, ScanLog, ScannerDiagnostics, ScannerState } from '@/core/types/scanner';
import { useDeveloperMode } from './use-developer-mode';
import type { ScannerView } from './use-scanner';

const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function clock(ts: number | null): string {
  return ts === null ? 'Not yet' : timeFormat.format(ts);
}

function statusCopy(state: ScannerState): { label: string; tone: string } {
  switch (state.status) {
    case 'scanning':
      return state.pageActive
        ? { label: 'Scanning', tone: 'bg-ok border-ok' }
        : { label: 'Waiting for a lead list', tone: 'bg-transparent border-wait' };
    case 'starting':
      return { label: 'Starting', tone: 'bg-transparent border-muted' };
    case 'stopped':
      return { label: 'Stopped', tone: 'bg-transparent border-muted' };
    case 'error':
      return { label: 'Error', tone: 'bg-fail border-fail' };
    case 'idle':
      return { label: 'Not started', tone: 'bg-transparent border-muted' };
    case 'locked':
      return { label: 'Locked: license not active', tone: 'bg-fail border-fail' };
  }
}

function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="min-w-0" title={hint}>
      <dt className="truncate text-[11px] leading-4 text-muted">{label}</dt>
      <dd className="text-[17px] leading-6 font-semibold">{value}</dd>
    </div>
  );
}

const LEVEL_TONE: Record<ScanLog['level'], string> = {
  INFO: 'text-ink',
  SUCCESS: 'text-ok',
  WARN: 'text-wait',
  ERROR: 'text-fail',
};

function LogList({ logs }: { logs: readonly ScanLog[] }) {
  const box = useRef<HTMLOListElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    const el = box.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [logs]);

  if (logs.length === 0) {
    return (
      <p className="rounded-md border border-rule bg-surface px-3 py-3 text-[12px] text-muted">
        Scanner events appear here as leads are read.
      </p>
    );
  }

  return (
    <ol
      ref={box}
      tabIndex={0}
      aria-label="Scanner log, most recent last"
      onScroll={(e) => {
        const el = e.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
      className="max-h-[176px] overflow-y-auto rounded-md border border-rule bg-surface px-3 py-2 text-[12px] leading-[18px] focus-visible:outline-2 focus-visible:outline-ok"
    >
      {logs.map((entry) => (
        <li key={entry.id} className="flex gap-2">
          <time className="shrink-0 text-muted" dateTime={new Date(entry.timestamp).toISOString()}>
            {timeFormat.format(entry.timestamp)}
          </time>
          <span className={`min-w-0 break-words ${LEVEL_TONE[entry.level]}`}>{entry.message}</span>
        </li>
      ))}
    </ol>
  );
}

function Diagnostics({ d }: { d: ScannerDiagnostics }) {
  const rows: Array<[string, string | number]> = [
    ['Mutations observed', d.mutationCount],
    ['Batches processed', d.batchCount],
    ['Candidates checked', d.candidateCount],
    ['Cards resolved', d.cardsResolved],
    ['Candidates rejected', d.rejectedCandidates],
    ['Read reliability (avg)', `${Math.round(d.averageConfidence * 100)}%`],
    ['Fields present (avg)', `${Math.round(d.averageCompleteness * 100)}%`],
    [
      'Latency avg / p95 / max',
      `${d.averageProcessingTimeMs} / ${d.p95ProcessingTimeMs} / ${d.maxProcessingTimeMs} ms`,
    ],
    ['Errors', d.errors],
    [
      'Extraction avg / p50 / p95 / max',
      `${d.extraction.averageMs} / ${d.extraction.p50Ms} / ${d.extraction.p95Ms} / ${d.extraction.maxMs} ms`,
    ],
    ['Queue size', d.queueSize],
    ['Filter evaluations', d.filter.evaluations],
    ['Filter matched / rejected', `${d.filter.matched} / ${d.filter.rejected}`],
    ['Filter latency avg / max', `${d.filter.averageTimeMs} / ${d.filter.maxTimeMs} ms`],
    ['Filter errors', d.filter.errors],
    ['Scoring', d.scoring.configSummary],
    [
      'Eligible / scored / rejected',
      `${d.scoring.eligible} / ${d.scoring.scored} / ${d.scoring.rejectedFromScoring}`,
    ],
    [
      'Score avg / min / max',
      d.scoring.averageScore === null
        ? '—'
        : `${d.scoring.averageScore} / ${d.scoring.minScore ?? '—'} / ${d.scoring.maxScore ?? '—'}`,
    ],
    [
      'Scoring time avg / p95 / max',
      `${d.scoring.timing.averageMs} / ${d.scoring.timing.p95Ms} / ${d.scoring.timing.maxMs} ms (${d.scoring.timing.count})`,
    ],
    ['Scoring errors', d.scoring.errors],
    [
      'Contact Buyer button (read-only check)',
      `found ${d.contactButton.found} (ref ${d.contactButton.byReference} / text ${d.contactButton.byText}) · not found ${d.contactButton.notFound} · mismatch ${d.contactButton.identityMismatch}`,
    ],
    ['Contact Buyer last failure', d.contactButton.lastFailure ?? '—'],
    [
      'Normalization',
      d.normalization.errors > 0
        ? `ERRORS ${d.normalization.errors} (v${d.normalization.version})`
        : `READY v${d.normalization.version}`,
    ],
    [
      'Normalized / avg time',
      `${d.normalization.normalized} / ${d.normalization.averageTimeMs} ms`,
    ],
    ['Selector map', d.selectorMapVersion],
  ];
  const counts = (record: Readonly<Record<string, number | undefined>>) =>
    Object.entries(record)
      .filter(([, n]) => (n ?? 0) > 0)
      .map(([k, n]) => `${k} ${n}`)
      .join(', ') || 'None';

  return (
    <section aria-labelledby="diag-heading" className="border-t border-rule px-4 py-3">
      <h2 id="diag-heading" className="pb-1.5 text-[12px] font-medium text-muted">
        Developer diagnostics
      </h2>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-[12px]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted">{label}</dt>
            <dd className="text-right">{value}</dd>
          </div>
        ))}
        <dt className="text-muted">Selector failures</dt>
        <dd className="text-right">{counts(d.selectorFailures)}</dd>
        <dt className="text-muted">Extraction failed</dt>
        <dd className="text-right">{counts(d.failedFields)}</dd>
        <dt className="text-muted">Not in card (normal)</dt>
        <dd className="text-right">{counts(d.missingFields)}</dd>
        <dt className="text-muted">Notes</dt>
        <dd className="text-right">{counts(d.notes)}</dd>
        <dt className="text-muted">Rejected by</dt>
        <dd className="text-right">{counts(d.filter.rejectionReasons)}</dd>
        <dt className="text-muted">Filter config</dt>
        <dd className="text-right">{d.filter.configSummary}</dd>
        <dt className="text-muted">Normalization warnings</dt>
        <dd className="text-right">{counts(d.normalization.warnings)}</dd>
      </dl>
      {d.recentExtractions.length > 0 && (
        <table className="mt-3 w-full table-fixed text-left text-[11px] leading-4">
          <caption className="pb-1 text-left text-[12px] font-medium text-muted">
            Recent cards: card match, fields present, failed fields
          </caption>
          <thead className="sr-only">
            <tr>
              <th>Lead</th>
              <th>Card match</th>
              <th>Fields present</th>
              <th>Failed fields</th>
            </tr>
          </thead>
          <tbody>
            {[...d.recentExtractions].reverse().map((x) => (
              <tr key={`${x.timestamp}-${x.label}`} className="border-t border-rule align-top">
                <td className="truncate py-1 pr-2" title={x.label}>
                  {x.outcome === 'updated' ? '↻ ' : x.outcome === 'failed' ? '✕ ' : ''}
                  {x.label}
                </td>
                <td className="w-9 py-1 text-right">{Math.round(x.cardConfidence * 100)}%</td>
                <td className="w-9 py-1 text-right">{Math.round(x.completeness * 100)}%</td>
                <td
                  className="w-20 truncate py-1 pl-2 text-muted"
                  title={x.failedFields.join(', ')}
                >
                  {x.failedFields.join(', ') || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

const OUTCOME: Record<LeadResult['reasons'][number]['outcome'], { symbol: string; tone: string }> =
  {
    pass: { symbol: '✓', tone: 'text-ok' },
    fail: { symbol: '✕', tone: 'text-fail' },
    info: { symbol: '⚠', tone: 'text-wait' },
  };

const PRIORITY_STYLE: Record<LeadPriority, string> = {
  CRITICAL: 'bg-fail text-paper',
  HIGH: 'bg-wait text-paper',
  MEDIUM: 'bg-ok text-paper',
  LOW: 'border border-ok text-ok',
  UNSCORED: 'border border-muted text-muted',
  REJECTED: 'border border-rule text-muted',
};

function PriorityBadge({ priority }: { priority: LeadPriority }) {
  return (
    <span
      className={`w-[68px] shrink-0 rounded px-1.5 py-px text-center text-[10px] font-semibold tracking-wide ${PRIORITY_STYLE[priority]}`}
    >
      {priority}
    </span>
  );
}

/** Scored-lead counts per priority; rejected and unscored listed separately. */
function PriorityStrip({ d }: { d: ScannerDiagnostics['scoring'] }) {
  const c = d.priorityCounts;
  return (
    <p className="pt-1 text-[12px] text-muted">
      Critical {c.CRITICAL} · High {c.HIGH} · Medium {c.MEDIUM} · Low {c.LOW}
      {c.UNSCORED > 0 ? ` · Unscored ${c.UNSCORED}` : ''}
      {d.averageScore !== null ? ` · avg ${d.averageScore}` : ''}
    </p>
  );
}

/** Recent filter verdicts with an expandable explanation per lead. */
function Results({ results }: { results: readonly LeadResult[] }) {
  if (results.length === 0) {
    return (
      <p className="rounded-md border border-rule bg-surface px-3 py-3 text-[12px] text-muted">
        Filter results appear here as leads are read.
      </p>
    );
  }
  return (
    <ul className="max-h-[220px] overflow-y-auto rounded-md border border-rule bg-surface">
      {results.map((r) => (
        <li key={r.leadId} className="border-b border-rule last:border-b-0">
          <details className="group px-3 py-1.5">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-[12px] focus-visible:outline-2 focus-visible:outline-ok">
              <PriorityBadge priority={r.priority} />
              <span className="min-w-0 flex-1 truncate" title={r.label}>
                {r.label}
              </span>
              <span className="shrink-0 text-[11px] text-muted">{r.country ?? '—'}</span>
              <span className="w-12 shrink-0 text-right text-[11px] font-semibold">
                {r.score === null ? '—' : `${r.score}/100`}
              </span>
            </summary>
            <p className="pt-1 text-[11px] text-muted">
              {r.status}
              {r.priority === 'UNSCORED' ? ' · not scored (scoring off)' : ''}
              {r.score !== null ? ` · score ${r.score}/100 · ${r.priority}` : ''}
            </p>
            {r.scoreReasons.length > 0 && (
              <ul className="space-y-0.5 pt-1 pl-1 text-[11px] leading-4">
                {r.scoreReasons.map((reason, i) => (
                  <li key={i} className={`flex gap-1.5 ${reason.points > 0 ? '' : 'text-muted'}`}>
                    <span className="w-8 shrink-0 text-right tabular-nums">
                      {formatPoints(reason.points)}
                    </span>
                    <span className="min-w-0 break-words">{reason.message}</span>
                  </li>
                ))}
              </ul>
            )}
            <ul className="space-y-0.5 pt-1 pb-0.5 pl-1 text-[11px] leading-4">
              {r.reasons.length === 0 && <li className="text-muted">No filter groups applied.</li>}
              {r.reasons.map((reason, i) => (
                <li key={i} className="flex gap-1.5">
                  <span aria-hidden className={OUTCOME[reason.outcome].tone}>
                    {OUTCOME[reason.outcome].symbol}
                  </span>
                  <span className="sr-only">{reason.outcome}:</span>
                  <span className="min-w-0 break-words">{reason.message}</span>
                </li>
              ))}
            </ul>
          </details>
        </li>
      ))}
    </ul>
  );
}

export function ScannerPanel({ view }: { view: ScannerView }) {
  const { snapshot, logs, busy, error } = view;
  const [developerMode, setDeveloperMode] = useDeveloperMode();

  if (!snapshot) {
    return <p className="px-4 py-4 text-[12px] text-muted">Connecting to the scanner…</p>;
  }

  const { state, diagnostics } = snapshot;
  const status = statusCopy(state);
  const running = state.status === 'scanning' || state.status === 'starting';

  return (
    <>
      <section aria-labelledby="scanner-heading" className="px-4 pt-3 pb-3">
        <div className="flex items-center gap-2">
          <span aria-hidden className={`size-[9px] rounded-full border-2 ${status.tone}`} />
          <h2 id="scanner-heading" className="flex-1 text-[14px] font-semibold">
            {status.label}
          </h2>
          <button
            type="button"
            disabled={busy}
            onClick={running ? view.stop : view.start}
            className="rounded-md border border-rule bg-surface px-3 py-1 text-[12px] font-medium hover:border-muted disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ok"
          >
            {running ? 'Stop scanning' : 'Start scanning'}
          </button>
        </div>
        {(error ?? state.lastError) && (
          <p role="alert" className="pt-1 text-[12px] text-fail">
            {error ?? state.lastError}
          </p>
        )}

        <dl className="grid grid-cols-3 gap-x-3 gap-y-2 pt-3">
          <Stat label="Detected" value={state.detected} />
          <Stat label="Processed" value={state.processed} />
          <Stat label="Duplicates" value={state.duplicates} />
          <Stat label="Failed" value={state.extractionFailures} hint="Extraction failures" />
          <Stat label="Matched" value={state.matched} hint="Unique leads, current filters" />
          <Stat label="Rejected" value={state.rejected} hint="Unique leads, current filters" />
        </dl>
        <PriorityStrip d={diagnostics.scoring} />
        <p className="pt-1 text-[12px] text-muted">
          Last scan {clock(state.lastScanAt)}. Average {state.averageProcessingTimeMs} ms per lead.
        </p>
      </section>

      <section aria-labelledby="results-heading" className="px-4 pb-3">
        <h2 id="results-heading" className="pb-1.5 text-[12px] font-medium text-muted">
          Recent results · {diagnostics.filter.configSummary}
        </h2>
        <Results results={view.snapshot?.results ?? []} />
      </section>

      <section aria-labelledby="log-heading" className="px-4 pb-3">
        <h2 id="log-heading" className="pb-1.5 text-[12px] font-medium text-muted">
          Scanner log
        </h2>
        <LogList logs={logs} />
      </section>

      {developerMode && <Diagnostics d={diagnostics} />}

      <div className="border-t border-rule px-4 py-2">
        <label className="flex cursor-pointer items-center gap-2 text-[12px] text-muted">
          <input
            type="checkbox"
            checked={developerMode}
            onChange={(e) => setDeveloperMode(e.currentTarget.checked)}
            className="size-3.5 accent-[var(--ok)] focus-visible:outline-2 focus-visible:outline-ok"
          />
          Show developer diagnostics
        </label>
      </div>
    </>
  );
}
