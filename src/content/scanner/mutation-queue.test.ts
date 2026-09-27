import { describe, expect, it, vi } from 'vitest';
import { manualScheduler } from '@/tests/manual-scheduler';
import { MutationQueue, frameScheduler, type MutationBatch } from './mutation-queue';

function record(target: Node, added: Node[] = []): MutationRecord {
  return { target, addedNodes: added as unknown as NodeList } as unknown as MutationRecord;
}

describe('MutationQueue', () => {
  it('coalesces many records into one scheduled flush', () => {
    const s = manualScheduler();
    const batches: MutationBatch[] = [];
    const q = new MutationQueue((b) => batches.push(b), s.schedule);
    const parent = document.createElement('div');
    const a = document.createElement('p');
    const b = document.createElement('p');
    q.push([record(parent, [a])]);
    q.push([record(parent, [b, document.createTextNode('t')]), record(parent, [a])]);
    expect(s.scheduled).toBe(1);
    s.run();
    expect(batches).toHaveLength(1);
    expect([...(batches[0]?.added ?? [])]).toEqual([a, b]);
    expect(batches[0]?.targets.size).toBe(1);
    expect(batches[0]?.mutationCount).toBe(3);
  });

  it('switches to a single rescan when too much is queued', () => {
    const s = manualScheduler();
    const batches: MutationBatch[] = [];
    const q = new MutationQueue((b) => batches.push(b), s.schedule, 5);
    const parent = document.createElement('div');
    q.push(Array.from({ length: 10 }, () => record(parent, [document.createElement('p')])));
    s.run();
    expect(batches[0]?.overflow).toBe(true);
    expect(batches[0]?.added.size).toBe(0);
  });

  it('clear() cancels the scheduled flush', () => {
    const s = manualScheduler();
    const onFlush = vi.fn();
    const q = new MutationQueue(onFlush, s.schedule);
    q.push([record(document.body, [document.createElement('p')])]);
    q.clear();
    s.run();
    expect(onFlush).not.toHaveBeenCalled();
    expect(q.pending).toBe(false);
  });

  it('frameScheduler runs once via animation frame or timeout, whichever is first', async () => {
    vi.useFakeTimers();
    const cb = vi.fn();
    frameScheduler(cb);
    await vi.advanceTimersByTimeAsync(300);
    expect(cb).toHaveBeenCalledTimes(1);
    const cancelled = vi.fn();
    frameScheduler(cancelled)();
    await vi.advanceTimersByTimeAsync(300);
    expect(cancelled).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
