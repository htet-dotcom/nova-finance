import { useMemo, useState } from 'react';
import { CategoryEditor } from '../components/CategoryEditor';
import { NumberField } from '../components/NumberField';
import { sortCategories } from '../lib/categories';
import { addDays, monthRange, resolvePeriod, weekRange, type Range } from '../lib/dates';
import { summarizeRange } from '../lib/engine';
import type { Category, PeriodConfig, TxType } from '../lib/types';
import { useStore } from '../store';
import { BarChart, EmptyState, Icon, Progress, useFmt } from '../ui';

type Tab = 'summary' | 'rules' | 'categories';

export function Budget({ initialTab = 'summary' }: { initialTab?: Tab }) {
  const { t } = useStore();
  const [tab, setTab] = useState<Tab>(initialTab);
  return (
    <div className="view" data-testid="budget">
      <div className="view-head">
        <h1 className="title">{t.navBudget}</h1>
        <a className="btn btn-soft" href="#/reports" data-testid="budget-open-reports">
          <Icon name="file" size={18} /> {t.navReports}
        </a>
      </div>
      <div className="segmented" role="tablist">
        {(['summary', 'rules', 'categories'] as const).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'seg-on' : ''} onClick={() => setTab(k)} data-testid={`budget-tab-${k}`}>
            {k === 'summary' ? t.summary : k === 'rules' ? t.rules : t.categories}
          </button>
        ))}
      </div>
      {tab === 'summary' && <Summary />}
      {tab === 'rules' && <Rules />}
      {tab === 'categories' && <Categories />}
    </div>
  );
}

// ---------------------------------------------------------------------------

type RangeKey = 'today' | 'week' | 'month' | 'period' | 'custom';

function Summary() {
  const { data, t, today, budget } = useStore();
  const { money, date, pct } = useFmt();
  const [key, setKey] = useState<RangeKey>('period');
  const [custom, setCustom] = useState<Range>({ start: addDays(today, -29), end: today });
  const cats = useMemo(() => new Map(data.categories.map((c) => [c.id, c])), [data.categories]);

  const range: Range =
    key === 'today' ? { start: today, end: today } : key === 'week' ? weekRange(today) : key === 'month' ? monthRange(today) : key === 'period' ? resolvePeriod(data.settings.period, today) : custom;
  const r = useMemo(() => summarizeRange({ ...data, today }, range), [data, today, range.start, range.end]); // eslint-disable-line react-hooks/exhaustive-deps
  const top = r.topExpenseCategory ? cats.get(r.topExpenseCategory.categoryId) : undefined;

  return (
    <>
      <div className="chips scroll-x" role="tablist">
        {(['today', 'week', 'month', 'period', 'custom'] as const).map((k) => (
          <button key={k} className={`chip ${key === k ? 'chip-on' : ''}`} onClick={() => setKey(k)} data-testid={`range-${k}`}>
            {{ today: t.today, week: t.thisWeek, month: t.thisMonth, period: t.thisPeriod, custom: t.custom }[k]}
          </button>
        ))}
      </div>
      {key === 'custom' && (
        <div className="field-row card">
          <label className="field">
            <span>{t.fromDate}</span>
            <input type="date" className="input" value={custom.start} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, start: e.target.value }))} data-testid="custom-start" />
          </label>
          <label className="field">
            <span>{t.toDate}</span>
            <input type="date" className="input" value={custom.end} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, end: e.target.value }))} data-testid="custom-end" />
          </label>
        </div>
      )}
      <p className="muted small center">{range.start === range.end ? date(range.start, 'long') : `${date(range.start, 'long')} – ${date(range.end, 'long')}`}</p>

      <section className="stats" data-testid="summary-stats">
        <div className="stat stat-income"><span className="stat-label">{t.totalIncome}</span><strong className="stat-value" data-testid="sum-income">{money(r.totalIncome)}</strong></div>
        <div className="stat stat-expense"><span className="stat-label">{t.totalExpense}</span><strong className="stat-value" data-testid="sum-expense">{money(r.totalExpense)}</strong></div>
        <div className="stat"><span className="stat-label">{t.netBalance}</span><strong className={`stat-value ${r.net < 0 ? 'neg' : ''}`} data-testid="sum-net">{money(r.net)}</strong></div>
        <div className="stat"><span className="stat-label">{t.averageDaily}</span><strong className="stat-value" data-testid="sum-avg">{money(r.averageDailySpending)}</strong></div>
        <div className="stat"><span className="stat-label">{t.recommendedDaily}</span><strong className="stat-value">{money(budget.dailyLimit)}</strong></div>
        <div className="stat"><span className="stat-label">{t.remainingBudget}</span><strong className={`stat-value ${budget.remainingSpendable < 0 ? 'neg' : ''}`}>{money(budget.remainingSpendable)}</strong></div>
        <div className="stat"><span className="stat-label">{t.savings}</span><strong className="stat-value">{money(budget.reserves.savings)}</strong></div>
        <div className="stat"><span className="stat-label">{t.savingsRate}</span><strong className="stat-value">{r.savingsRate === null ? '—' : pct(r.savingsRate)}</strong></div>
      </section>

      {r.missingRateCurrencies.length > 0 && (
        <div className="alert alert-near"><Icon name="alert" /><p>{t.missingRates(r.missingRateCurrencies.join(', '))}</p></div>
      )}

      <section className="card">
        <h2>{t.spendingByCategory}</h2>
        {top && (
          <p className="muted small" data-testid="top-category">
            {t.highestCategory}: <strong>{top.icon} {top.name}</strong> · {money(r.topExpenseCategory!.amount)}
          </p>
        )}
        {r.expenseByCategory.length === 0 ? (
          <EmptyState icon="📊" title={t.noData} />
        ) : (
          <ul className="breakdown">
            {r.expenseByCategory.map((c) => {
              const cat = cats.get(c.categoryId);
              return (
                <li key={c.categoryId}>
                  <span className="bd-name">{cat?.icon} {cat?.name ?? '—'}</span>
                  <span className="bd-bar"><span style={{ width: `${Math.max(2, c.share * 100)}%`, background: cat?.color }} /></span>
                  <span className="bd-amt">{money(c.amount)} <small className="muted">{pct(c.share)}</small></span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {r.byDay.length > 1 && r.byDay.length <= 120 && (
        <section className="card">
          <h2>{t.dailySpending}</h2>
          <BarChart values={r.byDay.map((d) => d.expense)} labels={r.byDay.map((d) => String(Number(d.date.slice(8))))} format={(v) => money(v)} />
        </section>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function Rules() {
  const { data, t, updateSettings, budget } = useStore();
  const { money } = useFmt();
  const s = data.settings;
  const cur = s.primaryCurrency;
  const p = s.period;

  const setPeriod = (next: PeriodConfig) => updateSettings({ period: next });
  const periodKind = (kind: PeriodConfig['kind']) => {
    const today = budget.today;
    if (kind === 'month') setPeriod({ kind, startDay: 1 });
    if (kind === 'custom') setPeriod({ kind, start: budget.period.start, end: budget.period.end });
    if (kind === 'rolling') setPeriod({ kind, start: today, length: 30 });
  };

  return (
    <div className="stack">
      <section className="card form">
        <h2>{t.period}</h2>
        <div className="segmented small">
          {(['month', 'custom', 'rolling'] as const).map((k) => (
            <button key={k} className={p.kind === k ? 'seg-on' : ''} onClick={() => p.kind !== k && periodKind(k)} data-testid={`period-${k}`}>
              {{ month: t.periodMonth, custom: t.periodCustom, rolling: t.periodRolling }[k]}
            </button>
          ))}
        </div>
        {p.kind === 'month' && (
          <NumberField label={t.startDay} hint={t.startDayHint} value={p.startDay} integer min={1} max={31} onCommit={(v) => setPeriod({ kind: 'month', startDay: v })} testId="period-start-day" />
        )}
        {p.kind === 'custom' && (
          <div className="field-row">
            <label className="field"><span>{t.start}</span><input type="date" className="input" value={p.start} onChange={(e) => e.target.value && setPeriod({ ...p, start: e.target.value })} data-testid="period-custom-start" /></label>
            <label className="field"><span>{t.end}</span><input type="date" className="input" value={p.end} onChange={(e) => e.target.value && setPeriod({ ...p, end: e.target.value })} data-testid="period-custom-end" /></label>
          </div>
        )}
        {p.kind === 'rolling' && (
          <div className="field-row">
            <label className="field"><span>{t.start}</span><input type="date" className="input" value={p.start} onChange={(e) => e.target.value && setPeriod({ ...p, start: e.target.value })} /></label>
            <NumberField label={t.length} value={p.length} integer min={1} max={366} onCommit={(v) => setPeriod({ ...p, length: v })} testId="period-length" />
          </div>
        )}
      </section>

      <section className="card form">
        <h2>{t.incomeBasis}</h2>
        <label className="radio">
          <input type="radio" name="basis" checked={s.incomeBasis === 'recorded'} onChange={() => updateSettings({ incomeBasis: 'recorded' })} data-testid="basis-recorded" />
          <span>{t.incomeRecorded}</span>
        </label>
        {s.incomeBasis === 'recorded' && (
          <label className="check indent">
            <input type="checkbox" checked={s.includeUpcomingIncome} onChange={(e) => updateSettings({ includeUpcomingIncome: e.target.checked })} />
            <span>{t.includeUpcoming}</span>
          </label>
        )}
        <label className="radio">
          <input type="radio" name="basis" checked={s.incomeBasis === 'planned'} onChange={() => updateSettings({ incomeBasis: 'planned' })} data-testid="basis-planned" />
          <span>{t.incomePlanned}</span>
        </label>
        {s.incomeBasis === 'planned' && <NumberField label={t.plannedIncome} value={s.plannedIncome} suffix={cur} onCommit={(v) => updateSettings({ plannedIncome: v })} testId="planned-income" />}
      </section>

      <section className="card form">
        <h2>{t.reserves}</h2>
        <NumberField label={t.savingsTarget} value={s.savingsTarget} suffix={cur} onCommit={(v) => updateSettings({ savingsTarget: v })} testId="savings-target" />
        <NumberField label={t.emergencyReserve} value={s.emergencyReserve} suffix={cur} onCommit={(v) => updateSettings({ emergencyReserve: v })} testId="emergency-reserve" />
        <NumberField label={t.fixedExpenses} value={s.fixedExpenses} suffix={cur} hint={t.fixedExpensesHint} onCommit={(v) => updateSettings({ fixedExpenses: v })} testId="fixed-expenses" />
        <NumberField label={t.protectedAmount} value={s.protectedAmount} suffix={cur} onCommit={(v) => updateSettings({ protectedAmount: v })} testId="protected-amount" />
        <p className="preview" data-testid="spendable-preview">
          {t.spendablePreview(money(budget.spendable), money(budget.period.totalDays ? Math.max(0, budget.spendable) / budget.period.totalDays : 0))}
        </p>
      </section>

      <section className="card form">
        <h2>{t.allowanceMode}</h2>
        <label className="radio">
          <input type="radio" name="mode" checked={s.allowanceMode === 'dynamic'} onChange={() => updateSettings({ allowanceMode: 'dynamic' })} />
          <span>{t.modeDynamic}</span>
        </label>
        <label className="radio">
          <input type="radio" name="mode" checked={s.allowanceMode === 'even'} onChange={() => updateSettings({ allowanceMode: 'even' })} data-testid="mode-even" />
          <span>{t.modeEven}</span>
        </label>
        <label className="field">
          <span>{t.nearLimit}: <strong>{Math.round(s.nearLimitRatio * 100)}%</strong></span>
          <input type="range" min={50} max={100} step={5} value={Math.round(s.nearLimitRatio * 100)} onChange={(e) => updateSettings({ nearLimitRatio: Number(e.target.value) / 100 })} />
        </label>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Categories() {
  const { data, t, budget, moveCategory } = useStore();
  const { money } = useFmt();
  const [editing, setEditing] = useState<{ cat?: Category; type: TxType } | null>(null);
  const states = new Map(budget.categoryBudgets.map((b) => [b.categoryId, b]));

  return (
    <div className="stack">
      <p className="muted small">{t.setBudgetsHint}</p>
      {(['expense', 'income'] as const).map((type) => {
        const list = sortCategories(data.categories, type);
        return (
          <section key={type} className="card" data-testid={`cat-section-${type}`}>
            <div className="card-head">
              <h2>{type === 'expense' ? t.expense : t.income}</h2>
              <button className="btn btn-soft small" onClick={() => setEditing({ type })} data-testid={`cat-add-${type}`}>
                <Icon name="plus" size={16} /> {t.newCategory}
              </button>
            </div>
            <ul className="cat-list">
              {list.map((c, i) => {
                const st = states.get(c.id);
                return (
                  <li key={c.id} data-testid="cat-item">
                    <span className="tx-icon" style={{ background: `${c.color}22` }}>{c.icon}</span>
                    <button className="cat-main" onClick={() => setEditing({ cat: c, type })}>
                      <span className="tx-title">
                        {c.name} {c.fixed && <span className="badge">{t.fixedCost}</span>}
                      </span>
                      {st ? (
                        <>
                          <span className={`tx-sub ${st.status === 'over' ? 'neg' : ''}`}>
                            {t.budgetUsed(money(st.spent), money(st.budget))} · {st.remaining < 0 ? t.overBy(money(-st.remaining)) : t.leftOf(money(st.remaining))}
                          </span>
                          <Progress ratio={st.ratio} tone={st.status} />
                        </>
                      ) : (
                        type === 'expense' && <span className="tx-sub">{t.noBudget}</span>
                      )}
                    </button>
                    <div className="reorder">
                      <button className="icon-btn" disabled={i === 0} onClick={() => moveCategory(c.id, -1)} aria-label={t.moveUp}><Icon name="up" size={16} /></button>
                      <button className="icon-btn" disabled={i === list.length - 1} onClick={() => moveCategory(c.id, 1)} aria-label={t.moveDown}><Icon name="down" size={16} /></button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {editing && <CategoryEditor initial={editing.cat} type={editing.type} onClose={() => setEditing(null)} />}
    </div>
  );
}
