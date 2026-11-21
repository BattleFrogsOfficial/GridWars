// Monthly budget math. Pure functions.
//
// Categories carry a monthly limit (the same every month in v1). Income and expenses are dated entries.
// The special "debt" category's spending is not entered by hand: it is the sum of debt payments
// (attacks) made that month, so paying a monster automatically shows up in the budget.

import { ymOf } from './dates.js';

export const CATEGORY_KINDS = {
  need: 'Need',
  want: 'Want',
  savings: 'Savings',
  debt: 'Debt attack',
};

export const DEBT_CATEGORY_ID = 'debt-attack';

export function defaultCategories() {
  return [
    { id: 'housing', name: 'Housing', kind: 'need', limit: 0 },
    { id: 'food', name: 'Food', kind: 'need', limit: 0 },
    { id: 'transport', name: 'Transport', kind: 'need', limit: 0 },
    { id: 'utilities', name: 'Bills & utilities', kind: 'need', limit: 0 },
    { id: 'fun', name: 'Fun', kind: 'want', limit: 0 },
    { id: 'savings', name: 'Savings', kind: 'savings', limit: 0 },
    { id: DEBT_CATEGORY_ID, name: 'Debt attack', kind: 'debt', limit: 0 },
  ];
}

export function monthSummary(state, ym) {
  const income = state.incomes.filter((i) => ymOf(i.date) === ym).reduce((s, i) => s + i.amount, 0);
  const spentBy = new Map(state.categories.map((c) => [c.id, 0]));
  for (const e of state.expenses) {
    if (ymOf(e.date) === ym && spentBy.has(e.categoryId)) spentBy.set(e.categoryId, spentBy.get(e.categoryId) + e.amount);
  }
  const debtPaid = state.ledger
    .filter((e) => e.kind === 'payment' && ymOf(e.date) === ym)
    .reduce((s, e) => s - e.amount, 0);
  if (spentBy.has(DEBT_CATEGORY_ID)) spentBy.set(DEBT_CATEGORY_ID, spentBy.get(DEBT_CATEGORY_ID) + debtPaid);

  const assigned = state.categories.reduce((s, c) => s + c.limit, 0);
  const spent = [...spentBy.values()].reduce((s, v) => s + v, 0);
  return {
    ym,
    income,
    assigned,
    toAssign: income - assigned, // zero-based budgeting: aim for exactly 0
    spent,
    left: income - spent,
    categories: state.categories.map((c) => ({
      ...c,
      spent: spentBy.get(c.id) || 0,
      remaining: c.limit - (spentBy.get(c.id) || 0),
      over: c.limit > 0 ? spentBy.get(c.id) > c.limit : spentBy.get(c.id) > 0,
    })),
  };
}

/** Apply a 50/30/20 split of a monthly income across the default category kinds (needs/wants/savings+debt). */
export function suggest503020(incomeCents) {
  return { need: Math.round(incomeCents * 0.5), want: Math.round(incomeCents * 0.3), savingsAndDebt: Math.round(incomeCents * 0.2) };
}
