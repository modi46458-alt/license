/**
 * Lead card fixtures assembled from DOM fragments inspected in the live
 * IndiaMART Lead Manager. The inner fragments (title block, time/location,
 * breadcrumb, ISQ rows, buyer row, contact markers, action controls) follow
 * the observed markup. The wrappers are NOT real: IndiaMART's card and list
 * containers were never captured, so they are plain <article>/<section>
 * elements marked data-fixture-*. Production code must never select on them.
 */

export interface CardSpec {
  title?: string | null;
  country?: string | null;
  age?: string | null;
  /** Put the lead-age block outside .BuyLdC_time_loc (variant seen in Phase 2 notes). */
  ageOutsideTimeLoc?: boolean;
  breadcrumbs?: readonly string[] | null;
  /** ISQ label → value rows, in order. */
  rows?: ReadonlyArray<readonly [string, string]>;
  buys?: string | null;
  /** Phase 2 notes show the buyer row as a div with plain spans. */
  plainBuyerRow?: boolean;
  engagementText?: string | null;
  contact?: { mobile?: boolean; whatsapp?: boolean; email?: boolean } | null;
  /**
   * How the country element carries IndiaMART's "Click here to view BuyLeads
   * from …" hint (seen live as "CanadaClick here to view BuyLeads from Canada").
   * The exact live markup is unknown, so several plausible shapes are tested.
   */
  countryMarkup?: 'plain' | 'hint-child' | 'hint-link' | 'single-text' | 'hint-first';
  /** Buyer row variants. */
  buyerMarkup?: 'default' | 'nested' | 'inline' | 'icon' | 'empty-value';
  actions?: boolean;
}

export const DEFAULT_ROWS: ReadonlyArray<readonly [string, string]> = [
  ['Quantity', '10 Strip'],
  ['Strength', '20mg'],
  ['Dosage Form', 'Tablet'],
  ['Quantity per Strip', '10 Capsules'],
];

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function countryInner(country: string, markup: CardSpec['countryMarkup'] = 'plain'): string {
  const c = esc(country);
  const hint = `Click here to view BuyLeads from ${c}`;
  switch (markup) {
    case 'plain':
      return c;
    case 'hint-child':
      return `${c}<span class="SLC_tltp">${hint}</span>`;
    case 'hint-link':
      return `<a href="/bltxn/?country=x">${c}</a><div class="SLC_tltp"><p>${hint}</p></div>`;
    case 'single-text':
      return `${c}${hint}`;
    case 'hint-first':
      return `<span class="SLC_tltp">${hint}</span>${c}`;
  }
}

function buyerRowVariant(buys: string, markup: NonNullable<CardSpec['buyerMarkup']>): string {
  const b = esc(buys);
  switch (markup) {
    case 'nested':
      return `<li class="BuyLdC_isqByrDtls"><div class="SLC_dflx"><span>Buys</span><small>:</small><div><span class="SLC_fwb">${b}</span></div></div></li>`;
    case 'inline':
      return `<li class="BuyLdC_isqByrDtls"><span>Buys: ${b}</span></li>`;
    case 'icon':
      return `<li class="BuyLdC_isqByrDtls"><i class="icn"></i><span>  Buys  </span><small> : </small><span class="SLC_fwb">\n   ${b}\n </span></li>`;
    case 'empty-value':
      return `<li class="BuyLdC_isqByrDtls"><span>Buys</span><small>:</small><span class="SLC_fwb">  </span></li>`;
    case 'default':
      return '';
  }
}

export function leadCardHtml(spec: CardSpec = {}): string {
  const title =
    spec.title === undefined ? 'Propanolol 20mg Tablets From Europe to Europe' : spec.title;
  const country = spec.country === undefined ? 'Luxembourg' : spec.country;
  const age = spec.age === undefined ? '22 mins ago' : spec.age;
  const crumbs =
    spec.breadcrumbs === undefined
      ? ['Blood Pressure Medicine', 'Propranolol Tablets']
      : spec.breadcrumbs;
  const rows = spec.rows ?? DEFAULT_ROWS;
  const buys =
    spec.buys === undefined
      ? 'Dutasteride Tablet, Medicine Drop Shippers, Finasteride Tablet'
      : spec.buys;
  const engagement =
    spec.engagementText === undefined
      ? 'Requirements: 8 Calls: 3 Replies: 126'
      : spec.engagementText;
  const contact =
    spec.contact === undefined ? { mobile: true, whatsapp: true, email: true } : spec.contact;

  const ageBlock =
    age === null
      ? ''
      : `<div class="MrLdsB_m1 MrLdsB_m0"><div><strong class="SLC_f14">${esc(age)}</strong></div></div>`;

  const titleSpan =
    title === null
      ? ''
      : `<span class="SLC_f18 SLC_fwb SLC_c0 BuyLdC_m6">\n        ${esc(title)}\n      </span>`;

  const titleBlock = `
    <div class="SLC_dflxG BuyLdC_Gtc1 SLC_ais BuyLdC_gap SLC_f12">
      <div class="SLC_dflx SLC_flxdc BuyLdC_brd">${titleSpan}</div>
      <div class="BuyLdC_time_loc">
        ${spec.ageOutsideTimeLoc ? '' : ageBlock}
        ${country === null ? '' : `<div><strong class="SLC_f14 SLC_c2">${countryInner(country, spec.countryMarkup)}</strong></div>`}
      </div>
    </div>
    ${spec.ageOutsideTimeLoc ? ageBlock : ''}`;

  const breadcrumb =
    crumbs === null
      ? ''
      : `<ul id="breadcrum_pmcat_div"><li>${crumbs
          .map((c) => `<span title="${esc(c)}">${esc(c)}</span>`)
          .join('<i>›</i>')}</li></ul>`;

  const isqRows = rows
    .map(
      ([label, value]) =>
        `<li class="BuyLdC_isqdet SLC_f13 SLC_dflx SLC_gap5 BuyLdC_lh"><span class="SLC_c0">${esc(label)}</span><small>:</small><strong>${esc(value)}</strong></li>`,
    )
    .join('');

  let buyerRow = '';
  if (buys !== null && spec.buyerMarkup && spec.buyerMarkup !== 'default') {
    buyerRow = buyerRowVariant(buys, spec.buyerMarkup);
  } else if (buys !== null) {
    buyerRow = spec.plainBuyerRow
      ? `<div class="BuyLdC_isqByrDtls"><span>Buys</span><small>:</small><span>${esc(buys)}</span></div>`
      : `<li class="BuyLdC_isqByrDtls"><span>Buys</span><small>:</small><span class="SLC_fwb">${esc(buys)}</span></li>`;
  }

  const contactBlock =
    contact === null
      ? ''
      : `<div>${[
          contact.mobile && '<p class="tooltip_vfr">Mobile Number Available</p>',
          contact.whatsapp && '<p class="tooltip_vfr">WhatsApp Available</p>',
          contact.email && '<p class="tooltip_vfr">Email ID Available</p>',
        ]
          .filter(Boolean)
          .join('')}</div>`;

  const actions =
    spec.actions === false
      ? ''
      : `<div class="SLC_pr BuyLdC_tltpw BuyLdC_Shrtlst"></div>
  <div class="BuyLdC_Hide"></div>
  <div class="BuyLdC_NtRlvnt"></div>
  <div class="BuyLdC_VwSimlr"><a href="https://seller.indiamart.com/similar?x=1">View Similar</a></div>`;

  return `
<article data-fixture-card>
  ${titleBlock}
  ${breadcrumb}
  <ul>${isqRows}${spec.plainBuyerRow ? '' : buyerRow}</ul>
  ${spec.plainBuyerRow ? buyerRow : ''}
  ${engagement === null ? '' : `<div>${esc(engagement)}</div>`}
  ${contactBlock}
  ${actions}
</article>`;
}

/** The Phase 1 single-card fixture. */
export const LEAD_CARD_HTML = leadCardHtml();

export function leadListHtml(
  cards: readonly CardSpec[],
  options: { pageBreadcrumbs?: readonly string[] } = {},
): string {
  const pageCrumb = options.pageBreadcrumbs
    ? `<ul id="breadcrum_pmcat_div"><li>${options.pageBreadcrumbs
        .map((c) => `<span title="${esc(c)}">${esc(c)}</span>`)
        .join('')}</li></ul>`
    : '';
  return `<main><header><h1>Lead Manager</h1>${pageCrumb}</header><section data-fixture-list>${cards
    .map((c) => leadCardHtml(c))
    .join('')}</section></main>`;
}

export function mountFixture(html: string = LEAD_CARD_HTML): HTMLElement {
  document.body.innerHTML = html;
  return document.body;
}

/** Three distinct realistic leads. */
export const THREE_LEADS: readonly CardSpec[] = [
  {},
  {
    title: 'Finasteride 5mg Tablets',
    country: 'United States',
    age: '1 hr ago',
    breadcrumbs: ['Hair Care Medicine', 'Finasteride Tablets'],
    rows: [
      ['Quantity', '100 Strip'],
      ['Strength', '5mg'],
    ],
    buys: 'Finasteride Tablet, Minoxidil Solution',
  },
  {
    title: 'Metformin 500mg Tablets',
    country: 'Canada',
    age: '3 days ago',
    breadcrumbs: ['Diabetes Medicine', 'Metformin Tablets'],
    rows: [['Quantity', '1,000 Pieces']],
    buys: null,
    contact: { mobile: true },
  },
];
