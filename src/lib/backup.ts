// Backup format, schema validation, migrations, merge planning and CSV export.

import { z } from 'zod';
import { CURRENCY_CODE_RE } from './currency';
import { isDateKey } from './dates';
import { cleanText, defaultSettings } from './defaults';
import type { AppData, Category, ExchangeRate, Settings, Transaction } from './types';

export const BACKUP_FORMAT = 'nova-finance-backup';
/** Bump when the persisted shape changes, and add a migration below. */
export const SCHEMA_VERSION = 1;
export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;
const MAX_AMOUNT = 1e13;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const id = z.string().min(1).max(128).regex(/^[\w@.:-]+$/, 'invalid id characters');
const iso = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'invalid timestamp');
const dateKey = z.string().refine(isDateKey, 'invalid date (expected YYYY-MM-DD)');
const code = z.string().regex(CURRENCY_CODE_RE, 'invalid currency code');
const text = (max: number) => z.string().max(max * 4).transform((s) => cleanText(s, max));
const money = z.number().finite().min(0).max(MAX_AMOUNT);

export const transactionSchema = z.object({
  id,
  type: z.enum(['income', 'expense']),
  amount: z.number().finite().positive('amount must be greater than 0').max(MAX_AMOUNT),
  currency: code,
  categoryId: id,
  date: dateKey,
  note: text(500).default(''),
  recurring: z
    .object({ freq: z.enum(['weekly', 'monthly']), until: dateKey.nullable().default(null) })
    .nullable()
    .default(null),
  createdAt: iso,
  updatedAt: iso,
});

export const categorySchema = z.object({
  id,
  name: text(60).refine((s) => s.length > 0, 'name is required'),
  type: z.enum(['income', 'expense']),
  icon: z.string().min(1).max(16),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'invalid color'),
  order: z.number().int().min(0).max(100_000),
  budget: money.nullable().default(null),
  fixed: z.boolean().default(false),
  createdAt: iso,
  updatedAt: iso,
});

export const rateSchema = z
  .object({
    id: z.string().max(64),
    base: code,
    quote: code,
    rate: z.number().finite().positive('rate must be greater than 0').max(1e12),
    source: z.enum(['provider', 'manual']),
    sourceLabel: text(120),
    updatedAt: iso,
    fetchedAt: iso.nullable().default(null),
  })
  .refine((r) => r.base !== r.quote, 'base and quote must differ')
  .transform((r) => ({ ...r, id: `${r.base}_${r.quote}_${r.source}` }));

const periodSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('month'), startDay: z.number().int().min(1).max(31) }),
  z.object({ kind: z.literal('custom'), start: dateKey, end: dateKey }),
  z.object({ kind: z.literal('rolling'), start: dateKey, length: z.number().int().min(1).max(366) }),
]);

const d = defaultSettings();
export const settingsSchema = z.object({
  primaryCurrency: code.default(d.primaryCurrency),
  language: z.enum(['en', 'my']).default(d.language),
  theme: z.enum(['system', 'light', 'dark']).default(d.theme),
  period: periodSchema.default(d.period),
  incomeBasis: z.enum(['recorded', 'planned']).default(d.incomeBasis),
  plannedIncome: money.default(0),
  includeUpcomingIncome: z.boolean().default(false),
  savingsTarget: money.default(0),
  emergencyReserve: money.default(0),
  fixedExpenses: money.default(0),
  protectedAmount: money.default(0),
  allowanceMode: z.enum(['dynamic', 'even']).default('dynamic'),
  nearLimitRatio: z.number().min(0.5).max(1).default(0.8),
  enabledCurrencies: z.array(code).max(200).default(d.enabledCurrencies),
  customCurrencies: z
    .array(
      z.object({
        code,
        name: text(60),
        symbol: z.string().min(1).max(8),
        decimals: z.number().int().min(0).max(4),
      }),
    )
    .max(100)
    .default([]),
  rateProviderEnabled: z.boolean().default(true),
  manualFirstCurrencies: z.array(code).max(200).default(d.manualFirstCurrencies),
  lastBackupAt: iso.nullable().default(null),
});

const envelopeSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  schemaVersion: z.number().int().min(1),
  exportedAt: iso,
  appVersion: z.string().max(40).optional(),
  data: z.object({
    transactions: z.array(z.unknown()).max(500_000),
    categories: z.array(z.unknown()).max(10_000),
    rates: z.array(z.unknown()).max(10_000).default([]),
    settings: z.unknown(),
  }),
});

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  exportedAt: string;
  appVersion: string;
  data: AppData;
}

// ---------------------------------------------------------------------------
// Migrations: each entry upgrades the raw `data` object from version N to N+1.
// ---------------------------------------------------------------------------

type RawData = Record<string, unknown>;
export const MIGRATIONS: Record<number, (data: RawData) => RawData> = {
  // 1: (data) => ({ ...data, newField: ... })  ← add v1→v2 here when the schema changes
};

export function migrateData(data: RawData, fromVersion: number): RawData {
  let out = data;
  for (let v = fromVersion; v < SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) throw new Error(`No migration from schema v${v}`);
    out = step(out);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export function buildBackup(data: AppData, appVersion: string, now = new Date()): BackupFile {
  return {
    format: BACKUP_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    appVersion,
    data: {
      transactions: [...data.transactions].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
      categories: [...data.categories],
      rates: [...data.rates],
      settings: { ...data.settings },
    },
  };
}

export function backupFileName(kind: 'json' | 'csv', now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}`;
  return `nova-finance-${kind === 'json' ? 'backup' : 'export'}_${stamp}.${kind}`;
}

/** Neutralise spreadsheet formula injection and quote per RFC 4180. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const row = (cells: unknown[]) => cells.map(csvCell).join(',');

/**
 * Human-friendly CSV export with one section per record type
 * (transactions, categories & budgets, exchange rates, settings).
 */
export function buildCsv(data: AppData): string {
  const cats = new Map(data.categories.map((c) => [c.id, c]));
  const lines: string[] = [];
  lines.push('# Transactions');
  lines.push(row(['date', 'type', 'category', 'amount', 'currency', 'note', 'recurring', 'recurring_until', 'id']));
  for (const t of [...data.transactions].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    lines.push(
      row([t.date, t.type, cats.get(t.categoryId)?.name ?? t.categoryId, t.amount, t.currency, t.note, t.recurring?.freq ?? '', t.recurring?.until ?? '', t.id]),
    );
  }
  lines.push('');
  lines.push('# Categories and budgets');
  lines.push(row(['name', 'type', 'icon', 'budget', 'budget_currency', 'fixed_cost', 'order', 'id']));
  for (const c of [...data.categories].sort((a, b) => (a.type === b.type ? a.order - b.order : a.type < b.type ? -1 : 1))) {
    lines.push(row([c.name, c.type, c.icon, c.budget ?? '', c.budget !== null ? data.settings.primaryCurrency : '', c.fixed ? 'yes' : 'no', c.order, c.id]));
  }
  lines.push('');
  lines.push('# Exchange rates');
  lines.push(row(['base', 'quote', 'rate', 'source', 'source_label', 'updated_at', 'fetched_at']));
  for (const r of data.rates) lines.push(row([r.base, r.quote, r.rate, r.source, r.sourceLabel, r.updatedAt, r.fetchedAt ?? '']));
  lines.push('');
  lines.push('# Settings');
  lines.push(row(['key', 'value']));
  for (const [k, v] of Object.entries(data.settings)) lines.push(row([k, typeof v === 'object' ? JSON.stringify(v) : v]));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// Import / validation
// ---------------------------------------------------------------------------

export interface ImportIssue {
  path: string;
  message: string;
}

export type ParseResult =
  | { ok: true; backup: BackupFile; warnings: string[] }
  | { ok: false; errors: ImportIssue[] };

const MAX_REPORTED = 25;

function issuesOf(prefix: string, err: z.ZodError): ImportIssue[] {
  return err.issues.map((i) => ({ path: [prefix, ...i.path].join('.'), message: i.message }));
}

/** Parse and fully validate a backup file. Never throws. */
export function parseBackup(textContent: string): ParseResult {
  if (textContent.length > MAX_IMPORT_BYTES) {
    return { ok: false, errors: [{ path: 'file', message: 'File is too large to be a Nova Finance backup' }] };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(textContent.replace(/^﻿/, ''));
  } catch {
    return { ok: false, errors: [{ path: 'file', message: 'File is not valid JSON' }] };
  }
  const env = envelopeSchema.safeParse(raw);
  if (!env.success) {
    const isOther = !(raw && typeof raw === 'object' && (raw as { format?: unknown }).format === BACKUP_FORMAT);
    return {
      ok: false,
      errors: isOther
        ? [{ path: 'format', message: 'This file is not a Nova Finance backup' }]
        : issuesOf('backup', env.error).slice(0, MAX_REPORTED),
    };
  }
  const { schemaVersion } = env.data;
  if (schemaVersion > SCHEMA_VERSION) {
    return {
      ok: false,
      errors: [{ path: 'schemaVersion', message: `Backup was made by a newer app version (schema v${schemaVersion}). Please update the app first.` }],
    };
  }
  let data: RawData;
  try {
    data = migrateData(env.data.data as RawData, schemaVersion);
  } catch (e) {
    return { ok: false, errors: [{ path: 'schemaVersion', message: (e as Error).message }] };
  }

  const errors: ImportIssue[] = [];
  const warnings: string[] = [];
  const collect = <T>(list: unknown[], schema: z.ZodType<T>, name: string): T[] => {
    const out: T[] = [];
    list.forEach((item, i) => {
      const r = schema.safeParse(item);
      if (r.success) out.push(r.data);
      else if (errors.length < MAX_REPORTED) errors.push(...issuesOf(`${name}[${i}]`, r.error).slice(0, 3));
    });
    return out;
  };

  const transactions = collect(data.transactions as unknown[], transactionSchema, 'transactions') as Transaction[];
  const categories = collect(data.categories as unknown[], categorySchema, 'categories') as Category[];
  const rates = collect((data.rates as unknown[]) ?? [], rateSchema, 'rates') as ExchangeRate[];
  const settingsParsed = settingsSchema.safeParse(data.settings ?? {});
  if (!settingsParsed.success) errors.push(...issuesOf('settings', settingsParsed.error).slice(0, 5));

  // Referential integrity and duplicates.
  const dupes = (xs: { id: string }[], name: string) => {
    const seen = new Set<string>();
    for (const x of xs) {
      if (seen.has(x.id)) errors.push({ path: name, message: `Duplicate id "${x.id}"` });
      seen.add(x.id);
    }
  };
  dupes(transactions, 'transactions');
  dupes(categories, 'categories');
  const catById = new Map(categories.map((c) => [c.id, c]));
  for (const t of transactions) {
    const c = catById.get(t.categoryId);
    if (!c) errors.push({ path: `transactions.${t.id}`, message: `Unknown category "${t.categoryId}"` });
    else if (c.type !== t.type) errors.push({ path: `transactions.${t.id}`, message: `Category "${c.name}" is for ${c.type}, not ${t.type}` });
    if (errors.length >= MAX_REPORTED) break;
  }
  for (const type of ['income', 'expense'] as const) {
    if (!categories.some((c) => c.type === type)) errors.push({ path: 'categories', message: `Backup has no ${type} categories` });
  }

  if (errors.length) return { ok: false, errors: errors.slice(0, MAX_REPORTED) };
  if (schemaVersion < SCHEMA_VERSION) warnings.push(`Upgraded from schema v${schemaVersion} to v${SCHEMA_VERSION}`);

  return {
    ok: true,
    warnings,
    backup: {
      format: BACKUP_FORMAT,
      schemaVersion: SCHEMA_VERSION,
      exportedAt: env.data.exportedAt,
      appVersion: env.data.appVersion ?? 'unknown',
      data: { transactions, categories, rates, settings: settingsParsed.data as Settings },
    },
  };
}

export interface ImportPlan {
  mode: 'replace' | 'merge';
  result: AppData;
  stats: {
    transactions: { added: number; updated: number; unchanged: number; removed: number };
    categories: { added: number; updated: number; unchanged: number; removed: number };
    rates: { added: number; updated: number; unchanged: number; removed: number };
  };
}

function mergeById<T extends { id: string; updatedAt: string }>(current: T[], incoming: T[]) {
  const map = new Map(current.map((x) => [x.id, x]));
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  for (const x of incoming) {
    const existing = map.get(x.id);
    if (!existing) {
      map.set(x.id, x);
      added++;
    } else if (Date.parse(x.updatedAt) > Date.parse(existing.updatedAt)) {
      map.set(x.id, x);
      updated++;
    } else unchanged++;
  }
  return { list: [...map.values()], stats: { added, updated, unchanged, removed: 0 } };
}

/**
 * Compute the data that will exist after import, without touching storage.
 *  - replace: incoming data becomes the full dataset (settings included).
 *  - merge:   records are matched by id; the newer `updatedAt` wins; current settings are kept.
 */
export function planImport(current: AppData, incoming: AppData, mode: 'replace' | 'merge'): ImportPlan {
  if (mode === 'replace') {
    const replaceStats = (cur: { id: string }[], inc: { id: string }[]) => {
      const curIds = new Set(cur.map((x) => x.id));
      const incIds = new Set(inc.map((x) => x.id));
      return {
        added: inc.filter((x) => !curIds.has(x.id)).length,
        updated: inc.filter((x) => curIds.has(x.id)).length,
        unchanged: 0,
        removed: cur.filter((x) => !incIds.has(x.id)).length,
      };
    };
    return {
      mode,
      result: { ...incoming, settings: { ...incoming.settings, lastBackupAt: current.settings.lastBackupAt } },
      stats: {
        transactions: replaceStats(current.transactions, incoming.transactions),
        categories: replaceStats(current.categories, incoming.categories),
        rates: replaceStats(current.rates, incoming.rates),
      },
    };
  }
  const tx = mergeById(current.transactions, incoming.transactions);
  const cats = mergeById(current.categories, incoming.categories);
  const rates = mergeById(current.rates, incoming.rates);

  // Re-point transactions whose category no longer matches (defensive; should not happen after validation).
  const catById = new Map(cats.list.map((c) => [c.id, c]));
  const fallback = (type: 'income' | 'expense') => cats.list.filter((c) => c.type === type).sort((a, b) => a.order - b.order)[0];
  const transactions = tx.list.map((t) => {
    const c = catById.get(t.categoryId);
    return c && c.type === t.type ? t : { ...t, categoryId: fallback(t.type).id };
  });

  return {
    mode,
    result: { transactions, categories: cats.list, rates: rates.list, settings: current.settings },
    stats: { transactions: tx.stats, categories: cats.stats, rates: rates.stats },
  };
}
