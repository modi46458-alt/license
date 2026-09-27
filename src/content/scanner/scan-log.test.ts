import { describe, expect, it } from 'vitest';
import { normalizeLead } from '@/core/normalization';
import type { Lead } from '@/core/types/lead';
import type { ScannerEvent } from '@/core/types/scanner';
import { extractLead } from '../extraction/lead-extractor';
import { leadCardHtml, mountFixture } from '@/tests/fixtures/indiamart-lead-card';
import { MAX_LOG_ENTRIES, ScanLogBuffer, formatEvent } from './scan-log';

function processed(spec = {}): ScannerEvent {
  mountFixture(leadCardHtml(spec));
  const { lead } = extractLead(document.querySelector('article') as Element);
  const full: Lead = { ...lead, id: 'lead_1', fingerprint: 'fp_1' };
  return {
    type: 'LEAD_PROCESSED',
    lead: full,
    normalized: normalizeLead(full, { normalizedAt: 0 }),
    filter: null,
    score: null,
    detection: { confidence: 0.9, signals: [], method: 'walk', depth: 1 },
    processingTimeMs: 1,
    timestamp: 0,
  };
}

describe('scan log formatting', () => {
  it('describes a processed lead', () => {
    expect(formatEvent(processed()).map((l) => l.message)).toEqual([
      'Lead detected: Propanolol 20mg Tablets From Europe to Europe',
      'Country: Luxembourg, Quantity: 10 Strip',
      'Mobile, WhatsApp, Email available',
      'Lead processed',
    ]);
  });

  it('does not flag the known engagement gap as a lead warning', () => {
    const lines = formatEvent(processed());
    expect(lines.some((l) => l.level === 'WARN')).toBe(false);
  });

  it('logs real extraction failures but not absent fields', () => {
    const messages = formatEvent(
      processed({ country: null, rows: [['Quantity', '10-20 Strips']], contact: null }),
    ).map((l) => l.message);
    expect(messages).toContain('Extraction failed: quantity: could not parse "10-20 Strips"');
    expect(messages.some((m) => m.includes('country'))).toBe(false);
    expect(messages).toContain('No contact channels listed');
    expect(messages.at(-1)).toBe('Lead processed with 1 warning');
  });

  it('omits absent optional fields instead of reporting them as failures', () => {
    const messages = formatEvent(processed({ rows: [], buys: null })).map((l) => l.message);
    expect(messages).toContain('Country: Luxembourg');
    expect(messages.some((m) => /quantity|buys/i.test(m))).toBe(false);
    expect(messages.at(-1)).toBe('Lead processed');
  });

  it('stays quiet for routine batches with nothing new', () => {
    expect(
      formatEvent({
        type: 'SCAN_COMPLETED',
        newLeads: 0,
        durationMs: 1,
        initial: false,
        timestamp: 0,
      }),
    ).toEqual([]);
  });
});

describe('ScanLogBuffer', () => {
  it(`keeps at most ${MAX_LOG_ENTRIES} entries`, () => {
    const log = new ScanLogBuffer();
    for (let i = 0; i < 500; i++) log.add({ type: 'SCANNER_ERROR', error: `e${i}`, timestamp: i });
    expect(log.size).toBe(MAX_LOG_ENTRIES);
    expect(log.all()[0]?.message).toBe('Scanner error: e300');
    expect(log.all().at(-1)?.id).toBe(500);
  });

  it('returns entries after an id', () => {
    const log = new ScanLogBuffer(10);
    log.add({ type: 'SCANNER_STOPPED', timestamp: 1 });
    log.add({ type: 'SCANNER_STOPPED', timestamp: 2 });
    expect(log.since(1).map((e) => e.id)).toEqual([2]);
  });
});
