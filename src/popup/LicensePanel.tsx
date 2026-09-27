import { useId, useState } from 'react';
import { LICENSE_CODE_PATTERN, normalizeLicenseCode, type LicenseState } from '@/core/license';
import type { LicenseView } from './use-license';

const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ok';

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

const TONE: Record<LicenseState['status'], string> = {
  ACTIVE: 'bg-ok text-paper',
  EXPIRED: 'bg-fail text-paper',
  DISABLED: 'bg-fail text-paper',
  SUSPENDED: 'bg-wait text-paper',
  REVOKED: 'bg-fail text-paper',
  UNREGISTERED: 'border border-muted text-muted',
  NETWORK_ERROR: 'bg-wait text-paper',
};

/** Shown on every tab while the license is not usable. */
export function LicenseBanner({ state, onOpen }: { state: LicenseState; onOpen: () => void }) {
  if (state.status === 'ACTIVE') return null;
  return (
    <div role="alert" className="flex items-center gap-2 border-b border-fail bg-surface px-4 py-2">
      <span className="min-w-0 flex-1 text-[12px]">
        <strong className="font-semibold">Locked.</strong> {state.message ?? 'License not active.'}{' '}
        Scanning and Auto-Click are off.
      </span>
      <button
        type="button"
        onClick={onOpen}
        className={`shrink-0 rounded-md border border-rule px-2 py-1 text-[12px] font-medium ${focusRing}`}
      >
        License
      </button>
    </div>
  );
}

export function LicensePanel({ view }: { view: LicenseView }) {
  const { state } = view;
  const [code, setCode] = useState('');
  const inputId = useId();
  const normalized = normalizeLicenseCode(code);
  const valid = LICENSE_CODE_PATTERN.test(normalized);
  const activated = state.status !== 'UNREGISTERED';

  return (
    <div className="px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[14px] font-semibold">License</h2>
        <span
          className={`rounded px-2 py-0.5 text-[11px] font-semibold tracking-wide ${TONE[state.status]}`}
        >
          {state.status === 'NETWORK_ERROR' ? 'LICENSE VALIDATION REQUIRED' : state.status}
          {state.status === 'ACTIVE' && state.offline ? ' · OFFLINE' : ''}
        </span>
      </div>
      <p role="status" className="pt-2 text-[12px]">
        {state.message}
      </p>

      <dl className="mt-3 grid grid-cols-[1fr_auto] gap-y-1 text-[12px]">
        {state.codeHint && (
          <>
            <dt className="text-muted">Code</dt>
            <dd className="text-right font-mono">IMS-••••-••••-{state.codeHint}</dd>
          </>
        )}
        {state.customer && (
          <>
            <dt className="text-muted">Customer</dt>
            <dd className="text-right">{state.customer}</dd>
          </>
        )}
        {state.plan && (
          <>
            <dt className="text-muted">Plan</dt>
            <dd className="text-right">{state.plan}</dd>
          </>
        )}
        {state.expiresAt !== null && (
          <>
            <dt className="text-muted">Expires</dt>
            <dd className="text-right">{date.format(state.expiresAt)}</dd>
          </>
        )}
        <dt className="text-muted">Last verified</dt>
        <dd className="text-right">
          {state.verifiedAtLocal === null ? 'Never' : dateTime.format(state.verifiedAtLocal)}
        </dd>
        {state.offline && state.graceUntilLocal !== null && (
          <>
            <dt className="text-muted">Offline until</dt>
            <dd className="text-right">{dateTime.format(state.graceUntilLocal)}</dd>
          </>
        )}
      </dl>

      {!activated || state.status === 'REVOKED' ? (
        <form
          className="mt-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) view.activate(normalized);
          }}
        >
          <label htmlFor={inputId} className="block text-[12px] font-medium">
            License Code
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id={inputId}
              value={code}
              onChange={(e) => setCode(e.currentTarget.value)}
              placeholder="IMS-XXXX-XXXX-XXXX"
              autoComplete="off"
              spellCheck={false}
              maxLength={24}
              className={`min-w-0 flex-1 rounded-md border border-rule bg-surface px-2 py-1.5 font-mono text-[13px] uppercase ${focusRing}`}
            />
            <button
              type="submit"
              disabled={!valid || view.busy}
              className={`rounded-md bg-ink px-3 py-1.5 text-[13px] font-medium text-paper disabled:opacity-40 ${focusRing}`}
            >
              Activate
            </button>
          </div>
          {code.length > 0 && !valid && (
            <p className="pt-1 text-[11px] text-muted">Format: IMS-XXXX-XXXX-XXXX</p>
          )}
        </form>
      ) : (
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={view.refresh}
            disabled={view.busy}
            className={`rounded-md border border-rule px-3 py-1.5 text-[12px] font-medium disabled:opacity-40 ${focusRing}`}
          >
            Check now
          </button>
          <button
            type="button"
            onClick={view.deactivate}
            disabled={view.busy}
            className={`rounded-md px-3 py-1.5 text-[12px] text-muted hover:text-fail disabled:opacity-40 ${focusRing}`}
          >
            Remove from this browser
          </button>
        </div>
      )}
      {view.error && (
        <p role="alert" className="pt-2 text-[12px] text-fail">
          {view.error}
        </p>
      )}
    </div>
  );
}
