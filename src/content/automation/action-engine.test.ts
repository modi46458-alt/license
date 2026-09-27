import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import {
  ACTION_DELAY_OPTIONS_MS,
  DEFAULT_AUTOMATION_CONFIG,
  checkEligibility,
  parseAutomationConfig,
  type AutomationConfig,
  type AutomationEvent,
  type LeadFacts,
  type MatchEvent,
} from '@/core/actions';
import { leadCardHtml, mountFixture } from '@/tests/fixtures/indiamart-lead-card';
import type { KeyValueArea } from '@/storage/config-repository';
import { AutoClickEngine, type EngineLicense, type LeadSource } from './action-engine';
import { AutomationLock, LOCK_STALE_MS } from './automation-lock';
import { clickContactBuyer } from './contact-buyer-executor';

/* ------------------------------------------------------------------ */
/* Harness                                                              */
/* ------------------------------------------------------------------ */

function virtualTime() {
  let now = 1_000_000;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 0;
  return {
    now: () => now,
    setTimer: (fn: () => void, ms: number) => {
      const t = { at: now + ms, fn, id: ++nextId };
      timers.push(t);
      return t.id;
    },
    clearTimer: (h: unknown) => {
      timers = timers.filter((t) => t.id !== h);
    },
    advance(ms: number) {
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
    },
    pending: () => timers.length,
  };
}

interface TestLead {
  id: string;
  title: string;
  status?: 'MATCHED' | 'REJECTED';
  button?: string | null;
}

const BUTTON = '<button type="button"><strong>Contact Buyer</strong></button>';

/** BLCard blocks plus a LeadSource over them; records real clicks per lead. */
function page(leads: TestLead[]) {
  mountFixture(
    `<main><section>${leads
      .map(
        (l, i) =>
          `<div id="BLCard${i + 1}" data-lead="${l.id}">${leadCardHtml({ title: l.title })}${
            l.button === null ? '' : `<div class="SLC_dflx SLC_ pr">${l.button ?? BUTTON}</div>`
          }</div>`,
      )
      .join('')}</section></main>`,
  );
  const clicks: string[] = [];
  document.querySelectorAll('[data-lead] button').forEach((b) =>
    b.addEventListener('click', () => {
      clicks.push((b.closest('[data-lead]') as HTMLElement).dataset.lead ?? '?');
    }),
  );
  const facts = new Map<string, LeadFacts>(
    leads.map((l) => [
      l.id,
      { leadId: l.id, fingerprint: `fp-${l.id}`, title: l.title, status: l.status ?? 'MATCHED' },
    ]),
  );
  const source: LeadSource = {
    getCard: (id) => document.querySelector(`[data-lead="${id}"] article`),
    getFacts: (id) => facts.get(id) ?? null,
  };
  return { clicks, facts, source };
}

let eventSeq = 0;
function matchEvent(leadId: string, id = `m-test-${++eventSeq}`): MatchEvent {
  return {
    matchEventId: id,
    leadId,
    fingerprint: `fp-${leadId}`,
    title: null,
    trigger: 'detected',
    at: 0,
  };
}

const OFF: AutomationConfig = { ...DEFAULT_AUTOMATION_CONFIG, autoClickEnabled: false };

/** Engine built OFF (as on page load), then switched to `config`. */
function engineFor(
  source: LeadSource,
  config: AutomationConfig = DEFAULT_AUTOMATION_CONFIG,
  extra: Partial<ConstructorParameters<typeof AutoClickEngine>[0]> = {},
) {
  const time = virtualTime();
  const events: AutomationEvent[] = [];
  const engine = new AutoClickEngine({
    leads: source,
    config: OFF,
    now: time.now,
    setTimer: time.setTimer,
    clearTimer: time.clearTimer,
    isVisible: () => true,
    ...extra,
  });
  engine.on((e) => events.push(e));
  engine.setConfig(config);
  const statuses = (id: string) =>
    events.flatMap((e) => ('action' in e && e.action.leadId === id ? [e.type] : []));
  return { engine, time, events, statuses };
}

let clickSpy: MockInstance<HTMLElement['click']>;
beforeEach(() => {
  clickSpy = vi.spyOn(HTMLElement.prototype, 'click');
});
afterEach(() => vi.restoreAllMocks());

/* ------------------------------------------------------------------ */
/* Config and eligibility                                               */
/* ------------------------------------------------------------------ */

describe('config', () => {
  it('Auto-Click is ON by default with a 1 s delay', () => {
    expect(DEFAULT_AUTOMATION_CONFIG).toEqual({
      version: 2,
      autoClickEnabled: true,
      delayBetweenActionsMs: 1000,
      maxRetries: 2,
    });
  });

  it.each([
    ['enabled not boolean', { autoClickEnabled: 'yes' }],
    ['zero delay', { delayBetweenActionsMs: 0 }],
    ['delay below 0.5 s', { delayBetweenActionsMs: 499 }],
    ['fractional delay', { delayBetweenActionsMs: 1500.5 }],
    ['delay above 60 s', { delayBetweenActionsMs: 60_001 }],
    ['negative retries', { maxRetries: -1 }],
    ['too many retries', { maxRetries: 6 }],
  ])('rejects %s', (_, patch) => {
    expect(parseAutomationConfig({ ...DEFAULT_AUTOMATION_CONFIG, ...patch })).toBeNull();
  });
});

describe('eligibility: MATCHED is the only lead condition', () => {
  const facts = (status: 'MATCHED' | 'REJECTED'): LeadFacts => ({
    leadId: 'L1',
    fingerprint: 'fp',
    title: 'Lead',
    status,
  });
  it.each([
    ['ON + MATCHED', facts('MATCHED'), DEFAULT_AUTOMATION_CONFIG, true],
    ['ON + REJECTED', facts('REJECTED'), DEFAULT_AUTOMATION_CONFIG, false],
    ['OFF + MATCHED', facts('MATCHED'), OFF, false],
    ['ON, lead gone', null, DEFAULT_AUTOMATION_CONFIG, false],
  ] as const)('%s → eligible %s', (_, f, config, eligible) => {
    expect(checkEligibility(f, config).eligible).toBe(eligible);
  });

  it('facts carry no score, priority or contacted flag', () => {
    expect(Object.keys(facts('MATCHED')).sort()).toEqual([
      'fingerprint',
      'leadId',
      'status',
      'title',
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* Event-based behaviour                                                */
/* ------------------------------------------------------------------ */

describe('one action per MATCHED event', () => {
  it('1. a MATCHED event → exactly one click, queued with no Start', () => {
    const { source, clicks } = page([{ id: 'A', title: 'Alpha Tablets' }]);
    const { engine, time, statuses } = engineFor(source);
    expect('start' in engine).toBe(false); // 9. no manual Start exists
    expect(engine.onMatchEvent(matchEvent('A'))).toBe(true);
    time.advance(60_000);
    expect(clicks).toEqual(['A']);
    expect(statuses('A')).toEqual(['ACTION_QUEUED', 'ACTION_STARTED', 'ACTION_SUCCESS']);
  });

  it('2. the same matchEventId delivered twice → one click', () => {
    const { source, clicks } = page([{ id: 'A', title: 'Alpha Tablets' }]);
    const { engine, time } = engineFor(source);
    const event = matchEvent('A', 'm-same');
    expect(engine.onMatchEvent(event)).toBe(true);
    expect(engine.onMatchEvent(event)).toBe(false);
    time.advance(60_000);
    expect(engine.onMatchEvent({ ...event })).toBe(false); // also after it was clicked
    time.advance(60_000);
    expect(clicks).toEqual(['A']);
  });

  it('3. different matchEventIds → separate clicks', () => {
    const { source, clicks } = page([
      { id: 'A', title: 'Alpha Tablets' },
      { id: 'B', title: 'Beta Capsules' },
    ]);
    const { engine, time } = engineFor(source);
    engine.onMatchEvent(matchEvent('A'));
    engine.onMatchEvent(matchEvent('B'));
    time.advance(60_000);
    expect(clicks).toEqual(['A', 'B']);
  });

  it('4. MATCHED → REJECTED → MATCHED → two clicks', () => {
    const { source, clicks, facts } = page([{ id: 'A', title: 'Alpha Tablets' }]);
    const { engine, time } = engineFor(source);
    engine.onMatchEvent(matchEvent('A'));
    time.advance(60_000);
    facts.set('A', { ...facts.get('A')!, status: 'REJECTED' }); // no event while rejected
    time.advance(60_000);
    facts.set('A', { ...facts.get('A')!, status: 'MATCHED' });
    engine.onMatchEvent(matchEvent('A'));
    time.advance(60_000);
    expect(clicks).toEqual(['A', 'A']);
  });

  it('5. the same logical lead with several genuine MATCHED evaluations → several clicks', () => {
    const { source, clicks } = page([{ id: 'A', title: 'Alpha Tablets' }]);
    const { engine, time } = engineFor(source);
    for (let i = 0; i < 3; i++) engine.onMatchEvent(matchEvent('A'));
    time.advance(60_000);
    expect(clicks).toEqual(['A', 'A', 'A']);
    const history = engine.snapshot().history;
    expect(new Set(history.map((r) => r.matchEventId)).size).toBe(3);
    expect(new Set(history.map((r) => r.leadId))).toEqual(new Set(['A']));
  });

  it('6. Auto-Click OFF → zero clicks, events are not queued', () => {
    const { source, clicks } = page([{ id: 'A', title: 'Alpha Tablets' }]);
    const { engine, time, events } = engineFor(source, OFF);
    expect(engine.onMatchEvent(matchEvent('A'))).toBe(false);
    time.advance(60_000);
    expect(engine.getState()).toBe('OFF');
    expect(clicks).toEqual([]);
    expect(events).toEqual([]);
  });

  it('an event that arrived while OFF is not acted on when switched ON later', () => {
    const { source, clicks } = page([{ id: 'A', title: 'Alpha Tablets' }]);
    const { engine, time } = engineFor(source, OFF);
    engine.onMatchEvent(matchEvent('A'));
    engine.setConfig(DEFAULT_AUTOMATION_CONFIG);
    time.advance(60_000);
    expect(clicks).toEqual([]);
  });

  it('a lead no longer MATCHED when its turn comes → SKIPPED, no click', () => {
    const { source, clicks, facts } = page([{ id: 'A', title: 'Alpha Tablets' }]);
    const { engine, time } = engineFor(source);
    engine.onMatchEvent(matchEvent('A'));
    facts.set('A', { ...facts.get('A')!, status: 'REJECTED' });
    time.advance(60_000);
    expect(clicks).toEqual([]);
    expect(engine.snapshot().history[0]).toMatchObject({
      status: 'SKIPPED',
      errorCode: 'NOT_MATCHED',
    });
  });

  it('action records carry the event, fingerprint, resolver result and outcome', () => {
    const { source } = page([{ id: 'A', title: 'Alpha Tablets' }]);
    const { engine, time } = engineFor(source);
    engine.onMatchEvent(matchEvent('A', 'm-rec'));
    time.advance(60_000);
    expect(engine.snapshot().history[0]).toMatchObject({
      matchEventId: 'm-rec',
      leadId: 'A',
      fingerprint: 'fp-A',
      actionType: 'CONTACT_BUYER',
      status: 'SUCCESS',
      resolverResult: 'FOUND_REFERENCE',
      errorCode: null,
    });
  });
});

describe('one at a time, with the delay', () => {
  it('first click immediately, next after the delay, never together', () => {
    const { source, clicks } = page([
      { id: 'A', title: 'Alpha Tablets' },
      { id: 'B', title: 'Beta Capsules' },
    ]);
    const { engine, time } = engineFor(source);
    engine.onMatchEvent(matchEvent('A'));
    engine.onMatchEvent(matchEvent('B'));
    time.advance(0);
    expect(clicks).toEqual(['A']);
    time.advance(999);
    expect(clicks).toEqual(['A']);
    time.advance(1);
    expect(clicks).toEqual(['A', 'B']);
  });

  it.each(ACTION_DELAY_OPTIONS_MS)('delay option %i ms spaces clicks by exactly that', (delay) => {
    const { source, clicks } = page([
      { id: 'A', title: 'Alpha Tablets' },
      { id: 'B', title: 'Beta Capsules' },
    ]);
    const { engine, time } = engineFor(source, {
      ...DEFAULT_AUTOMATION_CONFIG,
      delayBetweenActionsMs: delay,
    });
    engine.onMatchEvent(matchEvent('A'));
    engine.onMatchEvent(matchEvent('B'));
    time.advance(delay - 1);
    expect(clicks).toEqual(['A']);
    time.advance(1);
    expect(clicks).toEqual(['A', 'B']);
  });

  it('an event delivered during a click does not start a second click', () => {
    const { source, clicks } = page([
      { id: 'A', title: 'Alpha Tablets' },
      { id: 'B', title: 'Beta Capsules' },
    ]);
    const parts = engineFor(source);
    document
      .querySelector('[data-lead="A"] button')
      ?.addEventListener('click', () => parts.engine.onMatchEvent(matchEvent('B')));
    parts.engine.onMatchEvent(matchEvent('A'));
    parts.time.advance(0);
    expect(clicks).toEqual(['A']);
    expect(parts.time.pending()).toBe(1);
    parts.time.advance(1000);
    expect(clicks).toEqual(['A', 'B']);
  });
});

describe('STOP', () => {
  it('10. cancels the queue and the pending click, keeps history, stays OFF', () => {
    const leads = Array.from({ length: 4 }, (_, i) => ({
      id: `L${i}`,
      title: `Lead ${i} Tablets`,
    }));
    const { source, clicks } = page(leads);
    const { engine, time, events } = engineFor(source);
    for (const l of leads) engine.onMatchEvent(matchEvent(l.id));
    time.advance(0);
    expect(clicks).toEqual(['L0']);
    engine.stop();
    expect(engine.getState()).toBe('OFF');
    expect(time.pending()).toBe(0);
    expect(engine.onMatchEvent(matchEvent('L1'))).toBe(false);
    time.advance(10 * 60_000);
    expect(clicks).toEqual(['L0']);
    expect(engine.snapshot().history.filter((r) => r.status === 'CANCELLED')).toHaveLength(3);
    expect(events.at(-1)).toMatchObject({
      type: 'AUTOMATION_STOPPED',
      reason: 'user',
      cancelled: 3,
    });
  });

  it('prevents a waiting retry', () => {
    const { source, clicks } = page([{ id: 'A', title: 'Alpha Tablets', button: null }]);
    const { engine, time, statuses } = engineFor(source);
    engine.onMatchEvent(matchEvent('A'));
    time.advance(0);
    expect(statuses('A').at(-1)).toBe('ACTION_RETRYING');
    engine.stop();
    time.advance(60_000);
    expect(statuses('A').at(-1)).toBe('ACTION_CANCELLED');
    expect(clicks).toEqual([]);
  });
});

describe('license', () => {
  function licensed(initial: boolean) {
    let active = initial;
    const license: EngineLicense = { isLicenseActive: () => active };
    return { license, set: (a: boolean) => (active = a) };
  }

  it('11. license disabled → no click, nothing queued', () => {
    const { source, clicks } = page([{ id: 'A', title: 'Alpha Tablets' }]);
    const l = licensed(false);
    const { engine, time } = engineFor(source, DEFAULT_AUTOMATION_CONFIG, { license: l.license });
    expect(engine.getState()).toBe('LOCKED');
    expect(engine.onMatchEvent(matchEvent('A'))).toBe(false);
    time.advance(60_000);
    expect(clicks).toEqual([]);
  });

  it('12. license expiring before the click → no click', () => {
    const { source, clicks } = page([
      { id: 'A', title: 'Alpha Tablets' },
      { id: 'B', title: 'Beta Capsules' },
    ]);
    const l = licensed(true);
    const { engine, time } = engineFor(source, DEFAULT_AUTOMATION_CONFIG, { license: l.license });
    engine.onMatchEvent(matchEvent('A'));
    engine.onMatchEvent(matchEvent('B'));
    time.advance(0);
    l.set(false); // expires while B waits; no notification yet
    time.advance(60_000);
    expect(clicks).toEqual(['A']);
    expect(engine.getState()).toBe('LOCKED');
  });

  it('a stale server answer is refreshed before the click; a DISABLED answer blocks it', async () => {
    const { source, clicks } = page([{ id: 'A', title: 'Alpha Tablets' }]);
    let active = true;
    const validate = vi.fn(() => {
      active = false; // the server now says DISABLED
      return Promise.resolve();
    });
    const { engine, time } = engineFor(source, DEFAULT_AUTOMATION_CONFIG, {
      license: { isLicenseActive: () => active, needsValidation: () => true, validate },
    });
    engine.onMatchEvent(matchEvent('A'));
    time.advance(0);
    await vi.waitFor(() => expect(validate).toHaveBeenCalledOnce());
    await Promise.resolve();
    time.advance(60_000);
    expect(clicks).toEqual([]);
  });

  it('a fresh answer does not trigger a validation request (no request per lead)', () => {
    const { source, clicks } = page([{ id: 'A', title: 'Alpha Tablets' }]);
    const validate = vi.fn(() => Promise.resolve());
    const { engine, time } = engineFor(source, DEFAULT_AUTOMATION_CONFIG, {
      license: { isLicenseActive: () => true, needsValidation: () => false, validate },
    });
    engine.onMatchEvent(matchEvent('A'));
    time.advance(60_000);
    expect(clicks).toEqual(['A']);
    expect(validate).not.toHaveBeenCalled();
  });
});

describe('never the wrong lead', () => {
  it('13. the card now shows a different lead → IDENTITY_MISMATCH, no click, no retry', () => {
    const { source, clicks } = page([{ id: 'A', title: 'Alpha Tablets' }]);
    (document.querySelector('[data-lead="A"] .BuyLdC_m6') as Element).textContent = 'Other Lead';
    const { engine, time } = engineFor(source);
    engine.onMatchEvent(matchEvent('A'));
    time.advance(60_000);
    expect(clicks).toEqual([]);
    expect(engine.snapshot().history[0]).toMatchObject({
      status: 'FAILED',
      errorCode: 'IDENTITY_MISMATCH',
      resolverResult: 'IDENTITY_MISMATCH',
      attempt: 1,
    });
  });

  it("only another lead's button nearby → no click", () => {
    const { source, clicks } = page([
      { id: 'A', title: 'Alpha Tablets', button: null },
      { id: 'B', title: 'Beta Capsules', status: 'REJECTED' },
    ]);
    const { engine, time } = engineFor(source);
    engine.onMatchEvent(matchEvent('A'));
    time.advance(60_000);
    expect(clicks).toEqual([]);
  });

  it.each([
    ['disabled', '<button disabled><strong>Contact Buyer</strong></button>', 'button is disabled'],
    [
      'wrong button text',
      '<button><strong>View Details</strong></button>',
      'no Contact Buyer button in the card',
    ],
  ])('%s → no click', (_, button, reason) => {
    const { source, clicks } = page([{ id: 'A', title: 'Alpha Tablets', button }]);
    const { engine, time } = engineFor(source);
    engine.onMatchEvent(matchEvent('A'));
    time.advance(60_000);
    expect(clicks).toEqual([]);
    expect(engine.snapshot().history[0]).toMatchObject({ status: 'FAILED', errorMessage: reason });
  });

  it('hidden button → no click', () => {
    const { source, clicks } = page([{ id: 'A', title: 'Alpha Tablets' }]);
    const { engine, time } = engineFor(source, DEFAULT_AUTOMATION_CONFIG, {
      isVisible: () => false,
    });
    engine.onMatchEvent(matchEvent('A'));
    time.advance(60_000);
    expect(clicks).toEqual([]);
  });

  it('lead removed from the page → retried, then FAILED STALE_LEAD', () => {
    const { source, clicks } = page([{ id: 'A', title: 'Alpha Tablets' }]);
    document.querySelector('[data-lead="A"]')?.remove();
    const { engine, time } = engineFor(source);
    engine.onMatchEvent(matchEvent('A'));
    time.advance(60_000);
    expect(clicks).toEqual([]);
    expect(engine.snapshot().history[0]).toMatchObject({
      status: 'FAILED',
      errorCode: 'STALE_LEAD',
      attempt: 3,
    });
  });

  it('button appearing on a retry → clicked once', () => {
    const { source, clicks } = page([{ id: 'A', title: 'Alpha Tablets', button: null }]);
    const { engine, time } = engineFor(source);
    engine.onMatchEvent(matchEvent('A'));
    time.advance(0);
    const block = document.querySelector('[data-lead="A"]') as Element;
    block.insertAdjacentHTML('beforeend', `<div class="SLC_dflx SLC_ pr">${BUTTON}</div>`);
    block.querySelector('button')?.addEventListener('click', () => clicks.push('A'));
    time.advance(1000);
    expect(clicks).toEqual(['A']);
    expect(engine.snapshot().history[0]).toMatchObject({ status: 'SUCCESS', attempt: 2 });
  });

  it('a click that throws is never retried', () => {
    const { source } = page([{ id: 'A', title: 'Alpha Tablets' }]);
    clickSpy.mockImplementation(() => {
      throw new Error('page error');
    });
    const { engine, time } = engineFor(source);
    engine.onMatchEvent(matchEvent('A'));
    time.advance(60_000);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(engine.snapshot().history[0]).toMatchObject({
      status: 'FAILED',
      errorCode: 'CLICK_FAILED',
    });
  });

  it('standby (another tab clicking) → events are not acted on', () => {
    const { source, clicks } = page([{ id: 'A', title: 'Alpha Tablets' }]);
    const parts = engineFor(source, OFF);
    parts.engine.setStandby(true);
    parts.engine.setConfig(DEFAULT_AUTOMATION_CONFIG);
    expect(parts.engine.getState()).toBe('STANDBY');
    expect(parts.engine.onMatchEvent(matchEvent('A'))).toBe(false);
    parts.time.advance(60_000);
    expect(clicks).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Executor and lock                                                    */
/* ------------------------------------------------------------------ */

describe('executor', () => {
  it('refuses when the guard objects, when detached or disabled', () => {
    const button = document.createElement('button');
    document.body.append(button);
    expect(clickContactBuyer(button, () => 'Auto-Click is off')).toEqual({
      ok: false,
      clicked: false,
      reason: 'Auto-Click is off',
    });
    button.disabled = true;
    expect(clickContactBuyer(button, () => null)).toMatchObject({ ok: false, clicked: false });
    button.remove();
    expect(clickContactBuyer(button, () => null)).toMatchObject({ reason: 'button left the page' });
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('is the only non-test source that calls click()', () => {
    const sources = import.meta.glob(
      ['/src/**/*.ts', '/src/**/*.tsx', '!/src/**/*.test.ts', '!/src/**/*.test.tsx'],
      { query: '?raw', import: 'default', eager: true },
    );
    expect(Object.keys(sources).length).toBeGreaterThan(40);
    const offenders = Object.entries(sources)
      .filter(([, text]) => /\.click\(/.test(String(text)))
      .map(([path]) => path);
    expect(offenders).toEqual(['/src/content/automation/contact-buyer-executor.ts']);
  });
});

describe('automation lock (one tab clicks at a time)', () => {
  function memoryArea(): KeyValueArea {
    const data: Record<string, unknown> = {};
    return {
      get: (key) => Promise.resolve(key in data ? { [key]: structuredClone(data[key]) } : {}),
      set: (items) => (Object.assign(data, structuredClone(items)), Promise.resolve()),
      remove: (key) => (delete data[key], Promise.resolve()),
    };
  }

  it('a second tab waits while the first holds a fresh lock', async () => {
    const area = memoryArea();
    let now = 0;
    const a = new AutomationLock(
      'tab-a',
      () => now,
      () => area,
    );
    const b = new AutomationLock(
      'tab-b',
      () => now,
      () => area,
    );
    expect(await a.acquire()).toBe(true);
    expect(await b.acquire()).toBe(false);
    now += LOCK_STALE_MS + 1;
    expect(await b.acquire()).toBe(true);
    await b.release();
    expect(await a.acquire()).toBe(true);
  });
});
