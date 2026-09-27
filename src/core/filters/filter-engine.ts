import { countryByCode, normalizeCountry } from '../normalization/normalize-country';
import type { NormalizedLead } from '../normalization/normalization-types';
import { aliasKey } from '../normalization/normalize-text';
import { compileKeyword, findKeyword, wordTokens, type CompiledKeyword } from './filter-text';
import type {
  ContactChannel,
  FilterConfig,
  FilterEvaluation,
  FilterGroup,
  FilterReason,
  TextField,
} from './filter-types';

/**
 * Advanced filter engine (Phase 4).
 *
 *   result = [NOT excluded-keywords] AND ( positive groups combined with AND | OR )
 *
 * Positive groups: countries, keywords, quantity, contact, lead age. A group
 * takes part only when it is enabled and has something to check. Excluded
 * keywords always reject, whatever the global mode.
 *
 * Pure: reads only the NormalizedLead and the compiled config. No DOM, no
 * clock (evaluatedAt is passed in and is metadata), no randomness. Every
 * group is evaluated so all reasons are reported, not just the first.
 */

interface CompiledCountry {
  readonly label: string;
  readonly code: string | null;
  readonly key: string | null;
}

export interface CompiledFilter {
  readonly config: FilterConfig;
  readonly countries: readonly CompiledCountry[];
  readonly keywords: readonly CompiledKeyword[];
  readonly negatives: readonly CompiledKeyword[];
  readonly contactChannels: readonly ContactChannel[];
}

const CHANNEL_LABEL: Readonly<Record<ContactChannel, string>> = {
  mobile: 'Mobile',
  whatsapp: 'WhatsApp',
  email: 'Email',
};

/** Compile once per config change; evaluation then does no parsing of the config. */
export function compileFilter(config: FilterConfig): CompiledFilter {
  const enabledValues = (terms: FilterConfig['keywords']['values']) =>
    terms.filter((t) => t.enabled).map((t) => t.value);

  // Configured countries may be names, aliases or ISO codes ("GB").
  const countries = enabledValues(config.countries.values).map((label) => {
    const n = normalizeCountry(label).value;
    const byCode =
      n.code === null && /^[a-z]{2}$/i.test(label.trim()) ? countryByCode(label) : null;
    return byCode
      ? { label, code: byCode.code, key: aliasKey(byCode.name) }
      : { label, code: n.code, key: aliasKey(n.normalized) };
  });
  const compile = (values: string[]) =>
    values.map(compileKeyword).filter((k): k is CompiledKeyword => k !== null);
  const { mobile, whatsapp, email } = config.contact;

  return {
    config,
    countries,
    keywords: compile(enabledValues(config.keywords.values)),
    negatives: compile(enabledValues(config.negativeKeywords.values)),
    contactChannels: (
      [
        ['mobile', mobile],
        ['whatsapp', whatsapp],
        ['email', email],
      ] as const
    )
      .filter(([, on]) => on)
      .map(([c]) => c),
  };
}

/* ------------------------------------------------------------------ */
/* Per-lead text, tokenised lazily and once                            */
/* ------------------------------------------------------------------ */

class LeadText {
  private readonly cache = new Map<TextField, string[][]>();
  constructor(private readonly lead: NormalizedLead) {}

  /** Each field as one or more token lists (buyer products: one per product). */
  words(field: TextField): string[][] {
    let words = this.cache.get(field);
    if (!words) {
      const lead = this.lead;
      const texts =
        field === 'title'
          ? [lead.title.normalized]
          : field === 'productCategory'
            ? [lead.productCategory]
            : field === 'category'
              ? [lead.category]
              : lead.buys.products;
      words = texts.map((t) => wordTokens(t)).filter((w) => w.length > 0);
      this.cache.set(field, words);
    }
    return words;
  }

  find(
    keyword: CompiledKeyword,
    fields: readonly TextField[],
  ): { field: TextField; matchedText: string } | null {
    for (const field of fields) {
      for (const words of this.words(field)) {
        const at = findKeyword(words, keyword);
        if (at >= 0) {
          return { field, matchedText: words.slice(at, at + keyword.tokens.length).join(' ') };
        }
      }
    }
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Groups                                                               */
/* ------------------------------------------------------------------ */

interface GroupResult {
  readonly group: FilterGroup;
  /** null → group skipped (disabled or nothing configured). */
  readonly passed: boolean | null;
  readonly reasons: FilterReason[];
}

const skipped = (group: FilterGroup, what: string): GroupResult => ({
  group,
  passed: null,
  reasons: [
    {
      type: 'GROUP_EMPTY',
      group,
      outcome: 'info',
      message: `${what}: nothing selected, not applied`,
    },
  ],
});

function countryGroup(lead: NormalizedLead, f: CompiledFilter): GroupResult {
  const group = 'countries';
  if (f.countries.length === 0) return skipped(group, 'Countries');
  const name = lead.country.normalized;
  if (name === null) {
    return {
      group,
      passed: false,
      reasons: [
        { type: 'COUNTRY_MISSING', group, outcome: 'fail', message: 'Country unavailable' },
      ],
    };
  }
  const leadKey = aliasKey(name);
  const matches = (c: CompiledCountry) =>
    c.code !== null && lead.country.code !== null
      ? c.code === lead.country.code
      : c.key === leadKey;
  const expected = f.countries.map((c) => c.label).join(', ');

  const hit = f.countries.filter(matches);
  const passed =
    f.config.countries.mode === 'ANY' ? hit.length > 0 : hit.length === f.countries.length;
  if (passed) {
    return {
      group,
      passed,
      reasons: [
        {
          type: 'COUNTRY_MATCH',
          group,
          outcome: 'pass',
          value: name,
          code: lead.country.code,
          message: `Country matched: ${name}`,
        },
      ],
    };
  }
  return {
    group,
    passed,
    reasons: [
      {
        type: 'COUNTRY_MISMATCH',
        group,
        outcome: 'fail',
        value: name,
        expected,
        message:
          f.config.countries.mode === 'ALL' && hit.length > 0
            ? `Country ${name} cannot match all of: ${expected}`
            : `Country not allowed: ${name}`,
      },
    ],
  };
}

function keywordGroup(text: LeadText, f: CompiledFilter): GroupResult & { matched: string[] } {
  const group = 'keywords';
  const { fields, mode } = f.config.keywords;
  if (f.keywords.length === 0 || fields.length === 0) {
    return { ...skipped(group, 'Keywords'), matched: [] };
  }
  const reasons: FilterReason[] = [];
  const matched: string[] = [];
  const missing: string[] = [];
  for (const keyword of f.keywords) {
    const hit = text.find(keyword, fields);
    if (hit) {
      matched.push(keyword.label);
      reasons.push({
        type: 'KEYWORD_MATCH',
        group,
        outcome: 'pass',
        keyword: keyword.label,
        field: hit.field,
        matchedText: hit.matchedText,
        message: `Keyword matched: ${keyword.label} (${hit.field})`,
      });
    } else {
      missing.push(keyword.label);
    }
  }
  const passed = mode === 'ANY' ? matched.length > 0 : missing.length === 0;
  if (!passed) {
    reasons.push({
      type: 'KEYWORD_MISMATCH',
      group,
      outcome: 'fail',
      keywords: missing,
      message: mode === 'ANY' ? 'No keyword matched' : `Keywords not found: ${missing.join(', ')}`,
    });
  }
  return { group, passed, reasons, matched };
}

function negativeGroup(text: LeadText, f: CompiledFilter): GroupResult & { detected: string[] } {
  const group = 'negativeKeywords';
  const { fields } = f.config.negativeKeywords;
  if (f.negatives.length === 0 || fields.length === 0) {
    return { ...skipped(group, 'Excluded keywords'), detected: [] };
  }
  const reasons: FilterReason[] = [];
  const detected: string[] = [];
  for (const keyword of f.negatives) {
    const hit = text.find(keyword, fields);
    if (!hit) continue;
    detected.push(keyword.label);
    reasons.push({
      type: 'NEGATIVE_KEYWORD',
      group,
      outcome: 'fail',
      keyword: keyword.label,
      field: hit.field,
      matchedText: hit.matchedText,
      message: `Excluded keyword detected: ${keyword.label} (${hit.field})`,
    });
  }
  if (detected.length === 0) {
    reasons.push({
      type: 'NEGATIVE_CLEAR',
      group,
      outcome: 'pass',
      message: 'No excluded keywords',
    });
  }
  return { group, passed: detected.length === 0, reasons, detected };
}

function quantityGroup(lead: NormalizedLead, f: CompiledFilter): GroupResult {
  const group = 'quantity';
  const { min, max } = f.config.quantity;
  const value = lead.quantity.value;
  if (value === null) {
    return {
      group,
      passed: false,
      reasons: [
        {
          type: 'QUANTITY_MISSING',
          group,
          outcome: 'fail',
          raw: lead.quantity.raw,
          message:
            lead.quantity.raw === null
              ? 'Quantity unavailable'
              : `Quantity not a single number: ${lead.quantity.raw}`,
        },
      ],
    };
  }
  const shown = lead.quantity.unit ? `${value} ${lead.quantity.unit}` : String(value);
  if (min !== null && value < min) {
    return {
      group,
      passed: false,
      reasons: [
        {
          type: 'QUANTITY_TOO_LOW',
          group,
          outcome: 'fail',
          value,
          expected: min,
          message: `Quantity ${value} < minimum ${min}`,
        },
      ],
    };
  }
  if (max !== null && value > max) {
    return {
      group,
      passed: false,
      reasons: [
        {
          type: 'QUANTITY_TOO_HIGH',
          group,
          outcome: 'fail',
          value,
          expected: max,
          message: `Quantity ${value} > maximum ${max}`,
        },
      ],
    };
  }
  const bounds = [min !== null && `≥ ${min}`, max !== null && `≤ ${max}`].filter(Boolean);
  return {
    group,
    passed: true,
    reasons: [
      {
        type: 'QUANTITY_PASS',
        group,
        outcome: 'pass',
        value,
        message: bounds.length > 0 ? `Quantity ${shown} ${bounds.join(', ')}` : `Quantity ${shown}`,
      },
    ],
  };
}

function contactGroup(lead: NormalizedLead, f: CompiledFilter): GroupResult {
  const group = 'contact';
  if (f.contactChannels.length === 0) return skipped(group, 'Contact');
  const available: Record<ContactChannel, boolean> = {
    mobile: lead.contact.mobileAvailable,
    whatsapp: lead.contact.whatsappAvailable,
    email: lead.contact.emailAvailable,
  };
  const have = f.contactChannels.filter((c) => available[c]);
  const lacking = f.contactChannels.filter((c) => !available[c]);
  const labels = (cs: readonly ContactChannel[]) => cs.map((c) => CHANNEL_LABEL[c]).join(', ');
  const passed = f.config.contact.mode === 'ANY' ? have.length > 0 : lacking.length === 0;
  if (passed) {
    return {
      group,
      passed,
      reasons: [
        {
          type: 'CONTACT_PASS',
          group,
          outcome: 'pass',
          channels: have,
          message: `Contact: ${labels(have)} available`,
        },
      ],
    };
  }
  return {
    group,
    passed,
    reasons: [
      {
        type: 'CONTACT_MISSING',
        group,
        outcome: 'fail',
        channels: lacking,
        message:
          f.config.contact.mode === 'ANY'
            ? `Contact requirement failed: none of ${labels(lacking)} available`
            : `Contact requirement failed: ${labels(lacking)} unavailable`,
      },
    ],
  };
}

function leadAgeGroup(lead: NormalizedLead, f: CompiledFilter): GroupResult {
  const group = 'leadAge';
  const { minMinutes, maxMinutes } = f.config.leadAge;
  const minutes = lead.leadAge.minutes;
  if (minutes === null) {
    return {
      group,
      passed: false,
      reasons: [
        {
          type: 'LEAD_AGE_MISSING',
          group,
          outcome: 'fail',
          raw: lead.leadAge.raw,
          message:
            lead.leadAge.raw === null
              ? 'Lead age unavailable'
              : `Lead age not convertible: ${lead.leadAge.raw}`,
        },
      ],
    };
  }
  const reasons: FilterReason[] = [];
  if (lead.leadAge.approximate) {
    reasons.push({
      type: 'LEAD_AGE_APPROXIMATE',
      group,
      outcome: 'info',
      message: `Lead age is approximate: ${lead.leadAge.raw ?? ''}`.trim(),
    });
  }
  if (maxMinutes !== null && minutes > maxMinutes) {
    reasons.push({
      type: 'LEAD_AGE_TOO_OLD',
      group,
      outcome: 'fail',
      value: minutes,
      expected: maxMinutes,
      message: `Lead age ${minutes} min > maximum ${maxMinutes} min`,
    });
    return { group, passed: false, reasons };
  }
  if (minMinutes !== null && minutes < minMinutes) {
    reasons.push({
      type: 'LEAD_AGE_TOO_NEW',
      group,
      outcome: 'fail',
      value: minutes,
      expected: minMinutes,
      message: `Lead age ${minutes} min < minimum ${minMinutes} min`,
    });
    return { group, passed: false, reasons };
  }
  reasons.push({
    type: 'LEAD_AGE_PASS',
    group,
    outcome: 'pass',
    value: minutes,
    message: `Lead age ${minutes} min`,
  });
  return { group, passed: true, reasons };
}

/* ------------------------------------------------------------------ */
/* Evaluation                                                           */
/* ------------------------------------------------------------------ */

export interface EvaluateOptions {
  /** Metadata only. */
  readonly evaluatedAt: number;
}

export function evaluateLead(
  lead: NormalizedLead,
  filter: CompiledFilter,
  options: EvaluateOptions,
): FilterEvaluation {
  const { config } = filter;
  const base = {
    logic: config.logic.mode,
    configVersion: config.version,
    evaluatedAt: options.evaluatedAt,
  };

  if (!config.enabled) {
    return {
      ...base,
      status: 'MATCHED',
      passed: true,
      reasons: [
        {
          type: 'FILTER_DISABLED',
          group: 'filters',
          outcome: 'info',
          message: 'Filters are off: every lead matches',
        },
      ],
      matchedKeywords: [],
      matchedCountries: [],
      negativeKeywords: [],
      failedConditions: [],
    };
  }

  const text = new LeadText(lead);
  const positives: GroupResult[] = [];
  if (config.countries.enabled) positives.push(countryGroup(lead, filter));
  const keywords = config.keywords.enabled ? keywordGroup(text, filter) : null;
  if (keywords) positives.push(keywords);
  if (config.quantity.enabled) positives.push(quantityGroup(lead, filter));
  if (config.contact.enabled) positives.push(contactGroup(lead, filter));
  if (config.leadAge.enabled) positives.push(leadAgeGroup(lead, filter));
  const negative = config.negativeKeywords.enabled ? negativeGroup(text, filter) : null;

  const applied = positives.filter((g) => g.passed !== null);
  const positivePass =
    applied.length === 0
      ? true
      : config.logic.mode === 'AND'
        ? applied.every((g) => g.passed === true)
        : applied.some((g) => g.passed === true);
  const excluded = negative?.passed === false;
  const passed = positivePass && !excluded;

  const failedConditions: FilterGroup[] = [
    ...applied.filter((g) => g.passed === false).map((g) => g.group),
    ...(excluded ? (['negativeKeywords'] as const) : []),
  ];
  const countryReason = positives.flatMap((g) => g.reasons).find((r) => r.type === 'COUNTRY_MATCH');

  return {
    ...base,
    status: passed ? 'MATCHED' : 'REJECTED',
    passed,
    reasons: [...positives.flatMap((g) => g.reasons), ...(negative?.reasons ?? [])],
    matchedKeywords: keywords?.matched ?? [],
    matchedCountries: countryReason?.type === 'COUNTRY_MATCH' ? [countryReason.value] : [],
    negativeKeywords: negative?.detected ?? [],
    failedConditions,
  };
}
