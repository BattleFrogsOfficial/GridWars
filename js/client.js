'use strict';
// ---------- Dino Duel: rendering, animation, input, menus ----------
let cv, ctx, running = false, ME = 0, mode = 'bot', botDiff = 'normal', DPR = 1, VW = 0, VH = 0;
const $ = id => document.getElementById(id);
const R = { t: 0, pl: [{}, {}], parts: [], rags: [], pops: [], shake: 0, banner: null, flash: 0, acc: 0, tickN: 0, sent: '', sentT: 0, hud: '' };
const keys = {}, touch = { mx: 0, a: false }, input = { mx: 0, jc: 0, a: false };
const TAU = Math.PI * 2;

// ----- effects -----
function part(x, y, vx, vy, life, col, size, grav, kind) { if (R.parts.length < 700) R.parts.push({ x, y, vx, vy, life, max: life, col, size, grav: grav || 0, kind: kind || 0 }); }
function burst(x, y, n, col, sp, life, size, grav) { for (let i = 0; i < n; i++) { const a = Math.random() * TAU, s = sp * (0.3 + Math.random() * 0.7); part(x, y, Math.cos(a) * s, Math.sin(a) * s, life * (0.6 + Math.random() * 0.4), col, size * (0.6 + Math.random() * 0.6), grav); } }
function handleFx(f) {
  switch (f[0]) {
    case 'jump': if (f[3]) part(f[1], f[2], 0, 0, 0.3, '#ffffff', 10, 0, 1); else for (let i = 0; i < 5; i++) part(f[1] + rnd(-8, 8), f[2], rnd(-70, 70), rnd(-40, 0), 0.3, '#ffffffaa', 5); break;
    case 'land': for (let i = 0; i < 6; i++) part(f[1] + rnd(-10, 10), f[2], rnd(-110, 110), rnd(-50, 0), 0.32, '#ffffffaa', 5); break;
    case 'shot': { const r = R.pl[f[1]]; r.kick = 1; const d = WEAPONS[f[4]]; if (d.shape !== 'flame' && !d.mine) part(f[2], f[3], 0, 0, 0.08, '#fff3b0', 9, 0, 2); break; }
    case 'swing': R.pl[f[1]].swing = 1; break;
    case 'spark': burst(f[1], f[2], 5, '#ffe9a8', 160, 0.25, 3, 300); break;
    case 'boom': part(f[1], f[2], 0, 0, 0.35, '#ffb347', f[3], 0, 3); burst(f[1], f[2], 18, '#ff7a2a', f[3] * 4, 0.5, 7, 500); burst(f[1], f[2], 10, '#55505a', f[3] * 2, 0.7, 9, -60); R.shake = Math.max(R.shake, 0.35); break;
    case 'die': { const p = G.pl[f[1]]; R.rags.push({ id: f[1], kind: p.kind, x: f[2], y: f[3], vx: clamp(f[4], -700, 700), vy: Math.min(f[5], -200) - 200, rot: 0, vr: rnd(-14, 14), t: 0 }); burst(f[2], f[3], 16, COLORS[f[1]].main, 380, 0.6, 6, 700); burst(f[2], f[3], 8, '#fff', 300, 0.5, 4, 500); R.shake = Math.max(R.shake, 0.3); R.flash = 0.12; break; }
    case 'pick': R.pops.push({ x: f[2], y: f[3] - 24, t: 0, txt: WEAPONS[f[4]].n, col: TIERCOL[WEAPONS[f[4]].t] }); burst(f[2], f[3], 10, TIERCOL[WEAPONS[f[4]].t], 200, 0.4, 4, 0); break;
    case 'empty': R.pops.push({ x: f[2], y: f[3] - 30, t: 0, txt: 'empty!', col: '#fff' }); break;
    case 'spawn': part(f[1], f[2], 0, 0, 0.5, '#ffffff', 30, 0, 1); break;
    case 'result': R.banner = { t: 0, res: f[1] }; break;
  }
}

// ----- drawing helpers -----
function rr(c, x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
const INK = '#2a2233';
function drawWeapon(c, d) { // grip at origin, pointing right
  c.lineWidth = 2; c.strokeStyle = INK; c.fillStyle = d.col; c.lineJoin = 'round'; c.lineCap = 'round';
  const fs = () => { c.fill(); c.stroke(); };
  switch (d.look) {
    case 'club': rr(c, -2, -3, 22, 6, 3); fs(); c.beginPath(); c.arc(21, 0, 6, 0, TAU); fs(); break;
    case 'pan': c.fillStyle = '#5a4030'; rr(c, -2, -2, 14, 4, 2); fs(); c.fillStyle = d.col; c.beginPath(); c.ellipse(20, 0, 9, 8, 0, 0, TAU); fs(); break;
    case 'fish': c.beginPath(); c.ellipse(13, 0, 13, 6, 0, 0, TAU); fs(); c.beginPath(); c.moveTo(0, 0); c.lineTo(-7, -6); c.lineTo(-7, 6); c.closePath(); fs(); c.fillStyle = INK; c.beginPath(); c.arc(20, -2, 1.5, 0, TAU); c.fill(); break;
    case 'glove': c.fillStyle = '#444'; rr(c, -2, -3, 8, 6, 2); fs(); c.fillStyle = d.col; rr(c, 5, -8, 16, 16, 7); fs(); break;
    case 'blade': c.fillStyle = '#6b4a2a'; rr(c, -3, -2.5, 8, 5, 2); fs(); c.fillStyle = '#3a3a44'; rr(c, 4, -6, 3, 12, 1); fs(); c.fillStyle = d.col; c.beginPath(); c.moveTo(7, -3.5); c.lineTo(28, -2); c.lineTo(33, 0); c.lineTo(28, 2.5); c.lineTo(7, 3.5); c.closePath(); fs(); break;
    case 'pole': c.fillStyle = '#8a5a2b'; rr(c, -12, -2, 44, 4, 2); fs(); c.fillStyle = d.col; c.beginPath(); c.moveTo(30, -5); c.lineTo(44, 0); c.lineTo(30, 5); c.closePath(); fs(); break;
    case 'axe': c.fillStyle = '#8a5a2b'; rr(c, -4, -2, 32, 4, 2); fs(); c.fillStyle = d.col; c.beginPath(); c.moveTo(20, -2); c.quadraticCurveTo(24, -16, 36, -12); c.quadraticCurveTo(31, 0, 36, 12); c.quadraticCurveTo(24, 16, 20, 2); c.closePath(); fs(); break;
    case 'whip': c.fillStyle = '#5a4030'; rr(c, -3, -3, 9, 6, 2); fs(); c.strokeStyle = d.col; c.lineWidth = 3; c.beginPath(); c.moveTo(6, 0); c.bezierCurveTo(16, -12, 22, 12, 34, 2); c.stroke(); break;
    case 'bow': c.strokeStyle = d.col; c.lineWidth = 4; c.beginPath(); c.arc(4, 0, 14, -1.2, 1.2); c.stroke(); c.strokeStyle = '#eee'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(9, -13); c.lineTo(9, 13); c.stroke(); break;
    case 'ball': c.beginPath(); c.arc(8, 0, 8, 0, TAU); fs(); c.fillStyle = '#ffffff66'; c.beginPath(); c.arc(6, -3, 3, 0, TAU); c.fill(); break;
    case 'small': c.fillStyle = '#3a3038'; rr(c, -1, 0, 6, 9, 2); fs(); c.fillStyle = d.col; rr(c, -2, -5, 20, 7, 2); fs(); break;
    case 'long': c.fillStyle = '#5a4030'; rr(c, -10, -3, 12, 8, 2); fs(); c.fillStyle = d.col; rr(c, 0, -4, 30, 6, 2); fs(); c.fillStyle = '#3a3038'; rr(c, 4, 1, 5, 7, 2); fs(); break;
    case 'big': c.fillStyle = '#3a3038'; rr(c, 2, 2, 6, 8, 2); fs(); c.fillStyle = d.col; rr(c, -8, -7, 20, 13, 4); fs(); c.fillStyle = '#4a4a55'; for (let i = -1; i <= 1; i++) { rr(c, 12, i * 4 - 1.5, 20, 3, 1); fs(); } break;
    case 'launcher': c.fillStyle = d.col; rr(c, -10, -6, 38, 11, 4); fs(); c.fillStyle = '#22222a'; c.beginPath(); c.ellipse(28, -0.5, 2.5, 5, 0, 0, TAU); c.fill(); c.fillStyle = '#3a3038'; rr(c, 2, 4, 5, 7, 2); fs(); break;
  }
}
function drawDino(c, kind, col, o) { // origin at the feet, facing right
  const bob = o.air ? 0 : Math.abs(Math.sin(o.run)) * -2 * o.mv, y = bob;
  c.lineWidth = 2; c.strokeStyle = INK; c.lineJoin = 'round'; c.lineCap = 'round';
  const fs = f => { c.fillStyle = f; c.fill(); c.stroke(); };
  const wag = Math.sin(o.t * 7 + kind) * 2.5 + (o.air ? clamp(-o.vy * 0.012, -8, 8) : 0);
  c.beginPath(); c.moveTo(-5, -24 + y); c.quadraticCurveTo(-20, -22 + y, -27, -11 + y + wag); c.quadraticCurveTo(-15, -9 + y, -4, -8 + y); c.closePath(); fs(col.main);
  if (kind === 2) { c.fillStyle = '#f4f1e8'; for (const [sx, sy] of [[-25, -13], [-21, -17]]) { c.beginPath(); c.moveTo(sx, sy + y + wag * 0.8); c.lineTo(sx - 5, sy - 6 + y + wag); c.lineTo(sx + 3, sy - 2 + y + wag * 0.8); c.closePath(); c.fill(); c.stroke(); } }
  for (let i = 0; i < 2; i++) { // legs
    const ang = o.air ? (i ? 0.7 : -0.6) : Math.sin(o.run + i * Math.PI) * 0.9 * o.mv;
    c.save(); c.translate(i ? 4 : -4, -10 + y); c.rotate(ang); rr(c, -3.5, 0, 7, 10 - y, 3); fs(col.dark); rr(c, -3.5, 7 - y, 10, 4.5, 2); fs(col.dark); c.restore();
  }
  if (kind === 2) { for (let i = 0; i < 4; i++) { const px = -9 + i * 6, py = -27 - Math.sin((i + 0.5) / 4 * Math.PI) * 4 + y; c.beginPath(); c.moveTo(px - 4, py + 3); c.lineTo(px, py - 8); c.lineTo(px + 4, py + 3); c.closePath(); fs(col.light); } }
  c.beginPath(); c.ellipse(0, -18 + y, 12.5, 11.5, 0, 0, TAU); fs(col.main);
  c.beginPath(); c.ellipse(3, -14.5 + y, 7.5, 7, 0, 0, TAU); c.fillStyle = col.light; c.fill();
  const hx = 9, hy = -32 + y + (o.air ? -1 : 0);
  if (kind === 0) { // rex: big boxy head, teeth
    rr(c, hx - 8, hy - 9, 23, 16, 7); fs(col.main);
    c.fillStyle = '#fff'; for (let i = 0; i < 3; i++) { c.beginPath(); c.moveTo(hx + 4 + i * 4, hy + 6.5); c.lineTo(hx + 6 + i * 4, hy + 10.5); c.lineTo(hx + 8 + i * 4, hy + 6.5); c.closePath(); c.fill(); }
    c.beginPath(); c.moveTo(hx + 2, hy + 4); c.lineTo(hx + 14, hy + 4); c.stroke();
  } else if (kind === 1) { // trike: frill and horns
    c.beginPath(); c.arc(hx - 5, hy - 2, 11, 0, TAU); fs(col.dark);
    c.beginPath(); c.ellipse(hx + 3, hy + 1, 11, 7.5, 0, 0, TAU); fs(col.main);
    for (const [bx, by, tx, ty] of [[hx + 1, hy - 5, hx + 6, hy - 17], [hx + 10, hy - 3, hx + 17, hy - 9]]) { c.beginPath(); c.moveTo(bx - 3, by); c.lineTo(tx, ty); c.lineTo(bx + 3, by + 1); c.closePath(); fs('#f4f1e8'); }
    c.beginPath(); c.moveTo(hx + 6, hy + 4); c.lineTo(hx + 13, hy + 4); c.stroke();
  } else { // stego: small round head on a neck
    c.beginPath(); c.ellipse(hx + 4, hy + 3, 10, 6.5, -0.15, 0, TAU); fs(col.main);
    c.beginPath(); c.moveTo(hx + 7, hy + 5.5); c.lineTo(hx + 13, hy + 4.5); c.stroke();
  }
  const ex = hx + (kind === 0 ? 5 : 4), ey = hy - (kind === 2 ? 0 : 2);
  if (o.blink) { c.beginPath(); c.moveTo(ex - 3, ey); c.lineTo(ex + 3, ey); c.stroke(); }
  else { c.beginPath(); c.arc(ex, ey, 3.6, 0, TAU); c.fillStyle = '#fff'; c.fill(); c.stroke(); c.beginPath(); c.arc(ex + 1.2, ey, 1.8, 0, TAU); c.fillStyle = INK; c.fill(); }
}
function drawPlayer(c, p, r, now) {
  const col = COLORS[p.id];
  c.save(); c.translate(r.x, r.y + PH / 2); c.scale(p.face * r.sx, r.sy);
  drawDino(c, p.kind, col, { run: r.run, mv: r.mv, air: !p.onG, vy: p.vy, t: R.t, blink: (R.t * 1.3 + p.id * 0.37) % 3 < 0.12 });
  const d = p.w >= 0 ? WEAPONS[p.w] : null; // arm + weapon
  c.save(); c.translate(8, -17);
  let ang = 0, push = 0;
  if (d) {
    if (d.k === 'm') { const s = r.swing; if (d.look === 'pole' || d.look === 'glove') { ang = -0.1; push = Math.sin(s * Math.PI) * 16; } else ang = -1.1 + (s > 0 ? Math.sin((1 - s) * Math.PI * 0.75) * 2.3 : 0); }
    else { ang = -r.kick * 0.35 - (d.ang || 0) * 0.6; push = -r.kick * 5; }
    c.rotate(ang); c.translate(push, 0); drawWeapon(c, d);
  }
  c.strokeStyle = INK; c.fillStyle = col.dark; c.lineWidth = 2; c.beginPath(); c.arc(0, 0, 3.4, 0, TAU); c.fill(); c.stroke();
  c.restore(); c.restore();
  if (d && d.k === 'm' && r.swing > 0.2) { // swing arc
    c.save(); c.translate(r.x, r.y); c.scale(p.face, 1); c.globalAlpha = r.swing * 0.7; c.strokeStyle = '#fff'; c.lineWidth = 5; c.lineCap = 'round';
    c.beginPath(); if (d.arc < 32) { c.moveTo(14, -2); c.lineTo(14 + d.reach, -2); } else c.arc(6, -4, d.reach * 0.8, -1.1, 0.9); c.stroke(); c.restore(); c.globalAlpha = 1;
  }
}
function drawProj(c, pr, now) {
  const d = WEAPONS[pr.w], a = Math.atan2(pr.vy, pr.vx);
  c.save(); c.translate(pr.x, pr.y); c.lineWidth = 2; c.strokeStyle = INK; c.fillStyle = d.col;
  switch (d.shape) {
    case 'bullet': c.rotate(a); c.fillStyle = '#fff6c9'; rr(c, -9, -d.r * 0.7, 14, d.r * 1.4, d.r); c.fill(); c.fillStyle = d.col; c.globalAlpha = 0.5; rr(c, -22, -d.r * 0.5, 16, d.r, d.r); c.fill(); break;
    case 'beam': c.rotate(a); c.strokeStyle = d.col; c.lineWidth = d.r * 2; c.lineCap = 'round'; c.beginPath(); c.moveTo(-70, 0); c.lineTo(8, 0); c.stroke(); c.strokeStyle = '#fff'; c.lineWidth = d.r * 0.8; c.beginPath(); c.moveTo(-60, 0); c.lineTo(8, 0); c.stroke(); break;
    case 'arrow': c.rotate(a); c.strokeStyle = '#7a5a3a'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(-14, 0); c.lineTo(6, 0); c.stroke(); c.fillStyle = d.col; c.strokeStyle = INK; c.lineWidth = 1.5; c.beginPath(); c.moveTo(4, -4); c.lineTo(12, 0); c.lineTo(4, 4); c.closePath(); c.fill(); c.stroke(); break;
    case 'ball': c.beginPath(); c.arc(0, 0, d.r, 0, TAU); c.fill(); c.stroke(); break;
    case 'bomb': c.rotate(now / 90); c.beginPath(); c.arc(0, 0, d.r, 0, TAU); c.fill(); c.stroke(); c.fillStyle = (now / 80 | 0) % 2 ? '#ffe04a' : '#ff5a2a'; c.beginPath(); c.arc(0, -d.r - 2, 2.5, 0, TAU); c.fill(); break;
    case 'disc': c.rotate(now / 40); c.beginPath(); for (let i = 0; i < 16; i++) { const rad = i % 2 ? d.r : d.r * 0.68, q = i / 16 * TAU; c.lineTo(Math.cos(q) * rad, Math.sin(q) * rad); } c.closePath(); c.fill(); c.stroke(); c.fillStyle = INK; c.beginPath(); c.arc(0, 0, 2, 0, TAU); c.fill(); break;
    case 'rocket': c.rotate(a); rr(c, -d.r - 4, -d.r * 0.55, d.r * 2 + 6, d.r * 1.1, d.r * 0.5); c.fill(); c.stroke(); c.fillStyle = '#eee'; c.beginPath(); c.moveTo(d.r + 2, -d.r * 0.55); c.lineTo(d.r + 9, 0); c.lineTo(d.r + 2, d.r * 0.55); c.closePath(); c.fill(); c.stroke(); break;
    case 'rock': c.rotate(now / 120); c.fillStyle = '#6a4a3a'; c.beginPath(); for (let i = 0; i < 7; i++) { const q = i / 7 * TAU, rad = d.r * (0.8 + (i % 3) * 0.15); c.lineTo(Math.cos(q) * rad, Math.sin(q) * rad); } c.closePath(); c.fill(); c.stroke(); break;
    case 'flame': { const k = Math.min(1, (pr.t || 0) / d.life); c.globalAlpha = 0.85 - k * 0.5; c.fillStyle = k < 0.4 ? '#ffe46a' : k < 0.75 ? '#ff9a2a' : '#e5482a'; c.beginPath(); c.arc(0, 0, d.r * (0.6 + k * 0.9), 0, TAU); c.fill(); break; }
    case 'bee': c.rotate(a); c.beginPath(); c.ellipse(0, 0, 6, 4, 0, 0, TAU); c.fill(); c.stroke(); c.fillStyle = INK; c.fillRect(-1, -4, 2, 8); c.fillStyle = '#ffffffcc'; c.beginPath(); c.ellipse(-1, -5 - Math.sin(now / 15) * 1.5, 4, 2.5, 0, 0, TAU); c.fill(); break;
    case 'mine': c.beginPath(); c.arc(0, 4, d.r, Math.PI, 0); c.closePath(); c.fill(); c.stroke(); c.fillStyle = pr.st === 1 && (now / 160 | 0) % 2 ? '#ff3a3a' : '#7a1a1a'; c.beginPath(); c.arc(0, -3, 2.5, 0, TAU); c.fill(); break;
  }
  c.restore();
}
function drawSaw(c, x, y, rad, rot) {
  c.save(); c.translate(x, y); c.rotate(rot); c.beginPath();
  for (let i = 0; i < 20; i++) { const q = i / 20 * TAU, r2 = i % 2 ? rad : rad * 0.74; c.lineTo(Math.cos(q) * r2, Math.sin(q) * r2); }
  c.closePath(); c.fillStyle = '#d5dae2'; c.fill(); c.lineWidth = 2; c.strokeStyle = INK; c.stroke();
  c.beginPath(); c.arc(0, 0, rad * 0.3, 0, TAU); c.fillStyle = '#e5484d'; c.fill(); c.stroke(); c.restore();
}

// ----- frame -----
function render(now, dt) {
  const c = ctx, geo = G.geo, th = THEMES[G.mapI % THEMES.length];
  c.setTransform(DPR, 0, 0, DPR, 0, 0);
  const g = c.createLinearGradient(0, 0, 0, VH); g.addColorStop(0, th.sky[0]); g.addColorStop(1, th.sky[1]); c.fillStyle = g; c.fillRect(0, 0, VW, VH);
  if (th.name === 'Midnight') { c.fillStyle = '#fff'; for (let i = 0; i < 50; i++) { c.globalAlpha = 0.35 + 0.35 * Math.sin(R.t * 2 + i * 1.7); c.fillRect((i * 197.3) % VW, (i * 89.7) % (VH * 0.7), 2, 2); } c.globalAlpha = 1; }
  for (let L = 0; L < 2; L++) { // rolling hills
    c.fillStyle = th.hill[L]; c.beginPath(); c.moveTo(0, VH);
    for (let x = 0; x <= VW + 20; x += 20) c.lineTo(x, VH * (0.62 + L * 0.14) + Math.sin(x * 0.006 * (L + 1) + G.mapI * 1.3 + L * 2) * VH * 0.07 + Math.sin(x * 0.017 + L) * VH * 0.02);
    c.lineTo(VW, VH); c.closePath(); c.fill();
  }
  c.fillStyle = th.name === 'Volcano' || th.name === 'Midnight' ? '#ffffff22' : '#ffffffaa'; // drifting clouds
  for (let i = 0; i < 6; i++) { const cx = ((i * 331 + R.t * (8 + i * 3)) % (VW + 300)) - 150, cy = VH * (0.08 + (i * 0.37 % 1) * 0.3), s = 0.7 + (i % 3) * 0.3; for (const [dx, dy, rx, ry] of [[0, 0, 60, 18], [35, -10, 36, 16], [-30, -6, 30, 13]]) { c.beginPath(); c.ellipse(cx + dx * s, cy + dy * s, rx * s, ry * s, 0, 0, TAU); c.fill(); } }
  if (th.name === 'Volcano') { c.fillStyle = '#ffb347'; for (let i = 0; i < 24; i++) { const ey = VH - ((R.t * (30 + i * 4) + i * 70) % (VH + 40)), exx = (i * 173) % VW + Math.sin(R.t + i) * 20; c.globalAlpha = 0.6; c.fillRect(exx, ey, 3, 3); } c.globalAlpha = 1; }
  // world transform
  const top = 46, bot = touchOn ? 8 : 8, s = Math.min(VW / (geo.pw + 30), (VH - top - bot) / (geo.ph + 20));
  R.shake = Math.max(0, R.shake - dt);
  const ox = (VW - geo.pw * s) / 2 + (R.shake > 0 ? rnd(-7, 7) * R.shake * 3 : 0), oy = top + (VH - top - bot - geo.ph * s) / 2 + (R.shake > 0 ? rnd(-7, 7) * R.shake * 3 : 0);
  c.setTransform(DPR * s, 0, 0, DPR * s, DPR * ox, DPR * oy);
  // platforms
  for (const p of geo.plats) { c.fillStyle = '#0003'; rr(c, p.x + 1, p.y + 3, p.w - 2, 11, 5); c.fill(); c.fillStyle = th.plat; rr(c, p.x, p.y, p.w, 11, 5); c.fill(); c.lineWidth = 2; c.strokeStyle = th.ink; c.stroke(); c.fillStyle = '#ffffff55'; rr(c, p.x + 4, p.y + 2, p.w - 8, 3, 1.5); c.fill(); }
  c.fillStyle = th.solid; for (const q of geo.solids) c.fillRect(q.x - 0.5, q.y, q.w + 1, q.h);
  c.fillStyle = '#00000022'; for (let y = 0; y < geo.Hc; y++) for (let x = 0; x < geo.Wc; x++) if (geo.grid[y * geo.Wc + x] === 1 && (x * 7 + y * 13) % 5 === 0) rr(c, x * CELL + 8, y * CELL + 12, 14, 8, 4), c.fill();
  for (let y = 0; y < geo.Hc; y++) for (let x = 0; x < geo.Wc; x++) if (geo.grid[y * geo.Wc + x] === 1 && !(y > 0 && geo.grid[(y - 1) * geo.Wc + x] === 1)) { c.fillStyle = th.top; c.fillRect(x * CELL - 0.5, y * CELL - 2, CELL + 1, 11); c.fillStyle = '#ffffff44'; c.fillRect(x * CELL - 0.5, y * CELL - 2, CELL + 1, 3); }
  // pickups
  for (const k of G.pks) {
    const d = WEAPONS[k.w], sc = Math.min(1, k.age / 0.4), by = k.y + Math.sin(R.t * 4 + k.id) * 3 - (1 - sc) * 60;
    c.globalAlpha = sc * 0.35; c.fillStyle = TIERCOL[d.t]; c.beginPath(); c.arc(k.x, by, 19 + Math.sin(R.t * 6 + k.id) * 2, 0, TAU); c.fill(); c.globalAlpha = sc;
    c.strokeStyle = TIERCOL[d.t]; c.lineWidth = 2.5; c.beginPath(); c.arc(k.x, by, 16, R.t * 2 + k.id, R.t * 2 + k.id + 4.6); c.stroke();
    c.save(); c.translate(k.x - 9, by + 4); c.rotate(-0.5); c.scale(0.72, 0.72); drawWeapon(c, d); c.restore(); c.globalAlpha = 1;
  }
  for (const pr of G.prs) {
    drawProj(c, pr, now); const d = WEAPONS[pr.w];
    if ((d.shape === 'rocket' || d.shape === 'rock') && Math.random() < 0.8) part(pr.x - pr.vx * 0.012, pr.y - pr.vy * 0.012, rnd(-30, 30), rnd(-30, 30), 0.35, Math.random() < 0.5 ? '#ffb347' : '#8a8690', 6, -40);
  }
  // players
  for (const p of G.pl) {
    const r = R.pl[p.id];
    if (r.x === undefined || Math.abs(p.x - r.x) > 120 || Math.abs(p.y - r.y) > 120 || G.host) { r.x = p.x; r.y = p.y; } else { r.x += (p.x - r.x) * Math.min(1, dt * 25); r.y += (p.y - r.y) * Math.min(1, dt * 25); }
    const sp = Math.abs(p.vx); r.mv = p.onG ? Math.min(1, sp / 120) : 0; r.run = (r.run || 0) + dt * (6 + sp * 0.05) * (r.mv > 0.05 ? 1 : 0); if (r.mv < 0.05) r.run *= 0.8;
    r.kick = Math.max(0, (r.kick || 0) - dt * 9); r.swing = Math.max(0, (r.swing || 0) - dt * 5.5);
    if (p.onG && !r.wasG) r.squash = 1; r.wasG = p.onG; r.squash = Math.max(0, (r.squash || 0) - dt * 7);
    const st = p.onG ? 0 : clamp(Math.abs(p.vy) / 2600, 0, 0.22);
    r.sx = 1 + r.squash * 0.22 - st; r.sy = 1 - r.squash * 0.2 + st;
    if (!p.alive) continue;
    drawPlayer(c, p, r, now);
    if (G.ph === 'count' && p.id === ME && mode !== 'watch') { const ay = r.y - 62 + Math.sin(R.t * 8) * 4; c.fillStyle = '#fff'; c.strokeStyle = INK; c.lineWidth = 2; c.beginPath(); c.moveTo(r.x - 9, ay); c.lineTo(r.x + 9, ay); c.lineTo(r.x, ay + 12); c.closePath(); c.fill(); c.stroke(); c.font = '900 13px system-ui'; c.textAlign = 'center'; c.lineWidth = 3; c.strokeText('YOU', r.x, ay - 5); c.fillText('YOU', r.x, ay - 5); }
  }
  for (let i = R.rags.length - 1; i >= 0; i--) { // defeated dinos tumble away
    const q = R.rags[i]; q.t += dt; q.vy += GRAV * 0.8 * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.rot += q.vr * dt;
    if (q.t > 2.2) { R.rags.splice(i, 1); continue; }
    c.save(); c.translate(q.x, q.y); c.rotate(q.rot); c.translate(0, PH / 2); c.globalAlpha = Math.min(1, (2.2 - q.t) * 2);
    drawDino(c, q.kind, COLORS[q.id], { run: 0, mv: 0, air: true, vy: 0, t: R.t, blink: true }); c.restore(); c.globalAlpha = 1;
  }
  for (let i = R.parts.length - 1; i >= 0; i--) {
    const q = R.parts[i]; q.life -= dt; if (q.life <= 0) { R.parts.splice(i, 1); continue; }
    const k = q.life / q.max; q.vy += q.grav * dt; q.x += q.vx * dt; q.y += q.vy * dt;
    if (q.kind === 1) { c.globalAlpha = k; c.strokeStyle = q.col; c.lineWidth = 3; c.beginPath(); c.ellipse(q.x, q.y, q.size + (1 - k) * 22, (q.size + (1 - k) * 22) * 0.4, 0, 0, TAU); c.stroke(); }
    else if (q.kind === 2) { c.globalAlpha = k; c.fillStyle = q.col; c.beginPath(); for (let j = 0; j < 8; j++) { const a = j / 8 * TAU, rad = j % 2 ? q.size * 1.6 : q.size * 0.6; c.lineTo(q.x + Math.cos(a) * rad, q.y + Math.sin(a) * rad); } c.fill(); }
    else if (q.kind === 3) { c.globalAlpha = k * 0.8; c.fillStyle = q.col; c.beginPath(); c.arc(q.x, q.y, q.size * (1.05 - k * 0.5), 0, TAU); c.fill(); c.globalAlpha = k; c.strokeStyle = '#fff'; c.lineWidth = 4; c.beginPath(); c.arc(q.x, q.y, q.size * (1.1 - k * 0.3), 0, TAU); c.stroke(); }
    else { c.globalAlpha = Math.min(1, k * 1.5); c.fillStyle = q.col; c.beginPath(); c.arc(q.x, q.y, q.size * (0.4 + k * 0.6), 0, TAU); c.fill(); }
  }
  c.globalAlpha = 1;
  for (let i = R.pops.length - 1; i >= 0; i--) { const q = R.pops[i]; q.t += dt; if (q.t > 0.9) { R.pops.splice(i, 1); continue; } c.globalAlpha = Math.min(1, (0.9 - q.t) * 3); c.font = '900 15px system-ui'; c.textAlign = 'center'; c.lineWidth = 4; c.strokeStyle = INK; c.strokeText(q.txt, q.x, q.y - q.t * 40); c.fillStyle = q.col; c.fillText(q.txt, q.x, q.y - q.t * 40); }
  c.globalAlpha = 1;
  if (G.rz > 0) { // sudden-death razors
    const e = razorEdges();
    for (const [y0, y1, edge] of [[-2000, e.top, e.top], [e.bot, geo.ph + 2000, e.bot]]) {
      c.fillStyle = '#5a0f18cc'; c.fillRect(-2000, y0, geo.pw + 4000, y1 - y0);
      for (let x = -40 - ((R.t * 30) % 46); x < geo.pw + 80; x += 46) drawSaw(c, x, edge, 24, R.t * 9 * (edge === e.top ? 1 : -1) + x);
    }
  }
  // overlay text
  c.setTransform(DPR, 0, 0, DPR, 0, 0); c.textAlign = 'center'; c.textBaseline = 'middle';
  const big = (txt, size, col, alpha, yy) => { c.globalAlpha = alpha; c.font = '900 ' + size + 'px system-ui'; c.lineWidth = size * 0.14; c.strokeStyle = INK; c.lineJoin = 'round'; c.strokeText(txt, VW / 2, yy || VH * 0.42); c.fillStyle = col; c.fillText(txt, VW / 2, yy || VH * 0.42); c.globalAlpha = 1; };
  const base = Math.min(VW, VH * 1.6) * 0.2;
  if (G.ph === 'count') { const n = Math.ceil(G.pt), f = G.pt - Math.floor(G.pt); if (n >= 1) big(String(Math.min(3, n)), base * (0.9 + f * 0.7), '#fff', Math.min(1, f * 3 + 0.25)); c.font = '800 ' + Math.max(13, base * 0.16) + 'px system-ui'; c.fillStyle = '#fff'; c.strokeStyle = INK; c.lineWidth = 4; const lbl = MAPS[G.mapI].n + '  ·  Round ' + G.round; c.strokeText(lbl, VW / 2, VH * 0.42 + base * 0.8); c.fillText(lbl, VW / 2, VH * 0.42 + base * 0.8); }
  else if (G.ph === 'play' && G.time < 0.7) big('GO!', base * (1 + G.time * 0.8), '#ffe04a', 1 - G.time / 0.7);
  if (G.ph === 'play' && G.time >= SUDDEN_AT && G.time < SUDDEN_AT + 2.2 && (now / 180 | 0) % 2) big('SUDDEN DEATH', base * 0.5, '#ff5a5a', 1);
  if (R.banner && (G.ph === 'end' || G.ph === 'over')) { R.banner.t += dt; const b = R.banner, k = Math.min(1, b.t * 6); big(b.res < 0 ? 'TIE!' : COLORS[b.res].name + ' SCORES!', base * 0.55 * (0.6 + k * 0.4), b.res < 0 ? '#fff' : COLORS[b.res].main, k); if (b.res < 0) { c.font = '800 ' + base * 0.14 + 'px system-ui'; c.fillStyle = '#fff'; c.fillText('no points', VW / 2, VH * 0.42 + base * 0.42); } }
  if (R.flash > 0) { R.flash -= dt; c.fillStyle = 'rgba(255,255,255,' + Math.max(0, R.flash * 3) + ')'; c.fillRect(0, 0, VW, VH); }
}
function updateHud() {
  const wl = i => { const p = G.pl[i]; return p.w >= 0 ? WEAPONS[p.w].n + (WEAPONS[p.w].k === 'g' ? ' ×' + p.am : '') : ''; };
  const t = G.ph === 'count' ? 0 : Math.floor(G.time), key = G.sc.join() + wl(0) + '|' + wl(1) + t;
  if (key === R.hud) return; R.hud = key;
  $('s0').textContent = G.sc[0]; $('s1').textContent = G.sc[1]; $('w0').textContent = wl(0); $('w1').textContent = wl(1);
  $('timer').textContent = t; $('timer').classList.toggle('hot', t >= SUDDEN_AT - 5);
}
function readInput() {
  let mx = touch.mx; if (keys.a || keys.arrowleft) mx -= 1; if (keys.d || keys.arrowright) mx += 1;
  input.mx = clamp(mx, -1, 1); input.a = touch.a || !!(keys.j || keys.f || keys.enter || keys.k || keys.x);
}
function jumpPress() { input.jc = (input.jc + 1) & 1023; }
let lastT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  if (!running || !G || !G.geo) return;
  R.t += dt; readInput();
  if (G.host) {
    R.acc = Math.min(R.acc + dt, 0.1);
    while (R.acc >= DT) {
      R.acc -= DT; if (mode !== 'watch') { const i = G.inp[ME]; i.mx = input.mx; i.jc = input.jc; i.a = input.a; }
      tick(); R.tickN++;
      if (G.fx.length) { for (const f of G.fx) { handleFx(f); if (mode === 'host') Net.fxBuf.push(f); } G.fx.length = 0; }
      if (mode === 'host' && R.tickN % 2 === 0) netSend();
    }
  } else { // client: dead-reckon between snapshots, send input
    if (G.ph === 'play' || G.ph === 'end') { for (const p of G.pl) if (p.alive) { p.x += p.vx * dt; if (!p.onG) p.y += p.vy * dt; } for (const pr of G.prs) if (pr.st !== 1) { pr.vy += WEAPONS[pr.w].grav * dt; pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.t += dt; } }
    const k = input.mx + '|' + input.jc + '|' + input.a; if (k !== R.sent || now - R.sentT > 80) { R.sent = k; R.sentT = now; netInput(input); }
  }
  render(now, dt); updateHud();
  if (G.ph === 'over' && $('end').classList.contains('hidden') && !R.endShown) { R.endShown = true; setTimeout(showEnd, 900); }
  if (G.ph !== 'over' && R.endShown) { R.endShown = false; $('end').classList.add('hidden'); }
}

// ----- screens -----
function startGame(me, m) {
  ME = me; mode = m; running = true; R.parts.length = R.rags.length = R.pops.length = 0; R.banner = null; R.acc = 0; R.endShown = false; R.pl = [{}, {}];
  for (const id of ['menu', 'lobby', 'end']) $(id).classList.add('hidden');
  $('hud').classList.remove('hidden'); document.body.classList.add('playing'); $('touch').classList.toggle('hidden', !touchOn);
}
function showEnd() {
  if (!G || G.ph !== 'over') return; const w = G.sc[0] > G.sc[1] ? 0 : 1, youWin = w === ME;
  $('endTitle').textContent = mode === 'watch' ? COLORS[w].name + ' WINS' : youWin ? 'YOU WIN!' : 'YOU LOSE'; $('endTitle').style.color = COLORS[w].main;
  $('endText').textContent = COLORS[w].name + ' takes the match ' + G.sc[w] + ' to ' + G.sc[1 - w] + '.';
  $('bRematch').classList.toggle('hidden', mode === 'client'); $('end').classList.remove('hidden');
}
function toMenu(msg) {
  running = false; netClose(); G = null; document.body.classList.remove('playing');
  for (const id of ['hud', 'touch', 'lobby', 'end']) $(id).classList.add('hidden'); $('menu').classList.remove('hidden'); $('menuErr').textContent = msg || '';
}
function netLost(msg) { if (running || !$('lobby').classList.contains('hidden')) toMenu(msg); }
let touchOn = false;
function initUI() {
  touchOn = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return; const k = e.key === ' ' ? 'space' : e.key.toLowerCase();
    if (!keys[k] && (k === 'w' || k === 'arrowup' || k === 'space')) jumpPress();
    keys[k] = true; if (running && ['space', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
  });
  window.addEventListener('keyup', e => { keys[e.key === ' ' ? 'space' : e.key.toLowerCase()] = false; });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; touch.mx = 0; touch.a = false; });
  const mv = $('tMove'), setMv = e => { const r = mv.getBoundingClientRect(), x = (e.clientX - r.left) / r.width; touch.mx = x < 0.5 ? -1 : 1; mv.className = touch.mx < 0 ? 'l' : 'r'; e.preventDefault(); };
  const endMv = e => { touch.mx = 0; mv.className = ''; };
  mv.addEventListener('pointerdown', e => { mv.setPointerCapture(e.pointerId); setMv(e); }); mv.addEventListener('pointermove', e => { if (e.buttons || e.pointerType === 'touch') { if (mv.hasPointerCapture(e.pointerId)) setMv(e); } });
  mv.addEventListener('pointerup', endMv); mv.addEventListener('pointercancel', endMv);
  const hold = (el, down, up) => { el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); el.classList.add('on'); down(); e.preventDefault(); }); const u = () => { el.classList.remove('on'); up && up(); }; el.addEventListener('pointerup', u); el.addEventListener('pointercancel', u); };
  hold($('tJ'), jumpPress); hold($('tA'), () => { touch.a = true; }, () => { touch.a = false; });
  document.addEventListener('contextmenu', e => { if (running) e.preventDefault(); });
  for (const b of document.querySelectorAll('[data-bot]')) b.onclick = () => { botDiff = b.dataset.bot; netClose(); newMatch({ bots: [null, botDiff] }); startGame(0, 'bot'); };
  const err = t => { $('menuErr').textContent = t || ''; };
  Net.onError = t => { if (running) return; $('lobby').classList.add('hidden'); $('menu').classList.remove('hidden'); err(t); };
  Net.onOpen = code => { $('lCode').textContent = code; };
  $('bHost').onclick = () => { err(''); $('lCode').textContent = '…'; $('menu').classList.add('hidden'); $('lobby').classList.remove('hidden'); netHost().catch(e => Net.onError(e.message)); };
  $('bJoin').onclick = () => { const c = $('iCode').value.trim().toUpperCase(); if (c.length !== 5) return err('Enter the 5-letter room code.'); err('Connecting…'); netJoin(c).catch(e => err(e.message)); };
  $('lBack').onclick = $('bMenu').onclick = $('quit').onclick = () => toMenu('');
  $('bRematch').onclick = () => { $('end').classList.add('hidden'); R.endShown = false; R.banner = null; if (mode === 'bot') newMatch({ bots: [null, botDiff] }); else if (mode === 'host') newMatch({ bots: [null, null] }); };
}
function resize() { DPR = Math.min(2, window.devicePixelRatio || 1); VW = window.innerWidth; VH = window.innerHeight; cv.width = VW * DPR; cv.height = VH * DPR; }
window.addEventListener('load', () => { cv = $('c'); ctx = cv.getContext('2d'); resize(); window.addEventListener('resize', resize); initUI(); requestAnimationFrame(frame); });
