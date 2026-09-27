/**
 * Subscription license (extension side). The license server is the
 * authority: statuses, expiry and plan come from it; the extension only
 * caches the last verified answer and applies a bounded offline grace.
 */

export type LicenseStatus =
  'ACTIVE' | 'EXPIRED' | 'DISABLED' | 'SUSPENDED' | 'REVOKED' | 'UNREGISTERED' | 'NETWORK_ERROR';

/** Statuses the server can report (NETWORK_ERROR is client-side only). */
export type ServerLicenseStatus = Exclude<LicenseStatus, 'NETWORK_ERROR'>;

export const LICENSE_CODE_PATTERN = /^IMS-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

export interface LicenseState {
  readonly status: LicenseStatus;
  /** Last 4 characters of the code, for display only. */
  readonly codeHint: string | null;
  readonly plan: string | null;
  readonly customer: string | null;
  /** Server time (ms) when the license expires. */
  readonly expiresAt: number | null;
  /** Server time (ms) of the last successful validation. */
  readonly verifiedAt: number | null;
  /** Local clock (ms) at that validation: offline grace is measured from here. */
  readonly verifiedAtLocal: number | null;
  /** Local clock (ms) until which an ACTIVE license works without the server. */
  readonly graceUntilLocal: number | null;
  /** ACTIVE but running on the offline grace (server unreachable). */
  readonly offline: boolean;
  /** Human-readable reason for the current status, if any. */
  readonly message: string | null;
  /** Local clock (ms) of the last validation attempt (successful or not). */
  readonly checkedAtLocal: number | null;
}

/** What the license server returns from activate / validate / push. */
export interface ServerLicenseResponse {
  readonly status: ServerLicenseStatus;
  readonly expiresAt: number | null;
  readonly serverTime: number;
  readonly plan: string | null;
  readonly customer: string | null;
  readonly codeHint: string | null;
  /** Issued by activate only. */
  readonly token?: string;
  readonly message?: string;
}

/** Persisted in chrome.storage.local. The raw license code is never stored. */
export interface LicenseRecord {
  readonly state: LicenseState;
  /** Opaque device token from activation (null until activated). */
  readonly token: string | null;
  /** Random id for this browser profile, sent to bind the license. */
  readonly deviceId: string;
}

export const DEFAULT_GRACE_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_VALIDATION_INTERVAL_MS = 5 * 60 * 1000;
