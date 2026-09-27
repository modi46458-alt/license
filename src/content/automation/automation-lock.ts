import type { KeyValueArea } from '@/storage/config-repository';

/**
 * One automation run across all IndiaMART tabs: a lock in chrome.storage.local
 * with a heartbeat. A lock whose heartbeat is older than STALE_MS (tab closed
 * or crashed) can be taken over.
 */

export const AUTOMATION_LOCK_KEY = 'automation.lock';
export const LOCK_STALE_MS = 30_000;

interface Lock {
  readonly token: string;
  readonly heartbeatAt: number;
}

function parse(input: unknown): Lock | null {
  if (typeof input !== 'object' || input === null) return null;
  const { token, heartbeatAt } = input as Partial<Lock>;
  return typeof token === 'string' && typeof heartbeatAt === 'number'
    ? { token, heartbeatAt }
    : null;
}

export class AutomationLock {
  constructor(
    private readonly token: string,
    private readonly now: () => number,
    private readonly area: () => KeyValueArea = () => chrome.storage.local,
  ) {}

  /** true when this tab holds the lock afterwards. */
  async acquire(): Promise<boolean> {
    try {
      const stored = parse((await this.area().get(AUTOMATION_LOCK_KEY))[AUTOMATION_LOCK_KEY]);
      if (
        stored &&
        stored.token !== this.token &&
        this.now() - stored.heartbeatAt < LOCK_STALE_MS
      ) {
        return false;
      }
      await this.area().set({
        [AUTOMATION_LOCK_KEY]: { token: this.token, heartbeatAt: this.now() },
      });
      return true;
    } catch {
      return false; // cannot prove exclusivity → do not run
    }
  }

  async heartbeat(): Promise<void> {
    try {
      await this.area().set({
        [AUTOMATION_LOCK_KEY]: { token: this.token, heartbeatAt: this.now() },
      });
    } catch {
      /* next heartbeat retries */
    }
  }

  async release(): Promise<void> {
    try {
      const stored = parse((await this.area().get(AUTOMATION_LOCK_KEY))[AUTOMATION_LOCK_KEY]);
      if (stored?.token === this.token) await this.area().remove(AUTOMATION_LOCK_KEY);
    } catch {
      /* goes stale on its own */
    }
  }
}
