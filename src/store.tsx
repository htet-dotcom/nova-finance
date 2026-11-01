import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { accountBalances, buildTransfer, createAccount, moveAccount, netWorth, planAccountDelete, updateAccount, type AccountBalance, type AccountInput, type NetWorth, type TransferInput } from './lib/accounts';
import { planImport, type ImportPlan } from './lib/backup';
import { addContribution, createGoal, removeContribution, updateGoal, type GoalInput } from './lib/goals';
import { CategoryOpError, createCategory, moveCategory, planCategoryDelete, updateCategory } from './lib/categories';
import { allCurrencies, CURRENCY_CODE_RE } from './lib/currency';
import { localTodayKey, isDateKey } from './lib/dates';
import * as db from './lib/db';
import { cleanText, defaultCategories, defaultSettings, newId } from './lib/defaults';
import { computeBudget, type BudgetSnapshot } from './lib/engine';
import { makeManualRate, openErApiProvider, providerResultToRates, rateId } from './lib/fx';
import type { Account, AppData, Category, Goal, Recurrence, Settings, Transaction, Transfer, TxType } from './lib/types';
import { dictionaries, type Dict } from './i18n';
import { setSystemBarsDark } from './native';

export interface TxInput {
  id?: string;
  type: TxType;
  amount: number;
  currency: string;
  categoryId: string;
  date: string;
  note: string;
  recurring: Recurrence | null;
  accountId?: string | null;
}

export type RateRefreshState = { status: 'idle' | 'loading' | 'ok' | 'error'; message?: string; at?: string };

interface Store {
  ready: boolean;
  loadError: string | null;
  data: AppData;
  today: string;
  online: boolean;
  t: Dict;
  budget: BudgetSnapshot;
  saveTransaction(input: TxInput): Promise<Transaction>;
  deleteTransaction(id: string): Promise<void>;
  saveCategory(input: { id?: string; name: string; type: TxType; icon: string; color?: string; budget: number | null; fixed: boolean }): Promise<Category>;
  moveCategory(id: string, dir: -1 | 1): Promise<void>;
  deleteCategory(id: string, reassignTo: string): Promise<void>;
  updateSettings(patch: Partial<Settings>): Promise<void>;
  saveManualRate(base: string, quote: string, rate: number, label: string): Promise<void>;
  deleteRate(id: string): Promise<void>;
  refreshRates(): Promise<void>;
  rateRefresh: RateRefreshState;
  applyImport(plan: ImportPlan): Promise<void>;
  undoImport(): Promise<boolean>;
  snapshotAt: string | null;
  markBackedUp(): Promise<void>;
  resetAll(): Promise<void>;
  persistent: boolean | null;
  balances: Map<string, AccountBalance>;
  netWorth: NetWorth;
  saveAccount(input: AccountInput & { id?: string }): Promise<Account>;
  moveAccount(id: string, dir: -1 | 1): Promise<void>;
  deleteAccount(id: string): Promise<void>;
  saveTransfer(input: TransferInput): Promise<Transfer>;
  deleteTransfer(id: string): Promise<void>;
  saveGoal(input: GoalInput & { id?: string }): Promise<Goal>;
  deleteGoal(id: string): Promise<void>;
  addGoalContribution(goalId: string, input: { amount: number; date: string; note: string }): Promise<Goal>;
  removeGoalContribution(goalId: string, contributionId: string): Promise<Goal>;
}

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside provider');
  return s;
}

const emptyData = (settings: Settings = defaultSettings()): AppData => ({
  transactions: [],
  categories: defaultCategories(),
  rates: [],
  accounts: [],
  transfers: [],
  goals: [],
  settings,
});
const EMPTY = emptyData();
const AUTO_REFRESH_MS = 6 * 60 * 60 * 1000;

export class ValidationError extends Error {}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(EMPTY);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [today, setToday] = useState(localTodayKey());
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [rateRefresh, setRateRefresh] = useState<RateRefreshState>({ status: 'idle' });
  const [snapshotAt, setSnapshotAt] = useState<string | null>(null);
  const [persistent, setPersistent] = useState<boolean | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;

  // ---- load ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await db.loadAll();
        if (cancelled) return;
        setData(loaded);
        setReady(true);
        const snap = await db.loadSnapshot();
        if (!cancelled) setSnapshotAt(snap?.savedAt ?? null);
        setPersistent(await db.requestPersistentStorage());
      } catch (e) {
        console.error(e);
        if (!cancelled) setLoadError((e as Error).message || 'Storage unavailable');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- clock & connectivity ----
  useEffect(() => {
    const tick = () => setToday(localTodayKey());
    const id = window.setInterval(tick, 30_000);
    const onVis = () => document.visibilityState === 'visible' && tick();
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  const t = dictionaries[data.settings.language] ?? dictionaries.en;

  // ---- transactions ----
  const saveTransaction = useCallback(async (input: TxInput) => {
    const d = dataRef.current;
    if (!(input.amount > 0) || !Number.isFinite(input.amount) || input.amount > 1e13) throw new ValidationError('amount');
    if (!isDateKey(input.date)) throw new ValidationError('date');
    if (!CURRENCY_CODE_RE.test(input.currency)) throw new ValidationError('currency');
    const cat = d.categories.find((c) => c.id === input.categoryId);
    if (!cat || cat.type !== input.type) throw new ValidationError('category');
    if (input.recurring?.until && (!isDateKey(input.recurring.until) || input.recurring.until < input.date)) {
      throw new ValidationError('until');
    }
    const existing = input.id ? d.transactions.find((x) => x.id === input.id) : undefined;
    const accountId = input.accountId === undefined ? (existing?.accountId ?? null) : input.accountId;
    if (accountId !== null && !d.accounts.some((a) => a.id === accountId)) throw new ValidationError('account');
    const now = new Date().toISOString();
    const tx: Transaction = {
      id: existing?.id ?? newId('tx'),
      type: input.type,
      amount: input.amount,
      currency: input.currency,
      categoryId: input.categoryId,
      date: input.date,
      note: cleanText(input.note, 500),
      recurring: input.recurring,
      accountId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await db.putTransaction(tx);
    setData((p) => ({
      ...p,
      transactions: existing ? p.transactions.map((x) => (x.id === tx.id ? tx : x)) : [...p.transactions, tx],
    }));
    return tx;
  }, []);

  const deleteTransaction = useCallback(async (id: string) => {
    await db.deleteTransaction(id);
    setData((p) => ({ ...p, transactions: p.transactions.filter((x) => x.id !== id) }));
  }, []);

  // ---- categories ----
  const saveCategory: Store['saveCategory'] = useCallback(async (input) => {
    const list = dataRef.current.categories;
    const cat = input.id
      ? updateCategory(list, input.id, { name: input.name, icon: input.icon, color: input.color, budget: input.budget, fixed: input.fixed })
      : createCategory(list, input);
    await db.putCategories([cat]);
    setData((p) => ({
      ...p,
      categories: p.categories.some((c) => c.id === cat.id) ? p.categories.map((c) => (c.id === cat.id ? cat : c)) : [...p.categories, cat],
    }));
    return cat;
  }, []);

  const moveCat = useCallback(async (id: string, dir: -1 | 1) => {
    const changed = moveCategory(dataRef.current.categories, id, dir);
    if (!changed.length) return;
    await db.putCategories(changed);
    const byId = new Map(changed.map((c) => [c.id, c]));
    setData((p) => ({ ...p, categories: p.categories.map((c) => byId.get(c.id) ?? c) }));
  }, []);

  const deleteCat = useCallback(async (id: string, reassignTo: string) => {
    const d = dataRef.current;
    const { moved } = planCategoryDelete(d.categories, d.transactions, id, reassignTo);
    await db.deleteCategory(id, reassignTo, moved);
    const now = new Date().toISOString();
    setData((p) => ({
      ...p,
      categories: p.categories.filter((c) => c.id !== id),
      transactions: p.transactions.map((x) => (x.categoryId === id ? { ...x, categoryId: reassignTo, updatedAt: now } : x)),
    }));
  }, []);

  // ---- accounts & transfers ----
  const saveAccount: Store['saveAccount'] = useCallback(async (input) => {
    const list = dataRef.current.accounts;
    const acc = input.id ? updateAccount(list, input.id, input) : createAccount(list, input);
    await db.putAccounts([acc]);
    setData((p) => ({ ...p, accounts: p.accounts.some((a) => a.id === acc.id) ? p.accounts.map((a) => (a.id === acc.id ? acc : a)) : [...p.accounts, acc] }));
    return acc;
  }, []);

  const moveAcc = useCallback(async (id: string, dir: -1 | 1) => {
    const changed = moveAccount(dataRef.current.accounts, id, dir);
    if (!changed.length) return;
    await db.putAccounts(changed);
    const byId = new Map(changed.map((a) => [a.id, a]));
    setData((p) => ({ ...p, accounts: p.accounts.map((a) => byId.get(a.id) ?? a) }));
  }, []);

  const deleteAcc = useCallback(async (id: string) => {
    const d = dataRef.current;
    const { unassigned, transferIds } = planAccountDelete(d.transactions, d.transfers, id);
    await db.deleteAccount(id, unassigned, transferIds);
    const changed = new Map(unassigned.map((t) => [t.id, t]));
    const gone = new Set(transferIds);
    setData((p) => ({
      ...p,
      accounts: p.accounts.filter((a) => a.id !== id),
      transactions: p.transactions.map((t) => changed.get(t.id) ?? t),
      transfers: p.transfers.filter((x) => !gone.has(x.id)),
    }));
  }, []);

  const saveTransfer = useCallback(async (input: TransferInput) => {
    const d = dataRef.current;
    const existing = input.id ? d.transfers.find((x) => x.id === input.id) : undefined;
    const x = buildTransfer(d.accounts, existing, input);
    await db.putTransfer(x);
    setData((p) => ({ ...p, transfers: existing ? p.transfers.map((y) => (y.id === x.id ? x : y)) : [...p.transfers, x] }));
    return x;
  }, []);

  const deleteTransfer = useCallback(async (id: string) => {
    await db.deleteTransfer(id);
    setData((p) => ({ ...p, transfers: p.transfers.filter((x) => x.id !== id) }));
  }, []);

  // ---- savings goals ----
  const storeGoal = useCallback(async (g: Goal) => {
    await db.putGoal(g);
    setData((p) => ({ ...p, goals: p.goals.some((x) => x.id === g.id) ? p.goals.map((x) => (x.id === g.id ? g : x)) : [...p.goals, g] }));
    return g;
  }, []);

  const saveGoal: Store['saveGoal'] = useCallback(async (input) => {
    const d = dataRef.current;
    const existing = input.id ? d.goals.find((g) => g.id === input.id) : undefined;
    return storeGoal(existing ? updateGoal(existing, input) : createGoal(d.goals, input));
  }, [storeGoal]);

  const deleteGoal = useCallback(async (id: string) => {
    await db.deleteGoal(id);
    setData((p) => ({ ...p, goals: p.goals.filter((g) => g.id !== id) }));
  }, []);

  const goalById = (id: string) => {
    const g = dataRef.current.goals.find((x) => x.id === id);
    if (!g) throw new ValidationError('goal');
    return g;
  };
  const addGoalContribution: Store['addGoalContribution'] = useCallback(
    async (goalId, input) => storeGoal(addContribution(goalById(goalId), input, dataRef.current.settings.customCurrencies)),
    [storeGoal],
  );
  const removeGoalContribution: Store['removeGoalContribution'] = useCallback(
    async (goalId, contributionId) => storeGoal(removeContribution(goalById(goalId), contributionId, dataRef.current.settings.customCurrencies)),
    [storeGoal],
  );

  // ---- settings ----
  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    const next = { ...dataRef.current.settings, ...patch };
    await db.saveSettings(next);
    setData((p) => ({ ...p, settings: next }));
  }, []);

  // ---- rates ----
  const saveManualRate = useCallback(async (base: string, quote: string, rate: number, label: string) => {
    if (!(rate > 0) || !Number.isFinite(rate)) throw new ValidationError('rate');
    if (base === quote || !CURRENCY_CODE_RE.test(base) || !CURRENCY_CODE_RE.test(quote)) throw new ValidationError('pair');
    const r = makeManualRate(base, quote, rate, new Date().toISOString(), cleanText(label, 120));
    // A manual rate for the reverse pair would conflict; replace it.
    const reverseId = rateId(quote, base, 'manual');
    if (dataRef.current.rates.some((x) => x.id === reverseId)) await db.deleteRate(reverseId);
    await db.putRates([r]);
    setData((p) => ({ ...p, rates: [...p.rates.filter((x) => x.id !== r.id && x.id !== reverseId), r] }));
  }, []);

  const deleteRate = useCallback(async (id: string) => {
    await db.deleteRate(id);
    setData((p) => ({ ...p, rates: p.rates.filter((x) => x.id !== id) }));
  }, []);

  const refreshingRef = useRef(false);
  const refreshRates = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRateRefresh({ status: 'loading' });
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 12_000);
    try {
      const s = dataRef.current.settings;
      const codes = allCurrencies(s.customCurrencies).map((c) => c.code);
      const result = await openErApiProvider.fetchRates('USD', ctrl.signal);
      const fetchedAt = new Date().toISOString();
      const rates = providerResultToRates(result, codes, openErApiProvider.label, fetchedAt);
      if (!rates.length) throw new Error('empty');
      await db.putRates(rates);
      const ids = new Set(rates.map((r) => r.id));
      setData((p) => ({ ...p, rates: [...p.rates.filter((r) => !ids.has(r.id)), ...rates] }));
      setRateRefresh({ status: 'ok', at: fetchedAt });
    } catch (e) {
      console.warn('Rate refresh failed', e);
      setRateRefresh({ status: 'error', message: (e as Error).message });
    } finally {
      window.clearTimeout(timer);
      refreshingRef.current = false;
    }
  }, []);

  // Auto-refresh provider rates when online and stale.
  useEffect(() => {
    if (!ready || !online || !data.settings.rateProviderEnabled) return;
    const latest = data.rates
      .filter((r) => r.source === 'provider' && r.fetchedAt)
      .reduce((m, r) => Math.max(m, Date.parse(r.fetchedAt!)), 0);
    if (Date.now() - latest > AUTO_REFRESH_MS) void refreshRates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, online, data.settings.rateProviderEnabled]);

  // ---- import / backup ----
  const applyImport = useCallback(async (plan: ImportPlan) => {
    const current = dataRef.current;
    await db.saveSnapshot(current);
    // Re-plan against the latest data to avoid racing edits made while the dialog was open.
    const fresh = plan.mode === 'merge' ? planImport(current, { ...plan.result }, 'merge').result : plan.result;
    await db.replaceAll(fresh);
    setData(await db.loadAll());
    setSnapshotAt(new Date().toISOString());
  }, []);

  const undoImport = useCallback(async () => {
    const snap = await db.loadSnapshot();
    if (!snap) return false;
    await db.replaceAll(snap.data);
    await db.clearSnapshot();
    setData(await db.loadAll());
    setSnapshotAt(null);
    return true;
  }, []);

  const markBackedUp = useCallback(async () => {
    await updateSettings({ lastBackupAt: new Date().toISOString() });
  }, [updateSettings]);

  const resetAll = useCallback(async () => {
    const fresh = emptyData({ ...defaultSettings(), language: dataRef.current.settings.language });
    await db.replaceAll(fresh);
    await db.clearSnapshot();
    setSnapshotAt(null);
    setData(fresh);
  }, []);

  const budget = useMemo(
    () => computeBudget({ transactions: data.transactions, categories: data.categories, rates: data.rates, settings: data.settings, today }),
    [data, today],
  );

  const balances = useMemo(
    () => accountBalances({ accounts: data.accounts, transactions: data.transactions, transfers: data.transfers, rates: data.rates, settings: data.settings, today }),
    [data.accounts, data.transactions, data.transfers, data.rates, data.settings, today],
  );
  const worth = useMemo(() => netWorth(data.accounts, balances, data.rates, data.settings), [data.accounts, balances, data.rates, data.settings]);

  // ---- theme & language side effects ----
  useEffect(() => {
    const root = document.documentElement;
    const theme = data.settings.theme;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    root.lang = data.settings.language;
    const dark = theme === 'dark' || (theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b1220' : '#0f766e');
    void setSystemBarsDark(!!dark);
  }, [data.settings.theme, data.settings.language]);

  const value: Store = {
    ready,
    loadError,
    data,
    today,
    online,
    t,
    budget,
    saveTransaction,
    deleteTransaction,
    saveCategory,
    moveCategory: moveCat,
    deleteCategory: deleteCat,
    updateSettings,
    saveManualRate,
    deleteRate,
    refreshRates,
    rateRefresh,
    applyImport,
    undoImport,
    snapshotAt,
    markBackedUp,
    resetAll,
    persistent,
    balances,
    netWorth: worth,
    saveAccount,
    moveAccount: moveAcc,
    deleteAccount: deleteAcc,
    saveTransfer,
    deleteTransfer,
    saveGoal,
    deleteGoal,
    addGoalContribution,
    removeGoalContribution,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function categoryErrorText(t: Dict, e: unknown): string {
  if (e instanceof CategoryOpError) {
    return {
      'name-required': t.errNameRequired,
      'name-taken': t.errNameTaken,
      'last-of-type': t.errLastOfType,
      'invalid-target': t.errLastOfType,
      'invalid-budget': t.errInvalidBudget,
    }[e.code];
  }
  return (e as Error)?.message ?? String(e);
}
