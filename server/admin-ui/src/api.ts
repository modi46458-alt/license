/**
 * Admin API client. The admin key is sent once, to /session, and never kept:
 * the server answers with an HttpOnly session cookie (invisible to scripts)
 * and a CSRF token that lives only in memory here (never in localStorage).
 */

export type LicenseStatus = 'ACTIVE' | 'EXPIRED' | 'DISABLED' | 'SUSPENDED' | 'REVOKED';
export type AdminAction = 'disable' | 'suspend' | 'reactivate' | 'revoke' | 'reset-device';

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CustomerRow {
  id: string;
  name: string;
  email: string;
  company: string | null;
  phone: string | null;
  createdAt: number;
  licenseCount: number;
  license: {
    id: string;
    codeHint: string;
    plan: string;
    startsAt: number;
    expiresAt: number;
    status: LicenseStatus;
  } | null;
  deviceCount: number;
  lastSeenAt: number | null;
}

export interface LicenseRow {
  id: string;
  codeHint: string;
  customerId: string;
  customer: string | null;
  email: string | null;
  company: string | null;
  plan: string;
  status: Exclude<LicenseStatus, 'EXPIRED'>;
  effectiveStatus: LicenseStatus;
  startsAt: number;
  expiresAt: number;
  maxDevices: number;
  activeDevices: number;
  createdAt: number;
  updatedAt: number;
  lastSeenAt: number | null;
}

export interface DeviceRow {
  id: string;
  licenseId: string;
  customerId: string;
  customer: string | null;
  codeHint: string | null;
  device: string;
  status: 'ACTIVE' | 'RELEASED';
  createdAt: number;
  lastSeenAt: number;
  lastValidationAt: number | null;
  extensionVersion: string | null;
}

export interface AuditRow {
  at: number;
  actor: string;
  action: string;
  licenseId: string | null;
  customerId: string | null;
  customer: string | null;
  detail: string | null;
  previousStatus: string | null;
  newStatus: string | null;
  ip: string | null;
  result: 'SUCCESS' | 'FAILURE';
}

export interface LicenseDetails {
  license: LicenseRow & { lastValidationAt: number | null };
  customer: { id: string; name: string; email: string; company: string | null } | null;
  devices: Omit<DeviceRow, 'customer' | 'codeHint'>[];
  audit: Omit<AuditRow, 'customer'>[];
}

export interface Dashboard {
  stats: Record<
    | 'TOTAL'
    | 'ACTIVE'
    | 'EXPIRED'
    | 'DISABLED'
    | 'SUSPENDED'
    | 'REVOKED'
    | 'EXPIRING_SOON'
    | 'CUSTOMERS'
    | 'ACTIVE_DEVICES',
    number
  >;
  expiring: LicenseRow[];
  recent: AuditRow[];
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

let csrfToken: string | null = null;
let onUnauthorized: () => void = () => undefined;

export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  let res: Response;
  try {
    res = await fetch(`/admin/api${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError(0, 'The license server is not reachable.');
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { message?: string };
  if (res.status === 401 && path !== '/session') {
    csrfToken = null;
    onUnauthorized();
  }
  if (!res.ok) throw new ApiError(res.status, data.message ?? `Request failed (${res.status})`);
  return data as T;
}

function qs(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const api = {
  async login(key: string): Promise<{ expiresAt: number }> {
    const r = await call<{ csrfToken: string; expiresAt: number }>('POST', '/session', { key });
    csrfToken = r.csrfToken;
    return r;
  },
  async restore(): Promise<{ expiresAt: number } | null> {
    try {
      const r = await call<{ csrfToken: string; expiresAt: number }>('GET', '/session');
      csrfToken = r.csrfToken;
      return r;
    } catch {
      return null;
    }
  },
  async logout(): Promise<void> {
    await call('DELETE', '/session').catch(() => undefined);
    csrfToken = null;
  },
  dashboard: () => call<Dashboard>('GET', '/dashboard'),
  customers: (p: { query?: string | undefined; page?: number; pageSize?: number }) =>
    call<Page<CustomerRow>>('GET', `/customers${qs(p)}`),
  createCustomer: (c: { name: string; email: string; company?: string; phone?: string }) =>
    call<CustomerRow>('POST', '/customers', c),
  updateCustomer: (
    id: string,
    c: { name: string; email: string; company?: string; phone?: string },
  ) => call<CustomerRow>('PUT', `/customers/${encodeURIComponent(id)}`, c),
  licenses: (p: {
    query?: string | undefined;
    status?: string | undefined;
    page?: number;
    pageSize?: number;
  }) => call<Page<LicenseRow>>('GET', `/licenses/search${qs(p)}`),
  license: (id: string) => call<LicenseDetails>('GET', `/licenses/${encodeURIComponent(id)}`),
  createLicense: (l: {
    customerId: string;
    plan: string;
    startsAt: number;
    expiresAt: number;
    maxDevices: number;
  }) => call<{ license: LicenseRow; code: string }>('POST', '/licenses', l),
  act: (id: string, action: AdminAction) =>
    call<LicenseRow>('POST', `/licenses/${encodeURIComponent(id)}/${action}`),
  extend: (id: string, body: { days: 30 | 90 | 365 } | { expiresAt: number }) =>
    call<LicenseRow>('POST', `/licenses/${encodeURIComponent(id)}/extend`, body),
  devices: (p: {
    query?: string | undefined;
    status?: string | undefined;
    page?: number;
    pageSize?: number;
  }) => call<Page<DeviceRow>>('GET', `/devices${qs(p)}`),
  resetDevice: (id: string) => call<void>('POST', `/devices/${encodeURIComponent(id)}/reset`),
  audit: (p: {
    action?: string | undefined;
    licenseId?: string | undefined;
    page?: number;
    pageSize?: number;
  }) => call<Page<AuditRow>>('GET', `/audit/search${qs(p)}`),
  async health(): Promise<boolean> {
    try {
      const res = await fetch('/healthz', { cache: 'no-store' });
      return res.ok;
    } catch {
      return false;
    }
  },
};
