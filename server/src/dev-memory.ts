import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { sha256 } from './crypto.js';
import { LicenseService } from './license-service.js';
import { MemoryLicenseRepository } from './memory-repository.js';
import { attachRealtime } from './realtime.js';

/**
 * Local preview of the admin panel without MongoDB: in-memory data (lost on
 * exit) and a one-time admin key printed at start. Never for production.
 */
if (process.env.NODE_ENV === 'production') {
  console.error('dev-memory is for local development only.');
  process.exit(1);
}
const key = randomBytes(24).toString('base64url');
const service = new LicenseService(new MemoryLicenseRepository(), randomBytes(32).toString('hex'));
const app = createApp({
  service,
  adminKeySha256: sha256(key),
  requireHttps: false,
  trustProxy: 0,
  adminUiDir: resolve(dirname(fileURLToPath(import.meta.url)), '../public/admin'),
});
const server = createServer(app);
attachRealtime(server, service);
const port = Number(process.env.PORT ?? 8787);
server.listen(port, '127.0.0.1', () => {
  console.log(`Admin panel (in-memory, local only): http://localhost:${port}/admin`);
  console.log(`One-time admin key: ${key}`);
});
