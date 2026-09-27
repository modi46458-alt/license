import { useCallback, useEffect, useState } from 'react';

/**
 * Developer diagnostics switch. Stored locally so it survives popup closes.
 * Moves into SettingsRepository when storage lands (Phase 9).
 */
export const DEVELOPER_MODE_KEY = 'settings.developerMode';

export function useDeveloperMode(): [boolean, (on: boolean) => void] {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    chrome.storage.local.get(DEVELOPER_MODE_KEY).then(
      (stored) => setEnabled(stored[DEVELOPER_MODE_KEY] === true),
      () => setEnabled(false),
    );
  }, []);

  const set = useCallback((on: boolean) => {
    setEnabled(on);
    chrome.storage.local.set({ [DEVELOPER_MODE_KEY]: on }).catch(() => setEnabled(!on));
  }, []);

  return [enabled, set];
}
