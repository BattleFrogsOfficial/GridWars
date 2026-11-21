// Debt ledger math and monster classification. Pure functions: no DOM, no storage.
//
// A debt's balance is never stored directly. It is derived:
//   balance = startBalance + sum(ledger entries for that debt)
// Entry amounts are signed cents: payments are negative (damage), interest/charges/fees are positive (regen).
// A "correction" entry (from a Scout report) is whatever delta makes the balance match the real statement.

import { addMonths, dueDateIn, ymOf } from './dates.js';

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
export function pendingInterest(debt, ledger, today, makeId) {
  const entries = [];
  let through = debt.accruedThrough;
  if (!debt.autoInterest || debt.apr <= 0 || !through) return { entries, accruedThrough: through };

  const own = ledger.filter((e) => e.debtId === debt.id);
  let ym = ymOf(through);
  let due = dueDateIn(ym, debt.dueDay);
  if (due <= through) {
    ym = addMonths(ym, 1);
    due = dueDateIn(ym, debt.dueDay);
  }
  // Safety cap: never generate more than 10 years of entries in one go.
  for (let i = 0; due <= today && i < 120; i++) {
    const bal = balanceOf(debt, own.concat(entries), due);
    const amount = monthlyInterest(bal, debt.apr);
    if (amount > 0) {
      entries.push({ id: makeId(), debtId: debt.id, kind: 'interest', amount, date: due, note: '', auto: true });
    }
    through = due;
    ym = addMonths(ym, 1);
    due = dueDateIn(ym, debt.dueDay);
  }
  return { entries, accruedThrough: through };
}
