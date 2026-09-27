import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  INITIAL_LICENSE_STATE,
  fromServer,
  type LicenseState,
  type ServerLicenseStatus,
} from '@/core/license';
import { LicenseBanner, LicensePanel } from './LicensePanel';
import type { LicenseView } from './use-license';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const at = (status: ServerLicenseStatus): LicenseState =>
  fromServer(
    INITIAL_LICENSE_STATE,
    {
      status,
      expiresAt: Date.UTC(2027, 0, 31),
      serverTime: Date.UTC(2026, 8, 26),
      plan: 'Pro',
      customer: 'Acme Pharma',
      codeHint: 'AB12',
    },
    Date.UTC(2026, 8, 26),
  );

function view(state: LicenseState, over: Partial<LicenseView> = {}): LicenseView {
  return {
    state,
    busy: false,
    error: null,
    activate: vi.fn(),
    deactivate: vi.fn(),
    refresh: vi.fn(),
    ...over,
  };
}

let host: HTMLDivElement;
function render(ui: React.ReactElement) {
  host = document.createElement('div');
  document.body.append(host);
  act(() => createRoot(host).render(ui));
}
afterEach(() => host?.remove());

function typeInto(input: HTMLInputElement, value: string) {
  Reflect.set(HTMLInputElement.prototype, 'value', value, input);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('LicensePanel', () => {
  it('unregistered: code field validates the IMS format before Activate', () => {
    const activate = vi.fn();
    render(<LicensePanel view={view(INITIAL_LICENSE_STATE, { activate })} />);
    const input = host.querySelector('input') as HTMLInputElement;
    const button = host.querySelector('button[type=submit]') as HTMLButtonElement;
    act(() => typeInto(input, 'IMS-12'));
    expect(button.disabled).toBe(true);
    act(() => typeInto(input, ' ims-ab12-cd34-ef56 '));
    expect(button.disabled).toBe(false);
    act(() => button.click());
    expect(activate).toHaveBeenCalledWith('IMS-AB12-CD34-EF56');
  });

  it('active: shows plan, customer, masked code and expiry; never the full code', () => {
    render(<LicensePanel view={view(at('ACTIVE'))} />);
    expect(host.textContent).toContain('ACTIVE');
    expect(host.textContent).toContain('IMS-••••-••••-AB12');
    expect(host.textContent).toContain('Acme Pharma');
    expect(host.querySelector('input')).toBeNull();
  });

  it.each<ServerLicenseStatus>(['EXPIRED', 'DISABLED', 'SUSPENDED'])(
    '%s is shown with its reason',
    (status) => {
      render(<LicensePanel view={view(at(status))} />);
      expect(host.textContent).toContain(status);
    },
  );
});

describe('LicenseBanner', () => {
  it('hidden when ACTIVE, locked message otherwise', () => {
    render(<LicenseBanner state={at('ACTIVE')} onOpen={vi.fn()} />);
    expect(host.textContent).toBe('');
    host.remove();
    const onOpen = vi.fn();
    render(<LicenseBanner state={at('DISABLED')} onOpen={onOpen} />);
    expect(host.textContent).toContain('Locked.');
    expect(host.textContent).toContain('Scanning and Auto-Click are off.');
    act(() => (host.querySelector('button') as HTMLButtonElement).click());
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
