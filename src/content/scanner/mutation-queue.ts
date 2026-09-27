/** Schedules `cb` once; returns a cancel function. */
export type Scheduler = (cb: () => void) => () => void;

/**
 * Default scheduler: next animation frame, with a timeout fallback because
 * Chrome pauses requestAnimationFrame in background tabs and leads should
 * still be picked up while the seller works in another tab.
 */
export const frameScheduler: Scheduler = (cb) => {
  let done = false;
  let frame = 0;
  const run = () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    cb();
  };
  frame = requestAnimationFrame(run);
  const timer = setTimeout(run, 250);
  return () => {
    done = true;
    cancelAnimationFrame(frame);
    clearTimeout(timer);
  };
};

export interface MutationBatch {
  /** Elements added since the last flush (text nodes excluded). */
  readonly added: ReadonlySet<Element>;
  /** Parents of childList changes, used to find re-rendered known cards. */
  readonly targets: ReadonlySet<Element>;
  /** Too many nodes queued: cheaper to rescan once than walk each node. */
  readonly overflow: boolean;
  readonly mutationCount: number;
}

/**
 * Collects MutationRecords into Sets and flushes them in one scheduled batch.
 * Never touches the DOM itself.
 */
export class MutationQueue {
  private added = new Set<Element>();

  /** Nodes waiting for the next batch. */
  get size(): number {
    return this.added.size + this.targets.size;
  }
  private targets = new Set<Element>();
  private overflow = false;
  private mutationCount = 0;
  private cancel: (() => void) | null = null;

  constructor(
    private readonly onFlush: (batch: MutationBatch) => void,
    private readonly schedule: Scheduler = frameScheduler,
    private readonly maxQueued = 2000,
  ) {}

  push(records: readonly MutationRecord[]): void {
    for (const record of records) {
      this.mutationCount++;
      if (this.overflow) continue;
      if (record.target instanceof Element) this.targets.add(record.target);
      for (const node of Array.from(record.addedNodes)) {
        if (node instanceof Element) this.added.add(node);
      }
      if (this.added.size + this.targets.size > this.maxQueued) {
        this.overflow = true;
        this.added.clear();
        this.targets.clear();
      }
    }
    this.request();
  }

  /** Schedule a flush even without mutations (navigation, activation checks). */
  request(): void {
    this.cancel ??= this.schedule(() => this.flush());
  }

  flush(): void {
    this.cancel?.();
    this.cancel = null;
    const batch: MutationBatch = {
      added: this.added,
      targets: this.targets,
      overflow: this.overflow,
      mutationCount: this.mutationCount,
    };
    this.added = new Set();
    this.targets = new Set();
    this.overflow = false;
    this.mutationCount = 0;
    this.onFlush(batch);
  }

  clear(): void {
    this.cancel?.();
    this.cancel = null;
    this.added.clear();
    this.targets.clear();
    this.overflow = false;
    this.mutationCount = 0;
  }

  get pending(): boolean {
    return this.cancel !== null;
  }
}
