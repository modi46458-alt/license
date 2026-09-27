import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTER_CONFIG } from '@/core/filters';
import {
  FILTER_CONFIG_KEY,
  loadFilterConfig,
  resetFilterConfig,
  saveFilterConfig,
  type KeyValueArea,
} from './filter-config-repository';

function memoryArea(initial: Record<string, unknown> = {}): KeyValueArea & {
  data: Record<string, unknown>;
} {
  const data = { ...initial };
  return {
    data,
    get: (key) => Promise.resolve(key in data ? { [key]: data[key] } : {}),
    set: (items) => {
      Object.assign(data, structuredClone(items));
      return Promise.resolve();
    },
    remove: (key) => {
      delete data[key];
      return Promise.resolve();
    },
  };
}

describe('filter config repository', () => {
  it('returns defaults when nothing is stored', async () => {
    expect(await loadFilterConfig(memoryArea())).toEqual({
      config: DEFAULT_FILTER_CONFIG,
      fromDefaults: true,
    });
  });

  it('round-trips a saved config', async () => {
    const area = memoryArea();
    const custom = { ...DEFAULT_FILTER_CONFIG, logic: { mode: 'OR' as const } };
    await saveFilterConfig(custom, area);
    expect(await loadFilterConfig(area)).toEqual({ config: custom, fromDefaults: false });
  });

  it.each([
    ['garbage string', 'not json'],
    ['wrong version', { ...DEFAULT_FILTER_CONFIG, version: 99 }],
    ['broken group', { ...DEFAULT_FILTER_CONFIG, quantity: 'x' }],
  ])('falls back to defaults for %s', async (_, stored) => {
    const loaded = await loadFilterConfig(memoryArea({ [FILTER_CONFIG_KEY]: stored }));
    expect(loaded).toEqual({ config: DEFAULT_FILTER_CONFIG, fromDefaults: true });
  });

  it('falls back to defaults when storage itself fails', async () => {
    const failing: KeyValueArea = {
      get: () => Promise.reject(new Error('quota')),
      set: () => Promise.reject(new Error('quota')),
      remove: () => Promise.reject(new Error('quota')),
    };
    expect((await loadFilterConfig(failing)).fromDefaults).toBe(true);
    await expect(saveFilterConfig(DEFAULT_FILTER_CONFIG, failing)).rejects.toThrow(
      'Could not save filter configuration',
    );
  });

  it('never stores an invalid config', async () => {
    const area = memoryArea();
    const invalid = { ...DEFAULT_FILTER_CONFIG, quantity: { enabled: true, min: 50, max: 10 } };
    await expect(saveFilterConfig(invalid, area)).rejects.toThrow('invalid');
    expect(area.data).toEqual({});
  });

  it('reset removes the stored config', async () => {
    const area = memoryArea();
    await saveFilterConfig({ ...DEFAULT_FILTER_CONFIG, enabled: false }, area);
    await resetFilterConfig(area);
    expect((await loadFilterConfig(area)).fromDefaults).toBe(true);
  });
});

describe('recovering filters saved in chrome.storage.local by another build', () => {
  it('moves a valid local copy back to sync once', async () => {
    const sync = memoryArea();
    const local = memoryArea({
      [FILTER_CONFIG_KEY]: { ...DEFAULT_FILTER_CONFIG, logic: { mode: 'OR' } },
    });
    const loaded = await loadFilterConfig(sync, local);
    expect(loaded).toEqual({
      config: { ...DEFAULT_FILTER_CONFIG, logic: { mode: 'OR' } },
      fromDefaults: false,
    });
    expect(sync.data[FILTER_CONFIG_KEY]).toEqual({
      ...DEFAULT_FILTER_CONFIG,
      logic: { mode: 'OR' },
    });
    expect(local.data).toEqual({});
  });

  it('ignores a local copy that is invalid under these limits (e.g. 500 keywords)', async () => {
    const big = {
      ...DEFAULT_FILTER_CONFIG,
      keywords: {
        ...DEFAULT_FILTER_CONFIG.keywords,
        values: Array.from({ length: 500 }, (_, i) => ({ value: `K${i}`, enabled: true })),
      },
    };
    const loaded = await loadFilterConfig(memoryArea(), memoryArea({ [FILTER_CONFIG_KEY]: big }));
    expect(loaded.fromDefaults).toBe(true);
  });

  it('a sync copy always wins', async () => {
    const sync = memoryArea({ [FILTER_CONFIG_KEY]: DEFAULT_FILTER_CONFIG });
    const local = memoryArea({ [FILTER_CONFIG_KEY]: { ...DEFAULT_FILTER_CONFIG, enabled: false } });
    expect((await loadFilterConfig(sync, local)).config).toEqual(DEFAULT_FILTER_CONFIG);
  });
});
