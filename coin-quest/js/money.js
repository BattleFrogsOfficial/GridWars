// Money is always stored as integer cents so totals never drift from float rounding.

/** Parse user input like "1,234.56", "$20", "19.999" into integer cents. Returns null if invalid. */
export function parseMoney(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input * 100) : null;
  const s = String(input ?? '').trim().replace(/[\s,$€£¥₹]/g, '');
  const m = s.match(/^(-?)(\d*)(?:\.(\d*))?$/);
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) return null;
  const whole = parseInt(m[2] || '0', 10);
  const frac = (m[3] || '').padEnd(3, '0');
  let cents = whole * 100 + parseInt(frac.slice(0, 2), 10);
  if (Number(frac[2]) >= 5) cents += 1; // round half up on the third decimal
  return m[1] ? -cents : cents;
}

/** Parse a percentage like "24.99" or "24.99%" into a number (24.99). Returns null if invalid. */
export function parsePercent(input) {
  const s = String(input ?? '').trim().replace('%', '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n < 1000 ? n : null;
}

const formatters = new Map();
export function formatMoney(cents, currency = 'USD', { compact = false } = {}) {
  const key = currency + compact;
  if (!formatters.has(key)) {
    formatters.set(key, new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      ...(compact ? { notation: 'compact', maximumFractionDigits: 1 } : {}),
    }));
  }
  return formatters.get(key).format((cents || 0) / 100);
}

/** Cents to a plain editable string, e.g. 123456 -> "1234.56". */
export function centsToInput(cents) {
  if (cents == null) return '';
  const neg = cents < 0;
  const abs = Math.abs(cents);
  return (neg ? '-' : '') + Math.floor(abs / 100) + '.' + String(abs % 100).padStart(2, '0');
}
