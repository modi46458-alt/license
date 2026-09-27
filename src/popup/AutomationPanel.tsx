import { useId } from 'react';
import {
  ACTION_DELAY_OPTIONS_MS,
  type ActionRecord,
  type ActionStatus,
  type AutomationSnapshot,
} from '@/core/actions';
import type { AutomationConfigView } from './use-automation-config';

const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ok';

const STATUS_TONE: Record<ActionStatus, string> = {
  QUEUED: 'text-muted',
  RUNNING: 'text-wait',
  RETRYING: 'text-wait',
  SUCCESS: 'text-ok',
  FAILED: 'text-fail',
  SKIPPED: 'text-muted',
  CANCELLED: 'text-muted',
};

export const STATUS_TEXT = {
  on: 'Matched leads will be contacted automatically.',
  off: 'Auto-click disabled.',
  standby: 'Auto-click is running in another IndiaMART tab. This tab is waiting.',
  locked: 'Locked: an active license is required. Nothing is clicked.',
} as const;

/* ------------------------------------------------------------------ */
/* STOP                                                                 */
/* ------------------------------------------------------------------ */

/** The emergency STOP, shown on every tab while Auto-Click is ON. */
export function StopBanner({
  enabled,
  automation,
  onStop,
}: {
  enabled: boolean;
  automation: AutomationSnapshot | null;
  onStop: () => void;
}) {
  if (!enabled) return null;
  return (
    <div
      role="status"
      className="flex items-center gap-3 border-b border-fail bg-fail px-4 py-2 text-paper"
    >
      <span className="min-w-0 flex-1 text-[12px] font-medium">
        Auto-Click ON{automation ? ` · ${automation.clicked} contacted` : ''}
        {automation && automation.queueLength > 0 ? ` · ${automation.queueLength} queued` : ''}
      </span>
      <button
        type="button"
        onClick={onStop}
        className="rounded-md bg-paper px-3 py-1.5 text-[13px] font-bold tracking-wide text-fail focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper"
      >
        STOP AUTOMATION
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* History                                                              */
/* ------------------------------------------------------------------ */

function History({ records }: { records: readonly ActionRecord[] }) {
  if (records.length === 0) return <p className="text-[12px] text-muted">No clicks yet.</p>;
  return (
    <ul className="max-h-[220px] overflow-y-auto rounded-md border border-rule bg-surface text-[11px]">
      {records.map((r) => (
        <li key={r.actionId} className="border-b border-rule px-2 py-1 last:border-b-0">
          <div className="flex gap-2">
            <span className={`w-[70px] shrink-0 font-semibold ${STATUS_TONE[r.status]}`}>
              {r.status}
            </span>
            <span className="min-w-0 flex-1 truncate" title={r.leadLabel}>
              {r.leadLabel}
            </span>
          </div>
          {r.errorCode && (
            <p className="pl-[78px] text-muted">
              {r.errorCode}: {r.errorMessage}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

function DelaySelect({
  value,
  disabled,
  onChange,
}: {
  value: number;
  disabled: boolean;
  onChange: (ms: number) => void;
}) {
  const id = useId();
  const options: readonly number[] = ACTION_DELAY_OPTIONS_MS.includes(
    value as (typeof ACTION_DELAY_OPTIONS_MS)[number],
  )
    ? ACTION_DELAY_OPTIONS_MS
    : [...ACTION_DELAY_OPTIONS_MS, value].sort((a, b) => a - b);
  return (
    <div className="flex items-center justify-between gap-2 pt-2 text-[12px]">
      <label htmlFor={id}>Delay between clicks</label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
        className={`rounded-md border border-rule bg-surface px-2 py-1 ${focusRing}`}
      >
        {options.map((ms) => (
          <option key={ms} value={ms}>
            {ms >= 1000 ? `${ms / 1000} s` : `${ms} ms`}
          </option>
        ))}
      </select>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Panel                                                                */
/* ------------------------------------------------------------------ */

export function AutomationPanel({
  settings,
  automation,
  automationError,
  onToggle,
  onStop,
}: {
  settings: AutomationConfigView;
  automation: AutomationSnapshot | null;
  automationError: string | null;
  onToggle: (on: boolean) => void;
  onStop: () => void;
}) {
  const saved = settings.saved;
  if (saved === null) return <p className="px-4 py-4 text-[12px] text-muted">Loading…</p>;

  const on = saved.autoClickEnabled;
  const status =
    automation?.state === 'LOCKED'
      ? STATUS_TEXT.locked
      : !on
        ? STATUS_TEXT.off
        : automation?.state === 'STANDBY'
          ? STATUS_TEXT.standby
          : STATUS_TEXT.on;

  return (
    <div>
      <section aria-labelledby="auto-title" className="px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <h2 id="auto-title" className="text-[13px] font-bold tracking-wide uppercase">
            Auto-click Contact Buyer
          </h2>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-labelledby="auto-title"
            disabled={settings.busy}
            onClick={() => onToggle(!on)}
            className={`relative h-7 w-14 shrink-0 rounded-full transition-colors disabled:opacity-50 ${focusRing} ${
              on ? 'bg-fail' : 'bg-rule'
            }`}
          >
            <span
              className={`absolute top-1 left-1 grid size-5 place-items-center rounded-full bg-paper text-[8px] font-bold transition-transform ${
                on ? 'translate-x-7 text-fail' : 'text-muted'
              }`}
            >
              {on ? 'ON' : 'OFF'}
            </span>
          </button>
        </div>
        <p role="status" className={`pt-2 text-[13px] ${on ? 'font-medium' : 'text-muted'}`}>
          {status}
        </p>
        <p className="pt-1 text-[11px] text-muted">
          Each time the filters MATCH a lead, its Contact Buyer is clicked once for that match, one
          at a time. Rejected leads are never clicked.
        </p>
        <DelaySelect
          value={saved.delayBetweenActionsMs}
          disabled={settings.busy}
          onChange={settings.setDelay}
        />
        {on && (
          <button
            type="button"
            onClick={onStop}
            className="mt-3 w-full rounded-md bg-fail px-3 py-2 text-[13px] font-bold tracking-wide text-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fail"
          >
            STOP AUTOMATION
          </button>
        )}
        {(automationError ?? settings.message) && (
          <p role="alert" className="pt-2 text-[12px] text-muted">
            {automationError ?? settings.message}
          </p>
        )}
      </section>

      <section aria-labelledby="auto-history" className="border-t border-rule px-4 py-3">
        <div className="flex items-baseline justify-between pb-2">
          <h3
            id="auto-history"
            className="text-[11px] font-semibold tracking-wide text-muted uppercase"
          >
            Contact Buyer clicks (latest first)
          </h3>
          <span className="text-[11px] text-muted">
            {automation?.clicked ?? 0} contacted · {automation?.queueLength ?? 0} queued
          </span>
        </div>
        <History records={automation?.history ?? []} />
        {automation?.lastError && (
          <p className="pt-1 text-[11px] text-muted">Last failure: {automation.lastError}</p>
        )}
      </section>
    </div>
  );
}
