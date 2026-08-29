/* ============================================================================
   water.js — the watering model.

   THE BUG THIS FILE EXISTS TO PREVENT
   v8 read free text like "Rarely" and turned it into "every 10 days". A number
   invented from prose is worse than no number, because the user acts on it.
   Here, a schedule is produced only when there is a real interval to produce
   it from. When there is not, the written rule is returned verbatim and the UI
   shows the rule instead of a fake countdown.

   Everything else is an adjustment on top of that base interval: season, zone,
   container size and material, and today's heat.
   ========================================================================== */

import { daysSince, firstNumber, midNumber, clamp, iso } from '../core/util.js';

/* ==========================================================================
   Seasons — Talcher's four, not the meteorological four
   ========================================================================== */
export const SEASONS = [
  { k: 'monsoon', label: 'Monsoon · Jul–Sep', months: [6, 7, 8] },
  { k: 'post', label: 'Post-monsoon · Oct–Nov', months: [9, 10] },
  { k: 'winter', label: 'Winter · Dec–Feb', months: [11, 0, 1] },
  { k: 'dry', label: 'Dry gap · Mar–Jun', months: [2, 3, 4, 5] }
];

export function seasonIndex(date = new Date()) {
  const m = date.getMonth();
  return SEASONS.findIndex((s) => s.months.includes(m));
}

export const seasonOf = (date = new Date()) => SEASONS[seasonIndex(date)];

/* ==========================================================================
   Adjustment factors — multiply the base interval
   >1 means it can go longer between waterings
   ========================================================================== */

/** How fast a zone dries a container out. */
export const ZONE_DRY = {
  A: 1.00,       // reference: open ground level, full sun
  B: 0.78,       // terrace — sun plus wind is the fastest-drying place on site
  C: 1.15,       // closed balcony: still air, low evaporative demand
  D: 1.35,       // 40–50% shade
  E: 1.70,       // enclosed, dark, barely transpiring
  indoor: 1.00   // indoor bands are already expressed as their own intervals
};

/** Container material and colour, again as a drying multiplier. */
export const CONTAINER_DRY = {
  'fabric-pale': 0.80,   // fabric breathes: dries faster, which is the trade
  'fabric-dark': 0.76,
  'hdpe-pale': 1.10,
  'hdpe-dark': 1.05,
  'black-plastic': 1.00,
  terracotta: 0.72,
  cement: 1.05,
  'double-potted': 1.25,
  'mulched-raised': 1.30
};

/**
 * Bigger bags hold proportionally longer, but not linearly — surface area
 * scales as V^(2/3) while volume scales as V, so the exponent lands near ¼.
 */
export const sizeFactor = (litres, reference = 43) =>
  (!litres ? 1 : clamp((litres / reference) ** 0.25, 0.6, 1.8));

/** Today's heat pulls the interval in. Above 45 °C it nearly halves it. */
export function heatFactor(dayHighC) {
  if (dayHighC == null) return 1;
  if (dayHighC < 30) return 1.15;
  if (dayHighC < 36) return 1.0;
  if (dayHighC < 40) return 0.85;
  if (dayHighC < 44) return 0.7;
  return 0.55;
}

/* ==========================================================================
   Base interval
   ========================================================================== */

/**
 * Resolve a base interval in days, or null when the source is prose.
 *
 * @param {object} src
 *   { seasonalDays } — the wd:[m, p, w, d] array from data/orchard.json, the
 *                      authoritative source when present;
 *   { text }         — free text like "8–12 days" or "Rarely".
 */
export function baseInterval(src, seasonIdx) {
  if (Array.isArray(src?.seasonalDays)) {
    const v = src.seasonalDays[seasonIdx];
    if (v === null || v === undefined) return { days: null, rule: 'Check drainage instead — do not water to a schedule.', source: 'seasonal' };
    if (typeof v === 'number') return { days: v, rule: '', source: 'seasonal' };
  }
  if (src?.text) {
    const days = midNumber(src.text);
    if (days !== null) return { days, rule: '', source: 'text' };
    /* Prose with no number. Return it and let the UI print the rule. */
    return { days: null, rule: String(src.text), source: 'prose' };
  }
  return { days: null, rule: '', source: 'none' };
}

/* ==========================================================================
   The schedule
   ========================================================================== */

/**
 * @param {object} o
 *   base        { seasonalDays } or { text }
 *   zone        'A'..'E' | 'indoor'
 *   litres      container volume
 *   container   key of CONTAINER_DRY
 *   dayHighC    modelled day high for that zone today
 *   lastWatered ISO date
 * @returns {{intervalDays, dueInDays, overdueDays, due, rule, factors, litresPerWater}}
 */
export function schedule({ base, zone = 'A', litres = null, container = 'fabric-pale',
  dayHighC = null, lastWatered = '', date = new Date() }) {
  const si = seasonIndex(date);
  const b = baseInterval(base, si);

  const factors = {
    zone: ZONE_DRY[zone] ?? 1,
    container: CONTAINER_DRY[container] ?? 1,
    size: sizeFactor(litres),
    heat: heatFactor(dayHighC)
  };

  if (b.days === null) {
    return {
      intervalDays: null,
      dueInDays: null,
      overdueDays: null,
      due: false,
      rule: b.rule,
      season: SEASONS[si],
      factors,
      litresPerWater: litresPerWater(litres),
      /* Explicitly no schedule. The UI must show `rule`, not a countdown. */
      scheduled: false
    };
  }

  const interval = Math.max(1, Math.round(
    b.days * factors.zone * factors.container * factors.size * factors.heat
  ));

  const since = lastWatered ? daysSince(lastWatered) : null;
  const dueInDays = since === null ? null : interval - since;

  return {
    intervalDays: interval,
    baseDays: b.days,
    since,
    dueInDays,
    overdueDays: dueInDays !== null && dueInDays < 0 ? -dueInDays : 0,
    due: dueInDays !== null && dueInDays <= 0,
    rule: '',
    season: SEASONS[si],
    factors,
    litresPerWater: litresPerWater(litres),
    scheduled: true
  };
}

/**
 * How much to give. A container wants wetting through, not sipping: roughly a
 * quarter of substrate volume, which comes out at the wall as 10–15% drainage.
 * Little-and-often is what builds the salt crust the Feed screen warns about.
 */
export function litresPerWater(litres) {
  if (!litres) return null;
  return Math.round(litres * 0.25 * 10) / 10;
}

/* ==========================================================================
   Rolling the whole site up
   ========================================================================== */

/**
 * @param {object[]} items  [{ id, name, zone, base, litres, container, lastWatered }]
 * @param {object} zoneHighs { A: 41.2, ... }
 */
export function wateringBoard(items, zoneHighs = {}, date = new Date()) {
  const rows = items.map((it) => ({
    ...it,
    sched: schedule({ ...it, dayHighC: zoneHighs[it.zone] ?? null, date })
  }));

  const due = rows.filter((r) => r.sched.due);
  const unscheduled = rows.filter((r) => !r.sched.scheduled);

  /* Sort by how late, worst first. */
  due.sort((a, b) => (b.sched.overdueDays || 0) - (a.sched.overdueDays || 0));

  return {
    rows,
    due,
    unscheduled,
    byZone: rows.reduce((acc, r) => { (acc[r.zone] ||= []).push(r); return acc; }, {}),
    litresToday: due.reduce((a, r) => a + (r.sched.litresPerWater || 0), 0)
  };
}

/* ==========================================================================
   Timing advice — when in the day, not just whether
   ========================================================================== */

export function wateringWindow(dayHighC, season = seasonOf()) {
  if (dayHighC != null && dayHighC >= 42) {
    return {
      window: 'Before 06:30, and again around 18:00 for anything in A or B.',
      why: 'Water at noon and you drive water into a 45 °C root zone; the plant cannot use it and the bag steams. Two cool-hour waterings beat one big midday one.'
    };
  }
  if (season.k === 'monsoon') {
    return {
      window: 'Only after checking the bag. Skip if the top 3 cm is damp.',
      why: 'Waterlogging is what triggers the guava Fusarium and the papaya collar rot. In August the default answer is "no".'
    };
  }
  if (season.k === 'winter') {
    return {
      window: 'Mid-morning, 09:00–11:00.',
      why: 'Wet foliage overnight at 9 °C invites fungal spotting. Let it dry before dusk.'
    };
  }
  return { window: 'Early morning, before 08:00.', why: 'Least evaporative loss and the leaf dries before nightfall.' };
}
