// Debt ledger math and monster classification. Pure functions: no DOM, no storage.
//
// A debt's balance is never stored directly. It is derived:
//   balance = startBalance + sum(ledger entries for that debt)
// Entry amounts are signed cents: payments are negative (damage), interest/charges/fees are positive (regen).
// A "correction" entry (from a Scout report) is whatever delta makes the balance match the real statement.

import { addDays, addMonths, dueDateIn, ymOf } from './dates.js';

export const DEBT_TYPES = [
  { key: 'credit', label: 'Credit card' },
  { key: 'personal', label: 'Personal loan' },
  { key: 'car', label: 'Car loan' },
  { key: 'student', label: 'Student loan' },
  { key: 'medical', label: 'Medical bill' },
  { key: 'mortgage', label: 'Mortgage' },
  { key: 'other', label: 'Other' },
];

export const ENTRY_KINDS = {
  payment: { label: 'Attack', sign: -1 },
  interest: { label: 'Interest regen', sign: 1 },
  accrued: { label: 'Interest (paused loan)', sign: 1 },
  charge: { label: 'New charge', sign: 1 },
  fee: { label: 'Fee', sign: 1 },
  correction: { label: 'Scout report', sign: 0 },
};

// Balance decides the monster's size and tier.
export const TIERS = [
  { key: 'slime', name: 'Slime', min: 0 },
  { key: 'goblin', name: 'Goblin', min: 50_000 }, // $500
  { key: 'troll', name: 'Troll', min: 200_000 }, // $2,000
  { key: 'drake', name: 'Young Dragon', min: 1_000_000 }, // $10,000
  { key: 'dragon', name: 'Elder Dragon', min: 4_000_000 }, // $40,000
];

// APR decides its temperament (color) — how fast it regenerates.
export const TEMPERS = [
  { key: 'calm', name: 'Calm', minApr: 0 },
  { key: 'angry', name: 'Angry', minApr: 5 },
  { key: 'furious', name: 'Furious', minApr: 15 },
];

export function tierFor(balanceCents) {
  let t = TIERS[0];
  for (const tier of TIERS) if (balanceCents >= tier.min) t = tier;
  return t;
}

export function temperFor(apr) {
  let t = TEMPERS[0];
  for (const temper of TEMPERS) if (apr >= temper.minApr) t = temper;
  return t;
}

/**
 * The highest balance a debt has ever had: its starting balance, or more if interest and charges pushed it
 * higher before payments brought it down. A monster's type is set by this, so paying a debt down makes it
 * more and more damaged instead of turning it into a weaker monster.
 */
export function peakBalance(debt, ledger) {
  let bal = debt.startBalance;
  let peak = bal;
  const own = ledger.filter((e) => e.debtId === debt.id).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  // within a day, count increases before payments so a same-day charge and payment still registers the peak
  let i = 0;
  while (i < own.length) {
    const day = own[i].date;
    let up = 0, down = 0;
    for (; i < own.length && own[i].date === day; i++) {
      if (own[i].amount > 0) up += own[i].amount;
      else down += own[i].amount;
    }
    bal += up;
    if (bal > peak) peak = bal;
    bal += down;
  }
  return peak;
}

/** Which sprite to draw. Mortgages are always a castle boss; everything else follows its tier. */
export function speciesFor(debt, balanceCents) {
  if (debt.type === 'mortgage') return { key: 'castle', name: 'Castle Keep' };
  return tierFor(balanceCents);
}

export function balanceOf(debt, ledger, asOf = null) {
  let b = debt.startBalance;
  for (const e of ledger) {
    if (e.debtId === debt.id && (asOf == null || e.date <= asOf)) b += e.amount;
  }
  return b;
}

export function balancesById(debts, ledger) {
  const map = new Map(debts.map((d) => [d.id, d.startBalance]));
  for (const e of ledger) if (map.has(e.debtId)) map.set(e.debtId, map.get(e.debtId) + e.amount);
  return map;
}

/** One month of interest at the given APR, rounded to the cent. Zero for non-positive balances. */
export function monthlyInterest(balanceCents, apr) {
  if (balanceCents <= 0 || apr <= 0) return 0;
  return Math.round((balanceCents * apr) / 1200);
}

/** True when the minimum payment does not even cover a month of interest: the monster out-heals you. */
export function isRegenerating(debt, balanceCents) {
  return balanceCents > 0 && monthlyInterest(balanceCents, debt.apr) >= debt.minPayment;
}

/**
 * Compute interest entries owed since `debt.accruedThrough` up to `today` (inclusive), one per due date.
 * Returns { entries, accruedThrough } without mutating anything.
 * Interest each month is based on the balance as of that due date, including that month's earlier entries.
 */
/** The interest rate on a date: the current (promo) rate until promoEnds, then aprAfter. */
export function aprOn(debt, date) {
  return debt.promoEnds && date >= debt.promoEnds ? debt.aprAfter ?? debt.apr : debt.apr;
}

/** In deferment/forbearance: no payment is required through pauseUntil. */
export const isPaused = (debt, date) => !!debt.pauseUntil && date <= debt.pauseUntil;

const monthsBetween = (fromYm, toYm) => {
  const [a, b] = fromYm.split('-').map(Number);
  const [c, d] = toYm.split('-').map(Number);
  return c * 12 + d - (a * 12 + b);
};

/** A debt in the shape the payoff simulations take, with its promo and pause converted to month counts from today. */
export function simDebt(debt, balance, today) {
  const now = ymOf(today);
  return {
    id: debt.id,
    balance,
    apr: debt.promoEnds && today >= debt.promoEnds ? debt.aprAfter ?? debt.apr : debt.apr,
    aprAfter: debt.aprAfter ?? null,
    promoMonths: debt.promoEnds && today < debt.promoEnds ? monthsBetween(now, ymOf(debt.promoEnds)) : null,
    minPayment: debt.minPayment,
    pauseMonths: debt.pauseUntil && today <= debt.pauseUntil ? monthsBetween(now, ymOf(debt.pauseUntil)) : 0,
    pauseAccrues: debt.pauseAccrues !== false,
    capitalize: debt.capitalize !== false,
  };
}

/**
 * Compute interest entries owed since `debt.accruedThrough` up to `today` (inclusive), one per due date.
 * Returns { entries, accruedThrough } without mutating anything.
 *  - Credit cards: daily interest on each day's balance through the cycle (previous due date to this one),
 *    and none at all if the balance at the start of the cycle was paid off in full during it (grace period).
 *  - Other debts: a month of interest on the balance as of the due date.
 *  - Paused loans (deferment/forbearance): interest builds up as "accrued" (or not at all if it doesn't accrue)
 *    and earns no interest itself; when the pause ends it is capitalized (added to principal) unless turned off.
 */
export function pendingInterest(debt, ledger, today, makeId) {
  const entries = [];
  let through = debt.accruedThrough;
  const hasRate = debt.apr > 0 || (debt.aprAfter ?? 0) > 0;
  if (!debt.autoInterest || !hasRate || !through) return { entries, accruedThrough: through };

  const own = ledger.filter((e) => e.debtId === debt.id);
  let ym = ymOf(through);
  let due = dueDateIn(ym, debt.dueDay);
  if (due <= through) {
    ym = addMonths(ym, 1);
    due = dueDateIn(ym, debt.dueDay);
  }
  // Safety cap: never generate more than 10 years of entries in one go.
  for (let i = 0; due <= today && i < 120; i++) {
    const all = own.concat(entries);
    const paused = isPaused(debt, due);
    let amount = 0;
    if (paused && debt.pauseAccrues === false) {
      amount = 0;
    } else if (debt.type === 'credit' && !paused) {
      const prevDue = dueDateIn(addMonths(ym, -1), debt.dueDay);
      const start = prevDue > debt.createdAt ? prevDue : debt.createdAt;
      const statement = balanceOf(debt, all, start);
      const paidInCycle = -all.filter((e) => e.kind === 'payment' && e.date > start && e.date <= due).reduce((t, e) => t + e.amount, 0);
      if (statement > 0 && paidInCycle < statement) {
        let sum = 0;
        for (let d = addDays(start, 1); d <= due; d = addDays(d, 1)) sum += (Math.max(0, balanceOf(debt, all, d)) * aprOn(debt, d)) / 36500;
        amount = Math.round(sum);
      }
    } else {
      const accrued = all.filter((e) => e.kind === 'accrued' && e.date <= due).reduce((t, e) => t + e.amount, 0);
      const excluded = paused || debt.capitalize === false ? accrued : 0;
      amount = monthlyInterest(balanceOf(debt, all, due) - excluded, aprOn(debt, due));
    }
    if (amount > 0) {
      entries.push({ id: makeId(), debtId: debt.id, kind: paused ? 'accrued' : 'interest', amount, date: due, note: '', auto: true });
    }
    through = due;
    ym = addMonths(ym, 1);
    due = dueDateIn(ym, debt.dueDay);
  }
  return { entries, accruedThrough: through };
}

/** The most recent due date passed without at least the minimum being paid since the one before it. */
export function missedPayment(debt, ledger, today) {
  if (!debt.minPayment || isPaused(debt, today)) return null;
  let last = dueDateIn(ymOf(today), debt.dueDay);
  if (last >= today) last = dueDateIn(addMonths(ymOf(today), -1), debt.dueDay);
  const prev = dueDateIn(addMonths(ymOf(last), -1), debt.dueDay);
  if (prev < debt.createdAt) return null; // added too recently to know
  if (balanceOf(debt, ledger, prev) <= 0) return null;
  const paid = ledger.filter((e) => e.debtId === debt.id && e.kind === 'payment' && e.date > prev && e.date <= last).reduce((t, e) => t - e.amount, 0);
  return paid < Math.min(debt.minPayment, balanceOf(debt, ledger, prev)) ? { due: last, paid } : null;
}
