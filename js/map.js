'use strict';
// ---------- Deterministic world generation ----------
function hash2(x, y, s) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, s, o) {
  let a = 0, amp = 1, f = 1, t = 0;
  for (let i = 0; i < o; i++) { a += vnoise(x * f, y * f, s + i * 101) * amp; t += amp; amp *= 0.5; f *= 2; }
  return a / t;
}
function isLand(t) { return t >= T.PLAINS && t <= T.HILLS; }

function genMap(seed) {
  seed = seed | 0;
  const N = MW * MH, ter = new Uint8Array(N), feat = new Uint8Array(N), amt = new Uint8Array(N);
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    let e = fbm(x / 70, y / 70, seed, 5);
    const edge = Math.min(x, y, MW - 1 - x, MH - 1 - y);
    if (edge < 28) e -= (28 - edge) / 28 * 0.4;
    const riv = Math.abs(fbm(x / 60, y / 60, seed + 500, 3) - 0.5);
    const temp = y / MH * 0.9 + 0.05 + (fbm(x / 60, y / 60, seed + 900, 3) - 0.5) * 0.55;
    const moist = fbm(x / 50, y / 50, seed + 1300, 4);
    let t;
    if (e < 0.385) t = T.DEEP; else if (e < 0.415) t = T.SHALLOW;
    else if (e > 0.7) t = T.PEAK;
    else if (riv < 0.011 && e < 0.66) t = T.SHALLOW;
    else if (e > 0.62) t = T.HILLS;
    else if (temp < 0.3) t = T.TUNDRA;
    else if (temp > 0.68 && moist < 0.52) t = T.DESERT;
    else if (moist > 0.64 && e < 0.52) t = T.SWAMP;
    else if (moist > 0.5) t = T.FOREST;
    else t = T.PLAINS;
    const i = y * MW + x; ter[i] = t;
    const r = hash2(x, y, seed + 7), c = fbm(x / 9, y / 9, seed + 77, 2); // c: clustering for ore
    let f = 0;
    if (t === T.FOREST) f = r < 0.42 ? F.TREE : r < 0.445 ? F.BERRY : r < 0.452 ? F.ROCK : 0;
    else if (t === T.PLAINS) f = r < 0.035 ? F.TREE : r < 0.047 ? F.BERRY : r < 0.053 ? F.ROCK : 0;
    else if (t === T.DESERT) f = r < 0.03 ? F.ROCK : (r < 0.1 && c > 0.66) ? F.GOLD : r > 0.996 ? F.TREE : 0;
    else if (t === T.TUNDRA) f = r < 0.05 ? F.TREE : r < 0.065 ? F.ROCK : (r < 0.2 && c > 0.64) ? F.IRON : 0;
    else if (t === T.SWAMP) f = r < 0.14 ? F.TREE : r < 0.2 ? F.BERRY : 0;
    else if (t === T.HILLS) f = r < 0.1 ? F.ROCK : (r < 0.3 && c > 0.62) ? F.IRON : (r > 0.8 && c < 0.36) ? F.GOLD : r > 0.97 ? F.TREE : 0;
    feat[i] = f; if (f) amt[i] = FEAT[f].amt;
  }
  // Starting villages: north, east, south, west
  const want = [[250, 85], [415, 250], [250, 415], [85, 250]], starts = [];
  const okSpot = (cx, cy) => { for (let y = cy - 4; y <= cy + 4; y++) for (let x = cx - 4; x <= cx + 4; x++) if (!isLand(ter[y * MW + x])) return false; return true; };
  for (const [wx, wy] of want) {
    let best = null;
    for (let r = 0; r < 70 && !best; r++) for (let dy = -r; dy <= r && !best; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const cx = wx + dx, cy = wy + dy;
      if (cx < 40 || cy < 40 || cx > MW - 41 || cy > MH - 41) continue;
      if (okSpot(cx, cy)) { best = [cx, cy]; break; }
    }
    if (!best) best = [wx, wy];
    const [cx, cy] = best; let base = ter[cy * MW + cx]; if (!isLand(base) || base === T.HILLS) base = T.PLAINS;
    for (let y = cy - 4; y <= cy + 4; y++) for (let x = cx - 4; x <= cx + 4; x++) { const i = y * MW + x; if (!isLand(ter[i]) || ter[i] === T.HILLS) ter[i] = base; feat[i] = 0; amt[i] = 0; }
    const put = (dx, dy, f) => { const i = (cy + dy) * MW + cx + dx; if (!isLand(ter[i])) ter[i] = base; feat[i] = f; amt[i] = FEAT[f].amt; };
    [[-5, -3], [-5, -2], [-6, -2], [-5, -4], [-6, -3], [-6, -4], [-5, -5], [-6, -5], [-7, -3], [-7, -4]].forEach(o => put(o[0], o[1], F.TREE));
    [[5, -3], [6, -3], [5, -4], [6, -4]].forEach(o => put(o[0], o[1], F.ROCK));
    [[-5, 4], [-6, 4], [-5, 5], [-6, 5]].forEach(o => put(o[0], o[1], F.BERRY));
    starts.push({ x: cx, y: cy });
    // carve a guaranteed land/ford route to the centre of the world
    const n = Math.max(Math.abs(250 - cx), Math.abs(250 - cy));
    for (let k = 0; k <= n; k++) {
      const x = Math.round(cx + (250 - cx) * k / n), y = Math.round(cy + (250 - cy) * k / n);
      for (const [ox, oy] of [[0, 0], [1, 0], [0, 1]]) {
        const i = (y + oy) * MW + x + ox;
        if (ter[i] === T.DEEP) ter[i] = T.SHALLOW; else if (ter[i] === T.PEAK) { ter[i] = T.HILLS; }
      }
    }
  }
  return { ter, feat, amt, starts, seed };
}
