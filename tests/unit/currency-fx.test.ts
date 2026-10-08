import { describe, expect, it } from 'vitest';
import { allCurrencies, BUILTIN_CURRENCIES, formatMoney, getCurrency, parseAmount, roundTo, sumMoney } from '../../src/lib/currency';
import {
  convert,
  LIVE_WINDOW_MS,
  makeConverter,
  makeManualRate,
  MANUAL_LABEL,
  providerResultToRates,
  rateStatus,
  resolveRate,
} from '../../src/lib/fx';
import { manual, provider } from './helpers';

describe('currency list', () => {
  it('includes all required currencies', () => {
    const codes = BUILTIN_CURRENCIES.map((c) => c.code);
    for (const c of ['THB', 'MMK', 'USD', 'EUR', 'GBP', 'SGD', 'MYR', 'JPY', 'CNY']) expect(codes).toContain(c);
  });

  it('is extensible with custom currencies', () => {
    const list = allCurrencies([{ code: 'VND', name: 'Vietnamese Dong', symbol: '₫', decimals: 0 }]);
    expect(list.map((c) => c.code)).toContain('VND');
    expect(getCurrency('VND', [{ code: 'VND', name: 'Vietnamese Dong', symbol: '₫', decimals: 0 }]).decimals).toBe(0);
  });

  it('unknown codes fall back safely', () => {
    expect(getCurrency('XYZ').code).toBe('XYZ');
  });
});

describe('money helpers', () => {
  it('rounds half away from zero without float artefacts', () => {
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(-1.005, 2)).toBe(-1.01);
    expect(roundTo(66.666666, 2)).toBe(66.67);
    expect(roundTo(NaN)).toBe(0);
  });

  it('sums without drift', () => {
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
    expect(sumMoney(Array(10).fill(0.1))).toBe(1);
  });

  it('formats per currency', () => {
    expect(formatMoney(3000, 'THB')).toBe('฿3,000');
    expect(formatMoney(58.333, 'THB')).toBe('฿58.33');
    expect(formatMoney(-25, 'THB')).toBe('-฿25');
    expect(formatMoney(1234567, 'MMK')).toBe('1,234,567 Ks');
    expect(formatMoney(1000.4, 'JPY')).toBe('¥1,000');
    expect(formatMoney(10, 'USD', { signed: true })).toBe('+$10');
  });

  it('parses typed amounts', () => {
    expect(parseAmount('1,250.50')).toBe(1250.5);
    expect(parseAmount(' 100 ')).toBe(100);
    expect(parseAmount('.5')).toBe(0.5);
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('1.2.3')).toBeNull();
    expect(parseAmount('-5')).toBeNull();
    expect(parseAmount('')).toBeNull();
  });
});

describe('exchange-rate resolution', () => {
  it('identity', () => {
    expect(resolveRate([], 'THB', 'THB')?.rate).toBe(1);
  });

  it('direct and inverse rates', () => {
    const rates = [provider('USD', 'THB', 35)];
    expect(convert(rates, 100, 'USD', 'THB')).toBe(3500);
    expect(convert(rates, 3500, 'THB', 'USD')).toBeCloseTo(100, 10);
  });

  it('cross rates through a pivot: USD → THB → MMK', () => {
    const rates = [provider('USD', 'THB', 35), manual('THB', 'MMK', 120)];
    const r = resolveRate(rates, 'USD', 'MMK')!;
    expect(r.rate).toBeCloseTo(4200, 8);
    expect(r.kind).toBe('manual');
    expect(r.steps).toHaveLength(2);
  });

  it('calculator examples: 100 USD → THB, 1,000 THB → MMK, 100 USD → MMK', () => {
    const rates = [provider('USD', 'THB', 36.5), manual('THB', 'MMK', 125)];
    expect(convert(rates, 100, 'USD', 'THB')).toBeCloseTo(3650, 8);
    expect(convert(rates, 1000, 'THB', 'MMK')).toBe(125_000);
    expect(convert(rates, 100, 'USD', 'MMK', ['MMK'])).toBeCloseTo(456_250, 6);
  });

  it('manual rate overrides a provider rate for the same pair', () => {
    const rates = [provider('THB', 'MMK', 60), manual('THB', 'MMK', 125)];
    const r = resolveRate(rates, 'THB', 'MMK')!;
    expect(r.rate).toBe(125);
    expect(r.kind).toBe('manual');
  });

  it('manual-first currencies ignore the provider’s official rate', () => {
    const rates = [provider('USD', 'THB', 35), provider('USD', 'MMK', 2100), manual('THB', 'MMK', 120)];
    // Without manual-first, the shortest path is the provider's direct USD→MMK.
    expect(resolveRate(rates, 'USD', 'MMK')!.rate).toBe(2100);
    // With MMK manual-first, the user's THB→MMK rate is used.
    expect(resolveRate(rates, 'USD', 'MMK', { manualFirst: ['MMK'] })!.rate).toBeCloseTo(4200, 8);
    // Conversions not involving MMK are unaffected.
    expect(resolveRate(rates, 'THB', 'USD', { manualFirst: ['MMK'] })!.rate).toBeCloseTo(1 / 35, 10);
  });

  it('manual-first falls back to provider when no manual rate exists for that currency', () => {
    const rates = [provider('USD', 'MMK', 2100)];
    expect(resolveRate(rates, 'USD', 'MMK', { manualFirst: ['MMK'] })!.rate).toBe(2100);
  });

  it('a manual USD→MMK rate works too', () => {
    const rates = [manual('USD', 'MMK', 4400), provider('USD', 'THB', 35)];
    expect(convert(rates, 1000, 'THB', 'MMK', ['MMK'])).toBeCloseTo((1000 / 35) * 4400, 6);
  });

  it('missing rate returns null', () => {
    expect(resolveRate([provider('USD', 'THB', 35)], 'EUR', 'THB')).toBeNull();
    expect(convert([], 1, 'EUR', 'THB')).toBeNull();
  });

  it('ignores invalid (zero/negative/NaN) rates', () => {
    const bad = [{ ...provider('USD', 'THB', 0) }, { ...provider('EUR', 'THB', NaN) }];
    expect(resolveRate(bad, 'USD', 'THB')).toBeNull();
    expect(resolveRate(bad, 'EUR', 'THB')).toBeNull();
  });

  it('memoising converter', () => {
    const conv = makeConverter([provider('USD', 'THB', 35)], 'THB');
    expect(conv(2, 'USD')).toBe(70);
    expect(conv(5, 'THB')).toBe(5);
    expect(conv(5, 'EUR')).toBeNull();
  });
});

describe('rate status labelling', () => {
  const now = Date.parse('2026-09-01T12:00:00Z');
  it('manual rates are always labelled manual', () => {
    const r = makeManualRate('THB', 'MMK', 120);
    expect(rateStatus(r, now)).toBe('manual');
    expect(r.sourceLabel).toBe(MANUAL_LABEL);
  });
  it('provider rates are live only within the live window', () => {
    expect(rateStatus(provider('USD', 'THB', 35, new Date(now - 5 * 60_000).toISOString()), now)).toBe('live');
    expect(rateStatus(provider('USD', 'THB', 35, new Date(now - LIVE_WINDOW_MS - 1).toISOString()), now)).toBe('cached');
  });
  it('blank manual source label falls back to the manual label', () => {
    expect(makeManualRate('THB', 'MMK', 1, undefined, '  ').sourceLabel).toBe(MANUAL_LABEL);
  });
});

describe('provider adapter', () => {
  it('keeps only requested, valid currencies', () => {
    const rates = providerResultToRates(
      { base: 'USD', rates: { USD: 1, THB: 35, MMK: 2100, EUR: -1, XXX: 5 }, publishedAt: '2026-09-01T00:00:00Z' },
      ['USD', 'THB', 'MMK', 'EUR'],
      'test',
      '2026-09-01T01:00:00Z',
    );
    expect(rates.map((r) => r.quote)).toEqual(['THB', 'MMK']);
    expect(rates.every((r) => r.source === 'provider' && r.fetchedAt === '2026-09-01T01:00:00Z')).toBe(true);
  });
});
