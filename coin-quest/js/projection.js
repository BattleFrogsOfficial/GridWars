// Money over time: actual month-end values for recent months, then a projection for the months ahead.
// Pure functions.
//
// The projection assumes the budget is followed:
//   + income sources each month
//   - fixed bills
//   - debt payments: minimums + the Extra debt payments line on the plan's debts (they stop as debts die),
//     and minimums on benched debts
//   - everyday and fun budget lines (need/want)
//   - savings budget lines move from checking into savings
//   - scheduled one-off payments in the month they are planned for
// Investments are held flat (no market growth is assumed).

import { addMonths, daysInMonth, dueDateIn, ymOf } from './dates.js';
import { accountEvents, totalsByType } from './accounts.js';
import { balanceOf } from './debts.js';
import { monthSummary, monthlyPlan } from './budget.js';
import { simulatePayoff, projectDebt } from './planner.js';

const monthEnd = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return `${ym}-${String(daysInMonth(y, m)).padStart(2, '0')}`;
};
const sumBy = (arr, f) => arr.reduce((s, x) => s + f(x), 0);

/** Where a scheduled payment comes out of: 'savings' if its account is a savings account, else 'cash'. */
function scheduledSide(state, item) {
  const a = state.accounts.find((x) => x.id === item.accountId);
  return a?.type === 'savings' ? 'savings' : 'cash';
}

/** Dates after `today` (through month `endYm`) on which a planned payment happens; monthly ones repeat. */
export function occurrences(item, today, endYm) {
  const out = [];
  let d = item.date;
  for (let i = 0; i < 240 && ymOf(d) <= endYm; i++) {
    if (d > today) out.push(d);
    if (item.repeat !== 'monthly') break;
    d = dueDateIn(addMonths(ymOf(d), 1), item.day || Number(d.slice(8)));
  }
  return out;
}

/**
 * @returns {{ months: string[], splitAt: number, cash: number[], savings: number[], invest: number[],
 *             debts: number[], income: number[], spending: number[] }}
 * Index splitAt is the current month (its balances are today's). Later indexes are projected.
 */
export function moneyTimeline(state, today, { back = 5, ahead = 12, projections = true } = {}) {
  const now = ymOf(today);
  const dataMonths = [
    state.settings.startMonth,
    ...state.accounts.map((a) => ymOf(a.createdAt)),
    ...state.debts.map((d) => ymOf(d.createdAt)),
    ...state.expenses.map((e) => ymOf(e.date)),
    ...state.incomes.map((e) => ymOf(e.date)),
  ].filter(Boolean);
  const earliest = dataMonths.reduce((min, m) => (m < min ? m : min), now);
  let first = addMonths(now, -back);
  if (earliest > first) first = earliest;

  const events = accountEvents(state);
  const liveNow = state.debts.map((d) => ({ d, bal: balanceOf(d, state.ledger) })).filter((x) => x.bal > 0);
  const minsNow = sumBy(liveNow, (x) => x.d.minPayment);
  const out = { months: [], splitAt: 0, cash: [], savings: [], invest: [], debts: [], income: [], spending: [] };

  // Actual: month-end values (today for the current month).
  for (let ym = first; ym <= now; ym = addMonths(ym, 1)) {
    const date = ym === now ? today : monthEnd(ym);
    const t = totalsByType(state, date, events);
    const s = monthSummary(state, ym, minsNow);
    out.months.push(ym);
    out.cash.push(t.cash);
    out.savings.push(t.savings);
    out.invest.push(t.invest);
    out.debts.push(sumBy(state.debts.filter((d) => d.createdAt <= date), (d) => Math.max(0, balanceOf(d, state.ledger, date))));
    out.income.push(s.incomeTotal);
    out.spending.push(s.spent);
  }
  out.splitAt = out.months.length - 1;
  if (!projections) return out;

  // Projected.
  const plan = monthlyPlan(state, minsNow);
  const lineTotal = (kinds) => sumBy(state.categories.filter((c) => kinds.includes(c.kind)), (c) => c.limit);
  const spendLines = lineTotal(['need', 'want']);
  const saveLines = lineTotal(['savings']);
  const extraDebt = lineTotal(['debt']);
  const asDebt = (x) => ({ id: x.d.id, balance: x.bal, apr: x.d.apr, minPayment: x.d.minPayment });
  const sim = simulatePayoff(liveNow.filter((x) => x.d.include).map(asDebt), extraDebt, state.settings.strategy);
  const benched = liveNow.filter((x) => !x.d.include).map((x) => projectDebt(asDebt(x), {}, ahead + 1));
  const at = (tl, k) => tl[Math.min(k, tl.length - 1)] ?? 0;
  const paid = (r, k) => r.payments[k - 1] ?? 0; // exact amount the simulation paid in month k
  const endYm = addMonths(now, ahead);
  // Each planned payment's dates in the projection window. Debt payments only add what's above that debt's
  // minimum, because the plan already pays the minimum every month.
  const planned = state.scheduled.flatMap((x) => {
    let amount = x.amount;
    if (x.kind === 'debt') {
      const live = liveNow.find((l) => l.d.id === x.debtId);
      amount = live ? Math.max(0, x.amount - live.d.minPayment) : 0;
    }
    return amount ? occurrences(x, today, endYm).map((date) => ({ ...x, date, amount })) : [];
  });
  let extraDebtPaid = 0;

  let cash = out.cash[out.splitAt];
  let savings = out.savings[out.splitAt];
  const invest = out.invest[out.splitAt];
  for (let k = 1; k <= ahead; k++) {
    const ym = addMonths(now, k);
    // Planned payments later this month land in the first projected month.
    const sched = planned.filter((x) => (k === 1 ? ymOf(x.date) <= ym : ymOf(x.date) === ym));
    extraDebtPaid += sumBy(sched.filter((x) => x.kind === 'debt'), (x) => x.amount);
    const schedCash = sumBy(sched.filter((x) => scheduledSide(state, x) === 'cash'), (x) => x.amount);
    const schedSave = sumBy(sched.filter((x) => scheduledSide(state, x) === 'savings'), (x) => x.amount);
    const debtOut = paid(sim, k) + sumBy(benched, (b) => paid(b, k));

    cash += plan.income - plan.fixed - debtOut - spendLines - saveLines - schedCash;
    savings += saveLines - schedSave;
    out.months.push(ym);
    out.cash.push(cash);
    out.savings.push(savings);
    out.invest.push(invest);
    out.debts.push(Math.max(0, at(sim.timeline, k) + sumBy(benched, (b) => at(b.timeline, k)) - extraDebtPaid));
    out.income.push(plan.income);
    out.spending.push(plan.fixed + debtOut + spendLines + schedCash + schedSave);
  }
  return out;
}
