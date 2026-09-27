import { useCallback, useEffect, useState } from 'react';
import { ApiError } from './api';

/** Load data with loading/error state; `reload` re-runs it. */
export function useLoad<T>(load: () => Promise<T>, deps: readonly unknown[]) {
  const [tick, setTick] = useState(0);
  const key = JSON.stringify([...deps, tick]);
  const [state, setState] = useState<{ key: string | null; data: T | null; error: string | null }>({
    key: null,
    data: null,
    error: null,
  });
  useEffect(() => {
    let live = true;
    load().then(
      (data) => {
        if (live) setState({ key, data, error: null });
      },
      (e: unknown) => {
        if (live) {
          const error = e instanceof ApiError ? e.message : 'Could not load data.';
          setState((s) => ({ key, data: s.data, error }));
        }
      },
    );
    return () => {
      live = false;
    };
    // `key` captures deps and reload ticks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data: state.data, error: state.error, loading: state.key !== key, reload };
}

/** Debounced value (search boxes: no request per keystroke). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}
