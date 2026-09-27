import { useState } from 'react';
import { ApiError, api, type LicenseStatus } from '../api';
import { LicenseActions } from '../components/license-actions';
import { useToast } from '../components/toast';
import {
  Button,
  Card,
  Field,
  Modal,
  Pagination,
  StateRow,
  StatusBadge,
  inputClass,
  td,
  th,
} from '../components/ui';
import { date, dateTime, maskedCode } from '../format';
import { useDebounced, useLoad } from '../hooks';
import { navigate } from '../router';

const FILTERS: Array<'ALL' | LicenseStatus> = [
  'ALL',
  'ACTIVE',
  'EXPIRED',
  'DISABLED',
  'SUSPENDED',
  'REVOKED',
];
const DAY = 86_400_000;
const toInput = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function LicensesPage() {
  const toast = useToast();
  const [status, setStatus] = useState<(typeof FILTERS)[number]>('ALL');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const search = useDebounced(query);
  const list = useLoad(
    () => api.licenses({ status, query: search, page, pageSize: 25 }),
    [status, search, page],
  );
  const [creating, setCreating] = useState(false);
  const [newCode, setNewCode] = useState<string | null>(null);

  return (
    <Card
      title="Licenses"
      actions={
        <div className="flex items-center gap-2">
          <input
            type="search"
            aria-label="Search licenses"
            placeholder="Search customer, email, code, plan…"
            value={query}
            onChange={(e) => {
              setQuery(e.currentTarget.value);
              setPage(1);
            }}
            className={`${inputClass} w-64`}
          />
          <Button kind="primary" onClick={() => setCreating(true)}>
            Create License
          </Button>
        </div>
      }
    >
      <div
        role="tablist"
        aria-label="Status filter"
        className="flex flex-wrap gap-1 border-b border-rule px-4 py-2"
      >
        {FILTERS.map((f) => (
          <button
            key={f}
            role="tab"
            aria-selected={status === f}
            onClick={() => {
              setStatus(f);
              setPage(1);
            }}
            className={`rounded px-2.5 py-1 text-xs font-semibold ${status === f ? 'bg-ink text-white' : 'text-muted hover:text-ink'}`}
          >
            {f}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1000px] text-sm">
          <thead>
            <tr className="border-b border-rule">
              {[
                'License',
                'Customer',
                'Plan',
                'Start',
                'Expiry',
                'Status',
                'Devices',
                'Last seen',
                'Actions',
              ].map((h) => (
                <th key={h} className={th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <StateRow
              colSpan={9}
              loading={list.loading && !list.data}
              error={list.error}
              empty={list.data?.items.length === 0}
            />
            {list.data?.items.map((l) => (
              <tr key={l.id} className="border-b border-rule last:border-0">
                <td className={td}>
                  <a
                    href={`/admin/licenses/${l.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      navigate(`/admin/licenses/${l.id}`);
                    }}
                    className="font-mono text-xs text-accent hover:underline"
                  >
                    {maskedCode(l.codeHint)}
                  </a>
                </td>
                <td className={td}>
                  {l.customer ?? '—'}
                  <div className="text-xs text-muted">{l.email}</div>
                </td>
                <td className={td}>{l.plan}</td>
                <td className={td}>{date(l.startsAt)}</td>
                <td className={td}>{date(l.expiresAt)}</td>
                <td className={td}>
                  <StatusBadge status={l.effectiveStatus} />
                </td>
                <td className={td}>
                  {l.activeDevices} / {l.maxDevices}
                </td>
                <td className={td}>{dateTime(l.lastSeenAt)}</td>
                <td className={td}>
                  <LicenseActions license={l} onDone={list.reload} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.data && (
        <Pagination
          page={list.data.page}
          pageSize={list.data.pageSize}
          total={list.data.total}
          onPage={setPage}
        />
      )}
      {creating && (
        <CreateLicenseDialog
          customer={null}
          onCancel={() => setCreating(false)}
          onCreated={(code) => {
            setCreating(false);
            setNewCode(code);
            toast('success', 'License created.');
            list.reload();
          }}
        />
      )}
      {newCode && <LicenseCodeDialog code={newCode} onClose={() => setNewCode(null)} />}
    </Card>
  );
}

/** Create a license for a customer (picked here when not given). */
export function CreateLicenseDialog({
  customer,
  onCancel,
  onCreated,
}: {
  customer: { id: string; name: string } | null;
  onCancel: () => void;
  onCreated: (code: string) => void;
}) {
  const [today] = useState(() => Date.now());
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerId, setCustomerId] = useState(customer?.id ?? '');
  const lookup = useDebounced(customerQuery);
  const options = useLoad(
    () => (customer ? Promise.resolve(null) : api.customers({ query: lookup, pageSize: 20 })),
    [lookup, customer],
  );
  const [plan, setPlan] = useState('Standard');
  const [start, setStart] = useState(toInput(today));
  const [expiry, setExpiry] = useState(toInput(today + 30 * DAY));
  const [maxDevices, setMaxDevices] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const startsAt = new Date(`${start}T00:00:00`).getTime();
  const expiresAt = new Date(`${expiry}T23:59:59`).getTime();
  const valid =
    customerId &&
    plan.trim() &&
    Number.isFinite(startsAt) &&
    expiresAt > startsAt &&
    maxDevices >= 1;

  const create = () => {
    setBusy(true);
    setError(null);
    api
      .createLicense({ customerId, plan: plan.trim(), startsAt, expiresAt, maxDevices })
      .then((r) => onCreated(r.code))
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.message : 'Could not create the license.'),
      )
      .finally(() => setBusy(false));
  };

  return (
    <Modal
      title={customer ? `New license for ${customer.name}` : 'Create license'}
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button kind="primary" onClick={create} disabled={!valid || busy}>
            Create License
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {!customer && (
          <>
            <Field label="Find customer">
              {(id) => (
                <input
                  id={id}
                  type="search"
                  value={customerQuery}
                  onChange={(e) => setCustomerQuery(e.currentTarget.value)}
                  placeholder="Name or email"
                  className={inputClass}
                />
              )}
            </Field>
            <Field label="Customer">
              {(id) => (
                <select
                  id={id}
                  value={customerId}
                  onChange={(e) => setCustomerId(e.currentTarget.value)}
                  className={inputClass}
                >
                  <option value="">Select a customer…</option>
                  {options.data?.items.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.email})
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </>
        )}
        <Field label="Plan">
          {(id) => (
            <input
              id={id}
              value={plan}
              onChange={(e) => setPlan(e.currentTarget.value)}
              className={inputClass}
              maxLength={60}
            />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start date">
            {(id) => (
              <input
                id={id}
                type="date"
                value={start}
                onChange={(e) => setStart(e.currentTarget.value)}
                className={inputClass}
              />
            )}
          </Field>
          <Field label="Expiry date">
            {(id) => (
              <input
                id={id}
                type="date"
                value={expiry}
                onChange={(e) => setExpiry(e.currentTarget.value)}
                className={inputClass}
              />
            )}
          </Field>
        </div>
        <Field label="Max devices">
          {(id) => (
            <input
              id={id}
              type="number"
              min={1}
              max={20}
              value={maxDevices}
              onChange={(e) => setMaxDevices(Number(e.currentTarget.value))}
              className={inputClass}
            />
          )}
        </Field>
        {error && (
          <p role="alert" className="text-bad">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

/** The raw code, shown exactly once (only its hash is stored). */
export function LicenseCodeDialog({ code, onClose }: { code: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Modal
      title="License created"
      onClose={onClose}
      footer={
        <Button kind="primary" onClick={onClose}>
          I have saved the code
        </Button>
      }
    >
      <p className="mb-3 text-muted">
        Give this code to the customer. It is shown only now and cannot be retrieved later.
      </p>
      <div className="flex items-center gap-2">
        <code
          data-testid="license-code"
          className="flex-1 rounded-md border border-rule bg-paper px-3 py-2 font-mono text-base tracking-wider select-all"
        >
          {code}
        </code>
        <Button
          onClick={() => {
            void navigator.clipboard?.writeText(code).then(() => setCopied(true));
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </Modal>
  );
}
