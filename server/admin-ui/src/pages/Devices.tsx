import { useState } from 'react';
import { ApiError, api } from '../api';
import { useToast } from '../components/toast';
import {
  Button,
  Card,
  ConfirmDialog,
  Pagination,
  StateRow,
  StatusBadge,
  inputClass,
  td,
  th,
} from '../components/ui';
import { dateTime, maskedCode } from '../format';
import { useDebounced, useLoad } from '../hooks';
import { navigate } from '../router';

export function DevicesPage() {
  const toast = useToast();
  const [status, setStatus] = useState<'ALL' | 'ACTIVE' | 'RELEASED'>('ACTIVE');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const search = useDebounced(query);
  const list = useLoad(
    () =>
      api.devices({
        status: status === 'ALL' ? undefined : status,
        query: search,
        page,
        pageSize: 25,
      }),
    [status, search, page],
  );
  const [resetting, setResetting] = useState<string | null>(null);

  return (
    <Card
      title="Devices"
      actions={
        <div className="flex items-center gap-2">
          <select
            aria-label="Device status"
            value={status}
            onChange={(e) => {
              setStatus(e.currentTarget.value as typeof status);
              setPage(1);
            }}
            className={`${inputClass} w-36`}
          >
            <option value="ACTIVE">Active</option>
            <option value="RELEASED">Released</option>
            <option value="ALL">All</option>
          </select>
          <input
            type="search"
            aria-label="Search devices"
            placeholder="Customer, license, device…"
            value={query}
            onChange={(e) => {
              setQuery(e.currentTarget.value);
              setPage(1);
            }}
            className={`${inputClass} w-64`}
          />
        </div>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-rule">
              {[
                'Customer',
                'License',
                'Device ID',
                'Last seen',
                'Last validation',
                'Status',
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
              colSpan={7}
              loading={list.loading && !list.data}
              error={list.error}
              empty={list.data?.items.length === 0}
            />
            {list.data?.items.map((d) => (
              <tr key={d.id} className="border-b border-rule last:border-0">
                <td className={td}>{d.customer ?? '—'}</td>
                <td className={td}>
                  <button
                    className="font-mono text-xs text-accent hover:underline"
                    onClick={() => navigate(`/admin/licenses/${d.licenseId}`)}
                  >
                    {maskedCode(d.codeHint)}
                  </button>
                </td>
                <td
                  className={`${td} font-mono text-xs`}
                  title="Hashed and masked; the raw device id is never stored"
                >
                  {d.device}
                </td>
                <td className={td}>{dateTime(d.lastSeenAt)}</td>
                <td className={td}>{dateTime(d.lastValidationAt)}</td>
                <td className={td}>
                  <StatusBadge status={d.status} />
                </td>
                <td className={td}>
                  {d.status === 'ACTIVE' && (
                    <Button small onClick={() => setResetting(d.id)}>
                      Reset Device
                    </Button>
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
      {resetting && (
        <ConfirmDialog
          question="Reset this device?"
          confirmLabel="Confirm Reset Device"
          onCancel={() => setResetting(null)}
          onConfirm={() => {
            api
              .resetDevice(resetting)
              .then(() => {
                toast('success', 'Device reset. It must activate again.');
                list.reload();
              })
              .catch((e: unknown) =>
                toast('error', e instanceof ApiError ? e.message : 'Reset failed.'),
              )
              .finally(() => setResetting(null));
          }}
        >
          <p className="text-muted">
            Its token stops working at once; the customer must activate this browser again.
          </p>
        </ConfirmDialog>
      )}
    </Card>
  );
}
