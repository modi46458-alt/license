import { describe, expect, it } from 'vitest';
import { LICENSE_CODE_PATTERN } from '../src/crypto.js';
import { DAY, DEVICE_A, DEVICE_B, setup } from './helpers.js';

type Answer = { status: string; token?: string; expiresAt: number | null; serverTime: number };
const asAnswer = (body: unknown) => body as Answer;

async function activated(t: ReturnType<typeof setup>, device = DEVICE_A) {
  const { license, code } = await t.license();
  const result = await t.service.activate({
    licenseCode: code,
    deviceId: device,
    extensionVersion: '0.6.1',
  });
  const token = asAnswer(result.body).token ?? '';
  const validate = (d = device) =>
    t.service.validate({ token, deviceId: d, extensionVersion: '0.6.1' });
  return { license, code, token, result, validate };
}

describe('license creation', () => {
  it('issues an IMS code shown once; only its hash (and last 4 chars) is stored', async () => {
    const t = setup();
    const { license, code } = await t.license();
    expect(code).toMatch(LICENSE_CODE_PATTERN);
    expect(license.codeHint).toBe(code.slice(-4));
    expect(JSON.stringify(await t.repo.listLicenses())).not.toContain(code);
    expect(license.codeHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('validates input', async () => {
    const t = setup();
    await expect(t.service.createCustomer({ name: '', email: 'x@y.z' }, 'admin')).rejects.toThrow(
      'name',
    );
    await expect(t.service.createCustomer({ name: 'A', email: 'nope' }, 'admin')).rejects.toThrow(
      'email',
    );
    await expect(
      t.service.createLicense({ customerId: 'missing', plan: 'Pro', days: 30 }, 'admin'),
    ).rejects.toThrow('Unknown customer');
  });
});

describe('activation and device binding', () => {
  it('activates, binds the device (hashed), returns ACTIVE with a token', async () => {
    const t = setup();
    const { result, token, license } = await activated(t);
    expect(result.httpStatus).toBe(200);
    expect(asAnswer(result.body)).toMatchObject({ status: 'ACTIVE', expiresAt: license.expiresAt });
    expect(token.length).toBeGreaterThanOrEqual(40);
    const bindings = await t.repo.listBindings(license.id);
    expect(bindings).toHaveLength(1);
    expect(JSON.stringify(bindings)).not.toContain(DEVICE_A);
    expect(JSON.stringify(bindings)).not.toContain(token);
  });

  it('rejects unknown, malformed and case/space-variant codes correctly', async () => {
    const t = setup();
    const { code } = await t.license();
    expect(
      (
        await t.service.activate({
          licenseCode: 'IMS-0000-0000-0000',
          deviceId: DEVICE_A,
          extensionVersion: '1',
        })
      ).httpStatus,
    ).toBe(404);
    expect(
      (
        await t.service.activate({
          licenseCode: 'hello',
          deviceId: DEVICE_A,
          extensionVersion: '1',
        })
      ).httpStatus,
    ).toBe(400);
    expect(
      (
        await t.service.activate({
          licenseCode: ` ${code.toLowerCase()} `,
          deviceId: DEVICE_A,
          extensionVersion: '1',
        })
      ).httpStatus,
    ).toBe(200);
  });

  it('maxDevices: a second browser is refused until the admin resets the device', async () => {
    const t = setup();
    const { license, code, validate } = await activated(t);
    const second = await t.service.activate({
      licenseCode: code,
      deviceId: DEVICE_B,
      extensionVersion: '0.6.1',
    });
    expect(second.httpStatus).toBe(409);
    await t.service.act(license.id, 'reset-device', 'admin');
    expect(asAnswer((await validate()).body).status).toBe('UNREGISTERED'); // old browser released
    const again = await t.service.activate({
      licenseCode: code,
      deviceId: DEVICE_B,
      extensionVersion: '0.6.1',
    });
    expect(again.httpStatus).toBe(200);
  });

  it('the same browser re-activating gets a fresh token; the old one stops working', async () => {
    const t = setup();
    const { code, token } = await activated(t);
    const again = await t.service.activate({
      licenseCode: code,
      deviceId: DEVICE_A,
      extensionVersion: '0.6.1',
    });
    const fresh = asAnswer(again.body).token ?? '';
    expect(fresh).not.toBe(token);
    expect(
      (await t.service.validate({ token, deviceId: DEVICE_A, extensionVersion: '0.6.1' }))
        .httpStatus,
    ).toBe(401);
    expect(
      (await t.service.validate({ token: fresh, deviceId: DEVICE_A, extensionVersion: '0.6.1' }))
        .httpStatus,
    ).toBe(200);
  });

  it('a token used from another device id is UNREGISTERED', async () => {
    const t = setup();
    const { validate } = await activated(t);
    expect(asAnswer((await validate(DEVICE_B)).body).status).toBe('UNREGISTERED');
  });

  it('maxDevices 2 allows two browsers', async () => {
    const t = setup();
    const customer = await t.service.createCustomer({ name: 'Two', email: 'two@x.test' }, 'admin');
    const { code } = await t.service.createLicense(
      { customerId: customer.id, plan: 'Team', days: 30, maxDevices: 2 },
      'admin',
    );
    for (const d of [DEVICE_A, DEVICE_B]) {
      expect(
        (await t.service.activate({ licenseCode: code, deviceId: d, extensionVersion: '1' }))
          .httpStatus,
      ).toBe(200);
    }
    expect(
      (
        await t.service.activate({
          licenseCode: code,
          deviceId: 'device-cccc-3333',
          extensionVersion: '1',
        })
      ).httpStatus,
    ).toBe(409);
  });
});

describe('statuses (server time is authoritative)', () => {
  it('ACTIVE → EXPIRED when expiresAt <= server now', async () => {
    const t = setup();
    const { validate } = await activated(t);
    t.advance(30 * DAY - 1);
    expect(asAnswer((await validate()).body).status).toBe('ACTIVE');
    t.advance(1);
    const expired = await validate();
    expect(expired.httpStatus).toBe(403);
    expect(asAnswer(expired.body).status).toBe('EXPIRED');
  });

  it('an expired code cannot be activated', async () => {
    const t = setup();
    const { code } = await t.license({ days: 1 });
    t.advance(DAY);
    const result = await t.service.activate({
      licenseCode: code,
      deviceId: DEVICE_A,
      extensionVersion: '1',
    });
    expect(result.httpStatus).toBe(403);
    expect(asAnswer(result.body).status).toBe('EXPIRED');
  });

  it('remote disable → DISABLED; reactivate → ACTIVE', async () => {
    const t = setup();
    const { license, validate } = await activated(t);
    await t.service.act(license.id, 'disable', 'admin');
    expect(asAnswer((await validate()).body).status).toBe('DISABLED');
    await t.service.act(license.id, 'reactivate', 'admin');
    expect(asAnswer((await validate()).body).status).toBe('ACTIVE');
  });

  it('suspend and revoke; a revoked license can never be reactivated', async () => {
    const t = setup();
    const { license, validate } = await activated(t);
    await t.service.act(license.id, 'suspend', 'admin');
    expect(asAnswer((await validate()).body).status).toBe('SUSPENDED');
    await t.service.act(license.id, 'revoke', 'admin');
    expect(asAnswer((await validate()).body).status).toBe('UNREGISTERED'); // bindings released on revoke
    await expect(t.service.act(license.id, 'reactivate', 'admin')).rejects.toThrow('revoked');
    await expect(t.service.extend(license.id, { days: 30 }, 'admin')).rejects.toThrow('revoked');
  });

  it('extend +30/+90/+365 from the later of now and expiry; custom date must be in the future', async () => {
    const t = setup();
    const { license } = await activated(t);
    const e30 = await t.service.extend(license.id, { days: 30 }, 'admin');
    expect(e30.expiresAt).toBe(license.expiresAt + 30 * DAY);
    const e90 = await t.service.extend(license.id, { days: 90 }, 'admin');
    expect(e90.expiresAt).toBe(e30.expiresAt + 90 * DAY);
    await expect(t.service.extend(license.id, { days: 7 }, 'admin')).rejects.toThrow(
      '30, 90 or 365',
    );
    await expect(t.service.extend(license.id, { expiresAt: t.now() - 1 }, 'admin')).rejects.toThrow(
      'future',
    );
    const custom = await t.service.extend(license.id, { expiresAt: t.now() + 400 * DAY }, 'admin');
    expect(custom.expiresAt).toBe(t.now() + 400 * DAY);
  });

  it('extending an expired license makes it ACTIVE; extending a DISABLED one does not re-enable it', async () => {
    const t = setup();
    const { license, validate } = await activated(t);
    t.advance(31 * DAY);
    expect(asAnswer((await validate()).body).status).toBe('EXPIRED');
    await t.service.extend(license.id, { days: 30 }, 'admin');
    expect(asAnswer((await validate()).body).status).toBe('ACTIVE');
    await t.service.act(license.id, 'disable', 'admin');
    await t.service.extend(license.id, { days: 365 }, 'admin');
    expect(asAnswer((await validate()).body).status).toBe('DISABLED');
  });

  it('stats count effective statuses and licenses expiring within 7 days', async () => {
    const t = setup();
    const a = await t.license({ days: 5 });
    const b = await t.license({ days: 30 });
    await t.license({ days: 60 });
    await t.service.act(b.license.id, 'disable', 'admin');
    expect(await t.service.stats()).toMatchObject({
      TOTAL: 3,
      ACTIVE: 2,
      DISABLED: 1,
      EXPIRING_SOON: 1,
    });
    t.advance(6 * DAY);
    expect((await t.service.stats()).EXPIRED).toBe(1);
    expect(a.license.id).toBeTruthy();
  });
});

describe('audit and events', () => {
  it('every admin action and activation is audited and announced', async () => {
    const t = setup();
    const changed: string[] = [];
    t.service.events.on('changed', (c: { licenseId: string }) => changed.push(c.licenseId));
    const { license } = await activated(t);
    await t.service.act(license.id, 'disable', 'admin');
    await t.service.extend(license.id, { days: 30 }, 'admin');
    const actions = (await t.service.auditLog({ licenseId: license.id, limit: 50 })).map(
      (e) => e.action,
    );
    expect(actions).toEqual(
      expect.arrayContaining([
        'LICENSE_CREATED',
        'LICENSE_ACTIVATED',
        'LICENSE_DISABLED',
        'LICENSE_EXTENDED',
      ]),
    );
    expect(changed).toEqual([license.id, license.id]);
    const details = await t.service.details(license.id);
    expect(JSON.stringify(details)).not.toMatch(/tokenHash|codeHash"?:"[0-9a-f]/);
  });
});
