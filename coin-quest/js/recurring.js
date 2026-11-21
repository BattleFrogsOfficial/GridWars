// Paydays and bills that post themselves on their dates. Pure functions.
//
// An income source or bill with a nextDate and an account posts automatically once that date arrives:
// a payday adds to the account, a bill takes from it. Its nextDate then moves on by its frequency.
// Irregular ("varies") income never posts itself, since the amount isn't known; record those paydays by hand.
// Recurring items are already counted in the monthly budget, so posting only changes account balances.

import { addDays, addMonths, daysInMonth, dueDateIn, ymOf } from './dates.js';

/** The next date after `date` for an item paid with frequency `freq`, anchored to day-of-month `day`. */
export function nextOccurrence(date, freq, day = Number(date.slice(8))) {
  const ym = ymOf(date);
  switch (freq) {
    case 'weekly':
      return addDays(date, 7);
    case 'biweekly':
      return addDays(date, 14);
    case 'semimonthly': {
      // Twice a month: on day a (1-15) and a + 15 (or the last day of the month).
      const a = ((day - 1) % 15) + 1;
      const [y, m] = ym.split('-').map(Number);
      const second = `${ym}-${String(Math.min(a + 15, daysInMonth(y, m))).padStart(2, '0')}`;
      return date < second && Number(date.slice(8)) < a + 15 ? second : dueDateIn(addMonths(ym, 1), a);
    }
    case 'yearly':
      return dueDateIn(addMonths(ym, 12), day);
    default:
      return dueDateIn(addMonths(ym, 1), day);
  }
}

/**
 * Everything due on or before `today`. Returns { moves, nextDates } without changing state:
 * moves to add, and the new nextDate for each item that posted ({ list, id, nextDate }).
 */
export function dueRecurring(state, today, makeId) {
  const moves = [];
  const nextDates = [];
  const lists = [['incomeSources', 'payday'], ['bills', 'bill']];
  for (const [list, kind] of lists) {
    for (const item of state[list]) {
      if (!item.nextDate || !item.accountId || item.variable) continue;
      if (!state.accounts.some((a) => a.id === item.accountId)) continue;
      let d = item.nextDate;
      for (let i = 0; d <= today && i < 120; i++) {
        moves.push({
          id: makeId(), kind, from: kind === 'bill' ? item.accountId : null, to: kind === 'payday' ? item.accountId : null,
          amount: item.amount, date: d, note: item.name, sourceId: item.id, auto: true,
        });
        d = nextOccurrence(d, item.freq, item.day || Number(item.nextDate.slice(8)));
      }
      if (d !== item.nextDate) nextDates.push({ list, id: item.id, nextDate: d });
    }
  }
  return { moves, nextDates };
}
