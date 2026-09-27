import { useState } from 'react';
import { ApiError, api, type AdminAction, type LicenseStatus } from '../api';
import { ACTION_TEXT, actionsFor, date } from '../format';
import { useToast } from './toast';
import { Button, ConfirmDialog, Field, Modal, inputClass } from './ui';

type Pending = { kind: AdminAction } | { kind: 'extend' } | null;

/** Status-aware license actions with confirmation; the server enforces the rules. */
export function LicenseActions({
  license,
  onDone,
  small = true,
}: {
  license: { id: string; effectiveStatus: LicenseStatus; expiresAt: number };
  onDone: () => void;
  small?: boolean;
}) {
  const toast = useToast();
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);

  const run = async (label: string, request: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await request();
      toast('success', `${label} done.`);
      setPending(null);
      onDone();
    } catch (error) {
      toast('error', error instanceof ApiError ? error.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  };

  const actions = actionsFor(license.effectiveStatus);
  if (actions.length === 0) return <span className="text-xs text-muted">No actions (revoked)</span>;

  return (
    <div className="flex flex-wrap gap-1.5">
      {actions.map((action) => (
        <Button
          key={action}
          small={small}
          kind={ACTION_TEXT[action].danger ? 'secondary' : 'primary'}
          onClick={() => setPending({ kind: action })}
        >
          {ACTION_TEXT[action].label}
        </Button>
      ))}
      {pending && pending.kind !== 'extend' && (
        <ConfirmDialog
          question={ACTION_TEXT[pending.kind].question}
          confirmLabel={`Confirm ${ACTION_TEXT[pending.kind].label}`}
          danger={ACTION_TEXT[pending.kind].danger}
          busy={busy}
          onCancel={() => setPending(null)}
          onConfirm={() =>
            void run(ACTION_TEXT[pending.kind].label, () => api.act(license.id, pending.kind))
          }
        />
      )}
      {pending?.kind === 'extend' && (
        <ExtendDialog
          expiresAt={license.expiresAt}
          busy={busy}
          onCancel={() => setPending(null)}
          onConfirm={(body) => void run('Extension', () => api.extend(license.id, body))}
        />
      )}
    </div>
  );
}

export function ExtendDialog({
  expiresAt,
  busy,
  onCancel,
  onConfirm,
}: {
  expiresAt: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (body: { days: 30 | 90 | 365 } | { expiresAt: number }) => void;
}) {
  const [choice, setChoice] = useState<30 | 90 | 365 | 'custom'>(30);
  const [custom, setCustom] = useState('');
  const [now] = useState(() => Date.now());
  const customMs = custom ? new Date(`${custom}T23:59:59`).getTime() : NaN;
  const valid = choice !== 'custom' || (Number.isFinite(customMs) && customMs > now);
  return (
    <Modal
      title="Extend license"
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button
            kind="primary"
            disabled={!valid || busy}
            onClick={() =>
              onConfirm(choice === 'custom' ? { expiresAt: customMs } : { days: choice })
            }
          >
            Confirm Extend
          </Button>
        </>
      }
    >
      <p className="mb-3 text-muted">
        Current expiry: {date(expiresAt)}. Quick options extend from the later of today and the
        current expiry.
      </p>
      <div role="radiogroup" aria-label="Extension" className="mb-3 flex flex-wrap gap-2">
        {([30, 90, 365, 'custom'] as const).map((option) => (
          <label
            key={option}
            className={`cursor-pointer rounded-md border px-3 py-1.5 text-sm ${choice === option ? 'border-accent bg-accent/5 font-medium' : 'border-rule'}`}
          >
            <input
              type="radio"
              name="extend"
              className="sr-only"
              checked={choice === option}
              onChange={() => setChoice(option)}
            />
            {option === 'custom' ? 'Custom date' : `+${option} days`}
          </label>
        ))}
      </div>
      {choice === 'custom' && (
        <Field label="New expiry date">
          {(id) => (
            <input
              id={id}
              type="date"
              value={custom}
              onChange={(e) => setCustom(e.currentTarget.value)}
              className={inputClass}
            />
          )}
        </Field>
      )}
    </Modal>
  );
}
