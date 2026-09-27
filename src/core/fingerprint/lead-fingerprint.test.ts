import { describe, expect, it } from 'vitest';
import { extractLead } from '@/content/extraction/lead-extractor';
import { leadCardHtml, mountFixture } from '@/tests/fixtures/indiamart-lead-card';
import type { ExtractedLead } from '../types/lead';
import { cyrb53 } from './hash';
import { createLeadFingerprint, leadIdFromFingerprint } from './lead-fingerprint';

function leadFrom(html: string, now = 1): ExtractedLead {
  const root = mountFixture(html);
  const card = root.querySelector('article');
  if (!card) throw new Error('fixture');
  return extractLead(card, { now }).lead;
}

describe('fingerprint', () => {
  it('is deterministic', () => {
    expect(cyrb53('abc')).toBe(cyrb53('abc'));
    expect(cyrb53('abc')).not.toBe(cyrb53('abd'));
    const a = createLeadFingerprint(leadFrom(leadCardHtml()));
    const b = createLeadFingerprint(leadFrom(leadCardHtml()));
    expect(a).toMatch(/^fp_[0-9a-f]{14}$/);
    expect(a).toBe(b);
  });

  it('ignores lead age, detection time, engagement and contact availability', () => {
    const base = createLeadFingerprint(leadFrom(leadCardHtml(), 1));
    const aged = createLeadFingerprint(
      leadFrom(
        leadCardHtml({ age: '2 hours ago', engagementText: 'Replies: 500', contact: null }),
        999,
      ),
    );
    expect(aged).toBe(base);
  });

  it('ignores whitespace and case differences in the title', () => {
    const a = createLeadFingerprint(leadFrom(leadCardHtml({ title: 'Propanolol 20mg Tablets' })));
    const b = createLeadFingerprint(
      leadFrom(leadCardHtml({ title: '  PROPANOLOL  20mg tablets ' })),
    );
    expect(a).toBe(b);
  });

  it.each([
    ['country', { country: 'Germany' }],
    ['quantity', { rows: [['Quantity', '20 Strip']] as const }],
    ['product category', { breadcrumbs: ['Blood Pressure Medicine', 'Atenolol Tablets'] }],
    ['buyer products', { buys: 'Something Else' }],
    ['title', { title: 'Another product' }],
  ])('changes when %s changes', (_label, spec) => {
    const base = createLeadFingerprint(leadFrom(leadCardHtml()));
    expect(createLeadFingerprint(leadFrom(leadCardHtml(spec)))).not.toBe(base);
  });

  it('is null without a title or product category', () => {
    expect(
      createLeadFingerprint(leadFrom(leadCardHtml({ title: null, breadcrumbs: null }))),
    ).toBeNull();
    expect(createLeadFingerprint(leadFrom(leadCardHtml({ title: null })))).not.toBeNull();
  });

  it('derives a stable id', () => {
    expect(leadIdFromFingerprint('fp_00abcdef123456')).toBe('lead_00abcdef123456');
  });
});
