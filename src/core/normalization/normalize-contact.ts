import type { LeadContact } from '../types/lead';
import type { NormalizedContact } from './normalization-types';

/**
 * Availability only. Numbers and addresses are deliberately not part of the
 * normalized model; they stay on the extracted Lead (null unless IndiaMART
 * actually renders them) and are never generated here.
 */
export function normalizeContact(contact: LeadContact): NormalizedContact {
  return {
    mobileAvailable: contact.mobileAvailable === true,
    whatsappAvailable: contact.whatsappAvailable === true,
    emailAvailable: contact.emailAvailable === true,
  };
}
