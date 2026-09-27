import { DEFAULT_FILTER_CONFIG, parseFilterConfig } from '@/core/filters/filter-config';
import type { FilterConfig } from '@/core/filters/filter-types';
import { createConfigRepository, type KeyValueArea, type LoadedConfig } from './config-repository';

/**
 * Filter configuration persistence (chrome.storage.sync, key "filters.config").
 * Stored data is validated on every read; anything invalid falls back to the
 * defaults instead of breaking the popup or the scanner.
 */

export type { KeyValueArea } from './config-repository';
export type LoadedFilterConfig = LoadedConfig<FilterConfig>;

export const FILTER_CONFIG_KEY = 'filters.config';

const repository = createConfigRepository<FilterConfig>({
  key: FILTER_CONFIG_KEY,
  label: 'Filter',
  parse: parseFilterConfig,
  defaults: DEFAULT_FILTER_CONFIG,
  // A build that kept filters in chrome.storage.local: recover them once.
  legacyArea: () => chrome.storage.local,
});

export const loadFilterConfig = (area?: KeyValueArea, legacy?: KeyValueArea | null) =>
  repository.load(area, legacy);
/** Validates before writing; an invalid config is never stored. */
export const saveFilterConfig = (config: FilterConfig, area?: KeyValueArea) =>
  repository.save(config, area);
/** Removes the stored config; readers then get the defaults. */
export const resetFilterConfig = (area?: KeyValueArea) => repository.reset(area);
/** Calls `onChange` with the new (validated or default) config whenever it changes. */
export const watchFilterConfig = (onChange: (loaded: LoadedFilterConfig) => void) =>
  repository.watch(onChange);
