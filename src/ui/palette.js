/* ============================================================================
   palette.js — Ctrl+K. One box that reaches everything.

   Sources are registered rather than hard-coded, so a new view adds its own
   entries without this file knowing anything about it. Providers are called
   lazily on open, so 225 catalogue rows are not walked on every keystroke of
   the rest of the app.
   ========================================================================== */

import { byId, esc } from '../core/dom.js';
import { rank, highlight } from './search.js';

const providers = [];
let items = [];
let filtered = [];
let selected = 0;
let open = false;

/**
 * Register a source of palette entries.
 * @param {function(): Array<{title, sub?, group, keys?, run: Function}>} fn
 */
export const registerProvider = (fn) => providers.push(fn);

const box = () => byId('pal');
const input = () => byId('palq');
const list = () => byId('pallist');

export function openPalette(prefill = '') {
  items = providers.flatMap((fn) => {
    try { return fn() || []; } catch (err) { console.error('[palette] provider failed', err); return []; }
  });
  open = true;
  box().classList.add('on');
  const q = input();
  q.value = prefill;
  q.focus();
  q.select();
  render(prefill);
}

export function closePalette() {
  open = false;
  box().classList.remove('on');
}

export const isOpen = () => open;

function render(query) {
  filtered = rank(items, query, {
    fields: [
      { key: 'title', weight: 1 },
      { key: 'sub', weight: 0.55 },
      { key: 'group', weight: 0.3 }
    ],
    limit: 40
  });
  selected = 0;
  paint();
}

function paint() {
  const el = list();
  if (!filtered.length) {
    el.innerHTML = '<div class="palempty">Nothing matches. Try a plant name, a zone letter, or “theme”.</div>';
    return;
  }
  el.innerHTML = filtered.map(({ item, ranges, field }, i) => `
    <div class="palrow ${i === selected ? 'sel' : ''}" data-i="${i}" role="option" aria-selected="${i === selected}">
      <div style="min-width:0">
        <div class="pt">${field === 'title' ? highlight(item.title, ranges) : esc(item.title)}</div>
        ${item.sub ? `<div class="ps">${field === 'sub' ? highlight(item.sub, ranges) : esc(item.sub)}</div>` : ''}
      </div>
      <span class="pk">${esc(item.keys || item.group || '')}</span>
    </div>`).join('');

  el.querySelector('.palrow.sel')?.scrollIntoView({ block: 'nearest' });
}

function move(delta) {
  if (!filtered.length) return;
  selected = (selected + delta + filtered.length) % filtered.length;
  paint();
}

function run(i = selected) {
  const hit = filtered[i];
  if (!hit) return;
  closePalette();
  try { hit.item.run(); } catch (err) { console.error('[palette] command failed', err); }
}

export function startPalette() {
  const q = input();

  q.addEventListener('input', () => render(q.value));

  q.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); run(); }
    else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
    else if (e.key === 'Tab') { e.preventDefault(); move(e.shiftKey ? -1 : 1); }
  });

  list().addEventListener('click', (e) => {
    const row = e.target.closest('.palrow');
    if (row) run(Number(row.dataset.i));
  });
  list().addEventListener('mousemove', (e) => {
    const row = e.target.closest('.palrow');
    if (row && Number(row.dataset.i) !== selected) { selected = Number(row.dataset.i); paint(); }
  });

  box().addEventListener('click', (e) => { if (e.target === box()) closePalette(); });

  addEventListener('keydown', (e) => {
    /* Ctrl/Cmd+K anywhere, including inside a text field. */
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      open ? closePalette() : openPalette();
      return;
    }
    if (open) return;
    /* "/" opens search, but not while the user is typing into something. */
    const typing = /^(input|textarea|select)$/i.test(e.target.tagName) || e.target.isContentEditable;
    if (e.key === '/' && !typing) { e.preventDefault(); openPalette(); }
  });
}
