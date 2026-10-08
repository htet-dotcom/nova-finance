import { describe, expect, it } from 'vitest';
import { computeBudget, expandOccurrences, summarizeRange } from '../../src/lib/engine';
import { input, manual, provider, tx } from './helpers';

describe('daily limit – income only', () => {
  it.each([
    [3000, 100],
    [5000, 166.67],
    [2000, 66.67],
  ])('income %d over 30 days → %d/day', (income, perDay) => {
    const s = computeBudget(input([tx('income', income, '2026-09-01')], '2026-09-01'));
    expect(s.period.totalDays).toBe(30);
    expect(s.period.remainingDays).toBe(30);
    expect(s.dailyLimit).toBe(perDay);
    expect(s.status).toBe('ok');
  });

  it('increases automatically when income goes up and decreases when it goes down', () => {
    const base = computeBudget(input([tx('income', 3000, '2026-09-01')], '2026-09-01')).dailyLimit;
    const up = computeBudget(input([tx('income', 5000, '2026-09-01')], '2026-09-01')).dailyLimit;
    const down = computeBudget(input([tx('income', 2000, '2026-09-01')], '2026-09-01')).dailyLimit;
    expect(up).toBeGreaterThan(base);
    expect(down).toBeLessThan(base);
  });

  it('never uses a hard-coded threshold – limit scales with any income', () => {
    for (const income of [1, 123.45, 999_999]) {
      const s = computeBudget(input([tx('income', income, '2026-09-01')], '2026-09-01'));
      expect(s.dailyLimit).toBeCloseTo(income / 30, 2);
    }
  });
});

describe('daily limit – dynamic recalculation', () => {
  it('income 3000, spent 1000, 20 days left → 100/day', () => {
    const s = computeBudget(
      input([tx('income', 3000, '2026-09-01'), tx('expense', 1000, '2026-09-05')], '2026-09-11'),
    );
    expect(s.period.remainingDays).toBe(20);
    expect(s.remainingSpendable).toBe(2000);
    expect(s.dailyLimit).toBe(100);
  });

  it('spending below the allowance raises tomorrow’s limit', () => {
    const s = computeBudget(input([tx('income', 3000, '2026-09-01'), tx('expense', 70, '2026-09-01')], '2026-09-01'));
    expect(s.dailyLimit).toBe(100);
    expect(s.spentToday).toBe(70);
    expect(s.todayRemaining).toBe(30);
    expect(s.status).toBe('ok');
    expect(s.tomorrowLimit).toBe(101.03); // 2930 / 29
  });

  it('spending above the allowance warns and lowers tomorrow’s limit', () => {
    const s = computeBudget(input([tx('income', 3000, '2026-09-01'), tx('expense', 125, '2026-09-01')], '2026-09-01'));
    expect(s.status).toBe('over');
    expect(s.overBy).toBe(25);
    expect(s.todayRemaining).toBe(-25);
    expect(s.tomorrowLimit).toBe(99.14); // 2875 / 29
  });

  it('today’s limit does not shrink while spending during the day', () => {
    const before = computeBudget(input([tx('income', 3000, '2026-09-01')], '2026-09-10'));
    const after = computeBudget(
      input([tx('income', 3000, '2026-09-01'), tx('expense', 40, '2026-09-10'), tx('expense', 30, '2026-09-10')], '2026-09-10'),
    );
    expect(after.dailyLimit).toBe(before.dailyLimit);
    expect(after.spentToday).toBe(70);
  });

  it('flags the near-limit state using the configured ratio', () => {
    const s = computeBudget(input([tx('income', 3000, '2026-09-01'), tx('expense', 85, '2026-09-01')], '2026-09-01'));
    expect(s.status).toBe('near');
    const lenient = computeBudget(
      input([tx('income', 3000, '2026-09-01'), tx('expense', 85, '2026-09-01')], '2026-09-01', { nearLimitRatio: 0.9 }),
    );
    expect(lenient.status).toBe('ok');
  });

  it('dashboard example: limit 58, spent 72 → over by 14', () => {
    // 1750 remaining spendable before today over 30 days ≈ 58.33
    const s = computeBudget(input([tx('income', 1750, '2026-09-01'), tx('expense', 72, '2026-09-01')], '2026-09-01'));
    expect(s.dailyLimit).toBe(58.33);
    expect(s.overBy).toBe(13.67);
    expect(s.status).toBe('over');
  });
});

describe('savings, reserves and fixed expenses', () => {
  it('income 3000 − savings 500 − fixed 500 → 2000 spendable → 66.67/day', () => {
    const s = computeBudget(
      input([tx('income', 3000, '2026-09-01')], '2026-09-01', { savingsTarget: 500, fixedExpenses: 500 }),
    );
    expect(s.spendable).toBe(2000);
    expect(s.dailyLimit).toBe(66.67);
    expect(s.reserves.total).toBe(1000);
  });

  it('deducts emergency reserve and protected amount', () => {
    const s = computeBudget(
      input([tx('income', 3000, '2026-09-01')], '2026-09-01', { emergencyReserve: 300, protectedAmount: 200 }),
    );
    expect(s.spendable).toBe(2500);
  });

  it('fixed-category spending is covered by the fixed reserve, not the daily allowance', () => {
    const rent = tx('expense', 500, '2026-09-01', { categoryId: 'cat_rent' });
    const s = computeBudget(input([tx('income', 3000, '2026-09-01'), rent], '2026-09-01', { fixedExpenses: 500 }));
    expect(s.fixedSpent).toBe(500);
    expect(s.spentToday).toBe(0);
    expect(s.spentTodayTotal).toBe(500);
    expect(s.dailyLimit).toBe(83.33); // (3000 − 500) / 30
    expect(s.status).toBe('ok');
  });

  it('fixed spending above the plan reduces the spendable amount', () => {
    const rent = tx('expense', 800, '2026-09-01', { categoryId: 'cat_rent' });
    const s = computeBudget(input([tx('income', 3000, '2026-09-01'), rent], '2026-09-02', { fixedExpenses: 500 }));
    expect(s.reserves.fixed).toBe(800);
    expect(s.spendable).toBe(2200);
  });

  it('planned income basis uses the configured amount', () => {
    const s = computeBudget(input([], '2026-09-01', { incomeBasis: 'planned', plannedIncome: 4500 }));
    expect(s.budgetIncome).toBe(4500);
    expect(s.dailyLimit).toBe(150);
  });

  it('even allowance mode keeps a flat daily figure', () => {
    const s = computeBudget(
      input([tx('income', 3000, '2026-09-01'), tx('expense', 1000, '2026-09-02')], '2026-09-11', { allowanceMode: 'even' }),
    );
    expect(s.dailyLimit).toBe(100);
    expect(s.tomorrowLimit).toBe(100);
  });
});

describe('edge cases', () => {
  it('zero income → zero limit, no-income status, no NaN', () => {
    const s = computeBudget(input([], '2026-09-10'));
    expect(s.dailyLimit).toBe(0);
    expect(s.status).toBe('no-income');
    expect(Number.isNaN(s.averageDailySpending)).toBe(false);
  });

  it('zero income with spending today → over', () => {
    const s = computeBudget(input([tx('expense', 50, '2026-09-10')], '2026-09-10'));
    expect(s.status).toBe('over');
    expect(s.overBy).toBe(50);
  });

  it('expenses greater than income → negative balance, depleted, limit 0', () => {
    const s = computeBudget(input([tx('income', 1000, '2026-09-01'), tx('expense', 1500, '2026-09-05')], '2026-09-10'));
    expect(s.balance).toBe(-500);
    expect(s.remainingSpendable).toBe(-500);
    expect(s.dailyLimit).toBe(0);
    expect(s.tomorrowLimit).toBe(0);
    expect(s.status).toBe('depleted');
  });

  it('reserves larger than income → limit 0, never negative', () => {
    const s = computeBudget(input([tx('income', 1000, '2026-09-01')], '2026-09-01', { savingsTarget: 5000 }));
    expect(s.spendable).toBe(-4000);
    expect(s.dailyLimit).toBe(0);
  });

  it('last day of the period: all remaining money is available today', () => {
    const s = computeBudget(input([tx('income', 3000, '2026-09-01'), tx('expense', 2900, '2026-09-10')], '2026-09-30'));
    expect(s.period.remainingDays).toBe(1);
    expect(s.dailyLimit).toBe(100);
    expect(s.tomorrowLimit).toBe(0);
  });

  it('zero remaining days (custom period ended) → limit 0, ended', () => {
    const s = computeBudget(
      input([tx('income', 3000, '2026-09-01')], '2026-10-05', { period: { kind: 'custom', start: '2026-09-01', end: '2026-09-30' } }),
    );
    expect(s.period.remainingDays).toBe(0);
    expect(s.dailyLimit).toBe(0);
    expect(s.status).toBe('ended');
  });

  it('custom period not started yet', () => {
    const s = computeBudget(
      input([], '2026-08-25', { period: { kind: 'custom', start: '2026-09-01', end: '2026-09-30' }, incomeBasis: 'planned', plannedIncome: 3000 }),
    );
    expect(s.status).toBe('not-started');
    expect(s.dailyLimit).toBe(100);
  });

  it('future transactions are excluded from today’s figures and reported as upcoming', () => {
    const s = computeBudget(
      input([tx('income', 3000, '2026-09-01'), tx('expense', 400, '2026-09-20'), tx('income', 1000, '2026-09-25')], '2026-09-10'),
    );
    expect(s.totalExpenses).toBe(0);
    expect(s.upcomingExpenses).toBe(400);
    expect(s.upcomingIncome).toBe(1000);
    expect(s.budgetIncome).toBe(3000);
  });

  it('can count upcoming income when the user opts in', () => {
    const s = computeBudget(
      input([tx('income', 3000, '2026-09-25')], '2026-09-01', { includeUpcomingIncome: true }),
    );
    expect(s.budgetIncome).toBe(3000);
    expect(s.dailyLimit).toBe(100);
  });

  it('transactions outside the period are ignored', () => {
    const s = computeBudget(
      input([tx('income', 9999, '2026-08-31'), tx('income', 3000, '2026-09-01'), tx('expense', 500, '2026-10-01')], '2026-09-01'),
    );
    expect(s.budgetIncome).toBe(3000);
    expect(s.totalExpenses).toBe(0);
  });

  it('projects the end-of-period balance from the average daily spend', () => {
    const s = computeBudget(input([tx('income', 3000, '2026-09-01'), tx('expense', 500, '2026-09-03')], '2026-09-10'));
    // avg 50/day for 10 days; 20 days after today → 3000 − 500 − 1000
    expect(s.averageDailySpending).toBe(50);
    expect(s.projectedEndBalance).toBe(1500);
  });
});

describe('multiple currencies', () => {
  it('converts foreign-currency transactions into the primary currency', () => {
    const rates = [provider('USD', 'THB', 35)];
    const s = computeBudget(
      input([tx('income', 100, '2026-09-01', { currency: 'USD' }), tx('expense', 10, '2026-09-01', { currency: 'USD' })], '2026-09-01', {}, rates),
    );
    expect(s.budgetIncome).toBe(3500);
    expect(s.spentToday).toBe(350);
  });

  it('uses the manual MMK rate', () => {
    const rates = [manual('THB', 'MMK', 120)];
    const s = computeBudget(
      input([tx('income', 360_000, '2026-09-01', { currency: 'MMK' })], '2026-09-01', {}, rates),
    );
    expect(s.budgetIncome).toBe(3000);
    expect(s.dailyLimit).toBe(100);
  });

  it('works with MMK as primary currency (0 decimals)', () => {
    const rates = [manual('THB', 'MMK', 120)];
    const s = computeBudget(
      input([tx('income', 3000, '2026-09-01')], '2026-09-01', { primaryCurrency: 'MMK' }, rates),
    );
    expect(s.budgetIncome).toBe(360_000);
    expect(s.dailyLimit).toBe(12_000);
  });

  it('missing exchange rate: excludes the record and reports the currency', () => {
    const s = computeBudget(
      input([tx('income', 3000, '2026-09-01'), tx('expense', 50, '2026-09-01', { currency: 'EUR' })], '2026-09-01'),
    );
    expect(s.missingRateCurrencies).toEqual(['EUR']);
    expect(s.unconvertedCount).toBe(1);
    expect(s.spentToday).toBe(0);
    expect(s.dailyLimit).toBe(100);
  });
});

describe('category budgets', () => {
  it('reports ok / near / over per category independent of the daily limit', () => {
    const cats = input([], '2026-09-10').categories.map((c) =>
      c.id === 'cat_food' ? { ...c, budget: 5000 } : c.id === 'cat_transport' ? { ...c, budget: 1000 } : c.id === 'cat_shopping' ? { ...c, budget: 1000 } : c,
    );
    const inp = {
      ...input(
        [
          tx('income', 30000, '2026-09-01'),
          tx('expense', 5200, '2026-09-05', { categoryId: 'cat_food' }),
          tx('expense', 850, '2026-09-05', { categoryId: 'cat_transport' }),
          tx('expense', 100, '2026-09-05', { categoryId: 'cat_shopping' }),
        ],
        '2026-09-10',
      ),
      categories: cats,
    };
    const s = computeBudget(inp);
    const by = Object.fromEntries(s.categoryBudgets.map((b) => [b.categoryId, b]));
    expect(by.cat_food.status).toBe('over');
    expect(by.cat_food.remaining).toBe(-200);
    expect(by.cat_transport.status).toBe('near');
    expect(by.cat_shopping.status).toBe('ok');
    expect(s.status).not.toBe('over'); // daily allowance is independent
  });
});

describe('recurring transactions', () => {
  it('monthly salary repeats every month, clamped to short months', () => {
    const salary = tx('income', 1000, '2026-01-31', { recurring: { freq: 'monthly', until: null } });
    const occ = expandOccurrences([salary], { start: '2026-01-01', end: '2026-04-30' });
    expect(occ.map((o) => o.date)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });

  it('leap-year February', () => {
    const salary = tx('income', 1000, '2028-01-31', { recurring: { freq: 'monthly', until: null } });
    const occ = expandOccurrences([salary], { start: '2028-02-01', end: '2028-02-29' });
    expect(occ.map((o) => o.date)).toEqual(['2028-02-29']);
  });

  it('weekly repeats respect `until`', () => {
    const t = tx('expense', 10, '2026-09-01', { recurring: { freq: 'weekly', until: '2026-09-20' } });
    const occ = expandOccurrences([t], { start: '2026-09-01', end: '2026-09-30' });
    expect(occ.map((o) => o.date)).toEqual(['2026-09-01', '2026-09-08', '2026-09-15']);
  });

  it('recurring income feeds the budget in later periods', () => {
    const salary = tx('income', 3000, '2026-08-01', { recurring: { freq: 'monthly', until: null } });
    const s = computeBudget(input([salary], '2026-09-01'));
    expect(s.budgetIncome).toBe(3000);
    expect(s.dailyLimit).toBe(100);
  });
});

describe('range summary', () => {
  const data = [
    tx('income', 3000, '2026-09-01'),
    tx('expense', 300, '2026-09-02', { categoryId: 'cat_food' }),
    tx('expense', 100, '2026-09-02', { categoryId: 'cat_transport' }),
    tx('expense', 200, '2026-09-04', { categoryId: 'cat_food' }),
    tx('expense', 999, '2026-09-20', { categoryId: 'cat_food' }), // future
  ];

  it('totals, net, average and top category', () => {
    const r = summarizeRange(input(data, '2026-09-05'), { start: '2026-09-01', end: '2026-09-30' });
    expect(r.totalIncome).toBe(3000);
    expect(r.totalExpense).toBe(600);
    expect(r.net).toBe(2400);
    expect(r.daysCounted).toBe(5);
    expect(r.averageDailySpending).toBe(120);
    expect(r.topExpenseCategory?.categoryId).toBe('cat_food');
    expect(r.topExpenseCategory?.amount).toBe(500);
    expect(r.savingsRate).toBeCloseTo(0.8);
    expect(r.byDay).toHaveLength(5);
  });

  it('single day (today)', () => {
    const r = summarizeRange(input(data, '2026-09-02'), { start: '2026-09-02', end: '2026-09-02' });
    expect(r.totalExpense).toBe(400);
    expect(r.daysCounted).toBe(1);
  });

  it('range entirely in the future is empty', () => {
    const r = summarizeRange(input(data, '2026-09-02'), { start: '2026-10-01', end: '2026-10-31' });
    expect(r.totalExpense).toBe(0);
    expect(r.daysCounted).toBe(0);
    expect(r.savingsRate).toBeNull();
  });
});
