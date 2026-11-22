// App shell: state, routing, the five tabs and their actions.
//   plan   – future planning, projection and statistics
//   spend  – spending tracker: expenses, debts, debt payments and charges
//   battle – the battleground (center tab, default)
//   budget – income and budgeting
//   setup  – settings and first-run setup

import { formatMoney, parseMoney, centsToInput } from './money.js';
import { todayISO, ymOf, addMonths, monthLabel, dayLabel, dueDateIn } from './dates.js';
import {
  DEBT_TYPES, ENTRY_KINDS, balancesById, speciesFor, temperFor, monthlyInterest, isRegenerating, pendingInterest,
  aprOn, isPaused, simDebt, missedPayment, peakBalance,
} from './debts.js';
import { simulatePayoff, projectDebt, STRATEGIES } from './planner.js';
import {
  monthSummary, monthlyPlan, savedSoFar, suggestSplit, toMonthly, CATEGORY_KINDS, DEBT_CATEGORY_ID, OTHER_CATEGORY_ID, FREQUENCIES,
  goalStatus, sourceMonthly,
} from './budget.js';
import { dueRecurring } from './recurring.js';
import { uid, emptyState, normalizeState } from './state.js';
import { loadState, saveState, requestPersistence, downloadBackup, readBackup, hadLoadProblem } from './storage.js';
import { drawSprite } from './sprites.js';
import { MODELS, renderModel, renderPortrait, damageLevel } from './models.js';
import { esc, toast, holdToasts, openSheet, openForm, askConfirm } from './ui.js';
import { battleMarkup, mountBattle, playAttack, battleKey, attackPower, drawDiorama, victoryMarkup, mountVictory } from './battle.js';
import { lineChart, attachCharts, SERIES_COLORS } from './chart.js';
import { ACCOUNT_TYPES, accountEvents, accountBalances, totalsByType, accountActivity } from './accounts.js';
import { moneyTimeline } from './projection.js';
import { randomHex, hashPin, biometricAvailable, registerBiometric, verifyBiometric, encodeTransfer, decodeTransfer } from './lock.js';

let state = emptyState();
const ui = { month: ymOf(todayISO()), persisted: null, installPrompt: null };

const view = document.getElementById('view');
const fmt = (c, o) => formatMoney(c, state.settings.currency, o);
const typeLabel = (k) => DEBT_TYPES.find((t) => t.key === k)?.label || 'Debt';
const TAB_ORDER = ['plan', 'spend', 'battle', 'budget', 'setup'];

// ---------- state changes ----------

function save() {
  saveState(state).catch(() => toast('Could not save on this device!', 'bad'));
}

function commit(fn) {
  fn(state);
  save();
  render();
}

// Undo: risky changes keep a copy of the state from just before them for a few seconds.
let undoSnapshot = null;
let undoTimer = null;
function commitUndoable(label, fn) {
  const before = structuredClone(state);
  commit(fn);
  undoSnapshot = before;
  showUndo(label);
}

function showUndo(label) {
  let bar = document.getElementById('undo-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'undo-bar';
    bar.setAttribute('role', 'status');
    document.body.appendChild(bar);
    bar.addEventListener('click', (e) => {
      if (!e.target.closest('[data-undo]') || !undoSnapshot) return;
      state = undoSnapshot;
      undoSnapshot = null;
      bar.classList.remove('show');
      save();
      render();
      toast('Undone.');
    });
  }
  bar.innerHTML = `<span>${esc(label)}</span><button class="btn" data-undo>Undo</button>`;
  bar.classList.add('show');
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => {
    bar.classList.remove('show');
    undoSnapshot = null;
  }, 7000);
}

function markActive() {
  const t = todayISO();
  if (!state.player.days.includes(t)) state.player.days.push(t);
  if (state.player.days.length > 400) state.player.days = state.player.days.slice(-400);
}


/** Add any interest that came due while the app was closed. */
function runAccrual() {
  const today = todayISO();
  let total = 0;
  for (const d of state.debts) {
    const r = pendingInterest(d, state.ledger, today, uid);
    if (r.entries.length) {
      state.ledger.push(...r.entries);
      total += r.entries.reduce((s, e) => s + e.amount, 0);
    }
    d.accruedThrough = r.accruedThrough;
  }
  if (total > 0) {
    save();
    setTimeout(() => toast(`Your monsters regenerated ${fmt(total)} in interest.`, 'bad'), 400);
  }
}

/** Post paydays and bills whose dates have arrived. */
function runRecurring() {
  const r = dueRecurring(state, todayISO(), uid);
  if (!r.moves.length) return;
  state.moves.push(...r.moves);
  for (const n of r.nextDates) {
    const item = state[n.list].find((x) => x.id === n.id);
    if (item) item.nextDate = n.nextDate;
  }
  save();
  const pay = r.moves.filter((m) => m.kind === 'payday').length;
  const bills = r.moves.length - pay;
  setTimeout(() => toast(`Posted ${[pay && `${pay} payday${pay > 1 ? 's' : ''}`, bills && `${bills} bill${bills > 1 ? 's' : ''}`].filter(Boolean).join(' and ')}.`), 900);
}

// ---------- derived data ----------

function monsters() {
  const today = todayISO();
  const bal = balancesById(state.debts, state.ledger);
  const list = state.debts.map((d) => {
    const balance = bal.get(d.id);
    const rate = aprOn(d, today); // the rate charged today (after a promo ends, the after-promo rate)
    // The type comes from the highest the debt has ever been; paying it down only damages it.
    const peak = Math.max(peakBalance(d, state.ledger), balance, 1);
    const species = speciesFor(d, peak);
    const temper = temperFor(rate);
    const maxHp = peak;
    const paused = isPaused(d, today);
    return {
      ...d,
      rate,
      balance,
      species,
      temper,
      maxHp,
      paused,
      promo: d.promoEnds && today < d.promoEnds ? { ends: d.promoEnds, after: d.aprAfter ?? d.apr } : null,
      monthly: monthlyInterest(balance, rate),
      regen: d.autoInterest && !paused && isRegenerating({ ...d, apr: rate }, balance),
      missed: balance > 0 ? missedPayment(d, state.ledger, today) : null,
      hpPct: Math.max(0, Math.min(100, (balance / maxHp) * 100)),
      alive: balance > 0,
      dmg: balance > 0 ? damageLevel(balance, peak) : 1, // 0, .25, .5, .75 or 1
      boss: false,
    };
  });
  // The boss is the biggest debt still being fought.
  const boss = list.filter((m) => m.alive && m.include).sort((a, b) => b.balance - a.balance)[0];
  if (boss && list.filter((m) => m.alive && m.include).length > 1) boss.boss = true;
  return list;
}

/** Planned debt payments as one-off extras for the payoff simulation (only what's above each minimum). */
function plannedExtras(active) {
  const today = todayISO();
  const now = ymOf(today);
  const out = [];
  for (const x of state.scheduled) {
    if (x.kind !== 'debt') continue;
    const d = active.find((m) => m.id === x.debtId);
    if (!d || x.amount <= d.minPayment) continue;
    let date = x.date;
    for (let i = 0; i < 360; i++) {
      if (date > today) {
        const [a, b] = now.split('-').map(Number);
        const [c, e] = ymOf(date).split('-').map(Number);
        out.push({ id: d.id, month: Math.max(1, c * 12 + e - (a * 12 + b)), amount: x.amount - d.minPayment });
      }
      if (x.repeat !== 'monthly') break;
      date = dueDateIn(addMonths(ymOf(date), 1), x.day || Number(date.slice(8)));
    }
  }
  return out;
}

/** Every debt still owed costs its minimum each month, benched ones (like a mortgage) included. */
function debtMinsTotal() {
  return monsters().filter((m) => m.alive).reduce((s, m) => s + m.minPayment, 0);
}

const summary = (ym) => monthSummary(state, ym, debtMinsTotal());

/** The budget's "Extra debt payments" line is the extra paid on top of minimums in the plan. */
function autoExtra(active) {
  const attack = state.categories.find((c) => c.id === DEBT_CATEGORY_ID)?.limit || 0;
  const mins = active.reduce((s, d) => s + d.minPayment, 0);
  return { attack, mins, extra: attack };
}

function currentPlan() {
  const active = monsters().filter((m) => m.alive && m.include);
  const auto = autoExtra(active);
  const extra = state.settings.extraCents ?? auto.extra;
  const strategy = state.settings.strategy;
  const today = todayISO();
  const sims = active.map((m) => simDebt(m, m.balance, today));
  const extras = plannedExtras(active);
  const plan = simulatePayoff(sims, extra, strategy, 600, extras);
  const baseline = simulatePayoff(sims, 0, strategy);
  return { active, auto, extra, strategy, plan, baseline, extras };
}

const hasAnyData = () => state.debts.length || state.incomes.length || state.expenses.length || state.incomeSources.length || state.bills.length;

// ---------- rendering helpers ----------

/**
 * A picture of a monster (or the hero) at 16 * scale CSS pixels.
 * Monsters use their framed portrait in lists and cards, and the full 3D-rendered model at large sizes
 * (scale 8+, the debt sheet). The hero still uses its 16x16 sprite.
 */
function spriteCanvas(key, temper, scale, cls = '', damage = 0) {
  const px = 16 * scale;
  if (MODELS[key]) {
    const full = scale >= 8;
    const size = full ? Math.round(px / 2) : px;
    return `<canvas class="sprite ${full ? 'model' : 'portrait'} ${cls}" width="${size}" height="${size}" style="width:${px}px;height:${px}px" data-${full ? 'model' : 'portrait'}="${key}" data-temper="${temper}" data-damage="${damage}" aria-hidden="true"></canvas>`;
  }
  return `<canvas class="sprite ${cls}" width="${px}" height="${px}" data-sprite="${key}" data-temper="${temper}" data-scale="${scale}" aria-hidden="true"></canvas>`;
}

// Rendered portraits and models, by type, temper and size: each is drawn once.
const artCache = new Map();
function art(kind, type, temper, size, damage = 0) {
  const k = `${kind}|${type}|${temper}|${size}|${damage}`;
  if (!artCache.has(k)) {
    const buf = kind === 'portrait' ? renderPortrait(type, temper, { size, damage }) : renderModel(type, temper, { w: size, h: size, t: 0.4, damage });
    artCache.set(k, new ImageData(buf.data, buf.w, buf.h));
  }
  return artCache.get(k);
}

function paintSprites(root) {
  for (const c of root.querySelectorAll('canvas[data-sprite]')) {
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    drawSprite(ctx, c.dataset.sprite, c.dataset.temper, Number(c.dataset.scale));
  }
  for (const c of root.querySelectorAll('canvas[data-portrait], canvas[data-model]')) {
    const kind = c.dataset.portrait ? 'portrait' : 'model';
    c.getContext('2d').putImageData(art(kind, c.dataset[kind], c.dataset.temper, c.width, Number(c.dataset.damage) || 0), 0, 0);
  }
}

function hpBar(pct, label = '', phases = false) {
  const marks = phases ? [75, 50, 25].map((p) => `<i class="phase" style="left:${p}%"></i>`).join('') : '';
  return `<div class="hp ${phases ? 'boss-hp' : ''}" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><div class="hp-fill" style="width:${pct}%"></div>${marks}${label ? `<span>${label}</span>` : ''}</div>`;
}

function meter(spent, limit) {
  const pct = limit > 0 ? Math.min(100, (spent / limit) * 100) : spent > 0 ? 100 : 0;
  const over = limit > 0 ? spent > limit : spent > 0;
  return `<div class="meter ${over ? 'over' : ''}"><div style="width:${pct}%"></div></div>`;
}

function monthsLabel(n) {
  if (n < 12) return `${n} month${n === 1 ? '' : 's'}`;
  const y = Math.floor(n / 12);
  const m = n % 12;
  return `${y} yr${y === 1 ? '' : 's'}${m ? ` ${m} mo` : ''}`;
}

function monthNav() {
  return `
    <div class="month-nav">
      <button class="btn icon" data-action="month" data-d="-1" aria-label="Previous month">‹</button>
      <b>${monthLabel(ui.month)}</b>
      <button class="btn icon" data-action="month" data-d="1" aria-label="Next month">›</button>
    </div>`;
}

function header(title, sub = '') {
  return `<header class="page-head"><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</header>`;
}

// ---------- tab 1: plan ----------

function planView() {
  const { active, auto, extra, strategy, plan, baseline, extras } = currentPlan();
  const now = ymOf(todayISO());
  const ms = monsters();

  const paidAll = state.ledger.filter((e) => e.kind === 'payment').reduce((s, e) => s - e.amount, 0);
  const interestAll = state.ledger.filter((e) => e.kind === 'interest').reduce((s, e) => s + e.amount, 0);
  const history = [5, 4, 3, 2, 1, 0].map((k) => {
    const ym = addMonths(now, -k);
    const m = summary(ym);
    return { ym, income: m.incomeTotal, spent: m.spent };
  });
  const histMax = Math.max(1, ...history.flatMap((h) => [h.income, h.spent]));

  let projection = '';
  if (active.length) {
    const byId = new Map(active.map((m) => [m.id, m]));
    const savedInterest = baseline.feasible ? baseline.totalInterest - plan.totalInterest : null;
    const savedMonths = baseline.feasible ? baseline.months - plan.months : null;
    // Chart domain: long enough to show the minimums-only line finish (or not), capped at 30 years.
    const span = Math.min(360, plan.feasible ? Math.max(plan.months, baseline.feasible ? baseline.months : plan.months * 2, 12) : 120);
    const padTo = (arr) => Array.from({ length: span + 1 }, (_, i) => Math.max(0, arr[i] ?? 0));
    const chart = lineChart({
      series: [
        { key: 'plan', name: 'Your plan', color: SERIES_COLORS.plan, values: padTo(plan.timeline) },
        { key: 'baseline', name: 'Minimums only', color: SERIES_COLORS.baseline, values: padTo(baseline.timeline) },
      ],
      todayAt: 0,
      todayFraction: 0.2,
      xLabel: (i) => (i === 0 ? 'Today' : monthLabel(addMonths(now, i), { month: 'short', year: 'numeric' })),
      yFmt: (v, full) => fmt(v, { compact: !full }),
      ariaLabel: `Total debt over time. Your plan reaches zero in ${monthsLabel(plan.months)}.`,
    });

    projection = `
      <section class="card hero-stat">
        ${plan.feasible
          ? `<small>Debt free in</small><div class="big">${monthLabel(addMonths(now, plan.months))}</div>
             <p>${monthsLabel(plan.months)} · ${fmt(plan.totalInterest)} interest on the way</p>
             ${extra > 0 ? (savedInterest != null
               ? `<p class="good">${fmt(savedInterest)} less interest and ${monthsLabel(savedMonths)} sooner than minimums only.</p>`
               : `<p class="good">On minimums alone you would never finish. Your extra payments make this possible.</p>`) : ''}`
          : `<small>Debt free in</small><div class="big bad">Never</div>
             <p>With ${fmt(plan.budget)} a month, interest grows faster than you pay. Raise the extra amount below.</p>`}
      </section>

      <section class="card">
        <h2>Total debt over time</h2>
        ${chart}
      </section>

      <section class="card">
        <h2>Strategy</h2>
        <div class="seg" role="group" aria-label="Strategy">
          ${Object.entries(STRATEGIES).map(([k, s]) => `<button class="${k === strategy ? 'on' : ''}" aria-pressed="${k === strategy}" data-action="set-strategy" data-key="${k}">${s.label}</button>`).join('')}
        </div>
        <p class="hint">${STRATEGIES[strategy].blurb}</p>
        <div class="stats">
          <div><small>Minimums</small><b>${fmt(auto.mins)}</b></div>
          <div><small>Extra / mo</small><b>${fmt(extra)}</b></div>
          <div><small>Total / mo</small><b>${fmt(plan.budget)}</b></div>
        </div>
        <p class="hint">${state.settings.extraCents == null ? `Extra comes from the Extra debt payments line in your budget (${fmt(auto.attack)}).` : 'Extra set by hand.'}${extras.length ? ` Planned debt payments above their minimums are included (${extras.length}).` : ''}</p>
        ${(() => { const lo = monthlyPlan(state, debtMinsTotal()).leftover; return state.incomeSources.length && lo < 0 ? `<p class="bad">Your bills and minimum payments are ${fmt(-lo)} more than your income each month.</p>` : ''; })()}
        <button class="btn" data-action="set-extra">Change extra</button>
      </section>

      <section class="card">
        <h2>Each debt</h2>
        <p class="hint">Paid-off dates on this plan. Tap a debt for what-if projections.</p>
        <ol class="rows">
          ${plan.kills.map((k) => projectRow(byId.get(k.id), monthLabel(addMonths(now, k.month), { month: 'short', year: 'numeric' }))).join('')}
          ${active.filter((m) => !plan.kills.some((k) => k.id === m.id)).map((m) => projectRow(m, 'never', 'bad')).join('')}
          ${benchedRows()}
        </ol>
        <p class="hint">Assumes rates stay the same and no new charges. An estimate, not financial advice.</p>
      </section>`;
  } else {
    projection = `<section class="card empty-card"><p>Add your debts to see when you'll be debt free.</p><button class="btn primary" data-action="add-debt">Add a debt</button></section>
      ${benchedRows() ? `<section class="card"><h2>Each debt</h2><p class="hint">Tap a debt for what-if projections.</p><ol class="rows">${benchedRows()}</ol></section>` : ''}`;
  }

  return `
    ${header('Planning', 'Where your money is heading')}
    ${projection}
    <section class="card">
      <h2>Your stats</h2>
      <div class="stats">
        <div><small>Paid so far</small><b>${fmt(paidAll)}</b></div>
        <div><small>Interest added</small><b>${fmt(interestAll)}</b></div>
        <div><small>Paid off</small><b>${ms.filter((m) => !m.alive).length} of ${ms.length}</b></div>
      </div>
    </section>

    <section class="card">
      <h2>Last 6 months</h2>
      <div class="legend"><span><i class="sw-income"></i>Income</span><span><i class="sw-spent"></i>Spent</span></div>
      <ul class="hist">
        ${history.map((h) => `
          <li>
            <span class="hist-m">${monthLabel(h.ym, { month: 'short' })}</span>
            <span class="hist-bars">
              <span class="bar income" style="width:${(h.income / histMax) * 100}%"></span>
              <span class="bar spent" style="width:${(h.spent / histMax) * 100}%"></span>
            </span>
            <span class="hist-v"><b class="${h.income - h.spent < 0 ? 'bad' : ''}">${h.income - h.spent >= 0 ? '+' : '−'}${fmt(Math.abs(h.income - h.spent), { compact: true })}</b></span>
          </li>`).join('')}
      </ul>
      <p class="hint">Right column is what was left over (income minus spending, including debt payments).</p>
    </section>
    ${reportCard()}`;
}

/** Spending by budget line over the last few months: total, monthly average, and how often it went over. */
function reportCard() {
  const n = ui.reportMonths || 6;
  const now = ymOf(todayISO());
  const months = Array.from({ length: n }, (_, i) => addMonths(now, i - n + 1));
  const sums = months.map((ym) => summary(ym));
  const lines = [...state.categories.map((c) => ({ id: c.id, name: c.name })), { id: OTHER_CATEGORY_ID, name: 'Unplanned' }]
    .map((l) => {
      const rows = sums.map((m) => (l.id === OTHER_CATEGORY_ID ? m.other : m.categories.find((c) => c.id === l.id)));
      const total = rows.reduce((t, r) => t + (r?.spent || 0), 0);
      return { ...l, total, avg: Math.round(total / n), over: rows.filter((r) => r?.over).length, limit: rows.at(-1)?.limit || 0 };
    })
    .filter((l) => l.total > 0)
    .sort((a, b) => b.total - a.total);
  const max = Math.max(1, ...lines.map((l) => l.avg));
  const bills = sums.reduce((t, m) => t + m.fixed, 0);
  return `
    <section class="card">
      <h2>Where your money went</h2>
      <div class="seg" role="group" aria-label="Report range">
        ${[3, 6, 12].map((k) => `<button class="${k === n ? 'on' : ''}" aria-pressed="${k === n}" data-action="report-range" data-key="${k}">${k} months</button>`).join('')}
      </div>
      ${lines.length ? `<ul class="report">${lines.map((l) => `
        <li>
          <span class="rep-top"><span>${esc(l.name)}${l.over ? ` <small class="bad">over ${l.over}×</small>` : ''}</span><b>${fmt(l.avg)}<small>/mo</small></b></span>
          <span class="rep-bar"><span style="width:${(l.avg / max) * 100}%"></span></span>
          <small>${fmt(l.total)} in ${n} months${l.limit ? ` · budget ${fmt(l.limit)}/mo` : ''}</small>
        </li>`).join('')}</ul>` : '<p class="empty">Log expenses to see where your money goes.</p>'}
      ${bills ? `<p class="hint">Plus ${fmt(bills)} in fixed bills over the same months.</p>` : ''}
    </section>`;
}

function projectRow(m, right, cls = '') {
  return `<li><button class="row-btn" data-action="project" data-id="${m.id}">
    ${spriteCanvas(m.species.key, m.temper.key, 3, '', m.dmg)}
    <span class="grow">${esc(m.name)}<small>${fmt(m.balance)} · ${m.rate}% APR${m.promo ? ` until ${dayLabel(m.promo.ends)}` : ''}</small></span>
    <small class="${cls}">${right}</small><span class="chev" aria-hidden="true">›</span>
  </button></li>`;
}

function benchedRows() {
  return monsters().filter((m) => m.alive && !m.include).map((m) => projectRow(m, 'benched')).join('');
}

// ---------- per-debt what-if projections ----------

const EVERY_OPTIONS = [
  [0, 'Just once, now'], [1, 'Every month'], [2, 'Every 2 months'], [3, 'Every 3 months'], [6, 'Every 6 months'], [12, 'Once a year'],
];

function openProjection(id) {
  const m = monsters().find((x) => x.id === id);
  if (!m) return;
  const now = ymOf(todayISO());
  const debt = simDebt(m, m.balance, todayISO());
  const roundUp = (c, step) => Math.ceil(c / step) * step;
  const defMonthly = roundUp(Math.max(m.minPayment * 2, m.minPayment + 2500, 1000), 500);
  let active = 'monthly';

  const html = `
    <div class="pj-head">
      ${spriteCanvas(m.species.key, m.temper.key, 3, '', m.dmg)}
      <div class="grow"><h2>${esc(m.name)}</h2>
        <small>${fmt(m.balance)} owed · ${m.rate}% APR · ${fmt(m.minPayment)} minimum${m.promo ? ` · ${m.apr}% until ${dayLabel(m.promo.ends)}, then ${m.promo.after}%` : ''}${m.paused ? ` · paused until ${dayLabel(m.pauseUntil)}` : ''}</small></div>
    </div>
    <div class="pj-chart"></div>

    <section class="scn" data-scn="min">
      <h3>1. Minimum payments only</h3>
      <p class="hint">Paying ${fmt(m.minPayment)} every month.</p>
      <div class="scn-out" aria-live="polite"></div>
    </section>

    <section class="scn" data-scn="monthly">
      <h3>2. Pay a set amount each month</h3>
      <div class="field"><label for="pj-monthly">Monthly payment</label>
        <input id="pj-monthly" inputmode="decimal" autocomplete="off" value="${centsToInput(defMonthly)}"></div>
      <div class="scn-out" aria-live="polite"></div>
    </section>

    <section class="scn" data-scn="extra">
      <h3>3. Make extra payments</h3>
      <p class="hint">On top of the ${fmt(m.minPayment)} minimum.</p>
      <div class="field-row">
        <div class="field"><label for="pj-extra">Extra amount</label>
          <input id="pj-extra" inputmode="decimal" autocomplete="off" value="100.00"></div>
        <div class="field"><label for="pj-every">How often</label>
          <select id="pj-every">${EVERY_OPTIONS.map(([v, l]) => `<option value="${v}" ${v === 3 ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      </div>
      <div class="scn-out" aria-live="polite"></div>
    </section>

    <section class="scn" data-scn="missed">
      <h3>4. Miss payments</h3>
      <p class="hint">Skip the next payments, then go back to the minimum.</p>
      <div class="field-row">
        <div class="field"><label for="pj-miss">Payments missed</label>
          <input id="pj-miss" inputmode="numeric" autocomplete="off" value="1"></div>
        <div class="field"><label for="pj-fee">Late fee each</label>
          <input id="pj-fee" inputmode="decimal" autocomplete="off" value="30.00"></div>
      </div>
      <p class="hint">Check your own late fee in your card or loan terms. Missed payments can also raise your rate and hurt your credit score, which this doesn't include.</p>
      <div class="scn-out" aria-live="polite"></div>
    </section>

    <p class="hint">Assumes the rate stays at ${m.apr}% and no new charges. A fixed minimum is used; card minimums usually shrink as the balance falls, which makes the real minimums-only path slower.</p>`;

  const sheet = openSheet(html, { className: 'projection' });
  const el = sheet.el;
  paintSprites(el);
  const $ = (sel) => el.querySelector(sel);

  const describe = (r, base) => {
    if (!r.feasible) {
      return `<p class="pj-date bad">Never paid off</p><p>At this rate interest outgrows the payment. You need more than ${fmt(monthlyInterest(m.balance, m.apr))} a month just to keep up.</p>`;
    }
    let cmp = '';
    if (base && base !== r && base.feasible) {
      const dm = base.months - r.months;
      const di = base.totalInterest + (base.totalFees || 0) - r.totalInterest - r.totalFees;
      if (dm === 0 && di === 0) cmp = '<p class="hint">Same as minimums only.</p>';
      else {
        const time = dm > 0 ? `<b class="good">${monthsLabel(dm)} sooner</b>` : dm < 0 ? `<b class="bad">${monthsLabel(-dm)} later</b>` : 'same date';
        const money = di > 0 ? `<b class="good">${fmt(di)} less</b> in interest and fees` : di < 0 ? `<b class="bad">${fmt(-di)} more</b> in interest and fees` : 'same cost';
        cmp = `<p>vs. minimums only: ${time}, ${money}.</p>`;
      }
    } else if (base && base !== r && !base.feasible) {
      cmp = '<p class="good">Minimums alone never pay this off; this does.</p>';
    }
    return `<p class="pj-date">Paid off <b>${monthLabel(addMonths(now, r.months))}</b> <small>in ${monthsLabel(r.months)}</small></p>
      <p>Interest ${fmt(r.totalInterest)}${r.totalFees ? ` + fees ${fmt(r.totalFees)}` : ''} · total paid ${fmt(r.totalPaid)}</p>${cmp}`;
  };

  const compute = () => {
    const base = projectDebt(debt);
    const results = { min: base };
    const outs = {};

    const monthly = parseMoney($('#pj-monthly').value);
    if (monthly == null || monthly <= 0) outs.monthly = '<p class="bad">Enter a monthly amount.</p>';
    else {
      results.monthly = projectDebt(debt, { monthly });
      outs.monthly = (monthly < m.minPayment ? `<p class="bad">That's below the ${fmt(m.minPayment)} minimum, so the lender would treat it as a missed payment.</p>` : '') + describe(results.monthly, base);
    }

    const extra = parseMoney($('#pj-extra').value);
    if (extra == null || extra < 0) outs.extra = '<p class="bad">Enter an extra amount.</p>';
    else {
      results.extra = projectDebt(debt, { extra: { amount: extra, every: Number($('#pj-every').value) } });
      outs.extra = describe(results.extra, base);
    }

    const miss = Number($('#pj-miss').value);
    const fee = parseMoney($('#pj-fee').value || '0');
    if (!Number.isInteger(miss) || miss < 0 || miss > 24) outs.missed = '<p class="bad">Enter a number of payments from 0 to 24.</p>';
    else if (fee == null || fee < 0) outs.missed = '<p class="bad">Enter a late fee (0 if none).</p>';
    else {
      results.missed = projectDebt(debt, { missed: { count: miss, fee } });
      outs.missed = describe(results.missed, base);
    }
    outs.min = describe(base, null);

    for (const sec of el.querySelectorAll('.scn')) {
      sec.querySelector('.scn-out').innerHTML = outs[sec.dataset.scn];
      sec.classList.toggle('on', sec.dataset.scn === active && active !== 'min');
    }

    // Chart: minimums only vs the scenario being edited (two lines, so the colors stay distinguishable).
    const cmp = active !== 'min' ? results[active] : null;
    const spanOf = (r) => (r.feasible ? r.months : 120);
    const span = Math.min(360, Math.max(6, spanOf(base), cmp ? spanOf(cmp) : 0));
    const pad = (arr) => Array.from({ length: span + 1 }, (_, i) => Math.max(0, arr[i] ?? 0));
    const names = { monthly: 'Set monthly amount', extra: 'With extra payments', missed: 'With missed payments' };
    const series = [];
    if (cmp) series.push({ key: 'plan', name: names[active], color: SERIES_COLORS.plan, values: pad(cmp.timeline) });
    series.push({ key: 'baseline', name: 'Minimums only', color: SERIES_COLORS.baseline, values: pad(base.timeline) });
    $('.pj-chart').innerHTML = lineChart({
      series,
      todayAt: 0,
      todayFraction: 0.2,
      xLabel: (i) => (i === 0 ? 'Today' : monthLabel(addMonths(now, i), { month: 'short', year: 'numeric' })),
      yFmt: (v, full) => fmt(v, { compact: !full }),
      ariaLabel: `${m.name} balance over time`,
    });
    attachCharts($('.pj-chart'));
  };

  el.addEventListener('input', compute);
  el.addEventListener('change', compute);
  el.addEventListener('focusin', (e) => {
    const sec = e.target.closest('.scn');
    if (sec && sec.dataset.scn !== active) {
      active = sec.dataset.scn;
      compute();
    }
  });
  el.addEventListener('click', (e) => {
    const sec = e.target.closest('.scn');
    if (sec && sec.dataset.scn !== active) {
      active = sec.dataset.scn;
      compute();
    }
  });
  compute();
}

// ---------- tab 2: spending ----------

function spendView() {
  const m = summary(ui.month);
  const ms = monsters();
  const debtName = (id) => state.debts.find((d) => d.id === id)?.name || 'debt';
  const entries = [
    ...state.expenses.filter((e) => ymOf(e.date) === ui.month).map((e) => ({
      id: e.id, date: e.date, amount: e.amount, t: 'expense', sign: '−', card: e.debtId ? debtName(e.debtId) : null,
      label: catName(e.categoryId) + (e.note ? ` · ${e.note}` : ''),
    })),
    // Card purchases already appear as expenses, so their linked charges are left out here.
    ...state.ledger.filter((e) => !e.auto && !e.expenseId && e.kind !== 'correction' && ymOf(e.date) === ui.month).map((e) => ({
      id: e.id, date: e.date, amount: Math.abs(e.amount), t: 'ledger', cls: e.kind === 'payment' ? 'attack' : 'charge',
      sign: e.kind === 'payment' ? '−' : '+',
      label: `${e.kind === 'payment' ? 'Payment' : ENTRY_KINDS[e.kind].label}: ${debtName(e.debtId)}${e.note ? ` · ${e.note}` : ''}`,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  const top = [...m.categories, m.other].filter((c) => c.spent > 0).sort((a, b) => b.spent - a.spent).slice(0, 3);
  const live = ms.filter((d) => d.alive);

  return `
    ${header('Spending', 'Log expenses, debts and payments')}
    <div class="action-grid">
      <button class="btn primary" data-action="add-expense">+ Expense</button>
      <button class="btn primary" data-action="add-payment" ${live.length ? '' : 'disabled'}>+ Debt payment</button>
      <button class="btn" data-action="add-debt">+ New debt</button>
      <button class="btn" data-action="add-charge" ${live.length ? '' : 'disabled'}>+ Charge on a debt</button>
      <button class="btn" data-action="add-scheduled">+ Plan a purchase</button>
      <button class="btn" data-action="plan-debt" ${live.length ? '' : 'disabled'}>+ Plan a debt payment</button>
    </div>
    ${upcomingCard()}

    <section class="card">
      <h2>Debts</h2>
      ${ms.length ? `<ul class="rows">${ms.sort((a, b) => b.balance - a.balance).map((d) => `
        <li><button class="row-btn" data-action="open-debt" data-id="${d.id}">
          ${spriteCanvas(d.species.key, d.temper.key, 3, d.alive ? '' : 'dead', d.dmg)}
          <span class="grow">${esc(d.name)}<small>${d.alive ? `${typeLabel(d.type)} · ${d.rate}% APR${d.promo ? ` until ${dayLabel(d.promo.ends)}, then ${d.promo.after}%` : ''}${d.paused ? ` · paused until ${dayLabel(d.pauseUntil)}` : ''}${d.missed ? ' · missed payment' : ''}${d.include ? '' : ' · benched'}` : 'Paid off'}</small></span>
          <b>${fmt(Math.max(0, d.balance))}</b>
        </button></li>`).join('')}</ul>` : '<p class="empty">No debts yet. Add each loan or card you owe on.</p>'}
    </section>

    ${monthNav()}
    <section class="card">
      <div class="stats">
        <div><small>Logged spending</small><b>${fmt(m.expenses)}</b></div>
        <div><small>Debt payments</small><b>${fmt(m.debtPaid)}</b></div>
        <div><small>Left this month</small><b class="${m.left < 0 ? 'bad' : ''}">${fmt(m.left)}</b></div>
      </div>
      ${top.length ? `<p class="hint">Biggest: ${top.map((c) => `${esc(c.name)} ${fmt(c.spent)}`).join(' · ')}</p>` : ''}
    </section>

    <section class="card">
      <h2>Log</h2>
      ${entries.length ? `<ul class="log">${entries.map((e) => `
        <li class="${e.cls || e.t}">
          <button class="row-btn grow" data-action="edit-entry" data-t="${e.t}" data-id="${e.id}"><span class="grow">${esc(e.label)}<small>${dayLabel(e.date)}${e.card ? ` · on ${esc(e.card)}` : ''}</small></span>
          <b>${e.sign}${fmt(e.amount)}</b></button>
          <button class="x" data-action="del-entry" data-t="${e.t}" data-id="${e.id}" aria-label="Delete">×</button>
        </li>`).join('')}</ul>` : '<p class="empty">Nothing logged this month.</p>'}
    </section>`;
}

// ---------- tab 3: battle ----------

function monsterCard(m) {
  const badges = [
    m.boss && m.alive ? '<span class="badge boss">BOSS</span>' : '',
    m.missed ? '<span class="badge bad">Missed payment</span>' : '',
    m.paused && m.alive ? '<span class="badge">Paused</span>' : '',
    m.promo && m.alive ? `<span class="badge">${m.apr}% until ${dayLabel(m.promo.ends)}</span>` : '',
  ].join('');
  return `
    <button class="card monster ${m.alive ? '' : 'dead'} ${m.boss && m.alive ? 'is-boss' : ''} ${m.missed ? 'enraged' : ''}" data-action="open-debt" data-id="${m.id}">
      ${spriteCanvas(m.species.key, m.temper.key, m.boss && m.alive ? 5 : 4, '', m.dmg)}
      <div class="grow">
        <div class="m-name">${esc(m.name)}</div>
        <small>${m.alive ? `${m.temper.name} ${m.species.name}` : 'Defeated'} · ${m.rate}% APR</small>
        ${badges ? `<div class="badges">${badges}</div>` : ''}
        ${m.alive ? hpBar(m.hpPct, `${fmt(m.balance)} owed`, m.boss) : ''}
        ${m.missed ? `<small class="bad">Enraged! The ${dayLabel(m.missed.due)} payment was missed. Pay it to calm it down.</small>`
          : m.regen ? '<small class="bad">Regenerating! The minimum doesn\'t cover interest</small>' : ''}
      </div>
    </button>`;
}

/** A monster as the battle stage shows it. */
function fighterOf(m) {
  const warn = m.missed ? [`Missed the ${dayLabel(m.missed.due)} payment! Pay it to calm it down`, true]
    : m.regen ? ["Growing: the minimum doesn't cover its interest", true]
    : m.paused ? [`Payments paused until ${dayLabel(m.pauseUntil)}`, false]
    : m.promo ? [`${m.apr}% until ${dayLabel(m.promo.ends)}, then ${m.promo.after}%`, false] : [null, false];
  return {
    id: m.id, name: m.name, type: m.species.key, temper: m.temper.key, temperName: m.temper.name, speciesName: m.species.name,
    rate: m.rate, balance: m.balance, peak: m.maxHp, boss: m.boss, warn: warn[0], warnBad: warn[1],
    start: m.startBalance, paid: state.ledger.reduce((t, e) => t + (e.debtId === m.id && e.kind === 'payment' ? -e.amount : 0), 0),
  };
}
const fightOrder = (a, b) => (b.boss - a.boss) || b.balance - a.balance;
const battleFighters = () => monsters().filter((m) => m.alive && m.include).sort(fightOrder).map(fighterOf);

/** The monster in its habitat, for the top of a debt's sheets (painted by paintDioramas). */
const dioramaHtml = (m, cls = '') => `<canvas class="diorama ${cls}" data-dio="${m.id}" width="120" height="90" aria-hidden="true"></canvas>`;
function paintDioramas(root) {
  for (const c of root.querySelectorAll('canvas[data-dio]')) {
    const m = monsters().find((x) => x.id === c.dataset.dio);
    if (m) drawDiorama(c, fighterOf(m));
  }
}
const debtSubline = (m) => `${m.rate}% APR · Started at ${fmt(m.startBalance)}`;
const totalPaid = (m) => state.ledger.reduce((t, e) => t + (e.debtId === m.id && e.kind === 'payment' ? -e.amount : 0), 0);

/** Stars for how hard a payment hits (the attack's name only shows while it plays). */
function powerLabel(cents, m) {
  const p = attackPower(cents, m.maxHp, m.balance);
  if (p.kill) return '<span class="power-stars">✦</span> Pays it off';
  return `<span class="power-stars" aria-label="Attack power ${p.stars} of 5">${'★'.repeat(p.stars)}<span>${'★'.repeat(5 - p.stars)}</span></span> ${(p.share * 100).toFixed(p.share < 0.1 ? 1 : 0)}% of the debt`;
}

/** Pay: the minimum in one tap, or a custom amount. */
function payMonster(id) {
  const m = monsters().find((x) => x.id === id);
  if (!m || !m.alive) return;
  const min = Math.min(m.minPayment || 0, m.balance);
  const acct = withAccount('Paid from', ['cash', 'savings'])[0];
  const acctName = acct?.value ? state.accounts.find((a) => a.id === acct.value)?.name : null;
  const sheet = openSheet(`
    ${dioramaHtml(m, 'short')}
    <h2>Pay ${esc(m.name)}</h2>
    <p class="hint">${fmt(m.balance)} owed${m.paused ? ` · payments paused until ${dayLabel(m.pauseUntil)}` : ''}</p>
    <div class="pay-choices">
      <button class="pay-choice primary" data-action="min" ${min ? '' : 'disabled'}>
        <span class="grow"><b>Minimum payment</b><small>${min ? `${powerLabel(min, m)}${acctName ? ` · from ${esc(acctName)}` : ''}` : 'No minimum set yet. Add one in Details.'}</small></span>
        <span class="amt">${min ? fmt(min) : ''}</span>
      </button>
      <button class="pay-choice" data-action="custom">
        <span class="grow"><b>Custom amount</b><small>Pay more, hit harder</small></span>
        <span class="amt" aria-hidden="true">›</span>
      </button>
    </div>`, {
    onAction: (action, _el, { close }) => {
      close();
      if (action === 'min') {
        const v = { amount: min, accountId: acct?.value || null, date: todayISO(), note: '' };
        const res = saveDebtEntry('payment', m, v);
        if (res.error) return toast(res.error, 'bad');
        afterDebtEntry('payment', m, v.amount, res, true);
      }
      if (action === 'custom') logDebtEntry('payment', m.id, true);
    },
    className: 'debt-sheet',
  });
  paintDioramas(sheet.el);
}

/** The Battle tab is only the battle: the stage, or a prompt to add a first debt. */
function battleView() {
  const ms = monsters();
  const active = ms.filter((m) => m.alive && m.include);
  const dead = ms.filter((m) => !m.alive);
  return `
    <h1 class="sr-only">Battle</h1>
    ${active.length ? battleMarkup() : dead.length ? victoryMarkup() : `
      <section class="card empty-card battle-empty">
        <p>No monsters yet. Each debt you add appears here as a monster.</p>
        <div class="row-buttons"><button class="btn primary" data-action="add-debt">Add a debt</button>
        ${state.settings.setupDone ? '' : '<button class="btn" data-action="goto" data-tab="setup">Set up your account</button>'}</div>
      </section>`}`;
}

/** "Add to Home Screen" help, on the Settings tab until the app is installed. */
function installTip() {
  const iOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone) return '';
  if (ui.installPrompt) return `<section class="card tip">Install Coin Quest on this device. <button class="btn primary" data-action="install">Install</button></section>`;
  return iOS ? `<section class="card tip">Install: tap <b>Share</b> then <b>Add to Home Screen</b>.</section>` : '';
}

// ---------- money you have (current situation) ----------

const TYPE_OPTIONS = Object.entries(ACCOUNT_TYPES).map(([value, label]) => ({ value, label }));
const TYPE_COLORS = { cash: '#7a8ae6', savings: '#199e70', invest: '#c07d18' }; // validated as a set on the card surface

/** A select field for choosing an account, defaulting to the first cash account. */
function accountField(label, types = ['cash', 'savings', 'invest'], name = 'accountId') {
  const opts = state.accounts.filter((a) => types.includes(a.type));
  const bal = accountBalances(state);
  return {
    name, label, type: 'select',
    value: (opts.find((a) => a.type === 'cash') || opts[0])?.id || '',
    options: [...opts.map((a) => ({ value: a.id, label: `${a.name} · ${fmt(bal.get(a.id))}` })), { value: '', label: "Don't track" }],
  };
}
const withAccount = (label, types) => (state.accounts.length ? [accountField(label, types)] : []);

function situationCard() {
  if (!state.accounts.length) {
    return `
      <section class="card tip">
        <h2>Current situation</h2>
        <p>Add what you have right now in cash, savings and investments. Everything you log keeps it up to date from then on.</p>
        <button class="btn primary wide" data-action="add-account">+ Add an account</button>
      </section>
      ${moneyChartCard()}`;
  }
  const events = accountEvents(state);
  const bal = accountBalances(state, null, events);
  const t = totalsByType(state, null, events);
  const owed = monsters().filter((m) => m.alive).reduce((s, m) => s + m.balance, 0);
  return `
    <section class="card">
      <h2>Current situation</h2>
      <div class="worth">
        <div><small>You have</small><div class="big">${fmt(t.total)}</div></div>
        ${owed ? `<div class="worth-net"><small>Debts ${fmt(owed)} · Net worth</small><b class="${t.total - owed < 0 ? 'bad' : ''}">${fmt(t.total - owed)}</b></div>` : ''}
      </div>
      <div class="stats">
        ${Object.entries(ACCOUNT_TYPES).map(([k, l]) => `<div><small><i class="sw" style="background:${TYPE_COLORS[k]}"></i>${l}</small><b>${fmt(t[k])}</b></div>`).join('')}
      </div>
    </section>
    ${moneyChartCard()}
    <section class="card">
      <h2>Accounts</h2>
      <ul class="rows">${state.accounts.map((a) => `
        <li><button class="row-btn" data-action="open-account" data-id="${a.id}">
          <i class="sw" style="background:${TYPE_COLORS[a.type]}"></i>
          <span class="grow">${esc(a.name)}<small>${ACCOUNT_TYPES[a.type]}</small></span>
          <b class="${bal.get(a.id) < 0 ? 'bad' : ''}">${fmt(bal.get(a.id))}</b><span class="chev" aria-hidden="true">›</span>
        </button></li>`).join('')}</ul>
      <div class="action-grid">
        <button class="btn" data-action="payday">+ Payday</button>
        <button class="btn" data-action="pay-bill">+ Bill paid</button>
        <button class="btn" data-action="move-money" ${state.accounts.length > 1 ? '' : 'disabled'}>Move money</button>
        <button class="btn" data-action="add-account">+ Account</button>
      </div>
      <p class="hint">Balances change when you log income, expenses and debt payments. If one drifts from your bank, tap it and choose Update balance.</p>
    </section>`;
}

/** Chart series per view. Colors come from the palette-validated set (cash/savings/invested). */
const CHART_VIEWS = {
  checking: { label: 'Checking', series: () => [{ key: 'cash', name: 'Checking & cash', color: TYPE_COLORS.cash }] },
  savings: {
    label: 'Savings',
    series: () => [
      { key: 'savings', name: 'Savings', color: TYPE_COLORS.savings },
      ...(state.accounts.some((a) => a.type === 'invest') ? [{ key: 'invest', name: 'Invested', color: TYPE_COLORS.invest }] : []),
    ],
  },
  income: {
    label: 'Income',
    series: () => {
      const c = state.settings.chart;
      return [
        ...(c.income ? [{ key: 'income', name: 'Income / mo', color: TYPE_COLORS.savings }] : []),
        ...(c.spending ? [{ key: 'spending', name: 'Spending / mo', color: TYPE_COLORS.invest }] : []),
        ...(c.debts ? [{ key: 'debts', name: 'Debts owed', color: TYPE_COLORS.cash }] : []),
      ];
    },
  },
};

function moneyChartCard() {
  const c = state.settings.chart;
  const t = moneyTimeline(state, todayISO(), { projections: c.projections });
  const series = CHART_VIEWS[c.view].series().map((s) => ({ ...s, values: t[s.key] }));
  const now = ymOf(todayISO());
  const chart = series.length
    ? lineChart({
      series,
      splitAt: t.splitAt,
      todayAt: t.splitAt,
      todayFraction: 0.3,
      xLabel: (i) => (t.months[i] === now ? 'This month' : monthLabel(t.months[i], { month: 'short', year: '2-digit' })),
      yFmt: (v, full) => fmt(v, { compact: !full }),
      ariaLabel: `${CHART_VIEWS[c.view].label} over time${c.projections ? ', with projections' : ''}`,
    })
    : '<p class="empty">Turn on at least one line below.</p>';
  const chip = (k, label) => `<button class="chip ${c[k] ? 'on' : ''}" aria-pressed="${c[k]}" data-action="chart-show" data-key="${k}">${label}</button>`;
  return `
    <section class="card">
      <h2>Money over time</h2>
      <div class="seg" role="group" aria-label="Chart view">
        ${Object.entries(CHART_VIEWS).map(([k, v]) => `<button class="${k === c.view ? 'on' : ''}" aria-pressed="${k === c.view}" data-action="chart-view" data-key="${k}">${v.label}</button>`).join('')}
      </div>
      ${c.view === 'income' ? `<div class="chips">${chip('income', 'Income')}${chip('spending', 'Spending')}${chip('debts', 'Debts')}</div>` : ''}
      ${chart}
      <label class="switch"><input type="checkbox" data-change="chart-proj" ${c.projections ? 'checked' : ''}><span>Show projections for the next 12 months</span></label>
      ${c.projections ? `<p class="hint">Dashed lines assume you follow your budget: pay, bills, debt payments on your plan, budget lines and planned one-off payments${state.scheduled.length ? ` (${state.scheduled.length} planned)` : ''}. Investments are held flat.</p>` : ''}
    </section>`;
}

function accountForm(a = null) {
  openForm({
    title: a ? `Edit ${a.name}` : 'Add an account',
    intro: a ? 'To change the balance, use Update balance instead.' : 'A bank account, cash, savings or an investment account like a 401(k), IRA or brokerage.',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, value: a?.name || '', placeholder: 'e.g. Checking' },
      { name: 'type', label: 'Type', type: 'select', options: TYPE_OPTIONS, value: a?.type || 'cash' },
      ...(a ? [] : [{ name: 'start', label: 'Balance today', type: 'money', required: true }]),
    ],
    extra: a ? [{ label: 'Delete', action: 'delete', className: 'bad' }] : [],
    onExtra: (_x, close) => {
      askConfirm(`Delete ${a.name}? Its history is removed. Expenses and payments logged from it stay in your budget.`, { okLabel: 'Delete', danger: true }).then((ok) => {
        if (!ok) return;
        close();
        commit((s) => {
          s.accounts = s.accounts.filter((x) => x.id !== a.id);
          s.moves = s.moves
            .map((m) => ({ ...m, from: m.from === a.id ? null : m.from, to: m.to === a.id ? null : m.to }))
            .filter((m) => (m.kind === 'update' ? m.to : m.from || m.to));
          for (const list of [s.incomes, s.expenses, s.ledger]) {
            for (const e of list) {
              if (e.accountId === a.id) e.accountId = null;
              if (e.toAccountId === a.id) e.toAccountId = null;
            }
          }
        });
      });
    },
    onSubmit: (v) => {
      commit((s) => {
        if (a) Object.assign(s.accounts.find((x) => x.id === a.id), { name: v.name, type: v.type });
        else s.accounts.push({ id: uid(), name: v.name, type: v.type, start: v.start, createdAt: todayISO() });
      });
    },
  });
}

function updateBalance(a) {
  const current = accountBalances(state).get(a.id);
  openForm({
    title: `Update ${a.name}`,
    intro: `The app shows <b>${fmt(current)}</b>. Enter the real balance from your bank or statement; the difference is recorded so nothing else changes.`,
    fields: [
      { name: 'balance', label: 'Real balance', type: 'money', required: true, value: current },
      { name: 'note', label: 'Reason (optional)', type: 'text', placeholder: a.type === 'invest' ? 'e.g. Market change' : 'e.g. Bank fee' },
    ],
    submitLabel: 'Update',
    onSubmit: (v) => {
      const delta = v.balance - current;
      if (!delta) return;
      commit((s) => s.moves.push({ id: uid(), kind: 'update', from: null, to: a.id, amount: delta, date: todayISO(), note: v.note || '' }));
      toast(`${a.name} updated to ${fmt(v.balance)}.`);
    },
  });
}

function openAccount(id) {
  const a = state.accounts.find((x) => x.id === id);
  if (!a) return;
  const balance = accountBalances(state).get(id);
  const acts = accountActivity(state, id);
  const sheet = openSheet(`
    <h2>${esc(a.name)}</h2>
    <p class="hint">${ACCOUNT_TYPES[a.type]} · added ${dayLabel(a.createdAt)}</p>
    <div class="big ${balance < 0 ? 'bad' : ''}">${fmt(balance)}</div>
    <div class="row-buttons">
      <button class="btn primary" data-action="update">Update balance</button>
      ${state.accounts.length > 1 ? '<button class="btn" data-action="move">Move money</button>' : ''}
      <button class="btn" data-action="edit">Edit</button>
    </div>
    <h3>Activity</h3>
    <ul class="log">
      ${acts.slice(0, 60).map((ev) => `
        <li class="${ev.amount > 0 ? 'income' : ''}"><span class="grow">${esc(ev.label)}<small>${dayLabel(ev.date)}</small></span>
          <b>${ev.amount > 0 ? '+' : '−'}${fmt(Math.abs(ev.amount))}</b></li>`).join('')}
      <li><span class="grow">Starting balance<small>${dayLabel(a.createdAt)}</small></span><b>${fmt(a.start)}</b></li>
    </ul>
    <p class="hint">To remove an item, delete it where it was logged (Spending or Budget tab).</p>`, {
    onAction: (action, _el, { close }) => {
      close();
      if (action === 'update') updateBalance(a);
      if (action === 'move') moveMoney(a.id);
      if (action === 'edit') accountForm(a);
    },
  });
  return sheet;
}

/** Payday or bill: money arriving from a recurring income source, or leaving for a recurring bill. */
function recordRecurring(kind) {
  const isPay = kind === 'payday';
  const list = isPay ? state.incomeSources : state.bills;
  openForm({
    title: isPay ? 'Record a payday' : 'Record a bill paid',
    intro: isPay
      ? 'Money from a regular income source arriving in an account. Your monthly budget already counts it, so this only updates the account.'
      : 'A regular bill leaving an account. Your monthly budget already counts it, so this only updates the account.',
    fields: [
      ...(list.length ? [{ name: 'src', label: isPay ? 'Income source' : 'Bill', type: 'select', options: list.map((x) => ({ value: x.id, label: `${x.name} (${fmt(x.amount)} ${freqLabel(x.freq)})` })), value: list[0].id }] : []),
      { name: 'amount', label: 'Amount', type: 'money', hint: list.length ? 'Leave blank to use the usual amount.' : '' , required: !list.length, positive: true },
      accountField(isPay ? 'Into' : 'Paid from', isPay ? ['cash', 'savings', 'invest'] : ['cash', 'savings']),
      { name: 'date', label: 'Date', type: 'date', value: todayISO() },
    ],
    onSubmit: (v) => {
      const src = list.find((x) => x.id === v.src);
      const amount = v.amount || src?.amount;
      if (!amount) return 'Enter an amount.';
      if (!v.accountId) return 'Pick an account.';
      commit((s) => {
        s.moves.push({ id: uid(), kind, from: isPay ? null : v.accountId, to: isPay ? v.accountId : null, amount, date: v.date, note: src?.name || '', sourceId: src?.id || null, auto: false });
        markActive();
      });
      toast(isPay ? `+${fmt(amount)} payday recorded.` : `${fmt(amount)} bill recorded.`);
    },
  });
}

function moveMoney(fromId = null) {
  const from = accountField('From');
  const to = accountField('To', ['cash', 'savings', 'invest'], 'toId');
  from.options = from.options.filter((o) => o.value);
  to.options = to.options.filter((o) => o.value);
  if (fromId) from.value = fromId;
  to.value = (state.accounts.find((a) => a.id !== from.value && a.type !== 'cash') || state.accounts.find((a) => a.id !== from.value))?.id;
  openForm({
    title: 'Move money',
    intro: 'Between your own accounts, like checking to savings or savings to an investment account.',
    fields: [from, to, { name: 'amount', label: 'Amount', type: 'money', required: true, positive: true }, { name: 'date', label: 'Date', type: 'date', value: todayISO() }, { name: 'note', label: 'Note (optional)', type: 'text' }],
    submitLabel: 'Move',
    onSubmit: (v) => {
      if (v.accountId === v.toId) return 'Pick two different accounts.';
      commit((s) => s.moves.push({ id: uid(), kind: 'transfer', from: v.accountId, to: v.toId, amount: v.amount, date: v.date, note: v.note || '' }));
      toast(`Moved ${fmt(v.amount)}.`);
    },
  });
}

// ---------- tab 4: income & budget ----------

const GOALS = {
  payDebt: 'Pay off debt faster',
  emergency: 'Build an emergency fund',
  saveFor: 'Save up for something',
  fun: 'Keep some money for fun',
  spendLess: 'Spend less on everyday things',
};

function recurringRows(list) {
  return state[list].map((r) => `
    <li><button class="row-btn" data-action="edit-rec" data-list="${list}" data-id="${r.id}">
      <span class="grow">${esc(r.name)}<small>${r.variable ? 'varies, about ' : ''}${fmt(r.amount)} ${freqLabel(r.freq)}${r.nextDate && r.accountId && !r.variable ? ` · next ${dayLabel(r.nextDate)}, posts to ${esc(state.accounts.find((a) => a.id === r.accountId)?.name || 'account')}` : ''}</small></span>
      <b>${fmt(list === 'incomeSources' ? sourceMonthly(state, r, ymOf(todayISO())) : toMonthly(r.amount, r.freq))}<small>/mo</small></b><span class="chev" aria-hidden="true">›</span>
    </button></li>`).join('');
}

function budgetView() {
  if (!state.settings.setupDone && !state.incomeSources.length && !state.accounts.length) {
    return `
      ${header('Income &amp; budget')}
      <section class="card empty-card">
        <p>Your budget is built from your income, bills and debts. Set up your account to fill it in.</p>
        <button class="btn primary" data-action="goto" data-tab="setup">Go to setup</button>
      </section>
      ${moneyChartCard()}`;
  }
  const mins = debtMinsTotal();
  const p = monthlyPlan(state, mins, ui.month);
  const m = summary(ui.month);
  const alive = monsters().filter((x) => x.alive);
  const hasDebtCat = state.categories.some((c) => c.id === DEBT_CATEGORY_ID);
  const extras = state.incomes.filter((i) => ymOf(i.date) === ui.month).sort((a, b) => b.date.localeCompare(a.date));
  const catRow = (c) => {
    const goal = c.kind === 'savings' ? goalStatus(state, c, todayISO()) : null;
    const notes = [
      c.overridden ? `${monthLabel(ui.month, { month: 'long' })} only` : '',
      c.carry ? `${c.carry > 0 ? '+' : '−'}${fmt(Math.abs(c.carry))} carried over` : '',
    ].filter(Boolean);
    return `
      <li><button data-action="${c.id === OTHER_CATEGORY_ID ? 'add-cat' : 'edit-cat'}" data-id="${c.id}">
        <span class="cat-top"><span>${esc(c.name)} <small>${c.id === OTHER_CATEGORY_ID ? 'not in your plan' : c.kind === 'debt' ? '' : CATEGORY_KINDS[c.kind]}</small></span><span>${fmt(c.spent)} / ${fmt(c.available ?? c.limit)}</span></span>
        ${meter(c.spent, c.available ?? c.limit)}
        ${notes.length ? `<small>${notes.join(' · ')}</small>` : ''}
        ${goal ? `<small>Saved ${fmt(goal.saved)} of ${fmt(c.target)}${goal.done ? ' · goal reached!' : goal.needPerMonth
          ? ` · ${goal.late ? '<span class="bad">past the deadline</span>' : `needs ${fmt(goal.needPerMonth)}/mo to make ${dayLabel(c.targetDate)} · <span class="${goal.onTrack ? 'good' : 'bad'}">${goal.onTrack ? 'on track' : 'behind'}</span>`}` : ''}</small>
          ${meter(Math.min(goal.saved, c.target), c.target)}` : ''}
      </button></li>`;
  };

  return `
    ${header('Income &amp; budget', 'What you have, what comes in, where it goes')}
    ${situationCard()}
    <section class="card">
      <h2>Every month</h2>
      <ul class="flow">
        <li><span>Income</span><b>${fmt(p.income)}</b></li>
        <li><span>Fixed bills</span><b>−${fmt(p.fixed)}</b></li>
        <li><span>Debt minimum payments</span><b>−${fmt(p.debtMins)}</b></li>
        <li class="flow-total"><span>Left over</span><b class="${p.leftover < 0 ? 'bad' : ''}">${fmt(p.leftover)}</b></li>
      </ul>
      ${p.leftover < 0 ? `<p class="bad">Your bills and minimum payments are ${fmt(-p.leftover)} more than your income.</p>` : ''}
    </section>

    <section class="card">
      <h2>Where the rest goes</h2>
      <p class="assign ${p.unallocated < 0 ? 'bad' : p.unallocated === 0 ? 'good' : ''}">
        ${p.unallocated > 0 ? `<b>${fmt(p.unallocated)}</b> still needs a job.` : p.unallocated < 0 ? `You've planned <b>${fmt(-p.unallocated)}</b> more than you have left.` : 'Every dollar has a job.'}
        <small>${fmt(p.allocated)} of ${fmt(Math.max(0, p.leftover))} assigned</small>
      </p>
      <div class="row-buttons">
        <button class="btn primary" data-action="add-cat">+ Add to budget</button>
        ${alive.length && !hasDebtCat ? '<button class="btn" data-action="add-debt-cat">+ Extra debt payments</button>' : ''}
      </div>
      <h3>Spent so far</h3>
      ${monthNav()}
      ${m.categories.length || m.other.spent ? `<ul class="cats">${m.categories.map(catRow).join('')}${m.other.spent ? catRow(m.other) : ''}</ul>`
        : '<p class="empty">Nothing planned yet. Add groceries, savings, fun money or anything else.</p>'}
    </section>

    <section class="card">
      <h2>Income sources</h2>
      ${state.incomeSources.length ? `<ul class="rows">${recurringRows('incomeSources')}</ul>` : '<p class="empty">No regular income yet.</p>'}
      <button class="btn" data-action="add-rec" data-list="incomeSources">+ Income source</button>
      <h3>Extra income in ${monthLabel(ui.month, { month: 'long' })}</h3>
      ${extras.length ? `<ul class="log">${extras.map((i) => `
        <li class="income">
          <button class="row-btn grow" data-action="edit-entry" data-t="income" data-id="${i.id}"><span class="grow">${esc(i.source || 'Income')}<small>${dayLabel(i.date)}</small></span>
          <b>+${fmt(i.amount)}</b></button>
          <button class="x" data-action="del-entry" data-t="income" data-id="${i.id}" aria-label="Delete">×</button>
        </li>`).join('')}</ul>` : '<p class="hint">Bonuses, gifts or side jobs that only happen once.</p>'}
      <button class="btn" data-action="add-income">+ Log extra income</button>
    </section>

    <section class="card">
      <h2>Fixed bills</h2>
      ${state.bills.length ? `<ul class="rows">${recurringRows('bills')}</ul>` : '<p class="empty">No recurring bills yet.</p>'}
      <button class="btn" data-action="add-rec" data-list="bills">+ Bill</button>
    </section>

    <section class="card">
      <h2>Debt minimum payments</h2>
      ${alive.length ? `<ul class="rows">${alive.map((d) => `
        <li><button class="row-btn" data-action="open-debt" data-id="${d.id}">
          ${spriteCanvas(d.species.key, d.temper.key, 3, '', d.dmg)}
          <span class="grow">${esc(d.name)}<small>${fmt(d.balance)} owed</small></span>
          <b>${fmt(d.minPayment)}<small>/mo</small></b>
        </button></li>`).join('')}</ul>` : '<p class="empty">No debts.</p>'}
      <p class="hint">Add or change debts on the Spending tab.</p>
    </section>`;
}

// ---------- tab 5: settings & setup ----------

const CURRENCIES = ['USD', 'CAD', 'EUR', 'GBP', 'AUD', 'NZD', 'MXN', 'BRL', 'INR', 'JPY', 'CHF', 'SEK', 'ZAR', 'PHP'];

function setupView() {
  const done = state.settings.setupDone;
  const goals = Object.entries(GOALS).filter(([k]) => state.goals[k]);
  return `
    ${header('Settings')}
    ${installTip()}
    <section class="card ${done ? '' : 'tip'}">
      <h2>${done ? 'Your account' : 'Get started'}</h2>
      ${done
        ? `<p>Set up in ${monthLabel(state.settings.startMonth || ymOf(todayISO()))}: ${state.incomeSources.length} income source${state.incomeSources.length === 1 ? '' : 's'}, ${state.bills.length} bill${state.bills.length === 1 ? '' : 's'}, ${state.debts.length} debt${state.debts.length === 1 ? '' : 's'}.</p>`
        : '<p>Everything starts empty. Set up your account to add your income, bills, debts and goals. It takes a few minutes, and nothing is saved until you finish.</p>'}
      ${done ? '<button class="btn primary wide" data-action="update-setup">Update my setup</button>' : ''}
      <button class="btn ${done ? '' : 'primary'} wide" data-action="new-account">Set up a new account</button>
      ${done ? '<p class="hint">Update my setup keeps everything and lets you change income, bills and goals or add new accounts, debts and budget lines. A new account replaces everything.</p>' : ''}
    </section>
    ${done ? `
      <section class="card">
        <h2>Your goals</h2>
        ${goals.length ? `<ul class="goal-list">${goals.map(([, l]) => `<li>${l}</li>`).join('')}</ul>` : '<p class="empty">No goals picked.</p>'}
        <button class="btn" data-action="edit-goals">Change goals</button>
      </section>` : ''}
    <section class="card">
      <h2>Basics</h2>
      <div class="field"><label for="set-currency">Currency</label>
        <select id="set-currency" data-change="currency">${CURRENCIES.map((c) => `<option ${c === state.settings.currency ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
    </section>
    <section class="card">
      <h2>Backup</h2>
      <p>Your data never leaves this device. Download a backup to keep it safe or move it to a new phone.</p>
      <p class="hint">Last backup: ${state.settings.lastBackup ? dayLabel(state.settings.lastBackup) : 'never'}</p>
      <div class="row-buttons">
        <button class="btn primary" data-action="backup">Download backup</button>
        <label class="btn">Restore backup<input type="file" accept="application/json,.json" data-change="restore" hidden></label>
      </div>
      <p class="hint">Storage: ${ui.persisted == null ? 'checking…' : ui.persisted ? 'protected from automatic clean-up' : 'the browser may clear it if space runs low. Installing to your home screen helps.'}</p>
    </section>
    <section class="card">
      <h2>Privacy lock</h2>
      <p>${state.settings.lock.enabled ? `On. The app asks for your passcode${state.settings.lock.credId ? ' or Face ID / fingerprint' : ''} when it opens and after a minute away.` : 'Off. Anyone holding your phone can open the app.'}</p>
      <div class="row-buttons">
        <button class="btn ${state.settings.lock.enabled ? '' : 'primary'}" data-action="set-pin">${state.settings.lock.enabled ? 'Change passcode' : 'Set a passcode'}</button>
        ${state.settings.lock.enabled ? `<button class="btn" data-action="bio">${state.settings.lock.credId ? 'Stop using Face ID' : 'Use Face ID / fingerprint'}</button>
          <button class="btn" data-action="lock-off">Turn off</button>` : ''}
      </div>
      <p class="hint">The lock hides the app from anyone holding your phone. It doesn't encrypt your saved data.</p>
    </section>
    <section class="card">
      <h2>Move to another device</h2>
      <p>Copy a transfer code here and paste it in the app on your other phone or browser. It also works as a backup you can keep in a note.</p>
      <div class="row-buttons">
        <button class="btn" data-action="transfer-out">Copy transfer code</button>
        <button class="btn" data-action="transfer-in">Paste a transfer code</button>
      </div>
      <p class="hint">The code contains all your financial details. Only paste it somewhere private.</p>
    </section>
    <section class="card">
      <h2>Install</h2>
      <p><b>iPhone/iPad:</b> open in Safari, tap Share, then Add to Home Screen.<br><b>Android:</b> open in Chrome, tap ⋮, then Install app.</p>
    </section>
    <section class="card danger">
      <h2>Danger zone</h2>
      <button class="btn bad" data-action="erase">Erase everything</button>
    </section>`;
}

const VIEWS = { plan: planView, spend: spendView, battle: battleView, budget: budgetView, setup: setupView };

// Routes are plain #names (no slashes) so links work inside embedded viewers too.
function route() {
  const r = location.hash.replace(/^#\/?/, '');
  const legacy = { town: 'battle', quest: 'plan', gear: 'setup', settings: 'setup' };
  if (r in VIEWS) return r;
  if (r in legacy) return legacy[r];
  return state.settings.setupDone || hasAnyData() ? 'battle' : 'setup';
}

function go(tab) {
  if (route() === tab) render();
  else location.hash = '#' + tab;
}

let lastRoute = null;
function render() {
  const r = route();
  const scrollY = r === lastRoute ? window.scrollY : 0;
  view.innerHTML = VIEWS[r]();
  view.classList.toggle('battle-only', r === 'battle');
  for (const a of document.querySelectorAll('.tabs a')) {
    const on = a.dataset.tab === r;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  paintSprites(view);
  attachCharts(view);
  if (r === 'battle') {
    mountBattle(document.getElementById('b-stage'), battleFighters(), fmt, { onPay: payMonster, onDetails: (id) => openDebt(id) });
    const beaten = monsters().filter((m) => !m.alive);
    mountVictory(document.getElementById('b-victory'), {
      count: beaten.length,
      total: state.ledger.reduce((t, e) => t + (e.kind === 'payment' ? -e.amount : 0), 0),
      trophies: beaten.map(fighterOf),
    }, fmt);
  }
  window.scrollTo(0, scrollY);
  lastRoute = r;
}

// ---------- debts ----------

const debtTypeOptions = DEBT_TYPES.map((t) => ({ value: t.key, label: t.label }));
const liveDebtOptions = () => monsters().filter((m) => m.alive).map((m) => ({ value: m.id, label: `${m.name} (${fmt(m.balance)})` }));

/** With `draft` (an array), the new debt is added to it instead of saved: used by account setup. */
/** Optional details: promo rates and payment pauses (deferment/forbearance). */
function debtDetailFields(m = null) {
  return [
    { name: 'promoEnds', label: 'Promo rate ends (optional)', type: 'date', value: m?.promoEnds || '', hint: 'For a 0% or intro rate: the day it ends. The rate above applies until then.' },
    { name: 'aprAfter', label: 'Rate after the promo (APR %)', type: 'percent', value: m?.aprAfter ?? '' },
    { name: 'pauseUntil', label: 'Payments paused until (optional)', type: 'date', value: m?.pauseUntil || '', hint: 'Deferment or forbearance: no payment is due through this date.' },
    { name: 'pauseAccrues', label: 'Interest builds up while paused', type: 'checkbox', value: m ? m.pauseAccrues : true, hint: 'Turn off for subsidized federal loans in deferment.' },
    { name: 'capitalize', label: 'Add unpaid interest to the balance when the pause ends', type: 'checkbox', value: m ? m.capitalize : true },
  ];
}

function checkDebtDetails(v) {
  if (v.promoEnds && v.aprAfter == null) return 'Enter the rate that applies after the promo ends.';
  return '';
}

function addDebt(onDone, draft = null) {
  openForm({
    title: 'New debt',
    intro: 'Enter it as it is today. It becomes a monster: bigger balance, bigger monster; higher interest, angrier color.',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, placeholder: 'e.g. Visa card' },
      { name: 'type', label: 'Type', type: 'select', options: debtTypeOptions, value: 'credit' },
      { name: 'balance', label: 'Current balance', type: 'money', required: true, positive: true },
      { name: 'apr', label: 'Interest rate (APR %)', type: 'percent', required: true },
      { name: 'minPayment', label: 'Minimum monthly payment', type: 'money', required: true, hint: 'On an income-driven student loan plan, enter your plan payment.' },
      { name: 'dueDay', label: 'Due day of month (1–31)', type: 'int', required: true, min: 1, maxValue: 31, value: 1 },
      { name: 'include', label: 'Fight this debt', type: 'checkbox', value: true, hint: 'Uncheck to keep it (for example a mortgage) off the battleground and out of the plan.' },
      { name: 'autoInterest', label: 'Add interest automatically each month', type: 'checkbox', value: true, hint: 'Credit cards are charged daily interest, and none for a month you pay the previous balance in full.' },
      ...debtDetailFields(),
    ],
    submitLabel: 'Add debt',
    onSubmit: (v) => {
      const err = checkDebtDetails(v);
      if (err) return err;
      const today = todayISO();
      const debt = {
        id: uid(), name: v.name, type: v.type, startBalance: v.balance, apr: v.apr, minPayment: v.minPayment,
        dueDay: v.dueDay, include: v.include, autoInterest: v.autoInterest, createdAt: today, accruedThrough: today, killRewarded: false,
        promoEnds: v.promoEnds, aprAfter: v.promoEnds ? v.aprAfter : null, pauseUntil: v.pauseUntil, pauseAccrues: v.pauseAccrues, capitalize: v.capitalize, bossPhases: [],
      };
      if (draft) draft.push(debt);
      else {
        commit((s) => s.debts.push(debt));
        toast(`${v.name} has appeared on the battleground!`);
      }
      if (onDone) setTimeout(onDone, 0);
    },
  });
}

function editDebt(m) {
  openForm({
    title: `Edit ${m.name}`,
    intro: 'To change the balance, use “Update balance” instead.',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, value: m.name },
      { name: 'type', label: 'Type', type: 'select', options: debtTypeOptions, value: m.type },
      { name: 'apr', label: 'Interest rate (APR %)', type: 'percent', required: true, value: m.apr, hint: 'If it has a promo rate, enter the promo rate here.' },
      { name: 'minPayment', label: 'Minimum monthly payment', type: 'money', required: true, value: m.minPayment, hint: 'On an income-driven student loan plan, enter your plan payment.' },
      { name: 'dueDay', label: 'Due day of month (1–31)', type: 'int', required: true, min: 1, maxValue: 31, value: m.dueDay },
      { name: 'include', label: 'Fight this debt', type: 'checkbox', value: m.include },
      { name: 'autoInterest', label: 'Add interest automatically each month', type: 'checkbox', value: m.autoInterest },
      ...debtDetailFields(m),
    ],
    onSubmit: (v) => {
      const err = checkDebtDetails(v);
      if (err) return err;
      if (!v.promoEnds) v.aprAfter = null;
      commit((s) => {
        const d = s.debts.find((x) => x.id === m.id);
        // Turning auto-interest back on must not back-charge the months it was off.
        if (v.autoInterest && !d.autoInterest) d.accruedThrough = todayISO();
        Object.assign(d, v);
      });
      openDebt(m.id);
    },
    extra: [{ label: 'Delete', action: 'delete', className: 'bad' }],
    onExtra: (action, close) => {
      if (action !== 'delete') return;
      askConfirm(`Delete ${m.name} and its whole history?`, { okLabel: 'Delete', danger: true }).then((ok) => {
        if (!ok) return;
        close();
        commitUndoable(`Deleted ${m.name}`, (s) => {
          s.debts = s.debts.filter((d) => d.id !== m.id);
          s.ledger = s.ledger.filter((e) => e.debtId !== m.id);
          s.scheduled = s.scheduled.filter((x) => x.debtId !== m.id);
          for (const e of s.expenses) if (e.debtId === m.id) e.debtId = null; // card purchases stay as spending
        });
      });
    },
  });
}

/**
 * Log a payment (attack) or a new charge. With debtId the debt is fixed; without it the form asks which debt.
 * `fromBattle` reopens the monster afterwards with the hit animation.
 */
/** prefill fills the form (used when a planned payment happens); onDone(state) runs inside the save. */
function logDebtEntry(kind, debtId = null, fromBattle = false, prefill = {}, onDone = null) {
  const isAttack = kind === 'payment';
  const fixed = debtId ? monsters().find((m) => m.id === debtId) : null;
  const options = liveDebtOptions();
  if (!fixed && !options.length) return toast('Add a debt first.');
  const first = fixed || monsters().find((m) => m.id === options[0].value);
  const sheet = openForm({
    lead: fixed ? dioramaHtml(fixed, 'short') : '',
    className: fixed ? 'debt-sheet' : '',
    title: isAttack ? (fixed ? `Pay ${fixed.name}` : 'Log a debt payment') : (fixed ? `New charge on ${fixed.name}` : 'Log a new charge'),
    intro: isAttack ? 'A payment you made. Every coin is damage.' : 'New spending or fees on a debt. It heals the monster.',
    fields: [
      ...(fixed ? [] : [{ name: 'debtId', label: 'Debt', type: 'select', options, value: options[0].value }]),
      { name: 'amount', label: 'Amount', type: 'money', required: true, positive: true, value: prefill.amount ?? (isAttack ? Math.min(first.minPayment, first.balance) || '' : '') },
      ...(isAttack ? withAccount('Paid from', ['cash', 'savings']).map((f) => (prefill.accountId !== undefined ? { ...f, value: prefill.accountId || '' } : f)) : []),
      { name: 'date', label: 'Date', type: 'date', value: prefill.date || todayISO() },
      { name: 'note', label: 'Note (optional)', type: 'text', value: prefill.note || '' },
    ],
    submitLabel: isAttack ? 'Strike!' : 'Add charge',
    onSubmit: (v) => {
      const m = monsters().find((x) => x.id === (fixed ? fixed.id : v.debtId));
      const res = saveDebtEntry(kind, m, v, onDone);
      if (res.error) return res.error;
      afterDebtEntry(kind, m, v.amount, res, fromBattle);
    },
  });
  paintDioramas(sheet.el);
  if (isAttack) {
    // live preview of how hard the payment hits
    const input = sheet.el.querySelector('input[name=amount]');
    const prev = document.createElement('p');
    prev.className = 'power';
    input.closest('.field').appendChild(prev);
    const update = () => {
      const mm = fixed || monsters().find((x) => x.id === sheet.el.querySelector('[name=debtId]')?.value);
      const c = parseMoney(input.value.trim());
      prev.innerHTML = mm && c > 0 ? `Attack power ${powerLabel(Math.min(c, mm.balance), mm)}` : '';
    };
    input.addEventListener('input', update);
    sheet.el.querySelector('[name=debtId]')?.addEventListener('change', update);
    update();
  }
}

/** Save a payment (attack) or charge on monster m. Returns { error } or { killed }. */
function saveDebtEntry(kind, m, v, onDone = null) {
  const isAttack = kind === 'payment';
  if (isAttack && v.amount > m.balance) return { error: `That's more than what's owed (${fmt(m.balance)}).` };
  if (v.date > todayISO()) return { error: 'Pick today or an earlier date.' };
  let killed = false;
  commit((s) => {
    s.ledger.push({ id: uid(), debtId: m.id, kind, amount: isAttack ? -v.amount : v.amount, date: v.date, note: v.note || '', auto: false, accountId: isAttack ? v.accountId || null : null });
    markActive();
    onDone?.(s);
    if (isAttack) {
      const d = s.debts.find((x) => x.id === m.id);
      if (m.balance - v.amount <= 0 && !d.killRewarded) {
        d.killRewarded = true;
        killed = true;
      }
    }
  });
  return { killed };
}

/** After saving: on the Battle tab a payment plays its attack on the stage; elsewhere a toast (and the hit on the debt's sheet). */
function afterDebtEntry(kind, m, amount, { killed }, fromBattle) {
  const isAttack = kind === 'payment';
  const msg = killed ? `${m.name} is paid off!` : isAttack ? `Paid ${fmt(amount)} toward ${m.name}.` : `${fmt(amount)} added to ${m.name}.`;
  if (isAttack && fromBattle && route() === 'battle' && document.getElementById('b-stage') && m.include) {
    holdToasts(true);
    playAttack(fighterOf(m), amount, () => {
      render();
      holdToasts(false);
    });
    return;
  }
  toast(msg, isAttack ? 'good' : 'bad');
  if (fromBattle && !killed) openDebt(m.id, isAttack ? amount : -amount);
}

function scoutDebt(m) {
  openForm({
    title: `Update ${m.name}'s balance`,
    intro: `The app thinks you owe <b>${fmt(m.balance)}</b>. Enter the real balance from your statement and the difference is recorded.`,
    fields: [{ name: 'balance', label: 'Real balance', type: 'money', required: true, value: m.balance }],
    submitLabel: 'Update',
    onSubmit: (v) => {
      const delta = v.balance - m.balance;
      if (delta === 0) return void openDebt(m.id);
      commit((s) => {
        s.ledger.push({ id: uid(), debtId: m.id, kind: 'correction', amount: delta, date: todayISO(), note: '', auto: false });
        markActive();
      });
      openDebt(m.id);
    },
  });
}

function openDebt(id, hit = 0) {
  const m = monsters().find((x) => x.id === id);
  if (!m) return;
  const own = state.ledger.filter((e) => e.debtId === id).sort((a, b) => b.date.localeCompare(a.date));
  const paid = own.filter((e) => e.kind === 'payment').reduce((s, e) => s - e.amount, 0);
  const interest = own.filter((e) => e.kind === 'interest').reduce((s, e) => s + e.amount, 0);
  const html = `
    <div class="dio-wrap ${hit > 0 ? 'hit' : hit < 0 ? 'heal' : ''}">
      ${dioramaHtml(m)}
      ${hit ? `<span class="dmg ${hit < 0 ? 'heal' : ''}">${hit > 0 ? '−' : '+'}${fmt(Math.abs(hit))}</span>` : ''}
    </div>
    <div class="debt-head">
      <h2>${esc(m.name)}</h2>
      <p class="sub">${debtSubline(m)}${m.alive ? '' : ' · Paid off'}${m.include ? '' : ' · Benched'}</p>
      ${hpBar(m.hpPct, `${fmt(Math.max(0, m.balance))} owed`, m.boss && m.alive)}
      <p class="sub">Total paid: <em>${fmt(totalPaid(m))}</em></p>
    </div>
    ${m.missed ? `<p class="bad">Missed payment: less than the minimum was paid for the ${dayLabel(m.missed.due)} due date. Late fees and a higher rate may follow.</p>` : ''}
    ${m.regen ? `<p class="bad">It heals ${fmt(m.monthly)} a month but the minimum only hits for ${fmt(m.minPayment)}. Pay more than the minimum to make progress.</p>` : ''}
    ${m.promo ? `<p class="hint">Promo rate: ${m.apr}% until ${dayLabel(m.promo.ends)}, then ${m.promo.after}%.</p>` : ''}
    ${m.paused ? `<p class="hint">Payments paused until ${dayLabel(m.pauseUntil)}. Interest ${m.pauseAccrues ? `builds up${m.capitalize ? ' and is added to the balance when the pause ends' : ''}` : "doesn't build up"}.</p>` : ''}
    <div class="stats">
      <div><small>APR</small><b>${m.rate}%</b></div>
      <div><small>Interest / mo</small><b>${fmt(m.monthly)}</b></div>
      <div><small>Minimum</small><b>${fmt(m.minPayment)}</b></div>
      <div><small>Due day</small><b>${m.dueDay}</b></div>
      <div><small>Paid so far</small><b>${fmt(paid)}</b></div>
      <div><small>Interest added</small><b>${fmt(interest)}</b></div>
    </div>
    <div class="row-buttons">
      ${m.alive ? '<button class="btn primary" data-action="attack">Pay</button>' : ''}
      <button class="btn" data-action="scout">Update balance</button>
      ${m.alive ? '<button class="btn" data-action="plan">Plan a payment</button>' : ''}
      <button class="btn" data-action="charge">+ Charge</button>
      <button class="btn" data-action="edit">Edit</button>
    </div>
    <h3>History</h3>
    ${own.length ? `<ul class="log">${own.slice(0, 50).map((e) => `
      <li class="${e.amount < 0 ? 'income' : 'expense'}">
        <button class="row-btn grow" data-action="edit-ledger" data-id="${e.id}"><span class="grow">${ENTRY_KINDS[e.kind].label}${e.note ? ` · ${esc(e.note)}` : ''}<small>${dayLabel(e.date)}${e.expenseId ? ' · from an expense' : ''}</small></span>
        <b>${e.amount < 0 ? '−' : '+'}${fmt(Math.abs(e.amount))}</b></button>
        <button class="x" data-action="del-ledger" data-id="${e.id}" aria-label="Delete">×</button>
      </li>`).join('')}</ul>` : '<p class="empty">No history yet.</p>'}
    <p class="hint">Started at ${fmt(m.startBalance)} on ${dayLabel(m.createdAt)}.</p>`;

  const sheet = openSheet(html, {
    className: 'debt-sheet',
    className: 'debt',
    onAction: (action, el, { close }) => {
      if (action === 'del-ledger') {
        askConfirm('Delete this history entry? The balance will be recalculated.', { okLabel: 'Delete', danger: true }).then((ok) => {
          if (!ok) return;
          close();
          deleteLedgerEntry(el.dataset.id);
          openDebt(id);
        });
        return;
      }
      if (action === 'edit-ledger') {
        close();
        return editLedgerEntry(state.ledger.find((e) => e.id === el.dataset.id));
      }
      close();
      if (action === 'attack') payMonster(m.id);
      if (action === 'charge') logDebtEntry('charge', m.id, true);
      if (action === 'scout') scoutDebt(m);
      if (action === 'plan') debtPaymentForm(null, m.id);
      if (action === 'edit') editDebt(m);
    },
  });
  paintSprites(sheet.el);
  paintDioramas(sheet.el);
}

// ---------- spending & income ----------

const FREQ_OPTIONS = Object.entries(FREQUENCIES).map(([value, f]) => ({ value, label: f.label }));
const freqLabel = (f) => FREQUENCIES[f]?.label || '';
const catName = (id) => (id === OTHER_CATEGORY_ID ? 'Unplanned' : state.categories.find((c) => c.id === id)?.name || '?');

/** One-off income for a single month. Regular pay lives in income sources. */
function addIncome() {
  openForm({
    title: 'Log extra income',
    intro: 'A one-off amount, like a bonus, a gift or a side job. Your regular pay is set under Income sources.',
    fields: [
      { name: 'amount', label: 'Amount', type: 'money', required: true, positive: true },
      { name: 'source', label: 'What was it?', type: 'text', placeholder: 'e.g. Bonus' },
      ...withAccount('Into'),
      { name: 'date', label: 'Date', type: 'date', value: todayISO() },
    ],
    onSubmit: (v) => {
      commit((s) => {
        s.incomes.push({ id: uid(), amount: v.amount, source: v.source || '', date: v.date, note: '', accountId: v.accountId || null });
        markActive();
      });
      toast(`+${fmt(v.amount)} logged.`, 'good');
    },
  });
}

function expenseOptions() {
  return [
    ...state.categories.filter((c) => c.kind !== 'debt').map((c) => ({ value: c.id, label: c.kind === 'savings' ? `${c.name} (savings)` : c.name })),
    { value: OTHER_CATEGORY_ID, label: 'Unplanned / other' },
  ];
}

/** "Paid with": an account, or a credit card/other debt (the purchase adds to that debt). */
function paidWithField(current = {}) {
  const bal = accountBalances(state);
  const accts = state.accounts.filter((a) => a.type !== 'invest').map((a) => ({ value: `a:${a.id}`, label: `${a.name} · ${fmt(bal.get(a.id))}` }));
  const cards = monsters().filter((m) => m.type === 'credit' || m.type === 'other').map((m) => ({ value: `d:${m.id}`, label: `${m.name} (adds to the card)` }));
  if (!accts.length && !cards.length) return [];
  const value = current.debtId ? `d:${current.debtId}` : current.accountId ? `a:${current.accountId}`
    : current.accountId === null && current.id ? '' : accts.find((o) => state.accounts.find((a) => `a:${a.id}` === o.value)?.type === 'cash')?.value || accts[0]?.value || '';
  return [{ name: 'paidWith', label: 'Paid with', type: 'select', options: [...accts, ...cards, { value: '', label: "Don't track" }], value }];
}

const parsePaidWith = (v) => ({
  accountId: v?.startsWith('a:') ? v.slice(2) : null,
  debtId: v?.startsWith('d:') ? v.slice(2) : null,
});

/** Apply an expense's side effects: a card purchase becomes a linked charge on that debt. */
function syncCardCharge(s, e) {
  s.ledger = s.ledger.filter((x) => x.expenseId !== e.id);
  if (e.debtId) s.ledger.push({ id: uid(), debtId: e.debtId, kind: 'charge', amount: e.amount, date: e.date, note: e.note || catName(e.categoryId), auto: false, accountId: null, expenseId: e.id });
}

/**
 * Log or edit an expense. `prefill` fills a new one (used when a planned payment happens); onDone runs inside the save.
 * With `existing`, the form edits it and offers Delete.
 */
function expenseForm(existing = null, prefill = {}, onDone = null) {
  const options = expenseOptions();
  const base = existing || prefill;
  openForm({
    title: existing ? 'Edit expense' : prefill.title || 'Log expense',
    intro: existing ? '' : `Pick the budget line it comes from. For debt payments use “+ Debt payment”.${state.accounts.some((a) => a.type === 'savings') ? ' Money logged to a savings line moves into your savings account.' : ''}`,
    fields: [
      { name: 'amount', label: 'Amount', type: 'money', required: true, positive: true, value: base.amount ?? '' },
      { name: 'categoryId', label: 'Budget line', type: 'select', options, value: options.some((o) => o.value === base.categoryId) ? base.categoryId : options[0].value },
      ...paidWithField(existing || { accountId: prefill.accountId }),
      { name: 'note', label: 'Note (optional)', type: 'text', value: base.note || '' },
      { name: 'date', label: 'Date', type: 'date', value: base.date || todayISO() },
    ],
    extra: existing ? [{ label: 'Delete', action: 'delete', className: 'bad' }] : [],
    onExtra: (_a, close) => {
      close();
      deleteExpense(existing.id);
    },
    onSubmit: (v) => {
      const { accountId, debtId } = parsePaidWith(v.paidWith);
      const isSaving = state.categories.find((c) => c.id === v.categoryId)?.kind === 'savings';
      const toAccountId = isSaving && !debtId ? state.accounts.find((a) => a.type === 'savings' && a.id !== accountId)?.id || null : null;
      const fields = { amount: v.amount, categoryId: v.categoryId, note: v.note || '', date: v.date, accountId, toAccountId, debtId };
      if (existing) {
        commitUndoable('Expense changed', (s) => {
          const e = s.expenses.find((x) => x.id === existing.id);
          Object.assign(e, fields);
          syncCardCharge(s, e);
        });
        return;
      }
      commit((s) => {
        const e = { id: uid(), ...fields };
        s.expenses.push(e);
        syncCardCharge(s, e);
        markActive();
        onDone?.(s);
      });
      const cat = summary(ymOf(v.date)).categories.find((c) => c.id === v.categoryId);
      const over = cat && cat.limit > 0 && cat.remaining < 0;
      const card = debtId ? state.debts.find((d) => d.id === debtId)?.name : null;
      toast(over ? `${cat.name} is over budget by ${fmt(-cat.remaining)}` : card ? `Logged on ${card}. It grew by ${fmt(v.amount)}.`   : 'Logged.', over || card ? 'bad' : '');
    },
  });
}

const addExpense = (prefill = {}, onDone = null) => expenseForm(null, prefill, onDone);

function deleteExpense(id) {
  commitUndoable('Expense deleted', (s) => {
    s.expenses = s.expenses.filter((x) => x.id !== id);
    s.ledger = s.ledger.filter((x) => x.expenseId !== id);
  });
}

function deleteLedgerEntry(id) {
  const e = state.ledger.find((x) => x.id === id);
  commitUndoable('Entry deleted', (s) => {
    s.ledger = s.ledger.filter((x) => x.id !== id);
    if (e?.expenseId) s.expenses = s.expenses.filter((x) => x.id !== e.expenseId); // a card purchase: remove the expense too
  });
}

/** Edit a payment, charge, fee or balance update on a debt. */
function editLedgerEntry(e) {
  if (!e) return;
  if (e.expenseId) return expenseForm(state.expenses.find((x) => x.id === e.expenseId));
  const isPay = e.kind === 'payment';
  openForm({
    title: `Edit ${ENTRY_KINDS[e.kind].label.toLowerCase()}`,
    intro: e.kind === 'correction' ? 'A balance update records the difference from what the app expected. Enter a negative amount for a decrease.' : '',
    fields: [
      e.kind === 'correction'
        ? { name: 'amount', label: 'Change', type: 'text', required: true, value: centsToInput(e.amount) }
        : { name: 'amount', label: 'Amount', type: 'money', required: true, positive: true, value: Math.abs(e.amount) },
      ...(isPay ? withAccount('Paid from', ['cash', 'savings']).map((f) => ({ ...f, value: e.accountId || '' })) : []),
      { name: 'date', label: 'Date', type: 'date', value: e.date },
      { name: 'note', label: 'Note (optional)', type: 'text', value: e.note },
    ],
    extra: [{ label: 'Delete', action: 'delete', className: 'bad' }],
    onExtra: (_a, close) => {
      close();
      deleteLedgerEntry(e.id);
    },
    onSubmit: (v) => {
      let amount;
      if (e.kind === 'correction') {
        amount = parseMoney(v.amount);
        if (amount == null) return 'Enter an amount, like -25.00';
      } else amount = isPay ? -v.amount : v.amount;
      commitUndoable('Entry changed', (s) => Object.assign(s.ledger.find((x) => x.id === e.id), { amount, date: v.date, note: v.note || '', ...(isPay ? { accountId: v.accountId || null } : {}) }));
    },
  });
}

/** Edit one-off extra income. */
function editIncome(i) {
  openForm({
    title: 'Edit income',
    fields: [
      { name: 'amount', label: 'Amount', type: 'money', required: true, positive: true, value: i.amount },
      { name: 'source', label: 'What was it?', type: 'text', value: i.source },
      ...withAccount('Into').map((f) => ({ ...f, value: i.accountId || '' })),
      { name: 'date', label: 'Date', type: 'date', value: i.date },
    ],
    extra: [{ label: 'Delete', action: 'delete', className: 'bad' }],
    onExtra: (_a, close) => {
      close();
      commitUndoable('Income deleted', (s) => (s.incomes = s.incomes.filter((x) => x.id !== i.id)));
    },
    onSubmit: (v) => commitUndoable('Income changed', (s) => Object.assign(s.incomes.find((x) => x.id === i.id), { amount: v.amount, source: v.source || '', date: v.date, accountId: v.accountId || null })),
  });
}

// ---------- planned one-off payments ----------

function upcomingCard() {
  if (!state.scheduled.length) return '';
  const today = todayISO();
  const items = state.scheduled.slice().sort((a, b) => a.date.localeCompare(b.date));
  return `
    <section class="card">
      <h2>Upcoming payments</h2>
      <ul class="rows">${items.map((x) => {
        const due = x.date <= today;
        const debt = x.kind === 'debt' ? monsters().find((m) => m.id === x.debtId) : null;
        const what = debt ? `Payment · ${x.repeat === 'monthly' ? 'every month' : 'one time'}` : catName(x.categoryId);
        return `
          <li class="${due ? 'due' : ''}">
            <button class="row-btn" data-action="edit-scheduled" data-id="${x.id}">
              ${debt ? spriteCanvas(debt.species.key, debt.temper.key, 3, '', debt.dmg) : ''}
              <span class="grow">${esc(debt ? debt.name : x.name)}<small>${due ? 'Due ' : ''}${dayLabel(x.date)} · ${esc(what)}</small></span>
              <b>${fmt(x.amount)}</b>
            </button>
          </li>
          ${due ? `<li class="due-actions"><span class="grow">Did it happen?</span>
            <button class="btn primary" data-action="log-scheduled" data-id="${x.id}">Log it</button>
            <button class="btn" data-action="skip-scheduled" data-id="${x.id}">${x.repeat === 'monthly' ? 'Skip this one' : 'Skip'}</button></li>` : ''}`;
      }).join('')}</ul>
      <p class="hint">Planned payments count in your projections. They become real when you log them. A debt payment above its minimum counts as extra.</p>
    </section>`;
}

function scheduleForm(item = null) {
  const options = expenseOptions();
  const acct = withAccount('Pay from', ['cash', 'savings']);
  if (item && acct[0]) acct[0].value = item.accountId || '';
  openForm({
    title: item ? `Edit ${item.name}` : 'Plan a one-off payment',
    intro: 'Something you know is coming, like Black Friday shopping, a trip or a car repair. It shows in your projections until it happens.',
    fields: [
      { name: 'name', label: 'What is it?', type: 'text', required: true, value: item?.name || '', placeholder: 'e.g. Black Friday shopping', max: 60 },
      { name: 'amount', label: 'Amount', type: 'money', required: true, positive: true, value: item?.amount ?? '' },
      { name: 'date', label: 'Date', type: 'date', value: item?.date || todayISO() },
      { name: 'categoryId', label: 'Budget line', type: 'select', options, value: item?.categoryId || OTHER_CATEGORY_ID },
      ...acct,
    ],
    submitLabel: item ? 'Save' : 'Plan it',
    extra: item ? [{ label: 'Delete', action: 'delete', className: 'bad' }] : [],
    onExtra: (_x, close) => {
      close();
      commit((s) => (s.scheduled = s.scheduled.filter((x) => x.id !== item.id)));
    },
    onSubmit: (v) => {
      const fields = { name: v.name, amount: v.amount, date: v.date, categoryId: v.categoryId, accountId: v.accountId || null };
      commit((s) => {
        if (item) Object.assign(s.scheduled.find((x) => x.id === item.id), fields);
        else s.scheduled.push({ id: uid(), note: '', ...fields });
      });
      toast(item ? 'Saved.' : `${v.name} planned for ${dayLabel(v.date)}.`);
    },
  });
}

const nextDueDate = (dueDay) => {
  const today = todayISO();
  const thisMonth = dueDateIn(ymOf(today), dueDay);
  return thisMonth >= today ? thisMonth : dueDateIn(addMonths(ymOf(today), 1), dueDay);
};

/** A repeating payment moves to next month; a one-time payment (or one for a paid-off debt) is removed. */
function advanceScheduled(s, id) {
  const x = s.scheduled.find((y) => y.id === id);
  if (!x) return;
  const debtAlive = x.kind !== 'debt' || monsters().some((m) => m.id === x.debtId && m.alive);
  if (x.repeat === 'monthly' && debtAlive) x.date = dueDateIn(addMonths(ymOf(x.date), 1), x.day || Number(x.date.slice(8)));
  else s.scheduled = s.scheduled.filter((y) => y.id !== id);
}

function debtPaymentForm(item = null, debtId = null) {
  const live = monsters().filter((m) => m.alive);
  const first = live.find((m) => m.id === (item?.debtId || debtId)) || live[0];
  if (!first) return toast('Add a debt first.');
  const acct = withAccount('Pay from', ['cash', 'savings']);
  if (item && acct[0]) acct[0].value = item.accountId || '';
  openForm({
    title: item ? `Edit payment to ${first.name}` : 'Plan a debt payment',
    intro: 'Set when you will pay a card or loan. On the day, the app asks you to log it. Paying more than the minimum counts as extra in your projections.',
    fields: [
      ...(item || debtId ? [] : [{ name: 'debtId', label: 'Debt', type: 'select', options: live.map((m) => ({ value: m.id, label: `${m.name} (min ${fmt(m.minPayment)}, due day ${m.dueDay})` })), value: first.id }]),
      { name: 'amount', label: 'Amount', type: 'money', required: true, positive: true, value: item?.amount ?? first.minPayment },
      { name: 'date', label: 'Pay on', type: 'date', value: item?.date || nextDueDate(first.dueDay), hint: item || debtId ? '' : 'Leave this date to use the chosen debt\'s next due date.' },
      { name: 'repeat', label: 'Repeat every month on this day', type: 'checkbox', value: item ? item.repeat === 'monthly' : true },
      ...acct,
    ],
    submitLabel: item ? 'Save' : 'Plan it',
    extra: item ? [{ label: 'Delete', action: 'delete', className: 'bad' }] : [],
    onExtra: (_x, close) => {
      close();
      commit((s) => (s.scheduled = s.scheduled.filter((x) => x.id !== item.id)));
    },
    onSubmit: (v) => {
      const debt = live.find((m) => m.id === (v.debtId || item?.debtId || debtId)) || first;
      // A default date for the first debt in the list moves to the chosen debt's own due date.
      const date = !item && !debtId && v.date === nextDueDate(first.dueDay) ? nextDueDate(debt.dueDay) : v.date;
      const fields = {
        kind: 'debt', name: debt.name, debtId: debt.id, amount: v.amount, date, categoryId: OTHER_CATEGORY_ID,
        accountId: v.accountId || null, repeat: v.repeat ? 'monthly' : 'none', day: Number(date.slice(8)),
      };
      commit((s) => {
        if (item) Object.assign(s.scheduled.find((x) => x.id === item.id), fields);
        else s.scheduled.push({ id: uid(), note: '', ...fields });
      });
      toast(`${debt.name}: ${fmt(v.amount)} planned for ${dayLabel(date)}${v.repeat ? ', every month' : ''}.`);
    },
  });
}

function logScheduled(item) {
  if (item.kind === 'debt') {
    return logDebtEntry('payment', item.debtId, false, {
      amount: Math.min(item.amount, monsters().find((m) => m.id === item.debtId)?.balance || item.amount),
      date: item.date > todayISO() ? todayISO() : item.date,
      accountId: item.accountId,
      note: item.repeat === 'monthly' ? 'Planned monthly payment' : 'Planned payment',
    }, (s) => advanceScheduled(s, item.id));
  }
  addExpense(
    { title: `Log ${item.name}`, amount: item.amount, categoryId: item.categoryId, note: item.name, date: item.date > todayISO() ? todayISO() : item.date, accountId: item.accountId },
    (s) => (s.scheduled = s.scheduled.filter((x) => x.id !== item.id)),
  );
}

function categoryForm(c, preset = {}) {
  const isNew = !c;
  const isDebt = (c?.id ?? preset.id) === DEBT_CATEGORY_ID;
  const ym = ui.month;
  const plan = monthlyPlan(state, debtMinsTotal(), ym);
  const current = c ? (c.overrides && ym in c.overrides ? c.overrides[ym] : c.limit) : null;
  const free = plan.unallocated + (current || 0);
  const monthName = monthLabel(ym, { month: 'long' });
  openForm({
    title: isNew ? (isDebt ? 'Extra debt payments' : 'Add to your budget') : `Edit ${c.name}`,
    intro: `${isDebt ? 'Money on top of your minimum payments each month. It becomes extra damage on your debts in your plan. ' : ''}You have <b>${fmt(free)}</b> a month not yet assigned.`,
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, value: c?.name || preset.name || '', placeholder: 'e.g. Groceries' },
      ...(isDebt ? [] : [{
        name: 'kind', label: 'Type', type: 'select', value: c?.kind || preset.kind || 'need',
        options: Object.entries(CATEGORY_KINDS).filter(([k]) => k !== 'debt').map(([value, label]) => ({ value, label })),
      }]),
      { name: 'limit', label: 'Amount per month', type: 'money', required: true, value: current ?? '' },
      ...(isNew ? [] : [{ name: 'onlyThisMonth', label: `Only for ${monthName}`, type: 'checkbox', value: !!(c.overrides && ym in c.overrides), hint: `Use a different amount just in ${monthName}; other months keep ${fmt(c.limit)}.` }]),
      ...(isDebt ? [] : [
        { name: 'rollover', label: 'Carry unspent money to next month', type: 'checkbox', value: c?.rollover ?? false, hint: 'Good for costs that come and go, like car repairs or gifts. Overspending carries too.' },
        { name: 'target', label: 'Savings goal total (optional)', type: 'money', value: c?.target ?? '', hint: 'For savings: the total you want to reach. Log money you set aside as an expense on this line to track it.' },
        { name: 'targetDate', label: 'Reach it by (optional)', type: 'date', value: c?.targetDate || '', hint: 'Shows how much to put aside each month to make it in time.' },
      ]),
    ],
    extra: isNew ? [] : [{ label: 'Delete', action: 'delete', className: 'bad' }],
    onExtra: (action, close) => {
      askConfirm(`Remove ${c.name} from your budget? Anything already logged to it moves to Unplanned.`, { okLabel: 'Remove', danger: true }).then((ok) => {
        if (!ok) return;
        close();
        commitUndoable(`Removed ${c.name}`, (s) => {
          s.categories = s.categories.filter((x) => x.id !== c.id);
          for (const e of s.expenses) if (e.categoryId === c.id) e.categoryId = OTHER_CATEGORY_ID;
        });
      });
    },
    onSubmit: (v) => {
      const fields = {
        name: v.name, kind: isDebt ? 'debt' : v.kind, target: isDebt ? null : v.target || null,
        targetDate: isDebt ? null : v.targetDate || null, rollover: isDebt ? false : !!v.rollover,
      };
      commit((s) => {
        if (isNew) return void s.categories.push({ id: isDebt ? DEBT_CATEGORY_ID : uid(), limit: v.limit, overrides: {}, ...fields });
        const x = s.categories.find((y) => y.id === c.id);
        Object.assign(x, fields);
        x.overrides = { ...(x.overrides || {}) };
        if (v.onlyThisMonth) x.overrides[ym] = v.limit;
        else {
          x.limit = v.limit;
          delete x.overrides[ym];
        }
      });
    },
  });
}

/** Add or edit a recurring income source or fixed bill. */
function recurringForm(list, item = null) {
  const isIncome = list === 'incomeSources';
  openForm({
    title: item ? `Edit ${item.name}` : isIncome ? 'Add an income source' : 'Add a recurring bill',
    intro: isIncome
      ? 'Regular take-home pay, after tax.'
      : 'Something you pay again and again that never gets paid off: rent, a lease, insurance, a subscription. Loans and cards are debts instead.',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, value: item?.name || '', placeholder: isIncome ? 'e.g. Paycheck' : 'e.g. Rent' },
      { name: 'amount', label: 'Amount', type: 'money', required: true, positive: true, value: item?.amount ?? '' },
      { name: 'freq', label: 'How often', type: 'select', options: FREQ_OPTIONS, value: item?.freq || (isIncome ? 'weekly' : 'monthly') },
      ...(isIncome ? [{ name: 'variable', label: 'The amount varies (irregular income)', type: 'checkbox', value: item?.variable ?? false, hint: 'Your budget uses the average of the paydays you record (+ Payday) over the last 3 months, and the amount above until then.' }] : []),
      { name: 'nextDate', label: isIncome ? 'Next payday (optional)' : 'Next due date (optional)', type: 'date', value: item?.nextDate || '', hint: 'With a date and an account, it posts to the account automatically each time. A date of today or earlier posts right away.' },
      ...(state.accounts.length ? [{ ...accountField(isIncome ? 'Paid into' : 'Paid from', isIncome ? ['cash', 'savings', 'invest'] : ['cash', 'savings']), value: item ? item.accountId || '' : accountField('x', ['cash']).value }] : []),
    ],
    extra: item ? [{ label: 'Delete', action: 'delete', className: 'bad' }] : [],
    onExtra: (_a, close) => {
      close();
      commitUndoable(`Deleted ${item.name}`, (s) => (s[list] = s[list].filter((x) => x.id !== item.id)));
    },
    onSubmit: (v) => {
      const fields = {
        name: v.name, amount: v.amount, freq: v.freq, variable: isIncome && !!v.variable,
        nextDate: v.nextDate || null, day: v.nextDate ? Number(v.nextDate.slice(8)) : null, accountId: v.accountId || null,
      };
      commit((s) => {
        if (item) Object.assign(s[list].find((x) => x.id === item.id), fields);
        else s[list].push({ id: uid(), ...fields });
      });
      runRecurring();
      render();
    },
  });
}

function editGoals() {
  openForm({
    title: 'Your goals',
    intro: 'Add budget lines for new goals on the Budget tab.',
    fields: Object.entries(GOALS).map(([k, label]) => ({ name: k, label, type: 'checkbox', value: state.goals[k] })),
    onSubmit: (v) => commit((s) => (s.goals = { ...s.goals, ...v })),
  });
}

// ---------- new account setup ----------

const BILL_PRESETS = ['Rent', 'Car lease', 'Car insurance', 'Utilities (power, water, gas)', 'Phone & internet', 'Health insurance', 'Subscriptions & memberships', 'Childcare'];
const EVERYDAY_PRESETS = [['Groceries', 'weekly'], ['Gas & transport', 'weekly']];
const WIZ_STEPS = ['Income', 'Money', 'Bills', 'Debts', 'Goals', 'Summary'];
const MONEY_PRESETS = [['Checking account', 'cash'], ['Cash on hand', 'cash'], ['Savings account', 'savings'], ['Investments (401k, IRA, brokerage)', 'invest']];

async function startNewAccount() {
  if (state.settings.setupDone || hasAnyData()) {
    const ok = await askConfirm(
      'A new account replaces everything on this device: debts, budget, history and level. Download a backup first if you might want it.',
      { title: 'Start a new account?', okLabel: 'Start over', danger: true },
    );
    if (!ok) return;
  }
  runWizard();
}

/**
 * The guided setup. A new account starts from scratch and replaces everything.
 * `update` mode starts from what's already there and only changes income, bills and goals, and adds new
 * accounts, debts and budget lines: nothing is deleted.
 */
function runWizard(update = false) {
  const row = (name = '', freq = 'monthly') => ({ name, raw: '', freq });
  const fromExisting = (list) => state[list].map((r) => ({ ...r, raw: centsToInput(r.amount) }));
  const existingMins = update ? monsters().filter((m) => m.alive).reduce((t, m) => t + m.minPayment, 0) : 0;
  const existingLines = update ? state.categories.reduce((t, c) => t + c.limit, 0) : 0;
  const hasLine = (name) => state.categories.some((c) => c.name.toLowerCase() === name.toLowerCase());
  const d = {
    currency: state.settings.currency,
    income: update ? fromExisting('incomeSources') : [row('Paycheck', 'weekly')],
    money: update ? [] : MONEY_PRESETS.map(([n, type]) => ({ name: n, raw: '', type })),
    bills: update ? fromExisting('bills') : BILL_PRESETS.map((n) => row(n)),
    everyday: update ? [] : EVERYDAY_PRESETS.map(([n, f]) => row(n, f)),
    debts: [],
    goals: update ? { ...state.goals } : { payDebt: true, emergency: true, saveFor: false, fun: true, spendLess: false },
    emergencyRaw: '',
    saveForName: '',
    saveForRaw: '',
    alloc: [],
  };
  let step = 0;
  // Blank means 0; anything else must parse. Returns null for invalid input.
  const amt = (raw) => (String(raw).trim() === '' ? 0 : parseMoney(raw));
  const monthlyOf = (rows) => rows.reduce((s, r) => s + toMonthly(Math.max(0, amt(r.raw) || 0), r.freq), 0);
  const money = (c) => formatMoney(c, d.currency);
  const moneyTotals = () => {
    const t = { cash: 0, savings: 0, invest: 0 };
    for (const r of d.money) t[r.type] += amt(r.raw) || 0;
    return t;
  };
  const totals = () => {
    const income = monthlyOf(d.income);
    const bills = monthlyOf(d.bills);
    const everyday = monthlyOf(d.everyday);
    const mins = existingMins + d.debts.reduce((s, x) => s + x.minPayment, 0);
    return { income, bills, everyday, mins, leftover: income - bills - everyday - mins };
  };

  const rowsHtml = (list, opts = FREQ_OPTIONS, f = 'freq') => `
    <div class="wrows">${d[list].map((r, i) => `
      <div class="wrow">
        <input class="wname" data-list="${list}" data-i="${i}" data-f="name" value="${esc(r.name)}" maxlength="40" aria-label="Name" placeholder="Name">
        <button class="x" data-action="del-row" data-list="${list}" data-i="${i}" aria-label="Remove ${esc(r.name)}">×</button>
        <input class="wamt" data-list="${list}" data-i="${i}" data-f="raw" value="${esc(r.raw)}" inputmode="decimal" autocomplete="off" placeholder="0.00" aria-label="${esc(r.name || 'Amount')} amount">
        <select data-list="${list}" data-i="${i}" data-f="${f}" aria-label="${f === 'type' ? 'Type' : 'How often'}">${opts.map((o) => `<option value="${o.value}" ${o.value === r[f] ? 'selected' : ''}>${o.label}</option>`).join('')}</select>
      </div>`).join('')}
    </div>`;

  const goalBox = (k, extra = '') => `
    <div class="goal ${d.goals[k] ? 'on' : ''}">
      <label class="check"><input type="checkbox" data-g="${k}" ${d.goals[k] ? 'checked' : ''}> <span>${GOALS[k]}</span></label>
      ${d.goals[k] ? extra : ''}
    </div>`;

  function buildAlloc() {
    const t = totals();
    const keys = [];
    // When updating, only goals that don't already have a budget line get one.
    const debtCount = d.debts.length + (update ? monsters().filter((m) => m.alive).length : 0);
    if (d.goals.payDebt && debtCount && !(update && state.categories.some((c) => c.id === DEBT_CATEGORY_ID))) keys.push('debt');
    if (d.goals.emergency && !(update && hasLine('Emergency fund'))) keys.push('emergency');
    if (d.goals.saveFor && !(update && hasLine(d.saveForName.trim() || 'Savings goal'))) keys.push('saveFor');
    if (d.goals.fun && !(update && hasLine('Fun money'))) keys.push('fun');
    const split = suggestSplit(t.leftover - existingLines, keys);
    const names = { debt: 'Extra debt payments', emergency: 'Emergency fund', saveFor: d.saveForName.trim() || 'Savings goal', fun: 'Fun money' };
    d.alloc = keys.map((k) => ({ k, name: names[k], raw: centsToInput(split[k]) }));
  }

  function stepHtml() {
    const t = totals();
    switch (WIZ_STEPS[step]) {
      case 'Income':
        return `
          <h2>How much do you make?</h2>
          <p class="intro">Your take-home pay after tax. Add each job or regular source of income.</p>
          <div class="field"><label for="wiz-currency">Currency</label>
            <select id="wiz-currency" data-field="currency">${CURRENCIES.map((c) => `<option ${c === d.currency ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
          ${rowsHtml('income')}
          <button class="btn" data-action="add-row" data-list="income">+ Add another income</button>
          <p class="wiz-total">About <b data-total="income">${money(t.income)}</b> a month.</p>`;
      case 'Money': {
        const m = moneyTotals();
        return `
          <h2>What do you have right now?</h2>
          ${update ? `${state.accounts.length ? `<ul class="rows">${(() => { const bal = accountBalances(state); return state.accounts.map((a) => `<li><span class="grow">${esc(a.name)}<small>${ACCOUNT_TYPES[a.type]} · kept as is</small></span><b>${money(bal.get(a.id))}</b></li>`).join(''); })()}</ul>` : ''}
            <p class="intro">Add any new accounts below. To change a balance, use Update balance on the Budget tab.</p>`
            : `<p class="intro">Today's balances. Leave blank anything you don't have. From now on, everything you log keeps these up to date.</p>`}
          ${rowsHtml('money', TYPE_OPTIONS, 'type')}
          <button class="btn" data-action="add-row" data-list="money">+ Add another account</button>
          <p class="wiz-total">Cash <b data-total="m-cash">${money(m.cash)}</b> · Savings <b data-total="m-savings">${money(m.savings)}</b> · Invested <b data-total="m-invest">${money(m.invest)}</b></p>`;
      }
      case 'Bills':
        return `
          <h2>What do you pay regularly?</h2>
          <p class="intro">Costs that repeat and never get paid off. Fill in what you pay and leave the rest blank. Loans, cards and mortgages come next.</p>
          ${rowsHtml('bills')}
          <button class="btn" data-action="add-row" data-list="bills">+ Add another bill</button>
          <h3>Everyday spending</h3>
          <p class="hint">Roughly what you spend on these. They become budget lines you can track. Optional.</p>
          ${rowsHtml('everyday')}
          <button class="btn" data-action="add-row" data-list="everyday">+ Add another</button>
          <p class="wiz-total">Bills about <b data-total="bills">${money(t.bills)}</b> and everyday spending about <b data-total="everyday">${money(t.everyday)}</b> a month.</p>`;
      case 'Debts':
        return `
          <h2>What do you owe?</h2>
          ${update && state.debts.length ? `<ul class="rows">${monsters().filter((m) => m.alive).map((m) => `<li><span class="grow">${esc(m.name)}<small>${money(m.balance)} · kept as is</small></span><b>${money(m.minPayment)}<small>/mo</small></b></li>`).join('')}</ul>
            <p class="intro">Add any new debts. To change one, tap it on the Spending tab.</p>`
            : '<p class="intro">Student loans, credit cards, car loans, medical bills, a mortgage. Each one becomes a monster to defeat.</p>'}
          ${d.debts.length ? `<ul class="rows">${d.debts.map((x, i) => `
            <li><span class="grow">${esc(x.name)}<small>${money(x.startBalance)} · ${x.apr}% APR${x.include ? '' : ' · benched'}</small></span>
              <b>${money(x.minPayment)}<small>/mo</small></b>
              <button class="x" data-action="del-debt" data-i="${i}" aria-label="Remove ${esc(x.name)}">×</button></li>`).join('')}</ul>`
            : '<p class="empty">No debts added. If you have none, tap Next.</p>'}
          <button class="btn primary wide" data-action="wiz-add-debt">+ Add a debt</button>
          <p class="hint">A mortgage is optional. Add it and uncheck “Fight this debt” to keep it off the battleground; its payment still counts in your budget.</p>
          ${d.debts.length ? `<p class="wiz-total">Minimum payments: <b>${money(t.mins)}</b> a month.</p>` : ''}`;
      case 'Goals':
        return `
          <h2>What are your goals?</h2>
          <p class="intro">Pick any. They decide how the money left over is split in the next step.</p>
          ${goalBox('payDebt', d.debts.length ? '' : '<p class="hint">You haven\'t added any debts, so this will be skipped.</p>')}
          ${goalBox('emergency', `<div class="field"><label for="wiz-em">Target (optional)</label>
            <input id="wiz-em" data-field="emergencyRaw" value="${esc(d.emergencyRaw)}" inputmode="decimal" placeholder="${centsToInput(Math.round((t.bills + t.everyday + t.mins) * 3 / 100) * 100)}"></div>
            <p class="hint">Many people aim for 3 months of costs, about ${money(Math.round((t.bills + t.everyday + t.mins) * 3))}.</p>`)}
          ${goalBox('saveFor', `<div class="field-row">
            <div class="field"><label for="wiz-sf-name">For what?</label><input id="wiz-sf-name" data-field="saveForName" value="${esc(d.saveForName)}" maxlength="40" placeholder="e.g. Vacation"></div>
            <div class="field"><label for="wiz-sf">Target</label><input id="wiz-sf" data-field="saveForRaw" value="${esc(d.saveForRaw)}" inputmode="decimal" placeholder="0.00"></div></div>`)}
          ${goalBox('fun')}
          ${goalBox('spendLess', '<p class="hint">Your everyday budget lines will show when you go over.</p>')}`;
      default: {
        const assigned = d.alloc.reduce((s, a) => s + Math.max(0, amt(a.raw) || 0), 0);
        return `
          <h2>Your month</h2>
          ${(() => { const m = moneyTotals(); const tot = m.cash + m.savings + m.invest; return tot ? `<p class="wiz-total">You have <b>${money(tot)}</b> today: ${money(m.cash)} cash, ${money(m.savings)} savings, ${money(m.invest)} invested.</p>` : ''; })()}
          <ul class="flow">
            <li><span>Income</span><b>${money(t.income)}</b></li>
            <li><span>Fixed bills</span><b>−${money(t.bills)}</b></li>
            <li><span>Debt minimum payments</span><b>−${money(t.mins)}</b></li>
            <li><span>Everyday spending</span><b>−${money(t.everyday)}</b></li>
            <li class="flow-total"><span>Left over</span><b class="${t.leftover < 0 ? 'bad' : ''}">${money(t.leftover)}</b></li>
          </ul>
          ${t.leftover < 0
            ? `<p class="bad">You're spending ${money(-t.leftover)} more than you make each month. Finish setup, then look for bills or spending to cut on the Budget tab.</p>`
            : d.alloc.length ? `
              <h3>Put the rest to work</h3>
              <p class="hint">A starting split based on your goals. Change any amount; you can add more lines later.</p>
              <div class="wrows">${d.alloc.map((a, i) => `
                <div class="arow"><label for="wiz-a${i}">${esc(a.name)}</label>
                  <input id="wiz-a${i}" data-alloc="${i}" value="${esc(a.raw)}" inputmode="decimal" autocomplete="off"><small>/mo</small></div>`).join('')}
              </div>
              <p class="wiz-total">Still unassigned: <b data-total="unassigned" class="${t.leftover - assigned < 0 ? 'bad' : ''}">${money(t.leftover - assigned)}</b></p>`
            : '<p class="hint">No goals picked, so the whole amount is yours to assign on the Budget tab.</p>'}`;
      }
    }
  }

  const sheet = openSheet('<div class="wiz"></div>', { className: 'wizard', onAction });
  const el = sheet.el;
  const box = el.querySelector('.wiz');

  function render() {
    box.innerHTML = `
      <ol class="wiz-progress" aria-label="Setup progress">${WIZ_STEPS.map((s, i) => `<li class="${i < step ? 'done' : i === step ? 'on' : ''}">${s}</li>`).join('')}</ol>
      <p class="wiz-step">Step ${step + 1} of ${WIZ_STEPS.length}</p>
      ${stepHtml()}
      <p class="form-error" role="alert"></p>
      <div class="row-buttons wiz-nav">
        ${step > 0 ? '<button class="btn" data-action="back">Back</button>' : ''}
        <button class="btn primary" data-action="${step === WIZ_STEPS.length - 1 ? 'finish' : 'next'}">${step === WIZ_STEPS.length - 1 ? 'Finish setup' : 'Next'}</button>
      </div>`;
    el.scrollTop = 0;
  }

  function updateTotals() {
    const t = totals();
    const set = (k, v, bad) => {
      const b = box.querySelector(`[data-total="${k}"]`);
      if (b) {
        b.textContent = money(v);
        b.classList.toggle('bad', !!bad);
      }
    };
    set('income', t.income);
    const mt = moneyTotals();
    set('m-cash', mt.cash);
    set('m-savings', mt.savings);
    set('m-invest', mt.invest);
    set('bills', t.bills);
    set('everyday', t.everyday);
    const assigned = d.alloc.reduce((s, a) => s + Math.max(0, amt(a.raw) || 0), 0);
    set('unassigned', t.leftover - assigned, t.leftover - assigned < 0);
  }

  function validate() {
    const badRow = (list) => d[list].find((r) => amt(r.raw) == null || amt(r.raw) < 0);
    const step0 = WIZ_STEPS[step];
    if (step0 === 'Income') {
      const bad = badRow('income');
      if (bad) return `Check the amount for ${bad.name || 'an income'}.`;
      if (!d.income.some((r) => amt(r.raw) > 0)) return 'Enter at least one income amount.';
    }
    if (step0 === 'Money') {
      const bad = d.money.find((r) => amt(r.raw) == null);
      if (bad) return `Check the amount for ${bad.name || 'an account'}.`;
    }
    if (step0 === 'Bills') {
      const bad = badRow('bills') || badRow('everyday');
      if (bad) return `Check the amount for ${bad.name || 'a bill'}.`;
    }
    if (step0 === 'Goals') {
      if (d.goals.saveFor && !d.saveForName.trim()) return 'Say what you are saving for, or untick that goal.';
      if (amt(d.emergencyRaw) == null || amt(d.saveForRaw) == null) return 'Check the target amounts.';
    }
    if (step0 === 'Summary' && d.alloc.some((a) => amt(a.raw) == null || amt(a.raw) < 0)) return 'Check the amounts you assigned.';
    return '';
  }

  /** Update mode: merge into the current save instead of replacing it. */
  function finishUpdate() {
    const today = todayISO();
    const merge = (rows, existing, fallback) => rows
      .filter((r) => amt(r.raw) > 0)
      .map((r) => {
        const old = existing.find((x) => x.id === r.id);
        return { ...(old || { nextDate: null, day: null, accountId: null, variable: false }), id: r.id || uid(), name: r.name.trim() || fallback, amount: amt(r.raw), freq: r.freq };
      });
    sheet.close();
    commitUndoable('Setup updated', (s) => {
      s.settings.currency = d.currency;
      s.goals = { ...d.goals };
      s.incomeSources = merge(d.income, s.incomeSources, 'Income');
      s.bills = merge(d.bills, s.bills, 'Bill');
      s.debts.push(...d.debts.map((x) => ({ ...x, createdAt: today, accruedThrough: today })));
      s.accounts.push(...d.money
        .filter((r) => String(r.raw).trim() !== '' && amt(r.raw) != null)
        .map((r) => ({ id: uid(), name: r.name.trim() || ACCOUNT_TYPES[r.type], type: r.type, start: amt(r.raw), createdAt: today })));
      for (const r of d.everyday.filter((x) => amt(x.raw) > 0)) {
        s.categories.push({ id: uid(), name: r.name.trim() || 'Everyday', kind: 'need', limit: toMonthly(amt(r.raw), r.freq), target: null, overrides: {} });
      }
      for (const a of d.alloc) {
        const limit = Math.max(0, amt(a.raw) || 0);
        const line = { debt: [DEBT_CATEGORY_ID, 'debt', null], emergency: [uid(), 'savings', amt(d.emergencyRaw) || null], saveFor: [uid(), 'savings', amt(d.saveForRaw) || null], fun: [uid(), 'want', null] }[a.k];
        s.categories.push({ id: line[0], name: a.name, kind: line[1], limit, target: line[2], overrides: {} });
      }
    });
    go('budget');
  }

  function finish() {
    if (update) return finishUpdate();
    const today = todayISO();
    const s = emptyState();
    s.settings.currency = d.currency;
    s.settings.setupDone = true;
    s.settings.startMonth = ymOf(today);
    s.goals = { ...d.goals };
    const recurring = (rows, fallback) => rows
      .filter((r) => amt(r.raw) > 0)
      .map((r) => ({ id: uid(), name: r.name.trim() || fallback, amount: amt(r.raw), freq: r.freq }));
    s.incomeSources = recurring(d.income, 'Income');
    s.bills = recurring(d.bills, 'Bill');
    s.debts = d.debts.map((x) => ({ ...x, createdAt: today, accruedThrough: today }));
    s.accounts = d.money
      .filter((r) => String(r.raw).trim() !== '' && amt(r.raw) != null)
      .map((r) => ({ id: uid(), name: r.name.trim() || ACCOUNT_TYPES[r.type], type: r.type, start: amt(r.raw), createdAt: today }));
    s.categories = recurring(d.everyday, 'Everyday').map((r) => ({ id: r.id, name: r.name, kind: 'need', limit: toMonthly(r.amount, r.freq), target: null }));
    for (const a of d.alloc) {
      const limit = Math.max(0, amt(a.raw) || 0);
      if (a.k === 'debt') s.categories.push({ id: DEBT_CATEGORY_ID, name: a.name, kind: 'debt', limit, target: null });
      if (a.k === 'emergency') s.categories.push({ id: uid(), name: a.name, kind: 'savings', limit, target: amt(d.emergencyRaw) || null });
      if (a.k === 'saveFor') s.categories.push({ id: uid(), name: a.name, kind: 'savings', limit, target: amt(d.saveForRaw) || null });
      if (a.k === 'fun') s.categories.push({ id: uid(), name: a.name, kind: 'want', limit, target: null });
    }
    state = s;
    save();
    sheet.close();
    ui.month = ymOf(today);
    go('budget');
    toast('Account set up! Here is your month.', 'good');
  }

  function onAction(action, btn) {
    const list = btn.dataset.list;
    const i = Number(btn.dataset.i);
    if (action === 'add-row') {
      d[list].push(list === 'money' ? { name: '', raw: '', type: 'cash' } : row('', list === 'income' ? 'weekly' : list === 'everyday' ? 'weekly' : 'monthly'));
      render();
      box.querySelectorAll(`.wname[data-list="${list}"]`)[d[list].length - 1]?.focus();
      return;
    }
    if (action === 'del-row') {
      d[list].splice(i, 1);
      return render();
    }
    if (action === 'del-debt') {
      d.debts.splice(i, 1);
      return render();
    }
    if (action === 'wiz-add-debt') return addDebt(render, d.debts);
    if (action === 'back') {
      step--;
      return render();
    }
    if (action === 'next' || action === 'finish') {
      const err = validate();
      if (err) {
        box.querySelector('.form-error').textContent = err;
        return;
      }
      if (action === 'finish') return finish();
      step++;
      if (WIZ_STEPS[step] === 'Summary') buildAlloc();
      render();
    }
  }

  const onInput = (e) => {
    const t = e.target;
    if (t.dataset.list) d[t.dataset.list][Number(t.dataset.i)][t.dataset.f] = t.value;
    else if (t.dataset.field) d[t.dataset.field] = t.value;
    else if (t.dataset.alloc) d.alloc[Number(t.dataset.alloc)].raw = t.value;
    else if (t.dataset.g) {
      d.goals[t.dataset.g] = t.checked;
      return render(); // show or hide the goal's extra fields
    }
    updateTotals();
  };
  el.addEventListener('input', onInput);
  el.addEventListener('change', (e) => {
    if (e.target.tagName === 'SELECT' || e.target.type === 'checkbox') onInput(e);
  });
  render();
}

// ---------- privacy lock ----------

let locked = false;
let hiddenAt = 0;
let wrongTries = 0;
let waitUntil = 0;

function showLock() {
  if (!state.settings.lock.enabled || locked) return;
  locked = true;
  for (const d of document.querySelectorAll('dialog[open]')) d.close();
  let el = document.getElementById('lock');
  if (!el) {
    el = document.createElement('div');
    el.id = 'lock';
    document.body.appendChild(el);
  }
  let pin = '';
  let forgot = false;
  const paint = (msg = '') => {
    el.innerHTML = `
      <div class="lock-box">
        ${spriteCanvas('hero', state.player.skin, 4)}
        <h2>Coin Quest is locked</h2>
        <div class="pin-dots" aria-label="${pin.length} digits entered">${'●'.repeat(pin.length) || '&nbsp;'}</div>
        <p class="lock-msg ${msg ? 'bad' : ''}" role="alert">${msg || 'Enter your passcode'}</p>
        <div class="keypad">
          ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-k="${n}">${n}</button>`).join('')}
          <button data-k="del" aria-label="Delete">⌫</button><button data-k="0">0</button><button data-k="ok" aria-label="Unlock">OK</button>
        </div>
        ${state.settings.lock.credId ? '<button class="btn wide" data-k="bio">Use Face ID / fingerprint</button>' : ''}
        <button class="link-btn" data-k="forgot">${forgot ? 'Tap again to erase everything on this device' : 'Forgot passcode?'}</button>
        ${forgot ? '<p class="hint">The only way in without the passcode is to erase this device\'s data. You can restore a backup or transfer code afterwards.</p>' : ''}
      </div>`;
    paintSprites(el);
  };
  const unlock = () => {
    locked = false;
    wrongTries = 0;
    el.remove();
  };
  const tryPin = async () => {
    if (Date.now() < waitUntil) return paint(`Too many tries. Wait ${Math.ceil((waitUntil - Date.now()) / 1000)} seconds.`);
    const h = await hashPin(pin, state.settings.lock.salt);
    if (h === state.settings.lock.pinHash) return unlock();
    pin = '';
    wrongTries++;
    if (wrongTries >= 5) waitUntil = Date.now() + 30_000;
    el.querySelector('.lock-box')?.classList.add('shake');
    paint(wrongTries >= 5 ? 'Too many tries. Wait 30 seconds.' : 'Wrong passcode. Try again.');
  };
  el.onclick = async (e) => {
    const k = e.target.closest('[data-k]')?.dataset.k;
    if (!k) return;
    if (k === 'bio') {
      try {
        if (await verifyBiometric(state.settings.lock.credId)) unlock();
      } catch {
        paint('Face ID / fingerprint did not work. Use your passcode.');
      }
      return;
    }
    if (k === 'forgot') {
      if (!forgot) {
        forgot = true;
        return paint();
      }
      state = emptyState();
      save();
      unlock();
      go('setup');
      return toast('Everything was erased. Restore a backup or transfer code in Settings.');
    }
    if (k === 'del') pin = pin.slice(0, -1);
    else if (k === 'ok') return tryPin();
    else if (pin.length < 8) pin += k;
    paint();
    if (pin.length >= 4 && (await hashPin(pin, state.settings.lock.salt)) === state.settings.lock.pinHash) unlock();
  };
  paint();
}

function setPin() {
  openForm({
    title: state.settings.lock.enabled ? 'Change passcode' : 'Set a passcode',
    intro: '4 to 8 digits. There is no way to recover it, so pick one you will remember.',
    fields: [
      { name: 'pin', label: 'New passcode', type: 'pin', required: true },
      { name: 'again', label: 'Type it again', type: 'pin', required: true },
    ],
    onSubmit: (v) => {
      if (!/^\d{4,8}$/.test(v.pin)) return 'Use 4 to 8 digits.';
      if (v.pin !== v.again) return "The two passcodes don't match.";
      const salt = randomHex();
      hashPin(v.pin, salt).then((pinHash) => {
        commit((s) => (s.settings.lock = { ...s.settings.lock, enabled: true, pinHash, salt }));
        toast('Passcode set. The app will lock when it opens and after a minute away.', 'good');
      });
    },
  });
}

async function toggleBiometric() {
  if (state.settings.lock.credId) return commit((s) => (s.settings.lock.credId = null));
  if (!(await biometricAvailable())) return toast("Face ID / fingerprint isn't available here. It works once the app is installed from its website.", 'bad');
  try {
    const credId = await registerBiometric();
    commit((s) => (s.settings.lock.credId = credId));
    toast('Face ID / fingerprint is on.', 'good');
  } catch {
    toast('Face ID / fingerprint was not set up.', 'bad');
  }
}

// ---------- device transfer ----------

async function transferOut() {
  const code = await encodeTransfer(state);
  openSheet(`
    <h2>Your transfer code</h2>
    <p class="intro">Copy all of it. On the other device, open Settings → Paste a transfer code. It holds all your financial details, so keep it private.</p>
    <textarea class="code" readonly rows="6" aria-label="Transfer code">${esc(code)}</textarea>
    <p class="hint">${code.length.toLocaleString()} characters.</p>
    <div class="row-buttons"><button class="btn primary" data-action="copy">Copy</button></div>`, {
    onAction: (action, _el, { el }) => {
      if (action !== 'copy') return;
      const ta = el.querySelector('textarea');
      navigator.clipboard?.writeText(code).then(() => toast('Copied.'), () => {
        ta.select();
        toast('Select all and copy it by hand.');
      }) ?? (ta.select(), toast('Select all and copy it by hand.'));
    },
  });
}

function transferIn() {
  const sheet = openSheet(`
    <h2>Paste a transfer code</h2>
    <p class="intro">This replaces everything on this device with the data from the code.</p>
    <textarea class="code" rows="6" aria-label="Transfer code" placeholder="CQ1:…"></textarea>
    <p class="form-error" role="alert"></p>
    <div class="row-buttons"><button class="btn primary" data-action="load">Load it</button></div>`, {
    onAction: async (action, _el, { el, close }) => {
      if (action !== 'load') return;
      const err = el.querySelector('.form-error');
      try {
        const restored = normalizeState(await decodeTransfer(el.querySelector('textarea').value));
        if (!(await askConfirm(`Replace everything on this device with this data (${restored.debts.length} debts, ${restored.accounts.length} accounts)?`, { okLabel: 'Replace', title: 'Load transfer code?' }))) return;
        close();
        state = restored;
        runAccrual();
        runRecurring();
        save();
        render();
        toast('Loaded.', 'good');
      } catch (e) {
        err.textContent = e.message || 'That code could not be read.';
      }
    },
  });
  sheet.el.querySelector('textarea').focus();
}

// ---------- events ----------

function onClick(e) {
  const a = e.target.closest('[data-action]');
  if (!a || a.closest('dialog')) return;
  const actions = {
    'add-debt': () => addDebt(),
    'open-debt': () => openDebt(a.dataset.id),
    project: () => openProjection(a.dataset.id),
    'add-payment': () => logDebtEntry('payment'),
    'add-charge': () => logDebtEntry('charge'),
    'add-income': () => addIncome(),
    'add-expense': () => addExpense(),
    'add-cat': () => categoryForm(null),
    'edit-cat': () => categoryForm(state.categories.find((c) => c.id === a.dataset.id)),
    'add-debt-cat': () => categoryForm(null, { id: DEBT_CATEGORY_ID, name: 'Extra debt payments' }),
    'add-rec': () => recurringForm(a.dataset.list),
    'edit-rec': () => recurringForm(a.dataset.list, state[a.dataset.list].find((x) => x.id === a.dataset.id)),
    'new-account': startNewAccount,
    'update-setup': () => runWizard(true),
    'set-pin': setPin,
    bio: toggleBiometric,
    'lock-off': async () => {
      if (await askConfirm('Turn off the passcode lock?', { okLabel: 'Turn off', title: 'Turn off lock?' })) {
        commit((s) => (s.settings.lock = { enabled: false, pinHash: null, salt: null, credId: null }));
      }
    },
    'transfer-out': transferOut,
    'transfer-in': transferIn,
    'add-account': () => accountForm(),
    'open-account': () => openAccount(a.dataset.id),
    payday: () => recordRecurring('payday'),
    'pay-bill': () => recordRecurring('bill'),
    'move-money': () => moveMoney(),
    'chart-view': () => commit((s) => (s.settings.chart.view = a.dataset.key)),
    'chart-show': () => commit((s) => (s.settings.chart[a.dataset.key] = !s.settings.chart[a.dataset.key])),
    'add-scheduled': () => scheduleForm(),
    'edit-scheduled': () => {
      const item = state.scheduled.find((x) => x.id === a.dataset.id);
      if (item.kind === 'debt') debtPaymentForm(item);
      else scheduleForm(item);
    },
    'plan-debt': () => debtPaymentForm(),
    'log-scheduled': () => logScheduled(state.scheduled.find((x) => x.id === a.dataset.id)),
    'skip-scheduled': async () => {
      const item = state.scheduled.find((x) => x.id === a.dataset.id);
      const monthly = item.repeat === 'monthly';
      const msg = monthly
        ? `Skip this ${dayLabel(item.date)} payment to ${item.name}? Nothing is logged and the plan moves to next month.`
        : `Skip ${item.name}? It's removed from your plans and nothing is logged.`;
      if (await askConfirm(msg, { okLabel: 'Skip it', title: 'Skip payment?' })) commit((s) => advanceScheduled(s, item.id));
    },
    'edit-goals': editGoals,
    goto: () => go(a.dataset.tab),
    month: () => {
      ui.month = addMonths(ui.month, Number(a.dataset.d));
      render();
    },
    'del-entry': () => {
      const { t, id } = a.dataset;
      if (t === 'expense') deleteExpense(id);
      else if (t === 'ledger') deleteLedgerEntry(id);
      else commitUndoable('Income deleted', (s) => (s.incomes = s.incomes.filter((x) => x.id !== id)));
    },
    'edit-entry': () => {
      const { t, id } = a.dataset;
      if (t === 'expense') expenseForm(state.expenses.find((x) => x.id === id));
      else if (t === 'ledger') editLedgerEntry(state.ledger.find((x) => x.id === id));
      else editIncome(state.incomes.find((x) => x.id === id));
    },
    'report-range': () => {
      ui.reportMonths = Number(a.dataset.key);
      render();
    },
    'set-strategy': () => commit((s) => (s.settings.strategy = a.dataset.key)),
    'set-extra': () => {
      const { auto } = currentPlan();
      openForm({
        title: 'Extra payment per month',
        intro: `On top of the minimums (${fmt(auto.mins)}). Your budget allows ${fmt(auto.extra)}.`,
        fields: [{ name: 'extra', label: 'Extra per month', type: 'money', required: true, value: state.settings.extraCents ?? auto.extra }],
        extra: [{ label: 'Use budget', action: 'auto' }],
        onExtra: (_a, close) => {
          close();
          commit((s) => (s.settings.extraCents = null));
        },
        onSubmit: (v) => commit((s) => (s.settings.extraCents = v.extra)),
      });
    },
    backup: () => {
      downloadBackup(state);
      commit((s) => (s.settings.lastBackup = todayISO()));
      toast('Backup downloaded. Keep it somewhere safe.');
    },
    erase: async () => {
      if (!(await askConfirm('Erase ALL your debts, budget and progress on this device? Download a backup first if you might want it. This cannot be undone.', { okLabel: 'Erase everything', danger: true, title: 'Erase everything?' }))) return;
      state = emptyState();
      save();
      go('setup');
      toast('All data erased.');
    },
    install: async () => {
      ui.installPrompt?.prompt();
      await ui.installPrompt?.userChoice;
      ui.installPrompt = null;
      render();
    },
  };
  actions[a.dataset.action]?.();
}

async function onChange(e) {
  const k = e.target.dataset.change;
  if (k === 'currency') commit((s) => (s.settings.currency = e.target.value));
  if (k === 'chart-proj') commit((s) => (s.settings.chart.projections = e.target.checked));
  if (k === 'restore') {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const restored = await readBackup(file);
      if (!(await askConfirm(`Replace everything on this device with this backup (${restored.debts.length} debts, ${restored.incomes.length + restored.expenses.length} budget entries)?`, { okLabel: 'Restore', title: 'Restore backup?' }))) return;
      state = restored;
      runAccrual();
      runRecurring();
      save();
      render();
      toast('Backup restored.', 'good');
    } catch (err) {
      toast(err.message || 'Could not read that backup.', 'bad');
    }
  }
}

/** Swipe left/right on the page to move between tabs, like the game menus it borrows from. */
function enableSwipe() {
  let sx = 0;
  let sy = 0;
  let t0 = 0;
  view.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    sx = t.clientX;
    sy = t.clientY;
    t0 = Date.now();
  }, { passive: true });
  view.addEventListener('touchend', (e) => {
    if (document.querySelector('dialog[open]') || e.target.closest('.chart, input, select, .b-stage-wrap')) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx;
    const dy = t.clientY - sy;
    if (Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 0.6 || Date.now() - t0 > 600) return;
    const i = TAB_ORDER.indexOf(route()) + (dx < 0 ? 1 : -1);
    if (i >= 0 && i < TAB_ORDER.length) go(TAB_ORDER[i]);
  }, { passive: true });
}

// ---------- boot ----------

async function boot() {
  state = await loadState();
  if (hadLoadProblem()) setTimeout(() => toast('Your saved data could not be read. A copy was kept safe; restore a backup in Settings.', 'bad'), 500);
  runAccrual();
  runRecurring();
  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  document.addEventListener('keydown', battleKey);
  window.addEventListener('hashchange', render);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hiddenAt = Date.now();
    if (document.visibilityState === 'visible' && hiddenAt && Date.now() - hiddenAt > 60_000) showLock();
    if (document.visibilityState === 'visible') {
      runAccrual();
      runRecurring();
      render();
    }
  });
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    ui.installPrompt = e;
    render();
  });
  enableSwipe();
  render();
  showLock();
  requestPersistence().then((p) => {
    ui.persisted = p;
    if (route() === 'setup') render();
  });
  // Only the installable version (index.html links the manifest) has a service worker to register.
  if ('serviceWorker' in navigator && document.querySelector('link[rel="manifest"]') && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker not available', err));
  }
}

boot();
