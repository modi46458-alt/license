import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { LicenseService } from './license-service.js';
import { MongoLicenseRepository } from './mongo-repository.js';
import { attachRealtime } from './realtime.js';

/** Entry point: node dist/server.js (behind a TLS-terminating proxy in production). */
async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const connection = await mongoose.createConnection(config.mongoUri).asPromise();
  const service = new LicenseService(new MongoLicenseRepository(connection), config.licensePepper);
  const app = createApp({
    service,
    adminKeySha256: config.adminKeySha256,
    requireHttps: config.requireHttps,
    trustProxy: config.trustProxy,
    // Built admin panel (npm run build:admin), served under /admin.
    adminUiDir: resolve(dirname(fileURLToPath(import.meta.url)), '../public/admin'),
  });
  const server = createServer(app);
  attachRealtime(server, service);
  server.listen(config.port, () => console.log(`[license-server] listening on :${config.port}`));
}

main().catch((error: unknown) => {
  console.error(
    '[license-server] failed to start:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
