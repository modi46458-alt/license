import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScannerEvent } from '@/core/types/scanner';
import {
  THREE_LEADS,
  leadCardHtml,
  leadListHtml,
  mountFixture,
  type CardSpec,
} from '@/tests/fixtures/indiamart-lead-card';
import { manualScheduler, settle } from '@/tests/manual-scheduler';
import { extractLead } from '../extraction/lead-extractor';
import { DEFAULT_FILTER_CONFIG } from '@/core/filters';
import { DEFAULT_SCORING_CONFIG } from '@/core/scoring';
import { LeadScanner, type LeadScannerOptions } from './lead-scanner';
import { ScanLogBuffer } from './scan-log';

const LEAD_PAGE = 'https://seller.indiamart.com/bltxn/';

function setup(
  html: string | null = leadListHtml(THREE_LEADS),
  options: Partial<LeadScannerOptions> = {},
) {
  if (html !== null) mountFixture(html);
  const s = manualScheduler();
  let url = LEAD_PAGE;
  const scanner = new LeadScanner({
    document,
    getUrl: () => url,
    schedule: s.schedule,
    frameBudgetMs: 1_000,
    ...options,
  });
  const events: ScannerEvent[] = [];
  scanner.on((e) => events.push(e));
  const types = () => events.map((e) => e.type);
  const count = (type: ScannerEvent['type']) => events.filter((e) => e.type === type).length;
  return {
    scanner,
    events,
    types,
    count,
    s,
    setUrl: (next: string) => (url = next),
    /** Let MutationObserver deliver, then run the scheduled batch. */
    async tick() {
      await settle();
      s.run();
    },
  };
}

function list(): Element {
  return document.querySelector('section[data-fixture-list]') as Element;
}

function append(spec: CardSpec): void {
  list().insertAdjacentHTML('beforeend', leadCardHtml(spec));
}

let t: ReturnType<typeof setup>;
afterEach(() => t?.scanner.stop());

describe('initial scan', () => {
  beforeEach(() => {
    t = setup();
    t.scanner.start();
  });

  it('detects every visible lead once, in order', () => {
    expect(t.scanner.getState()).toMatchObject({
      status: 'scanning',
      pageActive: true,
      detected: 3,
      processed: 3,
      duplicates: 0,
      extractionFailures: 0,
      // Default filters: the Luxembourg lead (10 Strip) is rejected; the US
      // and Canada leads pass. matched + rejected = unique evaluated leads.
      matched: 2,
      rejected: 1,
    });
    const processed = t.events.flatMap((e) =>
      e.type === 'LEAD_PROCESSED' ? [e.lead.rawTitle] : [],
    );
    expect(processed).toEqual([
      'Propanolol 20mg Tablets From Europe to Europe',
      'Finasteride 5mg Tablets',
      'Metformin 500mg Tablets',
    ]);
  });

  it('emits the documented event sequence', () => {
    expect(t.types().slice(0, 4)).toEqual([
      'SCAN_STARTED',
      'LEAD_CANDIDATE_FOUND',
      'LEAD_DETECTED',
      'LEAD_PROCESSED',
    ]);
    const completed = t.events.find((e) => e.type === 'SCAN_COMPLETED');
    expect(completed).toMatchObject({ newLeads: 3, initial: true });
    const detected = t.events.find((e) => e.type === 'LEAD_DETECTED');
    expect(detected?.type === 'LEAD_DETECTED' && detected.leadId).toMatch(/^lead_[0-9a-f]{14}$/);
    expect(detected?.type === 'LEAD_DETECTED' && detected.fingerprint).toMatch(/^fp_[0-9a-f]{14}$/);
  });

  it('assigns ids from fingerprints, not DOM position', () => {
    const ids = t.events.flatMap((e) => (e.type === 'LEAD_PROCESSED' ? [e.lead.id] : []));
    t.scanner.stop();
    const reversed = setup(leadListHtml([...THREE_LEADS].reverse()));
    reversed.scanner.start();
    const reversedIds = reversed.events.flatMap((e) =>
      e.type === 'LEAD_PROCESSED' ? [e.lead.id] : [],
    );
    expect(reversedIds).toEqual([...ids].reverse());
    reversed.scanner.stop();
  });

  it('never modifies the page', () => {
    const before = document.body.innerHTML;
    t.scanner.scanExisting();
    expect(document.body.innerHTML).toBe(before);
  });
});

describe('MutationObserver batching', () => {
  beforeEach(() => {
    t = setup();
    t.scanner.start();
  });

  it('processes many inserted leads in one batch', async () => {
    for (let i = 0; i < 5; i++) append({ title: `New lead ${i}`, country: 'India' });
    expect(t.s.scheduled).toBe(0);
    await settle();
    expect(t.s.scheduled).toBe(1);
    t.s.run();
    expect(t.scanner.getState().detected).toBe(8);
    expect(t.scanner.getSnapshot().diagnostics.batchCount).toBe(1);
    expect(t.events.filter((e) => e.type === 'SCAN_COMPLETED').at(-1)).toMatchObject({
      newLeads: 5,
      initial: false,
    });
  });

  it('ignores mutations outside lead cards', async () => {
    document.body.insertAdjacentHTML('beforeend', '<div><p>chat widget</p></div>');
    await t.tick();
    expect(t.scanner.getState().detected).toBe(3);
    expect(t.count('SCAN_COMPLETED')).toBe(1);
  });

  it('does not rescan the whole document per mutation', async () => {
    const spy = vi.spyOn(document, 'querySelectorAll');
    append({ title: 'One more', country: 'India' });
    await t.tick();
    expect(spy).not.toHaveBeenCalled();
  });

  it('picks up a lead that renders in pieces', async () => {
    list().insertAdjacentHTML(
      'beforeend',
      '<article data-fixture-card><div class="SLC_dflxG BuyLdC_Gtc1"><span class="BuyLdC_m6">Lazy lead</span></div></article>',
    );
    await t.tick();
    expect(t.scanner.getState().detected).toBe(3); // not enough signals yet
    const lazy = list().lastElementChild as Element;
    lazy
      .querySelector('.BuyLdC_Gtc1')
      ?.insertAdjacentHTML(
        'beforeend',
        '<div class="BuyLdC_time_loc"><div><strong class="SLC_f14 SLC_c2">Kenya</strong></div></div>',
      );
    lazy.insertAdjacentHTML(
      'beforeend',
      '<ul><li class="BuyLdC_isqdet"><span>Quantity</span><strong>4 Box</strong></li></ul>',
    );
    await t.tick();
    expect(t.scanner.getState().detected).toBe(4);
  });
});

describe('duplicate prevention', () => {
  beforeEach(() => {
    t = setup();
    t.scanner.start();
  });

  it('a re-rendered card (new element, same lead) is a duplicate', async () => {
    const first = list().firstElementChild as Element;
    list().append(first.cloneNode(true));
    await t.tick();
    expect(t.scanner.getState()).toMatchObject({ detected: 3, duplicates: 1 });
    expect(t.count('LEAD_DUPLICATE')).toBe(1);
  });

  it('a whole list re-render counts no new leads', async () => {
    list().innerHTML = THREE_LEADS.map((c) => leadCardHtml(c)).join('');
    await t.tick();
    expect(t.scanner.getState()).toMatchObject({ detected: 3, duplicates: 3 });
  });

  it('an in-place update of the same card is silent', async () => {
    const age = list().querySelector('.MrLdsB_m1 strong') as Element;
    age.textContent = '23 mins ago';
    await t.tick();
    expect(t.scanner.getState()).toMatchObject({ detected: 3, duplicates: 0 });
    expect(t.count('LEAD_PROCESSED')).toBe(3);
  });

  it('a detail change on the same card updates the lead instead of adding one', async () => {
    const firstId = t.events.find((e) => e.type === 'LEAD_PROCESSED');
    const qty = list().querySelector('.BuyLdC_isqdet strong') as Element;
    qty.textContent = '50 Strip';
    await t.tick();
    expect(t.scanner.getState()).toMatchObject({ detected: 3, duplicates: 0, processed: 4 });
    const updated = t.events.find((e) => e.type === 'LEAD_UPDATED');
    expect(updated?.type === 'LEAD_UPDATED' && updated.lead.quantityRaw).toBe('50 Strip');
    expect(updated?.type === 'LEAD_UPDATED' && updated.leadId).toBe(
      firstId?.type === 'LEAD_PROCESSED' && firstId.lead.id,
    );
  });

  it('a recycled card element showing a different lead is a new lead', async () => {
    const title = list().querySelector('.BuyLdC_m6') as Element;
    title.textContent = 'Amlodipine 5mg Tablets';
    await t.tick();
    expect(t.scanner.getState().detected).toBe(4);
    expect(t.count('LEAD_UPDATED')).toBe(0);
  });

  it('a card that gains fields after detection is counted once, and its re-render is a duplicate', async () => {
    append({ title: 'Partial lead', country: 'Kenya', rows: [], buys: 'Paracetamol Tablet' });
    await t.tick();
    expect(t.scanner.getState().detected).toBe(4);
    const partial = list().lastElementChild as Element;
    partial.insertAdjacentHTML(
      'beforeend',
      '<ul><li class="BuyLdC_isqdet"><span>Quantity</span><strong>4 Box</strong></li></ul>',
    );
    await t.tick();
    expect(t.scanner.getState()).toMatchObject({ detected: 4, duplicates: 0 });
    expect(t.count('LEAD_UPDATED')).toBe(1);

    list().append(partial.cloneNode(true));
    await t.tick();
    expect(t.scanner.getState()).toMatchObject({ detected: 4, duplicates: 1 });
  });

  it('processed counts every card outcome, not only new leads', async () => {
    const first = list().firstElementChild as Element;
    list().append(first.cloneNode(true));
    await t.tick();
    const { detected, duplicates, extractionFailures, processed } = t.scanner.getState();
    expect(processed).toBe(detected + duplicates + extractionFailures);
  });

  it('progressive rendering: a card re-rendered with more fields keeps its lead id', async () => {
    // Live: "Tiger Pharma …" first seen at 80% card match, then again at 90%.
    const spec = { title: 'Tiger Pharma Growth Hormone Hgh Injection', country: 'USA' };
    append({ ...spec, rows: [], buys: null, contact: null });
    await t.tick();
    const first = t.events.filter((e) => e.type === 'LEAD_PROCESSED').at(-1);
    const firstId = first?.type === 'LEAD_PROCESSED' ? first.lead.id : null;

    (list().lastElementChild as Element).remove();
    append({ ...spec, rows: [['Quantity', '30 Vial']] });
    await t.tick();

    expect(t.scanner.getState()).toMatchObject({ detected: 4, duplicates: 0 });
    const updated = t.events.find((e) => e.type === 'LEAD_UPDATED');
    expect(updated?.type === 'LEAD_UPDATED' && updated.leadId).toBe(firstId);
    expect(updated?.type === 'LEAD_UPDATED' && updated.revealed).toEqual(
      expect.arrayContaining(['quantity', 'buys', 'mobile']),
    );
  });

  it('same lead with changing optional fields never creates a new lead', async () => {
    const spec = { title: 'Erectile Dysfunction Spray', country: 'Canada' };
    append({ ...spec, rows: [], buys: null });
    await t.tick();
    const lazy = list().lastElementChild as Element;
    lazy.insertAdjacentHTML(
      'beforeend',
      '<ul><li class="BuyLdC_isqdet"><span>Dosage Form</span><strong>Spray</strong></li></ul>',
    );
    await t.tick();
    list().append(lazy.cloneNode(true));
    await t.tick();
    expect(t.scanner.getState()).toMatchObject({ detected: 4, duplicates: 1 });
    expect(t.count('LEAD_UPDATED')).toBe(1);
  });

  it('processCandidate is safe to call repeatedly', () => {
    const title = document.querySelector('.BuyLdC_m6') as Element;
    expect(t.scanner.processCandidate(title)).toBe('unchanged');
    expect(t.scanner.processCandidate(document.body)).toBe('rejected');
    expect(t.scanner.getState().detected).toBe(3);
  });

  it('bounds de-duplication memory by evicting the oldest fingerprint', async () => {
    t.scanner.stop();
    t = setup(leadListHtml(THREE_LEADS), { maxRememberedLeads: 2 });
    t.scanner.start();
    // Memory now holds leads 2 and 3. Re-render lead 3 (refreshed, duplicate)
    // then lead 1 (evicted earlier, so it counts as new again).
    list().innerHTML = [THREE_LEADS[2], THREE_LEADS[0]].map((c) => leadCardHtml(c ?? {})).join('');
    await t.tick();
    expect(t.scanner.getState()).toMatchObject({ detected: 4, duplicates: 1 });
  });
});

describe('lifecycle', () => {
  it('start() is idempotent: one observer, one initial scan', () => {
    const observe = vi.spyOn(MutationObserver.prototype, 'observe');
    t = setup();
    t.scanner.start();
    t.scanner.start();
    t.scanner.start();
    expect(observe).toHaveBeenCalledTimes(1);
    expect(t.count('SCAN_STARTED')).toBe(1);
    expect(t.scanner.getState().detected).toBe(3);
  });

  it('stop() disconnects: later inserts are ignored', async () => {
    t = setup();
    t.scanner.start();
    t.scanner.stop();
    t.scanner.stop();
    append({ title: 'After stop', country: 'India' });
    await t.tick();
    expect(t.scanner.getState()).toMatchObject({ status: 'stopped', detected: 3 });
    expect(t.count('SCANNER_STOPPED')).toBe(1);
  });

  it('restart() resumes observing and keeps de-duplication', async () => {
    t = setup();
    t.scanner.start();
    t.scanner.restart();
    // Same elements, same leads: recognised as unchanged, nothing re-detected.
    expect(t.scanner.getState()).toMatchObject({ status: 'scanning', detected: 3, duplicates: 0 });
    expect(t.count('LEAD_PROCESSED')).toBe(3);
    append({ title: 'After restart', country: 'India' });
    await t.tick();
    expect(t.scanner.getState().detected).toBe(4);
  });
});

describe('error isolation', () => {
  it('one failing card does not stop the others', () => {
    t = setup(leadListHtml(THREE_LEADS), {
      extract: (card, options) => {
        if (card.textContent?.includes('Finasteride 5mg')) throw new Error('broken card');
        return extractLead(card, options);
      },
    });
    t.scanner.start();
    expect(t.scanner.getState()).toMatchObject({
      detected: 2,
      extractionFailures: 1,
      status: 'scanning',
    });
    expect(t.events.find((e) => e.type === 'LEAD_EXTRACTION_FAILED')).toMatchObject({
      error: 'broken card',
    });
  });

  it('a failing card is not re-reported on every mutation', async () => {
    t = setup(leadListHtml([{ title: null, breadcrumbs: null }, {}]));
    t.scanner.start();
    expect(t.scanner.getState()).toMatchObject({ detected: 1, extractionFailures: 1 });
    const broken = list().firstElementChild as Element;
    broken.insertAdjacentHTML('beforeend', '<span>noise</span>');
    await t.tick();
    expect(t.scanner.getState().extractionFailures).toBe(1);
  });

  it('partial leads record absent fields as missing and unreadable ones as failed', () => {
    t = setup(leadListHtml([{ country: null, rows: [['Quantity', '10-20 Strips']] }]));
    t.scanner.start();
    const processed = t.events.find((e) => e.type === 'LEAD_PROCESSED');
    expect(processed?.type === 'LEAD_PROCESSED' && processed.lead.extraction.failedFields).toEqual([
      'quantity',
    ]);
    const d = t.scanner.getSnapshot().diagnostics;
    expect(d.failedFields).toEqual({ quantity: 1 });
    expect(d.missingFields).toMatchObject({ country: 1 });
    expect(d.selectorFailures).toEqual({});
  });

  it('a throwing listener does not affect scanning', () => {
    t = setup();
    t.scanner.on(() => {
      throw new Error('ui bug');
    });
    t.scanner.start();
    expect(t.scanner.getState().detected).toBe(3);
  });
});

describe('page handling', () => {
  it('waits on pages without a lead list, then activates when one appears', async () => {
    t = setup('<main><section data-fixture-list></section></main>');
    t.scanner.start();
    expect(t.scanner.getState()).toMatchObject({
      status: 'scanning',
      pageActive: false,
      detected: 0,
    });
    expect(t.types()).toContain('PAGE_INACTIVE');
    append({});
    await t.tick();
    expect(t.scanner.getState()).toMatchObject({ pageActive: true, detected: 1 });
    expect(t.events).toContainEqual(
      expect.objectContaining({ type: 'SCAN_STARTED', reason: 'activation' }),
    );
  });

  it('while waiting, unrelated mutations never query the whole document', async () => {
    t = setup('<main><p>Dashboard</p></main>');
    t.scanner.start();
    const spy = vi.spyOn(document, 'querySelector');
    const spyAll = vi.spyOn(document, 'querySelectorAll');
    for (let i = 0; i < 20; i++) document.body.insertAdjacentHTML('beforeend', '<p>noise</p>');
    await t.tick();
    expect(spy).not.toHaveBeenCalled();
    expect(spyAll).not.toHaveBeenCalled();
    expect(t.scanner.getState().pageActive).toBe(false);
  });

  it('never scans an unsupported URL, even with lead markup', () => {
    t = setup();
    t.setUrl('https://www.indiamart.com/');
    t.scanner.start();
    expect(t.scanner.getState()).toMatchObject({ pageActive: false, detected: 0 });
  });

  it('handles SPA navigation with a replaced lead list', async () => {
    t = setup();
    t.scanner.start();
    t.setUrl(`${LEAD_PAGE}?page=2`);
    const main = document.querySelector('main') as Element;
    main.innerHTML = `<section data-fixture-list>${[
      THREE_LEADS[0] ?? {},
      { title: 'Page two lead', country: 'Japan' },
    ]
      .map((c) => leadCardHtml(c))
      .join('')}</section>`;
    await t.tick();
    expect(t.events).toContainEqual(
      expect.objectContaining({ type: 'SCAN_STARTED', reason: 'navigation' }),
    );
    expect(t.scanner.getState()).toMatchObject({ detected: 4, duplicates: 1 });
  });

  it('goes inactive when navigating away from the lead list', async () => {
    t = setup();
    t.scanner.start();
    t.setUrl('https://seller.indiamart.com/settings');
    document.querySelector('main')?.replaceChildren();
    await t.tick();
    expect(t.scanner.getState().pageActive).toBe(false);
  });
});

describe('performance', () => {
  it('yields when the frame budget is exceeded and finishes in the next batch', () => {
    let now = 0;
    const cards = Array.from({ length: 6 }, (_, i) => ({ title: `Lead ${i}`, country: 'India' }));
    t = setup(leadListHtml(cards), {
      frameBudgetMs: 5,
      clock: () => (now += 3),
    });
    t.scanner.start();
    const firstPass = t.scanner.getState().detected;
    expect(firstPass).toBeGreaterThan(0);
    expect(firstPass).toBeLessThan(6);
    expect(t.scanner.hasPendingWork).toBe(true);
    t.s.run();
    expect(t.scanner.getState().detected).toBe(6);
    expect(t.count('SCAN_COMPLETED')).toBe(1);
  });

  it('keeps a bounded list of recent extractions for diagnostics', async () => {
    t = setup();
    t.scanner.start();
    for (let i = 0; i < 30; i++) append({ title: `Bulk lead ${i}`, country: 'India' });
    await t.tick();
    const samples = t.scanner.getSnapshot().diagnostics.recentExtractions;
    expect(samples).toHaveLength(20);
    expect(samples.at(-1)).toMatchObject({ label: 'Bulk lead 29', outcome: 'new' });
    expect(samples.at(-1)?.cardConfidence).toBeGreaterThanOrEqual(0.5);
  });

  it('records latency and diagnostics', () => {
    t = setup();
    t.scanner.start();
    const d = t.scanner.getSnapshot().diagnostics;
    expect(d.cardsResolved).toBe(3);
    expect(d.candidateCount).toBeGreaterThanOrEqual(3);
    expect(d.maxProcessingTimeMs).toBeGreaterThanOrEqual(d.averageProcessingTimeMs);
    expect(d.averageConfidence).toBeGreaterThan(0.9);
  });

  it('counts rejected candidates', async () => {
    t = setup();
    t.scanner.start();
    document.body.insertAdjacentHTML(
      'beforeend',
      '<aside><span class="BuyLdC_m6">Sidebar ad</span></aside>',
    );
    await t.tick();
    expect(t.scanner.getSnapshot().diagnostics.rejectedCandidates).toBe(1);
    expect(t.scanner.getState().detected).toBe(3);
  });
});

describe('normalization (Phase 3)', () => {
  it('every processed lead carries a normalized, filter-ready form', () => {
    t = setup(leadListHtml([{ country: 'USA', rows: [['Quantity', '2 Boxes']] }]));
    t.scanner.start();
    const e = t.events.find((x) => x.type === 'LEAD_PROCESSED');
    const n = e?.type === 'LEAD_PROCESSED' ? e.normalized : null;
    expect(n).toMatchObject({
      country: { raw: 'USA', normalized: 'United States', code: 'US' },
      quantity: { value: 2, normalizedUnit: 'box' },
    });
    expect(n?.id).toBe(e?.type === 'LEAD_PROCESSED' ? e.lead.id : undefined);
    // Extraction values are untouched by normalization.
    expect(e?.type === 'LEAD_PROCESSED' && e.lead.country).toBe('USA');
  });

  it('updates carry a fresh normalized form', async () => {
    t = setup();
    t.scanner.start();
    const qty = list().querySelector('.BuyLdC_isqdet strong') as Element;
    qty.textContent = '5 Vials';
    await t.tick();
    const e = t.events.find((x) => x.type === 'LEAD_UPDATED');
    expect(e?.type === 'LEAD_UPDATED' && e.normalized?.quantity).toMatchObject({
      value: 5,
      normalizedUnit: 'vial',
    });
  });

  it('a normalization failure never loses the lead', () => {
    t = setup(undefined, {
      normalizeLead: () => {
        throw new Error('boom');
      },
    });
    t.scanner.start();
    expect(t.scanner.getState().detected).toBe(3);
    const e = t.events.find((x) => x.type === 'LEAD_PROCESSED');
    expect(e?.type === 'LEAD_PROCESSED' && e.normalized).toBeNull();
    expect(t.scanner.getSnapshot().diagnostics.normalization.errors).toBe(3);
  });

  it('reports normalization diagnostics', () => {
    t = setup(leadListHtml([{ country: 'Atlantis' }, { country: 'UK' }]));
    t.scanner.start();
    const d = t.scanner.getSnapshot().diagnostics.normalization;
    expect(d.normalized).toBe(2);
    expect(d.errors).toBe(0);
    expect(d.warnings).toEqual({ 'country: not in alias map': 1 });
    expect(d.averageTimeMs).toBeGreaterThanOrEqual(0);
  });
});

describe('filters (Phase 4)', () => {
  const statuses = () =>
    t.events.flatMap((e) => (e.type === 'LEAD_PROCESSED' && e.filter ? [e.filter.status] : []));

  it('every processed lead is evaluated with the default filters', () => {
    t = setup();
    t.scanner.start();
    expect(statuses()).toEqual(['REJECTED', 'MATCHED', 'MATCHED']);
    const first = t.events.find((e) => e.type === 'LEAD_PROCESSED');
    // Luxembourg, 10 Strip: both the country and the minimum quantity fail.
    expect(first?.type === 'LEAD_PROCESSED' && first.filter?.failedConditions).toEqual([
      'countries',
      'quantity',
    ]);
    const { state, diagnostics, results } = t.scanner.getSnapshot();
    expect(state.matched + state.rejected).toBe(state.detected);
    expect(diagnostics.filter).toMatchObject({
      evaluations: 3,
      matched: 2,
      rejected: 1,
      errors: 0,
    });
    expect(diagnostics.filter.rejectionReasons).toEqual({ countries: 1, quantity: 1 });
    expect(results.map((r) => r.status)).toEqual(['MATCHED', 'MATCHED', 'REJECTED']);
    expect(results[2]?.reasons).toContainEqual({
      outcome: 'fail',
      message: 'Country not allowed: Luxembourg',
    });
  });

  it('duplicates are not evaluated again', async () => {
    t = setup();
    t.scanner.start();
    list().append((list().firstElementChild as Element).cloneNode(true));
    await t.tick();
    expect(t.scanner.getSnapshot().diagnostics.filter.evaluations).toBe(3);
    expect(t.scanner.getState()).toMatchObject({ matched: 2, rejected: 1, duplicates: 1 });
  });

  it('updates are re-evaluated and counters follow the new verdict', async () => {
    t = setup(leadListHtml([{ country: 'USA', rows: [['Quantity', '5 Strip']] }]));
    t.scanner.start();
    expect(t.scanner.getState()).toMatchObject({ matched: 0, rejected: 1 });
    (list().querySelector('.BuyLdC_isqdet strong') as Element).textContent = '50 Strip';
    await t.tick();
    expect(t.scanner.getState()).toMatchObject({ matched: 1, rejected: 0, detected: 1 });
    const updated = t.events.find((e) => e.type === 'LEAD_UPDATED');
    expect(updated?.type === 'LEAD_UPDATED' && updated.previousStatus).toBe('REJECTED');
    expect(updated?.type === 'LEAD_UPDATED' && updated.filter?.status).toBe('MATCHED');
  });

  it('changing the config re-evaluates remembered leads', () => {
    t = setup();
    t.scanner.start();
    t.scanner.setFilterConfig({
      ...DEFAULT_FILTER_CONFIG,
      countries: {
        ...DEFAULT_FILTER_CONFIG.countries,
        values: [{ value: 'Luxembourg', enabled: true }],
      },
      quantity: { enabled: true, min: 5, max: null },
    });
    expect(t.scanner.getState()).toMatchObject({ matched: 1, rejected: 2 });
    const applied = t.events.find((e) => e.type === 'FILTERS_APPLIED');
    expect(applied).toMatchObject({ matched: 1, rejected: 2, changed: 3 });
    expect(t.scanner.getSnapshot().results.find((r) => r.status === 'MATCHED')?.country).toBe(
      'Luxembourg',
    );
  });

  it('filters off: every lead matches', () => {
    t = setup(undefined, { filterConfig: { ...DEFAULT_FILTER_CONFIG, enabled: false } });
    t.scanner.start();
    expect(t.scanner.getState()).toMatchObject({ matched: 3, rejected: 0 });
  });

  it('logs the verdict concisely', () => {
    t = setup();
    const log = new ScanLogBuffer();
    t.scanner.on((e) => log.add(e));
    t.scanner.start();
    const lines = log.all().map((l) => l.message);
    expect(lines).toContain(
      'Filter rejected: Country not allowed: Luxembourg; Quantity 10 < minimum 20',
    );
    expect(lines.some((l) => l.startsWith('Filter matched: Country matched: United States'))).toBe(
      true,
    );
  });

  it('never modifies the page while filtering', () => {
    t = setup();
    const before = document.body.innerHTML;
    t.scanner.start();
    t.scanner.setFilterConfig({ ...DEFAULT_FILTER_CONFIG, logic: { mode: 'OR' } });
    expect(document.body.innerHTML).toBe(before);
  });
});

describe('scoring (Phase 5)', () => {
  const processed = () => t.events.flatMap((e) => (e.type === 'LEAD_PROCESSED' ? [e] : []));

  it('matched leads are scored; rejected leads get score null + REJECTED', () => {
    t = setup();
    t.scanner.start();
    const [lux, us, ca] = processed();
    expect(lux?.filter?.status).toBe('REJECTED');
    expect(lux?.score).toMatchObject({ kind: 'REJECTED', score: null, priority: 'REJECTED' });
    expect(us?.score?.kind).toBe('SCORED');
    expect(ca?.score?.kind).toBe('SCORED');
    for (const e of [us, ca]) {
      expect(e?.score?.score).toBeGreaterThanOrEqual(0);
      expect(e?.score?.score).toBeLessThanOrEqual(100);
    }
  });

  it('diagnostics count only scored leads in score statistics', () => {
    t = setup();
    t.scanner.start();
    const d = t.scanner.getSnapshot().diagnostics.scoring;
    expect(d).toMatchObject({ eligible: 2, scored: 2, rejectedFromScoring: 1, errors: 0 });
    const scores = processed().flatMap((e) => (e.score?.score == null ? [] : [e.score.score]));
    expect(d.averageScore).toBe(
      Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10,
    );
    expect(d.minScore).toBe(Math.min(...scores));
    expect(d.maxScore).toBe(Math.max(...scores));
    expect(d.priorityCounts.REJECTED).toBe(1);
    const scoredBands =
      d.priorityCounts.CRITICAL +
      d.priorityCounts.HIGH +
      d.priorityCounts.MEDIUM +
      d.priorityCounts.LOW;
    expect(scoredBands).toBe(2);
    expect(d.timing.count).toBe(2);
  });

  it('recent results carry score and priority; rejected show none', () => {
    t = setup();
    t.scanner.start();
    const { results } = t.scanner.getSnapshot();
    const rejected = results.find((r) => r.status === 'REJECTED');
    expect(rejected).toMatchObject({ score: null, priority: 'REJECTED', scoreReasons: [] });
    const us = results.find((r) => r.country === 'United States');
    expect(us?.status).toBe('MATCHED');
    expect(us?.score).not.toBeNull();
    expect(us?.scoreReasons[0]).toEqual({ points: 25, message: 'Country matched: United States' });
  });

  it('duplicates are not scored again', async () => {
    t = setup();
    t.scanner.start();
    list().append((list().children[1] as Element).cloneNode(true));
    await t.tick();
    expect(t.scanner.getSnapshot().diagnostics.scoring.timing.count).toBe(2);
  });

  it('an update recalculates the score', async () => {
    t = setup(leadListHtml([{ country: 'USA', rows: [['Quantity', '20 Strip']] }]));
    t.scanner.start();
    const before = processed()[0]?.score?.score ?? -1;
    (list().querySelector('.BuyLdC_isqdet strong') as Element).textContent = '100 Strip';
    await t.tick();
    const updated = t.events.find((e) => e.type === 'LEAD_UPDATED');
    expect(updated?.type === 'LEAD_UPDATED' && updated.score?.score).toBe(before + 16);
  });

  it('matched → rejected clears the score; rejected → matched scores afresh', async () => {
    t = setup(leadListHtml([{ country: 'USA', rows: [['Quantity', '50 Strip']] }]));
    t.scanner.start();
    expect(t.scanner.getSnapshot().results[0]).toMatchObject({ status: 'MATCHED' });
    // matched → rejected: the quantity drops below the minimum
    (list().querySelector('.BuyLdC_isqdet strong') as Element).textContent = '5 Strip';
    await t.tick();
    expect(t.scanner.getSnapshot().results[0]).toMatchObject({
      status: 'REJECTED',
      score: null,
      priority: 'REJECTED',
    });
    expect(t.scanner.getSnapshot().diagnostics.scoring).toMatchObject({
      scored: 0,
      averageScore: null,
    });
    // rejected → matched via a filter change
    t.scanner.setFilterConfig({
      ...DEFAULT_FILTER_CONFIG,
      quantity: { enabled: true, min: 1, max: null },
    });
    const r = t.scanner.getSnapshot().results[0];
    expect(r?.status).toBe('MATCHED');
    expect(r?.score).toBeGreaterThan(0);
    expect(r?.priority).not.toBe('REJECTED');
  });

  it('filter changes refresh matched/rejected and scores together', () => {
    t = setup();
    t.scanner.start();
    t.scanner.setFilterConfig({ ...DEFAULT_FILTER_CONFIG, enabled: false });
    const d = t.scanner.getSnapshot().diagnostics.scoring;
    expect(d).toMatchObject({ eligible: 3, scored: 3, rejectedFromScoring: 0 });
    expect(d.priorityCounts.REJECTED).toBe(0);
  });

  it('scoring changes re-score without touching filter verdicts', () => {
    t = setup();
    t.scanner.start();
    const before = t.scanner.getState();
    t.scanner.setScoringConfig({ ...DEFAULT_SCORING_CONFIG, enabled: false });
    expect(t.scanner.getState()).toMatchObject({
      matched: before.matched,
      rejected: before.rejected,
    });
    const d = t.scanner.getSnapshot().diagnostics.scoring;
    expect(d).toMatchObject({ scored: 0, averageScore: null });
    expect(d.priorityCounts).toMatchObject({ UNSCORED: 2, REJECTED: 1, LOW: 0 });
    const applied = t.events.find((e) => e.type === 'SCORING_APPLIED');
    expect(applied).toMatchObject({ scored: 0, changed: 2 });
  });

  it('scoring off from the start: matched leads are UNSCORED, not LOW', () => {
    t = setup(undefined, { scoringConfig: { ...DEFAULT_SCORING_CONFIG, enabled: false } });
    t.scanner.start();
    expect(processed().map((e) => e.score?.priority)).toEqual(['REJECTED', 'UNSCORED', 'UNSCORED']);
  });

  it('an invalid scoring config falls back to defaults; an invalid update is refused', () => {
    t = setup(undefined, {
      scoringConfig: { ...DEFAULT_SCORING_CONFIG, quantityForFullPoints: Number.NaN },
    });
    t.scanner.start();
    const scores = processed().flatMap((e) => (e.score?.score == null ? [] : [e.score.score]));
    expect(scores).toHaveLength(2);
    for (const s of scores) expect(Number.isInteger(s)).toBe(true);

    t.scanner.setScoringConfig({
      ...DEFAULT_SCORING_CONFIG,
      thresholds: { critical: 10, high: 50, medium: 90 },
    });
    expect(t.types()).toContain('SCANNER_ERROR');
    expect(t.scanner.getSnapshot().diagnostics.scoring.configSummary).toBe(
      'weights 100 · critical ≥ 90 · high ≥ 75 · medium ≥ 50',
    );
  });

  it('logs a concise score line for matched leads only', () => {
    t = setup();
    const log = new ScanLogBuffer();
    t.scanner.on((e) => log.add(e));
    t.scanner.start();
    const lines = log.all().map((l) => l.message);
    const scoreLines = lines.filter((l) => l.startsWith('Score '));
    expect(scoreLines).toHaveLength(2);
    expect(scoreLines[0]).toMatch(/^Score \d+\/100 \((CRITICAL|HIGH|MEDIUM|LOW)\): \+25 country/);
    expect(lines).toContain(
      'Filter rejected: Country not allowed: Luxembourg; Quantity 10 < minimum 20',
    );
  });
});

describe('Contact Buyer check (read-only diagnostics)', () => {
  const withButton = (spec: Parameters<typeof leadCardHtml>[0], n: number, button = true) =>
    `<div id="BLCard${n}">${leadCardHtml(spec)}${
      button
        ? '<div class="SLC_dflx SLC_ pr"><button><strong>Contact Buyer</strong></button></div>'
        : ''
    }</div>`;

  it('counts found and missing buttons without clicking anything', () => {
    const html = `<main><section data-fixture-list>${withButton({ title: 'A Tablets' }, 1)}${withButton(
      { title: 'B Capsules' },
      2,
      false,
    )}</section></main>`;
    const click = vi.spyOn(HTMLElement.prototype, 'click');
    // Filters off: every lead is MATCHED, so every card gets the check.
    t = setup(html, {
      isElementVisible: () => true,
      filterConfig: { ...DEFAULT_FILTER_CONFIG, enabled: false },
    });
    t.scanner.start();
    const d = t.scanner.getSnapshot().diagnostics;
    expect(d.contactButton).toMatchObject({
      found: 1,
      notFound: 1,
      identityMismatch: 0,
      byReference: 1,
    });
    expect(d.contactButton.lastFailure).toBe(
      'ACTION_NOT_FOUND: no Contact Buyer button in the card',
    );
    expect(d.recentExtractions.map((x) => x.contactButton)).toEqual(['found', 'ACTION_NOT_FOUND']);
    expect(click).not.toHaveBeenCalled();
  });

  it('rejected leads are not checked (only matched leads can be clicked)', () => {
    t = setup(`<main><section data-fixture-list>${withButton({}, 1)}</section></main>`, {
      isElementVisible: () => true,
    });
    t.scanner.start();
    const d = t.scanner.getSnapshot().diagnostics;
    expect(t.scanner.getState()).toMatchObject({ rejected: 1 });
    expect(d.recentExtractions.map((x) => x.contactButton)).toEqual(['not-checked']);
    expect(d.contactButton).toMatchObject({ found: 0, notFound: 0 });
  });

  it('without layout (default visibility) the button is reported as not visible, never clicked', () => {
    t = setup(`<main><section data-fixture-list>${withButton({}, 1)}</section></main>`, {
      filterConfig: { ...DEFAULT_FILTER_CONFIG, enabled: false },
    });
    t.scanner.start();
    expect(t.scanner.getSnapshot().diagnostics.contactButton.lastFailure).toBe(
      'ACTION_NOT_FOUND: button is not visible',
    );
  });
});
