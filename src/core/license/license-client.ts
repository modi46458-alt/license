import { LicenseError } from './license-errors';
import { parseServerLicense } from './license-events';
import { LICENSE_CODE_PATTERN, type ServerLicenseResponse } from './license-types';

/**
 * HTTP client for the license server. Only the service worker uses it. It
 * sends the license code once (activation); afterwards only the device token.
 */

export interface LicenseClientOptions {
  /** e.g. "https://license.example.com" (no trailing slash). */
  readonly baseUrl: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

export function normalizeLicenseCode(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, '');
}

export class LicenseClient {
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: LicenseClientOptions) {
    this.fetchFn = options.fetch ?? ((...args) => fetch(...args));
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  activate(
    code: string,
    deviceId: string,
    extensionVersion: string,
  ): Promise<ServerLicenseResponse> {
    const licenseCode = normalizeLicenseCode(code);
    if (!LICENSE_CODE_PATTERN.test(licenseCode)) {
      return Promise.reject(
        new LicenseError('INVALID_CODE', 'License codes look like IMS-XXXX-XXXX-XXXX.'),
      );
    }
    return this.post('/api/license/activate', { licenseCode, deviceId, extensionVersion });
  }

  validate(
    token: string,
    deviceId: string,
    extensionVersion: string,
  ): Promise<ServerLicenseResponse> {
    return this.post('/api/license/validate', { token, deviceId, extensionVersion });
  }

  private async post(path: string, body: Record<string, string>): Promise<ServerLicenseResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchFn(`${this.options.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
        credentials: 'omit',
        cache: 'no-store',
      });
    } catch {
      throw new LicenseError('NETWORK', 'License server unreachable');
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 429)
      throw new LicenseError('RATE_LIMITED', 'Too many attempts. Try again later.');
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new LicenseError('BAD_RESPONSE', `Unexpected response (${response.status})`);
    }
    if (response.status >= 500)
      throw new LicenseError('NETWORK', `License server error (${response.status})`);
    const parsed = parseServerLicense(json);
    if (!parsed) {
      const message =
        typeof json === 'object' &&
        json !== null &&
        'message' in json &&
        typeof json.message === 'string'
          ? json.message
          : `Request refused (${response.status})`;
      const code =
        response.status === 409
          ? 'DEVICE_MISMATCH'
          : response.status === 400
            ? 'INVALID_CODE'
            : 'BAD_RESPONSE';
      throw new LicenseError(code, message);
    }
    return parsed;
  }
}
