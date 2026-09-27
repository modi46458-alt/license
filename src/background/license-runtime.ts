import { LicenseClient, loadLicenseRecord, saveLicenseRecord } from '@/core/license';
import { LicenseManager, type SocketLike } from './license-manager';

/**
 * Production wiring of the license manager in the service worker: the
 * license server URL comes from the build (VITE_LICENSE_API_URL), storage is
 * chrome.storage.local, push is a WebSocket, periodic validation is an alarm.
 */

export const LICENSE_API_URL: string = (
  import.meta.env.VITE_LICENSE_API_URL ?? 'http://localhost:8787'
).replace(/\/+$/, '');

export const LICENSE_ALARM = 'license-validate';
export const LICENSE_ALARM_PERIOD_MINUTES = 5;

function pushUrl(base: string): string {
  return `${base.replace(/^http/, 'ws')}/api/license/events`;
}

let manager: LicenseManager | null = null;

export function getLicenseManager(): LicenseManager {
  manager ??= new LicenseManager({
    api: new LicenseClient({ baseUrl: LICENSE_API_URL }),
    store: {
      load: () => loadLicenseRecord(chrome.storage.local, () => crypto.randomUUID()),
      save: (record) => saveLicenseRecord(chrome.storage.local, record),
    },
    version: chrome.runtime.getManifest().version,
    pushUrl: pushUrl(LICENSE_API_URL),
    createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
  });
  return manager;
}
