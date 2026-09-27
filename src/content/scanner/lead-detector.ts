import type { CardDetection } from '@/core/types/scanner';
import {
  LABELED_FIELDS,
  LABELED_ROWS,
  LEAD_CARD,
  type CardSignal,
  type LeadCardConfig,
} from '../selectors/indiamart-selectors';
import { cleanText, extractLabeledValue, isStableSelector } from '../selectors/selector-resolver';

export interface LeadCardMatch {
  readonly card: Element;
  readonly detection: CardDetection;
}

function signalPresent(el: Element, signal: CardSignal): boolean {
  if (signal.selector === null) return false;
  if (signal.labeledField) {
    return extractLabeledValue(el, LABELED_FIELDS[signal.labeledField], LABELED_ROWS) !== null;
  }
  if (!signal.textExclude) return el.querySelector(signal.selector) !== null;
  const exclude = signal.textExclude;
  return Array.from(el.querySelectorAll(signal.selector)).some((m) => {
    const text = cleanText(m.textContent);
    return text.length > 0 && !exclude.test(text);
  });
}

/** Signal ids present in `el`, including `el` itself matching a signal. */
export function scoreElement(
  el: Element,
  config: LeadCardConfig = LEAD_CARD,
): { confidence: number; signals: string[] } {
  const signals: string[] = [];
  let confidence = 0;
  for (const signal of config.signals) {
    if (signalPresent(el, signal)) {
      signals.push(signal.id);
      confidence += signal.weight;
    }
  }
  return { confidence: Math.round(confidence * 1000) / 1000, signals };
}

/** true when `el` is a list rather than a single card. */
export function holdsSeveralCards(el: Element, config: LeadCardConfig): boolean {
  return config.uniquePerCard.some((selector) => el.querySelectorAll(selector).length > 1);
}

/** Descendant matches of `selector` in `el`, counted up to 2 (all we need to know). */
function cappedCount(el: Element, selector: string): number {
  if (!el.firstElementChild) return 0;
  const first = el.querySelector(selector);
  if (!first) return 0;
  return el.querySelectorAll(selector).length > 1 ? 2 : 1;
}

/**
 * Descendant matches in `parent`, from the already-known count in `child`:
 * the child's own subtree is not searched again, and siblings are only
 * searched until a second match proves "several". Same answer as
 * cappedCount(parent), without scanning a whole lead list for every card.
 */
function parentCount(child: Element, parent: Element, selector: string, inChild: number): number {
  let total = inChild + (child.matches(selector) ? 1 : 0);
  for (let s = parent.firstElementChild; s && total < 2; s = s.nextElementSibling) {
    if (s === child) continue;
    if (s.matches(selector)) total++;
    if (total < 2) total += cappedCount(s, selector);
  }
  return Math.min(total, 2);
}

const stableContainerCache = new Map<string, boolean>();
function usableContainer(selector: string | null): selector is string {
  if (selector === null) return false;
  let ok = stableContainerCache.get(selector);
  if (ok === undefined) {
    ok = isStableSelector(selector);
    stableContainerCache.set(selector, ok);
  }
  return ok;
}

/**
 * Resolve any element inside a lead card to the card itself.
 *
 * 1. If a verified container selector is configured (and passes the stability
 *    check), use closest().
 * 2. Otherwise walk up at most `maxAncestorDepth` ancestors, stopping at the
 *    first ancestor that contains more than one card title (that is the list).
 *    The smallest ancestor with the highest signal score wins, provided the
 *    score reaches `threshold`. <body> and <html> are never cards.
 */
export function findLeadCard(
  element: Element,
  config: LeadCardConfig = LEAD_CARD,
): LeadCardMatch | null {
  if (usableContainer(config.containerSelector)) {
    const card = element.closest(config.containerSelector);
    if (card && !holdsSeveralCards(card, config)) {
      const { confidence, signals } = scoreElement(card, config);
      if (confidence >= config.threshold) {
        return { card, detection: { confidence, signals, method: 'container', depth: 0 } };
      }
    }
  }

  let best: { el: Element; confidence: number; signals: string[]; depth: number } | null = null;
  let current: Element | null = element;
  let child: Element | null = null;
  // Per unique-per-card selector: matches below `current`, capped at 2.
  let counts: number[] = [];
  for (let depth = 0; current && depth <= config.maxAncestorDepth; depth++) {
    if (current === current.ownerDocument.body || current === current.ownerDocument.documentElement)
      break;
    const here: Element = current;
    const below: Element | null = child;
    counts =
      below === null
        ? config.uniquePerCard.map((selector) => cappedCount(here, selector))
        : config.uniquePerCard.map((selector, k) =>
            parentCount(below, here, selector, counts[k] ?? 0),
          );
    if (counts.some((c) => c > 1)) break; // a list, not a card
    const { confidence, signals } = scoreElement(here, config);
    if (!best || confidence > best.confidence) best = { el: here, confidence, signals, depth };
    child = here;
    current = here.parentElement;
  }

  if (!best || best.confidence < config.threshold) return null;
  return {
    card: best.el,
    detection: {
      confidence: best.confidence,
      signals: best.signals,
      method: 'walk',
      depth: best.depth,
    },
  };
}

const ANCHOR_SELECTOR_CACHE = new WeakMap<LeadCardConfig, string>();
export function anchorSelector(config: LeadCardConfig = LEAD_CARD): string {
  let selector = ANCHOR_SELECTOR_CACHE.get(config);
  if (!selector) {
    selector = config.anchors.join(', ');
    ANCHOR_SELECTOR_CACHE.set(config, selector);
  }
  return selector;
}

/** Anchors inside (and including) a node. Only the node's own subtree is searched. */
export function collectAnchors(node: Node, config: LeadCardConfig = LEAD_CARD): Element[] {
  if (!(node instanceof Element)) return [];
  const selector = anchorSelector(config);
  const found: Element[] = node.matches(selector) ? [node] : [];
  if (node.firstElementChild) found.push(...Array.from(node.querySelectorAll(selector)));
  return found;
}
