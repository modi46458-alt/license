import { describe, expect, it } from 'vitest';
import { leadCardHtml, mountFixture, type CardSpec } from '@/tests/fixtures/indiamart-lead-card';
import { extractLead } from '@/content/extraction/lead-extractor';
import type { ExtractedLead } from '../types/lead';
import { createLeadFingerprint } from './lead-fingerprint';
import { LeadRegistry } from './lead-registry';

function lead(spec: CardSpec = {}): { lead: ExtractedLead; fp: string } {
  mountFixture(leadCardHtml(spec));
  const extracted = extractLead(document.querySelector('article') as Element).lead;
  const fp = createLeadFingerprint(extracted);
  if (fp === null) throw new Error('fixture has no identity');
  return { lead: extracted, fp };
}

const resolve = (r: LeadRegistry, x: { lead: ExtractedLead; fp: string }, cardId?: string) =>
  r.resolve(x.lead, x.fp, cardId ?? null);

describe('LeadRegistry', () => {
  it('same fingerprint, same content → duplicate with the same id', () => {
    const r = new LeadRegistry();
    const a = resolve(r, lead());
    const b = resolve(r, lead());
    expect(a.kind).toBe('new');
    expect(b).toEqual({ kind: 'duplicate', leadId: a.leadId });
  });

  it('re-render gaining contact markers → updated, same id', () => {
    const r = new LeadRegistry();
    const a = resolve(r, lead({ contact: null }));
    const b = resolve(r, lead());
    expect(b.kind).toBe('updated');
    expect(b.leadId).toBe(a.leadId);
    expect(b.kind === 'updated' && b.added).toEqual(['mobile', 'whatsapp', 'email']);
  });

  it('new element gaining optional rows (new fingerprint) → updated, same id', () => {
    const r = new LeadRegistry();
    const a = resolve(r, lead({ rows: [], buys: null }));
    const b = resolve(r, lead());
    expect(b.kind).toBe('updated');
    expect(b.leadId).toBe(a.leadId);
  });

  it('an older partial render after the full one → duplicate, nothing lost', () => {
    const r = new LeadRegistry();
    const full = resolve(r, lead());
    const partial = resolve(r, lead({ rows: [], buys: null, contact: null }));
    expect(partial).toEqual({ kind: 'duplicate', leadId: full.leadId });
    expect(resolve(r, lead())).toEqual({ kind: 'duplicate', leadId: full.leadId });
  });

  it('same title and country but a different quantity → a different lead', () => {
    const r = new LeadRegistry();
    const a = resolve(r, lead({ rows: [['Quantity', '10 Strip']] }));
    const b = resolve(r, lead({ rows: [['Quantity', '500 Strip']] }));
    expect(b.kind).toBe('new');
    expect(b.leadId).not.toBe(a.leadId);
  });

  it('same title in another country → a different lead', () => {
    const r = new LeadRegistry();
    const a = resolve(r, lead({ country: 'Canada' }));
    const b = resolve(r, lead({ country: 'USA' }));
    expect(b.kind).toBe('new');
    expect(b.leadId).not.toBe(a.leadId);
  });

  it('lead age never affects identity', () => {
    const r = new LeadRegistry();
    const a = resolve(r, lead({ age: '22 mins ago' }));
    expect(resolve(r, lead({ age: '2 hours ago' }))).toEqual({
      kind: 'duplicate',
      leadId: a.leadId,
    });
  });

  it('same card element: a changed detail updates the same lead', () => {
    const r = new LeadRegistry();
    const a = resolve(r, lead({ rows: [['Quantity', '10 Strip']] }));
    const b = resolve(r, lead({ rows: [['Quantity', '50 Strip']] }), a.leadId);
    expect(b).toMatchObject({ kind: 'updated', leadId: a.leadId, added: ['quantity'] });
  });

  it('evicts the least recently seen lead beyond its bound', () => {
    const r = new LeadRegistry(2);
    const first = resolve(r, lead({ title: 'One' }));
    resolve(r, lead({ title: 'Two' }));
    resolve(r, lead({ title: 'Three' }));
    expect(r.size).toBe(2);
    expect(resolve(r, lead({ title: 'One' })).kind).toBe('new');
    expect(first.kind).toBe('new');
  });
});
