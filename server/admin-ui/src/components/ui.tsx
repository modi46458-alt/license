import { useEffect, useId, useRef, type ReactNode } from 'react';

export const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export function Button({
  children,
  onClick,
  kind = 'secondary',
  type = 'button',
  disabled = false,
  small = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: 'primary' | 'secondary' | 'danger' | 'ghost';
  type?: 'button' | 'submit';
  disabled?: boolean;
  small?: boolean;
}) {
  const look = {
    primary: 'bg-accent text-white hover:bg-accent/90',
    secondary: 'border border-rule bg-surface hover:border-muted',
    danger: 'bg-bad text-white hover:bg-bad/90',
    ghost: 'text-muted hover:text-ink',
  }[kind];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md ${small ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'} font-medium disabled:opacity-40 ${look} ${focusRing}`}
    >
      {children}
    </button>
  );
}

const STATUS_TONE: Record<string, string> = {
  ACTIVE: 'bg-ok/10 text-ok ring-ok/30',
  EXPIRED: 'bg-warn/10 text-warn ring-warn/30',
  DISABLED: 'bg-bad/10 text-bad ring-bad/30',
  SUSPENDED: 'bg-warn/10 text-warn ring-warn/30',
  REVOKED: 'bg-ink/10 text-ink ring-ink/30',
  RELEASED: 'bg-ink/5 text-muted ring-rule',
  SUCCESS: 'bg-ok/10 text-ok ring-ok/30',
  FAILURE: 'bg-bad/10 text-bad ring-bad/30',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-[11px] font-semibold tracking-wide ring-1 ${STATUS_TONE[status] ?? 'bg-paper text-muted ring-rule'}`}
    >
      {status}
    </span>
  );
}

export function Modal({
  title,
  children,
  onClose,
  footer,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>('input, select, button')?.focus();
  }, []);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-ink/40 p-4 pt-[10vh]"
    >
      <div
        ref={panel}
        className={`w-full ${wide ? 'max-w-2xl' : 'max-w-md'} rounded-lg bg-surface shadow-xl`}
      >
        <h2 id={titleId} className="border-b border-rule px-5 py-3 text-base font-semibold">
          {title}
        </h2>
        <div className="px-5 py-4 text-sm">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-rule px-5 py-3">{footer}</div>
        )}
      </div>
    </div>
  );
}

/** Confirmation for destructive actions: "Disable this license?" → Cancel / Confirm Disable. */
export function ConfirmDialog({
  question,
  confirmLabel,
  danger = true,
  busy = false,
  onCancel,
  onConfirm,
  children,
}: {
  question: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  return (
    <Modal
      title={question}
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button kind={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children ?? (
        <p className="text-muted">
          The change applies immediately and is recorded in the audit log.
        </p>
      )}
    </Modal>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: (id: string) => ReactNode;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs font-medium text-muted">
        {label}
      </label>
      {children(id)}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

export const inputClass = `w-full rounded-md border border-rule bg-surface px-2.5 py-1.5 text-sm ${focusRing}`;

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between gap-2 px-4 py-2 text-xs text-muted">
      <span>
        {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-2">
        <Button small onClick={() => onPage(page - 1)} disabled={page <= 1}>
          Previous
        </Button>
        <span>
          Page {page} of {pages}
        </span>
        <Button small onClick={() => onPage(page + 1)} disabled={page >= pages}>
          Next
        </Button>
      </div>
    </div>
  );
}

export function Card({
  title,
  actions,
  children,
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-rule bg-surface">
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-rule px-4 py-2.5">
          {title && <h2 className="text-sm font-semibold">{title}</h2>}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

/** Loading / error / empty states for tables and panels. */
export function StateRow({
  colSpan,
  loading,
  error,
  empty,
}: {
  colSpan: number;
  loading: boolean;
  error: string | null;
  empty: boolean;
}) {
  if (!loading && !error && !empty) return null;
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-muted">
        {loading ? (
          'Loading…'
        ) : error ? (
          <span className="text-bad">{error}</span>
        ) : (
          'Nothing here yet.'
        )}
      </td>
    </tr>
  );
}

export const th =
  'px-4 py-2 text-left text-[11px] font-semibold tracking-wide text-muted uppercase';
export const td = 'px-4 py-2 align-top';
