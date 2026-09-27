import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORING_CONFIG } from '@/core/scoring';
import type { KeyValueArea } from './config-repository';
import {
  SCORING_CONFIG_KEY,
  loadScoringConfig,
  resetScoringConfig,
  saveScoringConfig,
} from './scoring-config-repository';

function memoryArea(initial: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...initial };
  const area: KeyValueArea = {
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
  return { area, data };
}

describe('scoring config repository', () => {
  it('defaults when nothing is stored', async () => {
    expect(await loadScoringConfig(memoryArea().area)).toEqual({
      config: DEFAULT_SCORING_CONFIG,
      fromDefaults: true,
    });
  });

  it('round-trips a saved config', async () => {
    const { area } = memoryArea();
    const custom = {
      ...DEFAULT_SCORING_CONFIG,
      thresholds: { critical: 80, high: 60, medium: 40 },
    };
    await saveScoringConfig(custom, area);
    expect(await loadScoringConfig(area)).toEqual({ config: custom, fromDefaults: false });
  });

  it.each([
    ['corrupt value', 'garbage'],
    [
      'bad thresholds',
      { ...DEFAULT_SCORING_CONFIG, thresholds: { critical: 50, high: 75, medium: 90 } },
    ],
    ['future version', { ...DEFAULT_SCORING_CONFIG, version: 2 }],
  ])('falls back to defaults for %s', async (_, stored) => {
    const { area } = memoryArea({ [SCORING_CONFIG_KEY]: stored });
    expect((await loadScoringConfig(area)).fromDefaults).toBe(true);
  });

  it('storage failure → defaults on read, clear error on write', async () => {
    const failing: KeyValueArea = {
      get: () => Promise.reject(new Error('x')),
      set: () => Promise.reject(new Error('x')),
      remove: () => Promise.reject(new Error('x')),
    };
    expect((await loadScoringConfig(failing)).fromDefaults).toBe(true);
    await expect(saveScoringConfig(DEFAULT_SCORING_CONFIG, failing)).rejects.toThrow(
      'Could not save scoring configuration',
    );
    await expect(resetScoringConfig(failing)).rejects.toThrow(
      'Could not reset scoring configuration',
    );
  });

  it('never stores an invalid config', async () => {
    const { area, data } = memoryArea();
    const invalid = {
      ...DEFAULT_SCORING_CONFIG,
      weights: { ...DEFAULT_SCORING_CONFIG.weights, email: -1 },
    };
    await expect(saveScoringConfig(invalid, area)).rejects.toThrow('invalid');
    expect(data).toEqual({});
  });

  it('reset restores defaults', async () => {
    const { area } = memoryArea();
    await saveScoringConfig({ ...DEFAULT_SCORING_CONFIG, enabled: false }, area);
    await resetScoringConfig(area);
    expect((await loadScoringConfig(area)).config).toEqual(DEFAULT_SCORING_CONFIG);
  });
});
