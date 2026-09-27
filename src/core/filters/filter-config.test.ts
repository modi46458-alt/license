import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILTER_CONFIG,
  FILTER_CONFIG_VERSION,
  FILTER_LIMITS,
  configOrDefault,
  parseFilterConfig,
  summarizeFilterConfig,
} from './index';

const clone = (): Record<string, unknown> => ({ ...structuredClone(DEFAULT_FILTER_CONFIG) });

describe('default config', () => {
  it('matches the Phase 4 defaults', () => {
    const on = (t: readonly { value: string; enabled: boolean }[]) =>
      t.filter((x) => x.enabled).map((x) => x.value);
    const c = DEFAULT_FILTER_CONFIG;
    expect(c.version).toBe(FILTER_CONFIG_VERSION);
    expect(on(c.countries.values)).toEqual([
      'Canada',
      'United States',
      'United Kingdom',
      'Australia',
      'New Zealand',
    ]);
    expect(on(c.keywords.values)).toEqual([
      'Medicine',
      'Tablet',
      'Capsule',
      'Injection',
      'Pharmaceutical',
    ]);
    expect(on(c.negativeKeywords.values)).toEqual(['Retail', 'Personal Use', 'Home Use']);
    expect(c.quantity).toEqual({ enabled: true, min: 20, max: null });
    expect(c.contact).toMatchObject({
      enabled: true,
      mode: 'ANY',
      mobile: true,
      whatsapp: true,
      email: true,
    });
    expect(c.leadAge.enabled).toBe(false);
    expect(c.logic.mode).toBe('AND');
  });

  it('is itself valid', () => {
    expect(parseFilterConfig(DEFAULT_FILTER_CONFIG)).toEqual(DEFAULT_FILTER_CONFIG);
  });

  it('fits chrome.storage.sync limits even at maximum size', () => {
    const big = {
      ...DEFAULT_FILTER_CONFIG,
      keywords: {
        ...DEFAULT_FILTER_CONFIG.keywords,
        values: Array.from({ length: FILTER_LIMITS.maxTerms }, (_, i) => ({
          value: `k${i}`.padEnd(FILTER_LIMITS.maxTermLength, 'x'),
          enabled: true,
        })),
      },
    };
    expect(parseFilterConfig(big)).not.toBeNull();
    // 8 KB per item quota (JSON length of key + value).
    expect(JSON.stringify(big).length).toBeLessThan(8192);
  });
});

describe('parseFilterConfig rejects invalid input', () => {
  const cases: Array<[string, (c: Record<string, unknown>) => unknown]> = [
    ['null', () => null],
    ['array', () => []],
    ['string', () => 'config'],
    ['missing version', (c) => ({ ...c, version: undefined })],
    ['future version', (c) => ({ ...c, version: 2 })],
    ['enabled not boolean', (c) => ({ ...c, enabled: 'yes' })],
    [
      'bad country mode',
      (c) => ({ ...c, countries: { ...(c.countries as object), mode: 'SOME' } }),
    ],
    ['bad logic', (c) => ({ ...c, logic: { mode: 'XOR' } })],
    [
      'term not object',
      (c) => ({ ...c, keywords: { ...(c.keywords as object), values: ['Tablet'] } }),
    ],
    [
      'empty term',
      (c) => ({
        ...c,
        keywords: { ...(c.keywords as object), values: [{ value: ' ', enabled: true }] },
      }),
    ],
    [
      'too long term',
      (c) => ({
        ...c,
        keywords: {
          ...(c.keywords as object),
          values: [{ value: 'x'.repeat(FILTER_LIMITS.maxTermLength + 1), enabled: true }],
        },
      }),
    ],
    [
      'too many terms',
      (c) => ({
        ...c,
        keywords: {
          ...(c.keywords as object),
          values: Array.from({ length: FILTER_LIMITS.maxTerms + 1 }, () => ({
            value: 'a',
            enabled: true,
          })),
        },
      }),
    ],
    [
      'unknown field',
      (c) => ({ ...c, keywords: { ...(c.keywords as object), fields: ['title', 'body'] } }),
    ],
    ['negative min', (c) => ({ ...c, quantity: { enabled: true, min: -1, max: null } })],
    ['NaN max', (c) => ({ ...c, quantity: { enabled: true, min: null, max: Number.NaN } })],
    ['min > max', (c) => ({ ...c, quantity: { enabled: true, min: 50, max: 10 } })],
    [
      'age min > max',
      (c) => ({ ...c, leadAge: { enabled: true, minMinutes: 60, maxMinutes: 10 } }),
    ],
    [
      'contact flag not boolean',
      (c) => ({ ...c, contact: { ...(c.contact as object), email: 1 } }),
    ],
    ['missing group', (c) => ({ ...c, contact: undefined })],
  ];
  it.each(cases)('%s', (_, make) => {
    expect(parseFilterConfig(make(clone()))).toBeNull();
    expect(configOrDefault(make(clone()))).toEqual({
      config: DEFAULT_FILTER_CONFIG,
      fromDefaults: true,
    });
  });

  it('cleans whitespace in terms and de-duplicates fields', () => {
    const c = clone();
    const parsed = parseFilterConfig({
      ...c,
      keywords: {
        ...(c.keywords as object),
        values: [{ value: '  Personal   Use ', enabled: true }],
        fields: ['title', 'title'],
      },
    });
    expect(parsed?.keywords.values).toEqual([{ value: 'Personal Use', enabled: true }]);
    expect(parsed?.keywords.fields).toEqual(['title']);
  });

  it('treats user text as data only', () => {
    const c = clone();
    const parsed = parseFilterConfig({
      ...c,
      keywords: {
        ...(c.keywords as object),
        values: [{ value: '<img onerror=alert(1)>', enabled: true }],
      },
    });
    expect(parsed?.keywords.values[0]?.value).toBe('<img onerror=alert(1)>');
  });
});

describe('summary', () => {
  it('describes the default config', () => {
    expect(summarizeFilterConfig(DEFAULT_FILTER_CONFIG)).toBe(
      'AND · 5 countries ANY · 5 keywords ANY · 3 excluded · qty ≥ 20 · contact ANY',
    );
  });
  it('filters off', () => {
    expect(summarizeFilterConfig({ ...DEFAULT_FILTER_CONFIG, enabled: false })).toBe('Filters off');
  });
});
