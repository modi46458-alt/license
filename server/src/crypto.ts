import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/** Crockford-style alphabet without I, L, O, U (no look-alikes). */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const LICENSE_CODE_PATTERN = /^IMS-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

/** IMS-XXXX-XXXX-XXXX from a CSPRNG (~60 bits). Shown to the admin once. */
export function generateLicenseCode(): string {
  const block = () =>
    Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return `IMS-${block()}-${block()}-${block()}`;
}

export function normalizeLicenseCode(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, '');
}

/** Keyed hash of a license code: the raw code is never stored. */
export function hashLicenseCode(code: string, pepper: string): string {
  return createHmac('sha256', pepper).update(normalizeLicenseCode(code)).digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function randomId(): string {
  return randomBytes(12).toString('base64url');
}

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 64, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, keyB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scryptAsync(
    password,
    Buffer.from(saltB64, 'base64'),
    expected.length,
    SCRYPT,
  );
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Constant-time string comparison (for CSRF tokens). */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
