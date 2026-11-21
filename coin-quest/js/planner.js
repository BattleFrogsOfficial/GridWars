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

/** The rate in simulated month k (1-based): the promo rate until the promo ends, then the after-promo rate. */
const rateIn = (d, k) => (d.promoMonths != null && k >= d.promoMonths ? d.aprAfter ?? d.apr : d.apr);

/**
 * One month of interest for a simulated debt, honoring a pause (deferment/forbearance).
 * d.acc tracks interest accrued during a pause that hasn't been capitalized; it earns no interest itself.
 */
function accrue(d, k) {
  const paused = k <= (d.pauseMonths || 0);
  if (!paused && d.acc && d.capitalize !== false) d.acc = 0; // capitalized when the pause ends
  if (paused && d.pauseAccrues === false) return 0;
  const i = monthlyInterest(d.bal - (d.acc || 0), rateIn(d, k));
  d.bal += i;
  if (paused) d.acc = (d.acc || 0) + i;
  return i;
}

/** Apply a payment, paying down uncapitalized accrued interest first. */
function pay(d, amount) {
  const p = Math.min(amount, d.bal);
  d.bal -= p;
  if (d.acc) d.acc = Math.max(0, d.acc - p);
  return p;
}

/**
 * @param {{id:string, balance:number, apr:number, minPayment:number, promoMonths?, aprAfter?, pauseMonths?, pauseAccrues?, capitalize?}[]} debts
 * @param {number} extraCents  extra paid per month on top of minimums
 * @param {'avalanche'|'snowball'} strategy
 * @param {number} maxMonths
 * @param {{id:string, month:number, amount:number}[]} extras  planned one-off amounts paid to a debt in a given month,
 *        on top of the monthly budget
 */
export function simulatePayoff(debts, extraCents, strategy = 'avalanche', maxMonths = 600, extras = []) {
  const order = (STRATEGIES[strategy] || STRATEGIES.avalanche).order;
  const live = debts
    .filter((d) => d.balance > 0)
    .map((d) => ({ ...d, min: Math.max(0, d.minPayment), bal: d.balance, acc: 0 }));
  const budget = live.reduce((s, d) => s + d.min, 0) + Math.max(0, extraCents);
  const kills = [];
  const timeline = [live.reduce((s, d) => s + d.bal, 0)];
  const payments = []; // payments[k-1] = total paid in month k
  let totalInterest = 0;
  let totalPaid = 0;
  let month = 0;

  while (month < maxMonths && live.some((d) => d.bal > 0)) {
    month++;
    const active = live.filter((d) => d.bal > 0);
    for (const d of active) totalInterest += accrue(d, month);
    const paused = (d) => month <= (d.pauseMonths || 0);
    // A paused loan's minimum isn't due, so that money isn't spent this month.
    let pool = budget - active.filter(paused).reduce((t, d) => t + d.min, 0);
    for (const d of active) if (!paused(d)) pool -= pay(d, Math.min(d.min, pool));
    let planned = 0;
    for (const x of extras) {
      const d = active.find((y) => y.id === x.id);
      if (d && x.month === month) planned += pay(d, x.amount);
    }
    // Extra goes to debts that aren't paused first, and to a paused one only if nothing else is left.
    const targets = active.filter((d) => !paused(d)).sort(order).concat(active.filter(paused).sort(order));
    for (const d of targets) {
      if (pool <= 0) break;
      pool -= pay(d, pool);
    }
    const spent = budget - active.filter(paused).reduce((t, d) => t + d.min, 0) - pool;
    totalPaid += spent + planned;
    payments.push(spent + planned);
    for (const d of active) if (d.bal <= 0) kills.push({ id: d.id, month });
    timeline.push(live.reduce((s, d) => s + d.bal, 0));
  }

  const feasible = live.every((d) => d.bal <= 0);
  return { feasible, months: month, totalInterest, totalPaid, kills, timeline, payments, budget };
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
  const d = { ...debt, bal: debt.balance, acc: 0 };
  let totalInterest = 0;
  let totalFees = 0;
  let totalPaid = 0;
  let month = 0;
  const timeline = [d.bal];
  const payments = [];
  while (d.bal > 0 && month < maxMonths) {
    month++;
    totalInterest += accrue(d, month);
    let amount;
    if (month <= missCount) {
      amount = 0;
      d.bal += fee;
      totalFees += fee;
    } else {
      amount = month <= (d.pauseMonths || 0) ? 0 : monthly;
    }
    if (extraAmt && (every === 0 ? month === 1 : (month - 1) % every === 0)) amount += extraAmt;
    const paid = pay(d, amount);
    totalPaid += paid;
    payments.push(paid);
    timeline.push(d.bal);
  }
  return { feasible: d.bal <= 0, months: month, totalInterest, totalFees, totalPaid, timeline, payments };
}
