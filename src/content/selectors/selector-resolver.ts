import {
  LABEL_SEPARATOR_PATTERN,
  TEXT_NOISE_PATTERNS,
  type FieldSelector,
  type LabeledField,
  type LabeledRowSelector,
  type SelectorStrategy,
} from './indiamart-selectors';

/**
 * Generic resolution of the declarative selector map. Contains no
 * IndiaMART-specific knowledge; everything site-specific is passed in.
 */

export interface ResolvedElement {
  readonly element: Element;
  /** Cleaned value text, read per the strategy's text mode, hint text removed. */
  readonly text: string;
  readonly strategyIndex: number;
  readonly confidence: number;
}

export interface ResolveFailure {
  readonly fieldId: string;
  readonly attempted: number;
}

export type ResolveResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: ResolveFailure };

/** Collapse whitespace (including NBSP) and trim. Never returns HTML. */
export function cleanText(value: string | null | undefined): string {
  return (value ?? '').replace(/[\s\u00a0]+/g, ' ').trim();
}

function ownText(el: Element): string {
  return cleanText(el.textContent);
}

/** Remove known hint/tooltip text ("Click here to view BuyLeads from …"). */
export function stripNoise(text: string, noise: readonly RegExp[] = TEXT_NOISE_PATTERNS): string {
  let out = text;
  for (const pattern of noise) out = out.replace(pattern, '');
  return cleanText(out);
}

/**
 * First meaningful text node inside `el`, in document order. Picks "Canada"
 * out of <strong>Canada<span>Click here to view BuyLeads from Canada</span></strong>
 * instead of the concatenated textContent.
 */
export function leadingText(el: Element): string {
  const doc = el.ownerDocument;
  const walker = doc.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = stripNoise(cleanText(node.nodeValue));
    if (text && !LABEL_SEPARATOR_PATTERN.test(text)) return text;
  }
  return '';
}

/** Value text for an element under a strategy. */
export function strategyText(el: Element, strategy: SelectorStrategy): string {
  if (strategy.kind === 'css' && strategy.textMode === 'leading') return leadingText(el);
  return stripNoise(ownText(el));
}

function passesTextRules(el: Element, strategy: SelectorStrategy): boolean {
  if (strategy.kind !== 'css') return true;
  const hasTextRules =
    strategy.requireText ?? (strategy.textMatch ?? strategy.textExclude) !== undefined;
  if (!hasTextRules) return true; // icon-only controls (Shortlist, Hide) have no text
  const text = strategyText(el, strategy);
  if (text.length === 0) return false;
  if (strategy.textMatch && !strategy.textMatch.test(text)) return false;
  if (strategy.textExclude?.test(text)) return false;
  return true;
}

/**
 * Deepest in-scope elements whose full text matches — avoids returning the
 * card root. Only children that are themselves in scope count as "deeper",
 * so <button><strong>Contact Buyer</strong></button> with scope "button"
 * returns the button, not nothing.
 */
function findByText(root: ParentNode, scope: string, pattern: RegExp): Element[] {
  const hits: Element[] = [];
  for (const el of Array.from(root.querySelectorAll(scope))) {
    if (!pattern.test(ownText(el))) continue;
    const hasMatchingChild = Array.from(el.children).some(
      (c) => c.matches(scope) && pattern.test(ownText(c)),
    );
    if (!hasMatchingChild) hits.push(el);
  }
  return hits;
}

function runStrategy(root: ParentNode, strategy: SelectorStrategy): Element[] {
  try {
    if (strategy.kind === 'css') {
      return Array.from(root.querySelectorAll(strategy.selector)).filter((el) =>
        passesTextRules(el, strategy),
      );
    }
    return findByText(root, strategy.scope, strategy.pattern);
  } catch {
    // Invalid selector must never break a scan; treat as a miss.
    return [];
  }
}

/** First element produced by the first strategy that yields anything. */
export function resolveOne(root: ParentNode, field: FieldSelector): ResolveResult<ResolvedElement> {
  for (const [strategyIndex, strategy] of field.strategies.entries()) {
    const element = runStrategy(root, strategy)[0];
    if (element) {
      return {
        ok: true,
        value: {
          element,
          text: strategyText(element, strategy),
          strategyIndex,
          confidence: strategy.confidence,
        },
      };
    }
  }
  return { ok: false, failure: { fieldId: field.id, attempted: field.strategies.length } };
}

/** All elements from the first strategy that yields anything (for breadcrumbs etc.). */
export function resolveAll(
  root: ParentNode,
  field: FieldSelector,
): ResolveResult<readonly ResolvedElement[]> {
  for (const [strategyIndex, strategy] of field.strategies.entries()) {
    const elements = runStrategy(root, strategy);
    if (elements.length > 0) {
      return {
        ok: true,
        value: elements.map((element) => ({
          element,
          text: strategyText(element, strategy),
          strategyIndex,
          confidence: strategy.confidence,
        })),
      };
    }
  }
  return { ok: false, failure: { fieldId: field.id, attempted: field.strategies.length } };
}

function normaliseLabel(label: string): string {
  return cleanText(label).replace(/\s*:$/, '').toLowerCase();
}

export type LabeledRead =
  | { readonly status: 'found'; readonly value: string; readonly method: 'sibling' | 'inline' }
  | { readonly status: 'missing' }
  | { readonly status: 'failed'; readonly reason: string };

const MAX_ROW_DEPTH = 3;

/**
 * Per-card memo for labeled-row reading: the rows of each row selector and
 * the cleaned children/text of each element are computed once per card, not
 * once per field. Pass the same cache to every readLabeledField call for one
 * card (extraction does); results are identical with or without it.
 */
export interface LabeledReadCache {
  readonly rows: Map<string, Element[]>;
  readonly children: WeakMap<Element, Array<{ node: ChildNode; text: string }>>;
  readonly text: WeakMap<Element, string>;
}

export function createLabeledReadCache(): LabeledReadCache {
  return { rows: new Map(), children: new WeakMap(), text: new WeakMap() };
}

/** Element and non-empty text children, in order. */
function meaningfulChildren(
  el: Element,
  cache?: LabeledReadCache,
): Array<{ node: ChildNode; text: string }> {
  const hit = cache?.children.get(el);
  if (hit) return hit;
  const children = Array.from(el.childNodes)
    .filter((n) => n.nodeType === 1 || n.nodeType === 3)
    .map((node) => ({ node, text: stripNoise(cleanText(node.textContent)) }))
    .filter((c) => c.text.length > 0);
  cache?.children.set(el, children);
  return children;
}

function rowText(el: Element, cache?: LabeledReadCache): string {
  const hit = cache?.text.get(el);
  if (hit !== undefined) return hit;
  const text = stripNoise(cleanText(el.textContent));
  cache?.text.set(el, text);
  return text;
}

function rowsFor(root: ParentNode, selector: string, cache?: LabeledReadCache): Element[] {
  const hit = cache?.rows.get(selector);
  if (hit) return hit;
  const rows = Array.from(root.querySelectorAll(selector));
  cache?.rows.set(selector, rows);
  return rows;
}

/** Compiled "Label: value" patterns per field (built once, not per call). */
const INLINE_PATTERNS = new WeakMap<LabeledField, RegExp[]>();
function inlinePatterns(field: LabeledField): RegExp[] {
  let patterns = INLINE_PATTERNS.get(field);
  if (!patterns) {
    patterns = field.labels.map(
      (label) => new RegExp(`^${escapeRegExp(cleanText(label))}\\s*:\\s*(.+)$`, 'i'),
    );
    INLINE_PATTERNS.set(field, patterns);
  }
  return patterns;
}

const WANTED = new WeakMap<LabeledField, ReadonlySet<string>>();
function wantedLabels(field: LabeledField): ReadonlySet<string> {
  let wanted = WANTED.get(field);
  if (!wanted) {
    wanted = new Set(field.labels.map(normaliseLabel));
    WANTED.set(field, wanted);
  }
  return wanted;
}

/**
 * Label as a child, value as a following sibling (element or bare text).
 * If no direct child is the label, look one wrapper deeper (bounded), so
 * <row><p><span>Buys</span>:<span>X</span></p></row> still reads.
 * Returns undefined when this subtree has no label child at all.
 */
function readSiblingValue(
  el: Element,
  wanted: ReadonlySet<string>,
  depth: number,
  cache?: LabeledReadCache,
): string | null | undefined {
  const children = meaningfulChildren(el, cache);
  const labelIndex = children.findIndex((c) => wanted.has(normaliseLabel(c.text)));
  if (labelIndex >= 0) {
    for (const sibling of children.slice(labelIndex + 1)) {
      const value = sibling.text.replace(/^[:\-–—]\s*/, '');
      if (!LABEL_SEPARATOR_PATTERN.test(value)) return value;
    }
    return null; // label present, no value next to it
  }
  if (depth >= MAX_ROW_DEPTH) return undefined;
  for (const child of el.children) {
    const found = readSiblingValue(child, wanted, depth + 1, cache);
    if (found !== undefined) return found;
  }
  return undefined;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Semantic "label: value" extraction with an explicit outcome:
 *   found   — a row carries the label and a value
 *   missing — no row carries the label (normal: IndiaMART omits empty rows)
 *   failed  — a row carries the label but no value could be read
 *
 * Label matching is exact ("Quantity" never matches "Quantity per Strip").
 * Two readings per row: label/value as separate children (preferred), then
 * inline text "Label: value" inside one element. No positional selectors.
 */
export function readLabeledField(
  root: ParentNode,
  field: LabeledField,
  rows: readonly LabeledRowSelector[],
  cache?: LabeledReadCache,
): LabeledRead {
  const wanted = wantedLabels(field);
  const inline = inlinePatterns(field);
  let failure: string | null = null;

  for (const row of rows) {
    let candidates: Element[];
    try {
      candidates = rowsFor(root, row.rowSelector, cache);
    } catch {
      continue;
    }
    for (const rowEl of candidates) {
      const sibling = readSiblingValue(rowEl, wanted, 0, cache);
      if (typeof sibling === 'string' && sibling.length > 0) {
        return { status: 'found', value: sibling, method: 'sibling' };
      }
      const text = rowText(rowEl, cache);
      for (const pattern of inline) {
        const value = pattern.exec(text)?.[1]?.trim();
        if (value) return { status: 'found', value, method: 'inline' };
      }
      if (sibling === null || wanted.has(normaliseLabel(text))) {
        failure = `${field.labels[0] ?? field.id}: row present but value empty`;
      }
    }
  }
  return failure ? { status: 'failed', reason: failure } : { status: 'missing' };
}

/** Value-only wrapper (Phase 1 API). */
export function extractLabeledValue(
  root: ParentNode,
  field: LabeledField,
  rows: readonly LabeledRowSelector[],
): string | null {
  const read = readLabeledField(root, field, rows);
  return read.status === 'found' ? read.value : null;
}

/**
 * Rejects selectors that are likely to break on the next IndiaMART deploy:
 * positional pseudo-classes, generated numeric IDs, long copied paths.
 * Used for runtime-configurable selectors (e.g. a future card container).
 */
export function isStableSelector(selector: string): boolean {
  if (/:(nth-|first-child|last-child|only-child|first-of-type|last-of-type)/.test(selector)) {
    return false;
  }
  if (/#[\w-]*\d{3,}/.test(selector)) return false;
  for (const part of selector.split(',')) {
    const hops = part
      .trim()
      .split(/\s*[>+~]\s*|\s+/)
      .filter(Boolean).length;
    if (hops > 3) return false;
  }
  try {
    document.createDocumentFragment().querySelector(selector);
  } catch {
    return false;
  }
  return true;
}
