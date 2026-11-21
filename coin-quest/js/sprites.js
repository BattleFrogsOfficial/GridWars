// Pixel-art sprites as text grids. Each character is a palette slot; '.' is transparent.
//   o outline   b body   d body shade   l body highlight   w wing
//   e eye white p pupil  t horn/tooth   f fire
// Body slots (b/d/l/w) are recolored by the debt's temper (APR); the rest are fixed.
// Placeholder art: the final look comes in the art pass.

export const SPRITES = {
  slime: [
    '................',
    '................',
    '................',
    '................',
    '......oooo......',
    '....oolllboo....',
    '...olllbbbbbo...',
    '..olbbbbbbbbbo..',
    '..obeebbbbeebo..',
    '.obbepbbbbepbbo.',
    '.obbbbbbbbbbbbo.',
    '.obbbbddddbbbbo.',
    '.obbbbbbbbbbbdo.',
    '.odbbbbbbbbbddo.',
    '..oddddddddddo..',
    '...oooooooooo...',
  ],
  goblin: [
    '................',
    '.....oooooo.....',
    'o...obllbbbo...o',
    'obo.obbbbbbo.obo',
    'obboobbbbbbbobbo',
    '.obbbeebbeebbbo.',
    '..obbepbbpebbo..',
    '...obbbbbbbbo...',
    '...obtdttdtbo...',
    '....obbbbbbo....',
    '....oddddddo....',
    '...obddddddbo...',
    '...oboddddobo...',
    '....ooddddoo....',
    '.....obo.obo....',
    '....ooo..ooo....',
  ],
  troll: [
    '..t..........t..',
    '..tt..oooo..tt..',
    '...ttobbbbott...',
    '....obbbbbbo....',
    '...obeebbeebo...',
    '...obpebbepbo...',
    '...obbbddbbbo...',
    '...obtbbbbtbo...',
    '.oooobbbbbboooo.',
    'obbbbbddddbbbbbo',
    'obbobbddddbbobbo',
    'obbobbbbbbbbobbo',
    'oddoddddddddoddo',
    '.oo.obbbbbbo.oo.',
    '....obbo..obbo..',
    '...ooooo..ooooo.',
  ],
  drake: [
    '................',
    '..tt......o.....',
    '..otoo...owo....',
    '.obbbbo.owwo....',
    'obebbbbbowwwo...',
    'obpbbbbbbowwo...',
    'obbbbbbbbbowo...',
    '.offbbbbbbbbo...',
    '..oo.obbbbbbbo..',
    '.....oblllbbbbo.',
    '.....obllldbbbbo',
    '....obblldbo.obo',
    '....obbbddbo..oo',
    '....obo..obo....',
    '...ooo..ooo.....',
    '................',
  ],
  dragon: [
    'o....t....t....o',
    'ow...to..ot...wo',
    'oww..obbbbo..wwo',
    'owwwoepbbpeowwwo',
    'owwwobbbbbbowwwo',
    'owwwobtbbtbowwwo',
    'oww.obffffbo.wwo',
    'ow..oobbbboo..wo',
    'o..obbllllbbo..o',
    '..obbllllllbbo..',
    '.obbbllllllbbbo.',
    '.obbbbllllbbbbo.',
    '.obdbbbbbbbbdbo.',
    '.obbo.obbo.obbo.',
    '.oto..oddo..oto.',
    '................',
  ],
  castle: [
    'o.o.o......o.o.o',
    'ooooo......ooooo',
    'obbbo......obbbo',
    'obpbo......obpbo',
    'obbboo.oo.oobbbo',
    'obbboooooooobbbo',
    'obbbbbbbbbbbbbbo',
    'obbbbepbbpebbbbo',
    'obbbbbbbbbbbbbbo',
    'odbbbbbbbbbbbbdo',
    'obbbbboooobbbbbo',
    'obbbbbottobbbbbo',
    'obbbbboppobbbbbo',
    'odddddoppodddddo',
    'oooooooooooooooo',
    '................',
  ],
  hero: [
    '.....oooooo.....',
    '....offffffo....',
    '...offfffffo....',
    '...ollllllllo...',
    '...olpllllplo...',
    '...ollllllllo...',
    '....olllllo.....',
    '..oooobbbboooo..',
    '.otobbbbbbbbobo.',
    '.otobbdbbdbbobo.',
    '.otobbbbbbbbolo.',
    '.ooodddddddoooo.',
    '....obbbbbbo....',
    '....obbo.obbo...',
    '....odo...odo...',
    '...ooo....ooo...',
  ],
};

const FIXED = { o: '#1a1020', e: '#ffffff', p: '#1a1020', t: '#f0e6c8', f: '#ff7a1a' };

export const TEMPER_PALETTES = {
  calm: { b: '#5fbf5f', d: '#3a8a4a', l: '#9be38f', w: '#2f6e3c' },
  angry: { b: '#e0902f', d: '#a85f1d', l: '#f5c071', w: '#7f4314' },
  furious: { b: '#d63a3a', d: '#8f1f2a', l: '#f07a6a', w: '#5e1420' },
};

const SPECIAL_PALETTES = {
  castle: { b: '#8a8aa0', d: '#5a5a70', l: '#b4b4c8', w: '#5a5a70', p: '#2a1a30' },
  hero: { b: '#3a6ad6', d: '#24479a', l: '#f2c39a', w: '#24479a', f: '#7a4a24', t: '#c8d0e0' },
};

export function paletteFor(spriteKey, temperKey = 'calm') {
  return { ...FIXED, ...(TEMPER_PALETTES[temperKey] || TEMPER_PALETTES.calm), ...(SPECIAL_PALETTES[spriteKey] || {}) };
}

/** Castles are tinted by temper only in their eyes, so a high-interest mortgage still reads as angry. */
export function eyeTint(spriteKey, temperKey) {
  if (spriteKey !== 'castle') return null;
  return { calm: '#ffe680', angry: '#ffb040', furious: '#ff4040' }[temperKey];
}

/** Draw onto a 2D canvas context (browser) at integer scale. */
export function drawSprite(ctx, spriteKey, temperKey, scale, ox = 0, oy = 0) {
  const rows = SPRITES[spriteKey];
  const pal = paletteFor(spriteKey, temperKey);
  const tint = eyeTint(spriteKey, temperKey);
  if (tint) pal.e = tint;
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const c = rows[y][x];
      if (c === '.' || !pal[c]) continue;
      ctx.fillStyle = pal[c];
      ctx.fillRect(ox + x * scale, oy + y * scale, scale, scale);
    }
  }
}
