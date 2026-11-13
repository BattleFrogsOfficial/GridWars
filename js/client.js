'use strict';
// ---------- Rendering, input and HUD ----------
let ME = 0, running = false, cv, ctx, endShown = false;
const cam = { x: 0, y: 0, z: 2 };
const UI = { sel: [], selB: 0, place: null, menu: null, amove: false, boxMode: false, hover: null, box: null, panelKey: '', lastClick: 0, lastId: 0, lastPlace: -1 };
const keys = {}, fxList = [], ptrs = new Map();
let drag = null, miniBase, miniImg, miniDirty = true;
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function toast(t) {
  const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; $('toasts').appendChild(d);
  while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
  setTimeout(() => d.remove(), 3500);
}
function consumeEvents(e, fx, msg) {
  if (e && e.length) { for (let i = 0; i < e.length; i += 2) miniPixel(e[i]); miniDirty = true; }
  if (fx) { const t = performance.now(); for (const f of fx) fxList.push({ k: f[0], x1: f[1], y1: f[2], x2: f[3], y2: f[4], t }); if (fxList.length > 400) fxList.splice(0, fxList.length - 400); }
  if (msg) for (const m of msg) toast(m);
}

// ----- game start / main loops -----
function startGame(you) {
  ME = you; running = true; endShown = false;
  UI.sel = []; UI.selB = 0; UI.place = null; UI.menu = null;
  for (const id of ['menu', 'lobby', 'end']) $(id).classList.add('hidden');
  $('hud').classList.remove('hidden');
  buildMini(); goHome(); updateTop(); refreshPanel(true);
  toast('You are ' + TEAMNAME[ME] + '. Tap a worker, then tap a tree, rock or bush to gather.');
}
function goHome() {
  const b = S.buildings.find(b => b.owner === ME && b.type === 'townhall') || S.buildings.find(b => b.owner === ME);
  if (b) centerOn(b.x + 1.5, b.y + 1.5);
  else { const st = S.map.starts[0]; centerOn(st.x, st.y); }
}
function centerOn(tx, ty) { cam.x = tx * TILE - cv.width / cam.z / 2; cam.y = ty * TILE - cv.height / cam.z / 2; clampCam(); }
function clampCam() {
  const vw = cv.width / cam.z, vh = cv.height / cam.z, m = 40;
  cam.x = Math.max(-m, Math.min(MW * TILE - vw + m, cam.x)); cam.y = Math.max(-m, Math.min(MH * TILE - vh + m, cam.y));
}
let simAcc = 0, simLast = 0;
function simLoop() {
  const now = performance.now(); let dt = now - simLast; simLast = now;
  if (!running || !S || !S.host) return;
  simAcc = Math.min(simAcc + dt, 600); let n = 0;
  while (simAcc >= 100 && n < 6) { simTick(); simAcc -= 100; n++; }
  if (!n) return;
  const e = S.tev, fx = S.fx, msg = S.msgs; S.tev = []; S.fx = []; S.msgs = [];
  consumeEvents(e, fx, msg);
  if (Net.mode === 'host') { for (const v of e) Net.buf.e.push(v); for (const v of fx) Net.buf.fx.push(v.map(r2)); for (const v of msg) Net.buf.msg.push(v); if (S.tick % 2 === 0 || S.over) netSnapshot(); }
}
let lastFrame = 0, lastUI = 0, lastMini = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now;
  if (!running || !S) return;
  const sp = 500 * dt / cam.z * (keys.shift ? 2.5 : 1);
  if (keys.arrowleft || keys.a) cam.x -= sp; if (keys.arrowright || keys.d) cam.x += sp;
  if (keys.arrowup || keys.w) cam.y -= sp; if (keys.arrowdown || keys.s) cam.y += sp;
  clampCam(); render(now, dt);
  if (now - lastUI > 250) { lastUI = now; updateTop(); refreshPanel(false); checkEnd(); }
  if (now - lastMini > 300) { lastMini = now; drawMini(); }
}

// ----- minimap -----
function miniColor(i) {
  const t = S.map.ter[i], f = S.map.feat[i]; let c = TERRAIN[t].col, k = 1;
  if (f === F.TREE) k = 0.72; else if (f === F.ROAD || f === F.BRIDGE) c = [176, 150, 110]; else if (f === F.GOLD) c = [232, 184, 32]; else if (f === F.IRON) c = [150, 90, 60]; else if (f === F.ROCK) k = 0.8;
  return [c[0] * k, c[1] * k, c[2] * k];
}
function buildMini() {
  miniBase = mk(MW, MH); const g = miniBase.getContext('2d'); miniImg = g.createImageData(MW, MH);
  for (let i = 0; i < MW * MH; i++) { const c = miniColor(i); miniImg.data[i * 4] = c[0]; miniImg.data[i * 4 + 1] = c[1]; miniImg.data[i * 4 + 2] = c[2]; miniImg.data[i * 4 + 3] = 255; }
  g.putImageData(miniImg, 0, 0); miniDirty = false;
}
function miniPixel(i) { const c = miniColor(i); miniImg.data[i * 4] = c[0]; miniImg.data[i * 4 + 1] = c[1]; miniImg.data[i * 4 + 2] = c[2]; }
function drawMini() {
  const m = $('mini'), g = m.getContext('2d');
  if (miniDirty) { miniBase.getContext('2d').putImageData(miniImg, 0, 0); miniDirty = false; }
  g.drawImage(miniBase, 0, 0);
  for (const b of S.buildings) { const s = Math.max(5, (BLD[b.type].size || 1) * 3); g.fillStyle = TEAM[b.owner]; g.fillRect(b.x - 1, b.y - 1, s, s); }
  for (const u of S.units) { if (u.inBoat) continue; g.fillStyle = u.owner === ME ? '#fff' : TEAM[u.owner]; g.fillRect((u.x | 0) - 1, (u.y | 0) - 1, 4, 4); g.fillStyle = TEAM[u.owner]; g.fillRect(u.x | 0, u.y | 0, 2, 2); }
  g.strokeStyle = '#fff'; g.lineWidth = 3; g.strokeRect(cam.x / TILE, cam.y / TILE, cv.width / cam.z / TILE, cv.height / cam.z / TILE);
}
function miniPointer(e) {
  if (!(e.buttons || e.type === 'pointerdown')) return; const r = $('mini').getBoundingClientRect();
  centerOn((e.clientX - r.left) / r.width * MW, (e.clientY - r.top) / r.height * MH); e.preventDefault();
}

// ----- rendering -----
function render(now, dt) {
  const cw = cv.width, ch = cv.height, z = cam.z, m = S.map;
  ctx.imageSmoothingEnabled = false; ctx.fillStyle = '#16305f'; ctx.fillRect(0, 0, cw, ch);
  const X = wx => Math.round((wx * TILE - cam.x) * z), Y = wy => Math.round((wy * TILE - cam.y) * z);
  const x0 = Math.max(0, Math.floor(cam.x / TILE)), y0 = Math.max(0, Math.floor(cam.y / TILE));
  const x1 = Math.min(MW - 1, Math.floor((cam.x + cw / z) / TILE)), y1 = Math.min(MH - 1, Math.floor((cam.y + ch / z) / TILE));
  const wf = (now / 700) | 0;
  for (let y = y0; y <= y1; y++) {
    const sy = Y(y), sh = Y(y + 1) - sy;
    for (let x = x0; x <= x1; x++) {
      const i = y * MW + x, t = m.ter[i], sx = X(x), sw = X(x + 1) - sx;
      const v = t <= T.SHALLOW ? (x * 3 + y * 5 + wf) & 3 : ((x * 73856093) ^ (y * 19349663)) & 3;
      ctx.drawImage(SPR.ter[t][v], sx, sy, sw, sh);
      const f = m.feat[i]; if (f) ctx.drawImage(featSprite(f, t), sx, sy, sw, sh);
    }
  }
  // buildings
  const selB = UI.selB;
  for (const b of S.buildings) {
    const d = BLD[b.type], s = d.size || 1; if (b.x + s < x0 || b.x > x1 + 1 || b.y + s < y0 || b.y > y1 + 1) continue;
    const sx = X(b.x), sy = Y(b.y), sw = X(b.x + s) - sx, sh = Y(b.y + s) - sy;
    if (b.prog < 1) ctx.globalAlpha = 0.45 + 0.4 * b.prog;
    ctx.drawImage(bldSprite(b.type, b.owner), sx, sy, sw, sh); ctx.globalAlpha = 1;
    if (b.id === selB) { ctx.strokeStyle = b.owner === ME ? '#fff' : '#ff6a5a'; ctx.lineWidth = Math.max(1, z); ctx.strokeRect(sx + 1, sy + 1, sw - 2, sh - 2); }
    if (b.prog < 1) bar(sx, sy + sh - 3 * z, sw, b.prog, '#f0c62a', z);
    else if (b.hp < d.hp || b.id === selB) bar(sx, sy - 3 * z, sw, b.hp / d.hp, '#5fc24a', z);
    if (b.queue && b.queue.length && b.owner === ME) bar(sx, sy + sh - 3 * z, sw, b.qp, '#6ab8ff', z);
  }
  // units
  const vis = [], k = Math.min(1, dt * 14), selSet = new Set(UI.sel);
  for (const u of S.units) {
    if (u.inBoat) continue;
    if (u.rx === undefined) { u.rx = u.x; u.ry = u.y; u.face = 1; }
    const ox = u.rx, oy = u.ry;
    if (Math.abs(u.x - u.rx) > 6 || Math.abs(u.y - u.ry) > 6) { u.rx = u.x; u.ry = u.y; } else { u.rx += (u.x - u.rx) * k; u.ry += (u.y - u.ry) * k; }
    const mv = Math.abs(u.rx - ox) + Math.abs(u.ry - oy); u.mv = mv > 0.004;
    if (u.rx - ox > 0.003) u.face = 1; else if (u.rx - ox < -0.003) u.face = -1;
    if (u.rx >= x0 - 1 && u.rx <= x1 + 2 && u.ry >= y0 - 1 && u.ry <= y1 + 2) vis.push(u);
  }
  vis.sort((a, b) => a.ry - b.ry);
  const us = Math.round(TILE * z);
  for (const u of vis) {
    const d = UNIT[u.type], bob = u.mv && ((now / 130 + u.id) & 1) ? z : (d.cls === 'boat' && ((now / 500 + u.id) & 1) ? z : 0);
    const cx = X(u.rx), cy = Y(u.ry), sx = cx - us / 2, sy = cy - us * 0.68 - bob;
    if (selSet.has(u.id)) { ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1, z); ctx.beginPath(); ctx.ellipse(cx, cy + us * 0.22, us * 0.42, us * 0.2, 0, 0, 6.3); ctx.stroke(); }
    const sp = unitSprite(u.type, u.owner);
    if (u.face < 0) { ctx.save(); ctx.translate(cx, 0); ctx.scale(-1, 1); ctx.drawImage(sp, -us / 2, sy, us, us); ctx.restore(); } else ctx.drawImage(sp, sx, sy, us, us);
    if (u.cn > 0 && u.ct) { ctx.fillStyle = '#000'; ctx.fillRect(sx + us * 0.05, sy + us * 0.5, 4 * z + 2, 4 * z + 2); ctx.fillStyle = RESCOL[u.ct]; ctx.fillRect(sx + us * 0.05 + 1, sy + us * 0.5 + 1, 4 * z, 4 * z); }
    const cg = u.cargo ? u.cargo.length : (u.cargoN || 0);
    if (cg) { ctx.fillStyle = '#fff'; ctx.font = 'bold ' + (6 * z) + 'px monospace'; ctx.textAlign = 'center'; ctx.fillText(cg, cx, sy - z); }
    if (u.hp < d.hp || selSet.has(u.id)) bar(sx + us * 0.15, sy - 2 * z, us * 0.7, u.hp / d.hp, u.owner === ME ? '#5fc24a' : '#e0503f', z);
  }
  // effects
  for (let i = fxList.length - 1; i >= 0; i--) {
    const f = fxList[i], a = (now - f.t) / (f.k === 3 ? 600 : f.k === 1 ? 500 : f.k === 5 ? 500 : 260);
    if (a >= 1) { fxList.splice(i, 1); continue; }
    if (f.k <= 1) {
      const px = f.x1 + (f.x2 - f.x1) * a, py = f.y1 + (f.y2 - f.y1) * a - Math.sin(a * 3.14) * (f.k ? 2 : 0.6), s = (f.k ? 3 : 2) * z;
      ctx.fillStyle = f.k ? '#555' : '#f4e8c0'; ctx.fillRect(X(px) - s / 2, Y(py) - s / 2, s, s); ctx.fillStyle = '#0006'; ctx.fillRect(X(px) - s / 2, Y(py) + s / 2, s, z);
    } else if (f.k === 2) { ctx.fillStyle = 'rgba(200,30,30,' + (1 - a) + ')'; const s = (4 + a * 8) * z; ctx.fillRect(X(f.x1) - s / 2, Y(f.y1) - s / 2, s, s); }
    else if (f.k === 3) { ctx.fillStyle = 'rgba(120,100,80,' + (1 - a) + ')'; const s = (f.x2 * 16 * (0.6 + a * 0.8)) * z; ctx.fillRect(X(f.x1) - s / 2, Y(f.y1) - s / 2, s, s); }
    else if (f.k === 4) { ctx.fillStyle = 'rgba(255,255,255,' + (1 - a) + ')'; const s = 3 * z; ctx.fillRect(X(f.x2) - s / 2, Y(f.y2 - 0.3) - s / 2, s, s); }
    else if (f.k === 5) { ctx.strokeStyle = 'rgba(' + (f.x2 ? '255,90,70,' : '120,255,120,') + (1 - a) + ')'; ctx.lineWidth = z; const s = (4 + a * 10) * z; ctx.strokeRect(X(f.x1) - s / 2, Y(f.y1) - s / 2, s, s); }
  }
  // placement ghost
  if (UI.place && UI.hover) {
    const d = BLD[UI.place], s = d.size || 1, bx = UI.hover.x - (s >> 1), by = UI.hover.y - (s >> 1), ok = !canPlace(ME, UI.place, bx, by);
    const sx = X(bx), sy = Y(by), sw = X(bx + s) - sx, sh = Y(by + s) - sy;
    ctx.globalAlpha = 0.65; ctx.drawImage(bldSprite(UI.place, ME), sx, sy, sw, sh); ctx.globalAlpha = 1;
    ctx.strokeStyle = ok ? '#7dff7d' : '#ff5a4a'; ctx.lineWidth = Math.max(2, z); ctx.strokeRect(sx, sy, sw, sh);
  }
  if (UI.box) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.fillStyle = '#ffffff22'; const b = UI.box; ctx.fillRect(b.x, b.y, b.w, b.h); ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w, b.h); }
}
function bar(x, y, w, f, col, z) { const h = Math.max(2, 2 * z); ctx.fillStyle = '#000'; ctx.fillRect(x, y, w, h); ctx.fillStyle = col; ctx.fillRect(x + 1, y + 1, Math.max(0, (w - 2) * Math.max(0, Math.min(1, f))), h - 2); }

// ----- input -----
function toWorld(cx, cy) { const r = cv.getBoundingClientRect(); return { x: (cam.x + (cx - r.left) / cam.z) / TILE, y: (cam.y + (cy - r.top) / cam.z) / TILE }; }
function zoomAt(cx, cy, nz) {
  nz = Math.max(1, Math.min(5, nz)); const w = toWorld(cx, cy), r = cv.getBoundingClientRect();
  cam.z = nz; cam.x = w.x * TILE - (cx - r.left) / nz; cam.y = w.y * TILE - (cy - r.top) / nz; clampCam();
}
function pick(w) {
  let best = null, bd = 0.75;
  for (const u of S.units) { if (u.inBoat) continue; const d = Math.hypot((u.rx === undefined ? u.x : u.rx) - w.x, (u.ry === undefined ? u.y : u.ry) - 0.25 - w.y); if (d < bd) { bd = d; best = u; } }
  if (best) return { u: best };
  const tx = w.x | 0, ty = w.y | 0; if (!inb(tx, ty)) return null;
  const o = S.occ[ty * MW + tx]; if (o) { const b = S.bById.get(o); if (b) return { b }; }
  return null;
}
const mySel = () => UI.sel.map(i => S.uById.get(i)).filter(u => u && u.owner === ME && !u.inBoat && !u.dead);
function selectUnits(us) { UI.sel = us.map(u => u.id); UI.selB = 0; UI.menu = null; UI.amove = false; refreshPanel(true); }
function selectBld(b) { UI.sel = []; UI.selB = b ? b.id : 0; UI.menu = null; refreshPanel(true); }
function command(w) {
  const us = mySel(); if (!us.length) return; const ids = us.map(u => u.id), e = pick(w);
  const ping = bad => fxList.push({ k: 5, x1: w.x, y1: w.y, x2: bad ? 1 : 0, y2: 0, t: performance.now() });
  if (e) {
    const t = e.u || e.b;
    if (t.owner !== ME) { sendCmd({ c: 'attack', ids, t: t.id, b: e.b ? 1 : 0 }); ping(true); return; }
    if (e.u && UNIT[t.type].cap && us.some(u => UNIT[u.type].cls !== 'boat')) { sendCmd({ c: 'board', ids, boat: t.id }); ping(); return; }
  }
  const tx = w.x | 0, ty = w.y | 0; if (!inb(tx, ty)) return; const i = ty * MW + tx, f = S.map.feat[i];
  if (FEAT[f]) {
    const wk = us.filter(u => u.type === 'worker');
    if (wk.length) { sendCmd({ c: 'gather', ids: wk.map(u => u.id), i }); const rest = us.filter(u => u.type !== 'worker'); if (rest.length) sendCmd({ c: 'move', ids: rest.map(u => u.id), x: tx, y: ty }); ping(); return; }
  }
  sendCmd({ c: 'move', ids, x: tx, y: ty, a: UI.amove ? 1 : 0 }); ping(UI.amove);
  if (UI.amove) { UI.amove = false; refreshPanel(true); }
}
function tryPlace(w, quiet) {
  const type = UI.place, d = BLD[type], s = d.size || 1, x = (w.x | 0) - (s >> 1), y = (w.y | 0) - (s >> 1);
  UI.hover = { x: w.x | 0, y: w.y | 0 };
  const key = y * MW + x; if (quiet && key === UI.lastPlace) return; UI.lastPlace = key;
  const r = canPlace(ME, type, x, y);
  if (r) { if (!quiet) toast(r); return; }
  if (!canAfford(S.players[ME], d.cost)) { if (!quiet) toast('Not enough resources for ' + d.name); return; }
  sendCmd({ c: 'build', type, x, y });
  if (!(d.wall || d.tile || keys.shift)) { UI.place = null; refreshPanel(true); }
}
function click(cx, cy, touch, btn) {
  const w = toWorld(cx, cy);
  if (UI.place) { if (btn === 2) { UI.place = null; refreshPanel(true); } else tryPlace(w, false); return; }
  if (!touch && btn === 2) { command(w); return; }
  const e = pick(w), now = performance.now(), us = mySel();
  if (e && e.u && e.u.owner === ME) {
    if (touch && us.length && UNIT[e.u.type].cap && us.some(u => UNIT[u.type].cls !== 'boat') && !us.includes(e.u)) { command(w); return; }
    if (now - UI.lastClick < 400 && UI.lastId === e.u.id) { // double tap: all of this type on screen
      const a = toWorld(0, 0), b = toWorld(cv.width, cv.height);
      selectUnits(S.units.filter(u => u.owner === ME && u.type === e.u.type && !u.inBoat && u.x >= a.x && u.x <= b.x && u.y >= a.y && u.y <= b.y));
    } else if (keys.shift && us.length) selectUnits(us.includes(e.u) ? us.filter(u => u !== e.u) : us.concat([e.u]));
    else selectUnits([e.u]);
    UI.lastClick = now; UI.lastId = e.u.id; return;
  }
  if (touch && us.length && !(e && e.b && e.b.owner === ME)) { command(w); return; }
  if (e && e.b) { selectBld(e.b); return; }
  if (e && e.u) { UI.sel = []; UI.selB = 0; UI.menu = null; UI.view = e.u.id; refreshPanel(true); return; }
  UI.sel = []; UI.selB = 0; UI.view = 0; refreshPanel(true);
}
function boxSelect(b) {
  const a = toWorld(b.x, b.y), c = toWorld(b.x + b.w, b.y + b.h);
  let us = S.units.filter(u => u.owner === ME && !u.inBoat && u.x >= a.x && u.x <= c.x && u.y >= a.y - 0.3 && u.y <= c.y + 0.5);
  const mil = us.filter(u => !UNIT[u.type].civil); if (mil.length) us = mil;
  if (us.length) selectUnits(us);
}
function initInput() {
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('pointerdown', e => {
    if (!running) return; try { cv.setPointerCapture(e.pointerId); } catch (_) { }
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 2) { const p = [...ptrs.values()]; drag = { mode: 'pinch', d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), z: cam.z }; UI.box = null; return; }
    const touch = e.pointerType !== 'mouse';
    drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY, moved: false, touch, btn: e.button, mode: !touch && e.button === 1 ? 'pan' : null };
    if (UI.place) { const w = toWorld(e.clientX, e.clientY); UI.hover = { x: w.x | 0, y: w.y | 0 }; UI.lastPlace = -1; }
  });
  cv.addEventListener('pointermove', e => {
    if (!running) return;
    if (e.pointerType === 'mouse') { const w = toWorld(e.clientX, e.clientY); UI.hover = { x: w.x | 0, y: w.y | 0 }; }
    const p = ptrs.get(e.pointerId); if (!p) return; p.x = e.clientX; p.y = e.clientY;
    if (!drag) return;
    if (drag.mode === 'pinch') { if (ptrs.size >= 2) { const q = [...ptrs.values()]; const d = Math.hypot(q[0].x - q[1].x, q[0].y - q[1].y); zoomAt((q[0].x + q[1].x) / 2, (q[0].y + q[1].y) / 2, drag.z * d / drag.d); } return; }
    if (drag.id !== e.pointerId) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > (drag.touch ? 9 : 5)) {
      drag.moved = true;
      if (!drag.mode) drag.mode = drag.touch ? (UI.boxMode && !UI.place ? 'box' : 'pan') : drag.btn === 0 ? (UI.place ? 'paint' : 'box') : 'pan';
    }
    if (drag.mode === 'pan') { cam.x -= (e.clientX - drag.lx) / cam.z; cam.y -= (e.clientY - drag.ly) / cam.z; clampCam(); }
    else if (drag.mode === 'box') UI.box = { x: Math.min(drag.sx, e.clientX), y: Math.min(drag.sy, e.clientY), w: Math.abs(e.clientX - drag.sx), h: Math.abs(e.clientY - drag.sy) };
    else if (drag.mode === 'paint' && UI.place && (BLD[UI.place].wall || BLD[UI.place].tile)) tryPlace(toWorld(e.clientX, e.clientY), true);
    drag.lx = e.clientX; drag.ly = e.clientY;
  });
  const up = e => {
    ptrs.delete(e.pointerId); if (!drag) return;
    if (drag.mode === 'pinch') { drag = ptrs.size ? { mode: 'dead' } : null; return; }
    if (drag.mode === 'dead') { if (!ptrs.size) drag = null; return; }
    if (drag.id !== e.pointerId) return;
    if (e.type === 'pointerup') {
      if (!drag.moved) click(e.clientX, e.clientY, drag.touch, drag.btn);
      else if (drag.mode === 'box' && UI.box) { boxSelect(UI.box); if (drag.touch) { UI.boxMode = false; $('bBox').classList.remove('on'); } }
    }
    UI.box = null; drag = null;
  };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', e => { if (!running) return; e.preventDefault(); zoomAt(e.clientX, e.clientY, cam.z * (e.deltaY < 0 ? 1.25 : 0.8)); }, { passive: false });
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return; const k = e.key.toLowerCase(); keys[k] = true; if (!running) return;
    if (k === 'escape') { UI.place = null; UI.menu = null; UI.amove = false; refreshPanel(true); }
    else if (k === 'b') act('menu:build'); else if (k === 'h') goHome(); else if (k === 'q') act('amove'); else if (k === 'x') act('stop');
    else if (k === 'delete' && UI.selB) act('demolish');
  });
  window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
  const mini = $('mini'); mini.addEventListener('pointerdown', e => { mini.setPointerCapture(e.pointerId); miniPointer(e); }); mini.addEventListener('pointermove', miniPointer);
  $('panel').addEventListener('click', e => { const b = e.target.closest('[data-a]'); if (b) act(b.dataset.a); });
  $('bBuild').onclick = () => act(UI.menu === 'build' ? 'menu:close' : 'menu:build');
  $('bBox').onclick = () => { UI.boxMode = !UI.boxMode; $('bBox').classList.toggle('on', UI.boxMode); if (UI.boxMode) toast('Drag on the map to select several units.'); };
  $('bHome').onclick = goHome;
  $('bHelp').onclick = $('bHelp2').onclick = showHelp; $('helpClose').onclick = () => $('help').classList.add('hidden');
}

// ----- HUD -----
function act(a) {
  const [k, v, v2] = a.split(':'), b = S.bById.get(UI.selB), ids = mySel().map(u => u.id);
  if (k === 'menu') { UI.menu = v === 'build' ? 'build' : null; UI.place = null; }
  else if (k === 'build') { UI.place = v; UI.menu = null; UI.hover = null; toast((BLD[v].wall || BLD[v].tile) ? 'Tap tiles to place ' + BLD[v].name + ' (mouse: drag to paint). Cancel when done.' : 'Tap the map to place the ' + BLD[v].name + '.'); }
  else if (k === 'cancelplace') UI.place = null;
  else if (k === 'train' && b) {
    const p = S.players[ME], ud = UNIT[v];
    if (ud.req && !hasBld(ME, ud.req)) toast('Requires a ' + BLD[ud.req].name); else if (!canAfford(p, ud.cost)) toast('Not enough resources'); else if (p.pop >= p.cap) toast('Army cap reached. Build more homes.');
    sendCmd({ c: 'train', b: b.id, type: v });
  }
  else if (k === 'cancel' && b) sendCmd({ c: 'cancel', b: b.id });
  else if (k === 'demolish' && b && b.owner === ME) { if (UI.demo === b.id) { sendCmd({ c: 'demolish', b: b.id }); UI.demo = 0; } else { UI.demo = b.id; toast('Press Demolish again to confirm.'); } }
  else if (k === 'trade') sendCmd({ c: 'trade', r: v2, sell: v === 'sell' ? 1 : 0 });
  else if (k === 'upg' && b) { if (!canAfford(S.players[ME], upgCost(S.players[ME].upg[v]))) toast('Not enough resources'); sendCmd({ c: 'upgrade', b: b.id, w: v }); }
  else if (k === 'stop') sendCmd({ c: 'stop', ids });
  else if (k === 'unload') sendCmd({ c: 'unload', ids });
  else if (k === 'amove') { if (ids.length) UI.amove = !UI.amove; }
  else if (k === 'desel') { UI.sel = []; UI.selB = 0; UI.view = 0; }
  refreshPanel(true);
}
function costHTML(c) { let s = ''; for (const r in c) s += '<i class="ri" style="background:' + RESCOL[r] + '"></i>' + c[r] + ' '; return s || 'free'; }
function btn(a, icon, name, sub, cost) { return '<button data-a="' + a + '"' + (cost ? " data-cost='" + JSON.stringify(cost) + "'" : '') + (sub && sub.title ? ' title="' + esc(sub.title) + '"' : '') + '>' + (icon ? '<img src="' + icon + '">' : '') + '<span><b>' + name + '</b>' + (sub && sub.html ? '<small>' + sub.html + '</small>' : '') + '</span></button>'; }
function panelHTML() {
  const p = S.players[ME];
  if (UI.place) { const d = BLD[UI.place]; return '<h3>Placing: ' + d.name + '</h3><p class="info">' + d.desc + ' Cost: ' + costHTML(d.cost) + '</p><div class="grid">' + btn('cancelplace', '', 'Done / Cancel') + '</div>'; }
  if (UI.menu === 'build') {
    const shop = hasBld(ME, 'shop'); let h = '<h3>Shop — buy for your village</h3>';
    if (!shop) h += '<p class="info">Your shop is gone! Rebuild it to buy anything else.</p>';
    h += '<div class="grid">';
    for (const t of BUILD_MENU) { if (!shop && t !== 'shop') continue; const d = BLD[t]; h += btn('build:' + t, iconURL('b', t, ME), d.name, { html: costHTML(d.cost), title: d.desc }, d.cost); }
    return h + btn('menu:close', '', 'Close') + '</div>';
  }
  const b = S.bById.get(UI.selB);
  if (b) {
    const d = BLD[b.type], mine = b.owner === ME; let h = '<h3>' + d.name + (mine ? '' : ' — ' + esc(S.players[b.owner].name)) + '</h3><p class="info">HP <span data-live="bhp"></span> · ' + d.desc + '</p>';
    if (!mine) return h;
    if (b.prog < 1) return h + '<p class="info">Under construction… <span class="bar"><i data-live="prog"></i></span></p><div class="grid">' + btn('demolish', '', 'Demolish') + '</div>';
    h += '<div class="grid">';
    if (d.train) for (const t of d.train) { const ud = UNIT[t]; h += btn('train:' + t, iconURL('u', t, ME), ud.name, { html: costHTML(ud.cost) + (ud.req && !hasBld(ME, ud.req) ? ' · needs ' + BLD[ud.req].name : ''), title: ud.desc }, ud.cost); }
    if (b.type === 'shop' || b.type === 'townhall') h += btn('menu:build', iconURL('b', 'house', ME), 'Buy buildings', { html: 'walls, farms, barracks…' });
    if (b.type === 'shop') for (const r of ['wood', 'stone', 'food', 'iron']) {
      h += btn('trade:sell:' + r, '', 'Sell ' + r, { html: costHTML({ [r]: TRADE.lot }) + '→ ' + costHTML({ gold: TRADE.sell }) }, { [r]: TRADE.lot });
      h += btn('trade:buy:' + r, '', 'Buy ' + r, { html: costHTML({ gold: TRADE.buy }) + '→ ' + costHTML({ [r]: TRADE.lot }) }, { gold: TRADE.buy });
    }
    if (b.type === 'blacksmith') for (const [w, n, t] of [['wpn', 'Steel Weapons', '+25% damage'], ['arm', 'Steel Armor', '-15% damage taken']]) {
      const l = p.upg[w]; h += l >= 2 ? btn('none', '', n + ' II', { html: 'fully forged' }) : btn('upg:' + w, '', n + (l ? ' II' : ' I'), { html: costHTML(upgCost(l)) + '· ' + t }, upgCost(l));
    }
    if (b.type === 'house') h += '<p class="info">Workers come from homes automatically (2 each) and return if lost.</p>';
    if (d.train) h += btn('cancel', '', 'Cancel last', { html: 'Queue: <span data-live="queue"></span>' });
    return h + btn('demolish', '', 'Demolish') + '</div>';
  }
  const us = mySel();
  if (us.length) {
    const cnt = {}; for (const u of us) cnt[u.type] = (cnt[u.type] || 0) + 1;
    const names = Object.keys(cnt).map(t => (cnt[t] > 1 ? cnt[t] + '× ' : '') + UNIT[t].name).join(', ');
    let h = '<h3>' + names + '</h3><p class="info">' + (us.length === 1 ? 'HP <span data-live="uhp"></span> · ' + (UNIT[us[0].type].desc || 'Gathers wood, stone, ore and berries.') : us.length + ' units selected') + '</p><div class="grid">';
    if (cnt.worker) h += '<p class="info">Tap a tree, rock, ore or berry bush to gather it.</p>';
    if (us.some(u => UNIT[u.type].dmg > 0 && !UNIT[u.type].civil)) h += '<button data-a="amove" class="' + (UI.amove ? 'on' : '') + '"><span><b>Attack-move</b><small>' + (UI.amove ? 'now tap a destination' : 'fight on the way (Q)') + '</small></span></button>';
    if (us.some(u => UNIT[u.type].cap)) h += btn('unload', '', 'Unload', { html: 'drop passengers ashore' });
    return h + btn('stop', '', 'Stop') + btn('desel', '', 'Deselect') + '</div>';
  }
  const v = S.uById.get(UI.view);
  if (v) return '<h3>' + UNIT[v.type].name + ' — ' + esc(S.players[v.owner].name) + '</h3><p class="info">Enemy unit. Select your troops and tap it to attack.</p>';
  return '<p class="info">' + (p.alive ? 'Select a unit or building. Mouse: left-drag selects, right-click orders. Touch: tap to select, tap again to order, drag to pan, pinch to zoom.' : 'Your village has fallen. You are spectating.') + '</p>';
}
function refreshPanel(force) {
  const h = panelHTML();
  if (h !== UI.panelKey) { UI.panelKey = h; $('panel').innerHTML = h; }
  const p = S.players[ME], pn = $('panel'), b = S.bById.get(UI.selB);
  for (const el of pn.querySelectorAll('[data-cost]')) el.classList.toggle('dim', !canAfford(p, JSON.parse(el.dataset.cost)));
  for (const el of pn.querySelectorAll('[data-live]')) {
    const k = el.dataset.live;
    if (k === 'bhp' && b) el.textContent = Math.ceil(b.hp) + '/' + BLD[b.type].hp;
    else if (k === 'prog' && b) el.style.width = (b.prog * 100) + '%';
    else if (k === 'queue' && b) el.textContent = b.queue.length ? b.queue.map(q => UNIT[q].name).join(', ') + ' (' + Math.floor(b.qp * 100) + '%)' : 'empty';
    else if (k === 'uhp') { const u = mySel()[0]; if (u) el.textContent = Math.ceil(u.hp) + '/' + UNIT[u.type].hp; }
  }
  $('bBuild').classList.toggle('on', UI.menu === 'build');
}
function updateTop() {
  const p = S.players[ME]; let h = '';
  for (const r of RES) h += '<span title="' + r + '"><i class="ri" style="background:' + RESCOL[r] + '"></i>' + Math.floor(p.res[r]) + '</span>';
  h += '<span title="Army size / cap">⚔ ' + p.pop + '/' + p.cap + '</span><span style="margin-left:auto">';
  for (const q of S.players) h += '<i class="ri" title="' + esc(q.name) + '" style="background:' + (q.alive ? TEAM[q.id] : '#333') + '"></i> ';
  h += '</span>';
  if (h !== UI.topKey) { UI.topKey = h; $('top').innerHTML = h; }
}
function checkEnd() {
  if (endShown) return; const p = S.players[ME];
  if (S.over || !p.alive) {
    endShown = true; const win = S.over && S.winner === ME;
    $('endTitle').textContent = win ? 'VICTORY' : 'DEFEAT';
    $('endText').textContent = win ? 'Every rival village lies in ruins. You are the last one standing.' : S.over ? (S.winner >= 0 ? S.players[S.winner].name + ' is the last one standing.' : 'No village survived.') : 'Your village has been destroyed.';
    $('endWatch').classList.toggle('hidden', S.over); $('end').classList.remove('hidden');
  }
}
function showHelp() {
  let h = '<h3>Goal</h3><ul><li>Destroy every building of the other villages (walls do not count). Last village standing wins.</li></ul>';
  h += '<h3>Controls</h3><ul><li><b>Mouse:</b> left-click selects, left-drag box-selects, right-click orders (move / gather / attack / board boat), right-drag or WASD pans, wheel zooms. Double-click selects all of a type. B: shop, Q: attack-move, X: stop, H: home, Esc: cancel.</li>';
  h += '<li><b>Touch:</b> tap to select, tap a target to order, drag to pan, pinch to zoom. Use ⬚ Select to drag a box. Double-tap selects all of a type.</li></ul>';
  h += '<h3>Economy</h3><ul><li>Point workers at trees, rocks, ore and berry bushes. They haul loads to the nearest Town Hall or Storage.</li><li>Open the <b>Shop</b> (🔨 Build) to buy buildings. New buildings must be near your village or one of your workers.</li><li>Homes supply 2 workers each and +4 army cap. Farms and pens make the food your troops cost.</li><li>The Shop also trades resources for gold. The Blacksmith forges steel, the peak of technology.</li></ul>';
  h += '<h3>Travel</h3><ul><li><b>Roads</b> make any land fast. <b>Bridges</b> span shallow water.</li><li><b>Horses</b> (Stable) are fast on plains and desert, hopeless in swamps and hills.</li><li><b>Boats</b> (Dock): select troops and tap a Transport Boat to board, sail, then Unload. Deep water cannot be crossed any other way, and islands hold rich ore.</li></ul>';
  h += '<h3>Biomes</h3><table><tr><th>Biome</th><th>Speed</th><th>Farm</th><th>Pros</th><th>Cons</th></tr>';
  TERRAIN.forEach((t, i) => { h += '<tr><td><i class="ri" style="background:rgb(' + t.col + ')"></i> ' + t.name + '</td><td>' + (t.foot ? Math.round(t.foot * 100) + '%' : '—') + '</td><td>' + (t.farm ? Math.round(t.farm * 100) + '%' : '—') + '</td><td>' + t.pro + '</td><td>' + t.con + '</td></tr>'; });
  $('helpBody').innerHTML = h + '</table>'; $('help').classList.remove('hidden');
}

// ----- menus -----
function initMenu() {
  const name = () => ($('iName').value.trim() || 'Player').slice(0, 16), err = t => { $('menuErr').textContent = t || ''; };
  const seedOf = () => { const v = parseInt($('iSeed').value, 10); return Number.isFinite(v) ? v | 0 : (Math.random() * 2147483647) | 0; };
  try { $('iName').value = localStorage.getItem('gw_name') || 'Player'; } catch (_) { }
  const save = () => { try { localStorage.setItem('gw_name', name()); } catch (_) { } };
  $('bSingle').onclick = () => {
    save(); const n = +$('iAI').value, diff = $('iDiff').value, players = [{ name: name(), ai: false }];
    for (let i = 0; i < n; i++) players.push({ name: 'Computer ' + (i + 1), ai: true, diff });
    Net.mode = 'none'; newGame({ seed: seedOf(), players }); startGame(0);
  };
  const lobby = host => {
    $('menu').classList.add('hidden'); $('lobby').classList.remove('hidden'); $('lHost').classList.toggle('hidden', !host); $('lWait').classList.toggle('hidden', host);
    $('lCode').textContent = host ? '…' : Net.code; $('lErr').textContent = ''; $('lPlayers').innerHTML = '<li>Connecting…</li>';
  };
  Net.onLobby = l => { $('lCode').textContent = Net.code; $('lPlayers').innerHTML = l.map((n, i) => '<li><i class="ri" style="background:' + TEAM[i] + '"></i> ' + esc(n) + (i === 0 ? ' (host)' : '') + '</li>').join(''); };
  Net.onError = t => { $('lErr').textContent = t; err(t); };
  $('bHost').onclick = () => { save(); err(''); netHost(name()).then(() => lobby(true)).catch(e => err(e.message)); };
  $('bJoin').onclick = () => { save(); const c = $('iCode').value.trim().toUpperCase(); if (c.length !== 5) return err('Enter the 5-letter room code.'); err(''); netJoin(c, name()).then(() => lobby(false)).catch(e => err(e.message)); };
  $('lStart').onclick = () => netStart(seedOf(), +$('lAI').value, $('lDiff').value);
  $('lBack').onclick = $('endMenu').onclick = () => location.reload();
  $('endWatch').onclick = () => $('end').classList.add('hidden');
}
function resize() { cv.width = window.innerWidth; cv.height = window.innerHeight; if (running) clampCam(); }
window.addEventListener('load', () => {
  cv = $('c'); ctx = cv.getContext('2d'); resize(); window.addEventListener('resize', resize);
  cam.z = window.innerWidth < 700 ? 2 : 2.5;
  initSprites(); initInput(); initMenu();
  simLast = performance.now(); setInterval(simLoop, 50); requestAnimationFrame(frame);
});
