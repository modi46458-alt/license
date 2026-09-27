/**
 * MV3 service worker. Responsibilities: message routing, storage
 * coordination, statistics, notifications, lifecycle. Never touches the DOM.
 * Listeners are registered synchronously at top level so they survive
 * worker restarts.
 */
import { LICENSE_ALARM, LICENSE_ALARM_PERIOD_MINUTES, getLicenseManager } from './license-runtime';
import { recordInstall, routeMessage } from './message-router';

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    recordInstall().catch((error: unknown) =>
      console.error('[IMSLI] install record failed', error),
    );
  }
});

chrome.runtime.onMessage.addListener(routeMessage);

// License: validate at startup and every 5 minutes (alarms survive worker
// restarts); the push channel reports admin changes in real time.
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === LICENSE_ALARM) void getLicenseManager().validate('periodic');
});
void chrome.alarms.create(LICENSE_ALARM, { periodInMinutes: LICENSE_ALARM_PERIOD_MINUTES });
chrome.runtime.onStartup.addListener(() => void getLicenseManager().init());
void getLicenseManager().init();
