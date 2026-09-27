import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import type { LicenseChange, LicenseService } from './license-service.js';

/**
 * Real-time license push (WebSocket, /api/license/events). The extension
 * authenticates with its device token; after that, every admin change to
 * its license (disable, suspend, revoke, reactivate, extend, reset device)
 * is pushed at once as LICENSE_STATUS with the full server answer.
 * If this channel is down, the extension still validates every 5 minutes.
 */
export function attachRealtime(server: HttpServer, service: LicenseService): () => void {
  const wss = new WebSocketServer({ server, path: '/api/license/events', maxPayload: 4096 });
  const byLicense = new Map<string, Set<{ socket: WebSocket; token: string; deviceId: string }>>();

  wss.on('connection', (socket) => {
    let subscription: {
      licenseId: string;
      socket: WebSocket;
      token: string;
      deviceId: string;
    } | null = null;
    const authTimer = setTimeout(() => socket.close(4401, 'auth timeout'), 10_000);
    let alive = true;
    const ping = setInterval(() => {
      if (!alive) return socket.terminate();
      alive = false;
      socket.ping();
    }, 30_000);
    socket.on('pong', () => (alive = true));

    socket.on('message', (raw) => {
      let message: { type?: unknown; token?: unknown; deviceId?: unknown };
      try {
        message = JSON.parse(frameText(raw)) as typeof message;
      } catch {
        return socket.close(4400, 'bad message');
      }
      if (message.type === 'PING') {
        socket.send(JSON.stringify({ type: 'PONG' }));
        return;
      }
      if (message.type !== 'AUTH' || subscription) return;
      if (typeof message.token !== 'string' || typeof message.deviceId !== 'string') {
        return socket.close(4400, 'bad auth');
      }
      const token = message.token;
      const deviceId = message.deviceId;
      void service.findByToken(token, deviceId).then((found) => {
        clearTimeout(authTimer);
        if (!found) {
          socket.send(JSON.stringify({ type: 'AUTH_FAILED', reason: 'unknown token' }));
          return socket.close(4401, 'unauthorized');
        }
        subscription = { licenseId: found.license.id, socket, token, deviceId };
        const set = byLicense.get(found.license.id) ?? new Set();
        set.add(subscription);
        byLicense.set(found.license.id, set);
        socket.send(JSON.stringify({ type: 'AUTH_OK' }));
      });
    });

    socket.on('close', () => {
      clearTimeout(authTimer);
      clearInterval(ping);
      if (subscription) byLicense.get(subscription.licenseId)?.delete(subscription);
    });
  });

  const onChange = ({ licenseId }: LicenseChange) => {
    const subscribers = byLicense.get(licenseId);
    if (!subscribers?.size) return;
    for (const sub of subscribers) {
      // Each device gets its own answer (a reset device is told UNREGISTERED).
      void service
        .validate({ token: sub.token, deviceId: sub.deviceId, extensionVersion: undefined })
        .then((result) => {
          if ('status' in result.body && sub.socket.readyState === sub.socket.OPEN) {
            sub.socket.send(JSON.stringify({ type: 'LICENSE_STATUS', license: result.body }));
          }
        });
    }
  };
  service.events.on('changed', onChange);

  return () => {
    service.events.off('changed', onChange);
    wss.close();
  };
}

/** WebSocket frame payload as UTF-8 text. */
export function frameText(raw: RawData): string {
  if (Buffer.isBuffer(raw)) return raw.toString('utf8');
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8');
  return Buffer.from(raw).toString('utf8');
}
