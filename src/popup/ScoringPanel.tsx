import { useId } from 'react';
import {
  SCORE_COMPONENTS,
  SCORING_LIMITS,
  totalWeight,
  type ScoreComponent,
  type ScoringConfig,
} from '@/core/scoring';
import type { ScoringConfigView } from './use-scoring-config';

const COMPONENT_LABEL: Record<ScoreComponent, string> = {
  country: 'Country',
  quantity: 'Quantity',
  mobile: 'Mobile',
  whatsapp: 'WhatsApp',
  email: 'Email',
  keyword: 'Keyword',
  category: 'Category',
  buyerProducts: 'Buyer products',
  leadAge: 'Lead age',
};

const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ok';

function NumberInput({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  prefix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  prefix?: string;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-2 text-[12px]">
      <label htmlFor={id} className="text-ink">
        {label}
      </label>
      <span className="flex items-center gap-1">
        {prefix && <span className="text-muted">{prefix}</span>}
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={step}
          value={Number.isFinite(value) ? value : ''}
          onChange={(e) => {
            const n = Number(e.currentTarget.value);
            if (e.currentTarget.value !== '' && Number.isFinite(n)) onChange(n);
          }}
          className={`w-16 rounded-md border border-rule bg-surface px-2 py-0.5 text-right ${focusRing}`}
        />
      </span>
    </div>
  );
}

export function ScoringPanel({ view }: { view: ScoringConfigView }) {
  const { draft: c, setDraft } = view;
  if (view.saved === null) {
    return <p className="px-4 py-4 text-[12px] text-muted">Loading scoring…</p>;
  }

  const total = totalWeight(c.weights);
  const setWeight = (component: ScoreComponent, value: number) =>
    setDraft({ ...c, weights: { ...c.weights, [component]: value } });
  const setThreshold = (key: keyof ScoringConfig['thresholds'], value: number) =>
    setDraft({ ...c, thresholds: { ...c.thresholds, [key]: value } });

  return (
    <div>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div>
          <h2 className="text-[14px] font-semibold">Lead scoring</h2>
          <p className="text-[12px] text-muted">
            Scores matched leads 0–100. Rejected leads are never scored.
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-1.5 text-[12px] font-medium">
          <input
            type="checkbox"
            checked={c.enabled}
            onChange={(e) => setDraft({ ...c, enabled: e.currentTarget.checked })}
            className={`size-4 accent-[var(--ok)] ${focusRing}`}
          />
          {c.enabled ? 'On' : 'Off'}
        </label>
      </div>

      <fieldset disabled={!c.enabled} className="disabled:opacity-50">
        <section aria-labelledby="weights-heading" className="border-t border-rule px-4 py-3">
          <div className="flex items-baseline justify-between pb-2">
            <h3
              id="weights-heading"
              className="text-[11px] font-semibold tracking-wide text-muted uppercase"
            >
              Weights (points)
            </h3>
            <span
              className={`text-[12px] font-medium ${total === 100 ? 'text-ok' : 'text-wait'}`}
              aria-live="polite"
            >
              Total {Number.isInteger(total) ? total : total.toFixed(1)}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            {SCORE_COMPONENTS.map((component) => (
              <NumberInput
                key={component}
                label={COMPONENT_LABEL[component]}
                value={c.weights[component]}
                min={0}
                max={SCORING_LIMITS.maxWeight}
                onChange={(v) => setWeight(component, v)}
              />
            ))}
          </div>
          {total !== 100 && total > 0 && (
            <p className="pt-2 text-[11px] text-wait">
              Weights total {Number.isInteger(total) ? total : total.toFixed(1)}. Scores will be
              scaled to 0–100.
            </p>
          )}
          <div className="pt-2">
            <NumberInput
              label="Quantity for full points"
              value={c.quantityForFullPoints}
              min={1}
              max={SCORING_LIMITS.maxQuantityForFullPoints}
              onChange={(v) => setDraft({ ...c, quantityForFullPoints: v })}
            />
            <p className="pt-1 text-[11px] text-muted">
              Any unit counts the same: 50 Kg and 50 Box score alike.
            </p>
          </div>
          <label className="flex cursor-pointer items-center gap-1.5 pt-2 text-[12px]">
            <input
              type="checkbox"
              checked={c.allowApproximateLeadAge}
              onChange={(e) => setDraft({ ...c, allowApproximateLeadAge: e.currentTarget.checked })}
              className={`size-3.5 accent-[var(--ok)] ${focusRing}`}
            />
            Score approximate lead ages (months, years)
          </label>
        </section>

        <section aria-labelledby="thresholds-heading" className="border-t border-rule px-4 py-3">
          <h3
            id="thresholds-heading"
            className="pb-2 text-[11px] font-semibold tracking-wide text-muted uppercase"
          >
            Priority thresholds
          </h3>
          <div className="space-y-1.5">
            <NumberInput
              label="Critical"
              prefix="≥"
              value={c.thresholds.critical}
              min={1}
              max={100}
              onChange={(v) => setThreshold('critical', v)}
            />
            <NumberInput
              label="High"
              prefix="≥"
              value={c.thresholds.high}
              min={1}
              max={100}
              onChange={(v) => setThreshold('high', v)}
            />
            <NumberInput
              label="Medium"
              prefix="≥"
              value={c.thresholds.medium}
              min={1}
              max={100}
              onChange={(v) => setThreshold('medium', v)}
            />
            <p className="text-[12px] text-muted">Low: below {c.thresholds.medium}</p>
          </div>
        </section>
      </fieldset>

      <div className="sticky bottom-0 flex items-center gap-2 border-t border-rule bg-surface px-4 py-3">
        <button
          type="button"
          disabled={view.busy || !view.dirty || view.problem !== null}
          onClick={view.save}
          className={`rounded-md bg-ink px-3 py-1.5 text-[13px] font-medium text-paper disabled:opacity-40 ${focusRing}`}
        >
          Save scoring
        </button>
        <button
          type="button"
          disabled={view.busy}
          onClick={view.reset}
          className={`rounded-md border border-rule px-3 py-1.5 text-[13px] font-medium hover:border-muted disabled:opacity-40 ${focusRing}`}
        >
          Reset
        </button>
        <p
          role="status"
          className={`min-w-0 flex-1 text-right text-[11px] ${view.problem ? 'text-fail' : 'text-muted'}`}
        >
          {view.problem ?? view.message ?? (view.dirty ? 'Unsaved changes' : '')}
        </p>
      </div>
    </div>
  );
}
