/* ============================================================================
   toast.js — transient confirmations, with undo where an action is destructive.
   ========================================================================== */

import { byId, esc, el } from '../core/dom.js';

let host = null;
const ensure = () => (host ||= byId('toasts'));

/**
 * @param {string} message
 * @param {object} opts { actionLabel, action, ms }
 */
export function toast(message, { actionLabel = '', action = null, ms = 4200 } = {}) {
  const node = el('div', 'toast');
  node.setAttribute('role', 'status');
  node.innerHTML = `<span>${esc(message)}</span>`;

  if (actionLabel && action) {
    const btn = el('button', '', esc(actionLabel));
    btn.addEventListener('click', () => { action(); dismiss(); });
    node.appendChild(btn);
  }

  let timer = setTimeout(dismiss, ms);
  node.addEventListener('mouseenter', () => clearTimeout(timer));
  node.addEventListener('mouseleave', () => { timer = setTimeout(dismiss, 1600); });

  function dismiss() {
    clearTimeout(timer);
    node.style.opacity = '0';
    node.style.transform = 'translateY(8px)';
    setTimeout(() => node.remove(), 220);
  }

  ensure()?.appendChild(node);
  return dismiss;
}

/** A toast that carries the undo for a destructive action. */
export const toastUndo = (message, undo) =>
  toast(message, { actionLabel: 'Undo', action: undo, ms: 7000 });
