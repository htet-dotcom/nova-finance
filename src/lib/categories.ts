import { CATEGORY_COLORS, cleanText, newId } from './defaults';
import type { Category, Transaction, TxType } from './types';

export type CategoryError = 'name-required' | 'name-taken' | 'last-of-type' | 'invalid-target' | 'invalid-budget';

export class CategoryOpError extends Error {
  constructor(public code: CategoryError) {
    super(code);
  }
}

export function sortCategories(list: readonly Category[], type?: TxType): Category[] {
  return list.filter((c) => !type || c.type === type).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

function assertName(list: readonly Category[], type: TxType, name: string, exceptId?: string): string {
  const clean = cleanText(name, 60);
  if (!clean) throw new CategoryOpError('name-required');
  const lower = clean.toLocaleLowerCase();
  if (list.some((c) => c.type === type && c.id !== exceptId && c.name.toLocaleLowerCase() === lower)) {
    throw new CategoryOpError('name-taken');
  }
  return clean;
}

function assertBudget(budget: number | null): number | null {
  if (budget === null) return null;
  if (!Number.isFinite(budget) || budget < 0) throw new CategoryOpError('invalid-budget');
  return budget === 0 ? null : budget;
}

export function createCategory(
  list: readonly Category[],
  input: { name: string; type: TxType; icon: string; color?: string; budget?: number | null; fixed?: boolean },
  now = new Date().toISOString(),
): Category {
  const name = assertName(list, input.type, input.name);
  const same = list.filter((c) => c.type === input.type);
  return {
    id: newId('cat'),
    name,
    type: input.type,
    icon: input.icon || '📦',
    color: input.color ?? CATEGORY_COLORS[same.length % CATEGORY_COLORS.length],
    order: same.reduce((m, c) => Math.max(m, c.order + 1), 0),
    budget: input.type === 'expense' ? assertBudget(input.budget ?? null) : null,
    fixed: input.type === 'expense' ? !!input.fixed : false,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateCategory(
  list: readonly Category[],
  id: string,
  patch: Partial<Pick<Category, 'name' | 'icon' | 'color' | 'budget' | 'fixed'>>,
  now = new Date().toISOString(),
): Category {
  const cat = list.find((c) => c.id === id);
  if (!cat) throw new CategoryOpError('invalid-target');
  return {
    ...cat,
    ...patch,
    name: patch.name !== undefined ? assertName(list, cat.type, patch.name, id) : cat.name,
    budget: cat.type === 'expense' && patch.budget !== undefined ? assertBudget(patch.budget) : cat.budget,
    fixed: cat.type === 'expense' && patch.fixed !== undefined ? patch.fixed : cat.fixed,
    updatedAt: now,
  };
}

/** Move a category one step up/down within its type. Returns the categories whose order changed. */
export function moveCategory(list: readonly Category[], id: string, dir: -1 | 1, now = new Date().toISOString()): Category[] {
  const cat = list.find((c) => c.id === id);
  if (!cat) return [];
  const ordered = sortCategories(list, cat.type);
  const idx = ordered.findIndex((c) => c.id === id);
  const swap = idx + dir;
  if (swap < 0 || swap >= ordered.length) return [];
  [ordered[idx], ordered[swap]] = [ordered[swap], ordered[idx]];
  return ordered
    .map((c, i) => (c.order === i ? null : { ...c, order: i, updatedAt: now }))
    .filter((c): c is Category => c !== null);
}

/**
 * Plan deleting a category: its transactions move to `reassignTo` (same type).
 * Deleting the last category of a type is not allowed.
 */
export function planCategoryDelete(
  categories: readonly Category[],
  transactions: readonly Transaction[],
  id: string,
  reassignTo: string,
): { moved: Transaction[] } {
  const cat = categories.find((c) => c.id === id);
  if (!cat) throw new CategoryOpError('invalid-target');
  if (categories.filter((c) => c.type === cat.type).length <= 1) throw new CategoryOpError('last-of-type');
  const target = categories.find((c) => c.id === reassignTo);
  if (!target || target.id === id || target.type !== cat.type) throw new CategoryOpError('invalid-target');
  return { moved: transactions.filter((t) => t.categoryId === id) };
}
