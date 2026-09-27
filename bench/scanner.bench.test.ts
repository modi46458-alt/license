/**
 * Scanner benchmark (jsdom). Run: npm run bench
 * Numbers are jsdom timings on this machine, not Chrome timings: use them to
 * compare before/after, not against live measurements.
 */
import { it } from 'vitest';
import { DEFAULT_FILTER_CONFIG } from '@/core/filters';
import { leadCardHtml, mountFixture, type CardSpec } from '@/tests/fixtures/indiamart-lead-card';
import { manualScheduler, settle } from '@/tests/manual-scheduler';
import { LeadScanner } from '@/content/scanner/lead-scanner';

const COUNTRIES = ['USA', 'Canada', 'Qatar', 'Luxembourg', 'UK', 'Spain', 'Australia'];

function spec(i: number): CardSpec {
  return {
    title: `Lead ${i} ${i % 3 === 0 ? 'Tablets' : i % 3 === 1 ? 'Injection' : 'Capsules'} ${i % 7}mg`,
    country: COUNTRIES[i % COUNTRIES.length] ?? 'USA',
    rows: [
      ['Quantity', `${(i % 50) + 1} Strip`],
      ['Strength', `${(i % 9) + 1}0mg`],
      ['Dosage Form', 'Tablet'],
    ],
    buys: i % 2 ? 'Paracetamol Tablet, Ibuprofen Tablet' : null,
  };
}

function block(i: number): string {
  return `<div id="BLCard${i}">${leadCardHtml(spec(i))}<div class="SLC_dflx SLC_ pr"><button><strong>Contact Buyer</strong></button></div></div>`;
}

function stats(samples: number[]) {
  const s = [...samples].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] ?? 0;
  const avg = s.reduce((a, b) => a + b, 0) / (s.length || 1);
  return { n: s.length, avg, p50: q(50), p95: q(95), p99: q(99), max: s.at(-1) ?? 0 };
}

const fmt = (n: number) => n.toFixed(3);

function scanner(schedule = manualScheduler().schedule) {
  return new LeadScanner({
    document,
    getUrl: () => 'https://seller.indiamart.com/bltxn/',
    schedule,
    frameBudgetMs: 1e9,
    filterConfig: DEFAULT_FILTER_CONFIG,
  });
}

const lines: string[] = [];
const report = (line: string) => {
  lines.push(line);
  console.log(`BENCH ${line}`);
};

it('initial scan: 100 / 500 / 1000 leads', () => {
  // warm-up (JIT)
  mountFixture(
    `<main><section>${Array.from({ length: 200 }, (_, i) => block(i)).join('')}</section></main>`,
  );
  scanner().start();
  for (const n of [100, 500, 1000]) {
    mountFixture(
      `<main><section>${Array.from({ length: n }, (_, i) => block(i)).join('')}</section></main>`,
    );
    const s = scanner();
    const perLead: number[] = [];
    s.on((e) => {
      if (e.type === 'LEAD_PROCESSED') perLead.push(e.processingTimeMs);
    });
    const t0 = performance.now();
    s.start();
    const wall = performance.now() - t0;
    const st = stats(perLead);
    report(
      `leads=${n} pipeline avg=${fmt(st.avg)} p50=${fmt(st.p50)} p95=${fmt(st.p95)} p99=${fmt(st.p99)} max=${fmt(st.max)} ms | wall=${wall.toFixed(1)} ms (${fmt(wall / n)} ms/lead incl. card detection) | ${Math.round((n / wall) * 1000)} leads/s`,
    );
  }
});

it('mutations: 5000 / 10000 (10% lead cards, 90% unrelated DOM churn)', async () => {
  for (const total of [5000, 10000]) {
    mountFixture('<main><section data-list></section><aside data-noise></aside></main>');
    const sched = manualScheduler();
    const s = scanner(sched.schedule);
    s.start();
    const list = document.querySelector('[data-list]') as Element;
    const noise = document.querySelector('[data-noise]') as Element;
    const flushes: number[] = [];
    let card = 0;
    for (let m = 0; m < total; m += 50) {
      for (let k = 0; k < 50; k++) {
        if ((m + k) % 10 === 0) list.insertAdjacentHTML('beforeend', block(card++));
        else noise.insertAdjacentHTML('beforeend', `<span class="SLC_f12">tick ${m + k}</span>`);
      }
      await settle();
      const t0 = performance.now();
      sched.run();
      flushes.push(performance.now() - t0);
    }
    const st = stats(flushes);
    const totalMs = flushes.reduce((a, b) => a + b, 0);
    const d = s.getSnapshot().diagnostics;
    report(
      `mutations=${total} cards=${card} detected=${s.getState().detected} batch avg=${fmt(st.avg)} p95=${fmt(st.p95)} p99=${fmt(st.p99)} max=${fmt(st.max)} ms | total=${totalMs.toFixed(1)} ms | ${fmt(totalMs / card)} ms/lead | ${Math.round((card / totalMs) * 1000)} leads/s | observed=${d.mutationCount}`,
    );
  }
});

it('repeated DOM updates and duplicate candidate nodes (500 known leads)', async () => {
  mountFixture(
    `<main><section data-list>${Array.from({ length: 500 }, (_, i) => block(i)).join('')}</section></main>`,
  );
  const sched = manualScheduler();
  const s = scanner(sched.schedule);
  s.start();
  const list = document.querySelector('[data-list]') as Element;
  const ages = Array.from(document.querySelectorAll('.MrLdsB_m1 strong'));

  // 1) Repeated updates: every card's age text ticks 4 times (no identity or filter change).
  const updates: number[] = [];
  for (let round = 0; round < 4; round++) {
    ages.forEach((el, i) => (el.textContent = `${round + 23 + (i % 5)} mins ago`));
    await settle();
    const t0 = performance.now();
    sched.run();
    updates.push(performance.now() - t0);
  }
  // 2) Duplicate candidates: 500 re-rendered copies of already-known leads.
  const t1 = performance.now();
  list.insertAdjacentHTML('beforeend', Array.from({ length: 500 }, (_, i) => block(i)).join(''));
  await settle();
  sched.run();
  const dupMs = performance.now() - t1;
  const st = stats(updates);
  const state = s.getState();
  report(
    `repeated-updates rounds=4 cards=500 per-round avg=${fmt(st.avg)} max=${fmt(st.max)} ms (${fmt(st.avg / 500)} ms/card) | duplicates=500 total=${dupMs.toFixed(1)} ms (${fmt(dupMs / 500)} ms/copy) | detected=${state.detected} duplicates=${state.duplicates} updated-events=0-expected`,
  );
});
