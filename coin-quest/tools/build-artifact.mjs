// Bundles the app into ONE self-contained HTML body (no <html>/<head>), for previewing as a claude.ai artifact.
// The installable PWA is still index.html + js/ + sw.js; this is only a test build.
// Run: node tools/build-artifact.mjs <out.html>
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const ORDER = ['money', 'dates', 'debts', 'planner', 'budget', 'accounts', 'projection', 'recurring', 'state', 'storage', 'sprites', 'models', 'scenes', 'battlefx', 'ui', 'battle', 'chart', 'lock', 'app'];

// Each module runs in its own scope and hands back only what it exports, so private helpers with the
// same name in different files can't collide. Exported names are unique across the app.
const js = ORDER.map((name) => {
  const raw = read(`js/${name}.js`);
  const exportsList = [...raw.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  const src = raw
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?[ \t]*$/gm, '')
    .replace(/^export\s+(?=(async\s+)?function|const|let|class)/gm, '');
  if (/^\s*(import|export)\b/m.test(src)) throw new Error(`Unhandled import/export left in ${name}.js`);
  if (/^export\s+let\b/m.test(raw)) throw new Error(`${name}.js exports a let; export a function instead so bundling keeps it live`);
  if (!exportsList.length) return `// ---- ${name}.js ----\n(() => {\n${src}\n})();`;
  return `// ---- ${name}.js ----\nconst { ${exportsList.join(', ')} } = (() => {\n${src}\nreturn { ${exportsList.join(', ')} };\n})();`;
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
