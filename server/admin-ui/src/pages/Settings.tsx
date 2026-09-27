import { Card } from '../components/ui';
import { dateTime } from '../format';

export function SettingsPage({
  sessionExpiresAt,
  serverUp,
}: {
  sessionExpiresAt: number | null;
  serverUp: boolean | null;
}) {
  return (
    <Card title="Settings">
      <dl className="grid grid-cols-[14rem_1fr] gap-y-2 px-4 py-3 text-sm">
        <dt className="text-muted">License server</dt>
        <dd>{serverUp === null ? 'Checking…' : serverUp ? 'Online' : 'Unreachable'}</dd>
        <dt className="text-muted">This session ends</dt>
        <dd>{dateTime(sessionExpiresAt)} (or after 30 minutes without activity)</dd>
        <dt className="text-muted">Admin key</dt>
        <dd>
          Set on the server as a SHA-256 hash (ADMIN_API_KEY_SHA256). Rotate it with npm run
          admin:key and a restart; the panel never stores it.
        </dd>
        <dt className="text-muted">Extension offline grace</dt>
        <dd>24 hours after the last successful validation</dd>
        <dt className="text-muted">Extension validation</dt>
        <dd>Every 5 minutes, plus real-time push of admin changes</dd>
      </dl>
    </Card>
  );
}
