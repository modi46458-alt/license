import { useEffect, useState, type ReactNode } from 'react';
import { api, setUnauthorizedHandler } from './api';
import { ToastProvider, useToast } from './components/toast';
import { Button } from './components/ui';
import { AuditPage } from './pages/Audit';
import { CustomersPage } from './pages/Customers';
import { DashboardPage } from './pages/Dashboard';
import { DevicesPage } from './pages/Devices';
import { LicenseDetailPage } from './pages/LicenseDetail';
import { LicensesPage } from './pages/Licenses';
import { Login } from './pages/Login';
import { SettingsPage } from './pages/Settings';
import { navigate, usePath } from './router';

const NAV = [
  ['/admin', 'Dashboard'],
  ['/admin/customers', 'Customers'],
  ['/admin/licenses', 'Licenses'],
  ['/admin/devices', 'Devices'],
  ['/admin/audit-logs', 'Audit Logs'],
  ['/admin/settings', 'Settings'],
] as const;

export function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}

function Shell() {
  const path = usePath();
  const toast = useToast();
  // null = checking the existing session; false = signed out.
  const [session, setSession] = useState<{ expiresAt: number } | false | null>(null);
  const [serverUp, setServerUp] = useState<boolean | null>(null);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setSession(false);
      toast('error', 'Your session ended. Please sign in again.');
    });
    void api.restore().then((s) => setSession(s ?? false));
  }, [toast]);

  useEffect(() => {
    const check = () => void api.health().then(setServerUp);
    check();
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (session === false && path !== '/admin/login') navigate('/admin/login');
    if (session && path === '/admin/login') navigate('/admin');
  }, [session, path]);

  if (session === null) return <p className="p-8 text-sm text-muted">Loading…</p>;
  if (session === false) return <Login onSignedIn={(expiresAt) => setSession({ expiresAt })} />;

  const detail = /^\/admin\/licenses\/([\w-]+)$/.exec(path)?.[1];
  let page: ReactNode;
  if (detail) page = <LicenseDetailPage id={detail} />;
  else if (path === '/admin/customers') page = <CustomersPage />;
  else if (path === '/admin/licenses') page = <LicensesPage />;
  else if (path === '/admin/devices') page = <DevicesPage />;
  else if (path === '/admin/audit-logs') page = <AuditPage />;
  else if (path === '/admin/settings')
    page = <SettingsPage sessionExpiresAt={session.expiresAt} serverUp={serverUp} />;
  else page = <DashboardPage />;

  const title = detail ? 'License' : (NAV.find(([href]) => href === path)?.[1] ?? 'Dashboard');
  const logout = () => {
    void api.logout().then(() => {
      setSession(false);
      toast('success', 'Signed out.');
    });
  };

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-56 shrink-0 flex-col bg-ink text-white md:flex">
        <div className="px-5 py-4">
          <p className="text-sm font-semibold">License Admin</p>
          <p className="text-xs text-white/60">Smart Lead Intelligence</p>
        </div>
        <nav aria-label="Main" className="flex flex-1 flex-col gap-0.5 px-2">
          {NAV.map(([href, label]) => (
            <a
              key={href}
              href={href}
              aria-current={
                path === href || (href === '/admin/licenses' && detail) ? 'page' : undefined
              }
              onClick={(e) => {
                e.preventDefault();
                navigate(href);
              }}
              className={`rounded-md px-3 py-2 text-sm ${path === href ? 'bg-white/15 font-medium' : 'text-white/75 hover:bg-white/10'}`}
            >
              {label}
            </a>
          ))}
          <button
            onClick={logout}
            className="mt-2 rounded-md px-3 py-2 text-left text-sm text-white/75 hover:bg-white/10"
          >
            Logout
          </button>
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-rule bg-surface px-6 py-3">
          <div className="flex items-center gap-3">
            <select
              aria-label="Navigate"
              className="rounded-md border border-rule px-2 py-1 text-sm md:hidden"
              value={detail ? '/admin/licenses' : path}
              onChange={(e) => navigate(e.currentTarget.value)}
            >
              {NAV.map(([href, label]) => (
                <option key={href} value={href}>
                  {label}
                </option>
              ))}
            </select>
            <h1 className="text-base font-semibold">{title}</h1>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="flex items-center gap-1.5 text-muted" role="status">
              <span
                className={`inline-block size-2 rounded-full ${serverUp ? 'bg-ok' : serverUp === false ? 'bg-bad' : 'bg-rule'}`}
              />
              {serverUp === false ? 'Server unreachable' : 'Server online'}
            </span>
            <span className="text-muted">Admin</span>
            <Button small onClick={logout}>
              Logout
            </Button>
          </div>
        </header>
        <main className="flex-1 p-6">{page}</main>
      </div>
    </div>
  );
}
