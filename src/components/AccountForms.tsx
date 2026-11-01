import { useMemo, useState } from 'react';
import { ACCOUNT_ICONS, AccountOpError, sortAccounts } from '../lib/accounts';
import { allCurrencies, parseAmount, roundMoney } from '../lib/currency';
import { isDateKey } from '../lib/dates';
import { CATEGORY_COLORS } from '../lib/defaults';
import { makeConverter } from '../lib/fx';
import type { Account, Transfer } from '../lib/types';
import type { Dict } from '../i18n';
import { useStore } from '../store';
import { Sheet, useConfirm, useFmt, useToast } from '../ui';

export function accountErrorText(t: Dict, e: unknown): string {
  if (e instanceof AccountOpError) {
    return {
      'name-required': t.errNameRequired,
      'name-taken': t.errNameTaken,
      'invalid-amount': t.invalidAmount,
      'invalid-currency': t.invalidCurrency,
      'same-account': t.errSameAccount,
      'unknown-account': t.errUnknownAccount,
      'invalid-date': t.invalidDate,
    }[e.code];
  }
  return (e as Error)?.message ?? String(e);
}

/** Parses a signed amount ("-1,200.50" allowed). */
function parseSigned(text: string): number | null {
  const s = text.trim();
  if (!s) return 0;
  const neg = /^[-−]/.test(s);
  const v = parseAmount(s.replace(/^[-−]\s*/, ''));
  return v === null ? null : neg ? -v : v;
}

export function AccountForm({ initial, onClose }: { initial?: Account; onClose: () => void }) {
  const { data, t, saveAccount, deleteAccount } = useStore();
  const toast = useToast();
  const confirm = useConfirm();
  const s = data.settings;
  const currencies = allCurrencies(s.customCurrencies).filter((c) => s.enabledCurrencies.includes(c.code) || c.code === s.primaryCurrency || c.code === initial?.currency);
  const [name, setName] = useState(initial?.name ?? '');
  const [icon, setIcon] = useState(initial?.icon ?? ACCOUNT_ICONS[0]);
  const [color, setColor] = useState(initial?.color ?? CATEGORY_COLORS[data.accounts.length % CATEGORY_COLORS.length]);
  const [currency, setCurrency] = useState(initial?.currency ?? s.primaryCurrency);
  const [opening, setOpening] = useState(initial ? String(initial.openingBalance) : '');
  const [archived, setArchived] = useState(initial?.archived ?? false);
  const [error, setError] = useState<string | null>(null);
  const used = initial ? data.transactions.some((x) => x.accountId === initial.id) || data.transfers.some((x) => x.fromAccountId === initial.id || x.toAccountId === initial.id) : false;

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const openingBalance = parseSigned(opening);
    if (openingBalance === null) return setError(t.invalidAmount);
    try {
      await saveAccount({ id: initial?.id, name, icon, color, currency, openingBalance, archived });
      toast(t.saved, 'success');
      onClose();
    } catch (err) {
      setError(accountErrorText(t, err));
    }
  };

  const remove = async () => {
    if (!initial) return;
    if (!(await confirm.ask(used ? t.deleteAccountUsedConfirm(initial.name) : t.deleteAccountConfirm(initial.name)))) return;
    await deleteAccount(initial.id);
    toast(t.deleted);
    onClose();
  };

  return (
    <Sheet
      title={initial ? t.editAccount : t.newAccount}
      onClose={onClose}
      testId="account-form"
      footer={
        <>
          {initial && <button type="button" className="btn btn-danger-ghost" onClick={remove} data-testid="account-delete">{t.delete}</button>}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>{t.cancel}</button>
          <button type="submit" form="account-form" className="btn btn-primary" data-testid="account-save">{t.save}</button>
        </>
      }
    >
      <form id="account-form" className="form" onSubmit={submit} noValidate>
        <label className="field">
          <span>{t.accountName}</span>
          <input className="input" value={name} maxLength={60} onChange={(e) => { setName(e.target.value); setError(null); }} placeholder={t.accountNamePlaceholder} autoFocus={!initial} data-testid="account-name" />
        </label>
        <fieldset className="field">
          <legend>{t.icon}</legend>
          <div className="icon-grid">
            {ACCOUNT_ICONS.map((i) => (
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
            <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)} data-testid="account-currency">
              {currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
            </select>
          </label>
          <label className="field">
            <span>{t.openingBalance}</span>
            <input className="input" inputMode="decimal" value={opening} placeholder="0" onChange={(e) => { setOpening(e.target.value); setError(null); }} data-testid="account-opening" />
          </label>
        </div>
        <small className="muted">{t.openingBalanceHint}</small>
        {initial && (
          <label className="check">
            <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} data-testid="account-archived" />
            <span>{t.archiveAccount}</span>
          </label>
        )}
        {error && <p className="field-error" role="alert">{error}</p>}
      </form>
      {confirm.node}
    </Sheet>
  );
}

export function TransferForm({ initial, defaultFrom, onClose }: { initial?: Transfer; defaultFrom?: string; onClose: () => void }) {
  const { data, t, today, saveTransfer, deleteTransfer } = useStore();
  const { money } = useFmt();
  const toast = useToast();
  const confirm = useConfirm();
  const accounts = useMemo(
    () => sortAccounts(data.accounts).filter((a) => !a.archived || a.id === initial?.fromAccountId || a.id === initial?.toAccountId),
    [data.accounts, initial],
  );
  const [from, setFrom] = useState(initial?.fromAccountId ?? defaultFrom ?? accounts[0]?.id ?? '');
  const [to, setTo] = useState(initial?.toAccountId ?? accounts.find((a) => a.id !== (defaultFrom ?? accounts[0]?.id))?.id ?? '');
  const [amountText, setAmountText] = useState(initial ? String(initial.amount) : '');
  const [toText, setToText] = useState(initial ? String(initial.toAmount) : '');
  const [toTouched, setToTouched] = useState(!!initial);
  const [date, setDate] = useState(initial?.date ?? today);
  const [note, setNote] = useState(initial?.note ?? '');
  const [error, setError] = useState<string | null>(null);

  const fromAcc = accounts.find((a) => a.id === from);
  const toAcc = accounts.find((a) => a.id === to);
  const cross = !!fromAcc && !!toAcc && fromAcc.currency !== toAcc.currency;
  const amount = parseAmount(amountText);
  // Suggest the received amount from the current rate until the user types their own.
  const suggested = useMemo(() => {
    if (!cross || amount === null) return null;
    const v = makeConverter(data.rates, toAcc!.currency, data.settings.manualFirstCurrencies)(amount, fromAcc!.currency);
    return v === null ? null : roundMoney(v, toAcc!.currency, data.settings.customCurrencies);
  }, [cross, amount, data.rates, data.settings, fromAcc, toAcc]);
  const toValue = toTouched ? toText : suggested !== null ? String(suggested) : '';

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (amount === null || amount <= 0) return setError(t.invalidAmount);
    const toAmount = cross ? parseAmount(toValue) : amount;
    if (toAmount === null || toAmount <= 0) return setError(t.invalidAmount);
    if (!isDateKey(date)) return setError(t.invalidDate);
    try {
      await saveTransfer({ id: initial?.id, fromAccountId: from, toAccountId: to, amount, toAmount, date, note });
      toast(t.saved, 'success');
      onClose();
    } catch (err) {
      setError(accountErrorText(t, err));
    }
  };

  const remove = async () => {
    if (!initial || !(await confirm.ask(t.deleteTransferConfirm))) return;
    await deleteTransfer(initial.id);
    toast(t.deleted);
    onClose();
  };

  const option = (a: Account) => <option key={a.id} value={a.id}>{a.icon} {a.name} ({a.currency})</option>;

  return (
    <Sheet
      title={initial ? t.editTransfer : t.newTransfer}
      onClose={onClose}
      testId="transfer-form"
      footer={
        <>
          {initial && <button type="button" className="btn btn-danger-ghost" onClick={remove} data-testid="transfer-delete">{t.delete}</button>}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>{t.cancel}</button>
          <button type="submit" form="transfer-form" className="btn btn-primary" data-testid="transfer-save">{t.save}</button>
        </>
      }
    >
      <form id="transfer-form" className="form" onSubmit={submit} noValidate>
        <label className="field">
          <span>{t.transferFrom}</span>
          <select className="input" value={from} onChange={(e) => { setFrom(e.target.value); setToTouched(false); setError(null); }} data-testid="transfer-from">
            {accounts.map(option)}
          </select>
        </label>
        <label className="field">
          <span>{t.transferTo}</span>
          <select className="input" value={to} onChange={(e) => { setTo(e.target.value); setToTouched(false); setError(null); }} data-testid="transfer-to">
            {accounts.map(option)}
          </select>
        </label>
        <div className="field-row">
          <label className="field">
            <span>{t.amount}{fromAcc && ` (${fromAcc.currency})`}</span>
            <input className="input" inputMode="decimal" value={amountText} placeholder="0" onChange={(e) => { setAmountText(e.target.value); setError(null); }} data-testid="transfer-amount" />
          </label>
          {cross && (
            <label className="field">
              <span>{t.transferReceived} ({toAcc!.currency})</span>
              <input className="input" inputMode="decimal" value={toValue} placeholder="0" onChange={(e) => { setToTouched(true); setToText(e.target.value); setError(null); }} data-testid="transfer-to-amount" />
            </label>
          )}
        </div>
        {cross && suggested !== null && !toTouched && <small className="muted">{t.transferRateHint(money(suggested, toAcc!.currency))}</small>}
        <div className="field-row">
          <label className="field">
            <span>{t.date}</span>
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} data-testid="transfer-date" />
          </label>
          <label className="field">
            <span>{t.note}</span>
            <input className="input" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder={t.notePlaceholder} />
          </label>
        </div>
        <p className="muted small">{t.transferHint}</p>
        {error && <p className="field-error" role="alert">{error}</p>}
      </form>
      {confirm.node}
    </Sheet>
  );
}
