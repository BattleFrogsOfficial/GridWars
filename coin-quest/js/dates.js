// Dates are stored as local calendar strings: "YYYY-MM-DD" for days, "YYYY-MM" for months.

const pad = (n) => String(n).padStart(2, '0');

export function todayISO(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function ymOf(iso) {
  return iso.slice(0, 7);
}

export function daysInMonth(year, month1) {
  return new Date(year, month1, 0).getDate();
}

export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
}

/** The date in month `ym` on which a debt with `dueDay` (1-31) is due; clamps to the month's last day. */
export function dueDateIn(ym, dueDay) {
  const [y, m] = ym.split('-').map(Number);
  return `${ym}-${pad(Math.min(dueDay, daysInMonth(y, m)))}`;
}

export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return todayISO(new Date(y, m - 1, d + n));
}

export function monthLabel(ym, opts = { month: 'long', year: 'numeric' }) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, opts);
}

export function dayLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function isValidISO(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}
