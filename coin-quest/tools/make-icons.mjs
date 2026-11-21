// Generates the home-screen icons from the sprite data. No dependencies.
// Run: node tools/make-icons.mjs   (from the coin-quest folder)
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { SPRITES, paletteFor } from '../js/sprites.js';

const BG = [0x1b, 0x14, 0x2e];
const SPRITE = 'dragon';
const TEMPER = 'furious';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) raw.set(pixel(x, y), y * (size * 3 + 1) + 1 + x * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

function icon(size, spritePx) {
  const rows = SPRITES[SPRITE];
  const pal = paletteFor(SPRITE, TEMPER);
  const scale = Math.floor(spritePx / 16);
  const off = Math.floor((size - scale * 16) / 2);
  return png(size, (x, y) => {
    const sx = Math.floor((x - off) / scale);
    const sy = Math.floor((y - off) / scale);
    const c = rows[sy]?.[sx];
    return c && c !== '.' && pal[c] ? hex(pal[c]) : BG;
  });
}

mkdirSync(new URL('../icons/', import.meta.url), { recursive: true });
const out = (name, buf) => writeFileSync(new URL(`../icons/${name}`, import.meta.url), buf);
out('icon-192.png', icon(192, 144));
out('icon-512.png', icon(512, 384));
out('icon-maskable-512.png', icon(512, 320)); // stays inside the 80% safe zone when masked to a circle
out('apple-touch-icon.png', icon(180, 144));
console.log('icons written');
