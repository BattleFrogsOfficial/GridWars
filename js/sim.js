'use strict';
// ---------- Dino Duel: game rules, physics, weapons, bot (runs on the host) ----------
let G = null;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const rnd = (a, b) => a + Math.random() * (b - a);

// ----- map geometry -----
const geoCache = {};
function buildMap(i) {
  if (geoCache[i]) return geoCache[i];
  const m = MAPS[i], Wc = m.w, Hc = m.h, grid = new Uint8Array(Wc * Hc), solids = [], plats = [];
  const add = (a, isS) => {
    for (const x of [a[0], Wc - a[0] - a[2]]) {
      const h = isS ? a[3] : 1;
      if (isS) solids.push({ x: x * CELL, y: a[1] * CELL, w: a[2] * CELL, h: h * CELL }); else plats.push({ x: x * CELL, y: a[1] * CELL, w: a[2] * CELL, h: 10 });
      for (let yy = a[1]; yy < a[1] + h && yy < Hc; yy++) for (let xx = x; xx < x + a[2]; xx++) if (xx >= 0 && xx < Wc && (isS || !grid[yy * Wc + xx])) grid[yy * Wc + xx] = isS ? 1 : 2;
    }
  };
  m.s.forEach(a => add(a, true)); m.p.forEach(a => add(a, false));
  const sol = (x, y) => y >= 0 && x >= 0 && x < Wc && y < Hc && grid[y * Wc + x] === 1;
  const surfs = [], stand = [];
  for (let y = 1; y < Hc; y++) {
    let run = null;
    for (let x = 0; x <= Wc; x++) {
      const ok = x < Wc && grid[y * Wc + x] && !sol(x, y - 1) && !sol(x, y - 2) && !(grid[y * Wc + x] === 2 && y - 1 >= 0 && grid[(y - 1) * Wc + x] === 2);
      if (ok) { if (!run) { run = { id: surfs.length, x0: x * CELL, x1: 0, y: y * CELL, edges: [] }; surfs.push(run); } run.x1 = (x + 1) * CELL; stand.push({ x: (x + 0.5) * CELL, y: y * CELL, s: run.id }); }
      else run = null;
    }
  }
  const geo = { i, Wc, Hc, pw: Wc * CELL, ph: Hc * CELL, solids, plats, grid, surfs, stand, size: Wc <= 22 ? 0 : Wc <= 30 ? 1 : 2 };
  buildNav(geo);
  return geoCache[i] = geo;
}
function surfaceAt(geo, x, bottom) {
  for (const s of geo.surfs) if (Math.abs(s.y - bottom) < 3 && x > s.x0 - PW / 2 && x < s.x1 + PW / 2) return s;
  return null;
}
function solidAt(geo, x, y) { const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL); return cx >= 0 && cy >= 0 && cx < geo.Wc && cy < geo.Hc && geo.grid[cy * geo.Wc + cx] === 1; }
function losClear(geo, x0, y0, x1, y1) { const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 16); for (let i = 1; i < n; i++) if (solidAt(geo, x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n)) return false; return true; }

// ----- player physics -----
function newPlayer(id) { return { id, x: 0, y: 0, vx: 0, vy: 0, face: id ? -1 : 1, onG: false, coy: 0, jbuf: 0, dj: 1, alive: true, w: -1, am: 0, cd: 0, atk: 0, kind: 0, ls: -1, jc: 0, inv: false }; }
function stepPlayer(p, mx, jp, geo, fx) {
  const tv = mx * RUN, a = (p.onG ? ACC : AIRACC) * DT;
  p.vx += clamp(tv - p.vx, -a, a);
  if (Math.abs(mx) > 0.1) p.face = mx > 0 ? 1 : -1;
  if (p.onG) { p.coy = 0.09; p.dj = 1; } else p.coy -= DT;
  if (jp) p.jbuf = 0.1; else p.jbuf -= DT;
  if (p.jbuf > 0) {
    if (p.coy > 0) { p.vy = -JUMP; p.coy = 0; p.jbuf = 0; if (fx) fx.push(['jump', p.x, p.y + PH / 2, 0]); }
    else if (p.dj > 0) { p.vy = -DJUMP; p.dj = 0; p.jbuf = 0; if (fx) fx.push(['jump', p.x, p.y + PH / 2, 1]); }
  }
  p.vy = Math.min(p.vy + GRAV * DT, MAXFALL);
  const hw = PW / 2, hh = PH / 2;
  p.x += p.vx * DT;
  for (const s of geo.solids) if (p.x + hw > s.x && p.x - hw < s.x + s.w && p.y + hh > s.y && p.y - hh < s.y + s.h) { p.x = p.vx > 0 ? s.x - hw : s.x + s.w + hw; p.vx = 0; }
  const ob = p.y + hh, wasG = p.onG, vy0 = p.vy; p.y += p.vy * DT; p.onG = false;
  for (const s of geo.solids) if (p.x + hw > s.x && p.x - hw < s.x + s.w && p.y + hh > s.y && p.y - hh < s.y + s.h) { if (p.vy > 0) { p.y = s.y - hh; p.onG = true; } else p.y = s.y + s.h + hh; p.vy = 0; }
  if (p.vy >= 0) for (const s of geo.plats) if (p.x + hw > s.x && p.x - hw < s.x + s.w && ob <= s.y + 0.01 && p.y + hh >= s.y) { p.y = s.y - hh; p.vy = 0; p.onG = true; }
  if (p.onG && !wasG && vy0 > 300 && fx) fx.push(['land', p.x, p.y + hh]);
}

// ----- bot navigation: which jumps connect which surfaces -----
function patInput(pat, dir, t, air) {
  switch (pat) {
    case 0: return { mx: dir, jp: false };
    case 1: return { mx: dir, jp: t === 0 };
    case 2: return { mx: dir, jp: t === 0 || t === 18 };
    case 3: return { mx: dir, jp: t === 0 || t === 34 };
    case 4: return { mx: t < 14 ? 0 : dir, jp: t === 0 || t === 20 };
    case 5: return { mx: t < 12 ? dir : 0, jp: t === 0 };
    case 6: return { mx: dir, jp: air === 10 };
    case 7: return { mx: dir, jp: t === 0 || t === 42 };
    case 8: return { mx: 0, jp: t === 0 || t === 20 };
    case 9: return { mx: t < 22 ? 0 : dir, jp: t === 0 };
    case 10: return { mx: t < 30 ? 0 : dir, jp: t === 0 || t === 22 };
  }
}
function simPat(geo, from, x, pat, dir) {
  const p = newPlayer(0); p.x = x; p.y = from.y - PH / 2; p.onG = true; let air = 0;
  for (let t = 0; t < 170; t++) {
    const i = patInput(pat, dir, t, air); stepPlayer(p, i.mx, i.jp, geo, null); air = p.onG ? 0 : air + 1;
    if (p.y > geo.ph + 60) return null;
    if (p.onG && t > 2) { const s = surfaceAt(geo, p.x, p.y + PH / 2); if (!s) return null; if (s !== from) return { to: s.id, cost: t }; if (pat !== 0 && pat !== 6) return null; }
  }
  return null;
}
function buildNav(geo) {
  for (const s of geo.surfs) {
    const xs = []; for (let x = s.x0 + CELL / 2; x < s.x1; x += CELL) xs.push(x);
    const best = {};
    for (const x of xs) for (let pat = 0; pat <= 10; pat++) for (const dir of pat === 8 ? [0] : [-1, 1]) {
      const r = simPat(geo, s, x, pat, dir); if (!r) continue;
      const a = simPat(geo, s, x - 5, pat, dir), b = simPat(geo, s, x + 5, pat, dir);
      if (!a || !b || a.to !== r.to || b.to !== r.to) continue;
      (best[r.to] = best[r.to] || []).push({ to: r.to, x, pat, dir, cost: r.cost });
    }
    for (const k in best) { best[k].sort((a, b) => a.cost - b.cost); s.edges.push({ to: +k, opts: best[k].slice(0, 6) }); }
  }
}
function navNext(geo, from, to) { // first hop of the shortest surface path
  if (from === to) return null;
  const prev = new Int16Array(geo.surfs.length).fill(-1), q = [from]; prev[from] = from;
  for (let h = 0; h < q.length; h++) {
    const c = q[h]; if (c === to) break;
    for (const e of geo.surfs[c].edges) if (prev[e.to] < 0) { prev[e.to] = c; q.push(e.to); }
  }
  if (prev[to] < 0) return null;
  let c = to; while (prev[c] !== from) c = prev[c];
  return geo.surfs[from].edges.find(e => e.to === c);
}

// ----- match flow -----
function newMatch(opts) { // opts.bots: [diff|null, diff|null]
  G = { host: true, geo: null, mapI: -1, ph: 'count', pt: 3, time: 0, sc: [0, 0], pl: [newPlayer(0), newPlayer(1)], prs: [], pks: [], fx: [], rz: 0,
    inp: [{ mx: 0, jc: 0, a: false }, { mx: 0, jc: 0, a: false }], bots: (opts.bots || [null, null]).map(d => d ? newBot(d) : null), bag: [], nid: 1, res: -2, decided: false, spawnT: 0, round: 0 };
  startRound(); return G;
}
function startRound() {
  if (!G.bag.length) { G.bag = MAPS.map((_, i) => i); for (let i = G.bag.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [G.bag[i], G.bag[j]] = [G.bag[j], G.bag[i]]; } if (G.bag[G.bag.length - 1] === G.mapI) G.bag.reverse(); }
  G.mapI = G.bag.pop(); const geo = G.geo = buildMap(G.mapI);
  G.ph = 'count'; G.pt = 3; G.time = 0; G.prs = []; G.pks = []; G.rz = 0; G.res = -2; G.decided = false; G.round++;
  const kinds = [0, 1, 2].sort(() => Math.random() - 0.5);
  let a, b, tries = 0;
  do { a = geo.stand[Math.random() * geo.stand.length | 0]; b = geo.stand[Math.random() * geo.stand.length | 0]; } while (Math.abs(a.x - b.x) < geo.pw * (tries++ < 60 ? 0.35 : 0.1) && tries < 200);
  [a, b].forEach((s, i) => { const p = G.pl[i], jc = p.jc; Object.assign(p, newPlayer(i)); p.jc = jc; p.x = s.x; p.y = s.y - PH / 2; p.onG = true; p.ls = s.s; p.kind = kinds[i]; p.face = s.x < geo.pw / 2 ? 1 : -1; G.fx.push(['spawn', p.x, p.y]); });
  for (const bt of G.bots) if (bt) { bt.pat = null; bt.goal = null; bt.fire = 0; bt.think = 0; }
}
function spawnPickup() {
  const geo = G.geo; let s = null;
  for (let k = 0; k < 30; k++) {
    s = geo.stand[Math.random() * geo.stand.length | 0];
    if (!G.pks.some(q => Math.abs(q.x - s.x) < 70 && Math.abs(q.y - (s.y - 18)) < 50) && !G.pl.some(p => p.alive && Math.abs(p.x - s.x) < 150 && Math.abs(p.y - s.y) < 130)) break;
  }
  let r = Math.random() * 100, t = 1; while (t < 5 && (r -= TIERW[t]) > 0) t++;
  const pool = []; for (let i = 0; i < N_WEAPONS; i++) if (WEAPONS[i].t === t) pool.push(i);
  G.pks.push({ id: G.nid++, w: pool[Math.random() * pool.length | 0], x: s.x, y: s.y - 18, age: 0 });
}
function killP(p, kx, ky) { if (!p.alive || p.inv) return; p.alive = false; p.atk = 0; G.fx.push(['die', p.id, p.x, p.y, kx || 0, ky || 0]); }
function boxDist(p, x, y) { return Math.hypot(Math.max(Math.abs(x - p.x) - PW / 2, 0), Math.max(Math.abs(y - p.y) - PH / 2, 0)); }
function explode(x, y, def, o) {
  G.fx.push(['boom', x, y, def.expl]);
  for (const p of G.pl) if (p.alive && boxDist(p, x, y) <= def.expl) killP(p, (p.x - x) * 4, -300);
  if (def.frag) for (let i = 0; i < def.frag; i++) { const a = -Math.PI * (0.1 + 0.8 * (i + Math.random() * 0.6) / def.frag), sd = WEAPONS[W_SHRAPNEL]; G.prs.push({ id: G.nid++, w: W_SHRAPNEL, o: -1, x, y: y - 6, vx: Math.cos(a) * sd.sp, vy: Math.sin(a) * sd.sp, t: 0, b: 0, st: 0, d: 1 }); }
}
function fire(p, def) {
  const mk = (x, y, vx, vy) => G.prs.push({ id: G.nid++, w: p.w, o: p.id, x, y, vx, vy, t: 0, b: def.bnc || 0, st: 0, d: p.face });
  const mx = p.x + p.face * 18, my = p.y - 3;
  if (def.mine) mk(p.x + p.face * 4, p.y + PH / 2 - 10, 0, 0);
  else if (def.rain) for (let i = 0; i < def.cnt; i++) mk(p.x + p.face * (130 + i * 55) + rnd(-18, 18), -40 - i * 70, rnd(-30, 30), def.sp);
  else if (def.ring) for (let i = 0; i < def.cnt; i++) { const a = i / def.cnt * 6.2832; mk(p.x + Math.cos(a) * 14, p.y + Math.sin(a) * 14, Math.cos(a) * def.sp, Math.sin(a) * def.sp); }
  else for (let i = 0; i < def.cnt; i++) {
    const a = (def.ang || 0) + (def.cnt > 1 ? ((i + 0.5) / def.cnt - 0.5) * 2 * def.spr + rnd(-0.03, 0.03) : rnd(-def.spr, def.spr)), s = def.sp * (def.cnt > 2 ? rnd(0.85, 1.1) : 1);
    mk(mx, my, p.face * Math.cos(a) * s + (def.grav ? p.vx * 0.4 : 0), -Math.sin(a) * s);
  }
  p.vx -= p.face * (def.rec || 0); p.am--; G.fx.push(['shot', p.id, mx, my, p.w]);
  if (p.am <= 0) { p.w = -1; G.fx.push(['empty', p.id, p.x, p.y]); }
}
function stepProj(pr) {
  const def = WEAPONS[pr.w], geo = G.geo; pr.t += DT;
  if (pr.st === 1) { // resting mine
    if (pr.t - pr.at > 0.6) for (const p of G.pl) if (p.alive && boxDist(p, pr.x, pr.y) < def.trig) { explode(pr.x, pr.y, def, pr.o); return false; }
    return pr.t < def.life;
  }
  if (def.hom) { const e = G.pl[1 - pr.o]; if (e && e.alive) { const cur = Math.atan2(pr.vy, pr.vx), want = Math.atan2(e.y - pr.y, e.x - pr.x); let d = want - cur; while (d > Math.PI) d -= 6.2832; while (d < -Math.PI) d += 6.2832; const a = cur + clamp(d, -def.hom * DT, def.hom * DT); pr.vx = Math.cos(a) * def.sp; pr.vy = Math.sin(a) * def.sp; } }
  if (def.boom) pr.vx -= pr.d * def.sp * 1.55 * DT;
  pr.vy += def.grav * DT;
  const dist = Math.hypot(pr.vx, pr.vy) * DT, n = Math.max(1, Math.ceil(dist / 9)), sx = pr.vx * DT / n, sy = pr.vy * DT / n;
  for (let k = 0; k < n; k++) {
    const ox = pr.x, oy = pr.y; pr.x += sx; pr.y += sy;
    if (!def.ghost && solidAt(geo, pr.x, pr.y)) {
      if (def.mine) { pr.y = Math.floor(pr.y / CELL) * CELL - 4; pr.st = 1; pr.at = pr.t; pr.vx = pr.vy = 0; return true; }
      if (pr.b > 0) { pr.b--; const dm = def.damp || (def.grav ? 0.6 : 1); if (solidAt(geo, ox, pr.y)) { pr.vy = -pr.vy * dm; pr.y = oy; } else { pr.vx = -pr.vx * (def.grav ? 0.7 : 1); pr.x = ox; } G.fx.push(['spark', pr.x, pr.y]); break; }
      if (def.expl) explode(ox, oy, def, pr.o); else G.fx.push(['spark', ox, oy]);
      return false;
    }
    if (def.heavy && pr.vy > 0) for (const s of geo.plats) if (pr.x > s.x && pr.x < s.x + s.w && oy <= s.y && pr.y >= s.y) {
      if (def.mine) { pr.y = s.y - 4; pr.st = 1; pr.at = pr.t; pr.vx = pr.vy = 0; return true; }
      if (pr.b > 0) { pr.b--; pr.vy = -pr.vy * (def.damp || 0.6); pr.y = s.y - 1; break; }
      if (def.expl) explode(pr.x, s.y - 2, def, pr.o); return false;
    }
    for (const p of G.pl) {
      if (!p.alive || p.inv) continue;
      if (p.id === pr.o && !((def.bnc || def.boom) && pr.t > 0.35)) continue;
      if (Math.abs(pr.x - p.x) < PW / 2 + def.r * 0.7 && Math.abs(pr.y - p.y) < PH / 2 + def.r * 0.7) { killP(p, pr.vx * 0.5, pr.vy * 0.5 - 250); if (def.expl) explode(pr.x, pr.y, def, pr.o); return false; }
    }
  }
  if (pr.t >= def.life) { if (def.expl) explode(pr.x, pr.y, def, pr.o); return false; }
  return pr.x > -300 && pr.x < geo.pw + 300 && pr.y < geo.ph + 300 && pr.y > -1500;
}
function razorEdges() { const h = G.geo.ph / 2 + 20, d = G.rz * h; return { top: -20 + d, bot: G.geo.ph + 20 - d }; }

function tick() {
  if (!G || G.ph === 'over') return;
  const geo = G.geo;
  if (G.ph === 'count') {
    G.pt -= DT; for (const p of G.pl) stepPlayer(p, 0, false, geo, null);
    if (G.pt <= 0) { G.ph = 'play'; G.time = 0; G.spawnT = 0.7; }
    return;
  }
  if (G.ph === 'play') {
    G.time += DT; G.spawnT -= DT;
    if (G.spawnT <= 0) { G.spawnT = (G.time < 6 ? 1.3 : 2.4) - geo.size * 0.25; if (G.pks.length < 5 + geo.size * 2) spawnPickup(); }
    if (G.time >= SUDDEN_AT) G.rz = Math.min(1, (G.time - SUDDEN_AT) / RAZOR_TIME);
  }
  for (const p of G.pl) {
    if (!p.alive) continue;
    const bot = G.bots[p.id], inp = bot ? botInput(bot, p, G.pl[1 - p.id]) : G.inp[p.id];
    const jp = bot ? inp.jp : inp.jc !== p.jc; p.jc = bot ? p.jc : inp.jc;
    stepPlayer(p, clamp(inp.mx || 0, -1, 1), jp, geo, G.fx);
    if (p.onG) { const s = surfaceAt(geo, p.x, p.y + PH / 2); if (s) p.ls = s.id; }
    p.cd -= DT;
    const def = p.w >= 0 ? WEAPONS[p.w] : null;
    if (p.atk > 0 && def && def.k === 'm') {
      p.atk -= DT; const e = G.pl[1 - p.id], x0 = p.face > 0 ? p.x + 4 : p.x - 4 - def.reach - PW / 2, x1 = x0 + def.reach + PW / 2;
      if (e.alive && e.x + PW / 2 > x0 && e.x - PW / 2 < x1 && Math.abs(e.y - p.y) < def.arc / 2 + PH / 2 - 4) killP(e, p.face * 500, -350);
    }
    if (inp.a && p.cd <= 0 && def) {
      p.cd = def.cd;
      if (def.k === 'm') { p.atk = def.act; if (def.lunge) p.vx = p.face * def.lunge; G.fx.push(['swing', p.id]); } else fire(p, def);
    }
    for (let i = G.pks.length - 1; i >= 0; i--) {
      const k = G.pks[i];
      if (k.age > 0.4 && Math.abs(k.x - p.x) < PW / 2 + 14 && Math.abs(k.y - p.y) < PH / 2 + 14 && (p.w < 0 || WEAPONS[k.w].t > WEAPONS[p.w].t)) { p.w = k.w; p.am = WEAPONS[k.w].am || 0; p.cd = Math.max(p.cd, 0.15); p.atk = 0; G.fx.push(['pick', p.id, k.x, k.y, k.w]); G.pks.splice(i, 1); }
    }
    if (p.y > geo.ph + 70) killP(p, 0, -200);
    if (G.rz > 0) { const r = razorEdges(); if (p.y - PH / 2 < r.top || p.y + PH / 2 > r.bot) killP(p, rnd(-200, 200), p.y < geo.ph / 2 ? 300 : -500); }
  }
  for (const k of G.pks) k.age += DT;
  if (G.prs.length) G.prs = G.prs.filter(stepProj);
  if (G.ph === 'play' && G.pl.some(p => !p.alive)) { G.ph = 'end'; G.pt = 1.7; G.decided = false; }
  if (G.ph === 'end') {
    G.pt -= DT;
    if (!G.decided && G.pt <= 1.2) {
      G.decided = true; const al = G.pl.filter(p => p.alive);
      if (al.length === 1) { G.res = al[0].id; G.sc[G.res]++; al[0].inv = true; } else G.res = -1;
      G.fx.push(['result', G.res]);
    }
    if (G.pt <= 0) { if (Math.max(G.sc[0], G.sc[1]) >= WIN_SCORE) G.ph = 'over'; else startRound(); }
  }
}

// ----- bot -----
function newBot(diff) { return { d: BOTS[diff] || BOTS.normal, pat: null, patT: 0, air: 0, goal: null, think: 0, fire: 0, dodgeCd: 0, wob: 0 }; }
function botGoal(b, me, en) {
  const geo = G.geo, D = b.d, def = me.w >= 0 ? WEAPONS[me.w] : null;
  let pick = null, ps = 1e9;
  for (const k of G.pks) {
    if (def && (!D.greedy || WEAPONS[k.w].t <= def.t)) continue;
    const ks = surfaceAt(geo, k.x, k.y + 18); if (!ks || (me.ls >= 0 && ks.id !== me.ls && !navNext(geo, me.ls, ks.id))) continue;
    const s = Math.abs(k.x - me.x) + Math.abs(k.y - me.y) * 1.5 - WEAPONS[k.w].t * (D.greedy ? 60 : 0); if (s < ps) { ps = s; pick = k; }
  }
  let g = null;
  if (pick && (!def || ps < 260)) { const s = surfaceAt(geo, pick.x, pick.y + 18); if (s) g = { s: s.id, x: pick.x }; }
  if (!g && def && en.alive && en.ls >= 0 && (en.ls === me.ls || me.ls < 0 || navNext(geo, me.ls, en.ls))) {
    const es = geo.surfs[en.ls]; let x = en.x;
    if (def.k !== 'm') { const pref = Math.min(def.rng * 0.55, 260), side = me.x < en.x ? -1 : 1; x = en.x + side * pref; if (x < es.x0 + 14 || x > es.x1 - 14) { x = en.x - side * pref; if (x < es.x0 + 14 || x > es.x1 - 14) x = clamp(en.x + side * pref, es.x0 + 14, es.x1 - 14); } }
    g = { s: en.ls, x };
  }
  if (!g) { // nothing to do: drift away from an armed enemy, otherwise wander
    if (b.goal && b.goal.w && Math.random() < 0.8) return b.goal;
    let best = null, bs = -1e9;
    for (const s of geo.surfs) { const cx = (s.x0 + s.x1) / 2, sc = (en.alive && en.w >= 0 ? Math.abs(cx - en.x) + Math.abs(s.y - en.y) : 0) + Math.random() * 300; if (sc > bs) { bs = sc; best = s; } }
    g = { s: best.id, x: rnd(best.x0 + 16, best.x1 - 16), w: 1 };
  }
  if (G.rz > 0) { // sudden death: stay between the razors
    const r = razorEdges(), ok = s => s.y - PH - 30 > r.top && s.y + 30 < r.bot;
    if (!ok(geo.surfs[g.s])) { let best = null, bd = 1e9; for (const s of geo.surfs) { const d = Math.abs(s.y - PH / 2 - geo.ph / 2) + Math.abs((s.x0 + s.x1) / 2 - me.x) * 0.2; if (d < bd) { bd = d; best = s; } } g = { s: best.id, x: clamp(me.x, best.x0 + 16, best.x1 - 16) }; }
  }
  return g;
}
function botInput(b, me, en) {
  const geo = G.geo, D = b.d, out = { mx: 0, jp: false, a: false };
  if (G.ph === 'count') return out;
  b.dodgeCd -= DT;
  if (b.pat) {
    const i = patInput(b.pat.pat, b.pat.dir, b.patT, b.air); out.mx = i.mx; out.jp = i.jp; b.patT++; b.air = me.onG ? 0 : b.air + 1;
    if ((b.patT > 4 && me.onG) || b.patT > 170) b.pat = null;
  } else if (me.onG) {
    const cur = surfaceAt(geo, me.x, me.y + PH / 2);
    if (--b.think <= 0 || !b.goal) { b.think = D.think; b.goal = botGoal(b, me, en); }
    const g = b.goal;
    if (cur && g) {
      if (g.s === cur.id) { const dx = clamp(g.x, cur.x0 + 12, cur.x1 - 12) - me.x; out.mx = Math.abs(dx) < 8 ? 0 : clamp(dx / 40, -1, 1) * D.speed; }
      else {
        const e = navNext(geo, cur.id, g.s);
        if (e) {
          let o = e.opts[0], bd = 1e9; for (const q of e.opts) { const d = Math.abs(q.x - me.x) + q.cost * 2; if (d < bd) { bd = d; o = q; } }
          const dx = o.x - me.x;
          if (Math.abs(dx) < 4 && Math.abs(me.vx) < 30) { b.pat = o; b.patT = 0; b.air = 0; } else out.mx = clamp(dx / 28, -1, 1) * (Math.abs(dx) > 40 ? D.speed : 1);
        } else b.goal = null;
      }
    }
    // dodge incoming fire
    if (D.dodge > 0 && b.dodgeCd <= 0) {
      let threat = false;
      for (const pr of G.prs) {
        if (pr.o === me.id || pr.st === 1) continue; const pd = WEAPONS[pr.w];
        for (let k = 3; k <= 15 && !threat; k += 3) { const t = k * DT; if (Math.abs(pr.x + pr.vx * t - me.x) < PW / 2 + pd.r + 8 && Math.abs(pr.y + pr.vy * t + 0.5 * pd.grav * t * t - me.y) < PH / 2 + pd.r + 8) threat = true; }
        if (threat) break;
      }
      const ed = en.w >= 0 ? WEAPONS[en.w] : null;
      if (!threat && ed && en.alive && ed.k === 'm' && me.w < 0 && Math.abs(en.x - me.x) < ed.reach + 60 && Math.abs(en.y - me.y) < 50) threat = true;
      if (threat) { b.dodgeCd = 0.4; if (Math.random() < D.dodge && !b.pat) out.jp = true; }
    }
  } else { // airborne without a plan: steer for the nearest ground, save the double jump for emergencies
    let best = null, bd = 1e9;
    for (const s of geo.surfs) { if (s.y < me.y + PH / 2 - 4) continue; const tx = clamp(me.x, s.x0 + 10, s.x1 - 10), d = Math.abs(tx - me.x) + (s.y - me.y) * 0.3; if (d < bd) { bd = d; best = tx; } }
    if (best !== null) out.mx = clamp((best - me.x) / 20, -1, 1);
    if (me.vy > 250 && me.dj > 0 && (best === null || Math.abs(best - me.x) > 60 || me.y > geo.ph - 60)) out.jp = true;
    if (D.dodge >= 0.8 && me.dj > 0 && b.dodgeCd <= 0) for (const pr of G.prs) { if (pr.o === me.id || pr.st === 1) continue; const t = 0.12; if (Math.abs(pr.x + pr.vx * t - me.x) < PW / 2 + 12 && Math.abs(pr.y + pr.vy * t - me.y) < PH / 2 + 12) { out.jp = true; b.dodgeCd = 0.4; break; } }
  }
  // attack
  const def = me.w >= 0 ? WEAPONS[me.w] : null;
  if (def && en.alive && G.ph === 'play') {
    const dx = en.x - me.x, adx = Math.abs(dx), dy = en.y - me.y, slack = D.err * 30; let want;
    if (def.k === 'm') want = adx < def.reach + PW / 2 + slack && Math.abs(dy) < def.arc / 2 + PH / 2 - 6;
    else if (def.ai === 'any') want = adx < def.rng && Math.abs(dy) < 260 && (!def.mine || adx < 130);
    else if (def.ai === 'arc') want = adx < def.rng && adx > 60 && dy > -110 && dy < 160;
    else want = adx < def.rng && Math.abs(dy - (def.grav ? def.grav * 0.5 * (adx / def.sp) * (adx / def.sp) - Math.sin(def.ang || 0) * adx : 0)) < PH / 2 + def.r + slack && (!D.los || def.ghost || losClear(geo, me.x, me.y - 3, en.x, en.y));
    if (def.expl && !def.hom && !def.mine && adx < def.expl + 30 && D.los) want = false; // don't blow yourself up
    if (want) {
      if (me.face !== (dx > 0 ? 1 : -1)) { if (!b.pat) out.mx = (dx > 0 ? 1 : -1) * 0.15; }
      else if (++b.fire >= D.react) out.a = true;
    } else b.fire = Math.max(0, b.fire - 1);
  }
  return out;
}

// ----- network snapshots -----
const q1 = v => Math.round(v * 10) / 10;
function makeSnap() {
  return { t: 's', ph: G.ph, pt: q1(G.pt), tm: q1(G.time), sc: G.sc, m: G.mapI, rz: Math.round(G.rz * 1000) / 1000, res: G.res, rd: G.round,
    p: G.pl.map(p => [q1(p.x), q1(p.y), q1(p.vx), q1(p.vy), p.face, p.alive ? 1 : 0, p.w, p.am, p.atk > 0 ? 1 : 0, p.kind, p.onG ? 1 : 0]),
    pr: G.prs.map(r => [r.id, r.w, r.o, q1(r.x), q1(r.y), q1(r.vx), q1(r.vy), r.st, r.d]),
    pk: G.pks.map(k => [k.id, k.w, k.x, k.y, q1(k.age)]) };
}
function clientInit() { G = { host: false, geo: null, mapI: -1, ph: 'count', pt: 3, time: 0, sc: [0, 0], pl: [newPlayer(0), newPlayer(1)], prs: [], pks: [], fx: [], rz: 0, res: -2, round: 0 }; }
function applySnap(m) {
  if (m.m !== G.mapI) { G.mapI = m.m; G.geo = buildMap(m.m); }
  G.ph = m.ph; G.pt = m.pt; G.time = m.tm; G.sc = m.sc; G.rz = m.rz; G.res = m.res; G.round = m.rd;
  m.p.forEach((a, i) => { const p = G.pl[i]; p.x = a[0]; p.y = a[1]; p.vx = a[2]; p.vy = a[3]; p.face = a[4]; p.alive = !!a[5]; p.w = a[6]; p.am = a[7]; p.atk = a[8] ? 0.1 : 0; p.kind = a[9]; p.onG = !!a[10]; });
  G.prs = m.pr.map(a => ({ id: a[0], w: a[1], o: a[2], x: a[3], y: a[4], vx: a[5], vy: a[6], st: a[7], d: a[8], t: 1 }));
  G.pks = m.pk.map(a => ({ id: a[0], w: a[1], x: a[2], y: a[3], age: a[4] }));
}
