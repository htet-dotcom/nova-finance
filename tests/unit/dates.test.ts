import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  daysInMonth,
  diffDays,
  isDateKey,
  isLeapYear,
  localTodayKey,
  monthRange,
  rangeLength,
  resolvePeriod,
  weekRange,
} from '../../src/lib/dates';

describe('date keys', () => {
  it('validates real calendar dates', () => {
    expect(isDateKey('2026-10-09')).toBe(true);
    expect(isDateKey('2026-02-29')).toBe(false);
    expect(isDateKey('2028-02-29')).toBe(true);
    expect(isDateKey('2026-13-01')).toBe(false);
    expect(isDateKey('2026-1-1')).toBe(false);
    expect(isDateKey(20261009)).toBe(false);
  });

  it('leap years', () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2100)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
  });

  it('day arithmetic across month/year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(diffDays('2026-01-01', '2027-01-01')).toBe(365);
    expect(rangeLength('2026-09-01', '2026-09-30')).toBe(30);
  });

  it('is immune to DST transitions (date-only math)', () => {
    // Europe/US DST changes happen in March/October/November
    expect(diffDays('2026-03-01', '2026-04-01')).toBe(31);
    expect(diffDays('2026-10-25', '2026-10-26')).toBe(1);
  });

  it('month arithmetic clamps to month length', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
  });

  it('local today uses the device calendar, not UTC', () => {
    // 23:30 local time on Oct 9 must still be Oct 9.
    expect(localTodayKey(new Date(2026, 9, 9, 23, 30))).toBe('2026-10-09');
    expect(localTodayKey(new Date(2026, 9, 10, 0, 5))).toBe('2026-10-10');
  });
});

describe('budget periods', () => {
  it('calendar month', () => {
    expect(resolvePeriod({ kind: 'month', startDay: 1 }, '2026-10-09')).toEqual({ start: '2026-10-01', end: '2026-10-31' });
    expect(resolvePeriod({ kind: 'month', startDay: 1 }, '2028-02-10')).toEqual({ start: '2028-02-01', end: '2028-02-29' });
  });

  it('pay-day month (starts on the 25th)', () => {
    expect(resolvePeriod({ kind: 'month', startDay: 25 }, '2026-10-09')).toEqual({ start: '2026-09-25', end: '2026-10-24' });
    expect(resolvePeriod({ kind: 'month', startDay: 25 }, '2026-10-25')).toEqual({ start: '2026-10-25', end: '2026-11-24' });
    expect(resolvePeriod({ kind: 'month', startDay: 25 }, '2026-12-31')).toEqual({ start: '2026-12-25', end: '2027-01-24' });
  });

  it('start day 31 clamps in short months', () => {
    expect(resolvePeriod({ kind: 'month', startDay: 31 }, '2026-02-28')).toEqual({ start: '2026-02-28', end: '2026-03-30' });
    expect(resolvePeriod({ kind: 'month', startDay: 31 }, '2026-02-15')).toEqual({ start: '2026-01-31', end: '2026-02-27' });
  });

  it('custom range (normalises reversed input)', () => {
    expect(resolvePeriod({ kind: 'custom', start: '2026-10-20', end: '2026-10-01' }, '2026-10-09')).toEqual({ start: '2026-10-01', end: '2026-10-20' });
  });

  it('rolling N-day periods', () => {
    const cfg = { kind: 'rolling', start: '2026-09-01', length: 30 } as const;
    expect(resolvePeriod(cfg, '2026-09-30')).toEqual({ start: '2026-09-01', end: '2026-09-30' });
    expect(resolvePeriod(cfg, '2026-10-01')).toEqual({ start: '2026-10-01', end: '2026-10-30' });
    expect(resolvePeriod(cfg, '2026-08-31')).toEqual({ start: '2026-08-02', end: '2026-08-31' });
  });

  it('week (Mon–Sun) and month ranges', () => {
    expect(weekRange('2026-10-09')).toEqual({ start: '2026-10-05', end: '2026-10-11' }); // Friday
    expect(weekRange('2026-10-11')).toEqual({ start: '2026-10-05', end: '2026-10-11' }); // Sunday
    expect(monthRange('2026-10-09')).toEqual({ start: '2026-10-01', end: '2026-10-31' });
  });
});
