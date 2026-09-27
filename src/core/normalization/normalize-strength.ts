import type { Normalized, NormalizedStrength } from './normalization-types';
import { normalizeText } from './normalize-text';

/** Canonical strength unit spellings (lower-case, no spaces). */
const UNIT_ALIASES: Readonly<Record<string, string>> = {
  mg: 'mg',
  milligram: 'mg',
  milligrams: 'mg',
  mcg: 'mcg',
  ug: 'mcg',
  microgram: 'mcg',
  micrograms: 'mcg',
  g: 'g',
  gm: 'g',
  gram: 'g',
  grams: 'g',
  kg: 'kg',
  ml: 'ml',
  l: 'l',
  iu: 'iu',
  'i.u.': 'iu',
  units: 'unit',
  unit: 'unit',
  u: 'unit',
  '%': '%',
  '%w/w': '% w/w',
  '%w/v': '% w/v',
  '%v/v': '% v/v',
  meq: 'meq',
  mmol: 'mmol',
  mcl: 'mcl',
};

const NUMBER = String.raw`\d+(?:\.\d+)?`;
/** Unit text: letters, µ, %, and "/" denominators such as mg/ml, mg/5ml, % w/w. */
const UNIT = String.raw`[a-z\u00b5\u03bc%][a-z\u00b5\u03bc%.]*(?:\s*\/\s*\d*\s*[a-z\u00b5\u03bc]+)?|%\s*[wv]\/[wv]`;
const SIMPLE = new RegExp(String.raw`^(${NUMBER})\s*(${UNIT})$`, 'i');
/** "36 IU (12 mg)" — a value with an equivalent in brackets. */
const EQUIVALENT = new RegExp(
  String.raw`^(${NUMBER})\s*(${UNIT})\s*\(\s*(${NUMBER})\s*(${UNIT})\s*\)$`,
  'i',
);
/** "20mg + 10mg", "20mg/10mg", "20 mg & 10 mg" — combination products. */
const COMBINATION = new RegExp(
  String.raw`^(${NUMBER})\s*(${UNIT})\s*(\+|&|\/|,|and)\s*(${NUMBER})\s*(${UNIT})$`,
  'i',
);

function toNumber(text: string): number | null {
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** "Mg/ML" → "mg/ml", "IU" → "iu", "% w/w" → "% w/w". Unknown units: lower-case, spaces removed. */
export function canonicalStrengthUnit(unit: string): { unit: string; known: boolean } {
  // NFKC turns the micro sign (U+00B5) into Greek mu (U+03BC); treat both as "u".
  const compact = unit
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[\u00b5\u03bc]/g, 'u');
  const direct = UNIT_ALIASES[compact];
  if (direct) return { unit: direct, known: true };
  const [num, den] = compact.split('/');
  if (num !== undefined && den !== undefined) {
    const n = UNIT_ALIASES[num];
    const denMatch = /^(\d*)([a-z]+)$/.exec(den);
    const d = denMatch ? UNIT_ALIASES[denMatch[2] ?? ''] : undefined;
    if (n && d && denMatch) return { unit: `${n}/${denMatch[1] ?? ''}${d}`, known: true };
  }
  return { unit: compact, known: false };
}

const EMPTY: Omit<NormalizedStrength, 'raw'> = {
  value: null,
  unit: null,
  secondaryValue: null,
  secondaryUnit: null,
  complex: false,
};

/**
 * Supported: "20mg", "20 mg", "20MG", "2.5 mg", "250 mg/ml", "400mg/ml",
 * "10 mg/5 ml", "40% w/w", "36 IU (12 mg)" (value + equivalent),
 * "20mg + 10mg" (combination). Anything else keeps raw with nulls and a
 * warning. Values are never invented.
 */
export function normalizeStrength(raw: string | null): Normalized<NormalizedStrength> {
  const text = normalizeText(raw);
  if (text === null) return { value: { raw, ...EMPTY }, warnings: [] };
  const warnings: string[] = [];
  const unit = (u: string) => {
    const c = canonicalStrengthUnit(u);
    if (!c.known) warnings.push('strength: unrecognized unit');
    return c.unit;
  };

  // Combination first: "20mg + 10mg", and "20mg/10mg" when both sides share a
  // unit (a concentration such as "250mg/ml" has a different denominator).
  const combo = COMBINATION.exec(text);
  if (combo) {
    const [, v1 = '', u1 = '', sep = '', v2 = '', u2 = ''] = combo;
    const sameUnit = canonicalStrengthUnit(u1).unit === canonicalStrengthUnit(u2).unit;
    if (sep !== '/' || sameUnit) {
      warnings.push('strength: combination');
      return {
        value: {
          raw,
          value: toNumber(v1),
          unit: unit(u1),
          secondaryValue: toNumber(v2),
          secondaryUnit: unit(u2),
          complex: true,
        },
        warnings,
      };
    }
  }

  const equivalent = EQUIVALENT.exec(text);
  if (equivalent) {
    const [, v1 = '', u1 = '', v2 = '', u2 = ''] = equivalent;
    warnings.push('strength: complex format (value with equivalent)');
    return {
      value: {
        raw,
        value: toNumber(v1),
        unit: unit(u1),
        secondaryValue: toNumber(v2),
        secondaryUnit: unit(u2),
        complex: true,
      },
      warnings,
    };
  }

  const simple = SIMPLE.exec(text);
  if (simple) {
    const [, v = '', u = ''] = simple;
    return { value: { raw, ...EMPTY, value: toNumber(v), unit: unit(u) }, warnings };
  }
  return { value: { raw, ...EMPTY }, warnings: ['strength: unrecognized format'] };
}
