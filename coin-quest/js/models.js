// 3D-modelled pixel-art monsters.
//
// Each monster is a small 3D model made of signed-distance shapes (spheres, ellipsoids, capsules, cones,
// boxes, cylinders), blended smoothly where they meet. A tiny ray marcher renders it at low resolution and
// turns the lighting into pixel art: 4-tone colour ramps per material, ordered dithering between tones,
// a dark outline, and a dithered ground shadow. Because they're real models they can turn (yaw) and
// breathe/flap over time. Pure functions: rendering returns an RGBA buffer, so it runs in the browser and
// in Node (for tests and previews).

// ---------- palettes ----------

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const ramp = (...cols) => cols.map(hex); // [shadow, base, light, highlight]

const TEMPER_RAMPS = {
  calm: {
    body: ramp('#1f5a3a', '#3f9a52', '#7fd06a', '#c8f59a'),
    belly: ramp('#4f7a3a', '#8fb860', '#c8e090', '#f0ffd0'),
    wing: ramp('#123424', '#24603a', '#3f8a4a', '#7fc060'),
    glow: ramp('#a88a20', '#ffd040', '#ffe680', '#fffad0'),
  },
  angry: {
    body: ramp('#6a300c', '#c0681c', '#f0a040', '#ffe08a'),
    belly: ramp('#9a5a24', '#e0a050', '#f5cc80', '#fff0c0'),
    wing: ramp('#4a2006', '#7a3e10', '#b06a24', '#e0a040'),
    glow: ramp('#a85a10', '#ffa030', '#ffcc60', '#fff0c0'),
  },
  furious: {
    body: ramp('#4e101a', '#a8262e', '#e0544a', '#ffa08a'),
    belly: ramp('#7a2a28', '#c86450', '#eea088', '#ffd8c8'),
    wing: ramp('#300810', '#681620', '#a02a2c', '#e0544a'),
    glow: ramp('#a01818', '#ff3030', '#ff8060', '#ffe0d0'),
  },
};

const FIXED = {
  eye: ramp('#a8b0c0', '#e8ecf4', '#ffffff', '#ffffff'),
  eyeY: ramp('#a88a20', '#f0c840', '#ffe680', '#fffad0'),
  pupil: ramp('#0a060c', '#140a14', '#2a1a2a', '#c8c8d8'),
  dark: ramp('#14060c', '#2a0e16', '#3e1620', '#5a2430'),
  horn: ramp('#7a6a50', '#c8b890', '#ece0c0', '#ffffff'),
  tooth: ramp('#a8a090', '#e8e0d0', '#ffffff', '#ffffff'),
  wood: ramp('#3a2210', '#6b4220', '#9a6a38', '#c8945a'),
  cloth: ramp('#3a2a1a', '#6a4e30', '#8e6c44', '#b8946a'),
  stone: ramp('#3a3a4a', '#6a6a80', '#9a9ab0', '#c8c8dc'),
  roof: ramp('#3a1420', '#6a2434', '#943448', '#c05868'),
  metal: ramp('#24242c', '#4a4c58', '#7a7e8c', '#c0c4d0'),
  fire: ramp('#c83010', '#ff7a1a', '#ffc040', '#fff4a0'),
  wound: ramp('#2a060c', '#5e1018', '#8a2224', '#b84a3a'),
  rubble: ramp('#1a1420', '#2e2636', '#4a4054', '#6a6074'),
};

const OUTLINE = [20, 10, 20];
const EMISSIVE = new Set(['glow', 'fire']);
const GLOSSY = new Set(['eye', 'eyeY', 'pupil', 'horn', 'tooth', 'metal']);

// ---------- SDF primitives (p is x,y,z) ----------

const len3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function sdSphere(x, y, z, c, r) {
  return len3(x - c[0], y - c[1], z - c[2]) - r;
}
function sdEllipsoid(x, y, z, c, r) {
  const px = (x - c[0]) / r[0], py = (y - c[1]) / r[1], pz = (z - c[2]) / r[2];
  const k0 = len3(px, py, pz);
  const k1 = len3(px / r[0], py / r[1], pz / r[2]);
  return k1 === 0 ? -Math.min(r[0], r[1], r[2]) : (k0 * (k0 - 1)) / k1;
}
// Capsule from a to b whose radius goes from r1 to r2 (a rounded cone when they differ).
function sdCone(x, y, z, a, b, r1, r2) {
  const pax = x - a[0], pay = y - a[1], paz = z - a[2];
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const h = clamp((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz), 0, 1);
  return len3(pax - bax * h, pay - bay * h, paz - baz * h) - (r1 + (r2 - r1) * h);
}
function sdBox(x, y, z, c, hs, rad = 0) {
  const qx = Math.abs(x - c[0]) - hs[0], qy = Math.abs(y - c[1]) - hs[1], qz = Math.abs(z - c[2]) - hs[2];
  return len3(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - rad;
}
function sdCylinder(x, y, z, c, r, hh) {
  const dx = Math.hypot(x - c[0], z - c[2]) - r, dy = Math.abs(y - c[1]) - hh;
  return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
}
function smin(a, b, k) {
  if (k <= 0) return Math.min(a, b);
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
  return b + (a - b) * h - k * h * (1 - h);
}

// ---------- models ----------
// Parts: { s: shape, ...shape params, m: material, k: blend radius with what's drawn so far,
//          sym: mirror across x (give the +x side), flap: [pivot, amount] wings that rotate around z }.
// Units: the ground is y = 0, the model faces +z (toward the viewer).

const sph = (c, r, m, o = {}) => ({ s: 'sph', c, r, m, ...o });
const ell = (c, r, m, o = {}) => ({ s: 'ell', c, r, m, ...o });
const cone = (a, b, r1, r2, m, o = {}) => ({ s: 'cone', a, b, r1, r2, m, ...o });
const box = (c, h, m, o = {}) => ({ s: 'box', c, h, rad: o.rad || 0.02, m, ...o });
const cyl = (c, r, hh, m, o = {}) => ({ s: 'cyl', c, r, hh, m, ...o });

/** Scale every position and size in a list of parts (used to make the slime small). */
function scaleParts(parts, k) {
  const v = (a) => a && a.map((n) => n * k);
  return parts.map((p) => ({
    ...p, c: v(p.c), a: v(p.a), b: v(p.b), h: v(p.h), r: Array.isArray(p.r) ? v(p.r) : p.r && p.r * k,
    r1: p.r1 && p.r1 * k, r2: p.r2 && p.r2 * k, hh: p.hh && p.hh * k, rad: p.rad && p.rad * k, k: p.k && p.k * k,
    flap: p.flap && [v(p.flap[0]), p.flap[1]],
  }));
}

/**
 * Battle damage: a chunk carved out once the debt is `at` (0-1) paid off. `side` limits a mirrored part to
 * one side (1 = right, -1 = left) so a wing can be torn on one side only.
 */
const bite = (c, r, at, o = {}) => ({ s: 'sph', c, r, m: 'wound', sub: true, at, ...o });

function slime() {
  // The weakest monster: small, round and soft.
  const parts = scaleParts([
      bite([-0.5, 0.92, 0.38], 0.2, 0.4),
      bite([0.66, 0.42, 0.42], 0.18, 0.65),
      bite([0.12, 1.24, 0.12], 0.22, 0.85),
      ell([0, 0.5, 0], [0.86, 0.55, 0.76], 'body'),
      sph([0, 0.88, -0.02], 0.44, 'body', { k: 0.35 }),
      sph([0.72, 0.13, 0.28], 0.17, 'body', { k: 0.2, sym: true }),
      sph([0.3, 0.1, 0.62], 0.13, 'body', { k: 0.18, sym: true }),
      ell([0.27, 0.74, 0.56], [0.15, 0.19, 0.1], 'eye', { sym: true }),
      sph([0.25, 0.71, 0.66], 0.075, 'pupil', { sym: true }),
      ell([0, 0.42, 0.69], [0.24, 0.07, 0.06], 'dark'),
      box([0.11, 0.46, 0.7], [0.03, 0.03, 0.02], 'tooth', { sym: true, rad: 0.01 }),
  ], 0.6);
  // bites go last so they carve the finished body
  parts.push(...parts.splice(0, 3));
  return { height: 0.81, head: 0.45, anim: 'squish', portrait: 'full', shadow: [0.54, 0.34], parts };
}

function goblin() {
  return {
    height: 1.75, head: 1.32, anim: 'breathe', shadow: [0.5, 0.3],
    parts: [
      // legs planted wide with flat feet so it stands on the ground
      cone([0.2, 0.06, 0.02], [0.17, 0.5, 0], 0.12, 0.1, 'body', { sym: true }),
      ell([0.22, 0.045, 0.1], [0.17, 0.055, 0.22], 'body', { sym: true }),
      ell([0, 0.84, 0], [0.33, 0.31, 0.25], 'body'),
      ell([0, 0.8, 0.13], [0.22, 0.2, 0.14], 'belly', { k: 0.05 }),
      cone([0, 0.66, 0.02], [0, 0.46, 0.06], 0.3, 0.2, 'cloth'),
      cone([0.3, 1.02, 0], [0.5, 0.64, 0.12], 0.1, 0.085, 'body', { sym: true, k: 0.06 }),
      sph([0.52, 0.57, 0.15], 0.1, 'body', { sym: true }),
      cone([0.56, 0.48, 0.22], [0.74, 1.12, 0.16], 0.06, 0.08, 'wood'),
      sph([0.76, 1.18, 0.16], 0.15, 'wood', { k: 0.05 }),
      sph([0, 1.33, 0.03], 0.33, 'body', { k: 0.08 }),
      cone([0.27, 1.38, 0], [0.74, 1.58, -0.06], 0.1, 0.015, 'body', { sym: true, k: 0.05 }),
      cone([0, 1.31, 0.3], [0, 1.22, 0.46], 0.08, 0.035, 'body', { k: 0.03 }),
      ell([0.13, 1.41, 0.26], [0.09, 0.07, 0.06], 'eyeY', { sym: true }),
      sph([0.13, 1.4, 0.315], 0.04, 'pupil', { sym: true }),
      ell([0, 1.15, 0.27], [0.16, 0.045, 0.05], 'dark'),
      box([0.07, 1.175, 0.305], [0.025, 0.03, 0.02], 'tooth', { sym: true, rad: 0.008 }),
      bite([0.64, 1.56, -0.04], 0.12, 0.4),
      bite([-0.26, 0.92, 0.22], 0.11, 0.65),
      bite([0.86, 1.28, 0.2], 0.1, 0.85),
    ],
  };
}

function troll() {
  return {
    height: 2.05, head: 1.62, anim: 'breathe', shadow: [0.85, 0.45],
    parts: [
      cone([0.3, 0.02, 0], [0.3, 0.6, 0], 0.21, 0.19, 'body', { sym: true }),
      ell([0.33, 0.08, 0.13], [0.22, 0.1, 0.26], 'body', { sym: true }),
      ell([0, 1.05, 0], [0.66, 0.56, 0.45], 'body'),
      ell([0, 0.95, 0.22], [0.42, 0.38, 0.26], 'belly', { k: 0.08 }),
      cone([0, 0.72, 0.05], [0, 0.5, 0.1], 0.5, 0.34, 'cloth'),
      sph([0.6, 1.36, 0], 0.3, 'body', { sym: true, k: 0.15 }),
      cone([0.7, 1.3, 0], [0.86, 0.56, 0.15], 0.2, 0.17, 'body', { sym: true, k: 0.1 }),
      sph([0.88, 0.46, 0.18], 0.22, 'body', { sym: true, k: 0.05 }),
      ell([0, 1.62, 0.2], [0.3, 0.27, 0.28], 'body', { k: 0.12 }),
      ell([0, 1.73, 0.4], [0.28, 0.07, 0.08], 'body', { k: 0.04 }),
      sph([0.11, 1.645, 0.44], 0.058, 'glow', { sym: true }),
      cone([0.12, 1.5, 0.42], [0.18, 1.69, 0.52], 0.05, 0.014, 'horn', { sym: true }),
      cone([0.22, 1.8, 0.14], [0.47, 2.04, -0.02], 0.09, 0.02, 'horn', { sym: true }),
      ell([0, 1.5, 0.44], [0.14, 0.04, 0.04], 'dark'),
      bite([0.44, 2.0, 0], 0.11, 0.4),
      bite([-0.72, 1.5, 0.16], 0.18, 0.65),
      bite([0.22, 1.1, 0.44], 0.14, 0.85),
    ],
  };
}

/** Young dragon (scale 1) and elder dragon (bigger, more horns and spikes, fire in its jaws). */
function wing(v, s) {
  const piv = v(0.3, 1.02, -0.22);
  const f = { sym: true, flap: [piv, 0.22] };
  return [
    ell(v(0.86, 1.3, -0.27), v(0.62, 0.46, 0.035), 'wing', f),
    sph(v(0.56, 0.82, -0.27), 0.24 * s, 'wing', { ...f, sub: true }),
    sph(v(0.98, 0.86, -0.27), 0.22 * s, 'wing', { ...f, sub: true }),
    sph(v(1.38, 1.02, -0.27), 0.2 * s, 'wing', { ...f, sub: true }),
    cone(piv, v(0.98, 1.72, -0.29), 0.055 * s, 0.035 * s, 'body', f),
    cone(v(0.98, 1.72, -0.29), v(1.5, 1.38, -0.3), 0.035 * s, 0.012, 'body', f),
    cone(v(0.98, 1.72, -0.29), v(1.12, 1.06, -0.29), 0.03 * s, 0.01, 'body', f),
    cone(v(0.98, 1.72, -0.29), v(0.74, 1.0, -0.28), 0.03 * s, 0.01, 'body', f),
    cone(v(0.98, 1.72, -0.29), v(1.06, 1.9, -0.3), 0.04 * s, 0.01, 'horn', f),
  ];
}

function dragon(elder) {
  const s = elder ? 1.12 : 1;
  const v = (x, y, z) => [x * s, y * s, z * s];
  const parts = [
    ell(v(0.36, 0.36, -0.1), v(0.3, 0.32, 0.38), 'body', { sym: true }),
    ell(v(0, 0.76, 0), v(0.5, 0.5, 0.45), 'body', { k: 0.1 }),
    ell(v(0, 0.74, 0.25), v(0.32, 0.42, 0.25), 'belly', { k: 0.06 }),
    cone(v(0.28, 0.62, 0.2), v(0.3, 0.08, 0.36), 0.11 * s, 0.1 * s, 'body', { sym: true, k: 0.05 }),
    ell(v(0.3, 0.06, 0.44), v(0.13, 0.06, 0.12), 'body', { sym: true }),
    cone(v(0.26, 0.05, 0.54), v(0.27, 0.03, 0.62), 0.03 * s, 0.01, 'horn', { sym: true }),
    cone(v(0, 1.0, 0.05), v(0, 1.46, 0.15), 0.2 * s, 0.16 * s, 'body', { k: 0.12 }),
    ell(v(0, 1.62, 0.22), v(0.28, 0.24, 0.3), 'body', { k: 0.1 }),
    ell(v(0, 1.53, 0.48), v(0.17, 0.13, 0.21), 'body', { k: 0.08 }),
    sph(v(0.06, 1.59, 0.66), 0.026 * s, 'dark', { sym: true }),
    ell(v(0.15, 1.69, 0.36), v(0.07, 0.06, 0.05), elder ? 'glow' : 'eyeY', { sym: true }),
    ell(v(0.15, 1.69, 0.405), v(0.02, 0.05, 0.02), 'pupil', { sym: true }),
    cone(v(0.14, 1.79, 0.1), v(0.32, 2.06, -0.22), 0.06 * s, 0.014, 'horn', { sym: true }),
    // wings: a membrane with a scalloped trailing edge and three finger bones, flapping at the shoulder
    ...wing(v, s),
    cone(v(0, 0.24, -0.42), v(0.62, 0.1, -0.2), 0.11 * s, 0.08 * s, 'body', { k: 0.06 }),
    cone(v(0.62, 0.1, -0.2), v(0.92, 0.2, 0.12), 0.08 * s, 0.02, 'body'),
  ];
  if (elder) {
    parts.push(
      // a crown of horns, cheek spikes and a ridge of spikes down the back
      cone(v(0.22, 1.74, 0.06), v(0.56, 1.86, -0.12), 0.06 * s, 0.012, 'horn', { sym: true }),
      cone(v(0.08, 1.84, 0.12), v(0.12, 2.12, 0.02), 0.045 * s, 0.01, 'horn', { sym: true }),
      cone(v(0.24, 1.55, 0.3), v(0.4, 1.5, 0.36), 0.04 * s, 0.01, 'horn', { sym: true }),
      cone(v(0.15, 1.44, 0.5), v(0.2, 1.33, 0.58), 0.035 * s, 0.01, 'horn', { sym: true }),
      cone(v(0, 1.36, -0.02), v(0, 1.5, -0.24), 0.06 * s, 0.01, 'horn'),
      cone(v(0, 1.12, -0.12), v(0, 1.26, -0.38), 0.06 * s, 0.01, 'horn'),
      cone(v(0, 0.88, -0.3), v(0, 1.0, -0.56), 0.06 * s, 0.01, 'horn'),
      ell(v(0, 1.46, 0.6), v(0.12, 0.05, 0.1), 'dark'),
      sph(v(0, 1.45, 0.68), 0.06 * s, 'fire'),
      box(v(0.07, 1.49, 0.66), v(0.02, 0.03, 0.02), 'tooth', { sym: true, rad: 0.006 }),
    );
  } else {
    parts.push(ell(v(0, 1.47, 0.6), v(0.11, 0.03, 0.08), 'dark'));
  }
  const wf = { sym: true, flap: [v(0.3, 1.02, -0.22), 0.22] };
  parts.push(
    bite(v(0.95, 1.3, -0.27), 0.13, 0.4, { ...wf, side: 1 }),
    bite(v(0.7, 1.45, -0.27), 0.12, 0.65, { ...wf, side: -1 }),
    bite(v(0.18, 1.42, 0.22), 0.12, 0.85),
  );
  return { height: (elder ? 2.3 : 2.06), head: 1.62 * s, anim: 'flap', plates: true, shadow: [0.85, 0.55], parts };
}

/** The elder dragon hovers in the air, wings spread high, looking down at you with fire in its jaws. */
function flyingDragon() {
  const piv = [0.32, 2.08, -0.2];
  const f = { sym: true, flap: [piv, 0.34] };
  const parts = [
    // body held upright in the air
    ell([0, 1.78, 0], [0.42, 0.56, 0.36], 'body'),
    ell([0, 1.72, 0.2], [0.28, 0.46, 0.2], 'belly', { k: 0.05 }),
    cone([0, 2.16, 0.04], [0, 2.46, 0.2], 0.2, 0.16, 'body', { k: 0.1 }),
    ell([0, 2.6, 0.28], [0.27, 0.23, 0.3], 'body', { k: 0.1 }),
    ell([0, 2.52, 0.55], [0.17, 0.12, 0.21], 'body', { k: 0.07 }),
    ell([0, 2.38, 0.5], [0.15, 0.055, 0.19], 'body', { k: 0.03 }), // open lower jaw
    ell([0, 2.45, 0.6], [0.12, 0.05, 0.12], 'dark'),
    sph([0, 2.44, 0.7], 0.075, 'fire'),
    box([0.07, 2.49, 0.68], [0.02, 0.03, 0.02], 'tooth', { sym: true, rad: 0.006 }),
    sph([0.06, 2.57, 0.74], 0.024, 'dark', { sym: true }),
    ell([0.14, 2.67, 0.44], [0.07, 0.05, 0.05], 'glow', { sym: true }),
    ell([0.14, 2.67, 0.485], [0.02, 0.045, 0.02], 'pupil', { sym: true }),
    // crown of horns
    cone([0.14, 2.78, 0.16], [0.34, 3.08, -0.16], 0.065, 0.014, 'horn', { sym: true }),
    cone([0.22, 2.72, 0.1], [0.58, 2.84, -0.1], 0.06, 0.012, 'horn', { sym: true }),
    cone([0.07, 2.82, 0.18], [0.12, 3.12, 0.08], 0.045, 0.01, 'horn', { sym: true }),
    cone([0.22, 2.52, 0.32], [0.4, 2.46, 0.38], 0.04, 0.01, 'horn', { sym: true }),
    // arms reaching forward with claws
    cone([0.3, 2.0, 0.1], [0.44, 1.62, 0.44], 0.09, 0.07, 'body', { sym: true, k: 0.05 }),
    sph([0.45, 1.56, 0.5], 0.08, 'body', { sym: true }),
    cone([0.45, 1.52, 0.54], [0.47, 1.4, 0.6], 0.025, 0.006, 'horn', { sym: true }),
    // hind legs and talons dangling below
    cone([0.24, 1.36, 0], [0.3, 0.92, 0.12], 0.15, 0.1, 'body', { sym: true, k: 0.06 }),
    ell([0.31, 0.84, 0.18], [0.1, 0.06, 0.14], 'body', { sym: true }),
    cone([0.31, 0.82, 0.28], [0.33, 0.72, 0.34], 0.03, 0.006, 'horn', { sym: true }),
    // tail hanging and curling
    cone([0, 1.28, -0.24], [0.26, 0.7, -0.36], 0.13, 0.08, 'body', { k: 0.06 }),
    cone([0.26, 0.7, -0.36], [-0.08, 0.38, -0.2], 0.08, 0.02, 'body'),
    // spikes down the back
    cone([0, 2.3, -0.06], [0, 2.42, -0.3], 0.06, 0.01, 'horn'),
    cone([0, 2.06, -0.24], [0, 2.18, -0.5], 0.06, 0.01, 'horn'),
    cone([0, 1.8, -0.32], [0, 1.9, -0.58], 0.06, 0.01, 'horn'),
    // huge wings spread high, scalloped along the bottom
    ell([1.2, 2.42, -0.28], [0.95, 0.62, 0.04], 'wing', f),
    sph([0.72, 1.78, -0.28], 0.32, 'wing', { ...f, sub: true }),
    sph([1.3, 1.82, -0.28], 0.3, 'wing', { ...f, sub: true }),
    sph([1.9, 2.06, -0.28], 0.28, 'wing', { ...f, sub: true }),
    cone(piv, [1.24, 3.05, -0.3], 0.07, 0.045, 'body', f),
    cone([1.24, 3.05, -0.3], [2.12, 2.34, -0.31], 0.045, 0.012, 'body', f),
    cone([1.24, 3.05, -0.3], [1.6, 1.84, -0.3], 0.04, 0.012, 'body', f),
    cone([1.24, 3.05, -0.3], [1.0, 1.76, -0.29], 0.04, 0.012, 'body', f),
    cone([1.24, 3.05, -0.3], [1.34, 3.28, -0.31], 0.05, 0.01, 'horn', f),
    // damage
    bite([1.3, 2.4, -0.28], 0.16, 0.35, { ...f, side: 1 }),
    bite([0.95, 2.6, -0.28], 0.14, 0.6, { ...f, side: -1 }),
    bite([-0.32, 1.95, 0.2], 0.15, 0.8),
    bite([0.34, 3.0, -0.12], 0.1, 0.9),
  ];
  return { height: 3.25, head: 2.6, anim: 'fly', plates: true, flying: true, shadow: [0.9, 0.5], parts };
}

function castle() {
  const merlons = [-0.6, -0.3, 0, 0.3, 0.6].map((x) => box([x, 1.27, 0.25], [0.075, 0.07, 0.06], 'stone', { rad: 0.01 }));
  return {
    height: 2.25, head: 1.3, anim: 'none', bricks: true, portrait: 'full', shadow: [1.2, 0.5], ruin: true,
    parts: [
      box([0, 0.6, 0], [0.75, 0.6, 0.3], 'stone'),
      cyl([0.86, 0.82, 0], 0.3, 0.82, 'stone', { sym: true }),
      cone([0.86, 1.62, 0], [0.86, 2.18, 0], 0.37, 0.015, 'roof', { sym: true }),
      box([0, 1.28, -0.12], [0.4, 0.46, 0.27], 'stone'),
      cone([0, 1.72, -0.12], [0, 2.24, -0.12], 0.44, 0.015, 'roof'),
      ...merlons,
      box([0, 0.3, 0.31], [0.21, 0.3, 0.03], 'dark', { rad: 0.01 }),
      sph([0, 0.58, 0.3], 0.21, 'dark'),
      ...[-0.12, -0.04, 0.04, 0.12].map((x) => box([x, 0.42, 0.345], [0.012, 0.16, 0.01], 'metal', { rad: 0.004 })),
      box([0.86, 1.12, 0.3], [0.05, 0.09, 0.02], 'glow', { sym: true, rad: 0.01 }),
      box([0.16, 1.36, 0.16], [0.055, 0.08, 0.02], 'glow', { sym: true, rad: 0.01 }),
      box([0.4, 0.75, 0.3], [0.04, 0.07, 0.02], 'glow', { sym: true, rad: 0.01 }),
      bite([0.6, 1.32, 0.26], 0.16, 0.3, { m: 'rubble' }),
      bite([-0.86, 2.02, 0.1], 0.2, 0.55, { m: 'rubble' }),
      bite([0.45, 0.52, 0.32], 0.17, 0.75, { m: 'rubble' }),
      bite([0.1, 2.12, -0.05], 0.22, 0.9, { m: 'rubble' }),
    ],
  };
}

export const MODELS = { slime: slime(), goblin: goblin(), troll: troll(), drake: dragon(false), dragon: flyingDragon(), castle: castle() };

// ---------- scene evaluation ----------

/** Distance to the model and which material is closest, at time t (for idle animation). */
/** A bounding sphere per part ([cx, cy, cz, radius]) so far-away parts can be skipped cheaply. */
function bounds(p) {
  if (p.bound) return p.bound;
  const mx = (v) => (Array.isArray(v) ? Math.max(...v) : v);
  let c, r;
  if (p.s === 'cone') {
    c = [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2];
    r = len3(p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2]) / 2 + Math.max(p.r1, p.r2);
  } else if (p.s === 'box') {
    c = p.c; r = len3(...p.h) + p.rad;
  } else if (p.s === 'cyl') {
    c = p.c; r = Math.hypot(p.r, p.hh);
  } else {
    c = p.c; r = mx(p.r);
  }
  p.bound = [c[0], c[1], c[2], r];
  return p.bound;
}

function evalModel(model, x, y, z, t, damage = 0) {
  let d = 1e9;
  let mat = 'body';
  let best = 1e9;
  const flapSpeed = model.anim === 'fly' ? 3.2 : 2.2;
  for (const p of model.parts) {
    if (p.at != null && damage < p.at) continue; // damage not reached yet
    if (p.side && Math.sign(x || 1) !== p.side) continue;
    let px = p.sym ? Math.abs(x) : x;
    let py = y;
    if (p.flap) {
      // Rotate around z at the pivot, by an angle that swings with time.
      const [pv, amt] = p.flap;
      const ang = -Math.sin(t * flapSpeed) * amt;
      const dx = px - pv[0], dy = py - pv[1];
      px = pv[0] + dx * Math.cos(ang) - dy * Math.sin(ang);
      py = pv[1] + dx * Math.sin(ang) + dy * Math.cos(ang);
    }
    // Skip parts whose bounding sphere is too far away to change the result.
    const bd = bounds(p);
    const lb = len3(px - bd[0], py - bd[1], z - bd[2]) - bd[3];
    if (p.sub ? lb > -d : lb > Math.max(d + (p.k || 0), best)) continue;
    let pd;
    switch (p.s) {
      case 'sph': pd = sdSphere(px, py, z, p.c, p.r); break;
      case 'ell': pd = sdEllipsoid(px, py, z, p.c, p.r); break;
      case 'cone': pd = sdCone(px, py, z, p.a, p.b, p.r1, p.r2); break;
      case 'box': pd = sdBox(px, py, z, p.c, p.h, p.rad); break;
      default: pd = sdCylinder(px, py, z, p.c, p.r, p.hh);
    }
    if (!p.sub && pd < best) {
      best = pd;
      mat = p.m;
    }
    if (p.sub) {
      // carve this shape out of what's drawn so far; a damage bite shows a wound where it cut
      if (-pd > d && p.at != null) mat = p.m;
      d = Math.max(d, -pd);
      continue;
    }
    d = p.k ? smin(d, pd, p.k) : Math.min(d, pd);
  }
  return [d, mat];
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const SBAYER_M = BAYER4;
// The shared battle camera: far enough back that a flying elder dragon fits and a slime looks small.
const STAGE = { ty: 1.75, camY: 2.25, dist: 10.5 };

/**
 * Render a monster to an RGBA pixel buffer.
 * opts: { w, h, yaw (radians, turns the model), t (seconds, idle animation), framing: 'full'|'portrait', shadow }
 * Returns { w, h, data: Uint8ClampedArray } with transparent background (plus a soft ground shadow).
 */
export function renderModel(type, temper = 'angry', opts = {}) {
  const model = MODELS[type] || MODELS.slime;
  const w = opts.w || 64, h = opts.h || 64;
  const yaw = opts.yaw || 0, t = opts.t || 0;
  // Damage (0 = untouched, 1 = nearly paid off): bites, scars, a hurt lean and duller colours.
  const damage = clamp(opts.damage || 0, 0, 1);
  const pal = {};
  for (const [k, r] of Object.entries({ ...FIXED, ...(TEMPER_RAMPS[temper] || TEMPER_RAMPS.angry) })) {
    pal[k] = EMISSIVE.has(k) || k === 'wound' ? r : r.map((c) => {
      const g = (c[0] + c[1] + c[2]) / 3 * 0.7;
      const f = damage * 0.38;
      return [c[0] + (g - c[0]) * f, c[1] + (g - c[1]) * f, c[2] + (g - c[2]) * f];
    });
  }
  const data = new Uint8ClampedArray(w * h * 4);
  const depth = new Float32Array(w * h).fill(Infinity);
  const mats = new Array(w * h);

  // Idle motion: a slime squishes, others breathe (slight bob); dragons flap (handled per part).
  const squish = model.anim === 'squish' ? Math.sin(t * 3) * 0.05 : 0;
  const bob = model.anim === 'fly' ? Math.sin(t * 3.2 - 0.8) * 0.07 : model.anim === 'breathe' || model.anim === 'flap' ? Math.sin(t * 2.2) * 0.025 : 0;
  const sy = 1 + squish, sxz = 1 - squish * 0.6;
  // badly hurt monsters lean to one side (not flying ones or castles)
  const lean = model.flying || model.ruin ? 0 : damage * 0.13;
  const cl = Math.cos(lean), sl = Math.sin(lean);

  // Camera: slightly above, looking at the model's middle (or its head for portraits).
  // 'stage' uses one camera for every monster, so they keep their true sizes relative to each other and the
  // ground always lands on the same row (stageGroundRow): a slime is small, a flying dragon fills the sky.
  const H = model.height;
  const portrait = opts.framing === 'portrait';
  const stage = opts.framing === 'stage';
  const target = stage ? [0, STAGE.ty, 0] : portrait ? [0, Math.max(model.head * 0.82, H * 0.5), 0] : [0, H * 0.48, 0];
  const dist = stage ? STAGE.dist : portrait ? (model.flying ? H * 1.2 + 0.9 : H * 1.55 + 1.1) : H * 2.15 + 0.9;
  const camY = stage ? STAGE.camY : target[1] + (portrait ? 0.2 : 0.35);
  const cam = [0, camY, dist];
  let fx = target[0] - cam[0], fy = target[1] - cam[1], fz = target[2] - cam[2];
  const fl = len3(fx, fy, fz);
  fx /= fl; fy /= fl; fz /= fl;
  // right = forward x up, up' = right x forward
  let rx = -fz, rz = fx;
  const rl = Math.hypot(rx, rz);
  rx /= rl; rz /= rl;
  const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
  const tanF = Math.tan(((portrait ? 30 : 34) * Math.PI) / 180 / 2);
  const cy = Math.cos(yaw), syaw = Math.sin(yaw);

  const scene = (x, y, z) => {
    // into model space: undo yaw, bob and squish
    const mx0 = x * cy - z * syaw, mz = x * syaw + z * cy;
    // lean around the feet
    const mx = mx0 * cl + y * sl, my = -mx0 * sl + y * cl;
    return evalModel(model, mx / sxz, (my - bob) / sy, mz / sxz, t, damage);
  };
  const L = [-0.55, 0.75, 0.62];
  const ll = len3(...L);
  const lx = L[0] / ll, ly = L[1] / ll, lz = L[2] / ll;

  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      // keep pixels square on non-square canvases: the vertical field of view is fixed, width follows
      const u = (((i + 0.5) / w) * 2 - 1) * (w / h), v = 1 - ((j + 0.5) / h) * 2;
      let dx = fx + (u * rx + v * ux) * tanF, dy = fy + v * uy * tanF, dz = fz + (u * rz + v * uz) * tanF;
      const dl = len3(dx, dy, dz);
      dx /= dl; dy /= dl; dz /= dl;
      // Skip rays that miss the model's bounding sphere.
      const bcY = H * 0.55, br = H * (model.flying ? 0.75 : 0.95) + 0.7;
      const ox = cam[0], oy = cam[1] - bcY, oz = cam[2];
      const bb = ox * dx + oy * dy + oz * dz, cc = ox * ox + oy * oy + oz * oz - br * br;
      const disc = bb * bb - cc;
      const idx = j * w + i;
      let hit = false, tt = 0;
      if (disc > 0) {
        tt = Math.max(0, -bb - Math.sqrt(disc));
        const tEnd = -bb + Math.sqrt(disc);
        for (let s = 0; s < 90 && tt < tEnd; s++) {
          const [d] = scene(cam[0] + dx * tt, cam[1] + dy * tt, cam[2] + dz * tt);
          if (d < 0.002) {
            hit = true;
            break;
          }
          tt += d * 0.85;
        }
      }
      const o = idx * 4;
      if (!hit) {
        // Contact shadow on the ground (y = 0) under the model: a solid core with a dithered rim,
        // smaller and fainter under something flying high above it.
        if (opts.shadow !== false && dy < 0) {
          const tg = -cam[1] / dy;
          const gx = cam[0] + dx * tg, gz = cam[2] + dz * tg;
          const [srx, srz] = model.shadow || [0.8, 0.45];
          const e = (gx * gx) / (srx * srx) + (gz * gz) / (srz * srz);
          const core = model.flying ? 0 : 0.55;
          if (e < core) data[o + 3] = 150;
          else if (e < 1 && SBAYER_M[(j & 3) * 4 + (i & 3)] < (1 - e) * (model.flying ? 0.9 : 1.6)) data[o + 3] = model.flying ? 80 : 120;
        }
        continue;
      }
      const px = cam[0] + dx * tt, py = cam[1] + dy * tt, pz = cam[2] + dz * tt;
      const [, mat] = scene(px, py, pz);
      // normal by central differences
      // normal from four samples on a tetrahedron
      const e = 0.004;
      const a1 = scene(px + e, py - e, pz - e)[0], a2 = scene(px - e, py - e, pz + e)[0];
      const a3 = scene(px - e, py + e, pz - e)[0], a4 = scene(px + e, py + e, pz + e)[0];
      const nx = a1 - a2 - a3 + a4, ny = -a1 - a2 + a3 + a4, nz = -a1 + a2 - a3 + a4;
      const nl = len3(nx, ny, nz) || 1;
      const Nx = nx / nl, Ny = ny / nl, Nz = nz / nl;
      const diff = Math.max(0, Nx * lx + Ny * ly + Nz * lz);
      // ambient occlusion from the distance field just off the surface
      const ao = clamp(scene(px + Nx * 0.09, py + Ny * 0.09, pz + Nz * 0.09)[0] / 0.09, 0.35, 1);
      // rim light where the surface turns away from the viewer
      const rim = Math.pow(1 - Math.max(0, -(Nx * dx + Ny * dy + Nz * dz)), 3);
      let val = (0.22 + 0.78 * diff) * ao + rim * 0.25;
      // surface detail in model space: stone bricks, belly plates
      const mx0 = px * cy - pz * syaw;
      const mx = (mx0 * cl + py * sl) / sxz, my = (-mx0 * sl + py * cl - bob) / sy, mz = (px * syaw + pz * cy) / sxz;
      if (model.bricks && mat === 'stone') {
        const row = Math.floor(my / 0.12);
        const across = Math.abs(Nx) > Math.abs(Nz) ? mz : mx;
        const bx = (across + (row % 2) * 0.12) / 0.24;
        if (my % 0.12 < 0.022 || bx - Math.floor(bx) < 0.08) val -= 0.3;
      }
      if (model.plates && mat === 'belly' && my % 0.11 < 0.025) val -= 0.28;
      let gash = false;
      if (damage > 0.08 && (mat === 'body' || mat === 'belly' || mat === 'wing' || mat === 'stone' || mat === 'roof')) {
        // the model surface is split into cells; a growing share of them gets a diagonal slash
        const cs = 0.26;
        const cx = Math.floor(mx / cs), cyy = Math.floor(my / cs), cz = Math.floor(mz / cs);
        const hsh = Math.abs(Math.sin(cx * 127.1 + cyy * 311.7 + cz * 74.7) * 43758.5453) % 1;
        if (hsh < damage * 0.75) {
          const fx2 = mx / cs - cx, fy2 = my / cs - cyy;
          const dline = hsh < damage * 0.37 ? Math.abs(fx2 - fy2) : Math.abs(fx2 + fy2 - 1);
          if (dline < 0.09 && fx2 > 0.15 && fx2 < 0.85) gash = true;
          else if (dline < 0.2 && fx2 > 0.1 && fx2 < 0.9) val -= 0.25;
        }
      }
      if (GLOSSY.has(mat)) {
        // specular glint: reflect the light about the normal and compare with the view direction
        const dn = 2 * (lx * Nx + ly * Ny + lz * Nz);
        const sx = dn * Nx - lx, sy2 = dn * Ny - ly, sz = dn * Nz - lz;
        const spec = Math.pow(Math.max(0, -(sx * dx + sy2 * dy + sz * dz)), 24);
        val += spec * 1.2;
      }
      if (EMISSIVE.has(mat)) val = 0.75 + diff * 0.35;
      // ordered dither between the four tones
      const dv = val + (BAYER4[(j & 3) * 4 + (i & 3)] - 0.5) * 0.12;
      const tone = dv < 0.34 ? 0 : dv < 0.6 ? 1 : dv < 0.86 ? 2 : 3;
      const col = gash ? (model.ruin ? pal.rubble[0] : pal.wound[1]) : (pal[mat] || pal.body)[tone];
      data[o] = col[0];
      data[o + 1] = col[1];
      data[o + 2] = col[2];
      data[o + 3] = 255;
      depth[idx] = tt;
      mats[idx] = mat;
    }
  }

  // Outline: dark pixels around the silhouette, and along big depth steps inside it.
  const out = new Uint8ClampedArray(data);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const idx = j * w + i, o = idx * 4;
      const solid = depth[idx] !== Infinity;
      let edge = false;
      for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + ddx, jj = j + ddy;
        if (ii < 0 || jj < 0 || ii >= w || jj >= h) continue;
        const n = jj * w + ii;
        const nd = depth[n];
        if (!solid && nd !== Infinity) edge = true;
        if (solid && nd !== Infinity && nd - depth[idx] > 0.22 && mats[n] !== mats[idx]) edge = true;
      }
      if (edge && (!solid || depth[idx] !== Infinity)) {
        out[o] = OUTLINE[0];
        out[o + 1] = OUTLINE[1];
        out[o + 2] = OUTLINE[2];
        out[o + 3] = 255;
      }
    }
  }
  return { w, h, data: out };
}

/**
 * Where the ground (y = 0, under the model) lands, as a fraction of the image height, with the 'stage'
 * camera. Battle scenes put their floor line here so every monster stands on it.
 */
export function stageGroundRow() {
  const { camY, dist, ty } = STAGE;
  const pitch = Math.atan2(camY - ty, dist);
  const ang = Math.atan2(camY, dist) - pitch; // angle below the view centre
  const tanF = Math.tan((34 * Math.PI) / 180 / 2);
  return 0.5 + Math.tan(ang) / tanF / 2;
}

/** Damage shown for a debt: 0 untouched to 1 nearly paid off, in five steps so renders can be cached. */
export function damageLevel(balance, peak) {
  if (!(peak > 0)) return 0;
  const paid = Math.min(1, Math.max(0, 1 - balance / peak));
  return Math.min(4, Math.floor(paid * 5)) / 4;
}

/** Which model draws a debt: mortgages are castles, everything else by balance tier. */
export function modelFor(speciesKey) {
  return MODELS[speciesKey] ? speciesKey : 'slime';
}

// ---------- framed portraits ----------

/** Frame material per monster type: also reads as its rank. */
export const FRAMES = {
  slime: { name: 'Wood', ramp: ramp('#2e1a0c', '#5e3a1c', '#8e5e30', '#c08a50') },
  goblin: { name: 'Iron', ramp: ramp('#22222c', '#4c4e5e', '#7e8296', '#bcc0d0') },
  troll: { name: 'Bronze', ramp: ramp('#34200c', '#7e5020', '#bc7e34', '#ecbc68') },
  drake: { name: 'Silver', ramp: ramp('#34384a', '#7e8498', '#bcc2d2', '#f2f4ff') },
  dragon: { name: 'Gold', ramp: ramp('#442a06', '#a07410', '#dcae2c', '#fff0a0') },
  castle: { name: 'Obsidian', ramp: ramp('#100818', '#32204a', '#5e4486', '#a284cc') },
};

/**
 * A monster in a pixel-art frame, for lists and cards.
 * Returns { w, h, data } of size x size (default 56): a 4 px bevelled frame, corner gems in the temper's
 * glow colour, a dithered backdrop in the temper's colours, and the monster's portrait inside.
 */
export function renderPortrait(type, temper = 'angry', opts = {}) {
  const S = opts.size || 56;
  const B = Math.max(3, Math.round(S / 14)); // frame thickness
  const inner = S - B * 2;
  const model = MODELS[type] || MODELS.slime;
  const fr = (FRAMES[type] || FRAMES.slime).ramp;
  const tp = TEMPER_RAMPS[temper] || TEMPER_RAMPS.angry;
  const data = new Uint8ClampedArray(S * S * 4);
  const put = (x, y, c, a = 255) => {
    const o = (y * S + x) * 4;
    data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = a;
  };
  const mix = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  const night = [16, 12, 30];
  // backdrop: dark at the top, a glow of the temper colour behind the monster, dithered in steps
  const glow = mix(night, tp.body[0], 0.9), mid = mix(night, tp.body[0], 0.45);
  for (let y = 0; y < inner; y++) {
    for (let x = 0; x < inner; x++) {
      const dx = (x - inner / 2) / inner, dy = (y - inner * 0.62) / inner;
      const r = Math.sqrt(dx * dx + dy * dy) * 2;
      const d = r + (BAYER4[(y & 3) * 4 + (x & 3)] - 0.5) * 0.35;
      put(x + B, y + B, d < 0.55 ? glow : d < 1.0 ? mid : night);
    }
  }
  // monster on top
  const im = renderModel(type, temper, { w: inner, h: inner, yaw: opts.yaw ?? 0.32, framing: model.portrait || 'portrait', t: opts.t || 0.4, damage: opts.damage || 0 });
  for (let y = 0; y < inner; y++) {
    for (let x = 0; x < inner; x++) {
      const so = (y * inner + x) * 4, a = im.data[so + 3] / 255;
      if (!a) continue;
      const o = ((y + B) * S + x + B) * 4;
      for (let c = 0; c < 3; c++) data[o + c] = data[o + c] * (1 - a) + im.data[so + c] * a;
    }
  }
  // bevelled frame: light on the top/left faces, dark on the bottom/right
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const ring = Math.min(x, y, S - 1 - x, S - 1 - y);
      if (ring >= B) continue;
      if (ring === 0) { put(x, y, OUTLINE); continue; }
      if (ring === B - 1) { put(x, y, fr[0]); continue; } // inner lip
      const topLeft = x + y < S - 1 ? (Math.min(x, y) === ring) : false;
      const bottomRight = Math.min(S - 1 - x, S - 1 - y) === ring;
      let c = topLeft ? fr[2] : bottomRight ? fr[1] : fr[2];
      if (ring === 1 && topLeft) c = fr[3];
      // engraved notches along the frame
      if (ring === Math.floor(B / 2) && ((x + y) % 6 === 0)) c = fr[0];
      put(x, y, c);
    }
  }
  // corner gems
  const g = Math.max(2, B - 1);
  for (const [cx, cy] of [[0, 0], [S - g - 1, 0], [0, S - g - 1], [S - g - 1, S - g - 1]]) {
    for (let y = 0; y <= g; y++) for (let x = 0; x <= g; x++) {
      const edge = x === 0 || y === 0 || x === g || y === g;
      put(cx + x, cy + y, edge ? OUTLINE : x + y <= 2 ? tp.glow[3] : tp.glow[1]);
    }
  }
  return { w: S, h: S, data };
}
