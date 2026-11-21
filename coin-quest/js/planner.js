// Debt payoff simulation ("Quest plan"). Pure functions.
//
// Each month: interest is added to every live debt, then every minimum is paid, then everything left
// in the monthly budget hits the target debt (and spills to the next). The monthly budget is fixed at
// (sum of all minimums + extra), so when a debt dies its minimum rolls onto the next target.

import { monthlyInterest } from './debts.js';

export const STRATEGIES = {
  avalanche: {
    label: 'Avalanche',
    blurb: 'Highest interest first. Pays the least interest overall.',
    order: (a, b) => b.apr - a.apr || a.bal - b.bal,
  },
  snowball: {
    label: 'Snowball',
    blurb: 'Smallest balance first. Quicker kills to keep you going.',
    order: (a, b) => a.bal - b.bal || b.apr - a.apr,
  },
};

/**
 * @param {{id:string, balance:number, apr:number, minPayment:number}[]} debts  balances/minimums in cents
 * @param {number} extraCents  extra paid per month on top of minimums
 * @param {'avalanche'|'snowball'} strategy
 * @returns {{feasible:boolean, months:number, totalInterest:number, totalPaid:number,
 *            kills:{id:string, month:number}[], timeline:number[]}}
 */
export function simulatePayoff(debts, extraCents, strategy = 'avalanche', maxMonths = 600) {
  const order = (STRATEGIES[strategy] || STRATEGIES.avalanche).order;
  const live = debts
    .filter((d) => d.balance > 0)
    .map((d) => ({ id: d.id, apr: d.apr, min: Math.max(0, d.minPayment), bal: d.balance }));
  const budget = live.reduce((s, d) => s + d.min, 0) + Math.max(0, extraCents);
  const kills = [];
  const timeline = [live.reduce((s, d) => s + d.bal, 0)];
  let totalInterest = 0;
  let totalPaid = 0;
  let month = 0;

  while (month < maxMonths && live.some((d) => d.bal > 0)) {
    month++;
    const active = live.filter((d) => d.bal > 0);
    for (const d of active) {
      const i = monthlyInterest(d.bal, d.apr);
      d.bal += i;
      totalInterest += i;
    }
    let pool = budget;
    for (const d of active) {
      const pay = Math.min(d.min, d.bal, pool);
      d.bal -= pay;
      pool -= pay;
    }
    for (const d of active.slice().sort(order)) {
      if (pool <= 0) break;
      const pay = Math.min(pool, d.bal);
      d.bal -= pay;
      pool -= pay;
    }
    totalPaid += budget - pool;
    for (const d of active) if (d.bal <= 0) kills.push({ id: d.id, month });
    timeline.push(live.reduce((s, d) => s + d.bal, 0));
  }

  const feasible = live.every((d) => d.bal <= 0);
  return { feasible, months: month, totalInterest, totalPaid, kills, timeline, budget };
}

/**
 * Month-by-month projection for ONE debt under a what-if scenario.
 * @param {{balance:number, apr:number, minPayment:number}} debt  cents / APR %
 * @param {object} s
 *   s.monthly      regular payment each month (default: the minimum)
 *   s.extra        { amount, every } extra payment on top; every = 0 means one time (this month),
 *                  otherwise every N months starting this month
 *   s.missed       { count, fee } skip the next `count` payments, each adding `fee`; payments then resume
 * Interest is added before each month's payment, as in simulatePayoff.
 * Assumes a fixed regular payment (real card minimums shrink as the balance falls).
 */
export function projectDebt(debt, s = {}, maxMonths = 600) {
  const monthly = Math.max(0, s.monthly ?? debt.minPayment);
  const extraAmt = Math.max(0, s.extra?.amount || 0);
  const every = Math.max(0, s.extra?.every ?? 0);
  const missCount = Math.max(0, s.missed?.count || 0);
  const fee = Math.max(0, s.missed?.fee || 0);
  let bal = debt.balance;
  let totalInterest = 0;
  let totalFees = 0;
  let totalPaid = 0;
  let month = 0;
  const timeline = [bal];
  while (bal > 0 && month < maxMonths) {
    month++;
    const i = monthlyInterest(bal, debt.apr);
    bal += i;
    totalInterest += i;
    let pay;
    if (month <= missCount) {
      pay = 0;
      bal += fee;
      totalFees += fee;
    } else {
      pay = monthly;
    }
    if (extraAmt && (every === 0 ? month === 1 : (month - 1) % every === 0)) pay += extraAmt;
    pay = Math.min(pay, bal);
    bal -= pay;
    totalPaid += pay;
    timeline.push(bal);
  }
  return { feasible: bal <= 0, months: month, totalInterest, totalFees, totalPaid, timeline };
}
