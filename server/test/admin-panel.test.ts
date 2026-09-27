import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { IDLE_MS } from '../src/admin-session.js';
import { createApp } from '../src/app.js';
import { sha256 } from '../src/crypto.js';
import { DAY, DEVICE_A, DEVICE_B, setup } from './helpers.js';

const KEY = 'admin-key-for-panel-tests-0123456789';

function panel(options: { requireHttps?: boolean; adminUiDir?: string } = {}) {
  const t = setup();
  const server = createApp({
    service: t.service,
    adminKeySha256: sha256(KEY),
    requireHttps: options.requireHttps ?? false,
    trustProxy: 1,
    now: t.now,
    ...(options.adminUiDir ? { adminUiDir: options.adminUiDir } : {}),
  });
  return { t, server };
}

/** Signs in like the browser does: cookie jar + CSRF header on writes. */
async function signIn(server: ReturnType<typeof panel>['server']) {
  const agent = request.agent(server);
  const login = await agent.post('/admin/api/session').send({ key: KEY });
  expect(login.status).toBe(200);
  const csrf = login.body.csrfToken as string;
  return {
    agent,
    csrf,
    get: (path: string) => agent.get(`/admin/api${path}`),
    post: (path: string, body?: object) =>
      agent
        .post(`/admin/api${path}`)
        .set('X-CSRF-Token', csrf)
        .send(body ?? {}),
    put: (path: string, body: object) =>
      agent.put(`/admin/api${path}`).set('X-CSRF-Token', csrf).send(body),
  };
}

async function seed(s: Awaited<ReturnType<typeof signIn>>) {
  const customer = await s.post('/customers', {
    name: 'Acme Pharma',
    email: 'ops@acme.test',
    company: 'Acme Ltd',
    phone: '+91 98000 00000',
  });
  const created = await s.post('/licenses', {
    customerId: customer.body.id,
    plan: 'Pro',
    days: 30,
    maxDevices: 2,
  });
  return {
    customer: customer.body,
    license: created.body.license,
    code: created.body.code as string,
  };
}

describe('admin login', () => {
  it('wrong key → 401 and an audited failed login; nothing is set', async () => {
    const { t, server } = panel();
    const res = await request(server).post('/admin/api/session').send({ key: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.headers['set-cookie']).toBeUndefined();
    const audit = await t.service.searchAudit({ action: 'ADMIN_LOGIN_FAILED' });
    expect(audit.total).toBe(1);
    expect(JSON.stringify(audit.items)).not.toContain('wrong');
  });

  it('right key → HttpOnly SameSite=Strict session cookie + CSRF token; key never echoed', async () => {
    const { server } = panel();
    const res = await request(server).post('/admin/api/session').send({ key: KEY });
    expect(res.status).toBe(200);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/imsli_admin=[^;]+; Path=\/admin; HttpOnly; SameSite=Strict/);
    expect(cookie).not.toContain('Secure');
    expect(JSON.stringify(res.body)).not.toContain(KEY);
    expect(res.body.csrfToken).toMatch(/^[\w-]{40,}$/);
  });

  it('Secure cookie when HTTPS is required', async () => {
    const { server } = panel({ requireHttps: true });
    const res = await request(server)
      .post('/admin/api/session')
      .set('X-Forwarded-Proto', 'https')
      .send({ key: KEY });
    expect(String(res.headers['set-cookie'])).toContain('Secure');
  });

  it('unauthorized requests are refused; writes need the CSRF token', async () => {
    const { server } = panel();
    expect((await request(server).get('/admin/api/dashboard')).status).toBe(401);
    const s = await signIn(server);
    expect((await s.get('/dashboard')).status).toBe(200);
    const noCsrf = await s.agent
      .post('/admin/api/customers')
      .send({ name: 'X', email: 'x@y.test' });
    expect(noCsrf.status).toBe(403);
    const badCsrf = await s.agent
      .post('/admin/api/customers')
      .set('X-CSRF-Token', 'nope')
      .send({ name: 'X', email: 'x@y.test' });
    expect(badCsrf.status).toBe(403);
  });

  it('session restore, logout and expiry', async () => {
    const { t, server } = panel();
    const s = await signIn(server);
    expect((await s.get('/session')).body.csrfToken).toBe(s.csrf);
    t.advance(IDLE_MS + 1);
    expect((await s.get('/dashboard')).status).toBe(401); // idle timeout
    const again = await signIn(server);
    const out = await again.agent.delete('/admin/api/session').set('X-CSRF-Token', again.csrf);
    expect(out.status).toBe(204);
    expect((await again.get('/dashboard')).status).toBe(401);
    const actions = (await t.service.searchAudit({ pageSize: 50 })).items.map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['ADMIN_LOGIN', 'ADMIN_LOGOUT']));
  });

  it('scripts can still use the Bearer admin key', async () => {
    const { server } = panel();
    const res = await request(server).get('/admin/api/stats').set('Authorization', `Bearer ${KEY}`);
    expect(res.status).toBe(200);
  });
});

describe('customers', () => {
  it('create (with company and phone), validate, edit', async () => {
    const { server } = panel();
    const s = await signIn(server);
    const { customer } = await seed(s);
    expect(customer).toMatchObject({
      name: 'Acme Pharma',
      email: 'ops@acme.test',
      company: 'Acme Ltd',
      phone: '+91 98000 00000',
    });
    expect((await s.post('/customers', { name: '', email: 'a@b.test' })).status).toBe(400);
    expect((await s.post('/customers', { name: 'A', email: 'not-an-email' })).status).toBe(400);
    const edited = await s.put(`/customers/${customer.id}`, {
      name: 'Acme Pharma Pvt',
      email: 'admin@acme.test',
      company: 'Acme',
      phone: '',
    });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ name: 'Acme Pharma Pvt', email: 'admin@acme.test' });
    expect((await s.put('/customers/missing', { name: 'X', email: 'x@y.test' })).status).toBe(404);
  });

  it('search by name, email, company and license code hint; paginated', async () => {
    const { server } = panel();
    const s = await signIn(server);
    const { code } = await seed(s);
    for (let i = 0; i < 30; i++)
      await s.post('/customers', { name: `Buyer ${i}`, email: `b${i}@x.test` });
    const page1 = await s.get('/customers?page=1&pageSize=10');
    expect(page1.body).toMatchObject({ total: 31, page: 1, pageSize: 10 });
    expect(page1.body.items).toHaveLength(10);
    for (const q of ['acme pharma', 'ops@acme', 'Acme Ltd', code.slice(-4)]) {
      const found = await s.get(`/customers?query=${encodeURIComponent(q)}`);
      expect(found.body.total).toBe(1);
      expect(found.body.items[0]).toMatchObject({
        name: 'Acme Pharma',
        licenseCount: 1,
        deviceCount: 0,
        license: { plan: 'Pro', status: 'ACTIVE' },
      });
    }
  });
});

describe('licenses', () => {
  it('create with start and expiry dates; the code is returned once and never listed', async () => {
    const { t, server } = panel();
    const s = await signIn(server);
    const customer = await s.post('/customers', { name: 'Dated', email: 'd@x.test' });
    const startsAt = t.now() + DAY;
    const expiresAt = t.now() + 60 * DAY;
    const created = await s.post('/licenses', {
      customerId: customer.body.id,
      plan: 'Team',
      startsAt,
      expiresAt,
      maxDevices: 3,
    });
    expect(created.status).toBe(201);
    expect(created.body.license).toMatchObject({
      startsAt,
      expiresAt,
      maxDevices: 3,
      plan: 'Team',
    });
    const code = created.body.code as string;
    const everything = JSON.stringify([
      (await s.get('/licenses/search')).body,
      (await s.get(`/licenses/${created.body.license.id}`)).body,
      (await s.get('/customers')).body,
    ]);
    expect(everything).not.toContain(code);
    expect(everything).not.toContain('codeHash');
    expect(
      (
        await s.post('/licenses', {
          customerId: customer.body.id,
          plan: 'X',
          startsAt,
          expiresAt: startsAt - 1,
        })
      ).status,
    ).toBe(400);
  });

  it('status filter and pagination', async () => {
    const { server } = panel();
    const s = await signIn(server);
    const { license } = await seed(s);
    const other = await seed(s);
    await s.post(`/licenses/${license.id}/disable`);
    const disabled = await s.get('/licenses/search?status=DISABLED');
    expect(disabled.body.total).toBe(1);
    expect(disabled.body.items[0].id).toBe(license.id);
    expect(
      (await s.get('/licenses/search?status=ACTIVE')).body.items.map((l: { id: string }) => l.id),
    ).toEqual([other.license.id]);
    expect((await s.get('/licenses/search?status=ALL&pageSize=1')).body).toMatchObject({
      total: 2,
      pageSize: 1,
    });
  });

  it('disable → reactivate, suspend → reactivate, extend, revoke (final); audited with previous/new status and IP', async () => {
    const { t, server } = panel();
    const s = await signIn(server);
    const { license } = await seed(s);
    for (const [action, status] of [
      ['disable', 'DISABLED'],
      ['reactivate', 'ACTIVE'],
      ['suspend', 'SUSPENDED'],
      ['reactivate', 'ACTIVE'],
    ] as const) {
      const res = await s.post(`/licenses/${license.id}/${action}`);
      expect(res.status).toBe(200);
      expect((await s.get(`/licenses/${license.id}`)).body.license.effectiveStatus).toBe(status);
    }
    const extended = await s.post(`/licenses/${license.id}/extend`, { days: 90 });
    expect(extended.body.expiresAt).toBe(license.expiresAt + 90 * DAY);
    const custom = t.now() + 500 * DAY;
    expect(
      (await s.post(`/licenses/${license.id}/extend`, { expiresAt: custom })).body.expiresAt,
    ).toBe(custom);
    expect((await s.post(`/licenses/${license.id}/revoke`)).status).toBe(200);
    expect((await s.post(`/licenses/${license.id}/reactivate`)).status).toBe(409);

    const audit = await s.get(`/audit/search?licenseId=${license.id}&pageSize=50`);
    const disableEntry = audit.body.items.find(
      (e: { action: string }) => e.action === 'LICENSE_DISABLED',
    );
    expect(disableEntry).toMatchObject({
      previousStatus: 'ACTIVE',
      newStatus: 'DISABLED',
      result: 'SUCCESS',
      customer: 'Acme Pharma',
    });
    expect(disableEntry.ip).toBeTruthy();
    const onlyExtends = await s.get(
      `/audit/search?licenseId=${license.id}&action=LICENSE_EXTENDED`,
    );
    expect(onlyExtends.body.total).toBe(2);
  });

  it('invalid input and unknown ids', async () => {
    const { server } = panel();
    const s = await signIn(server);
    const { license } = await seed(s);
    expect((await s.post(`/licenses/${license.id}/extend`, { days: 12 })).status).toBe(400);
    expect((await s.post('/licenses/nope/disable')).status).toBe(404);
    expect((await s.post(`/licenses/${license.id}/teleport`)).status).toBe(404);
    expect((await s.post('/licenses', { customerId: 'nope', plan: 'Pro', days: 30 })).status).toBe(
      400,
    );
  });
});

describe('devices', () => {
  it('lists bindings with masked ids; resetting one device invalidates its token only', async () => {
    const { t, server } = panel();
    const s = await signIn(server);
    const { code } = await seed(s);
    const a = await t.service.activate({
      licenseCode: code,
      deviceId: DEVICE_A,
      extensionVersion: '0.6.1',
    });
    const b = await t.service.activate({
      licenseCode: code,
      deviceId: DEVICE_B,
      extensionVersion: '0.6.1',
    });
    const tokenA = (a.body as { token: string }).token;
    const tokenB = (b.body as { token: string }).token;
    const devices = await s.get('/devices');
    expect(devices.body.total).toBe(2);
    const raw = JSON.stringify(devices.body);
    for (const secret of [DEVICE_A, DEVICE_B, tokenA, tokenB, 'tokenHash', 'deviceIdHash'])
      expect(raw).not.toContain(secret);
    expect(devices.body.items[0]).toMatchObject({ customer: 'Acme Pharma', status: 'ACTIVE' });
    expect(devices.body.items[0].device).toMatch(/…/);

    const target = devices.body.items.find(() => true) as { id: string };
    expect((await s.post(`/devices/${target.id}/reset`)).status).toBe(204);
    expect((await s.post(`/devices/${target.id}/reset`)).status).toBe(409);
    const results = await Promise.all(
      [
        [tokenA, DEVICE_A],
        [tokenB, DEVICE_B],
      ].map(([token, deviceId]) =>
        t.service.validate({ token, deviceId, extensionVersion: '0.6.1' }),
      ),
    );
    expect(results.map((r) => r.httpStatus).sort()).toEqual([200, 401]); // one released, one still active
    expect((await s.get('/devices?status=RELEASED')).body.total).toBe(1);
    expect((await s.get('/audit/search?action=DEVICE_RESET')).body.total).toBe(1);
  });
});

describe('dashboard', () => {
  it('counts customers, licenses by status, active devices, expiring soon; recent activity', async () => {
    const { t, server } = panel();
    const s = await signIn(server);
    const { code, customer } = await seed(s);
    await t.service.activate({ licenseCode: code, deviceId: DEVICE_A, extensionVersion: '0.6.1' });
    const soon = await s.post('/licenses', { customerId: customer.id, plan: 'Trial', days: 3 });
    const dash = await s.get('/dashboard');
    expect(dash.body.stats).toMatchObject({
      CUSTOMERS: 1,
      TOTAL: 2,
      ACTIVE: 2,
      ACTIVE_DEVICES: 1,
      EXPIRING_SOON: 1,
    });
    expect(dash.body.expiring.map((l: { id: string }) => l.id)).toEqual([soon.body.license.id]);
    expect(dash.body.recent.length).toBeGreaterThan(0);
  });
});

describe('panel files', () => {
  it('serves the SPA for panel routes with a strict CSP, never shadowing the API', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'admin-ui-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Admin</title>');
    writeFileSync(join(dir, 'assets', 'app.js'), 'console.log(1)');
    const { server } = panel({ adminUiDir: dir });
    for (const path of ['/admin', '/admin/login', '/admin/customers', '/admin/licenses/abc']) {
      const res = await request(server).get(path);
      expect(res.status).toBe(200);
      expect(res.text).toContain('<title>Admin</title>');
      expect(res.headers['content-security-policy']).toContain("script-src 'self'");
      expect(res.headers['x-frame-options']).toBe('DENY');
    }
    expect((await request(server).get('/admin/assets/app.js')).status).toBe(200);
    expect((await request(server).get('/admin/api/dashboard')).status).toBe(401);
  });
});
