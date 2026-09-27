/**
 * License domain model. The server clock is the only clock: expiry is
 * computed from expiresAt and the server's now(); nothing the extension
 * sends (times, statuses, plans) is trusted.
 */

/** Admin decisions stored on a license. */
export type StoredStatus = 'ACTIVE' | 'DISABLED' | 'SUSPENDED' | 'REVOKED';
/** What a license effectively is right now (EXPIRED is derived, never stored). */
export type EffectiveStatus = StoredStatus | 'EXPIRED';
/** What the extension can be told. */
export type ClientStatus = EffectiveStatus | 'UNREGISTERED';

export interface Customer {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly company: string | null;
  readonly phone: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface License {
  readonly id: string;
  /** HMAC of the license code; the code itself is never stored. */
  readonly codeHash: string;
  /** Last 4 characters, for display. */
  readonly codeHint: string;
  readonly customerId: string;
  readonly plan: string;
  readonly status: StoredStatus;
  readonly startsAt: number;
  readonly expiresAt: number;
  readonly maxDevices: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly lastSeenAt: number | null;
}

/** One browser profile bound to a license. */
export interface DeviceBinding {
  readonly id: string;
  readonly licenseId: string;
  readonly customerId: string;
  /** HMAC of the extension's random device id. */
  readonly deviceIdHash: string;
  /** SHA-256 of the current device token (rotated on every activation). */
  readonly tokenHash: string;
  readonly status: 'ACTIVE' | 'RELEASED';
  readonly createdAt: number;
  readonly lastSeenAt: number;
  readonly lastValidationAt: number | null;
  readonly extensionVersion: string | null;
}

/** Canonical audit actions. Never contains codes, tokens, keys or raw device ids. */
export type AuditAction =
  | 'CUSTOMER_CREATED'
  | 'CUSTOMER_UPDATED'
  | 'LICENSE_CREATED'
  | 'LICENSE_DISABLED'
  | 'LICENSE_SUSPENDED'
  | 'LICENSE_REACTIVATED'
  | 'LICENSE_REVOKED'
  | 'LICENSE_EXTENDED'
  | 'DEVICE_RESET'
  | 'LICENSE_ACTIVATED'
  | 'ACTIVATION_REFUSED'
  | 'ADMIN_LOGIN'
  | 'ADMIN_LOGIN_FAILED'
  | 'ADMIN_LOGOUT';

export interface AuditEntry {
  readonly at: number;
  readonly actor: string;
  readonly action: AuditAction;
  readonly licenseId: string | null;
  readonly customerId: string | null;
  readonly detail: string | null;
  readonly previousStatus: string | null;
  readonly newStatus: string | null;
  readonly ip: string | null;
  readonly result: 'SUCCESS' | 'FAILURE';
}

/** Exactly what the extension receives: no secrets, no other customer's data. */
export interface LicenseAnswer {
  readonly status: ClientStatus;
  readonly expiresAt: number | null;
  readonly serverTime: number;
  readonly plan: string | null;
  readonly customer: string | null;
  readonly codeHint: string | null;
  readonly token?: string;
  readonly message?: string;
}

export function effectiveStatus(
  license: Pick<License, 'status' | 'startsAt' | 'expiresAt'>,
  now: number,
): EffectiveStatus {
  if (license.status !== 'ACTIVE') return license.status; // manual decisions win
  return license.expiresAt <= now ? 'EXPIRED' : 'ACTIVE';
}

export function statusMessage(status: ClientStatus): string {
  switch (status) {
    case 'ACTIVE':
      return 'License active.';
    case 'EXPIRED':
      return 'License expired. Renew it to continue.';
    case 'DISABLED':
      return 'License disabled by the administrator.';
    case 'SUSPENDED':
      return 'License suspended. Contact support.';
    case 'REVOKED':
      return 'License revoked.';
    case 'UNREGISTERED':
      return 'This browser is not activated. Enter your license code.';
  }
}
