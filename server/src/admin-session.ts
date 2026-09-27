import { randomToken, safeEqual, sha256 } from './crypto.js';

/**
 * Server-side admin sessions for the web panel. The browser only holds an
 * opaque random id in an HttpOnly, SameSite=Strict cookie; the admin key is
 * checked once at login and never stored anywhere. Ids are kept hashed.
 * Sessions end after 30 minutes idle or 8 hours in total, or on logout.
 * State-changing requests must also carry the session's CSRF token.
 *
 * In-memory: sessions end on restart and are per process (run one instance,
 * or add a shared store behind this class).
 */

export const SESSION_COOKIE = 'imsli_admin';
export const IDLE_MS = 30 * 60_000;
export const ABSOLUTE_MS = 8 * 60 * 60_000;

interface Session {
  readonly csrf: string;
  readonly createdAt: number;
  lastSeenAt: number;
  readonly ip: string | null;
}

export class AdminSessions {
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly now: () => number = Date.now) {}

  create(ip: string | null): { id: string; csrf: string; expiresAt: number } {
    this.sweep();
    const id = randomToken();
    const csrf = randomToken();
    const now = this.now();
    this.sessions.set(sha256(id), { csrf, createdAt: now, lastSeenAt: now, ip });
    return { id, csrf, expiresAt: this.expiresAt({ createdAt: now, lastSeenAt: now }) };
  }

  /** Valid session for this cookie value (refreshes the idle timer), or null. */
  get(id: string | undefined): { csrf: string; expiresAt: number } | null {
    if (!id) return null;
    const key = sha256(id);
    const session = this.sessions.get(key);
    if (!session) return null;
    const now = this.now();
    if (now - session.lastSeenAt > IDLE_MS || now - session.createdAt > ABSOLUTE_MS) {
      this.sessions.delete(key);
      return null;
    }
    session.lastSeenAt = now;
    return { csrf: session.csrf, expiresAt: this.expiresAt(session) };
  }

  checkCsrf(id: string | undefined, token: string | undefined): boolean {
    const session = id ? this.sessions.get(sha256(id)) : undefined;
    return Boolean(session && token && safeEqual(session.csrf, token));
  }

  destroy(id: string | undefined): void {
    if (id) this.sessions.delete(sha256(id));
  }

  private expiresAt(s: Pick<Session, 'createdAt' | 'lastSeenAt'>): number {
    return Math.min(s.lastSeenAt + IDLE_MS, s.createdAt + ABSOLUTE_MS);
  }

  private sweep(): void {
    const now = this.now();
    for (const [key, s] of this.sessions) {
      if (now - s.lastSeenAt > IDLE_MS || now - s.createdAt > ABSOLUTE_MS)
        this.sessions.delete(key);
    }
  }
}

/** Minimal cookie header parser (no dependency). */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}
