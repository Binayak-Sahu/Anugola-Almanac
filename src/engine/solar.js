/* ============================================================================
   solar.js — sun geometry for 20.95°N, 85.22°E (Talcher, Angul).

   Why this file exists at all:

   The whole site plan rests on one latitude fact. At 20.95°N the June sun
   passes within 2.5° of vertical, so a south-facing overhang shades the
   balcony beneath it all summer; in December the same sun sits 45° up in the
   south and floods it. That is why Zone C has an inverted calendar and why the
   winter vegetable programme goes there. v9 asserted this in prose. Here it is
   computed, so the app can show the user the actual profile angle on any date
   and size an overhang instead of guessing.

   Everything is plain trigonometry — NOAA's low-precision solar equations,
   good to about a minute of arc, which is three orders of magnitude better
   than the accuracy of "put the tomatoes near the rail".
   ========================================================================== */

export const SITE = {
  lat: 20.95,
  lon: 85.22,
  tzOffsetHours: 5.5,      // IST
  stdMeridian: 82.5        // 15° × 5.5
};

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const sin = (deg) => Math.sin(deg * D2R);
const cos = (deg) => Math.cos(deg * D2R);
const tan = (deg) => Math.tan(deg * D2R);
const asin = (x) => Math.asin(Math.max(-1, Math.min(1, x))) * R2D;
const acos = (x) => Math.acos(Math.max(-1, Math.min(1, x))) * R2D;

/** Day of year, 1-based. */
export function dayOfYear(d = new Date()) {
  const start = Date.UTC(d.getFullYear(), 0, 0);
  const here = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((here - start) / 864e5);
}

/** Solar declination in degrees. Cooper's equation. */
export function declination(n) {
  return 23.45 * sin((360 / 365) * (284 + n));
}

/** Equation of time, minutes. Spencer's series, ±0.5 min. */
export function equationOfTime(n) {
  const b = (360 / 364) * (n - 81) * D2R;
  return 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
}

/** Local clock time → apparent solar time, in decimal hours. */
export function solarTime(date, lat = SITE.lat, lon = SITE.lon) {
  const n = dayOfYear(date);
  const clock = date.getHours() + date.getMinutes() / 60;
  const correction = 4 * (lon - SITE.stdMeridian) + equationOfTime(n);
  return clock + correction / 60;
}

/**
 * Sun position for an instant.
 * @returns {{altitude:number, azimuth:number, declination:number, hourAngle:number}}
 *          altitude in degrees above the horizon (negative = below);
 *          azimuth in degrees clockwise from north (180 = due south).
 */
export function sunPosition(date = new Date(), lat = SITE.lat, lon = SITE.lon) {
  const n = dayOfYear(date);
  const dec = declination(n);
  const H = 15 * (solarTime(date, lat, lon) - 12);

  const altitude = asin(sin(lat) * sin(dec) + cos(lat) * cos(dec) * cos(H));

  /* Azimuth measured from north, clockwise, so morning sun reads ~090 and
     afternoon ~270 — the way a compass app reads it. */
  const y = -sin(H) * cos(dec);
  const x = cos(lat) * sin(dec) - sin(lat) * cos(dec) * cos(H);
  let azimuth = Math.atan2(y, x) * R2D;
  azimuth = (azimuth + 360) % 360;

  return { altitude, azimuth, declination: dec, hourAngle: H };
}

/** Noon altitude — the number that decides whether an overhang works. */
export function noonAltitude(date = new Date(), lat = SITE.lat) {
  return 90 - Math.abs(lat - declination(dayOfYear(date)));
}

/**
 * Sunrise, sunset and daylength for a date, in local decimal hours.
 * Returns nulls above the arctic circle; irrelevant here but honest.
 */
export function dayLength(date = new Date(), lat = SITE.lat, lon = SITE.lon) {
  const n = dayOfYear(date);
  const dec = declination(n);
  const cosH0 = -tan(lat) * tan(dec);
  if (cosH0 > 1) return { sunrise: null, sunset: null, hours: 0, polar: 'night' };
  if (cosH0 < -1) return { sunrise: null, sunset: null, hours: 24, polar: 'day' };

  const H0 = acos(cosH0);
  const correction = (4 * (lon - SITE.stdMeridian) + equationOfTime(n)) / 60;
  const noon = 12 - correction;
  return {
    sunrise: noon - H0 / 15,
    sunset: noon + H0 / 15,
    solarNoon: noon,
    hours: (2 * H0) / 15,
    polar: null
  };
}

/** Relative clear-sky beam irradiance on a horizontal surface, 0–1. */
export function beamFraction(date = new Date(), lat = SITE.lat) {
  const alt = sunPosition(date, lat).altitude;
  if (alt <= 0) return 0;
  /* Air-mass attenuation, Kasten–Young simplified. */
  const airMass = 1 / (sin(alt) + 0.50572 * (alt + 6.07995) ** -1.6364);
  return 0.7 ** (airMass ** 0.678) * sin(alt);
}

/** Daily integrated light, sampled every 20 minutes. Arbitrary units, but
    comparable month to month — which is all a "how much light in May vs
    December" chart needs. */
export function dailyLight(date = new Date(), lat = SITE.lat) {
  let total = 0;
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  for (let m = 0; m < 24 * 60; m += 20) {
    d.setHours(0, m, 0, 0);
    total += beamFraction(d, lat);
  }
  return total / 3;   // per-hour equivalent
}

/** Twelve monthly samples on the 15th, for charts. */
export function solarYear(year = new Date().getFullYear(), lat = SITE.lat) {
  return Array.from({ length: 12 }, (_, m) => {
    const d = new Date(year, m, 15);
    return {
      month: m,
      noonAltitude: noonAltitude(d, lat),
      declination: declination(dayOfYear(d)),
      dayLength: dayLength(d, lat).hours,
      light: dailyLight(d, lat)
    };
  });
}

/** The day's arc, sampled for drawing a sun path. */
export function sunPath(date = new Date(), stepMinutes = 15, lat = SITE.lat) {
  const out = [];
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  for (let m = 0; m < 24 * 60; m += stepMinutes) {
    d.setHours(0, m, 0, 0);
    const p = sunPosition(d, lat);
    if (p.altitude > -1) out.push({ minutes: m, ...p });
  }
  return out;
}

/* ==========================================================================
   OVERHANG SHADING — the Zone C model
   ==========================================================================
   A horizontal overhang above a south-facing opening. The governing quantity
   is the PROFILE ANGLE (vertical shadow angle): the sun's altitude projected
   into the plane perpendicular to the wall.

       tan(profile) = tan(altitude) / cos(azimuth − wallAzimuth)

   The shadow the overhang casts down the wall face is then

       drop = projection × tan(profile)

   Once `drop` exceeds the head-to-sill height, the opening is fully shaded.
   ========================================================================== */

/** Profile angle in degrees, or null when the sun is behind the wall. */
export function profileAngle(altitude, azimuth, wallAzimuth = 180) {
  const rel = ((azimuth - wallAzimuth + 540) % 360) - 180;   // −180..180
  if (Math.abs(rel) >= 90 || altitude <= 0) return null;      // sun is behind it
  return Math.atan2(tan(altitude), cos(rel)) * R2D;
}

/**
 * The default geometry.
 *
 * `projection` is measured from the GLASS LINE outward, not from the wall
 * behind it. On a closed balcony the glazing sits at the outer edge and the
 * slab above projects only a little past it, so this number is small — 0.4 to
 * 0.8 m is typical. Using the balcony's full depth here is the easy mistake,
 * and it makes the model claim the balcony is shaded in December, which it
 * plainly is not. The Zones screen lets the user measure their own.
 */
export const BALCONY_DEFAULT = { projection: 0.6, openingHeight: 2.1, sillHeight: 0.9, wallAzimuth: 180 };

/**
 * How much of a south-facing opening is in sun right now.
 *
 * The overhang is taken to sit at the head of the opening — the underside of
 * the slab above — and to project `projection` metres out from the glass.
 * Its shadow travels DOWN the glass by `drop`, so the sunlit band is whatever
 * is left below it.
 *
 * @param {object} geom { projection, openingHeight, sillHeight, wallAzimuth }
 *                      metres; sillHeight is measured up from the floor.
 */
export function overhangShade(geom, date = new Date(), lat = SITE.lat) {
  const { projection, openingHeight, sillHeight, wallAzimuth } = { ...BALCONY_DEFAULT, ...(geom || {}) };
  const pos = sunPosition(date, lat);
  const prof = profileAngle(pos.altitude, pos.azimuth, wallAzimuth);

  if (prof === null) {
    return { ...pos, profile: null, drop: null, sunlitFraction: 0, floorPenetration: 0, state: 'behind' };
  }

  const drop = projection * tan(prof);
  const sunlitHeight = Math.max(0, Math.min(openingHeight, openingHeight - drop));
  const sunlitFraction = openingHeight > 0 ? sunlitHeight / openingHeight : 0;

  /* The lowest ray clears the overhang's outer edge, which sits at head height
     (sill + glass) and `projection` out from the glass. Where it meets the
     floor, measured back from the glass line, is how far the sun reaches in. */
  const head = openingHeight + sillHeight;
  const floorPenetration = Math.max(0, head / tan(prof) - projection);

  return {
    ...pos,
    profile: prof,
    drop,
    sunlitFraction,
    floorPenetration,
    state: sunlitFraction <= 0.001 ? 'shaded' : sunlitFraction >= 0.999 ? 'full sun' : 'partial'
  };
}

/**
 * Noon shading month by month — the chart that explains why Zone C peaks in
 * December and goes dark in June.
 */
export function overhangYear(geom, year = new Date().getFullYear(), lat = SITE.lat) {
  return Array.from({ length: 12 }, (_, m) => {
    const d = new Date(year, m, 15);
    /* Evaluate at true solar noon, the worst case for a south overhang. */
    const { solarNoon } = dayLength(d, lat);
    d.setHours(Math.floor(solarNoon), Math.round((solarNoon % 1) * 60), 0, 0);
    const s = overhangShade(geom, d, lat);
    return { month: m, ...s };
  });
}

/* ==========================================================================
   CHILL HOURS
   ==========================================================================
   Hours below 7.2 °C accumulated Nov–Feb. Temperate fruit (apple, most peach,
   most plum) needs 200–1000+. This is the single number that rules them out
   here, and the knowledge cards quote it, so it gets computed rather than
   asserted.
   ========================================================================== */

/**
 * Estimate annual chill hours from monthly mean minima and maxima using a
 * sinusoidal daily temperature curve. Crude but well-behaved, and it gets the
 * answer that matters — Talcher is effectively zero.
 * @param {number[][]} monthly  [[high, low, humidity], ...] × 12
 */
export function chillHours(monthly, threshold = 7.2) {
  const DAYS = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let hours = 0;
  monthly.forEach(([high, low], m) => {
    const mean = (high + low) / 2;
    const amp = (high - low) / 2;
    if (mean - amp >= threshold) return;                 // never gets cold enough
    if (mean + amp <= threshold) { hours += DAYS[m] * 24; return; }
    /* Fraction of a sine day spent below the threshold. */
    const x = (threshold - mean) / amp;                  // −1..1
    const frac = Math.acos(Math.max(-1, Math.min(1, x))) / Math.PI;
    hours += DAYS[m] * 24 * (1 - frac);
  });
  return Math.round(hours);
}

/** Plain-language verdict on a stated chill requirement. */
export function chillVerdict(requiredHours, siteHours) {
  if (!requiredHours) return { ok: true, text: 'No chill requirement' };
  if (siteHours >= requiredHours) return { ok: true, text: `${siteHours} h available` };
  return {
    ok: false,
    text: `Needs ${requiredHours} h; this site gives about ${siteHours} h. It will grow and never fruit.`
  };
}
