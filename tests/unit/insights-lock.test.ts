import { describe, expect, it } from 'vitest';
import { buildInsights, compareToLastMonth, monthlyTrend, weekdayAverages } from '../../src/lib/insights';
import { createLockConfig, fromB64, isValidPin, registerFailure, remainingBlockMs, toB64, verifyPin } from '../../src/lib/lock';
import { input, tx } from './helpers';

const MONTH = { kind: 'month', startDay: 1 } as const;

describe('insights', () => {
  it('monthly trend: last N calendar months, oldest first, current month marked partial', () => {
    const txs = [tx('income', 1000, '2026-07-01'), tx('expense', 300, '2026-07-15'), tx('expense', 200, '2026-09-03'), tx('expense', 50, '2026-09-20')];
    const m = monthlyTrend(input(txs, '2026-09-10', { period: MONTH }), 3);
    expect(m.map((x) => x.month)).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(m[0]).toMatchObject({ income: 1000, expense: 300, net: 700, partial: false });
    // Future-dated entries are not counted.
    expect(m[2]).toMatchObject({ expense: 200, partial: true });
  });

  it('compares month-to-date with the same days of last month', () => {
    const txs = [tx('expense', 100, '2026-08-05'), tx('expense', 900, '2026-08-25'), tx('expense', 150, '2026-09-04')];
    const c = compareToLastMonth(input(txs, '2026-09-10', { period: MONTH }));
    expect(c.previous).toEqual({ start: '2026-08-01', end: '2026-08-10' });
    expect(c.previousTotal).toBe(100);
    expect(c.currentTotal).toBe(150);
    expect(c.change).toBeCloseTo(0.5);
  });

  it('clamps the comparison window to the end of a shorter previous month', () => {
    const c = compareToLastMonth(input([], '2026-03-31', { period: MONTH }));
    expect(c.previous).toEqual({ start: '2026-02-01', end: '2026-02-28' });
  });

  it('weekday averages are Monday-first and exclude today', () => {
    // 2026-09-07 is a Monday.
    const txs = [tx('expense', 70, '2026-09-07'), tx('expense', 999, '2026-09-10')];
    const w = weekdayAverages(input(txs, '2026-09-10', { period: MONTH }), 1);
    expect(w.range).toEqual({ start: '2026-09-03', end: '2026-09-09' });
    expect(w.averages[0]).toBe(70);
    expect(w.averages.reduce((a, b) => a + b, 0)).toBe(70);
  });

  it('builds highlights: pace, category change, savings rate, weekday, no-spend days', () => {
    const food = (amount: number, date: string) => tx('expense', amount, date, { categoryId: 'cat_food' });
    const shop = (amount: number, date: string) => tx('expense', amount, date, { categoryId: 'cat_shopping' });
    const txs = [
      tx('income', 10000, '2026-08-01'),
      food(1000, '2026-08-03'),
      shop(1000, '2026-08-04'),
      food(3000, '2026-09-02'),
      shop(1000, '2026-09-04'),
    ];
    const kinds = buildInsights(input(txs, '2026-09-10', { period: MONTH })).map((x) => x.kind);
    expect(kinds).toContain('pace');
    expect(kinds).toContain('category-up');
    expect(kinds).toContain('savings-rate');
    expect(kinds).toContain('no-spend-days');
    const up = buildInsights(input(txs, '2026-09-10', { period: MONTH })).find((x) => x.kind === 'category-up');
    expect(up).toMatchObject({ categoryId: 'cat_food', change: 2 });
  });

  it('stays quiet about tiny changes', () => {
    const txs = [tx('expense', 100, '2026-08-03'), tx('expense', 104, '2026-09-03')];
    const kinds = buildInsights(input(txs, '2026-09-10', { period: MONTH })).map((x) => x.kind);
    expect(kinds).not.toContain('pace');
    expect(kinds).not.toContain('category-up');
  });
});

describe('app lock', () => {
  it('accepts 4–8 digit PINs only', () => {
    expect(isValidPin('1234')).toBe(true);
    expect(isValidPin('12345678')).toBe(true);
    expect(isValidPin('123')).toBe(false);
    expect(isValidPin('123456789')).toBe(false);
    expect(isValidPin('12a4')).toBe(false);
  });

  it('hashes with a random salt and verifies', async () => {
    const a = await createLockConfig('2468', undefined, 1000);
    const b = await createLockConfig('2468', undefined, 1000);
    expect(a.hash).not.toBe(b.hash);
    expect(a.pinLength).toBe(4);
    expect(a).not.toHaveProperty('pin');
    expect(await verifyPin(a, '2468')).toBe(true);
    expect(await verifyPin(a, '2469')).toBe(false);
    expect(await verifyPin(a, '')).toBe(false);
  });

  it('keeps biometric and auto-lock settings when the PIN changes', async () => {
    const a = { ...(await createLockConfig('1111', undefined, 1000)), credentialId: 'abc', autoLockSeconds: 300 };
    const b = await createLockConfig('2222', a, 1000);
    expect(b).toMatchObject({ credentialId: 'abc', autoLockSeconds: 300 });
  });

  it('throttles after 5 failures with doubling waits, capped at 15 minutes', () => {
    let a = registerFailure(undefined, 0);
    for (let i = 0; i < 4; i++) a = registerFailure(a, 0);
    expect(a.failures).toBe(5);
    expect(remainingBlockMs(a, 0)).toBe(0);
    a = registerFailure(a, 0);
    expect(remainingBlockMs(a, 0)).toBe(30_000);
    a = registerFailure(a, 0);
    expect(remainingBlockMs(a, 0)).toBe(60_000);
    for (let i = 0; i < 10; i++) a = registerFailure(a, 0);
    expect(remainingBlockMs(a, 0)).toBe(15 * 60_000);
  });

  it('base64url round-trips', () => {
    const bytes = new Uint8Array([0, 251, 255, 62, 63, 1]);
    expect([...fromB64(toB64(bytes))]).toEqual([...bytes]);
    expect(toB64(bytes)).not.toMatch(/[+/=]/);
  });
});
