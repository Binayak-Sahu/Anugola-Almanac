/* ============================================================================
   feed.js — fertiliser dosing, pH management and coal-ash compensation.

   THE LOCAL PROBLEM
   Talcher sits among opencast mines and thermal stations. Fly ash settles on
   everything and washes into the bags with every rain. Fly ash is alkaline —
   typically pH 8–12 — and it is calcium- and sulphate-rich. Three consequences
   the rest of the app has to account for:

     1. Substrate pH drifts UP over a season, not down.
     2. Above about pH 7.5 iron, manganese and zinc go chemically unavailable.
        The plant is standing in them and starving. Interveinal chlorosis on
        NEW growth is the tell — see the deficiency guide.
     3. Feeding harder makes it worse: more salt, same lock-out. The fix is
        acidification and a chelate the high pH cannot break, not more NPK.

   Everything below is expressed per bag, because that is the unit the user
   actually handles.
   ========================================================================== */

import { clamp, round } from '../core/util.js';

/* ==========================================================================
   Products
   ==========================================================================
   data/feed.json's FEEDS table is a "what to feed what" reference written in
   prose — it has no machine-readable analysis. The calculator needs real
   N-P-K numbers, so the products actually available in Odisha are listed here.
   `gPerL` is the label rate.
   ========================================================================== */

/**
 * `gPer10L` is grams of product per 10 LITRES OF SUBSTRATE per application —
 * not grams per litre of water.
 *
 * That distinction is the whole reason this table exists. Indian labels quote
 * "2–3 g/litre", which is a CONCENTRATION and says nothing about how much
 * solution a plant should get. Read naively — 3 g/L across a proper 10.75 L
 * soak of a 43 L bag — it prescribes 32 g of 19:19:19 in one go, roughly six
 * grams of nitrogen, into a single container. That is a salt dose, not a feed.
 * Dosing per unit of substrate and then dissolving it in the soak volume gives
 * both numbers correctly, and the resulting concentration falls out at a sane
 * 0.8 g/L on its own.
 *
 * mode:  drench      dissolved and watered in, scaled to the bag
 *        foliar      sprayed to run-off, concentration only, not bag-scaled
 *        incorporate mixed into the substrate at potting, dry
 */
export const PRODUCTS = [
  { id: 'npk191919', name: '19:19:19 water-soluble', n: 19, p: 19, k: 19, gPer10L: 2.0, mode: 'drench',
    use: 'The general-purpose workhorse. Fortnightly through the growing season.' },
  { id: 'npk123316', name: '12:33:16 (bloom)', n: 12, p: 33, k: 16, gPer10L: 2.0, mode: 'drench',
    use: 'Pre-flowering push. Two applications, not a routine.' },
  { id: 'npk130045', name: '13:0:45 (potassium nitrate)', n: 13, p: 0, k: 45, gPer10L: 1.5, mode: 'drench',
    use: 'High-K for fruiting. Papaya the moment flowers set; tomato and chilli from the first truss.' },
  { id: 'urea', name: 'Urea 46:0:0', n: 46, p: 0, k: 0, gPer10L: 0.7, mode: 'drench',
    use: 'Nitrogen only, and the easiest thing here to overdo. Never on a dry bag.' },
  { id: 'mop', name: 'Muriate of potash 0:0:60', n: 0, p: 0, k: 60, gPer10L: 1.0, mode: 'drench',
    use: 'Cheap potassium. Chloride-based, so avoid it on anything salt-sensitive.' },
  { id: 'seaweed', name: 'Seaweed extract', n: 1, p: 0.5, k: 4, gPer10L: 2.5, mode: 'drench',
    use: 'Not really a fertiliser — a stress buffer. The one thing worth applying in May.' },
  { id: 'npk00523 4', name: '0:52:34 (mono-potassium phosphate)', n: 0, p: 52, k: 34, sprayGPerL: 5, mode: 'foliar',
    use: 'Flower-initiation spray for mango in October. Two sprays, twelve days apart. Not a soil feed.' },
  { id: 'ssp', name: 'Single super phosphate', n: 0, p: 16, k: 0, gPer10L: 10, mode: 'incorporate',
    use: 'Worked into the mix at potting, dry. Also supplies the calcium and sulphur coco does not.' }
];

/* ==========================================================================
   Dose calculation
   ========================================================================== */

/**
 * @param {object} product from PRODUCTS
 * @param {number} bagLitres substrate volume
 * @param {number} strength 0.5 (half) … 1 (standard) … 1.5
 * @returns {{mode, solutionLitres, grams, gPerL, ppm, mgPerBag}}
 */
export function dose(product, bagLitres, strength = 1) {
  const mode = product.mode || 'drench';

  if (mode === 'foliar') {
    const gPerL = (product.sprayGPerL ?? 5) * strength;
    return {
      mode,
      solutionLitres: 1,
      gPerL: round(gPerL, 2),
      grams: round(gPerL, 2),
      ppm: nutrients(gPerL),
      mgPerBag: { n: null, p: null, k: null }
    };
  }

  const grams = round((bagLitres / 10) * (product.gPer10L ?? 2) * strength, 1);

  if (mode === 'incorporate') {
    return {
      mode, solutionLitres: 0, gPerL: 0, grams,
      ppm: { n: 0, p: 0, k: 0 },
      mgPerBag: milligrams(grams)
    };
  }

  /* A feed IS a watering: a quarter of substrate volume, enough to wet
     through and run 10–15% from the base. */
  const solutionLitres = round(Math.max(0.5, bagLitres * 0.25), 2);
  const gPerL = grams / solutionLitres;

  return {
    mode,
    solutionLitres,
    gPerL: round(gPerL, 2),
    grams,
    ppm: nutrients(gPerL),
    mgPerBag: milligrams(grams)
  };

  function nutrients(concentration) {
    return {
      n: Math.round(concentration * (product.n || 0) * 10),
      p: Math.round(concentration * (product.p || 0) * 10),
      k: Math.round(concentration * (product.k || 0) * 10)
    };
  }
  function milligrams(g) {
    return {
      n: Math.round(g * (product.n || 0) * 10),
      p: Math.round(g * (product.p || 0) * 10),
      k: Math.round(g * (product.k || 0) * 10)
    };
  }
}

/**
 * Sanity band on the applied nitrogen concentration.
 * Calibrated for a fortnightly drench, not continuous fertigation — a
 * commercial fertigation line runs 100–150 ppm every single watering, so the
 * ceiling here is deliberately higher than a hydroponics chart would give.
 */
export function doseVerdict(ppmN) {
  if (ppmN < 80) return { level: 0, label: 'Light', text: 'Maintenance strength. Right for a freshly potted plant or the winter tick-over.' };
  if (ppmN < 180) return { level: 0, label: 'Standard', text: 'Normal fortnightly feed for a growing container tree.' };
  if (ppmN < 280) return { level: 1, label: 'Strong', text: 'Only for a heavy feeder in full flush — brinjal after a ratoon cut, papaya carrying fruit.' };
  return { level: 2, label: 'Too strong', text: 'Above 280 ppm N in a single drench you are salting the bag. Halve it and feed twice as often instead.' };
}

/* ==========================================================================
   pH
   ========================================================================== */

export const PH_BANDS = [
  { max: 5.4, key: 'acid', label: 'Too acid', note: 'Calcium and magnesium go short; aluminium becomes available and burns root tips.' },
  { max: 6.5, key: 'ideal', label: 'Ideal', note: 'Everything is available. This is the target for containers here.' },
  { max: 7.2, key: 'high', label: 'Slightly alkaline', note: 'Iron and manganese starting to tighten. Watch new growth.' },
  { max: 7.8, key: 'lockout', label: 'Lock-out beginning', note: 'Iron chlorosis on new leaves. EDTA chelates stop working around here.' },
  { max: 14, key: 'severe', label: 'Fly-ash alkaline', note: 'Iron, manganese, zinc and phosphorus all restricted. Acidify before you feed again.' }
];

export const phBand = (ph) => PH_BANDS.find((b) => ph <= b.max) || PH_BANDS[PH_BANDS.length - 1];

/**
 * Elemental sulphur needed to drop container pH.
 *
 * Field rates are quoted per hectare for mineral soil and are useless for a
 * 43 L bag. Working from buffering capacity instead: a peat/coco container mix
 * needs roughly 0.5–0.7 g of elemental sulphur per litre per pH unit. Sand and
 * coco sit at the low end, anything with clay or ash at the high end.
 *
 * Sulphur is biological — soil bacteria oxidise it — so it takes 4–8 weeks at
 * these temperatures and cannot be rushed. For a same-week correction, use
 * acidified irrigation instead (see acidifyWater).
 */
export function sulphurDose(bagLitres, fromPh, toPh = 6.2, buffering = 'coco') {
  const RATE = { sand: 0.42, coco: 0.55, loam: 0.70, ash: 0.90 };
  const drop = Math.max(0, fromPh - toPh);
  if (!drop) return { grams: 0, weeks: 0, note: 'Already at or below target.' };

  const grams = round(bagLitres * (RATE[buffering] ?? 0.55) * drop, 1);
  return {
    grams,
    weeks: '4–8',
    /* Overshooting is far harder to undo than undershooting. */
    note: grams > bagLitres * 1.2
      ? 'That is a large correction. Split it over two applications eight weeks apart and re-test between.'
      : 'Work it into the top 5 cm and water in. Re-test in six weeks — sulphur is bacterial, not chemical, and it will not move faster than the bugs do.',
    cap: round(bagLitres * 1.2, 0)
  };
}

/**
 * Same-week fix: acidify the irrigation water. Talcher groundwater plus fly ash
 * runs hard and alkaline, so this is the tool that actually gets used.
 */
export function acidifyWater(litres, fromPh, toPh = 6.2) {
  const drop = Math.max(0, fromPh - toPh);
  if (!drop) return null;
  /* Household 5% vinegar: about 1.5 ml per litre per pH unit against a
     moderately buffered hard water. Always measure after mixing, never before. */
  const vinegarMl = round(litres * 1.5 * drop, 1);
  const citricG = round(litres * 0.35 * drop, 2);
  return {
    vinegarMl,
    citricG,
    warn: 'Mix, wait two minutes, then measure. Never acidify and feed in the same can without checking — some soluble fertilisers shift pH by a full unit on their own.'
  };
}

/**
 * Fly-ash load correction. Ash falling on and washing into an open bag is a
 * continuous liming input, so an outdoor bag here drifts alkaline every season
 * whatever it started at.
 */
export function ashDrift({ zone = 'A', months = 6, covered = false }) {
  /* Terrace catches the most fall-out, the closed balcony and closed parking
     almost none. Numbers are estimated drift in pH units per six months. */
  const EXPOSURE = { A: 0.45, B: 0.60, C: 0.10, D: 0.25, E: 0.05, indoor: 0 };
  const rate = (EXPOSURE[zone] ?? 0.3) * (covered ? 0.35 : 1);
  const drift = round((rate * months) / 6, 2);
  return {
    drift,
    text: drift < 0.1
      ? 'Negligible ash loading in this zone.'
      : `Expect roughly +${drift} pH over ${months} months from ash fall-out alone.`,
    fix: covered
      ? 'Mulch is doing its job. Keep it topped up.'
      : 'Two inches of mulch cuts this by about two-thirds, and it also holds the root zone below 40 °C in May. Same fix, two problems.'
  };
}

/**
 * Which iron chelate actually works at a given pH. This is the single most
 * useful piece of fertiliser advice for an alkaline site and it is almost
 * never on the label.
 */
export function ironChelate(ph) {
  if (ph <= 6.5) return { form: 'Fe-EDTA', ok: true, note: 'Cheapest form, and stable at this pH. Nothing fancier is needed.' };
  if (ph <= 7.0) return { form: 'Fe-DTPA', ok: true, note: 'EDTA is losing hold above 6.5. DTPA holds to about 7.0.' };
  return {
    form: 'Fe-EDDHA',
    ok: true,
    note: 'Above pH 7 only EDDHA stays chelated. It is four times the price and the only one that will work — buying EDTA for an alkaline bag is money poured on the floor.'
  };
}

/* ==========================================================================
   Salt
   ========================================================================== */

/**
 * Estimated accumulated salt from feeding without leaching.
 * Rough but directionally right, and the point is the flush reminder.
 */
export function saltLoad({ feedsSinceFlush = 0, gPerFeed = 3, bagLitres = 43 }) {
  const mgPerL = (feedsSinceFlush * gPerFeed * 1000) / Math.max(1, bagLitres);
  const ecEstimate = round(mgPerL / 640, 2);   // 1 dS/m ≈ 640 mg/L TDS
  let level = 0;
  if (ecEstimate > 1.5) level = 1;
  if (ecEstimate > 2.5) level = 2;
  if (ecEstimate > 3.5) level = 3;
  return {
    ecEstimate,
    level,
    label: ['Clean', 'Building', 'High', 'Damaging'][level],
    flushNeeded: level >= 1,
    flushLitres: round(bagLitres * 2, 0),
    note: level >= 1
      ? `Run ${round(bagLitres * 2, 0)} L of plain water through the bag slowly, in one sitting. Leaf-margin scorch that looks like sunburn is usually this.`
      : 'No flush needed yet. Flush anyway before the first feed of October.'
  };
}

/* ==========================================================================
   The feeding year
   ========================================================================== */

/**
 * Whether to feed at all this month. The answer in June is no, and that is
 * the hardest instruction in the whole app to follow.
 */
export function feedGate(month, { pottedWithinDays = null, heatIndexC = null } = {}) {
  if (pottedWithinDays !== null && pottedWithinDays < 21) {
    return { feed: false, why: `Potted ${pottedWithinDays} days ago. Fertiliser on a freshly cut root system burns it. Wait until day 21–28.` };
  }
  if (heatIndexC !== null && heatIndexC >= 45) {
    return { feed: false, why: 'Heat index above 45 °C. A plant with its stomata shut cannot use nitrogen; all it does is add salt to a hot bag.' };
  }
  if (month === 4 || month === 5) {
    return { feed: false, why: 'May and June: the plant is surviving, not growing. Water and shade only. This is the month you feed nothing at all.' };
  }
  if (month === 11 || month === 0) {
    return { feed: 'light', why: 'Cool season. Half strength, and potassium-led rather than nitrogen-led.' };
  }
  return { feed: true, why: 'Growing season. Normal fortnightly schedule.' };
}
