import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_AUTOMATION_CONFIG, type AutomationConfig } from '@/core/actions';
import {
  loadAutomationConfig,
  saveAutomationConfig,
  watchAutomationConfig,
} from '@/storage/automation-config-repository';

export interface AutomationConfigView {
  saved: AutomationConfig | null;
  busy: boolean;
  message: string | null;
  /** The ON/OFF toggle: saved at once; the page picks it up immediately. */
  setEnabled: (on: boolean) => void;
  /** Delay between clicks (one of ACTION_DELAY_OPTIONS_MS). */
  setDelay: (ms: number) => void;
}

export function useAutomationConfig(): AutomationConfigView {
  const [saved, setSaved] = useState<AutomationConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void loadAutomationConfig().then(({ config }) => setSaved(config));
    // STOP pressed on the page also switches the setting OFF: follow it.
    return watchAutomationConfig(({ config }) => setSaved(config));
  }, []);

  const setEnabled = useCallback(
    (on: boolean) => {
      setBusy(true);
      setMessage(null);
      saveAutomationConfig({ ...(saved ?? DEFAULT_AUTOMATION_CONFIG), autoClickEnabled: on })
        .then(setSaved)
        .catch(() => setMessage('Could not change Auto-Click. Try again.'))
        .finally(() => setBusy(false));
    },
    [saved],
  );

  const setDelay = useCallback(
    (ms: number) => {
      setBusy(true);
      setMessage(null);
      saveAutomationConfig({ ...(saved ?? DEFAULT_AUTOMATION_CONFIG), delayBetweenActionsMs: ms })
        .then(setSaved)
        .catch(() => setMessage('Could not change the delay. Try again.'))
        .finally(() => setBusy(false));
    },
    [saved],
  );

  return { saved, busy, message, setEnabled, setDelay };
}
