import { INITIAL_LICENSE_STATE } from './license-state';
import type { LicenseRecord, LicenseState, LicenseStatus } from './license-types';

/**
 * Persistence of the license record in chrome.storage.local. Content
 * scripts and the popup read the state from here; only the service worker
 * writes it. The raw license code is never stored.
 */

export const LICENSE_RECORD_KEY = 'license.record';

export interface KeyValueArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

const STATUSES: ReadonlySet<string> = new Set<LicenseStatus>([
  'ACTIVE',
  'EXPIRED',
  'DISABLED',
  'SUSPENDED',
  'REVOKED',
  'UNREGISTERED',
  'NETWORK_ERROR',
]);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const s = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export function parseLicenseState(input: unknown): LicenseState | null {
  if (!isObj(input) || typeof input.status !== 'string' || !STATUSES.has(input.status)) return null;
  return {
    status: input.status as LicenseStatus,
    codeHint: s(input.codeHint),
    plan: s(input.plan),
    customer: s(input.customer),
    expiresAt: n(input.expiresAt),
    verifiedAt: n(input.verifiedAt),
    verifiedAtLocal: n(input.verifiedAtLocal),
    graceUntilLocal: n(input.graceUntilLocal),
    offline: input.offline === true,
    message: s(input.message),
    checkedAtLocal: n(input.checkedAtLocal),
  };
}

export function parseLicenseRecord(input: unknown): LicenseRecord | null {
  if (!isObj(input) || typeof input.deviceId !== 'string' || input.deviceId.length < 8) return null;
  const state = parseLicenseState(input.state);
  if (!state) return null;
  return { state, token: s(input.token), deviceId: input.deviceId };
}

export function newLicenseRecord(deviceId: string): LicenseRecord {
  return { state: INITIAL_LICENSE_STATE, token: null, deviceId };
}

export async function loadLicenseRecord(
  area: KeyValueArea,
  newDeviceId: () => string,
): Promise<LicenseRecord> {
  try {
    const stored = await area.get(LICENSE_RECORD_KEY);
    const record = parseLicenseRecord(stored[LICENSE_RECORD_KEY]);
    if (record) return record;
  } catch {
    /* fall through to a fresh record */
  }
  const fresh = newLicenseRecord(newDeviceId());
  await area.set({ [LICENSE_RECORD_KEY]: fresh }).catch(() => undefined);
  return fresh;
}

export async function saveLicenseRecord(area: KeyValueArea, record: LicenseRecord): Promise<void> {
  await area.set({ [LICENSE_RECORD_KEY]: record });
}

/** State only (for content scripts / popup), from a storage change or read. */
export function licenseStateFromStorage(value: unknown): LicenseState {
  return parseLicenseRecord(value)?.state ?? INITIAL_LICENSE_STATE;
}
