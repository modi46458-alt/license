import {
  FILTER_CONFIG_VERSION,
  TEXT_FIELDS,
  type FilterConfig,
  type FilterTerm,
  type LogicMode,
  type TermMode,
  type TextField,
} from './filter-types';

/** Limits keep the config well inside chrome.storage.sync's 8 KB per item. */
export const FILTER_LIMITS = { maxTerms: 50, maxTermLength: 60, maxNumber: 1_000_000_000 } as const;

const term = (value: string): FilterTerm => ({ value, enabled: true });

export const DEFAULT_FILTER_CONFIG: FilterConfig = {
  version: FILTER_CONFIG_VERSION,
  enabled: true,
  countries: {
    enabled: true,
    mode: 'ANY',
    values: ['Canada', 'United States', 'United Kingdom', 'Australia', 'New Zealand'].map(term),
  },
  keywords: {
    enabled: true,
    mode: 'ANY',
    values: ['Medicine', 'Tablet', 'Capsule', 'Injection', 'Pharmaceutical'].map(term),
    fields: ['title', 'productCategory', 'category', 'buyerProducts'],
  },
  negativeKeywords: {
    enabled: true,
    values: ['Retail', 'Personal Use', 'Home Use'].map(term),
    // Buyer products describe what else the buyer buys, not this request, so
    // they are not searched for exclusions by default.
    fields: ['title', 'productCategory', 'category'],
  },
  quantity: { enabled: true, min: 20, max: null },
  contact: { enabled: true, mode: 'ANY', mobile: true, whatsapp: true, email: true },
  leadAge: { enabled: false, minMinutes: null, maxMinutes: null },
  logic: { mode: 'AND' },
};

/* ------------------------------------------------------------------ */
/* Validation: stored data is untrusted; anything invalid → defaults.  */
/* ------------------------------------------------------------------ */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';

function mode(v: unknown): TermMode | null {
  return v === 'ANY' || v === 'ALL' ? v : null;
}
function logic(v: unknown): LogicMode | null {
  return v === 'AND' || v === 'OR' ? v : null;
}
function optionalNumber(v: unknown): number | null | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > FILTER_LIMITS.maxNumber) {
    return undefined; // invalid
  }
  return v;
}
function terms(v: unknown): FilterTerm[] | null {
  if (!Array.isArray(v) || v.length > FILTER_LIMITS.maxTerms) return null;
  const out: FilterTerm[] = [];
  for (const item of v) {
    if (!isObj(item) || typeof item.value !== 'string' || !isBool(item.enabled)) return null;
    const value = item.value.replace(/\s+/g, ' ').trim();
    if (value.length === 0 || value.length > FILTER_LIMITS.maxTermLength) return null;
    out.push({ value, enabled: item.enabled });
  }
  return out;
}
function fields(v: unknown): TextField[] | null {
  if (!Array.isArray(v)) return null;
  const out = v.filter((f): f is TextField => TEXT_FIELDS.includes(f as TextField));
  return out.length === v.length ? [...new Set(out)] : null;
}

/**
 * Strict parse of stored/imported config. Returns null for anything that is
 * not a valid current-version config; callers fall back to defaults.
 */
export function parseFilterConfig(input: unknown): FilterConfig | null {
  if (!isObj(input) || input.version !== FILTER_CONFIG_VERSION || !isBool(input.enabled)) {
    return null;
  }
  const {
    countries: c,
    keywords: k,
    negativeKeywords: n,
    quantity: q,
    contact: ct,
    leadAge: a,
  } = input;
  if (!isObj(c) || !isObj(k) || !isObj(n) || !isObj(q) || !isObj(ct) || !isObj(a)) return null;
  if (!isObj(input.logic)) return null;

  const cValues = terms(c.values);
  const kValues = terms(k.values);
  const nValues = terms(n.values);
  const kFields = fields(k.fields);
  const nFields = fields(n.fields);
  const cMode = mode(c.mode);
  const kMode = mode(k.mode);
  const ctMode = mode(ct.mode);
  const gMode = logic(input.logic.mode);
  const qMin = optionalNumber(q.min);
  const qMax = optionalNumber(q.max);
  const aMin = optionalNumber(a.minMinutes);
  const aMax = optionalNumber(a.maxMinutes);

  if (
    !cValues ||
    !kValues ||
    !nValues ||
    !kFields ||
    !nFields ||
    !cMode ||
    !kMode ||
    !ctMode ||
    !gMode ||
    qMin === undefined ||
    qMax === undefined ||
    aMin === undefined ||
    aMax === undefined ||
    !isBool(c.enabled) ||
    !isBool(k.enabled) ||
    !isBool(n.enabled) ||
    !isBool(q.enabled) ||
    !isBool(ct.enabled) ||
    !isBool(a.enabled) ||
    !isBool(ct.mobile) ||
    !isBool(ct.whatsapp) ||
    !isBool(ct.email)
  ) {
    return null;
  }
  if (qMin !== null && qMax !== null && qMin > qMax) return null;
  if (aMin !== null && aMax !== null && aMin > aMax) return null;

  return {
    version: FILTER_CONFIG_VERSION,
    enabled: input.enabled,
    countries: { enabled: c.enabled, mode: cMode, values: cValues },
    keywords: { enabled: k.enabled, mode: kMode, values: kValues, fields: kFields },
    negativeKeywords: { enabled: n.enabled, values: nValues, fields: nFields },
    quantity: { enabled: q.enabled, min: qMin, max: qMax },
    contact: {
      enabled: ct.enabled,
      mode: ctMode,
      mobile: ct.mobile,
      whatsapp: ct.whatsapp,
      email: ct.email,
    },
    leadAge: { enabled: a.enabled, minMinutes: aMin, maxMinutes: aMax },
    logic: { mode: gMode },
  };
}

/** Stored value → config. Missing or invalid → defaults, never a crash. */
export function configOrDefault(input: unknown): { config: FilterConfig; fromDefaults: boolean } {
  const parsed = parseFilterConfig(input);
  return parsed
    ? { config: parsed, fromDefaults: false }
    : { config: DEFAULT_FILTER_CONFIG, fromDefaults: true };
}

const on = (terms: readonly FilterTerm[]) => terms.filter((t) => t.enabled).map((t) => t.value);

/** One-line summary for diagnostics, e.g. "AND · 5 countries · 5 keywords · 3 excluded · qty ≥ 20 · contact ANY". */
export function summarizeFilterConfig(config: FilterConfig): string {
  if (!config.enabled) return 'Filters off';
  const parts: string[] = [config.logic.mode];
  if (config.countries.enabled)
    parts.push(`${on(config.countries.values).length} countries ${config.countries.mode}`);
  if (config.keywords.enabled)
    parts.push(`${on(config.keywords.values).length} keywords ${config.keywords.mode}`);
  if (config.negativeKeywords.enabled)
    parts.push(`${on(config.negativeKeywords.values).length} excluded`);
  if (config.quantity.enabled) {
    const { min, max } = config.quantity;
    parts.push(
      min !== null && max !== null
        ? `qty ${min}–${max}`
        : min !== null
          ? `qty ≥ ${min}`
          : max !== null
            ? `qty ≤ ${max}`
            : 'qty known',
    );
  }
  if (config.contact.enabled) parts.push(`contact ${config.contact.mode}`);
  if (config.leadAge.enabled) {
    const { minMinutes: lo, maxMinutes: hi } = config.leadAge;
    parts.push(`age ${lo ?? 0}–${hi ?? '∞'} min`);
  }
  return parts.join(' · ');
}
