import type { LicenseStatus } from './license-types';

export type LicenseErrorCode =
  | 'LICENSE_INACTIVE'
  | 'INVALID_CODE'
  | 'NETWORK'
  | 'BAD_RESPONSE'
  | 'RATE_LIMITED'
  | 'DEVICE_MISMATCH'
  | 'NOT_ACTIVATED';

export class LicenseError extends Error {
  constructor(
    readonly code: LicenseErrorCode,
    message: string,
    readonly status: LicenseStatus | null = null,
  ) {
    super(message);
    this.name = 'LicenseError';
  }
}
