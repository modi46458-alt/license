import type { ServerLicenseResponse, ServerLicenseStatus } from './license-types';

/**
 * Real-time messages from the license server (WebSocket). Every status
 * change is delivered as LICENSE_STATUS with the full server answer; the
 * extension treats it exactly like a validation result.
 */
export type LicensePushMessage =
  | { readonly type: 'LICENSE_STATUS'; readonly license: ServerLicenseResponse }
  | { readonly type: 'AUTH_OK' }
  | { readonly type: 'AUTH_FAILED'; readonly reason: string }
  | { readonly type: 'PONG' };

const STATUSES: ReadonlySet<string> = new Set<ServerLicenseStatus>([
  'ACTIVE',
  'EXPIRED',
  'DISABLED',
  'SUSPENDED',
  'REVOKED',
  'UNREGISTERED',
]);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const numOrNull = (v: unknown): v is number | null =>
  v === null || (typeof v === 'number' && Number.isFinite(v));
const strOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';

/** Strict parse of a server license answer (HTTP body or push payload). */
export function parseServerLicense(input: unknown): ServerLicenseResponse | null {
  if (!isObj(input)) return null;
  const { status, expiresAt, serverTime, plan, customer, codeHint, token, message } = input;
  if (typeof status !== 'string' || !STATUSES.has(status)) return null;
  if (!numOrNull(expiresAt) || typeof serverTime !== 'number' || !Number.isFinite(serverTime)) {
    return null;
  }
  if (!strOrNull(plan) || !strOrNull(customer) || !strOrNull(codeHint)) return null;
  if (token !== undefined && (typeof token !== 'string' || token.length < 20)) return null;
  if (message !== undefined && typeof message !== 'string') return null;
  return {
    status: status as ServerLicenseStatus,
    expiresAt,
    serverTime,
    plan,
    customer,
    codeHint,
    ...(token === undefined ? {} : { token }),
    ...(message === undefined ? {} : { message }),
  };
}

export function parsePushMessage(raw: unknown): LicensePushMessage | null {
  let data: unknown = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isObj(data)) return null;
  switch (data.type) {
    case 'LICENSE_STATUS': {
      const license = parseServerLicense(data.license);
      return license ? { type: 'LICENSE_STATUS', license } : null;
    }
    case 'AUTH_OK':
      return { type: 'AUTH_OK' };
    case 'AUTH_FAILED':
      return {
        type: 'AUTH_FAILED',
        reason: typeof data.reason === 'string' ? data.reason : 'unknown',
      };
    case 'PONG':
      return { type: 'PONG' };
    default:
      return null;
  }
}
