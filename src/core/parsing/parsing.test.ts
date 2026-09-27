import { describe, expect, it } from 'vitest';
import { parseLeadAgeMinutes } from './lead-age';
import { parseMeasure } from './measure';
import { cleanOrNull, normalizeText, splitList } from './text';

describe('parseMeasure', () => {
  it.each([
    ['10 Strip', 10, 'Strip'],
    ['20mg', 20, 'mg'],
    ['10 Capsules', 10, 'Capsules'],
    ['1,000 Pieces', 1000, 'Pieces'],
    ['2.5 Kg', 2.5, 'Kg'],
    ['500 mg/5ml', 500, 'mg/5ml'],
    ['  10\u00a0 Strip ', 10, 'Strip'],
    ['100', 100, null],
    ['5%', 5, '%'],
  ] as const)('%j → %d %s', (raw, value, unit) => {
    expect(parseMeasure(raw)).toEqual({ value, unit });
  });

  it.each([
    '10-20 Strips',
    '20mg + 10mg',
    'Strip',
    '',
    'ten strips',
    '10 Strips, 5 Boxes',
    '1,00 Pieces',
    `10 ${'x'.repeat(60)}`,
  ])('rejects malformed %j instead of guessing', (raw) => {
    expect(parseMeasure(raw)).toBeNull();
  });

  it('handles null and undefined', () => {
    expect(parseMeasure(null)).toBeNull();
    expect(parseMeasure(undefined)).toBeNull();
  });
});

describe('parseLeadAgeMinutes', () => {
  it.each([
    ['22 mins ago', 22],
    ['1 min ago', 1],
    ['1 hr ago', 60],
    ['2 hours ago', 120],
    ['3 days ago', 4320],
    ['1 week ago', 10080],
    ['30 secs ago', 1],
    ['just now', 0],
    ['Yesterday', 1440],
    ['  5  MINS   AGO ', 5],
  ] as const)('%j → %d', (raw, minutes) => {
    expect(parseLeadAgeMinutes(raw)).toBe(minutes);
  });

  it.each(['Luxembourg', '22 mins', 'ago', '5 fortnights ago', '', 'today'])(
    'returns null for %j',
    (raw) => expect(parseLeadAgeMinutes(raw)).toBeNull(),
  );
});

describe('text helpers', () => {
  it('cleans whitespace and returns null for empty', () => {
    expect(cleanOrNull('  a \n\t b  ')).toBe('a b');
    expect(cleanOrNull('   ')).toBeNull();
    expect(cleanOrNull(null)).toBeNull();
  });

  it('normalizes for comparison without touching the input', () => {
    const raw = '  Propanolol   20MG ';
    expect(normalizeText(raw)).toBe('propanolol 20mg');
    expect(raw).toBe('  Propanolol   20MG ');
    expect(normalizeText('ｆｕｌｌ')).toBe('full');
  });

  it('splits comma lists safely', () => {
    expect(splitList('Dutasteride Tablet, Medicine Drop Shippers,  Finasteride Tablet')).toEqual([
      'Dutasteride Tablet',
      'Medicine Drop Shippers',
      'Finasteride Tablet',
    ]);
    expect(splitList('a,, ,b,')).toEqual(['a', 'b']);
    expect(splitList(null)).toEqual([]);
  });
});
