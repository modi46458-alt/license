import { describe, expect, it } from 'vitest';
import type { Lead } from '../types/lead';
import {
  COUNTRY_COUNT,
  NORMALIZATION_VERSION,
  normalizeBuyerProducts,
  normalizeContact,
  normalizeCountry,
  normalizeDosageForm,
  normalizeForComparison,
  normalizeLead,
  normalizeLeadAge,
  normalizeMeasure,
  normalizeStrength,
  normalizeText,
  tokenize,
} from './index';

/* ------------------------------------------------------------------ */
/* 1–3 text and title                                                   */
/* ------------------------------------------------------------------ */

describe('text', () => {
  it.each([
    ['  Propranolol   20mg Tablets  ', 'Propranolol 20mg Tablets'],
    ['a\u00a0b', 'a b'],
    ['a\u2003\u2009b', 'a b'],
    ['a\u200bb', 'a b'],
    ['a\u200db', 'ab'],
    ['\ufeffTitle', 'Title'],
    ['Line\nbreak\ttab', 'Line break tab'],
    ['Benoquin Cream 40% w/w', 'Benoquin Cream 40% w/w'],
    ['ＦＵＬＬ ｗｉｄｔｈ', 'FULL width'],
  ])('normalizeText(%j) → %j', (input, expected) => {
    expect(normalizeText(input)).toBe(expected);
  });

  it.each([null, undefined, '', '   ', '\u00a0\u200b'])('empty %j → null', (input) => {
    expect(normalizeText(input)).toBeNull();
    expect(normalizeForComparison(input)).toBeNull();
  });

  it('comparison form lower-cases but keeps punctuation', () => {
    expect(normalizeForComparison('  Propranolol   20mg Tablets  ')).toBe(
      'propranolol 20mg tablets',
    );
    expect(normalizeForComparison('Testo E, 250 Mg/ml')).toBe('testo e, 250 mg/ml');
  });

  it('never mutates its input', () => {
    const input = '  Mixed   Case  ';
    normalizeForComparison(input);
    expect(input).toBe('  Mixed   Case  ');
  });
});

describe('title tokens', () => {
  it.each([
    ['Propranolol 20mg Tablets', ['propranolol', '20mg', 'tablets']],
    [
      'Testo E Testosterone Enanthate Injection, 250 Mg/ml',
      ['testo', 'e', 'testosterone', 'enanthate', 'injection', '250', 'mg/ml'],
    ],
    ['Benoquin Cream 40% w/w', ['benoquin', 'cream', '40%', 'w/w']],
    ['(Generic) Finasteride "5mg"', ['generic', 'finasteride', '5mg']],
    ['Tablet tablet TABLET', ['tablet']],
    [
      'TestomaxxTestosterone Enanthate Solution., 400mg/ml',
      ['testomaxxtestosterone', 'enanthate', 'solution', '400mg/ml'],
    ],
  ])('%j', (title, tokens) => {
    expect(tokenize(title)).toEqual(tokens);
  });

  it('no stop-word removal or synonyms', () => {
    expect(tokenize('Propanolol 20mg Tablets From Europe to Europe')).toEqual([
      'propanolol',
      '20mg',
      'tablets',
      'from',
      'europe',
      'to',
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* 4–7 country                                                          */
/* ------------------------------------------------------------------ */

describe('country', () => {
  it.each([
    ['USA', 'United States', 'US'],
    ['US', 'United States', 'US'],
    ['U.S.A.', 'United States', 'US'],
    ['United States', 'United States', 'US'],
    ['united states of america', 'United States', 'US'],
    ['UK', 'United Kingdom', 'GB'],
    ['U.K.', 'United Kingdom', 'GB'],
    ['Great Britain', 'United Kingdom', 'GB'],
    ['United Kingdom', 'United Kingdom', 'GB'],
    ['UAE', 'United Arab Emirates', 'AE'],
    ['The Netherlands', 'Netherlands', 'NL'],
    ['Holland', 'Netherlands', 'NL'],
    ['Luxembourg', 'Luxembourg', 'LU'],
    ['Canada', 'Canada', 'CA'],
    ['Madagascar', 'Madagascar', 'MG'],
    ['  kenya ', 'Kenya', 'KE'],
    ["Cote d'Ivoire", "Côte d'Ivoire", 'CI'],
    ['Türkiye', 'Turkey', 'TR'],
    ['Czech Republic', 'Czechia', 'CZ'],
    ['Russian Federation', 'Russia', 'RU'],
    ['Trinidad & Tobago', 'Trinidad and Tobago', 'TT'],
  ])('%j → %s (%s)', (raw, normalized, code) => {
    const { value, warnings } = normalizeCountry(raw);
    expect(value).toEqual({ raw, normalized, code });
    expect(warnings).toEqual([]);
  });

  it.each(['Atlantis', 'Congo', 'Korea', 'Dubai'])(
    'unknown or ambiguous %j is kept, not guessed',
    (raw) => {
      const { value, warnings } = normalizeCountry(` ${raw} `);
      expect(value).toEqual({ raw: ` ${raw} `, normalized: raw, code: null });
      expect(warnings).toEqual(['country: not in alias map']);
    },
  );

  it('null stays null without warnings', () => {
    expect(normalizeCountry(null)).toEqual({
      value: { raw: null, normalized: null, code: null },
      warnings: [],
    });
  });

  it('has a sizeable, conflict-free table', () => {
    // buildIndex throws on conflicting aliases at import time.
    expect(COUNTRY_COUNT).toBeGreaterThan(150);
  });
});

/* ------------------------------------------------------------------ */
/* 8–14 quantity                                                        */
/* ------------------------------------------------------------------ */

describe('quantity', () => {
  it.each([
    ['10 Strip', 10, 'Strip', 'strip'],
    ['10 strips', 10, 'strips', 'strip'],
    ['50 Vial', 50, 'Vial', 'vial'],
    ['5 vials', 5, 'vials', 'vial'],
    ['2 Boxes', 2, 'Boxes', 'box'],
    ['1 Box', 1, 'Box', 'box'],
    ['100 Pieces', 100, 'Pieces', 'piece'],
    ['1 Piece', 1, 'Piece', 'piece'],
    ['500 Pcs', 500, 'Pcs', 'piece'],
    ['3 Bottles', 3, 'Bottles', 'bottle'],
    ['250 Grams', 250, 'Grams', 'gram'],
    ['1 gram', 1, 'gram', 'gram'],
    ['5 Kgs', 5, 'Kgs', 'kg'],
    ['1 kg', 1, 'kg', 'kg'],
    ['1,000 Tablets', 1000, 'Tablets', 'tablet'],
    ['30 Capsules', 30, 'Capsules', 'capsule'],
    ['30 Vial', 30, 'Vial', 'vial'],
    ['2.5 Kg', 2.5, 'Kg', 'kg'],
  ])('%j → %d %s (%s)', (raw, value, unit, normalizedUnit) => {
    const result = normalizeMeasure('quantity', raw);
    expect(result.value).toEqual({ raw, value, unit, normalizedUnit });
    expect(result.warnings).toEqual([]);
  });

  it('never converts between units', () => {
    expect(normalizeMeasure('quantity', '1 kg').value.normalizedUnit).toBe('kg');
    expect(normalizeMeasure('quantity', '1000 grams').value.value).toBe(1000);
  });

  it.each(['10-20 Strips', 'Bulk', 'As required', '10 to 20 Boxes'])(
    'malformed %j keeps raw, value null, warning',
    (raw) => {
      const result = normalizeMeasure('quantity', raw);
      expect(result.value).toEqual({ raw, value: null, unit: null, normalizedUnit: null });
      expect(result.warnings).toEqual(['quantity: not a single number with a unit']);
    },
  );

  it('unknown unit keeps its spelling with a warning', () => {
    const result = normalizeMeasure('quantity', '4 Crates');
    expect(result.value).toMatchObject({ value: 4, unit: 'Crates', normalizedUnit: 'crates' });
    expect(result.warnings).toEqual(['quantity: unrecognized unit']);
  });

  it('a unit with extra detail keeps the leading canonical unit', () => {
    const result = normalizeMeasure('quantity', '10 Strips of 10 Tablets');
    expect(result.value).toMatchObject({ value: 10, normalizedUnit: 'strip' });
    expect(result.warnings).toEqual(['quantity: unit has extra detail']);
  });

  it('number without unit', () => {
    const result = normalizeMeasure('quantity', '12');
    expect(result.value).toMatchObject({ value: 12, unit: null, normalizedUnit: null });
    expect(result.warnings).toEqual(['quantity: no unit']);
  });

  it('quantity per strip uses its own field name in warnings', () => {
    expect(normalizeMeasure('quantityPerStrip', '10 Capsules').value.normalizedUnit).toBe(
      'capsule',
    );
    expect(normalizeMeasure('quantityPerStrip', 'ten').warnings).toEqual([
      'quantityPerStrip: not a single number with a unit',
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* 15–18 strength                                                       */
/* ------------------------------------------------------------------ */

describe('strength', () => {
  it.each([
    ['20mg', 20, 'mg'],
    ['20 mg', 20, 'mg'],
    ['20MG', 20, 'mg'],
    ['2.5 mg', 2.5, 'mg'],
    ['250 mg/ml', 250, 'mg/ml'],
    ['400mg/ml', 400, 'mg/ml'],
    ['250 Mg/ml', 250, 'mg/ml'],
    ['10 mg/5 ml', 10, 'mg/5ml'],
    ['500 mcg', 500, 'mcg'],
    ['500 µg', 500, 'mcg'],
    ['5000 IU', 5000, 'iu'],
    ['40% w/w', 40, '% w/w'],
    ['1 g', 1, 'g'],
    ['6800mg', 6800, 'mg'],
  ])('%j → %d %s', (raw, value, unit) => {
    const { value: s, warnings } = normalizeStrength(raw);
    expect(s).toEqual({
      raw,
      value,
      unit,
      secondaryValue: null,
      secondaryUnit: null,
      complex: false,
    });
    expect(warnings).toEqual([]);
  });

  it('"36 IU (12 mg)" keeps both quantities', () => {
    const { value, warnings } = normalizeStrength('36 IU (12 mg)');
    expect(value).toEqual({
      raw: '36 IU (12 mg)',
      value: 36,
      unit: 'iu',
      secondaryValue: 12,
      secondaryUnit: 'mg',
      complex: true,
    });
    expect(warnings).toEqual(['strength: complex format (value with equivalent)']);
  });

  it.each(['20mg + 10mg', '20mg/10mg', '20 mg & 10 mg'])('combination %j', (raw) => {
    const { value, warnings } = normalizeStrength(raw);
    expect(value).toMatchObject({
      value: 20,
      unit: 'mg',
      secondaryValue: 10,
      secondaryUnit: 'mg',
      complex: true,
    });
    expect(warnings).toEqual(['strength: combination']);
  });

  it.each(['High', '10-20mg', 'mg', '2,5 mg'])('unparseable %j → nulls + warning', (raw) => {
    const { value, warnings } = normalizeStrength(raw);
    expect(value).toMatchObject({ raw, value: null, unit: null, complex: false });
    expect(warnings).toEqual(['strength: unrecognized format']);
  });

  it('unknown unit is kept with a warning', () => {
    const { value, warnings } = normalizeStrength('5 zorks');
    expect(value).toMatchObject({ value: 5, unit: 'zorks' });
    expect(warnings).toEqual(['strength: unrecognized unit']);
  });
});

/* ------------------------------------------------------------------ */
/* 19 dosage form                                                       */
/* ------------------------------------------------------------------ */

describe('dosage form', () => {
  it.each([
    ['Tablet', 'tablet'],
    ['TABLET', 'tablet'],
    ['tablets', 'tablet'],
    ['Capsule', 'capsule'],
    ['Capsules', 'capsule'],
    ['Injection', 'injection'],
    ['Injectable', 'injection'],
    ['Cream', 'cream'],
    ['Spray', 'spray'],
    ['Drops', 'drops'],
    ['Soft Gel', 'softgel'],
    ['  Syrup ', 'syrup'],
  ])('%j → %s', (raw, normalized) => {
    expect(normalizeDosageForm(raw)).toEqual({ value: { raw, normalized }, warnings: [] });
  });

  it('does not classify compound forms', () => {
    expect(normalizeDosageForm('Film Coated Tablet')).toEqual({
      value: { raw: 'Film Coated Tablet', normalized: 'film coated tablet' },
      warnings: ['dosageForm: unrecognized form'],
    });
  });

  it('null stays null', () => {
    expect(normalizeDosageForm(null)).toEqual({
      value: { raw: null, normalized: null },
      warnings: [],
    });
  });
});

/* ------------------------------------------------------------------ */
/* 20–21 buyer products and contact                                     */
/* ------------------------------------------------------------------ */

describe('buyer products', () => {
  const raw = 'Dutasteride Tablet, Medicine Drop Shippers, Finasteride Tablet';
  const products = ['Dutasteride Tablet', 'Medicine Drop Shippers', 'Finasteride Tablet'];

  it('keeps raw and order, adds comparison forms', () => {
    expect(normalizeBuyerProducts(raw, products)).toEqual({
      value: {
        raw,
        products,
        normalizedProducts: ['dutasteride tablet', 'medicine drop shippers', 'finasteride tablet'],
      },
      warnings: [],
    });
  });

  it('cleans stray whitespace, never filters', () => {
    const { value } = normalizeBuyerProducts('x', ['  A   Tablet ', 'Retail Only']);
    expect(value.products).toEqual(['A Tablet', 'Retail Only']);
  });

  it('empty and missing', () => {
    expect(normalizeBuyerProducts(null, []).value.products).toEqual([]);
    expect(normalizeBuyerProducts(null, []).warnings).toEqual([]);
    expect(normalizeBuyerProducts(' , ', []).warnings).toEqual(['buys: no products in value']);
  });
});

describe('contact', () => {
  it('availability booleans only, no values', () => {
    const contact = normalizeContact({
      mobileAvailable: true,
      mobileNumber: null,
      whatsappAvailable: false,
      emailAvailable: true,
      email: null,
    });
    expect(contact).toEqual({
      mobileAvailable: true,
      whatsappAvailable: false,
      emailAvailable: true,
    });
    expect(Object.keys(contact)).not.toContain('mobileNumber');
    expect(Object.keys(contact)).not.toContain('email');
  });
});

/* ------------------------------------------------------------------ */
/* 22–24 lead age                                                       */
/* ------------------------------------------------------------------ */

describe('lead age', () => {
  it.each([
    ['just now', 0],
    ['1 min ago', 1],
    ['22 mins ago', 22],
    ['1 hour ago', 60],
    ['2 hours ago', 120],
    ['1 hr ago', 60],
    ['an hour ago', 60],
    ['1 day ago', 1440],
    ['3 days ago', 4320],
    ['2 weeks ago', 20160],
    ['30 secs ago', 1],
    ['  22   Mins   Ago ', 22],
  ])('%j → %d', (raw, minutes) => {
    const { value, warnings } = normalizeLeadAge(raw);
    expect(value).toEqual({ raw, minutes, approximate: false });
    expect(warnings).toEqual([]);
  });

  it('calendar units are flagged approximate', () => {
    const { value, warnings } = normalizeLeadAge('2 months ago');
    expect(value).toEqual({ raw: '2 months ago', minutes: 86400, approximate: true });
    expect(warnings).toEqual(['leadAge: approximate (calendar unit)']);
  });

  it.each([
    ['yesterday', 'leadAge: imprecise (needs current date)'],
    ['12 Sep', 'leadAge: unrecognized format'],
    ['soon', 'leadAge: unrecognized format'],
    ['5 fortnights ago', 'leadAge: unrecognized unit'],
  ])('%j → null, raw kept, warning', (raw, warning) => {
    const { value, warnings } = normalizeLeadAge(raw);
    expect(value).toEqual({ raw, minutes: null, approximate: false });
    expect(warnings).toEqual([warning]);
  });
});

/* ------------------------------------------------------------------ */
/* 25–28 whole lead                                                     */
/* ------------------------------------------------------------------ */

function lead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: 'lead_1',
    fingerprint: 'fp_1',
    rawTitle: '  Propanolol 20mg Tablets From Europe to Europe ',
    normalizedTitle: 'propanolol 20mg tablets from europe to europe',
    country: 'USA',
    rawLeadAge: '22 mins ago',
    leadAgeMinutes: 22,
    category: 'Blood Pressure Medicine',
    productCategory: 'Propranolol Tablets',
    breadcrumbs: ['Blood Pressure Medicine', 'Propranolol Tablets'],
    quantity: 10,
    quantityUnit: 'Strip',
    quantityRaw: '10 Strip',
    strengthRaw: '20mg',
    strengthValue: 20,
    strengthUnit: 'mg',
    dosageForm: 'Tablet',
    quantityPerStripRaw: '10 Capsules',
    quantityPerStripValue: 10,
    quantityPerStripUnit: 'Capsules',
    buysRaw: 'Dutasteride Tablet, Finasteride Tablet',
    buys: ['Dutasteride Tablet', 'Finasteride Tablet'],
    engagement: { requirements: null, calls: null, replies: null, verified: false, raw: null },
    contact: {
      mobileAvailable: true,
      mobileNumber: null,
      whatsappAvailable: true,
      emailAvailable: false,
      email: null,
    },
    extraction: {
      confidence: 1,
      completeness: 1,
      fields: {} as Lead['extraction']['fields'],
      failedFields: [],
      missingFields: [],
      warnings: [],
      notes: [],
    },
    detectedAt: 0,
    ...overrides,
  };
}

describe('normalizeLead', () => {
  const n = normalizeLead(lead(), { normalizedAt: 1234 });

  it('produces filter-ready fields', () => {
    expect(n).toMatchObject({
      id: 'lead_1',
      fingerprint: 'fp_1',
      title: {
        raw: '  Propanolol 20mg Tablets From Europe to Europe ',
        normalized: 'propanolol 20mg tablets from europe to europe',
      },
      country: { raw: 'USA', normalized: 'United States', code: 'US' },
      quantity: { value: 10, normalizedUnit: 'strip' },
      strength: { value: 20, unit: 'mg' },
      dosageForm: { normalized: 'tablet' },
      quantityPerStrip: { value: 10, normalizedUnit: 'capsule' },
      buys: { products: ['Dutasteride Tablet', 'Finasteride Tablet'] },
      leadAge: { minutes: 22 },
      contact: { mobileAvailable: true, whatsappAvailable: true, emailAvailable: false },
      normalization: { warnings: [], normalizedAt: 1234, version: NORMALIZATION_VERSION },
    });
    expect(n.title.tokens).toContain('propanolol');
  });

  it('preserves every raw value exactly', () => {
    const source = lead({ quantityRaw: '10-20 Strips', strengthRaw: '36 IU (12 mg)' });
    const r = normalizeLead(source, { normalizedAt: 0 });
    expect(r.title.raw).toBe(source.rawTitle);
    expect(r.country.raw).toBe(source.country);
    expect(r.quantity.raw).toBe('10-20 Strips');
    expect(r.strength.raw).toBe('36 IU (12 mg)');
    expect(r.dosageForm.raw).toBe(source.dosageForm);
    expect(r.buys.raw).toBe(source.buysRaw);
    expect(r.leadAge.raw).toBe(source.rawLeadAge);
  });

  it('does not mutate the extracted lead', () => {
    const source = lead();
    const snapshot = structuredClone(source);
    normalizeLead(source, { normalizedAt: 0 });
    expect(source).toEqual(snapshot);
  });

  it('collects normalization warnings separately from extraction warnings', () => {
    const r = normalizeLead(
      lead({
        country: 'Atlantis',
        quantityRaw: '10-20 Strips',
        strengthRaw: '36 IU (12 mg)',
        rawLeadAge: 'yesterday',
        extraction: { ...lead().extraction, warnings: ['quantity: extraction-level'] },
      }),
      { normalizedAt: 0 },
    );
    expect(r.normalization.warnings).toEqual([
      'country: not in alias map',
      'quantity: not a single number with a unit',
      'strength: complex format (value with equivalent)',
      'leadAge: imprecise (needs current date)',
    ]);
    expect(r.normalization.warnings).not.toContain('quantity: extraction-level');
  });

  it('is deterministic apart from normalizedAt', () => {
    const a = normalizeLead(lead(), { normalizedAt: 1 });
    const b = normalizeLead(lead(), { normalizedAt: 2 });
    expect({ ...a, normalization: { ...a.normalization, normalizedAt: 0 } }).toEqual({
      ...b,
      normalization: { ...b.normalization, normalizedAt: 0 },
    });
    expect(JSON.stringify(normalizeLead(lead(), { normalizedAt: 5 }))).toBe(
      JSON.stringify(normalizeLead(lead(), { normalizedAt: 5 })),
    );
  });

  it('handles a lead with every optional field missing', () => {
    const r = normalizeLead(
      lead({
        rawTitle: null,
        normalizedTitle: null,
        country: null,
        rawLeadAge: null,
        leadAgeMinutes: null,
        category: null,
        productCategory: null,
        breadcrumbs: [],
        quantity: null,
        quantityUnit: null,
        quantityRaw: null,
        strengthRaw: null,
        strengthValue: null,
        strengthUnit: null,
        dosageForm: null,
        quantityPerStripRaw: null,
        quantityPerStripValue: null,
        quantityPerStripUnit: null,
        buysRaw: null,
        buys: [],
      }),
      { normalizedAt: 0 },
    );
    expect(r.title).toEqual({ raw: null, normalized: null, tokens: [] });
    expect(r.country).toEqual({ raw: null, normalized: null, code: null });
    expect(r.quantity.value).toBeNull();
    expect(r.strength.complex).toBe(false);
    expect(r.dosageForm.normalized).toBeNull();
    expect(r.buys.products).toEqual([]);
    expect(r.leadAge.minutes).toBeNull();
    expect(r.normalization.warnings).toEqual([]);
  });

  it('is fast: 1,000 leads well under a frame budget each', () => {
    const source = lead();
    const start = performance.now();
    for (let i = 0; i < 1000; i++) normalizeLead(source, { normalizedAt: i });
    const perLead = (performance.now() - start) / 1000;
    expect(perLead).toBeLessThan(1);
  });
});
