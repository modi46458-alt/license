import { EventEmitter } from 'node:events';
import {
  LICENSE_CODE_PATTERN,
  generateLicenseCode,
  hashLicenseCode,
  normalizeLicenseCode,
  randomId,
  randomToken,
  sha256,
} from './crypto.js';
import {
  effectiveStatus,
  statusMessage,
  type AuditAction,
  type AuditEntry,
  type Customer,
  type DeviceBinding,
  type EffectiveStatus,
  type License,
  type LicenseAnswer,
} from './domain.js';
import type { LicenseRepository } from './repository.js';

/**
 * License rules. Manual states (DISABLED, SUSPENDED, REVOKED) win over
 * expiry and are only lifted by an explicit admin Reactivate (never for
 * REVOKED). Extending changes the expiry only: a disabled license stays
 * disabled; an expired one becomes ACTIVE again once its expiry is ahead.
 */

export type AdminAction = 'disable' | 'suspend' | 'reactivate' | 'revoke' | 'reset-device';

export class LicenseError extends Error {
  constructor(
    readonly httpStatus: number,
    message: string,
  ) {
    super(message);
  }
}

export interface ServiceResult<T> {
  readonly httpStatus: number;
  readonly body: T;
}

const DAY = 86_400_000;
export const EXPIRING_SOON_DAYS = 7;
const DEVICE_ID = /^[A-Za-z0-9-]{8,64}$/;
const VERSION = /^[0-9A-Za-z.+-]{1,20}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface LicenseChange {
  readonly licenseId: string;
}

/** Who performed an admin action (for the audit log). */
export interface Actor {
  readonly name: string;
  readonly ip: string | null;
}
const asActor = (actor: Actor | string): Actor =>
  typeof actor === 'string' ? { name: actor, ip: null } : actor;

export interface Page<T> {
  readonly items: T[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

function paginate<T>(rows: T[], page: unknown, pageSize: unknown): Page<T> {
  const size = Math.min(100, Math.max(1, Number.isInteger(pageSize) ? (pageSize as number) : 25));
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const p = Math.min(pages, Math.max(1, Number.isInteger(page) ? (page as number) : 1));
  return {
    items: rows.slice((p - 1) * size, p * size),
    total: rows.length,
    page: p,
    pageSize: size,
  };
}

const ACTION_AUDIT: Record<AdminAction, AuditAction> = {
  disable: 'LICENSE_DISABLED',
  suspend: 'LICENSE_SUSPENDED',
  reactivate: 'LICENSE_REACTIVATED',
  revoke: 'LICENSE_REVOKED',
  'reset-device': 'DEVICE_RESET',
};

const clean = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
const optional = (v: unknown, max: number): string | null => clean(v, max) || null;
const PHONE = /^[0-9+()\-.\s]{6,30}$/;

/** Only the start of a hash is shown, so bindings can be told apart without exposing it. */
export const maskHash = (hash: string): string => `${hash.slice(0, 10)}…`;

export class LicenseService {
  /** 'changed' (LicenseChange) after every admin change, for real-time push. */
  readonly events = new EventEmitter();

  constructor(
    private readonly repo: LicenseRepository,
    private readonly pepper: string,
    private readonly now: () => number = Date.now,
  ) {}

  /* ----------------------------- helpers ------------------------------ */

  private deviceHash(deviceId: string): string {
    return hashLicenseCode(`device:${deviceId}`, this.pepper);
  }

  private async audit(
    entry: Omit<AuditEntry, 'at' | 'previousStatus' | 'newStatus' | 'ip' | 'result'> &
      Partial<Pick<AuditEntry, 'previousStatus' | 'newStatus' | 'ip' | 'result'>>,
  ): Promise<void> {
    await this.repo.appendAudit({
      previousStatus: null,
      newStatus: null,
      ip: null,
      result: 'SUCCESS',
      ...entry,
      at: this.now(),
    });
  }

  async answer(license: License, extra: Partial<LicenseAnswer> = {}): Promise<LicenseAnswer> {
    const now = this.now();
    const status = effectiveStatus(license, now);
    const customer = await this.repo.getCustomer(license.customerId);
    return {
      status,
      expiresAt: license.expiresAt,
      serverTime: now,
      plan: license.plan,
      customer: customer?.name ?? null,
      codeHint: license.codeHint,
      message: statusMessage(status),
      ...extra,
    };
  }

  unregistered(): LicenseAnswer {
    return {
      status: 'UNREGISTERED',
      expiresAt: null,
      serverTime: this.now(),
      plan: null,
      customer: null,
      codeHint: null,
      message: statusMessage('UNREGISTERED'),
    };
  }

  /** Admin sign-in / sign-out events (no secrets are recorded). */
  async recordAdminAuth(
    action: 'ADMIN_LOGIN' | 'ADMIN_LOGIN_FAILED' | 'ADMIN_LOGOUT',
    ip: string | null,
  ): Promise<void> {
    await this.audit({
      actor: 'admin',
      action,
      licenseId: null,
      customerId: null,
      detail: null,
      ip,
      result: action === 'ADMIN_LOGIN_FAILED' ? 'FAILURE' : 'SUCCESS',
    });
  }

  /* ----------------------------- customers ---------------------------- */

  private validCustomer(input: {
    name?: unknown;
    email?: unknown;
    company?: unknown;
    phone?: unknown;
  }) {
    const name = clean(input.name, 120);
    const email = clean(input.email, 200).toLowerCase();
    const company = optional(input.company, 160);
    const phone = optional(input.phone, 30);
    if (!name) throw new LicenseError(400, 'Customer name is required.');
    if (!EMAIL.test(email)) throw new LicenseError(400, 'A valid email is required.');
    if (phone !== null && !PHONE.test(phone))
      throw new LicenseError(400, 'Phone may contain digits, spaces and + ( ) - . only.');
    return { name, email, company, phone };
  }

  async createCustomer(
    input: { name: unknown; email: unknown; company?: unknown; phone?: unknown },
    actor: Actor | string,
  ): Promise<Customer> {
    const who = asActor(actor);
    const now = this.now();
    const customer: Customer = {
      id: randomId(),
      ...this.validCustomer(input),
      createdAt: now,
      updatedAt: now,
    };
    await this.repo.createCustomer(customer);
    await this.audit({
      actor: who.name,
      ip: who.ip,
      action: 'CUSTOMER_CREATED',
      licenseId: null,
      customerId: customer.id,
      detail: customer.name,
    });
    return customer;
  }

  async updateCustomer(
    id: string,
    input: { name: unknown; email: unknown; company?: unknown; phone?: unknown },
    actor: Actor | string,
  ): Promise<Customer> {
    const who = asActor(actor);
    const current = await this.repo.getCustomer(id);
    if (!current) throw new LicenseError(404, 'Customer not found.');
    const updated = await this.repo.updateCustomer(id, {
      ...this.validCustomer(input),
      updatedAt: this.now(),
    });
    await this.audit({
      actor: who.name,
      ip: who.ip,
      action: 'CUSTOMER_UPDATED',
      licenseId: null,
      customerId: id,
      detail: null,
    });
    return updated as Customer;
  }

  /** Customers with their most recent license, device count and last activity; searchable, paginated. */
  async searchCustomers(filter: { query?: unknown; page?: unknown; pageSize?: unknown }) {
    const now = this.now();
    const query = clean(filter.query, 100).toLowerCase();
    const [customers, licenses, bindings] = await Promise.all([
      this.repo.listCustomers(),
      this.repo.listLicenses(),
      this.repo.listAllBindings(),
    ]);
    const rows = customers.map((customer) => {
      const own = licenses.filter((l) => l.customerId === customer.id);
      const latest = own[0] ?? null; // repositories list newest first
      const devices = bindings.filter((b) => b.customerId === customer.id && b.status === 'ACTIVE');
      const lastSeenAt = Math.max(0, ...own.map((l) => l.lastSeenAt ?? 0)) || null;
      return {
        ...customer,
        licenseCount: own.length,
        license: latest && {
          id: latest.id,
          codeHint: latest.codeHint,
          plan: latest.plan,
          startsAt: latest.startsAt,
          expiresAt: latest.expiresAt,
          status: effectiveStatus(latest, now),
        },
        deviceCount: devices.length,
        lastSeenAt,
      };
    });
    const matches = query
      ? rows.filter((r) =>
          [
            r.name,
            r.email,
            r.company ?? '',
            ...licenses.filter((l) => l.customerId === r.id).flatMap((l) => [l.id, l.codeHint]),
          ].some((v) => v.toLowerCase().includes(query)),
        )
      : rows;
    return paginate(matches, filter.page, filter.pageSize);
  }

  /* ----------------------------- licenses ----------------------------- */

  /** Returns the license and its code; the code is shown once and only its hash is kept. */
  async createLicense(
    input: {
      customerId: unknown;
      plan: unknown;
      days?: unknown;
      expiresAt?: unknown;
      maxDevices?: unknown;
      startsAt?: unknown;
    },
    actor: Actor | string,
  ): Promise<{ license: License; code: string }> {
    const who = asActor(actor);
    const customerId = typeof input.customerId === 'string' ? input.customerId : '';
    const customer = customerId ? await this.repo.getCustomer(customerId) : null;
    if (!customer) throw new LicenseError(400, 'Unknown customer.');
    const plan = clean(input.plan, 60) || 'Standard';
    const maxDevices = input.maxDevices ?? 1;
    if (
      typeof maxDevices !== 'number' ||
      !Number.isInteger(maxDevices) ||
      maxDevices < 1 ||
      maxDevices > 20
    ) {
      throw new LicenseError(400, 'Max devices must be 1–20.');
    }
    const now = this.now();
    const startsAt = input.startsAt === undefined ? now : input.startsAt;
    if (typeof startsAt !== 'number' || !Number.isFinite(startsAt))
      throw new LicenseError(400, 'Start date is invalid.');
    let expiresAt: number;
    if (input.expiresAt !== undefined) {
      if (
        typeof input.expiresAt !== 'number' ||
        !Number.isFinite(input.expiresAt) ||
        input.expiresAt <= Math.max(now, startsAt)
      ) {
        throw new LicenseError(400, 'Expiry date must be after the start date and in the future.');
      }
      expiresAt = input.expiresAt;
    } else {
      const days = input.days;
      if (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > 3650) {
        throw new LicenseError(400, 'Duration must be 1–3650 days (or give an expiry date).');
      }
      expiresAt = startsAt + days * DAY;
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateLicenseCode();
      const codeHash = hashLicenseCode(code, this.pepper);
      if (await this.repo.findLicenseByCodeHash(codeHash)) continue;
      const license: License = {
        id: randomId(),
        codeHash,
        codeHint: code.slice(-4),
        customerId: customer.id,
        plan,
        status: 'ACTIVE',
        startsAt,
        expiresAt,
        maxDevices,
        createdAt: now,
        updatedAt: now,
        lastSeenAt: null,
      };
      await this.repo.createLicense(license);
      await this.audit({
        actor: who.name,
        ip: who.ip,
        action: 'LICENSE_CREATED',
        licenseId: license.id,
        customerId: customer.id,
        detail: `${plan}, ${maxDevices} device(s), until ${new Date(expiresAt).toISOString().slice(0, 10)}`,
        newStatus: effectiveStatus(license, now),
      });
      return { license, code };
    }
    throw new LicenseError(500, 'Could not generate a unique license code.');
  }

  async act(id: string, action: AdminAction, actor: Actor | string): Promise<License> {
    const who = asActor(actor);
    const license = await this.repo.getLicense(id);
    if (!license) throw new LicenseError(404, 'License not found.');
    const now = this.now();
    const previous = effectiveStatus(license, now);
    if (license.status === 'REVOKED' && action !== 'reset-device') {
      await this.audit({
        actor: who.name,
        ip: who.ip,
        action: ACTION_AUDIT[action],
        licenseId: id,
        customerId: license.customerId,
        detail: 'refused: revoked',
        previousStatus: previous,
        newStatus: previous,
        result: 'FAILURE',
      });
      throw new LicenseError(409, 'A revoked license cannot be changed.');
    }
    let patch: Partial<License> = {};
    let released = 0;
    switch (action) {
      case 'disable':
        patch = { status: 'DISABLED' };
        break;
      case 'suspend':
        patch = { status: 'SUSPENDED' };
        break;
      case 'reactivate':
        patch = { status: 'ACTIVE' };
        break;
      case 'revoke':
        patch = { status: 'REVOKED' };
        released = await this.repo.releaseBindings(id, now);
        break;
      case 'reset-device':
        released = await this.repo.releaseBindings(id, now);
        break;
    }
    const updated = (await this.repo.updateLicense(id, { ...patch, updatedAt: now })) as License;
    await this.audit({
      actor: who.name,
      ip: who.ip,
      action: ACTION_AUDIT[action],
      licenseId: id,
      customerId: license.customerId,
      detail: released > 0 ? `${released} device(s) released` : null,
      previousStatus: previous,
      newStatus: effectiveStatus(updated, now),
    });
    this.events.emit('changed', { licenseId: id } satisfies LicenseChange);
    return updated;
  }

  /** +30 / +90 / +365 days (from the later of now and the current expiry), or a custom future date. */
  async extend(
    id: string,
    input: { days?: unknown; expiresAt?: unknown },
    actor: Actor | string,
  ): Promise<License> {
    const who = asActor(actor);
    const license = await this.repo.getLicense(id);
    if (!license) throw new LicenseError(404, 'License not found.');
    if (license.status === 'REVOKED')
      throw new LicenseError(409, 'A revoked license cannot be changed.');
    const now = this.now();
    let expiresAt: number;
    if (input.expiresAt !== undefined) {
      if (
        typeof input.expiresAt !== 'number' ||
        !Number.isFinite(input.expiresAt) ||
        input.expiresAt <= now
      ) {
        throw new LicenseError(400, 'Custom expiry must be a future date.');
      }
      expiresAt = input.expiresAt;
    } else if (input.days === 30 || input.days === 90 || input.days === 365) {
      expiresAt = Math.max(now, license.expiresAt) + input.days * DAY;
    } else {
      throw new LicenseError(400, 'Extend by 30, 90 or 365 days, or give a custom expiry date.');
    }
    const updated = (await this.repo.updateLicense(id, { expiresAt, updatedAt: now })) as License;
    await this.audit({
      actor: who.name,
      ip: who.ip,
      action: 'LICENSE_EXTENDED',
      licenseId: id,
      customerId: license.customerId,
      detail: `until ${new Date(expiresAt).toISOString().slice(0, 10)}`,
      previousStatus: effectiveStatus(license, now),
      newStatus: effectiveStatus(updated, now),
    });
    this.events.emit('changed', { licenseId: id } satisfies LicenseChange);
    return updated;
  }

  private async licenseRows() {
    const now = this.now();
    const [licenses, customers, bindings] = await Promise.all([
      this.repo.listLicenses(),
      this.repo.listCustomers(),
      this.repo.listAllBindings(),
    ]);
    const byId = new Map(customers.map((c) => [c.id, c]));
    return licenses.map(({ codeHash: _hash, ...license }) => ({
      ...license,
      effectiveStatus: effectiveStatus(license, now),
      customer: byId.get(license.customerId)?.name ?? null,
      email: byId.get(license.customerId)?.email ?? null,
      company: byId.get(license.customerId)?.company ?? null,
      activeDevices: bindings.filter((b) => b.licenseId === license.id && b.status === 'ACTIVE')
        .length,
    }));
  }

  /** Admin table (all licenses, no code hashes). */
  async listLicenses() {
    return this.licenseRows();
  }

  /** Status filter (effective status), search, pagination. */
  async searchLicenses(filter: {
    status?: unknown;
    query?: unknown;
    page?: unknown;
    pageSize?: unknown;
  }) {
    const query = clean(filter.query, 100).toLowerCase();
    const status =
      typeof filter.status === 'string' && filter.status !== 'ALL' ? filter.status : null;
    const rows = (await this.licenseRows()).filter(
      (r) =>
        (status === null || r.effectiveStatus === status) &&
        (!query ||
          [r.id, r.codeHint, r.plan, r.customer ?? '', r.email ?? '', r.company ?? ''].some((v) =>
            v.toLowerCase().includes(query),
          )),
    );
    return paginate(rows, filter.page, filter.pageSize);
  }

  /** Admin view of a license: status, customer, bindings (masked hashes), recent audit. */
  async details(id: string) {
    const license = await this.repo.getLicense(id);
    if (!license) throw new LicenseError(404, 'License not found.');
    const { codeHash: _hash, ...rest } = license;
    const bindings = await this.repo.listBindings(id);
    const lastValidationAt = Math.max(0, ...bindings.map((b) => b.lastValidationAt ?? 0)) || null;
    return {
      license: { ...rest, effectiveStatus: effectiveStatus(license, this.now()), lastValidationAt },
      customer: await this.repo.getCustomer(license.customerId),
      devices: bindings.map(({ tokenHash: _t, deviceIdHash, ...b }) => ({
        ...b,
        device: maskHash(deviceIdHash),
      })),
      audit: await this.repo.listAudit({ licenseId: id, limit: 50 }),
    };
  }

  /* ------------------------------ devices ----------------------------- */

  async searchDevices(filter: {
    status?: unknown;
    query?: unknown;
    page?: unknown;
    pageSize?: unknown;
  }) {
    const query = clean(filter.query, 100).toLowerCase();
    const status =
      filter.status === 'ACTIVE' || filter.status === 'RELEASED' ? filter.status : null;
    const [bindings, licenses, customers] = await Promise.all([
      this.repo.listAllBindings(),
      this.repo.listLicenses(),
      this.repo.listCustomers(),
    ]);
    const license = new Map(licenses.map((l) => [l.id, l]));
    const customer = new Map(customers.map((c) => [c.id, c]));
    const rows = bindings
      .filter((b) => status === null || b.status === status)
      .map(({ tokenHash: _t, deviceIdHash, ...b }) => ({
        ...b,
        device: maskHash(deviceIdHash),
        customer: customer.get(b.customerId)?.name ?? null,
        codeHint: license.get(b.licenseId)?.codeHint ?? null,
      }))
      .filter(
        (r) =>
          !query ||
          [r.customer ?? '', r.codeHint ?? '', r.licenseId, r.device].some((v) =>
            v.toLowerCase().includes(query),
          ),
      );
    return paginate(rows, filter.page, filter.pageSize);
  }

  /** Release one browser: its token stops working; it must activate again. */
  async resetDevice(bindingId: string, actor: Actor | string): Promise<void> {
    const who = asActor(actor);
    const binding = await this.repo.getBinding(bindingId);
    if (!binding) throw new LicenseError(404, 'Device not found.');
    if (binding.status === 'RELEASED')
      throw new LicenseError(409, 'This device is already released.');
    await this.repo.updateBinding(bindingId, { status: 'RELEASED' });
    await this.audit({
      actor: who.name,
      ip: who.ip,
      action: 'DEVICE_RESET',
      licenseId: binding.licenseId,
      customerId: binding.customerId,
      detail: `device ${maskHash(binding.deviceIdHash)}`,
    });
    this.events.emit('changed', { licenseId: binding.licenseId } satisfies LicenseChange);
  }

  /* ------------------------------ overview ---------------------------- */

  async stats(): Promise<
    Record<EffectiveStatus | 'TOTAL' | 'EXPIRING_SOON' | 'CUSTOMERS' | 'ACTIVE_DEVICES', number>
  > {
    const now = this.now();
    const counts = {
      TOTAL: 0,
      ACTIVE: 0,
      EXPIRED: 0,
      DISABLED: 0,
      SUSPENDED: 0,
      REVOKED: 0,
      EXPIRING_SOON: 0,
      CUSTOMERS: 0,
      ACTIVE_DEVICES: 0,
    };
    for (const license of await this.repo.listLicenses()) {
      const status = effectiveStatus(license, now);
      counts.TOTAL++;
      counts[status]++;
      if (status === 'ACTIVE' && license.expiresAt - now <= EXPIRING_SOON_DAYS * DAY)
        counts.EXPIRING_SOON++;
    }
    counts.CUSTOMERS = (await this.repo.listCustomers()).length;
    counts.ACTIVE_DEVICES = (await this.repo.listAllBindings()).filter(
      (b) => b.status === 'ACTIVE',
    ).length;
    return counts;
  }

  /** Dashboard: counts, recent activity, licenses expiring within 7 days or expired in the last 7. */
  async dashboard() {
    const now = this.now();
    const rows = await this.licenseRows();
    const expiring = rows
      .filter(
        (r) => r.status === 'ACTIVE' && Math.abs(r.expiresAt - now) <= EXPIRING_SOON_DAYS * DAY,
      )
      .sort((a, b) => a.expiresAt - b.expiresAt)
      .slice(0, 10);
    return {
      stats: await this.stats(),
      expiring,
      recent: (await this.searchAudit({ page: 1, pageSize: 10 })).items,
    };
  }

  /* ------------------------------- audit ------------------------------ */

  /** Audit log, newest first (unpaginated, for scripts). */
  async auditLog(filter: { licenseId?: string; limit: number }): Promise<AuditEntry[]> {
    return this.repo.listAudit(filter);
  }

  /** Audit log with customer names, filterable by license / customer / action, paginated. */
  async searchAudit(filter: {
    licenseId?: unknown;
    customerId?: unknown;
    action?: unknown;
    page?: unknown;
    pageSize?: unknown;
  }) {
    const query = {
      ...(typeof filter.licenseId === 'string' && filter.licenseId
        ? { licenseId: filter.licenseId }
        : {}),
      ...(typeof filter.customerId === 'string' && filter.customerId
        ? { customerId: filter.customerId }
        : {}),
      ...(typeof filter.action === 'string' && /^[A-Z_]{3,40}$/.test(filter.action)
        ? { action: filter.action }
        : {}),
    };
    const pageSize = Math.min(
      100,
      Math.max(1, Number.isInteger(filter.pageSize) ? (filter.pageSize as number) : 25),
    );
    const total = await this.repo.countAudit(query);
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(
      pages,
      Math.max(1, Number.isInteger(filter.page) ? (filter.page as number) : 1),
    );
    const entries = await this.repo.listAudit({
      ...query,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    const customers = new Map((await this.repo.listCustomers()).map((c) => [c.id, c.name]));
    return {
      items: entries.map((e) => ({
        ...e,
        customer: e.customerId ? (customers.get(e.customerId) ?? null) : null,
      })),
      total,
      page,
      pageSize,
    };
  }

  /* ---------------------------- extension ------------------------------ */

  async activate(input: {
    licenseCode: unknown;
    deviceId: unknown;
    extensionVersion: unknown;
  }): Promise<ServiceResult<LicenseAnswer | { message: string }>> {
    const { licenseCode, deviceId, extensionVersion } = input;
    if (
      typeof licenseCode !== 'string' ||
      typeof deviceId !== 'string' ||
      typeof extensionVersion !== 'string'
    ) {
      return { httpStatus: 400, body: { message: 'Invalid request.' } };
    }
    const code = normalizeLicenseCode(licenseCode);
    if (
      !LICENSE_CODE_PATTERN.test(code) ||
      !DEVICE_ID.test(deviceId) ||
      !VERSION.test(extensionVersion)
    ) {
      return { httpStatus: 400, body: { message: 'Invalid license code.' } };
    }
    const license = await this.repo.findLicenseByCodeHash(hashLicenseCode(code, this.pepper));
    if (!license) {
      await this.audit({
        actor: 'extension',
        action: 'ACTIVATION_REFUSED',
        licenseId: null,
        customerId: null,
        detail: 'unknown code',
        result: 'FAILURE',
      });
      return { httpStatus: 404, body: { message: 'License code not found.' } };
    }
    const status = effectiveStatus(license, this.now());
    if (status !== 'ACTIVE') {
      await this.audit({
        actor: 'extension',
        action: 'ACTIVATION_REFUSED',
        licenseId: license.id,
        customerId: license.customerId,
        detail: status,
        result: 'FAILURE',
      });
      return { httpStatus: 403, body: await this.answer(license) };
    }
    const now = this.now();
    const deviceIdHash = this.deviceHash(deviceId);
    const bindings = (await this.repo.listBindings(license.id)).filter(
      (b) => b.status === 'ACTIVE',
    );
    const existing = bindings.find((b) => b.deviceIdHash === deviceIdHash);
    if (!existing && bindings.length >= license.maxDevices) {
      await this.audit({
        actor: 'extension',
        action: 'ACTIVATION_REFUSED',
        licenseId: license.id,
        customerId: license.customerId,
        detail: `device limit ${bindings.length}/${license.maxDevices}`,
        result: 'FAILURE',
      });
      return {
        httpStatus: 409,
        body: {
          message:
            'This license is already activated on its maximum number of browsers. Ask for a device reset.',
        },
      };
    }
    const token = randomToken();
    if (existing) {
      await this.repo.updateBinding(existing.id, {
        tokenHash: sha256(token),
        lastSeenAt: now,
        extensionVersion,
      });
    } else {
      const binding: DeviceBinding = {
        id: randomId(),
        licenseId: license.id,
        customerId: license.customerId,
        deviceIdHash,
        tokenHash: sha256(token),
        status: 'ACTIVE',
        createdAt: now,
        lastSeenAt: now,
        lastValidationAt: null,
        extensionVersion,
      };
      await this.repo.createBinding(binding);
    }
    const updated = (await this.repo.updateLicense(license.id, {
      lastSeenAt: now,
      updatedAt: now,
    })) as License;
    await this.audit({
      actor: 'extension',
      action: 'LICENSE_ACTIVATED',
      licenseId: license.id,
      customerId: license.customerId,
      detail: `v${extensionVersion}`,
    });
    return { httpStatus: 200, body: await this.answer(updated, { token }) };
  }

  /** Token + device → the current server answer. Unknown/released token or another device → UNREGISTERED. */
  async validate(input: {
    token: unknown;
    deviceId: unknown;
    extensionVersion: unknown;
  }): Promise<ServiceResult<LicenseAnswer | { message: string }> & { licenseId: string | null }> {
    const { token, deviceId, extensionVersion } = input;
    if (
      typeof token !== 'string' ||
      token.length < 20 ||
      token.length > 100 ||
      typeof deviceId !== 'string' ||
      !DEVICE_ID.test(deviceId)
    ) {
      return { httpStatus: 400, body: { message: 'Invalid request.' }, licenseId: null };
    }
    const found = await this.findByToken(token, deviceId);
    if (!found) return { httpStatus: 401, body: this.unregistered(), licenseId: null };
    const now = this.now();
    const version =
      typeof extensionVersion === 'string' && VERSION.test(extensionVersion)
        ? extensionVersion
        : found.binding.extensionVersion;
    await this.repo.updateBinding(found.binding.id, {
      lastSeenAt: now,
      lastValidationAt: now,
      extensionVersion: version,
    });
    const license = (await this.repo.updateLicense(found.license.id, {
      lastSeenAt: now,
    })) as License;
    const answer = await this.answer(license);
    return {
      httpStatus: answer.status === 'ACTIVE' ? 200 : 403,
      body: answer,
      licenseId: license.id,
    };
  }

  async findByToken(
    token: string,
    deviceId: string,
  ): Promise<{ license: License; binding: DeviceBinding } | null> {
    const binding = await this.repo.findBindingByTokenHash(sha256(token));
    if (
      !binding ||
      binding.status !== 'ACTIVE' ||
      binding.deviceIdHash !== this.deviceHash(deviceId)
    )
      return null;
    const license = await this.repo.getLicense(binding.licenseId);
    return license ? { license, binding } : null;
  }
}
