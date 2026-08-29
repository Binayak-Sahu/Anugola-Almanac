/* ============================================================================
   dom.js — the smallest useful view layer.

   Views return HTML strings. `esc` is mandatory on anything that came from
   the user or from JSON. `mount` writes once per render, so there is no
   virtual DOM to reason about and no framework to keep up with.

   Events are delegated from a single document listener via data-act, which
   means innerHTML can be replaced freely without leaking listeners — the
   failure mode the v9 monolith had to work around by hand.
   ========================================================================== */

export const $ = (sel, root = document) =>
  (sel[0] === '#' && !/[ .>\[:]/.test(sel) ? root.getElementById?.(sel.slice(1)) ?? root.querySelector(sel) : root.querySelector(sel));
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
export const byId = (id) => document.getElementById(id);

const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ENT[c]);

/** Tagged template that escapes every interpolation unless it is wrapped in
    raw(). Makes the safe thing the default and the unsafe thing visible. */
const RAW = Symbol('raw');
export const raw = (s) => ({ [RAW]: String(s ?? '') });

export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i];
    out += renderVal(v) + strings[i + 1];
  }
  return out;
}

function renderVal(v) {
  if (v == null || v === false) return '';
  if (Array.isArray(v)) return v.map(renderVal).join('');
  if (typeof v === 'object' && RAW in v) return v[RAW];
  return esc(v);
}

/** Replace a container's content. Returns the container for chaining. */
export function mount(target, markup) {
  const node = typeof target === 'string' ? byId(target) : target;
  if (!node) return null;
  node.innerHTML = typeof markup === 'string' ? markup : String(markup ?? '');
  return node;
}

export function el(tag, cls, inner) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (inner != null) n.innerHTML = inner;
  return n;
}

/* ----------------------------------------------------- delegated events --- */
const handlers = new Map();

/** Register a handler for elements carrying data-act="name".
    The callback receives (element, event, dataset). */
export function on(action, fn) { handlers.set(action, fn); }

function dispatch(e) {
  const node = e.target.closest?.('[data-act]');
  if (!node) return;
  const fn = handlers.get(node.dataset.act);
  if (!fn) return;
  // Let a real link with a modifier key behave like a link.
  if (e.type === 'click' && (e.metaKey || e.ctrlKey) && node.tagName === 'A') return;
  e.preventDefault();
  fn(node, e, node.dataset);
}

export function startDelegation() {
  document.addEventListener('click', dispatch);
  document.addEventListener('change', (e) => {
    const node = e.target.closest?.('[data-act]');
    if (node && node.matches('input,select,textarea')) dispatch(e);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const node = e.target.closest?.('[data-act][role="button"]');
    if (node) dispatch(e);
  });
}

/* ------------------------------------------------------------- svg icons -- */
/* One place for stroke icons so views never paste path data. */
export const ICON = {
  sun: '<path d="M12 3v2M5.6 5.6l1.4 1.4M3 12h2M19 12h2M17 7l1.4-1.4"/><circle cx="12" cy="13" r="4"/><path d="M8 21h8"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8.2 8.2 0 1 0 10.5 10.5Z"/>',
  pot: '<path d="M6 10h12l-1.6 10H7.6z"/><path d="M12 10V6"/><path d="M12 7c-2.4 0-4-1.5-4-3.4C10.4 3.6 12 5.1 12 7Z"/>',
  tree: '<path d="M8 20h8l-1 3H9z"/><path d="M12 20v-8"/><circle cx="12" cy="8" r="5.5"/>',
  book: '<path d="M4 5h7v14H4zM13 5h7v14h-7z"/><path d="M7 9h1M16 9h1"/>',
  seed: '<path d="M12 21c-5 0-8-3-8-8 5 0 8 3 8 8Z"/><path d="M12 21c0-6 3-10 8-11 0 6-3 10-8 11Z"/><path d="M12 21v-4"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M17.5 14v7M14 17.5h7"/>',
  flask: '<path d="M7 3h10l-1 6H8z"/><path d="M9 9v3a3 3 0 0 0 6 0V9"/><path d="M12 15v6"/><path d="M9 21h6"/>',
  bag: '<path d="M6 8h12l-1.4 12H7.4z"/><path d="M6 8V6h12v2"/><path d="M9.5 13h5"/>',
  chart: '<path d="M4 18 9 11l4 4 7-9"/><path d="M4 21h17"/>',
  layers: '<path d="M3 16h18M3 20h18"/><path d="M7 12a5 5 0 0 1 10 0Z"/>',
  cart: '<path d="M5 7h14l-1.2 12H6.2z"/><path d="M9 7a3 3 0 0 1 6 0"/>',
  heart: '<path d="M12 20s-7-4.4-7-9.4A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7 2.6c0 5-7 9.4-7 9.4Z"/>',
  chip: '<path d="M12 4a4 4 0 0 0-4 4v8a4 4 0 0 0 8 0V8a4 4 0 0 0-4-4Z"/><path d="M8 10h8M8 14h8"/>',
  mushroom: '<path d="M4 12a8 8 0 0 1 16 0Z"/><path d="M10 12v6a2 2 0 0 0 4 0v-6"/>',
  thermo: '<path d="M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0Z"/><path d="M12 9v6"/>',
  drop: '<path d="M12 3s6 6.5 6 10.5a6 6 0 0 1-12 0C6 9.5 12 3 12 3Z"/>',
  dots: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
  camera: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.4"/>',
  swatch: '<path d="M4 4h7v16H4z"/><path d="M11 11h9v9h-9z"/>'
};

export const icon = (name, cls = '') =>
  `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[name] || ''}</svg>`;
