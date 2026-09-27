import { describe, expect, it, vi } from 'vitest';
import {
  INITIAL_LICENSE_STATE,
  LicenseError,
  isUsable,
  type LicenseRecord,
  type ServerLicenseResponse,
  type ServerLicenseStatus,
} from '@/core/license';
import { LicenseManager, type LicenseApi, type SocketLike } from './license-manager';

const T0 = 1_800_000_000_000;
const TOKEN = 't'.repeat(43);

const answer = (
  status: ServerLicenseStatus,
  over: Partial<ServerLicenseResponse> = {},
): ServerLicenseResponse => ({
  status,
  expiresAt: T0 + 30 * 86_400_000,
  serverTime: T0,
  plan: 'Pro',
  customer: 'Acme',
  codeHint: 'AB12',
  ...over,
});

function setup(api: Partial<LicenseApi> = {}, record?: Partial<LicenseRecord>) {
  let now = 1_000_000;
  let stored: LicenseRecord = {
    state: INITIAL_LICENSE_STATE,
    token: null,
    deviceId: 'device-0001',
    ...record,
  };
  const sockets: Array<SocketLike & { sent: string[] }> = [];
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const activateMock = vi.fn(() => Promise.resolve(answer('ACTIVE', { token: TOKEN })));
  const validateMock = vi.fn(() => Promise.resolve(answer('ACTIVE')));
  const fullApi: LicenseApi = { activate: activateMock, validate: validateMock, ...api };
  const manager = new LicenseManager({
    api: fullApi,
    store: { load: () => Promise.resolve(stored), save: (r) => ((stored = r), Promise.resolve()) },
    version: '0.6.1',
    pushUrl: 'wss://lic.test/api/license/events',
    createSocket: () => {
      const s = {
        readyState: 1,
        sent: [] as string[],
        send(d: string) {
          this.sent.push(d);
        },
        close: vi.fn(),
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
      } as SocketLike & { sent: string[] };
      sockets.push(s);
      return s;
    },
    now: () => now,
    setTimer: (fn, ms) => timers.push({ fn, ms }),
    clearTimer: () => undefined,
  });
  return {
    manager,
    activateMock,
    validateMock,
    sockets,
    timers,
    stored: () => stored,
    advance: (ms: number) => (now += ms),
    now: () => now,
  };
}

describe('LicenseManager', () => {
  it('activation stores the token (not the code) and opens the push channel', async () => {
    const t = setup();
    const state = await t.manager.activate('IMS-AB12-CD34-EF56');
    expect(state.status).toBe('ACTIVE');
    expect(t.stored().token).toBe(TOKEN);
    expect(JSON.stringify(t.stored())).not.toContain('IMS-AB12-CD34-EF56');
    expect(t.activateMock).toHaveBeenCalledWith('IMS-AB12-CD34-EF56', 'device-0001', '0.6.1');
    expect(t.sockets).toHaveLength(1);
    t.sockets[0]?.onopen?.({});
    expect(JSON.parse(t.sockets[0]?.sent[0] ?? '{}')).toEqual({
      type: 'AUTH',
      token: TOKEN,
      deviceId: 'device-0001',
    });
  });

  it('activation failure keeps the previous state and reports the reason', async () => {
    const t = setup({
      activate: () =>
        Promise.reject(new LicenseError('DEVICE_MISMATCH', 'Already activated on another device')),
    });
    await expect(t.manager.activate('IMS-AB12-CD34-EF56')).rejects.toThrow('Already activated');
    expect(t.stored()).toMatchObject({
      token: null,
      state: { status: 'UNREGISTERED', message: 'Already activated on another device' },
    });
  });

  it('remote disable → reactivate → extend via validation', async () => {
    const validate = vi.fn(() => Promise.resolve(answer('DISABLED')));
    const t = setup({ validate }, { token: TOKEN });
    expect((await t.manager.validate('popup')).status).toBe('DISABLED');
    validate.mockImplementation(() => Promise.resolve(answer('ACTIVE')));
    expect((await t.manager.validate('popup')).status).toBe('ACTIVE');
    validate.mockImplementation(() =>
      Promise.resolve(answer('ACTIVE', { expiresAt: T0 + 365 * 86_400_000 })),
    );
    expect((await t.manager.validate('popup')).expiresAt).toBe(T0 + 365 * 86_400_000);
  });

  it('push: LICENSE_STATUS DISABLED takes effect without a validation round-trip', async () => {
    const t = setup({}, { token: TOKEN });
    await t.manager.validate('startup');
    await t.manager.handlePush(
      JSON.stringify({ type: 'LICENSE_STATUS', license: answer('DISABLED') }),
    );
    expect(t.stored().state.status).toBe('DISABLED');
    expect(isUsable(t.stored().state, t.now())).toBe(false);
  });

  it('concurrent validations share one request', async () => {
    let resolve!: (v: ServerLicenseResponse) => void;
    const validate = vi.fn(() => new Promise<ServerLicenseResponse>((r) => (resolve = r)));
    const t = setup({ validate }, { token: TOKEN });
    const a = t.manager.validate('popup');
    const b = t.manager.validate('page');
    await vi.waitFor(() => expect(validate).toHaveBeenCalled());
    resolve(answer('ACTIVE'));
    await Promise.all([a, b]);
    expect(validate).toHaveBeenCalledTimes(1);
  });

  it('offline: grace keeps ACTIVE for 24 h, then NETWORK_ERROR', async () => {
    const validate = vi.fn(() => Promise.resolve(answer('ACTIVE')));
    const t = setup({ validate }, { token: TOKEN });
    await t.manager.validate('startup');
    validate.mockImplementation(() =>
      Promise.reject(new LicenseError('NETWORK', 'License server unreachable')),
    );
    t.advance(3_600_000);
    expect(await t.manager.validate('periodic')).toMatchObject({ status: 'ACTIVE', offline: true });
    t.advance(24 * 3_600_000);
    expect((await t.manager.validate('periodic')).status).toBe('NETWORK_ERROR');
  });

  it('UNREGISTERED from the server (device reset / unknown token) forgets the token', async () => {
    const t = setup({ validate: () => Promise.resolve(answer('UNREGISTERED')) }, { token: TOKEN });
    await t.manager.validate('popup');
    expect(t.stored().token).toBeNull();
  });

  it('push connection reconnects with backoff and re-validates on open', async () => {
    const t = setup({}, { token: TOKEN });
    await t.manager.init();
    t.sockets[0]?.onclose?.({});
    expect(t.timers.at(-1)?.ms).toBe(5_000);
    t.timers.at(-1)?.fn();
    expect(t.sockets).toHaveLength(2);
    t.sockets[1]?.onopen?.({});
    await Promise.resolve();
    expect(t.validateMock).toHaveBeenCalledTimes(2); // startup + reconnect
  });

  it('deactivate forgets the token locally', async () => {
    const t = setup({}, { token: TOKEN });
    await t.manager.deactivate();
    expect(t.stored()).toMatchObject({ token: null, state: { status: 'UNREGISTERED' } });
  });
});
