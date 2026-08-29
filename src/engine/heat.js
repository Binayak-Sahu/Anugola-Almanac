/* ============================================================================
   heat.js — the thermal model.

   Angul station data is one number for the whole district. The site is five
   micro-climates and a closed room, and the difference between them is the
   difference between a plant living and cooking. This module turns the station
   average into a per-zone estimate, then into the two numbers that actually
   decide plant behaviour: heat index (what the leaf experiences) and vapour
   pressure deficit (how fast it loses water).

   Every offset below is a modelled estimate, clearly labelled as such in the
   UI. The Readings log exists so the user can replace them with measurements —
   see calibrate().
   ========================================================================== */

import { clamp, MON } from '../core/util.js';
import { beamFraction, sunPosition } from './solar.js';

/* ==========================================================================
   Per-zone offsets from the open-air station reading, °C.
   [day, night] — a concrete roof and a shaded ground-floor bay diverge most
   at night, which is when a root zone actually recovers.
   ========================================================================== */
export const ZONE_MODEL = {
  A: { day: 0.0, night: -0.5, rh: 0, label: 'Open parking, ground level',
       why: 'Ground-level open air. Radiates to sky at night, so it runs slightly cooler than the station after dark.' },
  B: { day: +2.5, night: +1.5, rh: -5, label: '4th-floor terrace',
       why: 'A concrete slab absorbs all day and re-radiates all night. Add wind, which helps the leaf and dries the bag faster.' },
  C: { day: +3.5, night: +1.0, rh: +8, label: 'South balcony, closed',
       why: 'Glazed and closed: still air, greenhouse gain. Summer is moderated by the overhang, winter is amplified by low sun.' },
  D: { day: -2.5, night: -0.5, rh: +5, label: 'First-floor shade',
       why: '40–50% shade cloth cuts direct beam, so air temperature drops two to three degrees and humidity holds.' },
  E: { day: -3.5, night: +1.5, rh: +6, label: 'Closed parking',
       why: 'Enclosed masonry. High thermal mass flattens the daily swing — which is exactly what a shocked plant needs.' },
  indoor: { day: +4.0, night: +2.0, rh: 0, label: 'Utility room',
       why: 'Two glazed walls facing south, one small room, no cross-ventilation. It runs hot even with the sun off it.' }
};

/* Zone C inverts: the overhang shades it in summer and the low sun floods it
   in winter, so its gain is seasonal rather than constant. */
const ZONE_C_SEASONAL = [+5.5, +5.5, +4.0, +2.0, +1.0, +0.5, +1.0, +1.5, +2.5, +4.0, +5.0, +5.5];

/**
 * Estimated day high and night low for a zone in a given month.
 * @param {string} zone      'A'..'E' or 'indoor'
 * @param {number} month     0–11
 * @param {number[][]} angul [[high, low, rh], ...] × 12 from data/climate.json
 */
/**
 * Relative humidity at the day's HIGH, derived from a monthly MEAN.
 *
 * Absolute humidity barely moves through a day; relative humidity moves a
 * great deal, because the air's capacity to hold water roughly doubles every
 * ten degrees. Pairing a monthly mean RH with a day-high temperature is the
 * commonest way to produce a wildly overstated heat index — it briefly had
 * this app reporting a 60 °C heat index for the balcony in August, which is
 * both wrong and the kind of false alarm that teaches a user to ignore alerts.
 *
 * So: convert the mean RH to an actual vapour pressure at the mean
 * temperature, then re-express it as a percentage of saturation at the high.
 */
export function daytimeRh(meanRh, high, low) {
  const mean = (high + low) / 2;
  const vapourPressure = (meanRh / 100) * svp(mean);
  return clamp(Math.round((100 * vapourPressure) / svp(high)), 5, 100);
}

export function zoneMonth(zone, month, angul) {
  const [high, low, rh] = angul[month];
  const m = ZONE_MODEL[zone] || ZONE_MODEL.A;
  const dayOffset = zone === 'C' ? ZONE_C_SEASONAL[month] : m.day;

  const zoneHigh = Math.round((high + dayOffset) * 10) / 10;
  const zoneLow = Math.round((low + m.night) * 10) / 10;
  const meanRh = clamp(Math.round(rh + m.rh), 5, 100);

  return {
    zone,
    month,
    high: zoneHigh,
    low: zoneLow,
    /* `rh` is the afternoon figure — the one that belongs with `high`. */
    rh: daytimeRh(meanRh, zoneHigh, zoneLow),
    meanRh,
    label: m.label,
    why: m.why,
    modelled: true
  };
}

export const zoneYear = (zone, angul) =>
  Array.from({ length: 12 }, (_, m) => zoneMonth(zone, m, angul));

/* ==========================================================================
   ROOT-ZONE TEMPERATURE
   ==========================================================================
   The number nobody measures and everything dies of. Leaves look fine at 45 °C
   air; fine feeder roots stop at about 35 °C and start dying near 40 °C. In a
   black plastic pot in Talcher's May sun the bag interior crosses 50 °C.

   Modelled as air temperature plus a solar load scaled by what the bag is made
   of and how it is set up.
   ========================================================================== */

/** Solar gain multiplier by container. 1.0 = a black plastic pot in full sun. */
export const BAG_FACTOR = {
  'black-plastic': 1.00,
  'hdpe-dark': 0.80,
  'hdpe-pale': 0.55,
  'fabric-dark': 0.60,
  'fabric-pale': 0.38,     // the 400 GSM beige/grey/white bag the plan calls for
  terracotta: 0.34,        // evaporative cooling through the wall
  cement: 0.30,
  'double-potted': 0.18,
  'mulched-raised': 0.14
};

/** Additional reduction from shade cloth, as a fraction of solar load removed. */
export const SHADE_FACTOR = { none: 0, '30': 0.30, '50': 0.50, '75': 0.75 };

/**
 * Estimated peak root-zone temperature.
 * @param {object} o { airHigh, bag, shade, mulched, date }
 */
export function rootZoneTemp({ airHigh, bag = 'fabric-pale', shade = 'none', mulched = false, date = new Date() }) {
  const beam = beamFraction(new Date(date.getFullYear(), date.getMonth(), date.getDate(), 13, 30));
  /* 14 °C is the observed rise of a black plastic pot over air at full beam. */
  const load = 14 * beam * (BAG_FACTOR[bag] ?? 0.5) * (1 - (SHADE_FACTOR[shade] ?? 0));
  const mulchCredit = mulched ? 2.5 : 0;
  return Math.round((airHigh + load - mulchCredit) * 10) / 10;
}

export function rootZoneVerdict(t) {
  if (t < 30) return { level: 0, text: 'Comfortable' };
  if (t < 35) return { level: 1, text: 'Warm — growth slowing' };
  if (t < 40) return { level: 2, text: 'Feeder roots stalling' };
  if (t < 45) return { level: 3, text: 'Root death starts here' };
  return { level: 4, text: 'Lethal. The leaves will look fine right up until they do not.' };
}

/* ==========================================================================
   HEAT INDEX — NWS Rothfusz regression, worked in °F and returned in °C
   ========================================================================== */

const c2f = (c) => c * 9 / 5 + 32;
const f2c = (f) => (f - 32) * 5 / 9;

export function heatIndexC(tempC, rh) {
  if (tempC == null || rh == null) return null;
  const T = c2f(tempC);
  if (T < 80) {
    const simple = 0.5 * (T + 61 + (T - 68) * 1.2 + rh * 0.094);
    return Math.round(f2c((simple + T) / 2) * 10) / 10;
  }
  let hi = -42.379 + 2.04901523 * T + 10.14333127 * rh
    - 0.22475541 * T * rh - 0.00683783 * T * T - 0.05481717 * rh * rh
    + 0.00122874 * T * T * rh + 0.00085282 * T * rh * rh
    - 0.00000199 * T * T * rh * rh;

  if (rh < 13 && T >= 80 && T <= 112) {
    hi -= ((13 - rh) / 4) * Math.sqrt((17 - Math.abs(T - 95)) / 17);
  } else if (rh > 85 && T >= 80 && T <= 87) {
    hi += ((rh - 85) / 10) * ((87 - T) / 5);
  }
  return Math.round(f2c(hi) * 10) / 10;
}

/**
 * Five bands, matching --stress-0..4.
 *
 * Calibrated for PLANTS, not for human comfort — the NWS scale is about heat
 * stroke, this one is about stomatal closure. `beyondChart` marks the region
 * where the Rothfusz regression itself stops being trustworthy (the published
 * table ends around 137 °F / 58 °C), so the UI can stop quoting a decimal
 * place it has not earned.
 */
export function heatBand(hiC) {
  if (hiC == null) return { level: 0, label: 'No data', advice: '', beyondChart: false };
  const beyondChart = hiC > 54;
  if (hiC < 32) return { level: 0, label: 'Comfortable', advice: 'Normal routine.', beyondChart };
  if (hiC < 39) return { level: 1, label: 'Warm', advice: 'Water earlier. Check the terrace bags by mid-afternoon.', beyondChart };
  if (hiC < 45) return { level: 2, label: 'Caution', advice: 'Shade cloth over anything young. Water at dawn, never at noon.', beyondChart };
  if (hiC < 51) return { level: 3, label: 'Extreme caution', advice: 'Twice-daily watering in A and B. Move anything moveable to E. Do not repot, do not feed.', beyondChart };
  return {
    level: 4,
    label: 'Danger',
    advice: 'Emergency: fogger on, everything portable into Zone E, no work outdoors after 10 am.',
    beyondChart
  };
}

/* ==========================================================================
   VAPOUR PRESSURE DEFICIT
   ==========================================================================
   The right way to think about the "closed balcony with no air movement"
   problem, and the number a grow-light setup should be tuned to.
   ========================================================================== */

/** Saturation vapour pressure, kPa. Tetens. */
export const svp = (tempC) => 0.6108 * Math.exp((17.27 * tempC) / (tempC + 237.3));

/** VPD in kPa. `leafOffset` is how much cooler the leaf runs than the air —
    about 2 °C when transpiration is working, 0 when the stomata have shut. */
export function vpd(tempC, rh, leafOffset = 2) {
  if (tempC == null || rh == null) return null;
  const leaf = svp(tempC - leafOffset);
  const air = svp(tempC) * (rh / 100);
  return Math.round(Math.max(0, leaf - air) * 100) / 100;
}

export function vpdBand(kpa) {
  if (kpa == null) return { level: 0, label: 'No data', advice: '' };
  if (kpa < 0.4) return { level: 2, label: 'Too still and damp', advice: 'Fungal risk and weak transpiration. Move air.' };
  if (kpa < 0.8) return { level: 0, label: 'Propagation range', advice: 'Right for cuttings and fresh grafts.' };
  if (kpa < 1.2) return { level: 0, label: 'Ideal vegetative', advice: 'Nothing to do.' };
  if (kpa < 1.6) return { level: 1, label: 'Ideal fruiting', advice: 'Good. Keep water steady.' };
  if (kpa < 2.2) return { level: 2, label: 'Stressful', advice: 'Transpiration outruns uptake by afternoon. Shade or mist.' };
  return { level: 3, label: 'Stomata closing', advice: 'The plant has stopped feeding itself. Shade cloth and humidity, not more fertiliser.' };
}

/* ==========================================================================
   PLANT STRESS — comfort band vs. modelled zone conditions
   ========================================================================== */

/**
 * @param {object} plant  catalogue row with tmin/tmax/hmin/hmax (may be null)
 * @param {object} cond   { high, low, rh } from zoneMonth()
 * @returns {{score:number, reasons:string[]}} score 0 (fine) to 4 (lethal)
 */
export function plantStress(plant, cond) {
  const reasons = [];
  let score = 0;

  if (plant?.tmax != null && cond.high > plant.tmax) {
    const over = cond.high - plant.tmax;
    score = Math.max(score, over > 10 ? 4 : over > 6 ? 3 : over > 2 ? 2 : 1);
    reasons.push(`${Math.round(over)} °C above its comfortable maximum`);
  }
  if (plant?.tmin != null && cond.low < plant.tmin) {
    const under = plant.tmin - cond.low;
    score = Math.max(score, under > 8 ? 3 : under > 3 ? 2 : 1);
    reasons.push(`${Math.round(under)} °C below its comfortable minimum`);
  }
  if (plant?.hmin != null && cond.rh < plant.hmin) {
    score = Math.max(score, cond.rh < plant.hmin - 20 ? 3 : 1);
    reasons.push(`air is ${plant.hmin - cond.rh}% drier than it likes`);
  }
  return { score, reasons };
}

export const stressYear = (plant, zone, angul) =>
  Array.from({ length: 12 }, (_, m) => plantStress(plant, zoneMonth(zone, m, angul)).score);

/** How many months of the year a plant is not stressed in a zone. */
export function fitScore(plant, zone, angul) {
  const year = stressYear(plant, zone, angul);
  const good = year.filter((s) => s <= 1).length;
  return { good, months: year, verdict: good >= 10 ? 'yes' : good >= 7 ? 'watch' : 'no' };
}

/* ==========================================================================
   CALIBRATION — replace the model with measurements
   ==========================================================================
   Once the user has logged readings, the model should defer to them. This
   returns a corrected offset per zone, plus how much data it is standing on,
   so the UI can say "modelled" or "from 34 of your readings".
   ========================================================================== */

/**
 * @param {object[]} readings  store.readings
 * @param {number[][]} angul   station data
 * @returns {Object<string,{samples:number, dayBias:number, rhBias:number}>}
 */
export function calibrate(readings, angul) {
  const acc = {};
  for (const r of readings) {
    if (r.tempC == null && r.rh == null) continue;
    const d = new Date(r.at);
    if (Number.isNaN(d.getTime())) continue;
    const hour = d.getHours();
    /* Only afternoon readings speak to the day high. */
    if (hour < 12 || hour > 17) continue;

    const zone = r.zone || 'A';
    const predicted = zoneMonth(zone, d.getMonth(), angul);
    (acc[zone] ||= { samples: 0, dTemp: 0, dRh: 0, nTemp: 0, nRh: 0 });
    acc[zone].samples++;
    if (r.tempC != null) { acc[zone].dTemp += r.tempC - predicted.high; acc[zone].nTemp++; }
    if (r.rh != null) { acc[zone].dRh += r.rh - predicted.rh; acc[zone].nRh++; }
  }

  const out = {};
  for (const [zone, a] of Object.entries(acc)) {
    out[zone] = {
      samples: a.samples,
      dayBias: a.nTemp ? Math.round((a.dTemp / a.nTemp) * 10) / 10 : 0,
      rhBias: a.nRh ? Math.round(a.dRh / a.nRh) : 0,
      /* Below about eight afternoon readings the correction is noise. */
      trusted: a.samples >= 8
    };
  }
  return out;
}

/** zoneMonth, corrected by the user's own readings where there are enough. */
export function zoneMonthCalibrated(zone, month, angul, calibration) {
  const base = zoneMonth(zone, month, angul);
  const c = calibration?.[zone];
  if (!c?.trusted) return base;
  return {
    ...base,
    high: Math.round((base.high + c.dayBias) * 10) / 10,
    rh: clamp(base.rh + c.rhBias, 5, 100),
    modelled: false,
    samples: c.samples
  };
}

export const monthLabel = (m) => MON[m];
