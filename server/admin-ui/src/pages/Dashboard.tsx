import { api } from '../api';
import { Card, StatusBadge, td, th } from '../components/ui';
import { actionLabel, date, dateTime, maskedCode } from '../format';
import { useLoad } from '../hooks';
import { navigate } from '../router';

const CARDS = [
  ['CUSTOMERS', 'Total Customers'],
  ['TOTAL', 'Total Licenses'],
  ['ACTIVE', 'Active Licenses'],
  ['EXPIRED', 'Expired Licenses'],
  ['DISABLED', 'Disabled Licenses'],
  ['SUSPENDED', 'Suspended Licenses'],
  ['REVOKED', 'Revoked Licenses'],
  ['EXPIRING_SOON', 'Expiring Soon (7 days)'],
  ['ACTIVE_DEVICES', 'Active Devices'],
] as const;

export function DashboardPage() {
  const { data, error, loading } = useLoad(() => api.dashboard(), []);
  if (error) return <p className="text-bad">{error}</p>;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {CARDS.map(([key, label]) => (
          <div key={key} className="rounded-lg border border-rule bg-surface px-4 py-3">
            <p className="text-xs text-muted">{label}</p>
            <p className="mt-1 text-2xl font-semibold">
              {loading || !data ? '…' : data.stats[key]}
            </p>
          </div>
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Expiry warnings">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-rule">
                <th className={th}>License</th>
                <th className={th}>Customer</th>
                <th className={th}>Expires</th>
              </tr>
            </thead>
            <tbody>
              {data?.expiring.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-muted">
                    No license expires within 7 days.
                  </td>
                </tr>
              )}
              {data?.expiring.map((l) => (
                <tr
                  key={l.id}
                  className="cursor-pointer border-b border-rule last:border-0 hover:bg-paper"
                  onClick={() => navigate(`/admin/licenses/${l.id}`)}
                >
                  <td className={`${td} font-mono text-xs`}>{maskedCode(l.codeHint)}</td>
                  <td className={td}>{l.customer ?? '—'}</td>
                  <td className={`${td} text-warn`}>{date(l.expiresAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Recent activity">
          <ul className="divide-y divide-rule text-sm">
            {data?.recent.length === 0 && (
              <li className="px-4 py-6 text-center text-muted">No activity yet.</li>
            )}
            {data?.recent.map((e, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-4 py-2">
                <span>
                  <span className="font-medium">{actionLabel(e.action)}</span>
                  {e.customer && <span className="text-muted"> · {e.customer}</span>}
                </span>
                <span className="flex items-center gap-2 text-xs text-muted">
                  <StatusBadge status={e.result} />
                  {dateTime(e.at)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
