// Financial calculation engine. Pure functions only — no UI, no storage, no clock
// (callers pass `today`). Every number the dashboard shows comes from here.

import { roundMoney, sumMoney } from './currency';
import { addDays, addMonths, diffDays, maxKey, minKey, parts, rangeLength, resolvePeriod, type Range } from './dates';
import { makeConverter } from './fx';
import type { Category, DateKey, ExchangeRate, Settings, Transaction, TxType } from './types';

export interface EngineInput {
  transactions: readonly Transaction[];
  categories: readonly Category[];
  rates: readonly ExchangeRate[];
  settings: Settings;
  today: DateKey;
}

// ---------------------------------------------------------------------------
// Recurrence expansion
// ---------------------------------------------------------------------------

export interface Occurrence {
  tx: Transaction;
  date: DateKey;
  /** true for generated repeats of a recurring transaction (not the original entry). */
  virtual: boolean;
}

const MAX_OCCURRENCES = 2000;

/** Every occurrence (original + recurring repeats) that falls inside `range`. */
export function expandOccurrences(txs: readonly Transaction[], range: Range): Occurrence[] {
  const out: Occurrence[] = [];
  for (const tx of txs) {
    if (!tx.recurring) {
      if (tx.date >= range.start && tx.date <= range.end) out.push({ tx, date: tx.date, virtual: false });
      continue;
    }
    const last = tx.recurring.until ? minKey(tx.recurring.until, range.end) : range.end;
    const anchorDay = parts(tx.date).d;
    for (let i = 0; i < MAX_OCCURRENCES; i++) {
      const date = tx.recurring.freq === 'weekly' ? addDays(tx.date, i * 7) : addMonths(tx.date, i, anchorDay);
      if (date > last) break;
      if (date >= range.start) out.push({ tx, date, virtual: i > 0 });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

interface ConvertedSet {
  items: { occ: Occurrence; amount: number }[];
  missingCurrencies: string[];
  skipped: number;
}

function convertAll(occs: readonly Occurrence[], rates: readonly ExchangeRate[], settings: Settings): ConvertedSet {
  const conv = makeConverter(rates, settings.primaryCurrency, settings.manualFirstCurrencies);
  const missing = new Set<string>();
  const items: ConvertedSet['items'] = [];
  let skipped = 0;
  for (const occ of occs) {
    const amount = conv(occ.tx.amount, occ.tx.currency);
    if (amount === null) {
      missing.add(occ.tx.currency);
      skipped++;
    } else items.push({ occ, amount });
  }
  return { items, missingCurrencies: [...missing].sort(), skipped };
}

const total = (xs: readonly { amount: number }[]) => sumMoney(xs.map((x) => x.amount));

// ---------------------------------------------------------------------------
// Budget snapshot (the dashboard)
// ---------------------------------------------------------------------------

export type BudgetStatus = 'ok' | 'near' | 'over' | 'depleted' | 'no-income' | 'ended' | 'not-started';
export type CategoryBudgetStatus = 'ok' | 'near' | 'over';

export interface CategoryBudgetState {
  categoryId: string;
  budget: number;
  spent: number;
  remaining: number;
  /** spent / budget, can exceed 1 */
  ratio: number;
  status: CategoryBudgetStatus;
}

export interface BudgetSnapshot {
  currency: string;
  today: DateKey;
  period: Range & {
    totalDays: number;
    /** Days from period start through today (inclusive), clamped to the period. */
    daysElapsed: number;
    /** Days from today through period end (inclusive). 0 once the period has ended. */
    remainingDays: number;
    phase: 'before' | 'active' | 'ended';
  };
  /** Income the budget is based on (recorded or planned, per settings). */
  budgetIncome: number;
  /** Income actually recorded in the period up to today. */
  recordedIncome: number;
  upcomingIncome: number;
  upcomingExpenses: number;
  /** All expenses in the period up to today. */
  totalExpenses: number;
  /** Expenses in fixed-cost categories. */
  fixedSpent: number;
  /** Expenses outside fixed-cost categories, up to and including today. */
  discretionarySpent: number;
  spentBeforeToday: number;
  /** Discretionary spending today (what counts against today's limit). */
  spentToday: number;
  /** All expenses today, including fixed-cost categories. */
  spentTodayTotal: number;
  /** Actual money left: recorded income − all expenses. */
  balance: number;
  reserves: {
    savings: number;
    emergency: number;
    protected: number;
    fixedPlanned: number;
    /** Amount reserved for fixed costs: max(planned, actually spent). */
    fixed: number;
    total: number;
  };
  /** Money available for day-to-day spending over the whole period. */
  spendable: number;
  /** Spendable money left after discretionary spending so far (can be negative). */
  remainingSpendable: number;
  /** Recommended maximum discretionary spending for today. */
  dailyLimit: number;
  /** dailyLimit − spentToday (negative = over). */
  todayRemaining: number;
  overBy: number;
  /** Recommended limit for tomorrow given today's spending so far. */
  tomorrowLimit: number;
  averageDailySpending: number;
  /** Expected balance at period end if the current average spending continues. */
  projectedEndBalance: number;
  status: BudgetStatus;
  categoryBudgets: CategoryBudgetState[];
  missingRateCurrencies: string[];
  /** Transactions left out of totals because no exchange rate is available. */
  unconvertedCount: number;
}

export function computeBudget(input: EngineInput): BudgetSnapshot {
  const { settings, today, categories } = input;
  const cur = settings.primaryCurrency;
  const money = (v: number) => roundMoney(v, cur, settings.customCurrencies);
  const nn = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);

  // --- period ---------------------------------------------------------------
  const range = resolvePeriod(settings.period, today);
  const totalDays = rangeLength(range.start, range.end);
  const phase: BudgetSnapshot['period']['phase'] =
    today < range.start ? 'before' : today > range.end ? 'ended' : 'active';
  const daysElapsed = phase === 'before' ? 0 : phase === 'ended' ? totalDays : diffDays(range.start, today) + 1;
  const remainingDays = phase === 'before' ? totalDays : phase === 'ended' ? 0 : diffDays(today, range.end) + 1;

  // --- transactions -----------------------------------------------------------
  const conv = convertAll(expandOccurrences(input.transactions, range), input.rates, settings);
  const fixedCats = new Set(categories.filter((c) => c.fixed).map((c) => c.id));
  const of = (type: TxType) => conv.items.filter((i) => i.occ.tx.type === type);
  const past = (xs: ConvertedSet['items']) => xs.filter((i) => i.occ.date <= today);
  const future = (xs: ConvertedSet['items']) => xs.filter((i) => i.occ.date > today);

  const incomes = of('income');
  const expenses = past(of('expense'));
  const recordedIncome = total(past(incomes));
  const upcomingIncome = total(future(incomes));
  const upcomingExpenses = total(future(of('expense')));

  const isFixed = (i: ConvertedSet['items'][number]) => fixedCats.has(i.occ.tx.categoryId);
  const discretionary = expenses.filter((i) => !isFixed(i));
  const totalExpenses = total(expenses);
  const fixedSpent = total(expenses.filter(isFixed));
  const discretionarySpent = total(discretionary);
  const spentToday = total(discretionary.filter((i) => i.occ.date === today));
  const spentBeforeToday = total(discretionary.filter((i) => i.occ.date < today));
  const spentTodayTotal = total(expenses.filter((i) => i.occ.date === today));

  // --- income basis & reserves -------------------------------------------------
  const budgetIncome =
    settings.incomeBasis === 'planned'
      ? nn(settings.plannedIncome)
      : recordedIncome + (settings.includeUpcomingIncome ? upcomingIncome : 0);

  const fixedPlanned = nn(settings.fixedExpenses);
  const reserves = {
    savings: nn(settings.savingsTarget),
    emergency: nn(settings.emergencyReserve),
    protected: nn(settings.protectedAmount),
    fixedPlanned,
    fixed: Math.max(fixedPlanned, fixedSpent),
    total: 0,
  };
  reserves.total = sumMoney([reserves.savings, reserves.emergency, reserves.protected, reserves.fixed]);

  const spendable = budgetIncome - reserves.total;
  const remainingSpendable = spendable - discretionarySpent;
  const availableForToday = spendable - spentBeforeToday;

  // --- daily allowance ---------------------------------------------------------
  let dailyLimit: number;
  let tomorrowLimit: number;
  if (phase === 'ended' || remainingDays <= 0) {
    dailyLimit = 0;
    tomorrowLimit = 0;
  } else if (settings.allowanceMode === 'even') {
    dailyLimit = nn(spendable / totalDays);
    tomorrowLimit = remainingDays > 1 ? dailyLimit : 0;
  } else {
    dailyLimit = nn(availableForToday / remainingDays);
    tomorrowLimit = remainingDays > 1 ? nn(remainingSpendable / (remainingDays - 1)) : 0;
  }
  dailyLimit = money(dailyLimit);
  tomorrowLimit = money(tomorrowLimit);

  const todayRemaining = money(dailyLimit - spentToday);
  const overBy = money(Math.max(0, spentToday - dailyLimit));

  // --- projections -------------------------------------------------------------
  const averageDailySpending = daysElapsed > 0 ? discretionarySpent / daysElapsed : 0;
  const daysAfterToday = phase === 'before' ? totalDays : Math.max(0, remainingDays - 1);
  const balance = recordedIncome - totalExpenses;
  const projectedEndBalance =
    balance + upcomingIncome - averageDailySpending * daysAfterToday - Math.max(0, fixedPlanned - fixedSpent);

  // --- status ------------------------------------------------------------------
  const epsilon = 1e-9;
  let status: BudgetStatus;
  if (phase === 'ended') status = 'ended';
  else if (phase === 'before') status = 'not-started';
  else if (spentToday > dailyLimit + epsilon) status = 'over';
  else if (budgetIncome <= 0) status = 'no-income';
  else if (availableForToday <= 0) status = 'depleted';
  else if (dailyLimit > 0 && spentToday >= dailyLimit * clampRatio(settings.nearLimitRatio)) status = 'near';
  else status = 'ok';

  // --- category budgets --------------------------------------------------------
  const categoryBudgets: CategoryBudgetState[] = categories
    .filter((c) => c.type === 'expense' && c.budget !== null && c.budget > 0)
    .map((c) => {
      const budget = c.budget as number;
      const spent = money(total(expenses.filter((i) => i.occ.tx.categoryId === c.id)));
      const ratio = spent / budget;
      return {
        categoryId: c.id,
        budget,
        spent,
        remaining: money(budget - spent),
        ratio,
        status: ratio > 1 + epsilon ? 'over' : ratio >= clampRatio(settings.nearLimitRatio) ? 'near' : 'ok',
      } satisfies CategoryBudgetState;
    });

  return {
    currency: cur,
    today,
    period: { ...range, totalDays, daysElapsed, remainingDays, phase },
    budgetIncome: money(budgetIncome),
    recordedIncome: money(recordedIncome),
    upcomingIncome: money(upcomingIncome),
    upcomingExpenses: money(upcomingExpenses),
    totalExpenses: money(totalExpenses),
    fixedSpent: money(fixedSpent),
    discretionarySpent: money(discretionarySpent),
    spentBeforeToday: money(spentBeforeToday),
    spentToday: money(spentToday),
    spentTodayTotal: money(spentTodayTotal),
    balance: money(balance),
    reserves: {
      ...reserves,
      fixed: money(reserves.fixed),
      total: money(reserves.total),
    },
    spendable: money(spendable),
    remainingSpendable: money(remainingSpendable),
    dailyLimit,
    todayRemaining,
    overBy,
    tomorrowLimit,
    averageDailySpending: money(averageDailySpending),
    projectedEndBalance: money(projectedEndBalance),
    status,
    categoryBudgets,
    missingRateCurrencies: conv.missingCurrencies,
    unconvertedCount: conv.skipped,
  };
}

function clampRatio(r: number): number {
  return Number.isFinite(r) ? Math.min(1, Math.max(0.5, r)) : 0.8;
}

// ---------------------------------------------------------------------------
// Range summary (reports: today / week / month / custom)
// ---------------------------------------------------------------------------

export interface CategoryTotal {
  categoryId: string;
  amount: number;
  count: number;
  share: number;
}

export interface DayTotal {
  date: DateKey;
  income: number;
  expense: number;
}

export interface RangeSummary {
  currency: string;
  range: Range;
  /** Days of the range that have already happened (used for averages). */
  daysCounted: number;
  totalIncome: number;
  totalExpense: number;
  net: number;
  averageDailySpending: number;
  /** Share of income kept (net / income), null when there is no income. */
  savingsRate: number | null;
  expenseByCategory: CategoryTotal[];
  incomeByCategory: CategoryTotal[];
  topExpenseCategory: CategoryTotal | null;
  byDay: DayTotal[];
  transactionCount: number;
  missingRateCurrencies: string[];
  unconvertedCount: number;
}

export function summarizeRange(input: EngineInput, range: Range): RangeSummary {
  const { settings, today } = input;
  const cur = settings.primaryCurrency;
  const money = (v: number) => roundMoney(v, cur, settings.customCurrencies);
  const r = range.start <= range.end ? range : { start: range.end, end: range.start };
  // Only count what has happened: future-dated entries are ignored in reports.
  const effectiveEnd = minKey(r.end, today);
  const conv =
    effectiveEnd >= r.start
      ? convertAll(expandOccurrences(input.transactions, { start: r.start, end: effectiveEnd }), input.rates, settings)
      : { items: [], missingCurrencies: [], skipped: 0 };

  const inc = conv.items.filter((i) => i.occ.tx.type === 'income');
  const exp = conv.items.filter((i) => i.occ.tx.type === 'expense');
  const totalIncome = total(inc);
  const totalExpense = total(exp);
  const daysCounted = effectiveEnd >= r.start ? rangeLength(r.start, effectiveEnd) : 0;

  const byCat = (items: ConvertedSet['items'], sum: number): CategoryTotal[] => {
    const m = new Map<string, { amount: number; count: number }>();
    for (const i of items) {
      const e = m.get(i.occ.tx.categoryId) ?? { amount: 0, count: 0 };
      e.amount += i.amount;
      e.count++;
      m.set(i.occ.tx.categoryId, e);
    }
    return [...m.entries()]
      .map(([categoryId, e]) => ({ categoryId, amount: money(e.amount), count: e.count, share: sum > 0 ? e.amount / sum : 0 }))
      .sort((a, b) => b.amount - a.amount);
  };

  const days = new Map<DateKey, DayTotal>();
  if (daysCounted > 0 && daysCounted <= 400) {
    for (let k = r.start; k <= effectiveEnd; k = addDays(k, 1)) days.set(k, { date: k, income: 0, expense: 0 });
  }
  for (const i of conv.items) {
    const d = days.get(i.occ.date) ?? { date: i.occ.date, income: 0, expense: 0 };
    d[i.occ.tx.type] = money(d[i.occ.tx.type] + i.amount);
    days.set(i.occ.date, d);
  }

  const expenseByCategory = byCat(exp, totalExpense);
  return {
    currency: cur,
    range: { start: r.start, end: maxKey(r.start, r.end) },
    daysCounted,
    totalIncome: money(totalIncome),
    totalExpense: money(totalExpense),
    net: money(totalIncome - totalExpense),
    averageDailySpending: money(daysCounted > 0 ? totalExpense / daysCounted : 0),
    savingsRate: totalIncome > 0 ? (totalIncome - totalExpense) / totalIncome : null,
    expenseByCategory,
    incomeByCategory: byCat(inc, totalIncome),
    topExpenseCategory: expenseByCategory[0] ?? null,
    byDay: [...days.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
    transactionCount: conv.items.length,
    missingRateCurrencies: conv.missingCurrencies,
    unconvertedCount: conv.skipped,
  };
}
