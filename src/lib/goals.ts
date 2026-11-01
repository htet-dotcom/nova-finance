// Savings goals: progress, pace and required contributions. Pure functions only.

import { roundMoney, sumMoney } from './currency';
import { diffDays, isDateKey } from './dates';
import { CATEGORY_COLORS, cleanText, newId } from './defaults';
import type { CustomCurrency, DateKey, Goal, GoalContribution } from './types';

export type GoalError = 'name-required' | 'invalid-target' | 'invalid-amount' | 'invalid-date' | 'invalid-currency' | 'unknown-goal' | 'overdraw';

export class GoalOpError extends Error {
  constructor(public code: GoalError) {
    super(code);
  }
}

export const GOAL_ICONS = ['🎯', '🏠', '🚗', '✈️', '📱', '💻', '🎓', '💍', '👶', '🏥', '🛡️', '🎁', '🏍️', '🌴', '📈', '⭐'];
const MAX_AMOUNT = 1e13;

export interface GoalInput {
  name: string;
  icon: string;
  color?: string;
  currency: string;
  target: number;
  deadline: DateKey | null;
  archived?: boolean;
}

function validate(input: GoalInput) {
  const name = cleanText(input.name, 60);
  if (!name) throw new GoalOpError('name-required');
  if (!(Number.isFinite(input.target) && input.target > 0 && input.target <= MAX_AMOUNT)) throw new GoalOpError('invalid-target');
  if (input.deadline !== null && !isDateKey(input.deadline)) throw new GoalOpError('invalid-date');
  if (!/^[A-Z]{3}$/.test(input.currency)) throw new GoalOpError('invalid-currency');
  return name;
}

export function createGoal(list: readonly Goal[], input: GoalInput, now = new Date().toISOString()): Goal {
  const name = validate(input);
  return {
    id: newId('goal'),
    name,
    icon: input.icon || '🎯',
    color: input.color ?? CATEGORY_COLORS[(list.length + 3) % CATEGORY_COLORS.length],
    currency: input.currency,
    target: input.target,
    deadline: input.deadline,
    contributions: [],
    archived: !!input.archived,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateGoal(goal: Goal, input: GoalInput, now = new Date().toISOString()): Goal {
  const name = validate(input);
  if (input.currency !== goal.currency && goal.contributions.length) throw new GoalOpError('invalid-currency');
  return {
    ...goal,
    name,
    icon: input.icon || goal.icon,
    color: input.color ?? goal.color,
    currency: input.currency,
    target: input.target,
    deadline: input.deadline,
    archived: input.archived ?? goal.archived,
    updatedAt: now,
  };
}

export function goalSaved(goal: Goal, customCurrencies: readonly CustomCurrency[] = []): number {
  return roundMoney(sumMoney(goal.contributions.map((c) => c.amount)), goal.currency, customCurrencies);
}

/** Add a deposit (positive) or withdrawal (negative). Withdrawals cannot exceed what is saved. */
export function addContribution(
  goal: Goal,
  input: { amount: number; date: DateKey; note: string },
  customCurrencies: readonly CustomCurrency[] = [],
  now = new Date().toISOString(),
): Goal {
  if (!Number.isFinite(input.amount) || input.amount === 0 || Math.abs(input.amount) > MAX_AMOUNT) throw new GoalOpError('invalid-amount');
  if (!isDateKey(input.date)) throw new GoalOpError('invalid-date');
  if (input.amount < 0 && goalSaved(goal, customCurrencies) + input.amount < -1e-9) throw new GoalOpError('overdraw');
  const c: GoalContribution = { id: newId('gc'), date: input.date, amount: input.amount, note: cleanText(input.note, 200) };
  return { ...goal, contributions: [...goal.contributions, c], updatedAt: now };
}

export function removeContribution(goal: Goal, contributionId: string, customCurrencies: readonly CustomCurrency[] = [], now = new Date().toISOString()): Goal {
  const next = { ...goal, contributions: goal.contributions.filter((c) => c.id !== contributionId), updatedAt: now };
  if (goalSaved(next, customCurrencies) < -1e-9) throw new GoalOpError('overdraw');
  return next;
}

export type GoalStatus = 'done' | 'on-track' | 'behind' | 'overdue' | 'no-deadline';

export interface GoalProgress {
  goalId: string;
  saved: number;
  remaining: number;
  /** saved / target, clamped to [0, 1] */
  ratio: number;
  status: GoalStatus;
  /** Days from today until the deadline (inclusive of today); null without a deadline. */
  daysLeft: number | null;
  /** Amount to put aside per month / per day to finish on time (0 once done). */
  perMonth: number | null;
  perDay: number | null;
  /** Amount that should have been saved by today if saving evenly since the goal was created. */
  expectedByNow: number | null;
}

export function goalProgress(goal: Goal, today: DateKey, customCurrencies: readonly CustomCurrency[] = []): GoalProgress {
  const money = (v: number) => roundMoney(v, goal.currency, customCurrencies);
  const saved = goalSaved(goal, customCurrencies);
  const remaining = money(Math.max(0, goal.target - saved));
  const ratio = goal.target > 0 ? Math.max(0, Math.min(1, saved / goal.target)) : 0;
  const base = { goalId: goal.id, saved, remaining, ratio };
  if (remaining <= 0) return { ...base, status: 'done', daysLeft: goal.deadline ? Math.max(0, diffDays(today, goal.deadline) + 1) : null, perMonth: 0, perDay: 0, expectedByNow: null };
  if (!goal.deadline) return { ...base, status: 'no-deadline', daysLeft: null, perMonth: null, perDay: null, expectedByNow: null };

  const daysLeft = diffDays(today, goal.deadline) + 1;
  if (daysLeft <= 0) return { ...base, status: 'overdue', daysLeft: 0, perMonth: remaining, perDay: remaining, expectedByNow: goal.target };

  const perDay = money(remaining / daysLeft);
  // Average month length; avoids month-boundary jumps in the suggestion.
  const perMonth = money(remaining / Math.max(1, daysLeft / 30.4375));
  const created = goal.createdAt.slice(0, 10);
  const totalDays = Math.max(1, diffDays(created, goal.deadline) + 1);
  const elapsed = Math.min(totalDays, Math.max(0, diffDays(created, today) + 1));
  const expectedByNow = money((goal.target * elapsed) / totalDays);
  // A small grace (5 % of the target) avoids flagging "behind" for rounding-level differences.
  const status: GoalStatus = saved + goal.target * 0.05 >= expectedByNow ? 'on-track' : 'behind';
  return { ...base, status, daysLeft, perMonth: Math.min(perMonth, remaining), perDay, expectedByNow };
}
