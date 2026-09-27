import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_SCORING_CONFIG,
  parseScoringConfig,
  totalWeight,
  type ScoringConfig,
} from '@/core/scoring';
import {
  loadScoringConfig,
  resetScoringConfig,
  saveScoringConfig,
} from '@/storage/scoring-config-repository';

export interface ScoringConfigView {
  saved: ScoringConfig | null;
  draft: ScoringConfig;
  setDraft: (next: ScoringConfig) => void;
  dirty: boolean;
  /** null when the draft is valid. */
  problem: string | null;
  busy: boolean;
  message: string | null;
  save: () => void;
  reset: () => void;
}

export function describeScoringProblem(config: ScoringConfig): string | null {
  const { critical, high, medium } = config.thresholds;
  if (!(critical > high && high > medium)) return 'Thresholds must be Critical > High > Medium.';
  if (medium < 1 || critical > 100) return 'Thresholds must be between 1 and 100.';
  if (totalWeight(config.weights) <= 0) return 'At least one weight must be above 0.';
  return parseScoringConfig(config) ? null : 'Some scoring values are not valid.';
}

/** Popup-side editing of the scoring config (draft until Save). */
export function useScoringConfig(): ScoringConfigView {
  const [saved, setSaved] = useState<ScoringConfig | null>(null);
  const [draft, setDraft] = useState<ScoringConfig>(DEFAULT_SCORING_CONFIG);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void loadScoringConfig().then(({ config }) => {
      setSaved(config);
      setDraft(config);
    });
  }, []);

  const save = useCallback(() => {
    setBusy(true);
    setMessage(null);
    saveScoringConfig(draft)
      .then((stored) => {
        setSaved(stored);
        setDraft(stored);
        setMessage('Scoring saved. Matched leads are re-scored.');
      })
      .catch(() => setMessage('Could not save scoring settings. Try again.'))
      .finally(() => setBusy(false));
  }, [draft]);

  const reset = useCallback(() => {
    setBusy(true);
    setMessage(null);
    resetScoringConfig()
      .then(() => {
        setSaved(DEFAULT_SCORING_CONFIG);
        setDraft(DEFAULT_SCORING_CONFIG);
        setMessage('Default scoring restored.');
      })
      .catch(() => setMessage('Could not reset scoring settings. Try again.'))
      .finally(() => setBusy(false));
  }, []);

  return {
    saved,
    draft,
    setDraft: (next) => {
      setDraft(next);
      setMessage(null);
    },
    dirty: saved !== null && JSON.stringify(saved) !== JSON.stringify(draft),
    problem: describeScoringProblem(draft),
    busy,
    message,
    save,
    reset,
  };
}
