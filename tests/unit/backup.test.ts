import { describe, expect, it } from 'vitest';
import {
  BACKUP_FORMAT,
  buildBackup,
  buildCsv,
  csvCell,
  parseBackup,
  planImport,
  SCHEMA_VERSION,
} from '../../src/lib/backup';
import { defaultCategories, defaultSettings } from '../../src/lib/defaults';
import { makeManualRate } from '../../src/lib/fx';
import type { AppData } from '../../src/lib/types';
import { tx } from './helpers';

function sample(): AppData {
  const categories = defaultCategories('2026-01-01T00:00:00.000Z').map((c) => (c.id === 'cat_food' ? { ...c, budget: 5000 } : c));
  return {
    transactions: [
      tx('income', 3000, '2026-09-01', { id: 'inc1' }),
      tx('expense', 120.5, '2026-09-02', { id: 'exp1', note: 'Lunch, "special"', currency: 'MMK' }),
    ],
    categories,
    rates: [makeManualRate('THB', 'MMK', 120, '2026-09-01T00:00:00.000Z')],
    settings: { ...defaultSettings(), savingsTarget: 500 },
  };
}

const roundTrip = (data: AppData) => parseBackup(JSON.stringify(buildBackup(data, '1.0.0')));

describe('JSON backup', () => {
  it('round-trips all data: income, expenses, categories, budgets, settings, rates', () => {
    const data = sample();
    const r = roundTrip(data);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.backup.data.transactions).toHaveLength(2);
    expect(r.backup.data.categories.find((c) => c.id === 'cat_food')?.budget).toBe(5000);
    expect(r.backup.data.settings.savingsTarget).toBe(500);
    expect(r.backup.data.rates[0]).toMatchObject({ base: 'THB', quote: 'MMK', rate: 120, source: 'manual' });
    expect(r.backup.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('includes format metadata', () => {
    const b = buildBackup(sample(), '1.2.3');
    expect(b.format).toBe(BACKUP_FORMAT);
    expect(b.appVersion).toBe('1.2.3');
  });

  it('rejects non-JSON', () => {
    const r = parseBackup('not json');
    expect(r.ok).toBe(false);
  });

  it('rejects JSON that is not a Nova Finance backup', () => {
    const r = parseBackup(JSON.stringify({ hello: 'world' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].message).toMatch(/not a Nova Finance backup/);
  });

  it('rejects backups from a newer schema', () => {
    const b = { ...buildBackup(sample(), '9'), schemaVersion: SCHEMA_VERSION + 1 };
    const r = parseBackup(JSON.stringify(b));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].message).toMatch(/newer app version/);
  });

  it('detects invalid records instead of silently importing them', () => {
    const b = buildBackup(sample(), '1');
    const bad = JSON.parse(JSON.stringify(b));
    bad.data.transactions[0].amount = -5;
    bad.data.transactions[1].date = '2026-02-30';
    bad.data.transactions.push({ id: 'x' });
    const r = parseBackup(JSON.stringify(bad));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const paths = r.errors.map((e) => e.path).join(' ');
      expect(paths).toContain('transactions[0].amount');
      expect(paths).toContain('transactions[1].date');
      expect(paths).toContain('transactions[2]');
    }
  });

  it('detects unknown categories, wrong category type and duplicate ids', () => {
    const bad = JSON.parse(JSON.stringify(buildBackup(sample(), '1')));
    bad.data.transactions[0].categoryId = 'cat_missing';
    bad.data.transactions[1].categoryId = 'cat_salary'; // expense pointing to income category
    bad.data.categories.push({ ...bad.data.categories[0] });
    const r = parseBackup(JSON.stringify(bad));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const msgs = r.errors.map((e) => e.message).join(' | ');
      expect(msgs).toMatch(/Unknown category/);
      expect(msgs).toMatch(/is for income, not expense/);
      expect(msgs).toMatch(/Duplicate id/);
    }
  });

  it('sanitises text fields on import', () => {
    const b = JSON.parse(JSON.stringify(buildBackup(sample(), '1')));
    b.data.transactions[0].note = 'hi\u0000\u0007 there';
    const r = parseBackup(JSON.stringify(b));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.backup.data.transactions.find((t) => t.id === 'inc1')?.note).toBe('hi there');
  });

  it('fills settings added in newer versions with defaults', () => {
    const b = JSON.parse(JSON.stringify(buildBackup(sample(), '1')));
    delete b.data.settings.manualFirstCurrencies;
    delete b.data.settings.nearLimitRatio;
    const r = parseBackup(JSON.stringify(b));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.backup.data.settings.manualFirstCurrencies).toEqual(['MMK']);
      expect(r.backup.data.settings.nearLimitRatio).toBe(0.8);
    }
  });

  it('accepts a UTF-8 BOM', () => {
    expect(parseBackup('﻿' + JSON.stringify(buildBackup(sample(), '1'))).ok).toBe(true);
  });
});

describe('import planning', () => {
  it('replace mode swaps the dataset and reports removed records', () => {
    const current = sample();
    const incoming = { ...sample(), transactions: [tx('expense', 1, '2026-09-03', { id: 'new1' })] };
    const plan = planImport(current, incoming, 'replace');
    expect(plan.result.transactions.map((t) => t.id)).toEqual(['new1']);
    expect(plan.stats.transactions).toMatchObject({ added: 1, removed: 2 });
  });

  it('merge mode keeps existing records and lets the newer version win', () => {
    const current = sample();
    const newer = { ...current.transactions[1], amount: 999, updatedAt: '2027-01-01T00:00:00.000Z' };
    const older = { ...current.transactions[0], amount: 1, updatedAt: '2020-01-01T00:00:00.000Z' };
    const incoming = { ...sample(), transactions: [older, newer, tx('expense', 5, '2026-09-05', { id: 'n2' })] };
    const plan = planImport(current, incoming, 'merge');
    const byId = Object.fromEntries(plan.result.transactions.map((t) => [t.id, t]));
    expect(byId.inc1.amount).toBe(3000);
    expect(byId.exp1.amount).toBe(999);
    expect(byId.n2).toBeDefined();
    expect(plan.stats.transactions).toEqual({ added: 1, updated: 1, unchanged: 1, removed: 0 });
    expect(plan.result.settings).toBe(current.settings);
  });

  it('replace keeps the device’s own last-backup timestamp', () => {
    const current = { ...sample(), settings: { ...defaultSettings(), lastBackupAt: '2026-09-09T00:00:00.000Z' } };
    const plan = planImport(current, sample(), 'replace');
    expect(plan.result.settings.lastBackupAt).toBe('2026-09-09T00:00:00.000Z');
  });
});

describe('CSV export', () => {
  it('contains every section', () => {
    const csv = buildCsv(sample());
    expect(csv).toContain('# Transactions');
    expect(csv).toContain('# Categories and budgets');
    expect(csv).toContain('# Exchange rates');
    expect(csv).toContain('# Settings');
    expect(csv).toContain('"Lunch, ""special"""');
    expect(csv).toContain('Food,expense,🍜,5000,THB');
    expect(csv).toContain('THB,MMK,120,manual,Manual / User-entered rate');
  });

  it('neutralises formula injection but keeps negative numbers', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('-12.5')).toBe('-12.5');
    expect(csvCell(null)).toBe('');
  });
});
