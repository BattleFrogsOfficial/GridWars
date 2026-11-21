// App shell: state, routing, the five tabs and their actions.
//   plan   – future planning, projection and statistics
//   spend  – spending tracker: expenses, debts, debt payments and charges
//   battle – the battleground (center tab, default)
//   budget – income and budgeting
//   setup  – settings and first-run setup

import { formatMoney } from './money.js';
import { todayISO, ymOf, addMonths, monthLabel, dayLabel } from './dates.js';
import {
  DEBT_TYPES, ENTRY_KINDS, balancesById, speciesFor, temperFor, monthlyInterest, isRegenerating, pendingInterest,
} from './debts.js';
import { simulatePayoff, STRATEGIES } from './planner.js';
import { monthSummary, CATEGORY_KINDS, DEBT_CATEGORY_ID } from './budget.js';
import { XP, attackXp, levelInfo, streak } from './player.js';
import { uid, emptyState } from './state.js';
import { loadState, saveState, requestPersistence, downloadBackup, readBackup } from './storage.js';
import { drawSprite } from './sprites.js';
import { esc, toast, openSheet, openForm, askConfirm } from './ui.js';
import { lineChart, attachCharts, SERIES_COLORS } from './chart.js';

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

function markActive() {
  const t = todayISO();
  if (!state.player.days.includes(t)) state.player.days.push(t);
  if (state.player.days.length > 400) state.player.days = state.player.days.slice(-400);
}

function gainXp(n) {
  const before = levelInfo(state.player.xp).level;
  state.player.xp += n;
  const after = levelInfo(state.player.xp).level;
  if (after > before) setTimeout(() => toast(`LEVEL UP! You are now level ${after}.`, 'good'), 600);
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

// ---------- derived data ----------

function monsters() {
  const bal = balancesById(state.debts, state.ledger);
  return state.debts.map((d) => {
    const balance = bal.get(d.id);
    const species = speciesFor(d, balance);
    const temper = temperFor(d.apr);
    const maxHp = Math.max(d.startBalance, balance, 1);
    return {
      ...d,
      balance,
      species,
      temper,
      monthly: monthlyInterest(balance, d.apr),
      regen: d.autoInterest && isRegenerating(d, balance),
      hpPct: Math.max(0, Math.min(100, (balance / maxHp) * 100)),
      alive: balance > 0,
    };
  });
}

function autoExtra(active) {
  const attack = state.categories.find((c) => c.id === DEBT_CATEGORY_ID)?.limit || 0;
  const mins = active.reduce((s, d) => s + d.minPayment, 0);
  return { attack, mins, extra: Math.max(0, attack - mins) };
}

function currentPlan() {
  const active = monsters().filter((m) => m.alive && m.include);
  const auto = autoExtra(active);
  const extra = state.settings.extraCents ?? auto.extra;
  const strategy = state.settings.strategy;
  const plan = simulatePayoff(active, extra, strategy);
  const baseline = simulatePayoff(active, 0, strategy);
  return { active, auto, extra, strategy, plan, baseline };
}

const hasAnyData = () => state.debts.length || state.incomes.length || state.expenses.length;

// ---------- rendering helpers ----------

function spriteCanvas(key, temper, scale, cls = '') {
  return `<canvas class="sprite ${cls}" width="${16 * scale}" height="${16 * scale}" data-sprite="${key}" data-temper="${temper}" data-scale="${scale}" aria-hidden="true"></canvas>`;
}

function paintSprites(root) {
  for (const c of root.querySelectorAll('canvas[data-sprite]')) {
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    drawSprite(ctx, c.dataset.sprite, c.dataset.temper, Number(c.dataset.scale));
  }
}

function hpBar(pct, label = '') {
  return `<div class="hp" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><div class="hp-fill" style="width:${pct}%"></div>${label ? `<span>${label}</span>` : ''}</div>`;
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
  const { active, auto, extra, strategy, plan, baseline } = currentPlan();
  const now = ymOf(todayISO());
  const ms = monsters();

  const paidAll = state.ledger.filter((e) => e.kind === 'payment').reduce((s, e) => s - e.amount, 0);
  const interestAll = state.ledger.filter((e) => e.kind === 'interest').reduce((s, e) => s + e.amount, 0);
  const lv = levelInfo(state.player.xp);
  const history = [5, 4, 3, 2, 1, 0].map((k) => {
    const ym = addMonths(now, -k);
    const m = monthSummary(state, ym);
    return { ym, income: m.income, spent: m.spent };
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
      xLabel: (i) => (i === 0 ? 'Now' : monthLabel(addMonths(now, i), { month: 'short', year: 'numeric' })),
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
        <p class="hint">${state.settings.extraCents == null ? `Extra comes from your Debt attack budget (${fmt(auto.attack)}) minus minimums.` : 'Extra set by hand.'}</p>
        ${auto.attack < auto.mins ? `<p class="bad">Your Debt attack budget is ${fmt(auto.mins - auto.attack)} short of the minimum payments. Raise it in Income &amp; budget.</p>` : ''}
        <button class="btn" data-action="set-extra">Change extra</button>
      </section>

      <section class="card">
        <h2>Order of battle</h2>
        <ol class="rows">
          ${plan.kills.map((k) => {
            const m = byId.get(k.id);
            return `<li>${spriteCanvas(m.species.key, m.temper.key, 2)}<span class="grow">${esc(m.name)}</span><small>${monthLabel(addMonths(now, k.month), { month: 'short', year: 'numeric' })}</small></li>`;
          }).join('')}
          ${active.filter((m) => !plan.kills.some((k) => k.id === m.id)).map((m) => `<li>${spriteCanvas(m.species.key, m.temper.key, 2)}<span class="grow">${esc(m.name)}</span><small class="bad">never</small></li>`).join('')}
        </ol>
        <p class="hint">Assumes rates stay the same and no new charges. An estimate, not financial advice.</p>
      </section>`;
  } else {
    projection = `<section class="card empty-card"><p>Add your debts to see when you'll be debt free.</p><button class="btn primary" data-action="add-debt">Add a debt</button></section>`;
  }

  return `
    ${header('Planning', 'Where your money is heading')}
    ${projection}
    <section class="card">
      <h2>Your stats</h2>
      <div class="stats">
        <div><small>Damage dealt</small><b>${fmt(paidAll)}</b></div>
        <div><small>Interest healed</small><b>${fmt(interestAll)}</b></div>
        <div><small>Defeated</small><b>${ms.filter((m) => !m.alive).length} of ${ms.length}</b></div>
        <div><small>Level</small><b>${lv.level}</b></div>
        <div><small>Streak</small><b>${((n) => `${n} day${n === 1 ? '' : 's'}`)(streak(state.player.days, todayISO()))}</b></div>
        <div><small>Days logged</small><b>${state.player.days.length}</b></div>
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
    </section>`;
}

// ---------- tab 2: spending ----------

function spendView() {
  const m = monthSummary(state, ui.month);
  const ms = monsters();
  const debtName = (id) => state.debts.find((d) => d.id === id)?.name || 'debt';
  const entries = [
    ...state.expenses.filter((e) => ymOf(e.date) === ui.month).map((e) => ({
      id: e.id, date: e.date, amount: e.amount, t: 'expense', sign: '−',
      label: (state.categories.find((c) => c.id === e.categoryId)?.name || '?') + (e.note ? ` · ${e.note}` : ''),
    })),
    ...state.ledger.filter((e) => !e.auto && e.kind !== 'correction' && ymOf(e.date) === ui.month).map((e) => ({
      id: e.id, date: e.date, amount: Math.abs(e.amount), t: 'ledger', cls: e.kind === 'payment' ? 'attack' : 'charge',
      sign: e.kind === 'payment' ? '−' : '+',
      label: `${e.kind === 'payment' ? 'Payment' : ENTRY_KINDS[e.kind].label}: ${debtName(e.debtId)}${e.note ? ` · ${e.note}` : ''}`,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  const top = m.categories.filter((c) => c.spent > 0).sort((a, b) => b.spent - a.spent).slice(0, 3);
  const live = ms.filter((d) => d.alive);

  return `
    ${header('Spending', 'Log expenses, debts and payments')}
    <div class="action-grid">
      <button class="btn primary" data-action="add-expense">+ Expense</button>
      <button class="btn primary" data-action="add-payment" ${live.length ? '' : 'disabled'}>+ Debt payment</button>
      <button class="btn" data-action="add-debt">+ New debt</button>
      <button class="btn" data-action="add-charge" ${live.length ? '' : 'disabled'}>+ Charge on a debt</button>
    </div>

    <section class="card">
      <h2>Debts</h2>
      ${ms.length ? `<ul class="rows">${ms.sort((a, b) => b.balance - a.balance).map((d) => `
        <li><button class="row-btn" data-action="open-debt" data-id="${d.id}">
          ${spriteCanvas(d.species.key, d.temper.key, 2, d.alive ? '' : 'dead')}
          <span class="grow">${esc(d.name)}<small>${d.alive ? `${typeLabel(d.type)} · ${d.apr}% APR${d.include ? '' : ' · benched'}` : 'Paid off'}</small></span>
          <b>${fmt(Math.max(0, d.balance))}</b>
        </button></li>`).join('')}</ul>` : '<p class="empty">No debts yet. Add each loan or card you owe on.</p>'}
    </section>

    ${monthNav()}
    <section class="card">
      <div class="stats">
        <div><small>Spent</small><b>${fmt(m.spent)}</b></div>
        <div><small>Debt payments</small><b>${fmt(m.categories.find((c) => c.id === DEBT_CATEGORY_ID)?.spent || 0)}</b></div>
        <div><small>Left</small><b class="${m.left < 0 ? 'bad' : ''}">${fmt(m.left)}</b></div>
      </div>
      ${top.length ? `<p class="hint">Biggest: ${top.map((c) => `${esc(c.name)} ${fmt(c.spent)}`).join(' · ')}</p>` : ''}
    </section>

    <section class="card">
      <h2>Log</h2>
      ${entries.length ? `<ul class="log">${entries.map((e) => `
        <li class="${e.cls || e.t}">
          <span class="grow">${esc(e.label)}<small>${dayLabel(e.date)}</small></span>
          <b>${e.sign}${fmt(e.amount)}</b>
          <button class="x" data-action="del-entry" data-t="${e.t}" data-id="${e.id}" aria-label="Delete">×</button>
        </li>`).join('')}</ul>` : '<p class="empty">Nothing logged this month.</p>'}
    </section>`;
}

// ---------- tab 3: battle ----------

function monsterCard(m) {
  return `
    <button class="card monster ${m.alive ? '' : 'dead'}" data-action="open-debt" data-id="${m.id}">
      ${spriteCanvas(m.species.key, m.temper.key, 4)}
      <div class="grow">
        <div class="m-name">${esc(m.name)}</div>
        <small>${m.alive ? `${m.temper.name} ${m.species.name}` : 'Defeated'} · ${m.apr}% APR</small>
        ${m.alive ? hpBar(m.hpPct, fmt(m.balance)) : ''}
        ${m.regen ? '<small class="bad">Regenerating! The minimum doesn\'t cover interest</small>' : ''}
      </div>
    </button>`;
}

function battleView() {
  const lv = levelInfo(state.player.xp);
  const st = streak(state.player.days, todayISO());
  const ms = monsters();
  const active = ms.filter((m) => m.alive && m.include).sort((a, b) => b.balance - a.balance);
  const benched = ms.filter((m) => m.alive && !m.include);
  const dead = ms.filter((m) => !m.alive);
  const totalHp = active.reduce((s, m) => s + m.balance, 0);
  const iOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;

  return `
    <section class="card hero">
      ${spriteCanvas('hero', 'calm', 4)}
      <div class="grow">
        <div class="hero-line"><strong>Level ${lv.level}</strong><span>${st} day streak</span></div>
        <div class="xp" role="meter" aria-label="Experience" aria-valuenow="${lv.into}" aria-valuemax="${lv.span}"><div style="width:${(lv.into / lv.span) * 100}%"></div></div>
        <small>${lv.toNext} XP to level ${lv.level + 1}</small>
      </div>
    </section>
    ${!standalone && iOS && state.settings.setupDone ? `<section class="card tip">Install: tap <b>Share</b> then <b>Add to Home Screen</b>.</section>` : ''}
    ${!standalone && ui.installPrompt ? `<section class="card tip">Install Coin Quest on this device. <button class="btn primary" data-action="install">Install</button></section>` : ''}

    <div class="battle-head">
      <h1>Battleground</h1>
      ${active.length ? `<span>${fmt(totalHp)} HP left</span>` : ''}
    </div>
    ${active.length ? active.map(monsterCard).join('') : `
      <section class="card empty-card">
        <p>${dead.length ? 'Every monster is defeated. Well fought!' : 'No monsters yet. Each debt you add appears here as a monster.'}</p>
        <div class="row-buttons"><button class="btn primary" data-action="add-debt">Add a debt</button>
        ${hasAnyData() ? '' : '<button class="btn" data-action="example">Try example data</button>'}</div>
      </section>`}
    ${benched.length ? `<h2 class="section-h">Benched</h2><p class="hint">Kept off the battlefield and out of the plan.</p>${benched.map(monsterCard).join('')}` : ''}
    ${dead.length ? `<h2 class="section-h">Trophies</h2>${dead.map(monsterCard).join('')}` : ''}`;
}

// ---------- tab 4: income & budget ----------

function budgetView() {
  const m = monthSummary(state, ui.month);
  const incomes = state.incomes.filter((i) => ymOf(i.date) === ui.month).sort((a, b) => b.date.localeCompare(a.date));
  const allZero = state.categories.every((c) => c.limit === 0);
  const splitBase = m.income || state.settings.expectedIncome || 0;

  return `
    ${header('Income &amp; budget', 'Give every coin a job')}
    ${monthNav()}
    <section class="card">
      <div class="stats">
        <div><small>Income</small><b>${fmt(m.income)}</b></div>
        <div><small>Planned</small><b>${fmt(m.assigned)}</b></div>
        <div><small>Unplanned</small><b class="${m.toAssign < 0 ? 'bad' : ''}">${fmt(m.toAssign)}</b></div>
      </div>
      <p class="${m.toAssign < 0 ? 'bad' : m.toAssign === 0 && m.income > 0 ? 'good' : ''}">
        ${m.toAssign > 0 ? `${fmt(m.toAssign)} still needs a job.` : m.toAssign < 0 ? `You've planned ${fmt(-m.toAssign)} more than you earned.` : m.income > 0 ? 'Every coin has a job.' : 'Log your income to start planning.'}
      </p>
      <button class="btn primary wide" data-action="add-income">+ Income</button>
    </section>

    <section class="card">
      <h2>Monthly limits</h2>
      ${allZero && splitBase > 0 ? `<button class="btn wide" data-action="split-503020">Quick-fill 50/30/20</button>` : ''}
      <ul class="cats">
        ${m.categories.map((c) => `
          <li><button data-action="edit-cat" data-id="${c.id}">
            <span class="cat-top"><span>${esc(c.name)} <small>${CATEGORY_KINDS[c.kind]}</small></span><span>${fmt(c.spent)} / ${fmt(c.limit)}</span></span>
            ${meter(c.spent, c.limit)}
          </button></li>`).join('')}
      </ul>
      <button class="btn" data-action="add-cat">+ Category</button>
    </section>

    <section class="card">
      <h2>Income this month</h2>
      ${incomes.length ? `<ul class="log">${incomes.map((i) => `
        <li class="income">
          <span class="grow">${esc(i.source || 'Income')}<small>${dayLabel(i.date)}</small></span>
          <b>+${fmt(i.amount)}</b>
          <button class="x" data-action="del-entry" data-t="income" data-id="${i.id}" aria-label="Delete">×</button>
        </li>`).join('')}</ul>` : '<p class="empty">No income logged this month.</p>'}
    </section>`;
}

// ---------- tab 5: settings & setup ----------

const CURRENCIES = ['USD', 'CAD', 'EUR', 'GBP', 'AUD', 'NZD', 'MXN', 'BRL', 'INR', 'JPY', 'CHF', 'SEK', 'ZAR', 'PHP'];

function setupView() {
  const done = state.settings.setupDone;
  return `
    ${header('Settings')}
    <section class="card ${done ? '' : 'tip'}">
      <h2>${done ? 'Setup' : 'Welcome!'}</h2>
      <p>${done ? 'Run the guided setup again to update your income, debts and budget.' : 'Answer a few questions to set up your income, debts and budget. It takes about two minutes.'}</p>
      <button class="btn ${done ? '' : 'primary'} wide" data-action="setup">${done ? 'Run setup again' : 'Start setup'}</button>
      ${hasAnyData() ? '' : '<button class="btn wide" data-action="example">Or try example data</button>'}
    </section>
    <section class="card">
      <h2>Basics</h2>
      <div class="field"><label for="set-currency">Currency</label>
        <select id="set-currency" data-change="currency">${CURRENCIES.map((c) => `<option ${c === state.settings.currency ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
      <div class="field"><span class="label">Usual monthly income</span>
        <button class="btn wide" data-action="set-expected">${state.settings.expectedIncome ? fmt(state.settings.expectedIncome) : 'Not set'}</button></div>
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
  for (const a of document.querySelectorAll('.tabs a')) {
    const on = a.dataset.tab === r;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  paintSprites(view);
  attachCharts(view);
  window.scrollTo(0, scrollY);
  lastRoute = r;
}

// ---------- debts ----------

const debtTypeOptions = DEBT_TYPES.map((t) => ({ value: t.key, label: t.label }));
const liveDebtOptions = () => monsters().filter((m) => m.alive).map((m) => ({ value: m.id, label: `${m.name} (${fmt(m.balance)})` }));

function addDebt(onDone) {
  openForm({
    title: 'New debt',
    intro: 'Enter it as it is today. It becomes a monster: bigger balance, bigger monster; higher interest, angrier color.',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, placeholder: 'e.g. Visa card' },
      { name: 'type', label: 'Type', type: 'select', options: debtTypeOptions, value: 'credit' },
      { name: 'balance', label: 'Current balance', type: 'money', required: true, positive: true },
      { name: 'apr', label: 'Interest rate (APR %)', type: 'percent', required: true },
      { name: 'minPayment', label: 'Minimum monthly payment', type: 'money', required: true },
      { name: 'dueDay', label: 'Due day of month (1–31)', type: 'int', required: true, min: 1, maxValue: 31, value: 1 },
      { name: 'include', label: 'Fight this debt', type: 'checkbox', value: true, hint: 'Uncheck to keep it (for example a mortgage) off the battleground and out of the plan.' },
      { name: 'autoInterest', label: 'Add interest automatically each month', type: 'checkbox', value: true },
    ],
    submitLabel: 'Add debt',
    onSubmit: (v) => {
      const today = todayISO();
      commit((s) => {
        s.debts.push({
          id: uid(), name: v.name, type: v.type, startBalance: v.balance, apr: v.apr, minPayment: v.minPayment,
          dueDay: v.dueDay, include: v.include, autoInterest: v.autoInterest, createdAt: today, accruedThrough: today, killRewarded: false,
        });
      });
      toast(`${v.name} has appeared on the battleground!`);
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
      { name: 'apr', label: 'Interest rate (APR %)', type: 'percent', required: true, value: m.apr },
      { name: 'minPayment', label: 'Minimum monthly payment', type: 'money', required: true, value: m.minPayment },
      { name: 'dueDay', label: 'Due day of month (1–31)', type: 'int', required: true, min: 1, maxValue: 31, value: m.dueDay },
      { name: 'include', label: 'Fight this debt', type: 'checkbox', value: m.include },
      { name: 'autoInterest', label: 'Add interest automatically each month', type: 'checkbox', value: m.autoInterest },
    ],
    onSubmit: (v) => {
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
      askConfirm(`Delete ${m.name} and its whole history? This can't be undone.`, { okLabel: 'Delete', danger: true }).then((ok) => {
        if (!ok) return;
        close();
        commit((s) => {
          s.debts = s.debts.filter((d) => d.id !== m.id);
          s.ledger = s.ledger.filter((e) => e.debtId !== m.id);
        });
      });
    },
  });
}

/**
 * Log a payment (attack) or a new charge. With debtId the debt is fixed; without it the form asks which debt.
 * `fromBattle` reopens the monster afterwards with the hit animation.
 */
function logDebtEntry(kind, debtId = null, fromBattle = false) {
  const isAttack = kind === 'payment';
  const fixed = debtId ? monsters().find((m) => m.id === debtId) : null;
  const options = liveDebtOptions();
  if (!fixed && !options.length) return toast('Add a debt first.');
  const first = fixed || monsters().find((m) => m.id === options[0].value);
  openForm({
    title: isAttack ? (fixed ? `Attack ${fixed.name}` : 'Log a debt payment') : (fixed ? `New charge on ${fixed.name}` : 'Log a new charge'),
    intro: isAttack ? 'A payment you made. Every coin is damage.' : 'New spending or fees on a debt. It heals the monster.',
    fields: [
      ...(fixed ? [] : [{ name: 'debtId', label: 'Debt', type: 'select', options, value: options[0].value }]),
      { name: 'amount', label: 'Amount', type: 'money', required: true, positive: true, value: isAttack ? Math.min(first.minPayment, first.balance) || '' : '' },
      { name: 'date', label: 'Date', type: 'date', value: todayISO() },
      { name: 'note', label: 'Note (optional)', type: 'text' },
    ],
    submitLabel: isAttack ? 'Strike!' : 'Add charge',
    onSubmit: (v) => {
      const m = monsters().find((x) => x.id === (fixed ? fixed.id : v.debtId));
      if (isAttack && v.amount > m.balance) return `That's more than what's owed (${fmt(m.balance)}).`;
      if (v.date > todayISO()) return 'Pick today or an earlier date.';
      let killed = false;
      commit((s) => {
        s.ledger.push({ id: uid(), debtId: m.id, kind, amount: isAttack ? -v.amount : v.amount, date: v.date, note: v.note || '', auto: false });
        markActive();
        if (isAttack) {
          gainXp(attackXp(v.amount));
          const d = s.debts.find((x) => x.id === m.id);
          if (m.balance - v.amount <= 0 && !d.killRewarded) {
            d.killRewarded = true;
            gainXp(XP.kill[m.species.key] || 100);
            killed = true;
          }
        }
      });
      if (killed) toast(`VICTORY! ${m.name} is defeated! +${XP.kill[m.species.key] || 100} XP`, 'good');
      else if (isAttack) toast(`Hit ${m.name} for ${fmt(v.amount)}! +${attackXp(v.amount)} XP`, 'good');
      else toast(`${m.name} healed ${fmt(v.amount)}.`, 'bad');
      if (fromBattle && !killed) openDebt(m.id, isAttack ? v.amount : -v.amount);
    },
  });
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
        gainXp(XP.scout);
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
    <div class="arena ${hit > 0 ? 'hit' : hit < 0 ? 'heal' : ''}">
      ${spriteCanvas(m.species.key, m.temper.key, 10, m.alive ? '' : 'dead')}
      ${hit ? `<span class="dmg ${hit < 0 ? 'heal' : ''}">${hit > 0 ? '−' : '+'}${fmt(Math.abs(hit))}</span>` : ''}
    </div>
    <h2>${esc(m.name)}</h2>
    <p class="hint">${m.alive ? `${m.temper.name} ${m.species.name}` : 'Defeated'} · ${typeLabel(m.type)}${m.include ? '' : ' · Benched'}</p>
    ${hpBar(m.hpPct, `${fmt(Math.max(0, m.balance))} HP`)}
    ${m.regen ? `<p class="bad">It heals ${fmt(m.monthly)} a month but the minimum only hits for ${fmt(m.minPayment)}. Pay more than the minimum to make progress.</p>` : ''}
    <div class="stats">
      <div><small>APR</small><b>${m.apr}%</b></div>
      <div><small>Regen / mo</small><b>${fmt(m.monthly)}</b></div>
      <div><small>Minimum</small><b>${fmt(m.minPayment)}</b></div>
      <div><small>Due day</small><b>${m.dueDay}</b></div>
      <div><small>Damage dealt</small><b>${fmt(paid)}</b></div>
      <div><small>Interest healed</small><b>${fmt(interest)}</b></div>
    </div>
    <div class="row-buttons">
      ${m.alive ? '<button class="btn primary" data-action="attack">Attack (pay)</button>' : ''}
      <button class="btn" data-action="scout">Update balance</button>
      <button class="btn" data-action="charge">+ Charge</button>
      <button class="btn" data-action="edit">Edit</button>
    </div>
    <h3>History</h3>
    ${own.length ? `<ul class="log">${own.slice(0, 50).map((e) => `
      <li class="${e.amount < 0 ? 'income' : 'expense'}">
        <span class="grow">${ENTRY_KINDS[e.kind].label}${e.note ? ` · ${esc(e.note)}` : ''}<small>${dayLabel(e.date)}</small></span>
        <b>${e.amount < 0 ? '−' : '+'}${fmt(Math.abs(e.amount))}</b>
        <button class="x" data-action="del-ledger" data-id="${e.id}" aria-label="Delete">×</button>
      </li>`).join('')}</ul>` : '<p class="empty">No history yet.</p>'}
    <p class="hint">Started at ${fmt(m.startBalance)} on ${dayLabel(m.createdAt)}.</p>`;

  const sheet = openSheet(html, {
    className: 'debt',
    onAction: (action, el, { close }) => {
      if (action === 'del-ledger') {
        askConfirm('Delete this history entry? The balance will be recalculated.', { okLabel: 'Delete', danger: true }).then((ok) => {
          if (!ok) return;
          close();
          commit((s) => (s.ledger = s.ledger.filter((e) => e.id !== el.dataset.id)));
          openDebt(id);
        });
        return;
      }
      close();
      if (action === 'attack') logDebtEntry('payment', m.id, true);
      if (action === 'charge') logDebtEntry('charge', m.id, true);
      if (action === 'scout') scoutDebt(m);
      if (action === 'edit') editDebt(m);
    },
  });
  paintSprites(sheet.el);
}

// ---------- spending & income ----------

function addIncome(onDone) {
  const sources = [...new Set(state.incomes.map((i) => i.source).filter(Boolean))];
  openForm({
    title: 'Log income',
    fields: [
      { name: 'amount', label: 'Amount', type: 'money', required: true, positive: true, value: state.settings.expectedIncome || '' },
      { name: 'source', label: 'Source', type: 'text', value: sources.at(-1) || '', placeholder: 'e.g. Paycheck' },
      { name: 'date', label: 'Date', type: 'date', value: todayISO() },
    ],
    onSubmit: (v) => {
      commit((s) => {
        s.incomes.push({ id: uid(), amount: v.amount, source: v.source || '', date: v.date, note: '' });
        markActive();
        gainXp(XP.log);
      });
      toast(`+${fmt(v.amount)} gold. +${XP.log} XP`, 'good');
      if (onDone) setTimeout(onDone, 0);
    },
  });
}

function addExpense() {
  const cats = state.categories.filter((c) => c.kind !== 'debt');
  openForm({
    title: 'Log expense',
    intro: 'For debt payments use “+ Debt payment” so the monster takes the damage.',
    fields: [
      { name: 'amount', label: 'Amount', type: 'money', required: true, positive: true },
      { name: 'categoryId', label: 'Category', type: 'select', options: cats.map((c) => ({ value: c.id, label: c.name })), value: cats[0]?.id },
      { name: 'note', label: 'Note (optional)', type: 'text' },
      { name: 'date', label: 'Date', type: 'date', value: todayISO() },
    ],
    onSubmit: (v) => {
      commit((s) => {
        s.expenses.push({ id: uid(), amount: v.amount, categoryId: v.categoryId, note: v.note || '', date: v.date });
        markActive();
        gainXp(XP.log);
      });
      const cat = monthSummary(state, ymOf(v.date)).categories.find((c) => c.id === v.categoryId);
      const over = cat.limit > 0 && cat.remaining < 0;
      toast(over ? `${cat.name} is over budget by ${fmt(-cat.remaining)}` : `Logged. +${XP.log} XP`, over ? 'bad' : '');
    },
  });
}

function categoryForm(c) {
  const isNew = !c;
  const isDebt = c?.id === DEBT_CATEGORY_ID;
  openForm({
    title: isNew ? 'New category' : `Edit ${c.name}`,
    intro: isDebt ? 'The total you plan to put toward debts each month. Anything above the minimums becomes extra damage in your plan.' : '',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, value: c?.name || '' },
      ...(isDebt ? [] : [{
        name: 'kind', label: 'Kind', type: 'select', value: c?.kind || 'need',
        options: Object.entries(CATEGORY_KINDS).filter(([k]) => k !== 'debt').map(([value, label]) => ({ value, label })),
      }]),
      { name: 'limit', label: 'Monthly limit', type: 'money', required: true, value: c?.limit ?? 0 },
    ],
    extra: isNew || isDebt ? [] : [{ label: 'Delete', action: 'delete', className: 'bad' }],
    onExtra: (action, close) => {
      const used = state.expenses.filter((e) => e.categoryId === c.id).length;
      askConfirm(used ? `Delete ${c.name} and its ${used} logged expense(s)?` : `Delete ${c.name}?`, { okLabel: 'Delete', danger: true }).then((ok) => {
        if (!ok) return;
        close();
        commit((s) => {
          s.categories = s.categories.filter((x) => x.id !== c.id);
          s.expenses = s.expenses.filter((e) => e.categoryId !== c.id);
        });
      });
    },
    onSubmit: (v) => {
      commit((s) => {
        if (isNew) s.categories.splice(s.categories.length - 1, 0, { id: uid(), name: v.name, kind: v.kind, limit: v.limit });
        else Object.assign(s.categories.find((x) => x.id === c.id), v);
      });
    },
  });
}

function apply503020(s, income) {
  const groups = [
    [s.categories.filter((c) => c.kind === 'need'), 0.5],
    [s.categories.filter((c) => c.kind === 'want'), 0.3],
    [s.categories.filter((c) => c.kind === 'savings' || c.kind === 'debt'), 0.2],
  ];
  for (const [cats, share] of groups) {
    if (!cats.length) continue;
    const total = Math.round(income * share);
    const each = Math.floor(total / cats.length);
    cats.forEach((c, i) => (c.limit = each + (i === 0 ? total - each * cats.length : 0)));
  }
}

async function split503020() {
  const income = monthSummary(state, ui.month).income || state.settings.expectedIncome || 0;
  const ok = await askConfirm(`Split ${fmt(income)} as 50% needs, 30% wants, 20% savings & debt? You can adjust each one after.`, { okLabel: 'Split it', title: 'Quick-fill budget' });
  if (ok) commit((s) => apply503020(s, income));
}

// ---------- first-run setup ----------

function runSetup() {
  openForm({
    title: 'Setup 1 of 3: Income',
    intro: 'What do you usually take home each month, after tax?',
    fields: [
      { name: 'currency', label: 'Currency', type: 'select', options: CURRENCIES.map((c) => ({ value: c, label: c })), value: state.settings.currency },
      { name: 'income', label: 'Monthly take-home pay', type: 'money', value: state.settings.expectedIncome ?? '' },
      {
        name: 'logIt', label: `Log it as ${monthLabel(ymOf(todayISO()), { month: 'long' })}'s income`, type: 'checkbox',
        value: !state.incomes.some((i) => ymOf(i.date) === ymOf(todayISO())),
      },
    ],
    submitLabel: 'Next',
    onSubmit: (v) => {
      commit((s) => {
        s.settings.currency = v.currency;
        s.settings.expectedIncome = v.income || null;
        if (v.income && v.logIt) s.incomes.push({ id: uid(), amount: v.income, source: 'Paycheck', date: todayISO(), note: '' });
      });
      setTimeout(setupDebts, 0);
    },
  });
}

function setupDebts() {
  const n = state.debts.length;
  const sheet = openSheet(`
    <h2>Setup 2 of 3: Debts</h2>
    <p>${n ? `You have ${n} debt${n === 1 ? '' : 's'} so far.` : 'Add each credit card, loan or bill you owe on. Each one becomes a monster.'}</p>
    <p class="hint">Mortgages are optional. You can add one and uncheck “Fight this debt” to keep it off the battleground.</p>
    <div class="row-buttons">
      <button class="btn" data-action="next">${n ? 'Done with debts' : 'I have no debts'}</button>
      <button class="btn primary" data-action="add">${n ? 'Add another' : 'Add a debt'}</button>
    </div>`, {
    onAction: (a, _el, { close }) => {
      close();
      if (a === 'add') addDebt(setupDebts);
      if (a === 'next') setupBudget();
    },
  });
  return sheet;
}

async function setupBudget() {
  const income = state.settings.expectedIncome;
  if (income) {
    const ok = await askConfirm(
      `Start your budget with the 50/30/20 rule? ${fmt(Math.round(income * 0.5))} for needs, ${fmt(Math.round(income * 0.3))} for wants, ${fmt(Math.round(income * 0.2))} for savings and paying off debt. You can change every limit later.`,
      { title: 'Setup 3 of 3: Budget', okLabel: 'Use 50/30/20', cancelLabel: "I'll set it myself" },
    );
    if (ok) commit((s) => apply503020(s, income));
  }
  commit((s) => (s.settings.setupDone = true));
  toast('Setup complete. To battle!', 'good');
  go('battle');
}

// ---------- example data ----------

function exampleState() {
  const s = emptyState();
  const today = todayISO();
  const ym = ymOf(today);
  const debt = (name, type, bal, apr, min, dueDay, include = true) => ({
    id: uid(), name, type, startBalance: bal, apr, minPayment: min, dueDay, include, autoInterest: true,
    createdAt: today, accruedThrough: today, killRewarded: false,
  });
  s.settings.setupDone = true;
  s.settings.expectedIncome = 350000;
  s.debts = [
    debt('Example: Visa', 'credit', 420000, 24.99, 9500, 15),
    debt('Example: Store card', 'credit', 100000, 29.99, 2000, 5),
    debt('Example: Car loan', 'car', 1450000, 6.9, 31000, 20),
    debt('Example: Dentist', 'medical', 32000, 0, 4000, 1),
    debt('Example: Mortgage', 'mortgage', 25000000, 6.5, 160000, 1, false),
  ];
  const limits = { housing: 120000, food: 45000, transport: 20000, utilities: 25000, fun: 20000, savings: 20000, 'debt-attack': 80000 };
  for (const c of s.categories) c.limit = limits[c.id] ?? 0;
  // A few past months so the history chart has something to show.
  for (let k = 0; k < 4; k++) {
    const m = addMonths(ym, -k);
    s.incomes.push({ id: uid(), amount: 175000, source: 'Example paycheck', date: `${m}-01`, note: '' });
    if (k > 0) s.incomes.push({ id: uid(), amount: 175000, source: 'Example paycheck', date: `${m}-15`, note: '' });
    s.expenses.push({ id: uid(), amount: 120000, categoryId: 'housing', date: `${m}-01`, note: 'Rent' });
    s.expenses.push({ id: uid(), amount: 30000 + k * 4100, categoryId: 'food', date: `${m}-02`, note: 'Groceries' });
    s.expenses.push({ id: uid(), amount: 4500 + k * 900, categoryId: 'transport', date: `${m}-03`, note: 'Gas' });
    if (k > 0) s.expenses.push({ id: uid(), amount: 15000 + k * 2500, categoryId: 'fun', date: `${m}-12`, note: 'Going out' });
  }
  s.ledger = [{ id: uid(), debtId: s.debts[3].id, kind: 'payment', amount: -4000, date: `${ym}-01`, note: '', auto: false }];
  return s;
}

// ---------- events ----------

function onClick(e) {
  const a = e.target.closest('[data-action]');
  if (!a || a.closest('dialog')) return;
  const actions = {
    'add-debt': () => addDebt(),
    'open-debt': () => openDebt(a.dataset.id),
    'add-payment': () => logDebtEntry('payment'),
    'add-charge': () => logDebtEntry('charge'),
    'add-income': () => addIncome(),
    'add-expense': addExpense,
    'add-cat': () => categoryForm(null),
    'edit-cat': () => categoryForm(state.categories.find((c) => c.id === a.dataset.id)),
    'split-503020': split503020,
    setup: runSetup,
    month: () => {
      ui.month = addMonths(ui.month, Number(a.dataset.d));
      render();
    },
    'del-entry': async () => {
      if (!(await askConfirm('Delete this entry?', { okLabel: 'Delete', danger: true }))) return;
      const key = { income: 'incomes', expense: 'expenses', ledger: 'ledger' }[a.dataset.t];
      commit((s) => (s[key] = s[key].filter((x) => x.id !== a.dataset.id)));
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
    'set-expected': () => openForm({
      title: 'Usual monthly income',
      intro: 'Your normal take-home pay. Used to pre-fill income and for the 50/30/20 split.',
      fields: [{ name: 'income', label: 'Monthly take-home pay', type: 'money', value: state.settings.expectedIncome ?? '' }],
      onSubmit: (v) => commit((s) => (s.settings.expectedIncome = v.income || null)),
    }),
    backup: () => {
      downloadBackup(state);
      commit((s) => (s.settings.lastBackup = todayISO()));
      toast('Backup downloaded. Keep it somewhere safe.');
    },
    example: async () => {
      if (!(await askConfirm('Load made-up example debts and a sample budget so you can try things out? Erase it later in Settings.', { okLabel: 'Load examples', title: 'Example data' }))) return;
      state = exampleState();
      save();
      go('battle');
      toast('Example data loaded. These are not your numbers.');
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
  if (k === 'restore') {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const restored = await readBackup(file);
      if (!(await askConfirm(`Replace everything on this device with this backup (${restored.debts.length} debts, ${restored.incomes.length + restored.expenses.length} budget entries)?`, { okLabel: 'Restore', title: 'Restore backup?' }))) return;
      state = restored;
      runAccrual();
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
    if (document.querySelector('dialog[open]') || e.target.closest('.chart, input, select')) return;
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
  runAccrual();
  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  window.addEventListener('hashchange', render);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      runAccrual();
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
  requestPersistence().then((p) => {
    ui.persisted = p;
    if (route() === 'setup') render();
  });
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker not available', err));
  }
}

boot();
