'use strict';
// ---------- Dino Duel: constants, weapons, maps ----------
const CELL = 40, PW = 26, PH = 34, DT = 1 / 60;
const GRAV = 2300, RUN = 340, ACC = 3200, AIRACC = 2200, JUMP = 780, DJUMP = 720, MAXFALL = 1100;
const WIN_SCORE = 10, SUDDEN_AT = 30, RAZOR_TIME = 14;
const COLORS = [{ name: 'RED', main: '#e5484d', dark: '#a82a32', light: '#ffb3a8' }, { name: 'BLUE', main: '#3d8bfd', dark: '#2459b8', light: '#b5d6ff' }];
const DINOS = ['Rex', 'Trike', 'Stego'];
const TIERCOL = ['#fff', '#b8bec9', '#5fd068', '#4aa8ff', '#b56bff', '#ffc531'];
const TIERW = [0, 22, 26, 26, 16, 10];

// melee: reach, arc (hit height), act (active time), cd, lunge
const M = (n, t, look, col, reach, arc, cd, x) => Object.assign({ n, t, k: 'm', look, col, reach, arc, cd, act: 0.13 }, x);
// gun: sp speed, am ammo, cd, r radius, cnt, spr spread, grav, life, bnc bounces, expl radius, rec recoil, ang launch angle,
//      hom homing, boom boomerang, mine, ring, rain, frag, ghost (through walls), heavy (lands on platforms), rng/ai for the bot
const Gn = (n, t, look, col, shape, x) => Object.assign({ n, t, k: 'g', look, col, shape, sp: 1000, am: 6, cd: 0.4, r: 4, cnt: 1, spr: 0, grav: 0, life: 2.5, rng: 650, ai: 'line' }, x);
const WEAPONS = [
  // tier 1: barely weapons
  M('Twig', 1, 'club', '#9a6b3a', 34, 40, 0.45),
  M('Bone Club', 1, 'club', '#efe6d0', 44, 44, 0.5),
  M('Frying Pan', 1, 'pan', '#555b66', 42, 44, 0.55),
  M('Wet Fish', 1, 'fish', '#7fb8c9', 46, 40, 0.4),
  M('Fly Swatter', 1, 'pan', '#e25d8a', 54, 30, 0.5),
  M('Rubber Chicken', 1, 'fish', '#f5d04a', 40, 40, 0.35),
  M('Boxing Glove', 1, 'glove', '#d8333a', 38, 36, 0.7, { lunge: 520 }),
  M('Flint Knife', 1, 'blade', '#8d99a6', 30, 36, 0.22),
  Gn('Pebbles', 1, 'ball', '#8a8f99', 'ball', { sp: 600, grav: 900, am: 3, cd: 0.5, r: 5, ang: 0.25, ai: 'arc', rng: 300 }),
  M('Wooden Sword', 1, 'blade', '#b98a52', 50, 44, 0.4),
  // tier 2: primitive but real
  M('Stone Spear', 2, 'pole', '#b0b6c0', 72, 24, 0.55),
  Gn('Javelins', 2, 'pole', '#c9a46a', 'arrow', { sp: 820, grav: 700, am: 3, cd: 0.6, r: 5, ang: 0.2, ai: 'arc', rng: 420 }),
  Gn('Slingshot', 2, 'bow', '#8a5a2b', 'ball', { sp: 760, grav: 500, am: 8, cd: 0.45, r: 5, ang: 0.12, rng: 420 }),
  Gn('Boomerang', 2, 'ball', '#e0a03a', 'disc', { sp: 720, boom: 1, am: 4, cd: 0.8, r: 9, life: 1.5, rng: 300 }),
  Gn('Short Bow', 2, 'bow', '#a8703a', 'arrow', { sp: 900, grav: 350, am: 6, cd: 0.5, ang: 0.08, rng: 520 }),
  M('Battle Axe', 2, 'axe', '#c0c6d0', 60, 70, 0.8, { act: 0.2 }),
  Gn('Throwing Knives', 2, 'blade', '#cfd6e0', 'arrow', { sp: 1000, life: 0.45, am: 5, cd: 0.3, rng: 400 }),
  Gn('Snowballer', 2, 'launcher', '#dff1ff', 'ball', { sp: 430, grav: 300, am: 6, cd: 0.5, r: 10, rng: 380 }),
  M('Vine Whip', 2, 'whip', '#4fa84a', 96, 20, 0.7, { act: 0.15 }),
  Gn('Pea Shooter', 2, 'small', '#6fcf5a', 'ball', { sp: 520, am: 12, cd: 0.28, rng: 500 }),
  M('Katana', 2, 'blade', '#e8eef5', 56, 50, 0.3, { lunge: 380 }),
  // tier 3: solid
  Gn('Pistol', 3, 'small', '#5a6370', 'bullet', { sp: 1100, am: 10, cd: 0.3 }),
  Gn('Revolver', 3, 'small', '#b8862f', 'bullet', { sp: 1500, am: 6, cd: 0.45, rec: 120 }),
  Gn('Crossbow', 3, 'bow', '#6b4a2a', 'arrow', { sp: 1400, grav: 120, am: 5, cd: 0.7 }),
  Gn('Grenades', 3, 'ball', '#4f7a3a', 'bomb', { sp: 620, grav: 1500, bnc: 3, life: 1.4, expl: 95, am: 3, ang: 0.5, cd: 0.7, r: 8, heavy: 1, ai: 'arc', rng: 380 }),
  Gn('Shotgun', 3, 'long', '#7a4a2a', 'bullet', { sp: 1100, cnt: 6, spr: 0.22, life: 0.28, am: 4, cd: 0.75, rec: 300, rng: 260 }),
  Gn('Bouncer', 3, 'launcher', '#ff7ac0', 'ball', { sp: 700, bnc: 5, life: 3, am: 6, cd: 0.4, r: 7 }),
  Gn('Saw Launcher', 3, 'launcher', '#aab2bd', 'disc', { sp: 600, grav: 1600, bnc: 6, life: 3, r: 11, am: 3, cd: 0.8, heavy: 1, damp: 0.92, rng: 420 }),
  Gn('Flare Gun', 3, 'small', '#ff7a3a', 'rocket', { sp: 650, grav: 250, expl: 60, am: 4, cd: 0.7, r: 6, rng: 500 }),
  Gn('Twin Pistols', 3, 'small', '#3f4650', 'bullet', { sp: 1100, cnt: 2, spr: 0.06, am: 8, cd: 0.25 }),
  Gn('Nail Gun', 3, 'small', '#e0c04a', 'arrow', { sp: 900, life: 0.4, am: 24, cd: 0.11, spr: 0.05, r: 3, rng: 330 }),
  Gn('Land Mines', 3, 'ball', '#5a5f6a', 'mine', { sp: 0, grav: 1800, mine: 1, expl: 90, trig: 55, am: 3, cd: 0.6, r: 9, life: 25, heavy: 1, ai: 'any', rng: 140 }),
  Gn('Blowpipe', 3, 'pole', '#7ab04a', 'arrow', { sp: 1700, am: 5, cd: 0.5, r: 3 }),
  Gn('Firecrackers', 3, 'ball', '#e5383b', 'bomb', { sp: 520, grav: 1300, life: 0.8, expl: 70, am: 5, cd: 0.4, ang: 0.6, r: 6, heavy: 1, bnc: 2, ai: 'arc', rng: 300 }),
  // tier 4: strong
  Gn('SMG', 4, 'small', '#4a5560', 'bullet', { sp: 1200, am: 32, cd: 0.075, spr: 0.09, r: 3 }),
  Gn('Burst Rifle', 4, 'long', '#3a4a3a', 'bullet', { sp: 1500, am: 30, cd: 0.09, spr: 0.03, r: 3 }),
  Gn('Sniper', 4, 'long', '#2a3440', 'beam', { sp: 3200, am: 3, cd: 1, rec: 250, rng: 2000 }),
  Gn('Rocket Launcher', 4, 'launcher', '#5a6a4a', 'rocket', { sp: 820, expl: 115, am: 2, cd: 1, r: 9, rec: 200 }),
  Gn('Flamethrower', 4, 'big', '#ff8a2a', 'flame', { sp: 520, life: 0.38, am: 70, cd: 0.035, spr: 0.2, r: 9, rng: 190 }),
  Gn('Double Barrel', 4, 'long', '#5a3a22', 'bullet', { sp: 1100, cnt: 12, spr: 0.3, life: 0.26, am: 2, cd: 0.5, rec: 500, rng: 240 }),
  Gn('Bee Hive', 4, 'ball', '#f2c21a', 'bee', { sp: 380, hom: 5, life: 4, am: 4, cd: 0.6, r: 5, ai: 'any', rng: 900 }),
  Gn('Laser Rifle', 4, 'long', '#ff3a6a', 'beam', { sp: 3600, am: 6, cd: 0.4, r: 3, rng: 2000 }),
  Gn('Cluster Bomb', 4, 'ball', '#8a3a8a', 'bomb', { sp: 620, grav: 1500, bnc: 2, life: 1.3, expl: 80, frag: 7, am: 2, ang: 0.5, cd: 0.8, r: 9, heavy: 1, ai: 'arc', rng: 380 }),
  Gn('Ricochet Rifle', 4, 'long', '#2ac0c0', 'bullet', { sp: 1300, bnc: 4, life: 2.5, am: 10, cd: 0.3 }),
  // tier 5: overpowered
  Gn('Dartling Gun', 5, 'big', '#ffc531', 'bullet', { sp: 1500, am: 90, cd: 0.04, spr: 0.12, r: 3, rec: 25 }),
  Gn('Minigun', 5, 'big', '#8a929c', 'bullet', { sp: 1400, am: 120, cd: 0.05, spr: 0.07, r: 3, rec: 45 }),
  Gn('Rail Cannon', 5, 'launcher', '#6af0ff', 'beam', { sp: 4000, ghost: 1, am: 3, cd: 0.8, r: 6, rng: 3000 }),
  Gn('Meteor Staff', 5, 'pole', '#ff6a2a', 'rock', { sp: 520, rain: 1, cnt: 6, expl: 60, am: 3, cd: 0.9, r: 10, ai: 'any', rng: 480 }),
  Gn('Starburst', 5, 'ball', '#ffe66a', 'ball', { sp: 800, ring: 1, cnt: 18, life: 1.2, am: 3, cd: 0.7, r: 5, ai: 'any', rng: 330 }),
  Gn('Seeker Missiles', 5, 'launcher', '#d83b6a', 'rocket', { sp: 560, hom: 9, expl: 90, life: 5, am: 3, cd: 0.8, r: 8, ai: 'any', rng: 1500 }),
];
const N_WEAPONS = WEAPONS.length; // spawnable
WEAPONS.push(Gn('Shrapnel', 0, 'ball', '#ffd27a', 'ball', { sp: 560, grav: 1200, life: 0.55, r: 4 }));
const W_SHRAPNEL = WEAPONS.length - 1;

const THEMES = [
  { name: 'Jungle', sky: ['#7ecbff', '#dcf4ff'], hill: ['#8fd19b', '#6dbb80'], solid: '#7a5a3c', top: '#58b44a', plat: '#c98f4a', ink: '#2c2433' },
  { name: 'Desert', sky: ['#ffc98a', '#fff1d0'], hill: ['#f0c684', '#e3ad63'], solid: '#b9793f', top: '#f3d892', plat: '#96592f', ink: '#3a2a22' },
  { name: 'Glacier', sky: ['#a9cdfc', '#f0f7ff'], hill: ['#d5e6f8', '#bcd5ef'], solid: '#6f92bd', top: '#ffffff', plat: '#4f78ad', ink: '#22304a' },
  { name: 'Volcano', sky: ['#2d1a2b', '#b04a36'], hill: ['#5e2c33', '#47222b'], solid: '#463840', top: '#f06a2c', plat: '#8a5a50', ink: '#160d14' },
  { name: 'Midnight', sky: ['#12163a', '#3b4184'], hill: ['#2a3068', '#212656'], solid: '#3c477a', top: '#7fd8c6', plat: '#6a74b8', ink: '#0b0d22' },
  { name: 'Sunset', sky: ['#ff95bd', '#ffe3bd'], hill: ['#f7a9c9', '#ee8fb8'], solid: '#9c5285', top: '#ffd3ea', plat: '#6f4494', ink: '#34183a' },
];
// Maps are authored as the LEFT HALF in cells and mirrored. s: solid [x,y,w,h], p: one-way platform [x,y,w]
const MAPS = [
  // small 22x13
  { n: 'Meadow', w: 22, h: 13, s: [[2, 11, 9, 2]], p: [[4, 8, 3], [9, 5, 2]] },
  { n: 'The Gap', w: 22, h: 13, s: [[1, 10, 7, 3]], p: [[9, 8, 2], [3, 6, 3], [9, 4, 2]] },
  { n: 'Ziggurat', w: 22, h: 13, s: [[1, 11, 10, 2], [5, 9, 6, 2], [8, 7, 3, 2]], p: [[2, 7, 2]] },
  { n: 'Rope Bridge', w: 22, h: 13, s: [[0, 8, 4, 5]], p: [[4, 8, 7], [6, 5, 5], [8, 11, 3]] },
  { n: 'Pillars', w: 22, h: 13, s: [[2, 7, 2, 6], [7, 10, 4, 3]], p: [[4, 9, 3], [5, 5, 3], [9, 7, 2]] },
  { n: 'Stepping Stones', w: 22, h: 13, s: [[1, 10, 3, 1], [6, 11, 3, 1], [10, 9, 1, 1]], p: [[3, 7, 3], [8, 5, 3]] },
  { n: 'Bowl', w: 22, h: 13, s: [[0, 6, 2, 7], [2, 10, 3, 3], [5, 12, 6, 1]], p: [[6, 9, 3], [9, 6, 2]] },
  { n: 'Shelves', w: 22, h: 13, s: [[3, 12, 8, 1]], p: [[1, 9, 5], [7, 9, 4], [4, 6, 4], [9, 3, 2]] },
  { n: 'Totem', w: 22, h: 13, s: [[10, 6, 1, 5], [2, 11, 7, 2]], p: [[3, 8, 3], [7, 5, 3], [1, 5, 2]] },
  { n: 'Chimney', w: 22, h: 13, s: [[0, 3, 1, 10], [1, 12, 8, 1]], p: [[1, 9, 4], [6, 9, 5], [3, 6, 5], [9, 6, 2], [1, 3, 3], [6, 3, 5]] },
  // medium 30x17
  { n: 'Savanna', w: 30, h: 17, s: [[2, 15, 13, 2]], p: [[4, 12, 4], [10, 12, 3], [7, 9, 4], [13, 6, 2], [2, 8, 2]] },
  { n: 'Canyon', w: 30, h: 17, s: [[0, 13, 6, 4], [9, 15, 6, 2]], p: [[6, 11, 3], [10, 12, 3], [3, 9, 3], [8, 8, 3], [13, 9, 2], [12, 5, 3]] },
  { n: 'Temple', w: 30, h: 17, s: [[1, 15, 14, 2], [4, 13, 2, 2], [10, 11, 5, 1], [13, 8, 2, 3]], p: [[2, 10, 3], [6, 8, 3], [10, 5, 3]] },
  { n: 'Floating Isles', w: 30, h: 17, s: [[1, 13, 4, 1], [7, 14, 4, 1], [13, 12, 2, 1], [3, 8, 3, 1], [9, 9, 3, 1]], p: [[6, 11, 2], [12, 6, 3], [6, 5, 3], [1, 5, 2]] },
  { n: 'Fortress', w: 30, h: 17, s: [[0, 15, 15, 2], [2, 9, 1, 6], [3, 9, 4, 1]], p: [[8, 12, 4], [11, 8, 4], [4, 5, 4], [9, 4, 3], [0, 12, 2]] },
  { n: 'Split', w: 30, h: 17, s: [[1, 15, 5, 2], [8, 15, 4, 2], [14, 13, 1, 4]], p: [[2, 12, 3], [6, 10, 3], [10, 11, 3], [3, 7, 4], [9, 6, 4], [13, 9, 2]] },
  { n: 'Stairway', w: 30, h: 17, s: [[0, 15, 4, 2], [4, 13, 3, 4], [7, 11, 3, 6], [10, 9, 3, 8], [13, 7, 2, 10]], p: [[2, 9, 3], [6, 6, 3]] },
  { n: 'Catwalks', w: 30, h: 17, s: [[0, 16, 2, 1], [6, 16, 3, 1], [13, 16, 2, 1]], p: [[1, 14, 6], [9, 14, 6], [4, 11, 6], [12, 11, 3], [1, 8, 5], [8, 8, 5], [5, 5, 5], [12, 4, 3]] },
  { n: 'The Pit', w: 30, h: 17, s: [[0, 10, 5, 7], [5, 15, 4, 2]], p: [[9, 13, 3], [13, 11, 2], [6, 7, 3], [11, 7, 3]] },
  { n: 'Towers', w: 30, h: 17, s: [[3, 9, 3, 8], [10, 10, 3, 7]], p: [[0, 12, 3], [6, 13, 4], [6, 9, 4], [13, 7, 2], [7, 4, 4], [13, 13, 2]] },
  { n: 'Arena', w: 30, h: 17, s: [[0, 5, 1, 12], [1, 15, 11, 2]], p: [[1, 11, 4], [7, 12, 4], [4, 8, 4], [10, 8, 5], [1, 5, 3], [7, 4, 4], [13, 12, 2]] },
  { n: 'Zigzag', w: 30, h: 17, s: [[0, 14, 7, 1], [9, 16, 6, 1]], p: [[8, 12, 5], [2, 10, 5], [8, 8, 5], [2, 6, 5], [9, 4, 6]] },
  // large 40x22
  { n: 'Great Plains', w: 40, h: 22, s: [[2, 20, 18, 2]], p: [[4, 17, 4], [10, 17, 4], [16, 16, 4], [6, 13, 5], [13, 12, 4], [2, 10, 3], [8, 9, 4], [15, 8, 5], [11, 5, 4]] },
  { n: 'Archipelago', w: 40, h: 22, s: [[1, 18, 5, 2], [8, 19, 4, 2], [14, 17, 4, 2], [19, 20, 1, 2]], p: [[5, 15, 3], [10, 14, 4], [16, 13, 4], [2, 12, 3], [6, 10, 4], [12, 9, 4], [17, 8, 3], [8, 6, 4], [14, 5, 4]] },
  { n: 'Citadel', w: 40, h: 22, s: [[0, 20, 20, 2], [3, 12, 1, 8], [4, 12, 5, 1], [12, 14, 1, 6], [13, 14, 4, 1], [18, 9, 2, 2]], p: [[5, 16, 4], [8, 9, 4], [14, 10, 3], [1, 8, 3], [5, 5, 4], [12, 6, 4], [16, 17, 4], [0, 17, 2], [1, 14, 2]] },
  { n: 'Sky Ladder', w: 40, h: 22, s: [[0, 21, 4, 1], [8, 21, 5, 1], [17, 21, 3, 1]], p: [[2, 19, 6], [10, 19, 6], [17, 19, 3], [5, 16, 6], [13, 16, 6], [2, 13, 6], [10, 13, 6], [17, 13, 3], [5, 10, 6], [13, 10, 6], [2, 7, 6], [10, 7, 6], [17, 7, 3], [7, 4, 6], [15, 4, 5]] },
  { n: 'Volcano', w: 40, h: 22, s: [[0, 20, 6, 2], [6, 18, 4, 4], [10, 15, 4, 7], [14, 12, 3, 10], [17, 14, 3, 8]], p: [[2, 16, 3], [5, 13, 4], [9, 10, 4], [1, 10, 3], [15, 8, 5], [5, 7, 4], [11, 5, 4]] },
  { n: 'Twin Peaks', w: 40, h: 22, s: [[2, 20, 6, 2], [4, 16, 3, 4], [11, 19, 5, 3], [13, 13, 2, 6]], p: [[8, 16, 3], [16, 16, 4], [8, 12, 4], [1, 12, 3], [15, 10, 5], [5, 9, 3], [10, 7, 4], [16, 5, 4]] },
  { n: 'Labyrinth', w: 40, h: 22, s: [[0, 20, 9, 2], [12, 20, 8, 2], [6, 15, 1, 5], [7, 15, 5, 1], [14, 11, 1, 6], [15, 11, 5, 1], [2, 10, 6, 1], [9, 6, 1, 4], [10, 6, 6, 1]], p: [[1, 16, 4], [9, 17, 3], [16, 16, 4], [10, 12, 3], [1, 6, 4], [3, 13, 3], [17, 7, 3], [5, 3, 5], [13, 3, 5]] },
  { n: 'Colosseum', w: 40, h: 22, s: [[0, 8, 2, 14], [2, 20, 7, 2], [11, 20, 9, 2], [2, 14, 3, 1], [2, 8, 3, 1]], p: [[6, 17, 4], [12, 16, 5], [6, 11, 5], [13, 12, 4], [17, 9, 3], [7, 6, 5], [14, 5, 5], [18, 14, 2]] },
];
const BOTS = {
  easy: { name: 'Easy', think: 40, react: 30, dodge: 0.1, speed: 0.7, err: 1.2, greedy: 0, los: 0 },
  normal: { name: 'Normal', think: 20, react: 14, dodge: 0.45, speed: 0.9, err: 0.6, greedy: 1, los: 0 },
  hard: { name: 'Hard', think: 10, react: 6, dodge: 0.8, speed: 1, err: 0.2, greedy: 1, los: 1 },
  impossible: { name: 'Impossible', think: 4, react: 1, dodge: 1, speed: 1, err: 0, greedy: 1, los: 1 },
};
