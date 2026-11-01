import { useMemo, useState } from 'react';
import { AccountForm, TransferForm } from '../components/AccountForms';
import { GoalDetail, GoalForm, GoalStatusLine } from '../components/GoalForms';
import { sortAccounts } from '../lib/accounts';
import { roundMoney, sumMoney } from '../lib/currency';
import { makeConverter } from '../lib/fx';
import { goalProgress } from '../lib/goals';
import type { Account, Goal, Transfer } from '../lib/types';
import { useStore } from '../store';
import { EmptyState, Icon, Progress, useFmt } from '../ui';

type Tab = 'accounts' | 'goals';

export function Wallet({ initialTab = 'accounts' }: { initialTab?: Tab }) {
  const { t } = useStore();
  const [tab, setTab] = useState<Tab>(initialTab);
  return (
    <div className="view" data-testid="wallet">
      <div className="view-head">
        <h1 className="title">{t.navWallet}</h1>
        <a className="btn btn-soft" href="#/exchange" data-testid="wallet-open-exchange">
          <Icon name="swap" size={18} /> {t.navExchange}
        </a>
      </div>
      <div className="segmented" role="tablist">
        {(['accounts', 'goals'] as const).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'seg-on' : ''} onClick={() => setTab(k)} data-testid={`wallet-tab-${k}`}>
            {k === 'accounts' ? t.accounts : t.goals}
          </button>
        ))}
      </div>
      {tab === 'accounts' ? <Accounts /> : <Goals />}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Accounts() {
  const { data, t, balances, netWorth, moveAccount } = useStore();
  const { money, date } = useFmt();
  const [editing, setEditing] = useState<{ acc?: Account } | null>(null);
  const [transfer, setTransfer] = useState<{ x?: Transfer; from?: string } | null>(null);
  const all = sortAccounts(data.accounts);
  const active = all.filter((a) => !a.archived);
  const archived = all.filter((a) => a.archived);
  const accById = useMemo(() => new Map(data.accounts.map((a) => [a.id, a])), [data.accounts]);
  const toPrimary = useMemo(() => makeConverter(data.rates, data.settings.primaryCurrency, data.settings.manualFirstCurrencies), [data.rates, data.settings]);
  const unassigned = data.accounts.length ? data.transactions.filter((x) => x.accountId === null).length : 0;
  const transfers = [...data.transfers].sort((a, b) => (a.date === b.date ? b.createdAt.localeCompare(a.createdAt) : b.date.localeCompare(a.date))).slice(0, 10);

  const row = (a: Account, i: number, list: Account[]) => {
    const b = balances.get(a.id);
    const bal = b?.balance ?? a.openingBalance;
    const converted = a.currency !== data.settings.primaryCurrency ? toPrimary(bal, a.currency) : null;
    return (
      <li key={a.id} data-testid="account-item">
        <span className="tx-icon" style={{ background: `${a.color}22` }}>{a.icon}</span>
        <button className="cat-main" onClick={() => setEditing({ acc: a })}>
          <span className="tx-title">{a.name}</span>
          <span className="tx-sub">
            {a.currency}
            {converted !== null && ` · ≈ ${money(converted)}`}
            {b && b.upcoming !== 0 && ` · ${t.scheduled} ${money(b.upcoming, a.currency, { signed: true })}`}
            {b && b.unconverted > 0 && ` · ⚠ ${t.missingRateShort}`}
          </span>
        </button>
        <strong className={`acc-balance ${bal < 0 ? 'neg' : ''}`} data-testid="account-balance">{money(bal, a.currency)}</strong>
        {!a.archived && (
          <div className="reorder">
            <button className="icon-btn" disabled={i === 0} onClick={() => moveAccount(a.id, -1)} aria-label={t.moveUp}><Icon name="up" size={16} /></button>
            <button className="icon-btn" disabled={i === list.length - 1} onClick={() => moveAccount(a.id, 1)} aria-label={t.moveDown}><Icon name="down" size={16} /></button>
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="stack">
      <section className="hero-worth card" data-testid="net-worth">
        <span className="stat-label">{t.netWorth}</span>
        <strong className={`worth-value ${netWorth.total < 0 ? 'neg' : ''}`} data-testid="net-worth-value">{money(netWorth.total)}</strong>
        <div className="worth-split">
          <span>{t.assets}: <strong>{money(netWorth.assets)}</strong></span>
          <span>{t.liabilities}: <strong>{money(netWorth.liabilities)}</strong></span>
        </div>
        {netWorth.missingCurrencies.length > 0 && <p className="small warn-text">{t.missingRates(netWorth.missingCurrencies.join(', '))}</p>}
      </section>

      <div className="btn-grid">
        <button className="btn btn-primary" onClick={() => setEditing({})} data-testid="account-add"><Icon name="plus" size={18} /> {t.newAccount}</button>
        <button className="btn" onClick={() => setTransfer({})} disabled={active.length < 2} data-testid="transfer-add"><Icon name="swap" size={18} /> {t.newTransfer}</button>
      </div>

      <section className="card">
        <h2>{t.accounts}</h2>
        {active.length === 0 ? (
          <EmptyState icon="👛" title={t.noAccounts} hint={t.noAccountsHint} />
        ) : (
          <ul className="cat-list">{active.map((a, i) => row(a, i, active))}</ul>
        )}
        {unassigned > 0 && <p className="muted small">{t.unassignedNote(unassigned)}</p>}
        {archived.length > 0 && (
          <details>
            <summary>{t.archived} ({archived.length})</summary>
            <ul className="cat-list">{archived.map((a, i) => row(a, i, archived))}</ul>
          </details>
        )}
      </section>

      {transfers.length > 0 && (
        <section className="card" data-testid="transfer-list">
          <h2>{t.transfers}</h2>
          <ul className="tx-list">
            {transfers.map((x) => {
              const from = accById.get(x.fromAccountId);
              const to = accById.get(x.toAccountId);
              return (
                <li key={x.id}>
                  <button className="tx-row" onClick={() => setTransfer({ x })} data-testid="transfer-row">
                    <span className="tx-icon" aria-hidden="true">⇄</span>
                    <span className="tx-main">
                      <span className="tx-title">{from?.icon} {from?.name} → {to?.icon} {to?.name}</span>
                      <span className="tx-sub">{date(x.date, 'day')}{x.note && ` · ${x.note}`}</span>
                    </span>
                    <span className="tx-amount">
                      {money(x.amount, from?.currency)}
                      {from && to && from.currency !== to.currency && <span className="tx-cur">→ {money(x.toAmount, to.currency)}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {editing && <AccountForm initial={editing.acc} onClose={() => setEditing(null)} />}
      {transfer && <TransferForm initial={transfer.x} defaultFrom={transfer.from} onClose={() => setTransfer(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Goals() {
  const { data, t, today } = useStore();
  const { money } = useFmt();
  const [editing, setEditing] = useState<{ goal?: Goal } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = data.goals.find((g) => g.id === openId);
  const active = data.goals.filter((g) => !g.archived).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const archived = data.goals.filter((g) => g.archived);
  const s = data.settings;

  const totals = useMemo(() => {
    const conv = makeConverter(data.rates, s.primaryCurrency, s.manualFirstCurrencies);
    const saved: number[] = [];
    const target: number[] = [];
    for (const g of active) {
      const p = goalProgress(g, today, s.customCurrencies);
      const a = conv(p.saved, g.currency);
      const b = conv(g.target, g.currency);
      if (a !== null && b !== null) {
        saved.push(a);
        target.push(b);
      }
    }
    const r = (v: number) => roundMoney(v, s.primaryCurrency, s.customCurrencies);
    return { saved: r(sumMoney(saved)), target: r(sumMoney(target)) };
  }, [active, data.rates, s, today]);

  const card = (g: Goal) => {
    const p = goalProgress(g, today, s.customCurrencies);
    return (
      <li key={g.id}>
        <button className="goal-card" onClick={() => setOpenId(g.id)} style={{ '--cat': g.color } as React.CSSProperties} data-testid="goal-item">
          <span className="goal-head">
            <span className="tx-icon" style={{ background: `${g.color}22` }}>{g.icon}</span>
            <span className="tx-main">
              <span className="tx-title">{g.name}</span>
              <span className="tx-sub">{money(p.saved, g.currency)} / {money(g.target, g.currency)}</span>
            </span>
            <strong className="goal-pct">{Math.floor(p.ratio * 100)}%</strong>
          </span>
          <Progress ratio={p.ratio} tone={p.status === 'behind' || p.status === 'overdue' ? 'near' : 'ok'} />
          <GoalStatusLine goal={g} />
        </button>
      </li>
    );
  };

  return (
    <div className="stack">
      {active.length > 0 && (
        <section className="hero-worth card" data-testid="goals-total">
          <span className="stat-label">{t.goalsSaved}</span>
          <strong className="worth-value">{money(totals.saved)}</strong>
          <Progress ratio={totals.target ? totals.saved / totals.target : 0} tone="ok" />
          <span className="muted small">{t.goalsOfTarget(money(totals.target), active.length)}</span>
        </section>
      )}
      <button className="btn btn-primary" onClick={() => setEditing({})} data-testid="goal-add-open"><Icon name="plus" size={18} /> {t.newGoal}</button>
      {active.length === 0 ? (
        <section className="card"><EmptyState icon="🎯" title={t.noGoals} hint={t.noGoalsHint} /></section>
      ) : (
        <ul className="goal-list">{active.map(card)}</ul>
      )}
      {archived.length > 0 && (
        <details className="card">
          <summary>{t.archived} ({archived.length})</summary>
          <ul className="goal-list">{archived.map(card)}</ul>
        </details>
      )}
      <p className="muted small">{t.goalsVsReserve}</p>
      {open && !editing && <GoalDetail goal={open} onEdit={() => setEditing({ goal: open })} onClose={() => setOpenId(null)} />}
      {editing && <GoalForm initial={editing.goal} onClose={() => setEditing(null)} />}
    </div>
  );
}
