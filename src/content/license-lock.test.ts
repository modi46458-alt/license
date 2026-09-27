import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AUTOMATION_CONFIG, type AutomationEvent, type LeadFacts } from '@/core/actions';
import { DEFAULT_FILTER_CONFIG } from '@/core/filters';
import {
  DEFAULT_GRACE_MS,
  INITIAL_LICENSE_STATE,
  LicenseGate,
  fromServer,
  type ServerLicenseStatus,
} from '@/core/license';
import type { ScannerEvent } from '@/core/types/scanner';
import { leadCardHtml, leadListHtml, mountFixture } from '@/tests/fixtures/indiamart-lead-card';
import { manualScheduler, settle } from '@/tests/manual-scheduler';
import { AutoClickEngine, type LeadSource } from './automation/action-engine';
import { LeadScanner } from './scanner/lead-scanner';

const T0 = 1_800_000_000_000;
const state = (status: ServerLicenseStatus, localNow: number) =>
  fromServer(
    INITIAL_LICENSE_STATE,
    {
      status,
      expiresAt: T0 + 30 * 86_400_000,
      serverTime: T0,
      plan: 'Pro',
      customer: 'Acme',
      codeHint: 'AB12',
    },
    localNow,
  );

function gateAt(status: ServerLicenseStatus | null) {
  let now = 1_000_000;
  const gate = new LicenseGate(() => now);
  if (status) gate.update(state(status, now));
  return {
    gate,
    set: (s: ServerLicenseStatus) => gate.update(state(s, now)),
    advance: (ms: number) => (now += ms),
  };
}

afterEach(() => vi.restoreAllMocks());

/* ------------------------------------------------------------------ */
/* Scanner                                                              */
/* ------------------------------------------------------------------ */

function scannerWith(gate: LicenseGate) {
  mountFixture(leadListHtml([{ title: 'First Lead Tablets' }]));
  const sched = manualScheduler();
  const events: ScannerEvent[] = [];
  const scanner = new LeadScanner({
    document,
    getUrl: () => 'https://seller.indiamart.com/bltxn/',
    schedule: sched.schedule,
    filterConfig: DEFAULT_FILTER_CONFIG,
    license: gate,
  });
  scanner.on((e) => events.push(e));
  const addLead = async (title: string) => {
    document.querySelector('section')?.insertAdjacentHTML('beforeend', leadCardHtml({ title }));
    await settle();
    sched.run();
  };
  return { scanner, events, addLead };
}

describe('scanner license lock', () => {
  it('ACTIVE → scans', () => {
    const { gate } = gateAt('ACTIVE');
    const { scanner } = scannerWith(gate);
    scanner.start();
    expect(scanner.getState()).toMatchObject({ status: 'scanning', detected: 1 });
  });

  it.each<ServerLicenseStatus | null>([
    'DISABLED',
    'EXPIRED',
    'SUSPENDED',
    'REVOKED',
    'UNREGISTERED',
    null,
  ])('%s → never starts: no observer, nothing read', (status) => {
    const { gate } = gateAt(status);
    const { scanner, events } = scannerWith(gate);
    const observe = vi.spyOn(MutationObserver.prototype, 'observe');
    scanner.start();
    expect(scanner.getState()).toMatchObject({ status: 'locked', detected: 0 });
    expect(observe).not.toHaveBeenCalled();
    expect(events.map((e) => e.type)).toEqual(['SCANNER_LOCKED']);
  });

  it('ACTIVE → DISABLED stops at once; REACTIVATED works again', async () => {
    const { gate, set } = gateAt('ACTIVE');
    const { scanner, events, addLead } = scannerWith(gate);
    gate.subscribe((active) => (active ? scanner.start() : scanner.lock()));
    scanner.start();
    expect(scanner.getState().detected).toBe(1);

    set('DISABLED');
    expect(scanner.getState().status).toBe('locked');
    await addLead('Second Lead Capsules'); // observer disconnected: not seen
    expect(scanner.getState().detected).toBe(1);
    expect(events.filter((e) => e.type === 'LEAD_PROCESSED')).toHaveLength(1);

    set('ACTIVE');
    expect(scanner.getState().status).toBe('scanning');
    expect(scanner.getState().detected).toBe(2); // rescan on start picks it up
  });

  it('EXPIRED while running stops processing even before the gate notifies', async () => {
    const { gate, set } = gateAt('ACTIVE');
    const { scanner, addLead } = scannerWith(gate);
    scanner.start();
    set('EXPIRED'); // no subscriber: the scanner checks the gate itself per batch
    await addLead('Second Lead Capsules');
    expect(scanner.getState()).toMatchObject({ status: 'locked', detected: 1 });
  });

  it('offline grace over → locked', async () => {
    const { gate, advance } = gateAt('ACTIVE');
    const { scanner, addLead } = scannerWith(gate);
    scanner.start();
    advance(DEFAULT_GRACE_MS + 1);
    await addLead('Second Lead Capsules');
    expect(scanner.getState().status).toBe('locked');
  });
});

/* ------------------------------------------------------------------ */
/* Auto-Click                                                           */
/* ------------------------------------------------------------------ */

function autoClick(
  gate: LicenseGate,
  leads: Array<{ id: string; title: string; button?: boolean }>,
) {
  mountFixture(
    `<main><section>${leads
      .map(
        (l, i) =>
          `<div id="BLCard${i + 1}" data-lead="${l.id}">${leadCardHtml({ title: l.title })}${
            l.button === false
              ? ''
              : '<div class="SLC_dflx SLC_ pr"><button><strong>Contact Buyer</strong></button></div>'
          }</div>`,
      )
      .join('')}</section></main>`,
  );
  const clicks: string[] = [];
  document
    .querySelectorAll('[data-lead] button')
    .forEach((b) =>
      b.addEventListener('click', () =>
        clicks.push((b.closest('[data-lead]') as HTMLElement).dataset.lead ?? ''),
      ),
    );
  const facts = new Map<string, LeadFacts>(
    leads.map((l) => [
      l.id,
      { leadId: l.id, fingerprint: `fp-${l.id}`, title: l.title, status: 'MATCHED' },
    ]),
  );
  const source: LeadSource = {
    getCard: (id) => document.querySelector(`[data-lead="${id}"] article`),
    getFacts: (id) => facts.get(id) ?? null,
  };
  let now = 5_000_000;
  const timers: Array<{ at: number; fn: () => void; id: number }> = [];
  let id = 0;
  const events: AutomationEvent[] = [];
  const engine = new AutoClickEngine({
    leads: source,
    config: DEFAULT_AUTOMATION_CONFIG,
    now: () => now,
    setTimer: (fn, ms) => (timers.push({ at: now + ms, fn, id: ++id }), id),
    clearTimer: (h) => {
      const i = timers.findIndex((t) => t.id === h);
      if (i >= 0) timers.splice(i, 1);
    },
    isVisible: () => true,
    license: { isLicenseActive: () => gate.isLicenseActive() },
  });
  engine.on((e) => events.push(e));
  gate.subscribe((active) => engine.setLicensed(active));
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
  let seq = 0;
  /** One genuine MATCHED evaluation per lead, as the scanner would report. */
  const matchAll = () => {
    for (const l of leads) {
      engine.onMatchEvent({
        matchEventId: `m-${++seq}`,
        leadId: l.id,
        fingerprint: `fp-${l.id}`,
        title: l.title,
        trigger: 'detected',
        at: now,
      });
    }
  };
  return { engine, clicks, advance, events, matchAll, pending: () => timers.length };
}

describe('Auto-Click license lock', () => {
  it('ACTIVE + MATCHED → clicked', () => {
    const { gate } = gateAt('ACTIVE');
    const a = autoClick(gate, [{ id: 'A', title: 'Alpha Tablets' }]);
    a.matchAll();
    a.advance(0);
    expect(a.clicks).toEqual(['A']);
  });

  it.each<ServerLicenseStatus | null>(['DISABLED', 'EXPIRED', 'SUSPENDED', 'REVOKED', null])(
    '%s + MATCHED → blocked, nothing queued',
    (status) => {
      const { gate } = gateAt(status);
      const a = autoClick(gate, [{ id: 'A', title: 'Alpha Tablets' }]);
      a.matchAll();
      a.advance(60_000);
      expect(a.engine.getState()).toBe('LOCKED');
      expect(a.clicks).toEqual([]);
      expect(a.events.filter((e) => e.type === 'ACTION_QUEUED')).toEqual([]);
    },
  );

  it('queued actions and the delayed next click are cancelled when the license is disabled', () => {
    const { gate, set } = gateAt('ACTIVE');
    const a = autoClick(gate, [
      { id: 'A', title: 'Alpha Tablets' },
      { id: 'B', title: 'Beta Capsules' },
      { id: 'C', title: 'Gamma Injection' },
    ]);
    a.matchAll();
    a.advance(0);
    expect(a.clicks).toEqual(['A']);
    expect(a.pending()).toBe(1); // B waits for the delay
    set('DISABLED');
    expect(a.pending()).toBe(0);
    a.advance(60_000);
    expect(a.clicks).toEqual(['A']);
    const cancelled = a.engine.snapshot().history.filter((r) => r.status === 'CANCELLED');
    expect(cancelled.map((r) => r.leadId).sort()).toEqual(['B', 'C']);
    expect(a.events.at(-1)).toMatchObject({ type: 'AUTOMATION_STOPPED', reason: 'license' });
  });

  it('a waiting retry is cancelled when the license is disabled', () => {
    const { gate, set } = gateAt('ACTIVE');
    const a = autoClick(gate, [{ id: 'A', title: 'Alpha Tablets', button: false }]);
    a.matchAll();
    a.advance(0);
    expect(a.engine.snapshot().history[0]?.status).toBe('RETRYING');
    set('DISABLED');
    a.advance(60_000);
    expect(a.engine.snapshot().history[0]?.status).toBe('CANCELLED');
    expect(a.clicks).toEqual([]);
  });

  it('grace ending between checks: the click is refused at the last moment', () => {
    const { gate, advance } = gateAt('ACTIVE');
    const a = autoClick(gate, [
      { id: 'A', title: 'Alpha Tablets' },
      { id: 'B', title: 'Beta Capsules' },
    ]);
    a.matchAll();
    a.advance(0);
    advance(DEFAULT_GRACE_MS + 1); // no validation for over a day, no notification yet
    a.advance(60_000);
    expect(a.clicks).toEqual(['A']);
    expect(a.engine.getState()).toBe('LOCKED');
  });

  it('REACTIVATED → new MATCHED events are clicked again; events from the locked period are not', () => {
    const { gate, set } = gateAt('DISABLED');
    const a = autoClick(gate, [{ id: 'A', title: 'Alpha Tablets' }]);
    a.matchAll(); // while DISABLED: dropped
    a.advance(60_000);
    expect(a.clicks).toEqual([]);
    set('ACTIVE');
    a.advance(60_000);
    expect(a.clicks).toEqual([]);
    a.matchAll(); // a new genuine MATCHED evaluation after reactivation
    a.advance(0);
    expect(a.clicks).toEqual(['A']);
  });
});
