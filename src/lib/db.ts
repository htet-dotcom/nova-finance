// IndexedDB persistence. All data stays on this device.
//
// Versioning:
//  - DB_VERSION   – IndexedDB structure (object stores / indexes). Upgrades run in `upgrade()`
//                   and are additive, so existing records are never dropped.
//  - SCHEMA_VERSION (backup.ts) – record shape. Stored in `meta.schemaVersion`; on open,
//                   `migrateStoredData` upgrades records in place before the app reads them.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { migrateData, SCHEMA_VERSION, settingsSchema } from './backup';
import { defaultCategories, defaultSettings } from './defaults';
import type { AppData, Category, ExchangeRate, Settings, Transaction } from './types';

export const DB_NAME = 'nova-finance';
export const DB_VERSION = 1;

interface FinanceDB extends DBSchema {
  transactions: { key: string; value: Transaction; indexes: { byDate: string } };
  categories: { key: string; value: Category };
  rates: { key: string; value: ExchangeRate };
  kv: { key: string; value: unknown };
}

type DB = IDBPDatabase<FinanceDB>;

let dbPromise: Promise<DB> | null = null;

export function openFinanceDb(name = DB_NAME): Promise<DB> {
  if (!dbPromise) {
    dbPromise = openDB<FinanceDB>(name, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const tx = db.createObjectStore('transactions', { keyPath: 'id' });
          tx.createIndex('byDate', 'date');
          db.createObjectStore('categories', { keyPath: 'id' });
          db.createObjectStore('rates', { keyPath: 'id' });
          db.createObjectStore('kv');
        }
        // Future structural upgrades go here as `if (oldVersion < 2) { ... }`.
      },
      blocked() {
        console.warn('Database upgrade blocked by another open tab');
      },
      terminated() {
        dbPromise = null;
      },
    });
  }
  return dbPromise;
}

/** Test helper: forget the cached connection. */
export async function closeFinanceDb(): Promise<void> {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
}

const SETTINGS_KEY = 'settings';
const SCHEMA_KEY = 'schemaVersion';
const SNAPSHOT_KEY = 'preImportSnapshot';

async function migrateStoredData(db: DB): Promise<void> {
  const stored = (await db.get('kv', SCHEMA_KEY)) as number | undefined;
  if (stored === undefined || stored >= SCHEMA_VERSION) return;
  const raw = {
    transactions: await db.getAll('transactions'),
    categories: await db.getAll('categories'),
    rates: await db.getAll('rates'),
    settings: await db.get('kv', SETTINGS_KEY),
  };
  const migrated = migrateData(raw, stored) as unknown as AppData;
  await replaceAll(migrated, db);
}

/** Load everything; seeds defaults on first run. */
export async function loadAll(): Promise<AppData> {
  const db = await openFinanceDb();
  await migrateStoredData(db);
  let categories = await db.getAll('categories');
  const rawSettings = await db.get('kv', SETTINGS_KEY);
  const firstRun = rawSettings === undefined && categories.length === 0;
  if (firstRun) {
    categories = defaultCategories();
    const t = db.transaction(['categories', 'kv'], 'readwrite');
    for (const c of categories) await t.objectStore('categories').put(c);
    await t.objectStore('kv').put(defaultSettings(), SETTINGS_KEY);
    await t.objectStore('kv').put(SCHEMA_VERSION, SCHEMA_KEY);
    await t.done;
  }
  // Fill in any settings added in newer app versions without losing user values.
  const parsed = settingsSchema.safeParse(rawSettings ?? {});
  const settings: Settings = parsed.success ? (parsed.data as Settings) : defaultSettings();
  if ((await db.get('kv', SCHEMA_KEY)) === undefined) await db.put('kv', SCHEMA_VERSION, SCHEMA_KEY);
  return {
    transactions: await db.getAll('transactions'),
    categories,
    rates: await db.getAll('rates'),
    settings,
  };
}

export async function putTransaction(t: Transaction) {
  await (await openFinanceDb()).put('transactions', t);
}
export async function deleteTransaction(id: string) {
  await (await openFinanceDb()).delete('transactions', id);
}
export async function putCategories(list: Category[]) {
  const db = await openFinanceDb();
  const t = db.transaction('categories', 'readwrite');
  await Promise.all([...list.map((c) => t.store.put(c)), t.done]);
}
/** Delete a category and move its transactions to another category in one atomic step. */
export async function deleteCategory(id: string, reassignTo: string, moved: Transaction[]) {
  const db = await openFinanceDb();
  const t = db.transaction(['categories', 'transactions'], 'readwrite');
  for (const tx of moved) await t.objectStore('transactions').put({ ...tx, categoryId: reassignTo });
  await t.objectStore('categories').delete(id);
  await t.done;
}
export async function putRates(list: ExchangeRate[]) {
  const db = await openFinanceDb();
  const t = db.transaction('rates', 'readwrite');
  await Promise.all([...list.map((r) => t.store.put(r)), t.done]);
}
export async function deleteRate(id: string) {
  await (await openFinanceDb()).delete('rates', id);
}
export async function saveSettings(s: Settings) {
  await (await openFinanceDb()).put('kv', s, SETTINGS_KEY);
}

/** Atomically replace every record (used by import and migrations). */
export async function replaceAll(data: AppData, existing?: DB): Promise<void> {
  const db = existing ?? (await openFinanceDb());
  const t = db.transaction(['transactions', 'categories', 'rates', 'kv'], 'readwrite');
  await t.objectStore('transactions').clear();
  await t.objectStore('categories').clear();
  await t.objectStore('rates').clear();
  for (const x of data.transactions) await t.objectStore('transactions').put(x);
  for (const x of data.categories) await t.objectStore('categories').put(x);
  for (const x of data.rates) await t.objectStore('rates').put(x);
  await t.objectStore('kv').put(data.settings, SETTINGS_KEY);
  await t.objectStore('kv').put(SCHEMA_VERSION, SCHEMA_KEY);
  await t.done;
}

/** Keep a copy of the current data before an import so it can be undone. */
export async function saveSnapshot(data: AppData): Promise<void> {
  await (await openFinanceDb()).put('kv', { savedAt: new Date().toISOString(), data }, SNAPSHOT_KEY);
}
export async function loadSnapshot(): Promise<{ savedAt: string; data: AppData } | undefined> {
  return (await (await openFinanceDb()).get('kv', SNAPSHOT_KEY)) as { savedAt: string; data: AppData } | undefined;
}
export async function clearSnapshot(): Promise<void> {
  await (await openFinanceDb()).delete('kv', SNAPSHOT_KEY);
}

/** Ask the browser not to evict our data under storage pressure. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
