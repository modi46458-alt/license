import { parseLeadAgeMinutes } from '@/core/parsing/lead-age';
import { parseMeasure } from '@/core/parsing/measure';
import { cleanOrNull, normalizeText, splitList } from '@/core/parsing/text';
import type {
  CoreLeadField,
  ExtractedLead,
  FieldState,
  LeadContact,
  LeadEngagement,
  LeadField,
} from '@/core/types/lead';
import {
  ENGAGEMENT,
  FIELD_SELECTORS,
  LABELED_FIELDS,
  LABELED_ROWS,
  LIST_VALUE_SEPARATOR,
  type EngagementConfig,
  type FieldSelector,
  type LabeledFieldId,
} from '../selectors/indiamart-selectors';
import {
  cleanText,
  createLabeledReadCache,
  readLabeledField,
  resolveAll,
  stripNoise,
  resolveOne,
} from '../selectors/selector-resolver';
import { extractContact } from './contact-extractor';
import { extractEngagement } from './engagement-extractor';

/**
 * Weight of each core field (sums to 1). Used for both scores:
 *   confidence   — over fields present in the DOM (found or failed): how
 *                  reliably they were read. Absent fields do not count.
 *   completeness — over all core fields: how many were present.
 * The title always counts toward confidence: a lead card without a readable
 * title is a failed read, never a merely "incomplete" one.
 */
export const CONFIDENCE_WEIGHTS: Readonly<Record<CoreLeadField, number>> = {
  title: 0.3,
  country: 0.2,
  category: 0.15,
  quantity: 0.15,
  buys: 0.1,
  leadAge: 0.1,
};

export const ALL_FIELDS: readonly LeadField[] = [
  'title',
  'country',
  'leadAge',
  'category',
  'quantity',
  'strength',
  'dosageForm',
  'quantityPerStrip',
  'buys',
  'engagement',
  'contact',
];

export interface ExtractionResult {
  readonly lead: ExtractedLead;
  /** Fields present in the DOM whose every selector strategy failed. */
  readonly selectorFailures: readonly string[];
}

export interface ExtractOptions {
  readonly now?: number;
  readonly engagement?: EngagementConfig;
}

class ExtractionContext {
  readonly warnings: string[] = [];
  readonly notes: string[] = [];
  readonly selectorFailures: string[] = [];
  readonly fields = Object.fromEntries(ALL_FIELDS.map((f) => [f, 'missing'])) as Record<
    LeadField,
    FieldState
  >;
  private readonly strategyConfidence = new Map<LeadField, number>();
  /** Rows and cleaned texts read once per card, shared by all labeled fields. */
  readonly rowCache = createLabeledReadCache();

  constructor(private readonly card: Element) {}

  found(field: LeadField, strategyConfidence = 1): void {
    this.fields[field] = 'found';
    this.strategyConfidence.set(field, strategyConfidence);
  }

  missing(field: LeadField, note?: string): void {
    this.fields[field] = 'missing';
    if (note) this.notes.push(note);
  }

  failed(field: LeadField, reason: string): void {
    this.fields[field] = 'failed';
    this.warnings.push(`${field}: ${reason}`);
  }

  /** Resolution failed: FAILED if the field's structure is in the card, else MISSING. */
  unresolved(field: LeadField, selector: FieldSelector): void {
    if (this.present(selector)) {
      this.selectorFailures.push(selector.id);
      this.failed(field, 'present in the card but no value could be read');
    } else {
      this.missing(field);
    }
  }

  present(selector: FieldSelector): boolean {
    if (!selector.presenceSelector) return false;
    try {
      const exclude = selector.presenceTextExclude;
      return Array.from(this.card.querySelectorAll(selector.presenceSelector)).some(
        (el) => !exclude || !exclude.test(stripNoise(cleanText(el.textContent))),
      );
    } catch {
      return false;
    }
  }

  /** Run one field in isolation: an exception fails that field, never the lead. */
  guard<T>(field: LeadField, fallback: T, fn: () => T): T {
    try {
      return fn();
    } catch {
      this.failed(field, 'extraction error');
      return fallback;
    }
  }

  get confidence(): number {
    let total = 0;
    let score = 0;
    for (const [field, weight] of Object.entries(CONFIDENCE_WEIGHTS) as [CoreLeadField, number][]) {
      const state = this.fields[field];
      if (state === 'missing' && field !== 'title') continue;
      total += weight;
      if (state === 'found') score += weight * (this.strategyConfidence.get(field) ?? 1);
    }
    // Optional fields only lower confidence when present but unreadable.
    const optionalFailures = (['strength', 'dosageForm', 'quantityPerStrip'] as const).filter(
      (f) => this.fields[f] === 'failed',
    ).length;
    const base = total === 0 ? 0 : score / total;
    return round(Math.max(0, base - 0.05 * optionalFailures));
  }

  get completeness(): number {
    let score = 0;
    for (const [field, weight] of Object.entries(CONFIDENCE_WEIGHTS) as [CoreLeadField, number][]) {
      if (this.fields[field] === 'found') score += weight;
    }
    return round(score);
  }

  info() {
    return {
      confidence: this.confidence,
      completeness: this.completeness,
      fields: { ...this.fields },
      failedFields: ALL_FIELDS.filter((f) => this.fields[f] === 'failed'),
      missingFields: ALL_FIELDS.filter((f) => this.fields[f] === 'missing'),
      warnings: this.warnings,
      notes: this.notes,
    };
  }
}

const round = (n: number) => Math.round(Math.min(1, n) * 1000) / 1000;

/**
 * A labeled row field. Row absent → MISSING. Row present but empty → FAILED.
 * Value present but not parseable as a measure → FAILED, raw value kept.
 */
function labeledField(
  ctx: ExtractionContext,
  card: Element,
  field: LeadField,
  id: LabeledFieldId,
): string | null {
  return ctx.guard(field, null, () => {
    const read = readLabeledField(card, LABELED_FIELDS[id], LABELED_ROWS, ctx.rowCache);
    if (read.status === 'found') {
      ctx.found(field, read.method === 'sibling' ? 1 : 0.9);
      return cleanOrNull(read.value);
    }
    if (read.status === 'failed') ctx.failed(field, 'row present but value empty');
    else ctx.missing(field);
    return null;
  });
}

function measured(ctx: ExtractionContext, field: LeadField, raw: string | null) {
  if (raw === null) return { value: null, unit: null };
  const parsed = parseMeasure(raw);
  if (!parsed) {
    ctx.failed(field, `could not parse "${raw}"`);
    return { value: null, unit: null };
  }
  return parsed;
}

/**
 * Extract a lead from a resolved card element. Read-only: never clicks,
 * focuses, scrolls or mutates the page. Every field ends in one state:
 * found, missing (absent from the card, normal) or failed (present but
 * unreadable). Raw values are always kept next to parsed ones.
 */
export function extractLead(card: Element, options: ExtractOptions = {}): ExtractionResult {
  const ctx = new ExtractionContext(card);
  const detectedAt = options.now ?? Date.now();

  const rawTitle = ctx.guard('title', null, () => {
    const r = resolveOne(card, FIELD_SELECTORS.title);
    const text = r.ok ? cleanOrNull(r.value.text) : null;
    if (!r.ok || text === null) {
      ctx.selectorFailures.push('title');
      ctx.failed('title', 'no readable title in the card');
      return null;
    }
    ctx.found('title', r.value.confidence);
    return text;
  });

  const country = ctx.guard('country', null, () => {
    const r = resolveOne(card, FIELD_SELECTORS.country);
    if (!r.ok) {
      ctx.unresolved('country', FIELD_SELECTORS.country);
      return null;
    }
    ctx.found('country', r.value.confidence);
    return cleanOrNull(r.value.text);
  });

  const rawLeadAge = ctx.guard('leadAge', null, () => {
    const r = resolveOne(card, FIELD_SELECTORS.timestamp);
    if (!r.ok) {
      ctx.unresolved('leadAge', FIELD_SELECTORS.timestamp);
      return null;
    }
    ctx.found('leadAge', r.value.confidence);
    return cleanOrNull(r.value.text);
  });
  const leadAgeMinutes = rawLeadAge === null ? null : parseLeadAgeMinutes(rawLeadAge);
  if (rawLeadAge !== null && leadAgeMinutes === null) {
    ctx.failed('leadAge', `could not parse "${rawLeadAge}"`);
  }

  const breadcrumbs = ctx.guard<string[]>('category', [], () => {
    const selector = FIELD_SELECTORS.categoryBreadcrumb;
    const r = resolveAll(card, selector);
    if (!r.ok) {
      ctx.unresolved('category', selector);
      if (ctx.fields.category === 'missing' && isOutside(card, selector.presenceSelector)) {
        // A breadcrumb exists on the page but not in this card: it describes
        // the page (or another card), so it is never attached to this lead.
        ctx.notes.push('category: page-level breadcrumb unavailable for card');
      }
      return [];
    }
    const values = r.value
      .map((v) => cleanOrNull(v.element.getAttribute('title') ?? v.text))
      .filter((v): v is string => v !== null)
      .filter((v, i, all) => i === 0 || all[i - 1] !== v);
    if (values.length === 0) ctx.failed('category', 'breadcrumb present but empty');
    else ctx.found('category', r.value[0]?.confidence ?? 0);
    return values;
  });
  // Last crumb is the product category; the one above it is its category.
  const productCategory = breadcrumbs.length >= 2 ? (breadcrumbs.at(-1) ?? null) : null;
  const category =
    breadcrumbs.length >= 2 ? (breadcrumbs.at(-2) ?? null) : (breadcrumbs[0] ?? null);

  const quantityRaw = labeledField(ctx, card, 'quantity', 'quantity');
  const quantity = measured(ctx, 'quantity', quantityRaw);

  const strengthRaw = labeledField(ctx, card, 'strength', 'strength');
  const strength = measured(ctx, 'strength', strengthRaw);

  const dosageForm = labeledField(ctx, card, 'dosageForm', 'dosageForm');

  const quantityPerStripRaw = labeledField(ctx, card, 'quantityPerStrip', 'quantityPerStrip');
  const perStrip = measured(ctx, 'quantityPerStrip', quantityPerStripRaw);

  const buysRaw = labeledField(ctx, card, 'buys', 'buyerProducts');
  const buys = splitList(buysRaw, LIST_VALUE_SEPARATOR);

  const engagement = ctx.guard<LeadEngagement>('engagement', UNVERIFIED_ENGAGEMENT, () => {
    const result = extractEngagement(card, options.engagement ?? ENGAGEMENT);
    if (result.state === 'found') ctx.found('engagement');
    else if (result.state === 'failed') ctx.failed('engagement', result.message ?? 'unreadable');
    else ctx.missing('engagement', result.message ?? undefined);
    return result.engagement;
  });

  const contact = ctx.guard<LeadContact>('contact', NO_CONTACT, () => {
    const result = extractContact(card);
    if (result.source === 'none') ctx.missing('contact');
    else ctx.found('contact');
    return result.contact;
  });

  return {
    selectorFailures: ctx.selectorFailures,
    lead: {
      rawTitle,
      normalizedTitle: normalizeText(rawTitle),
      country,
      rawLeadAge,
      leadAgeMinutes,
      category,
      productCategory,
      breadcrumbs,
      quantity: quantity.value,
      quantityUnit: quantity.unit,
      quantityRaw,
      strengthRaw,
      strengthValue: strength.value,
      strengthUnit: strength.unit,
      dosageForm,
      quantityPerStripRaw,
      quantityPerStripValue: perStrip.value,
      quantityPerStripUnit: perStrip.unit,
      buysRaw,
      buys,
      engagement,
      contact,
      extraction: ctx.info(),
      detectedAt,
    },
  };
}

const UNVERIFIED_ENGAGEMENT: LeadEngagement = {
  requirements: null,
  calls: null,
  replies: null,
  verified: false,
  raw: null,
};

const NO_CONTACT: LeadContact = {
  emailAvailable: false,
  email: null,
  mobileAvailable: false,
  mobileNumber: null,
  whatsappAvailable: false,
};

/** true when `selector` matches somewhere in the document but not inside `card`. */
function isOutside(card: Element, selector: string | undefined): boolean {
  if (!selector) return false;
  try {
    return (
      card.querySelector(selector) === null && card.ownerDocument.querySelector(selector) !== null
    );
  } catch {
    return false;
  }
}

/** Short label for logs: title, else product category, else a placeholder. */
export function leadLabel(lead: Pick<ExtractedLead, 'rawTitle' | 'productCategory'>): string {
  return cleanText(lead.rawTitle ?? lead.productCategory ?? '') || 'Untitled lead';
}
