import { MessagingError } from './errors';
import { createMessage, type MessageMap, type MessageType, type PayloadlessType } from './messages';

/** Send a typed message to the service worker. */
export async function sendToWorker<T extends PayloadlessType>(
  type: T,
): Promise<MessageMap[T]['response']> {
  try {
    return await chrome.runtime.sendMessage(createMessage(type, undefined));
  } catch (cause) {
    throw new MessagingError(`Service worker did not answer ${type}`, { cause });
  }
}

/** Send a typed message with a payload to the service worker. */
export async function sendToWorkerWith<T extends MessageType>(
  type: T,
  payload: MessageMap[T]['request'],
): Promise<MessageMap[T]['response']> {
  try {
    return await chrome.runtime.sendMessage(createMessage(type, payload));
  } catch (cause) {
    throw new MessagingError(`Service worker did not answer ${type}`, { cause });
  }
}

/**
 * Send a typed message to the content script in a tab. Rejects when no
 * content script is listening (wrong page, or tab loaded before install).
 */
export async function sendToTab<T extends PayloadlessType>(
  tabId: number,
  type: T,
): Promise<MessageMap[T]['response']> {
  try {
    return await chrome.tabs.sendMessage(tabId, createMessage(type, undefined));
  } catch (cause) {
    throw new MessagingError(`Content script did not answer ${type}`, { cause });
  }
}
