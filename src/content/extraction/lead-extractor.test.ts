import { describe, expect, it, vi } from 'vitest';
import { leadCardHtml, mountFixture, type CardSpec } from '@/tests/fixtures/indiamart-lead-card';
import { ENGAGEMENT } from '../selectors/indiamart-selectors';
import { extractContact } from './contact-extractor';
import { ENGAGEMENT_UNVERIFIED_NOTE, extractEngagement } from './engagement-extractor';
import { extractLead } from './lead-extractor';

function card(spec: CardSpec = {}): Element {
  mountFixture(leadCardHtml(spec));
  return document.querySelector('article') as Element;
}

describe('extractLead on the observed card', () => {
  const { lead, selectorFailures } = extractLead(card(), { now: 1_700_000_000_000 });

  it('title: raw preserved, normalized separately', () => {
    expect(lead.rawTitle).toBe('Propanolol 20mg Tablets From Europe to Europe');
    expect(lead.normalizedTitle).toBe('propanolol 20mg tablets from europe to europe');
  });

  it('country and lead age are not confused', () => {
    expect(lead.country).toBe('Luxembourg');
    expect(lead.rawLeadAge).toBe('22 mins ago');
    expect(lead.leadAgeMinutes).toBe(22);
  });

  it('keeps title and breadcrumb product separate', () => {
    expect(lead.breadcrumbs).toEqual(['Blood Pressure Medicine', 'Propranolol Tablets']);
    expect(lead.category).toBe('Blood Pressure Medicine');
    expect(lead.productCategory).toBe('Propranolol Tablets');
    expect(lead.rawTitle).not.toBe(lead.productCategory);
  });

  it('quantity, strength, dosage form, quantity per strip', () => {
    expect(lead).toMatchObject({
      quantityRaw: '10 Strip',
      quantity: 10,
      quantityUnit: 'Strip',
      strengthRaw: '20mg',
      strengthValue: 20,
      strengthUnit: 'mg',
      dosageForm: 'Tablet',
      quantityPerStripRaw: '10 Capsules',
      quantityPerStripValue: 10,
      quantityPerStripUnit: 'Capsules',
    });
  });

  it('buyer products: raw kept, list split', () => {
    expect(lead.buysRaw).toBe('Dutasteride Tablet, Medicine Drop Shippers, Finasteride Tablet');
    expect(lead.buys).toEqual([
      'Dutasteride Tablet',
      'Medicine Drop Shippers',
      'Finasteride Tablet',
    ]);
  });

  it('contact: availability only, values never invented', () => {
    expect(lead.contact).toEqual({
      mobileAvailable: true,
      mobileNumber: null,
      whatsappAvailable: true,
      emailAvailable: true,
      email: null,
    });
  });

  it('engagement: unverified markup yields nulls and a note, not a failure', () => {
    expect(lead.engagement).toEqual({
      requirements: null,
      calls: null,
      replies: null,
      verified: false,
      raw: null,
    });
    expect(lead.extraction.notes).toContain(ENGAGEMENT_UNVERIFIED_NOTE);
    expect(lead.extraction.warnings).toEqual([]);
    expect(lead.extraction.fields.engagement).toBe('missing');
    expect(lead.extraction.failedFields).not.toContain('engagement');
  });

  it('full extraction has full confidence and no failures', () => {
    expect(lead.extraction.confidence).toBe(1);
    expect(lead.extraction.completeness).toBe(1);
    expect(lead.extraction.failedFields).toEqual([]);
    expect(selectorFailures).toEqual([]);
    expect(lead.detectedAt).toBe(1_700_000_000_000);
  });
});

describe('breadcrumbs of any length', () => {
  it.each([
    [['Medicine'], 'Medicine', null],
    [
      ['Pharma', 'Blood Pressure Medicine', 'Propranolol Tablets'],
      'Blood Pressure Medicine',
      'Propranolol Tablets',
    ],
  ] as const)('%j', (crumbs, category, product) => {
    const { lead } = extractLead(card({ breadcrumbs: crumbs }));
    expect(lead.breadcrumbs).toEqual(crumbs);
    expect(lead.category).toBe(category);
    expect(lead.productCategory).toBe(product);
  });
});

describe('markup variants from the Phase 2 notes', () => {
  it('reads a div buyer row with plain spans', () => {
    const { lead } = extractLead(card({ plainBuyerRow: true }));
    expect(lead.buys).toHaveLength(3);
  });

  it('finds the lead age outside the time/location block', () => {
    const { lead } = extractLead(card({ ageOutsideTimeLoc: true }));
    expect(lead.rawLeadAge).toBe('22 mins ago');
    expect(lead.country).toBe('Luxembourg');
    expect(lead.extraction.confidence).toBeLessThan(1);
  });

  it('"Quantity" never reads "Quantity per Strip"', () => {
    const { lead } = extractLead(card({ rows: [['Quantity per Strip', '10 Capsules']] }));
    expect(lead.quantityRaw).toBeNull();
    expect(lead.quantityPerStripRaw).toBe('10 Capsules');
  });
});

describe('partial and broken cards', () => {
  it('absent fields are null and listed as missing, not failed', () => {
    const { lead } = extractLead(
      card({ country: null, age: null, rows: [], buys: null, breadcrumbs: null, contact: null }),
    );
    expect(lead.rawTitle).not.toBeNull();
    expect(lead.country).toBeNull();
    expect(lead.quantity).toBeNull();
    expect(lead.buys).toEqual([]);
    expect(lead.contact.mobileAvailable).toBe(false);
    expect(lead.extraction.failedFields).toEqual([]);
    expect(lead.extraction.warnings).toEqual([]);
    expect(lead.extraction.missingFields).toEqual(
      expect.arrayContaining(['country', 'leadAge', 'category', 'quantity', 'buys', 'contact']),
    );
    // Everything present was read perfectly; the card is just sparse.
    expect(lead.extraction.confidence).toBe(1);
    expect(lead.extraction.completeness).toBeCloseTo(0.3);
  });

  it('missing optional pharma fields are not failures', () => {
    const { lead } = extractLead(card({ rows: [['Quantity', '5 Box']] }));
    expect(lead.strengthRaw).toBeNull();
    expect(lead.dosageForm).toBeNull();
    expect(lead.extraction.failedFields).toEqual([]);
  });

  it('malformed quantity keeps the raw value and warns', () => {
    const { lead } = extractLead(
      card({
        rows: [
          ['Quantity', '10-20 Strips'],
          ['Strength', '20mg + 10mg'],
        ],
      }),
    );
    expect(lead.quantityRaw).toBe('10-20 Strips');
    expect(lead.quantity).toBeNull();
    expect(lead.quantityUnit).toBeNull();
    expect(lead.strengthValue).toBeNull();
    expect(lead.extraction.warnings).toEqual(
      expect.arrayContaining([
        'quantity: could not parse "10-20 Strips"',
        'strength: could not parse "20mg + 10mg"',
      ]),
    );
    // Present but unparseable → FIELD_EXTRACTION_FAILED.
    expect(lead.extraction.failedFields).toEqual(['quantity', 'strength']);
  });

  it('unparseable lead age is kept raw with a warning', () => {
    const { lead } = extractLead(card({ age: 'Yesterday' }));
    expect(lead.leadAgeMinutes).toBe(1440);
  });

  it('an exception in one field does not lose the others', () => {
    const el = card();
    const original = el.querySelectorAll.bind(el);
    vi.spyOn(el, 'querySelectorAll').mockImplementation((selector: string) => {
      if (selector.includes('tooltip_vfr')) throw new Error('boom');
      return original(selector);
    });
    const { lead } = extractLead(el);
    expect(lead.extraction.warnings).toContain('contact: extraction error');
    expect(lead.contact.mobileAvailable).toBe(false);
    expect(lead.rawTitle).not.toBeNull();
    expect(lead.quantity).toBe(10);
  });

  it('an empty element yields an empty lead without throwing', () => {
    const { lead } = extractLead(document.createElement('div'));
    expect(lead.extraction.confidence).toBe(0);
    expect(lead.extraction.completeness).toBe(0);
    // Only the required title is a failure; the rest is simply absent.
    expect(lead.extraction.failedFields).toEqual(['title']);
  });
});

describe('contact extractor', () => {
  it('reads partial availability', () => {
    const { contact, source } = extractContact(card({ contact: { whatsapp: true } }));
    expect(source).toBe('marker');
    expect(contact).toMatchObject({
      mobileAvailable: false,
      whatsappAvailable: true,
      emailAvailable: false,
    });
  });

  it('falls back to text when the marker class changes', () => {
    const el = card();
    el.querySelectorAll('p.tooltip_vfr').forEach((p) => p.classList.remove('tooltip_vfr'));
    const { contact, source } = extractContact(el);
    expect(source).toBe('text');
    expect(contact.mobileAvailable && contact.whatsappAvailable && contact.emailAvailable).toBe(
      true,
    );
  });

  it('never copies phone numbers or emails even when present nearby', () => {
    const el = card();
    el.insertAdjacentHTML('beforeend', '<p>+91 98765 43210 buyer@example.com</p>');
    const { contact } = extractContact(el);
    expect(contact.mobileNumber).toBeNull();
    expect(contact.email).toBeNull();
  });
});

describe('contact negatives', () => {
  it('"Not Available" markers do not count as available', () => {
    const el = document.createElement('div');
    el.innerHTML =
      '<p class="tooltip_vfr">Mobile Number Not Available</p>' +
      '<p class="tooltip_vfr">WhatsApp Not Available</p>' +
      '<p class="tooltip_vfr">Email ID Not Available</p>';
    expect(extractContact(el).contact).toMatchObject({
      mobileAvailable: false,
      whatsappAvailable: false,
      emailAvailable: false,
    });
  });
});

describe('engagement extractor', () => {
  it('does not guess from free text while unverified', () => {
    const { engagement, state, message } = extractEngagement(card());
    expect(engagement.requirements).toBeNull();
    expect(state).toBe('missing');
    expect(message).toBe(ENGAGEMENT_UNVERIFIED_NOTE);
  });

  it('reads counts once a container is verified', () => {
    const el = card({ engagementText: null });
    el.insertAdjacentHTML(
      'beforeend',
      '<div class="Eng_x">Requirements: 8 Calls: 3 Replies: 1,126</div>',
    );
    const { engagement, state } = extractEngagement(el, {
      ...ENGAGEMENT,
      containerSelector: '.Eng_x',
    });
    expect(state).toBe('found');
    expect(engagement).toEqual({
      requirements: 8,
      calls: 3,
      replies: 1126,
      verified: true,
      raw: 'Requirements: 8 Calls: 3 Replies: 1,126',
    });
  });

  it('reports a missing verified container', () => {
    const { engagement, state, message } = extractEngagement(card(), {
      ...ENGAGEMENT,
      containerSelector: '.Eng_x',
    });
    expect(engagement.verified).toBe(false);
    expect(state).toBe('missing');
    expect(message).toMatch(/not found/);
  });
});
