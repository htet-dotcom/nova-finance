import { describe, expect, it } from 'vitest';
import { dictionaries, reportLabels } from '../../src/i18n';
import { buildReport, buildReportText, dailyRange, monthlyRange, type ReportFormatters, type ReportLabels } from '../../src/lib/report';
import { layoutReport, PDF_GEOMETRY, PNG_GEOMETRY, wrapText, type Font } from '../../src/lib/report-layout';
import { input, manual, tx } from './helpers';

const L: ReportLabels = reportLabels(dictionaries.en);
const LM: ReportLabels = reportLabels(dictionaries.my);
const F: ReportFormatters = {
  date: (k) => k,
  dateTime: (iso) => iso.slice(0, 16),
  periodLabel: (r) => (r.kind === 'daily' ? r.range.start : r.range.start.slice(0, 7)),
};
/** Deterministic fake measurer: Latin ~0.55em, other scripts ~0.8em per code unit. */
const measure = (text: string, f: Font) => [...text].reduce((w, ch) => w + f.size * (/[\x00-\x7f]/.test(ch) ? 0.55 : 0.8), 0);

const data = [
  tx('income', 3000, '2026-09-01', { categoryId: 'cat_salary', note: 'September pay' }),
  tx('expense', 120, '2026-09-01', { categoryId: 'cat_food', note: 'Lunch' }),
  tx('expense', 80, '2026-09-02', { categoryId: 'cat_transport' }),
  tx('expense', 500, '2026-09-15', { categoryId: 'cat_rent' }),
  tx('expense', 40, '2026-08-31', { categoryId: 'cat_food' }), // previous month
  tx('expense', 60, '2026-10-01', { categoryId: 'cat_food' }), // next month
];

describe('report periods and totals', () => {
  it('daily report includes only that date', () => {
    const r = buildReport(input(data, '2026-09-30'), 'daily', dailyRange('2026-09-01'));
    expect(r.rows.map((x) => x.amount)).toEqual([3000, 120]);
    expect(r.summary.totalIncome).toBe(3000);
    expect(r.summary.totalExpense).toBe(120);
    expect(r.summary.net).toBe(2880);
  });

  it('monthly report respects month boundaries', () => {
    const r = buildReport(input(data, '2026-10-05'), 'monthly', monthlyRange(2026, 9));
    expect(r.range).toEqual({ start: '2026-09-01', end: '2026-09-30' });
    expect(r.rows).toHaveLength(4);
    expect(r.summary.totalExpense).toBe(700);
    expect(r.summary.net).toBe(2300);
  });

  it('leap-year February', () => {
    expect(monthlyRange(2028, 2).end).toBe('2028-02-29');
    expect(monthlyRange(2026, 2).end).toBe('2026-02-28');
    expect(monthlyRange(2026, 12)).toEqual({ start: '2026-12-01', end: '2026-12-31' });
  });

  it('empty day and empty month', () => {
    const d = buildReport(input(data, '2026-09-30'), 'daily', dailyRange('2026-09-10'));
    expect(d.rows).toEqual([]);
    expect(d.summary.totalIncome).toBe(0);
    expect(d.summary.net).toBe(0);
    const m = buildReport(input([], '2026-09-30'), 'monthly', monthlyRange(2026, 7));
    expect(m.rows).toEqual([]);
    expect(m.expenseByCategory).toEqual([]);
    expect(buildReportText(m, L, F)).toContain('No transactions in this period.');
  });

  it('category and daily breakdowns', () => {
    const r = buildReport(input(data, '2026-10-05'), 'monthly', monthlyRange(2026, 9));
    expect(r.expenseByCategory.map((c) => [c.name, c.amount])).toEqual([
      ['Rent', 500],
      ['Food', 120],
      ['Transportation', 80],
    ]);
    expect(r.incomeByCategory[0]).toMatchObject({ name: 'Salary', amount: 3000, count: 1 });
    const days = r.summary.byDay.filter((d) => d.expense || d.income);
    expect(days).toEqual([
      { date: '2026-09-01', income: 3000, expense: 120 },
      { date: '2026-09-02', income: 0, expense: 80 },
      { date: '2026-09-15', income: 0, expense: 500 },
    ]);
  });

  it('current month excludes future-dated entries and says so', () => {
    const r = buildReport(input(data, '2026-09-10'), 'monthly', monthlyRange(2026, 9));
    expect(r.rows).toHaveLength(3);
    expect(r.upcomingExcluded).toBe(1);
    expect(buildReportText(r, L, F)).toContain('1 future-dated entry is not included');
  });

  it('orders same-day rows by entry time, then id (numeric-aware)', () => {
    const rows = ['t_10', 't_2', 't_1'].map((id) => tx('expense', 1, '2026-09-05', { id }));
    const r = buildReport(input(rows, '2026-09-30'), 'daily', dailyRange('2026-09-05'));
    expect(r.rows.map((x) => x.key)).toEqual(['t_1@2026-09-05', 't_2@2026-09-05', 't_10@2026-09-05']);
  });

  it('recurring entries appear once per occurrence', () => {
    const weekly = tx('expense', 10, '2026-09-01', { categoryId: 'cat_transport', recurring: { freq: 'weekly', until: null } });
    const r = buildReport(input([weekly], '2026-10-05'), 'monthly', monthlyRange(2026, 9));
    expect(r.rows.map((x) => x.date)).toEqual(['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29']);
    expect(new Set(r.rows.map((x) => x.key)).size).toBe(5);
    expect(r.summary.totalExpense).toBe(50);
  });
});

describe('currency in reports', () => {
  it('converts with the manual MMK rate and shows both amounts', () => {
    const mmk = tx('expense', 12000, '2026-09-03', { currency: 'MMK', categoryId: 'cat_food' });
    const r = buildReport(input([mmk], '2026-09-30', {}, [manual('THB', 'MMK', 120)]), 'daily', dailyRange('2026-09-03'));
    expect(r.rows[0].primaryAmount).toBe(100);
    expect(r.summary.totalExpense).toBe(100);
    expect(buildReportText(r, L, F)).toContain('-12,000 Ks (≈ -฿100)');
  });

  it('respects the selected primary currency', () => {
    const r = buildReport(input([tx('income', 100, '2026-09-03')], '2026-09-30', { primaryCurrency: 'MMK' }, [manual('THB', 'MMK', 120)]), 'daily', dailyRange('2026-09-03'));
    expect(r.currency).toBe('MMK');
    expect(r.summary.totalIncome).toBe(12000);
  });

  it('lists but does not total entries without a rate', () => {
    const eur = tx('expense', 5, '2026-09-03', { currency: 'EUR' });
    const r = buildReport(input([eur], '2026-09-30'), 'daily', dailyRange('2026-09-03'));
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].primaryAmount).toBeNull();
    expect(r.summary.totalExpense).toBe(0);
    const text = buildReportText(r, L, F);
    expect(text).toContain('No exchange rate for EUR');
    expect(text).toContain('no exchange rate – not in totals');
  });
});

describe('TXT report', () => {
  it('has period, totals and every transaction', () => {
    const r = buildReport(input(data, '2026-10-05'), 'monthly', monthlyRange(2026, 9));
    const text = buildReportText(r, L, F);
    for (const s of ['Monthly summary', 'Period: 2026-09', 'Total income: ฿3,000', 'Total expense: ฿700', 'Net balance: ฿2,300', 'Daily totals', 'Expenses by category', 'September pay', 'Lunch']) {
      expect(text).toContain(s);
    }
    expect(text.match(/^• /gm)).toHaveLength(4);
  });

  it('keeps Myanmar Unicode text intact', () => {
    const note = 'မနက်စာ ကော်ဖီ နှင့် မုန့်';
    const r = buildReport(input([tx('expense', 50, '2026-09-03', { note })], '2026-09-30'), 'daily', dailyRange('2026-09-03'));
    const text = buildReportText(r, LM, F);
    expect(text).toContain(note);
    expect(text).toContain('နေ့စဉ် စာရင်း');
    expect(text).toContain('စုစုပေါင်း အသုံးစရိတ်');
    // UTF-8 round trip
    expect(new TextDecoder().decode(new TextEncoder().encode(text))).toBe(text);
  });
});

describe('page layout / pagination', () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      tx(i % 7 === 0 ? 'income' : 'expense', 10 + i, `2026-09-${String((i % 30) + 1).padStart(2, '0')}`, {
        categoryId: i % 7 === 0 ? 'cat_salary' : 'cat_food',
        note: i % 5 === 0 ? `Note ${i} — မြန်မာ မှတ်ချက် ${'ရှည်လျားသော စာသား '.repeat(i % 3)}` : '',
      }),
    );

  for (const [name, g] of [['PDF', PDF_GEOMETRY], ['PNG', PNG_GEOMETRY]] as const) {
    it(`${name}: 400 transactions paginate without losing or duplicating any`, () => {
      const r = buildReport(input(many(400), '2026-10-05'), 'monthly', monthlyRange(2026, 9));
      expect(r.rows).toHaveLength(400);
      const pages = layoutReport(r, L, F, g, measure);
      expect(pages.length).toBeGreaterThan(5);
      const keys = pages.flatMap((p) => p.rowKeys);
      expect(keys).toHaveLength(400);
      expect(new Set(keys)).toEqual(new Set(r.rows.map((x) => x.key)));
      // Nothing drawn outside the page (no clipping)
      for (const p of pages) {
        for (const op of p.ops) {
          const y = op.kind === 'line' ? Math.max(op.y1, op.y2) : op.kind === 'rect' ? op.y + op.h : op.y + op.font.size * 1.75;
          expect(y).toBeLessThanOrEqual(p.height);
          if (op.kind === 'text') {
            const w = measure(op.text, op.font);
            const x0 = op.align === 'right' ? op.x - w : op.x;
            expect(x0).toBeGreaterThanOrEqual(g.margin - 1);
            expect(x0 + w).toBeLessThanOrEqual(g.width - g.margin + 1);
          }
        }
      }
      // Every page is numbered
      pages.forEach((p, i) => expect(p.ops.some((o) => o.kind === 'text' && o.text === `Page ${i + 1} of ${pages.length}`)).toBe(true));
    });
  }

  it('empty report still produces one page with a "no transactions" line', () => {
    const r = buildReport(input([], '2026-10-05'), 'daily', dailyRange('2026-10-05'));
    const pages = layoutReport(r, L, F, PDF_GEOMETRY, measure);
    expect(pages).toHaveLength(1);
    expect(pages[0].ops.some((o) => o.kind === 'text' && o.text === 'No transactions in this period.')).toBe(true);
  });

  it('PNG trims the last page; PDF keeps A4 size', () => {
    const r = buildReport(input(data, '2026-10-05'), 'daily', dailyRange('2026-09-01'));
    expect(layoutReport(r, L, F, PNG_GEOMETRY, measure)[0].height).toBeLessThan(PNG_GEOMETRY.height);
    expect(layoutReport(r, L, F, PDF_GEOMETRY, measure)[0].height).toBe(PDF_GEOMETRY.height);
  });

  it('wraps long Myanmar text (no spaces) without losing characters', () => {
    const text = 'မြန်မာစာသားရှည်ရှည်'.repeat(12);
    const lines = wrapText(text, 200, { size: 20, weight: 400 }, measure);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe(text);
    for (const l of lines) expect(measure(l, { size: 20, weight: 400 })).toBeLessThanOrEqual(200 + 20);
  });

  it('wraps Latin text at word boundaries', () => {
    const lines = wrapText('alpha beta gamma delta epsilon', 60, { size: 10, weight: 400 }, measure);
    expect(lines.join(' ')).toBe('alpha beta gamma delta epsilon');
    expect(lines.every((l) => !l.startsWith(' '))).toBe(true);
  });
});
