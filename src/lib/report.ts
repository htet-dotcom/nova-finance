// Daily / monthly report model and plain-text rendering.
// Totals come from the engine's summarizeRange(); this module only adds the
// per-transaction detail rows and presentation-neutral structure.

import { formatMoney } from './currency';
import { daysInMonth, makeKey, type Range } from './dates';
import { expandOccurrences, summarizeRange, type EngineInput, type RangeSummary } from './engine';
import { makeConverter } from './fx';
import type { CustomCurrency, DateKey, TxType } from './types';

export type ReportKind = 'daily' | 'monthly';

export interface ReportRow {
  /** Stable key: transaction id + occurrence date (recurring entries repeat). */
  key: string;
  date: DateKey;
  type: TxType;
  categoryName: string;
  note: string;
  amount: number;
  currency: string;
  /** Amount in the primary currency, or null when no exchange rate exists. */
  primaryAmount: number | null;
  recurring: boolean;
}

export interface ReportCategoryLine {
  name: string;
  amount: number;
  share: number;
  count: number;
}

export interface Report {
  kind: ReportKind;
  range: Range;
  currency: string;
  customCurrencies: CustomCurrency[];
  generatedAt: string;
  summary: RangeSummary;
  rows: ReportRow[];
  expenseByCategory: ReportCategoryLine[];
  incomeByCategory: ReportCategoryLine[];
  /** Entries dated after `today` inside the range — not included (they have not happened yet). */
  upcomingExcluded: number;
}

export function dailyRange(date: DateKey): Range {
  return { start: date, end: date };
}

export function monthlyRange(year: number, month: number): Range {
  return { start: makeKey(year, month, 1), end: makeKey(year, month, daysInMonth(year, month)) };
}

export function buildReport(input: EngineInput, kind: ReportKind, range: Range, now: Date = new Date()): Report {
  const { settings, today } = input;
  const summary = summarizeRange(input, range);
  const cats = new Map(input.categories.map((c) => [c.id, c]));
  const conv = makeConverter(input.rates, settings.primaryCurrency, settings.manualFirstCurrencies);

  const all = expandOccurrences(input.transactions, range);
  const happened = all.filter((o) => o.date <= today);
  const created = new Map(happened.map((o) => [o.tx.id, o.tx.createdAt]));
  const rows: ReportRow[] = happened
    .map((o) => ({
      key: `${o.tx.id}@${o.date}`,
      date: o.date,
      type: o.tx.type,
      categoryName: cats.get(o.tx.categoryId)?.name ?? '—',
      note: o.tx.note,
      amount: o.tx.amount,
      currency: o.tx.currency,
      primaryAmount: conv(o.tx.amount, o.tx.currency),
      recurring: o.tx.recurring !== null,
    }))
    // Date, then income before expense, then entry order (numeric-aware id as a stable tie-break).
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (a.type === b.type ? 0 : a.type === 'income' ? -1 : 1) ||
        (created.get(a.key.split('@')[0]) ?? '').localeCompare(created.get(b.key.split('@')[0]) ?? '') ||
        a.key.localeCompare(b.key, 'en', { numeric: true }),
    );

  const named = (list: RangeSummary['expenseByCategory']): ReportCategoryLine[] =>
    list.map((c) => ({ name: cats.get(c.categoryId)?.name ?? '—', amount: c.amount, share: c.share, count: c.count }));

  return {
    kind,
    range,
    currency: settings.primaryCurrency,
    customCurrencies: settings.customCurrencies,
    generatedAt: now.toISOString(),
    summary,
    rows,
    expenseByCategory: named(summary.expenseByCategory),
    incomeByCategory: named(summary.incomeByCategory),
    upcomingExcluded: all.length - happened.length,
  };
}

// ---------------------------------------------------------------------------
// Labels (injected so the model stays language-neutral)
// ---------------------------------------------------------------------------

export interface ReportLabels {
  appName: string;
  dailyTitle: string;
  monthlyTitle: string;
  period: string;
  generated: string;
  currencyNote: (code: string) => string;
  totalIncome: string;
  totalExpense: string;
  net: string;
  averageDaily: string;
  transactions: string;
  count: (n: number) => string;
  expenseByCategory: string;
  incomeByCategory: string;
  dailyTotals: string;
  date: string;
  category: string;
  note: string;
  amount: string;
  income: string;
  expense: string;
  noTransactions: string;
  noRate: string;
  missingRates: (codes: string) => string;
  upcomingExcluded: (n: number) => string;
  recurring: string;
  page: (n: number, total: number) => string;
  footer: string;
}

export interface ReportFormatters {
  date: (key: DateKey) => string;
  dateTime: (iso: string) => string;
  periodLabel: (r: Report) => string;
}

export const money = (r: Report, v: number, code = r.currency, signed = false) =>
  formatMoney(v, code, { custom: r.customCurrencies, signed });

export function rowAmountText(r: Report, row: ReportRow): string {
  const sign = row.type === 'income' ? 1 : -1;
  const own = money(r, sign * row.amount, row.currency, true);
  if (row.currency === r.currency) return own;
  return row.primaryAmount === null ? own : `${own} (≈ ${money(r, sign * row.primaryAmount, r.currency, true)})`;
}

/** Days shown in the monthly "daily totals" table: only days with activity. */
export function activeDays(r: Report) {
  return r.summary.byDay.filter((d) => d.income !== 0 || d.expense !== 0);
}

// ---------------------------------------------------------------------------
// TXT
// ---------------------------------------------------------------------------

export function buildReportText(r: Report, L: ReportLabels, f: ReportFormatters): string {
  const s = r.summary;
  const out: string[] = [];
  const rule = '─'.repeat(32);
  out.push(`${L.appName} — ${r.kind === 'daily' ? L.dailyTitle : L.monthlyTitle}`);
  out.push(`${L.period}: ${f.periodLabel(r)}`);
  out.push(`${L.generated}: ${f.dateTime(r.generatedAt)}`);
  out.push(L.currencyNote(r.currency));
  out.push(rule);
  out.push(`${L.totalIncome}: ${money(r, s.totalIncome)}`);
  out.push(`${L.totalExpense}: ${money(r, s.totalExpense)}`);
  out.push(`${L.net}: ${money(r, s.net)}`);
  if (r.kind === 'monthly') out.push(`${L.averageDaily}: ${money(r, s.averageDailySpending)}`);
  out.push(`${L.transactions}: ${L.count(r.rows.length)}`);
  if (s.missingRateCurrencies.length) out.push(`⚠ ${L.missingRates(s.missingRateCurrencies.join(', '))}`);
  if (r.upcomingExcluded) out.push(`ℹ ${L.upcomingExcluded(r.upcomingExcluded)}`);

  const catBlock = (title: string, lines: ReportCategoryLine[]) => {
    if (!lines.length) return;
    out.push('', title, rule);
    for (const c of lines) out.push(`${c.name}: ${money(r, c.amount)} (${Math.round(c.share * 100)}%, ${L.count(c.count)})`);
  };
  catBlock(L.expenseByCategory, r.expenseByCategory);
  catBlock(L.incomeByCategory, r.incomeByCategory);

  if (r.kind === 'monthly') {
    const days = activeDays(r);
    if (days.length) {
      out.push('', L.dailyTotals, rule);
      for (const d of days) out.push(`${f.date(d.date)}: +${money(r, d.income)} / -${money(r, d.expense)}`);
    }
  }

  out.push('', L.transactions, rule);
  if (!r.rows.length) out.push(L.noTransactions);
  let lastDate = '';
  for (const row of r.rows) {
    if (r.kind === 'monthly' && row.date !== lastDate) {
      out.push(`[${f.date(row.date)}]`);
      lastDate = row.date;
    }
    const kind = row.type === 'income' ? L.income : L.expense;
    const missing = row.currency !== r.currency && row.primaryAmount === null ? ` (${L.noRate})` : '';
    const rec = row.recurring ? ` ↻ ${L.recurring}` : '';
    out.push(`• ${row.categoryName} (${kind}) ${rowAmountText(r, row)}${missing}${rec}`);
    if (row.note) out.push(`  ${row.note}`);
  }
  out.push('', L.footer);
  return out.join('\n') + '\n';
}
