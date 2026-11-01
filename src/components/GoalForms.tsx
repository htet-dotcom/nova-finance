import { useState } from 'react';
import { parseAmountExpr } from '../lib/calc';
import { allCurrencies, parseAmount } from '../lib/currency';
import { isDateKey } from '../lib/dates';
import { CATEGORY_COLORS } from '../lib/defaults';
import { GOAL_ICONS, GoalOpError, goalProgress } from '../lib/goals';
import type { Goal } from '../lib/types';
import type { Dict } from '../i18n';
import { useStore } from '../store';
import { Icon, Progress, Sheet, useConfirm, useFmt, useToast } from '../ui';
import { CalcButton, ExprPreview } from './Calculator';

export function goalErrorText(t: Dict, e: unknown): string {
  if (e instanceof GoalOpError) {
    return {
      'name-required': t.errNameRequired,
      'invalid-target': t.invalidAmount,
      'invalid-amount': t.invalidAmount,
      'invalid-date': t.invalidDate,
      'invalid-currency': t.errGoalCurrency,
      'unknown-goal': t.errUnknownGoal,
      overdraw: t.errGoalOverdraw,
    }[e.code];
  }
  return (e as Error)?.message ?? String(e);
}

export function GoalForm({ initial, onClose }: { initial?: Goal; onClose: () => void }) {
  const { data, t, saveGoal, deleteGoal } = useStore();
  const toast = useToast();
  const confirm = useConfirm();
  const s = data.settings;
  const currencies = allCurrencies(s.customCurrencies).filter((c) => s.enabledCurrencies.includes(c.code) || c.code === s.primaryCurrency || c.code === initial?.currency);
  const [name, setName] = useState(initial?.name ?? '');
  const [icon, setIcon] = useState(initial?.icon ?? GOAL_ICONS[0]);
  const [color, setColor] = useState(initial?.color ?? CATEGORY_COLORS[(data.goals.length + 3) % CATEGORY_COLORS.length]);
  const [currency, setCurrency] = useState(initial?.currency ?? s.primaryCurrency);
  const [target, setTarget] = useState(initial ? String(initial.target) : '');
  const [deadline, setDeadline] = useState(initial?.deadline ?? '');
  const [archived, setArchived] = useState(initial?.archived ?? false);
  const [error, setError] = useState<string | null>(null);
  const locked = !!initial?.contributions.length;

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const v = parseAmount(target);
    if (v === null || v <= 0) return setError(t.invalidAmount);
    if (deadline && !isDateKey(deadline)) return setError(t.invalidDate);
    try {
      await saveGoal({ id: initial?.id, name, icon, color, currency, target: v, deadline: deadline || null, archived });
      toast(t.saved, 'success');
      onClose();
    } catch (err) {
      setError(goalErrorText(t, err));
    }
  };

  const remove = async () => {
    if (!initial || !(await confirm.ask(t.deleteGoalConfirm(initial.name)))) return;
    await deleteGoal(initial.id);
    toast(t.deleted);
    onClose();
  };

  return (
    <Sheet
      title={initial ? t.editGoal : t.newGoal}
      onClose={onClose}
      testId="goal-form"
      footer={
        <>
          {initial && <button type="button" className="btn btn-danger-ghost" onClick={remove} data-testid="goal-delete">{t.delete}</button>}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>{t.cancel}</button>
          <button type="submit" form="goal-form" className="btn btn-primary" data-testid="goal-save">{t.save}</button>
        </>
      }
    >
      <form id="goal-form" className="form" onSubmit={submit} noValidate>
        <label className="field">
          <span>{t.goalName}</span>
          <input className="input" value={name} maxLength={60} onChange={(e) => { setName(e.target.value); setError(null); }} placeholder={t.goalNamePlaceholder} autoFocus={!initial} data-testid="goal-name" />
        </label>
        <fieldset className="field">
          <legend>{t.icon}</legend>
          <div className="icon-grid">
            {GOAL_ICONS.map((i) => (
              <button type="button" key={i} className={`icon-pick ${i === icon ? 'on' : ''}`} onClick={() => setIcon(i)} aria-pressed={i === icon}>{i}</button>
            ))}
          </div>
        </fieldset>
        <fieldset className="field">
          <legend>{t.color}</legend>
          <div className="color-row">
            {CATEGORY_COLORS.map((c) => (
              <button type="button" key={c} className={`color-pick ${c === color ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} aria-pressed={c === color} />
            ))}
          </div>
        </fieldset>
        <div className="field-row">
          <label className="field">
            <span>{t.currency}</span>
            <select className="input" value={currency} disabled={locked} onChange={(e) => setCurrency(e.target.value)} data-testid="goal-currency">
              {currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
            </select>
          </label>
          <label className="field">
            <span>{t.goalTarget}</span>
            <input className="input" inputMode="decimal" value={target} placeholder="0" onChange={(e) => { setTarget(e.target.value); setError(null); }} data-testid="goal-target" />
          </label>
        </div>
        <label className="field">
          <span>{t.goalDeadline} <small className="muted">({t.optional})</small></span>
          <input type="date" className="input" value={deadline} onChange={(e) => setDeadline(e.target.value)} data-testid="goal-deadline" />
        </label>
        {initial && (
          <label className="check">
            <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
            <span>{t.archiveGoal}</span>
          </label>
        )}
        <p className="muted small">{t.goalHint}</p>
        {error && <p className="field-error" role="alert">{error}</p>}
      </form>
      {confirm.node}
    </Sheet>
  );
}

export function GoalDetail({ goal, onEdit, onClose }: { goal: Goal; onEdit: () => void; onClose: () => void }) {
  const { data, t, today, addGoalContribution, removeGoalContribution } = useStore();
  const { money, date } = useFmt();
  const toast = useToast();
  const confirm = useConfirm();
  const [mode, setMode] = useState<'deposit' | 'withdraw'>('deposit');
  const [amountText, setAmountText] = useState('');
  const [day, setDay] = useState(today);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const p = goalProgress(goal, today, data.settings.customCurrencies);
  const cur = goal.currency;
  const history = [...goal.contributions].sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));

  const add = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const v = parseAmountExpr(amountText, parseAmount);
    if (v === null || v <= 0) return setError(t.invalidAmount);
    try {
      await addGoalContribution(goal.id, { amount: mode === 'deposit' ? v : -v, date: day, note });
      setAmountText('');
      setNote('');
      setError(null);
      const done = mode === 'deposit' && p.saved < goal.target && p.saved + v >= goal.target;
      toast(done ? t.goalReached(goal.name) : t.saved, 'success');
    } catch (err) {
      setError(goalErrorText(t, err));
    }
  };

  const remove = async (id: string) => {
    if (!(await confirm.ask(t.deleteEntryConfirm))) return;
    try {
      await removeGoalContribution(goal.id, id);
    } catch (err) {
      toast(goalErrorText(t, err), 'error');
    }
  };

  return (
    <Sheet title={`${goal.icon} ${goal.name}`} onClose={onClose} testId="goal-detail" footer={<><button className="btn" onClick={onEdit} data-testid="goal-edit"><Icon name="edit" size={16} /> {t.edit}</button><span className="spacer" /><button className="btn btn-primary" onClick={onClose}>{t.done}</button></>}>
      <div className="goal-summary">
        <div className="goal-figures">
          <strong data-testid="goal-saved">{money(p.saved, cur)}</strong>
          <span className="muted"> / {money(goal.target, cur)}</span>
        </div>
        <Progress ratio={p.ratio} tone={p.status === 'behind' || p.status === 'overdue' ? 'near' : 'ok'} />
        <GoalStatusLine goal={goal} />
      </div>

      <form className="form card-inset" onSubmit={add} noValidate>
        <div className="segmented small">
          <button type="button" className={mode === 'deposit' ? 'seg-on seg-income' : ''} onClick={() => setMode('deposit')} data-testid="goal-mode-deposit">{t.goalDeposit}</button>
          <button type="button" className={mode === 'withdraw' ? 'seg-on seg-expense' : ''} onClick={() => setMode('withdraw')} data-testid="goal-mode-withdraw">{t.goalWithdraw}</button>
        </div>
        <div className="field-row">
          <label className="field">
            <span>{t.amount} ({cur})</span>
            <span className="input-calc">
              <input className="input" inputMode="decimal" value={amountText} placeholder="0" onChange={(e) => { setAmountText(e.target.value); setError(null); }} data-testid="goal-amount" />
              <CalcButton value={amountText} currency={cur} onResult={(v) => { setAmountText(v); setError(null); }} testId="goal-calc" />
            </span>
            <ExprPreview text={amountText} currency={cur} />
          </label>
          <label className="field">
            <span>{t.date}</span>
            <input type="date" className="input" value={day} onChange={(e) => setDay(e.target.value)} />
          </label>
        </div>
        <label className="field">
          <span>{t.note}</span>
          <input className="input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder={t.notePlaceholder} />
        </label>
        {error && <p className="field-error" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary" data-testid="goal-add">{mode === 'deposit' ? t.goalDeposit : t.goalWithdraw}</button>
      </form>

      <h3 className="sub">{t.goalHistory}</h3>
      {history.length === 0 ? (
        <p className="muted small">{t.goalNoHistory}</p>
      ) : (
        <ul className="rate-list" data-testid="goal-history">
          {history.map((c) => (
            <li key={c.id} className="rate-item">
              <span className="grow">
                {date(c.date, 'day')}
                {c.note && <span className="muted"> · {c.note}</span>}
              </span>
              <strong className={c.amount < 0 ? 'neg' : 'pos'}>{money(c.amount, cur, { signed: true })}</strong>
              <button className="icon-btn" aria-label={t.delete} onClick={() => remove(c.id)}><Icon name="trash" size={16} /></button>
            </li>
          ))}
        </ul>
      )}
      {confirm.node}
    </Sheet>
  );
}

export function GoalStatusLine({ goal }: { goal: Goal }) {
  const { data, t, today } = useStore();
  const { money, date } = useFmt();
  const p = goalProgress(goal, today, data.settings.customCurrencies);
  const cur = goal.currency;
  const text =
    p.status === 'done'
      ? t.goalDone
      : p.status === 'no-deadline'
        ? t.goalLeft(money(p.remaining, cur))
        : p.status === 'overdue'
          ? t.goalOverdue(date(goal.deadline!, 'long'), money(p.remaining, cur))
          : t.goalPace(money(p.perMonth ?? 0, cur), date(goal.deadline!, 'long'));
  return (
    <p className={`small goal-status goal-${p.status}`} data-testid="goal-status">
      <Icon name={p.status === 'done' ? 'check' : p.status === 'behind' || p.status === 'overdue' ? 'alert' : 'info'} size={14} />
      <span>
        {text}
        {p.status === 'behind' && ` · ${t.goalBehind}`}
      </span>
    </p>
  );
}
