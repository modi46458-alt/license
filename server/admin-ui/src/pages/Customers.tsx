import { useState } from 'react';
import { ApiError, api, type CustomerRow } from '../api';
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
import { CreateLicenseDialog, LicenseCodeDialog } from './Licenses';

const PAGE_SIZE = 25;

export function CustomersPage() {
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const search = useDebounced(query);
  const list = useLoad(
    () => api.customers({ query: search, page, pageSize: PAGE_SIZE }),
    [search, page],
  );
  const [editing, setEditing] = useState<CustomerRow | 'new' | null>(null);
  const [viewing, setViewing] = useState<CustomerRow | null>(null);
  const [licenseFor, setLicenseFor] = useState<CustomerRow | null>(null);
  const [newCode, setNewCode] = useState<string | null>(null);

  return (
    <Card
      title="Customers"
      actions={
        <div className="flex items-center gap-2">
          <input
            type="search"
            aria-label="Search customers"
            placeholder="Search name, email, company, license…"
            value={query}
            onChange={(e) => {
              setQuery(e.currentTarget.value);
              setPage(1);
            }}
            className={`${inputClass} w-72`}
          />
          <Button kind="primary" onClick={() => setEditing('new')}>
            Create Customer
          </Button>
        </div>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] text-sm">
          <thead>
            <tr className="border-b border-rule">
              {[
                'Customer',
                'Email',
                'Company',
                'License',
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
              colSpan={11}
              loading={list.loading && !list.data}
              error={list.error}
              empty={list.data?.items.length === 0}
            />
            {list.data?.items.map((c) => (
              <tr key={c.id} className="border-b border-rule last:border-0">
                <td className={`${td} font-medium`}>{c.name}</td>
                <td className={td}>{c.email}</td>
                <td className={td}>{c.company ?? '—'}</td>
                <td className={`${td} font-mono text-xs`}>
                  {c.license ? maskedCode(c.license.codeHint) : '—'}
                </td>
                <td className={td}>{c.license?.plan ?? '—'}</td>
                <td className={td}>{date(c.license?.startsAt)}</td>
                <td className={td}>{date(c.license?.expiresAt)}</td>
                <td className={td}>
                  {c.license ? <StatusBadge status={c.license.status} /> : '—'}
                </td>
                <td className={td}>{c.deviceCount}</td>
                <td className={td}>{dateTime(c.lastSeenAt)}</td>
                <td className={`${td} space-y-1.5`}>
                  <div className="flex flex-wrap gap-1.5">
                    <Button small onClick={() => setViewing(c)}>
                      View
                    </Button>
                    <Button small onClick={() => setEditing(c)}>
                      Edit
                    </Button>
                    {c.license ? (
                      <Button
                        small
                        onClick={() => navigate(`/admin/licenses/${c.license?.id ?? ''}`)}
                      >
                        View License
                      </Button>
                    ) : (
                      <Button small kind="primary" onClick={() => setLicenseFor(c)}>
                        Create License
                      </Button>
                    )}
                  </div>
                  {c.license && (
                    <LicenseActions
                      license={{
                        id: c.license.id,
                        effectiveStatus: c.license.status,
                        expiresAt: c.license.expiresAt,
                      }}
                      onDone={list.reload}
                    />
                  )}
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

      {editing && (
        <CustomerDialog
          customer={editing === 'new' ? null : editing}
          onCancel={() => setEditing(null)}
          onSaved={(saved, withLicense) => {
            setEditing(null);
            toast('success', editing === 'new' ? 'Customer created.' : 'Customer updated.');
            list.reload();
            if (withLicense) setLicenseFor(saved);
          }}
        />
      )}
      {viewing && (
        <Modal
          title={viewing.name}
          onClose={() => setViewing(null)}
          footer={<Button onClick={() => setViewing(null)}>Close</Button>}
        >
          <dl className="grid grid-cols-[8rem_1fr] gap-y-1.5">
            <dt className="text-muted">Email</dt>
            <dd>{viewing.email}</dd>
            <dt className="text-muted">Company</dt>
            <dd>{viewing.company ?? '—'}</dd>
            <dt className="text-muted">Phone</dt>
            <dd>{viewing.phone ?? '—'}</dd>
            <dt className="text-muted">Customer since</dt>
            <dd>{date(viewing.createdAt)}</dd>
            <dt className="text-muted">Licenses</dt>
            <dd>{viewing.licenseCount}</dd>
            <dt className="text-muted">Active devices</dt>
            <dd>{viewing.deviceCount}</dd>
          </dl>
        </Modal>
      )}
      {licenseFor && (
        <CreateLicenseDialog
          customer={licenseFor}
          onCancel={() => setLicenseFor(null)}
          onCreated={(code) => {
            setLicenseFor(null);
            setNewCode(code);
            list.reload();
          }}
        />
      )}
      {newCode && <LicenseCodeDialog code={newCode} onClose={() => setNewCode(null)} />}
    </Card>
  );
}

function CustomerDialog({
  customer,
  onCancel,
  onSaved,
}: {
  customer: CustomerRow | null;
  onCancel: () => void;
  onSaved: (customer: CustomerRow, withLicense: boolean) => void;
}) {
  const [form, setForm] = useState({
    name: customer?.name ?? '',
    email: customer?.email ?? '',
    company: customer?.company ?? '',
    phone: customer?.phone ?? '',
  });
  const [withLicense, setWithLicense] = useState(customer === null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: e.currentTarget.value });

  const save = () => {
    setBusy(true);
    setError(null);
    const request = customer ? api.updateCustomer(customer.id, form) : api.createCustomer(form);
    request
      .then((saved) => onSaved(saved, customer === null && withLicense))
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Could not save.'))
      .finally(() => setBusy(false));
  };

  return (
    <Modal
      title={customer ? 'Edit customer' : 'Create customer'}
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button kind="primary" onClick={save} disabled={busy || !form.name || !form.email}>
            {customer ? 'Save' : 'Create'}
          </Button>
        </>
      }
    >
      <form className="space-y-3" onSubmit={(e) => e.preventDefault()}>
        <Field label="Name">
          {(id) => (
            <input
              id={id}
              value={form.name}
              onChange={set('name')}
              className={inputClass}
              maxLength={120}
            />
          )}
        </Field>
        <Field label="Email">
          {(id) => (
            <input
              id={id}
              type="email"
              value={form.email}
              onChange={set('email')}
              className={inputClass}
              maxLength={200}
            />
          )}
        </Field>
        <Field label="Company">
          {(id) => (
            <input
              id={id}
              value={form.company}
              onChange={set('company')}
              className={inputClass}
              maxLength={120}
            />
          )}
        </Field>
        <Field label="Phone">
          {(id) => (
            <input
              id={id}
              value={form.phone}
              onChange={set('phone')}
              className={inputClass}
              maxLength={40}
            />
          )}
        </Field>
        {!customer && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={withLicense}
              onChange={(e) => setWithLicense(e.currentTarget.checked)}
            />
            Create a license (plan, dates, devices) next
          </label>
        )}
        {error && (
          <p role="alert" className="text-bad">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
