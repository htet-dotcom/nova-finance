// Core domain types. Everything persisted locally conforms to these shapes.

export type TxType = 'income' | 'expense';

/** Calendar date without time, always `YYYY-MM-DD` in the user's local calendar. */
export type DateKey = string;

export interface Recurrence {
  freq: 'weekly' | 'monthly';
  /** Last date (inclusive) an occurrence may fall on; null = open-ended. */
  until: DateKey | null;
}

export interface Transaction {
  id: string;
  type: TxType;
  /** Positive amount in `currency` major units. */
  amount: number;
  currency: string;
  categoryId: string;
  date: DateKey;
  note: string;
  recurring: Recurrence | null;
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  name: string;
  type: TxType;
  icon: string;
  color: string;
  order: number;
  /** Optional per-period budget in the primary currency (expense categories only). */
  budget: number | null;
  /**
   * Fixed-cost category (rent, phone, ...). Spending here is covered by the
   * "fixed expenses" reserve instead of the daily discretionary allowance.
   */
  fixed: boolean;
  createdAt: string;
  updatedAt: string;
}

export type RateSource = 'provider' | 'manual';

export interface ExchangeRate {
  /** `${base}_${quote}_${source}` */
  id: string;
  base: string;
  quote: string;
  /** 1 base = `rate` quote */
  rate: number;
  source: RateSource;
  /** Human readable origin, e.g. "open.er-api.com" or "Manual / User-entered rate". */
  sourceLabel: string;
  /** When the rate value was entered (manual) or published by the provider. */
  updatedAt: string;
  /** When this device fetched the rate (provider only). */
  fetchedAt: string | null;
}

export type PeriodConfig =
  | { kind: 'month'; startDay: number }
  | { kind: 'custom'; start: DateKey; end: DateKey }
  | { kind: 'rolling'; start: DateKey; length: number };

export interface CustomCurrency {
  code: string;
  name: string;
  symbol: string;
  decimals: number;
}

export interface Settings {
  primaryCurrency: string;
  language: 'en' | 'my';
  theme: 'system' | 'light' | 'dark';
  period: PeriodConfig;
  /** 'recorded' = sum of income transactions in the period; 'planned' = fixed amount below. */
  incomeBasis: 'recorded' | 'planned';
  plannedIncome: number;
  /** Count income dated later in the current period (e.g. upcoming salary) as already available. */
  includeUpcomingIncome: boolean;
  savingsTarget: number;
  emergencyReserve: number;
  fixedExpenses: number;
  protectedAmount: number;
  /** 'dynamic' recalculates from remaining money / remaining days; 'even' = spendable / period length. */
  allowanceMode: 'dynamic' | 'even';
  /** Fraction of today's limit at which the "near limit" state starts (0.5 – 1). */
  nearLimitRatio: number;
  enabledCurrencies: string[];
  customCurrencies: CustomCurrency[];
  rateProviderEnabled: boolean;
  /** Currencies whose manual rates override provider rates entirely (default: MMK). */
  manualFirstCurrencies: string[];
  lastBackupAt: string | null;
}

export interface AppData {
  transactions: Transaction[];
  categories: Category[];
  rates: ExchangeRate[];
  settings: Settings;
}
