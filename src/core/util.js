/* ============================================================================
   util.js — dates, numbers, text. No DOM, no state. Pure and testable.
   ========================================================================== */

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const round = (v, dp = 0) => { const m = 10 ** dp; return Math.round(v * m) / m; };

export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONFULL = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/* ---------------------------------------------------------------- dates --- */

/** Local-midnight ISO date, `YYYY-MM-DD`. Never toISOString() — that is UTC,
    and at IST+5:30 it reports yesterday for anything logged before 05:30. */
export function iso(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function parseISO(s) {
  if (!s) return null;
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export const addDays = (d, n) => { const x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; };

export function daysBetween(a, b) {
  const x = typeof a === 'string' ? parseISO(a) : a;
  const y = typeof b === 'string' ? parseISO(b) : b;
  if (!x || !y) return null;
  return Math.round((y - x) / 864e5);
}

export const daysSince = (s) => daysBetween(s, new Date());

/** "in 4 days" / "3 days ago" / "today". Signed day counts read badly in a UI. */
export function relDays(n) {
  if (n === null || n === undefined) return '—';
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

/** Coarse duration for countdowns measured in years. */
export function humanSpan(days) {
  if (days == null) return '—';
  if (days < 0) return 'now';
  if (days < 45) return `${days} d`;
  const mo = Math.round(days / 30.4);
  if (mo < 24) return `${mo} mo`;
  return `${(days / 365.25).toFixed(1)} yr`;
}

/* ------------------------------------------------------------ formatting -- */
export const money = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN');
export const plural = (n, w, p) => `${n} ${n === 1 ? w : (p || w + 's')}`;
export const pct = (n) => `${Math.round(n * 100)}%`;

export const slugOf = (t) =>
  String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x';

/** First number in a free-text interval like "8–12 days" → 8. Returns null for
    prose such as "Rarely" so the caller can fall back to the written rule
    rather than inventing a schedule — the v8 watering bug. */
export function firstNumber(s) {
  const m = /(\d+(?:\.\d+)?)/.exec(String(s ?? ''));
  return m ? Number(m[1]) : null;
}

/** Midpoint of "8–12 days" → 10. Same null contract as firstNumber. */
export function midNumber(s) {
  const nums = String(s ?? '').match(/\d+(?:\.\d+)?/g);
  if (!nums || !nums.length) return null;
  if (nums.length === 1) return Number(nums[0]);
  return (Number(nums[0]) + Number(nums[1])) / 2;
}

/* ------------------------------------------------------------- functions -- */
export function debounce(fn, ms = 180) {
  let t;
  return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
}

export function throttle(fn, ms = 200) {
  let last = 0, timer = null, pending = null;
  return function (...args) {
    pending = args;
    const now = Date.now();
    const wait = ms - (now - last);
    if (wait <= 0) { last = now; fn.apply(this, pending); return; }
    if (!timer) timer = setTimeout(() => { timer = null; last = Date.now(); fn.apply(this, pending); }, wait);
  };
}

export const uid = (p = 'x') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export const deepClone = (o) => (typeof structuredClone === 'function'
  ? structuredClone(o)
  : JSON.parse(JSON.stringify(o)));

export const groupBy = (arr, key) => arr.reduce((acc, item) => {
  const k = typeof key === 'function' ? key(item) : item[key];
  (acc[k] ||= []).push(item);
  return acc;
}, {});

export const sum = (arr, f = (x) => x) => arr.reduce((a, x) => a + (f(x) || 0), 0);
