import { useEffect, useState } from 'react';
import { parseAmount } from '../lib/currency';

/** Numeric text input that only commits valid, non-negative numbers. Empty commits 0. */
export function NumberField({
  label,
  value,
  onCommit,
  hint,
  suffix,
  testId,
  integer,
  min,
  max,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  hint?: string;
  suffix?: string;
  testId?: string;
  integer?: boolean;
  min?: number;
  max?: number;
}) {
  const [text, setText] = useState(value ? String(value) : '');
  const [bad, setBad] = useState(false);
  useEffect(() => {
    setText((cur) => (parseAmount(cur) === value || (cur === '' && value === 0) ? cur : value ? String(value) : ''));
  }, [value]);

  const commit = (raw: string) => {
    const v = raw.trim() === '' ? 0 : parseAmount(raw);
    const ok = v !== null && (!integer || Number.isInteger(v)) && (min === undefined || v >= min) && (max === undefined || v <= max);
    setBad(!ok);
    if (ok && v !== value) onCommit(v);
  };

  return (
    <label className="field">
      <span>{label}</span>
      <div className="input-suffix">
        <input
          className={`input ${bad ? 'input-bad' : ''}`}
          inputMode={integer ? 'numeric' : 'decimal'}
          value={text}
          placeholder="0"
          onChange={(e) => {
            setText(e.target.value);
            commit(e.target.value);
          }}
          data-testid={testId}
          aria-invalid={bad}
        />
        {suffix && <span className="suffix">{suffix}</span>}
      </div>
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}
