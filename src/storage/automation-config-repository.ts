import { DEFAULT_AUTOMATION_CONFIG, parseAutomationConfig } from '@/core/actions/automation-config';
import type { AutomationConfig } from '@/core/actions/automation-types';
import { createConfigRepository, type KeyValueArea, type LoadedConfig } from './config-repository';

/**
 * Auto-Click settings (chrome.storage.sync, key "automation.config").
 * Anything invalid falls back to the safe defaults (Auto-Click OFF).
 * Saving settings never starts automation; only the explicit Start does.
 */

export type LoadedAutomationConfig = LoadedConfig<AutomationConfig>;

export const AUTOMATION_CONFIG_KEY = 'automation.config';

const repository = createConfigRepository<AutomationConfig>({
  key: AUTOMATION_CONFIG_KEY,
  label: 'Automation',
  parse: parseAutomationConfig,
  defaults: DEFAULT_AUTOMATION_CONFIG,
});

export const loadAutomationConfig = (area?: KeyValueArea) => repository.load(area);
export const saveAutomationConfig = (config: AutomationConfig, area?: KeyValueArea) =>
  repository.save(config, area);
export const resetAutomationConfig = (area?: KeyValueArea) => repository.reset(area);
export const watchAutomationConfig = (onChange: (loaded: LoadedAutomationConfig) => void) =>
  repository.watch(onChange);
