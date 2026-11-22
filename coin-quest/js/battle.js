// The Battle tab's stage: a first-person view of one debt monster at a time in its habitat.
// Swipe (or the arrows) to face the next one. A payment plays an attack (battlefx.js) on the stage.
//
// The app renders the markup (battleMarkup) and calls mountBattle after every render; this module keeps
// its own state (which monster you're facing, the frame cache, a running attack) across re-renders.

import { MODELS, renderModel, renderPortrait, stageGroundRow, damageLevel } from './models.js';
import { renderScene, renderVictory, HABITATS } from './scenes.js';
import { createAttack, attackTier } from './battlefx.js';
import { esc } from './ui.js';

const SW = 120, SH = 168;
const FLAP = [0, 0.49, 0.98, 1.47]; // a full wing beat for the flying dragon
const B = { list: [], cur: 0, curId: null, els: null, fmt: (c) => String(c), hooks: {}, drag: null, slide: null, atk: null, running: false, lastNow: 0, motes: [] };
let groundRow = null;
const GY = () => groundRow ?? (groundRow = Math.round(stageGroundRow() * SH));
// The battle fills the screen. The canvas is sized to it in art pixels (cw x ch) at scale k, where k keeps
// the monster the size it had on the framed stage; the 120x168 monster frame sits at (ox, oy).
const L = { cw: SW, ch: SH, k: 3, ox: 0, oy: 0, hy: Math.round(SH * 0.55) };

// ---------- frames: one stage render per type, temper, damage level and (for the flyer) wing beat ----------
const frames = new Map();
const queue = [];
const fkey = (m, dmg, t) => `${m.type}|${m.temper}|${dmg}|${t}`;
const flyer = (m) => !!MODELS[m.type]?.flying;
const dmgOf = (m) => (m.balance > 0 ? damageLevel(m.balance, m.peak) : 1);
const toCanvas = (buf) => {
  const c = document.createElement('canvas');
  c.width = buf.w; c.height = buf.h;
  c.getContext('2d').putImageData(new ImageData(buf.data, buf.w, buf.h), 0, 0);
  return c;
};
function want(m, dmg, front = false) {
  for (const t of flyer(m) ? FLAP : [0.4]) {
    const k = fkey(m, dmg, t);
    if (frames.has(k) || queue.some((q) => q.k === k)) continue;
    const job = { k, m: { type: m.type, temper: m.temper }, dmg, t };
    if (front) queue.unshift(job); else queue.push(job);
  }
  pump();
}
let pumping = false;
function pump() {
  if (pumping) return;
  pumping = true;
  const step = () => {
    const t0 = performance.now();
    while (queue.length && performance.now() - t0 < 30) {
      const q = queue.shift();
      if (!frames.has(q.k)) frames.set(q.k, toCanvas(renderModel(q.m.type, q.m.temper, { w: SW, h: SH, framing: 'stage', t: q.t, damage: q.dmg, shadow: false })));
    }
    if (queue.length) setTimeout(step, 0);
    else pumping = false;
  };
  setTimeout(step, 0);
}
/** The frame to draw: the right damage level if it's ready, else the nearest one that is. */
function frameFor(m, time) {
  const w = dmgOf(m);
  for (const lvl of [w, 0.75, 0.5, 0.25, 0, 1].filter((l, i, a) => a.indexOf(l) === i)) {
    if (flyer(m)) {
      const all = FLAP.map((t) => frames.get(fkey(m, lvl, t)));
      if (all.every(Boolean)) return all[Math.floor(time * 5.2) % all.length];
      if (all[0] && lvl !== w) return all[0];
    } else if (frames.has(fkey(m, lvl, 0.4))) return frames.get(fkey(m, lvl, 0.4));
  }
  return frames.get(fkey(m, w, flyer(m) ? FLAP[0] : 0.4)) || null;
}
// The ground shadow is drawn on its own, so it stays put while the monster bobs, squishes or is knocked back.
const shadows = new Map();
function shadowOf(type) {
  if (!shadows.has(type)) shadows.set(type, toCanvas(renderModel(type, 'calm', { w: SW, h: SH, framing: 'stage', shadowOnly: true })));
  return shadows.get(type);
}
function drawShadow(g, m, x, turn, alpha = 1) {
  const sx = 1 - 0.42 * Math.min(1, turn);
  const w = Math.round(SW * sx);
  g.globalAlpha = alpha;
  g.drawImage(shadowOf(m.type), Math.round(L.ox + x + (SW - w) / 2), L.oy, w, SH);
  g.globalAlpha = 1;
}
const whiteCache = new WeakMap();
function whiteOf(cv) {
  if (whiteCache.has(cv)) return whiteCache.get(cv);
  const c = document.createElement('canvas');
  c.width = cv.width; c.height = cv.height;
  const g = c.getContext('2d');
  g.drawImage(cv, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  whiteCache.set(cv, c);
  return c;
}
const sceneCache = new Map();
function sceneOf(type) {
  const k = `${type}|${L.cw}|${L.ch}|${L.hy}`;
  if (!sceneCache.has(k)) sceneCache.set(k, toCanvas(renderScene(type, L.cw, L.ch, { hy: L.hy })));
  return sceneCache.get(k);
}

/** Bounding box, main colours and sample pixel positions of a rendered frame (for the attack's debris). */
const infoCache = new WeakMap();
function frameInfo(cv) {
  if (infoCache.has(cv)) return infoCache.get(cv);
  const a = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  let x0 = SW, y0 = SH, x1 = 0, y1 = 0;
  const counts = new Map(), points = [];
  for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
    const o = (y * SW + x) * 4;
    if (a[o + 3] < 200) continue;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    if ((x + y) % 3 === 0) points.push([x, y]);
    if (a[o] + a[o + 1] + a[o + 2] < 90) continue;
    const k = `#${[a[o], a[o + 1], a[o + 2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const info = { box: { x0, y0, x1, y1 }, palette: [...counts].sort((p, q) => q[1] - p[1]).slice(0, 4).map((p) => p[0]), points };
  infoCache.set(cv, info);
  return info;
}

// ---------- ambient particles per habitat ----------
const AMBIENT = { fireflies: ['#e8ff8a', '#a8e060'], embers: ['#ffb040', '#ff6a1a'], mist: ['#c8d0e8', '#9aa4c4'], snow: ['#ffffff', '#c8d4f0'] };
function seedMotes(kind) {
  const n = Math.round((kind === 'mist' ? 26 : 18) * (L.cw * L.ch) / (SW * SH));
  B.motes = Array.from({ length: n }, () => ({ x: Math.random() * L.cw, y: Math.random() * L.ch * 0.9, p: Math.random() * 6.28, s: 0.3 + Math.random() * 0.7 }));
}
function drawMotes(g, kind, time) {
  const cols = AMBIENT[kind];
  if (!cols) return;
  for (const q of B.motes) {
    if (kind === 'fireflies') { q.x += Math.sin(time * 0.8 + q.p) * 0.15; q.y += Math.cos(time * 0.6 + q.p) * 0.1; if (Math.sin(time * 3 + q.p) < 0.2) continue; }
    if (kind === 'embers') { q.y -= 0.25 * q.s; q.x += Math.sin(time + q.p) * 0.12; if (q.y < 0) { q.y = L.ch; q.x = Math.random() * L.cw; } }
    if (kind === 'snow') { q.y += 0.2 * q.s; q.x += Math.sin(time * 0.7 + q.p) * 0.1; if (q.y > L.ch) { q.y = 0; q.x = Math.random() * L.cw; } }
    if (kind === 'mist') { q.x += 0.08 * q.s; if (q.x > L.cw + 6) q.x = -6; q.y = L.hy - 8 + Math.sin(q.p) * 10; }
    g.fillStyle = cols[(q.p * 10 | 0) % 2];
    if (kind === 'mist') { g.globalAlpha = 0.18; g.fillRect(Math.round(q.x) - 4, Math.round(q.y), 9, 2); g.globalAlpha = 1; }
    else g.fillRect(Math.round(q.x), Math.round(q.y), 1, 1);
  }
}

// ---------- drawing ----------
const FX_B = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
let tmp = null;
function drawMonster(g, m, cv, x, turn, time, o = {}) {
  if (!cv) return;
  if (o.xf) {
    const xf = o.xf;
    if (xf.dissolve >= 1) return;
    if (!tmp || tmp.width !== L.cw || tmp.height !== L.ch) { tmp = document.createElement('canvas'); tmp.width = L.cw; tmp.height = L.ch; }
    const tg = tmp.getContext('2d');
    const target = xf.dissolve > 0 ? tg : g;
    if (target === tg) { tg.clearRect(0, 0, L.cw, L.ch); tg.imageSmoothingEnabled = false; }
    const px0 = L.ox + SW / 2 + x, py0 = xf.pivotY;
    target.save();
    target.translate(Math.round(px0 + xf.dx), Math.round(py0 + xf.dy));
    target.rotate(xf.rot);
    target.scale(xf.sx, xf.sy);
    target.translate(-px0, -py0);
    drawMonster(target, m, cv, x, turn, time, { white: xf.flash });
    target.restore();
    if (target === tg) {
      // dissolve from the top down, the edge glowing gold
      const img = tg.getImageData(0, 0, L.cw, L.ch), a = img.data, b = o.box, hgt = Math.max(1, b.y1 - b.y0);
      for (let y = Math.max(0, b.y0 - 20); y < Math.min(L.ch, b.y1 + 20); y++) for (let xx = 0; xx < L.cw; xx++) {
        const k = (y * L.cw + xx) * 4;
        if (!a[k + 3]) continue;
        const v = 0.5 * FX_B[((y >> 1) & 3) * 4 + ((xx >> 1) & 3)] + 0.5 * Math.min(1, Math.max(0, (y - b.y0) / hgt));
        const cut = xf.dissolve * 1.1;
        if (v < cut) a[k + 3] = 0;
        else if (v < cut + 0.07) { a[k] = 255; a[k + 1] = 214; a[k + 2] = 80; }
      }
      tg.putImageData(img, 0, 0);
      g.drawImage(tmp, 0, 0);
    }
    return;
  }
  const sx = 1 - 0.42 * Math.min(1, turn);
  const breathe = m.type === 'slime' ? Math.sin(time * 3) * 0.05 : 0;
  const bob = flyer(m) || m.type === 'castle' ? 0 : Math.round(Math.sin(time * 2.2) * 0.6);
  const w = Math.round(SW * sx * (1 - breathe * 0.6)), h = Math.round(SH * (1 + breathe));
  const gy = GY();
  g.drawImage(o.white ? whiteOf(cv) : cv, Math.round(L.ox + x + (SW - w) / 2), Math.round(L.oy + gy - gy * (h / SH)) + bob, w, h);
}

const shown = () => (B.atk ? B.atk.m : B.list[B.cur]);

function compose(g, offset, time) {
  const m = shown();
  if (!m) return;
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, L.cw, L.ch);
  const dir = offset < 0 ? 1 : -1;
  const n = B.list.length > 1 ? B.list[(B.cur + dir + B.list.length) % B.list.length] : null;
  const shift = offset * L.cw;
  g.drawImage(sceneOf(m.type), Math.round(shift * 0.5), 0);
  if (offset && n) g.drawImage(sceneOf(n.type), Math.round(shift * 0.5 + dir * L.cw), 0);
  drawMotes(g, HABITATS[m.type]?.particles, time);
  const A = B.atk?.A;
  if (A) {
    const dim = A.dim();
    if (dim > 0.01) { g.globalAlpha = dim; g.fillStyle = '#05030c'; g.fillRect(0, 0, L.cw, L.ch); g.globalAlpha = 1; }
    A.drawBack(g);
    const xf = A.monster();
    drawShadow(g, m, 0, 0, 1 - xf.dissolve);
    drawMonster(g, m, B.atk.frame, 0, 0, time, { xf, box: B.atk.box });
    A.drawFront(g);
    return;
  }
  const a = Math.abs(offset);
  const fm = frameFor(m, time);
  if (fm) { drawShadow(g, m, shift * 1.1, a * 1.6); drawMonster(g, m, fm, shift * 1.1, a * 1.6, time); }
  if (offset && n) {
    const fn = frameFor(n, time), nx = dir * L.cw * 0.9 * Math.pow(1 - a, 1.6);
    if (fn) { drawShadow(g, n, nx, (1 - a) * 1.4); drawMonster(g, n, fn, nx, (1 - a) * 1.4, time); }
  }
}

// ---------- the HUD ----------
function hudHtml(m) {
  const fmt = B.fmt;
  const pct = Math.max(0, Math.min(100, (Math.max(0, m.balance) / m.peak) * 100));
  return `
    <div class="b-name">${esc(m.name)}</div>
    <div class="b-sub">${m.rate}% APR · Started at ${fmt(m.start)}</div>
    <div class="b-bar" role="meter" aria-label="Still owed" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}" aria-valuetext="${fmt(Math.max(0, m.balance))} owed"><u style="width:${pct}%"></u><i style="width:${pct}%"></i>${m.boss ? [75, 50, 25].map((p) => `<span class="ph" style="left:${p}%"></span>`).join('') : ''}<b>${fmt(Math.max(0, m.balance))} owed</b></div>
    <div class="b-paid">Total paid: <em>${fmt(m.paid)}</em></div>`;
}
function renderHud() {
  const e = B.els;
  const m = shown();
  if (!e || !m) return;
  e.hud.innerHTML = hudHtml(m);
  e.dots.innerHTML = B.list.length > 1 ? B.list.map((_, k) => `<i class="${k === B.cur ? 'on' : ''}"></i>`).join('') : '';
  e.dots.style.top = `${e.hud.offsetTop + e.hud.offsetHeight + 8}px`;
  e.stage.setAttribute('aria-label', `${m.name}: ${m.speciesName}, ${B.fmt(Math.max(0, m.balance))} owed`);
}
function setBar(m, balance, drainSec, ghostDelay) {
  const bar = B.els?.hud.querySelector('.b-bar');
  if (!bar) return;
  const pct = Math.max(0, Math.min(100, (Math.max(0, balance) / m.peak) * 100));
  const i = bar.querySelector('i'), u = bar.querySelector('u');
  i.style.transitionDuration = `${drainSec}s`;
  i.style.width = `${pct}%`;
  setTimeout(() => { u.style.transitionDuration = `${drainSec + 0.2}s`; u.style.width = `${pct}%`; }, ghostDelay);
  bar.querySelector('b').textContent = `${B.fmt(Math.max(0, balance))} owed`;
  bar.setAttribute('aria-valuenow', Math.round(pct));
  bar.setAttribute('aria-valuetext', `${B.fmt(Math.max(0, balance))} owed`);
  const paid = B.els.hud.querySelector('.b-paid');
  if (paid) paid.innerHTML = `Total paid: <em>${B.fmt(m.paid + Math.max(0, m.balance - balance))}</em>`;
}

// ---------- markup and mounting ----------
export function battleMarkup() {
  return `
    <section class="b-stage-wrap" id="b-stage">
      <canvas class="b-stage" width="${SW}" height="${SH}" role="img" aria-label="Battle"></canvas>
      <div class="b-summon">Summoning…</div>
      <div class="b-hud"></div>
      <div class="b-dots" aria-hidden="true"></div>
      <button class="b-arrow l" type="button" aria-label="Previous debt">‹</button>
      <button class="b-arrow r" type="button" aria-label="Next debt">›</button>
      <div class="b-skip" hidden>Tap to speed up</div>
      <div class="b-actions">
        <button class="btn primary" type="button" data-b="pay">Pay</button>
        <button class="btn" type="button" data-b="details">Details</button>
      </div>
    </section>`;
}

/**
 * Bring the stage to life after the app renders its markup.
 * fighters: [{ id, name, type, temper, speciesName, rate, balance, peak, start, paid, boss }]
 * hooks: { onPay(id), onDetails(id) }
 */
export function mountBattle(root, fighters, fmt, hooks) {
  if (!root) return;
  B.list = fighters;
  B.fmt = fmt;
  B.hooks = hooks;
  const idx = B.list.findIndex((m) => m.id === B.curId);
  B.cur = idx >= 0 ? idx : Math.min(B.cur, Math.max(0, B.list.length - 1));
  B.curId = B.list[B.cur]?.id ?? null;
  B.els = {
    root,
    stage: root.querySelector('.b-stage'),
    hud: root.querySelector('.b-hud'),
    dots: root.querySelector('.b-dots'),
    skip: root.querySelector('.b-skip'),
    summon: root.querySelector('.b-summon'),
  };
  B.els.g = B.els.stage.getContext('2d');
  layout();
  if (!resizeHooked) {
    resizeHooked = true;
    addEventListener('resize', () => { if (B.els && document.body.contains(B.els.stage) && !B.atk) { layout(); seedMotes(HABITATS[shown()?.type]?.particles); renderHud(); } });
  }
  root.classList.toggle('single', B.list.length < 2);
  root.querySelector('.b-arrow.l').onclick = () => turn(-1);
  root.querySelector('.b-arrow.r').onclick = () => turn(1);
  root.querySelector('[data-b=pay]').onclick = () => !B.atk && shown() && B.hooks.onPay?.(shown().id);
  root.querySelector('[data-b=details]').onclick = () => !B.atk && shown() && B.hooks.onDetails?.(shown().id);
  const stage = B.els.stage;
  stage.addEventListener('pointerdown', (e) => {
    if (B.atk) { B.atk.A.skip(); return; }
    if (B.slide || B.list.length < 2) return;
    B.drag = { x0: e.clientX, y0: e.clientY, offset: 0 };
    stage.setPointerCapture?.(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!B.drag) return;
    B.drag.offset = Math.max(-1, Math.min(1, (e.clientX - B.drag.x0) / stage.getBoundingClientRect().width));
  });
  const end = () => {
    if (!B.drag) return;
    const off = B.drag.offset;
    if (Math.abs(off) > 0.25) turn(off < 0 ? 1 : -1);
    else B.slide = { from: off, to: 0, t0: performance.now(), dur: 220, done: () => {} };
    B.drag = null;
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  setBusy(!!B.atk);
  if (shown()) {
    seedMotes(HABITATS[shown().type]?.particles);
    renderHud();
    // this monster first, then its neighbours, then everyone else
    want(shown(), dmgOf(shown()), true);
    for (const k of [1, -1, 2, -2, 3, -3]) { const n = B.list[(B.cur + k + B.list.length * 3) % B.list.length]; if (n) want(n, dmgOf(n)); }
    if (B.atk) setBar(B.atk.m, B.atk.shownBalance, 0, 0);
  }
  if (!B.running) { B.running = true; B.lastNow = performance.now(); requestAnimationFrame(loop); }
}

/** Size the canvas to the screen. The monster keeps its size; its feet sit just above Pay and Details. */
function layout() {
  const e = B.els;
  const r = e.root.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const k = Math.max(1.5, Math.min(r.width - 32, 460, (r.height - 24) * SW / SH) / SW);
  const cw = Math.ceil(r.width / k), ch = Math.ceil(r.height / k);
  const actions = e.root.querySelector('.b-actions');
  // everything from the top of Pay down, plus a gap, stays clear of the monster
  const reserve = Math.ceil(((actions ? r.height - actions.offsetTop : 122) + 22) / k);
  const feet = Math.min(ch - reserve, ch - 6);
  Object.assign(L, { cw, ch, k, ox: Math.round((cw - SW) / 2), oy: feet - GY(), hy: feet - (GY() - Math.round(SH * 0.55)) });
  const c = e.stage;
  if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
  const top = r.height - ch * k;
  c.style.width = `${cw * k}px`;
  c.style.height = `${ch * k}px`;
  c.style.left = `${(r.width - cw * k) / 2}px`;
  c.style.top = `${top}px`;
  // where the monster's upper body is, for the attack's banner and damage number
  e.root.style.setProperty('--mon-y', `${Math.round(top + (feet - 70) * k)}px`);
}
let resizeHooked = false;

function turn(dir) {
  if (B.slide || B.atk || B.list.length < 2) return;
  const from = B.drag ? B.drag.offset : 0;
  B.slide = { from, to: dir > 0 ? -1 : 1, t0: performance.now(), dur: 380 * (1 - Math.abs(from)) + 140, done: () => {
    B.cur = (B.cur + dir + B.list.length) % B.list.length;
    B.curId = B.list[B.cur].id;
    seedMotes(HABITATS[shown().type]?.particles);
    renderHud();
    for (const k of [1, -1]) { const n = B.list[(B.cur + k + B.list.length) % B.list.length]; want(n, dmgOf(n)); }
  } };
}

/** Arrow keys turn to the next/previous debt while the Battle tab is showing. */
export function battleKey(e) {
  if (!B.els || !document.body.contains(B.els.stage) || document.querySelector('dialog[open]')) return;
  if (e.target.closest?.('input, select, textarea')) return;
  if (e.key === 'ArrowRight') turn(1);
  if (e.key === 'ArrowLeft') turn(-1);
}

function loop(now) {
  const e = B.els;
  if (!e || !document.body.contains(e.stage)) { B.running = false; return; }
  const time = now / 1000;
  let offset = B.drag ? B.drag.offset : 0;
  if (B.slide) {
    const k = Math.min(1, (now - B.slide.t0) / B.slide.dur);
    offset = B.slide.from + (B.slide.to - B.slide.from) * (1 - Math.pow(1 - k, 3));
    if (k >= 1) { const done = B.slide.done; B.slide = null; offset = 0; done(); }
  }
  if (B.atk) runAttack(now);
  B.lastNow = now;
  // screen shake and the zoom punch of an attack
  const v = B.atk ? B.atk.A.view() : null;
  e.stage.style.transform = v ? `translate(${(v.x * L.k).toFixed(1)}px, ${(v.y * L.k).toFixed(1)}px) scale(${v.zoom.toFixed(3)})` : '';
  compose(e.g, offset, time);
  if (e.summon && shown() && frameFor(shown(), time)) { e.summon.remove(); e.summon = null; }
  requestAnimationFrame(loop);
}

// ---------- attacking ----------
function setBusy(on) {
  if (!B.els) return;
  B.els.root.classList.toggle('busy', on);
  B.els.skip.hidden = !on;
  for (const b of B.els.root.querySelectorAll('.b-arrow, .b-actions .btn')) b.disabled = on;
}

/** True while an attack is playing. */
export const battleBusy = () => !!B.atk;

/**
 * Play an attack on the stage. `m` is the monster as it was before the payment (a fighter object, its
 * balance the old balance); `cents` the payment. onDone runs when the animation ends.
 */
export function playAttack(m, cents, onDone) {
  if (!B.els || !document.body.contains(B.els.stage)) return void onDone?.();
  const tr = attackTier(cents, m.peak, m.balance);
  const after = m.balance - cents;
  want(m, dmgOf(m), true);
  want({ ...m, balance: after }, damageLevel(Math.max(0, after), m.peak), true);
  const t0 = performance.now();
  const start = () => {
    const frame = frameFor(m, performance.now() / 1000);
    if (!frame) {
      if (performance.now() - t0 > 4000) return void onDone?.();
      return void setTimeout(start, 60);
    }
    const fi = frameInfo(frame);
    const info = { box: { x0: fi.box.x0 + L.ox, y0: fi.box.y0 + L.oy, x1: fi.box.x1 + L.ox, y1: fi.box.y1 + L.oy }, palette: fi.palette, points: fi.points.map(([x, y]) => [x + L.ox, y + L.oy]) };
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const A = createAttack({ tier: tr.index, kill: tr.kill, type: m.type, box: info.box, palette: info.palette, points: info.points,
      W: L.cw, H: L.ch, groundY: L.oy + GY(), flying: flyer(m), reduced, seed: (Math.random() * 1e9) | 0 });
    B.atk = { A, m: { ...m }, cents, tr, after, info, box: info.box, frame, onDone, shownBalance: m.balance };
    B.drag = null;
    B.slide = null;
    seedMotes(HABITATS[m.type]?.particles);
    renderHud();
    setBusy(true);
    if (tr.index >= 3) B.els.hud.classList.add('away'); // clear the sky for the big ones
  };
  start();
}

function popText(cls, html, ms) {
  const el = document.createElement('div');
  el.className = cls;
  el.innerHTML = html;
  B.els.root.appendChild(el);
  setTimeout(() => el.remove(), ms);
  return el;
}

function runAttack(now) {
  const at = B.atk;
  const { A, tr, m } = at;
  const cues = A.step((now - B.lastNow) / 1000);
  // the monster keeps animating from the right frame while the stage shows the new wounds after the hit
  if (at.hit) at.frame = frameFor({ ...m, balance: Math.max(0, at.after) }, now / 1000) || at.frame;
  else if (flyer(m)) at.frame = frameFor(m, now / 1000) || at.frame;
  for (const c of cues) {
    if (c.cue === 'banner') popText(`b-banner s${c.size}`, esc(c.text), 1500);
    if (c.cue === 'buzz') { try { navigator.vibrate?.(c.ms); } catch { /* not supported */ } }
    if (c.cue === 'hit') {
      at.hit = true;
      B.els.hud.classList.remove('away');
      const share = `${(tr.share * 100).toFixed(tr.share < 0.1 ? 1 : 0)}% of the debt`;
      const long = B.fmt(at.cents).length > 9;
      const el = popText(`b-dmg s${tr.stars}${long ? ' long' : ''}`, `<span>−${esc(B.fmt(0))}</span><small>${share}</small>`, 2300);
      const span = el.querySelector('span'), t0 = performance.now(), dur = 300 + tr.index * 180, total = at.cents;
      const count = () => {
        const k = Math.min(1, (performance.now() - t0) / dur);
        span.textContent = `−${B.fmt(k < 1 ? Math.round((total * (1 - Math.pow(1 - k, 3))) / 100) * 100 : total)}`;
        if (k < 1) requestAnimationFrame(count);
      };
      requestAnimationFrame(count);
      at.shownBalance = Math.max(0, at.after);
      setBar(m, at.shownBalance, 0.3 + tr.index * 0.25, 450 + tr.index * 150);
      if (m.boss && at.after > 0) {
        const before = Math.floor((m.balance / m.peak) * 4), after = Math.floor((at.after / m.peak) * 4);
        if (after < before) setTimeout(() => B.atk && popText('b-banner s3', `Phase broken!<small>${4 - after} of 4 down</small>`, 1500), 1100 + tr.index * 200);
      }
    }
    if (c.cue === 'defeated') popText('b-banner win', `Defeated!<small>${esc(m.name)} is paid off</small>`, 3000);
  }
  if (A.done) {
    const done = at.onDone;
    B.atk = null;
    B.els.hud.classList.remove('away');
    setBusy(false);
    done?.();
  }
}

// ---------- dioramas: the monster in its habitat, as a strip at the top of the Pay and Details sheets ----------
const dioramas = new Map();
/** Draw monster m (a fighter) standing in its habitat into canvas c, cropped to the monster. */
export function drawDiorama(c, m) {
  const key = `${m.type}|${m.temper}|${dmgOf(m)}`;
  let d = dioramas.get(key);
  if (!d) {
    const scene = toCanvas(renderScene(m.type, SW, SH));
    const frame = toCanvas(renderModel(m.type, m.temper, { w: SW, h: SH, framing: 'stage', t: 0.4, damage: dmgOf(m), shadow: false }));
    const g = scene.getContext('2d');
    g.drawImage(shadowOf(m.type), 0, 0);
    g.drawImage(frame, 0, 0);
    const box = frameInfo(frame).box;
    const top = Math.max(0, box.y0 - 10), bottom = Math.min(SH, Math.max(box.y1, GY()) + 12);
    d = { scene, top, h: bottom - top };
    dioramas.set(key, d);
  }
  c.width = SW;
  c.height = d.h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(d.scene, 0, d.top, SW, d.h, 0, 0, SW, d.h);
}

/** The attack a payment would make, for the payment form: stars only (names show during the attack). */
export function attackPower(cents, peak, balance) {
  const tr = attackTier(cents, peak, balance);
  return { stars: tr.stars, kill: tr.kill, share: tr.share };
}

// ---------- victory: every debt paid off ----------
// A sunrise over a treasure hill with fireworks, light rays, confetti and twinkling gold, full screen like
// the battle, with "Debt free!", the total paid and a shelf of the debts beaten.

const V = { els: null, running: false, fw: [], conf: [], last: 0, born: 0, nextLaunch: 0, layers: null, L: null };

export function victoryMarkup() {
  return `
    <section class="b-stage-wrap v-wrap" id="b-victory">
      <canvas class="b-stage v-stage" role="img" aria-label="Victory: a sunrise over a treasure chest, with fireworks"></canvas>
      <div class="v-head" role="status">
        <div class="v-title">Debt free!</div>
        <div class="v-sub"></div>
        <div class="v-paid"></div>
      </div>
      <div class="v-bottom">
        <div class="v-shelf"><div class="v-shelf-h">Trophies</div><div class="v-trophies"></div></div>
        <button class="v-add" type="button" data-action="add-debt">Add a debt</button>
      </div>
    </section>`;
}

/** info: { count, total, trophies: [fighter] } */
export function mountVictory(root, info, fmt) {
  if (!root) return;
  const stage = root.querySelector('.v-stage');
  V.els = { root, stage, g: stage.getContext('2d') };
  root.querySelector('.v-sub').textContent = info.count === 1 ? 'You beat your debt.' : `You beat all ${info.count} debts.`;
  root.querySelector('.v-paid').innerHTML = `Total paid: <em>${esc(fmt(info.total))}</em>`;
  const shelf = root.querySelector('.v-trophies');
  shelf.innerHTML = '';
  for (const m of info.trophies) {
    const c = document.createElement('canvas');
    c.width = c.height = 56;
    c.title = m.name;
    c.setAttribute('role', 'img');
    c.setAttribute('aria-label', `${m.name}, paid off`);
    c.getContext('2d').putImageData(new ImageData(renderPortrait(m.type, m.temper, { size: 56 }).data, 56, 56), 0, 0);
    shelf.appendChild(c);
  }
  victoryLayout();
  if (!V.running) {
    V.running = true;
    V.last = V.born = performance.now();
    V.nextLaunch = 0;
    V.fw = [];
    V.conf = [];
    requestAnimationFrame(victoryLoop);
  }
}

function victoryLayout() {
  const e = V.els;
  const r = e.root.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const k = Math.max(1.5, Math.min(r.width - 32, 460, (r.height - 24) * SW / SH) / SW);
  const cw = Math.ceil(r.width / k), ch = Math.ceil(r.height / k);
  const bottom = e.root.querySelector('.v-bottom');
  const ground = ch - Math.ceil(((bottom ? r.height - bottom.offsetTop : 160) + 26) / k);
  const hy = Math.max(Math.round(ch * 0.38), ground - 34);
  const key = `${cw}|${ch}|${hy}|${ground}`;
  if (!V.layers || V.layers.key !== key) {
    const v = renderVictory(cw, ch, hy, ground);
    V.layers = { key, sky: toCanvas(v.sky), land: toCanvas(v.land), sun: v.sun };
  }
  V.L = { cw, ch, k, hy, ground };
  e.stage.width = cw; e.stage.height = ch;
  const top = r.height - ch * k;
  Object.assign(e.stage.style, { width: `${cw * k}px`, height: `${ch * k}px`, left: `${(r.width - cw * k) / 2}px`, top: `${top}px`, transform: '' });
}

const FW_COLORS = [['#fff6c0', '#ffd040', '#ff9a20'], ['#ffffff', '#ff8ac8', '#d0408a'], ['#ffffff', '#8af0ff', '#3a9ad0'], ['#ffffff', '#b8ff8a', '#4ab040']];
const CONF = ['#ffd040', '#ff6a8a', '#6ad0ff', '#b8ff8a', '#ffffff', '#ff9a20'];

function victoryLoop(now) {
  const e = V.els;
  if (!e || !document.body.contains(e.stage)) { V.running = false; return; }
  const dt = Math.min(0.05, (now - V.last) / 1000);
  V.last = now;
  const t = (now - V.born) / 1000;
  const { cw, ch, hy, ground } = V.L;
  const g = e.g;
  const px = (x, y, c, a = 1) => { g.globalAlpha = a; g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), 1, 1); };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  g.imageSmoothingEnabled = false;
  g.globalAlpha = 1;
  g.drawImage(V.layers.sky, 0, 0);
  // slowly turning rays of light from the sun
  const sun = V.layers.sun;
  const spin = reduced ? 0 : t * 0.12;
  g.fillStyle = '#fff0b0';
  for (let y = 0; y < hy; y += 1) for (let x = 0; x < cw; x += 1) {
    const dx = x - sun.x, dy = y - sun.y, d = Math.hypot(dx, dy);
    if (d < sun.r * 1.05) continue;
    const a = Math.atan2(dy, dx) + spin;
    const ray = Math.cos(a * 9);
    const fall = 1 - d / (cw * 1.1);
    if (ray > 0.55 && fall * (ray - 0.55) * 2.2 > FX_B[(y & 3) * 4 + (x & 3)]) { g.globalAlpha = 0.35; g.fillRect(x, y, 1, 1); }
  }
  g.globalAlpha = 1;
  // fireworks: rockets rise from behind the hills and burst; a flurry when the screen first opens
  if (!reduced && t >= V.nextLaunch) {
    V.nextLaunch = t + (t < 3 ? 0.35 : 0.7 + Math.random() * 0.9);
    const x = cw * (0.15 + Math.random() * 0.7);
    V.fw.push({ kind: 'rocket', x, y: hy, vy: -(55 + Math.random() * 30), ty: ch * (0.1 + Math.random() * 0.25), col: FW_COLORS[Math.floor(Math.random() * FW_COLORS.length)] });
  }
  for (let i = V.fw.length - 1; i >= 0; i--) {
    const f = V.fw[i];
    if (f.kind === 'rocket') {
      f.y += f.vy * dt;
      px(f.x, f.y, '#fff0c0'); px(f.x, f.y + 1, '#ffb040', 0.7); px(f.x, f.y + 2, '#ff7a20', 0.4);
      if (f.y <= f.ty) {
        V.fw.splice(i, 1);
        const n = 34 + Math.floor(Math.random() * 18), sp = 26 + Math.random() * 18;
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2 + Math.random() * 0.2, v = sp * (0.6 + Math.random() * 0.5);
          V.fw.push({ kind: 'spark', x: f.x, y: f.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1.1 + Math.random() * 0.6, age: 0, col: f.col });
        }
      }
      continue;
    }
    f.age += dt;
    if (f.age > f.life) { V.fw.splice(i, 1); continue; }
    f.vx *= 1 - 1.6 * dt; f.vy = f.vy * (1 - 1.6 * dt) + 18 * dt;
    f.x += f.vx * dt; f.y += f.vy * dt;
    const k = f.age / f.life;
    px(f.x, f.y, f.col[Math.min(2, Math.floor(k * 3))], k > 0.7 ? (1 - k) / 0.3 : 1);
    if (k < 0.4) px(f.x - f.vx * 0.03, f.y - f.vy * 0.03, f.col[1], 0.5);
  }
  g.globalAlpha = 1;
  g.drawImage(V.layers.land, 0, 0);
  // the victory flag on the treasure hill
  const fx = Math.round(cw / 2) + 30, fy = ground - 50;
  for (let y = fy; y < ground - 4; y++) { px(fx, y, '#d8d8e8'); px(fx + 1, y, '#8a8aa0'); }
  px(fx, fy - 1, '#ffd040'); px(fx + 1, fy - 1, '#ffd040');
  for (let x = 0; x < 14; x++) {
    const wv = reduced ? 0 : Math.round(Math.sin(t * 6 - x * 0.6) * 1.2 * (x / 14));
    for (let y = 0; y < 9; y++) px(fx + 2 + x, fy + y + wv, y === 0 || y === 8 ? '#b86e12' : y > 2 && y < 6 ? '#e04848' : '#ffd040');
  }
  // twinkles on the gold
  if (!reduced) for (let i = 0; i < 4; i++) {
    const x = cw / 2 + (Math.random() - 0.5) * 56, y = ground - 3 - Math.random() * 22;
    px(x, y, '#ffffff'); px(x - 1, y, '#fff6c0', 0.6); px(x + 1, y, '#fff6c0', 0.6); px(x, y - 1, '#fff6c0', 0.6); px(x, y + 1, '#fff6c0', 0.6);
  }
  // confetti drifting down
  if (!reduced) {
    while (V.conf.length < 46) V.conf.push({ x: Math.random() * cw, y: -Math.random() * ch * (V.conf.length < 20 && t < 0.5 ? 1 : 0.1), vy: 12 + Math.random() * 16, p: Math.random() * 6.28, c: CONF[Math.floor(Math.random() * CONF.length)] });
    for (let i = V.conf.length - 1; i >= 0; i--) {
      const q = V.conf[i];
      q.y += q.vy * dt;
      q.x += Math.sin(t * 2 + q.p) * 0.25;
      if (q.y > ch) { V.conf.splice(i, 1); continue; }
      g.globalAlpha = 1;
      g.fillStyle = q.c;
      if (Math.sin(t * 8 + q.p) > 0) g.fillRect(Math.round(q.x), Math.round(q.y), 2, 1);
      else g.fillRect(Math.round(q.x), Math.round(q.y), 1, 2);
    }
  }
  g.globalAlpha = 1;
  requestAnimationFrame(victoryLoop);
}

addEventListener('resize', () => { if (V.els && document.body.contains(V.els.stage)) victoryLayout(); });
