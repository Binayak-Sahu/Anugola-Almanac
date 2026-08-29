/* ============================================================================
   theme.js — two skins x three mode settings (auto/light/dark).

   The mode the user CHOSE and the mode currently RENDERED are different
   things. `auto` is a choice; `dark` is what auto resolved to at 8 pm. Both
   are kept, because a UI that shows "Dark" selected when the user picked
   "Auto" is lying, and because the OS can change under us at sunset.

       data-skin       jungle | precision
       data-mode       light | dark          (resolved — what CSS matches on)
       data-mode-pref  auto | light | dark   (the user's choice)
   ========================================================================== */

import { setSetting, get } from '../core/store.js';

export const SKINS = [
  { k: 'jungle', label: 'Jungle', hint: 'Lush, editorial, warm. Serif headings and canopy light.' },
  { k: 'precision', label: 'Precision', hint: 'Instrument panel. Grotesk, hairlines, blueprint grid, denser data.' }
];

export const MODES = [
  { k: 'auto', label: 'Auto', hint: 'Follows the phone' },
  { k: 'light', label: 'Light', hint: '' },
  { k: 'dark', label: 'Dark', hint: '' }
];

const THEME_COLORS = {
  'jungle:light': '#E7EBE4', 'jungle:dark': '#0E1411',
  'precision:light': '#F6F7F8', 'precision:dark': '#0A0B0C'
};

const mql = matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set();

export const onThemeChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

export function resolvedMode(pref = get().settings.mode) {
  return pref === 'auto' ? (mql.matches ? 'dark' : 'light') : pref;
}

export function current() {
  const s = get().settings;
  return { skin: s.skin, mode: s.mode, resolved: resolvedMode(s.mode) };
}

/** Write the theme to the document. Does not persist — see setSkin/setMode. */
export function apply({ skin, mode } = {}) {
  const s = get().settings;
  const nextSkin = skin || s.skin;
  const pref = mode || s.mode;
  const resolved = resolvedMode(pref);

  const root = document.documentElement;
  root.setAttribute('data-skin', nextSkin);
  root.setAttribute('data-mode', resolved);
  root.setAttribute('data-mode-pref', pref);

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLORS[`${nextSkin}:${resolved}`] || '#E7EBE4');

  for (const fn of listeners) fn({ skin: nextSkin, mode: pref, resolved });
  return { skin: nextSkin, mode: pref, resolved };
}

export function setSkin(skin) {
  setSetting('skin', skin);
  return apply({ skin });
}

export function setMode(mode) {
  setSetting('mode', mode);
  return apply({ mode });
}

/** Cycle light → dark → auto. Bound to the rail button and to the `t` key. */
export function cycleMode() {
  const order = ['light', 'dark', 'auto'];
  const i = order.indexOf(get().settings.mode);
  return setMode(order[(i + 1) % order.length]);
}

export function toggleSkin() {
  return setSkin(get().settings.skin === 'jungle' ? 'precision' : 'jungle');
}

/** Start watching the OS preference. Only matters while mode === 'auto'. */
export function startTheme() {
  const onSystem = () => { if (get().settings.mode === 'auto') apply(); };
  if (mql.addEventListener) mql.addEventListener('change', onSystem);
  else mql.addListener(onSystem);          // Safari < 14
  apply();
}

/* --------------------------------------------------------------- markup --- */

/** The theme control used in the rail footer and in Settings. */
export function themePicker() {
  const { skin, mode } = current();
  const skins = SKINS.map((s) => `
    <button class="chip ${s.k === skin ? 'on' : ''}" data-act="skin" data-skin="${s.k}"
            title="${s.hint}" aria-pressed="${s.k === skin}">${s.label}</button>`).join('');
  const modes = MODES.map((m) => `
    <button class="chip ${m.k === mode ? 'on' : ''}" data-act="mode" data-mode="${m.k}"
            aria-pressed="${m.k === mode}">${m.label}</button>`).join('');

  return `
    <div class="themepick">
      <div class="eyebrow">Theme</div>
      <div class="row">${skins}</div>
      <div class="row" style="margin-top:6px">${modes}</div>
    </div>`;
}
