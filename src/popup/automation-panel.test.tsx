import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_AUTOMATION_CONFIG,
  type AutomationConfig,
  type AutomationSnapshot,
} from '@/core/actions';
import { AutomationPanel, STATUS_TEXT, StopBanner } from './AutomationPanel';
import type { AutomationConfigView } from './use-automation-config';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OFF: AutomationConfig = { ...DEFAULT_AUTOMATION_CONFIG, autoClickEnabled: false };

function settings(config: AutomationConfig, setEnabled = vi.fn()): AutomationConfigView {
  return { saved: config, busy: false, message: null, setEnabled, setDelay: vi.fn() };
}

function snapshot(over: Partial<AutomationSnapshot> = {}): AutomationSnapshot {
  return {
    state: 'ON',
    config: DEFAULT_AUTOMATION_CONFIG,
    clicked: 0,
    events: 0,
    queueLength: 0,
    current: null,
    nextActionAt: null,
    history: [],
    lastError: null,
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

const byText = (text: string) =>
  Array.from(host.querySelectorAll('button')).find((b) => b.textContent === text);
const toggle = () => host.querySelector('[role=switch]') as HTMLButtonElement;

describe('Auto-Click panel', () => {
  it('ON by default: the toggle says ON and explains what happens', () => {
    render(
      <AutomationPanel
        settings={settings(DEFAULT_AUTOMATION_CONFIG)}
        automation={snapshot()}
        automationError={null}
        onToggle={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    expect(host.textContent).toContain('Auto-click Contact Buyer');
    expect(toggle().getAttribute('aria-checked')).toBe('true');
    expect(toggle().textContent).toBe('ON');
    expect(host.textContent).toContain(STATUS_TEXT.on);
    expect(STATUS_TEXT.on).toBe('Matched leads will be contacted automatically.');
  });

  it('OFF: says "Auto-click disabled." and hides STOP', () => {
    render(
      <AutomationPanel
        settings={settings(OFF)}
        automation={snapshot({ state: 'OFF' })}
        automationError={null}
        onToggle={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    expect(toggle().getAttribute('aria-checked')).toBe('false');
    expect(host.textContent).toContain('Auto-click disabled.');
    expect(byText('STOP AUTOMATION')).toBeUndefined();
  });

  it('the toggle switches ON/OFF directly: no Start button, no confirmation', () => {
    const onToggle = vi.fn();
    render(
      <AutomationPanel
        settings={settings(OFF)}
        automation={snapshot({ state: 'OFF' })}
        automationError={null}
        onToggle={onToggle}
        onStop={vi.fn()}
      />,
    );
    act(() => toggle().click());
    expect(onToggle).toHaveBeenCalledWith(true);
    expect(host.querySelector('[role=dialog]')).toBeNull();
    expect(host.textContent).not.toMatch(/Start/);
    expect(host.textContent).not.toMatch(/Minimum score|Eligible/);
  });

  it('STOP AUTOMATION calls stop', () => {
    const onStop = vi.fn();
    render(
      <AutomationPanel
        settings={settings(DEFAULT_AUTOMATION_CONFIG)}
        automation={snapshot({ clicked: 2, queueLength: 1 })}
        automationError={null}
        onToggle={vi.fn()}
        onStop={onStop}
      />,
    );
    expect(host.textContent).toContain('2 contacted · 1 queued');
    act(() => byText('STOP AUTOMATION')?.click());
    expect(onStop).toHaveBeenCalledOnce();
  });

  it('standby explains that another tab is clicking', () => {
    render(
      <AutomationPanel
        settings={settings(DEFAULT_AUTOMATION_CONFIG)}
        automation={snapshot({ state: 'STANDBY' })}
        automationError={null}
        onToggle={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    expect(host.textContent).toContain(STATUS_TEXT.standby);
  });

  it('shows the click log with reasons', () => {
    render(
      <AutomationPanel
        settings={settings(DEFAULT_AUTOMATION_CONFIG)}
        automation={snapshot({
          history: [
            {
              actionId: 'a1',
              matchEventId: 'm-1',
              leadId: 'L1',
              fingerprint: 'fp-1',
              resolverResult: 'IDENTITY_MISMATCH',
              actionType: 'CONTACT_BUYER',
              status: 'FAILED',
              attempt: 1,
              maxRetries: 2,
              createdAt: 0,
              startedAt: 0,
              completedAt: 0,
              errorCode: 'IDENTITY_MISMATCH',
              errorMessage: 'the card now shows a different lead',
              leadLabel: 'Propranolol Tablets',
            },
          ],
        })}
        automationError={null}
        onToggle={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    expect(host.textContent).toContain('IDENTITY_MISMATCH: the card now shows a different lead');
  });
});

describe('StopBanner', () => {
  it('shows only while Auto-Click is ON, and stops on click', () => {
    const onStop = vi.fn();
    render(<StopBanner enabled={false} automation={snapshot()} onStop={onStop} />);
    expect(host.textContent).toBe('');
    host.remove();
    render(<StopBanner enabled automation={snapshot({ clicked: 3 })} onStop={onStop} />);
    expect(host.textContent).toContain('Auto-Click ON · 3 contacted');
    act(() => byText('STOP AUTOMATION')?.click());
    expect(onStop).toHaveBeenCalledOnce();
  });
});

describe('delay and license lock in the panel', () => {
  it('offers the safe delay options and saves the chosen one', () => {
    const view = settings(DEFAULT_AUTOMATION_CONFIG);
    render(
      <AutomationPanel
        settings={view}
        automation={snapshot()}
        automationError={null}
        onToggle={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    const select = host.querySelector('select') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      '500 ms',
      '750 ms',
      '1 s',
      '1.5 s',
      '2 s',
    ]);
    expect(select.value).toBe('1000');
    act(() => {
      select.value = '1500';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(view.setDelay).toHaveBeenCalledWith(1500);
  });

  it('LOCKED explains that a license is required', () => {
    render(
      <AutomationPanel
        settings={settings(DEFAULT_AUTOMATION_CONFIG)}
        automation={snapshot({ state: 'LOCKED' })}
        automationError={null}
        onToggle={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    expect(host.textContent).toContain(STATUS_TEXT.locked);
  });
});
