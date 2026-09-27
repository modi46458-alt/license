/**
 * Server configuration from the environment. Secrets are required and never
 * have defaults; the server refuses to start without them. No secret is
 * ever shipped inside the Chrome extension.
 */
export interface ServerConfig {
  readonly port: number;
  /** MongoDB connection string, e.g. mongodb+srv://… */
  readonly mongoUri: string;
  /** HMAC key for license-code and device-id hashes (≥ 32 chars). */
  readonly licensePepper: string;
  /** SHA-256 (hex) of the admin API key. The key itself is never stored. */
  readonly adminKeySha256: string;
  /** Reject plain-HTTP requests (X-Forwarded-Proto behind a TLS proxy). */
  readonly requireHttps: boolean;
  /** Proxy hops to trust for client IPs (rate limiting). */
  readonly trustProxy: number;
}

export function loadConfig(env: NodeJS.ProcessEnv): ServerConfig {
  const pepper = env.LICENSE_PEPPER ?? '';
  if (pepper.length < 32) {
    throw new Error('LICENSE_PEPPER must be a random secret of at least 32 characters.');
  }
  const adminKeySha256 = (env.ADMIN_API_KEY_SHA256 ?? '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(adminKeySha256)) {
    throw new Error(
      'ADMIN_API_KEY_SHA256 must be the SHA-256 hex of the admin API key (npm run admin:key).',
    );
  }
  const mongoUri = env.MONGODB_URI ?? '';
  if (!mongoUri.startsWith('mongodb')) throw new Error('MONGODB_URI must be set.');
  const production = env.NODE_ENV === 'production';
  return {
    port: Number(env.PORT ?? 8787),
    mongoUri,
    licensePepper: pepper,
    adminKeySha256,
    requireHttps: env.REQUIRE_HTTPS ? env.REQUIRE_HTTPS === 'true' : production,
    trustProxy: Number(env.TRUST_PROXY ?? (production ? 1 : 0)),
  };
}
