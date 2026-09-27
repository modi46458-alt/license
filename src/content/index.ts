/**
 * Content script entry: page detection, the lead scanner, Auto-Click
 * (filter MATCHED → Contact Buyer, when ON), the bounded scan log, and the
 * popup bridge. Nothing leaves this tab: lead data is only sent to the
 * extension's own popup while it is open.
 */
import {
  SCANNER_PORT_NAME,
  isExtensionMessage,
  type AutomationCommandResult,
  type ContentStatus,
  type ScannerPortMessage,
  type ScannerStatusResponse,
} from '@/shared/messages';
import { loadFilterConfig, watchFilterConfig } from '@/storage/filter-config-repository';
import { loadScoringConfig, watchScoringConfig } from '@/storage/scoring-config-repository';
import {
  loadAutomationConfig,
  saveAutomationConfig,
  watchAutomationConfig,
} from '@/storage/automation-config-repository';
import { DEFAULT_AUTOMATION_CONFIG, type AutomationConfig } from '@/core/actions';
import {
  LICENSE_RECORD_KEY,
  LicenseGate,
  licenseStateFromStorage,
  setLicenseGate,
} from '@/core/license';
import { sendToWorkerWith } from '@/shared/messaging';
import { AutoClickEngine } from './automation/action-engine';
import { AutomationLock } from './automation/automation-lock';
import { StopOverlay } from './automation/stop-overlay';
import { hasLeadList } from './scanner/indiamart-page-detector';
import { LeadScanner } from './scanner/lead-scanner';
import { ScanLogBuffer } from './scanner/scan-log';
import { SELECTOR_MAP_VERSION } from './selectors/indiamart-selectors';

const DEBUG = import.meta.env.MODE === 'development';
const PUSH_INTERVAL_MS = 250;

/* ------------------------------ license ------------------------------- */

// The local gate: the service worker validates with the server and writes
// the result to storage; here it is only read. No request per lead.
const licenseGate = new LicenseGate();
setLicenseGate(licenseGate);

const scanner = new LeadScanner({ document, getUrl: () => location.href, license: licenseGate });
const log = new ScanLogBuffer();

const PRE_CLICK_LICENSE_MAX_AGE_MS = 60_000;

/** Validate now and apply the answer to the gate (used right before a click). */
async function validateNow(reason: string): Promise<void> {
  const result = await sendToWorkerWith('LICENSE_VALIDATE', { reason });
  if (result) licenseGate.update(result.state);
}

/** Ask the service worker to validate now (page activation, before automation). */
let lastValidationRequest = 0;
function requestValidation(reason: string): void {
  if (Date.now() - lastValidationRequest < 30_000) return;
  lastValidationRequest = Date.now();
  sendToWorkerWith('LICENSE_VALIDATE', { reason }).catch(() => undefined);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && LICENSE_RECORD_KEY in changes) {
    licenseGate.update(licenseStateFromStorage(changes[LICENSE_RECORD_KEY]?.newValue));
  }
});
// Grace and expiry can lapse with no new data: re-check every minute.
setInterval(() => licenseGate.recheck(), 60_000);

/* ---------------------------- auto-click ------------------------------ */

// Every genuine MATCHED evaluation (LEAD_MATCHED, one matchEventId) with
// Auto-Click ON → one Contact Buyer action. The engine starts OFF until the
// saved setting is loaded (default ON); its queue is never restored after a
// reload. There is no permanent "already contacted" suppression.
const lock = new AutomationLock(crypto.randomUUID(), Date.now);
const engine = new AutoClickEngine({
  leads: {
    getCard: (leadId) => scanner.getCardForLead(leadId),
    getFacts: (leadId) => scanner.getLeadFacts(leadId),
  },
  config: { ...DEFAULT_AUTOMATION_CONFIG, autoClickEnabled: false },
  license: {
    isLicenseActive: () => licenseGate.isLicenseActive(),
    // Before a Contact Buyer click the server answer must be under a minute
    // old; otherwise the click waits for a validation (never per scanned lead).
    needsValidation: () => licenseGate.needsValidation(PRE_CLICK_LICENSE_MAX_AGE_MS),
    validate: () => validateNow('contact-buyer'),
  },
});

// License changes apply at once: not ACTIVE → scanner locked (observer
// disconnected, queue cleared) and Auto-Click queue, timers and retries
// cancelled; ACTIVE again → both resume.
licenseGate.subscribe((active) => {
  engine.setLicensed(active);
  if (active) scanner.start();
  else scanner.lock();
  syncIndicators();
  schedulePush();
});
let automationConfig: AutomationConfig | null = null;
const overlay = new StopOverlay(document, () => void stopAutomation());
let lockTimer: ReturnType<typeof setInterval> | null = null;

/** One tab clicks at a time: hold the lock while ON, stand by if another tab has it. */
async function syncLock(): Promise<void> {
  if (!automationConfig?.autoClickEnabled) {
    if (lockTimer !== null) clearInterval(lockTimer);
    lockTimer = null;
    engine.setStandby(false);
    await lock.release();
    return;
  }
  const held = await lock.acquire(); // also refreshes our own heartbeat
  engine.setStandby(!held);
  lockTimer ??= setInterval(() => void syncLock(), 10_000);
}

function syncIndicators(): void {
  const snapshot = engine.snapshot();
  if (snapshot.state === 'ON') {
    overlay.show(`Auto-Click ON · ${snapshot.clicked} contacted`);
  } else {
    overlay.hide();
  }
}

async function applyAutomationConfig(config: AutomationConfig): Promise<void> {
  if (config.autoClickEnabled && !automationConfig?.autoClickEnabled) {
    requestValidation('automation'); // before automation starts
  }
  automationConfig = config;
  if (!config.autoClickEnabled) {
    engine.setConfig(config);
  } else {
    await syncLock(); // standby decided before switching on
    engine.setConfig(config);
  }
  await syncLock();
  syncIndicators();
  schedulePush();
}

/** STOP: cancel everything now and save OFF so it stays off after a reload. */
async function stopAutomation(): Promise<AutomationCommandResult> {
  engine.stop();
  const base = automationConfig ?? DEFAULT_AUTOMATION_CONFIG;
  automationConfig = { ...base, autoClickEnabled: false };
  syncIndicators();
  try {
    await saveAutomationConfig(automationConfig);
  } catch {
    /* the engine is already stopped; the toggle may show ON until retried */
  }
  await syncLock();
  schedulePush();
  return { ok: true, snapshot: engine.snapshot() };
}

engine.on((event) => {
  log.add(event);
  if (DEBUG) console.debug('[IMSLI]', event.type, event);
  syncIndicators();
  schedulePush();
});

// Lock released on the way out; the queue itself ends with the page.
addEventListener('pagehide', () => {
  engine.setStandby(true);
  void lock.release();
});

/* ---------------------------- popup bridge ---------------------------- */

const ports = new Set<chrome.runtime.Port>();
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let lastPushedLogId = 0;

function post(port: chrome.runtime.Port, message: ScannerPortMessage): void {
  try {
    port.postMessage(message);
  } catch {
    ports.delete(port);
  }
}

/** Throttled push of state and new log lines to open popups. */
function schedulePush(): void {
  if (ports.size === 0 || pushTimer !== null) return;
  pushTimer = setTimeout(() => {
    pushTimer = null;
    const entries = log.since(lastPushedLogId);
    lastPushedLogId = log.all().at(-1)?.id ?? lastPushedLogId;
    const automation = engine.snapshot();
    for (const port of ports) {
      post(port, { type: 'SCANNER_STATUS_RESPONSE', payload: scanner.getSnapshot() });
      post(port, { type: 'AUTOMATION_STATUS', payload: automation });
      if (entries.length > 0)
        post(port, { type: 'SCANNER_LOG', payload: { entries, reset: false } });
    }
  }, PUSH_INTERVAL_MS);
}

scanner.on((event) => {
  log.add(event);
  // New or changed verdicts may make leads eligible during a running session.
  // One action per genuine MATCHED evaluation (duplicate ids are ignored).
  if (event.type === 'LEAD_MATCHED') engine.onMatchEvent(event.event);
  if (DEBUG) console.debug('[IMSLI]', event.type, event);
  schedulePush();
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== SCANNER_PORT_NAME || port.sender?.id !== chrome.runtime.id) return;
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));
  lastPushedLogId = log.all().at(-1)?.id ?? 0;
  post(port, { type: 'SCANNER_STATUS_RESPONSE', payload: scanner.getSnapshot() });
  post(port, { type: 'AUTOMATION_STATUS', payload: engine.snapshot() });
  post(port, { type: 'SCANNER_LOG', payload: { entries: log.all(), reset: true } });
});

/* ------------------------------ messages ------------------------------ */

function statusResponse(): ScannerStatusResponse {
  return { snapshot: scanner.getSnapshot(), logs: log.all() };
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !isExtensionMessage(message)) return false;

  switch (message.type) {
    case 'CONTENT_PING': {
      const status: ContentStatus = {
        ready: true,
        leadListDetected: hasLeadList(document),
        selectorMapVersion: SELECTOR_MAP_VERSION,
      };
      sendResponse(status);
      return false;
    }
    case 'SCANNER_START':
      scanner.start();
      sendResponse(statusResponse());
      return false;
    case 'SCANNER_STOP':
      scanner.stop();
      sendResponse(statusResponse());
      return false;
    case 'SCANNER_STATUS_REQUEST':
      sendResponse(statusResponse());
      return false;
    case 'AUTOMATION_STATUS_REQUEST':
      sendResponse({ ok: true, snapshot: engine.snapshot() } satisfies AutomationCommandResult);
      return false;
    case 'AUTOMATION_STOP':
      stopAutomation().then(sendResponse, () =>
        sendResponse({ ok: false, error: 'Could not stop.', snapshot: engine.snapshot() }),
      );
      return true; // async response
    default:
      return false;
  }
});

/* ------------------------------- start -------------------------------- */

// The scanner starts automatically and stays idle until the page shows a
// lead list. Saved filters, scoring and the Auto-Click setting are applied
// first, so the first leads are judged (and, if ON, contacted) under the
// user's settings (defaults if none or invalid).
void Promise.all([
  loadFilterConfig(),
  loadScoringConfig(),
  loadAutomationConfig(),
  chrome.storage.local.get(LICENSE_RECORD_KEY).catch(() => ({})),
])
  .then(([filters, scoring, automation, license]) => {
    // v0.6.1 kept a permanent "contacted" list; Auto-Click is event-based now.
    void chrome.storage.local.remove('automation.contacted').catch(() => undefined);
    licenseGate.update(
      licenseStateFromStorage((license as Record<string, unknown>)[LICENSE_RECORD_KEY]),
    );
    requestValidation('page');
    scanner.setFilterConfig(filters.config, { announce: false });
    scanner.setScoringConfig(scoring.config, { announce: false });
    return applyAutomationConfig(automation.config);
  })
  .finally(() => scanner.start());

// Settings edited in the popup apply live: remembered leads are re-evaluated.
watchFilterConfig(({ config }) => scanner.setFilterConfig(config));
watchScoringConfig(({ config }) => scanner.setScoringConfig(config));
// The popup toggle: ON queues matched leads at once, OFF cancels the queue.
watchAutomationConfig(({ config }) => void applyAutomationConfig(config));
