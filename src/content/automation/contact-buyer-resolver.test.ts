import { afterEach, describe, expect, it, vi } from 'vitest';
import { leadCardHtml, mountFixture, type CardSpec } from '@/tests/fixtures/indiamart-lead-card';
import { findLeadCard } from '../scanner/lead-detector';
import { CONTACT_BUYER } from '../selectors/indiamart-selectors';
import { contactScope, resolveContactBuyer } from './contact-buyer-resolver';

const visible = () => true;

interface WrapOptions {
  n?: number;
  /** Class list of the button row; the verified reference implies "SLC_dflx SLC_ pr". */
  rowClass?: string;
  buttonHtml?: string;
  /** false → no BLCard wrapper at all. */
  wrapper?: boolean;
  /** Put the button row inside the article instead of beside it. */
  inside?: boolean;
}

const BUTTON = '<button type="button"><strong>Contact Buyer</strong></button>';

function blCard(spec: CardSpec = {}, o: WrapOptions = {}): string {
  const row = `<div class="${o.rowClass ?? 'SLC_dflx SLC_ pr'}">${o.buttonHtml ?? BUTTON}</div>`;
  const card = leadCardHtml(spec);
  const body = o.inside ? card.replace('</article>', `${row}</article>`) : `${card}${row}`;
  return o.wrapper === false
    ? `<div class="list-item">${body}</div>`
    : `<div id="BLCard${o.n ?? 1}" class="SLC_pr">${body}</div>`;
}

function mount(html: string): void {
  mountFixture(`<main><section>${html}</section></main>`);
}

/** The card as the scanner would identify it (via the title anchor). */
function detectedCard(index = 0): Element {
  const anchor = document.querySelectorAll('.BuyLdC_m6')[index] as Element;
  const match = findLeadCard(anchor);
  if (!match) throw new Error('fixture card not detected');
  return match.card;
}

afterEach(() => vi.restoreAllMocks());

describe('Contact Buyer resolution', () => {
  it('finds the button with the verified reference structure, scoped to the card', () => {
    mount(blCard());
    const r = resolveContactBuyer(detectedCard(), { isVisible: visible });
    expect(r.ok).toBe(true);
    expect(r.ok && r.strategyIndex).toBe(0);
    expect(r.ok && r.confidence).toBe(1);
    expect(r.ok && r.button.tagName).toBe('BUTTON');
    // The verified reference itself points at the same element (strong inside it).
    expect(r.ok && r.button.contains(document.querySelector(CONTACT_BUYER.reference))).toBe(true);
  });

  it('widens the scope to the BLCard wrapper when the button row sits beside the card', () => {
    mount(blCard());
    const card = detectedCard();
    expect(card.tagName).toBe('ARTICLE'); // detector picked the smaller container
    expect(contactScope(card).id).toBe('BLCard1');
    expect(resolveContactBuyer(card, { isVisible: visible }).ok).toBe(true);
  });

  it('falls back to button text when the row classes differ (e.g. "SLC_pr")', () => {
    mount(blCard({}, { rowClass: 'SLC_dflx SLC_pr' }));
    const r = resolveContactBuyer(detectedCard(), { isVisible: visible });
    expect(r.ok && r.strategyIndex).toBe(1);
    expect(r.ok && r.confidence).toBe(0.8);
  });

  it.each([1, 2, 7, 42, 1000])('does not depend on the card number (BLCard%i)', (n) => {
    mount(blCard({}, { n }));
    expect(resolveContactBuyer(detectedCard(), { isVisible: visible }).ok).toBe(true);
  });

  it('works without any BLCard wrapper when the button is inside the card', () => {
    mount(blCard({}, { wrapper: false, inside: true }));
    expect(resolveContactBuyer(detectedCard(), { isVisible: visible }).ok).toBe(true);
  });

  it("each card resolves its own button, never a neighbour's", () => {
    mount(
      blCard({ title: 'First Lead Tablets' }, { n: 1 }) +
        blCard({ title: 'Second Lead Capsules' }, { n: 2 }),
    );
    const first = resolveContactBuyer(detectedCard(0), { isVisible: visible });
    const second = resolveContactBuyer(detectedCard(1), { isVisible: visible });
    expect(first.ok && first.button.closest('[id^="BLCard"]')?.id).toBe('BLCard1');
    expect(second.ok && second.button.closest('[id^="BLCard"]')?.id).toBe('BLCard2');
    expect(first.ok && second.ok && first.button).not.toBe(second.ok && second.button);
  });
});

describe('refuses when not confident', () => {
  it('no button → ACTION_NOT_FOUND', () => {
    mount(blCard({}, { buttonHtml: '' }));
    expect(resolveContactBuyer(detectedCard(), { isVisible: visible })).toEqual({
      ok: false,
      code: 'ACTION_NOT_FOUND',
      reason: 'no Contact Buyer button in the card',
    });
  });

  it.each([
    '<button><strong>View Details</strong></button>',
    '<button><strong>Contacted</strong></button>',
    '<a><strong>Contact</strong></a>',
  ])('wrong button %s → ACTION_NOT_FOUND', (buttonHtml) => {
    mount(blCard({}, { buttonHtml }));
    const r = resolveContactBuyer(detectedCard(), { isVisible: visible });
    expect(r).toMatchObject({ ok: false, code: 'ACTION_NOT_FOUND' });
  });

  it('invisible button → ACTION_NOT_FOUND', () => {
    mount(blCard());
    expect(resolveContactBuyer(detectedCard(), { isVisible: () => false })).toEqual({
      ok: false,
      code: 'ACTION_NOT_FOUND',
      reason: 'button is not visible',
    });
  });

  it('the default visibility check rejects hidden buttons', () => {
    mount(blCard({}, { buttonHtml: '<button hidden><strong>Contact Buyer</strong></button>' }));
    expect(resolveContactBuyer(detectedCard())).toMatchObject({ code: 'ACTION_NOT_FOUND' });
  });

  it('disabled button → ACTION_NOT_FOUND', () => {
    mount(blCard({}, { buttonHtml: '<button disabled><strong>Contact Buyer</strong></button>' }));
    expect(resolveContactBuyer(detectedCard(), { isVisible: visible })).toMatchObject({
      code: 'ACTION_NOT_FOUND',
      reason: 'button is disabled',
    });
  });

  it('card removed from the page → ACTION_NOT_FOUND', () => {
    mount(blCard());
    const card = detectedCard();
    card.closest('[id^="BLCard"]')?.remove();
    expect(resolveContactBuyer(card, { isVisible: visible })).toMatchObject({
      code: 'ACTION_NOT_FOUND',
      reason: 'lead card is no longer on the page',
    });
  });

  it('card now shows a different lead → IDENTITY_MISMATCH', () => {
    mount(blCard({ title: 'Propranolol Tablets' }));
    const r = resolveContactBuyer(detectedCard(), {
      isVisible: visible,
      expectedTitle: 'Amlodipine 5mg Tablets',
    });
    expect(r).toEqual({
      ok: false,
      code: 'IDENTITY_MISMATCH',
      reason: 'the card now shows a different lead',
    });
  });

  it('expected title matches case- and space-insensitively', () => {
    mount(blCard({ title: 'Propranolol  Tablets' }));
    const r = resolveContactBuyer(detectedCard(), {
      isVisible: visible,
      expectedTitle: 'propranolol tablets',
    });
    expect(r.ok).toBe(true);
  });

  it('a scope holding two leads → IDENTITY_MISMATCH', () => {
    mount(
      `<div id="BLCard1">${leadCardHtml({ title: 'A' })}${leadCardHtml({ title: 'B' })}<div class="SLC_dflx SLC_ pr">${BUTTON}</div></div>`,
    );
    const r = resolveContactBuyer(document.getElementById('BLCard1') as Element, {
      isVisible: visible,
    });
    expect(r).toMatchObject({ ok: false, code: 'IDENTITY_MISMATCH' });
  });

  it('two Contact Buyer buttons in one card → IDENTITY_MISMATCH', () => {
    mount(blCard({}, { buttonHtml: `${BUTTON}${BUTTON}` }));
    expect(resolveContactBuyer(detectedCard(), { isVisible: visible })).toMatchObject({
      code: 'IDENTITY_MISMATCH',
      reason: '2 Contact Buyer buttons in the card',
    });
  });
});

describe('read-only', () => {
  it('never clicks, focuses or dispatches events', () => {
    mount(blCard());
    const click = vi.spyOn(HTMLElement.prototype, 'click');
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    const dispatch = vi.spyOn(EventTarget.prototype, 'dispatchEvent');
    const before = document.body.innerHTML;
    resolveContactBuyer(detectedCard(), { isVisible: visible });
    resolveContactBuyer(detectedCard());
    expect(click).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(document.body.innerHTML).toBe(before);
  });
});

describe('selector map', () => {
  it('keeps the verified reference as documentation only', () => {
    expect(CONTACT_BUYER.reference).toBe('#BLCard1 > div.SLC_dflx.SLC_.pr > button > strong');
    const production = CONTACT_BUYER.selector.strategies.map((s) =>
      s.kind === 'css' ? s.selector : s.scope,
    );
    for (const selector of [
      ...production,
      CONTACT_BUYER.cardContainer,
      CONTACT_BUYER.titleAnchor,
    ]) {
      expect(selector).not.toMatch(/#BLCard|BLCard\d|:nth-/);
    }
  });
});
