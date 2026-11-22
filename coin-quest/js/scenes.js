// First-person battle backdrops and the hero's sword and shield, drawn as pixel art in code.
// Pure functions returning RGBA buffers ({ w, h, data }), like models.js.

const shex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const SBAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const bayer = (x, y) => SBAYER[(y & 3) * 4 + (x & 3)];

// Smooth 1D value noise for ridgelines.
function noise1(x, seed) {
  const h = (n) => {
    const s = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return h(i) * (1 - u) + h(i + 1) * u;
}
const hash2 = (x, y, seed = 0) => {
  const s = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453;
  return s - Math.floor(s);
};

/** Where each monster type lives. Colours run from the top of the sky down to the horizon. */
export const HABITATS = {
  slime: {
    name: 'Mossy Hollow', sky: ['#0c1626', '#173440', '#2e5c52', '#6a9e7c'], orb: { c: '#e8ffd0', x: 0.72, y: 0.2, r: 6 },
    far: '#1a3836', near: '#10281f', ground: ['#1c3622', '#24452a'], path: '#3e5e34', fog: '#2e5c52', props: 'trees', particles: 'fireflies', stars: true,
  },
  goblin: {
    name: 'Goblin Woods', sky: ['#24122c', '#6e2a38', '#d0643a', '#ffbc6a'], orb: { c: '#fff0b0', x: 0.3, y: 0.46, r: 10 },
    far: '#45202e', near: '#26121c', ground: ['#382818', '#44321e'], path: '#5e482c', fog: '#b05a3a', props: 'pines', particles: 'embers',
  },
  troll: {
    name: 'Stone Bridge', sky: ['#18223e', '#34466c', '#7484aa', '#bcc4dc'], orb: { c: '#eef0fa', x: 0.8, y: 0.16, r: 6, moon: true },
    far: '#465070', near: '#282e46', ground: ['#454554', '#525264'], path: '#6a6a7e', fog: '#8a94b4', props: 'rocks', particles: 'mist',
  },
  drake: {
    name: 'Ember Canyon', sky: ['#260c12', '#6e2016', '#c45026', '#ffa858'], orb: { c: '#ffe8a0', x: 0.5, y: 0.34, r: 12 },
    far: '#62261a', near: '#36140e', ground: ['#552816', '#64301c'], path: '#84462a', fog: '#c45026', props: 'cliffs', particles: 'embers',
  },
  dragon: {
    name: "Dragon's Lair", sky: ['#08050c', '#160c1c', '#2a1428', '#4a1c2a'], orb: null,
    far: '#1e0f1c', near: '#120812', ground: ['#28131a', '#32181e'], path: '#40201e', fog: '#5a2028', props: 'cave', particles: 'embers', lava: true, gold: true,
  },
  castle: {
    name: 'Castle Gate', sky: ['#05070f', '#0e1634', '#202c56', '#454878'], orb: { c: '#f4f0d8', x: 0.24, y: 0.17, r: 8, moon: true },
    far: '#131930', near: '#0b0f1e', ground: ['#373744', '#42424f'], path: '#585868', fog: '#2a3050', props: 'banners', particles: 'snow', stars: true,
  },
};

/**
 * The backdrop for a monster type. The horizon sits a little above the middle; the floor runs toward a
 * vanishing point in the centre so it reads as first person.
 */
/** opts.hy: the horizon row (default 55% down), so a taller backdrop can keep the monster's perspective. */
export function renderScene(type, w = 120, h = 168, opts = {}) {
  const H = HABITATS[type] || HABITATS.slime;
  const sky = H.sky.map(shex), far = shex(H.far), near = shex(H.near), fog = shex(H.fog), path = shex(H.path);
  const ground = H.ground.map(shex);
  const data = new Uint8ClampedArray(w * h * 4);
  const hy = opts.hy ?? Math.round(h * 0.55);
  const seed = type.length * 7.3;
  const put = (x, y, c) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const o = (y * w + x) * 4;
    data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255;
  };
  const mix = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];

  // sky: four colour stops, dithered between them
  for (let y = 0; y < hy; y++) {
    const f = (y / hy) * (sky.length - 1);
    for (let x = 0; x < w; x++) {
      const i = Math.floor(f), fr = f - i;
      put(x, y, sky[Math.min(sky.length - 1, i + (fr > bayer(x, y) ? 1 : 0))]);
    }
  }
  if (H.stars) for (let y = 0; y < hy * 0.7; y++) for (let x = 0; x < w; x++) if (hash2(x, y, seed) > 0.985) put(x, y, hash2(y, x) > 0.5 ? [255, 255, 240] : [170, 180, 220]);
  // sun or moon with a dithered halo
  if (H.orb) {
    const ox = H.orb.x * w, oy = H.orb.y * h, r = H.orb.r, c = shex(H.orb.c);
    for (let y = Math.floor(oy - r * 3); y < oy + r * 3; y++) {
      for (let x = Math.floor(ox - r * 3); x < ox + r * 3; x++) {
        const d = Math.hypot(x - ox, y - oy);
        if (d < r) {
          const crater = H.orb.moon && hash2(Math.floor(x / 2), Math.floor(y / 2), 3) > 0.8;
          put(x, y, crater ? mix(c, [150, 150, 170], 0.5) : c);
        } else if (d < r * 2.6 && y < hy && (1 - (d - r) / (r * 1.6)) * 0.55 > bayer(x, y)) {
          const o = (y * w + x) * 4;
          put(x, y, mix([data[o], data[o + 1], data[o + 2]], c, 0.35));
        }
      }
    }
  }
  // far ridge and nearer ridge (mountains, treelines or cave walls)
  for (let x = 0; x < w; x++) {
    const r1 = hy - Math.round(h * (0.08 + 0.1 * noise1(x * 0.05, seed)) + h * 0.03 * noise1(x * 0.2, seed + 1));
    const jag = H.props === 'pines' || H.props === 'trees' ? (x % 5 === 2 ? 3 : x % 5 === 1 || x % 5 === 3 ? 1 : 0) : 0;
    const r2 = hy - Math.round(h * (0.03 + 0.045 * noise1(x * 0.09 + 50, seed))) - jag;
    for (let y = r1; y < hy; y++) put(x, y, y < r1 + 2 ? mix(far, sky[3], 0.25) : far);
    for (let y = r2; y < hy; y++) put(x, y, near);
  }
  // cave: a ceiling and walls closing in, with a glow from below
  if (H.props === 'cave') {
    for (let x = 0; x < w; x++) {
      const ceil = Math.round(h * (0.1 + 0.1 * noise1(x * 0.08, seed + 4)) + (x % 9 === 4 ? 7 : x % 9 === 3 || x % 9 === 5 ? 3 : 0));
      for (let y = 0; y < ceil; y++) put(x, y, y > ceil - 2 ? shex('#2a1626') : near);
      const wall = Math.round(w * 0.16 * (1 - Math.min(1, Math.abs(x - w / 2) / (w / 2)) ** 0.3));
      void wall;
    }
  }
  // floor in perspective: checker tiles toward a central vanishing point, a lighter path, fog at the horizon
  for (let y = hy; y < h; y++) {
    const dz = y - hy + 1;
    const z = 40 / dz;
    for (let x = 0; x < w; x++) {
      const xw = ((x - w / 2) / dz) * 5;
      const onPath = Math.abs(xw) < 4.2;
      const tile = (Math.floor(xw / 2.2) + Math.floor(z)) & 1;
      let c = onPath ? (tile ? path : mix(path, ground[1], 0.4)) : ground[tile];
      if (H.lava && hash2(Math.floor(xw), Math.floor(z * 2), 9) > 0.86 && Math.abs((xw % 1) - 0.5) < 0.12) c = shex(y > hy + 6 ? '#ff7a1a' : '#c83010');
      const fogAmt = Math.max(0, 1 - dz / (h * 0.16));
      if (fogAmt > bayer(x, y)) c = mix(c, fog, 0.55);
      put(x, y, c);
    }
  }
  // first-person framing props at the screen edges
  const sil = mix(near, [0, 0, 0], 0.45);
  if (H.props === 'pines' || H.props === 'trees') {
    for (const [tx, top, width] of [[-2, h * 0.04, 22], [w + 2, h * 0.08, 24], [10, h * 0.3, 10], [w - 12, h * 0.34, 10]]) {
      for (let y = Math.floor(top); y < h; y++) {
        const t = (y - top) / (h - top);
        const tiers = H.props === 'pines' ? ((y - top) % 12) / 12 : 0.6;
        const half = width * Math.min(1, t * 1.6) * (0.55 + tiers * 0.45);
        for (let x = Math.floor(tx - half); x <= tx + half; x++) put(x, y, sil);
      }
    }
  }
  if (H.props === 'cliffs' || H.props === 'cave') {
    for (let y = 0; y < h; y++) {
      const lw = Math.round(w * (0.1 + 0.08 * noise1(y * 0.06, seed + 2)) * (H.props === 'cave' ? 1.2 : 1));
      const rw = Math.round(w * (0.1 + 0.08 * noise1(y * 0.06 + 20, seed + 3)) * (H.props === 'cave' ? 1.2 : 1));
      for (let x = 0; x < lw; x++) put(x, y, x === lw - 1 ? mix(sil, fog, 0.4) : sil);
      for (let x = w - rw; x < w; x++) put(x, y, x === w - rw ? mix(sil, fog, 0.4) : sil);
    }
  }
  // dragon hoard: smooth domed piles of gold at both sides of the floor, lit from above, with a few glints
  if (H.gold) {
    const G = ['#4a300a', '#8a6414', '#c8941c', '#f0c040', '#fff0a0'].map(shex);
    for (const [cx, base, rw, rh] of [[w * 0.12, h * 1.02, w * 0.26, h * 0.17], [w * 0.9, h * 1.02, w * 0.28, h * 0.2], [w * 0.24, h * 0.78, w * 0.1, h * 0.05]]) {
      for (let y = Math.floor(base - rh); y < Math.min(h, base); y++) {
        for (let x = Math.floor(cx - rw); x <= cx + rw; x++) {
          const u = (x - cx) / rw, top = base - rh * (1 - u * u);
          if (Math.abs(u) > 1 || y < top) continue;
          // dome normal: facing up near the top edge, sideways toward the rim
          const depth = (y - top) / Math.max(1, base - top);
          const lit = 0.95 - depth * 0.9 + u * 0.2 + (bayer(x, y) - 0.5) * 0.22;
          const edge = y - top < 1;
          const glint = hash2(x, y, 5) > 0.985 && depth < 0.6;
          put(x, y, glint ? G[4] : edge ? G[3] : lit > 0.7 ? G[3] : lit > 0.45 ? G[2] : lit > 0.2 ? G[1] : G[0]);
        }
      }
    }
  }
  if (H.props === 'rocks') {
    // boulders in the near corners: lit from the moon (upper right), with a darker underside and a rim
    const R = [mix(sil, fog, 0.5), mix(sil, fog, 0.3), mix(sil, fog, 0.12), sil];
    for (const [cx, cy, r] of [[2, h * 0.94, 22], [w - 4, h * 0.9, 24], [w * 0.16, h * 0.74, 7], [w * 0.86, h * 0.72, 5]]) {
      for (let y = Math.floor(cy - r); y < h; y++) for (let x = Math.floor(cx - r * 1.3); x < cx + r * 1.3; x++) {
        const nx = (x - cx) / (r * 1.3), ny = (y - cy) / r;
        // lumpy outline so it reads as rock, not a disc
        const lump = 1 + 0.08 * Math.sin(Math.atan2(ny, nx) * 5 + cx);
        const d2 = nx * nx + ny * ny;
        if (d2 > lump * lump) continue;
        const nz = Math.sqrt(Math.max(0, 1 - d2));
        const lit = nx * 0.45 - ny * 0.6 + nz * 0.4 + (bayer(x, y) - 0.5) * 0.25;
        put(x, y, d2 > lump * lump * 0.86 ? R[3] : lit > 0.55 ? R[0] : lit > 0.25 ? R[1] : lit > -0.1 ? R[2] : R[3]);
      }
    }
  }
  if (H.props === 'banners') {
    // castle walls rising at the sides, with torches
    for (const side of [0, 1]) {
      const x0 = side ? w - 16 : 0;
      for (let y = Math.round(h * 0.18); y < h; y++) for (let x = x0; x < x0 + 16; x++) {
        const brick = (y % 6 === 0) || ((x + (Math.floor(y / 6) % 2) * 4) % 8 === 0);
        put(x, y, brick ? mix(sil, [0, 0, 0], 0.4) : sil);
      }
      for (let y = Math.round(h * 0.14); y < h * 0.18; y++) for (let x = x0; x < x0 + 16; x++) if ((x - x0) % 6 < 4) put(x, y, sil);
      const tx = side ? w - 18 : 17, ty = Math.round(h * 0.42);
      for (let y = ty; y < ty + 8; y++) put(tx, y, shex('#3a2414'));
      for (let y = ty - 5; y < ty; y++) for (let x = tx - 1; x <= tx + 1; x++) if (bayer(x, y) < 0.8) put(x, y, y < ty - 3 ? shex('#ffe08a') : shex('#ff8a2a'));
    }
  }
  // vignette
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x - w / 2) / (w / 2), dy = (y - h * 0.55) / (h * 0.6);
      const v = Math.max(0, Math.sqrt(dx * dx + dy * dy) - 0.75);
      if (v * 1.6 > bayer(x, y)) {
        const o = (y * w + x) * 4;
        put(x, y, mix([data[o], data[o + 1], data[o + 2]], [0, 0, 0], 0.45));
      }
    }
  }
  return { w, h, data, horizon: hy };
}

// ---------- the hero's sword and shield (first person) ----------

function line(buf, x0, y0, x1, y1, thick, colorAt) {
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2);
  for (let s = 0; s <= steps; s++) {
    const t = s / steps, cx = x0 + (x1 - x0) * t, cy = y0 + (y1 - y0) * t;
    for (let dy = -thick; dy <= thick; dy++) for (let dx = -thick; dx <= thick; dx++) {
      if (dx * dx + dy * dy > thick * thick + 0.5) continue;
      const x = Math.round(cx + dx), y = Math.round(cy + dy);
      if (x < 0 || y < 0 || x >= buf.w || y >= buf.h) continue;
      const c = colorAt(t, dx, dy);
      const o = (y * buf.w + x) * 4;
      buf.data[o] = c[0]; buf.data[o + 1] = c[1]; buf.data[o + 2] = c[2]; buf.data[o + 3] = 255;
    }
  }
}

function outline(buf) {
  const { w, h, data } = buf;
  const src = new Uint8ClampedArray(data);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    if (src[o + 3]) continue;
    const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
      const xx = x + dx, yy = y + dy;
      return xx >= 0 && yy >= 0 && xx < w && yy < h && src[(yy * w + xx) * 4 + 3];
    });
    if (n) { data[o] = 20; data[o + 1] = 10; data[o + 2] = 20; data[o + 3] = 255; }
  }
}

/** The sword held at the bottom right, blade up and to the left. */
export function renderSword(w = 56, h = 84) {
  const buf = { w, h, data: new Uint8ClampedArray(w * h * 4) };
  const steel = ['#5a6070', '#a8b0c4', '#e4e8f4', '#ffffff'].map(shex);
  // blade: shaded across its width with a bright edge and a dark fuller down the middle
  line(buf, w - 18, h - 30, 9, 8, 3, (t, dx, dy) => (dx + dy < -2 ? steel[3] : dx + dy < 0 ? steel[2] : dx + dy < 2 ? steel[1] : steel[0]));
  line(buf, 9, 8, 3, 2, 2, (t, dx, dy) => (dx + dy < 0 ? steel[3] : steel[2]));
  line(buf, w - 19, h - 31, 14, 13, 0, () => steel[0]);
  // crossguard, grip, pommel, gauntlet
  const gold = ['#7a5410', '#e0ac2c', '#fff0a0'].map(shex);
  line(buf, w - 32, h - 36, w - 8, h - 17, 3, (t, dx, dy) => (dx + dy < -1 ? gold[2] : dx + dy < 2 ? gold[1] : gold[0]));
  line(buf, w - 16, h - 24, w - 5, h - 8, 3, (t, dx) => (dx < 0 ? shex('#6a4022') : shex('#4a2a14')));
  line(buf, w - 4, h - 5, w - 4, h - 5, 3, (t, dx, dy) => (dx + dy < 0 ? gold[2] : gold[1]));
  line(buf, w - 12, h - 14, w + 6, h + 4, 7, (t, dx, dy) => (dx + dy < -3 ? shex('#9a6a38') : dx + dy < 2 ? shex('#7a4a24') : shex('#5e3a1c')));
  outline(buf);
  return buf;
}

/** A round shield at the bottom left. */
export function renderShield(w = 48, h = 44) {
  const buf = { w, h, data: new Uint8ClampedArray(w * h * 4) };
  const cx = 18, cy = 26, r = 22;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = Math.hypot(x - cx, y - cy);
    if (d > r) continue;
    let c;
    if (d > r - 3) c = d > r - 1.5 ? shex('#5a6070') : shex('#a8b0c4');
    else if (d < 4) c = shex(d < 2 ? '#fff0a0' : '#e0ac2c');
    else {
      const plank = Math.floor((x - cx + 40) / 6) % 2;
      const lit = (x - cx) + (y - cy) < -6;
      c = shex(lit ? (plank ? '#a06a3a' : '#8a5a30') : plank ? '#7a4a24' : '#6a3e1c');
    }
    const o = (y * w + x) * 4;
    buf.data[o] = c[0]; buf.data[o + 1] = c[1]; buf.data[o + 2] = c[2]; buf.data[o + 3] = 255;
  }
  outline(buf);
  return buf;
}
