import { useState } from 'react';
import { api } from '../api';
import { Card, Pagination, StateRow, StatusBadge, inputClass, td, th } from '../components/ui';
import { actionLabel, dateTime } from '../format';
import { useLoad } from '../hooks';
import { navigate } from '../router';

const ACTIONS = [
  'LICENSE_CREATED',
  'LICENSE_DISABLED',
  'LICENSE_SUSPENDED',
  'LICENSE_REACTIVATED',
  'LICENSE_REVOKED',
  'LICENSE_EXTENDED',
  'DEVICE_RESET',
  'LICENSE_ACTIVATED',
  'ACTIVATION_REFUSED',
  'CUSTOMER_CREATED',
  'CUSTOMER_UPDATED',
  'ADMIN_LOGIN',
  'ADMIN_LOGIN_FAILED',
  'ADMIN_LOGOUT',
];

export function AuditPage() {
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const list = useLoad(
    () => api.audit({ action: action || undefined, page, pageSize: 50 }),
    [action, page],
  );
  return (
    <Card
      title="Audit Logs"
      actions={
        <select
          aria-label="Action filter"
          value={action}
          onChange={(e) => {
            setAction(e.currentTarget.value);
            setPage(1);
          }}
          className={`${inputClass} w-56`}
        >
          <option value="">All actions</option>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1000px] text-sm">
          <thead>
            <tr className="border-b border-rule">
              {[
                'Timestamp',
                'By',
                'Customer',
                'License',
                'Action',
                'Previous → New',
                'IP',
                'Result',
                'Detail',
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
            {list.data?.items.map((e, i) => (
              <tr key={i} className="border-b border-rule last:border-0">
                <td className={`${td} whitespace-nowrap`}>{dateTime(e.at)}</td>
                <td className={td}>{e.actor}</td>
                <td className={td}>{e.customer ?? '—'}</td>
                <td className={td}>
                  {e.licenseId ? (
                    <button
                      className="font-mono text-xs text-accent hover:underline"
                      onClick={() => navigate(`/admin/licenses/${e.licenseId ?? ''}`)}
                    >
                      {e.licenseId.slice(0, 8)}…
                    </button>
                  ) : (
                    '—'
                  )}
                </td>
                <td className={td}>
                  <span className="font-mono text-xs">{e.action}</span>
                  <div className="text-xs text-muted">{actionLabel(e.action)}</div>
                </td>
                <td className={td}>
                  {e.previousStatus || e.newStatus
                    ? `${e.previousStatus ?? '—'} → ${e.newStatus ?? '—'}`
                    : '—'}
                </td>
                <td className={`${td} font-mono text-xs`}>{e.ip ?? '—'}</td>
                <td className={td}>
                  <StatusBadge status={e.result} />
                </td>
                <td className={`${td} text-muted`}>{e.detail ?? ''}</td>
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
    </Card>
  );
}
