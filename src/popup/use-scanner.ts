import { useCallback, useEffect, useState } from 'react';
import type { AutomationSnapshot } from '@/core/actions';
import type { ScanLog, ScannerSnapshot } from '@/core/types/scanner';
import { SCANNER_PORT_NAME, isScannerPortMessage } from '@/shared/messages';
import { sendToTab } from '@/shared/messaging';

const MAX_LOGS = 200;

export interface ScannerView {
  snapshot: ScannerSnapshot | null;
  logs: readonly ScanLog[];
  busy: boolean;
  error: string | null;
  start: () => void;
  stop: () => void;
  automation: AutomationSnapshot | null;
  automationError: string | null;
  /** Emergency STOP. */
  stopAutomation: () => void;
}

/**
 * Live scanner view over a port to the tab's content script. The content
 * script pushes throttled updates only while this popup is open; nothing is
 * polled.
 */
export function useScanner(tabId: number | null): ScannerView {
  const [snapshot, setSnapshot] = useState<ScannerSnapshot | null>(null);
  const [logs, setLogs] = useState<readonly ScanLog[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [automation, setAutomation] = useState<AutomationSnapshot | null>(null);
  const [automationError, setAutomationError] = useState<string | null>(null);

  useEffect(() => {
    if (tabId === null) return;
    const port = chrome.tabs.connect(tabId, { name: SCANNER_PORT_NAME });
    port.onMessage.addListener((message: unknown) => {
      if (!isScannerPortMessage(message)) return;
      if (message.type === 'SCANNER_STATUS_RESPONSE') {
        setSnapshot(message.payload);
        return;
      }
      if (message.type === 'AUTOMATION_STATUS') {
        setAutomation(message.payload);
        return;
      }
      const { entries, reset } = message.payload;
      setLogs((prev) => (reset ? entries : [...prev, ...entries]).slice(-MAX_LOGS));
    });
    port.onDisconnect.addListener(() => {
      // The tab closed, navigated, or has no page reader yet.
      if (chrome.runtime.lastError) setError('Lost connection to the page reader. Reload the tab.');
    });
    return () => port.disconnect();
  }, [tabId]);

  const send = useCallback(
    (type: 'SCANNER_START' | 'SCANNER_STOP') => {
      if (tabId === null) return;
      setBusy(true);
      setError(null);
      sendToTab(tabId, type)
        .then((response) => setSnapshot(response.snapshot))
        .catch(() => setError('The page reader did not respond. Reload the IndiaMART tab.'))
        .finally(() => setBusy(false));
    },
    [tabId],
  );

  const command = useCallback(
    (type: 'AUTOMATION_STOP') => {
      if (tabId === null) return;
      setAutomationError(null);
      sendToTab(tabId, type)
        .then((result) => {
          if (result.snapshot) setAutomation(result.snapshot);
          if (!result.ok) setAutomationError(result.error);
        })
        .catch(() => setAutomationError('The page did not respond. Reload the IndiaMART tab.'));
    },
    [tabId],
  );

  useEffect(() => {
    if (tabId === null) return;
    sendToTab(tabId, 'AUTOMATION_STATUS_REQUEST')
      .then((result) => {
        if (result.snapshot) setAutomation(result.snapshot);
      })
      .catch(() => undefined);
  }, [tabId]);

  return {
    automation,
    automationError,
    stopAutomation: () => command('AUTOMATION_STOP'),
    snapshot,
    logs,
    busy,
    error,
    start: () => send('SCANNER_START'),
    stop: () => send('SCANNER_STOP'),
  };
}
