import type { ActionErrorCode, AutomationConfig, LeadFacts } from './automation-types';

export type Eligibility =
  | { readonly eligible: true }
  | { readonly eligible: false; readonly code: ActionErrorCode; readonly reason: string };

const no = (code: ActionErrorCode, reason: string): Eligibility => ({
  eligible: false,
  code,
  reason,
});

/**
 * The page-independent pre-click checks. The only lead condition is the
 * filter verdict: MATCHED. Score, priority and earlier contacts are
 * deliberately ignored (each MATCHED event is its own action).
 *
 *   Auto-Click ON · lead still known · lead still MATCHED
 *
 * The button checks (belongs to this lead, exists, visible, enabled) are done
 * by the Contact Buyer resolver at click time; the license by the gate.
 */
export function checkEligibility(facts: LeadFacts | null, config: AutomationConfig): Eligibility {
  if (!config.autoClickEnabled) return no('AUTOMATION_DISABLED', 'Auto-Click is off');
  if (facts === null) return no('STALE_LEAD', 'lead is no longer on the page');
  if (facts.status !== 'MATCHED')
    return no('NOT_MATCHED', 'lead is no longer matched by the filters');
  return { eligible: true };
}
