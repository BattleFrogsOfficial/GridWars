// XP, levels and streaks. Rewards only go to good habits: logging and paying down debt.

import { addDays } from './dates.js';

export const XP = {
  log: 5, // logging income or an expense
  scout: 5, // updating a debt's real balance
  attackBase: 10, // any debt payment
  attackPer: 1000, // +1 XP per $10 paid ...
  attackCap: 50, // ... up to this much per payment
  kill: { slime: 50, goblin: 100, troll: 200, drake: 400, dragon: 800, castle: 1500 },
};

export function attackXp(amountCents) {
  return XP.attackBase + Math.min(XP.attackCap, Math.floor(amountCents / XP.attackPer));
}

/** Total XP needed to reach `level` (level 1 = 0 XP). */
export function xpForLevel(level) {
  return Math.round(100 * Math.pow(level - 1, 1.5));
}

export function levelInfo(xp) {
  let level = 1;
  while (xp >= xpForLevel(level + 1)) level++;
  const floor = xpForLevel(level);
  const next = xpForLevel(level + 1);
  return { level, xp, into: xp - floor, span: next - floor, toNext: next - xp };
}

/** Consecutive days with activity, counting back from today (or yesterday, so the streak survives until you log today). */
export function streak(days, today) {
  const set = new Set(days);
  let d = set.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (set.has(d)) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}
