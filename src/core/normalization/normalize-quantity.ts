import { parseMeasure } from '../parsing/measure';
import type { Normalized, NormalizedMeasure } from './normalization-types';
import { aliasKey, normalizeText } from './normalize-text';

/**
 * Canonical packaging/count units → spellings accepted for them. Only
 * spelling is unified; units are never converted (10 box stays 10 box).
 */
const UNITS: Readonly<Record<string, readonly string[]>> = {
  strip: ['strip', 'strips'],
  box: ['box', 'boxes', 'bx'],
  vial: ['vial', 'vials'],
  piece: ['piece', 'pieces', 'pc', 'pcs', 'nos', 'no', 'number', 'numbers'],
  bottle: ['bottle', 'bottles', 'btl'],
  tablet: ['tablet', 'tablets', 'tab', 'tabs'],
  capsule: ['capsule', 'capsules', 'cap', 'caps'],
  pack: ['pack', 'packs', 'packet', 'packets', 'pkt'],
  unit: ['unit', 'units'],
  ampoule: ['ampoule', 'ampoules', 'ampule', 'ampules', 'amp', 'amps'],
  tube: ['tube', 'tubes'],
  sachet: ['sachet', 'sachets'],
  kit: ['kit', 'kits'],
  carton: ['carton', 'cartons'],
  blister: ['blister', 'blisters'],
  pen: ['pen', 'pens'],
  jar: ['jar', 'jars'],
  bag: ['bag', 'bags'],
  gram: ['gram', 'grams', 'g', 'gm', 'gms', 'gr'],
  kg: ['kg', 'kgs', 'kilogram', 'kilograms', 'kilo', 'kilos'],
  mg: ['mg', 'milligram', 'milligrams'],
  ml: ['ml', 'millilitre', 'millilitres', 'milliliter', 'milliliters'],
  litre: ['l', 'ltr', 'ltrs', 'litre', 'litres', 'liter', 'liters'],
  ton: ['ton', 'tons', 'tonne', 'tonnes', 'mt'],
};

const UNIT_INDEX: ReadonlyMap<string, string> = new Map(
  Object.entries(UNITS).flatMap(([canonical, spellings]) =>
    spellings.map((s) => [s, canonical] as const),
  ),
);

export const QUANTITY_UNITS: readonly string[] = Object.keys(UNITS);

/** Canonical unit for a spelling, or null when not in the table. */
export function canonicalUnit(unit: string | null): string | null {
  const key = aliasKey(unit);
  return key === null ? null : (UNIT_INDEX.get(key) ?? null);
}

/**
 * "2 Boxes" → { value: 2, unit: "Boxes", normalizedUnit: "box" }.
 * Ranges and text ("10-20 Strips", "Bulk") keep raw with value null and a
 * warning. Unknown units keep their lower-case spelling with a warning.
 */
export function normalizeMeasure(
  field: 'quantity' | 'quantityPerStrip',
  raw: string | null,
): Normalized<NormalizedMeasure> {
  const cleaned = normalizeText(raw);
  if (cleaned === null) {
    return { value: { raw, value: null, unit: null, normalizedUnit: null }, warnings: [] };
  }
  const parsed = parseMeasure(cleaned);
  if (!parsed) {
    return {
      value: { raw, value: null, unit: null, normalizedUnit: null },
      warnings: [`${field}: not a single number with a unit`],
    };
  }
  if (parsed.unit === null) {
    return {
      value: { raw, value: parsed.value, unit: null, normalizedUnit: null },
      warnings: [`${field}: no unit`],
    };
  }
  // "10 to 20 Boxes", "10 - 20 Strips": a range, not a quantity.
  if (/^(?:to|[-–—])\s*\d/i.test(parsed.unit)) {
    return {
      value: { raw, value: null, unit: null, normalizedUnit: null },
      warnings: [`${field}: not a single number with a unit`],
    };
  }
  const canonical = canonicalUnit(parsed.unit);
  if (canonical !== null) {
    return {
      value: { raw, value: parsed.value, unit: parsed.unit, normalizedUnit: canonical },
      warnings: [],
    };
  }
  // "Strips of 10 Tablets": the leading word is the unit, the rest is detail.
  const leading = canonicalUnit(parsed.unit.split(' ')[0] ?? null);
  return {
    value: {
      raw,
      value: parsed.value,
      unit: parsed.unit,
      normalizedUnit: leading ?? aliasKey(parsed.unit),
    },
    warnings: [leading ? `${field}: unit has extra detail` : `${field}: unrecognized unit`],
  };
}
