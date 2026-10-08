import { useMemo, useState } from 'react';
import { allCurrencies, parseAmount, roundTo } from '../lib/currency';
import { MANUAL_LABEL, rateStatus, resolveRate, type RateStatus } from '../lib/fx';
import type { ExchangeRate } from '../lib/types';
import { useStore } from '../store';
import { Icon, useConfirm, useFmt, useToast } from '../ui';

export function Exchange() {
  const { data, t, online, refreshRates, rateRefresh, saveManualRate, deleteRate, updateSettings } = useStore();
  const { money, dateTime } = useFmt();
  const toast = useToast();
  const confirm = useConfirm();
  const s = data.settings;
  const currencies = allCurrencies(s.customCurrencies);

  const [from, setFrom] = useState('THB');
  const [to, setTo] = useState('MMK');
  const [amountText, setAmountText] = useState('1000');
  const amount = parseAmount(amountText);

  const resolved = useMemo(() => resolveRate(data.rates, from, to, { manualFirst: s.manualFirstCurrencies }), [data.rates, from, to, s.manualFirstCurrencies]);
  const result = resolved && amount !== null ? amount * resolved.rate : null;
  const status: RateStatus | null = resolved?.steps.length
    ? resolved.steps.some((st) => st.rateRecord.source === 'manual')
      ? 'manual'
      : resolved.steps.every((st) => rateStatus(st.rateRecord) === 'live')
        ? 'live'
        : 'cached'
    : null;

  // Manual rate form
  const [mBase, setMBase] = useState('THB');
  const [mQuote, setMQuote] = useState('MMK');
  const existing = data.rates.find((r) => r.source === 'manual' && r.base === mBase && r.quote === mQuote);
  const [mRate, setMRate] = useState(existing ? String(existing.rate) : '');
  const [mLabel, setMLabel] = useState(existing?.sourceLabel ?? MANUAL_LABEL);
  const [mError, setMError] = useState<string | null>(null);

  const pickPair = (base: string, quote: string) => {
    setMBase(base);
    setMQuote(quote);
    const ex = data.rates.find((r) => r.source === 'manual' && r.base === base && r.quote === quote);
    setMRate(ex ? String(ex.rate) : '');
    setMLabel(ex?.sourceLabel ?? MANUAL_LABEL);
    setMError(null);
  };

  const saveManual = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = parseAmount(mRate);
    if (r === null || r <= 0 || mBase === mQuote) return setMError(t.invalidRate);
    await saveManualRate(mBase, mQuote, r, mLabel || MANUAL_LABEL);
    toast(t.rateSaved, 'success');
  };

  const manual = data.rates.filter((r) => r.source === 'manual').sort((a, b) => a.id.localeCompare(b.id));
  const providerRates = data.rates.filter((r) => r.source === 'provider').sort((a, b) => a.quote.localeCompare(b.quote));
  const lastFetch = providerRates.reduce<string | null>((m, r) => (r.fetchedAt && (!m || r.fetchedAt > m) ? r.fetchedAt : m), null);

  const statusLabel = (st: RateStatus) => ({ live: t.statusLive, cached: t.statusCached, manual: t.statusManual })[st];
  const fmtRate = (v: number) => (v >= 100 ? roundTo(v, 2) : v >= 1 ? roundTo(v, 4) : Number(v.toPrecision(6))).toLocaleString('en-US', { maximumFractionDigits: 8 });

  return (
    <div className="view" data-testid="exchange">
      <div className="view-head">
        <h1 className="title">{t.navExchange}</h1>
        {s.rateProviderEnabled && (
          <button className="btn btn-soft" onClick={async () => { await refreshRates(); }} disabled={!online || rateRefresh.status === 'loading'} data-testid="refresh-rates">
            <Icon name="refresh" size={18} /> <span className="hide-xs">{rateRefresh.status === 'loading' ? t.refreshing : t.refreshRates}</span>
          </button>
        )}
      </div>

      {!online && <div className="alert alert-info"><Icon name="wifiOff" /><p>{t.offlineRates}</p></div>}
      {rateRefresh.status === 'error' && online && <div className="alert alert-near"><Icon name="alert" /><p>{t.ratesFailed}</p></div>}

      <section className="card calc" data-testid="calculator">
        <h2>{t.calculator}</h2>
        <div className="calc-grid">
          <label className="field">
            <span>{t.from}</span>
            <select className="input" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="calc-from">
              {currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
            </select>
          </label>
          <button className="icon-btn swap-btn" onClick={() => { setFrom(to); setTo(from); }} aria-label={t.swap} data-testid="calc-swap">
            <Icon name="swap" />
          </button>
          <label className="field">
            <span>{t.to}</span>
            <select className="input" value={to} onChange={(e) => setTo(e.target.value)} data-testid="calc-to">
              {currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
            </select>
          </label>
        </div>
        <label className="field">
          <span>{t.amount}</span>
          <input className="input amount-input" inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} data-testid="calc-amount" />
        </label>
        <div className="calc-result" data-testid="calc-result">
          {resolved && result !== null ? (
            <>
              <span className="muted small">{t.result}</span>
              <strong className="calc-value" data-testid="calc-value">{money(result, to)}</strong>
              <span className="small">
                {t.rate}: 1 {from} = <strong data-testid="calc-rate">{fmtRate(resolved.rate)}</strong> {to}
              </span>
              {status && (
                <span className={`rate-badge rate-${status}`} data-testid="calc-status">
                  {statusLabel(status)}
                </span>
              )}
              {resolved.steps.length > 0 && (
                <span className="muted small">
                  {t.rateSource}: {[...new Set(resolved.steps.map((st) => st.rateRecord.sourceLabel))].join(' + ')}
                  {resolved.steps.length > 1 && ` · ${t.viaPath([from, ...resolved.steps.map((st) => st.to)].join(' → '))}`}
                </span>
              )}
              {resolved.updatedAt && <span className="muted small">{t.rateUpdated}: {dateTime(resolved.updatedAt)}</span>}
            </>
          ) : resolved ? (
            <span className="muted">{t.invalidAmount}</span>
          ) : (
            <span className="muted" data-testid="calc-no-rate">{t.noRate}</span>
          )}
        </div>
      </section>

      <section className="card form" data-testid="mmk-rate">
        <h2>{t.mmkTitle}</h2>
        <p className="muted small">{t.mmkNote}</p>
        <div className="chips">
          {['THB', 'USD'].map((b) => (
            <button key={b} className={`chip ${mBase === b && mQuote === 'MMK' ? 'chip-on' : ''}`} onClick={() => pickPair(b, 'MMK')} data-testid={`mmk-pair-${b}`}>
              1 {b} = ? MMK
            </button>
          ))}
        </div>
        <form onSubmit={saveManual} className="form" noValidate>
          <div className="field-row">
            <label className="field">
              <span>{t.from}</span>
              <select className="input" value={mBase} onChange={(e) => pickPair(e.target.value, mQuote)} data-testid="manual-base">
                {currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
              </select>
            </label>
            <label className="field">
              <span>{t.to}</span>
              <select className="input" value={mQuote} onChange={(e) => pickPair(mBase, e.target.value)} data-testid="manual-quote">
                {currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
              </select>
            </label>
          </div>
          <label className="field">
            <span>1 {mBase} = ? {mQuote}</span>
            <input className="input" inputMode="decimal" value={mRate} onChange={(e) => { setMRate(e.target.value); setMError(null); }} placeholder="0" data-testid="manual-rate" />
          </label>
          <label className="field">
            <span>{t.sourceLabel}</span>
            <input className="input" value={mLabel} maxLength={120} onChange={(e) => setMLabel(e.target.value)} placeholder={t.sourceLabelHint} data-testid="manual-label" />
          </label>
          {mError && <p className="field-error">{mError}</p>}
          <button className="btn btn-primary" type="submit" data-testid="manual-save">{t.save}</button>
        </form>
      </section>

      <section className="card" data-testid="manual-rates">
        <h2>{t.manualRates}</h2>
        {manual.length === 0 ? (
          <p className="muted small">{t.noManualRates}</p>
        ) : (
          <ul className="rate-list">
            {manual.map((r) => (
              <RateItem key={r.id} r={r} fmt={fmtRate} statusLabel={statusLabel(rateStatus(r))} onEdit={() => pickPair(r.base, r.quote)} onDelete={async () => {
                if (await confirm.ask(`${t.delete}: 1 ${r.base} = ${fmtRate(r.rate)} ${r.quote}?`)) {
                  await deleteRate(r.id);
                  toast(t.rateDeleted);
                }
              }} />
            ))}
          </ul>
        )}
        <div className="field">
          <span className="small">{t.manualFirst}</span>
          <div className="chips">
            {['MMK', ...s.manualFirstCurrencies.filter((c) => c !== 'MMK')].map((c) => {
              const on = s.manualFirstCurrencies.includes(c);
              return (
                <button key={c} className={`chip ${on ? 'chip-on' : ''}`} aria-pressed={on} onClick={() => updateSettings({ manualFirstCurrencies: on ? s.manualFirstCurrencies.filter((x) => x !== c) : [...s.manualFirstCurrencies, c] })}>
                  {on ? '✓ ' : ''}{c}
                </button>
              );
            })}
          </div>
          <small className="muted">{t.manualFirstHint}</small>
        </div>
      </section>

      <section className="card" data-testid="provider-rates">
        <div className="card-head">
          <h2>{t.providerRates}</h2>
          {lastFetch && <span className="muted small">{t.rateFetched}: {dateTime(lastFetch)}</span>}
        </div>
        {!s.rateProviderEnabled && <p className="muted small">{t.providerDisabled}</p>}
        {providerRates.length === 0 ? (
          <p className="muted small">{t.noProviderRates}</p>
        ) : (
          <>
            <p className="muted small">{t.providerNote}</p>
            <ul className="rate-list compact">
              {providerRates.map((r) => (
                <RateItem key={r.id} r={r} fmt={fmtRate} statusLabel={statusLabel(rateStatus(r))} />
              ))}
            </ul>
          </>
        )}
      </section>
      {confirm.node}
    </div>
  );
}

function RateItem({ r, fmt, statusLabel, onEdit, onDelete }: { r: ExchangeRate; fmt: (v: number) => string; statusLabel: string; onEdit?: () => void; onDelete?: () => void }) {
  const { t } = useStore();
  const { dateTime } = useFmt();
  const st = rateStatus(r);
  return (
    <li className="rate-item" data-testid={`rate-${r.id}`}>
      <div className="grow">
        <strong>1 {r.base} = {fmt(r.rate)} {r.quote}</strong>
        <span className="muted small block">
          <span className={`rate-badge rate-${st}`}>{statusLabel}</span> {r.sourceLabel !== statusLabel && r.sourceLabel} · {t.rateUpdated}: {dateTime(r.updatedAt)}
        </span>
      </div>
      {onEdit && <button className="icon-btn" onClick={onEdit} aria-label={t.edit}><Icon name="edit" size={16} /></button>}
      {onDelete && <button className="icon-btn" onClick={onDelete} aria-label={t.delete}><Icon name="trash" size={16} /></button>}
    </li>
  );
}
