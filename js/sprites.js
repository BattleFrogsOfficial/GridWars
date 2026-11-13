'use strict';
// ---------- Procedural pixel art ----------
const SPR = { ter: [], feat: {}, cache: {} };
function mk(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function rgb(c, f) { return 'rgb(' + Math.min(255, c[0] * f | 0) + ',' + Math.min(255, c[1] * f | 0) + ',' + Math.min(255, c[2] * f | 0) + ')'; }
function outline(c) {
  const g = c.getContext('2d'), w = c.width, h = c.height, d = g.getImageData(0, 0, w, h), o = new Uint8ClampedArray(d.data);
  const A = (x, y) => x >= 0 && y >= 0 && x < w && y < h && o[(y * w + x) * 4 + 3] > 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!A(x, y) && (A(x + 1, y) || A(x - 1, y) || A(x, y + 1) || A(x, y - 1))) { const i = (y * w + x) * 4; d.data[i] = 24; d.data[i + 1] = 18; d.data[i + 2] = 28; d.data[i + 3] = 255; }
  g.putImageData(d, 0, 0); return c;
}
function P(g) { return (col, x, y, w, h) => { g.fillStyle = col; g.fillRect(x, y, w || 1, h || 1); }; }

function initSprites() {
  // terrain: 4 variants each
  for (let t = 0; t < TERRAIN.length; t++) {
    const vs = [];
    for (let v = 0; v < 4; v++) {
      const c = mk(16, 16), g = c.getContext('2d'), col = TERRAIN[t].col, p = P(g);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p(rgb(col, 0.95 + Math.random() * 0.1), x, y);
      const dots = (n, f) => { for (let i = 0; i < n; i++) p(rgb(col, f), Math.random() * 15 | 0, Math.random() * 15 | 0, 1 + (Math.random() * 2 | 0), 1); };
      if (t <= T.SHALLOW) { for (let i = 0; i < 3; i++) p(rgb(col, 1.22), (v * 5 + i * 6) % 13, (v * 3 + i * 5 + 2) % 15, 3, 1); }
      else if (t === T.PLAINS || t === T.FOREST) { dots(7, 0.85); dots(4, 1.15); }
      else if (t === T.DESERT) { dots(5, 0.9); for (let i = 0; i < 2; i++) p(rgb(col, 1.1), Math.random() * 10 | 0, Math.random() * 15 | 0, 5, 1); }
      else if (t === T.TUNDRA) { dots(5, 0.9); dots(3, 1.1); }
      else if (t === T.SWAMP) { dots(6, 0.75); for (let i = 0; i < 2; i++) p('#3d5a6a', Math.random() * 12 | 0, Math.random() * 14 | 0, 3, 2); }
      else if (t === T.HILLS) { dots(6, 0.8); dots(5, 1.2); p(rgb(col, 0.7), 2 + v, 10, 5, 1); p(rgb(col, 1.25), 3 + v, 9, 3, 1); }
      else if (t === T.PEAK) {
        for (let i = 0; i < 12; i++) { p(rgb(col, 0.8), 8 - (i >> 1) - 1, 3 + i, (i >> 1) + 1, 1); p(rgb(col, 1.15), 8, 3 + i, (i >> 1) + 1, 1); }
        p('#fff', 7, 3, 2, 1); p('#fff', 6, 4, 4, 1); p('#eef', 6, 5, 2, 1); p('#fff', 9, 5, 2, 1);
      }
      vs.push(c);
    }
    SPR.ter.push(vs);
  }
  // features
  const feat = (name, fn) => { const c = mk(16, 16); fn(P(c.getContext('2d'))); SPR.feat[name] = outline(c); };
  feat('tree', p => { p('#6b4423', 7, 10, 2, 5); p('#2f7d32', 4, 3, 8, 7); p('#2f7d32', 5, 2, 6, 9); p('#49a34a', 5, 3, 4, 3); p('#1f5d25', 8, 8, 3, 2); });
  feat('pine', p => { p('#5a3a1e', 7, 12, 2, 3); for (let i = 0; i < 5; i++) p('#1f5a3a', 7 - i, 2 + i * 2, 2 + i * 2, 2); p('#fff', 7, 2, 2, 1); p('#e8f0f4', 5, 6, 2, 1); p('#e8f0f4', 9, 8, 3, 1); });
  feat('cactus', p => { p('#3f9a4a', 7, 3, 3, 12); p('#3f9a4a', 4, 6, 2, 4); p('#3f9a4a', 4, 9, 4, 2); p('#3f9a4a', 11, 5, 2, 4); p('#3f9a4a', 9, 8, 4, 2); p('#6cc46c', 8, 4, 1, 9); });
  feat('swtree', p => { p('#4a3a22', 7, 8, 2, 7); p('#4a3a22', 5, 13, 6, 1); p('#3a5f2a', 3, 3, 10, 5); p('#3a5f2a', 4, 2, 8, 7); p('#567d36', 5, 3, 4, 2); p('#3a5f2a', 3, 8, 1, 3); p('#3a5f2a', 12, 8, 1, 2); });
  const rock = (p, a, b) => { p('#7d7d83', 3, 7, 10, 7); p('#7d7d83', 5, 5, 6, 3); p('#a4a4ab', 4, 7, 5, 3); p('#a4a4ab', 6, 5, 3, 2); p('#5c5c63', 9, 10, 4, 4); if (a) { p(a, 5, 9, 2, 2); p(a, 9, 7, 2, 2); p(a, 7, 11, 2, 2); p(b, 5, 9); p(b, 9, 7); p(b, 7, 11); p(a, 11, 11, 1, 1); } };
  feat('rock', p => rock(p)); feat('iron', p => rock(p, '#b5562a', '#e08a55')); feat('gold', p => rock(p, '#e8b820', '#fff3a0'));
  feat('berry', p => { p('#2f7d32', 3, 7, 10, 7); p('#2f7d32', 5, 5, 6, 3); p('#49a34a', 4, 7, 4, 2); for (const [x, y] of [[5, 9], [8, 7], [10, 10], [6, 12], [9, 12]]) p('#e0304a', x, y, 2, 2); });
  const road = mk(16, 16), rp = P(road.getContext('2d'));
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (x > 0 && x < 15 && y > 0 && y < 15) rp(rgb([176, 150, 110], 0.92 + Math.random() * 0.14), x, y);
  for (let i = 0; i < 6; i++) rp('#8a7352', 2 + Math.random() * 11 | 0, 2 + Math.random() * 11 | 0, 2, 1);
  SPR.feat.road = road;
  const br = mk(16, 16), bp = P(br.getContext('2d'));
  for (let x = 0; x < 16; x += 4) { bp('#9a6a36', x, 1, 3, 14); bp('#7a4f24', x + 3, 1, 1, 14); }
  bp('#5a3a1a', 0, 0, 16, 2); bp('#5a3a1a', 0, 14, 16, 2);
  SPR.feat.bridge = br;
}
function featSprite(f, t) {
  switch (f) {
    case F.TREE: return t === T.TUNDRA ? SPR.feat.pine : t === T.DESERT ? SPR.feat.cactus : t === T.SWAMP ? SPR.feat.swtree : SPR.feat.tree;
    case F.ROCK: return SPR.feat.rock; case F.IRON: return SPR.feat.iron; case F.GOLD: return SPR.feat.gold;
    case F.BERRY: return SPR.feat.berry; case F.ROAD: return SPR.feat.road; case F.BRIDGE: return SPR.feat.bridge;
  }
  return null;
}
function human(p, team, o) {
  const skin = '#e8b88a';
  p('#3b2a1a', 6, 11, 2, 3); p('#3b2a1a', 9, 11, 2, 3);
  p(o.armor || team, 5, 6, 7, 5); if (o.armor) p(team, 7, 7, 3, 3);
  p(skin, 4, 7, 1, 3); p(skin, 12, 7, 1, 3);
  p(skin, 6, 2, 5, 4); p('#222', 7, 4); p('#222', 9, 4);
  if (o.helm) { p(o.helm, 6, 1, 5, 2); p(o.helm, 5, 2, 1, 2); p(o.helm, 11, 2, 1, 2); } else p(o.hair || '#6a4a2a', 6, 1, 5, 1);
  if (o.w === 'axe') { p('#7a4a1e', 13, 4, 1, 8); p('#b8bcc4', 12, 4, 3, 2); }
  if (o.w === 'spear') { p('#7a4a1e', 13, 2, 1, 12); p('#d8dce4', 13, 0, 1, 2); }
  if (o.w === 'bow') { p('#7a4a1e', 13, 3); p('#7a4a1e', 14, 4, 1, 6); p('#7a4a1e', 13, 10); p('#ddd', 13, 4, 1, 6); }
  if (o.w === 'sword') { p(o.blade || '#c8ccd4', 13, 2, 1, 7); p('#8a6a20', 12, 9, 3, 1); p('#5a3a1a', 13, 10); }
  if (o.shield) { p(o.shield, 2, 6, 3, 5); p(team, 3, 7, 1, 3); }
}
const UNIT_ART = {
  worker: (p, t) => human(p, t, { w: 'axe' }),
  spear: (p, t) => human(p, t, { w: 'spear', hair: '#3a2a1a', shield: '#8a5a2b' }),
  archer: (p, t) => human(p, t, { w: 'bow', helm: '#4a7a3a' }),
  sword: (p, t) => human(p, t, { w: 'sword', helm: '#8a8f99', shield: '#8a8f99', armor: '#6f747d' }),
  champion: (p, t) => human(p, t, { w: 'sword', helm: '#dfe8f2', shield: '#c4d2e2', armor: '#a9b9cc', blade: '#ffffff' }),
  scout: (p, t) => rider(p, t, false), lancer: (p, t) => rider(p, t, true),
  ram: (p, t) => { p('#6b4423', 2, 5, 11, 2); p(t, 2, 4, 11, 1); p('#8a5a2b', 2, 7, 11, 4); p('#5a3a1a', 3, 8, 12, 2); p('#9aa0aa', 14, 7, 2, 4); p('#2a2a2a', 3, 11, 3, 3); p('#2a2a2a', 9, 11, 3, 3); p('#777', 4, 12); p('#777', 10, 12); },
  catapult: (p, t) => { p('#8a5a2b', 2, 10, 12, 2); p('#2a2a2a', 2, 12, 3, 3); p('#2a2a2a', 11, 12, 3, 3); for (let i = 0; i < 7; i++) p('#6b4423', 4 + i, 9 - i, 2, 1); p('#9a9a9a', 10, 1, 3, 3); p(t, 3, 7, 2, 3); p('#6b4423', 7, 6, 1, 4); },
  boat: (p, t) => { p('#7a4a1e', 1, 9, 14, 2); p('#5a3a1a', 2, 11, 12, 2); p('#5a3a1a', 4, 13, 8, 1); p('#4a3015', 8, 1, 1, 8); p('#f0ead8', 4, 2, 4, 6); p(t, 9, 2, 4, 6); p('#f0ead8', 9, 4, 4, 1); },
  galley: (p, t) => { p('#6b3a1a', 0, 9, 16, 2); p('#4a2a12', 1, 11, 14, 2); p('#4a2a12', 3, 13, 10, 1); p('#c8ccd4', 15, 8, 1, 2); p('#4a3015', 7, 0, 1, 9); p(t, 3, 1, 9, 6); p('#f0ead8', 3, 3, 9, 1); p('#f0ead8', 3, 5, 9, 1); for (let i = 2; i < 14; i += 3) p('#c9a36b', i, 12, 1, 3); },
};
function rider(p, t, steel) {
  const h = steel ? '#5a4a42' : '#8a5a2b';
  p(h, 2, 8, 10, 4); p(h, 11, 5, 3, 5); p(h, 13, 6, 2, 2); p('#222', 13, 6); p('#3a2a1a', 1, 8, 1, 4);
  p(h, 3, 12, 1, 3); p(h, 5, 12, 1, 3); p(h, 9, 12, 1, 3); p(h, 11, 12, 1, 3);
  if (steel) { p('#a9b9cc', 3, 8, 8, 2); p('#a9b9cc', 11, 5, 3, 1); }
  p(steel ? '#a9b9cc' : t, 5, 4, 4, 4); p(t, 6, 5, 2, 2); p('#e8b88a', 6, 1, 3, 3); if (steel) p('#dfe8f2', 6, 0, 3, 2); else p('#3a2a1a', 6, 0, 3, 1);
  if (steel) { p('#7a4a1e', 9, 5, 7, 1); p('#fff', 15, 5); } else { p('#7a4a1e', 10, 2, 1, 6); p('#d8dce4', 10, 1); }
}
const BLD_ART = {
  townhall: (p, t) => {
    p('#b9a98a', 4, 20, 40, 26); p('#9a8a6c', 4, 42, 40, 4);
    for (let y = 22; y < 42; y += 5) for (let x = 6 + (y % 2) * 3; x < 42; x += 8) p('#a39376', x, y, 4, 2);
    for (let i = 0; i < 14; i++) p(i % 3 === 2 ? '#0003' : t, 2 + i * 1.5 | 0, 20 - i, 44 - (i * 3), 1), p(t, 2 + (i * 1.5 | 0), 19 - i, 44 - i * 3, 2);
    p('#fff5', 8, 16, 32, 1); p('#5a3a1a', 19, 32, 10, 14); p('#3a2410', 20, 33, 8, 13); p('#e8c02a', 26, 40, 1, 2);
    p('#35506a', 9, 28, 6, 6); p('#35506a', 33, 28, 6, 6); p('#8ab', 10, 29, 2, 2); p('#8ab', 34, 29, 2, 2);
    p('#4a3015', 23, 0, 1, 8); p(t, 24, 0, 7, 4); p('#fff', 26, 1, 2, 2);
  },
  house: (p, t) => { p('#c9a36b', 3, 8, 10, 7); p('#a8854f', 3, 13, 10, 2); for (let i = 0; i < 6; i++) p(t, 1 + i, 7 - i, 14 - i * 2, 2); p('#5a3a1a', 7, 11, 2, 4); p('#35506a', 10, 10, 2, 2); p('#777', 11, 2, 2, 3); },
  storage: (p, t) => { p('#8a5a2b', 1, 6, 14, 9); p('#5b3a1a', 1, 3, 14, 3); p('#6f4722', 0, 5, 16, 1); p('#3a2410', 6, 9, 4, 6); p(t, 6, 7, 4, 1); p('#c9a36b', 2, 11, 3, 3); p('#a8854f', 3, 12); p('#c9a36b', 11, 11, 3, 3); p('#a8854f', 12, 12); },
  shop: (p, t) => { p('#d8c08a', 2, 7, 12, 8); p('#b89c62', 2, 13, 12, 2); for (let x = 1; x < 15; x += 2) { p(t, x, 4, 1, 3); p('#fff', x + 1, 4, 1, 3); } p('#5a3a1a', 1, 3, 14, 1); p('#3a2410', 3, 9, 6, 3); p('#e0503f', 4, 9, 1, 1); p('#f0c62a', 6, 9); p('#49a34a', 7, 10); p('#5a3a1a', 10, 10, 3, 5); },
  farm: (p, t) => { p('#7a5a32', 1, 1, 14, 14); for (let y = 2; y < 14; y += 3) { p('#5e4424', 2, y + 1, 12, 1); for (let x = 2; x < 14; x += 2) p('#7ac74f', x, y); } p('#e8d36a', 3, 5); p('#e8d36a', 9, 8); p('#e8d36a', 6, 11); p('#4a3015', 13, 9, 1, 5); p(t, 11, 9, 2, 2); },
  pen: (p, t) => { p('#86b35a', 1, 1, 14, 14); p('#8a5a2b', 1, 1, 14, 1); p('#8a5a2b', 1, 14, 14, 1); p('#8a5a2b', 1, 1, 1, 14); p('#8a5a2b', 14, 1, 1, 14); p('#6b4423', 1, 7, 1, 2); p('#fff', 4, 4, 3, 2); p('#222', 7, 4); p('#f4b6c0', 9, 9, 3, 2); p('#fff', 4, 10, 3, 2); p('#222', 3, 10); p(t, 13, 2, 2, 2); },
  barracks: (p, t) => { p('#7d6a55', 1, 6, 14, 9); p('#5d4d3d', 1, 13, 14, 2); p('#4a3a2c', 0, 4, 16, 2); p(t, 1, 3, 14, 1); p('#3a2410', 6, 10, 4, 5); p(t, 2, 7, 3, 4); p('#fff', 3, 8, 1, 2); p(t, 11, 7, 3, 4); p('#fff', 12, 8, 1, 2); p('#c8ccd4', 7, 6, 1, 3); p('#c8ccd4', 6, 7, 3, 1); },
  stable: (p, t) => { p('#9a6a36', 1, 7, 14, 8); for (let i = 0; i < 4; i++) p(t, 1 + i * 2, 6 - i, 14 - i * 4, 1); p('#3a2410', 3, 9, 4, 6); p('#3a2410', 9, 9, 4, 6); p('#8a5a2b', 4, 10, 2, 2); p('#222', 5, 10); p('#e8d36a', 9, 13, 4, 2); p('#7a4f24', 1, 11, 14, 1); },
  blacksmith: (p, t) => { p('#5c5c63', 1, 6, 14, 9); p('#45454b', 1, 13, 14, 2); p('#3a3a40', 0, 5, 16, 1); p('#45454b', 11, 0, 3, 5); p('#f08a2a', 12, 0, 1, 1); p('#ccc8', 12, 0, 2, 1); p('#2a1a10', 3, 8, 5, 5); p('#f08a2a', 4, 10, 3, 3); p('#ffd84a', 5, 11, 1, 2); p('#888', 10, 10, 4, 1); p('#666', 11, 11, 2, 3); p(t, 1, 4, 9, 1); },
  siege: (p, t) => { p('#8a5a2b', 1, 8, 14, 7); p('#6b4423', 1, 6, 14, 2); p(t, 1, 5, 14, 1); p('#3a2410', 2, 9, 12, 5); p('#6b4423', 3, 12, 8, 1); for (let i = 0; i < 4; i++) p('#9a6a36', 5 + i, 11 - i); p('#2a2a2a', 10, 11, 3, 3); p('#888', 11, 12); },
  dock: (p, t) => { for (let x = 1; x < 15; x += 3) { p('#9a6a36', x, 2, 2, 12); p('#7a4f24', x + 2, 2, 1, 12); } p('#5a3a1a', 0, 1, 16, 2); p('#5a3a1a', 0, 13, 16, 2); p('#4a3015', 1, 0, 2, 3); p('#4a3015', 13, 0, 2, 3); p('#4a3015', 7, 3, 1, 7); p(t, 8, 3, 4, 3); p('#c9a36b', 3, 9, 3, 3); },
  tower: (p, t) => { p('#8d8d95', 4, 4, 8, 11); p('#6d6d75', 10, 4, 2, 11); p('#8d8d95', 3, 2, 10, 3); p('#8d8d95', 3, 1, 2, 1); p('#8d8d95', 7, 1, 2, 1); p('#8d8d95', 11, 1, 2, 1); p('#2a2a30', 7, 7, 2, 3); p('#3a2410', 7, 12, 2, 3); p(t, 4, 5, 8, 1); },
  wall: (p, t) => { for (let x = 0; x < 16; x += 4) { p('#8a5a2b', x, 4, 3, 11); p('#6b4423', x + 3, 4, 1, 11); p('#8a5a2b', x + 1, 3, 1, 1); p('#a8733a', x, 5, 1, 9); } p('#5a3a1a', 0, 9, 16, 1); },
  swall: (p, t) => { p('#8d8d95', 0, 4, 16, 11); for (let y = 4; y < 15; y += 3) { p('#6d6d75', 0, y + 2, 16, 1); for (let x = (y % 2) * 3; x < 16; x += 6) p('#6d6d75', x, y, 1, 2); } p('#a9a9b1', 0, 3, 3, 1); p('#a9a9b1', 6, 3, 4, 1); p('#a9a9b1', 13, 3, 3, 1); },
  gate: (p, t) => { p('#8d8d95', 0, 3, 16, 12); p('#6d6d75', 0, 13, 16, 2); p('#5a3a1a', 3, 6, 10, 9); p('#7a4f24', 4, 7, 4, 8); p('#7a4f24', 9, 7, 3, 8); p('#222', 8, 7, 1, 8); p(t, 3, 4, 10, 2); p('#e8c02a', 7, 11); p('#e8c02a', 9, 11); },
};
function unitSprite(type, owner) {
  const k = 'u' + type + owner; if (SPR.cache[k]) return SPR.cache[k];
  const c = mk(16, 16); UNIT_ART[type](P(c.getContext('2d')), TEAM[owner]); return SPR.cache[k] = outline(c);
}
function bldSprite(type, owner) {
  const k = 'b' + type + owner; if (SPR.cache[k]) return SPR.cache[k];
  const d = BLD[type], s = (d.size || 1) * 16, c = mk(s, s);
  if (d.tile) c.getContext('2d').drawImage(type === 'road' ? SPR.feat.road : SPR.feat.bridge, 0, 0);
  else BLD_ART[type](P(c.getContext('2d')), TEAM[owner]);
  return SPR.cache[k] = c;
}
function iconURL(kind, type, owner) {
  const k = 'i' + kind + type + owner; if (SPR.cache[k]) return SPR.cache[k];
  return SPR.cache[k] = (kind === 'u' ? unitSprite(type, owner) : bldSprite(type, owner)).toDataURL();
}
