import { randomBytes } from 'node:crypto';
import { sha256 } from '../crypto.js';

/**
 * Generates an admin API key. Print the key once for the administrator and
 * put only its SHA-256 into the server environment (ADMIN_API_KEY_SHA256).
 */
const key = randomBytes(32).toString('base64url');
console.log(`Admin API key (store it in a password manager, shown once):\n  ${key}\n`);
console.log(`Server environment:\n  ADMIN_API_KEY_SHA256=${sha256(key)}`);
