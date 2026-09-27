import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AUTOMATION_CONFIG, type MatchEvent } from '@/core/actions';
import { DEFAULT_FILTER_CONFIG, type FilterConfig } from '@/core/filters';
import { DEFAULT_SCORING_CONFIG } from '@/core/scoring';
import { leadCardHtml, mountFixture, type CardSpec } from '@/tests/fixtures/indiamart-lead-card';
import { manualScheduler, settle } from '@/tests/manual-scheduler';
import { LeadScanner } from '../scanner/lead-scanner';
import { AutoClickEngine } from './action-engine';
import { StopOverlay } from './stop-overlay';

/**
 * Real pipeline: DOM → scanner (extract, normalize, filter, score) →
 * LEAD_MATCHED events → Auto-Click → verified resolver → guarded click.
 */

const FILTERS: FilterConfig = {
  ...DEFAULT_FILTER_CONFIG,
  quantity: { enabled: true, min: 1, max: null },
};

function block(spec: CardSpec, n: number): string {
  return `<div id="BLCard${n}" data-n="${n}">${leadCardHtml(spec)}<div class="SLC_dflx SLC_ pr"><button><strong>Contact Buyer</strong></button></div></div>`;
}

function setup(cards: CardSpec[], options: { autoClick?: boolean; scoringOff?: boolean } = {}) {
  mountFixture(
    `<main><section data-fixture-list>${cards.map((c, i) => block(c, i + 1)).join('')}</section></main>`,
  );
  const clicked: string[] = [];
  const listen = () =>
    document.querySelectorAll('[data-n] button').forEach((b) => {
      if ((b as HTMLElement).dataset.listening) return;
      (b as HTMLElement).dataset.listening = '1';
      b.addEventListener('click', () =>
        clicked.push((b.closest('[data-n]') as HTMLElement).dataset.n ?? '?'),
      );
    });
  listen();
  const sched = manualScheduler();
  const scanner = new LeadScanner({
    document,
    getUrl: () => 'https://seller.indiamart.com/bltxn/',
    schedule: sched.schedule,
    frameBudgetMs: 10_000,
    filterConfig: FILTERS,
    ...(options.scoringOff ? { scoringConfig: { ...DEFAULT_SCORING_CONFIG, enabled: false } } : {}),
  });
  let now = 5_000_000;
  const timers: { at: number; fn: () => void }[] = [];
  const engine = new AutoClickEngine({
    leads: {
      getCard: (id) => scanner.getCardForLead(id),
      getFacts: (id) => scanner.getLeadFacts(id),
    },
    config: { ...DEFAULT_AUTOMATION_CONFIG, autoClickEnabled: false },
    now: () => now,
    setTimer: (fn, ms) => timers.push({ at: now + ms, fn }),
    clearTimer: () => timers.splice(0),
    isVisible: () => true,
  });
  const matchEvents: MatchEvent[] = [];
  // As in the content script: every LEAD_MATCHED event goes to the engine.
  scanner.on((e) => {
    if (e.type === 'LEAD_MATCHED') {
      matchEvents.push(e.event);
      engine.onMatchEvent(e.event);
    }
  });
  engine.setConfig({ ...DEFAULT_AUTOMATION_CONFIG, autoClickEnabled: options.autoClick ?? true });
  const advance = (ms: number) => {
    const target = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const t = timers[0];
      if (!t || t.at > target) break;
      timers.shift();
      now = t.at;
      t.fn();
    }
    now = target;
  };
  const flush = async () => {
    await settle();
    sched.run();
  };
  scanner.start();
  return { scanner, engine, clicked, advance, flush, listen, matchEvents };
}

afterEach(() => vi.restoreAllMocks());

const US = (title: string, qty = '50 Strip'): CardSpec => ({
  title,
  country: 'USA',
  rows: [['Quantity', qty]],
});

describe('filter MATCHED → match event → Contact Buyer (real scanner)', () => {
  it('matched leads are clicked automatically with no Start; rejected leads never', () => {
    const { clicked, advance, scanner, matchEvents } = setup([
      { title: 'Rejected Lead Tablets', country: 'Qatar', rows: [['Quantity', '50 Strip']] },
      US('Matched One Tablets'),
      US('Matched Two Capsules', '2 Box'),
    ]);
    expect(scanner.listLeadFacts().map((f) => f.status)).toEqual([
      'REJECTED',
      'MATCHED',
      'MATCHED',
    ]);
    expect(matchEvents).toHaveLength(2);
    expect(new Set(matchEvents.map((e) => e.matchEventId)).size).toBe(2);
    advance(60_000);
    expect(clicked).toEqual(['2', '3']);
  });

  it('Auto-Click OFF: matched leads are not clicked', () => {
    const { clicked, advance } = setup([US('Matched One Tablets')], { autoClick: false });
    advance(60_000);
    expect(clicked).toEqual([]);
  });

  it('7–8. a LOW-scoring or unscored MATCHED lead is still clicked', () => {
    const low = setup([
      {
        ...US('Low Score Tablets', '1 Box'),
        contact: { mobile: true },
        buys: null,
        breadcrumbs: null,
        age: null,
      },
    ]);
    expect(low.scanner.getSnapshot().results[0]).toMatchObject({
      status: 'MATCHED',
      priority: 'LOW',
    });
    low.advance(60_000);
    expect(low.clicked).toEqual(['1']);

    const unscored = setup([US('Unscored Tablets')], { scoringOff: true });
    expect(unscored.scanner.getSnapshot().results[0]?.priority).toBe('UNSCORED');
    unscored.advance(60_000);
    expect(unscored.clicked).toEqual(['1']);
  });

  it('4. MATCHED → REJECTED → MATCHED (filter changes) → two clicks', () => {
    const { clicked, advance, scanner, matchEvents } = setup([US('Matched One Tablets')]);
    advance(60_000);
    expect(clicked).toEqual(['1']);
    const onlyCanada = {
      ...FILTERS,
      countries: { ...FILTERS.countries, values: [{ value: 'Canada', enabled: true }] },
    };
    scanner.setFilterConfig(onlyCanada); // now REJECTED: no event, no click
    advance(60_000);
    expect(clicked).toEqual(['1']);
    scanner.setFilterConfig(FILTERS); // MATCHED again: a new, genuine event
    advance(60_000);
    expect(clicked).toEqual(['1', '1']);
    expect(new Set(matchEvents.map((e) => e.matchEventId)).size).toBe(2);
    expect(matchEvents.map((e) => e.trigger)).toEqual(['detected', 'filters']);
  });

  it('5. a lead re-evaluated as MATCHED after an update is a new event → another click', async () => {
    const { clicked, advance, flush, matchEvents } = setup([US('Matched One Tablets', '50 Strip')]);
    advance(60_000);
    expect(clicked).toEqual(['1']);
    (document.querySelector('.BuyLdC_isqdet strong') as Element).textContent = '80 Strip';
    await flush(); // LEAD_UPDATED → re-evaluated → MATCHED → new matchEventId
    advance(60_000);
    expect(clicked).toEqual(['1', '1']);
    expect(matchEvents.map((e) => e.trigger)).toEqual(['detected', 'updated']);
  });

  it('a duplicate DOM copy of the same lead is not a new event → no extra click', async () => {
    const { clicked, advance, flush, listen, matchEvents } = setup([US('Matched One Tablets')]);
    advance(60_000);
    const list = document.querySelector('[data-fixture-list]') as Element;
    list.insertAdjacentHTML('beforeend', block(US('Matched One Tablets'), 9));
    listen();
    await flush();
    advance(60_000);
    expect(clicked).toEqual(['1']);
    expect(matchEvents).toHaveLength(1);
  });

  it('a DOM mutation that changes nothing the filters use is not a new event', async () => {
    const { clicked, advance, flush, matchEvents } = setup([US('Matched One Tablets')]);
    advance(60_000);
    // Lead age ticks: a DOM change, no new filter evaluation.
    const age = Array.from(document.querySelectorAll('strong')).find((s) =>
      /ago/.test(s.textContent ?? ''),
    );
    if (age) age.textContent = '23 mins ago';
    await flush();
    advance(60_000);
    expect(clicked).toEqual(['1']);
    expect(matchEvents).toHaveLength(1);
  });

  it('re-applying filters does not create events for leads that were already MATCHED', () => {
    const { clicked, advance, scanner, matchEvents } = setup([US('Matched One Tablets')]);
    advance(60_000);
    scanner.setFilterConfig({ ...FILTERS, logic: { mode: 'OR' } }); // still MATCHED
    advance(60_000);
    expect(matchEvents).toHaveLength(1);
    expect(clicked).toEqual(['1']);
  });

  it('13. a card whose title changed to another lead is not clicked', () => {
    const { engine, clicked, advance, matchEvents } = setup([US('Matched One Tablets')], {
      autoClick: false,
    });
    const original = matchEvents[0] as MatchEvent;
    // The card now shows another lead; the scanner has not re-read it yet.
    (document.querySelector('.BuyLdC_m6') as Element).textContent = 'Different Lead';
    engine.setConfig(DEFAULT_AUTOMATION_CONFIG);
    engine.onMatchEvent({ ...original, matchEventId: 'm-late' });
    advance(60_000);
    expect(clicked).toEqual([]);
    expect(engine.snapshot().history[0]).toMatchObject({ errorCode: 'IDENTITY_MISMATCH' });
  });

  it('the on-page STOP turns Auto-Click off at once', () => {
    const { engine, clicked, advance } = setup([
      US('One Tablets'),
      US('Two Tablets'),
      US('Three Tablets'),
    ]);
    const overlay = new StopOverlay(document, () => engine.stop());
    overlay.show('Auto-Click ON');
    advance(0);
    expect(clicked).toEqual(['1']);
    document
      .querySelector('[data-imsli-overlay]')
      ?.shadowRoot?.querySelector('button')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(engine.getState()).toBe('OFF');
    advance(10 * 60_000);
    expect(clicked).toEqual(['1']);
  });
});
