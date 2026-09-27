import mongoose, { Schema, type Connection, type Model } from 'mongoose';
import type { AuditEntry, Customer, DeviceBinding, License } from './domain.js';
import type { AuditQuery, LicenseRepository } from './repository.js';

/**
 * MongoDB (Mongoose) implementation of the repository. Collections:
 * customers, licenses, devicebindings, auditlogs. Unique indexes on the
 * license code hash and the device token hash.
 */

const customerSchema = new Schema<Customer>(
  {
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    email: { type: String, required: true, index: true },
    company: { type: String, default: null },
    phone: { type: String, default: null },
    createdAt: { type: Number, required: true },
    updatedAt: { type: Number, required: true },
  },
  { versionKey: false },
);

const licenseSchema = new Schema<License>(
  {
    id: { type: String, required: true, unique: true },
    codeHash: { type: String, required: true, unique: true },
    codeHint: { type: String, required: true },
    customerId: { type: String, required: true, index: true },
    plan: { type: String, required: true },
    status: { type: String, required: true, enum: ['ACTIVE', 'DISABLED', 'SUSPENDED', 'REVOKED'] },
    startsAt: { type: Number, required: true },
    expiresAt: { type: Number, required: true, index: true },
    maxDevices: { type: Number, required: true, min: 1 },
    createdAt: { type: Number, required: true },
    updatedAt: { type: Number, required: true },
    lastSeenAt: { type: Number, default: null },
  },
  { versionKey: false },
);

const bindingSchema = new Schema<DeviceBinding>(
  {
    id: { type: String, required: true, unique: true },
    licenseId: { type: String, required: true, index: true },
    customerId: { type: String, required: true },
    deviceIdHash: { type: String, required: true },
    tokenHash: { type: String, required: true, unique: true },
    status: { type: String, required: true, enum: ['ACTIVE', 'RELEASED'] },
    createdAt: { type: Number, required: true },
    lastSeenAt: { type: Number, required: true },
    lastValidationAt: { type: Number, default: null },
    extensionVersion: { type: String, default: null },
  },
  { versionKey: false },
);

const auditSchema = new Schema<AuditEntry>(
  {
    at: { type: Number, required: true, index: true },
    actor: { type: String, required: true },
    action: { type: String, required: true, index: true },
    licenseId: { type: String, default: null, index: true },
    customerId: { type: String, default: null, index: true },
    detail: { type: String, default: null },
    previousStatus: { type: String, default: null },
    newStatus: { type: String, default: null },
    ip: { type: String, default: null },
    result: { type: String, required: true, enum: ['SUCCESS', 'FAILURE'] },
  },
  { versionKey: false },
);

const PLAIN = { _id: 0 } as const;

export class MongoLicenseRepository implements LicenseRepository {
  private readonly customers: Model<Customer>;
  private readonly licenses: Model<License>;
  private readonly bindings: Model<DeviceBinding>;
  private readonly audit: Model<AuditEntry>;

  constructor(connection: Connection) {
    this.customers = connection.model<Customer>('Customer', customerSchema);
    this.licenses = connection.model<License>('License', licenseSchema);
    this.bindings = connection.model<DeviceBinding>('DeviceBinding', bindingSchema);
    this.audit = connection.model<AuditEntry>('AuditLog', auditSchema);
  }

  static async connect(uri: string): Promise<MongoLicenseRepository> {
    const connection = await mongoose.createConnection(uri, { autoIndex: true }).asPromise();
    return new MongoLicenseRepository(connection);
  }

  async createCustomer(customer: Customer): Promise<void> {
    await this.customers.create(customer);
  }
  getCustomer(id: string): Promise<Customer | null> {
    return this.customers.findOne({ id }, PLAIN).lean<Customer>().exec();
  }
  listCustomers(): Promise<Customer[]> {
    return this.customers.find({}, PLAIN).sort({ createdAt: -1 }).lean<Customer[]>().exec();
  }
  updateCustomer(id: string, patch: Partial<Customer>): Promise<Customer | null> {
    return this.customers
      .findOneAndUpdate({ id }, { $set: patch }, { new: true, projection: PLAIN })
      .lean<Customer>()
      .exec();
  }

  async createLicense(license: License): Promise<void> {
    await this.licenses.create(license);
  }
  getLicense(id: string): Promise<License | null> {
    return this.licenses.findOne({ id }, PLAIN).lean<License>().exec();
  }
  findLicenseByCodeHash(codeHash: string): Promise<License | null> {
    return this.licenses.findOne({ codeHash }, PLAIN).lean<License>().exec();
  }
  listLicenses(): Promise<License[]> {
    return this.licenses.find({}, PLAIN).sort({ createdAt: -1 }).lean<License[]>().exec();
  }
  updateLicense(id: string, patch: Partial<License>): Promise<License | null> {
    return this.licenses
      .findOneAndUpdate({ id }, { $set: patch }, { new: true, projection: PLAIN })
      .lean<License>()
      .exec();
  }

  async createBinding(binding: DeviceBinding): Promise<void> {
    await this.bindings.create(binding);
  }
  getBinding(id: string): Promise<DeviceBinding | null> {
    return this.bindings.findOne({ id }, PLAIN).lean<DeviceBinding>().exec();
  }
  listAllBindings(): Promise<DeviceBinding[]> {
    return this.bindings.find({}, PLAIN).sort({ lastSeenAt: -1 }).lean<DeviceBinding[]>().exec();
  }
  findBindingByTokenHash(tokenHash: string): Promise<DeviceBinding | null> {
    return this.bindings.findOne({ tokenHash }, PLAIN).lean<DeviceBinding>().exec();
  }
  listBindings(licenseId: string): Promise<DeviceBinding[]> {
    return this.bindings.find({ licenseId }, PLAIN).lean<DeviceBinding[]>().exec();
  }
  async updateBinding(id: string, patch: Partial<DeviceBinding>): Promise<void> {
    await this.bindings.updateOne({ id }, { $set: patch }).exec();
  }
  async releaseBindings(licenseId: string): Promise<number> {
    const result = await this.bindings
      .updateMany({ licenseId, status: 'ACTIVE' }, { $set: { status: 'RELEASED' } })
      .exec();
    return result.modifiedCount;
  }

  async appendAudit(entry: AuditEntry): Promise<void> {
    await this.audit.create(entry);
  }
  private auditFilter(query: Omit<AuditQuery, 'limit' | 'offset'>): Record<string, string> {
    const filter: Record<string, string> = {};
    if (query.licenseId !== undefined) filter.licenseId = query.licenseId;
    if (query.customerId !== undefined) filter.customerId = query.customerId;
    if (query.action !== undefined) filter.action = query.action;
    return filter;
  }
  listAudit(query: AuditQuery): Promise<AuditEntry[]> {
    return this.audit
      .find(this.auditFilter(query), PLAIN)
      .sort({ at: -1, _id: -1 })
      .skip(query.offset ?? 0)
      .limit(query.limit)
      .lean<AuditEntry[]>()
      .exec();
  }
  countAudit(query: Omit<AuditQuery, 'limit' | 'offset'>): Promise<number> {
    return this.audit.countDocuments(this.auditFilter(query)).exec();
  }
}
