'use client';

import { useId, type ReactNode } from 'react';

// Small accessible form primitives: every control has a visible label,
// optional help text, and an error wired up with aria-describedby.

interface Common {
  label: string;
  help?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
}

function Shell({
  id,
  label,
  help,
  error,
  required,
  children,
}: Common & { id: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
        {required && (
          <span className="ms-1 text-accent" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children}
      {help && !error && (
        <p id={`${id}-help`} className="help">
          {help}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

const describedBy = (id: string, help?: string, error?: string) =>
  error ? `${id}-error` : help ? `${id}-help` : undefined;

export function TextField(
  props: Common & {
    value: string | null;
    onChange: (v: string | null) => void;
    maxLength?: number;
    placeholder?: string;
    lang?: string;
    type?: 'text' | 'date';
  },
) {
  const id = useId();
  return (
    <Shell id={id} {...props}>
      <input
        id={id}
        type={props.type ?? 'text'}
        className="field"
        value={props.value ?? ''}
        maxLength={props.maxLength}
        placeholder={props.placeholder}
        disabled={props.disabled}
        required={props.required}
        lang={props.lang}
        dir={props.type === 'date' ? undefined : 'auto'}
        aria-invalid={!!props.error}
        aria-describedby={describedBy(id, props.help, props.error)}
        onChange={(e) => props.onChange(e.target.value === '' ? null : e.target.value)}
      />
    </Shell>
  );
}

export function TextArea(
  props: Common & { value: string | null; onChange: (v: string | null) => void; maxLength?: number; lang?: string; rows?: number },
) {
  const id = useId();
  const length = props.value?.length ?? 0;
  return (
    <Shell id={id} {...props}>
      <textarea
        id={id}
        className="field min-h-24 resize-y"
        rows={props.rows ?? 4}
        value={props.value ?? ''}
        maxLength={props.maxLength}
        disabled={props.disabled}
        lang={props.lang}
        dir="auto"
        aria-invalid={!!props.error}
        aria-describedby={describedBy(id, props.help, props.error)}
        onChange={(e) => props.onChange(e.target.value === '' ? null : e.target.value)}
      />
      {props.maxLength && (
        <p className="mt-0.5 text-end text-xs tabular-nums text-muted" aria-hidden="true">
          {length} / {props.maxLength}
        </p>
      )}
    </Shell>
  );
}

export function NumberField(
  props: Common & { value: number | null; onChange: (v: number | null) => void; min?: number; max?: number; step?: number },
) {
  const id = useId();
  return (
    <Shell id={id} {...props}>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        className="field tabular-nums"
        value={props.value ?? ''}
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        disabled={props.disabled}
        aria-invalid={!!props.error}
        aria-describedby={describedBy(id, props.help, props.error)}
        onChange={(e) => props.onChange(e.target.value === '' ? null : Number(e.target.value))}
      />
    </Shell>
  );
}

export function SelectField<T extends string>(
  props: Common & { value: T | null; onChange: (v: T | null) => void; options: readonly { value: T; label: string }[]; placeholder: string },
) {
  const id = useId();
  return (
    <Shell id={id} {...props}>
      <select
        id={id}
        className="field"
        value={props.value ?? ''}
        disabled={props.disabled}
        aria-invalid={!!props.error}
        aria-describedby={describedBy(id, props.help, props.error)}
        onChange={(e) => props.onChange((e.target.value || null) as T | null)}
      >
        <option value="">{props.placeholder}</option>
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Shell>
  );
}

export function CheckboxField(props: { label: string; help?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex items-start gap-3 rounded-xl border border-line bg-white/60 p-3">
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 size-5 shrink-0 accent-accent"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <span className="text-sm">
        <span className="font-medium">{props.label}</span>
        {props.help && <span className="mt-0.5 block text-muted">{props.help}</span>}
      </span>
    </label>
  );
}

/** Card section with an anchor target for the step navigation. */
export function Step({
  id,
  number,
  title,
  lead,
  done,
  children,
}: {
  id: string;
  number: number;
  title: string;
  lead?: string;
  done: boolean;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="card scroll-mt-24 p-5 sm:p-6">
      <header className="mb-5 flex items-start gap-3">
        <span
          className={`grid size-8 shrink-0 place-items-center rounded-full text-sm font-semibold transition-colors ${
            done ? 'bg-success text-white' : 'bg-accent-soft text-accent'
          }`}
          aria-hidden="true"
        >
          {done ? '✓' : number}
        </span>
        <div>
          <h2 id={`${id}-title`} className="font-display text-xl font-semibold">
            {title}
          </h2>
          {lead && <p className="mt-0.5 text-sm text-muted">{lead}</p>}
        </div>
      </header>
      <div className="space-y-4">{children}</div>
    </section>
  );
}
