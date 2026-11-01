import { describe, expect, it } from 'vitest';
import {
  AccountOpError,
  accountBalances,
  buildTransfer,
  createAccount,
  moveAccount,
  netWorth,
  planAccountDelete,
  updateAccount,
} from '../../src/lib/accounts';
import { BACKUP_FORMAT, buildBackup, buildCsv, parseBackup, planImport } from '../../src/lib/backup';
import { defaultCategories, defaultSettings } from '../../src/lib/defaults';
import { addContribution, createGoal, GoalOpError, goalProgress, goalSaved, removeContribution, updateGoal } from '../../src/lib/goals';
import type { Account, AppData, Transfer } from '../../src/lib/types';
import { manual, tx } from './helpers';

const NOW = '2026-09-01T00:00:00.000Z';
const settings = defaultSettings();

function accounts() {
  const cash = createAccount([], { name: 'Cash', icon: '💵', currency: 'THB', openingBalance: 1000 }, NOW);
  const bank = createAccount([cash], { name: 'KBZ', icon: '🏦', currency: 'MMK', openingBalance: 0 }, NOW);
  return { cash, bank, list: [cash, bank] };
}

describe('accounts', () => {
  it('validates names (required, unique case-insensitive) and amounts', () => {
    const { cash, list } = accounts();
    expect(() => createAccount(list, { name: '  ', icon: '💵', currency: 'THB', openingBalance: 0 })).toThrow(AccountOpError);
    expect(() => createAccount(list, { name: 'cash', icon: '💵', currency: 'THB', openingBalance: 0 })).toThrow(/name-taken/);
    expect(() => createAccount(list, { name: 'X', icon: '💵', currency: 'thb', openingBalance: 0 })).toThrow(/invalid-currency/);
    expect(() => createAccount(list, { name: 'X', icon: '💵', currency: 'THB', openingBalance: Number.NaN })).toThrow(/invalid-amount/);
    // Renaming to its own name is fine; negative opening balance (debt) is allowed.
    expect(updateAccount(list, cash.id, { name: 'Cash', icon: '💵', currency: 'THB', openingBalance: -50 }).openingBalance).toBe(-50);
  });

  it('orders new accounts last and swaps on move', () => {
    const { cash, bank, list } = accounts();
    expect(bank.order).toBe(cash.order + 1);
    const changed = moveAccount(list, bank.id, -1);
    expect(changed.map((a) => [a.id, a.order])).toEqual(expect.arrayContaining([[bank.id, 0], [cash.id, 1]]));
    expect(moveAccount(list, cash.id, -1)).toEqual([]);
  });

  it('computes balances: opening + income − expense ± transfers, today only, recurring included', () => {
    const { cash, bank, list } = accounts();
    const txs = [
      tx('income', 500, '2026-09-02', { accountId: cash.id }),
      tx('expense', 200, '2026-09-03', { accountId: cash.id }),
      tx('expense', 100, '2026-09-20', { accountId: cash.id }), // future → upcoming
      tx('expense', 10, '2026-08-01', { accountId: cash.id, recurring: { freq: 'monthly', until: null } }), // Aug 1 + Sep 1
      tx('expense', 999, '2026-09-02'), // unassigned: ignored
    ];
    const transfers: Transfer[] = [buildTransfer(list, undefined, { fromAccountId: cash.id, toAccountId: bank.id, amount: 100, toAmount: 12000, date: '2026-09-04', note: '' }, NOW)];
    const b = accountBalances({ accounts: list, transactions: txs, transfers, rates: [], settings, today: '2026-09-10', horizon: '2026-09-30' });
    expect(b.get(cash.id)).toMatchObject({ balance: 1000 + 500 - 200 - 20 - 100, income: 500, expense: 220, transfersOut: 100, upcoming: -100 });
    expect(b.get(bank.id)).toMatchObject({ balance: 12000, transfersIn: 12000 });
  });

  it('converts foreign-currency entries into the account currency, and flags missing rates', () => {
    const { cash, list } = accounts();
    const txs = [tx('expense', 1200, '2026-09-02', { accountId: cash.id, currency: 'MMK' }), tx('expense', 5, '2026-09-02', { accountId: cash.id, currency: 'EUR' })];
    const b = accountBalances({ accounts: list, transactions: txs, transfers: [], rates: [manual('THB', 'MMK', 120)], settings, today: '2026-09-10' });
    expect(b.get(cash.id)).toMatchObject({ balance: 990, unconverted: 1 });
  });

  it('net worth sums active accounts in the primary currency; debts reduce it; archived excluded', () => {
    const { cash, bank } = accounts();
    const card: Account = { ...createAccount([cash, bank], { name: 'Card', icon: '💳', currency: 'THB', openingBalance: -300 }, NOW) };
    const old: Account = { ...createAccount([cash, bank, card], { name: 'Old', icon: '🏦', currency: 'THB', openingBalance: 5000 }, NOW), archived: true };
    const list = [cash, bank, card, old];
    const b = accountBalances({ accounts: list, transactions: [], transfers: [], rates: [], settings, today: '2026-09-10' });
    b.set(bank.id, { ...b.get(bank.id)!, balance: 12000 });
    const w = netWorth(list, b, [manual('THB', 'MMK', 120)], settings);
    expect(w).toMatchObject({ assets: 1100, liabilities: 300, total: 800, missingCurrencies: [] });
    expect(netWorth(list, b, [], settings).missingCurrencies).toEqual(['MMK']);
  });

  it('transfers: different accounts, positive amounts, same-currency amounts are forced equal', () => {
    const { cash, bank, list } = accounts();
    expect(() => buildTransfer(list, undefined, { fromAccountId: cash.id, toAccountId: cash.id, amount: 1, toAmount: 1, date: '2026-09-01', note: '' })).toThrow(/same-account/);
    expect(() => buildTransfer(list, undefined, { fromAccountId: cash.id, toAccountId: bank.id, amount: 0, toAmount: 1, date: '2026-09-01', note: '' })).toThrow(/invalid-amount/);
    const cash2 = createAccount(list, { name: 'Cash 2', icon: '💵', currency: 'THB', openingBalance: 0 });
    const x = buildTransfer([...list, cash2], undefined, { fromAccountId: cash.id, toAccountId: cash2.id, amount: 50, toAmount: 999, date: '2026-09-01', note: '' });
    expect(x.toAmount).toBe(50);
  });

  it('deleting an account unassigns its transactions and removes its transfers', () => {
    const { cash, bank, list } = accounts();
    const t1 = tx('expense', 5, '2026-09-02', { accountId: cash.id });
    const t2 = tx('expense', 5, '2026-09-02', { accountId: bank.id });
    const x = buildTransfer(list, undefined, { fromAccountId: cash.id, toAccountId: bank.id, amount: 1, toAmount: 120, date: '2026-09-01', note: '' });
    const plan = planAccountDelete([t1, t2], [x], cash.id);
    expect(plan.unassigned.map((t) => [t.id, t.accountId])).toEqual([[t1.id, null]]);
    expect(plan.transferIds).toEqual([x.id]);
  });
});

describe('savings goals', () => {
  const base = () => createGoal([], { name: 'Phone', icon: '📱', currency: 'THB', target: 12000, deadline: '2026-12-31' }, NOW);

  it('validates input', () => {
    expect(() => createGoal([], { name: '', icon: '🎯', currency: 'THB', target: 1, deadline: null })).toThrow(GoalOpError);
    expect(() => createGoal([], { name: 'X', icon: '🎯', currency: 'THB', target: 0, deadline: null })).toThrow(/invalid-target/);
    expect(() => createGoal([], { name: 'X', icon: '🎯', currency: 'THB', target: 1, deadline: '2026-02-30' })).toThrow(/invalid-date/);
  });

  it('deposits and withdrawals; cannot take out more than saved', () => {
    let g = addContribution(base(), { amount: 3000, date: '2026-09-05', note: '' });
    g = addContribution(g, { amount: -500, date: '2026-09-06', note: 'oops' });
    expect(goalSaved(g)).toBe(2500);
    expect(() => addContribution(g, { amount: -3000, date: '2026-09-07', note: '' })).toThrow(/overdraw/);
    // Removing the deposit would leave a negative balance.
    expect(() => removeContribution(g, g.contributions[0].id)).toThrow(/overdraw/);
    expect(goalSaved(removeContribution(g, g.contributions[1].id))).toBe(3000);
  });

  it('currency is locked once money was added', () => {
    const g = addContribution(base(), { amount: 1, date: '2026-09-05', note: '' });
    expect(() => updateGoal(g, { name: 'Phone', icon: '📱', currency: 'USD', target: 12000, deadline: null })).toThrow(/invalid-currency/);
  });

  it('progress: per-month pace, on-track vs behind, done, overdue, no deadline', () => {
    // Created Sep 1, deadline Dec 31 (122 days). On Oct 31 (61 days in) ~50% is expected.
    const g = base();
    const behind = goalProgress(addContribution(g, { amount: 3000, date: '2026-09-05', note: '' }), '2026-10-31');
    expect(behind.status).toBe('behind');
    expect(behind.daysLeft).toBe(62);
    expect(behind.perDay).toBeCloseTo(9000 / 62, 2);
    expect(behind.perMonth).toBeCloseTo(9000 / (62 / 30.4375), 0);

    const onTrack = goalProgress(addContribution(g, { amount: 6000, date: '2026-09-05', note: '' }), '2026-10-31');
    expect(onTrack.status).toBe('on-track');

    expect(goalProgress(addContribution(g, { amount: 12000, date: '2026-09-05', note: '' }), '2026-10-31')).toMatchObject({ status: 'done', ratio: 1, remaining: 0 });
    expect(goalProgress(g, '2027-01-02')).toMatchObject({ status: 'overdue', daysLeft: 0 });
    expect(goalProgress({ ...g, deadline: null }, '2026-10-31')).toMatchObject({ status: 'no-deadline', perMonth: null });
  });
});

describe('backup v2: accounts, transfers, goals', () => {
  function data(): AppData {
    const { cash, bank, list } = accounts();
    const goal = addContribution(createGoal([], { name: 'Trip', icon: '✈️', currency: 'THB', target: 5000, deadline: null }, NOW), { amount: 100, date: '2026-09-02', note: '' }, [], NOW);
    return {
      transactions: [tx('expense', 10, '2026-09-02', { id: 'e1', accountId: cash.id }), tx('income', 10, '2026-09-02', { id: 'i1' })],
      categories: defaultCategories(NOW),
      rates: [],
      accounts: list,
      transfers: [buildTransfer(list, undefined, { fromAccountId: cash.id, toAccountId: bank.id, amount: 5, toAmount: 600, date: '2026-09-03', note: 'atm' }, NOW)],
      goals: [goal],
      settings,
    };
  }

  it('round-trips', () => {
    const d = data();
    const r = parseBackup(JSON.stringify(buildBackup(d, '2.0.0')));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.backup.data.accounts).toHaveLength(2);
    expect(r.backup.data.transfers[0]).toMatchObject({ amount: 5, toAmount: 600, note: 'atm' });
    expect(r.backup.data.goals[0].contributions).toHaveLength(1);
    expect(r.backup.data.transactions.find((t) => t.id === 'e1')?.accountId).toBe(d.accounts[0].id);
  });

  it('migrates a v1 backup (no accounts; transactions without accountId)', () => {
    const d = data();
    const v1 = {
      format: BACKUP_FORMAT,
      schemaVersion: 1,
      exportedAt: NOW,
      data: {
        transactions: d.transactions.map(({ accountId: _drop, ...rest }) => rest),
        categories: d.categories,
        rates: [],
        settings,
      },
    };
    const r = parseBackup(JSON.stringify(v1));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings[0]).toMatch(/v1 to v2/);
    expect(r.backup.data.transactions.every((t) => t.accountId === null)).toBe(true);
    expect(r.backup.data.accounts).toEqual([]);
  });

  it('rejects references to unknown accounts', () => {
    const d = data();
    const bad = buildBackup({ ...d, accounts: [d.accounts[1]] }, '2.0.0');
    const r = parseBackup(JSON.stringify(bad));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => /Unknown account/.test(e.message))).toBe(true);
  });

  it('merge keeps references valid and counts new record types', () => {
    const d = data();
    const empty: AppData = { ...d, transactions: [], accounts: [], transfers: [], goals: [] };
    const plan = planImport(empty, d, 'merge');
    expect(plan.stats.accounts.added).toBe(2);
    expect(plan.stats.transfers.added).toBe(1);
    expect(plan.stats.goals.added).toBe(1);
  });

  it('CSV includes account column and new sections', () => {
    const csv = buildCsv(data());
    expect(csv).toContain('recurring_until,account,id');
    expect(csv).toContain('# Accounts');
    expect(csv).toContain('# Transfers');
    expect(csv).toContain('# Savings goals');
  });
});
