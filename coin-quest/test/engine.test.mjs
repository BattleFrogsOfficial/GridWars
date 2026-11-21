// Run with: node --test coin-quest/test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMoney, parsePercent, centsToInput } from '../js/money.js';
import { addMonths, dueDateIn, addDays, isValidISO } from '../js/dates.js';
import { balanceOf, monthlyInterest, isRegenerating, pendingInterest, tierFor, temperFor, speciesFor } from '../js/debts.js';
import { simulatePayoff } from '../js/planner.js';
import { monthSummary, monthlyPlan, toMonthly, suggestSplit, DEBT_CATEGORY_ID, OTHER_CATEGORY_ID } from '../js/budget.js';
import { levelInfo, streak, xpForLevel, attackXp } from '../js/player.js';
import { emptyState, normalizeState } from '../js/state.js';
import { SPRITES } from '../js/sprites.js';

let n = 0;
const id = () => 'id' + n++;

test('parseMoney handles common inputs without float error', () => {
  assert.equal(parseMoney('1,234.56'), 123456);
  assert.equal(parseMoney('$20'), 2000);
  assert.equal(parseMoney('19.999'), 2000);
  assert.equal(parseMoney('1.005'), 101);
  assert.equal(parseMoney('.5'), 50);
  assert.equal(parseMoney('0.1'), 10);
  assert.equal(parseMoney(''), null);
  assert.equal(parseMoney('abc'), null);
  assert.equal(parseMoney('1.2.3'), null);
  assert.equal(centsToInput(123405), '1234.05');
  assert.equal(parsePercent('24.99%'), 24.99);
  assert.equal(parsePercent('-1'), null);
});

test('dates', () => {
  assert.equal(addMonths('2026-11', 2), '2027-01');
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(dueDateIn('2027-02', 31), '2027-02-28');
  assert.equal(dueDateIn('2028-02', 31), '2028-02-29');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.ok(isValidISO('2026-02-28'));
  assert.ok(!isValidISO('2026-02-30'));
});

test('balance is derived from start balance plus ledger', () => {
  const debt = { id: 'a', startBalance: 100000 };
  const ledger = [
    { debtId: 'a', amount: -20000, date: '2026-01-05' },
    { debtId: 'a', amount: 1500, date: '2026-01-10' },
    { debtId: 'b', amount: -99999, date: '2026-01-10' },
  ];
  assert.equal(balanceOf(debt, ledger), 81500);
  assert.equal(balanceOf(debt, ledger, '2026-01-06'), 80000);
});

test('interest and regeneration warning', () => {
  assert.equal(monthlyInterest(100000, 24), 2000); // $1000 at 24% = $20/month
  assert.equal(monthlyInterest(-500, 24), 0);
  assert.ok(isRegenerating({ apr: 24, minPayment: 1500 }, 100000));
  assert.ok(!isRegenerating({ apr: 24, minPayment: 5000 }, 100000));
});

test('pendingInterest accrues once per due date, catches up, and respects payments', () => {
  const debt = { id: 'a', startBalance: 120000, apr: 12, dueDay: 15, autoInterest: true, accruedThrough: '2026-01-20' };
  const ledger = [{ debtId: 'a', amount: -20000, date: '2026-02-01' }];
  const r = pendingInterest(debt, ledger, '2026-04-14', id);
  // Due dates passed: Feb 15, Mar 15 (Apr 15 not yet). Feb: 1000.00 * 1% = 10.00
  assert.deepEqual(r.entries.map((e) => [e.date, e.amount]), [['2026-02-15', 1000], ['2026-03-15', 1010]]);
  assert.equal(r.accruedThrough, '2026-03-15');
  // Running again from the new checkpoint on the same day adds nothing.
  const again = pendingInterest({ ...debt, accruedThrough: r.accruedThrough }, ledger.concat(r.entries), '2026-04-14', id);
  assert.equal(again.entries.length, 0);
  // Due day on the same day it was created does not charge immediately.
  const fresh = pendingInterest({ ...debt, accruedThrough: '2026-04-15', dueDay: 15 }, [], '2026-04-15', id);
  assert.equal(fresh.entries.length, 0);
  // Disabled auto interest
  assert.equal(pendingInterest({ ...debt, autoInterest: false }, [], '2027-01-01', id).entries.length, 0);
});

test('monster classification', () => {
  assert.equal(tierFor(10000).key, 'slime');
  assert.equal(tierFor(50000).key, 'goblin');
  assert.equal(tierFor(1500000).key, 'drake');
  assert.equal(tierFor(9000000).key, 'dragon');
  assert.equal(temperFor(0).key, 'calm');
  assert.equal(temperFor(7).key, 'angry');
  assert.equal(temperFor(29.99).key, 'furious');
  assert.equal(speciesFor({ type: 'mortgage' }, 100).key, 'castle');
});

test('payoff simulation: single loan matches amortization', () => {
  // $1,000 at 12%, $100/month -> 11 months, final payment smaller
  const r = simulatePayoff([{ id: 'a', balance: 100000, apr: 12, minPayment: 10000 }], 0);
  assert.ok(r.feasible);
  assert.equal(r.months, 11);
  assert.ok(r.totalInterest > 5500 && r.totalInterest < 6000, String(r.totalInterest));
  assert.equal(r.totalPaid, 100000 + r.totalInterest);
});

test('avalanche pays less interest than snowball; rollover works; infeasible is detected', () => {
  const debts = [
    { id: 'small', balance: 100000, apr: 5, minPayment: 2500 },
    { id: 'big', balance: 500000, apr: 25, minPayment: 15000 },
  ];
  const av = simulatePayoff(debts, 20000, 'avalanche');
  const sb = simulatePayoff(debts, 20000, 'snowball');
  assert.ok(av.feasible && sb.feasible);
  assert.ok(av.totalInterest < sb.totalInterest);
  assert.equal(sb.kills[0].id, 'small');
  assert.equal(av.kills[0].id, 'big');
  const minsOnly = simulatePayoff(debts, 0, 'avalanche');
  assert.ok(minsOnly.months > av.months);

  const bad = simulatePayoff([{ id: 'x', balance: 1000000, apr: 30, minPayment: 10000 }], 0);
  assert.equal(bad.feasible, false);
});

test('monthly plan: income minus bills minus minimums leaves the amount to allocate', () => {
  const s = emptyState();
  s.incomeSources.push({ id: 'i', name: 'Job', amount: 92308, freq: 'weekly' }); // $923.08/wk ≈ $4,000/mo
  s.bills.push({ id: 'r', name: 'Rent', amount: 150000, freq: 'monthly' });
  s.bills.push({ id: 'p', name: 'Phone', amount: 60000, freq: 'yearly' }); // $50/mo
  s.categories.push({ id: 'food', name: 'Groceries', kind: 'need', limit: 50000 });
  s.categories.push({ id: DEBT_CATEGORY_ID, name: 'Extra debt payments', kind: 'debt', limit: 30000 });
  const p = monthlyPlan(s, 50000);
  assert.equal(p.income, 400001);
  assert.equal(p.fixed, 155000);
  assert.equal(p.leftover, 400001 - 155000 - 50000);
  assert.equal(p.allocated, 80000);
  assert.equal(p.unallocated, p.leftover - 80000);
  assert.equal(toMonthly(100000, 'biweekly'), 216667);
  assert.equal(toMonthly(100000, 'semimonthly'), 200000);
});

test('month summary: actual spending, extra debt payments and one-off income', () => {
  const s = emptyState();
  s.settings.startMonth = '2026-11';
  s.incomeSources.push({ id: 'i', name: 'Job', amount: 400000, freq: 'monthly' });
  s.bills.push({ id: 'r', name: 'Rent', amount: 150000, freq: 'monthly' });
  s.categories.push({ id: 'food', name: 'Groceries', kind: 'need', limit: 40000 });
  s.categories.push({ id: DEBT_CATEGORY_ID, name: 'Extra debt payments', kind: 'debt', limit: 30000 });
  s.incomes.push({ id: '1', amount: 20000, date: '2026-11-20', source: 'Bonus' });
  s.expenses.push({ id: '3', amount: 45000, date: '2026-11-03', categoryId: 'food' });
  s.expenses.push({ id: '4', amount: 1000, date: '2026-11-03', categoryId: OTHER_CATEGORY_ID });
  s.debts.push({ id: 'd', startBalance: 100000 });
  s.ledger.push({ id: '5', debtId: 'd', kind: 'payment', amount: -35000, date: '2026-11-10' });
  s.ledger.push({ id: '6', debtId: 'd', kind: 'interest', amount: 1000, date: '2026-11-15' });
  const m = monthSummary(s, '2026-11', 10000);
  assert.equal(m.incomeTotal, 420000);
  assert.equal(m.debtPaid, 35000);
  assert.equal(m.spent, 150000 + 46000 + 35000);
  assert.equal(m.left, 420000 - m.spent);
  assert.ok(m.categories.find((c) => c.id === 'food').over);
  assert.equal(m.categories.find((c) => c.id === DEBT_CATEGORY_ID).spent, 25000); // 35000 paid - 10000 minimums
  assert.equal(m.other.spent, 1000);
  // Months before setup don't count recurring income or bills
  const before = monthSummary(s, '2026-10', 10000);
  assert.equal(before.income, 0);
  assert.equal(before.fixed, 0);
});

test('suggestSplit never exceeds what is left and weights the goals', () => {
  const split = suggestSplit(150000, ['debt', 'emergency', 'fun']);
  const total = Object.values(split).reduce((a, b) => a + b, 0);
  assert.ok(total <= 150000 && total > 140000);
  assert.ok(split.debt > split.emergency && split.emergency > split.fun);
  Object.values(split).forEach((v) => assert.equal(v % 500, 0));
  assert.deepEqual(suggestSplit(-100, ['debt']), { debt: 0 });
});

test('levels and streaks', () => {
  assert.equal(levelInfo(0).level, 1);
  assert.equal(levelInfo(xpForLevel(2)).level, 2);
  assert.equal(levelInfo(xpForLevel(5) - 1).level, 4);
  assert.equal(attackXp(100), 10);
  assert.equal(attackXp(10_000_000), 60);
  assert.equal(streak(['2026-11-19', '2026-11-20', '2026-11-21'], '2026-11-21'), 3);
  assert.equal(streak(['2026-11-19', '2026-11-20'], '2026-11-21'), 2);
  assert.equal(streak(['2026-11-18'], '2026-11-21'), 0);
});

test('normalizeState rejects foreign files, cleans bad values and migrates v1', () => {
  assert.throws(() => normalizeState({ foo: 1 }));
  assert.throws(() => normalizeState({ app: 'coin-quest', version: 99 }));
  const s = normalizeState({
    app: 'coin-quest',
    version: 5,
    debts: [{ id: 'a', startBalance: 1000, apr: -5, dueDay: 40, type: 'spaceship' }, { id: 'bad' }],
    ledger: [{ id: 'l', debtId: 'a', kind: 'payment', amount: -100, date: '2026-01-01' }, { id: 'm', debtId: 'zzz', kind: 'payment', amount: 1, date: '2026-01-01' }],
    categories: [{ id: 'x', name: 'X', limit: 1.5, target: -3 }],
    incomeSources: [{ id: 'i', name: 'Job', amount: 1000, freq: 'hourly' }, { id: 'j', amount: -1 }],
    expenses: [{ id: 'e', amount: 100, date: '2026-01-01', categoryId: 'nope' }, { id: 'f', amount: 100, date: '2026-01-01', categoryId: 'other' }],
  });
  assert.equal(s.debts.length, 1);
  assert.equal(s.debts[0].apr, 0);
  assert.equal(s.debts[0].dueDay, 1);
  assert.equal(s.debts[0].type, 'other');
  assert.equal(s.ledger.length, 1);
  assert.equal(s.categories[0].limit, 0);
  assert.equal(s.categories[0].target, null);
  assert.deepEqual(s.incomeSources, [{ id: 'i', name: 'Job', amount: 1000, freq: 'monthly', nextDate: null, day: null, accountId: null, variable: false }]);
  assert.equal(s.expenses.length, 1);
  assert.deepEqual(normalizeState(JSON.parse(JSON.stringify(s))), s);

  // v1 save: unused preset categories dropped, old Debt attack reset, setup counted done if it had debts
  const v1 = normalizeState({
    app: 'coin-quest', version: 1, settings: {},
    debts: [{ id: 'a', startBalance: 1000 }],
    categories: [{ id: 'housing', name: 'Housing', kind: 'need', limit: 0 }, { id: 'food', name: 'Food', kind: 'need', limit: 0 }, { id: 'debt-attack', name: 'Debt attack', kind: 'debt', limit: 80000 }],
    expenses: [{ id: 'e', amount: 100, date: '2026-01-01', categoryId: 'food' }],
  });
  assert.deepEqual(v1.categories.map((c) => [c.id, c.limit]), [['food', 0], ['debt-attack', 0]]);
  assert.equal(v1.settings.setupDone, true);
  assert.equal(v1.version, 5);
});

test('sprites are rectangular grids', () => {
  for (const [key, rows] of Object.entries(SPRITES)) {
    assert.equal(rows.length, 16, key);
    rows.forEach((r, i) => assert.equal(r.length, 16, `${key} row ${i}`));
  }
});

test('projectDebt scenarios', async () => {
  const { projectDebt } = await import('../js/planner.js');
  const debt = { balance: 100000, apr: 12, minPayment: 10000 };
  const base = projectDebt(debt);
  assert.equal(base.months, 11);
  assert.equal(base.totalPaid, 100000 + base.totalInterest);
  // Paying more finishes sooner with less interest
  const more = projectDebt(debt, { monthly: 20000 });
  assert.ok(more.months < base.months && more.totalInterest < base.totalInterest);
  // One-time extra payment of the whole balance kills it in month 1
  assert.equal(projectDebt(debt, { extra: { amount: 200000, every: 0 } }).months, 1);
  // Recurring extra every 3 months beats the base but not a doubled payment
  const ex3 = projectDebt(debt, { extra: { amount: 10000, every: 3 } });
  assert.ok(ex3.months < base.months && ex3.months >= more.months);
  // Missing 2 payments with a $30 fee: later, more interest, fees counted
  const miss = projectDebt(debt, { missed: { count: 2, fee: 3000 } });
  assert.ok(miss.months > base.months);
  assert.equal(miss.totalFees, 6000);
  assert.ok(miss.totalInterest > base.totalInterest);
  assert.equal(miss.totalPaid, 100000 + miss.totalInterest + miss.totalFees);
  // Payment below interest never finishes
  assert.equal(projectDebt({ balance: 1000000, apr: 30, minPayment: 10000 }).feasible, false);
});

test('account balances follow every input, ignore events before an account existed, and support overrides', async () => {
  const { accountBalances, totalsByType, balanceHistory, accountActivity } = await import('../js/accounts.js');
  const s = emptyState();
  s.categories.push({ id: 'ef', name: 'Emergency fund', kind: 'savings', limit: 10000, target: null });
  s.accounts.push({ id: 'chk', name: 'Checking', type: 'cash', start: 100000, createdAt: '2026-11-01' });
  s.accounts.push({ id: 'sav', name: 'Savings', type: 'savings', start: 500000, createdAt: '2026-11-01' });
  s.accounts.push({ id: 'ira', name: 'IRA', type: 'invest', start: 1000000, createdAt: '2026-11-10' });
  s.incomes.push({ id: 'i', amount: 20000, date: '2026-11-05', source: 'Bonus', accountId: 'chk' });
  s.incomes.push({ id: 'old', amount: 99999, date: '2026-10-05', source: 'Before', accountId: 'chk' }); // before account: ignored
  s.expenses.push({ id: 'e', amount: 5000, date: '2026-11-06', categoryId: 'other', accountId: 'chk', toAccountId: null });
  s.expenses.push({ id: 's', amount: 10000, date: '2026-11-07', categoryId: 'ef', accountId: 'chk', toAccountId: 'sav' });
  s.debts.push({ id: 'd', name: 'Visa', startBalance: 100000 });
  s.ledger.push({ id: 'p', debtId: 'd', kind: 'payment', amount: -15000, date: '2026-11-08', accountId: 'chk' });
  s.moves.push({ id: 'm1', kind: 'payday', from: null, to: 'chk', amount: 200000, date: '2026-11-14' });
  s.moves.push({ id: 'm2', kind: 'bill', from: 'chk', to: null, amount: 150000, date: '2026-11-15' });
  s.moves.push({ id: 'm3', kind: 'transfer', from: 'chk', to: 'ira', amount: 10000, date: '2026-11-16' });
  s.moves.push({ id: 'm4', kind: 'update', from: null, to: 'ira', amount: 25000, date: '2026-11-20' }); // market gain
  const bal = accountBalances(s);
  assert.equal(bal.get('chk'), 100000 + 20000 - 5000 - 10000 - 15000 + 200000 - 150000 - 10000);
  assert.equal(bal.get('sav'), 510000);
  assert.equal(bal.get('ira'), 1035000);
  const t = totalsByType(s, '2026-11-09');
  assert.equal(t.invest, 0); // IRA not added yet
  assert.equal(t.cash, 100000 + 20000 - 5000 - 10000 - 15000);
  const h = balanceHistory(s, '2026-11-21');
  assert.equal(h.dates[0], '2026-11-01');
  assert.equal(h.dates.at(-1), '2026-11-21');
  assert.equal(h.total.at(-1), bal.get('chk') + bal.get('sav') + bal.get('ira'));
  assert.equal(accountActivity(s, 'chk')[0].label, 'Moved money');
  // normalize keeps valid links and drops broken ones
  const n = normalizeState(JSON.parse(JSON.stringify({ ...s, app: 'coin-quest', version: 5, moves: [...s.moves, { id: 'x', kind: 'transfer', from: 'nope', to: null, amount: 5, date: '2026-11-01' }] })));
  assert.equal(n.moves.length, 4);
  assert.equal(n.expenses.find((e) => e.id === 's').toAccountId, 'sav');
  assert.equal(accountBalances(n).get('chk'), bal.get('chk'));
});

test('money timeline: actual months then a projection that follows the budget and scheduled payments', async () => {
  const { moneyTimeline } = await import('../js/projection.js');
  const s = emptyState();
  s.settings.startMonth = '2026-11';
  s.accounts.push({ id: 'chk', name: 'Checking', type: 'cash', start: 300000, createdAt: '2026-11-01' });
  s.accounts.push({ id: 'sav', name: 'Savings', type: 'savings', start: 100000, createdAt: '2026-11-01' });
  s.incomeSources.push({ id: 'i', name: 'Job', amount: 400000, freq: 'monthly' });
  s.bills.push({ id: 'b', name: 'Rent', amount: 200000, freq: 'monthly' });
  s.categories.push({ id: 'g', name: 'Groceries', kind: 'need', limit: 50000, target: null });
  s.categories.push({ id: 'e', name: 'Emergency', kind: 'savings', limit: 20000, target: null });
  s.debts.push({ id: 'd', name: 'Card', type: 'credit', startBalance: 120000, apr: 0, minPayment: 50000, dueDay: 1, include: true, autoInterest: true, createdAt: '2026-11-01', accruedThrough: '2026-11-01' });
  s.scheduled.push({ id: 'bf', name: 'Black Friday', amount: 30000, date: '2026-11-27', categoryId: 'other', accountId: 'chk' });
  s.scheduled.push({ id: 'old', name: 'Past', amount: 99999, date: '2026-11-02', categoryId: 'other', accountId: 'chk' });
  const t = moneyTimeline(s, '2026-11-21', { ahead: 4 });
  assert.deepEqual(t.months, ['2026-11', '2026-12', '2027-01', '2027-02', '2027-03']);
  assert.equal(t.splitAt, 0);
  assert.equal(t.cash[0], 300000);
  // Dec: +4000 -2000 rent -500 card -500 groceries -200 savings -300 Black Friday (later in Nov)
  assert.equal(t.cash[1], 300000 + 400000 - 200000 - 50000 - 50000 - 20000 - 30000);
  assert.equal(t.savings[1], 120000);
  assert.equal(t.debts[0], 120000);
  assert.equal(t.debts[1], 70000);
  assert.equal(t.debts[3], 0); // $1,200 at $500/mo: paid off in month 3
  // Month 3 pays only the last $200, month 4 pays nothing; cash grows faster
  assert.equal(t.cash[3] - t.cash[2], 400000 - 200000 - 20000 - 50000 - 20000);
  assert.equal(t.cash[4] - t.cash[3], 400000 - 200000 - 50000 - 20000);
  assert.equal(t.spending[1], 200000 + 50000 + 50000 + 30000);
  assert.equal(t.income[2], 400000);
  // Projections off: only actual months
  assert.equal(moneyTimeline(s, '2026-11-21', { projections: false }).months.length, 1);
});

test('planned debt payments: only the amount above the minimum is extra; monthly ones repeat', async () => {
  const { moneyTimeline, occurrences } = await import('../js/projection.js');
  assert.deepEqual(occurrences({ date: '2026-11-30', repeat: 'monthly', day: 31 }, '2026-11-21', '2027-02'), ['2026-11-30', '2027-01-31', '2027-02-28'].slice(0, 1).concat(['2026-12-31', '2027-01-31', '2027-02-28']));
  assert.deepEqual(occurrences({ date: '2026-12-05', repeat: 'none' }, '2026-11-21', '2027-06'), ['2026-12-05']);
  const s = emptyState();
  s.settings.startMonth = '2026-11';
  s.accounts.push({ id: 'chk', name: 'Checking', type: 'cash', start: 500000, createdAt: '2026-11-01' });
  s.debts.push({ id: 'd', name: 'Card', type: 'credit', startBalance: 200000, apr: 0, minPayment: 10000, dueDay: 5, include: true, autoInterest: true, createdAt: '2026-11-01', accruedThrough: '2026-11-01' });
  const base = moneyTimeline(s, '2026-11-21', { ahead: 3 });
  // A monthly payment at exactly the minimum changes nothing (the plan already pays it)
  s.scheduled.push({ id: 'm', kind: 'debt', name: 'Card', amount: 10000, date: '2026-12-05', debtId: 'd', accountId: 'chk', repeat: 'monthly', day: 5, categoryId: 'other' });
  assert.deepEqual(moneyTimeline(s, '2026-11-21', { ahead: 3 }).debts, base.debts);
  // A one-off $500 payment in December pays $400 extra
  s.scheduled.push({ id: 'x', kind: 'debt', name: 'Card', amount: 50000, date: '2026-12-15', debtId: 'd', accountId: 'chk', repeat: 'none', day: null, categoryId: 'other' });
  const t2 = moneyTimeline(s, '2026-11-21', { ahead: 3 });
  assert.equal(base.debts[1] - t2.debts[1], 40000);
  assert.equal(base.cash[1] - t2.cash[1], 40000);
  assert.equal(base.debts[3] - t2.debts[3], 40000);
  // normalize keeps debt payments with a valid debt only
  const n = normalizeState(JSON.parse(JSON.stringify({ ...s, app: 'coin-quest', version: 5, scheduled: [...s.scheduled, { id: 'bad', kind: 'debt', amount: 5, date: '2026-12-01', debtId: 'gone' }] })));
  assert.equal(n.scheduled.length, 2);
  assert.equal(n.scheduled[0].repeat, 'monthly');
});

test('credit cards: daily interest, and none when the previous balance is paid in full (grace period)', async () => {
  const { pendingInterest } = await import('../js/debts.js');
  const card = { id: 'c', type: 'credit', startBalance: 100000, apr: 36.5, dueDay: 15, autoInterest: true, createdAt: '2026-01-15', accruedThrough: '2026-01-15' };
  // Carrying $1,000 all of Jan 15 -> Feb 15 (31 days) at 36.5%: 0.1% a day = $1/day -> $31
  const carried = pendingInterest(card, [], '2026-02-15', id);
  assert.deepEqual(carried.entries.map((e) => e.amount), [3100]);
  // Paid $1,000 in full on Feb 1: no interest for that cycle
  const paid = pendingInterest(card, [{ debtId: 'c', kind: 'payment', amount: -100000, date: '2026-02-01' }], '2026-02-15', id);
  assert.equal(paid.entries.length, 0);
  // Paid $500 on Jan 31: Jan 16-30 at $1/day (15 days), Jan 31-Feb 15 at $0.50/day (16 days) = $23
  const half = pendingInterest(card, [{ debtId: 'c', kind: 'payment', amount: -50000, date: '2026-01-31' }], '2026-02-15', id);
  assert.deepEqual(half.entries.map((e) => e.amount), [2300]);
});

test('promo rates switch to the after-promo rate on the end date', async () => {
  const { pendingInterest, aprOn, simDebt } = await import('../js/debts.js');
  const d = { id: 'p', type: 'personal', startBalance: 120000, apr: 0, aprAfter: 24, promoEnds: '2026-03-01', dueDay: 15, autoInterest: true, createdAt: '2026-01-01', accruedThrough: '2026-01-01' };
  assert.equal(aprOn(d, '2026-02-28'), 0);
  assert.equal(aprOn(d, '2026-03-01'), 24);
  const r = pendingInterest(d, [], '2026-04-15', id);
  assert.deepEqual(r.entries.map((e) => [e.date, e.amount]), [['2026-03-15', 2400], ['2026-04-15', 2448]]);
  const sd = simDebt(d, 120000, '2026-01-10');
  assert.equal(sd.promoMonths, 2);
  assert.equal(simDebt(d, 120000, '2026-05-01').apr, 24);
  // Simulation: 0% for months 1, then 24%
  const { simulatePayoff } = await import('../js/planner.js');
  const sim = simulatePayoff([{ ...sd, minPayment: 10000 }], 0);
  assert.equal(sim.timeline[1], 110000); // month 1: no interest
  assert.equal(sim.timeline[2], 110000 + 2200 - 10000); // month 2: 2% of 110,000
});

test('student loan pause: interest accrues without compounding, then capitalizes', async () => {
  const { pendingInterest, balanceOf } = await import('../js/debts.js');
  const loan = { id: 's', type: 'student', startBalance: 1200000, apr: 12, dueDay: 1, autoInterest: true, createdAt: '2026-01-01', accruedThrough: '2026-01-01', pauseUntil: '2026-03-31', pauseAccrues: true, capitalize: true, minPayment: 20000 };
  const r = pendingInterest(loan, [], '2026-05-01', id);
  // Feb, Mar paused: 1% of principal each ($120), as "accrued". Apr: capitalized -> interest on 12,240
  assert.deepEqual(r.entries.map((e) => [e.date, e.kind, e.amount]), [['2026-02-01', 'accrued', 12000], ['2026-03-01', 'accrued', 12000], ['2026-04-01', 'interest', 12240], ['2026-05-01', 'interest', 12362]]);
  // Not capitalized: interest stays on principal only
  const r2 = pendingInterest({ ...loan, capitalize: false }, [], '2026-04-01', id);
  assert.equal(r2.entries.at(-1).amount, 12000);
  // Subsidized: nothing accrues while paused
  assert.deepEqual(pendingInterest({ ...loan, pauseAccrues: false }, [], '2026-04-01', id).entries.map((e) => e.amount), [12000]);
  assert.equal(balanceOf(loan, r.entries), 1200000 + 12000 + 12000 + 12240 + 12362);
  // Simulation: no payments while paused, then capitalized
  const { simulatePayoff, projectDebt } = await import('../js/planner.js');
  const sim = simulatePayoff([{ id: 's', balance: 1200000, apr: 12, minPayment: 20000, pauseMonths: 2, pauseAccrues: true, capitalize: true }], 0);
  assert.equal(sim.payments[0], 0);
  assert.equal(sim.payments[1], 0);
  assert.equal(sim.timeline[2], 1224000);
  assert.equal(sim.timeline[3], 1224000 + 12240 - 20000);
  assert.equal(projectDebt({ id: 's', balance: 1200000, apr: 12, minPayment: 20000, pauseMonths: 2 }).timeline[3], 1224000 + 12240 - 20000);
});

test('planned extras are paid on top of the budget in their month', async () => {
  const { simulatePayoff } = await import('../js/planner.js');
  const d = [{ id: 'a', balance: 100000, apr: 0, minPayment: 10000 }];
  const base = simulatePayoff(d, 0);
  const withExtra = simulatePayoff(d, 0, 'avalanche', 600, [{ id: 'a', month: 2, amount: 30000 }]);
  assert.equal(base.months, 10);
  assert.equal(withExtra.months, 7);
  assert.equal(withExtra.payments[1], 40000);
});

test('missed payments are detected after a due date passes without the minimum', async () => {
  const { missedPayment } = await import('../js/debts.js');
  const d = { id: 'm', startBalance: 100000, minPayment: 5000, dueDay: 10, createdAt: '2026-01-01' };
  assert.deepEqual(missedPayment(d, [], '2026-03-12'), { due: '2026-03-10', paid: 0 });
  assert.equal(missedPayment(d, [{ debtId: 'm', kind: 'payment', amount: -5000, date: '2026-03-01' }], '2026-03-12'), null);
  assert.equal(missedPayment({ ...d, createdAt: '2026-03-01' }, [], '2026-03-12'), null); // too new to judge
  assert.equal(missedPayment({ ...d, pauseUntil: '2026-06-01' }, [], '2026-03-12'), null);
});

test('recurring paydays and bills post on their dates and roll forward', async () => {
  const { nextOccurrence, dueRecurring } = await import('../js/recurring.js');
  assert.equal(nextOccurrence('2026-11-21', 'weekly'), '2026-11-28');
  assert.equal(nextOccurrence('2026-11-21', 'biweekly'), '2026-12-05');
  assert.equal(nextOccurrence('2026-01-31', 'monthly', 31), '2026-02-28');
  assert.equal(nextOccurrence('2026-02-28', 'monthly', 31), '2026-03-31');
  assert.equal(nextOccurrence('2026-11-01', 'semimonthly', 1), '2026-11-16');
  assert.equal(nextOccurrence('2026-11-16', 'semimonthly', 1), '2026-12-01');
  assert.equal(nextOccurrence('2026-02-14', 'semimonthly', 14), '2026-02-28');
  assert.equal(nextOccurrence('2026-03-10', 'yearly'), '2027-03-10');
  const s = emptyState();
  s.accounts.push({ id: 'chk', name: 'Checking', type: 'cash', start: 0, createdAt: '2026-11-01' });
  s.incomeSources.push({ id: 'job', name: 'Job', amount: 100000, freq: 'biweekly', nextDate: '2026-11-06', day: 6, accountId: 'chk', variable: false });
  s.incomeSources.push({ id: 'gig', name: 'Gig', amount: 50000, freq: 'weekly', nextDate: '2026-11-02', day: 2, accountId: 'chk', variable: true });
  s.bills.push({ id: 'rent', name: 'Rent', amount: 150000, freq: 'monthly', nextDate: '2026-12-01', day: 1, accountId: 'chk' });
  const r = dueRecurring(s, '2026-11-21', id);
  assert.deepEqual(r.moves.map((m) => [m.kind, m.date, m.amount]), [['payday', '2026-11-06', 100000], ['payday', '2026-11-20', 100000]]);
  assert.deepEqual(r.nextDates, [{ list: 'incomeSources', id: 'job', nextDate: '2026-12-04' }]);
});

test('budget lines: one-month amounts, rollover, card purchases not double counted, goal deadlines, variable income', async () => {
  const { monthSummary, goalStatus, sourceMonthly, carryInto } = await import('../js/budget.js');
  const s = emptyState();
  s.settings.startMonth = '2026-09';
  s.incomeSources.push({ id: 'i', name: 'Job', amount: 400000, freq: 'monthly' });
  s.categories.push({ id: 'g', name: 'Groceries', kind: 'need', limit: 40000, overrides: { '2026-11': 60000 }, rollover: true, target: null, targetDate: null });
  s.expenses.push({ id: 'a', amount: 30000, date: '2026-09-05', categoryId: 'g' }); // $100 left in Sep
  s.expenses.push({ id: 'b', amount: 45000, date: '2026-10-05', categoryId: 'g' }); // $50 over in Oct
  assert.equal(carryInto(s, s.categories[0], '2026-11'), 10000 - 5000);
  const nov = monthSummary(s, '2026-11', 0).categories[0];
  assert.equal(nov.limit, 60000);
  assert.equal(nov.available, 65000);
  // Card purchase $200 + $500 card payment: spending counts $200 + $300, not $700
  s.debts.push({ id: 'card', name: 'Card', startBalance: 100000 });
  s.expenses.push({ id: 'c', amount: 20000, date: '2026-11-03', categoryId: 'g', debtId: 'card' });
  s.ledger.push({ id: 'p', debtId: 'card', kind: 'payment', amount: -50000, date: '2026-11-10' });
  assert.equal(monthSummary(s, '2026-11', 0).spent, 20000 + 30000);
  // Savings goal: $1,200 by May with $300 saved -> $900 over 7 months (Nov..May) = $128.58 -> rounded up to $129
  s.categories.push({ id: 'trip', name: 'Trip', kind: 'savings', limit: 10000, target: 120000, targetDate: '2027-05-01' });
  s.expenses.push({ id: 't', amount: 30000, date: '2026-10-01', categoryId: 'trip' });
  const gs = goalStatus(s, s.categories[1], '2026-11-21');
  assert.equal(gs.monthsLeft, 7);
  assert.equal(gs.needPerMonth, 12900);
  assert.equal(gs.onTrack, false);
  // Variable income: average of recorded paydays in the last 3 months, else the estimate
  const gig = { id: 'gig', name: 'Gig', amount: 50000, freq: 'monthly', variable: true };
  assert.equal(sourceMonthly(s, gig, '2026-11'), 50000);
  s.moves.push({ id: 'm1', kind: 'payday', to: 'x', amount: 30000, date: '2026-09-10', sourceId: 'gig' });
  s.moves.push({ id: 'm2', kind: 'payday', to: 'x', amount: 70000, date: '2026-10-10', sourceId: 'gig' });
  s.moves.push({ id: 'm3', kind: 'payday', to: 'x', amount: 20000, date: '2026-10-20', sourceId: 'gig' });
  assert.equal(sourceMonthly(s, gig, '2026-11'), 60000); // (300 + 900) / 2 months
});

test('v5 fields survive a save round trip and bad values are cleaned', () => {
  const s = emptyState();
  s.accounts.push({ id: 'chk', name: 'Checking', type: 'cash', start: 0, createdAt: '2026-11-01' });
  s.debts.push({ id: 'd', name: 'Card', type: 'credit', startBalance: 1000, apr: 0, aprAfter: 29.99, promoEnds: '2027-03-01', minPayment: 100, dueDay: 5, include: true, autoInterest: true, createdAt: '2026-11-01', accruedThrough: '2026-11-01', killRewarded: false, pauseUntil: null, pauseAccrues: true, capitalize: true, bossPhases: [75] });
  s.categories.push({ id: 'g', name: 'Groceries', kind: 'need', limit: 100, target: null, targetDate: null, rollover: true, overrides: { '2026-12': 200 } });
  s.incomeSources.push({ id: 'i', name: 'Job', amount: 1000, freq: 'biweekly', nextDate: '2026-11-27', day: 27, accountId: 'chk', variable: false });
  s.expenses.push({ id: 'e', amount: 50, date: '2026-11-02', categoryId: 'g', note: '', accountId: null, toAccountId: null, debtId: 'd' });
  s.ledger.push({ id: 'l', debtId: 'd', kind: 'charge', amount: 50, date: '2026-11-02', note: '', auto: false, accountId: null, expenseId: 'e' });
  s.player.achievements = { 'first-hit': '2026-11-02' };
  const n = normalizeState(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(n, s);
  const bad = normalizeState({ ...JSON.parse(JSON.stringify(s)), debts: [{ ...s.debts[0], aprAfter: -1, promoEnds: 'soon', bossPhases: [10] }], categories: [{ ...s.categories[0], overrides: { nope: 5, '2026-12': -1 } }] });
  assert.equal(bad.debts[0].aprAfter, null);
  assert.equal(bad.debts[0].promoEnds, null);
  assert.deepEqual(bad.debts[0].bossPhases, []);
  assert.deepEqual(bad.categories[0].overrides, {});
});

test('game: achievements, weekly quests, boss phases, skins', async () => {
  const g = await import('../js/game.js');
  const s = emptyState();
  assert.deepEqual(g.newAchievements(s, '2026-11-21').map((a) => a.id), []);
  s.debts.push({ id: 'd', name: 'Card', startBalance: 150000, minPayment: 5000 });
  s.ledger.push({ id: 'p', debtId: 'd', kind: 'payment', amount: -150000, date: '2026-11-20' });
  const ids = g.newAchievements(s, '2026-11-21').map((a) => a.id);
  assert.deepEqual(ids, ['first-debt', 'first-hit', 'dmg-1k', 'first-kill']);
  s.player.achievements['first-debt'] = '2026-11-21';
  assert.ok(!g.newAchievements(s, '2026-11-21').some((a) => a.id === 'first-debt'));
  // Weeks start on Monday; quests are stable within a week
  assert.equal(g.weekStart('2026-11-21'), '2026-11-16'); // a Saturday
  assert.equal(g.weekStart('2026-11-16'), '2026-11-16');
  assert.deepEqual(g.weeklyQuests('2026-11-16'), g.weeklyQuests('2026-11-16'));
  assert.equal(new Set(g.weeklyQuests('2026-11-16')).size, 3);
  const qs = g.questStatus(s, '2026-11-21');
  assert.equal(qs.length, 3);
  // Boss phases
  assert.deepEqual(g.bossPhasesCrossed(100000, 80000, 40000), [75, 50]);
  assert.deepEqual(g.bossPhasesCrossed(100000, 80000, 40000, [75]), [50]);
  assert.deepEqual(g.bossPhasesCrossed(100000, 20000, 10000), []);
  // Skins by level
  assert.deepEqual(g.unlockedSkins(0), ['adventurer']);
  assert.ok(g.unlockedSkins(100000).includes('champion'));
});

test('monster type comes from the peak balance; paying down only adds damage', async () => {
  const { peakBalance, speciesFor } = await import('../js/debts.js');
  const { damageLevel } = await import('../js/models.js');
  const d = { id: 'p', startBalance: 1500000, type: 'student' };
  const ledger = [
    { debtId: 'p', kind: 'interest', amount: 100000, date: '2026-02-01' }, // up to $16,000
    { debtId: 'p', kind: 'payment', amount: -1500000, date: '2026-03-01' }, // down to $1,000
  ];
  assert.equal(peakBalance(d, ledger), 1600000);
  assert.equal(speciesFor(d, peakBalance(d, ledger)).key, 'drake'); // still a dragon at $1,000 left
  assert.equal(damageLevel(100000, 1600000), 1); // 94% paid: the most damaged look
  assert.equal(damageLevel(1600000, 1600000), 0);
  assert.equal(damageLevel(800000, 1600000), 0.5);
  // a same-day charge and payment still counts the charge toward the peak
  assert.equal(peakBalance({ id: 'q', startBalance: 1000 }, [{ debtId: 'q', amount: 500, date: '2026-01-01' }, { debtId: 'q', amount: -1400, date: '2026-01-01' }]), 1500);
});

import { attackTier, createAttack } from '../js/battlefx.js';

test('attack tier follows the share of full HP taken off', () => {
  const peak = 100000;
  assert.equal(attackTier(1000, peak, 50000).key, 'slash'); // 1%
  assert.equal(attackTier(5000, peak, 50000).key, 'cross'); // 5%
  assert.equal(attackTier(12000, peak, 50000).key, 'heavy'); // 12%
  assert.equal(attackTier(30000, peak, 50000).key, 'critical'); // 30%
  assert.equal(attackTier(50000, peak, 90000).key, 'legendary'); // 50%
  assert.equal(attackTier(50000, peak, 50000).kill, true);
  assert.equal(attackTier(49999, peak, 50000).kill, false);
  assert.equal(attackTier(0, 0, 0).key, 'slash');
});

test('every attack runs to the end, hits once as the main blow, and a kill says defeated', () => {
  for (let tier = 0; tier < 5; tier++) for (const kill of [false, true]) {
    const A = createAttack({ tier, kill, type: tier % 2 ? 'castle' : 'slime', box: { x0: 40, y0: 60, x1: 80, y1: 130 }, palette: ['#3f9a52'], points: [[60, 90]], W: 120, H: 168, groundY: 129, seed: 7 });
    const seen = [];
    for (let i = 0; i < 2000 && !A.done; i++) seen.push(...A.step(1 / 60).map((c) => c.cue));
    assert.ok(A.done, `tier ${tier} finished`);
    assert.equal(seen.filter((c) => c === 'hit').length, 1);
    assert.equal(seen.includes('defeated'), kill);
    assert.ok(seen.includes('banner'));
  }
});
