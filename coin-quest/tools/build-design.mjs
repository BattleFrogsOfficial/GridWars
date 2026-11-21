// Builds the battle-screen design page. Run: node tools/build-design.mjs design/battle-design.template.html out.html
// Inlines models.js, scenes.js and battlefx.js into the design page (exports stripped, like the app's artifact build).
import { readFileSync, writeFileSync } from 'node:fs';
const strip = (src) => src.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?[ \t]*$/gm, '').replace(/^export\s+(?=(async\s+)?function|const|let|class)/gm, '');
const dir = new URL('../js/', import.meta.url).pathname;
let html = readFileSync(process.argv[2], 'utf8');
html = html.replace('/*__MODELS__*/', strip(readFileSync(dir + 'models.js', 'utf8'))).replace('/*__SCENES__*/', strip(readFileSync(dir + 'scenes.js', 'utf8'))).replace('/*__BATTLEFX__*/', strip(readFileSync(dir + 'battlefx.js', 'utf8')));
writeFileSync(process.argv[3], html);
console.log('wrote', process.argv[3], (html.length / 1024).toFixed(0) + ' KB');
