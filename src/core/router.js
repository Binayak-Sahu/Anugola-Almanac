/* ============================================================================
   router.js — hash routing with deep links.

       #today                     a view
       #orchard/mango             a view plus a target
       #catalogue/red-diamond-guava

   Deep links matter here because the PWA manifest's shortcuts point at them
   and because "send me the page for that plant" is how you use this thing in
   a nursery car park.
   ========================================================================== */

const routes = new Map();
let current = { view: '', target: '' };
let fallback = 'today';
let onChange = () => {};

export function defineRoute(view, handler) { routes.set(view, handler); }
export function setFallback(view) { fallback = view; }
export function onRouteChange(fn) { onChange = fn; }

export const currentRoute = () => ({ ...current });

export function parseHash(hash = location.hash) {
  const raw = String(hash || '').replace(/^#/, '');
  const [view = '', ...rest] = raw.split('/');
  return { view: decodeURIComponent(view), target: decodeURIComponent(rest.join('/')) };
}

/** Navigate. `replace` avoids stacking history for programmatic redirects. */
export function go(view, target = '', { replace = false } = {}) {
  const hash = '#' + encodeURIComponent(view) + (target ? '/' + encodeURIComponent(target) : '');
  if (location.hash === hash) { resolve(); return; }
  if (replace) history.replaceState(null, '', hash);
  else location.hash = hash;
}

function resolve() {
  let { view, target } = parseHash();
  if (!view || !routes.has(view)) {
    view = fallback;
    target = '';
    history.replaceState(null, '', '#' + view);
  }
  const changedView = view !== current.view;
  current = { view, target };
  routes.get(view)?.(target, { changedView });
  onChange(current, { changedView });
}

export function startRouter() {
  addEventListener('hashchange', resolve);
  resolve();
}
