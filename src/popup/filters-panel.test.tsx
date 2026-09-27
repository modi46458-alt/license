import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FILTER_CONFIG, type FilterConfig } from '@/core/filters';
import { FiltersPanel } from './FiltersPanel';
import type { FilterConfigView } from './use-filter-config';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function view(overrides: Partial<FilterConfigView> = {}): FilterConfigView {
  return {
    saved: DEFAULT_FILTER_CONFIG,
    draft: DEFAULT_FILTER_CONFIG,
    setDraft: vi.fn(),
    dirty: false,
    problem: null,
    busy: false,
    message: null,
    apply: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  };
}

/** Set a controlled input's value the way React listens for it (native setter + input event). */
function typeInto(input: HTMLInputElement, value: string): void {
  Reflect.set(HTMLInputElement.prototype, 'value', value, input);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

let host: HTMLDivElement;
function render(v: FilterConfigView) {
  host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(<FiltersPanel view={v} />));
  return root;
}
afterEach(() => host?.remove());

const button = (name: string) =>
  Array.from(host.querySelectorAll('button')).find(
    (b) => b.textContent === name,
  ) as HTMLButtonElement;

describe('FiltersPanel', () => {
  it('shows the default filters', () => {
    render(view());
    const text = host.textContent ?? '';
    for (const t of ['Canada', 'United States', 'Tablet', 'Personal Use', 'Home Use']) {
      expect(text).toContain(t);
    }
    expect((host.querySelector('input[type=number]') as HTMLInputElement).value).toBe('20');
  });

  it('adds a keyword to the draft', () => {
    const setDraft = vi.fn();
    render(view({ setDraft }));
    const input = host.querySelector('input[placeholder="e.g. Softgel"]') as HTMLInputElement;
    act(() => {
      typeInto(input, '  Softgel  ');
    });
    act(() => {
      input.parentElement?.querySelector('button')?.click();
    });
    const next = setDraft.mock.calls.at(-1)?.[0] as FilterConfig;
    expect(next.keywords.values.at(-1)).toEqual({ value: 'Softgel', enabled: true });
  });

  it('rejects duplicate terms without changing the draft', () => {
    const setDraft = vi.fn();
    render(view({ setDraft }));
    const input = host.querySelector('input[placeholder="e.g. Softgel"]') as HTMLInputElement;
    act(() => {
      typeInto(input, 'tablet');
    });
    act(() => input.parentElement?.querySelector('button')?.click());
    expect(setDraft).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Already in the list.');
  });

  it('renders user text as text, never as markup', () => {
    const draft = {
      ...DEFAULT_FILTER_CONFIG,
      keywords: {
        ...DEFAULT_FILTER_CONFIG.keywords,
        values: [{ value: '<img src=x onerror=alert(1)>', enabled: true }],
      },
    };
    render(view({ draft, saved: draft }));
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('Apply is disabled until something changes, and while invalid', () => {
    render(view());
    expect(button('Apply filters').disabled).toBe(true);
    host.remove();
    render(view({ dirty: true, problem: 'Quantity minimum is above the maximum.' }));
    expect(button('Apply filters').disabled).toBe(true);
    expect(host.textContent).toContain('Quantity minimum is above the maximum.');
    host.remove();
    const apply = vi.fn();
    render(view({ dirty: true, apply }));
    act(() => button('Apply filters').click());
    expect(apply).toHaveBeenCalledOnce();
  });

  it('Reset calls reset', () => {
    const reset = vi.fn();
    render(view({ reset }));
    act(() => button('Reset to defaults').click());
    expect(reset).toHaveBeenCalledOnce();
  });
});
