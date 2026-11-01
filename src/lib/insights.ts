// Spending insights: monthly trend, period-over-period comparison, weekday pattern
// and plain-language highlights. Pure functions built on the engine.

import { roundMoney } from './currency';
import { addDays, addMonths, daysInMonth, diffDays, makeKey, minKey, parts, type Range } from './dates';
import { summarizeRange, type EngineInput } from './engine';
import type { DateKey } from './types';

export interface MonthTotal {
  /** `YYYY-MM` */
  month: string;
  range: Range;
  income: number;
  expense: number;
  net: number;
  /** true for the current (still running) month */
  partial: boolean;
}

const monthOf = (key: DateKey): Range => {
  const { y, m } = parts(key);
  return { start: makeKey(y, m, 1), end: makeKey(y, m, daysInMonth(y, m)) };
};

/** Income / expense per calendar month for the last `months` months (oldest first, current month last). */
export function monthlyTrend(input: EngineInput, months = 6): MonthTotal[] {
  const out: MonthTotal[] = [];
  const first = addMonths(monthOf(input.today).start, -(months - 1), 1);
  for (let i = 0; i < months; i++) {
    const range = monthOf(addMonths(first, i, 1));
    const s = summarizeRange(input, range);
    out.push({
      month: range.start.slice(0, 7),
      range,
      income: s.totalIncome,
      expense: s.totalExpense,
      net: s.net,
      partial: range.end >= input.today,
    });
  }
  return out;
}

export interface CategoryChange {
  categoryId: string;
  current: number;
  previous: number;
  /** (current − previous) / previous; null when previous is 0 */
  change: number | null;
}

export interface Comparison {
  current: Range;
  previous: Range;
  currentTotal: number;
  previousTotal: number;
  change: number | null;
  categories: CategoryChange[];
}

/**
 * Month-to-date versus the same number of days at the start of last month,
 * so a half-finished month is compared fairly.
 */
export function compareToLastMonth(input: EngineInput): Comparison {
  const cur = monthOf(input.today);
  const current = { start: cur.start, end: input.today };
  const days = diffDays(cur.start, input.today);
  const prevMonth = monthOf(addDays(cur.start, -1));
  const previous = { start: prevMonth.start, end: minKey(addDays(prevMonth.start, days), prevMonth.end) };
  const a = summarizeRange(input, current);
  const b = summarizeRange(input, previous);
  const ids = new Set([...a.expenseByCategory, ...b.expenseByCategory].map((c) => c.categoryId));
  const amt = (list: typeof a.expenseByCategory, id: string) => list.find((c) => c.categoryId === id)?.amount ?? 0;
  const ratio = (x: number, y: number) => (y > 0 ? (x - y) / y : null);
  const categories = [...ids]
    .map((id) => {
      const c = amt(a.expenseByCategory, id);
      const p = amt(b.expenseByCategory, id);
      return { categoryId: id, current: c, previous: p, change: ratio(c, p) };
    })
    .sort((x, y) => Math.abs(y.current - y.previous) - Math.abs(x.current - x.previous));
  return { current, previous, currentTotal: a.totalExpense, previousTotal: b.totalExpense, change: ratio(a.totalExpense, b.totalExpense), categories };
}

/**
 * Average spending per weekday (Monday first) over the last `weeks` full weeks before today.
 * Today is excluded because it is still in progress.
 */
export function weekdayAverages(input: EngineInput, weeks = 8): { averages: number[]; range: Range } {
  const range = { start: addDays(input.today, -weeks * 7), end: addDays(input.today, -1) };
  const s = summarizeRange(input, range);
  const totals = new Array(7).fill(0);
  const counts = new Array(7).fill(0);
  const dow = (k: DateKey) => {
    const { y, m, d } = parts(k);
    return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  };
  for (let k = range.start; k <= range.end; k = addDays(k, 1)) counts[dow(k)]++;
  for (const d of s.byDay) totals[dow(d.date)] += d.expense;
  const cur = input.settings.primaryCurrency;
  return {
    range,
    averages: totals.map((t, i) => roundMoney(counts[i] ? t / counts[i] : 0, cur, input.settings.customCurrencies)),
  };
}

export type Insight =
  | { kind: 'pace'; change: number; current: number; previous: number }
  | { kind: 'category-up' | 'category-down'; categoryId: string; change: number; current: number; previous: number }
  | { kind: 'top-weekday'; weekday: number; average: number; overall: number }
  | { kind: 'savings-rate'; month: string; rate: number }
  | { kind: 'no-spend-days'; count: number; days: number };

/** Minimum relative change worth mentioning. */
const CHANGE_THRESHOLD = 0.2;

/** Plain-language highlights, most useful first. */
export function buildInsights(input: EngineInput): Insight[] {
  const out: Insight[] = [];
  const cmp = compareToLastMonth(input);

  if (cmp.change !== null && Math.abs(cmp.change) >= 0.1) {
    out.push({ kind: 'pace', change: cmp.change, current: cmp.currentTotal, previous: cmp.previousTotal });
  }
  // A category change must be large relative to itself AND matter for the overall budget.
  const floor = Math.max(cmp.previousTotal, cmp.currentTotal) * 0.05;
  for (const c of cmp.categories) {
    if (c.change === null || Math.abs(c.change) < CHANGE_THRESHOLD || Math.abs(c.current - c.previous) < floor) continue;
    out.push({ kind: c.change > 0 ? 'category-up' : 'category-down', categoryId: c.categoryId, change: c.change, current: c.current, previous: c.previous });
    if (out.filter((x) => x.kind === 'category-up' || x.kind === 'category-down').length >= 3) break;
  }

  const wd = weekdayAverages(input);
  const overall = wd.averages.reduce((a, b) => a + b, 0) / 7;
  const max = Math.max(...wd.averages);
  if (overall > 0 && max >= overall * 1.3) {
    out.push({ kind: 'top-weekday', weekday: wd.averages.indexOf(max), average: max, overall: roundMoney(overall, input.settings.primaryCurrency, input.settings.customCurrencies) });
  }

  const lastMonth = monthOf(addDays(monthOf(input.today).start, -1));
  const lm = summarizeRange(input, lastMonth);
  if (lm.savingsRate !== null) out.push({ kind: 'savings-rate', month: lastMonth.start.slice(0, 7), rate: lm.savingsRate });

  const mtd = summarizeRange(input, { start: monthOf(input.today).start, end: input.today });
  if (mtd.daysCounted >= 3 && mtd.transactionCount > 0) {
    const noSpend = mtd.byDay.filter((d) => d.expense === 0 && d.date < input.today).length;
    if (noSpend > 0) out.push({ kind: 'no-spend-days', count: noSpend, days: mtd.daysCounted - 1 });
  }
  return out;
}
