import { useState } from 'react';
import { ApiError, api } from '../api';
import { LicenseActions } from '../components/license-actions';
import { useToast } from '../components/toast';
import { Button, Card, ConfirmDialog, StatusBadge, td, th } from '../components/ui';
import { actionLabel, date, dateTime, maskedCode } from '../format';
import { useLoad } from '../hooks';
import { navigate } from '../router';

export function LicenseDetailPage({ id }: { id: string }) {
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => api.license(id), [id]);
  const [resetting, setResetting] = useState<string | null>(null);

  if (loading && !data) return <p className="text-muted">Loading…</p>;
  if (error || !data) return <p className="text-bad">{error ?? 'License not found.'}</p>;
  const { license, customer, devices, audit } = data;
  const active = devices.filter((d) => d.status === 'ACTIVE');

  const rows: Array<[string, React.ReactNode]> = [
    ['Status', <StatusBadge key="s" status={license.effectiveStatus} />],
    ['Customer', customer ? `${customer.name} (${customer.email})` : '—'],
    ['Plan', license.plan],
    ['Start date', date(license.startsAt)],
    ['Expiry date', date(license.expiresAt)],
    ['Max devices', license.maxDevices],
    ['Current devices', active.length],
    ['Last validation', dateTime(license.lastValidationAt)],
    ['Last seen', dateTime(license.lastSeenAt)],
    ['Created', dateTime(license.createdAt)],
    ['Updated', dateTime(license.updatedAt)],
  ];

  return (
    <div className="space-y-6">
      <Button kind="ghost" onClick={() => navigate('/admin/licenses')}>
        ← Licenses
      </Button>
      <Card
        title={maskedCode(license.codeHint)}
        actions={<LicenseActions license={license} onDone={reload} small={false} />}
      >
        <dl className="grid grid-cols-[10rem_1fr] gap-y-2 px-4 py-3 text-sm md:grid-cols-[10rem_1fr_10rem_1fr]">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <Card title="Devices">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-rule">
              {['Device', 'Status', 'Version', 'Last seen', 'Last validation', 'Actions'].map(
                (h) => (
                  <th key={h} className={th}>
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {devices.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-muted">
                  Not activated on any browser yet.
                </td>
              </tr>
            )}
            {devices.map((d) => (
              <tr key={d.id} className="border-b border-rule last:border-0">
                <td className={`${td} font-mono text-xs`}>{d.device}</td>
                <td className={td}>
                  <StatusBadge status={d.status} />
                </td>
                <td className={td}>{d.extensionVersion ?? '—'}</td>
                <td className={td}>{dateTime(d.lastSeenAt)}</td>
                <td className={td}>{dateTime(d.lastValidationAt)}</td>
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
      </Card>
      <Card title="History">
        <ul className="divide-y divide-rule text-sm">
          {audit.map((e, i) => (
            <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
              <span>
                <span className="font-medium">{actionLabel(e.action)}</span>
                {e.previousStatus && e.newStatus && e.previousStatus !== e.newStatus && (
                  <span className="text-muted">
                    {' '}
                    · {e.previousStatus} → {e.newStatus}
                  </span>
                )}
                {e.detail && <span className="text-muted"> · {e.detail}</span>}
              </span>
              <span className="text-xs text-muted">{dateTime(e.at)}</span>
            </li>
          ))}
        </ul>
      </Card>
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
                reload();
              })
              .catch((e: unknown) =>
                toast('error', e instanceof ApiError ? e.message : 'Reset failed.'),
              )
              .finally(() => setResetting(null));
          }}
        >
          <p className="text-muted">
            Its token stops working at once; the browser must be activated again with the license
            code.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
