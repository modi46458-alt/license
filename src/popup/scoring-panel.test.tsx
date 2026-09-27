import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SCORING_CONFIG, type ScoringConfig } from '@/core/scoring';
import { ScoringPanel } from './ScoringPanel';
import { describeScoringProblem, type ScoringConfigView } from './use-scoring-config';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function view(overrides: Partial<ScoringConfigView> = {}): ScoringConfigView {
  const draft = overrides.draft ?? DEFAULT_SCORING_CONFIG;
  return {
    saved: DEFAULT_SCORING_CONFIG,
    draft,
    setDraft: vi.fn(),
    dirty: false,
    problem: describeScoringProblem(draft),
    busy: false,
    message: null,
    save: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  };
}

let host: HTMLDivElement;
function render(v: ScoringConfigView) {
  host = document.createElement('div');
  document.body.append(host);
  act(() => createRoot(host).render(<ScoringPanel view={v} />));
}
afterEach(() => host?.remove());

const button = (name: string) =>
  Array.from(host.querySelectorAll('button')).find(
    (b) => b.textContent === name,
  ) as HTMLButtonElement;

function typeInto(input: HTMLInputElement, value: string): void {
  Reflect.set(HTMLInputElement.prototype, 'value', value, input);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('ScoringPanel', () => {
  it('shows default weights totalling 100 and the thresholds', () => {
    render(view());
    expect(host.textContent).toContain('Total 100');
    expect(host.textContent).not.toContain('scaled');
    const values = Array.from(host.querySelectorAll('input[type=number]')).map(
      (i) => (i as HTMLInputElement).value,
    );
    expect(values).toEqual([
      '25',
      '20',
      '10',
      '15',
      '10',
      '8',
      '5',
      '3',
      '4',
      '100',
      '90',
      '75',
      '50',
    ]);
    expect(host.textContent).toContain('Low: below 50');
  });

  it('says clearly when weights do not total 100', () => {
    const draft: ScoringConfig = {
      ...DEFAULT_SCORING_CONFIG,
      weights: { ...DEFAULT_SCORING_CONFIG.weights, country: 35 },
    };
    render(view({ draft, dirty: true }));
    expect(host.textContent).toContain('Total 110');
    expect(host.textContent).toContain('Weights total 110. Scores will be scaled to 0–100.');
    expect(button('Save scoring').disabled).toBe(false);
  });

  it('editing a weight updates the draft', () => {
    const setDraft = vi.fn();
    render(view({ setDraft }));
    const country = host.querySelector('input[type=number]') as HTMLInputElement;
    act(() => typeInto(country, '30'));
    const next = setDraft.mock.calls.at(-1)?.[0] as ScoringConfig;
    expect(next.weights.country).toBe(30);
  });

  it('blocks saving invalid threshold order', () => {
    const draft: ScoringConfig = {
      ...DEFAULT_SCORING_CONFIG,
      thresholds: { critical: 50, high: 75, medium: 90 },
    };
    render(view({ draft, dirty: true }));
    expect(button('Save scoring').disabled).toBe(true);
    expect(host.textContent).toContain('Thresholds must be Critical > High > Medium.');
  });

  it('save and reset call through', () => {
    const save = vi.fn();
    const reset = vi.fn();
    render(view({ dirty: true, save, reset }));
    act(() => button('Save scoring').click());
    act(() => button('Reset').click());
    expect(save).toHaveBeenCalledOnce();
    expect(reset).toHaveBeenCalledOnce();
  });
});

describe('describeScoringProblem', () => {
  it.each([
    [DEFAULT_SCORING_CONFIG, null],
    [
      { ...DEFAULT_SCORING_CONFIG, thresholds: { critical: 75, high: 75, medium: 50 } },
      'Thresholds must be Critical > High > Medium.',
    ],
    [
      {
        ...DEFAULT_SCORING_CONFIG,
        weights: Object.fromEntries(
          Object.keys(DEFAULT_SCORING_CONFIG.weights).map((k) => [k, 0]),
        ) as ScoringConfig['weights'],
      },
      'At least one weight must be above 0.',
    ],
    [
      { ...DEFAULT_SCORING_CONFIG, weights: { ...DEFAULT_SCORING_CONFIG.weights, email: -5 } },
      'Some scoring values are not valid.',
    ],
  ] as const)('%#', (config, problem) => {
    expect(describeScoringProblem(config)).toBe(problem);
  });
});
