/* ============================================================================
   orchard.js — the container orchard planner.

   Turns the prose in data/orchard.json ("month 12–15, ~4 ft", "2–3 years")
   into dates, so the app can answer the three questions a container orchard
   actually raises:

     1. What size bag is this tree in, and when does it outgrow it?
     2. When was it last root-pruned, and when is that due again?
     3. How long until it fruits — and is it on schedule?

   A tree in a bag is a tree on a clock. Miss a step-up and it circles and
   girdles; miss a root-prune in the final bag and it strangles itself in
   three years. Neither failure is visible from above ground, which is exactly
   why it needs tracking rather than observation.
   ========================================================================== */

import { iso, parseISO, addDays, daysBetween, humanSpan, clamp } from '../core/util.js';

/* ==========================================================================
   Parsing the shipped prose
   ========================================================================== */

const UNIT_DAYS = { day: 1, days: 1, week: 7, weeks: 7, month: 30.44, months: 30.44, year: 365.25, years: 365.25 };

/**
 * "2–3 years" → { min: 730, max: 1096, text }
 * "8–10 months → around June 2027" → { min: 244, max: 304 }
 * "~90 days" → { min: 90, max: 90 }
 * Returns null when there is no parseable duration, which is a legitimate
 * answer for a seed packet measured in "days to first pick".
 */
export function parseDuration(text) {
  if (!text) return null;
  const m = /(\d+(?:\.\d+)?)\s*(?:[–\-—to]+\s*(\d+(?:\.\d+)?))?\s*(day|days|week|weeks|month|months|year|years)/i.exec(text);
  if (!m) return null;
  const unit = UNIT_DAYS[m[3].toLowerCase()];
  const min = Number(m[1]) * unit;
  const max = m[2] ? Number(m[2]) * unit : min;
  return { min: Math.round(min), max: Math.round(max), text: String(text) };
}

/**
 * A bag-ladder trigger, as written in the data.
 *   "now"                    → { kind: 'now' }
 *   "month 10"               → { kind: 'age', minDays: 304 }
 *   "month 12–15, ~4 ft"     → { kind: 'age', minDays: 365, maxDays: 457, height: 4 }
 *   "year 3 — final"         → { kind: 'age', minDays: 1096, final: true }
 *   "at ~1.5 ft"             → { kind: 'height', height: 1.5 }
 *   "final"                  → { kind: 'final', final: true }
 */
export function parseBagTrigger(w = '', note = '') {
  const text = String(w);
  const lower = text.toLowerCase();
  const final = /final/.test(lower) || /final/.test(String(note).toLowerCase());

  if (/^now\b/.test(lower)) return { kind: 'now', final, text };

  const height = /(\d+(?:\.\d+)?)\s*ft/i.exec(text);

  const monthly = /month\s*(\d+)(?:\s*[–\-—]\s*(\d+))?/i.exec(text);
  if (monthly) {
    return {
      kind: 'age', final, text,
      minDays: Math.round(Number(monthly[1]) * 30.44),
      maxDays: Math.round(Number(monthly[2] || monthly[1]) * 30.44),
      height: height ? Number(height[1]) : null
    };
  }

  const yearly = /year\s*(\d+)(?:\s*[–\-—]\s*(\d+))?/i.exec(text);
  if (yearly) {
    return {
      kind: 'age', final, text,
      minDays: Math.round(Number(yearly[1]) * 365.25),
      maxDays: Math.round(Number(yearly[2] || yearly[1]) * 365.25),
      height: height ? Number(height[1]) : null
    };
  }

  if (height) return { kind: 'height', final, text, height: Number(height[1]) };
  if (final) return { kind: 'final', final: true, text };
  return { kind: 'unknown', final, text };
}

/** Litres out of "43 L". */
export const parseLitres = (l) => {
  const m = /(\d+(?:\.\d+)?)/.exec(String(l || ''));
  return m ? Number(m[1]) : null;
};

/* ==========================================================================
   The ladder
   ========================================================================== */

/**
 * Build the bag ladder for one tree, merging the shipped plan with what the
 * user has actually done.
 *
 * @param {object} spec    the row from data/orchard.json
 * @param {object} record  store.orchard[id], or null if untracked
 * @param {Date}   today
 * @returns {{rungs:Array, currentIndex:number, nextDue:string|null, overdueDays:number|null}}
 */
export function bagLadder(spec, record, today = new Date()) {
  const bags = spec.bags || [];
  /* The clock starts when the tree was potted into its first bag; if it has
     not been potted yet, from acquisition, so the plan still shows dates. */
  const anchorISO = record?.bags?.[0]?.on || record?.acquired || iso(today);
  const anchor = parseISO(anchorISO) || today;

  const climbed = record?.bags || [];
  const currentIndex = climbed.length ? clamp(climbed.length - 1, 0, bags.length - 1) : -1;

  let nextDue = null;
  let overdueDays = null;

  const rungs = bags.map((bag, i) => {
    const trigger = parseBagTrigger(bag.w, bag.note);
    const doneEntry = climbed[i];

    /* Estimated due date, measured from the anchor. */
    let dueISO = null;
    if (trigger.kind === 'now') dueISO = anchorISO;
    else if (trigger.kind === 'age') dueISO = iso(addDays(anchor, trigger.minDays));

    const done = !!doneEntry;
    const isCurrent = i === currentIndex;
    const isNext = i === currentIndex + 1;

    let status = 'future';
    if (done) status = isCurrent ? 'current' : 'done';
    else if (isNext) status = 'next';

    let due = null;
    if (isNext) {
      if (dueISO) {
        due = daysBetween(iso(today), dueISO);
        if (due !== null && due <= 0) { overdueDays = -due; }
        nextDue = dueISO;
      } else if (trigger.kind === 'height') {
        nextDue = null;   // measured, not timed — the UI asks the user
      }
    }

    return {
      index: i,
      size: bag.s,
      litres: bag.l,
      litresNum: parseLitres(bag.l),
      note: bag.note || '',
      trigger,
      dueISO,
      dueInDays: due,
      onISO: doneEntry?.on || null,
      status,
      final: trigger.final || i === bags.length - 1
    };
  });

  return { rungs, currentIndex, nextDue, overdueDays, anchorISO };
}

/* ==========================================================================
   Root pruning
   ==========================================================================
   Only relevant once a tree is standing in its final bag: after that there is
   nowhere left to go, so the root ball has to be cut back into the same bag
   instead. Fabric bags air-prune and buy time; woven HDPE circles and makes
   the schedule mandatory.
   ========================================================================== */

export const PRUNE_INTERVAL_MONTHS = { 'fabric': 30, 'hdpe': 24, 'plastic': 18, 'terracotta': 24, 'unknown': 24 };

/**
 * @param {object} spec
 * @param {object} record
 * @param {object} opts { bagType, intervalMonths }
 */
export function rootPruneStatus(spec, record, opts = {}, today = new Date()) {
  const ladder = bagLadder(spec, record, today);
  const inFinalBag = ladder.currentIndex >= 0 && ladder.rungs[ladder.currentIndex]?.final;

  if (!inFinalBag) {
    return {
      applicable: false,
      reason: 'Still climbing the bag ladder. Step-ups replace root-pruning until the final bag.',
      dueISO: null, dueInDays: null, overdue: false
    };
  }

  const months = opts.intervalMonths || PRUNE_INTERVAL_MONTHS[opts.bagType || 'fabric'];
  const last = record?.lastRootPrune || record?.bags?.[ladder.currentIndex]?.on || record?.acquired;
  const lastDate = parseISO(last);
  if (!lastDate) {
    return { applicable: true, reason: 'No potting date logged yet.', dueISO: null, dueInDays: null, overdue: false, intervalMonths: months };
  }

  const dueISO = iso(addDays(lastDate, Math.round(months * 30.44)));
  const dueInDays = daysBetween(iso(today), dueISO);

  return {
    applicable: true,
    intervalMonths: months,
    lastISO: last,
    dueISO,
    dueInDays,
    overdue: dueInDays !== null && dueInDays < 0,
    /* Root-pruning is a dormant-season job. In Talcher that is the cool window
       after the monsoon, not the European "late winter". */
    seasonOK: [10, 11, 0, 1].includes(new Date(dueISO).getMonth()),
    reason: 'In its final bag. Cut back the outer 2–3 inches of root ball and back-fill with fresh mix.'
  };
}

/* ==========================================================================
   Fruiting countdown
   ========================================================================== */

/**
 * @returns {{expectedISO, daysToGo, elapsedDays, progress, window, fruited, text}}
 */
export function fruitingCountdown(spec, record, today = new Date()) {
  const dur = parseDuration(spec.first);
  const startISO = record?.acquired || iso(today);
  const start = parseISO(startISO) || today;
  const elapsedDays = daysBetween(startISO, iso(today)) ?? 0;

  if (record?.firstFruitOn) {
    return {
      fruited: true, firstFruitOn: record.firstFruitOn,
      elapsedDays, daysToGo: 0, progress: 1,
      text: `First fruit ${record.firstFruitOn}`
    };
  }

  if (!dur) {
    return { fruited: false, expectedISO: null, daysToGo: null, elapsedDays, progress: 0, text: spec.first || '—' };
  }

  const earlyISO = iso(addDays(start, dur.min));
  const lateISO = iso(addDays(start, dur.max));
  const daysToGo = daysBetween(iso(today), earlyISO);
  const progress = clamp(elapsedDays / dur.min, 0, 1);

  return {
    fruited: false,
    expectedISO: earlyISO,
    windowISO: [earlyISO, lateISO],
    daysToGo,
    elapsedDays,
    progress,
    /* Stated as a window, because "2–3 years" is not a date and pretending it
       is would be the app lying to its user. */
    text: dur.min === dur.max
      ? `about ${humanSpan(daysToGo)} to go`
      : `${humanSpan(daysToGo)} to the early edge of the window`,
    window: `${earlyISO.slice(0, 7)} → ${lateISO.slice(0, 7)}`
  };
}

/* ==========================================================================
   Whole-tree roll-up — one call, everything the card and the agenda need
   ========================================================================== */

export function treeStatus(spec, record, opts = {}, today = new Date()) {
  const ladder = bagLadder(spec, record, today);
  const prune = rootPruneStatus(spec, record, opts, today);
  const fruit = fruitingCountdown(spec, record, today);

  const alerts = [];

  if (ladder.overdueDays !== null && ladder.overdueDays > 0) {
    const next = ladder.rungs[ladder.currentIndex + 1];
    alerts.push({
      pri: ladder.overdueDays > 60 ? 'hi' : 'med',
      kind: 'potup',
      title: `${spec.name}: step up to ${next?.size}`,
      detail: `Due ${ladder.overdueDays} days ago. Roots circling in ${ladder.rungs[ladder.currentIndex]?.size} girdle the trunk, and the damage is invisible until the tree stalls.`
    });
  }

  if (prune.applicable && prune.overdue) {
    alerts.push({
      pri: 'med',
      kind: 'rootprune',
      title: `${spec.name}: root-prune due`,
      detail: `Last done ${prune.lastISO || 'never logged'}. Cut the outer 2–3 in of the ball and back-fill. Do it Oct–Jan, not in the dry gap.`
    });
  }

  const nextRung = ladder.rungs[ladder.currentIndex + 1];
  if (nextRung?.trigger?.kind === 'height') {
    alerts.push({
      pri: 'low',
      kind: 'measure',
      title: `${spec.name}: measure it`,
      detail: `Next bag (${nextRung.size}) is triggered by height — ${nextRung.trigger.height} ft — not by date. Measure and log it.`
    });
  }

  return {
    id: spec.id,
    spec,
    record,
    ladder,
    prune,
    fruit,
    alerts,
    stage: record?.stage || 'untracked',
    tracked: !!record
  };
}

/** Every tracked tree, ranked by how much attention it needs. */
export function orchardBoard(specs, orchardState, opts = {}, today = new Date()) {
  return specs
    .map((spec) => treeStatus(spec, orchardState?.[spec.id] || null, opts, today))
    .sort((a, b) => {
      const rank = (t) => (t.alerts.some((x) => x.pri === 'hi') ? 0 : t.alerts.length ? 1 : t.tracked ? 2 : 3);
      return rank(a) - rank(b);
    });
}
