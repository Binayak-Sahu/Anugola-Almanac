/* ============================================================================
   views/orchard.js — the Interactive Container Orchard Planner.

   Each tree gets a card carrying its whole clock: which bag it is standing in,
   when it outgrows it, when the root-prune falls due once it stops climbing,
   and how far through the wait for first fruit it is.
   ========================================================================== */

import { esc, mount, on, icon } from '../core/dom.js';
import { iso, humanSpan, relDays, parseISO, daysBetween } from '../core/util.js';
import * as store from '../core/store.js';
import { DB } from '../core/data.js';
import { orchardBoard, treeStatus, parseLitres } from '../engine/orchard.js';
import { STAGE_LBL, proseHtml, prose } from '../core/data.js';
import { section, bagLadderBar, facts, meter, chip, stepper, empty } from '../ui/components.js';
import { toast, toastUndo } from '../ui/toast.js';
import { currentRoute } from '../core/router.js';

export function renderOrchard(target = '') {
  const state = store.get();
  const board = orchardBoard(DB.orchard.ORCHARD, state.orchard);

  const tracked = board.filter((t) => t.tracked);
  const untracked = board.filter((t) => !t.tracked);
  const alerts = board.flatMap((t) => t.alerts);

  mount('v-orchard', `
    <div class="sec">
      <div class="eyebrow">Zone A · open parking, ground level</div>
      <h1 style="margin:4px 0 6px">The container orchard</h1>
      <p class="lede">
        Eight plants, six of them grafted. A tree in a bag is a tree on a clock: miss a
        step-up and the roots circle and girdle; miss a root-prune in the final bag and it
        strangles itself over three years. Neither failure shows above ground, which is the
        entire reason this screen exists.
      </p>
    </div>

    ${alerts.length ? section('Needs attention', alerts.map(alertRow).join(''), { eyebrow: `${alerts.length} open` }) : ''}

    ${section('Tracked', tracked.length
      ? tracked.map((t) => treeCard(t, target)).join('')
      : empty('Nothing tracked yet. Press "Track this" on a tree below and its clock starts.'),
      { eyebrow: `${tracked.length} of ${board.length}` })}

    ${untracked.length ? section('Not yet tracked', `<div class="grid g2">${untracked.map(stubCard).join('')}</div>`) : ''}

    ${section('The potting-up plan', pottingPlan(), {
      eyebrow: 'Arrival to full sun',
      aside: '<span class="pill">10 steps over 5 weeks</span>'
    })}

    ${proseSection('a-small-bag-does-not-force-top-growth')}
    ${proseSection('rules-that-cut-across-all-eight')}
    ${section('The orchard year', orchardYear(), { eyebrow: 'Month by month' })}
  `);

  if (target) {
    document.getElementById(`tree-${target}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
}

/* ------------------------------------------------------------------------- */

const alertRow = (a) => `
  <div class="task" data-pri="${a.pri}">
    <div></div>
    <div><div class="tt">${esc(a.title)}</div><div class="td">${esc(a.detail)}</div></div>
    <div></div>
  </div>`;

/* --------------------------------------------------------------- the card - */

function treeCard(t, focus) {
  const { spec, record, ladder, prune, fruit } = t;
  const open = focus === spec.id;
  const currentRung = ladder.rungs[ladder.currentIndex];
  const nextRung = ladder.rungs[ladder.currentIndex + 1];

  return `
  <article class="card treecard" id="tree-${esc(spec.id)}" data-zone="${esc(record?.zone || spec.zone?.[0] || 'A')}"
           style="margin-bottom:14px">

    <div class="spread" style="align-items:flex-start">
      <div class="row" style="flex-wrap:nowrap;gap:12px;min-width:0">
        ${treeGlyph(spec.g)}
        <div style="min-width:0">
          <h3>${esc(spec.name)}</h3>
          <div class="subtle" style="font-style:italic">${esc(spec.lat)}</div>
        </div>
      </div>
      <div class="row">
        ${chip(STAGE_LBL[record?.stage] || 'Tracked', { tone: 'mono' })}
        <button class="btn sm ghost" data-act="tree-expand" data-id="${esc(spec.id)}">${open ? 'Less' : 'More'}</button>
      </div>
    </div>

    <div class="row" style="margin:10px 0 4px">
      ${chip(spec.stock, { tone: /graft|layer/i.test(spec.stock) ? 'ok' : 'watch', title: 'Propagation — the field that decides everything' })}
      ${chip(spec.hgt, { mono: true, title: 'Height at purchase' })}
      ${chip(spec.first, { mono: true, title: 'Stated time to first fruit' })}
    </div>

    <!-- the bag ladder -->
    <div style="margin:16px 0 6px">
      <div class="eyebrow">Bag ladder</div>
      ${bagLadderBar(ladder)}
    </div>

    <div class="grid g2" style="margin-top:14px">
      ${fruitPanel(fruit, spec)}
      ${prunePanel(prune, spec)}
    </div>

    <div class="row" style="margin-top:14px">
      ${nextRung ? `<button class="btn pri" data-act="potup" data-id="${esc(spec.id)}" data-i="${nextRung.index}">
          Pot up to ${esc(nextRung.size)}</button>` : ''}
      ${prune.applicable ? `<button class="btn" data-act="rootprune" data-id="${esc(spec.id)}">Log root-prune</button>` : ''}
      <button class="btn" data-act="water-tree" data-id="${esc(spec.id)}">Watered today</button>
      ${!fruit.fruited ? `<button class="btn" data-act="first-fruit" data-id="${esc(spec.id)}">First fruit!</button>` : ''}
      <button class="btn ghost danger" data-act="untrack" data-id="${esc(spec.id)}">Stop tracking</button>
    </div>

    ${open ? detail(t, currentRung) : ''}
  </article>`;
}

function fruitPanel(fruit, spec) {
  if (fruit.fruited) {
    return `<div class="card flat">
      <div class="eyebrow">First fruit</div>
      <div class="num" style="font-size:22px;margin-top:4px">${esc(fruit.firstFruitOn)}</div>
      <p class="subtle">Logged. The clock that mattered has stopped.</p>
    </div>`;
  }
  return `<div class="card flat">
    <div class="eyebrow">Fruiting countdown</div>
    <div class="num" style="font-size:22px;margin-top:4px">${humanSpan(fruit.daysToGo)}</div>
    <div class="subtle">${esc(fruit.window || spec.first)}</div>
    <div style="margin-top:8px">${meter(fruit.progress)}</div>
    <p class="subtle" style="margin-top:6px">
      ${fruit.elapsedDays} days in. Stated as a window because “${esc(spec.first)}” is not a date,
      and pretending otherwise would be the app lying to you.
    </p>
  </div>`;
}

function prunePanel(prune, spec) {
  if (!prune.applicable) {
    return `<div class="card flat">
      <div class="eyebrow">Root pruning</div>
      <div style="font-size:15px;font-weight:600;margin-top:4px">Not yet</div>
      <p class="subtle">${esc(prune.reason)}</p>
    </div>`;
  }
  return `<div class="card flat ${prune.overdue ? 'hot' : ''}">
    <div class="eyebrow">Root pruning</div>
    <div class="num" style="font-size:22px;margin-top:4px">${prune.dueInDays === null ? '—' : relDays(prune.dueInDays)}</div>
    <div class="subtle">every ${prune.intervalMonths} months · last ${esc(prune.lastISO || 'never')}</div>
    <p class="subtle" style="margin-top:6px">${esc(prune.reason)}</p>
    ${!prune.seasonOK ? `<p class="subtle" style="color:var(--warn);margin-top:4px">
      That date falls outside the Oct–Jan window. Bring it forward rather than cutting roots in the dry gap.</p>` : ''}
  </div>`;
}

function detail(t, currentRung) {
  const { spec, record } = t;
  const events = (record?.events || []).slice(0, 12);

  return `
  <div style="margin-top:18px;border-top:1px solid var(--line);padding-top:16px">
    ${facts([
      ['Zone', record?.zone || spec.zone],
      ['In bag', currentRung ? `${currentRung.size} · ${currentRung.litres}` : 'not potted'],
      ['Final bag', spec.finalBag],
      ['Acquired', record?.acquired],
      ['Watering, monsoon', spec.water?.[0]],
      ['Watering, dry gap', spec.water?.[3]]
    ])}

    <div class="grid g2" style="margin-top:14px">
      <div class="card sunk">
        <div class="eyebrow" style="color:var(--danger)">What kills this one</div>
        <p style="font-size:13.5px;margin-top:4px"><b>${esc(spec.killer)}</b></p>
        <p style="font-size:13px;color:var(--ink-2);margin-top:6px">${esc(spec.prevent)}</p>
        <p class="subtle" style="margin-top:6px">Also watch: ${esc(spec.watch)}</p>
      </div>
      <div class="card sunk">
        <div class="eyebrow">Feeding</div>
        <p style="font-size:13px;margin-top:4px">${esc(spec.feed)}</p>
      </div>
    </div>

    <div class="card sunk" style="margin-top:14px">
      <div class="eyebrow">The thing nobody tells you</div>
      <p style="font-size:13.5px;margin-top:4px">${esc(spec.special)}</p>
    </div>

    <div style="margin-top:16px">
      <div class="eyebrow">Log</div>
      <form class="row" data-tree-log="${esc(spec.id)}" style="margin:8px 0">
        <select class="input" name="kind" style="width:auto">
          <option value="note">Note</option><option value="feed">Feed</option>
          <option value="prune">Prune</option><option value="flower">Flowering</option>
          <option value="fruit">Fruit set</option><option value="pest">Pest</option>
          <option value="disease">Disease</option><option value="move">Moved</option>
        </select>
        <input class="input" name="text" placeholder="What happened" style="flex:1;min-width:160px">
        <button class="btn" type="submit">Add</button>
      </form>
      ${events.length ? events.map((e) => `
        <div class="row" style="padding:6px 0;border-bottom:1px solid var(--line-2);gap:10px">
          <span class="chip tone-mono">${esc(e.on)}</span>
          <span class="chip">${esc(e.kind)}</span>
          <span style="font-size:13px;flex:1;min-width:0">${esc(e.text)}</span>
        </div>`).join('') : '<p class="subtle">Nothing logged yet.</p>'}
    </div>
  </div>`;
}

function stubCard(t) {
  const { spec } = t;
  return `<article class="card" data-zone="${esc(spec.zone?.[0] || 'A')}">
    <div class="row" style="flex-wrap:nowrap;gap:12px">
      ${treeGlyph(spec.g)}
      <div style="min-width:0">
        <h3>${esc(spec.name)}</h3>
        <div class="subtle" style="font-style:italic">${esc(spec.lat)}</div>
      </div>
    </div>
    <div class="row" style="margin:10px 0">
      ${chip(spec.stock, { tone: /graft|layer/i.test(spec.stock) ? 'ok' : 'watch' })}
      ${chip(spec.first, { mono: true })}
      ${chip(spec.finalBag?.split('·')[0] || '', { mono: true })}
    </div>
    <button class="btn pri" data-act="track" data-id="${esc(spec.id)}">Track this</button>
  </article>`;
}

/* ------------------------------------------------------------ tree glyphs -- */
/* OG is the orchard's drawn shapes, keyed by the `g` field on every tree —
   palm, tree, round, berry, bush, chilli. Fills come from the theme tokens via
   the .habit rules, so one drawing works in all four theme combinations. */

function treeGlyph(g) {
  const shape = DB.orchard.OG?.[g];
  if (!shape) return '';
  return `<div style="width:46px;flex:none" aria-hidden="true">${shape}</div>`;
}

function pottingPlan() {
  const steps = DB.orchard.POTPLAN.map((p) => ({
    title: `${p.w} — ${p.t}`,
    body: p.d,
    why: p.why,
    state: ''
  }));
  return stepper(steps);
}

/* ------------------------------------------------------------------ wire -- */

export function wireOrchard() {
  on('track', (el, e, ds) => {
    const spec = DB.orchard.ORCHARD.find((t) => t.id === ds.id);
    store.trackOrchard(ds.id, { zone: (spec?.zone || 'A')[0], acquired: iso() });
    toast(`Tracking ${spec?.name}`);
  });

  on('untrack', (el, e, ds) => {
    const rec = store.get().orchard[ds.id];
    const backup = JSON.parse(JSON.stringify(rec));
    store.untrackOrchard(ds.id);
    toastUndo('Stopped tracking', () => store.trackOrchard(ds.id, backup));
  });

  on('potup', (el, e, ds) => {
    const spec = DB.orchard.ORCHARD.find((t) => t.id === ds.id);
    const bag = spec?.bags?.[Number(ds.i)];
    if (!bag) return;
    store.potUp(ds.id, bag.s, bag.l);
    toast(`${spec.name} potted up to ${bag.s}. Do not feed for 21 days.`);
  });

  on('rootprune', (el, e, ds) => {
    store.logRootPrune(ds.id);
    toast('Root-prune logged. Next one in about 30 months.');
  });

  on('water-tree', (el, e, ds) => {
    store.logOrchardEvent(ds.id, 'water', 'Watered');
    toast('Watering logged');
  });

  on('first-fruit', (el, e, ds) => {
    store.updateOrchard(ds.id, { firstFruitOn: iso(), stage: 'fruiting' });
    store.logOrchardEvent(ds.id, 'fruit', 'First fruit');
    toast('First fruit logged. That is the whole point of the exercise.');
  });

  on('tree-expand', (el, e, ds) => {
    const route = currentRoute();
    location.hash = route.target === ds.id ? '#orchard' : `#orchard/${ds.id}`;
  });

  document.addEventListener('submit', (e) => {
    const id = e.target.dataset?.treeLog;
    if (!id) return;
    e.preventDefault();
    const f = new FormData(e.target);
    const text = String(f.get('text') || '').trim();
    if (!text) return;
    store.logOrchardEvent(id, f.get('kind'), text);
    e.target.reset();
    toast('Logged');
  });
}

/* ==========================================================================
   THE ORCHARD YEAR
   ==========================================================================
   OYEAR sits beside the mushroom literals in the v9 source, and the first pass
   of the v10 extraction filed it under mushrooms on that basis. It is not a
   mushroom calendar — index.html:1675 puts it inside <section id="v-orchard">,
   and the entries say so: "Root-prune woody pots", "Shade net UP", "Buy
   grafted now". views/shrooms.js was rendering it as "the oyster year", and
   because the rows are arrays rather than objects it fell through to
   JSON.stringify and printed raw JSON on the screen.

   The third field is a season tone: '' ordinary, 'hot' the dry gap, 'wet' the
   monsoon, 'go' the planting window.
   ========================================================================== */

const YEAR_TONE = {
  hot: { token: '--season-dry', label: 'Dry gap' },
  wet: { token: '--season-monsoon', label: 'Monsoon' },
  go: { token: '--season-post', label: 'Planting window' },
  '': { token: '--line-hi', label: '' }
};

function orchardYear() {
  const now = new Date().getMonth();
  return `<div class="grid g3">${DB.orchard.OYEAR.map(([month, what, tone], i) => {
    const t = YEAR_TONE[tone] || YEAR_TONE[''];
    return `<div class="card ${i === now ? '' : 'flat'}"
                 style="border-left:3px solid var(${t.token})">
      <div class="spread">
        <span class="eyebrow">${esc(month)}${i === now ? ' · now' : ''}</span>
        ${t.label ? chip(t.label, { mono: true }) : ''}
      </div>
      <p style="font-size:13.5px;margin-top:6px">${esc(what)}</p>
    </div>`;
  }).join('')}</div>`;
}

/** Wrap a lifted v9 block in v10's own section furniture. */
const VIEW = 'orchard';

function proseSection(slug, mounts = {}, view = VIEW) {
  const block = prose(view, slug);
  if (!block) return '';
  return section(block.heading, proseHtml(view, slug, mounts), {
    eyebrow: block.sub || block.eyebrow || ''
  });
}
