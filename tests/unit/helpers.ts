import { defaultCategories, defaultSettings } from '../../src/lib/defaults';
import type { EngineInput } from '../../src/lib/engine';
import { makeManualRate } from '../../src/lib/fx';
import type { ExchangeRate, Settings, Transaction, TxType } from '../../src/lib/types';

let seq = 0;
export function tx(
  type: TxType,
  amount: number,
  date: string,
  opts: Partial<Transaction> = {},
): Transaction {
  seq++;
  return {
    id: `t${seq}`,
    type,
    amount,
    currency: 'THB',
    categoryId: type === 'income' ? 'cat_salary' : 'cat_food',
    date,
    note: '',
    recurring: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...opts,
  };
}

/** A 30-day period: 2026-09-01 … 2026-09-30. */
export const PERIOD_30 = { kind: 'rolling', start: '2026-09-01', length: 30 } as const;

export function input(
  transactions: Transaction[],
  today: string,
  settings: Partial<Settings> = {},
  rates: ExchangeRate[] = [],
): EngineInput {
  return {
    transactions,
    categories: defaultCategories('2026-01-01T00:00:00.000Z'),
    rates,
    settings: { ...defaultSettings(), period: PERIOD_30, ...settings },
    today,
  };
}

export const manual = (base: string, quote: string, rate: number) =>
  makeManualRate(base, quote, rate, '2026-09-01T00:00:00.000Z');

export function provider(base: string, quote: string, rate: number, fetchedAt = '2026-09-01T00:00:00.000Z'): ExchangeRate {
  return {
    id: `${base}_${quote}_provider`,
    base,
    quote,
    rate,
    source: 'provider',
    sourceLabel: 'test provider',
    updatedAt: '2026-09-01T00:00:00.000Z',
    fetchedAt,
  };
}
