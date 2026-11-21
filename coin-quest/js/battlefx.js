// Attack animations for the battle stage (120x168 pixels, first person).
// How big an attack looks depends on the share of the monster's full HP (its peak balance) the payment
// takes off. Paying a debt happens once or twice a month, so every attack is a staged moment: a wind-up,
// the strike, hit-stop, the monster's own reaction, debris, and the damage counting up.
//
// The engine draws only pixels and reports DOM moments (banner, number, HP drain, vibration) as cues,
// so the same code can run in the design page and in the app.

export const ATTACK_TIERS = [
  { key: 'slash', name: 'Slash', min: 0, stars: 1 },
  { key: 'cross', name: 'Cross Cut', min: 0.02, stars: 2 },
  { key: 'heavy', name: 'Heavy Blow', min: 0.07, stars: 3 },
  { key: 'critical', name: 'Critical Strike', min: 0.2, stars: 4 },
  { key: 'legendary', name: 'Legendary Strike', min: 0.45, stars: 5 },
];

/** Which attack a payment of `amount` makes against a monster with `peak` max HP and `balance` HP left (cents). */
export function attackTier(amount, peak, balance) {
  const share = peak > 0 ? Math.max(0, amount) / peak : 0;
  let index = 0;
  ATTACK_TIERS.forEach((t, k) => { if (share >= t.min) index = k; });
  return { ...ATTACK_TIERS[index], index, share, kill: balance > 0 && amount >= balance };
}

const FX_BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const fxBay = (x, y) => FX_BAYER[(y & 3) * 4 + (x & 3)];
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const easeOut = (p) => 1 - Math.pow(1 - p, 3);

/** Piecewise-linear envelope through [time, value] points. */
const envelope = (pts) => (t) => {
  if (!pts.length || t <= pts[0][0]) return pts.length ? pts[0][1] : 0;
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i][0]) {
      const [t0, v0] = pts[i - 1], [t1, v1] = pts[i];
      return v0 + (v1 - v0) * ((t - t0) / (t1 - t0 || 1));
    }
  }
  return pts[pts.length - 1][1];
};

// What flies off each monster when it's hit, and how it reacts.
const DEBRIS = { slime: 'goo', goblin: 'chip', troll: 'chip', drake: 'scale', dragon: 'scale', castle: 'brick' };
const DUST = { slime: '#2c4a2a', goblin: '#6a4a2c', troll: '#7a7a8e', drake: '#7a4424', dragon: '#5a2a24', castle: '#9a9aae' };
const GOLD = ['#7a4a08', '#e09a1c', '#ffd040', '#fff4b0'];
const SPARK = ['#ffffff', '#fff0a0', '#ffc040', '#ff8020'];

/**
 * One attack. Options:
 *  tier 0-4, kill (bool), type (monster type), box {x0,y0,x1,y1} of the monster on the stage,
 *  palette (its main colours), points ([[x,y]...] sample of its pixels), W, H, groundY, flying, reduced, seed.
 * Each frame: step(dt) → cues fired this frame; then drawBack(g) before the monster, monster() for its
 * transform, drawFront(g) after it. view() gives the screen shake and zoom; dim() the backdrop darkening.
 */
export function createAttack(o) {
  const { W, H, groundY, type } = o;
  let seed = (o.seed || 1) >>> 0;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const rr = (a, b) => a + rnd() * (b - a);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const box = o.box;
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  const R = Math.max(10, Math.max(box.x1 - box.x0, box.y1 - box.y0) / 2);
  const feetY = o.flying ? box.y1 : groundY;
  const palette = o.palette && o.palette.length ? o.palette : ['#888', '#aaa', '#666'];
  const hand = { x: W / 2, y: H - 14 };
  const reduced = !!o.reduced;

  let t = 0, freeze = 0, speed = 1, end = 0;
  const events = [], cues = [], parts = [], rings = [], arcs = [], bolts = [], splats = [], kicks = [], shakes = [], zooms = [], beams = [], emitters = [];
  let flashes = [], swordPlan = null, orb = null, cross = null, dissolve = null, slowmo = [];
  const at = (time, fn) => events.push({ time, fn });
  const cue = (c) => cues.push(c);
  const dimPts = [[0, 0]], whitePts = [[0, 0]], edgePts = [[0, 0]], speedPts = [[0, 0]], chargePts = [[0, 0]];
  const dimEnv = () => envelope(dimPts), whiteEnv = () => envelope(whitePts);

  // ---------- building blocks ----------
  /** Gold motes gather at the hero's hands and a glow grows at the bottom of the screen. */
  function charge(t0, t1, level, motes) {
    chargePts.push([t0, 0], [t1 - 0.02, level], [t1 + 0.08, 0]);
    emitters.push({ t0, t1, every: (t1 - t0) / motes, next: t0, spawn: () => {
      const side = rnd();
      const x = side < 0.4 ? rr(-4, 8) : side < 0.8 ? rr(W - 8, W + 4) : rr(10, W - 10);
      const y = side < 0.8 ? rr(H * 0.45, H) : H + 2;
      parts.push({ kind: 'mote', x, y, x0: x, y0: y, tx: hand.x + rr(-6, 6), ty: hand.y + rr(-4, 4), born: t, life: rr(0.35, 0.6) });
    } });
    if (!reduced) shakes.push({ t0, dur: t1 - t0, amp: 0.4 + level * 0.8, rumble: true });
  }
  /** A slash across the monster from S to E (in units of its size), bowed by `bulge`. */
  function slash(t0, sx, sy, ex, ey, bulge, w, dur = 0.13) {
    const S = [cx + sx * R, cy + sy * R], E = [cx + ex * R, cy + ey * R];
    const mx = (S[0] + E[0]) / 2, my = (S[1] + E[1]) / 2, dx = E[0] - S[0], dy = E[1] - S[1], len = Math.hypot(dx, dy) || 1;
    const C = [mx - (dy / len) * bulge * R, my + (dx / len) * bulge * R];
    arcs.push({ t0, dur, S, C, E, w, len });
  }
  /** A hit: hit-stop, white flash on the monster, its reaction, sparks, debris, shake and (main hit) the cues. */
  function impact(t0, power, main = false, at0 = null) {
    at(t0, () => {
      const hx = at0 ? at0[0] : cx + rr(-R, R) * 0.25, hy = at0 ? at0[1] : cy + rr(-R, R) * 0.25;
      freeze = Math.max(freeze, Math.min(0.26, 0.03 + power * 0.04));
      flashes.push([t, t + 0.06 + power * 0.012]);
      kicks.push({ t0: t, s: Math.min(1.4, power / 3) });
      const n = Math.round(6 + power * 6);
      for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2, v = rr(50, 120) * (0.7 + power * 0.12);
        parts.push({ kind: 'spark', x: hx, y: hy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 60, drag: 3, born: t, life: rr(0.2, 0.45) });
      }
      debris(hx, hy, Math.round(4 + power * 5), power);
      if (power >= 1.4) coins(hx, hy, Math.round(power * 3));
      if (power >= 2) rings.push({ t0: t, x: cx, y: o.flying ? cy : feetY, r1: 18 + power * 10, dur: 0.45 + power * 0.04, flat: !o.flying });
      if (power >= 2.5 && (type === 'troll' || type === 'castle' || type === 'goblin')) dust(Math.round(power * 4));
      if (power >= 2.4 && type === 'slime') for (let i = 0; i < Math.min(4, Math.floor(power - 1)); i++) splats.push({ t0: t, x: pick([rr(4, 34), rr(W - 34, W - 4)]), y: rr(H * 0.3, H * 0.8), r: rr(5, 10), seed: rnd() * 100 });
      if (!reduced) {
        shakes.push({ t0: t, dur: 0.22 + power * 0.1, amp: 1.2 + power * 1.6 });
        zooms.push({ t0: t, dur: 0.35, amt: 0.01 + power * 0.012 });
      }
      if (power >= 2.5) whitePts.push([t, 0], [t + 0.01, Math.min(0.9, 0.25 + power * 0.1)], [t + 0.12 + power * 0.03, 0]);
      cue({ cue: 'buzz', ms: Math.round(15 + power * 18) });
      if (main) cue({ cue: 'hit', power });
    });
  }
  function debris(x, y, n, power) {
    const kind = DEBRIS[type] || 'chip';
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + rr(-1.3, 1.3), v = rr(40, 95) * (0.8 + power * 0.1);
      parts.push({ kind, x: x + rr(-4, 4), y: y + rr(-4, 4), vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: kind === 'goo' ? 210 : 260, drag: 0.6,
        born: t, life: rr(0.9, 1.6), c: pick(palette), c2: pick(palette), floor: feetY + rr(-2, 16), spin: rr(6, 16), size: kind === 'brick' ? (rnd() < 0.4 ? 3 : 2) : 2 });
    }
  }
  function coins(x, y, n, up = 1) {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + rr(-0.9, 0.9);
      const v = rr(60, 110) * up;
      parts.push({ kind: 'coin', x: x + rr(-3, 3), y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 240, drag: 0.4, born: t, life: rr(1.3, 2), floor: feetY + rr(0, 18), spin: rr(10, 20) });
    }
  }
  function dust(n) {
    for (let i = 0; i < n; i++) {
      const side = rnd() < 0.5 ? -1 : 1;
      parts.push({ kind: 'dust', x: cx + side * rr(R * 0.3, R * 1.1), y: feetY - rr(0, 4), vx: side * rr(15, 45), vy: rr(-14, -4), g: 0, drag: 2, born: t, life: rr(0.8, 1.4), r: rr(2, 4), c: DUST[type] || '#888' });
    }
  }
  function bolt(t0, x0, y0, x1, y1, dur = 0.16) {
    at(t0, () => { bolts.push({ t0: t, x0, y0, x1, y1, dur }); cue({ cue: 'buzz', ms: 20 }); });
  }

  // ---------- the five attacks ----------
  const tier = Math.max(0, Math.min(4, o.tier | 0));
  let mainAt = 0;
  if (tier === 0) {
    // Slash: a quick wind-up, one bright diagonal cut, coins knocked loose
    charge(0, 0.5, 0.45, 12);
    at(0.12, () => cue({ cue: 'banner', text: 'Slash!', size: 1 }));
    slash(0.5, -1.1, -0.95, 1.0, 0.95, 0.3, 4);
    impact(0.57, 1.7, true);
    mainAt = 0.57; end = 2.3;
  } else if (tier === 1) {
    // Cross Cut: two cuts in an X that flares and bursts
    charge(0, 0.55, 0.6, 18);
    at(0.12, () => cue({ cue: 'banner', text: 'Cross Cut!', size: 2 }));
    slash(0.55, -1.15, -1, 1.1, 1, 0.25, 4);
    impact(0.61, 1.2);
    slash(0.78, 1.15, -1, -1.1, 1, -0.25, 4);
    impact(0.84, 1.8, true);
    at(0.84, () => { cross = { t0: t, burst: t + 0.38 }; });
    at(1.22, () => {
      rings.push({ t0: t, x: cx, y: cy, r1: R * 1.6, dur: 0.4, flat: false });
      for (let i = 0; i < 18; i++) { const a = rnd() * 6.283, v = rr(60, 140); parts.push({ kind: 'spark', x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 40, drag: 3, born: t, life: rr(0.25, 0.5) }); }
      coins(cx, cy, 8);
      if (!reduced) shakes.push({ t0: t, dur: 0.3, amp: 3 });
      cue({ cue: 'buzz', ms: 30 });
    });
    mainAt = 0.84; end = 2.8;
  } else if (tier === 2) {
    // Heavy Blow: the world darkens, a long charge, one huge overhead cut, a shockwave across the ground
    dimPts.push([0.6, 0.45], [1.3, 0.45], [2.0, 0]);
    charge(0, 0.85, 0.85, 30);
    at(0.18, () => cue({ cue: 'banner', text: 'Heavy Blow!', size: 3 }));
    slash(0.85, -0.25, -1.7, 0.15, 1.35, 0.45, 7, 0.12);
    impact(0.92, 3.2, true);
    at(0.92, () => dust(10));
    mainAt = 0.92; end = 3.2;
  } else if (tier === 3) {
    // Critical Strike: gold rushes in from the edges, a three-cut combo, then a beam of light through it
    dimPts.push([0.5, 0.55], [2.6, 0.55], [3.3, 0]);
    edgePts.push([0.2, 0], [0.9, 1], [1.6, 0.6], [2.4, 0]);
    speedPts.push([0.4, 0], [0.9, 1], [0.96, 0], [1.95, 0], [2.0, 1], [2.5, 0]);
    charge(0, 0.95, 1, 40);
    at(0.15, () => cue({ cue: 'banner', text: 'CRITICAL!', size: 4 }));
    slash(0.95, -1.35, -0.2, 1.35, 0.1, 0.25, 5);
    impact(1.01, 1.6);
    slash(1.18, 1.25, 0.9, -1.25, -0.9, 0.3, 5);
    impact(1.24, 1.9);
    slash(1.42, 0.1, 1.45, -0.1, -1.55, -0.4, 6);
    impact(1.48, 2.2);
    at(1.5, () => { orb = { t0: t, t1: t + 0.5 }; });
    emitters.push({ t0: 1.5, t1: 1.98, every: 0.012, next: 1.5, spawn: () => {
      const a = rnd() * 6.283, d = rr(R * 1.2, R * 2.4);
      const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
      parts.push({ kind: 'mote', x, y, x0: x, y0: y, tx: cx, ty: cy, born: t, life: rr(0.2, 0.35) });
    } });
    at(1.98, () => beams.push({ t0: t, dur: 0.4 }));
    impact(2.06, 4.4, true, [cx, cy]);
    at(2.06, () => { slowmo.push([t, t + 0.6, 0.35]); coins(cx, cy, 14); for (let i = 0; i < 3; i++) rings.push({ t0: t + i * 0.1, x: cx, y: cy, r1: R * (1.6 + i * 0.7), dur: 0.5, flat: false }); });
    mainAt = 2.06; end = 4.1;
  } else {
    // Legendary Strike: the sky goes dark, lightning, energy rising from the ground, a giant sword of light
    // drops from the sky into the monster, slow motion, shockwaves, a rain of gold
    dimPts.push([0.7, 0.72], [3.2, 0.72], [4.2, 0]);
    edgePts.push([0.4, 0], [1.2, 1], [2.0, 0.5], [3.0, 0]);
    speedPts.push([1.0, 0], [1.75, 1], [1.95, 0], [2.0, 1], [2.6, 0]);
    chargePts.push([0, 0], [1.7, 1], [1.95, 0]);
    if (!reduced) shakes.push({ t0: 0, dur: 1.9, amp: 1.2, rumble: true });
    at(0.6, () => cue({ cue: 'banner', text: 'LEGENDARY STRIKE!', size: 5 }));
    for (const [bt, x] of [[0.45, W * 0.2], [0.85, W * 0.8], [1.3, W * 0.4]]) {
      bolt(bt, x + rr(-8, 8), -4, x + rr(-14, 14), rr(H * 0.35, H * 0.55));
      at(bt, () => whitePts.push([t, 0], [t + 0.01, 0.35], [t + 0.1, 0]));
    }
    emitters.push({ t0: 0.3, t1: 1.8, every: 0.015, next: 0.3, spawn: () => {
      const x = rr(0, W), y = rr(feetY, H);
      parts.push({ kind: 'rise', x, y, vx: rr(-3, 3), vy: rr(-60, -25), g: 0, drag: 0, born: t, life: rr(0.6, 1.1) });
    } });
    at(0.3, () => rings.push({ t0: t, x: cx, y: feetY, r1: R * 1.5, dur: 1.6, flat: true, hold: true }));
    swordPlan = { appear: 1.0, plunge: 1.85, hit: 1.97, shatter: 3.0 };
    impact(1.97, 6.5, true, [cx, cy]);
    at(1.97, () => {
      slowmo.push([t, t + 0.9, 0.3]);
      for (let i = 0; i < 3; i++) rings.push({ t0: t + i * 0.12, x: cx, y: o.flying ? cy : feetY, r1: 40 + i * 30, dur: 0.7, flat: !o.flying });
      for (let i = 0; i < 4; i++) { const a = rnd() * 6.283; bolts.push({ t0: t, x0: cx, y0: cy, x1: cx + Math.cos(a) * 70, y1: cy + Math.sin(a) * 70, dur: 0.3 }); }
      dust(14);
      coins(cx, cy, 16);
    });
    emitters.push({ t0: 2.2, t1: 3.4, every: 0.03, next: 2.2, spawn: () => {
      parts.push({ kind: 'coin', x: rr(4, W - 4), y: -4, vx: rr(-10, 10), vy: rr(30, 70), g: 160, drag: 0.2, born: t, life: rr(1.4, 2), floor: rr(groundY, H - 4), spin: rr(10, 20) });
    } });
    at(3.0, () => {
      for (let i = 0; i < 40; i++) { const y = cy - rr(0, 70), a = rnd() * 6.283, v = rr(10, 50); parts.push({ kind: 'mote', x: cx, y, x0: cx, y0: y, tx: cx + Math.cos(a) * v, ty: y + Math.sin(a) * v, born: t, life: rr(0.5, 0.9), fade: true }); }
    });
    mainAt = 1.97; end = 5.2;
  }

  // ---------- the killing blow: flashes, then the monster dissolves into gold ----------
  if (o.kill) {
    const k0 = mainAt + 0.7;
    for (const dt of [0, 0.16, 0.32]) at(k0 + dt, () => { flashes.push([t, t + 0.08]); kicks.push({ t0: t, s: 0.4 }); });
    at(k0 + 0.5, () => {
      dissolve = { t0: t, dur: 1.4 };
      rings.push({ t0: t, x: cx, y: cy, r1: R * 2.2, dur: 0.8, flat: false });
      cue({ cue: 'buzz', ms: 60 });
    });
    emitters.push({ t0: k0 + 0.5, t1: k0 + 1.9, every: 0.012, next: k0 + 0.5, spawn: () => {
      const p = o.points && o.points.length ? pick(o.points) : [cx + rr(-R, R), cy + rr(-R, R)];
      const kind = rnd() < 0.55 ? 'coin' : 'rise';
      parts.push({ kind, x: p[0], y: p[1], vx: rr(-25, 25), vy: rr(-80, -35), g: kind === 'coin' ? -10 : 0, drag: 0.5, born: t, life: rr(0.8, 1.4), floor: 999, spin: rr(10, 20) });
    } });
    at(k0 + 1.1, () => cue({ cue: 'defeated' }));
    emitters.push({ t0: k0 + 1.3, t1: k0 + 2.8, every: 0.025, next: k0 + 1.3, spawn: () => {
      parts.push({ kind: 'coin', x: rr(4, W - 4), y: -4, vx: rr(-10, 10), vy: rr(30, 70), g: 160, drag: 0.2, born: t, life: rr(1.4, 2), floor: rr(groundY, H - 4), spin: rr(10, 20) });
    } });
    end = Math.max(end, k0 + 3.4);
  }
  events.sort((a, b) => a.time - b.time);
  const dimF = dimEnv(), whiteF = whiteEnv(), edgeF = envelope(edgePts), speedF = envelope(speedPts), chargeF = envelope(chargePts.sort((a, b) => a[0] - b[0]));

  // ---------- simulation ----------
  let ev = 0;
  function step(realDt) {
    cues.length = 0;
    let dt = Math.min(0.05, realDt) * speed;
    if (freeze > 0) { freeze -= dt; dt = 0; }
    const slow = slowmo.find(([a, b]) => t >= a && t < b);
    if (slow) dt *= slow[2];
    t += dt;
    while (ev < events.length && events[ev].time <= t) events[ev++].fn();
    for (const e of emitters) while (t >= e.next && e.next < e.t1) { e.spawn(); e.next += e.every; }
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      if (t - p.born > p.life) { parts.splice(i, 1); continue; }
      if (p.kind === 'mote') {
        const k = easeOut(clamp01((t - p.born) / p.life));
        p.x = p.x0 + (p.tx - p.x0) * k; p.y = p.y0 + (p.ty - p.y0) * k;
        continue;
      }
      p.vx *= 1 - Math.min(1, p.drag * dt); p.vy *= 1 - Math.min(1, p.drag * dt);
      p.vy += p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.floor !== undefined && p.y > p.floor && p.vy > 0) {
        p.y = p.floor;
        if (p.kind === 'goo') { p.vx = 0; p.vy = 0; p.g = 0; p.flat = true; }
        else { p.vy = -p.vy * 0.35; p.vx *= 0.6; if (Math.abs(p.vy) < 12) { p.vy = 0; p.g = 0; p.rest = true; } }
      }
    }
    return cues.slice();
  }

  /** Transform for the monster this frame: offset, scale, rotation (about its feet), flash, dissolve 0-1. */
  function monster() {
    let dx = 0, dy = 0, sx = 1, sy = 1, rot = 0;
    for (const k of kicks) {
      const tau = t - k.t0;
      if (tau < 0 || tau > 1.5) continue;
      const decay = Math.exp(-tau * 5), osc = Math.exp(-tau * 6) * Math.cos(tau * 22), s = k.s;
      if (type === 'slime') { sy -= 0.32 * s * osc; sx += 0.26 * s * osc; }
      else if (type === 'goblin') { dy -= 5 * s * decay; sx -= 0.1 * s * decay; sy -= 0.1 * s * decay; rot += 0.2 * s * osc; }
      else if (type === 'troll') { dx += 2.5 * s * Math.sin(tau * 50) * decay; sx -= 0.03 * s * decay; sy -= 0.03 * s * decay; rot += 0.06 * s * osc; }
      else if (type === 'drake') { dy -= 3.5 * s * decay; sx -= 0.07 * s * decay; sy -= 0.07 * s * decay; rot -= 0.13 * s * osc; }
      else if (type === 'dragon') { dy -= 8 * s * decay; rot += 0.11 * s * osc; sx -= 0.05 * s * decay; sy -= 0.05 * s * decay; }
      else if (type === 'castle') { dx += 2 * s * Math.sin(tau * 60) * decay; dy += 1.2 * s * decay; }
    }
    // it trembles while a big attack charges
    const ch = chargeF(t);
    if (tier >= 2 && ch > 0.2 && !reduced) dx += Math.sin(t * 45) * ch * 0.8;
    if (reduced) { dx *= 0.3; dy *= 0.3; rot *= 0.3; }
    const flash = flashes.some(([a, b]) => t >= a && t < b);
    const dis = dissolve ? clamp01((t - dissolve.t0) / dissolve.dur) : 0;
    return { dx, dy, sx, sy, rot, flash, dissolve: dis, pivotY: o.flying ? cy : feetY };
  }

  function view() {
    let x = 0, y = 0, zoom = 1;
    for (const s of shakes) {
      const tau = t - s.t0;
      if (tau < 0 || tau > s.dur) continue;
      const a = s.rumble ? s.amp * (tau / s.dur) : s.amp * (1 - tau / s.dur);
      x += (Math.random() * 2 - 1) * a; y += (Math.random() * 2 - 1) * a;
    }
    for (const z of zooms) {
      const tau = t - z.t0;
      if (tau >= 0 && tau < z.dur) zoom += z.amt * (1 - tau / z.dur);
    }
    zoom += chargeF(t) * 0.025;
    return { x, y, zoom };
  }

  // ---------- drawing ----------
  const px = (g, x, y, c, s = 1) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), s, s); };

  /** Behind the monster: lightning in the sky, ground rings. */
  function drawBack(g) {
    for (const b of bolts) if (b.y0 < 0) drawBolt(g, b);
    for (const r of rings) if (r.flat) drawRing(g, r);
  }

  function drawFront(g) {
    // gold tint at the screen edges
    const edge = edgeF(t);
    if (edge > 0.02) {
      const band = 4 + edge * 10;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const d = Math.min(x, y, W - 1 - x, H - 1 - y);
        if (d < band && (1 - d / band) * edge * (0.8 + 0.2 * Math.sin(t * 12)) > fxBay(x, y)) px(g, x, y, d < band * 0.4 ? GOLD[2] : GOLD[1]);
      }
    }
    // speed lines rushing toward the monster
    const sp = speedF(t);
    if (sp > 0.05) {
      g.globalAlpha = 0.55 * sp;
      for (let i = 0; i < 18; i++) {
        const a = Math.random() * 6.283, r0 = 40 + Math.random() * 30, l = 8 + Math.random() * 18;
        for (let s = 0; s < l; s++) px(g, cx + Math.cos(a) * (r0 + s), cy + Math.sin(a) * (r0 + s), '#ffffff');
      }
      g.globalAlpha = 1;
    }
    for (const r of rings) if (!r.flat) drawRing(g, r);
    for (const b of bolts) if (b.y0 >= 0) drawBolt(g, b);
    if (cross) drawCross(g);
    if (orb) drawOrb(g);
    for (const b of beams) drawBeam(g, b);
    for (const a of arcs) drawArc(g, a);
    if (swordPlan) drawSword(g);
    for (const p of parts) drawPart(g, p);
    for (const s of splats) drawSplat(g, s);
    // charge glow rising at the hero's hands
    const ch = chargeF(t);
    if (ch > 0.02) {
      const r = 6 + ch * 30;
      for (let y = Math.floor(H - r * 0.8); y < H; y++) for (let x = Math.floor(hand.x - r); x <= hand.x + r; x++) {
        const d = Math.hypot((x - hand.x) / r, (y - H) / (r * 0.8));
        if (d < 1 && (1 - d) * 1.4 * ch + 0.1 > fxBay(x, y)) px(g, x, y, d < 0.35 ? '#ffffff' : d < 0.65 ? GOLD[3] : GOLD[2]);
      }
    }
    const wv = whiteF(t);
    if (wv > 0.01) { g.globalAlpha = Math.min(1, wv); g.fillStyle = '#fffbe8'; g.fillRect(0, 0, W, H); g.globalAlpha = 1; }
  }

  function drawArc(g, a) {
    const p = (t - a.t0) / a.dur;
    if (p < 0) return;
    const uh = easeOut(clamp01(p)), ut = clamp01((p - 0.35) / 1.6);
    if (ut >= 1) return;
    const n = Math.ceil(a.len * 2.2);
    for (let i = 0; i <= n; i++) {
      const u = ut + (uh - ut) * (i / n);
      const f = (u - ut) / ((uh - ut) || 1);
      const q = 1 - u;
      const x = q * q * a.S[0] + 2 * u * q * a.C[0] + u * u * a.E[0];
      const y = q * q * a.S[1] + 2 * u * q * a.C[1] + u * u * a.E[1];
      const tx = 2 * q * (a.C[0] - a.S[0]) + 2 * u * (a.E[0] - a.C[0]), ty = 2 * q * (a.C[1] - a.S[1]) + 2 * u * (a.E[1] - a.C[1]);
      const tl = Math.hypot(tx, ty) || 1, nx = -ty / tl, ny = tx / tl;
      const th = a.w * Math.pow(Math.sin(Math.PI * Math.min(1, f * 0.85 + 0.08)), 0.7) * (1 - ut * 0.6);
      for (let s = -th / 2; s <= th / 2; s += 0.5) {
        const e = Math.abs(s) / (th / 2 || 1);
        px(g, x + nx * s, y + ny * s, e < 0.35 ? '#ffffff' : e < 0.7 ? '#fff0a0' : '#ffb030');
      }
    }
  }

  function drawRing(g, r) {
    const tau = t - r.t0;
    if (tau < 0 || tau > r.dur) return;
    const k = r.hold ? Math.min(1, tau / 0.4) : easeOut(tau / r.dur);
    const rad = r.r1 * k, fade = r.hold ? Math.sin(Math.PI * tau / r.dur) : 1 - tau / r.dur;
    const ry = r.flat ? 0.32 : 1, steps = Math.ceil(rad * 7) + 8;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * 6.283;
      for (let w = 0; w < 2; w++) {
        const x = r.x + Math.cos(a) * (rad - w), y = r.y + Math.sin(a) * (rad - w) * ry;
        if (fade * 1.2 > fxBay(Math.round(x), Math.round(y))) px(g, x, y, w ? GOLD[2] : (r.hold ? GOLD[3] : '#ffffff'));
      }
    }
  }

  function drawBolt(g, b) {
    const tau = t - b.t0;
    if (tau < 0 || tau > b.dur) return;
    if (Math.random() < 0.25) return; // flicker
    let x = b.x0, y = b.y0;
    const segs = 9;
    for (let i = 1; i <= segs; i++) {
      const k = i / segs;
      const nx = b.x0 + (b.x1 - b.x0) * k + (i < segs ? (Math.random() * 2 - 1) * 7 : 0);
      const ny = b.y0 + (b.y1 - b.y0) * k;
      const n = Math.ceil(Math.hypot(nx - x, ny - y));
      for (let s = 0; s <= n; s++) {
        const lx = x + (nx - x) * (s / n), ly = y + (ny - y) * (s / n);
        px(g, lx - 1, ly, GOLD[2]); px(g, lx + 1, ly, GOLD[2]); px(g, lx, ly, '#ffffff');
      }
      x = nx; y = ny;
    }
  }

  function drawCross(g) {
    const tau = t - cross.t0;
    if (t > cross.burst + 0.05) return;
    const glow = 0.6 + 0.4 * Math.sin(tau * 40);
    const r = R * (0.9 + tau * 0.6);
    for (let s = -r; s <= r; s += 0.5) for (const sgn of [1, -1]) {
      const x = cx + s * 0.75, y = cy + sgn * s * 0.75;
      px(g, x, y, '#ffffff');
      if (glow > 0.5) { px(g, x + 1, y, GOLD[2]); px(g, x - 1, y, GOLD[2]); }
    }
  }

  function drawOrb(g) {
    const tau = t - orb.t0;
    if (t > orb.t1 + 0.1) return;
    const r = 1 + Math.min(1, tau / (orb.t1 - orb.t0)) * 7 + Math.sin(t * 50) * 0.6;
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
      const d = Math.hypot(x, y) / r;
      if (d < 1) px(g, cx + x, cy + y, d < 0.45 ? '#ffffff' : d < 0.8 ? GOLD[3] : GOLD[2]);
    }
  }

  function drawBeam(g, b) {
    const p = (t - b.t0) / b.dur;
    if (p < 0 || p > 1) return;
    const w = 13 * Math.sin(Math.PI * p) + 1;
    const n = Math.ceil(Math.hypot(cx - hand.x, cy - hand.y));
    for (let i = 0; i <= n; i++) {
      const k = i / n, x = hand.x + 4 + (cx - hand.x - 4) * k, y = H + (cy - H) * k;
      const ww = w * (1 - k * 0.45);
      for (let s = -ww / 2; s <= ww / 2; s++) {
        const e = Math.abs(s) / (ww / 2);
        if (e > 0.85 && fxBay(Math.round(x + s), Math.round(y)) > 0.5) continue;
        px(g, x + s, y, e < 0.4 ? '#ffffff' : e < 0.75 ? GOLD[3] : GOLD[2]);
      }
    }
  }

  function drawSword(g) {
    const s = swordPlan;
    if (t < s.appear || t > s.shatter) return;
    // the whole sword stays on screen while it hovers, however tall the monster is
    const L = 64, target = cy + Math.min(10, R * 0.25), hover = Math.max(L - 4, Math.min(target - 24, cy - 50));
    let tipY;
    if (t < s.plunge) tipY = hover + Math.sin(t * 5) * 1.5 - (1 - easeOut(clamp01((t - s.appear) / 0.5))) * 30;
    else tipY = hover + (target - hover) * easeOut(clamp01((t - s.plunge) / 0.12));
    const grow = clamp01((t - s.appear) / 0.5);
    const len = L * (0.3 + 0.7 * easeOut(grow));
    const x = Math.round(cx);
    const top = tipY - len;
    // aura
    if (t < s.hit) for (let y = Math.floor(top - 6); y < tipY + 4; y++) for (let dx = -7; dx <= 7; dx++) {
      const e = Math.abs(dx) / 7;
      if ((1 - e) * 0.55 * grow > fxBay(x + dx, y) + 0.2) px(g, x + dx, y, GOLD[2]);
    }
    for (let y = Math.floor(top); y <= tipY; y++) {
      const fromTip = tipY - y;
      const half = fromTip < 7 ? Math.floor(fromTip / 2.4) : 3;
      for (let dx = -half; dx <= half; dx++) {
        const c = dx === 0 ? '#ffffff' : Math.abs(dx) === half ? GOLD[1] : (dx < 0 ? GOLD[3] : GOLD[2]);
        px(g, x + dx, y, c);
      }
    }
    // crossguard, grip and pommel
    const gy = Math.floor(top);
    for (let dx = -10; dx <= 10; dx++) for (let dy = -2; dy <= 0; dy++) px(g, x + dx, gy + dy, dy === -2 ? GOLD[3] : Math.abs(dx) === 10 ? GOLD[0] : GOLD[2]);
    for (let dy = 1; dy <= 9; dy++) for (let dx = -1; dx <= 1; dx++) px(g, x + dx, gy - 2 - dy, dy % 3 === 0 ? GOLD[0] : '#8a4a1a');
    for (let dy = 0; dy < 3; dy++) for (let dx = -2; dx <= 2; dx++) px(g, x + dx, gy - 13 - dy, Math.abs(dx) + dy === 0 ? '#ffffff' : GOLD[2]);
    // a jewel in the guard
    px(g, x, gy - 1, '#ff4060'); px(g, x - 1, gy - 1, '#c01838');
  }

  function drawPart(g, p) {
    const age = (t - p.born) / p.life;
    const fadeOk = age < 0.7 || (1 - age) / 0.3 > fxBay(Math.round(p.x), Math.round(p.y));
    if (!fadeOk) return;
    switch (p.kind) {
      case 'spark': {
        const c = SPARK[Math.min(3, Math.floor(age * 4))];
        const l = Math.min(4, Math.hypot(p.vx, p.vy) / 30);
        const n = Math.hypot(p.vx, p.vy) || 1;
        for (let s = 0; s <= l; s++) px(g, p.x - (p.vx / n) * s, p.y - (p.vy / n) * s, c);
        break;
      }
      case 'mote':
        if (p.fade && age > 0.6 && Math.random() < 0.5) break;
        px(g, p.x, p.y, age < 0.5 ? GOLD[3] : '#ffffff');
        break;
      case 'rise':
        px(g, p.x, p.y, age < 0.3 ? '#ffffff' : GOLD[2]);
        if (age < 0.6) px(g, p.x, p.y + 1, GOLD[1]);
        break;
      case 'coin': {
        const w = p.rest ? 2 : (Math.floor((t * p.spin) % 3) === 0 ? 1 : 2);
        px(g, p.x, p.y, GOLD[2]);
        if (w === 2) { px(g, p.x + 1, p.y, GOLD[1]); px(g, p.x, p.y + 1, GOLD[1]); px(g, p.x + 1, p.y + 1, GOLD[0]); }
        else px(g, p.x, p.y + 1, GOLD[1]);
        if (Math.sin(t * 20 + p.spin) > 0.85) px(g, p.x, p.y - 1, '#ffffff');
        break;
      }
      case 'goo':
        if (p.flat) { px(g, p.x - 1, p.y, p.c); px(g, p.x, p.y, p.c); px(g, p.x + 1, p.y, p.c2); }
        else { px(g, p.x, p.y, p.c, 2); px(g, p.x, p.y, '#ffffff'); }
        break;
      case 'chip':
        px(g, p.x, p.y, p.c, 2);
        break;
      case 'scale': {
        const ph = Math.floor((t * p.spin) % 2);
        px(g, p.x, p.y - 1, p.c); px(g, p.x, p.y + 1, p.c2);
        if (ph) { px(g, p.x - 1, p.y, p.c); px(g, p.x + 1, p.y, p.c2); }
        px(g, p.x, p.y, '#ffffff');
        break;
      }
      case 'brick':
        g.fillStyle = p.c; g.fillRect(Math.round(p.x), Math.round(p.y), p.size + 1, p.size);
        px(g, p.x, p.y, '#e8e8f0');
        break;
      case 'dust': {
        const r = p.r * (1 + age * 1.5);
        for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
          if (x * x + y * y < r * r && (1 - age) * 0.7 > fxBay(Math.round(p.x + x), Math.round(p.y + y))) px(g, p.x + x, p.y + y, p.c);
        }
        break;
      }
    }
  }

  // slime on the lens: blobs on the screen that drip and fade
  function drawSplat(g, s) {
    const tau = t - s.t0;
    if (tau < 0 || tau > 1.8) return;
    const fade = tau < 1.1 ? 1 : 1 - (tau - 1.1) / 0.7;
    const [c0, c1] = [palette[0], palette[1] || palette[0]];
    for (let y = -s.r; y <= s.r; y++) for (let x = -s.r; x <= s.r; x++) {
      const wob = s.r * (0.85 + 0.15 * Math.sin(Math.atan2(y, x) * 5 + s.seed));
      const d = Math.hypot(x, y);
      if (d < wob && fade > fxBay(Math.round(s.x + x), Math.round(s.y + y)) * 0.9) px(g, s.x + x, s.y + y, d < wob * 0.6 ? c0 : c1);
    }
    px(g, s.x - s.r * 0.3, s.y - s.r * 0.3, '#ffffff');
    // drips
    for (let k = 0; k < 3; k++) {
      const dx = (k - 1) * s.r * 0.5 + Math.sin(s.seed + k) * 2;
      const len = Math.min(s.r * 2.5, tau * (12 + k * 6));
      for (let y = 0; y < len; y++) if (fade > fxBay(Math.round(s.x + dx), Math.round(s.y + s.r * 0.6 + y)) * 0.9) px(g, s.x + dx, s.y + s.r * 0.6 + y, c0);
    }
  }

  return {
    step,
    monster,
    view,
    dim: () => dimF(t),
    drawBack,
    drawFront,
    skip() { speed = 4; },
    get time() { return t; },
    get done() { return t >= end; },
    get impactAt() { return mainAt; },
    tier,
  };
}
