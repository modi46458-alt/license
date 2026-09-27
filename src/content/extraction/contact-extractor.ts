import type { LeadContact } from '@/core/types/lead';
import { CONTACT_AVAILABILITY } from '../selectors/indiamart-selectors';
import { cleanText } from '../selectors/selector-resolver';

export interface ContactExtraction {
  readonly contact: LeadContact;
  /** Where the availability markers were read from. */
  readonly source: 'marker' | 'text' | 'none';
}

function markerTexts(card: Element): { texts: string[]; source: ContactExtraction['source'] } {
  const markers = Array.from(card.querySelectorAll(CONTACT_AVAILABILITY.markerSelector));
  if (markers.length > 0)
    return { texts: markers.map((m) => cleanText(m.textContent)), source: 'marker' };

  // Fallback: short leaf elements whose text reads like an availability marker.
  const patterns = [
    CONTACT_AVAILABILITY.mobile,
    CONTACT_AVAILABILITY.whatsapp,
    CONTACT_AVAILABILITY.email,
  ];
  const texts = Array.from(card.querySelectorAll(CONTACT_AVAILABILITY.fallbackScope))
    .filter((el) => el.childElementCount === 0)
    .map((el) => cleanText(el.textContent))
    .filter((text) => text.length <= 40 && patterns.some((p) => p.test(text)));
  return { texts, source: texts.length > 0 ? 'text' : 'none' };
}

/**
 * Reads availability only. Values are always null: the markers state that a
 * channel exists, they never contain the number or address. No value is ever
 * inferred, reconstructed, or taken from anywhere else on the page.
 */
export function extractContact(card: Element): ContactExtraction {
  const { texts, source } = markerTexts(card);
  const has = (pattern: RegExp) => texts.some((t) => pattern.test(t));
  return {
    source,
    contact: {
      mobileAvailable: has(CONTACT_AVAILABILITY.mobile),
      mobileNumber: null,
      whatsappAvailable: has(CONTACT_AVAILABILITY.whatsapp),
      emailAvailable: has(CONTACT_AVAILABILITY.email),
      email: null,
    },
  };
}
