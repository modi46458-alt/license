import type { AuditEntry, Customer, DeviceBinding, License } from './domain.js';

export interface AuditQuery {
  readonly licenseId?: string;
  readonly customerId?: string;
  readonly action?: string;
  readonly limit: number;
  readonly offset?: number;
}

/**
 * Storage port. The service depends only on this interface; the in-memory
 * implementation backs tests and local development, the Mongoose one backs
 * production (MongoDB).
 */
export interface LicenseRepository {
  createCustomer(customer: Customer): Promise<void>;
  getCustomer(id: string): Promise<Customer | null>;
  listCustomers(): Promise<Customer[]>;
  updateCustomer(
    id: string,
    patch: Partial<Omit<Customer, 'id' | 'createdAt'>>,
  ): Promise<Customer | null>;

  createLicense(license: License): Promise<void>;
  getLicense(id: string): Promise<License | null>;
  findLicenseByCodeHash(codeHash: string): Promise<License | null>;
  listLicenses(): Promise<License[]>;
  updateLicense(
    id: string,
    patch: Partial<Omit<License, 'id' | 'codeHash' | 'createdAt'>>,
  ): Promise<License | null>;

  createBinding(binding: DeviceBinding): Promise<void>;
  getBinding(id: string): Promise<DeviceBinding | null>;
  findBindingByTokenHash(tokenHash: string): Promise<DeviceBinding | null>;
  listBindings(licenseId: string): Promise<DeviceBinding[]>;
  listAllBindings(): Promise<DeviceBinding[]>;
  updateBinding(
    id: string,
    patch: Partial<Omit<DeviceBinding, 'id' | 'licenseId' | 'customerId' | 'createdAt'>>,
  ): Promise<void>;
  releaseBindings(licenseId: string, at: number): Promise<number>;

  appendAudit(entry: AuditEntry): Promise<void>;
  /** Newest first. */
  listAudit(query: AuditQuery): Promise<AuditEntry[]>;
  countAudit(query: Omit<AuditQuery, 'limit' | 'offset'>): Promise<number>;
}
