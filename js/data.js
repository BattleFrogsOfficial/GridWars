'use strict';
// ---------- Shared game data ----------
const TILE = 16, MW = 500, MH = 500;
const T = { DEEP: 0, SHALLOW: 1, PLAINS: 2, FOREST: 3, DESERT: 4, TUNDRA: 5, SWAMP: 6, HILLS: 7, PEAK: 8 };
const TERRAIN = [
  { name: 'Deep Water', foot: 0, horse: 0, farm: 0, col: [35, 79, 158], pro: 'Boats sail at full speed', con: 'Impassable without a boat' },
  { name: 'Shallows', foot: 0.4, horse: 0.4, farm: 0, col: [63, 134, 201], pro: 'Can be forded on foot; bridges and docks can be built', con: 'Very slow to wade through' },
  { name: 'Plains', foot: 1, horse: 1, farm: 1.3, col: [106, 168, 74], pro: 'Fast travel, best farmland (+30% food), ideal for horses', con: 'Few trees, little stone, no ore' },
  { name: 'Forest', foot: 0.8, horse: 0.7, farm: 1, col: [63, 125, 58], pro: 'Endless wood and plenty of berries', con: 'Slow travel through the trees' },
  { name: 'Desert', foot: 0.85, horse: 0.9, farm: 0.4, col: [217, 194, 122], pro: 'Rich in gold and stone', con: 'Almost no wood, farms yield 60% less' },
  { name: 'Tundra', foot: 0.75, horse: 0.7, farm: 0.5, col: [226, 234, 240], pro: 'Rich in iron ore', con: 'Slow travel, farms yield 50% less' },
  { name: 'Swamp', foot: 0.5, horse: 0.35, farm: 0.8, col: [91, 107, 58], pro: 'Lots of berries; a natural moat that bogs down attackers', con: 'Very slow, terrible for horses' },
  { name: 'Hills', foot: 0.6, horse: 0.35, farm: 0.3, col: [140, 131, 119], pro: 'Stone, iron and gold; archers and towers get bonus range', con: 'Slow climb, poor farmland' },
  { name: 'Mountain Peak', foot: 0, horse: 0, farm: 0, col: [94, 90, 98], pro: 'A natural wall', con: 'Impassable' },
];
const F = { NONE: 0, TREE: 1, ROCK: 2, IRON: 3, GOLD: 4, BERRY: 5, ROAD: 6, BRIDGE: 7 };
const FEAT = [null,
  { res: 'wood', amt: 30, name: 'Tree' }, { res: 'stone', amt: 80, name: 'Rock' }, { res: 'iron', amt: 60, name: 'Iron ore' },
  { res: 'gold', amt: 50, name: 'Gold ore' }, { res: 'food', amt: 40, name: 'Berry bush' }, null, null];
const RES = ['wood', 'stone', 'food', 'iron', 'gold'];
const RESCOL = { wood: '#a0622a', stone: '#a9a9a9', food: '#e0503f', iron: '#7f93a8', gold: '#f0c62a' };
const TEAM = ['#3b7dd8', '#d83b3b', '#a04be0', '#f0922a'];
const TEAMNAME = ['Blue', 'Red', 'Purple', 'Orange'];
const BUILD_R = 14, AGGRO = 7, CARRY = 10;
const TRADE = { lot: 50, sell: 15, buy: 40 };

const BLD = {
  townhall: { name: 'Town Hall', size: 3, hp: 1500, cost: {}, time: 1, drop: true, atk: { dmg: 6, range: 5.5, cd: 1.5 }, desc: 'Heart of your village. Workers drop resources here.' },
  house: { name: "Worker's Home", hp: 300, cost: { wood: 60 }, time: 15, desc: 'Houses 2 workers and raises army cap by 4.' },
  storage: { name: 'Storage', hp: 400, cost: { wood: 80 }, time: 15, drop: true, desc: 'Drop-off point. Build near resources to save walking.' },
  shop: { name: 'Shop', hp: 400, cost: { wood: 100, stone: 40 }, time: 20, desc: 'Buy buildings and trade resources for gold.' },
  farm: { name: 'Farm', hp: 200, cost: { wood: 50 }, time: 12, food: 0.5, desc: 'Grows food. Yield depends on the biome.' },
  pen: { name: 'Animal Pen', hp: 250, cost: { wood: 90, food: 30 }, time: 15, food: 0.45, flat: true, desc: 'Livestock for food. Works in any biome.' },
  barracks: { name: 'Barracks', hp: 700, cost: { wood: 120, stone: 40 }, time: 25, train: ['spear', 'archer', 'sword', 'champion'], desc: 'Trains foot soldiers.' },
  stable: { name: 'Stable', hp: 600, cost: { wood: 140, food: 60 }, time: 25, train: ['scout', 'lancer'], desc: 'Trains fast horse riders.' },
  blacksmith: { name: 'Blacksmith', hp: 600, cost: { wood: 100, stone: 80, iron: 40 }, time: 30, desc: 'Forges steel: unlocks steel troops and upgrades.' },
  siege: { name: 'Siege Workshop', hp: 600, cost: { wood: 180, stone: 60 }, time: 30, train: ['ram', 'catapult'], desc: 'Builds rams and catapults to break walls.' },
  dock: { name: 'Dock', hp: 500, cost: { wood: 120 }, time: 20, water: true, train: ['boat', 'galley'], desc: 'Builds boats. Place on water touching the shore.' },
  tower: { name: 'Watchtower', hp: 550, cost: { wood: 60, stone: 80 }, time: 20, atk: { dmg: 11, range: 6.5, cd: 1.2 }, desc: 'Shoots arrows at enemies. Extra range on hills.' },
  wall: { name: 'Palisade', hp: 350, cost: { wood: 12 }, time: 4, wall: true, desc: 'Cheap wooden wall.' },
  swall: { name: 'Stone Wall', hp: 950, cost: { stone: 15 }, time: 6, wall: true, desc: 'Sturdy stone wall.' },
  gate: { name: 'Gate', hp: 550, cost: { wood: 30, stone: 10 }, time: 6, wall: true, gate: true, desc: 'Only your own units can pass.' },
  road: { name: 'Road', tile: F.ROAD, cost: { stone: 2 }, desc: 'Units move 50% faster than on plains, on any land.' },
  bridge: { name: 'Bridge', tile: F.BRIDGE, cost: { wood: 15 }, desc: 'Cross shallow water at full speed. Blocks boats.' },
};
const UNIT = {
  worker: { name: 'Worker', hp: 40, dmg: 3, range: 1.2, cd: 1, speed: 2.2, cls: 'foot', civil: true, time: 12 },
  spear: { name: 'Spearman', hp: 70, dmg: 8, range: 1.3, cd: 1, speed: 2.2, cls: 'foot', cost: { food: 40, wood: 20 }, time: 10, desc: 'Cheap wooden-spear infantry.' },
  archer: { name: 'Archer', hp: 45, dmg: 7, range: 5, cd: 1.3, speed: 2.3, cls: 'foot', cost: { food: 35, wood: 35 }, time: 12, desc: 'Ranged. +1 range on hills.' },
  sword: { name: 'Iron Swordsman', hp: 115, dmg: 13, range: 1.3, cd: 1, speed: 2.1, cls: 'foot', cost: { food: 50, iron: 25 }, time: 14, desc: 'Tough iron-armed infantry.' },
  champion: { name: 'Steel Champion', hp: 190, dmg: 21, range: 1.3, cd: 1, speed: 2.1, cls: 'foot', cost: { food: 70, iron: 50, gold: 15 }, time: 20, req: 'blacksmith', desc: 'Steel sword and armor. The finest warrior.' },
  scout: { name: 'Horse Scout', hp: 80, dmg: 8, range: 1.3, cd: 1, speed: 4.2, cls: 'horse', cost: { food: 60, wood: 20 }, time: 14, desc: 'Very fast rider. Weak in swamps and hills.' },
  lancer: { name: 'Steel Lancer', hp: 175, dmg: 20, range: 1.4, cd: 1.1, speed: 3.8, cls: 'horse', cost: { food: 90, iron: 45, gold: 15 }, time: 22, req: 'blacksmith', desc: 'Heavy steel cavalry.' },
  ram: { name: 'Battering Ram', hp: 280, dmg: 6, bld: 8, range: 1.3, cd: 1.5, speed: 1.4, cls: 'foot', bldOnly: true, cost: { wood: 150, iron: 10 }, time: 22, desc: 'Smashes buildings and walls. Cannot fight troops.' },
  catapult: { name: 'Catapult', hp: 90, dmg: 10, bld: 5, range: 7.5, cd: 3, speed: 1.3, cls: 'foot', cost: { wood: 160, stone: 60, iron: 20 }, time: 26, desc: 'Long-range siege weapon.' },
  boat: { name: 'Transport Boat', hp: 220, dmg: 0, range: 0, cd: 1, speed: 3.6, cls: 'boat', cap: 10, cost: { wood: 100 }, time: 16, desc: 'Carries up to 10 units across water.' },
  galley: { name: 'War Galley', hp: 280, dmg: 12, range: 5.5, cd: 1.5, speed: 3.3, cls: 'boat', cost: { wood: 160, iron: 20 }, time: 22, desc: 'Warship with archers aboard.' },
};
const UNAMES = Object.keys(UNIT), BNAMES = Object.keys(BLD);
const BUILD_MENU = ['house', 'storage', 'farm', 'pen', 'barracks', 'stable', 'blacksmith', 'siege', 'dock', 'tower', 'wall', 'swall', 'gate', 'road', 'bridge', 'shop'];
const DIFF = {
  easy: { name: 'Easy', rate: 0.7, wave: 6, first: 8 * 600 },
  normal: { name: 'Normal', rate: 1, wave: 9, first: 5 * 600 },
  hard: { name: 'Hard', rate: 1.5, wave: 12, first: 3.5 * 600 },
};
function upgCost(l) { return { iron: 60 * (l + 1), gold: 30 * (l + 1) }; }
