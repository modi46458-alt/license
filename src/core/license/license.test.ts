import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_GRACE_MS,
  INITIAL_LICENSE_STATE,
  LicenseClient,
  LicenseError,
  LicenseGate,
  fromServer,
  isUsable,
  licenseStateFromStorage,
  loadLicenseRecord,
  normalizeLicenseCode,
  onNetworkFailure,
  parsePushMessage,
  parseServerLicense,
  type LicenseState,
  type ServerLicenseResponse,
  type ServerLicenseStatus,
} from './index';

const DAY = 86_400_000;
const T0 = 1_800_000_000_000; // server time
const L0 = 1_700_000_000_000; // local clock (deliberately different)

const server = (
  status: ServerLicenseStatus,
  over: Partial<ServerLicenseResponse> = {},
): ServerLicenseResponse => ({
  status,
  expiresAt: T0 + 30 * DAY,
  serverTime: T0,
  plan: 'Pro',
  customer: 'Acme Pharma',
  codeHint: 'AB12',
  ...over,
});

const active = (): LicenseState => fromServer(INITIAL_LICENSE_STATE, server('ACTIVE'), L0);

describe('license state', () => {
  it('starts UNREGISTERED and unusable', () => {
    expect(INITIAL_LICENSE_STATE.status).toBe('UNREGISTERED');
    expect(isUsable(INITIAL_LICENSE_STATE, L0)).toBe(false);
  });

  it.each<ServerLicenseStatus>([
    'ACTIVE',
    'EXPIRED',
    'DISABLED',
    'SUSPENDED',
    'REVOKED',
    'UNREGISTERED',
  ])('server says %s → only ACTIVE is usable', (status) => {
    const state = fromServer(INITIAL_LICENSE_STATE, server(status), L0);
    expect(state.status).toBe(status);
    expect(isUsable(state, L0)).toBe(status === 'ACTIVE');
  });

  it('an ACTIVE answer past its own expiry is treated as EXPIRED (server time, not local)', () => {
    const state = fromServer(INITIAL_LICENSE_STATE, server('ACTIVE', { expiresAt: T0 - 1 }), L0);
    expect(state.status).toBe('EXPIRED');
    // A local clock far in the past does not help.
    expect(isUsable(state, 0)).toBe(false);
  });

  it('expiry is reached by elapsed time since the last server answer, never by the raw local clock', () => {
    const state = fromServer(
      INITIAL_LICENSE_STATE,
      server('ACTIVE', { expiresAt: T0 + 60_000 }),
      L0,
    );
    expect(isUsable(state, L0 + 59_000)).toBe(true);
    expect(isUsable(state, L0 + 60_000)).toBe(false);
  });

  it('offline: usable within the 24 h grace, locked (NETWORK_ERROR) after it', () => {
    const s = active();
    const inGrace = onNetworkFailure(s, L0 + 23 * 3_600_000);
    expect(inGrace).toMatchObject({ status: 'ACTIVE', offline: true });
    expect(isUsable(inGrace, L0 + 23 * 3_600_000)).toBe(true);
    const after = onNetworkFailure(s, L0 + DEFAULT_GRACE_MS + 1);
    expect(after.status).toBe('NETWORK_ERROR');
    expect(isUsable(after, L0 + DEFAULT_GRACE_MS + 1)).toBe(false);
  });

  it('offline never extends past expiry', () => {
    const s = fromServer(
      INITIAL_LICENSE_STATE,
      server('ACTIVE', { expiresAt: T0 + 3_600_000 }),
      L0,
    );
    expect(onNetworkFailure(s, L0 + 2 * 3_600_000).status).toBe('EXPIRED');
  });

  it('a clock turned back more than a minute voids the cached answer', () => {
    expect(isUsable(active(), L0 - 5 * 60_000)).toBe(false);
    expect(isUsable(active(), L0 - 30_000)).toBe(true);
  });

  it('network failure does not change a non-active status', () => {
    const disabled = fromServer(INITIAL_LICENSE_STATE, server('DISABLED'), L0);
    expect(onNetworkFailure(disabled, L0 + 1).status).toBe('DISABLED');
  });
});

describe('gate', () => {
  it('isLicenseActive / requireActiveLicense / subscribe', () => {
    let now = L0;
    const gate = new LicenseGate(() => now);
    const seen: boolean[] = [];
    gate.subscribe((a) => seen.push(a));
    expect(gate.isLicenseActive()).toBe(false);
    expect(() => gate.requireActiveLicense()).toThrow(LicenseError);
    gate.update(active());
    expect(gate.isLicenseActive()).toBe(true);
    expect(() => gate.requireActiveLicense()).not.toThrow();
    gate.update(fromServer(active(), server('DISABLED'), now));
    expect(gate.isLicenseActive()).toBe(false);
    gate.update(fromServer(active(), server('ACTIVE'), now));
    now += DEFAULT_GRACE_MS + 1; // no validation for over a day
    gate.recheck();
    expect(gate.isLicenseActive()).toBe(false);
    expect(gate.getLicenseState().status).toBe('NETWORK_ERROR');
    expect(seen).toEqual([true, false, true, false]);
  });
});

describe('parsing', () => {
  it('accepts a well-formed server answer and rejects anything else', () => {
    expect(parseServerLicense(server('ACTIVE'))).toEqual(server('ACTIVE'));
    for (const bad of [
      null,
      {},
      { ...server('ACTIVE'), status: 'LIFETIME' },
      { ...server('ACTIVE'), serverTime: 'now' },
      { ...server('ACTIVE'), token: 'short' },
    ]) {
      expect(parseServerLicense(bad)).toBeNull();
    }
  });

  it('push messages', () => {
    expect(
      parsePushMessage(JSON.stringify({ type: 'LICENSE_STATUS', license: server('DISABLED') })),
    ).toEqual({
      type: 'LICENSE_STATUS',
      license: server('DISABLED'),
    });
    expect(parsePushMessage('{not json')).toBeNull();
    expect(parsePushMessage({ type: 'EVAL', code: 'x' })).toBeNull();
  });

  it('storage record: never contains the raw code; corrupt → fresh UNREGISTERED record', async () => {
    const data: Record<string, unknown> = { 'license.record': 'garbage' };
    const area = {
      get: (k: string) => Promise.resolve({ [k]: data[k] }),
      set: (items: Record<string, unknown>) => (Object.assign(data, items), Promise.resolve()),
    };
    const record = await loadLicenseRecord(area, () => 'device-1234-5678');
    expect(record).toMatchObject({
      token: null,
      deviceId: 'device-1234-5678',
      state: { status: 'UNREGISTERED' },
    });
    expect(JSON.stringify(data)).not.toMatch(/IMS-/);
    expect(licenseStateFromStorage(undefined).status).toBe('UNREGISTERED');
  });
});

describe('client', () => {
  const ok = (body: unknown, status = 200) =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

  it('normalizes and validates the code before any request', async () => {
    const fetchFn = vi.fn(() => ok(server('ACTIVE', { token: 't'.repeat(43) })));
    const client = new LicenseClient({ baseUrl: 'https://lic.test', fetch: fetchFn });
    expect(normalizeLicenseCode(' ims-ab12-cd34-ef56 ')).toBe('IMS-AB12-CD34-EF56');
    await expect(client.activate('not a code', 'dev', '0.6.1')).rejects.toMatchObject({
      code: 'INVALID_CODE',
    });
    expect(fetchFn).not.toHaveBeenCalled();
    await client.activate('ims-ab12-cd34-ef56', 'dev', '0.6.1');
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://lic.test/api/license/activate');
    expect(JSON.parse(init.body as string)).toEqual({
      licenseCode: 'IMS-AB12-CD34-EF56',
      deviceId: 'dev',
      extensionVersion: '0.6.1',
    });
  });

  it('maps failures: network, 5xx, 429, 409 device mismatch', async () => {
    const make = (impl: () => Promise<Response>) =>
      new LicenseClient({ baseUrl: 'https://lic.test', fetch: vi.fn(impl) });
    await expect(
      make(() => Promise.reject(new TypeError('offline'))).validate('t', 'd', 'v'),
    ).rejects.toMatchObject({ code: 'NETWORK' });
    await expect(
      make(() => ok({ message: 'boom' }, 503)).validate('t', 'd', 'v'),
    ).rejects.toMatchObject({ code: 'NETWORK' });
    await expect(
      make(() => ok({ message: 'slow down' }, 429)).validate('t', 'd', 'v'),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await expect(
      make(() => ok({ message: 'Already activated on another device' }, 409)).activate(
        'IMS-AB12-CD34-EF56',
        'd',
        'v',
      ),
    ).rejects.toMatchObject({
      code: 'DEVICE_MISMATCH',
      message: 'Already activated on another device',
    });
  });

  it('a status answer (e.g. DISABLED with 403) is returned, not thrown', async () => {
    const client = new LicenseClient({
      baseUrl: 'https://lic.test',
      fetch: vi.fn(() => ok(server('DISABLED'), 403)),
    });
    await expect(client.validate('t', 'd', 'v')).resolves.toMatchObject({ status: 'DISABLED' });
  });
});
