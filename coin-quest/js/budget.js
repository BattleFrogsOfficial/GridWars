// Monthly budget math. Pure functions.
//
// The budget is built from what setup collects:
//   income sources (recurring, any frequency)  -> monthly income
//   fixed bills (recurring, never paid off)     -> monthly fixed costs
//   debts' minimum payments                     -> monthly debt minimums
//   left over = income - fixed - minimums, which the user assigns to "allocations" (categories).
// Actual spending is tracked per month: expenses logged against allocations, plus debt payments.
// Bills are assumed paid each month. One-off income (a bonus, a side job) adds to that month only.

import { ymOf } from './dates.js';

export const FREQUENCIES = {
  weekly: { label: 'per week', factor: 52 / 12 },
  biweekly: { label: 'every 2 weeks', factor: 26 / 12 },
  semimonthly: { label: 'twice a month', factor: 2 },
  monthly: { label: 'per month', factor: 1 },
  yearly: { label: 'per year', factor: 1 / 12 },
};

export const CATEGORY_KINDS = {
  need: 'Everyday need',
  want: 'Fun & wants',
  savings: 'Savings',
  debt: 'Extra debt payments',
};

/** The single allocation whose amount becomes extra monthly damage on debts in the plan. */
export const DEBT_CATEGORY_ID = 'debt-attack';
/** Expenses that weren't planned for go here; it is not a stored category. */
export const OTHER_CATEGORY_ID = 'other';

export function toMonthly(amount, freq) {
  return Math.round(amount * (FREQUENCIES[freq]?.factor ?? 1));
}

const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);

/** The planned month: what comes in, what's already spoken for, and what's left to assign. */
export function monthlyPlan(state, debtMins) {
  const income = sum(state.incomeSources, (i) => toMonthly(i.amount, i.freq));
  const fixed = sum(state.bills, (b) => toMonthly(b.amount, b.freq));
  const leftover = income - fixed - debtMins;
  const allocated = sum(state.categories, (c) => c.limit);
  return { income, fixed, debtMins, leftover, allocated, unallocated: leftover - allocated };
}

/** Plan plus what actually happened in month `ym`. */
export function monthSummary(state, ym, debtMins = 0) {
  // Recurring income and bills only count from the month the account was set up.
  const started = !state.settings.startMonth || ym >= state.settings.startMonth;
  const plan = started ? monthlyPlan(state, debtMins) : { income: 0, fixed: 0, debtMins: 0, leftover: 0, allocated: 0, unallocated: 0 };

  const extraIncome = sum(state.incomes.filter((i) => ymOf(i.date) === ym), (i) => i.amount);
  const spentBy = new Map(state.categories.map((c) => [c.id, 0]));
  spentBy.set(OTHER_CATEGORY_ID, 0);
  for (const e of state.expenses) {
    if (ymOf(e.date) === ym && spentBy.has(e.categoryId)) spentBy.set(e.categoryId, spentBy.get(e.categoryId) + e.amount);
  }
  const debtPaid = sum(state.ledger.filter((e) => e.kind === 'payment' && ymOf(e.date) === ym), (e) => -e.amount);
  // Payments beyond the minimums count toward the "Extra debt payments" allocation.
  if (spentBy.has(DEBT_CATEGORY_ID)) spentBy.set(DEBT_CATEGORY_ID, spentBy.get(DEBT_CATEGORY_ID) + Math.max(0, debtPaid - debtMins));

  const expenses = sum(state.expenses.filter((e) => ymOf(e.date) === ym), (e) => e.amount);
  const incomeTotal = plan.income + extraIncome;
  const spent = plan.fixed + expenses + debtPaid;
  const row = (c) => {
    const spentC = spentBy.get(c.id) || 0;
    return { ...c, spent: spentC, remaining: c.limit - spentC, over: c.limit > 0 ? spentC > c.limit : spentC > 0 };
  };
  const other = spentBy.get(OTHER_CATEGORY_ID);
  return {
    ...plan,
    ym,
    started,
    extraIncome,
    incomeTotal,
    expenses,
    debtPaid,
    spent, // bills + logged expenses + debt payments
    left: incomeTotal - spent,
    categories: state.categories.map(row),
    other: { id: OTHER_CATEGORY_ID, name: 'Unplanned', kind: 'want', limit: 0, spent: other, remaining: -other, over: other > 0 },
  };
}

/** All-time amount put into a savings allocation (expenses logged against it). */
export function savedSoFar(state, categoryId) {
  return sum(state.expenses.filter((e) => e.categoryId === categoryId), (e) => e.amount);
}

/**
 * Split what's left over across the chosen goals. Weights are a starting point the user edits.
 * Returns whole-dollar amounts (cents divisible by 500, i.e. $5 steps) that never exceed `leftover`.
 */
export const GOAL_WEIGHTS = { debt: 0.45, emergency: 0.3, saveFor: 0.15, fun: 0.1 };
export function suggestSplit(leftover, goalKeys) {
  const out = Object.fromEntries(goalKeys.map((k) => [k, 0]));
  if (leftover <= 0 || !goalKeys.length) return out;
  const total = sum(goalKeys, (k) => GOAL_WEIGHTS[k] || 0.1);
  for (const k of goalKeys) out[k] = Math.floor((leftover * (GOAL_WEIGHTS[k] || 0.1)) / total / 500) * 500;
  return out;
}
