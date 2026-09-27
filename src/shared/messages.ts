import type { LicenseState } from '@/core/license/license-types';
import type { AutomationSnapshot } from '@/core/actions';
import type { ScanLog, ScannerSnapshot } from '@/core/types/scanner';

/**
 * Typed message contract between content script, service worker and UI.
 *
 * Request/response messages (chrome.runtime / chrome.tabs sendMessage) are in
 * MessageMap. Live scanner updates flow over a port (ScannerPortMessage) only
 * while the popup is open. PIPELINE_EVENTS reserves the names used once leads
 * are stored and routed through the service worker (Phase 9).
 */

export const PIPELINE_EVENTS = [
  'LEAD_DETECTED',
  'LEAD_MATCHED',
  'LEAD_REJECTED',
  'SCAN_STARTED',
  'SCAN_COMPLETED',
  'STATS_UPDATED',
  'ACTION_QUEUED',
  'ACTION_STARTED',
  'ACTION_SUCCESS',
  'ACTION_FAILED',
  'SETTINGS_UPDATED',
  'ERROR_OCCURRED',
] as const;

export type PipelineEvent = (typeof PIPELINE_EVENTS)[number];

export interface ContentStatus {
  readonly ready: true;
  readonly leadListDetected: boolean;
  readonly selectorMapVersion: string;
}

export interface WorkerStatus {
  readonly version: string;
  readonly installedAt: number | null;
}

export interface ScannerStatusResponse {
  readonly snapshot: ScannerSnapshot;
  readonly logs: readonly ScanLog[];
}

/** request type → { request payload, response payload } */
export interface MessageMap {
  CONTENT_PING: { request: undefined; response: ContentStatus };
  WORKER_STATUS: { request: undefined; response: WorkerStatus };
  SCANNER_START: { request: undefined; response: ScannerStatusResponse };
  SCANNER_STOP: { request: undefined; response: ScannerStatusResponse };
  SCANNER_STATUS_REQUEST: { request: undefined; response: ScannerStatusResponse };
  AUTOMATION_STATUS_REQUEST: { request: undefined; response: AutomationCommandResult };
  /** License (handled by the service worker). */
  LICENSE_STATUS_REQUEST: { request: undefined; response: LicenseCommandResult };
  LICENSE_ACTIVATE: { request: { readonly code: string }; response: LicenseCommandResult };
  LICENSE_VALIDATE: { request: { readonly reason: string }; response: LicenseCommandResult };
  LICENSE_DEACTIVATE: { request: undefined; response: LicenseCommandResult };
  /** Emergency STOP: cancels the queue and switches Auto-Click OFF. */
  AUTOMATION_STOP: { request: undefined; response: AutomationCommandResult };
}

export type LicenseCommandResult =
  | { readonly ok: true; readonly state: LicenseState }
  | { readonly ok: false; readonly error: string; readonly state: LicenseState };

export type AutomationCommandResult =
  | { readonly ok: true; readonly snapshot: AutomationSnapshot }
  | { readonly ok: false; readonly error: string; readonly snapshot: AutomationSnapshot | null };

export type MessageType = keyof MessageMap;

export type ExtensionMessage<T extends MessageType = MessageType> = T extends MessageType
  ? { readonly type: T; readonly payload: MessageMap[T]['request'] }
  : never;

const KNOWN_TYPES: ReadonlySet<string> = new Set<MessageType>([
  'CONTENT_PING',
  'WORKER_STATUS',
  'SCANNER_START',
  'SCANNER_STOP',
  'SCANNER_STATUS_REQUEST',
  'AUTOMATION_STATUS_REQUEST',
  'AUTOMATION_STOP',
  'LICENSE_STATUS_REQUEST',
  'LICENSE_ACTIVATE',
  'LICENSE_VALIDATE',
  'LICENSE_DEACTIVATE',
]);

/** Runtime guard: never trust the shape of an incoming message. */
export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof value.type === 'string' &&
    KNOWN_TYPES.has(value.type)
  );
}

/** Message types that carry no request payload. */
export type PayloadlessType = {
  [K in MessageType]: MessageMap[K]['request'] extends undefined ? K : never;
}[MessageType];

export function createMessage<T extends MessageType>(
  type: T,
  payload: MessageMap[T]['request'],
): ExtensionMessage<T> {
  return { type, payload } as ExtensionMessage<T>;
}

/* ------------------------------------------------------------------ */
/* Live scanner port (content script → popup, only while popup is open) */
/* ------------------------------------------------------------------ */

export const SCANNER_PORT_NAME = 'imsli.scanner';

export type ScannerPortMessage =
  | { readonly type: 'SCANNER_STATUS_RESPONSE'; readonly payload: ScannerSnapshot }
  | { readonly type: 'AUTOMATION_STATUS'; readonly payload: AutomationSnapshot }
  | {
      readonly type: 'SCANNER_LOG';
      /** reset=true: replace the popup's log with these entries. */
      readonly payload: { readonly entries: readonly ScanLog[]; readonly reset: boolean };
    };

export function isScannerPortMessage(value: unknown): value is ScannerPortMessage {
  if (typeof value !== 'object' || value === null || !('type' in value) || !('payload' in value)) {
    return false;
  }
  const { type, payload } = value;
  if (typeof payload !== 'object' || payload === null) return false;
  if (type === 'SCANNER_STATUS_RESPONSE') return 'state' in payload && 'diagnostics' in payload;
  if (type === 'SCANNER_LOG') return 'entries' in payload && Array.isArray(payload.entries);
  if (type === 'AUTOMATION_STATUS') return 'state' in payload && 'history' in payload;
  return false;
}
