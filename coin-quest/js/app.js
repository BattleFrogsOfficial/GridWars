// App shell: state, routing, views and actions.

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
import { esc, toast, openSheet, openForm } from './ui.js';

let state = emptyState();
const ui = { month: ymOf(todayISO()), persisted: null, installPrompt: null };

const view = document.getElementById('view');
const fmt = (c, o) => formatMoney(c, state.settings.currency, o);
const typeLabel = (k) => DEBT_TYPES.find((t) => t.key === k)?.label || 'Debt';

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
  if (after > before) setTimeout(() => toast(`LEVEL UP! You are now level ${after}.`, 'good'), 1200);
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

// ---------- rendering helpers ----------

function spriteCanvas(key, temper, scale, cls = '') {
  return `<canvas class="sprite ${cls}" width="${16 * scale}" height="${16 * scale}" data-sprite="${key}" data-temper="${temper}" data-scale="${scale}"></canvas>`;
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

// ---------- views ----------

function townView() {
  const lv = levelInfo(state.player.xp);
  const st = streak(state.player.days, todayISO());
  const ms = monsters();
  const alive = ms.filter((m) => m.alive && m.include);
  const totalHp = alive.reduce((s, m) => s + m.balance, 0);
  const regen = alive.filter((m) => m.regen);
  const month = monthSummary(state, ymOf(todayISO()));
  const { plan } = currentPlan();
  const iOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const backupAge = state.settings.lastBackup ? Math.round((Date.parse(todayISO()) - Date.parse(state.settings.lastBackup)) / 864e5) : null;
  const hasData = state.debts.length || state.incomes.length || state.expenses.length;

  return `
    <h1>Town</h1>
    <section class="card hero">
      ${spriteCanvas('hero', 'calm', 4)}
      <div class="grow">
        <div class="hero-line"><strong>Level ${lv.level}</strong><span>${st} day streak</span></div>
        <div class="xp"><div style="width:${(lv.into / lv.span) * 100}%"></div></div>
        <small>${lv.toNext} XP to level ${lv.level + 1}</small>
      </div>
    </section>

    ${!standalone && iOS ? `<section class="card tip">Install: tap <b>Share</b> then <b>Add to Home Screen</b>. It works offline and keeps your save safer.</section>` : ''}
    ${!standalone && ui.installPrompt ? `<section class="card tip">Install Coin Quest on this device. <button class="btn primary" data-action="install">Install</button></section>` : ''}
    ${hasData && (backupAge == null || backupAge > 30) ? `<section class="card tip">Your save lives only on this device. ${backupAge == null ? 'You have never made a backup.' : `Last backup was ${backupAge} days ago.`} <a href="#/settings">Back up now</a></section>` : ''}

    <section class="card">
      <h2>The Battlefield</h2>
      ${alive.length ? `
        <div class="big">${fmt(totalHp)}</div><small>total monster HP across ${alive.length} monster${alive.length === 1 ? '' : 's'}</small>
        ${plan.feasible ? `<p>On your current plan, the last one falls in <b>${monthLabel(addMonths(ymOf(todayISO()), plan.months))}</b>.</p>` : `<p class="bad">At this pace some monsters never die. Check the Quest tab.</p>`}
        ${regen.length ? `<p class="bad">${regen.map((m) => esc(m.name)).join(', ')} heal${regen.length === 1 ? 's' : ''} faster than the minimum payment hits.</p>` : ''}
        <a class="btn" href="#/battle">To battle</a>`
        : `<p>No monsters yet. Add your debts to see them.</p><a class="btn primary" href="#/battle">Add a debt</a>`}
    </section>

    <section class="card">
      <h2>${monthLabel(month.ym, { month: 'long' })} gold</h2>
      <div class="stats">
        <div><small>Income</small><b>${fmt(month.income)}</b></div>
        <div><small>Spent</small><b>${fmt(month.spent)}</b></div>
        <div><small>Left</small><b class="${month.left < 0 ? 'bad' : ''}">${fmt(month.left)}</b></div>
      </div>
      <div class="row-buttons">
        <button class="btn" data-action="add-income">+ Income</button>
        <button class="btn primary" data-action="add-expense">+ Expense</button>
      </div>
    </section>`;
}

function monsterCard(m) {
  return `
    <button class="card monster ${m.alive ? '' : 'dead'}" data-action="open-debt" data-id="${m.id}">
      ${spriteCanvas(m.species.key, m.temper.key, 4)}
      <div class="grow">
        <div class="m-name">${esc(m.name)}</div>
        <small>${m.alive ? `${m.temper.name} ${m.species.name}` : 'Defeated'} · ${m.apr}% APR</small>
        ${m.alive ? hpBar(m.hpPct, fmt(m.balance)) : ''}
        ${m.regen ? '<small class="bad">Regenerating! Minimum doesn\'t cover interest</small>' : ''}
      </div>
    </button>`;
}

function battleView() {
  const ms = monsters();
  const active = ms.filter((m) => m.alive && m.include).sort((a, b) => b.balance - a.balance);
  const benched = ms.filter((m) => m.alive && !m.include);
  const dead = ms.filter((m) => !m.alive);
  return `
    <h1>Battle</h1>
    <button class="btn primary wide" data-action="add-debt">+ New monster (debt)</button>
    ${active.length ? active.map(monsterCard).join('') : '<p class="empty">No monsters on the battlefield.</p>'}
    ${benched.length ? `<h2>Benched</h2><p class="hint">Kept off the battlefield and out of the quest plan.</p>${benched.map(monsterCard).join('')}` : ''}
    ${dead.length ? `<h2>Trophies</h2>${dead.map(monsterCard).join('')}` : ''}`;
}

function questView() {
  const { active, auto, extra, strategy, plan, baseline } = currentPlan();
  if (!active.length) return `<h1>Quest</h1><p class="empty">Add debts on the Battle tab to plan your quest.</p>`;
  const now = ymOf(todayISO());
  const byId = new Map(active.map((m) => [m.id, m]));
  const savedInterest = baseline.feasible ? baseline.totalInterest - plan.totalInterest : null;
  const savedMonths = baseline.feasible ? baseline.months - plan.months : null;

  return `
    <h1>Quest</h1>
    <section class="card">
      <h2>Strategy</h2>
      <div class="seg">
        ${Object.entries(STRATEGIES).map(([k, s]) => `<button class="${k === strategy ? 'on' : ''}" data-action="set-strategy" data-key="${k}">${s.label}</button>`).join('')}
      </div>
      <p class="hint">${STRATEGIES[strategy].blurb}</p>
      <div class="stats">
        <div><small>Minimums</small><b>${fmt(auto.mins)}</b></div>
        <div><small>Extra / month</small><b>${fmt(extra)}</b></div>
        <div><small>Total / month</small><b>${fmt(plan.budget)}</b></div>
      </div>
      <p class="hint">${state.settings.extraCents == null
        ? `Extra comes from your budget's Debt attack (${fmt(auto.attack)}) minus minimums.`
        : 'Extra set by hand.'}</p>
      ${auto.attack < auto.mins ? `<p class="bad">Your budget's Debt attack (${fmt(auto.attack)}) is ${fmt(auto.mins - auto.attack)} short of the minimum payments. Raise it on the Budget tab.</p>` : ''}
      <button class="btn" data-action="set-extra">Change extra</button>
    </section>

    <section class="card">
      ${plan.feasible ? `
        <h2>Debt free: ${monthLabel(addMonths(now, plan.months))}</h2>
        <div class="stats">
          <div><small>Time</small><b>${monthsLabel(plan.months)}</b></div>
          <div><small>Interest paid</small><b>${fmt(plan.totalInterest)}</b></div>
        </div>
        ${extra > 0 ? (savedInterest != null
          ? `<p class="good">vs. minimums only: ${fmt(savedInterest)} less interest and ${monthsLabel(savedMonths)} sooner.</p>`
          : `<p class="good">Paying only the minimums, you would never finish. Your extra makes this possible.</p>`) : ''}`
        : `<h2 class="bad">This quest never ends</h2>
           <p>With ${fmt(plan.budget)} a month, interest grows faster than you pay. Raise the extra amount, or check the minimum payments are right.</p>`}
    </section>

    <section class="card">
      <h2>Order of battle</h2>
      <ol class="kills">
        ${plan.kills.map((k) => {
          const m = byId.get(k.id);
          return `<li>${spriteCanvas(m.species.key, m.temper.key, 2)}<span class="grow">${esc(m.name)}</span><small>${monthLabel(addMonths(now, k.month), { month: 'short', year: 'numeric' })}</small></li>`;
        }).join('')}
        ${active.filter((m) => !plan.kills.some((k) => k.id === m.id)).map((m) => `<li>${spriteCanvas(m.species.key, m.temper.key, 2)}<span class="grow">${esc(m.name)}</span><small class="bad">never</small></li>`).join('')}
      </ol>
      <p class="hint">Assumes rates stay the same and no new charges. Plans are estimates, not financial advice.</p>
    </section>`;
}

function budgetView() {
  const m = monthSummary(state, ui.month);
  const entries = [
    ...state.incomes.filter((i) => ymOf(i.date) === ui.month).map((i) => ({ ...i, t: 'income', label: i.source || 'Income' })),
    ...state.expenses.filter((e) => ymOf(e.date) === ui.month).map((e) => ({
      ...e, t: 'expense', label: (state.categories.find((c) => c.id === e.categoryId)?.name || '?') + (e.note ? ` · ${e.note}` : ''),
    })),
    ...state.ledger.filter((e) => e.kind === 'payment' && ymOf(e.date) === ui.month).map((e) => ({
      ...e, amount: -e.amount, t: 'attack', label: `Attack: ${state.debts.find((d) => d.id === e.debtId)?.name || 'debt'}`,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  const allZero = state.categories.every((c) => c.limit === 0);

  return `
    <h1>Budget</h1>
    <div class="month-nav">
      <button class="btn" data-action="month" data-d="-1" aria-label="Previous month">‹</button>
      <b>${monthLabel(ui.month)}</b>
      <button class="btn" data-action="month" data-d="1" aria-label="Next month">›</button>
    </div>
    <section class="card">
      <div class="stats">
        <div><small>Income</small><b>${fmt(m.income)}</b></div>
        <div><small>Spent</small><b>${fmt(m.spent)}</b></div>
        <div><small>Left</small><b class="${m.left < 0 ? 'bad' : ''}">${fmt(m.left)}</b></div>
      </div>
      <p class="${m.toAssign < 0 ? 'bad' : m.toAssign === 0 && m.income > 0 ? 'good' : ''}">
        ${m.toAssign > 0 ? `${fmt(m.toAssign)} still needs a job.` : m.toAssign < 0 ? `You've planned ${fmt(-m.toAssign)} more than you earned.` : m.income > 0 ? 'Every coin has a job.' : 'Log your income to start planning.'}
      </p>
      <div class="row-buttons">
        <button class="btn" data-action="add-income">+ Income</button>
        <button class="btn primary" data-action="add-expense">+ Expense</button>
      </div>
    </section>

    <section class="card">
      <h2>Categories <small>(monthly limits)</small></h2>
      ${allZero && m.income > 0 ? `<button class="btn" data-action="split-503020">Quick-fill 50/30/20 from income</button>` : ''}
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
      <h2>Log</h2>
      ${entries.length ? `<ul class="log">${entries.map((e) => `
        <li class="${e.t}">
          <span class="grow">${esc(e.label)}<small>${dayLabel(e.date)}</small></span>
          <b>${e.t === 'income' ? '+' : '−'}${fmt(e.amount)}</b>
          ${e.t === 'attack' ? '' : `<button class="x" data-action="del-entry" data-t="${e.t}" data-id="${e.id}" aria-label="Delete">×</button>`}
        </li>`).join('')}</ul>` : '<p class="empty">Nothing logged this month.</p>'}
    </section>`;
}

const CURRENCIES = ['USD', 'CAD', 'EUR', 'GBP', 'AUD', 'NZD', 'MXN', 'BRL', 'INR', 'JPY', 'CHF', 'SEK', 'ZAR', 'PHP'];

function settingsView() {
  return `
    <h1>Gear</h1>
    <section class="card">
      <h2>Currency</h2>
      <select data-change="currency">${CURRENCIES.map((c) => `<option ${c === state.settings.currency ? 'selected' : ''}>${c}</option>`).join('')}</select>
    </section>
    <section class="card">
      <h2>Backup</h2>
      <p>Your data never leaves this device. Download a backup file to keep it safe or move it to a new phone.</p>
      <p class="hint">Last backup: ${state.settings.lastBackup ? dayLabel(state.settings.lastBackup) : 'never'}</p>
      <div class="row-buttons">
        <button class="btn primary" data-action="backup">Download backup</button>
        <label class="btn">Restore backup<input type="file" accept="application/json,.json" data-change="restore" hidden></label>
      </div>
      <p class="hint">Storage: ${ui.persisted == null ? 'checking…' : ui.persisted ? 'protected from automatic clean-up' : 'the browser may clear it if space runs low. Installing to your home screen helps.'}</p>
    </section>
    <section class="card">
      <h2>Install</h2>
      <p><b>iPhone/iPad:</b> open in Safari, tap Share, then Add to Home Screen.<br><b>Android:</b> open in Chrome, tap ⋮, then Add to Home screen / Install app.</p>
    </section>
    <section class="card danger">
      <h2>Danger zone</h2>
      <button class="btn bad" data-action="erase">Erase everything</button>
    </section>`;
}

const VIEWS = { town: townView, battle: battleView, quest: questView, budget: budgetView, settings: settingsView };

function route() {
  const r = location.hash.replace(/^#\/?/, '');
  return r in VIEWS ? r : 'town';
}

function render() {
  const r = route();
  view.innerHTML = VIEWS[r]();
  for (const a of document.querySelectorAll('.tabs a')) a.toggleAttribute('aria-current', a.dataset.tab === r);
  paintSprites(view);
}

// ---------- debts ----------

const debtTypeOptions = DEBT_TYPES.map((t) => ({ value: t.key, label: t.label }));

function addDebt() {
  openForm({
    title: 'New monster',
    intro: 'Enter a debt as it is today. Its size depends on the balance; its color on the interest rate.',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, placeholder: 'e.g. Visa card' },
      { name: 'type', label: 'Type', type: 'select', options: debtTypeOptions, value: 'credit' },
      { name: 'balance', label: 'Current balance', type: 'money', required: true, positive: true },
      { name: 'apr', label: 'Interest rate (APR %)', type: 'percent', required: true },
      { name: 'minPayment', label: 'Minimum monthly payment', type: 'money', required: true },
      { name: 'dueDay', label: 'Due day of month (1–31)', type: 'int', required: true, min: 1, maxValue: 31, value: 1 },
      { name: 'include', label: 'Fight this debt', type: 'checkbox', value: true, hint: 'Uncheck to keep it (for example a mortgage) off the battlefield and out of the plan.' },
      { name: 'autoInterest', label: 'Add interest automatically each month', type: 'checkbox', value: true },
    ],
    submitLabel: 'Summon',
    onSubmit: (v) => {
      const today = todayISO();
      commit((s) => {
        s.debts.push({
          id: uid(), name: v.name, type: v.type, startBalance: v.balance, apr: v.apr, minPayment: v.minPayment,
          dueDay: v.dueDay, include: v.include, autoInterest: v.autoInterest, createdAt: today, accruedThrough: today, killRewarded: false,
        });
      });
      toast(`${v.name} has appeared!`);
    },
  });
}

function editDebt(m) {
  openForm({
    title: `Edit ${m.name}`,
    intro: 'To change the balance, use Scout instead.',
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
      if (!confirm(`Delete ${m.name} and its whole history? This can't be undone.`)) return;
      close();
      commit((s) => {
        s.debts = s.debts.filter((d) => d.id !== m.id);
        s.ledger = s.ledger.filter((e) => e.debtId !== m.id);
      });
    },
  });
}

function addEntry(m, kind) {
  const isAttack = kind === 'payment';
  const titles = { payment: `Attack ${m.name}`, charge: `New charge on ${m.name}`, fee: `Fee on ${m.name}` };
  openForm({
    title: titles[kind],
    intro: isAttack ? 'Log a payment you made. Every coin is damage.' : 'New spending or fees heal the monster.',
    fields: [
      { name: 'amount', label: 'Amount', type: 'money', required: true, positive: true, value: isAttack ? Math.min(m.minPayment, m.balance) || '' : '' },
      { name: 'date', label: 'Date', type: 'date', value: todayISO() },
      { name: 'note', label: 'Note (optional)', type: 'text' },
    ],
    submitLabel: isAttack ? 'Strike!' : 'Add',
    onSubmit: (v) => {
      if (isAttack && v.amount > m.balance) return `That's more than its HP (${fmt(m.balance)}).`;
      if (v.date > todayISO()) return 'Pick today or an earlier date.';
      let killed = false;
      commit((s) => {
        s.ledger.push({ id: uid(), debtId: m.id, kind, amount: isAttack ? -v.amount : v.amount, date: v.date, note: v.note || '', auto: false });
        if (isAttack) {
          markActive();
          gainXp(attackXp(v.amount));
          const d = s.debts.find((x) => x.id === m.id);
          if (m.balance - v.amount <= 0 && !d.killRewarded) {
            d.killRewarded = true;
            gainXp(XP.kill[m.species.key] || 100);
            killed = true;
          }
        }
      });
      if (killed) {
        toast(`VICTORY! ${m.name} is defeated! +${XP.kill[m.species.key] || 100} XP`, 'good');
      } else {
        openDebt(m.id, isAttack ? v.amount : -v.amount);
        if (isAttack) toast(`Hit for ${fmt(v.amount)}! +${attackXp(v.amount)} XP`, 'good');
      }
    },
  });
}

function scoutDebt(m) {
  openForm({
    title: `Scout ${m.name}`,
    intro: `The app thinks the balance is <b>${fmt(m.balance)}</b>. Enter the real balance from your statement and the difference is recorded.`,
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
      ${spriteCanvas(m.alive ? m.species.key : m.species.key, m.temper.key, 10, m.alive ? '' : 'dead')}
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
      <button class="btn" data-action="scout">Scout</button>
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
        if (!confirm('Delete this entry?')) return;
        close();
        commit((s) => (s.ledger = s.ledger.filter((e) => e.id !== el.dataset.id)));
        return openDebt(id);
      }
      close();
      if (action === 'attack') addEntry(m, 'payment');
      if (action === 'charge') addEntry(m, 'charge');
      if (action === 'scout') scoutDebt(m);
      if (action === 'edit') editDebt(m);
    },
  });
  paintSprites(sheet.el);
}

// ---------- budget ----------

function addIncome() {
  const sources = [...new Set(state.incomes.map((i) => i.source).filter(Boolean))];
  openForm({
    title: 'Log income',
    fields: [
      { name: 'amount', label: 'Amount', type: 'money', required: true, positive: true },
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
    },
  });
}

function addExpense() {
  const cats = state.categories.filter((c) => c.kind !== 'debt');
  openForm({
    title: 'Log expense',
    intro: 'Debt payments are logged by attacking a monster on the Battle tab.',
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
      toast(cat.limit > 0 && cat.remaining < 0 ? `${cat.name} is over budget by ${fmt(-cat.remaining)}` : `Logged. +${XP.log} XP`, cat.remaining < 0 && cat.limit > 0 ? 'bad' : '');
    },
  });
}

function categoryForm(c) {
  const isNew = !c;
  const isDebt = c?.id === DEBT_CATEGORY_ID;
  openForm({
    title: isNew ? 'New category' : `Edit ${c.name}`,
    intro: isDebt ? 'The total you plan to put toward debts each month. Anything above the minimums becomes extra damage in the Quest plan.' : '',
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
      if (!confirm(used ? `Delete ${c.name} and its ${used} logged expense(s)?` : `Delete ${c.name}?`)) return;
      close();
      commit((s) => {
        s.categories = s.categories.filter((x) => x.id !== c.id);
        s.expenses = s.expenses.filter((e) => e.categoryId !== c.id);
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

function split503020() {
  const income = monthSummary(state, ui.month).income;
  if (!confirm(`Split ${fmt(income)} as 50% needs, 30% wants, 20% savings & debt? You can adjust each one after.`)) return;
  commit((s) => {
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
  });
}

// ---------- events ----------

function onClick(e) {
  const a = e.target.closest('[data-action]');
  if (!a || a.closest('dialog')) return;
  const act = a.dataset.action;
  const actions = {
    'add-debt': addDebt,
    'open-debt': () => openDebt(a.dataset.id),
    'add-income': addIncome,
    'add-expense': addExpense,
    'add-cat': () => categoryForm(null),
    'edit-cat': () => categoryForm(state.categories.find((c) => c.id === a.dataset.id)),
    'split-503020': split503020,
    month: () => {
      ui.month = addMonths(ui.month, Number(a.dataset.d));
      render();
    },
    'del-entry': () => {
      if (!confirm('Delete this entry?')) return;
      const key = a.dataset.t === 'income' ? 'incomes' : 'expenses';
      commit((s) => (s[key] = s[key].filter((x) => x.id !== a.dataset.id)));
    },
    'set-strategy': () => commit((s) => (s.settings.strategy = a.dataset.key)),
    'set-extra': () => {
      const { auto } = currentPlan();
      openForm({
        title: 'Extra damage per month',
        intro: `On top of the minimums (${fmt(auto.mins)}). From your budget this would be ${fmt(auto.extra)}.`,
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
    erase: () => {
      if (!confirm('Erase ALL data on this device? Download a backup first if you might want it.')) return;
      if (prompt('Type ERASE to confirm') !== 'ERASE') return;
      state = emptyState();
      save();
      location.hash = '#/town';
      render();
      toast('All data erased.');
    },
    install: async () => {
      ui.installPrompt?.prompt();
      await ui.installPrompt?.userChoice;
      ui.installPrompt = null;
      render();
    },
  };
  actions[act]?.();
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
      if (!confirm(`Replace everything on this device with this backup (${restored.debts.length} debts, ${restored.incomes.length + restored.expenses.length} budget entries)?`)) return;
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
  render();
  requestPersistence().then((p) => {
    ui.persisted = p;
    if (route() === 'settings') render();
  });
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker failed', err));
  }
}

boot();
