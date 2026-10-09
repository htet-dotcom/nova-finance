import { useMemo, useState } from 'react';
import { ShareSheet } from '../components/ShareSheet';
import { TxRow } from '../components/TxRow';
import { addDays, maxKey } from '../lib/dates';
import { summarizeRange } from '../lib/engine';
import type { Transaction } from '../lib/types';
import { useStore } from '../store';
import { BarChart, EmptyState, Icon, Progress, Ring, useFmt } from '../ui';

export function Dashboard({ onEdit, go }: { onEdit: (tx: Transaction) => void; go: (route: string) => void }) {
  const { budget: b, data, t, today } = useStore();
  const { money, date, monthYear, pct } = useFmt();
  const [sharing, setSharing] = useState(false);
  const [explain, setExplain] = useState(false);
  const cats = useMemo(() => new Map(data.categories.map((c) => [c.id, c])), [data.categories]);

  const statusText = {
    ok: t.statusOk,
    near: t.statusNear,
    over: t.statusOver,
    depleted: t.statusDepleted,
    'no-income': t.statusNoIncome,
    ended: t.statusEnded,
    'not-started': t.statusNotStarted,
  }[b.status];
  const tone = b.status === 'over' || b.status === 'depleted' ? 'over' : b.status === 'near' ? 'near' : b.status === 'ok' ? 'ok' : 'idle';
  const ratio = b.dailyLimit > 0 ? b.spentToday / b.dailyLimit : b.spentToday > 0 ? 1 : 0;

  // Last 14 days of discretionary spending for the mini chart.
  const chart = useMemo(() => {
    // Fixed-cost categories are excluded so bars compare fairly against the daily limit.
    const start = maxKey(b.period.start, addDays(today, -13));
    const fixed = new Set(data.categories.filter((c) => c.fixed).map((c) => c.id));
    const transactions = data.transactions.filter((x) => !fixed.has(x.categoryId));
    return summarizeRange({ ...data, transactions, today }, { start, end: today }).byDay;
  }, [data, today, b.period.start]);

  const recent = useMemo(
    () => [...data.transactions].filter((x) => x.date <= today).sort((a, z) => (a.date === z.date ? z.createdAt.localeCompare(a.createdAt) : z.date.localeCompare(a.date))).slice(0, 5),
    [data.transactions, today],
  );

  const catWarnings = b.categoryBudgets.filter((c) => c.status !== 'ok').sort((a, z) => z.ratio - a.ratio);

  return (
    <div className="view" data-testid="dashboard">
      <div className="view-head">
        <div>
          <p className="eyebrow">{monthYear(today)}</p>
          <h1 className="title">{t.tagline}</h1>
        </div>
        <div className="head-actions">
          <button className="btn btn-soft" onClick={() => go('reports')} data-testid="open-reports" aria-label={t.navReports}>
            <Icon name="file" size={18} /> <span className="hide-xs">{t.navReports}</span>
          </button>
          <button className="btn btn-soft" onClick={() => setSharing(true)} data-testid="share-open" aria-label={t.share}>
            <Icon name="share" size={18} /> <span className="hide-xs">{t.share}</span>
          </button>
        </div>
      </div>

      <section className={`hero hero-${tone}`} data-testid="hero" data-status={b.status}>
        <Ring ratio={ratio} tone={tone}>
          <span className="ring-label">{t.canSpendToday}</span>
          <strong className="ring-amount" data-testid="left-today">
            {money(Math.max(0, b.todayRemaining))}
          </strong>
        </Ring>
        <div className="hero-side">
          <div className="hero-line">
            <span>{t.todayLimit}</span>
            <strong data-testid="daily-limit">{money(b.dailyLimit)}</strong>
          </div>
          <div className="hero-line">
            <span>{t.spentToday}</span>
            <strong data-testid="spent-today">{money(b.spentToday)}</strong>
          </div>
          <div className="hero-line">
            <span>{t.remainingDays}</span>
            <strong data-testid="days-left">{b.period.remainingDays}</strong>
          </div>
          <div className={`status-pill status-${tone}`} data-testid="status-pill">
            <Icon name={tone === 'over' ? 'alert' : tone === 'near' ? 'info' : 'check'} size={16} />
            {statusText}
          </div>
        </div>
      </section>

      {b.status === 'over' && (
        <div className="alert alert-over" role="alert" data-testid="over-warning">
          <Icon name="alert" />
          <div>
            <strong>{t.statusOver}</strong>
            <p>{t.overLimit(money(b.overBy))}</p>
          </div>
        </div>
      )}
      {b.status === 'no-income' && <div className="alert alert-info"><Icon name="info" /><p>{t.hintNoIncome}</p></div>}
      {b.status === 'depleted' && <div className="alert alert-over"><Icon name="alert" /><p>{t.hintDepleted}</p></div>}
      {b.status === 'ended' && <div className="alert alert-info"><Icon name="info" /><p>{t.hintEnded}</p></div>}
      {b.missingRateCurrencies.length > 0 && (
        <div className="alert alert-near" role="alert" data-testid="missing-rate">
          <Icon name="alert" />
          <p>{t.missingRates(b.missingRateCurrencies.join(', '))}</p>
        </div>
      )}

      <section className="stats">
        <Stat label={t.income} value={money(b.budgetIncome)} tone="income" testId="stat-income" />
        <Stat label={t.expenses} value={money(b.totalExpenses)} tone="expense" testId="stat-expenses" />
        <Stat label={t.remainingBalance} value={money(b.balance)} tone={b.balance < 0 ? 'expense' : undefined} testId="stat-balance" />
        <Stat label={t.savingsReserve} value={money(b.reserves.total)} testId="stat-reserve" />
        <Stat label={t.spendableLeft} value={money(b.remainingSpendable)} tone={b.remainingSpendable < 0 ? 'expense' : undefined} testId="stat-spendable" />
        <Stat label={t.tomorrowLimit} value={money(b.tomorrowLimit)} testId="stat-tomorrow" />
      </section>

      <section className="card">
        <div className="card-head">
          <h2>{t.periodLabel(date(b.period.start), date(b.period.end))}</h2>
          <span className="muted small">{t.daysLeftN(b.period.remainingDays)}</span>
        </div>
        <Progress ratio={b.period.totalDays ? b.period.daysElapsed / b.period.totalDays : 0} tone="ok" />
        <div className="kv-grid">
          <div><span>{t.avgDaily}</span><strong>{money(b.averageDailySpending)}</strong></div>
          <div><span>{t.projectedEnd}</span><strong className={b.projectedEndBalance < 0 ? 'neg' : ''}>{money(b.projectedEndBalance)}</strong></div>
          {(b.upcomingIncome > 0 || b.upcomingExpenses > 0) && (
            <div className="span-2"><span>{t.upcoming}</span><strong>+{money(b.upcomingIncome)} / −{money(b.upcomingExpenses)}</strong></div>
          )}
        </div>
        {chart.length > 1 && (
          <>
            <h3 className="sub">{t.dailySpending}</h3>
            <BarChart values={chart.map((d) => d.expense)} labels={chart.map((d) => String(Number(d.date.slice(8))))} limit={b.dailyLimit} format={(v) => money(v)} />
          </>
        )}
        <button className="link-btn" onClick={() => setExplain((x) => !x)} aria-expanded={explain}>
          <Icon name="info" size={16} /> {t.howCalculated}
        </button>
        {explain && (
          <div className="explain">
            <p>{data.settings.allowanceMode === 'even' ? t.calcExplainEven : t.calcExplain}</p>
            <p className="muted small">{t.fixedCovered}</p>
          </div>
        )}
      </section>

      {catWarnings.length > 0 && (
        <section className="card" data-testid="category-warnings">
          <h2>{t.categoryWarnings}</h2>
          <ul className="warn-list">
            {catWarnings.map((w) => {
              const c = cats.get(w.categoryId);
              return (
                <li key={w.categoryId} className={`warn-${w.status}`}>
                  <span className="warn-icon">{c?.icon}</span>
                  <div className="grow">
                    <p>{w.status === 'over' ? t.categoryOver(c?.name ?? '', money(-w.remaining)) : t.categoryNear(c?.name ?? '', pct(w.ratio))}</p>
                    <Progress ratio={w.ratio} tone={w.status} />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <h2>{t.recent}</h2>
          {recent.length > 0 && (
            <button className="link-btn" onClick={() => go('transactions')}>
              {t.seeAll}
            </button>
          )}
        </div>
        {recent.length === 0 ? (
          <EmptyState icon="🧾" title={t.noTransactions} hint={t.noTransactionsHint} />
        ) : (
          <ul className="tx-list">
            {recent.map((x) => (
              <TxRow key={x.id} tx={x} category={cats.get(x.categoryId)} onClick={() => onEdit(x)} />
            ))}
          </ul>
        )}
      </section>

      {sharing && <ShareSheet onClose={() => setSharing(false)} />}
    </div>
  );
}

function Stat({ label, value, tone, testId }: { label: string; value: string; tone?: 'income' | 'expense'; testId?: string }) {
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ''}`} data-testid={testId}>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
    </div>
  );
}
