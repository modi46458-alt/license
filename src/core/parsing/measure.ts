/**
 * Parses "<number> <unit>" values: "10 Strip", "20mg", "1,000 Pieces",
 * "2.5 Kg", "500 mg/5ml". Returns null for anything ambiguous (ranges such
 * as "10-20 Strips", compound strengths such as "20mg + 10mg", text only)
 * so callers can warn instead of storing a wrong number.
 */
export interface Measure {
  readonly value: number;
  readonly unit: string | null;
}

const MEASURE_PATTERN = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*(.*)$/u;
const UNIT_PATTERN = /^[\p{L}%µ][\p{L}\p{N}%µ ./]*$/u;
const MAX_UNIT_LENGTH = 40;

export function parseMeasure(raw: string | null | undefined): Measure | null {
  const text = (raw ?? '').replace(/[\s\u00a0]+/g, ' ').trim();
  const match = MEASURE_PATTERN.exec(text);
  if (!match) return null;

  const [, whole = '', fraction, rest = ''] = match;
  const value = Number(`${whole.replace(/,/g, '')}${fraction ? `.${fraction}` : ''}`);
  if (!Number.isFinite(value)) return null;

  const unit = rest.trim();
  if (unit.length === 0) return { value, unit: null };
  if (unit.length > MAX_UNIT_LENGTH || !UNIT_PATTERN.test(unit)) return null;
  return { value, unit };
}
