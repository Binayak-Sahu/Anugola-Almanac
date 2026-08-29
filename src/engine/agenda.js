/* ============================================================================
   agenda.js — the Action Desk.

   One priority queue assembled from every other engine, because the user has
   one morning, not eight screens. The rule for what earns a place here:

     A task appears only if it is actionable TODAY and something bad happens
     if it is skipped.

   Anything that is merely interesting belongs on its own screen. A daily list
   that cries wolf gets ignored within a week, and then the one that mattered
   gets ignored with it.

   Every task carries `why` — the consequence of skipping — because this user
   is a beginner and the reason is what turns an instruction into knowledge.
   ========================================================================== */

import { iso, daysSince, daysBetween, MONFULL } from '../core/util.js';
import { zoneMonth, heatIndexC, heatBand, rootZoneTemp, rootZoneVerdict, vpd, vpdBand } from './heat.js';
import { seasonOf, wateringBoard, wateringWindow } from './water.js';
import { orchardBoard } from './orchard.js';
import { seedProgramme } from './germination.js';
import { feedGate } from './feed.js';
import { overhangShade, dayLength, sunPosition, noonAltitude, BALCONY_DEFAULT } from './solar.js';

export const PRIORITY = { hi: 0, med: 1, low: 2 };

let seq = 0;
const task = (t) => ({ id: t.id || `t${++seq}`, pri: 'low', kind: 'note', why: '', link: '', ...t });

/* ==========================================================================
   Site conditions for right now
   ========================================================================== */

export function siteConditions(db, state, date = new Date()) {
  const angul = db.climate.ANGUL;
  const month = date.getMonth();
  const zones = {};

  for (const z of ['A', 'B', 'C', 'D', 'E', 'indoor']) {
    const m = zoneMonth(z, month, angul);
    const hi = heatIndexC(m.high, m.rh);
    zones[z] = {
      ...m,
      heatIndex: hi,
      band: heatBand(hi),
      vpd: vpd(m.high, m.rh),
      vpdBand: vpdBand(vpd(m.high, m.rh))
    };
  }

  const sun = sunPosition(date);
  const day = dayLength(date);

  /* The south balcony's overhang. Defaults until the user measures theirs
     on the Zones screen. */
  const geom = { ...BALCONY_DEFAULT, ...(state.settings?.balconyGeometry || {}) };
  const balcony = overhangShade(geom, date);

  return {
    date,
    month,
    monthName: MONFULL[month],
    season: seasonOf(date),
    zones,
    sun,
    day,
    noonAltitude: noonAltitude(date),
    balcony,
    hottest: Object.entries(zones).reduce((a, [k, v]) => (v.heatIndex > (a?.[1]?.heatIndex ?? -99) ? [k, v] : a), null)
  };
}

/* ==========================================================================
   Task producers
   ========================================================================== */

function heatTasks(cond, state) {
  const out = [];
  const threshold = state.settings?.heatAlertC ?? 42;

  for (const [zone, z] of Object.entries(cond.zones)) {
    if (z.band.level >= 3) {
      out.push(task({
        id: `heat-${zone}`,
        pri: z.band.level >= 4 ? 'hi' : 'med',
        kind: 'heat',
        zone,
        title: `Zone ${zone}: heat index ${z.heatIndex} °C — ${z.band.label.toLowerCase()}`,
        detail: z.band.advice,
        why: 'Above 45 °C apparent temperature the plant shuts its stomata and stops feeding itself. Shade is worth more than water at that point.',
        link: '#zones'
      }));
    }
  }

  /* Root zone is the alert nobody else gives you. */
  const zoneA = cond.zones.A;
  if (zoneA.high >= threshold) {
    const black = rootZoneTemp({ airHigh: zoneA.high, bag: 'black-plastic', date: cond.date });
    const pale = rootZoneTemp({ airHigh: zoneA.high, bag: 'fabric-pale', shade: '50', mulched: true, date: cond.date });
    out.push(task({
      id: 'rootzone',
      pri: 'med',
      kind: 'heat',
      title: `Root zone today: ${black} °C in a black pot, ${pale} °C in a pale bag under net`,
      detail: rootZoneVerdict(black).text + ' The difference is shade cloth, a pale bag and two inches of mulch — nothing else.',
      why: 'Feeder roots die from about 40 °C. Leaves look untouched while it happens, so the plant "suddenly" collapses a fortnight later.',
      link: '#bags'
    }));
  }
  return out;
}

function waterTasks(cond, db, state) {
  const zoneHighs = Object.fromEntries(Object.entries(cond.zones).map(([k, v]) => [k, v.high]));

  /* Indoor pots and tracked specimens. */
  const items = state.specimens.filter((s) => !s.dead).map((s) => ({
    id: s.sid,
    name: s.name || 'Unnamed pot',
    zone: s.site && s.site !== 'indoor' ? s.site : 'indoor',
    base: { text: s.water || '' },
    litres: null,
    container: 'black-plastic',
    lastWatered: s.watered
  }));

  /* Tracked orchard trees, which carry real seasonal day counts. */
  for (const [id, rec] of Object.entries(state.orchard || {})) {
    const spec = db.orchard.ORCHARD.find((t) => t.id === id);
    if (!spec || rec.alive === false) continue;
    const bag = rec.bags?.[rec.bagIdx];
    items.push({
      id: `orchard:${id}`,
      name: spec.name,
      zone: rec.zone || spec.zone?.[0] || 'A',
      base: { seasonalDays: spec.wd },
      litres: bag ? Number(String(bag.litres).replace(/[^\d.]/g, '')) || null : null,
      container: 'fabric-pale',
      lastWatered: lastWateringOf(rec)
    });
  }

  const board = wateringBoard(items, zoneHighs, cond.date);
  const out = board.due.map((r) => task({
    id: `water-${r.id}`,
    pri: r.sched.overdueDays > 3 ? 'hi' : 'med',
    kind: 'water',
    zone: r.zone,
    ref: r.id,
    title: `Water ${r.name}`,
    detail: [
      r.sched.overdueDays > 0 ? `${r.sched.overdueDays} days overdue` : 'Due today',
      r.sched.litresPerWater ? `${r.sched.litresPerWater} L, until it runs from the base` : null,
      `every ${r.sched.intervalDays} d in the ${r.sched.season.k}`
    ].filter(Boolean).join(' · '),
    why: 'Swings between bone dry and soaked are what drop jamun fruit and split guava skins. Consistency beats volume.',
    link: r.id.startsWith('orchard:') ? `#orchard/${r.id.slice(8)}` : `#pots/${r.id}`
  }));

  if (out.length) {
    const w = wateringWindow(cond.zones.A.high, cond.season);
    out.unshift(task({
      id: 'water-window',
      pri: 'med',
      kind: 'water',
      title: `Watering window: ${w.window}`,
      detail: `${board.due.length} due · about ${Math.round(board.litresToday)} L total`,
      why: w.why,
      link: '#today'
    }));
  }
  return out;
}

const lastWateringOf = (rec) =>
  (rec.events || []).find((e) => e.kind === 'water')?.on || rec.lastWatered || '';

function orchardTasks(db, state, date) {
  const board = orchardBoard(db.orchard.ORCHARD, state.orchard, {}, date);
  return board.flatMap((t) => t.alerts.map((a) => task({
    id: `orchard-${t.id}-${a.kind}`,
    pri: a.pri,
    kind: a.kind,
    title: a.title,
    detail: a.detail,
    why: 'A bag is a clock. Roots that circle strangle the trunk, and nothing shows above ground until the tree stops.',
    link: `#orchard/${t.id}`
  })));
}

function seedTasks(cond, state, date) {
  const soilByZone = Object.fromEntries(
    /* Soil in a shaded tray runs a couple of degrees under air. */
    Object.entries(cond.zones).map(([k, v]) => [k, (v.high + v.low) / 2 - 1])
  );
  const prog = seedProgramme(state.sowings, soilByZone, date);
  return prog.alerts.map((a) => task({
    id: `seed-${a.kind}-${a.title}`,
    pri: a.pri,
    kind: a.kind,
    title: a.title,
    detail: a.detail,
    why: 'Seedlings fail on a schedule, not at random. Catching a tray on the day it needs hardening off is the difference between a crop and a re-sow.',
    link: '#seeds'
  }));
}

function feedTasks(cond, db, state) {
  const gate = feedGate(cond.month, { heatIndexC: cond.zones.A.heatIndex });
  const monthPlan = db.feed.FEEDCAL?.[cond.month];

  if (gate.feed === false) {
    return [task({
      id: 'feed-gate',
      pri: 'low',
      kind: 'feed',
      title: `Do not feed in ${cond.monthName}`,
      detail: gate.why,
      why: 'Fertiliser in a heat-stalled bag is pure salt accumulation. The restraint is the technique.',
      link: '#feed'
    })];
  }

  const out = [];
  if (monthPlan) {
    out.push(task({
      id: 'feed-month',
      pri: 'low',
      kind: 'feed',
      title: `${cond.monthName} feeding — ${monthPlan.w || 'see the plan'} (${monthPlan.hp || 'normal'})`,
      detail: monthPlan.d || gate.why,
      why: gate.why,
      link: '#feed'
    }));
  }
  return out;
}

function sunTasks(cond) {
  const out = [];
  const b = cond.balcony;
  if (b && b.state !== 'behind') {
    const pctSun = Math.round(b.sunlitFraction * 100);
    /* Only worth saying when it is changing the plan. */
    if (pctSun <= 15 && [3, 4, 5, 6].includes(cond.month)) {
      out.push(task({
        id: 'sun-c-shaded',
        pri: 'low',
        kind: 'sun',
        zone: 'C',
        title: `Zone C is ${pctSun}% sunlit at noon — the overhang is doing its job`,
        detail: `Noon sun is ${Math.round(cond.noonAltitude)}° up. Nothing that needs full sun will crop on the balcony until the sun drops in September.`,
        why: 'This is the inverted calendar the whole Zone C plan depends on: shade house in summer, sun trap in winter.',
        link: '#zones'
      }));
    }
    if (pctSun >= 70 && [9, 10, 11, 0, 1].includes(cond.month)) {
      out.push(task({
        id: 'sun-c-open',
        pri: 'low',
        kind: 'sun',
        zone: 'C',
        title: `Zone C is ${pctSun}% sunlit at noon — the winter window is open`,
        detail: `Noon sun ${Math.round(cond.noonAltitude)}° and falling. This is the balcony's best light of the year; the winter vegetable programme goes in now.`,
        why: 'The window runs roughly October to February. Sowing late costs the whole crop, because March heat ends it regardless of how well it is growing.',
        link: '#seeds'
      }));
    }
  }
  if (cond.zones.C.vpdBand.level >= 2 && cond.zones.C.vpd < 0.4) {
    out.push(task({
      id: 'vpd-c',
      pri: 'med',
      kind: 'air',
      zone: 'C',
      title: 'Zone C air is too still',
      detail: `VPD ${cond.zones.C.vpd} kPa. ${cond.zones.C.vpdBand.advice}`,
      why: 'A closed balcony with no air movement grows spider mite within a month, and no wind means no pollination — hand-flick every open flower each morning.',
      link: '#zones'
    }));
  }
  return out;
}

/* ==========================================================================
   Assembly
   ========================================================================== */

/**
 * @returns {{conditions, tasks, open, done, counts}}
 */
export function buildAgenda(db, state, date = new Date()) {
  seq = 0;
  const cond = siteConditions(db, state, date);

  const all = [
    ...heatTasks(cond, state),
    ...waterTasks(cond, db, state),
    ...orchardTasks(db, state, date),
    ...seedTasks(cond, state, date),
    ...feedTasks(cond, db, state),
    ...sunTasks(cond)
  ];

  /* Completion is stamped per day, so yesterday's tick does not hide today's
     watering. Structural tasks (a pot-up that is genuinely done) use a stable
     id and stay ticked. */
  const today = iso(date);
  const withDone = all.map((t) => {
    const key = t.kind === 'water' || t.kind === 'heat' ? `${t.id}@${today}` : t.id;
    return { ...t, key, done: !!state.tasks[key] };
  });

  withDone.sort((a, b) =>
    (a.done - b.done) || (PRIORITY[a.pri] - PRIORITY[b.pri]) || a.title.localeCompare(b.title));

  return {
    conditions: cond,
    tasks: withDone,
    open: withDone.filter((t) => !t.done),
    done: withDone.filter((t) => t.done),
    counts: {
      hi: withDone.filter((t) => !t.done && t.pri === 'hi').length,
      med: withDone.filter((t) => !t.done && t.pri === 'med').length,
      low: withDone.filter((t) => !t.done && t.pri === 'low').length
    }
  };
}
