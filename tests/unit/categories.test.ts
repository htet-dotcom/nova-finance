import { describe, expect, it } from 'vitest';
import { createCategory, moveCategory, planCategoryDelete, sortCategories, updateCategory } from '../../src/lib/categories';
import { defaultCategories } from '../../src/lib/defaults';
import { tx } from './helpers';

const cats = () => defaultCategories('2026-01-01T00:00:00.000Z');

describe('categories', () => {
  it('ships editable defaults for both income and expense', () => {
    const list = cats();
    expect(sortCategories(list, 'expense').map((c) => c.name)).toEqual([
      'Food', 'Transportation', 'Rent', 'Phone', 'Internet', 'Shopping', 'Entertainment', 'Bills', 'Health', 'Education', 'Family', 'Other',
    ]);
    expect(sortCategories(list, 'income').map((c) => c.name)).toEqual(['Salary', 'Freelance', 'Business', 'Other income']);
  });

  it('creates a custom category with icon, budget and next order', () => {
    const c = createCategory(cats(), { name: '  Coffee  ', type: 'expense', icon: '☕', budget: 800 });
    expect(c.name).toBe('Coffee');
    expect(c.icon).toBe('☕');
    expect(c.budget).toBe(800);
    expect(c.order).toBe(12);
    expect(c.id).toMatch(/^cat_/);
  });

  it('custom income categories ignore budgets and fixed flags', () => {
    const c = createCategory(cats(), { name: 'Tips', type: 'income', icon: '🪙', budget: 100, fixed: true });
    expect(c.budget).toBeNull();
    expect(c.fixed).toBe(false);
  });

  it('rejects empty and duplicate names (case-insensitive, per type)', () => {
    expect(() => createCategory(cats(), { name: '   ', type: 'expense', icon: 'x' })).toThrow('name-required');
    expect(() => createCategory(cats(), { name: 'food', type: 'expense', icon: 'x' })).toThrow('name-taken');
    expect(() => createCategory(cats(), { name: 'Food', type: 'income', icon: 'x' })).not.toThrow();
  });

  it('renames, changes icon and budget', () => {
    const list = cats();
    const u = updateCategory(list, 'cat_food', { name: 'Food & drinks', icon: '🍚', budget: 5000 });
    expect(u).toMatchObject({ name: 'Food & drinks', icon: '🍚', budget: 5000 });
    expect(() => updateCategory(list, 'cat_food', { name: 'Rent' })).toThrow('name-taken');
    expect(updateCategory(list, 'cat_food', { name: 'FOOD' }).name).toBe('FOOD'); // same item, different case
    expect(updateCategory(list, 'cat_food', { budget: 0 }).budget).toBeNull();
    expect(() => updateCategory(list, 'cat_food', { budget: -1 })).toThrow('invalid-budget');
  });

  it('reorders within a type', () => {
    const list = cats();
    const changed = moveCategory(list, 'cat_transport', -1);
    const byId = Object.fromEntries(changed.map((c) => [c.id, c.order]));
    expect(byId).toEqual({ cat_transport: 0, cat_food: 1 });
    expect(moveCategory(list, 'cat_food', -1)).toEqual([]); // already first
  });

  it('deleting reassigns transactions to another category of the same type', () => {
    const list = cats();
    const txs = [tx('expense', 10, '2026-09-01', { categoryId: 'cat_food' }), tx('expense', 5, '2026-09-01', { categoryId: 'cat_rent' })];
    const plan = planCategoryDelete(list, txs, 'cat_food', 'cat_other-expense');
    expect(plan.moved).toHaveLength(1);
    expect(() => planCategoryDelete(list, txs, 'cat_food', 'cat_salary')).toThrow('invalid-target');
    expect(() => planCategoryDelete(list, txs, 'cat_food', 'cat_food')).toThrow('invalid-target');
  });

  it('cannot delete the last category of a type', () => {
    const only = cats().filter((c) => c.type === 'expense' || c.id === 'cat_salary');
    expect(() => planCategoryDelete(only, [], 'cat_salary', 'cat_food')).toThrow('last-of-type');
  });
});
