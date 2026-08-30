/* ============================================================================
   views/care.js — diagnosis, identification, and the light ladder.

   Three things live here, and they share one idea: look before you treat.

   The symptom table is deliberately ordered by what the plant is DOING rather
   than by what is wrong with it, because a beginner can see a yellow tip and
   cannot see a nitrogen deficiency. The identification wizard exists for the
   same reason — three of the seven indoor plants are still unidentified, and
   the crush-and-smell test that would settle it takes two seconds.
   ========================================================================== */

import { esc, mount, on } from '../core/dom.js';
import { debounce } from '../core/util.js';
import * as store from '../core/store.js';
import { DB, catalogue, PLACE_LBL, proseHtml, prose } from '../core/data.js';
import { habitArt, section, chip, facts, empty } from '../ui/components.js';
import { rank, highlight } from '../ui/search.js';
import { toast } from '../ui/toast.js';

const VIEW = 'care';
let SYMQ = '';
let ANSWERS = [null, null, null];

export function renderCare() {
  mount('v-care', `
    <div class="sec">
      <div class="eyebrow">Diagnosis · identification · light</div>
      <h1 style="margin:4px 0 6px">Care</h1>
      <p class="lede">
        Look before you treat. Most indoor plant deaths here are one of three things — too
        little light, water on a schedule instead of on a finger test, or salt from tap water
        that never gets flushed — and all three look like something more exotic before you
        check.
      </p>
    </div>

    ${section('Four things worth more than any fertiliser', proseHtml(VIEW, 'care'), {
      eyebrow: 'Free, immediate, and none of them involve buying anything' })}

    ${section('When something looks wrong', symptomTable(), {
      eyebrow: 'Search what you can see, not what you think it is' })}

    ${section('Identify a plant', idWizard(), {
      eyebrow: 'Three of the seven are still unresolved' })}

    ${section('The light ladder', lightLadder(), {
      eyebrow: 'Measured from the glass, not from the wall' })}

    ${proseSection('the-habits-that-matter')}
  `);
}

/* ------------------------------------------------- symptoms -------------- */

/* SYMPTOMS rows: [what you see, what it usually is, what to do] */
function symptomTable() {
  const rows = DB.care.SYMPTOMS;
  const hits = SYMQ.trim()
    ? rank(rows.map((r, i) => ({ i, seen: r[0], cause: r[1], fix: r[2] })), SYMQ, {
        fields: [{ key: 'seen', weight: 1 }, { key: 'cause', weight: 0.6 }, { key: 'fix', weight: 0.4 }],
        limit: 20
      })
    : rows.map((r, i) => ({ item: { i, seen: r[0], cause: r[1], fix: r[2] }, ranges: [], field: null }));

  return `
    <input class="input" id="symq" type="search" value="${esc(SYMQ)}" autocomplete="off"
           placeholder="yellow, brown tips, drooping, white crust, sticky…">
    <div style="margin-top:14px">
      ${hits.length ? hits.map(({ item, ranges, field }) => `
        <article class="card" style="margin-bottom:10px">
          <h3>${field === 'seen' ? highlight(item.seen, ranges) : esc(item.seen)}</h3>
          <p class="subtle" style="margin-top:4px"><b>Usually:</b>
            ${field === 'cause' ? highlight(item.cause, ranges) : esc(item.cause)}</p>
          <p style="font-size:13.5px;margin-top:8px"><b>Do this:</b>
            ${field === 'fix' ? highlight(item.fix, ranges) : esc(item.fix)}</p>
        </article>`).join('')
        : empty('Nothing matches. Describe what you can see rather than what you think it is.')}
    </div>`;
}

/* ------------------------------------------------- identification -------- */

/* IDQ rows: [question, [[answer label, habit key], ...]] */
function idWizard() {
  const questions = DB.care.IDQ;
  if (!questions?.length) return empty('No identification key in the data bundle.');

  const asked = questions.map((q, qi) => {
    const [text, options] = q;
    return `
      <div class="card" style="margin-bottom:10px">
        <div class="eyebrow">Question ${qi + 1}</div>
        <h3 style="margin-top:4px">${esc(text)}</h3>
        <div class="row" style="margin-top:10px">
          ${options.map(([label, value]) => `
            <button class="chip ${ANSWERS[qi] === value ? 'on' : ''}"
                    data-act="idans" data-q="${qi}" data-v="${esc(value)}">${esc(label)}</button>`).join('')}
        </div>
      </div>`;
  }).join('');

  return `${asked}
    <div class="row" style="margin-bottom:14px">
      <button class="btn ghost sm" data-act="idreset">Start again</button>
    </div>
    ${idResult()}`;
}

function idResult() {
  const habit = ANSWERS.find(Boolean);
  if (!habit) {
    return empty('Answer the first question and the shortlist appears here.');
  }

  const matches = catalogue(store.get())
    .filter((p) => p.habit === habit && (p.kind || 'house') === 'house')
    .slice(0, 12);

  return `
    <div class="card">
      <div class="spread" style="align-items:flex-start">
        <div>
          <div class="eyebrow">Shortlist</div>
          <h3 style="margin-top:4px">${esc(DB.catalogue.HABIT_LBL?.[habit] || habit)}</h3>
        </div>
        <div style="width:64px">${habitArt(habit)}</div>
      </div>
      ${matches.length
        ? `<div class="row" style="margin-top:12px">${matches.map((p) =>
            `<a class="chip" href="#catalogue/${esc(p.key)}">${esc(p.name)}</a>`).join('')}</div>`
        : '<p class="subtle" style="margin-top:10px">Nothing in the catalogue has that habit.</p>'}
      <p class="subtle" style="margin-top:12px">
        A shortlist, not an answer. For the three tall unidentified ones the deciding test is not
        visual at all: tear a leaf, crush it, smell it. Ginger, turmeric and mango-ginger are
        unmistakable, and if that is what they are they want double the water, much more light,
        and they die back completely around December.
      </p>
    </div>`;
}

/* ------------------------------------------------- light ladder ---------- */

/* ROOMS rows: [key, where, what it means] */
function lightLadder() {
  const rooms = DB.care.ROOMS;
  const state = store.get();
  const counts = state.specimens.reduce((acc, s) => {
    if (!s.site || s.site === 'indoor') acc[s.zone] = (acc[s.zone] || 0) + 1;
    return acc;
  }, {});

  return `<div class="grid g2">${rooms.map(([key, where, what], i) => `
    <article class="card" data-zone="indoor">
      <div class="spread" style="align-items:flex-start">
        <div style="min-width:0">
          <div class="eyebrow">Step ${i + 1} · ${esc(PLACE_LBL[key] || key)}</div>
          <h3 style="margin-top:4px">${esc(where)}</h3>
        </div>
        ${chip(`${counts[key] || 0} here`, { mono: true })}
      </div>
      <p style="font-size:13.5px;margin-top:8px">${esc(what)}</p>
    </article>`).join('')}</div>
    <p class="subtle" style="margin-top:12px">
      Light falls off with the square of the distance, so a plant a metre back from the glass is
      getting a small fraction of what one at the mesh gets — not a little less. This is why the
      grow light is treated as the primary source in that room rather than a supplement.
    </p>`;
}

/** Wrap a lifted v9 block in v10's own section furniture. */
function proseSection(slug, mounts = {}, view = VIEW) {
  const block = prose(view, slug);
  if (!block) return '';
  return section(block.heading, proseHtml(view, slug, mounts), {
    eyebrow: block.sub || block.eyebrow || ''
  });
}

/* ------------------------------------------------------------------ wire -- */

export function wireCare() {
  on('idans', (el, e, ds) => {
    const q = Number(ds.q);
    ANSWERS[q] = ANSWERS[q] === ds.v ? null : ds.v;
    renderCare();
  });

  on('idreset', () => { ANSWERS = [null, null, null]; renderCare(); });

  const search = debounce(() => {
    renderCare();
    const box = document.getElementById('symq');
    if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
  }, 220);

  document.addEventListener('input', (e) => {
    if (e.target.id !== 'symq') return;
    SYMQ = e.target.value;
    search();
  });
}
