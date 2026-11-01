import { useMemo, useState, type ReactNode } from 'react';
import { addMonths, monthRange, parts, type Range } from '../lib/dates';
import { summarizeRange } from '../lib/engine';
import { buildInsights, compareToLastMonth, monthlyTrend, weekdayAverages, type Insight } from '../lib/insights';
import { dateLocale } from '../i18n';
import { useStore } from '../store';
import { EmptyState, Icon, useFmt } from '../ui';

type RangeKey = 'month' | 'last-month' | '3-months' | 'year';

export function Insights() {
  const { data, t, today } = useStore();
  const { money, pct, date } = useFmt();
  const [key, setKey] = useState<RangeKey>('month');
  const input = useMemo(() => ({ ...data, today }), [data, today]);
  const cats = useMemo(() => new Map(data.categories.map((c) => [c.id, c])), [data.categories]);
  const loc = `${dateLocale(data.settings.language)}-u-nu-latn`;
  const shortMonth = (ym: string) => {
    const { y, m } = parts(`${ym}-01`);
    return new Intl.DateTimeFormat(loc, { month: 'short' }).format(new Date(y, m - 1, 1));
  };
  const longMonth = (ym: string) => {
    const { y, m } = parts(`${ym}-01`);
    return new Intl.DateTimeFormat(loc, { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1));
  };
  const weekdays = useMemo(() => {
    // 2024-01-01 is a Monday.
    return Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(loc, { weekday: 'short' }).format(new Date(2024, 0, 1 + i)));
  }, [loc]);
  const weekdaysLong = useMemo(
    () => Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(loc, { weekday: 'long' }).format(new Date(2024, 0, 1 + i))),
    [loc],
  );

  const range: Range = useMemo(() => {
    const m = monthRange(today);
    if (key === 'month') return m;
    if (key === 'last-month') return monthRange(addMonths(m.start, -1, 1));
    if (key === '3-months') return { start: addMonths(m.start, -2, 1), end: m.end };
    return { start: `${today.slice(0, 4)}-01-01`, end: `${today.slice(0, 4)}-12-31` };
  }, [key, today]);

  const summary = useMemo(() => summarizeRange(input, range), [input, range]);
  const trend = useMemo(() => monthlyTrend(input, 6), [input]);
  const cmp = useMemo(() => compareToLastMonth(input), [input]);
  const wd = useMemo(() => weekdayAverages(input), [input]);
  const insights = useMemo(() => buildInsights(input), [input]);
  const hasData = data.transactions.length > 0;

  const insightText = (x: Insight): { icon: string; tone: 'good' | 'bad' | 'neutral'; text: string } => {
    switch (x.kind) {
      case 'pace':
        return x.change > 0
          ? { icon: '📈', tone: 'bad', text: t.insPaceUp(pct(x.change), money(x.current), money(x.previous)) }
          : { icon: '📉', tone: 'good', text: t.insPaceDown(pct(-x.change), money(x.current), money(x.previous)) };
      case 'category-up':
      case 'category-down': {
        const c = cats.get(x.categoryId);
        const name = `${c?.icon ?? ''} ${c?.name ?? '—'}`.trim();
        return x.kind === 'category-up'
          ? { icon: '⬆️', tone: 'bad', text: t.insCatUp(name, pct(x.change), money(x.current - x.previous)) }
          : { icon: '⬇️', tone: 'good', text: t.insCatDown(name, pct(-x.change), money(x.previous - x.current)) };
      }
      case 'top-weekday':
        return { icon: '📅', tone: 'neutral', text: t.insWeekday(weekdaysLong[x.weekday], money(x.average), money(x.overall)) };
      case 'savings-rate':
        return x.rate >= 0
          ? { icon: '🐷', tone: x.rate >= 0.2 ? 'good' : 'neutral', text: t.insSavings(longMonth(x.month), pct(x.rate)) }
          : { icon: '⚠️', tone: 'bad', text: t.insOverspent(longMonth(x.month), pct(-x.rate)) };
      case 'no-spend-days':
        return { icon: '✨', tone: 'good', text: t.insNoSpend(x.count, x.days) };
    }
  };

  return (
    <div className="view" data-testid="insights">
      <div className="view-head">
        <h1 className="title">{t.navInsights}</h1>
        <a className="btn btn-soft" href="#/reports"><Icon name="file" size={18} /> <span className="hide-xs">{t.navReports}</span></a>
      </div>

      {!hasData ? (
        <section className="card"><EmptyState icon="📊" title={t.noData} hint={t.insightsEmptyHint} /></section>
      ) : (
        <>
          <section className="card" data-testid="insight-list">
            <h2>{t.highlights}</h2>
            {insights.length === 0 ? (
              <p className="muted small">{t.insNone}</p>
            ) : (
              <ul className="insight-list">
                {insights.map((x, i) => {
                  const v = insightText(x);
                  return (
                    <li key={i} className={`insight insight-${v.tone}`} data-kind={x.kind}>
                      <span className="insight-icon" aria-hidden="true">{v.icon}</span>
                      <p>{v.text}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="card" data-testid="compare-card">
            <h2>{t.thisMonthVsLast}</h2>
            <p className="muted small">{t.compareNote(date(cmp.previous.start), date(cmp.previous.end))}</p>
            <div className="kv-grid">
              <div><span>{t.thisMonthSoFar}</span><strong data-testid="cmp-current">{money(cmp.currentTotal)}</strong></div>
              <div><span>{t.lastMonthSameDays}</span><strong>{money(cmp.previousTotal)}</strong></div>
            </div>
            {cmp.change !== null && (
              <p className={`delta ${cmp.change > 0 ? 'delta-up' : 'delta-down'}`}>
                {cmp.change > 0 ? '▲' : '▼'} {pct(Math.abs(cmp.change))} {cmp.change > 0 ? t.more : t.less}
              </p>
            )}
          </section>

          <section className="card" data-testid="trend-card">
            <h2>{t.incomeVsExpense}</h2>
            <GroupedBars
              series={[{ name: t.income, cls: 'series-income' }, { name: t.expense, cls: 'series-expense' }]}
              groups={trend.map((m) => ({ label: shortMonth(m.month), title: longMonth(m.month) + (m.partial ? ` (${t.soFar})` : ''), values: [m.income, m.expense] }))}
              format={(v) => money(v)}
              ariaLabel={t.incomeVsExpense}
            />
            <details className="table-view">
              <summary>{t.showTable}</summary>
              <table className="data-table">
                <thead><tr><th>{t.month}</th><th>{t.income}</th><th>{t.expense}</th><th>{t.netBalance}</th></tr></thead>
                <tbody>
                  {trend.map((m) => (
                    <tr key={m.month}><td>{longMonth(m.month)}</td><td>{money(m.income)}</td><td>{money(m.expense)}</td><td className={m.net < 0 ? 'neg' : ''}>{money(m.net)}</td></tr>
                  ))}
                </tbody>
              </table>
            </details>
          </section>

          <section className="card" data-testid="category-card">
            <div className="card-head">
              <h2>{t.spendingByCategory}</h2>
            </div>
            <div className="chips scroll-x" role="tablist">
              {(['month', 'last-month', '3-months', 'year'] as const).map((k) => (
                <button key={k} className={`chip ${key === k ? 'chip-on' : ''}`} onClick={() => setKey(k)} data-testid={`ins-range-${k}`}>
                  {{ month: t.thisMonth, 'last-month': t.lastMonth, '3-months': t.last3Months, year: t.thisYear }[k]}
                </button>
              ))}
            </div>
            <div className="kv-grid">
              <div><span>{t.totalExpense}</span><strong data-testid="ins-total">{money(summary.totalExpense)}</strong></div>
              <div><span>{t.averageDaily}</span><strong>{money(summary.averageDailySpending)}</strong></div>
            </div>
            {summary.expenseByCategory.length === 0 ? (
              <EmptyState icon="📊" title={t.noData} />
            ) : (
              <>
                <ShareBar items={summary.expenseByCategory.map((c) => ({ id: c.categoryId, share: c.share, color: cats.get(c.categoryId)?.color ?? '#64748b', label: `${cats.get(c.categoryId)?.name ?? '—'}: ${money(c.amount)} (${pct(c.share)})` }))} />
                <ul className="breakdown">
                  {summary.expenseByCategory.map((c) => {
                    const cat = cats.get(c.categoryId);
                    return (
                      <li key={c.categoryId}>
                        <span className="bd-name"><span className="swatch" style={{ background: cat?.color }} aria-hidden="true" /> {cat?.icon} {cat?.name ?? '—'}</span>
                        <span className="bd-bar"><span style={{ width: `${Math.max(2, c.share * 100)}%`, background: cat?.color }} /></span>
                        <span className="bd-amt">{money(c.amount)} <small className="muted">{pct(c.share)} · {t.reportTransactions(c.count)}</small></span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </section>

          <section className="card" data-testid="weekday-card">
            <h2>{t.byWeekday}</h2>
            <p className="muted small">{t.byWeekdayNote}</p>
            <GroupedBars
              series={[{ name: t.avgDaily, cls: 'series-single' }]}
              groups={wd.averages.map((v, i) => ({ label: weekdays[i], title: weekdays[i], values: [v] }))}
              format={(v) => money(v)}
              ariaLabel={t.byWeekday}
            />
          </section>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Charts: plain HTML bars (crisp at any size, rounded data ends, accessible tooltips)
// ---------------------------------------------------------------------------

function GroupedBars({
  groups,
  series,
  format,
  ariaLabel,
}: {
  groups: { label: string; title: string; values: number[] }[];
  series: { name: string; cls: string }[];
  format: (v: number) => string;
  ariaLabel: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...groups.flatMap((g) => g.values));
  const tip = (g: (typeof groups)[number]): ReactNode => (
    <>
      <strong>{g.title}</strong>
      {series.map((s, i) => (
        <span key={s.name} className="tip-row">
          {series.length > 1 && <span className={`swatch ${s.cls}`} aria-hidden="true" />}
          {series.length > 1 && `${s.name}: `}
          <b>{format(g.values[i])}</b>
        </span>
      ))}
    </>
  );
  return (
    <figure className="gbar" aria-label={ariaLabel}>
      {series.length > 1 && (
        <figcaption className="legend">
          {series.map((s) => (
            <span key={s.name}><span className={`swatch ${s.cls}`} aria-hidden="true" /> {s.name}</span>
          ))}
        </figcaption>
      )}
      <div className="gbar-plot" onMouseLeave={() => setHover(null)}>
        <span className="gbar-max" aria-hidden="true">{format(max)}</span>
        {groups.map((g, gi) => (
          <div
            key={gi}
            className={`gbar-group ${hover === gi ? 'on' : ''}`}
            tabIndex={0}
            role="img"
            aria-label={`${g.title}: ${series.map((s, i) => `${series.length > 1 ? `${s.name} ` : ''}${format(g.values[i])}`).join(', ')}`}
            onMouseEnter={() => setHover(gi)}
            onFocus={() => setHover(gi)}
            onBlur={() => setHover(null)}
          >
            <div className="gbar-bars">
              {g.values.map((v, i) => (
                <span key={i} className={`gbar-bar ${series[i].cls}`} style={{ height: `${(v / max) * 100}%` }} />
              ))}
            </div>
            {hover === gi && <div className={`gbar-tip ${gi > groups.length / 2 ? 'left' : ''}`} role="tooltip">{tip(g)}</div>}
          </div>
        ))}
      </div>
      <div className="gbar-labels" aria-hidden="true">
        {groups.map((g, i) => <span key={i}>{g.label}</span>)}
      </div>
    </figure>
  );
}

function ShareBar({ items }: { items: { id: string; share: number; color: string; label: string }[] }) {
  return (
    <div className="share-bar" role="img" aria-label={items.map((x) => x.label).join('; ')}>
      {items.filter((x) => x.share > 0).map((x) => (
        <span key={x.id} style={{ flexGrow: x.share, background: x.color }} title={x.label} />
      ))}
    </div>
  );
}
