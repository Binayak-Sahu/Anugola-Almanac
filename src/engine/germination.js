/* ============================================================================
   germination.js — the seed programme's brain.

   Germination is not a fixed number of days, it is a temperature budget. A
   chilli seed needs roughly the same accumulated warmth whether it gets it in
   six days at 30 °C or eighteen at 18 °C. Modelling it as thermal time rather
   than "8–21 days" is what lets the app say something useful in a place where
   October and January are two different planets on the same balcony.

     thermal time (°C·day) = Σ max(0, meanTemp − baseTemp)
     days to emergence     ≈ TT_required / (meanTemp − baseTemp)

   Below baseTemp nothing happens at all, which is why the January sowings that
   "never came up" did not fail — they were simply never warm enough.
   ========================================================================== */

import { iso, parseISO, addDays, daysBetween, clamp, slugOf } from '../core/util.js';

/* ==========================================================================
   Crop thermal parameters
   base  — below this, no development
   tt    — accumulated °C·day to 50% emergence
   opt   — [min, max] soil temperature for reliable germination
   ========================================================================== */
export const CROP_THERMAL = {
  radish:      { base: 4,  tt: 62,  opt: [18, 30] },
  lettuce:     { base: 4,  tt: 60,  opt: [15, 24], note: 'Thermo-dormant above 28 °C soil — sow in the evening and keep the tray in Zone D.' },
  coriander:   { base: 5,  tt: 130, opt: [15, 26], note: 'Split the mericarp between finger and thumb before sowing; it halves the wait.' },
  spinach:     { base: 3,  tt: 85,  opt: [12, 24] },
  palak:       { base: 5,  tt: 80,  opt: [15, 28] },
  fenugreek:   { base: 6,  tt: 55,  opt: [18, 30] },
  methi:       { base: 6,  tt: 55,  opt: [18, 30] },
  tomato:      { base: 10, tt: 70,  opt: [21, 29] },
  chilli:      { base: 12, tt: 105, opt: [24, 30], note: 'Bottom heat is the whole game. Below 18 °C it simply will not come.' },
  capsicum:    { base: 12, tt: 110, opt: [24, 30] },
  brinjal:     { base: 12, tt: 100, opt: [24, 30] },
  okra:        { base: 13, tt: 75,  opt: [24, 32], note: 'Soak 12 h. Hard seed coat.' },
  bean:        { base: 8,  tt: 80,  opt: [18, 30] },
  cowpea:      { base: 11, tt: 65,  opt: [22, 32] },
  pea:         { base: 4,  tt: 90,  opt: [12, 22] },
  cucumber:    { base: 12, tt: 60,  opt: [24, 32] },
  gourd:       { base: 14, tt: 85,  opt: [25, 33], note: 'Soak 24 h, then nick the coat opposite the eye.' },
  pumpkin:     { base: 12, tt: 75,  opt: [24, 32] },
  watermelon:  { base: 14, tt: 80,  opt: [25, 33] },
  amaranth:    { base: 10, tt: 45,  opt: [20, 32] },
  carrot:      { base: 4,  tt: 130, opt: [15, 25], note: 'Must not dry out once for the full fortnight. Cover the tray with damp jute.' },
  beetroot:    { base: 5,  tt: 95,  opt: [15, 26] },
  onion:       { base: 5,  tt: 130, opt: [15, 25] },
  cabbage:     { base: 5,  tt: 60,  opt: [18, 28] },
  cauliflower: { base: 5,  tt: 62,  opt: [18, 28] },
  basil:       { base: 11, tt: 70,  opt: [21, 30] },
  marigold:    { base: 10, tt: 55,  opt: [21, 30] },
  papaya:      { base: 15, tt: 260, opt: [26, 33], note: 'Remove the sarcotesta or it inhibits its own germination.' },
  moringa:     { base: 14, tt: 110, opt: [25, 33] },
  microgreen:  { base: 8,  tt: 40,  opt: [18, 26] },
  default:     { base: 8,  tt: 85,  opt: [18, 28] }
};

/** Match a seed name to its thermal profile by keyword. */
export function thermalFor(name = '') {
  const n = String(name).toLowerCase();
  for (const key of Object.keys(CROP_THERMAL)) {
    if (key !== 'default' && n.includes(key)) return { key, ...CROP_THERMAL[key] };
  }
  /* A few names that do not contain their own crop word. */
  if (/microgreen|micro green|sprout/.test(n)) return { key: 'microgreen', ...CROP_THERMAL.microgreen };
  if (/lollo|biscia|salad bowl/.test(n)) return { key: 'lettuce', ...CROP_THERMAL.lettuce };
  if (/bhindi|lady.?finger/.test(n)) return { key: 'okra', ...CROP_THERMAL.okra };
  if (/baingan|aubergine|eggplant/.test(n)) return { key: 'brinjal', ...CROP_THERMAL.brinjal };
  if (/mirch|pepper/.test(n)) return { key: 'chilli', ...CROP_THERMAL.chilli };
  return { key: 'default', ...CROP_THERMAL.default };
}

/**
 * Expected days to emergence at a given mean soil temperature.
 * @returns {{days:number|null, warning:string}}
 */
export function expectedDays(name, meanSoilC) {
  const t = thermalFor(name);
  if (meanSoilC == null) return { days: null, warning: '', thermal: t };

  const drive = meanSoilC - t.base;
  if (drive <= 0.5) {
    return { days: null, thermal: t, warning: `Below ${t.base} °C this seed does not develop at all. Nothing is wrong with the seed.` };
  }

  const days = Math.round(t.tt / drive);
  let warning = '';
  if (meanSoilC < t.opt[0]) warning = `Cooler than its ${t.opt[0]}–${t.opt[1]} °C band — expect slow and patchy emergence.`;
  if (meanSoilC > t.opt[1]) warning = `Warmer than its ${t.opt[0]}–${t.opt[1]} °C band — expect thermo-dormancy and gappy rows.`;
  return { days, warning, thermal: t };
}

/* ==========================================================================
   Sowing status
   ========================================================================== */

export const PHASES = ['sown', 'germinating', 'growing', 'hardening', 'planted'];

/**
 * Everything derivable about one sowing record.
 * @param {object} sowing store.sowings[i]
 * @param {number} soilC  modelled mean soil temperature for its zone
 */
export function sowingStatus(sowing, soilC, today = new Date()) {
  const todayISO = iso(today);
  const age = daysBetween(sowing.sownOn, todayISO) ?? 0;

  const counts = (sowing.counts || []).slice().sort((a, b) => (a.on < b.on ? -1 : 1));
  const upNow = counts.length ? counts[counts.length - 1].up : 0;
  const firstUp = counts.find((c) => c.up > 0)?.on || null;

  const rate = sowing.qtySown > 0 ? clamp(upNow / sowing.qtySown, 0, 1) : null;
  const daysToFirst = firstUp ? daysBetween(sowing.sownOn, firstUp) : null;

  const est = expectedDays(sowing.name, soilC);
  const expected = sowing.expectDays ?? est.days;
  const dueISO = expected ? iso(addDays(parseISO(sowing.sownOn) || today, expected)) : null;

  /* Overdue = past the expected window with nothing up. The multiplier is 2×
     because germination is right-skewed; calling failure at 1× produces false
     alarms and teaches the user to ignore the app. */
  const overdue = !upNow && expected != null && age > expected * 2;

  const hardening = hardeningPlan(sowing, today);

  const alerts = [];
  if (overdue) {
    alerts.push({
      pri: 'med', kind: 'germfail',
      title: `${sowing.name}: nothing up after ${age} days`,
      detail: est.warning || `Expected around day ${expected}. Check depth, moisture and whether the tray dried out once — one dry afternoon at this stage is fatal.`
    });
  }
  if (rate !== null && rate > 0 && rate < 0.4 && age > (expected || 10) * 1.5) {
    alerts.push({
      pri: 'low', kind: 'germlow',
      title: `${sowing.name}: ${Math.round(rate * 100)}% germination`,
      detail: 'Below 40%. Re-sow the gaps now rather than nursing a thin tray — succession beats rescue.'
    });
  }
  if (hardening.active && hardening.dayIndex >= 0) {
    alerts.push({
      pri: 'med', kind: 'harden',
      title: `${sowing.name}: hardening off, day ${hardening.dayIndex + 1} of ${hardening.days}`,
      detail: hardening.todayStep
    });
  }
  if (sowing.status === 'growing' && !sowing.hardenFrom && age > 35) {
    alerts.push({
      pri: 'low', kind: 'potbound',
      title: `${sowing.name}: ${age} days in the tray`,
      detail: 'Seedlings spiral in a cell tray after about five weeks. Pot on or start hardening off.'
    });
  }

  return {
    id: sowing.id,
    age, upNow, firstUp, daysToFirst,
    rate,
    expected, dueISO,
    overdue,
    thermal: est.thermal,
    warning: est.warning,
    hardening,
    phase: derivePhase(sowing, upNow),
    alerts
  };
}

function derivePhase(s, upNow) {
  if (s.plantedOn) return 'planted';
  if (s.status === 'failed') return 'failed';
  if (s.hardenFrom) return 'hardening';
  if (s.pottedOn || upNow > 0) return upNow > 0 && !s.pottedOn ? 'germinating' : 'growing';
  return 'sown';
}

/* ==========================================================================
   HARDENING OFF
   ==========================================================================
   The step that kills more seedlings here than any pest. A tray raised in
   Zone D shade and moved straight into Zone A sun scorches in two hours, at
   temperatures where the damage is permanent. This is the ladder, written for
   a 45 °C site: exposure is added in the morning only, never the afternoon.
   ========================================================================== */

export const HARDENING_LADDER = [
  'Zone D shade, outdoors all day. No direct sun at all.',
  '1 hour of early-morning sun (before 08:00), then back to shade.',
  '2 hours of morning sun. Watch for any grey or bleached patch — that is scorch, and it does not heal.',
  '3 hours of morning sun. Water at dawn so they face it turgid.',
  'Morning sun until 10:00, then 50% net for the rest of the day.',
  'Morning sun until 11:00. First night left outdoors in D.',
  'Full morning sun, 50% net from noon. Ready for its final position tomorrow.'
];

export function hardeningPlan(sowing, today = new Date()) {
  const days = sowing.hardenDays || HARDENING_LADDER.length;
  if (!sowing.hardenFrom) {
    return { active: false, days, ladder: HARDENING_LADDER, dayIndex: -1, todayStep: '', endISO: null };
  }
  const dayIndex = daysBetween(sowing.hardenFrom, iso(today)) ?? 0;
  const endISO = iso(addDays(parseISO(sowing.hardenFrom), days));
  const step = HARDENING_LADDER[clamp(dayIndex, 0, HARDENING_LADDER.length - 1)];
  return {
    active: dayIndex >= 0 && dayIndex < days,
    complete: dayIndex >= days,
    days, dayIndex, endISO,
    ladder: HARDENING_LADDER,
    todayStep: dayIndex >= days ? 'Hardening complete — plant it out at dusk.' : step
  };
}

/* ==========================================================================
   Programme-level roll-up
   ========================================================================== */

export function seedProgramme(sowings, soilByZone, today = new Date()) {
  const rows = sowings.map((s) => ({ sowing: s, status: sowingStatus(s, soilByZone?.[s.zone] ?? null, today) }));

  const live = rows.filter((r) => !['planted', 'failed'].includes(r.status.phase));
  const sown = rows.reduce((a, r) => a + (r.sowing.qtySown || 0), 0);
  const up = rows.reduce((a, r) => a + r.status.upNow, 0);

  return {
    rows,
    live,
    totals: { sowings: rows.length, seedsSown: sown, seedlings: up, rate: sown ? up / sown : null },
    alerts: rows.flatMap((r) => r.status.alerts)
  };
}

/** Stable key for a seed row, so a sowing can point at the catalogue. */
export const seedKey = (seed) => slugOf(seed?.n || seed?.name || '');
