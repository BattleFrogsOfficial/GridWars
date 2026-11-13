'use strict';
// ---------- Authoritative simulation (runs on the host / in single player) ----------
let S = null;
const DT = 0.1, PN = MW * MH, PATH_CAP = 90000;
const DX8 = [1, -1, 0, 0, 1, 1, -1, -1], DY8 = [0, 0, 1, -1, 1, -1, 1, -1];
const SPIRAL = (() => { const a = []; for (let y = -10; y <= 10; y++) for (let x = -10; x <= 10; x++) a.push([x, y]); a.sort((p, q) => (p[0] * p[0] + p[1] * p[1]) - (q[0] * q[0] + q[1] * q[1])); return a; })();
const inb = (x, y) => x >= 0 && y >= 0 && x < MW && y < MH;
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function newGame(opts) {
  const map = genMap(opts.seed);
  S = { seed: opts.seed, map, tick: 0, players: [], units: [], buildings: [], uById: new Map(), bById: new Map(), nextId: 1,
    occ: new Int32Array(PN), fx: [], tev: [], msgs: [], pathQ: [], pc: null, bDirty: true, over: false, winner: -1, host: true };
  const order = [0, 1, 2, 3];
  for (let i = 3; i > 0; i--) { const j = Math.floor(hash2(i, 99, opts.seed) * (i + 1)); const t = order[i]; order[i] = order[j]; order[j] = t; }
  opts.players.forEach((pl, i) => {
    const p = { id: i, name: pl.name, ai: !!pl.ai, res: { wood: 200, stone: 100, food: 150, iron: 0, gold: 0 }, alive: true, upg: { wpn: 0, arm: 0 }, pop: 0, cap: 16, gm: 1, aiS: null };
    S.players.push(p);
    if (p.ai) makeAI(p, pl.diff || 'normal');
    const st = map.starts[order[i]]; p.start = st;
    addBuilding('townhall', i, st.x - 1, st.y - 1, true);
    const h1 = addBuilding('house', i, st.x - 2, st.y - 2, true), h2 = addBuilding('house', i, st.x + 2, st.y - 2, true);
    addBuilding('storage', i, st.x - 2, st.y + 2, true); addBuilding('shop', i, st.x + 2, st.y + 2, true);
    for (const h of [h1, h2]) for (let k = 0; k < 2; k++) { const u = spawnUnit('worker', i, h.x, h.y + 1); if (u) { u.home = h.id; h.wk++; } }
  });
  return S;
}
function makeAI(p, diff) { const d = DIFF[diff] || DIFF.normal; p.ai = true; p.gm = d.rate; p.aiS = { bi: 0, stuck: 0, wave: d.wave, first: d.first, attacking: false, alarm: null, none: {}, alt: 0 }; }

function addBuilding(type, owner, x, y, done) {
  const d = BLD[type], s = d.size || 1;
  const b = { id: S.nextId++, type, owner, x, y, hp: done ? d.hp : d.hp * 0.1, prog: done ? 1 : 0, queue: [], qp: 0, t: 8, wk: 0, cd: 0 };
  S.buildings.push(b); S.bById.set(b.id, b);
  for (let yy = y; yy < y + s; yy++) for (let xx = x; xx < x + s; xx++) S.occ[yy * MW + xx] = b.id;
  S.bDirty = true; return b;
}
function tileSpeed(cls, idx) {
  if (cls === 'boat') return 1;
  const f = S.map.feat[idx], t = S.map.ter[idx];
  if (f === F.ROAD) return 1.5; if (f === F.BRIDGE) return 1.1;
  let s = cls === 'horse' ? TERRAIN[t].horse : TERRAIN[t].foot;
  if (f) s *= 0.7;
  return s || 0.3;
}
function passable(cls, owner, idx) {
  const o = S.occ[idx];
  if (o) { const b = S.bById.get(o); if (!(b && BLD[b.type].gate && b.owner === owner && cls !== 'boat')) return false; }
  const t = S.map.ter[idx], f = S.map.feat[idx];
  if (cls === 'boat') return t <= T.SHALLOW && f !== F.BRIDGE;
  if (f === F.BRIDGE) return true;
  return t !== T.DEEP && t !== T.PEAK;
}
function spawnUnit(type, owner, x, y) {
  const cls = UNIT[type].cls;
  for (const o of SPIRAL) {
    const tx = x + o[0], ty = y + o[1];
    if (!inb(tx, ty) || !passable(cls, owner, ty * MW + tx)) continue;
    const u = { id: S.nextId++, type, owner, x: tx + 0.5, y: ty + 0.5, hp: UNIT[type].hp, o: 'idle', path: null, pi: 0, pend: false, goal: null, cd: 0, cn: 0, ct: null, home: 0, inBoat: 0, cargo: UNIT[type].cap ? [] : null, bt: 0 };
    S.units.push(u); S.uById.set(u.id, u); return u;
  }
  return null;
}

// ----- A* pathfinding -----
const pG = new Float32Array(PN), pF = new Int32Array(PN), pS = new Uint32Array(PN), pC = new Uint32Array(PN); let pStamp = 0;
const heapN = [], heapF = [];
function hpush(n, f) { let i = heapN.length; heapN.push(n); heapF.push(f); while (i > 0) { const p = (i - 1) >> 1; if (heapF[p] <= f) break; heapN[i] = heapN[p]; heapF[i] = heapF[p]; i = p; } heapN[i] = n; heapF[i] = f; }
function hpop() {
  const n = heapN[0], ln = heapN.pop(), lf = heapF.pop(), L = heapN.length;
  if (L) { let i = 0; for (;;) { let c = i * 2 + 1; if (c >= L) break; if (c + 1 < L && heapF[c + 1] < heapF[c]) c++; if (heapF[c] >= lf) break; heapN[i] = heapN[c]; heapF[i] = heapF[c]; i = c; } heapN[i] = ln; heapF[i] = lf; }
  return n;
}
function findPath(cls, owner, sx, sy, g) {
  pStamp++; heapN.length = 0; heapF.length = 0;
  const s = sy * MW + sx; pG[s] = 0; pS[s] = pStamp; pF[s] = -1;
  const hf = (x, y) => { const dx = Math.max(g.x0 - x, 0, x - g.x1), dy = Math.max(g.y0 - y, 0, y - g.y1); return dx > dy ? dx + 0.41 * dy : dy + 0.41 * dx; };
  let best = s, bestH = hf(sx, sy), n = 0, found = -1;
  hpush(s, bestH);
  while (heapN.length) {
    const c = hpop(); if (pC[c] === pStamp) continue; pC[c] = pStamp;
    const cx = c % MW, cy = (c / MW) | 0;
    if (Math.max(g.x0 - cx, 0, cx - g.x1, g.y0 - cy, cy - g.y1) <= g.r) { found = c; break; }
    if (++n > PATH_CAP) break;
    for (let d = 0; d < 8; d++) {
      const nx = cx + DX8[d], ny = cy + DY8[d]; if (nx < 0 || ny < 0 || nx >= MW || ny >= MH) continue;
      const ni = ny * MW + nx; if (pC[ni] === pStamp || !passable(cls, owner, ni)) continue;
      if (d >= 4 && (!passable(cls, owner, cy * MW + nx) || !passable(cls, owner, ny * MW + cx))) continue;
      const ng = pG[c] + (d >= 4 ? 1.414 : 1) / tileSpeed(cls, ni);
      if (pS[ni] !== pStamp || ng < pG[ni]) { pG[ni] = ng; pS[ni] = pStamp; pF[ni] = c; const h = hf(nx, ny); if (h < bestH) { bestH = h; best = ni; } hpush(ni, ng + h * 0.9); }
    }
  }
  let e = found >= 0 ? found : best; const path = [];
  while (e !== s && e >= 0) { path.push(e); e = pF[e]; }
  path.reverse(); return { path, ok: found >= 0 };
}
function reqPath(u, goal) { u.goal = goal; u.pd = false; if (!u.pend) { u.pend = true; S.pathQ.push(u); } }
function processPaths() {
  const t0 = nowMs(); let n = 0;
  while (S.pathQ.length && (n < 2 || nowMs() - t0 < 8)) {
    const u = S.pathQ.shift(); if (u.dead || !u.pend) continue; n++; u.pend = false;
    const g = u.goal, cls = UNIT[u.type].cls, sx = u.x | 0, sy = u.y | 0;
    const key = cls + '|' + u.owner + '|' + g.x0 + ',' + g.y0 + ',' + g.x1 + ',' + g.y1 + ',' + g.r, c = S.pc; let res = null;
    if (c && c.key === key && S.tick - c.tick < 30 && Math.max(Math.abs(sx - c.sx), Math.abs(sy - c.sy)) <= 6) {
      if (sx === c.sx && sy === c.sy) res = { path: c.path.slice(), ok: c.ok };
      else { const r1 = findPath(cls, u.owner, sx, sy, { x0: c.sx, y0: c.sy, x1: c.sx, y1: c.sy, r: 0 }); if (r1.ok) res = { path: r1.path.concat(c.path), ok: c.ok }; }
    }
    if (!res) { res = findPath(cls, u.owner, sx, sy, g); S.pc = { key, tick: S.tick, sx, sy, path: res.path, ok: res.ok }; }
    u.path = res.path.length ? res.path : null; u.pi = 0; u.blk = !res.ok; u.pd = true;
  }
}
function stepMove(u, dt) { // true when the path is finished
  if (!u.path) return true;
  const ud = UNIT[u.type];
  let d = ud.speed * tileSpeed(ud.cls, ((u.y | 0) * MW) + (u.x | 0)) * dt;
  while (d > 0 && u.pi < u.path.length) {
    const idx = u.path[u.pi];
    if (!passable(ud.cls, u.owner, idx)) { u.path = null; if (u.goal) reqPath(u, u.goal); return false; }
    const tx = (idx % MW) + 0.5, ty = ((idx / MW) | 0) + 0.5, dx = tx - u.x, dy = ty - u.y, L = Math.hypot(dx, dy);
    if (L <= d) { u.x = tx; u.y = ty; d -= L; u.pi++; } else { u.x += dx / L * d; u.y += dy / L * d; d = 0; }
  }
  if (u.pi >= u.path.length) { u.path = null; return true; }
  return false;
}

// ----- helpers -----
function bRect(b, r) { const s = BLD[b.type].size || 1; return { x0: b.x, y0: b.y, x1: b.x + s - 1, y1: b.y + s - 1, r }; }
function distToBld(x, y, b) { const s = BLD[b.type].size || 1; const dx = Math.max(b.x - x, 0, x - (b.x + s)), dy = Math.max(b.y - y, 0, y - (b.y + s)); return Math.hypot(dx, dy); }
function hasBld(pid, type) { for (const b of S.buildings) if (b.owner === pid && b.type === type && b.prog >= 1) return true; return false; }
function canAfford(p, cost) { for (const r in cost) if (p.res[r] < cost[r]) return false; return true; }
function pay(p, cost) { for (const r in cost) p.res[r] -= cost[r]; }
function nearOwn(pid, x, y, r) {
  for (const b of S.buildings) { if (b.owner !== pid || BLD[b.type].wall) continue; const s = BLD[b.type].size || 1; if (Math.max(b.x - x, 0, x - (b.x + s - 1), b.y - y, y - (b.y + s - 1)) <= r) return true; }
  for (const u of S.units) if (u.owner === pid && u.type === 'worker' && !u.inBoat && Math.abs(u.x - x) <= 5 && Math.abs(u.y - y) <= 5) return true;
  return false;
}
function canPlace(pid, type, x, y) { // '' if ok, otherwise the reason
  const d = BLD[type], s = d.size || 1, m = S.map;
  if (!(x >= 1 && y >= 1 && x + s <= MW - 1 && y + s <= MH - 1)) return 'Out of bounds';
  const i = y * MW + x;
  if (d.tile) {
    if (S.occ[i] || m.feat[i]) return 'That tile is occupied';
    if (type === 'road') { if (!isLand(m.ter[i])) return 'Roads need solid ground'; } else if (m.ter[i] !== T.SHALLOW) return 'Bridges can only span shallow water';
    for (let k = 0; k < 8; k++) { const f = m.feat[i + DY8[k] * MW + DX8[k]]; if (f === F.ROAD || f === F.BRIDGE) return ''; }
    return nearOwn(pid, x, y, BUILD_R) ? '' : 'Too far from your village, workers or roads';
  }
  if (d.water) {
    if (m.ter[i] > T.SHALLOW) return 'Docks must be placed on water'; if (S.occ[i] || m.feat[i]) return 'That tile is occupied';
    if (!(isLand(m.ter[i + 1]) || isLand(m.ter[i - 1]) || isLand(m.ter[i + MW]) || isLand(m.ter[i - MW]))) return 'Docks must touch the shore';
  } else for (let yy = y; yy < y + s; yy++) for (let xx = x; xx < x + s; xx++) {
    const j = yy * MW + xx; if (!isLand(m.ter[j])) return 'Needs solid ground'; if (S.occ[j]) return 'That tile is occupied'; if (m.feat[j]) return 'Something is in the way';
  }
  return nearOwn(pid, x, y, BUILD_R) ? '' : 'Too far from your village or workers';
}
function findNearestRes(x, y, res, maxR) {
  const m = S.map;
  for (let r = 0; r <= maxR; r++) {
    let best = -1, bd = 1e9;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx += (Math.abs(dy) === r ? 1 : 2 * r || 1)) {
      const tx = x + dx, ty = y + dy; if (!inb(tx, ty)) continue; const i = ty * MW + tx, f = m.feat[i];
      if (f && FEAT[f] && FEAT[f].res === res && !S.occ[i] && m.ter[i] !== T.DEEP) { const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } }
    }
    if (best >= 0) return best;
  }
  return -1;
}
function setTile(idx, f) { S.map.feat[idx] = f; if (!f || !FEAT[f]) S.map.amt[idx] = 0; S.tev.push(idx, f); }

// ----- orders -----
function clearOrder(u) { u.o = 'idle'; u.path = null; u.pend = false; u.resume = null; u.bt = 0; u.blk = false; u.pd = false; }
function setAttack(u, id, isB, resume) { u.o = 'attack'; u.tg = id; u.tb = !!isB; u.resume = resume || null; u.path = null; u.pend = false; u.pd = false; }
function orderMove(u, x, y, am, goal) { clearOrder(u); u.o = am ? 'amove' : 'move'; u.ax = x; u.ay = y; u.ag = goal || null; reqPath(u, goal || { x0: x, y0: y, x1: x, y1: y, r: 0 }); }
function startGather(u, idx) { const f = S.map.feat[idx]; if (!FEAT[f]) return; clearOrder(u); u.o = 'gather'; u.gt = idx; u.gr = FEAT[f].res; u.gs = 0; const x = idx % MW, y = (idx / MW) | 0; reqPath(u, { x0: x, y0: y, x1: x, y1: y, r: 0 }); }
function goReturn(u) {
  let best = null, bd = 1e9;
  for (const b of S.buildings) if (b.owner === u.owner && BLD[b.type].drop && b.prog >= 1) { const d = distToBld(u.x, u.y, b); if (d < bd) { bd = d; best = b; } }
  if (!best) { clearOrder(u); return; }
  u.gs = 2; u.drop = best.id; u.path = null; reqPath(u, bRect(best, 1));
}
function retarget(u) {
  const idx = findNearestRes(u.gt % MW, (u.gt / MW) | 0, u.gr, 16);
  if (idx >= 0) { u.gt = idx; u.gs = 0; u.path = null; const x = idx % MW, y = (idx / MW) | 0; reqPath(u, { x0: x, y0: y, x1: x, y1: y, r: 0 }); }
  else if (u.cn > 0) { u.gt = -1; goReturn(u); } else clearOrder(u);
}
function findEnemy(u, range) {
  const ud = UNIT[u.type]; let best = null, bd = range, isB = false;
  if (!ud.bldOnly) for (const e of S.units) {
    if (e.owner === u.owner || e.inBoat || e.dead) continue;
    const d = Math.hypot(e.x - u.x, e.y - u.y); if (d < bd) { bd = d; best = e; }
  }
  if (best && !(ud.bld > 1)) return { id: best.id, isB: false };
  let bb = null, bbd = range, wall = null, wd = range;
  for (const b of S.buildings) {
    if (b.owner === u.owner) continue; const d = distToBld(u.x, u.y, b);
    if (BLD[b.type].wall) { if (d < wd) { wd = d; wall = b; } } else if (d < bbd) { bbd = d; bb = b; }
  }
  if (bb) return { id: bb.id, isB: true };
  if (best) return { id: best.id, isB: false };
  if (wall && ud.bldOnly) return { id: wall.id, isB: true };
  return null;
}
function hurtUnit(t, dmg, aid, aB) {
  if (t.dead) return; const p = S.players[t.owner], td = UNIT[t.type];
  if (!td.civil) dmg *= 1 - 0.15 * p.upg.arm;
  t.hp -= dmg;
  if (p.aiS) p.aiS.alarm = { x: t.x | 0, y: t.y | 0, t: S.tick };
  if (t.hp <= 0) { killUnit(t); return; }
  if (aid && t.o === 'idle' && td.dmg > 0 && !td.civil && !td.bldOnly && !t.inBoat) setAttack(t, aid, aB, null);
}
function hurtBld(b, dmg) {
  if (b.dead) return; b.hp -= dmg; S.bDirty = true;
  const p = S.players[b.owner]; if (p.aiS) p.aiS.alarm = { x: b.x, y: b.y, t: S.tick };
  if (b.hp <= 0) killBld(b);
}
function killUnit(u) {
  if (u.dead) return; u.dead = true; S.uById.delete(u.id); S.fx.push([2, u.x, u.y, 0, 0]);
  if (u.cargo) for (const id of u.cargo) { const c = S.uById.get(id); if (c) { c.dead = true; S.uById.delete(id); } }
  if (u.home) { const h = S.bById.get(u.home); if (h) h.wk--; }
}
function killBld(b) {
  if (b.dead) return; b.dead = true; S.bById.delete(b.id); const s = BLD[b.type].size || 1;
  for (let yy = b.y; yy < b.y + s; yy++) for (let xx = b.x; xx < b.x + s; xx++) S.occ[yy * MW + xx] = 0;
  S.fx.push([3, b.x + s / 2, b.y + s / 2, s, 0]); S.bDirty = true;
}

function tickUnit(u, dt) {
  const d = UNIT[u.type];
  if (u.cd > 0) u.cd -= dt;
  switch (u.o) {
    case 'idle':
      if (d.dmg > 0 && !d.civil && (S.tick + u.id) % 5 === 0) { const e = findEnemy(u, AGGRO); if (e) setAttack(u, e.id, e.isB, null); }
      break;
    case 'move': if (!u.pend && stepMove(u, dt) && !u.pend) u.o = 'idle'; break;
    case 'amove':
      if (d.dmg > 0 && (S.tick + u.id) % 5 === 0) { const e = findEnemy(u, AGGRO); if (e) { setAttack(u, e.id, e.isB, { x: u.ax, y: u.ay, g: u.ag }); break; } }
      if (!u.pend && stepMove(u, dt) && !u.pend) u.o = 'idle';
      break;
    case 'attack': {
      const t = u.tb ? S.bById.get(u.tg) : S.uById.get(u.tg);
      if (!t || t.dead || t.inBoat || d.dmg <= 0) { const r = u.resume; if (r) orderMove(u, r.x, r.y, true, r.g); else clearOrder(u); break; }
      const dist = u.tb ? distToBld(u.x, u.y, t) : Math.hypot(t.x - u.x, t.y - u.y);
      const rng = d.range + (d.range > 2 && S.map.ter[(u.y | 0) * MW + (u.x | 0)] === T.HILLS ? 1 : 0) + 0.2;
      if (dist <= rng) {
        u.path = null; u.pend = false;
        if (u.cd <= 0) {
          u.cd = d.cd; const dmg = d.dmg * (1 + 0.25 * S.players[u.owner].upg.wpn);
          const tx = u.tb ? t.x + (BLD[t.type].size || 1) / 2 : t.x, ty = u.tb ? t.y + (BLD[t.type].size || 1) / 2 : t.y;
          S.fx.push([d.range > 2 ? (u.type === 'catapult' ? 1 : 0) : 4, u.x, u.y, tx, ty]);
          if (u.tb) hurtBld(t, dmg * (d.bld || 1)); else hurtUnit(t, dmg, u.id, false);
        }
      } else if (!u.pend) {
        if (u.path) {
          stepMove(u, dt);
          if (!u.tb && u.path && (S.tick + u.id) % 10 === 0) { const e = u.path[u.path.length - 1]; if (Math.abs(e % MW + 0.5 - t.x) > 2 || Math.abs(((e / MW) | 0) + 0.5 - t.y) > 2) reqPath(u, { x0: t.x | 0, y0: t.y | 0, x1: t.x | 0, y1: t.y | 0, r: 0 }); }
        } else if (u.pd && u.blk) { // could not reach: break through whatever is nearby, or give up
          u.pd = false; let alt = null, ad = 6;
          if (++u.bt <= 3) for (const b of S.buildings) { if (b.owner === u.owner || b === t) continue; const dd = distToBld(u.x, u.y, b); if (dd < ad) { ad = dd; alt = b; } }
          if (alt) { u.tg = alt.id; u.tb = true; } else clearOrder(u);
        } else reqPath(u, u.tb ? bRect(t, 1) : { x0: t.x | 0, y0: t.y | 0, x1: t.x | 0, y1: t.y | 0, r: 0 });
      }
      break;
    }
    case 'gather': {
      const m = S.map;
      if (u.gs === 0) {
        if (!u.pend && stepMove(u, dt) && !u.pend) {
          const gx = u.gt % MW + 0.5, gy = ((u.gt / MW) | 0) + 0.5, f = m.feat[u.gt];
          if (Math.abs(gx - u.x) < 1.6 && Math.abs(gy - u.y) < 1.6) { if (FEAT[f] && FEAT[f].res === u.gr) { u.gs = 1; u.gw = 0; } else retarget(u); }
          else if (u.blk) clearOrder(u); else retarget(u);
        }
      } else if (u.gs === 1) {
        const f = m.feat[u.gt];
        if (!FEAT[f] || FEAT[f].res !== u.gr) { retarget(u); break; }
        u.gw += dt * S.players[u.owner].gm;
        if (u.gw >= 0.5) {
          u.gw = 0; if (u.ct !== u.gr) { u.ct = u.gr; u.cn = 0; }
          u.cn++; if (--m.amt[u.gt] <= 0) setTile(u.gt, 0);
          if (u.cn >= CARRY) goReturn(u);
        }
      } else if (!u.pend && stepMove(u, dt) && !u.pend) {
        const b = S.bById.get(u.drop);
        if (b && distToBld(u.x, u.y, b) < 1.8) {
          S.players[u.owner].res[u.ct] += u.cn; u.cn = 0;
          if (u.gt < 0) clearOrder(u);
          else if (FEAT[m.feat[u.gt]] && FEAT[m.feat[u.gt]].res === u.gr) startGather(u, u.gt); else retarget(u);
        } else if (u.blk || !b) { if (b) clearOrder(u); else goReturn(u); } else goReturn(u);
      }
      break;
    }
    case 'board': {
      const t = S.uById.get(u.tg);
      if (!t || t.dead || !t.cargo) { clearOrder(u); break; }
      if (Math.hypot(t.x - u.x, t.y - u.y) < 1.9) { if (t.cargo.length < UNIT[t.type].cap) { t.cargo.push(u.id); u.inBoat = t.id; } clearOrder(u); break; }
      if (u.pend) break;
      if (u.path) { stepMove(u, dt); if ((S.tick + u.id) % 10 === 0 && u.path) { const e = u.path[u.path.length - 1]; if (Math.abs(e % MW + 0.5 - t.x) > 2.5 || Math.abs(((e / MW) | 0) + 0.5 - t.y) > 2.5) reqPath(u, { x0: t.x | 0, y0: t.y | 0, x1: t.x | 0, y1: t.y | 0, r: 1 }); } }
      else if (u.pd) { if (u.blk || ++u.bt > 20) clearOrder(u); else u.pd = false; }
      else if (t.o === 'idle' || (S.tick + u.id) % 10 === 0) reqPath(u, { x0: t.x | 0, y0: t.y | 0, x1: t.x | 0, y1: t.y | 0, r: 1 });
      break;
    }
  }
}
function tickBld(b, dt) {
  const d = BLD[b.type], p = S.players[b.owner];
  if (b.prog < 1) { b.prog = Math.min(1, b.prog + dt / d.time); b.hp = Math.min(d.hp, b.hp + d.hp * 0.9 * dt / d.time); if (b.prog >= 1) S.bDirty = true; return; }
  if (d.food) p.res.food += d.food * dt * p.gm * (d.flat ? 1 : TERRAIN[S.map.ter[b.y * MW + b.x]].farm);
  if (b.type === 'house' && b.wk < 2) { b.t += dt; if (b.t >= 12) { const u = spawnUnit('worker', b.owner, b.x, b.y + 1); if (u) { u.home = b.id; b.wk++; } b.t = 0; } }
  if (b.queue.length) {
    b.qp += dt / UNIT[b.queue[0]].time;
    if (b.qp >= 1) { const s = d.size || 1; const u = spawnUnit(b.queue[0], b.owner, b.x + (s >> 1), b.y + s - (d.water ? 1 : 0)); if (u) { b.queue.shift(); b.qp = 0; S.bDirty = true; } else b.qp = 1; }
  }
  if (d.atk) {
    b.cd -= dt;
    if (b.cd <= 0 && (S.tick + b.id) % 3 === 0) {
      const s = d.size || 1, cx = b.x + s / 2, cy = b.y + s / 2, rng = d.atk.range + (S.map.ter[b.y * MW + b.x] === T.HILLS ? 2 : 0);
      let best = null, bd = rng;
      for (const e of S.units) { if (e.owner === b.owner || e.inBoat || e.dead) continue; const dd = Math.hypot(e.x - cx, e.y - cy); if (dd < bd) { bd = dd; best = e; } }
      if (best) { b.cd = d.atk.cd; S.fx.push([0, cx, cy, best.x, best.y]); hurtUnit(best, d.atk.dmg, b.id, true); }
    }
  }
}

// ----- player commands -----
function applyCmd(pid, c) {
  const p = S.players[pid]; if (!p || !p.alive || S.over || !c) return;
  const own = ids => (Array.isArray(ids) ? ids.slice(0, 400) : []).map(i => S.uById.get(i)).filter(u => u && u.owner === pid && !u.inBoat && !u.dead);
  const myB = id => { const b = S.bById.get(id); return b && b.owner === pid ? b : null; };
  switch (c.c) {
    case 'move': {
      const x = c.x | 0, y = c.y | 0; if (!inb(x, y)) return; let k = 0;
      for (const u of own(c.ids)) {
        const cls = UNIT[u.type].cls; let tx = x, ty = y;
        for (; k < SPIRAL.length; k++) { const ox = x + SPIRAL[k][0], oy = y + SPIRAL[k][1]; if (inb(ox, oy) && passable(cls, pid, oy * MW + ox)) { tx = ox; ty = oy; break; } }
        k++; orderMove(u, tx, ty, !!c.a);
      }
      break;
    }
    case 'attack': { const t = c.b ? S.bById.get(c.t) : S.uById.get(c.t); if (!t || t.owner === pid) return; for (const u of own(c.ids)) if (UNIT[u.type].dmg > 0 && !(UNIT[u.type].bldOnly && !c.b)) { clearOrder(u); setAttack(u, t.id, !!c.b, null); } break; }
    case 'gather': { const i = c.i | 0; if (i < 0 || i >= PN || !FEAT[S.map.feat[i]]) return; for (const u of own(c.ids)) if (u.type === 'worker') startGather(u, i); break; }
    case 'board': { const bt = S.uById.get(c.boat); if (!bt || bt.owner !== pid || !bt.cargo) return; for (const u of own(c.ids)) if (UNIT[u.type].cls !== 'boat') { clearOrder(u); u.o = 'board'; u.tg = bt.id; } break; }
    case 'unload': {
      for (const bt of own(c.ids)) {
        if (!bt.cargo) continue; const keep = [];
        for (const id of bt.cargo) {
          const u = S.uById.get(id); if (!u) continue; let done = false;
          for (let k = 0; k < 25 && !done; k++) { const tx = (bt.x | 0) + SPIRAL[k][0], ty = (bt.y | 0) + SPIRAL[k][1]; if (inb(tx, ty) && isLand(S.map.ter[ty * MW + tx]) && passable(UNIT[u.type].cls, pid, ty * MW + tx)) { u.x = tx + 0.5; u.y = ty + 0.5; u.inBoat = 0; clearOrder(u); done = true; } }
          if (!done) keep.push(id);
        }
        bt.cargo = keep;
      }
      break;
    }
    case 'stop': for (const u of own(c.ids)) clearOrder(u); break;
    case 'build': {
      const d = BLD[c.type]; if (!d || c.type === 'townhall') return; const x = c.x | 0, y = c.y | 0;
      if (c.type !== 'shop' && !hasBld(pid, 'shop')) return;
      if (canPlace(pid, c.type, x, y) || !canAfford(p, d.cost)) return;
      pay(p, d.cost);
      if (d.tile) setTile(y * MW + x, d.tile); else addBuilding(c.type, pid, x, y, false);
      break;
    }
    case 'train': {
      const b = myB(c.b), ud = UNIT[c.type]; if (!b || b.prog < 1 || !ud || !(BLD[b.type].train || []).includes(c.type) || b.queue.length >= 5) return;
      if (ud.req && !hasBld(pid, ud.req)) return;
      let q = 0; for (const o of S.buildings) if (o.owner === pid) q += o.queue.length;
      if (p.pop + q >= p.cap || !canAfford(p, ud.cost)) return;
      pay(p, ud.cost); b.queue.push(c.type); S.bDirty = true; break;
    }
    case 'cancel': { const b = myB(c.b); if (!b || !b.queue.length) return; const t = b.queue.pop(); for (const r in UNIT[t].cost) p.res[r] += UNIT[t].cost[r]; if (!b.queue.length) b.qp = 0; S.bDirty = true; break; }
    case 'demolish': { const b = myB(c.b); if (b) killBld(b); break; }
    case 'trade': {
      const r = c.r; if (!RES.includes(r) || r === 'gold' || !hasBld(pid, 'shop')) return;
      if (c.sell) { if (p.res[r] >= TRADE.lot) { p.res[r] -= TRADE.lot; p.res.gold += TRADE.sell; } }
      else if (p.res.gold >= TRADE.buy) { p.res.gold -= TRADE.buy; p.res[r] += TRADE.lot; }
      break;
    }
    case 'upgrade': { const b = myB(c.b); if (!b || b.type !== 'blacksmith' || b.prog < 1 || (c.w !== 'wpn' && c.w !== 'arm')) return; const l = p.upg[c.w]; if (l >= 2 || !canAfford(p, upgCost(l))) return; pay(p, upgCost(l)); p.upg[c.w]++; break; }
  }
}

// ----- computer players -----
const AI_BO = ['farm', 'house', 'farm', 'barracks', 'house', 'farm', 'tower', 'pen', 'house', 'blacksmith', 'farm', 'stable', 'house', 'tower', 'siege', 'house', 'pen', 'house', 'tower'];
function aiPlace(p, type, cx, cy) {
  const s = BLD[type].size || 1;
  for (let k = 0; k < 60; k++) {
    const r = 4 + Math.floor(Math.random() * (5 + k / 6)), a = Math.random() * 6.283;
    const x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r);
    if (canPlace(p.id, type, x, y)) continue;
    let clear = true;
    for (let yy = y - 1; yy <= y + s && clear; yy++) for (let xx = x - 1; xx <= x + s; xx++) if (S.occ[yy * MW + xx]) { clear = false; break; }
    if (clear) return [x, y];
  }
  return null;
}
function aiThink(p) {
  const a = p.aiS, cnt = {}, done = {}, mine = [];
  for (const b of S.buildings) if (b.owner === p.id) { mine.push(b); cnt[b.type] = (cnt[b.type] || 0) + 1; if (b.prog >= 1) done[b.type] = (done[b.type] || 0) + 1; }
  const th = mine.find(b => b.type === 'townhall') || mine.find(b => !BLD[b.type].wall); if (!th) return;
  const cx = th.x + 1, cy = th.y + 1, workers = [], army = [], uc = {};
  for (const u of S.units) if (u.owner === p.id && !u.inBoat) { uc[u.type] = (uc[u.type] || 0) + 1; if (u.type === 'worker') workers.push(u); else if (UNIT[u.type].cls !== 'boat') army.push(u); }
  // economy
  const g = { wood: 0, stone: 0, food: 0, iron: 0, gold: 0 }; for (const u of workers) if (u.o === 'gather') g[u.gr]++;
  const wts = { wood: 2.2, food: (cnt.farm || 0) >= 3 ? 0.5 : 1, stone: 0.45, iron: done.barracks ? 0.6 : 0, gold: done.blacksmith ? 0.3 : 0 };
  for (const u of workers) {
    if (u.o !== 'idle') continue; let best = null, bs = 1e9;
    for (const r of RES) { if (!wts[r] || a.none[r] > S.tick) continue; const s = (p.res[r] + g[r] * 80) / wts[r]; if (s < bs) { bs = s; best = r; } }
    if (!best) continue; const idx = findNearestRes(cx, cy, best, 45);
    if (idx < 0) { a.none[best] = S.tick + 900; continue; } startGather(u, idx); g[best]++;
  }
  if (done.shop && done.barracks) {
    for (const r of ['iron', 'stone']) if (p.res[r] < 40 && a.none[r] > S.tick) { if (p.res.gold >= TRADE.buy) applyCmd(p.id, { c: 'trade', r }); else if (p.res.wood > 320) applyCmd(p.id, { c: 'trade', r: 'wood', sell: 1 }); else if (p.res.food > 420) applyCmd(p.id, { c: 'trade', r: 'food', sell: 1 }); }
  }
  // construction
  const boDone = a.bi >= AI_BO.length;
  let want = boDone ? (p.res.wood > 450 && (cnt.house || 0) < 12 ? 'house' : p.res.wood > 450 && (cnt.farm || 0) < 8 ? 'farm' : null) : AI_BO[a.bi];
  if (want) {
    if (canAfford(p, BLD[want].cost)) {
      const pos = aiPlace(p, want, cx, cy);
      if (pos) { applyCmd(p.id, { c: 'build', type: want, x: pos[0], y: pos[1] }); a.bi++; a.stuck = 0; } else if (++a.stuck > 8) { a.bi++; a.stuck = 0; }
    } else if (++a.stuck > 70) { a.bi++; a.stuck = 0; }
  }
  // training
  const ok = t => { const ud = UNIT[t]; return canAfford(p, ud.cost) && (!ud.req || done[ud.req]) && (boDone || p.res.wood - (ud.cost.wood || 0) >= 70); };
  for (const b of mine) {
    if (b.prog < 1 || b.queue.length >= 2) continue; let t = null;
    if (b.type === 'barracks') t = ok('champion') ? 'champion' : ok('sword') ? 'sword' : (a.alt ^= 1) ? 'archer' : 'spear';
    else if (b.type === 'stable') t = ok('lancer') ? 'lancer' : (uc.scout || 0) < 4 ? 'scout' : null;
    else if (b.type === 'siege') t = (uc.ram || 0) < 2 ? 'ram' : (uc.catapult || 0) < 2 ? 'catapult' : null;
    if (t && ok(t)) applyCmd(p.id, { c: 'train', b: b.id, type: t });
  }
  for (const b of mine) if (b.type === 'blacksmith' && b.prog >= 1) for (const w of ['wpn', 'arm']) if (p.upg[w] < 2 && p.res.iron > 150 + upgCost(p.upg[w]).iron) applyCmd(p.id, { c: 'upgrade', b: b.id, w });
  // war
  if (!a.attacking) {
    if (army.length >= a.wave && S.tick >= a.first) a.attacking = true;
    else if (a.alarm && S.tick - a.alarm.t < 100) for (const u of army) if (u.o === 'idle' && Math.hypot(u.x - a.alarm.x, u.y - a.alarm.y) > 4) orderMove(u, a.alarm.x, a.alarm.y, true, { x0: a.alarm.x, y0: a.alarm.y, x1: a.alarm.x, y1: a.alarm.y, r: 2 });
  }
  if (a.attacking) {
    if (army.length < Math.max(2, a.wave / 4)) { a.attacking = false; a.wave = Math.min(45, a.wave + 3); }
    else for (const u of army) {
      if (u.o !== 'idle') continue; let best = null, bd = 1e9;
      for (const b of S.buildings) { if (b.owner === p.id || BLD[b.type].wall) continue; const d = Math.abs(b.x - u.x) + Math.abs(b.y - u.y) + (b.type === 'townhall' ? -8 : 0); if (d < bd) { bd = d; best = b; } }
      if (best) orderMove(u, best.x, best.y, true, bRect(best, 1));
    }
  }
}

function simTick() {
  if (S.over) return;
  S.tick++;
  processPaths();
  for (const u of S.units) if (!u.dead && !u.inBoat) tickUnit(u, DT);
  for (const b of S.buildings) if (!b.dead) tickBld(b, DT);
  for (const p of S.players) if (p.alive && p.ai && (S.tick + p.id * 5) % 20 === 0) aiThink(p);
  if (S.tick % 10 === 0) {
    for (const p of S.players) { p.pop = 0; p.houses = 0; p.core = 0; }
    for (const u of S.units) if (!u.dead && !UNIT[u.type].civil) S.players[u.owner].pop++;
    let active = false;
    for (const b of S.buildings) { if (b.dead) continue; const p = S.players[b.owner]; if (!BLD[b.type].wall) p.core++; if (b.type === 'house' && b.prog >= 1) p.houses++; if (b.prog < 1 || b.queue.length) active = true; }
    if (active) S.bDirty = true;
    for (const p of S.players) {
      p.cap = Math.min(80, 8 + 4 * p.houses);
      if (p.alive && !p.core) {
        p.alive = false; S.msgs.push(p.name + "'s village has been destroyed!");
        for (const u of S.units) if (u.owner === p.id) killUnit(u);
        for (const b of S.buildings) if (b.owner === p.id) killBld(b);
      }
    }
    const alive = S.players.filter(p => p.alive);
    if (alive.length <= 1 && S.players.length > 1) { S.over = true; S.winner = alive.length ? alive[0].id : -1; }
  }
  if (S.units.some(u => u.dead)) S.units = S.units.filter(u => !u.dead);
  if (S.buildings.some(b => b.dead)) S.buildings = S.buildings.filter(b => !b.dead);
}

// ----- network snapshots -----
const r2 = v => Math.round(v * 100) / 100;
function makeSnap(full) {
  const m = { t: 's', k: S.tick, o: S.over ? 1 : 0, w: S.winner,
    p: S.players.map(p => [RES.map(r => Math.floor(p.res[r])), p.alive ? 1 : 0, p.pop, p.cap, p.upg.wpn, p.upg.arm]),
    u: [] };
  for (const u of S.units) if (!u.inBoat) m.u.push([u.id, UNAMES.indexOf(u.type), u.owner, r2(u.x), r2(u.y), Math.ceil(u.hp), u.cn > 0 ? RES.indexOf(u.ct) + 1 : 0, u.cargo ? u.cargo.length : 0]);
  if (S.bDirty || full) { m.b = S.buildings.map(b => [b.id, BNAMES.indexOf(b.type), b.owner, b.x, b.y, Math.ceil(b.hp), r2(b.prog), b.queue.map(q => UNAMES.indexOf(q)), r2(b.qp)]); S.bDirty = false; }
  return m;
}
function clientState(seed, players) {
  S = { seed, map: genMap(seed), tick: 0, players: players.map((p, i) => ({ id: i, name: p.name, ai: p.ai, res: { wood: 0, stone: 0, food: 0, iron: 0, gold: 0 }, alive: true, upg: { wpn: 0, arm: 0 }, pop: 0, cap: 0 })),
    units: [], buildings: [], uById: new Map(), bById: new Map(), occ: new Int32Array(PN), fx: [], tev: [], msgs: [], over: false, winner: -1, host: false };
  return S;
}
function applySnap(m) {
  S.tick = m.k; S.over = !!m.o; S.winner = m.w;
  m.p.forEach((a, i) => { const p = S.players[i]; if (!p) return; RES.forEach((r, j) => p.res[r] = a[0][j]); p.alive = !!a[1]; p.pop = a[2]; p.cap = a[3]; p.upg.wpn = a[4]; p.upg.arm = a[5]; });
  const seen = new Set();
  for (const a of m.u) {
    let u = S.uById.get(a[0]);
    if (!u) { u = { id: a[0], type: UNAMES[a[1]], owner: a[2], rx: a[3], ry: a[4] }; S.uById.set(u.id, u); S.units.push(u); }
    u.x = a[3]; u.y = a[4]; u.hp = a[5]; u.cn = a[6] ? 1 : 0; u.ct = a[6] ? RES[a[6] - 1] : null; u.cargoN = a[7]; seen.add(u.id);
  }
  if (S.units.length !== seen.size) S.units = S.units.filter(u => seen.has(u.id) || (S.uById.delete(u.id), false));
  if (m.b) {
    S.buildings = m.b.map(a => ({ id: a[0], type: BNAMES[a[1]], owner: a[2], x: a[3], y: a[4], hp: a[5], prog: a[6], queue: a[7].map(i => UNAMES[i]), qp: a[8] }));
    S.bById = new Map(S.buildings.map(b => [b.id, b])); S.occ.fill(0);
    for (const b of S.buildings) { const s = BLD[b.type].size || 1; for (let yy = b.y; yy < b.y + s; yy++) for (let xx = b.x; xx < b.x + s; xx++) S.occ[yy * MW + xx] = b.id; }
  }
  if (m.e) for (let i = 0; i < m.e.length; i += 2) S.map.feat[m.e[i]] = m.e[i + 1];
}
if (typeof module !== 'undefined') module.exports = {};
