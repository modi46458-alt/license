import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_FILTER_CONFIG, parseFilterConfig, type FilterConfig } from '@/core/filters';
import {
  loadFilterConfig,
  resetFilterConfig,
  saveFilterConfig,
} from '@/storage/filter-config-repository';

export interface FilterConfigView {
  /** Loaded from storage; null while loading. */
  saved: FilterConfig | null;
  draft: FilterConfig;
  setDraft: (next: FilterConfig) => void;
  dirty: boolean;
  /** null when the draft is valid. */
  problem: string | null;
  busy: boolean;
  message: string | null;
  apply: () => void;
  reset: () => void;
}

function describeProblem(config: FilterConfig): string | null {
  const { quantity: q, leadAge: a } = config;
  if (q.min !== null && q.max !== null && q.min > q.max)
    return 'Quantity minimum is above the maximum.';
  if (a.minMinutes !== null && a.maxMinutes !== null && a.minMinutes > a.maxMinutes) {
    return 'Lead age minimum is above the maximum.';
  }
  return parseFilterConfig(config) ? null : 'Some filter values are not valid.';
}

/**
 * Popup-side editing of the filter config. Edits stay in a draft until
 * Apply; saving goes through the repository, and the content script picks
 * the change up from storage and re-evaluates its leads.
 */
export function useFilterConfig(): FilterConfigView {
  const [saved, setSaved] = useState<FilterConfig | null>(null);
  const [draft, setDraft] = useState<FilterConfig>(DEFAULT_FILTER_CONFIG);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void loadFilterConfig().then(({ config, fromDefaults }) => {
      setSaved(config);
      setDraft(config);
      if (fromDefaults) setMessage('Using the default filters.');
    });
  }, []);

  const apply = useCallback(() => {
    setBusy(true);
    setMessage(null);
    saveFilterConfig(draft)
      .then((stored) => {
        setSaved(stored);
        setDraft(stored);
        setMessage('Filters applied. Leads on the page are re-checked.');
      })
      .catch(() => setMessage('Could not save the filters. Try again.'))
      .finally(() => setBusy(false));
  }, [draft]);

  const reset = useCallback(() => {
    setBusy(true);
    setMessage(null);
    resetFilterConfig()
      .then(() => {
        setSaved(DEFAULT_FILTER_CONFIG);
        setDraft(DEFAULT_FILTER_CONFIG);
        setMessage('Default filters restored.');
      })
      .catch(() => setMessage('Could not reset the filters. Try again.'))
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
    problem: describeProblem(draft),
    busy,
    message,
    apply,
    reset,
  };
}
