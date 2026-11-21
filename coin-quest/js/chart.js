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
  const all = opts.series.flatMap((s) => s.values);
  const max = Math.max(1, ...all);
  const min = Math.min(0, ...all); // projected balances can go below zero
  // Optional empty room on the left so "Today" (index todayAt) sits about todayFraction of the way in.
  const f = opts.todayFraction ?? 0;
  const pad = opts.todayAt != null && f > 0 ? Math.max(0, Math.ceil((f * (n - 1) - opts.todayAt) / (1 - f))) : 0;
  const span = Math.max(1, n - 1 + pad);
  const x = (i) => M.l + ((i + pad) / span) * (W - M.l - M.r);
  const y = (v) => M.t + (1 - (v - min) / (max - min)) * (H - M.t - M.b);
  // Index from which values are projected (drawn dashed); none if absent.
  const split = opts.splitAt ?? n - 1;
  charts.set(id, { ...opts, n, x, y, split, pad, span });
  // Where the Today marker goes: an explicit index, else where actual data ends and projection begins.
  const todayIdx = opts.todayAt ?? (split < n - 1 ? split : null);

  const grid = [min, (min + max) / 2, max, ...(min < 0 ? [0] : [])]
    .map((v) => `<line class="grid ${v === 0 && min < 0 ? 'zero' : ''}" x1="${M.l}" x2="${W - M.r}" y1="${y(v)}" y2="${y(v)}"/>`)
    .join('');
  const pts = (vals, from, to) => vals.slice(from, to + 1).map((v, j) => `${x(from + j).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const poly = (s, from, to, dashed) =>
    to > from
      ? `<polyline points="${pts(s.values, from, to)}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" ${dashed ? 'stroke-dasharray="5 5"' : ''}/>`
      : '';
  // Draw the first series last so it sits on top where lines overlap.
  const lines = opts.series
    .slice()
    .reverse()
    .map((s) => {
      // A lone actual point (nothing to connect yet) still gets a visible marker.
      const dot = split === 0 ? `<circle cx="${x(0)}" cy="${y(s.values[0])}" r="4" fill="${s.color}"/>` : '';
      return poly(s, 0, split, false) + poly(s, split, n - 1, true) + dot;
    })
    .join('');
  // Bottom labels: start, today (labelled at the top instead), and end. With room on the left the start is today.
  const tickIdx = [...new Set([pad && todayIdx === 0 ? null : 0, todayIdx != null && todayIdx > 0 ? null : Math.floor((n - 1) / 2), n - 1])].filter((i) => i != null);
  const ticks = tickIdx
    .map((i) => `<text class="tick" x="${x(i)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${esc(opts.xLabel(i))}</text>`)
    .join('');
  const nowLine = todayIdx != null
    ? `<line class="now" x1="${x(todayIdx)}" x2="${x(todayIdx)}" y1="${M.t}" y2="${H - M.b}"/><text class="tick today" x="${x(todayIdx)}" y="${M.t - 8}" text-anchor="middle">Today</text>`
    : '';

  return `
    <div class="chart" id="${id}">
      <div class="legend">${opts.series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}${split < n - 1 ? '<span><i class="dash"></i>Projected</span>' : ''}</div>
      <div class="chart-box">
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.ariaLabel)}">
          ${grid}
          <text class="tick" x="${M.l}" y="${M.t - 8}">${esc(opts.yFmt(max))}</text>
          ${min < 0 ? `<text class="tick" x="${W - M.r}" y="${y(min) - 4}" text-anchor="end">${esc(opts.yFmt(min))}</text>` : ''}
          ${nowLine}${lines}${ticks}
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
      const i = Math.max(0, Math.min(c.n - 1, Math.round(((px - M.l) / (W - M.l - M.r)) * c.span - c.pad)));
      const cx = c.x(i);
      cross.setAttribute('x1', cx);
      cross.setAttribute('x2', cx);
      cross.setAttribute('visibility', 'visible');
      dots.forEach((d, k) => {
        d.setAttribute('cx', cx);
        d.setAttribute('cy', c.y(c.series[k].values[i]));
        d.setAttribute('visibility', 'visible');
      });
      tip.innerHTML = `<b>${esc(c.xLabel(i))}${i > c.split ? ' (projected)' : ''}</b>${c.series
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
