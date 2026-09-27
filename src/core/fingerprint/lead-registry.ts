import { normalizeText } from '../parsing/text';
import type { ExtractedLead } from '../types/lead';
import { leadIdentityKey, leadIdFromFingerprint } from './lead-fingerprint';

/**
 * Keeps one stable lead id per logical lead, however often IndiaMART
 * re-renders or progressively fills the card.
 *
 *   same fingerprint                       → same lead
 *   same card element, same title          → same lead (card finished rendering)
 *   new element, same title + country, and
 *     no conflicting quantity/product/buys → same lead (re-render with more fields)
 *   anything else                          → new lead
 *
 * "Same lead" is reported as `updated` when the card revealed information not
 * seen before (a field appeared or a detail changed), otherwise `duplicate`.
 * Lead age, card confidence and DOM position never affect identity.
 */

export type Resolution =
  | { readonly kind: 'new'; readonly leadId: string }
  | { readonly kind: 'updated'; readonly leadId: string; readonly added: readonly string[] }
  | { readonly kind: 'duplicate'; readonly leadId: string };

type Info = Readonly<Record<string, string>>;

interface Entry {
  readonly leadId: string;
  readonly identity: string | null;
  info: Info;
  readonly fingerprints: Set<string>;
}

/** Differing values here mean two cards are different leads, not one lead re-rendered. */
const CONFLICT_KEYS = ['quantity', 'productCategory', 'buys'] as const;

/** Every informative value on a lead, normalised, non-empty values only. */
export function leadInfo(lead: ExtractedLead): Info {
  const info: Record<string, string> = {};
  const put = (key: string, value: string | null | undefined) => {
    const v = normalizeText(value ?? null);
    if (v) info[key] = v;
  };
  put('country', lead.country);
  put('quantity', lead.quantityRaw);
  put('category', lead.category);
  put('productCategory', lead.productCategory);
  put('buys', lead.buys.length > 0 ? lead.buys.join('|') : null);
  put('strength', lead.strengthRaw);
  put('dosageForm', lead.dosageForm);
  put('quantityPerStrip', lead.quantityPerStripRaw);
  if (lead.contact.mobileAvailable) info.mobile = 'yes';
  if (lead.contact.whatsappAvailable) info.whatsapp = 'yes';
  if (lead.contact.emailAvailable) info.email = 'yes';
  if (lead.engagement.verified) {
    put('requirements', lead.engagement.requirements?.toString());
    put('calls', lead.engagement.calls?.toString());
    put('replies', lead.engagement.replies?.toString());
  }
  return info;
}

/** Title plus country: what two renderings of one lead always share. */
export function crossCardIdentity(lead: ExtractedLead): string | null {
  const title = leadIdentityKey(lead);
  return title === null ? null : `${title}\u241f${normalizeText(lead.country) ?? ''}`;
}

function diff(known: Info, next: Info): { added: string[]; changed: string[] } {
  const added: string[] = [];
  const changed: string[] = [];
  for (const [key, value] of Object.entries(next)) {
    if (!(key in known)) added.push(key);
    else if (known[key] !== value) changed.push(key);
  }
  return { added, changed };
}

export class LeadRegistry {
  /** Map order = recency (LRU). */
  private readonly byId = new Map<string, Entry>();
  private readonly byFingerprint = new Map<string, string>();
  private readonly byIdentity = new Map<string, Set<string>>();

  constructor(private readonly maxLeads = 5000) {}

  get size(): number {
    return this.byId.size;
  }

  /**
   * @param cardLeadId lead id previously resolved for the SAME card element,
   *   passed only when that element still shows the same title.
   */
  resolve(lead: ExtractedLead, fingerprint: string, cardLeadId: string | null = null): Resolution {
    const next = leadInfo(lead);

    const byCard = cardLeadId === null ? undefined : this.byId.get(cardLeadId);
    if (byCard) return this.merge(byCard, fingerprint, next, true);

    const knownId = this.byFingerprint.get(fingerprint);
    const byFp = knownId === undefined ? undefined : this.byId.get(knownId);
    if (byFp) return this.merge(byFp, fingerprint, next, true);

    const identity = crossCardIdentity(lead);
    if (identity !== null) {
      for (const id of this.byIdentity.get(identity) ?? []) {
        const entry = this.byId.get(id);
        if (!entry) continue;
        const { changed } = diff(entry.info, next);
        if (CONFLICT_KEYS.some((k) => changed.includes(k))) continue;
        return this.merge(entry, fingerprint, next, false);
      }
    }

    const leadId = leadIdFromFingerprint(fingerprint);
    this.insert({ leadId, identity, info: next, fingerprints: new Set([fingerprint]) });
    return { kind: 'new', leadId };
  }

  /**
   * @param authoritative true when `next` is the same rendering of the lead
   *   (same card or same fingerprint): changed values replace old ones.
   *   false for a different element: only fills gaps, so an older partial
   *   render can never overwrite richer data.
   */
  private merge(entry: Entry, fingerprint: string, next: Info, authoritative: boolean): Resolution {
    const { added, changed } = diff(entry.info, next);
    const revealed = authoritative ? [...added, ...changed] : added;
    entry.info = authoritative ? { ...entry.info, ...next } : { ...next, ...entry.info };
    entry.fingerprints.add(fingerprint);
    this.byFingerprint.set(fingerprint, entry.leadId);
    this.touch(entry);
    return revealed.length > 0
      ? { kind: 'updated', leadId: entry.leadId, added: revealed }
      : { kind: 'duplicate', leadId: entry.leadId };
  }

  private insert(entry: Entry): void {
    this.byId.set(entry.leadId, entry);
    for (const fp of entry.fingerprints) this.byFingerprint.set(fp, entry.leadId);
    if (entry.identity !== null) {
      const ids = this.byIdentity.get(entry.identity) ?? new Set<string>();
      ids.add(entry.leadId);
      this.byIdentity.set(entry.identity, ids);
    }
    while (this.byId.size > this.maxLeads) {
      const oldest = this.byId.keys().next().value;
      if (oldest === undefined) break;
      this.evict(oldest);
    }
  }

  private touch(entry: Entry): void {
    this.byId.delete(entry.leadId);
    this.byId.set(entry.leadId, entry);
  }

  private evict(leadId: string): void {
    const entry = this.byId.get(leadId);
    if (!entry) return;
    this.byId.delete(leadId);
    for (const fp of entry.fingerprints) this.byFingerprint.delete(fp);
    if (entry.identity !== null) {
      const ids = this.byIdentity.get(entry.identity);
      ids?.delete(leadId);
      if (ids?.size === 0) this.byIdentity.delete(entry.identity);
    }
  }
}
