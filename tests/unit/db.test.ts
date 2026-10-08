import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  closeFinanceDb,
  deleteCategory,
  deleteTransaction,
  loadAll,
  loadSnapshot,
  openFinanceDb,
  putTransaction,
  replaceAll,
  saveSettings,
  saveSnapshot,
} from '../../src/lib/db';
import { tx } from './helpers';

beforeEach(async () => {
  await closeFinanceDb();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('nova-finance');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
});

describe('IndexedDB storage', () => {
  it('seeds default categories and settings on first run', async () => {
    const data = await loadAll();
    expect(data.categories.length).toBe(16);
    expect(data.settings.primaryCurrency).toBe('THB');
    expect(data.transactions).toEqual([]);
  });

  it('persists transactions and settings across reopen', async () => {
    const first = await loadAll();
    await putTransaction(tx('income', 3000, '2026-09-01', { id: 'a' }));
    await saveSettings({ ...first.settings, savingsTarget: 500 });
    await closeFinanceDb();
    const again = await loadAll();
    expect(again.transactions.map((t) => t.id)).toEqual(['a']);
    expect(again.settings.savingsTarget).toBe(500);
    expect(again.categories.length).toBe(16); // not re-seeded
  });

  it('does not re-seed categories the user deleted', async () => {
    await loadAll();
    await deleteCategory('cat_family', 'cat_food', []);
    await closeFinanceDb();
    const again = await loadAll();
    expect(again.categories.some((c) => c.id === 'cat_family')).toBe(false);
  });

  it('deletes a category and moves its transactions atomically', async () => {
    await loadAll();
    const t = tx('expense', 10, '2026-09-01', { id: 'x', categoryId: 'cat_family' });
    await putTransaction(t);
    await deleteCategory('cat_family', 'cat_food', [t]);
    const data = await loadAll();
    expect(data.transactions[0].categoryId).toBe('cat_food');
  });

  it('edits and deletes transactions', async () => {
    await loadAll();
    const t = tx('expense', 10, '2026-09-01', { id: 'e1' });
    await putTransaction(t);
    await putTransaction({ ...t, amount: 25 });
    expect((await loadAll()).transactions[0].amount).toBe(25);
    await deleteTransaction('e1');
    expect((await loadAll()).transactions).toEqual([]);
  });

  it('replaceAll swaps all data and snapshot allows undo', async () => {
    const before = await loadAll();
    await putTransaction(tx('expense', 10, '2026-09-01', { id: 'keep' }));
    const current = await loadAll();
    await saveSnapshot(current);
    await replaceAll({ ...before, transactions: [tx('income', 1, '2026-09-01', { id: 'imported' })] });
    expect((await loadAll()).transactions.map((t) => t.id)).toEqual(['imported']);
    const snap = await loadSnapshot();
    await replaceAll(snap!.data);
    expect((await loadAll()).transactions.map((t) => t.id)).toEqual(['keep']);
  });

  it('repairs settings saved by an older version (missing fields get defaults)', async () => {
    await loadAll();
    const db = await openFinanceDb();
    await db.put('kv', { primaryCurrency: 'MMK', savingsTarget: 100 }, 'settings');
    const data = await loadAll();
    expect(data.settings.primaryCurrency).toBe('MMK');
    expect(data.settings.savingsTarget).toBe(100);
    expect(data.settings.allowanceMode).toBe('dynamic');
  });
});
