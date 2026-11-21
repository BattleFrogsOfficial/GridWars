// Minimal SVG line chart with a crosshair tooltip. One y-axis, thin 2px lines, legend + hover.
// Series colors were checked with the palette validator against the dark card surface.

import { esc } from './ui.js';

export const SERIES_COLORS = { plan: '#c07d18', baseline: '#7a8ae6' };

const W = 340;
const H = 190;
const M = { l: 6, r: 6, t: 22, b: 26 };
const charts = new Map();
let nextId = 0;

/**
 * @param {{ series: {key:string, name:string, color:string, values:number[]}[],
 *           xLabel: (i:number)=>string, yFmt: (v:number)=>string, ariaLabel: string }} opts
 * values[i] is the value at x = i; every series has the same length.
 */
export function lineChart(opts) {
  const id = 'chart' + nextId++;
  const n = opts.series[0].values.length;
  const max = Math.max(1, ...opts.series.flatMap((s) => s.values));
  const x = (i) => M.l + (i / Math.max(1, n - 1)) * (W - M.l - M.r);
  const y = (v) => M.t + (1 - v / max) * (H - M.t - M.b);
  charts.set(id, { ...opts, n, x, y });

  const grid = [0, 0.5, 1]
    .map((f) => `<line class="grid" x1="${M.l}" x2="${W - M.r}" y1="${y(max * f)}" y2="${y(max * f)}"/>`)
    .join('');
  // Draw the first series last so it sits on top where lines overlap.
  const lines = opts.series
    .slice()
    .reverse()
    .map((s) => {
      const pts = s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
      return `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    })
    .join('');
  const ticks = [0, Math.floor((n - 1) / 2), n - 1]
    .map((i, k) => `<text class="tick" x="${x(i)}" y="${H - 8}" text-anchor="${['start', 'middle', 'end'][k]}">${esc(opts.xLabel(i))}</text>`)
    .join('');

  return `
    <div class="chart" id="${id}">
      <div class="legend">${opts.series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>
      <div class="chart-box">
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.ariaLabel)}">
          ${grid}
          <text class="tick" x="${M.l}" y="${M.t - 8}">${esc(opts.yFmt(max))}</text>
          ${lines}${ticks}
          <line class="cross" x1="0" x2="0" y1="${M.t}" y2="${H - M.b}" visibility="hidden"/>
          ${opts.series.map((s) => `<circle class="dot" data-key="${s.key}" r="4" fill="${s.color}" visibility="hidden"/>`).join('')}
          <rect class="hit" x="0" y="0" width="${W}" height="${H}" fill="transparent"/>
        </svg>
        <div class="chart-tip" hidden></div>
      </div>
    </div>`;
}

/** Wire hover/tap tooltips for every chart inside root. */
export function attachCharts(root) {
  for (const el of root.querySelectorAll('.chart')) {
    const c = charts.get(el.id);
    if (!c) continue;
    const svg = el.querySelector('svg');
    const tip = el.querySelector(".chart-tip");
    const cross = el.querySelector('.cross');
    const dots = el.querySelectorAll('.dot');
    const show = (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(c.n - 1, Math.round(((px - M.l) / (W - M.l - M.r)) * (c.n - 1))));
      const cx = c.x(i);
      cross.setAttribute('x1', cx);
      cross.setAttribute('x2', cx);
      cross.setAttribute('visibility', 'visible');
      dots.forEach((d, k) => {
        d.setAttribute('cx', cx);
        d.setAttribute('cy', c.y(c.series[k].values[i]));
        d.setAttribute('visibility', 'visible');
      });
      tip.innerHTML = `<b>${esc(c.xLabel(i))}</b>${c.series
        .map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)} <b>${esc(c.yFmt(s.values[i], true))}</b></span>`)
        .join('')}`;
      tip.hidden = false;
      const left = (cx / W) * r.width;
      tip.style.left = Math.min(Math.max(left - tip.offsetWidth / 2, 0), r.width - tip.offsetWidth) + 'px';
    };
    const hide = () => {
      tip.hidden = true;
      cross.setAttribute('visibility', 'hidden');
      dots.forEach((d) => d.setAttribute('visibility', 'hidden'));
    };
    svg.addEventListener('pointermove', show);
    svg.addEventListener('pointerdown', show);
    svg.addEventListener('pointerleave', hide);
  }
}
