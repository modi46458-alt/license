import { LicenseError, type LicenseState } from '@/core/license';
import {
  isExtensionMessage,
  type ExtensionMessage,
  type LicenseCommandResult,
  type WorkerStatus,
} from '@/shared/messages';
import { getLicenseManager } from './license-runtime';

const INSTALLED_AT_KEY = 'meta.installedAt';

export async function recordInstall(): Promise<void> {
  await chrome.storage.local.set({ [INSTALLED_AT_KEY]: Date.now() });
}

async function workerStatus(): Promise<WorkerStatus> {
  const stored = await chrome.storage.local.get(INSTALLED_AT_KEY);
  const installedAt = stored[INSTALLED_AT_KEY];
  return {
    version: chrome.runtime.getManifest().version,
    installedAt: typeof installedAt === 'number' ? installedAt : null,
  };
}

/**
 * Routes typed messages. Returns true only when it will respond
 * asynchronously, so unrelated messages are left for other listeners.
 */
export function routeMessage(
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void,
): boolean {
  // Only accept messages from this extension.
  if (sender.id !== chrome.runtime.id || !isExtensionMessage(message)) return false;

  switch (message.type) {
    case 'WORKER_STATUS':
      workerStatus().then(sendResponse, () => sendResponse(null));
      return true;
    case 'LICENSE_STATUS_REQUEST':
    case 'LICENSE_ACTIVATE':
    case 'LICENSE_VALIDATE':
    case 'LICENSE_DEACTIVATE':
      handleLicense(message).then(sendResponse, () => sendResponse(null));
      return true;
    default:
      return false;
  }
}

type LicenseMessage = ExtensionMessage<
  'LICENSE_STATUS_REQUEST' | 'LICENSE_ACTIVATE' | 'LICENSE_VALIDATE' | 'LICENSE_DEACTIVATE'
>;

async function handleLicense(message: LicenseMessage): Promise<LicenseCommandResult> {
  const manager = getLicenseManager();
  const ok = (state: LicenseState): LicenseCommandResult => ({ ok: true, state });
  try {
    switch (message.type) {
      case 'LICENSE_STATUS_REQUEST':
        return ok(await manager.getState());
      case 'LICENSE_ACTIVATE': {
        const code = (message.payload as { code?: unknown } | undefined)?.code;
        if (typeof code !== 'string' || code.length > 40) {
          return { ok: false, error: 'Enter a license code.', state: await manager.getState() };
        }
        return ok(await manager.activate(code));
      }
      case 'LICENSE_VALIDATE': {
        const reason = (message.payload as { reason?: unknown } | undefined)?.reason;
        return ok(
          await manager.validate(typeof reason === 'string' ? reason.slice(0, 40) : 'request'),
        );
      }
      case 'LICENSE_DEACTIVATE':
        return ok(await manager.deactivate());
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof LicenseError ? error.message : 'License request failed',
      state: await manager.getState(),
    };
  }
}
