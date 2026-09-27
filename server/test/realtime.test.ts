import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createApp } from '../src/app.js';
import { sha256 } from '../src/crypto.js';
import { attachRealtime, frameText } from '../src/realtime.js';
import { DEVICE_A, setup } from './helpers.js';

let server: Server | null = null;
let detach: (() => void) | null = null;
afterEach(async () => {
  detach?.();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = null;
});

function nextMessage(ws: WebSocket, type: string): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const onMessage = (data: WebSocket.RawData) => {
      const msg = JSON.parse(frameText(data)) as Record<string, unknown>;
      if (msg.type === type) {
        ws.off('message', onMessage);
        resolve(msg);
      }
    };
    ws.on('message', onMessage);
  });
}

describe('real-time push', () => {
  it('admin disable reaches the extension at once; reactivate too', async () => {
    const t = setup();
    const app = createApp({
      service: t.service,
      adminKeySha256: sha256('k'.repeat(40)),
      requireHttps: false,
      trustProxy: 0,
      now: t.now,
    });
    server = createServer(app);
    detach = attachRealtime(server, t.service);
    await new Promise<void>((resolve) => server?.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;

    const { license, code } = await t.license();
    const activation = await t.service.activate({
      licenseCode: code,
      deviceId: DEVICE_A,
      extensionVersion: '0.6.1',
    });
    const token = (activation.body as { token: string }).token;

    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/license/events`);
    await new Promise((resolve) => ws.once('open', resolve));
    const authed = nextMessage(ws, 'AUTH_OK');
    ws.send(JSON.stringify({ type: 'AUTH', token, deviceId: DEVICE_A }));
    await authed;

    const disabled = nextMessage(ws, 'LICENSE_STATUS');
    await t.service.act(license.id, 'disable', 'admin');
    expect(((await disabled).license as { status: string }).status).toBe('DISABLED');

    const reactivated = nextMessage(ws, 'LICENSE_STATUS');
    await t.service.act(license.id, 'reactivate', 'admin');
    expect(((await reactivated).license as { status: string }).status).toBe('ACTIVE');
    ws.close();
  });

  it('a bad token is refused', async () => {
    const t = setup();
    server = createServer(
      createApp({
        service: t.service,
        adminKeySha256: sha256('k'.repeat(40)),
        requireHttps: false,
        trustProxy: 0,
      }),
    );
    detach = attachRealtime(server, t.service);
    await new Promise<void>((resolve) => server?.listen(0, resolve));
    const ws = new WebSocket(
      `ws://127.0.0.1:${(server.address() as AddressInfo).port}/api/license/events`,
    );
    await new Promise((resolve) => ws.once('open', resolve));
    const failed = nextMessage(ws, 'AUTH_FAILED');
    ws.send(JSON.stringify({ type: 'AUTH', token: 'x'.repeat(43), deviceId: DEVICE_A }));
    expect((await failed).reason).toBe('unknown token');
  });
});
