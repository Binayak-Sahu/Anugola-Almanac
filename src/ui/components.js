/* ============================================================================
   components.js — render primitives shared across views.

   Every function returns an HTML string. Nothing here touches state or the
   DOM, so a component can be unit-tested by comparing strings, and views can
   compose them freely.
   ========================================================================== */

import { esc, icon } from '../core/dom.js';
import { humanSpan, relDays, MON, clamp } from '../core/util.js';
import { VERDICT_LBL, SITE_LBL, DIFF_LBL, TOX_LBL } from '../core/data.js';

/* ------------------------------------------------------------------ chips - */

export const chip = (label, { tone = '', dot = false, title = '', mono = false } = {}) =>
  `<span class="chip ${tone ? 'tone-' + tone : ''} ${mono ? 'tone-mono' : ''}"${title ? ` title="${esc(title)}"` : ''}>${
    dot ? '<i class="dotc"></i>' : ''}${esc(label)}</span>`;

export const zoneChip = (site) =>
  `<span class="chip tone-zone" data-zone="${esc(site)}">${esc(SITE_LBL[site] || site)}</span>`;

export const verdictChip = (verdict) => {
  if (!verdict) return '';
  const [tone, label] = VERDICT_LBL[verdict] || ['', verdict];
  return chip(label, { tone: tone === 'ok' ? 'ok' : tone === 'watch' ? 'watch' : 'no', dot: true });
};

/* ------------------------------------------------------------------ facts - */

/** A definition grid. `entries` is [[label, value], ...]; falsy values drop. */
export const facts = (entries) => {
  const rows = entries.filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (!rows.length) return '';
  return `<dl class="facts">${rows.map(([k, v]) =>
    `<div class="fact"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
};

/* ---------------------------------------------------------------- meters -- */

export const meter = (fraction, stressLevel = null) => {
  const w = clamp(Number(fraction) || 0, 0, 1) * 100;
  return `<div class="meter ${stressLevel !== null ? 's' + stressLevel : ''}"><i style="width:${w.toFixed(1)}%"></i></div>`;
};

/* ---------------------------------------------------- the bag ladder ----- */

/**
 * Horizontal progression: 15×15 → 20×20 → 24×24, showing where the tree is
 * standing and when the next move is due.
 * @param {object} ladder result of engine/orchard.bagLadder()
 */
export function bagLadderBar(ladder) {
  if (!ladder?.rungs?.length) return '';
  return `<div class="ladder">${ladder.rungs.map((r) => {
    const cls = r.status === 'current' ? 'now' : (r.status === 'done' ? 'done' : '');
    const when = r.onISO
      ? `potted ${r.onISO}`
      : (r.dueInDays !== null && r.dueInDays !== undefined
        ? relDays(r.dueInDays)
        : (r.trigger?.kind === 'height' ? `at ${r.trigger.height} ft` : esc(r.trigger?.text || '')));
    return `<div class="rung ${cls}" title="${esc(r.trigger?.text || '')}">
        <div class="bar"></div>
        <div class="sz">${esc(r.size)}</div>
        <div class="when">${esc(r.litres)} · ${esc(when)}</div>
      </div>`;
  }).join('')}</div>`;
}

/* --------------------------------------------------------------- steppers - */

/**
 * @param {Array<{title, body, why?, state?}>} steps  state: done | now | future
 */
export const stepper = (steps) => `<div class="steps">${steps.map((s, i) => `
  <div class="step ${s.state || ''}">
    <div class="pip">${s.state === 'done' ? '<svg viewBox="0 0 24 24" style="width:12px;height:12px;stroke:currentColor;fill:none;stroke-width:3">' + icon('check').replace(/<\/?svg[^>]*>/g, '') + '</svg>' : i + 1}</div>
    <div>
      <h4>${esc(s.title)}</h4>
      ${s.body ? `<p>${esc(s.body)}</p>` : ''}
      ${s.why ? `<div class="why">${esc(s.why)}</div>` : ''}
    </div>
  </div>`).join('')}</div>`;

/* ------------------------------------------------------------ sparklines -- */

/**
 * Twelve-month stress or temperature strip. Values are 0..1.
 * Pure SVG so it themes with currentColor and needs no library.
 */
export function yearStrip(values, { labels = MON, colors = null, height = 34 } = {}) {
  const w = 100 / values.length;
  const bars = values.map((v, i) => {
    const h = clamp(v, 0, 1) * (height - 12);
    const fill = colors ? colors[i] : 'currentColor';
    return `<rect x="${(i * w + w * 0.15).toFixed(2)}%" y="${(height - 10 - h).toFixed(1)}"
              width="${(w * 0.7).toFixed(2)}%" height="${Math.max(1, h).toFixed(1)}"
              rx="1.5" fill="${fill}"><title>${labels[i]}</title></rect>`;
  }).join('');
  const ticks = labels.map((l, i) =>
    `<text x="${(i * w + w / 2).toFixed(2)}%" y="${height - 1}" font-size="6.5"
       text-anchor="middle" fill="currentColor" opacity=".55">${l[0]}</text>`).join('');
  return `<svg class="yearstrip" viewBox="0 0 100 ${height}" preserveAspectRatio="none"
            style="width:100%;height:${height}px;overflow:visible">${bars}${ticks}</svg>`;
}

/** Stress colours pulled from the token ramp so they follow the theme. */
export const stressColors = (levels) =>
  levels.map((l) => `var(--stress-${clamp(Math.round(l), 0, 4)})`);

/* ==========================================================================
   KNOWLEDGE CARD
   ==========================================================================
   The rich card for a fruit or a rare plant. Every tag on it answers a
   question that decides whether the plant is worth buying:

     Propagation  a grafted mango fruits in 3 years, a seedling in 8 and not
                  true to type. This is the single most important field and it
                  gets the most prominent tag.
     Time to fruit
     Final bag    can this actually live in a container, or is it a tree?
     Chill hours  the field that rules out apple, litchi and peach here.
     Verdict      works / works with a catch / ruled out and why.
   ========================================================================== */

export function knowledgeCard(plant, { compact = false, chillSite = 0, actions = '' } = {}) {
  const tags = [
    plant.prop && chip(plant.prop, { tone: /graft|layer/i.test(plant.prop) ? 'ok' : 'watch', title: 'How it is propagated' }),
    plant.yrs && chip(plant.yrs, { tone: 'mono', title: 'Time to first fruit' }),
    plant.bagf && chip(plant.bagf, { mono: true, title: 'Final bag size' }),
    plant.chill && chillChip(plant.chill, chillSite),
    plant.site && zoneChip(plant.site),
    plant.verdict && verdictChip(plant.verdict)
  ].filter(Boolean).join('');

  if (compact) {
    return `<article class="card kcard" data-zone="${esc(plant.site || 'indoor')}">
      <h3>${esc(plant.name)}</h3>
      ${plant.lat ? `<div class="subtle" style="font-style:italic">${esc(plant.lat)}</div>` : ''}
      <div class="row" style="margin-top:8px">${tags}</div>
    </article>`;
  }

  return `<article class="card kcard" data-zone="${esc(plant.site || 'indoor')}">
    <div class="spread" style="align-items:flex-start">
      <div style="min-width:0">
        <h3>${esc(plant.name)}</h3>
        ${plant.lat ? `<div class="subtle" style="font-style:italic">${esc(plant.lat)}</div>` : ''}
      </div>
      ${actions}
    </div>
    <div class="row" style="margin:10px 0">${tags}</div>
    ${facts([
      ['Propagation', plant.prop],
      ['To fruit', plant.yrs],
      ['Final bag', plant.bagf],
      ['Chill need', plant.chill],
      ['Water', plant.water],
      ['Mature size', plant.size],
      ['Difficulty', DIFF_LBL[plant.diff]],
      ['Toxicity', TOX_LBL[plant.tox]],
      ['Price', plant.price ? '₹' + plant.price : '']
    ])}
    ${plant.note ? `<p class="lede" style="margin-top:12px;font-size:13.5px">${esc(plant.note)}</p>` : ''}
  </article>`;
}

/** Chill hours, judged against what the site can actually deliver. */
function chillChip(requirement, siteHours) {
  const req = /(\d+)/.exec(String(requirement));
  const needed = req ? Number(req[1]) : 0;
  if (!needed || /none|nil|zero|low/i.test(requirement)) {
    return chip(`Chill: ${requirement}`, { tone: 'ok', title: 'No chill requirement — fine here' });
  }
  const ok = siteHours >= needed;
  return chip(`Chill: ${requirement}`, {
    tone: ok ? 'ok' : 'no',
    title: ok
      ? `This site gives about ${siteHours} h.`
      : `Needs ${needed} h; Talcher gives about ${siteHours} h. It will grow and never fruit.`
  });
}

/* ----------------------------------------------------------------- empty -- */
export const empty = (text) => `<div class="empty">${esc(text)}</div>`;

/* ------------------------------------------------------------ section ---- */
export const section = (title, body, { eyebrow = '', aside = '' } = {}) => `
  <div class="sec">
    <div class="sechead">
      <div>
        ${eyebrow ? `<div class="eyebrow">${esc(eyebrow)}</div>` : ''}
        <h2>${esc(title)}</h2>
      </div>
      ${aside}
    </div>
    ${body}
  </div>`;
