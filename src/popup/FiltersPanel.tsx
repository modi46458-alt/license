import { useId, useState, type ReactNode } from 'react';
import {
  FILTER_LIMITS,
  TEXT_FIELDS,
  type FilterConfig,
  type FilterTerm,
  type LogicMode,
  type TermMode,
  type TextField,
} from '@/core/filters';
import type { FilterConfigView } from './use-filter-config';

const FIELD_LABEL: Record<TextField, string> = {
  title: 'Title',
  category: 'Category',
  productCategory: 'Product category',
  buyerProducts: 'Buyer products',
};

const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ok';

/* ------------------------------------------------------------------ */
/* Small controls                                                       */
/* ------------------------------------------------------------------ */

function Section({
  title,
  enabled,
  onToggle,
  children,
}: {
  title: string;
  enabled?: boolean;
  onToggle?: (on: boolean) => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="border-t border-rule px-4 py-3">
      <div className="flex items-center justify-between gap-2 pb-2">
        <h3 id={id} className="text-[11px] font-semibold tracking-wide text-muted uppercase">
          {title}
        </h3>
        {onToggle && (
          <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-muted">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => onToggle(e.currentTarget.checked)}
              className={`size-3.5 accent-[var(--ok)] ${focusRing}`}
            />
            {enabled ? 'On' : 'Off'}
          </label>
        )}
      </div>
      <fieldset disabled={enabled === false} className="space-y-2 disabled:opacity-50">
        {children}
      </fieldset>
    </section>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
  hint?: string | undefined;
}) {
  const name = useId();
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span className="text-muted">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex rounded-md border border-rule">
        {options.map((o) => (
          <label
            key={o.value}
            className={`cursor-pointer px-2 py-0.5 first:rounded-l-md last:rounded-r-md has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ok ${
              value === o.value ? 'bg-ink text-paper' : 'text-ink'
            }`}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            {o.label}
          </label>
        ))}
      </div>
      {hint && <span className="text-[11px] text-muted">{hint}</span>}
    </div>
  );
}

const TERM_MODES = [
  { value: 'ANY', label: 'Any' },
  { value: 'ALL', label: 'All' },
] as const satisfies readonly { value: TermMode; label: string }[];

function TermList({
  label,
  terms,
  onChange,
  placeholder,
}: {
  label: string;
  terms: readonly FilterTerm[];
  onChange: (next: FilterTerm[]) => void;
  placeholder: string;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();

  const add = () => {
    const value = text.replace(/\s+/g, ' ').trim();
    if (!value) return;
    if (value.length > FILTER_LIMITS.maxTermLength) {
      setError(`Keep it under ${FILTER_LIMITS.maxTermLength} characters.`);
      return;
    }
    if (terms.some((t) => t.value.toLowerCase() === value.toLowerCase())) {
      setError('Already in the list.');
      return;
    }
    if (terms.length >= FILTER_LIMITS.maxTerms) {
      setError(`At most ${FILTER_LIMITS.maxTerms} entries.`);
      return;
    }
    onChange([...terms, { value, enabled: true }]);
    setText('');
    setError(null);
  };

  return (
    <div>
      <ul aria-label={label} className="flex flex-wrap gap-1.5">
        {terms.map((t, i) => (
          <li
            key={t.value}
            className={`flex items-center gap-1 rounded-md border border-rule bg-surface py-0.5 pr-1 pl-1.5 text-[12px] ${
              t.enabled ? '' : 'text-muted line-through'
            }`}
          >
            <label className="flex cursor-pointer items-center gap-1">
              <input
                type="checkbox"
                checked={t.enabled}
                onChange={(e) =>
                  onChange(
                    terms.map((x, j) => (j === i ? { ...x, enabled: e.currentTarget.checked } : x)),
                  )
                }
                className={`size-3 accent-[var(--ok)] ${focusRing}`}
              />
              {t.value}
            </label>
            <button
              type="button"
              aria-label={`Remove ${t.value}`}
              onClick={() => onChange(terms.filter((_, j) => j !== i))}
              className={`rounded px-1 text-muted hover:text-fail ${focusRing}`}
            >
              ×
            </button>
          </li>
        ))}
        {terms.length === 0 && <li className="text-[12px] text-muted">None yet.</li>}
      </ul>
      <div className="mt-2 flex gap-1.5">
        <label htmlFor={inputId} className="sr-only">
          Add to {label}
        </label>
        <input
          id={inputId}
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          maxLength={FILTER_LIMITS.maxTermLength + 10}
          className={`min-w-0 flex-1 rounded-md border border-rule bg-surface px-2 py-1 text-[12px] ${focusRing}`}
        />
        <button
          type="button"
          onClick={add}
          className={`rounded-md border border-rule bg-surface px-2 py-1 text-[12px] font-medium hover:border-muted ${focusRing}`}
        >
          Add
        </button>
      </div>
      {error && (
        <p role="alert" className="pt-1 text-[11px] text-fail">
          {error}
        </p>
      )}
    </div>
  );
}

function FieldChecks({
  fields,
  onChange,
}: {
  fields: readonly TextField[];
  onChange: (next: TextField[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px]" role="group" aria-label="Search in">
      <span className="text-muted">Search in</span>
      {TEXT_FIELDS.map((f) => (
        <label key={f} className="flex cursor-pointer items-center gap-1">
          <input
            type="checkbox"
            checked={fields.includes(f)}
            onChange={(e) =>
              onChange(
                e.currentTarget.checked
                  ? TEXT_FIELDS.filter((x) => x === f || fields.includes(x))
                  : fields.filter((x) => x !== f),
              )
            }
            className={`size-3.5 accent-[var(--ok)] ${focusRing}`}
          />
          {FIELD_LABEL[f]}
        </label>
      ))}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  suffix,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  suffix?: string;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <label htmlFor={id} className="w-16 text-muted">
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={0}
        max={FILTER_LIMITS.maxNumber}
        value={value ?? ''}
        placeholder="Any"
        onChange={(e) => {
          const raw = e.currentTarget.value;
          const n = raw === '' ? null : Number(raw);
          onChange(n === null || (Number.isFinite(n) && n >= 0) ? n : value);
        }}
        className={`w-24 rounded-md border border-rule bg-surface px-2 py-1 ${focusRing}`}
      />
      {suffix && <span className="text-muted">{suffix}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Panel                                                                */
/* ------------------------------------------------------------------ */

export function FiltersPanel({ view }: { view: FilterConfigView }) {
  const { draft: c, setDraft } = view;
  const patch = <K extends keyof FilterConfig>(key: K, value: Partial<FilterConfig[K]>) =>
    setDraft({ ...c, [key]: { ...(c[key] as object), ...value } });

  if (view.saved === null) {
    return <p className="px-4 py-4 text-[12px] text-muted">Loading filters…</p>;
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div>
          <h2 className="text-[14px] font-semibold">Advanced filters</h2>
          <p className="text-[12px] text-muted">
            Mark leads as matched or rejected. Nothing is clicked.
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
        <Section
          title="Countries"
          enabled={c.countries.enabled}
          onToggle={(on) => patch('countries', { enabled: on })}
        >
          <TermList
            label="Countries"
            terms={c.countries.values}
            onChange={(values) => patch('countries', { values })}
            placeholder="Country name or code, e.g. Germany or DE"
          />
          <Segmented
            label="Match"
            value={c.countries.mode}
            options={TERM_MODES}
            onChange={(mode) => patch('countries', { mode })}
            hint={c.countries.mode === 'ALL' ? 'A lead has one country' : undefined}
          />
        </Section>

        <Section
          title="Product keywords"
          enabled={c.keywords.enabled}
          onToggle={(on) => patch('keywords', { enabled: on })}
        >
          <TermList
            label="Product keywords"
            terms={c.keywords.values}
            onChange={(values) => patch('keywords', { values })}
            placeholder="e.g. Softgel"
          />
          <Segmented
            label="Match"
            value={c.keywords.mode}
            options={TERM_MODES}
            onChange={(mode) => patch('keywords', { mode })}
          />
          <FieldChecks
            fields={c.keywords.fields}
            onChange={(fields) => patch('keywords', { fields })}
          />
        </Section>

        <Section
          title="Exclude keywords"
          enabled={c.negativeKeywords.enabled}
          onToggle={(on) => patch('negativeKeywords', { enabled: on })}
        >
          <TermList
            label="Excluded keywords"
            terms={c.negativeKeywords.values}
            onChange={(values) => patch('negativeKeywords', { values })}
            placeholder="e.g. Sample"
          />
          <FieldChecks
            fields={c.negativeKeywords.fields}
            onChange={(fields) => patch('negativeKeywords', { fields })}
          />
        </Section>

        <Section
          title="Quantity"
          enabled={c.quantity.enabled}
          onToggle={(on) => patch('quantity', { enabled: on })}
        >
          <NumberField
            label="Minimum"
            value={c.quantity.min}
            onChange={(min) => patch('quantity', { min })}
          />
          <NumberField
            label="Maximum"
            value={c.quantity.max}
            onChange={(max) => patch('quantity', { max })}
          />
          <p className="text-[11px] text-muted">
            Leads without a quantity are rejected while this is on.
          </p>
        </Section>

        <Section
          title="Contact"
          enabled={c.contact.enabled}
          onToggle={(on) => patch('contact', { enabled: on })}
        >
          <div className="flex gap-3 text-[12px]" role="group" aria-label="Contact channels">
            {(['mobile', 'whatsapp', 'email'] as const).map((ch) => (
              <label key={ch} className="flex cursor-pointer items-center gap-1">
                <input
                  type="checkbox"
                  checked={c.contact[ch]}
                  onChange={(e) => patch('contact', { [ch]: e.currentTarget.checked })}
                  className={`size-3.5 accent-[var(--ok)] ${focusRing}`}
                />
                {ch === 'mobile' ? 'Mobile' : ch === 'whatsapp' ? 'WhatsApp' : 'Email'}
              </label>
            ))}
          </div>
          <Segmented
            label="Require"
            value={c.contact.mode}
            options={TERM_MODES}
            onChange={(mode) => patch('contact', { mode })}
          />
        </Section>

        <Section
          title="Lead age"
          enabled={c.leadAge.enabled}
          onToggle={(on) => patch('leadAge', { enabled: on })}
        >
          <NumberField
            label="Minimum"
            value={c.leadAge.minMinutes}
            onChange={(minMinutes) => patch('leadAge', { minMinutes })}
            suffix="min"
          />
          <NumberField
            label="Maximum"
            value={c.leadAge.maxMinutes}
            onChange={(maxMinutes) => patch('leadAge', { maxMinutes })}
            suffix="min"
          />
          <p className="text-[11px] text-muted">Age as shown when the lead was read.</p>
        </Section>

        <Section title="Combine">
          <Segmented<LogicMode>
            label="Groups"
            value={c.logic.mode}
            options={[
              { value: 'AND', label: 'All must pass' },
              { value: 'OR', label: 'Any may pass' },
            ]}
            onChange={(mode) => setDraft({ ...c, logic: { mode } })}
          />
          <p className="text-[11px] text-muted">Excluded keywords always reject.</p>
        </Section>
      </fieldset>

      <div className="sticky bottom-0 flex items-center gap-2 border-t border-rule bg-surface px-4 py-3">
        <button
          type="button"
          disabled={view.busy || !view.dirty || view.problem !== null}
          onClick={view.apply}
          className={`rounded-md bg-ink px-3 py-1.5 text-[13px] font-medium text-paper disabled:opacity-40 ${focusRing}`}
        >
          Apply filters
        </button>
        <button
          type="button"
          disabled={view.busy}
          onClick={view.reset}
          className={`rounded-md border border-rule px-3 py-1.5 text-[13px] font-medium hover:border-muted disabled:opacity-40 ${focusRing}`}
        >
          Reset to defaults
        </button>
        <p role="status" className="min-w-0 flex-1 text-right text-[11px] text-muted">
          {view.problem ?? view.message ?? (view.dirty ? 'Unsaved changes' : '')}
        </p>
      </div>
    </div>
  );
}
