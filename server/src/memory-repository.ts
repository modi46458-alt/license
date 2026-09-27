import type { AuditEntry, Customer, DeviceBinding, License } from './domain.js';
import type { AuditQuery, LicenseRepository } from './repository.js';

/** In-memory repository for tests and local development (data is lost on restart). */
export class MemoryLicenseRepository implements LicenseRepository {
  private readonly customers = new Map<string, Customer>();
  private readonly licenses = new Map<string, License>();
  private readonly bindings = new Map<string, DeviceBinding>();
  private readonly audit: AuditEntry[] = [];

  createCustomer(customer: Customer): Promise<void> {
    this.customers.set(customer.id, customer);
    return Promise.resolve();
  }
  getCustomer(id: string): Promise<Customer | null> {
    return Promise.resolve(this.customers.get(id) ?? null);
  }
  listCustomers(): Promise<Customer[]> {
    return Promise.resolve([...this.customers.values()].sort((a, b) => b.createdAt - a.createdAt));
  }
  updateCustomer(
    id: string,
    patch: Partial<Omit<Customer, 'id' | 'createdAt'>>,
  ): Promise<Customer | null> {
    const current = this.customers.get(id);
    if (!current) return Promise.resolve(null);
    const next = { ...current, ...patch };
    this.customers.set(id, next);
    return Promise.resolve(next);
  }

  createLicense(license: License): Promise<void> {
    this.licenses.set(license.id, license);
    return Promise.resolve();
  }
  getLicense(id: string): Promise<License | null> {
    return Promise.resolve(this.licenses.get(id) ?? null);
  }
  findLicenseByCodeHash(codeHash: string): Promise<License | null> {
    return Promise.resolve(
      [...this.licenses.values()].find((l) => l.codeHash === codeHash) ?? null,
    );
  }
  listLicenses(): Promise<License[]> {
    return Promise.resolve([...this.licenses.values()].sort((a, b) => b.createdAt - a.createdAt));
  }
  updateLicense(
    id: string,
    patch: Partial<Omit<License, 'id' | 'codeHash' | 'createdAt'>>,
  ): Promise<License | null> {
    const current = this.licenses.get(id);
    if (!current) return Promise.resolve(null);
    const next = { ...current, ...patch };
    this.licenses.set(id, next);
    return Promise.resolve(next);
  }

  createBinding(binding: DeviceBinding): Promise<void> {
    this.bindings.set(binding.id, binding);
    return Promise.resolve();
  }
  getBinding(id: string): Promise<DeviceBinding | null> {
    return Promise.resolve(this.bindings.get(id) ?? null);
  }
  findBindingByTokenHash(tokenHash: string): Promise<DeviceBinding | null> {
    return Promise.resolve(
      [...this.bindings.values()].find((b) => b.tokenHash === tokenHash) ?? null,
    );
  }
  listBindings(licenseId: string): Promise<DeviceBinding[]> {
    return Promise.resolve([...this.bindings.values()].filter((b) => b.licenseId === licenseId));
  }
  listAllBindings(): Promise<DeviceBinding[]> {
    return Promise.resolve([...this.bindings.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt));
  }
  updateBinding(
    id: string,
    patch: Partial<Omit<DeviceBinding, 'id' | 'licenseId' | 'customerId' | 'createdAt'>>,
  ): Promise<void> {
    const current = this.bindings.get(id);
    if (current) this.bindings.set(id, { ...current, ...patch });
    return Promise.resolve();
  }
  releaseBindings(licenseId: string, _at: number): Promise<number> {
    let released = 0;
    for (const [id, b] of this.bindings) {
      if (b.licenseId === licenseId && b.status === 'ACTIVE') {
        this.bindings.set(id, { ...b, status: 'RELEASED' });
        released++;
      }
    }
    return Promise.resolve(released);
  }

  appendAudit(entry: AuditEntry): Promise<void> {
    this.audit.push(entry);
    return Promise.resolve();
  }
  private matching(query: Omit<AuditQuery, 'limit' | 'offset'>): AuditEntry[] {
    return this.audit
      .filter(
        (e) =>
          (query.licenseId === undefined || e.licenseId === query.licenseId) &&
          (query.customerId === undefined || e.customerId === query.customerId) &&
          (query.action === undefined || e.action === query.action),
      )
      .reverse();
  }
  listAudit(query: AuditQuery): Promise<AuditEntry[]> {
    const offset = query.offset ?? 0;
    return Promise.resolve(this.matching(query).slice(offset, offset + query.limit));
  }
  countAudit(query: Omit<AuditQuery, 'limit' | 'offset'>): Promise<number> {
    return Promise.resolve(this.matching(query).length);
  }
}
