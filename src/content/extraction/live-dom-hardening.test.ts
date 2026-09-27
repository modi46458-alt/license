/**
 * Regressions from the first live run on IndiaMART Lead Manager (Phase 2
 * hardening). Each describe block maps to an issue seen in live diagnostics.
 */
import { describe, expect, it } from 'vitest';
import {
  leadCardHtml,
  leadListHtml,
  mountFixture,
  type CardSpec,
} from '@/tests/fixtures/indiamart-lead-card';
import { LABELED_FIELDS, LABELED_ROWS } from '../selectors/indiamart-selectors';
import { readLabeledField } from '../selectors/selector-resolver';
import { extractLead } from './lead-extractor';

function card(spec: CardSpec = {}): Element {
  mountFixture(leadCardHtml(spec));
  return document.querySelector('article') as Element;
}

const extract = (spec: CardSpec = {}) => extractLead(card(spec)).lead;

describe('1–2. country next to "Click here to view BuyLeads" hint text', () => {
  const live = ['Canada', 'Luxembourg', 'USA', 'Madagascar'];
  const markups = ['hint-child', 'hint-link', 'single-text', 'hint-first'] as const;

  for (const markup of markups) {
    it.each(live)(`${markup}: %s`, (country) => {
      const lead = extract({ country, countryMarkup: markup });
      expect(lead.country).toBe(country);
      expect(lead.extraction.fields.country).toBe('found');
    });
  }

  it.each(live)('clean markup still reads %s', (country) => {
    expect(extract({ country, countryMarkup: 'plain' }).country).toBe(country);
  });

  it('keeps multi-word countries whole', () => {
    expect(extract({ country: 'United Arab Emirates', countryMarkup: 'hint-child' }).country).toBe(
      'United Arab Emirates',
    );
  });

  it('never takes the lead age as the country', () => {
    const lead = extract({ country: null });
    expect(lead.country).toBeNull();
    expect(lead.rawLeadAge).toBe('22 mins ago');
    expect(lead.extraction.fields.country).toBe('missing');
  });

  it('an empty country element is a failure, not an absence', () => {
    const el = card({ country: 'Canada' });
    const strong = el.querySelector('.BuyLdC_time_loc .SLC_c2') as Element;
    strong.textContent = '';
    const { lead } = extractLead(el);
    expect(lead.country).toBeNull();
    expect(lead.extraction.failedFields).toContain('country');
  });
});

describe('3–4. Quantity row: missing vs present', () => {
  it('no Quantity row → null values, FIELD_MISSING, no warning', () => {
    const lead = extract({
      title: 'Big Penis Male Sexual Stimulant Usa 6800mg 12 Tablets',
      rows: [['Strength', '6800mg']],
    });
    expect(lead.quantity).toBeNull();
    expect(lead.quantityUnit).toBeNull();
    expect(lead.quantityRaw).toBeNull();
    expect(lead.extraction.fields.quantity).toBe('missing');
    expect(lead.extraction.failedFields).toEqual([]);
    expect(lead.extraction.warnings).toEqual([]);
  });

  it('never parses quantity from the title', () => {
    const lead = extract({ title: 'Estradiol Estrabet 2 Tablet 12 Tablets', rows: [] });
    expect(lead.quantity).toBeNull();
  });

  it('Quantity row present → parsed, raw kept', () => {
    const lead = extract({ rows: [['Quantity', '30 Vial']] });
    expect(lead).toMatchObject({ quantity: 30, quantityUnit: 'Vial', quantityRaw: '30 Vial' });
    expect(lead.extraction.fields.quantity).toBe('found');
  });

  it('"Quantity per Strip" alone is not a Quantity row', () => {
    const lead = extract({ rows: [['Quantity per Strip', '10 Capsules']] });
    expect(lead.quantityRaw).toBeNull();
    expect(lead.extraction.fields.quantity).toBe('missing');
    expect(lead.quantityPerStripRaw).toBe('10 Capsules');
  });

  it('Quantity row with an empty value → FIELD_EXTRACTION_FAILED', () => {
    const lead = extract({ rows: [['Quantity', ' ']] });
    expect(lead.quantityRaw).toBeNull();
    expect(lead.extraction.failedFields).toEqual(['quantity']);
  });

  it('malformed "10-20 Strips" keeps raw, null number, warning', () => {
    const lead = extract({ rows: [['Quantity', '10-20 Strips']] });
    expect(lead.quantityRaw).toBe('10-20 Strips');
    expect(lead.quantity).toBeNull();
    expect(lead.extraction.warnings).toContain('quantity: could not parse "10-20 Strips"');
  });
});

describe('5–6. Buys row: missing vs present', () => {
  const products = 'Dutasteride Tablet, Medicine Drop Shippers, Finasteride Tablet';
  const expected = ['Dutasteride Tablet', 'Medicine Drop Shippers', 'Finasteride Tablet'];

  it('no Buys row → buysRaw null, buys [], FIELD_MISSING', () => {
    const lead = extract({ title: 'Benoquin Cream 40% w/w', buys: null });
    expect(lead.buysRaw).toBeNull();
    expect(lead.buys).toEqual([]);
    expect(lead.extraction.fields.buys).toBe('missing');
    expect(lead.extraction.failedFields).toEqual([]);
  });

  it.each(['default', 'nested', 'inline', 'icon'] as const)('%s markup', (buyerMarkup) => {
    const lead = extract({ buys: products, buyerMarkup });
    expect(lead.buysRaw).toBe(products);
    expect(lead.buys).toEqual(expected);
    expect(lead.extraction.fields.buys).toBe('found');
  });

  it('plain div row from the Phase 2 notes', () => {
    expect(extract({ buys: products, plainBuyerRow: true }).buys).toEqual(expected);
  });

  it('a single product and stray whitespace', () => {
    const lead = extract({ buys: '   Pregabalin Capsules   ' });
    expect(lead.buys).toEqual(['Pregabalin Capsules']);
  });

  it('commas with empty items are dropped, raw is untouched', () => {
    const lead = extract({ buys: 'A Tablet, , B Tablet,' });
    expect(lead.buys).toEqual(['A Tablet', 'B Tablet']);
    expect(lead.buysRaw).toBe('A Tablet, , B Tablet,');
  });

  it('Buys row with no value → FIELD_EXTRACTION_FAILED', () => {
    const lead = extract({ buys: 'x', buyerMarkup: 'empty-value' });
    expect(lead.buys).toEqual([]);
    expect(lead.extraction.failedFields).toEqual(['buys']);
  });

  it('readLabeledField reports the three outcomes', () => {
    const read = (spec: CardSpec) =>
      readLabeledField(card(spec), LABELED_FIELDS.buyerProducts, LABELED_ROWS).status;
    expect(read({ buys: products })).toBe('found');
    expect(read({ buys: null })).toBe('missing');
    expect(read({ buys: 'x', buyerMarkup: 'empty-value' })).toBe('failed');
  });
});

describe('7–8. breadcrumb: page-level vs card-level', () => {
  it('card-level breadcrumb is used', () => {
    const lead = extract();
    expect(lead.category).toBe('Blood Pressure Medicine');
    expect(lead.productCategory).toBe('Propranolol Tablets');
  });

  it('page-level breadcrumb is never attached to a card', () => {
    mountFixture(
      leadListHtml([{ breadcrumbs: null }], { pageBreadcrumbs: ['Page Cat', 'Page Product'] }),
    );
    const { lead, selectorFailures } = extractLead(document.querySelector('article') as Element);
    expect(lead.category).toBeNull();
    expect(lead.productCategory).toBeNull();
    expect(lead.breadcrumbs).toEqual([]);
    expect(lead.extraction.fields.category).toBe('missing');
    expect(lead.extraction.failedFields).not.toContain('category');
    expect(lead.extraction.notes).toContain('category: page-level breadcrumb unavailable for card');
    expect(selectorFailures).not.toContain('categoryBreadcrumb');
  });

  it('no breadcrumb anywhere is a plain absence without a note', () => {
    const lead = extract({ breadcrumbs: null });
    expect(lead.extraction.fields.category).toBe('missing');
    expect(lead.extraction.notes.some((n) => n.startsWith('category'))).toBe(false);
  });

  it('an empty card breadcrumb is a failure', () => {
    const lead = extract({ breadcrumbs: [] });
    expect(lead.extraction.failedFields).toContain('category');
  });
});

describe('11. field missing vs extraction failed', () => {
  it('every field reports exactly one state', () => {
    const lead = extract({ rows: [['Quantity', '10-20 Strips']], buys: null });
    const { fields, failedFields, missingFields } = lead.extraction;
    expect(fields).toMatchObject({
      title: 'found',
      country: 'found',
      quantity: 'failed',
      buys: 'missing',
      strength: 'missing',
      engagement: 'missing',
      contact: 'found',
    });
    for (const f of failedFields) expect(fields[f]).toBe('failed');
    for (const f of missingFields) expect(fields[f]).toBe('missing');
    expect(new Set([...failedFields, ...missingFields]).size).toBe(
      failedFields.length + missingFields.length,
    );
  });

  it('one warning per failure; absences produce none', () => {
    const lead = extract({ country: null, rows: [], buys: null, breadcrumbs: null });
    expect(lead.extraction.warnings).toEqual([]);
  });
});

describe('12. confidence vs completeness', () => {
  it('a sparse but clean lead keeps full confidence', () => {
    const lead = extract({ rows: [], buys: null, breadcrumbs: null });
    expect(lead.extraction.confidence).toBe(1);
    expect(lead.extraction.completeness).toBeCloseTo(0.6);
  });

  it('failures lower confidence; absences do not', () => {
    const clean = extract({ rows: [], buys: null });
    const broken = extract({ rows: [['Quantity', '10-20 Strips']], buys: null });
    expect(clean.extraction.confidence).toBe(1);
    expect(broken.extraction.confidence).toBeLessThan(1);
  });

  it('confidence is independent of how many optional rows exist', () => {
    const rich = extract();
    const lean = extract({ rows: [['Quantity', '5 Box']] });
    expect(lean.extraction.confidence).toBe(rich.extraction.confidence);
  });
});
