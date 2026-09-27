import { beforeEach, describe, expect, it } from 'vitest';
import { mountFixture } from '@/tests/fixtures/indiamart-lead-card';
import {
  ACTION_SELECTORS,
  CONTACT_AVAILABILITY,
  ENGAGEMENT_PATTERNS,
  FIELD_SELECTORS,
  LABELED_FIELDS,
  LABELED_ROWS,
  RELATIVE_TIME_PATTERN,
  type FieldSelector,
} from './indiamart-selectors';
import { cleanText, extractLabeledValue, resolveAll, resolveOne } from './selector-resolver';

let root: HTMLElement;
beforeEach(() => {
  root = mountFixture();
});

const textOf = (field: FieldSelector) => {
  const r = resolveOne(root, field);
  return r.ok ? cleanText(r.value.element.textContent) : null;
};

describe('scalar fields on the observed DOM', () => {
  it('title via primary selector at full confidence', () => {
    const r = resolveOne(root, FIELD_SELECTORS.title);
    expect(r.ok && r.value.confidence).toBe(1);
    expect(textOf(FIELD_SELECTORS.title)).toBe('Propanolol 20mg Tablets From Europe to Europe');
  });

  it('separates country from timestamp inside the same block', () => {
    expect(textOf(FIELD_SELECTORS.country)).toBe('Luxembourg');
    expect(textOf(FIELD_SELECTORS.timestamp)).toBe('22 mins ago');
  });

  it('returns every breadcrumb in order', () => {
    const r = resolveAll(root, FIELD_SELECTORS.categoryBreadcrumb);
    expect(r.ok && r.value.map((v) => v.element.getAttribute('title'))).toEqual([
      'Blood Pressure Medicine',
      'Propranolol Tablets',
    ]);
  });

  it('extracts the View Similar href', () => {
    const r = resolveOne(root, ACTION_SELECTORS.viewSimilar);
    expect(r.ok && r.value.element.getAttribute('href')).toBe(
      'https://seller.indiamart.com/similar?x=1',
    );
  });

  it('finds every action control', () => {
    for (const action of Object.values(ACTION_SELECTORS)) {
      expect(resolveOne(root, action).ok).toBe(true);
    }
  });
});

describe('fallbacks', () => {
  it('falls back to a weaker strategy when the primary class disappears', () => {
    root.querySelector('.BuyLdC_Gtc1')?.classList.remove('BuyLdC_Gtc1');
    const r = resolveOne(root, FIELD_SELECTORS.title);
    expect(r.ok && r.value.strategyIndex).toBe(1);
    expect(r.ok && r.value.confidence).toBe(0.9);
  });

  it('finds the timestamp by text when its container classes change', () => {
    root.querySelector('.BuyLdC_time_loc')?.classList.remove('BuyLdC_time_loc');
    root.querySelector('.MrLdsB_m1')?.classList.remove('MrLdsB_m1');
    const r = resolveOne(root, FIELD_SELECTORS.timestamp);
    expect(r.ok && r.value.confidence).toBe(0.6);
    expect(r.ok && cleanText(r.value.element.textContent)).toBe('22 mins ago');
  });

  it('skips an empty title element and uses the next strategy', () => {
    const primary = root.querySelector('.BuyLdC_m6');
    const title = primary?.textContent ?? '';
    primary?.replaceChildren();
    primary?.insertAdjacentHTML('afterend', `<span class="SLC_fwb">${title}</span>`);
    const r = resolveOne(root, FIELD_SELECTORS.title);
    expect(r.ok && r.value.strategyIndex).toBe(2);
  });

  it('reports a failure instead of throwing when nothing matches', () => {
    document.body.innerHTML = '<div>unrelated</div>';
    const r = resolveOne(document.body, FIELD_SELECTORS.title);
    expect(r).toEqual({ ok: false, failure: { fieldId: 'title', attempted: 3 } });
  });

  it('treats an invalid selector as a miss', () => {
    const broken: FieldSelector = {
      id: 'broken',
      description: '',
      verified: false,
      strategies: [
        { kind: 'css', selector: '::::', confidence: 1 },
        { kind: 'css', selector: '.BuyLdC_m6', confidence: 0.5 },
      ],
    };
    const r = resolveOne(root, broken);
    expect(r.ok && r.value.strategyIndex).toBe(1);
  });
});

describe('semantic labeled fields', () => {
  it.each([
    ['quantity', '10 Strip'],
    ['strength', '20mg'],
    ['dosageForm', 'Tablet'],
    ['quantityPerStrip', '10 Capsules'],
    ['buyerProducts', 'Dutasteride Tablet, Medicine Drop Shippers, Finasteride Tablet'],
  ] as const)('%s → %s', (id, expected) => {
    expect(extractLabeledValue(root, LABELED_FIELDS[id], LABELED_ROWS)).toBe(expected);
  });

  it('does not confuse "Quantity" with "Quantity per Strip"', () => {
    const list = root.querySelector('ul:not(#breadcrum_pmcat_div)');
    const [qty] = Array.from(root.querySelectorAll('.BuyLdC_isqdet'));
    if (list && qty) list.append(qty); // move Quantity after Quantity per Strip
    expect(extractLabeledValue(root, LABELED_FIELDS.quantity, LABELED_ROWS)).toBe('10 Strip');
  });

  it('survives row reordering', () => {
    const list = root.querySelector('ul:not(#breadcrum_pmcat_div)');
    list?.replaceChildren(...Array.from(list.children).reverse());
    expect(extractLabeledValue(root, LABELED_FIELDS.strength, LABELED_ROWS)).toBe('20mg');
  });

  it('returns null for a missing row', () => {
    root.querySelectorAll('.BuyLdC_isqdet').forEach((el) => el.remove());
    expect(extractLabeledValue(root, LABELED_FIELDS.quantity, LABELED_ROWS)).toBeNull();
  });
});

describe('text patterns', () => {
  it.each(['22 mins ago', '1 hr ago', '3 days ago', 'just now', 'Yesterday'])(
    'recognises "%s" as a relative time',
    (t) => expect(RELATIVE_TIME_PATTERN.test(t)).toBe(true),
  );

  it.each(['Luxembourg', 'United States', '22 Strip'])('does not treat "%s" as a time', (t) =>
    expect(RELATIVE_TIME_PATTERN.test(t)).toBe(false),
  );

  it('reads engagement counts from card text', () => {
    const text = cleanText(root.textContent);
    expect(ENGAGEMENT_PATTERNS.requirements.exec(text)?.[1]).toBe('8');
    expect(ENGAGEMENT_PATTERNS.calls.exec(text)?.[1]).toBe('3');
    expect(ENGAGEMENT_PATTERNS.replies.exec(text)?.[1]).toBe('126');
  });

  it('detects contact availability markers without implying values', () => {
    const markers = Array.from(root.querySelectorAll(CONTACT_AVAILABILITY.markerSelector)).map(
      (el) => cleanText(el.textContent),
    );
    expect(markers.some((m) => CONTACT_AVAILABILITY.mobile.test(m))).toBe(true);
    expect(markers.some((m) => CONTACT_AVAILABILITY.whatsapp.test(m))).toBe(true);
    expect(markers.some((m) => CONTACT_AVAILABILITY.email.test(m))).toBe(true);
    // No digits or @ in the markers: they are availability flags only.
    expect(markers.join(' ')).not.toMatch(/\d|@/);
  });
});
