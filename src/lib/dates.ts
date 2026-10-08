import type { DateKey, PeriodConfig } from './types';

// All date math is done on calendar keys (YYYY-MM-DD) interpreted as UTC midnight,
// so DST shifts and the device's timezone offset can never move a day boundary.

const DAY_MS = 86_400_000;
const KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDateKey(s: unknown): s is DateKey {
  if (typeof s !== 'string') return false;
  const m = KEY_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

function toUtc(key: DateKey): number {
  const m = KEY_RE.exec(key);
  if (!m) throw new Error(`Invalid date key: ${key}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function fromUtc(ms: number): DateKey {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function makeKey(year: number, month: number, day: number): DateKey {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Today's key in the device's local calendar (the user's own "today"). */
export function localTodayKey(now: Date = new Date()): DateKey {
  return makeKey(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

export function parts(key: DateKey): { y: number; m: number; d: number } {
  const [y, m, d] = key.split('-').map(Number);
  return { y, m, d };
}

export function addDays(key: DateKey, n: number): DateKey {
  return fromUtc(toUtc(key) + n * DAY_MS);
}

/** Add months, clamping the day to the target month's length (Jan 31 + 1 → Feb 28/29). */
export function addMonths(key: DateKey, n: number, preferredDay?: number): DateKey {
  const { y, m, d } = parts(key);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return makeKey(ny, nm, Math.min(preferredDay ?? d, daysInMonth(ny, nm)));
}

/** Whole days from a to b (b - a). */
export function diffDays(a: DateKey, b: DateKey): number {
  return Math.round((toUtc(b) - toUtc(a)) / DAY_MS);
}

/** Inclusive day count of a range. */
export function rangeLength(start: DateKey, end: DateKey): number {
  return Math.max(0, diffDays(start, end) + 1);
}

export function compareKeys(a: DateKey, b: DateKey): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function inRange(key: DateKey, start: DateKey, end: DateKey): boolean {
  return key >= start && key <= end;
}

export function minKey(a: DateKey, b: DateKey): DateKey {
  return a < b ? a : b;
}

export function maxKey(a: DateKey, b: DateKey): DateKey {
  return a > b ? a : b;
}

export interface Range {
  start: DateKey;
  end: DateKey;
}

/** Resolve the budget period that contains `today`. */
export function resolvePeriod(cfg: PeriodConfig, today: DateKey): Range {
  switch (cfg.kind) {
    case 'month': {
      const startDay = Math.min(Math.max(1, Math.trunc(cfg.startDay) || 1), 31);
      const { y, m, d } = parts(today);
      const thisStart = makeKey(y, m, Math.min(startDay, daysInMonth(y, m)));
      const start = d >= parts(thisStart).d ? thisStart : addMonths(makeKey(y, m, 1), -1, startDay);
      const next = addMonths(makeKey(parts(start).y, parts(start).m, 1), 1, startDay);
      return { start, end: addDays(next, -1) };
    }
    case 'custom':
      return cfg.start <= cfg.end ? { start: cfg.start, end: cfg.end } : { start: cfg.end, end: cfg.start };
    case 'rolling': {
      const len = Math.max(1, Math.trunc(cfg.length) || 1);
      const offset = diffDays(cfg.start, today);
      const idx = Math.floor(offset / len);
      const start = addDays(cfg.start, idx * len);
      return { start, end: addDays(start, len - 1) };
    }
  }
}

/** Week range (Monday–Sunday) containing `today`. */
export function weekRange(today: DateKey): Range {
  const dow = new Date(toUtc(today)).getUTCDay(); // 0 = Sun
  const start = addDays(today, -((dow + 6) % 7));
  return { start, end: addDays(start, 6) };
}

export function monthRange(today: DateKey): Range {
  const { y, m } = parts(today);
  return { start: makeKey(y, m, 1), end: makeKey(y, m, daysInMonth(y, m)) };
}

export function eachDay(start: DateKey, end: DateKey): DateKey[] {
  const out: DateKey[] = [];
  for (let k = start; k <= end; k = addDays(k, 1)) out.push(k);
  return out;
}
