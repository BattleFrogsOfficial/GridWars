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
