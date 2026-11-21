// Monthly budget math. Pure functions.
//
// The budget is built from what setup collects:
//   income sources (recurring, any frequency)  -> monthly income
//   fixed bills (recurring, never paid off)     -> monthly fixed costs
//   debts' minimum payments                     -> monthly debt minimums
//   left over = income - fixed - minimums, which the user assigns to "allocations" (categories).
// Actual spending is tracked per month: expenses logged against allocations, plus debt payments.
// Bills are assumed paid each month. One-off income (a bonus, a side job) adds to that month only.

import { addMonths, ymOf } from './dates.js';

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

/** A budget line's amount in month `ym`: a one-month override if set, else its usual amount. */
export function limitFor(c, ym) {
  return ym && c.overrides && ym in c.overrides ? c.overrides[ym] : c.limit;
}

/**
 * Monthly amount for an income source. Irregular ("varies") income uses the average of the paydays recorded
 * for it in the last 3 full months, falling back to the estimate until there are any.
 */
export function sourceMonthly(state, src, ym = null) {
  if (src.variable && ym) {
    const months = [1, 2, 3].map((k) => addMonths(ym, -k));
    const paid = state.moves.filter((m) => m.kind === 'payday' && m.sourceId === src.id && months.includes(ymOf(m.date)));
    if (paid.length) {
      const active = new Set(paid.map((m) => ymOf(m.date)));
      return Math.round(sum(paid, (m) => m.amount) / active.size);
    }
  }
  return toMonthly(src.amount, src.freq);
}

/** The planned month: what comes in, what's already spoken for, and what's left to assign. */
export function monthlyPlan(state, debtMins, ym = null) {
  const income = sum(state.incomeSources, (i) => sourceMonthly(state, i, ym));
  const fixed = sum(state.bills, (b) => toMonthly(b.amount, b.freq));
  const leftover = income - fixed - debtMins;
  const allocated = sum(state.categories, (c) => limitFor(c, ym));
  return { income, fixed, debtMins, leftover, allocated, unallocated: leftover - allocated };
}

/** Spending per budget line in month `ym` (expenses, plus extra debt payments for the debt line). */
function spentByLine(state, ym, debtMins) {
  const spentBy = new Map(state.categories.map((c) => [c.id, 0]));
  spentBy.set(OTHER_CATEGORY_ID, 0);
  for (const e of state.expenses) {
    if (ymOf(e.date) === ym && spentBy.has(e.categoryId)) spentBy.set(e.categoryId, spentBy.get(e.categoryId) + e.amount);
  }
  const debtPaid = sum(state.ledger.filter((e) => e.kind === 'payment' && ymOf(e.date) === ym), (e) => -e.amount);
  const cardSpend = sum(state.expenses.filter((e) => e.debtId && ymOf(e.date) === ym), (e) => e.amount);
  // Payments beyond the minimums (and beyond paying off this month's card purchases) are extra debt payments.
  if (spentBy.has(DEBT_CATEGORY_ID)) spentBy.set(DEBT_CATEGORY_ID, spentBy.get(DEBT_CATEGORY_ID) + Math.max(0, debtPaid - cardSpend - debtMins));
  return { spentBy, debtPaid, cardSpend };
}

/** Unspent (or overspent) money carried into `ym` for a line with rollover on, since the account started. */
export function carryInto(state, c, ym, debtMins = 0) {
  if (!c.rollover || !state.settings.startMonth) return 0;
  let carry = 0;
  let m = state.settings.startMonth;
  if (addMonths(ym, -36) > m) m = addMonths(ym, -36);
  for (; m < ym; m = addMonths(m, 1)) carry += limitFor(c, m) - (spentByLine(state, m, debtMins).spentBy.get(c.id) || 0);
  return carry;
}

/** Plan plus what actually happened in month `ym`. */
export function monthSummary(state, ym, debtMins = 0) {
  // Recurring income and bills only count from the month the account was set up.
  const started = !state.settings.startMonth || ym >= state.settings.startMonth;
  const plan = started ? monthlyPlan(state, debtMins, ym) : { income: 0, fixed: 0, debtMins: 0, leftover: 0, allocated: 0, unallocated: 0 };

  const extraIncome = sum(state.incomes.filter((i) => ymOf(i.date) === ym), (i) => i.amount);
  const { spentBy, debtPaid, cardSpend } = spentByLine(state, ym, debtMins);
  const expenses = sum(state.expenses.filter((e) => ymOf(e.date) === ym), (e) => e.amount);
  const incomeTotal = plan.income + extraIncome;
  // Card purchases already count as spending, so paying the card off doesn't count a second time.
  const debtSpend = Math.max(0, debtPaid - cardSpend);
  const spent = plan.fixed + expenses + debtSpend;
  const row = (c) => {
    const spentC = spentBy.get(c.id) || 0;
    const limit = limitFor(c, ym);
    const carry = carryInto(state, c, ym, debtMins);
    const available = limit + carry;
    return {
      ...c, limit, carry, available, overridden: !!(c.overrides && ym in c.overrides),
      spent: spentC, remaining: available - spentC, over: available > 0 ? spentC > available : spentC > 0,
    };
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
    cardSpend,
    spent, // bills + logged expenses + debt payments (not double-counting card purchases)
    left: incomeTotal - spent,
    categories: state.categories.map(row),
    other: { id: OTHER_CATEGORY_ID, name: 'Unplanned', kind: 'want', limit: 0, carry: 0, available: 0, spent: other, remaining: -other, over: other > 0 },
  };
}

/** Months from `fromYm` to `toYm` (0 if the same month). */
const monthsApart = (fromYm, toYm) => {
  const [a, b] = fromYm.split('-').map(Number);
  const [c, d] = toYm.split('-').map(Number);
  return c * 12 + d - (a * 12 + b);
};

/**
 * Progress on a savings line with a target and optionally a deadline.
 * needPerMonth: what to put aside each month (this month included) to reach the target by the deadline.
 */
export function goalStatus(state, c, today) {
  if (!c.target) return null;
  const saved = savedSoFar(state, c.id);
  const remaining = Math.max(0, c.target - saved);
  if (!c.targetDate) return { saved, remaining, done: remaining === 0 };
  const monthsLeft = Math.max(1, monthsApart(ymOf(today), ymOf(c.targetDate)) + 1);
  const needPerMonth = Math.ceil(remaining / monthsLeft / 100) * 100;
  return { saved, remaining, done: remaining === 0, monthsLeft, needPerMonth, onTrack: remaining === 0 || c.limit >= needPerMonth, late: today > c.targetDate && remaining > 0 };
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
