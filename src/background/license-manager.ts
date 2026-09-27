import {
  DEFAULT_GRACE_MS,
  INITIAL_LICENSE_STATE,
  LicenseError,
  fromServer,
  onNetworkFailure,
  parsePushMessage,
  type LicenseRecord,
  type LicenseState,
  type ServerLicenseResponse,
} from '@/core/license';

/**
 * Owns the license in the service worker: activation, validation at
 * lifecycle boundaries and every few minutes, the offline grace, and the
 * real-time push connection. Every change is written to storage, where
 * content scripts and the popup read it; no lead ever waits on the network.
 */

export interface LicenseApi {
  activate(code: string, deviceId: string, version: string): Promise<ServerLicenseResponse>;
  validate(token: string, deviceId: string, version: string): Promise<ServerLicenseResponse>;
}

export interface RecordStore {
  load(): Promise<LicenseRecord>;
  save(record: LicenseRecord): Promise<void>;
}

/** The subset of WebSocket the manager uses (injectable for tests). */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export interface LicenseManagerOptions {
  readonly api: LicenseApi;
  readonly store: RecordStore;
  readonly version: string;
  /** ws(s)://host/api/license/events, or null to disable push. */
  readonly pushUrl: string | null;
  readonly createSocket?: (url: string) => SocketLike;
  readonly now?: () => number;
  readonly graceMs?: number;
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
  readonly onChange?: (record: LicenseRecord) => void;
}

const OPEN = 1;
const PING_MS = 20_000; // keeps the MV3 service worker alive while connected
const MAX_BACKOFF_MS = 5 * 60_000;

export class LicenseManager {
  private record: LicenseRecord | null = null;
  private inFlight: Promise<LicenseState> | null = null;
  private socket: SocketLike | null = null;
  private pingTimer: unknown = null;
  private reconnectTimer: unknown = null;
  private backoffMs = 5_000;

  private readonly now: () => number;
  private readonly graceMs: number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(private readonly options: LicenseManagerOptions) {
    this.now = options.now ?? Date.now;
    this.graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer =
      options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  async getRecord(): Promise<LicenseRecord> {
    this.record ??= await this.options.store.load();
    return this.record;
  }

  async getState(): Promise<LicenseState> {
    return (await this.getRecord()).state;
  }

  /** Startup: validate a stored activation and open the push channel. */
  async init(): Promise<LicenseState> {
    const record = await this.getRecord();
    if (record.token === null) return record.state;
    const state = await this.validate('startup');
    this.connectPush();
    return state;
  }

  async activate(code: string): Promise<LicenseState> {
    const record = await this.getRecord();
    try {
      const response = await this.options.api.activate(code, record.deviceId, this.options.version);
      const next: LicenseRecord = {
        ...record,
        token: response.token ?? null,
        state: fromServer(record.state, response, this.now(), this.graceMs),
      };
      await this.commit(next);
      if (next.token !== null) this.connectPush();
      return next.state;
    } catch (error) {
      const message = error instanceof LicenseError ? error.message : 'Activation failed';
      await this.commit({
        ...record,
        state: { ...record.state, message, checkedAtLocal: this.now() },
      });
      throw error;
    }
  }

  /**
   * Validate with the server (startup, popup open, page activation, before
   * automation, reconnect, periodic alarm). Concurrent calls share one
   * request. Network failures apply the offline grace.
   */
  validate(reason: string): Promise<LicenseState> {
    this.inFlight ??= this.doValidate(reason).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async doValidate(_reason: string): Promise<LicenseState> {
    const record = await this.getRecord();
    if (record.token === null) return record.state;
    try {
      const response = await this.options.api.validate(
        record.token,
        record.deviceId,
        this.options.version,
      );
      const tokenStillValid = response.status !== 'UNREGISTERED';
      const next: LicenseRecord = {
        ...record,
        token: tokenStillValid ? record.token : null,
        state: fromServer(record.state, response, this.now(), this.graceMs),
      };
      await this.commit(next);
      if (!tokenStillValid) this.disconnectPush();
      return next.state;
    } catch (error) {
      const reason = error instanceof LicenseError ? error.message : 'License server unreachable';
      const next = { ...record, state: onNetworkFailure(record.state, this.now(), reason) };
      await this.commit(next);
      return next.state;
    }
  }

  /** Forget the activation on this device (the server binding stays until an admin resets it). */
  async deactivate(): Promise<LicenseState> {
    const record = await this.getRecord();
    this.disconnectPush();
    const next: LicenseRecord = { ...record, token: null, state: INITIAL_LICENSE_STATE };
    await this.commit(next);
    return next.state;
  }

  /** A push message from the server (also used directly by tests). */
  async handlePush(raw: unknown): Promise<void> {
    const message = parsePushMessage(raw);
    if (!message) return;
    if (message.type === 'AUTH_FAILED') {
      await this.validate('push-auth-failed');
      return;
    }
    if (message.type !== 'LICENSE_STATUS') return;
    const record = await this.getRecord();
    const next: LicenseRecord = {
      ...record,
      token: message.license.status === 'UNREGISTERED' ? null : record.token,
      state: fromServer(record.state, message.license, this.now(), this.graceMs),
    };
    await this.commit(next);
  }

  /* ------------------------------ push -------------------------------- */

  connectPush(): void {
    const { pushUrl, createSocket } = this.options;
    if (!pushUrl || !createSocket || this.socket || this.record?.token == null) return;
    const socket = createSocket(pushUrl);
    this.socket = socket;
    socket.onopen = () => {
      this.backoffMs = 5_000;
      const record = this.record;
      if (!record?.token) return socket.close();
      socket.send(JSON.stringify({ type: 'AUTH', token: record.token, deviceId: record.deviceId }));
      this.schedulePing();
      void this.validate('reconnect'); // catch up on anything missed while disconnected
    };
    socket.onmessage = (event) => void this.handlePush(event.data);
    socket.onerror = () => undefined; // onclose follows
    socket.onclose = () => {
      this.socket = null;
      if (this.pingTimer !== null) this.clearTimer(this.pingTimer);
      this.pingTimer = null;
      this.scheduleReconnect();
    };
  }

  disconnectPush(): void {
    if (this.reconnectTimer !== null) this.clearTimer(this.reconnectTimer);
    if (this.pingTimer !== null) this.clearTimer(this.pingTimer);
    this.reconnectTimer = null;
    this.pingTimer = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onclose = null;
      socket.close();
    }
  }

  private schedulePing(): void {
    this.pingTimer = this.setTimer(() => {
      if (this.socket?.readyState === OPEN) {
        this.socket.send(JSON.stringify({ type: 'PING' }));
        this.schedulePing();
      }
    }, PING_MS);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null || this.record?.token == null) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    this.reconnectTimer = this.setTimer(() => {
      this.reconnectTimer = null;
      this.connectPush();
    }, delay);
  }

  private async commit(record: LicenseRecord): Promise<void> {
    this.record = record;
    try {
      await this.options.store.save(record);
    } finally {
      this.options.onChange?.(record);
    }
  }
}
