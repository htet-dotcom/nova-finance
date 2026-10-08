import { useMemo, useState } from 'react';
import { sortCategories } from '../lib/categories';
import { allCurrencies, parseAmount } from '../lib/currency';
import { addDays, isDateKey } from '../lib/dates';
import type { Transaction, TxType } from '../lib/types';
import { useStore, ValidationError } from '../store';
import { Sheet, useConfirm, useFmt, useToast } from '../ui';

const LAST_CUR_KEY = 'nf.lastCurrency';

function readLastCurrency(): string | null {
  try {
    return localStorage.getItem(LAST_CUR_KEY);
  } catch {
    return null;
  }
}

export function TxForm({ initial, defaultType = 'expense', onClose }: { initial?: Transaction; defaultType?: TxType; onClose: () => void }) {
  const { data, t, today, saveTransaction, deleteTransaction } = useStore();
  const { date: fmtDate } = useFmt();
  const toast = useToast();
  const confirm = useConfirm();
  const s = data.settings;
  const currencies = allCurrencies(s.customCurrencies).filter((c) => s.enabledCurrencies.includes(c.code) || c.code === s.primaryCurrency || c.code === initial?.currency);

  const [type, setType] = useState<TxType>(initial?.type ?? defaultType);
  const [amountText, setAmountText] = useState(initial ? String(initial.amount) : '');
  const [currency, setCurrency] = useState(() => {
    const last = readLastCurrency();
    return initial?.currency ?? (last && currencies.some((c) => c.code === last) ? last : s.primaryCurrency);
  });
  const cats = useMemo(() => sortCategories(data.categories, type), [data.categories, type]);
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? cats[0]?.id ?? '');
  const [date, setDate] = useState(initial?.date ?? today);
  const [note, setNote] = useState(initial?.note ?? '');
  const [freq, setFreq] = useState<'none' | 'weekly' | 'monthly'>(initial?.recurring?.freq ?? 'none');
  const [until, setUntil] = useState(initial?.recurring?.until ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const switchType = (next: TxType) => {
    setType(next);
    const first = sortCategories(data.categories, next)[0];
    if (!data.categories.some((c) => c.id === categoryId && c.type === next)) setCategoryId(first?.id ?? '');
  };

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const amount = parseAmount(amountText);
    if (amount === null || amount <= 0) return setError(t.invalidAmount);
    if (!isDateKey(date)) return setError(t.invalidDate);
    if (freq !== 'none' && until && (!isDateKey(until) || until < date)) return setError(t.invalidDate);
    setBusy(true);
    try {
      await saveTransaction({
        id: initial?.id,
        type,
        amount,
        currency,
        categoryId,
        date,
        note,
        recurring: freq === 'none' ? null : { freq, until: until || null },
      });
      try {
        localStorage.setItem(LAST_CUR_KEY, currency);
      } catch {
        /* storage unavailable – not important */
      }
      toast(t.saved, 'success');
      onClose();
    } catch (err) {
      setError(
        err instanceof ValidationError
          ? err.message === 'date' || err.message === 'until'
            ? t.invalidDate
            : t.invalidAmount
          : (err as Error).message,
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!initial) return;
    if (!(await confirm.ask(t.deleteTxConfirm))) return;
    await deleteTransaction(initial.id);
    toast(t.deleted);
    onClose();
  };

  const yesterday = addDays(today, -1);

  return (
    <Sheet
      title={initial ? t.editTransaction : t.newTransaction}
      onClose={onClose}
      testId="tx-form"
      footer={
        <>
          {initial && (
            <button type="button" className="btn btn-danger-ghost" onClick={remove} data-testid="tx-delete">
              {t.delete}
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            {t.cancel}
          </button>
          <button type="submit" form="tx-form" className="btn btn-primary" disabled={busy} data-testid="tx-save">
            {t.save}
          </button>
        </>
      }
    >
      <form id="tx-form" onSubmit={submit} className="form" noValidate>
        <div className="segmented" role="tablist" aria-label={t.type}>
          <button type="button" role="tab" aria-selected={type === 'expense'} className={type === 'expense' ? 'seg-on seg-expense' : ''} onClick={() => switchType('expense')} data-testid="type-expense">
            {t.expense}
          </button>
          <button type="button" role="tab" aria-selected={type === 'income'} className={type === 'income' ? 'seg-on seg-income' : ''} onClick={() => switchType('income')} data-testid="type-income">
            {t.income}
          </button>
        </div>

        <div className="amount-row">
          <select aria-label={t.currency} value={currency} onChange={(e) => setCurrency(e.target.value)} className="currency-select" data-testid="tx-currency">
            {currencies.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code}
              </option>
            ))}
          </select>
          <input
            className="amount-input"
            inputMode="decimal"
            autoComplete="off"
            enterKeyHint="done"
            placeholder="0"
            aria-label={t.amount}
            value={amountText}
            onChange={(e) => {
              setAmountText(e.target.value);
              setError(null);
            }}
            autoFocus={!initial}
            data-testid="tx-amount"
          />
        </div>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}

        <fieldset className="field">
          <legend>{t.category}</legend>
          <div className="cat-grid">
            {cats.map((c) => (
              <button
                type="button"
                key={c.id}
                className={`cat-pick ${c.id === categoryId ? 'cat-pick-on' : ''}`}
                style={{ '--cat': c.color } as React.CSSProperties}
                onClick={() => setCategoryId(c.id)}
                aria-pressed={c.id === categoryId}
                data-testid={`cat-${c.id}`}
              >
                <span className="cat-pick-icon">{c.icon}</span>
                <span className="cat-pick-name">{c.name}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="field">
          <legend>{t.date}</legend>
          <div className="chips">
            <button type="button" className={`chip ${date === today ? 'chip-on' : ''}`} onClick={() => setDate(today)}>
              {t.today}
            </button>
            <button type="button" className={`chip ${date === yesterday ? 'chip-on' : ''}`} onClick={() => setDate(yesterday)}>
              {t.yesterday}
            </button>
            <input type="date" className="input date-input" value={date} onChange={(e) => setDate(e.target.value)} aria-label={t.date} data-testid="tx-date" />
          </div>
          {date > today && <p className="muted small">{t.futureBadge} · {fmtDate(date, 'long')}</p>}
        </fieldset>

        <label className="field">
          <span>{t.note}</span>
          <input className="input" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder={t.notePlaceholder} data-testid="tx-note" />
        </label>

        <div className="field-row">
          <label className="field">
            <span>{t.recurring}</span>
            <select className="input" value={freq} onChange={(e) => setFreq(e.target.value as typeof freq)} data-testid="tx-recurring">
              <option value="none">{t.recurringNone}</option>
              <option value="weekly">{t.recurringWeekly}</option>
              <option value="monthly">{t.recurringMonthly}</option>
            </select>
          </label>
          {freq !== 'none' && (
            <label className="field">
              <span>{t.recurringUntil}</span>
              <input type="date" className="input" value={until} min={date} onChange={(e) => setUntil(e.target.value)} />
            </label>
          )}
        </div>
      </form>
      {confirm.node}
    </Sheet>
  );
}
