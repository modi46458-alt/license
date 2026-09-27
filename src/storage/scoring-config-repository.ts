import { DEFAULT_SCORING_CONFIG, parseScoringConfig } from '@/core/scoring/scoring-config';
import type { ScoringConfig } from '@/core/scoring/scoring-types';
import { createConfigRepository, type KeyValueArea, type LoadedConfig } from './config-repository';

/** Scoring configuration persistence (chrome.storage.sync, key "scoring.config"). */

export type LoadedScoringConfig = LoadedConfig<ScoringConfig>;

export const SCORING_CONFIG_KEY = 'scoring.config';

const repository = createConfigRepository<ScoringConfig>({
  key: SCORING_CONFIG_KEY,
  label: 'Scoring',
  parse: parseScoringConfig,
  defaults: DEFAULT_SCORING_CONFIG,
});

export const loadScoringConfig = (area?: KeyValueArea) => repository.load(area);
export const saveScoringConfig = (config: ScoringConfig, area?: KeyValueArea) =>
  repository.save(config, area);
export const resetScoringConfig = (area?: KeyValueArea) => repository.reset(area);
export const watchScoringConfig = (onChange: (loaded: LoadedScoringConfig) => void) =>
  repository.watch(onChange);
