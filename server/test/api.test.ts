import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { sha256 } from '../src/crypto.js';
import { DEVICE_A, setup } from './helpers.js';

const ADMIN_KEY = 'admin-key-for-tests-0123456789abcdef';

function app(options: { requireHttps?: boolean } = {}) {
  const t = setup();
  const server = createApp({
    service: t.service,
    adminKeySha256: sha256(ADMIN_KEY),
    requireHttps: options.requireHttps ?? false,
    trustProxy: 1,
    now: t.now,
  });
  const admin = (method: 'get' | 'post', path: string) =>
    request(server)[method](`/admin/api${path}`).set('Authorization', `Bearer ${ADMIN_KEY}`);
  return { t, server, admin };
}

async function issue(a: ReturnType<typeof app>) {
  const customer = await a
    .admin('post', '/customers')
    .send({ name: 'Acme Pharma', email: 'ops@acme.test' });
  const created = await a
    .admin('post', '/licenses')
    .send({ customerId: customer.body.id, plan: 'Pro', days: 30 });
  return created.body as { code: string; license: { id: string } };
}

describe('extension API', () => {
  it('activate → validate → admin disable → validate says DISABLED (403)', async () => {
    const a = app();
    const { code, license } = await issue(a);
    const act = await request(a.server)
      .post('/api/license/activate')
      .send({ licenseCode: code, deviceId: DEVICE_A, extensionVersion: '0.6.1' });
    expect(act.status).toBe(200);
    expect(act.body).toMatchObject({
      status: 'ACTIVE',
      plan: 'Pro',
      customer: 'Acme Pharma',
      codeHint: code.slice(-4),
    });
    const token = act.body.token as string;
    const ok = await request(a.server)
      .post('/api/license/validate')
      .send({ token, deviceId: DEVICE_A, extensionVersion: '0.6.1' });
    expect(ok.status).toBe(200);
    await a.admin('post', `/licenses/${license.id}/disable`).expect(200);
    const blocked = await request(a.server)
      .post('/api/license/validate')
      .send({ token, deviceId: DEVICE_A });
    expect(blocked.status).toBe(403);
    expect(blocked.body.status).toBe('DISABLED');
  });

  it('bad input is rejected; unknown token is UNREGISTERED (401)', async () => {
    const a = app();
    expect(
      (await request(a.server).post('/api/license/activate').send({ licenseCode: 42 })).status,
    ).toBe(400);
    expect(
      (
        await request(a.server)
          .post('/api/license/activate')
          .set('Content-Type', 'application/json')
          .send('{bad')
      ).status,
    ).toBe(400);
    const unknown = await request(a.server)
      .post('/api/license/validate')
      .send({ token: 'x'.repeat(43), deviceId: DEVICE_A });
    expect(unknown.status).toBe(401);
    expect(unknown.body.status).toBe('UNREGISTERED');
  });

  it('rate limits activation attempts (10/min per IP)', async () => {
    const a = app();
    const attempt = () =>
      request(a.server)
        .post('/api/license/activate')
        .send({ licenseCode: 'IMS-0000-0000-0000', deviceId: DEVICE_A, extensionVersion: '1' });
    for (let i = 0; i < 10; i++) expect((await attempt()).status).toBe(404);
    expect((await attempt()).status).toBe(429);
  });

  it('HTTPS can be enforced', async () => {
    const a = app({ requireHttps: true });
    expect((await request(a.server).get('/healthz')).status).toBe(403);
    expect((await request(a.server).get('/healthz').set('X-Forwarded-Proto', 'https')).status).toBe(
      200,
    );
  });

  it('security headers, no stack traces', async () => {
    const a = app();
    const res = await request(a.server).get('/nope');
    expect(res.status).toBe(404);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('admin API', () => {
  it('requires the admin key', async () => {
    const a = app();
    expect((await request(a.server).get('/admin/api/stats')).status).toBe(401);
    expect(
      (await request(a.server).get('/admin/api/stats').set('Authorization', 'Bearer wrong')).status,
    ).toBe(401);
    expect((await a.admin('get', '/stats')).status).toBe(200);
  });

  it('create, list, details, extend, suspend, reactivate, revoke, reset device, audit', async () => {
    const a = app();
    const { license, code } = await issue(a);
    expect(code).toMatch(/^IMS-/);
    const list = await a.admin('get', '/licenses');
    expect(list.body).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain(code);
    expect(list.body[0]).toMatchObject({
      customer: 'Acme Pharma',
      email: 'ops@acme.test',
      effectiveStatus: 'ACTIVE',
    });
    for (const action of ['suspend', 'reactivate', 'reset-device']) {
      await a.admin('post', `/licenses/${license.id}/${action}`).expect(200);
    }
    const extended = await a.admin('post', `/licenses/${license.id}/extend`).send({ days: 90 });
    expect(extended.status).toBe(200);
    await a.admin('post', `/licenses/${license.id}/revoke`).expect(200);
    expect((await a.admin('post', `/licenses/${license.id}/reactivate`)).status).toBe(409);
    expect((await a.admin('post', `/licenses/${license.id}/explode`)).status).toBe(404);
    const details = await a.admin('get', `/licenses/${license.id}`);
    expect(details.body.license.effectiveStatus).toBe('REVOKED');
    const audit = await a.admin('get', `/audit?licenseId=${license.id}`);
    expect(audit.body.map((e: { action: string }) => e.action)).toEqual(
      expect.arrayContaining([
        'LICENSE_SUSPENDED',
        'LICENSE_REACTIVATED',
        'DEVICE_RESET',
        'LICENSE_EXTENDED',
        'LICENSE_REVOKED',
      ]),
    );
  });

  it('validation errors return 400 with a message', async () => {
    const a = app();
    const res = await a.admin('post', '/licenses').send({ customerId: 'nope', days: 30 });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Unknown customer.');
  });
});
