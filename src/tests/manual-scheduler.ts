import type { Scheduler } from '@/content/scanner/mutation-queue';

/** Deterministic scheduler for tests: callbacks run only when `run()` is called. */
export function manualScheduler() {
  const queue: Array<() => void> = [];
  const schedule: Scheduler = (cb) => {
    queue.push(cb);
    return () => {
      const i = queue.indexOf(cb);
      if (i >= 0) queue.splice(i, 1);
    };
  };
  return {
    schedule,
    get scheduled() {
      return queue.length;
    },
    /** Run everything scheduled, including work scheduled while running. */
    run(): number {
      let ran = 0;
      while (queue.length > 0 && ran < 1000) {
        queue.shift()?.();
        ran++;
      }
      return ran;
    },
  };
}

/** MutationObserver callbacks are microtasks. */
export const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
