import { describe, expect, it } from 'vitest';
import {
  ACTION_SELECTORS,
  CONTACT_BUYER,
  FIELD_SELECTORS,
  INDIAMART_PAGE,
  LABELED_ROWS,
  LEAD_CARD,
  type SelectorStrategy,
} from './indiamart-selectors';
import { isStableSelector } from './selector-resolver';

/** Guards the DOM-resilience rules for every selector in the adapter. */
function allCssSelectors(): string[] {
  const fromStrategies = (list: readonly SelectorStrategy[]) =>
    list.map((s) => (s.kind === 'css' ? s.selector : s.scope));
  return [
    ...Object.values(FIELD_SELECTORS).flatMap((f) => fromStrategies(f.strategies)),
    ...Object.values(ACTION_SELECTORS).flatMap((f) => fromStrategies(f.strategies)),
    ...fromStrategies(CONTACT_BUYER.selector.strategies),
    CONTACT_BUYER.cardContainer,
    CONTACT_BUYER.titleAnchor,
    ...LABELED_ROWS.map((r) => r.rowSelector),
    ...LEAD_CARD.anchors,
    ...LEAD_CARD.uniquePerCard,
    ...LEAD_CARD.signals.flatMap((s) => (s.selector ? [s.selector] : [])),
    ...(LEAD_CARD.containerSelector ? [LEAD_CARD.containerSelector] : []),
    ...INDIAMART_PAGE.leadListSignals,
  ];
}

describe('IndiaMART selector map', () => {
  const selectors = allCssSelectors();

  it.each(selectors)('%s is valid CSS', (selector) => {
    expect(() => document.createDocumentFragment().querySelector(selector)).not.toThrow();
  });

  it.each(selectors)('%s avoids positional pseudo-classes', (selector) => {
    expect(selector).not.toMatch(
      /:(nth-|first-child|last-child|only-child|first-of-type|last-of-type)/,
    );
  });

  it.each(selectors)('%s passes the runtime stability check', (selector) => {
    expect(isStableSelector(selector)).toBe(true);
  });

  it.each(selectors)('%s avoids generated numeric IDs', (selector) => {
    expect(selector).not.toMatch(/#[\w-]*\d{3,}/);
  });

  it.each(selectors)('%s is not a long copied path', (selector) => {
    for (const part of selector.split(',')) {
      const hops = part
        .trim()
        .split(/\s*[>+~]\s*|\s+/)
        .filter(Boolean).length;
      expect(hops).toBeLessThanOrEqual(3);
    }
  });

  it('keeps strategy confidence in 0..1 and ordered from strongest to weakest', () => {
    for (const field of [...Object.values(FIELD_SELECTORS), ...Object.values(ACTION_SELECTORS)]) {
      const confidences = field.strategies.map((s) => s.confidence);
      for (const c of confidences) expect(c).toBeGreaterThan(0);
      for (const c of confidences) expect(c).toBeLessThanOrEqual(1);
      expect([...confidences].sort((a, b) => b - a)).toEqual(confidences);
    }
  });

  it('card signal weights sum to 1 and the threshold is reachable', () => {
    const total = LEAD_CARD.signals.reduce((sum, s) => sum + s.weight, 0);
    expect(total).toBeCloseTo(1, 5);
    const reachable = LEAD_CARD.signals
      .filter((s) => s.selector !== null)
      .reduce((sum, s) => sum + s.weight, 0);
    expect(reachable).toBeGreaterThanOrEqual(LEAD_CARD.threshold);
  });

  it.each([
    'div:nth-child(3) > span',
    '#ember1234 .title',
    'body > div > div > main > ul > li',
    'li:first-child',
    '::::',
  ])('rejects unstable selector %s', (selector) => {
    expect(isStableSelector(selector)).toBe(false);
  });

  it('matches only the seller host', () => {
    expect(INDIAMART_PAGE.hostPattern.test('https://seller.indiamart.com/bltxn/')).toBe(true);
    expect(INDIAMART_PAGE.hostPattern.test('https://www.indiamart.com/')).toBe(false);
    expect(INDIAMART_PAGE.hostPattern.test('https://seller.indiamart.com.evil.io/')).toBe(false);
  });
});
