// The whole save file: shape, defaults, validation and migration. Pure functions.
// normalizeState() is used both when loading from storage and when importing a backup,
// so a damaged or hand-edited file can never put bad values into the app.

import { CATEGORY_KINDS, FREQUENCIES, OTHER_CATEGORY_ID } from './budget.js';
import { DEBT_TYPES, ENTRY_KINDS } from './debts.js';
import { ACCOUNT_TYPES, MOVE_KINDS } from './accounts.js';
import { isValidISO, todayISO } from './dates.js';

export const SCHEMA_VERSION = 3;
export const APP_ID = 'coin-quest';

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function emptyState() {
  return {
    app: APP_ID,
    version: SCHEMA_VERSION,
    createdAt: todayISO(),
    settings: { currency: 'USD', strategy: 'avalanche', extraCents: null, lastBackup: null, setupDone: false, startMonth: null },
    goals: { payDebt: false, emergency: false, saveFor: false, fun: false, spendLess: false },
    player: { xp: 0, days: [] },
    incomeSources: [], // recurring income: { id, name, amount, freq }
    bills: [], // recurring fixed costs that never get paid off: { id, name, amount, freq }
    debts: [],
    ledger: [],
    categories: [], // allocations of what's left over: { id, name, kind, limit, target? }
    incomes: [], // one-off extra income
    expenses: [],
    accounts: [], // money you have: { id, name, type: cash|savings|invest, start, createdAt }
    moves: [], // money moving between accounts: { id, kind, from, to, amount, date, note }
  };
}

const isInt = (n) => Number.isInteger(n);
const str = (s, max = 80) => (typeof s === 'string' ? s.slice(0, max) : '');
const arr = (a) => (Array.isArray(a) ? a : []);

function normDebt(d) {
  if (!d || typeof d.id !== 'string' || !isInt(d.startBalance)) return null;
  return {
    id: d.id,
    name: str(d.name) || 'Unnamed debt',
    type: DEBT_TYPES.some((t) => t.key === d.type) ? d.type : 'other',
    startBalance: d.startBalance,
    apr: Number.isFinite(d.apr) && d.apr >= 0 ? d.apr : 0,
    minPayment: isInt(d.minPayment) && d.minPayment >= 0 ? d.minPayment : 0,
    dueDay: isInt(d.dueDay) && d.dueDay >= 1 && d.dueDay <= 31 ? d.dueDay : 1,
    include: d.include !== false,
    autoInterest: d.autoInterest !== false,
    createdAt: isValidISO(d.createdAt) ? d.createdAt : todayISO(),
    accruedThrough: isValidISO(d.accruedThrough) ? d.accruedThrough : isValidISO(d.createdAt) ? d.createdAt : todayISO(),
    killRewarded: d.killRewarded === true,
  };
}

function normAccount(a) {
  if (!a || typeof a.id !== 'string' || !isInt(a.start)) return null;
  return {
    id: a.id,
    name: str(a.name, 40) || 'Account',
    type: a.type in ACCOUNT_TYPES ? a.type : 'cash',
    start: a.start,
    createdAt: isValidISO(a.createdAt) ? a.createdAt : todayISO(),
  };
}

function normMove(m, acctIds) {
  if (!m || typeof m.id !== 'string' || !(m.kind in MOVE_KINDS) || !isInt(m.amount) || !isValidISO(m.date)) return null;
  const from = acctIds.has(m.from) ? m.from : null;
  const to = acctIds.has(m.to) ? m.to : null;
  if (m.kind === 'update' ? !to : !(from || to) || m.amount <= 0) return null;
  return { id: m.id, kind: m.kind, from: m.kind === 'update' ? null : from, to, amount: m.amount, date: m.date, note: str(m.note, 80) };
}

function normEntry(e, debtIds) {
  if (!e || typeof e.id !== 'string' || !debtIds.has(e.debtId) || !isInt(e.amount) || !isValidISO(e.date)) return null;
  if (!(e.kind in ENTRY_KINDS)) return null;
  return { id: e.id, debtId: e.debtId, kind: e.kind, amount: e.amount, date: e.date, note: str(e.note, 140), auto: e.auto === true, accountId: typeof e.accountId === 'string' ? e.accountId : null };
}

function normCategory(c) {
  if (!c || typeof c.id !== 'string') return null;
  return {
    id: c.id,
    name: str(c.name, 40) || 'Category',
    kind: c.kind in CATEGORY_KINDS ? c.kind : 'need',
    limit: isInt(c.limit) && c.limit >= 0 ? c.limit : 0,
    target: isInt(c.target) && c.target > 0 ? c.target : null,
  };
}

function normRecurring(r) {
  if (!r || typeof r.id !== 'string' || !isInt(r.amount) || r.amount <= 0) return null;
  return { id: r.id, name: str(r.name, 40) || 'Untitled', amount: r.amount, freq: r.freq in FREQUENCIES ? r.freq : 'monthly' };
}

function normMoneyEntry(e, extra) {
  if (!e || typeof e.id !== 'string' || !isInt(e.amount) || e.amount <= 0 || !isValidISO(e.date)) return null;
  return { id: e.id, amount: e.amount, date: e.date, note: str(e.note, 140), ...extra(e) };
}

/** Accepts anything (parsed JSON) and returns a valid state, or throws if it isn't a save file at all. */
export function normalizeState(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Not a save file');
  if (raw.app !== APP_ID) throw new Error('This file is not a Coin Quest backup');
  if (!isInt(raw.version) || raw.version > SCHEMA_VERSION) throw new Error('This backup is from a newer version of the app');
  const migrated = migrate(raw);
  const base = emptyState();

  const debts = arr(migrated.debts).map(normDebt).filter(Boolean);
  const accounts = arr(migrated.accounts).map(normAccount).filter(Boolean);
  const acctIds = new Set(accounts.map((a) => a.id));
  const acct = (id) => (acctIds.has(id) ? id : null);
  const debtIds = new Set(debts.map((d) => d.id));
  const categories = arr(migrated.categories).map(normCategory).filter(Boolean);
  const catIds = new Set([...categories.map((c) => c.id), OTHER_CATEGORY_ID]);
  const g = migrated.goals || {};
  const s = migrated.settings || {};

  return {
    ...base,
    createdAt: isValidISO(migrated.createdAt) ? migrated.createdAt : base.createdAt,
    settings: {
      currency: typeof s.currency === 'string' && /^[A-Z]{3}$/.test(s.currency) ? s.currency : 'USD',
      strategy: s.strategy === 'snowball' ? 'snowball' : 'avalanche',
      extraCents: isInt(s.extraCents) && s.extraCents >= 0 ? s.extraCents : null,
      lastBackup: isValidISO(s.lastBackup) ? s.lastBackup : null,
      setupDone: s.setupDone === true,
      startMonth: typeof s.startMonth === 'string' && /^\d{4}-\d{2}$/.test(s.startMonth) ? s.startMonth : null,
    },
    goals: Object.fromEntries(Object.keys(base.goals).map((k) => [k, g[k] === true])),
    player: {
      xp: isInt(migrated.player?.xp) && migrated.player.xp >= 0 ? migrated.player.xp : 0,
      days: arr(migrated.player?.days).filter(isValidISO).slice(-400),
    },
    incomeSources: arr(migrated.incomeSources).map(normRecurring).filter(Boolean),
    bills: arr(migrated.bills).map(normRecurring).filter(Boolean),
    debts,
    ledger: arr(migrated.ledger).map((e) => normEntry(e, debtIds)).filter(Boolean).map((e) => ({ ...e, accountId: acct(e.accountId) })),
    categories,
    incomes: arr(migrated.incomes).map((e) => normMoneyEntry(e, (x) => ({ source: str(x.source, 40), accountId: acct(x.accountId) }))).filter(Boolean),
    expenses: arr(migrated.expenses)
      .map((e) => normMoneyEntry(e, (x) => ({ categoryId: x.categoryId, accountId: acct(x.accountId), toAccountId: acct(x.toAccountId) })))
      .filter((e) => e && catIds.has(e.categoryId)),
    accounts,
    moves: arr(migrated.moves).map((m) => normMove(m, acctIds)).filter(Boolean),
  };
}

// Schema changes, one step per version.
function migrate(raw) {
  const s = structuredClone(raw);
  if (s.version === 1) {
    // v2 adds recurring income/bills and goals. Old preset categories that were never used are dropped,
    // and the old "Debt attack" total (which included minimums) no longer applies, so it resets to 0.
    const used = new Set(arr(s.expenses).map((e) => e.categoryId));
    s.categories = arr(s.categories)
      .filter((c) => c && (c.limit > 0 || used.has(c.id)))
      .map((c) => (c.id === 'debt-attack' ? { ...c, name: 'Extra debt payments', limit: 0 } : c));
    s.incomeSources = [];
    s.bills = [];
    if (s.settings?.setupDone === undefined) s.settings = { ...s.settings, setupDone: arr(s.debts).length > 0 };
    s.version = 2;
  }
  if (s.version === 2) {
    // v3 adds accounts (cash, savings, invested) and moves between them. Nothing to convert.
    s.version = 3;
  }
  return s;
}
