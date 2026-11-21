// Money you have: cash, savings and investment accounts. Pure functions.
//
// Like debts, an account's balance is never stored; it is derived:
//   balance = starting balance + every input that touched it since the account was added
// Inputs that touch accounts:
//   extra income (incomes[].accountId)            +
//   expenses (expenses[].accountId)               -   and, for savings lines, +toAccountId
//   debt payments (ledger payment .accountId)     -
//   moves: payday (to), bill (from), transfer (from -> to), update (to, signed correction)
// Events dated before an account was added are ignored: its starting balance already includes them.

import { addDays } from './dates.js';

export const ACCOUNT_TYPES = {
  cash: 'Cash & checking',
  savings: 'Savings',
  invest: 'Invested',
};

export const MOVE_KINDS = {
  payday: 'Payday',
  bill: 'Bill paid',
  transfer: 'Moved money',
  update: 'Balance updated',
};

/** Every change to every account as { accountId, amount, date, label }. */
export function accountEvents(state) {
  const out = [];
  const add = (accountId, amount, date, label) => accountId && amount && out.push({ accountId, amount, date, label });
  for (const i of state.incomes) add(i.accountId, i.amount, i.date, `Income${i.source ? `: ${i.source}` : ''}`);
  for (const e of state.expenses) {
    const line = e.categoryId === 'other' ? 'Unplanned' : state.categories.find((c) => c.id === e.categoryId)?.name;
    const what = [line, e.note].filter(Boolean).join(' · ') || 'Expense';
    add(e.accountId, -e.amount, e.date, what);
    add(e.toAccountId, e.amount, e.date, `Saved: ${what}`);
  }
  for (const e of state.ledger) {
    if (e.kind === 'payment') add(e.accountId, e.amount, e.date, `Debt payment: ${state.debts.find((d) => d.id === e.debtId)?.name || 'debt'}`);
  }
  for (const m of state.moves) {
    const note = m.note ? `: ${m.note}` : '';
    if (m.kind === 'update') add(m.to, m.amount, m.date, `${MOVE_KINDS.update}${note}`);
    else {
      add(m.from, -m.amount, m.date, `${MOVE_KINDS[m.kind]}${note}`);
      add(m.to, m.amount, m.date, `${MOVE_KINDS[m.kind]}${note}`);
    }
  }
  return out;
}

/** Balance of each account as of `asOf` (inclusive; null = everything). Accounts not yet added count as 0. */
export function accountBalances(state, asOf = null, events = accountEvents(state)) {
  const byId = new Map();
  for (const a of state.accounts) byId.set(a.id, asOf == null || a.createdAt <= asOf ? a.start : 0);
  for (const ev of events) {
    const a = state.accounts.find((x) => x.id === ev.accountId);
    if (!a || ev.date < a.createdAt || (asOf != null && ev.date > asOf)) continue;
    byId.set(a.id, byId.get(a.id) + ev.amount);
  }
  return byId;
}

export function totalsByType(state, asOf = null, events) {
  const bal = accountBalances(state, asOf, events);
  const t = { cash: 0, savings: 0, invest: 0 };
  for (const a of state.accounts) t[a.type] += bal.get(a.id);
  return { ...t, total: t.cash + t.savings + t.invest };
}

/**
 * Balances by type over time, from the first account's start date to `today`.
 * Daily points for up to ~2 months, then weekly, then every 4 weeks, so the chart stays readable.
 */
export function balanceHistory(state, today) {
  if (!state.accounts.length) return { dates: [], cash: [], savings: [], invest: [], total: [] };
  const start = state.accounts.reduce((min, a) => (a.createdAt < min ? a.createdAt : min), today);
  const days = Math.max(0, Math.round((Date.parse(today) - Date.parse(start)) / 864e5));
  const step = days <= 62 ? 1 : days <= 730 ? 7 : 28;
  const dates = [];
  for (let d = start; d < today; d = addDays(d, step)) dates.push(d);
  dates.push(today);
  const events = accountEvents(state);
  const out = { dates, cash: [], savings: [], invest: [], total: [] };
  for (const d of dates) {
    const t = totalsByType(state, d, events);
    out.cash.push(t.cash);
    out.savings.push(t.savings);
    out.invest.push(t.invest);
    out.total.push(t.total);
  }
  return out;
}

/** Recent activity on one account, newest first. */
export function accountActivity(state, accountId) {
  const a = state.accounts.find((x) => x.id === accountId);
  if (!a) return [];
  return accountEvents(state)
    .filter((ev) => ev.accountId === accountId && ev.date >= a.createdAt)
    .sort((x, y) => y.date.localeCompare(x.date));
}
