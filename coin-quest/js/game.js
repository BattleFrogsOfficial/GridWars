// Game layer: achievements, weekly quests, boss phases and hero skins. Pure functions.
// Rewards only good habits: logging, paying, saving, planning. Never spending.

import { addDays, addMonths, ymOf } from './dates.js';
import { balancesById } from './debts.js';
import { monthlyPlan, goalStatus, monthSummary } from './budget.js';
import { totalsByType } from './accounts.js';
import { levelInfo, streak } from './player.js';

const sumOf = (arr, f) => arr.reduce((s, x) => s + f(x), 0);

/** Facts about the save that achievements and quests are judged on. */
export function gameFacts(state, today) {
  const bal = balancesById(state.debts, state.ledger);
  const payments = state.ledger.filter((e) => e.kind === 'payment');
  const alive = state.debts.filter((d) => bal.get(d.id) > 0);
  const defeated = state.debts.filter((d) => bal.get(d.id) <= 0);
  const mins = sumOf(alive, (d) => d.minPayment);
  const lastMonth = addMonths(ymOf(today), -1);
  const lm = state.settings.startMonth && lastMonth >= state.settings.startMonth ? monthSummary(state, lastMonth, mins) : null;
  return {
    debts: state.debts.length,
    defeated: defeated.length,
    bigDefeated: defeated.some((d) => d.startBalance >= 1_000_000),
    paidTotal: -sumOf(payments, (e) => e.amount),
    payments: payments.length,
    streak: streak(state.player.days, today),
    fullyAssigned: state.incomeSources.length > 0 && monthlyPlan(state, mins, ymOf(today)).unallocated === 0,
    savings: totalsByType(state).savings,
    goalReached: state.categories.some((c) => goalStatus(state, c, today)?.done),
    underBudgetLastMonth: !!lm && lm.categories.length > 0 && lm.categories.every((c) => !c.over) && !lm.other.over,
    planned: state.scheduled.length > 0 || Object.keys(state.player.achievements).includes('planner'),
    questsDone: sumOf(Object.values(state.player.quests), (q) => q.length),
  };
}

export const ACHIEVEMENTS = [
  { id: 'first-debt', title: 'Monster Hunter', desc: 'Add your first debt', test: (f) => f.debts >= 1 },
  { id: 'first-hit', title: 'First Blood', desc: 'Make your first debt payment', test: (f) => f.payments >= 1 },
  { id: 'dmg-1k', title: 'Heavy Hitter', desc: 'Pay $1,000 toward debts', test: (f) => f.paidTotal >= 100_000 },
  { id: 'dmg-10k', title: 'Warlord', desc: 'Pay $10,000 toward debts', test: (f) => f.paidTotal >= 1_000_000 },
  { id: 'dmg-50k', title: 'Legend', desc: 'Pay $50,000 toward debts', test: (f) => f.paidTotal >= 5_000_000 },
  { id: 'first-kill', title: 'Slayer', desc: 'Pay off a debt', test: (f) => f.defeated >= 1 },
  { id: 'kill-3', title: 'Monster Bane', desc: 'Pay off 3 debts', test: (f) => f.defeated >= 3 },
  { id: 'boss-down', title: 'Dragonslayer', desc: 'Pay off a debt of $10,000 or more', test: (f) => f.bigDefeated },
  { id: 'streak-7', title: 'Dedicated', desc: 'Log something 7 days in a row', test: (f) => f.streak >= 7 },
  { id: 'streak-30', title: 'Unstoppable', desc: 'Log something 30 days in a row', test: (f) => f.streak >= 30 },
  { id: 'budget-full', title: 'Every Coin a Job', desc: 'Assign all of your monthly left over', test: (f) => f.fullyAssigned },
  { id: 'under-budget', title: 'Disciplined', desc: 'Finish a month with every budget line on target', test: (f) => f.underBudgetLastMonth },
  { id: 'saver-1k', title: 'Treasure Keeper', desc: 'Have $1,000 in savings', test: (f) => f.savings >= 100_000 },
  { id: 'goal-reached', title: 'Goal Getter', desc: 'Reach a savings goal', test: (f) => f.goalReached },
  { id: 'planner', title: 'Strategist', desc: 'Plan a payment ahead of time', test: (f) => f.planned },
  { id: 'quest-1', title: 'Adventurer', desc: 'Complete a weekly quest', test: (f) => f.questsDone >= 1 },
  { id: 'quest-10', title: 'Questmaster', desc: 'Complete 10 weekly quests', test: (f) => f.questsDone >= 10 },
];
export const ACHIEVEMENT_XP = 50;

/** Achievements earned but not yet recorded. */
export function newAchievements(state, today) {
  const f = gameFacts(state, today);
  return ACHIEVEMENTS.filter((a) => !state.player.achievements[a.id] && a.test(f));
}

// ---------- weekly quests ----------

/** Monday of the week containing `date`. */
export function weekStart(date) {
  const [y, m, d] = date.split('-').map(Number);
  const dow = (new Date(y, m - 1, d).getDay() + 6) % 7; // Monday = 0
  return addDays(date, -dow);
}

const inWeek = (date, ws) => date >= ws && date <= addDays(ws, 6);

export const QUESTS = {
  log5: { title: 'Log something on 5 different days', goal: 5, value: (s, ws) => s.player.days.filter((d) => inWeek(d, ws)).length },
  pay: { title: 'Make a debt payment', goal: 1, value: (s, ws) => s.ledger.filter((e) => e.kind === 'payment' && inWeek(e.date, ws)).length },
  extra: {
    title: 'Pay more than a minimum on any debt',
    goal: 1,
    value: (s, ws) => s.ledger.filter((e) => e.kind === 'payment' && inWeek(e.date, ws) && -e.amount > (s.debts.find((d) => d.id === e.debtId)?.minPayment || 0)).length,
  },
  save: {
    title: 'Put money into savings',
    goal: 1,
    value: (s, ws) => {
      const savingsLines = new Set(s.categories.filter((c) => c.kind === 'savings').map((c) => c.id));
      const savingsAccts = new Set(s.accounts.filter((a) => a.type !== 'cash').map((a) => a.id));
      return s.expenses.filter((e) => inWeek(e.date, ws) && savingsLines.has(e.categoryId)).length
        + s.moves.filter((m) => m.kind === 'transfer' && inWeek(m.date, ws) && savingsAccts.has(m.to)).length;
    },
  },
  check: {
    title: 'Check a balance against your bank',
    goal: 1,
    value: (s, ws) => s.moves.filter((m) => m.kind === 'update' && inWeek(m.date, ws)).length
      + s.ledger.filter((e) => e.kind === 'correction' && inWeek(e.date, ws)).length,
  },
  clean: {
    title: 'No unplanned spending all week',
    goal: 1,
    // Judged once the week is over (on Sunday or later).
    value: (s, ws, today) => (today >= addDays(ws, 6) && !s.expenses.some((e) => e.categoryId === 'other' && inWeek(e.date, ws)) ? 1 : 0),
  },
};
export const QUEST_XP = 75;

/** Three quests for the week, the same for everyone in a given week. */
export function weeklyQuests(ws) {
  const keys = Object.keys(QUESTS);
  let h = 0;
  for (const ch of ws) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const picked = [];
  while (picked.length < 3) {
    const k = keys[h % keys.length];
    if (!picked.includes(k)) picked.push(k);
    h = (h * 1103515245 + 12345) >>> 0;
  }
  return picked;
}

export function questStatus(state, today) {
  const ws = weekStart(today);
  const claimed = state.player.quests[ws] || [];
  return weeklyQuests(ws).map((id) => {
    const q = QUESTS[id];
    const value = Math.min(q.goal, q.value(state, ws, today));
    return { id, title: q.title, value, goal: q.goal, done: value >= q.goal, claimed: claimed.includes(id) };
  });
}

// ---------- boss ----------

export const BOSS_PHASES = [75, 50, 25];
export const BOSS_PHASE_XP = 100;

/** Boss phases (HP % marks) passed by a payment that took the balance from `before` to `after`. */
export function bossPhasesCrossed(maxHp, before, after, already = []) {
  return BOSS_PHASES.filter((p) => !already.includes(p) && (before / maxHp) * 100 > p && (after / maxHp) * 100 <= p);
}

// ---------- hero skins and titles ----------

export const SKINS = [
  { id: 'adventurer', name: 'Adventurer', level: 1 },
  { id: 'knight', name: 'Knight', level: 3 },
  { id: 'ranger', name: 'Ranger', level: 5 },
  { id: 'mage', name: 'Mage', level: 8 },
  { id: 'champion', name: 'Golden Champion', level: 12 },
];

export function unlockedSkins(xp) {
  const lv = levelInfo(xp).level;
  return SKINS.filter((s) => lv >= s.level).map((s) => s.id);
}

/** Titles come from achievements earned. */
export function unlockedTitles(state) {
  return ACHIEVEMENTS.filter((a) => state.player.achievements[a.id]).map((a) => a.title);
}
