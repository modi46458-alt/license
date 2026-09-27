import { LicenseService } from '../src/license-service.js';
import { MemoryLicenseRepository } from '../src/memory-repository.js';

export const PEPPER = 'test-pepper-0123456789-abcdefghij-XYZ';
export const DAY = 86_400_000;
export const DEVICE_A = 'device-aaaa-1111';
export const DEVICE_B = 'device-bbbb-2222';

export function setup(start = Date.UTC(2026, 8, 27)) {
  let now = start;
  const repo = new MemoryLicenseRepository();
  const service = new LicenseService(repo, PEPPER, () => now);
  return {
    repo,
    service,
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
    async license(options: { days?: number; maxDevices?: number } = {}) {
      const customer = await service.createCustomer(
        { name: 'Acme Pharma', email: 'ops@acme.test' },
        'admin',
      );
      return service.createLicense(
        {
          customerId: customer.id,
          plan: 'Pro',
          days: options.days ?? 30,
          maxDevices: options.maxDevices ?? 1,
        },
        'admin',
      );
    },
  };
}
