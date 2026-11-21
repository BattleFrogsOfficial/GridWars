// Bundles the app into ONE self-contained HTML body (no <html>/<head>), for previewing as a claude.ai artifact.
// The installable PWA is still index.html + js/ + sw.js; this is only a test build.
// Run: node tools/build-artifact.mjs <out.html>
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const ORDER = ['money', 'dates', 'debts', 'planner', 'budget', 'player', 'accounts', 'projection', 'state', 'storage', 'sprites', 'ui', 'chart', 'app'];

const js = ORDER.map((name) => {
  const src = read(`js/${name}.js`)
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?[ \t]*$/gm, '')
    .replace(/^export\s+(?=(async\s+)?function|const|let|class)/gm, '');
  if (/^\s*(import|export)\b/m.test(src)) throw new Error(`Unhandled import/export left in ${name}.js`);
  return `// ---- ${name}.js ----\n${src}`;
}).join('\n');

const html = read('index.html');
const body = html.match(/<body>([\s\S]*?)<script/)[1].trim();
const fonts = html.match(/<!-- FONTS -->([\s\S]*?)<!-- \/FONTS -->/)[1].trim();
const out = `<title>Coin Quest</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="theme-color" content="#121a3a">
${fonts}
<style>
${read('style.css')}
</style>
${body}
<script type="module">
${js}
</script>
`;
writeFileSync(process.argv[2] || 'coin-quest-artifact.html', out);
console.log('wrote', process.argv[2], (out.length / 1024).toFixed(1) + ' KB');
