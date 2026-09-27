import { normalizeForComparison } from '@/core/normalization/normalize-text';
import { CONTACT_BUYER, CONTACT_BUYER_TEXT } from '../selectors/indiamart-selectors';
import { cleanText, resolveAll } from '../selectors/selector-resolver';

/**
 * Finds and verifies the Contact Buyer button of ONE lead card.
 *
 * Read-only: this module never clicks, focuses, scrolls or dispatches events.
 * The Phase 8 action engine will call it right before a user-approved click
 * and emit ACTION_FAILED with the code below whenever it does not return ok.
 *
 * Checks, in order (any failure → no button):
 *   1. the card is still on the page
 *   2. the search scope holds exactly one lead (one title)
 *   3. that lead is the one the caller expects (normalized title)
 *   4. exactly one Contact Buyer button inside the scope
 *   5. the button text says Contact Buyer
 *   6. the button belongs to this card's wrapper, not a neighbour's
 *   7. the button is connected, visible and enabled
 */

export type ActionFailureCode = 'ACTION_NOT_FOUND' | 'IDENTITY_MISMATCH';

export type ContactBuyerResolution =
  | {
      readonly ok: true;
      readonly button: Element;
      /** Where the button was searched: the card or its BLCard wrapper. */
      readonly scope: Element;
      /** 0 = verified reference structure, 1 = text fallback. */
      readonly strategyIndex: number;
      readonly confidence: number;
    }
  | { readonly ok: false; readonly code: ActionFailureCode; readonly reason: string };

export interface ResolveContactBuyerOptions {
  /** Normalized title the caller expects the card to show (identity check). */
  readonly expectedTitle?: string | null;
  /** Injectable for tests; the default uses layout (getClientRects). */
  readonly isVisible?: (element: Element) => boolean;
}

const fail = (code: ActionFailureCode, reason: string): ContactBuyerResolution => ({
  ok: false,
  code,
  reason,
});

/** Visible to the user right now: rendered, not display:none / visibility:hidden / [hidden]. */
export function isElementVisible(element: Element): boolean {
  if (!element.isConnected || element.closest('[hidden]')) return false;
  const view = element.ownerDocument.defaultView;
  const style = view?.getComputedStyle(element);
  if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
  return element.getClientRects().length > 0;
}

function safeClosest(element: Element, selector: string): Element | null {
  try {
    return element.closest(selector);
  } catch {
    return null;
  }
}

/**
 * The card, widened to its BLCard wrapper when the wrapper still holds only
 * this one lead (the verified button row is a direct child of that wrapper,
 * which may sit outside the smallest container the detector chose).
 */
export function contactScope(card: Element): Element {
  const wrapper = safeClosest(card, CONTACT_BUYER.cardContainer);
  if (!wrapper || wrapper === card) return card;
  return wrapper.querySelectorAll(CONTACT_BUYER.titleAnchor).length === 1 ? wrapper : card;
}

export function resolveContactBuyer(
  card: Element,
  options: ResolveContactBuyerOptions = {},
): ContactBuyerResolution {
  const isVisible = options.isVisible ?? isElementVisible;

  if (!card.isConnected) return fail('ACTION_NOT_FOUND', 'lead card is no longer on the page');

  const scope = contactScope(card);
  const titles = scope.querySelectorAll(CONTACT_BUYER.titleAnchor);
  if (titles.length !== 1) {
    return fail('IDENTITY_MISMATCH', `expected one lead in the card, found ${titles.length}`);
  }
  if (options.expectedTitle !== undefined && options.expectedTitle !== null) {
    const shown = normalizeForComparison(titles[0]?.textContent);
    if (shown !== normalizeForComparison(options.expectedTitle)) {
      return fail('IDENTITY_MISMATCH', 'the card now shows a different lead');
    }
  }

  const found = resolveAll(scope, CONTACT_BUYER.selector);
  if (!found.ok) return fail('ACTION_NOT_FOUND', 'no Contact Buyer button in the card');
  const buttons = [...new Set(found.value.map((r) => r.element))];
  if (buttons.length > 1) {
    return fail('IDENTITY_MISMATCH', `${buttons.length} Contact Buyer buttons in the card`);
  }
  const match = found.value[0];
  const button = match?.element;
  if (!match || !button) return fail('ACTION_NOT_FOUND', 'no Contact Buyer button in the card');

  if (!CONTACT_BUYER_TEXT.test(cleanText(button.textContent))) {
    return fail('ACTION_NOT_FOUND', 'button text is not Contact Buyer');
  }
  const buttonWrapper = safeClosest(button, CONTACT_BUYER.cardContainer);
  const scopeWrapper = safeClosest(scope, CONTACT_BUYER.cardContainer);
  if (!scope.contains(button) || buttonWrapper !== scopeWrapper) {
    return fail('IDENTITY_MISMATCH', 'button belongs to another card');
  }
  if (!isVisible(button)) return fail('ACTION_NOT_FOUND', 'button is not visible');
  if (button instanceof HTMLButtonElement && button.disabled) {
    return fail('ACTION_NOT_FOUND', 'button is disabled');
  }

  return {
    ok: true,
    button,
    scope,
    strategyIndex: match.strategyIndex,
    confidence: match.confidence,
  };
}
