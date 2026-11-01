// Accounts (wallets), transfers and balances. Pure functions only.

import { roundMoney, sumMoney } from './currency';
import { isDateKey } from './dates';
import { CATEGORY_COLORS, cleanText, newId } from './defaults';
import { expandOccurrences } from './engine';
import { makeConverter } from './fx';
import type { Account, CustomCurrency, DateKey, ExchangeRate, Settings, Transaction, Transfer } from './types';

export type AccountError = 'name-required' | 'name-taken' | 'invalid-amount' | 'invalid-currency' | 'same-account' | 'unknown-account' | 'invalid-date';

export class AccountOpError extends Error {
  constructor(public code: AccountError) {
    super(code);
  }
}

export const ACCOUNT_ICONS = ['💵', '👛', '🏦', '💳', '📱', '🪙', '🐷', '💼', '🏧', '💰', '🌏', '⭐'];
const MAX_AMOUNT = 1e13;
/** Earliest date considered when expanding recurring entries for balances. */
const EPOCH: DateKey = '1900-01-01';

export function sortAccounts(list: readonly Account[], includeArchived = true): Account[] {
  return list.filter((a) => includeArchived || !a.archived).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

function assertName(list: readonly Account[], name: string, exceptId?: string): string {
  const clean = cleanText(name, 60);
  if (!clean) throw new AccountOpError('name-required');
  const lower = clean.toLocaleLowerCase();
  if (list.some((a) => a.id !== exceptId && a.name.toLocaleLowerCase() === lower)) throw new AccountOpError('name-taken');
  return clean;
}

function assertBalance(v: number): number {
  if (!Number.isFinite(v) || Math.abs(v) > MAX_AMOUNT) throw new AccountOpError('invalid-amount');
  return v;
}

export interface AccountInput {
  name: string;
  icon: string;
  color?: string;
  currency: string;
  openingBalance: number;
  archived?: boolean;
}

export function createAccount(list: readonly Account[], input: AccountInput, now = new Date().toISOString()): Account {
  if (!/^[A-Z]{3}$/.test(input.currency)) throw new AccountOpError('invalid-currency');
  return {
    id: newId('acc'),
    name: assertName(list, input.name),
    icon: input.icon || '💵',
    color: input.color ?? CATEGORY_COLORS[list.length % CATEGORY_COLORS.length],
    currency: input.currency,
    openingBalance: assertBalance(input.openingBalance),
    order: list.reduce((m, a) => Math.max(m, a.order + 1), 0),
    archived: !!input.archived,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateAccount(list: readonly Account[], id: string, input: AccountInput, now = new Date().toISOString()): Account {
  const acc = list.find((a) => a.id === id);
  if (!acc) throw new AccountOpError('unknown-account');
  if (!/^[A-Z]{3}$/.test(input.currency)) throw new AccountOpError('invalid-currency');
  return {
    ...acc,
    name: assertName(list, input.name, id),
    icon: input.icon || acc.icon,
    color: input.color ?? acc.color,
    currency: input.currency,
    openingBalance: assertBalance(input.openingBalance),
    archived: input.archived ?? acc.archived,
    updatedAt: now,
  };
}

/** Swap an account with its neighbour; returns the records that changed. */
export function moveAccount(list: readonly Account[], id: string, dir: -1 | 1, now = new Date().toISOString()): Account[] {
  const sorted = sortAccounts(list).map((a, i) => ({ ...a, order: i }));
  const i = sorted.findIndex((a) => a.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= sorted.length) return [];
  [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
  const original = new Map(list.map((a) => [a.id, a]));
  return sorted
    .map((a, k) => ({ ...a, order: k }))
    .filter((a) => original.get(a.id)!.order !== a.order)
    .map((a) => ({ ...a, updatedAt: now }));
}

/** What deleting an account touches: its transactions become unassigned, its transfers are removed. */
export function planAccountDelete(transactions: readonly Transaction[], transfers: readonly Transfer[], id: string, now = new Date().toISOString()) {
  return {
    unassigned: transactions.filter((t) => t.accountId === id).map((t) => ({ ...t, accountId: null, updatedAt: now })),
    transferIds: transfers.filter((x) => x.fromAccountId === id || x.toAccountId === id).map((x) => x.id),
  };
}

export interface TransferInput {
  id?: string;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  toAmount: number;
  date: DateKey;
  note: string;
}

export function buildTransfer(accounts: readonly Account[], existing: Transfer | undefined, input: TransferInput, now = new Date().toISOString()): Transfer {
  if (input.fromAccountId === input.toAccountId) throw new AccountOpError('same-account');
  const from = accounts.find((a) => a.id === input.fromAccountId);
  const to = accounts.find((a) => a.id === input.toAccountId);
  if (!from || !to) throw new AccountOpError('unknown-account');
  const ok = (v: number) => Number.isFinite(v) && v > 0 && v <= MAX_AMOUNT;
  // Same currency: the received amount always equals the sent amount.
  const toAmount = from.currency === to.currency ? input.amount : input.toAmount;
  if (!ok(input.amount) || !ok(toAmount)) throw new AccountOpError('invalid-amount');
  if (!isDateKey(input.date)) throw new AccountOpError('invalid-date');
  return {
    id: existing?.id ?? newId('trf'),
    fromAccountId: from.id,
    toAccountId: to.id,
    amount: input.amount,
    toAmount,
    date: input.date,
    note: cleanText(input.note, 500),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------

export interface AccountBalance {
  accountId: string;
  currency: string;
  /** Opening balance + income − expenses ± transfers, up to and including `today`. */
  balance: number;
  income: number;
  expense: number;
  transfersIn: number;
  transfersOut: number;
  /** Entries in another currency without a usable exchange rate (left out of the balance). */
  unconverted: number;
  /** Future-dated (scheduled) net change after today. */
  upcoming: number;
}

export interface BalanceInput {
  accounts: readonly Account[];
  transactions: readonly Transaction[];
  transfers: readonly Transfer[];
  rates: readonly ExchangeRate[];
  settings: Pick<Settings, 'manualFirstCurrencies' | 'customCurrencies'>;
  today: DateKey;
  /** How far ahead to look for scheduled entries (default 31 days). */
  horizon?: DateKey;
}

export function accountBalances(input: BalanceInput): Map<string, AccountBalance> {
  const out = new Map<string, AccountBalance>();
  const convs = new Map<string, ReturnType<typeof makeConverter>>();
  const conv = (cur: string) => {
    let c = convs.get(cur);
    if (!c) convs.set(cur, (c = makeConverter(input.rates, cur, input.settings.manualFirstCurrencies)));
    return c;
  };
  const parts = new Map<string, { inc: number[]; exp: number[]; tin: number[]; tout: number[]; future: number[]; unconverted: number }>();
  for (const a of input.accounts) parts.set(a.id, { inc: [], exp: [], tin: [], tout: [], future: [], unconverted: 0 });
  const byId = new Map(input.accounts.map((a) => [a.id, a]));

  const linked = input.transactions.filter((t) => t.accountId !== null && parts.has(t.accountId));
  const horizon = input.horizon ?? input.today;
  for (const occ of expandOccurrences(linked, { start: EPOCH, end: horizon > input.today ? horizon : input.today })) {
    const acc = byId.get(occ.tx.accountId!)!;
    const p = parts.get(acc.id)!;
    const v = conv(acc.currency)(occ.tx.amount, occ.tx.currency);
    if (v === null) {
      p.unconverted++;
      continue;
    }
    if (occ.date > input.today) p.future.push(occ.tx.type === 'income' ? v : -v);
    else (occ.tx.type === 'income' ? p.inc : p.exp).push(v);
  }
  for (const x of input.transfers) {
    const from = parts.get(x.fromAccountId);
    const to = parts.get(x.toAccountId);
    if (x.date > input.today) {
      if (x.date <= horizon) {
        from?.future.push(-x.amount);
        to?.future.push(x.toAmount);
      }
      continue;
    }
    from?.tout.push(x.amount);
    to?.tin.push(x.toAmount);
  }
  for (const a of input.accounts) {
    const p = parts.get(a.id)!;
    const money = (v: number) => roundMoney(v, a.currency, input.settings.customCurrencies);
    const income = sumMoney(p.inc);
    const expense = sumMoney(p.exp);
    const transfersIn = sumMoney(p.tin);
    const transfersOut = sumMoney(p.tout);
    out.set(a.id, {
      accountId: a.id,
      currency: a.currency,
      balance: money(a.openingBalance + income - expense + transfersIn - transfersOut),
      income: money(income),
      expense: money(expense),
      transfersIn: money(transfersIn),
      transfersOut: money(transfersOut),
      unconverted: p.unconverted,
      upcoming: money(sumMoney(p.future)),
    });
  }
  return out;
}

export interface NetWorth {
  currency: string;
  total: number;
  assets: number;
  liabilities: number;
  /** Account currencies without a rate to the primary currency (left out of the total). */
  missingCurrencies: string[];
}

/** Sum of active (non-archived) account balances in the primary currency. */
export function netWorth(
  accounts: readonly Account[],
  balances: Map<string, AccountBalance>,
  rates: readonly ExchangeRate[],
  settings: Pick<Settings, 'primaryCurrency' | 'manualFirstCurrencies'> & { customCurrencies: CustomCurrency[] },
): NetWorth {
  const conv = makeConverter(rates, settings.primaryCurrency, settings.manualFirstCurrencies);
  const missing = new Set<string>();
  const assets: number[] = [];
  const debts: number[] = [];
  for (const a of accounts) {
    if (a.archived) continue;
    const b = balances.get(a.id);
    if (!b) continue;
    const v = conv(b.balance, a.currency);
    if (v === null) missing.add(a.currency);
    else (v >= 0 ? assets : debts).push(v);
  }
  const money = (v: number) => roundMoney(v, settings.primaryCurrency, settings.customCurrencies);
  const a = sumMoney(assets);
  const l = -sumMoney(debts);
  return { currency: settings.primaryCurrency, total: money(a - l), assets: money(a), liabilities: money(l), missingCurrencies: [...missing].sort() };
}
