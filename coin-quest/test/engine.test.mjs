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
    version: 4,
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
  assert.deepEqual(s.incomeSources, [{ id: 'i', name: 'Job', amount: 1000, freq: 'monthly' }]);
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
  assert.equal(v1.version, 4);
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
  const n = normalizeState(JSON.parse(JSON.stringify({ ...s, app: 'coin-quest', version: 4, moves: [...s.moves, { id: 'x', kind: 'transfer', from: 'nope', to: null, amount: 5, date: '2026-11-01' }] })));
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
  const n = normalizeState(JSON.parse(JSON.stringify({ ...s, app: 'coin-quest', version: 4, scheduled: [...s.scheduled, { id: 'bad', kind: 'debt', amount: 5, date: '2026-12-01', debtId: 'gone' }] })));
  assert.equal(n.scheduled.length, 2);
  assert.equal(n.scheduled[0].repeat, 'monthly');
});
