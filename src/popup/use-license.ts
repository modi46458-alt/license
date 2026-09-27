import { useCallback, useEffect, useState } from 'react';
import {
  INITIAL_LICENSE_STATE,
  LICENSE_RECORD_KEY,
  licenseStateFromStorage,
  type LicenseState,
} from '@/core/license';
import type { LicenseCommandResult } from '@/shared/messages';
import { sendToWorker, sendToWorkerWith } from '@/shared/messaging';

export interface LicenseView {
  state: LicenseState;
  busy: boolean;
  error: string | null;
  activate: (code: string) => void;
  deactivate: () => void;
  refresh: () => void;
}

/** Popup side of the license: reads the state, asks the worker to validate on open. */
export function useLicense(): LicenseView {
  const [state, setState] = useState<LicenseState>(INITIAL_LICENSE_STATE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback((result: LicenseCommandResult | null | undefined) => {
    if (!result) return;
    setState(result.state);
    setError(result.ok ? null : result.error);
  }, []);

  useEffect(() => {
    sendToWorker('LICENSE_STATUS_REQUEST').then(apply, () => undefined);
    // Popup opening is a validation point.
    sendToWorkerWith('LICENSE_VALIDATE', { reason: 'popup' }).then(apply, () => undefined);
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && LICENSE_RECORD_KEY in changes) {
        setState(licenseStateFromStorage(changes[LICENSE_RECORD_KEY]?.newValue));
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [apply]);

  const run = useCallback(
    (request: Promise<LicenseCommandResult>) => {
      setBusy(true);
      setError(null);
      request
        .then(apply, () => setError('The extension did not respond. Try again.'))
        .finally(() => setBusy(false));
    },
    [apply],
  );

  return {
    state,
    busy,
    error,
    activate: (code) => run(sendToWorkerWith('LICENSE_ACTIVATE', { code })),
    deactivate: () => run(sendToWorker('LICENSE_DEACTIVATE')),
    refresh: () => run(sendToWorkerWith('LICENSE_VALIDATE', { reason: 'popup-refresh' })),
  };
}
