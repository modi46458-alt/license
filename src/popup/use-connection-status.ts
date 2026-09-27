import { useEffect, useState } from 'react';
import { INDIAMART_PAGE } from '@/content/selectors/indiamart-selectors';
import type { ContentStatus, WorkerStatus } from '@/shared/messages';
import { sendToTab, sendToWorker } from '@/shared/messaging';

export type CheckState = 'checking' | 'ok' | 'waiting' | 'failed';

export interface ConnectionStatus {
  page: CheckState;
  host: string | null;
  tabId: number | null;
  content: CheckState;
  leadList: CheckState;
  worker: CheckState;
  contentStatus: ContentStatus | null;
  workerStatus: WorkerStatus | null;
}

const INITIAL: ConnectionStatus = {
  page: 'checking',
  host: null,
  tabId: null,
  content: 'checking',
  leadList: 'checking',
  worker: 'checking',
  contentStatus: null,
  workerStatus: null,
};

/**
 * Checks the chain popup → service worker and popup → page → content script.
 * Tab URLs are only visible for hosts we have permission for, so a missing
 * URL simply means "not an IndiaMART seller page".
 */
export function useConnectionStatus(): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>(INITIAL);

  useEffect(() => {
    let cancelled = false;
    const update = (patch: Partial<ConnectionStatus>) => {
      if (!cancelled) setStatus((prev) => ({ ...prev, ...patch }));
    };

    sendToWorker('WORKER_STATUS').then(
      (workerStatus) => update({ worker: workerStatus ? 'ok' : 'failed', workerStatus }),
      () => update({ worker: 'failed' }),
    );

    void (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const url = tab?.url ?? '';
      if (tab?.id === undefined || !INDIAMART_PAGE.hostPattern.test(url)) {
        update({ page: 'waiting', content: 'waiting', leadList: 'waiting' });
        return;
      }
      update({ page: 'ok', host: new URL(url).host, tabId: tab.id });
      try {
        const contentStatus = await sendToTab(tab.id, 'CONTENT_PING');
        update({
          content: 'ok',
          contentStatus,
          leadList: contentStatus.leadListDetected ? 'ok' : 'waiting',
        });
      } catch {
        update({ content: 'failed', leadList: 'waiting' });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return status;
}
