// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, setUnauthorizedHandler } from './api';
import { LicenseActions } from './components/license-actions';
import { ToastProvider } from './components/toast';
import { actionsFor } from './format';
import { LicenseCodeDialog } from './pages/Licenses';
import { Login } from './pages/Login';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Call = { url: string; init: RequestInit };
let calls: Call[] = [];
let respond: (url: string, init: RequestInit) => Response;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  calls = [];
  respond = () => json({});
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      return Promise.resolve(respond(url, init));
    }),
  );
});

let host: HTMLDivElement;
afterEach(() => {
  host?.remove();
  vi.unstubAllGlobals();
});

async function render(ui: React.ReactElement) {
  host = document.createElement('div');
  document.body.append(host);
  await act(async () => {
    createRoot(host).render(<ToastProvider>{ui}</ToastProvider>);
    await Promise.resolve();
  });
}

const button = (text: string) =>
  Array.from(document.querySelectorAll('button')).find(
    (b) => b.textContent === text,
  ) as HTMLButtonElement;

function type(input: HTMLInputElement, value: string) {
  Reflect.set(HTMLInputElement.prototype, 'value', value, input);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

describe('login', () => {
  it('wrong key shows the server error; the key is never kept in browser storage', async () => {
    respond = () => json({ message: 'Invalid admin key.' }, 401);
    const onSignedIn = vi.fn();
    await render(<Login onSignedIn={onSignedIn} />);
    type(host.querySelector('input[type=password]') as HTMLInputElement, 'secret-key-value');
    await act(async () => {
      button('Sign in').click();
      await Promise.resolve();
    });
    await flush();
    expect(host.textContent).toContain('Invalid admin key.');
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain(
      'secret-key-value',
    );
  });

  it('right key → signed in; the field is cleared and writes carry the CSRF token', async () => {
    respond = (url) =>
      url.endsWith('/session') ? json({ csrfToken: 'csrf-123', expiresAt: 1 }) : json({});
    const onSignedIn = vi.fn();
    await render(<Login onSignedIn={onSignedIn} />);
    type(host.querySelector('input[type=password]') as HTMLInputElement, 'secret-key-value');
    await act(async () => {
      button('Sign in').click();
      await Promise.resolve();
    });
    await flush();
    expect(onSignedIn).toHaveBeenCalledWith(1);
    expect(localStorage.length + sessionStorage.length).toBe(0);
    await api.act('lic1', 'disable');
    const write = calls.at(-1) as Call;
    expect(write.url).toBe('/admin/api/licenses/lic1/disable');
    expect((write.init.headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf-123');
    expect(write.init.credentials).toBe('same-origin');
  });

  it('a 401 on any request signs the panel out', async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    respond = () => json({ message: 'Admin authentication required.' }, 401);
    await expect(api.dashboard()).rejects.toThrow('Admin authentication required.');
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });
});

describe('license actions', () => {
  it('offers actions by status', () => {
    expect(actionsFor('ACTIVE')).toEqual([
      'disable',
      'suspend',
      'extend',
      'revoke',
      'reset-device',
    ]);
    expect(actionsFor('DISABLED')).toContain('reactivate');
    expect(actionsFor('SUSPENDED')).toContain('reactivate');
    expect(actionsFor('EXPIRED')).toContain('extend');
    expect(actionsFor('REVOKED')).toEqual([]);
  });

  it('Disable asks "Disable this license?" → Cancel does nothing, Confirm Disable calls the API', async () => {
    const onDone = vi.fn();
    await render(
      <LicenseActions
        license={{ id: 'L1', effectiveStatus: 'ACTIVE', expiresAt: Date.now() + 1e9 }}
        onDone={onDone}
      />,
    );
    act(() => button('Disable').click());
    expect(document.body.textContent).toContain('Disable this license?');
    act(() => button('Cancel').click());
    expect(calls).toHaveLength(0);
    act(() => button('Disable').click());
    await act(async () => {
      button('Confirm Disable').click();
      await Promise.resolve();
    });
    await flush();
    expect(calls.at(-1)?.url).toBe('/admin/api/licenses/L1/disable');
    expect(onDone).toHaveBeenCalledOnce();
    expect(document.body.textContent).toContain('Disable done.');
  });

  it('Extend: +90 days sends {days: 90}; a past custom date cannot be confirmed', async () => {
    await render(
      <LicenseActions
        license={{ id: 'L2', effectiveStatus: 'ACTIVE', expiresAt: Date.now() + 1e9 }}
        onDone={vi.fn()}
      />,
    );
    act(() => button('Extend').click());
    const radios = Array.from(document.querySelectorAll<HTMLInputElement>('input[type=radio]'));
    act(() => {
      radios[3]?.click(); // custom
    });
    type(document.querySelector('input[type=date]') as HTMLInputElement, '2001-01-01');
    await flush();
    expect(button('Confirm Extend').disabled).toBe(true);
    act(() => {
      radios[1]?.click(); // +90
    });
    await act(async () => {
      button('Confirm Extend').click();
      await Promise.resolve();
    });
    await flush();
    const call = calls.at(-1)!;
    expect(call.url).toBe('/admin/api/licenses/L2/extend');
    expect(JSON.parse(call.init.body as string)).toEqual({ days: 90 });
  });

  it('a REVOKED license shows no actions', async () => {
    await render(
      <LicenseActions
        license={{ id: 'L3', effectiveStatus: 'REVOKED', expiresAt: 0 }}
        onDone={vi.fn()}
      />,
    );
    expect(host.textContent).toContain('No actions');
  });
});

describe('license code', () => {
  it('shown once with a warning that it cannot be retrieved later', async () => {
    await render(<LicenseCodeDialog code="IMS-AB12-CD34-EF56" onClose={vi.fn()} />);
    expect(document.querySelector('[data-testid=license-code]')?.textContent).toBe(
      'IMS-AB12-CD34-EF56',
    );
    expect(document.body.textContent).toContain('cannot be retrieved later');
  });
});
