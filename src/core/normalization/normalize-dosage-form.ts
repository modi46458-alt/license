import type { Normalized, NormalizedDosageForm } from './normalization-types';
import { aliasKey, normalizeText } from './normalize-text';

/**
 * Canonical dosage forms → accepted spellings. Only spelling, case and
 * plurals are unified; no medical classification ("film coated tablet" is
 * not collapsed into "tablet").
 */
const FORMS: Readonly<Record<string, readonly string[]>> = {
  tablet: ['tablet', 'tablets', 'tab', 'tabs'],
  capsule: ['capsule', 'capsules', 'cap', 'caps'],
  softgel: ['softgel', 'softgels', 'soft gel', 'soft gels', 'soft gelatin capsule'],
  injection: ['injection', 'injections', 'injectable', 'injectables'],
  cream: ['cream', 'creams'],
  ointment: ['ointment', 'ointments'],
  gel: ['gel', 'gels'],
  lotion: ['lotion', 'lotions'],
  spray: ['spray', 'sprays', 'nasal spray'],
  syrup: ['syrup', 'syrups'],
  suspension: ['suspension', 'suspensions'],
  solution: ['solution', 'solutions'],
  drops: ['drop', 'drops'],
  powder: ['powder', 'powders'],
  granules: ['granule', 'granules'],
  sachet: ['sachet', 'sachets'],
  patch: ['patch', 'patches'],
  inhaler: ['inhaler', 'inhalers'],
  suppository: ['suppository', 'suppositories'],
  liquid: ['liquid', 'liquids'],
  oil: ['oil', 'oils'],
  lozenge: ['lozenge', 'lozenges'],
  shampoo: ['shampoo', 'shampoos'],
};

const INDEX: ReadonlyMap<string, string> = new Map(
  Object.entries(FORMS).flatMap(([canonical, spellings]) =>
    spellings.map((s) => [s, canonical] as const),
  ),
);

export const DOSAGE_FORMS: readonly string[] = Object.keys(FORMS);

/** "TABLETS" → "tablet". Unknown forms keep their comparison form with a warning. */
export function normalizeDosageForm(raw: string | null): Normalized<NormalizedDosageForm> {
  const key = aliasKey(normalizeText(raw));
  if (key === null) return { value: { raw, normalized: null }, warnings: [] };
  const canonical = INDEX.get(key);
  return canonical
    ? { value: { raw, normalized: canonical }, warnings: [] }
    : { value: { raw, normalized: key }, warnings: ['dosageForm: unrecognized form'] };
}
