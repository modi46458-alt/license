import type { LeadEngagement } from '@/core/types/lead';
import { ENGAGEMENT, type EngagementConfig } from '../selectors/indiamart-selectors';
import { cleanText } from '../selectors/selector-resolver';

export interface EngagementExtraction {
  readonly engagement: LeadEngagement;
  /** found: read from verified markup. missing: not configured / not in card. failed: config broken. */
  readonly state: 'found' | 'missing' | 'failed';
  readonly message: string | null;
}

/** Note (not a failure) on every lead until the engagement markup is verified. */
export const ENGAGEMENT_UNVERIFIED_NOTE = 'engagement: markup not verified, values not read';
/** @deprecated Phase 2 name; engagement is now reported as a note. */
export const ENGAGEMENT_UNVERIFIED_WARNING = ENGAGEMENT_UNVERIFIED_NOTE;

const UNVERIFIED: LeadEngagement = {
  requirements: null,
  calls: null,
  replies: null,
  verified: false,
  raw: null,
};

function count(pattern: RegExp, text: string): number | null {
  const digits = pattern.exec(text)?.[1];
  if (digits === undefined) return null;
  const value = Number(digits.replace(/,/g, ''));
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Engagement counts are read only from a verified container. Until the
 * markup is inspected (containerSelector null) this returns nulls with
 * verified=false and a warning: free-text matching across the whole card
 * could pick up numbers from unrelated elements, so it is not used.
 */
export function extractEngagement(
  card: Element,
  config: EngagementConfig = ENGAGEMENT,
): EngagementExtraction {
  if (config.containerSelector === null) {
    return { engagement: UNVERIFIED, state: 'missing', message: ENGAGEMENT_UNVERIFIED_NOTE };
  }
  let container: Element | null;
  try {
    container = card.querySelector(config.containerSelector);
  } catch {
    return { engagement: UNVERIFIED, state: 'failed', message: 'configured selector is invalid' };
  }
  if (!container) {
    return {
      engagement: UNVERIFIED,
      state: 'missing',
      message: 'engagement: container not found in card',
    };
  }
  const raw = cleanText(container.textContent);
  return {
    state: 'found',
    message: null,
    engagement: {
      requirements: count(config.requirements, raw),
      calls: count(config.calls, raw),
      replies: count(config.replies, raw),
      verified: true,
      raw: raw || null,
    },
  };
}
