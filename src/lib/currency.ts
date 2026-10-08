import type { CustomCurrency } from './types';

export interface CurrencyDef {
  code: string;
  name: string;
  symbol: string;
  decimals: number;
  flag: string;
}

/** Built-in currencies. Users can add more via Settings → custom currencies. */
export const BUILTIN_CURRENCIES: readonly CurrencyDef[] = [
  { code: 'THB', name: 'Thai Baht', symbol: '฿', decimals: 2, flag: '🇹🇭' },
  { code: 'MMK', name: 'Myanmar Kyat', symbol: 'K', decimals: 0, flag: '🇲🇲' },
  { code: 'USD', name: 'US Dollar', symbol: '$', decimals: 2, flag: '🇺🇸' },
  { code: 'EUR', name: 'Euro', symbol: '€', decimals: 2, flag: '🇪🇺' },
  { code: 'GBP', name: 'British Pound', symbol: '£', decimals: 2, flag: '🇬🇧' },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$', decimals: 2, flag: '🇸🇬' },
  { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM', decimals: 2, flag: '🇲🇾' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥', decimals: 0, flag: '🇯🇵' },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥', decimals: 2, flag: '🇨🇳' },
];

export const CURRENCY_CODE_RE = /^[A-Z]{3}$/;

export function allCurrencies(custom: readonly CustomCurrency[] = []): CurrencyDef[] {
  const out: CurrencyDef[] = [...BUILTIN_CURRENCIES];
  for (const c of custom) {
    if (!out.some((b) => b.code === c.code)) out.push({ ...c, flag: '💱' });
  }
  return out;
}

export function getCurrency(code: string, custom: readonly CustomCurrency[] = []): CurrencyDef {
  return (
    allCurrencies(custom).find((c) => c.code === code) ?? {
      code,
      name: code,
      symbol: code,
      decimals: 2,
      flag: '💱',
    }
  );
}

/** Round half away from zero to `decimals`, avoiding binary float artefacts (1.005 → 1.01). */
export function roundTo(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) return 0;
  const sign = value < 0 ? -1 : 1;
  const r = Number(Math.round(Number(`${Math.abs(value)}e${decimals}`)) + `e-${decimals}`);
  return sign * r || 0;
}

export function roundMoney(value: number, code: string, custom: readonly CustomCurrency[] = []): number {
  return roundTo(value, getCurrency(code, custom).decimals);
}

/** Sum a list of amounts with intermediate rounding to cents to avoid drift. */
export function sumMoney(values: readonly number[]): number {
  let total = 0;
  for (const v of values) total = roundTo(total + v, 6);
  return roundTo(total, 6);
}

export function formatMoney(
  amount: number,
  code: string,
  opts: { custom?: readonly CustomCurrency[]; signed?: boolean; compact?: boolean } = {},
): string {
  const cur = getCurrency(code, opts.custom);
  const decimals = Math.abs(amount) >= 1000 && cur.decimals > 0 && opts.compact ? 0 : cur.decimals;
  const abs = Math.abs(roundTo(amount, cur.decimals));
  const num = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: Number.isInteger(abs) ? 0 : decimals,
    maximumFractionDigits: decimals,
  }).format(abs);
  const sign = amount < 0 && abs !== 0 ? '-' : opts.signed && abs !== 0 ? '+' : '';
  const sym = cur.symbol.length > 1 && /^[A-Z]/.test(cur.symbol) ? `${cur.symbol} ` : cur.symbol;
  return code === 'MMK' ? `${sign}${num} ${cur.symbol}s` : `${sign}${sym}${num}`;
}

/** Parse user-typed amounts like "1,250.50" or "1250". Returns null when invalid. */
export function parseAmount(input: string): number | null {
  const cleaned = input.replace(/[,\s_]/g, '');
  if (!/^\d*\.?\d+$|^\d+\.$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
