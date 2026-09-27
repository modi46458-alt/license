import { AUTOMATION_CONFIG_VERSION, type AutomationConfig } from './automation-types';

/** Delay choices offered in the popup (never 0). */
export const ACTION_DELAY_OPTIONS_MS = [500, 750, 1000, 1500, 2000] as const;

export const AUTOMATION_LIMITS = {
  /** Floor on the gap between clicks so two can never fire together. */
  minDelayMs: 500,
  maxDelayMs: 60_000,
  maxRetries: 5,
} as const;

/** Auto-Click is ON by default. */
export const DEFAULT_AUTOMATION_CONFIG: AutomationConfig = {
  version: AUTOMATION_CONFIG_VERSION,
  autoClickEnabled: true,
  delayBetweenActionsMs: 1000,
  maxRetries: 2,
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/**
 * Strict parse; null for anything invalid, including version-1 settings from
 * the earlier Start/confirmation workflow (callers then use the defaults).
 */
export function parseAutomationConfig(input: unknown): AutomationConfig | null {
  if (!isObj(input) || input.version !== AUTOMATION_CONFIG_VERSION) return null;
  const { autoClickEnabled, delayBetweenActionsMs, maxRetries } = input;
  if (typeof autoClickEnabled !== 'boolean') return null;
  if (!isInt(delayBetweenActionsMs, AUTOMATION_LIMITS.minDelayMs, AUTOMATION_LIMITS.maxDelayMs)) {
    return null;
  }
  if (!isInt(maxRetries, 0, AUTOMATION_LIMITS.maxRetries)) return null;
  return {
    version: AUTOMATION_CONFIG_VERSION,
    autoClickEnabled,
    delayBetweenActionsMs,
    maxRetries,
  };
}
