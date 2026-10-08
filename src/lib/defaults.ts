import type { Category, Settings, TxType } from './types';

export function newId(prefix = ''): string {
  const c = globalThis.crypto;
  const raw =
    c && typeof c.randomUUID === 'function'
      ? c.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
  return prefix ? `${prefix}_${raw}` : raw;
}

// Control chars, line/paragraph separators and BOM (zero-width chars are kept: emoji ZWJ sequences and Myanmar word breaks use them).
const UNSAFE_CHARS = new RegExp('[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u2029\uFEFF]', 'g');

/** Strip control characters and collapse whitespace in user-entered text; cap the length. */
export function cleanText(input: unknown, max = 200): string {
  if (typeof input !== 'string') return '';
  return input.replace(UNSAFE_CHARS, '').replace(/[ 	]+/g, ' ').trim().slice(0, max);
}

export const CATEGORY_COLORS = [
  '#f97316', '#0ea5e9', '#8b5cf6', '#14b8a6', '#ec4899', '#eab308',
  '#ef4444', '#22c55e', '#6366f1', '#06b6d4', '#a855f7', '#64748b',
];

export const CATEGORY_ICONS = [
  '🍜', '🍚', '☕', '🛒', '🚌', '🚕', '⛽', '🏠', '📱', '🌐', '🛍️', '🎬', '🎮', '🧾', '💡', '💧',
  '🏥', '💊', '📚', '🎓', '👨‍👩‍👧', '🎁', '✈️', '🐶', '💇', '👕', '🏋️', '🍺', '🚗', '🔧', '❤️', '📦',
  '💼', '💻', '🏪', '💰', '📈', '🪙', '🏦', '🧧', '⭐',
];

interface Seed {
  key: string;
  name: string;
  icon: string;
  fixed?: boolean;
}

const EXPENSE_SEEDS: Seed[] = [
  { key: 'food', name: 'Food', icon: '🍜' },
  { key: 'transport', name: 'Transportation', icon: '🚌' },
  { key: 'rent', name: 'Rent', icon: '🏠', fixed: true },
  { key: 'phone', name: 'Phone', icon: '📱', fixed: true },
  { key: 'internet', name: 'Internet', icon: '🌐', fixed: true },
  { key: 'shopping', name: 'Shopping', icon: '🛍️' },
  { key: 'entertainment', name: 'Entertainment', icon: '🎬' },
  { key: 'bills', name: 'Bills', icon: '🧾', fixed: true },
  { key: 'health', name: 'Health', icon: '🏥' },
  { key: 'education', name: 'Education', icon: '📚' },
  { key: 'family', name: 'Family', icon: '👨‍👩‍👧' },
  { key: 'other-expense', name: 'Other', icon: '📦' },
];

const INCOME_SEEDS: Seed[] = [
  { key: 'salary', name: 'Salary', icon: '💼' },
  { key: 'freelance', name: 'Freelance', icon: '💻' },
  { key: 'business', name: 'Business', icon: '🏪' },
  { key: 'other-income', name: 'Other income', icon: '💰' },
];

export function defaultCategories(now = new Date().toISOString()): Category[] {
  const build = (seeds: Seed[], type: TxType, offset: number): Category[] =>
    seeds.map((s, i) => ({
      id: `cat_${s.key}`,
      name: s.name,
      type,
      icon: s.icon,
      color: CATEGORY_COLORS[(i + offset) % CATEGORY_COLORS.length],
      order: i,
      budget: null,
      fixed: !!s.fixed,
      createdAt: now,
      updatedAt: now,
    }));
  return [...build(EXPENSE_SEEDS, 'expense', 0), ...build(INCOME_SEEDS, 'income', 7)];
}

export function defaultSettings(): Settings {
  return {
    primaryCurrency: 'THB',
    language: 'en',
    theme: 'system',
    period: { kind: 'month', startDay: 1 },
    incomeBasis: 'recorded',
    plannedIncome: 0,
    includeUpcomingIncome: false,
    savingsTarget: 0,
    emergencyReserve: 0,
    fixedExpenses: 0,
    protectedAmount: 0,
    allowanceMode: 'dynamic',
    nearLimitRatio: 0.8,
    enabledCurrencies: ['THB', 'MMK', 'USD', 'EUR', 'GBP', 'SGD', 'MYR', 'JPY', 'CNY'],
    customCurrencies: [],
    rateProviderEnabled: true,
    manualFirstCurrencies: ['MMK'],
    lastBackupAt: null,
  };
}
