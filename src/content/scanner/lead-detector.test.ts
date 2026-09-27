import { describe, expect, it } from 'vitest';
import {
  THREE_LEADS,
  leadCardHtml,
  leadListHtml,
  mountFixture,
} from '@/tests/fixtures/indiamart-lead-card';
import { INDIAMART_PAGE, LEAD_CARD, type LeadCardConfig } from '../selectors/indiamart-selectors';
import { detectPage, isSupportedUrl } from './indiamart-page-detector';
import { collectAnchors, findLeadCard, scoreElement } from './lead-detector';

const SELLER = 'https://seller.indiamart.com/bltxn/?pref=recent';

describe('findLeadCard', () => {
  it('resolves every anchor of a card to the same card', () => {
    const root = mountFixture(leadListHtml(THREE_LEADS));
    const articles = Array.from(root.querySelectorAll('article'));
    for (const article of articles) {
      for (const anchor of collectAnchors(article)) {
        expect(findLeadCard(anchor)?.card).toBe(article);
      }
    }
  });

  it('separates adjacent cards in a list', () => {
    const root = mountFixture(leadListHtml(THREE_LEADS));
    const cards = new Set(
      Array.from(root.querySelectorAll('.BuyLdC_m6')).map((t) => findLeadCard(t)?.card),
    );
    expect(cards.size).toBe(3);
    expect(cards.has(root.querySelector('section') ?? undefined)).toBe(false);
  });

  it('reports signals and confidence', () => {
    const root = mountFixture();
    const match = findLeadCard(root.querySelector('.BuyLdC_m6') as Element);
    expect(match?.detection.method).toBe('walk');
    expect(match?.detection.signals).toEqual([
      'title',
      'country',
      'quantity',
      'buyer',
      'category',
      'contact',
    ]);
    expect(match?.detection.confidence).toBeCloseTo(0.9);
  });

  it('does not treat country-less time blocks as a country signal', () => {
    mountFixture(leadCardHtml({ country: null }));
    const { signals } = scoreElement(document.querySelector('article') as Element);
    expect(signals).not.toContain('country');
  });

  it('rejects random page elements', () => {
    document.body.innerHTML = `
      <nav><span class="BuyLdC_m6">Promoted</span></nav>
      <aside><li class="BuyLdC_isqdet"><span>Colour</span><strong>Red</strong></li></aside>`;
    expect(findLeadCard(document.querySelector('.BuyLdC_m6') as Element)).toBeNull();
    expect(findLeadCard(document.querySelector('.BuyLdC_isqdet') as Element)).toBeNull();
  });

  it('never returns body or html', () => {
    document.body.innerHTML = leadCardHtml().replace(/<\/?article[^>]*>/g, '');
    const match = findLeadCard(document.querySelector('.BuyLdC_m6') as Element);
    expect(match?.card).not.toBe(document.body);
    expect(match?.card).not.toBe(document.documentElement);
  });

  it('keeps a title-less card from absorbing its neighbour', () => {
    const root = mountFixture(leadListHtml([{ title: null }, {}]));
    const [broken, good] = Array.from(root.querySelectorAll('article'));
    const match = findLeadCard(broken?.querySelector('.BuyLdC_isqdet') as Element);
    expect(match?.card).toBe(broken);
    expect(findLeadCard(good?.querySelector('.BuyLdC_m6') as Element)?.card).toBe(good);
  });

  it('respects a configurable threshold', () => {
    mountFixture(leadCardHtml({ rows: [], buys: null, breadcrumbs: null, contact: null }));
    const anchor = document.querySelector('.BuyLdC_m6') as Element;
    expect(findLeadCard(anchor)).toBeNull(); // title + country = 0.45 < 0.5
    const match = findLeadCard(anchor, { ...LEAD_CARD, threshold: 0.4 });
    expect(match?.detection.confidence).toBeCloseTo(0.45);
    // Smallest ancestor with the top score: the title block, not the page.
    expect(match?.card.classList.contains('BuyLdC_Gtc1')).toBe(true);
  });

  it('uses a verified container selector when configured', () => {
    mountFixture();
    const config: LeadCardConfig = { ...LEAD_CARD, containerSelector: 'article' };
    const match = findLeadCard(document.querySelector('.BuyLdC_isqdet') as Element, config);
    expect(match?.detection.method).toBe('container');
    expect(match?.card.tagName).toBe('ARTICLE');
  });

  it('ignores an unstable container selector and falls back to the walk', () => {
    mountFixture();
    const config: LeadCardConfig = {
      ...LEAD_CARD,
      containerSelector: 'body > article:nth-child(1)',
    };
    const match = findLeadCard(document.querySelector('.BuyLdC_m6') as Element, config);
    expect(match?.detection.method).toBe('walk');
  });
});

describe('collectAnchors', () => {
  it('searches only the given subtree and includes the node itself', () => {
    const root = mountFixture(leadListHtml(THREE_LEADS));
    const first = root.querySelector('article') as Element;
    const anchors = collectAnchors(first);
    expect(anchors.every((a) => first.contains(a))).toBe(true);
    const title = first.querySelector('.BuyLdC_m6') as Element;
    expect(collectAnchors(title)).toEqual([title]);
    expect(collectAnchors(document.createTextNode('x'))).toEqual([]);
  });
});

describe('page detection', () => {
  it('requires the seller host', () => {
    expect(isSupportedUrl(SELLER)).toBe(true);
    expect(isSupportedUrl('https://www.indiamart.com/')).toBe(false);
    expect(isSupportedUrl('https://seller.indiamart.com.evil.io/')).toBe(false);
  });

  it('requires lead-list markup, not just the host', () => {
    document.body.innerHTML = '<main>Account settings</main>';
    expect(detectPage(SELLER, document).active).toBe(false);
    mountFixture();
    expect(detectPage(SELLER, document).active).toBe(true);
  });

  it('honours confirmed path patterns once configured', () => {
    mountFixture();
    const config = { ...INDIAMART_PAGE, supportedPaths: [/^\/messagecentre/] };
    expect(detectPage(SELLER, document, config).active).toBe(false);
    expect(detectPage('https://seller.indiamart.com/messagecentre/', document, config).active).toBe(
      true,
    );
  });
});
