import { describe, expect, it } from 'vitest';
import { createMessage, isExtensionMessage, isScannerPortMessage } from './messages';

describe('message contract', () => {
  it('builds typed messages', () => {
    expect(createMessage('CONTENT_PING', undefined)).toEqual({
      type: 'CONTENT_PING',
      payload: undefined,
    });
  });

  it.each([null, undefined, 'PING', {}, { type: 42 }, { type: 'UNKNOWN' }])('rejects %j', (value) =>
    expect(isExtensionMessage(value)).toBe(false),
  );

  it('accepts known messages', () => {
    expect(isExtensionMessage({ type: 'WORKER_STATUS' })).toBe(true);
  });
});

describe('scanner messages', () => {
  it.each(['SCANNER_START', 'SCANNER_STOP', 'SCANNER_STATUS_REQUEST'])('accepts %s', (type) => {
    expect(isExtensionMessage({ type })).toBe(true);
  });

  it('validates port messages', () => {
    expect(
      isScannerPortMessage({ type: 'SCANNER_LOG', payload: { entries: [], reset: true } }),
    ).toBe(true);
    expect(
      isScannerPortMessage({
        type: 'SCANNER_STATUS_RESPONSE',
        payload: { state: {}, diagnostics: {} },
      }),
    ).toBe(true);
    expect(isScannerPortMessage({ type: 'SCANNER_LOG', payload: { entries: 'x' } })).toBe(false);
    expect(isScannerPortMessage({ type: 'SCANNER_EVENT', payload: {} })).toBe(false);
    expect(isScannerPortMessage(null)).toBe(false);
  });
});
