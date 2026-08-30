# The Angul Almanac — v10 architecture

Talcher, Angul district, Odisha. 20.95° N, 85.22° E.

This document is the reasoning behind the v10 rebuild: what was wrong with v9,
what replaced it, and what is left to do. It is written for whoever picks this
up next, including the author in eighteen months.

---

## 1. Audit of v9

v9 was one 436 KB `index.html`: 6,363 lines holding 1,057 lines of CSS, ~4,160
lines of JavaScript, ~1,100 lines of markup and a JSON memory block. It worked.
It was also at the end of what that shape can carry.

### What was genuinely good, and was kept

| Thing | Why it stays |
|---|---|
| Offline-first service worker | The whole point. A phone in a yard has no signal. |
| Five micro-climate zones | The correct model of the site. Most apps assume one place. |
| "Ruled out — and why" | The most valuable list in the app. Apple, litchi, peach, mangosteen, durian and Alphonso are all sold locally and none will fruit here. |
| Propagation as a first-class field | A grafted mango fruits in three years, a seedling in eight and not true to type. This decides more than anything else on the card. |
| Prose that says *why* | "Do not feed in May" is an instruction. "In May the plant is surviving, not growing" is knowledge. |
| Netlify Blobs sync via one function | Right size for the problem. Unchanged wire protocol. |

### What was wrong

**A1 — Catalogue references were array indexes.**
A pot stored `sp: 16`, a position in the `RAW` array. Insert one houseplant
above it and every pot in the ledger silently points at a different species.
The catalogue had already grown 121 → 225 entries.

**A2 — Five catalogue rows collide on their name slug.**
Kagzi lime, Kaffir lime, Barbados cherry and Karonda each appear twice
(houseplant list and fruit list, differing only in capitalisation), and one
untreated-beetroot seed row is entered twice. Invisible while references were
numeric; fatal once they became keys. Now disambiguated in the extractor and
labelled with `dupOf` so the duplication stays visible.

**A3 — `unsafe-inline` in the Content-Security-Policy.**
Forced by the app living in an inline `<script>`. One injected string in a
user-entered plant note could execute. v10 has no inline script at all, so the
policy is now `script-src 'self'`.

**A4 — Save was manual.**
`save()` was called by hand from render code. Every new feature was a chance to
forget it.

**A5 — Watering intervals were invented from prose.**
Fixed in v9 itself, and the fix is now enforced by a test: `schedule()` returns
`scheduled: false` and the written rule verbatim when there is no real number.

**A6 — No trend data.**
Watering was a field, not a log. A field tells you the state; a log tells you
the trend, which is the entire point of a tracker.

**A7 — One theme family.** `data-theme="day|night"`.

### Two bugs found while building v10, both real

**Heat index was badly overstated.** The model paired a *monthly mean* humidity
with a *day-high* temperature. Air holds roughly twice as much water at 40 °C as
at 30 °C, so relative humidity at the afternoon peak is far below the daily
mean. The August balcony was reporting a 60 °C heat index. Fixed by converting
mean RH to an actual vapour pressure at the mean temperature and re-expressing
it as saturation at the high (`heat.daytimeRh`). Same balcony now reads 49 °C —
still serious, and no longer crying wolf.

**The fertiliser calculator prescribed a salt dose.** Indian labels quote
"2–3 g/litre", a *concentration*, which says nothing about how much solution a
plant should get. Read naively across a proper 10.75 L soak of a 43 L bag, it
prescribes 32 g of 19:19:19 in one application — about six grams of nitrogen
into one container. Products are now dosed per **10 litres of substrate**; the
concentration falls out at a sane 0.8 g/L and is independent of bag size.

---

## 2. Directory structure

```
/
├── index.html                  app shell — no data, no logic, ~150 lines
├── manifest.webmanifest
├── sw.js                       versioned, three caching strategies
├── netlify.toml                CSP without 'unsafe-inline'
├── package.json                no dependencies; scripts only
│
├── data/                       the knowledge base — static, immutable JSON
│   ├── catalogue.json          225 entries, 129 KB
│   ├── orchard.json            8 trees + the potting-up plan
│   ├── zones.json  seeds.json  mushrooms.json  feed.json
│   ├── soil.json   climate.json  sources.json   care.json
│   └── prose.json              23 KB lifted verbatim from v9's markup
│
├── src/
│   ├── main.js                 bootstrap, view registry, routing, keyboard
│   ├── core/
│   │   ├── schema.js           v10 shape + forward-only migrations
│   │   ├── store.js            one state object, one way to change it
│   │   ├── persist.js          localStorage (ledger) + IndexedDB (photos)
│   │   ├── sync.js             Netlify Blobs, unchanged wire protocol
│   │   ├── data.js             JSON loader, indexes, merged catalogue view
│   │   ├── router.js           hash routes with deep links
│   │   ├── dom.js              esc/html/mount + delegated events
│   │   └── util.js             dates, numbers, text. No DOM.
│   ├── engine/                 the horticultural brain. Pure, testable.
│   │   ├── solar.js            declination, profile angle, overhang, chill hours
│   │   ├── heat.js             zone model, heat index, VPD, root-zone temp
│   │   ├── water.js            per-zone, per-season watering intervals
│   │   ├── orchard.js          bag ladder, root-prune, fruiting countdown
│   │   ├── germination.js      thermal time, hardening-off ladder
│   │   ├── feed.js             dosing, pH, coal-ash compensation
│   │   └── agenda.js           the Action Desk priority queue
│   ├── ui/
│   │   ├── theme-boot.js       blocking, pre-paint, ES5, no imports
│   │   ├── theme.js            2 skins × 3 mode settings
│   │   ├── palette.js          Ctrl+K, provider-based
│   │   ├── search.js           subsequence scoring tuned for plant names
│   │   ├── components.js       chips, facts, ladders, steppers, year strips
│   │   └── toast.js
│   ├── views/                  one module per screen, each exporting
│   │   └── …                   render(target) and wire()
│   └── styles/
│       ├── tokens.css          the four-mode token matrix
│       ├── base.css  layout.css  components.css  views.css
│       └── legacy-prose.css    maps v9's classes onto v10 tokens
│
├── tools/
│   ├── extract-data.mjs        one-shot lift of every literal out of v9
│   ├── bake.mjs                single-file build for file:// use
│   ├── check.mjs               526 assertions, static + coverage + behavioural
│   ├── smoke.mjs               drives the real app in a real browser
│   └── serve.mjs               zero-dependency dev server
│
├── legacy/index-v9.html        the original, preserved verbatim
└── netlify/functions/data.mjs  sync endpoint
```

### Why ES modules and no bundler

The site is static and Netlify serves it directly. Native modules keep v9's
best property — no build step, no `node_modules`, nothing to go stale — while
allowing real files. `tools/check.mjs` does the one job a bundler was providing:
verifying that every import resolves and every imported name is actually
exported.

**The cost, and how it is paid.** Browsers refuse to load ES modules over
`file://`, and `fetch()` for `data/*.json` is blocked there too. v9's
double-click-and-it-works property would have been lost. `npm run bake` restores
it: it inlines the stylesheets, bundles the module graph into one classic
script, and embeds the knowledge base as a JSON blob that `data.js` reads
instead of fetching. Output is a single 520 KB HTML file that opens from a USB
stick. `--with-state backup.json` also bakes in a data snapshot, which is what
v9's "bake into this file" button did.

### Data as JSON, not JavaScript

245 KB of horticultural knowledge moved from array literals into `data/*.json`.
It is fetched once, cached hard by the service worker, and never mutated. User
edits live in `state.over` and `state.custom` and are merged on top in
`data.catalogue()`, so you can always tell what the app claimed and what the
user changed it to.

Nothing was retyped. `tools/extract-data.mjs` lifts the literals out of the
preserved v9 file and replays v9's own derivation — including folding the 55
seed packets into the catalogue — so the 225 entries are provably the same 225.
It stays in the repo as the audit trail.

---

## 3. Theme system: two skins × light/dark

```
<html data-skin="jungle|precision"
      data-mode="light|dark"        ← resolved; what CSS matches on
      data-mode-pref="auto|light|dark"> ← what the user chose
```

The mode the user *chose* and the mode currently *rendered* are different
things. `auto` is a choice; `dark` is what auto resolved to at 8 pm. Both are
kept — a UI showing "Dark" selected when the user picked "Auto" is lying, and
the OS changes under you at sunset.

### Three tiers, strictly

1. **Primitive** — `--j-canopy-500`, `--p-slate-900`. Raw ramps. A component may
   **never** reference these. They exist only to be assigned to tier 2.
2. **Semantic** — `--bg`, `--ink`, `--accent`, `--danger`. Role names. The only
   tier component CSS may touch. Four blocks assign the identical set of names;
   add one to a block and you must add it to all four.
3. **Domain** — `--zone-a`…`--zone-e`, `--verdict-yes`, `--stress-0`…`4`,
   `--season-dry`. The horticultural vocabulary, also skin-adaptive. Markup says
   `data-zone="C"` and stops thinking about colour.

### A skin owns more than colour

This is what makes the two read as different instruments rather than one layout
in two palettes:

| Token | Jungle | Precision |
|---|---|---|
| `--f-display` | Bodoni Moda (editorial serif) | Archivo (grotesk, 700) |
| `--r` | 14 px | 4 px |
| `--sh-1` / `--sh-2` | soft organic shadows | `none` / a 1 px rule |
| `--density` | 1 | 0.84 — every spacing step tightens |
| `--page-wash` | two radial canopy-light washes | `none` |
| `--page-grid` | `none` | 32 px blueprint grid |
| `--step-0` | 15 px | 14 px |

### No flash on load

`src/ui/theme-boot.js` is a blocking classic script — deliberately not inline,
so the CSP stays at `script-src 'self'`. Twenty lines of ES5 that read the
stored preference, resolve `auto` against `prefers-color-scheme`, stamp both
attributes and paint the browser chrome, before first paint.

---

## 4. Data architecture

Schema v10 (`src/core/schema.js`), four rules:

1. **Nothing references a catalogue index.** Records store `key: "peperomia"`.
2. **Events are append-only.** Watering, potting-up, root-pruning and readings
   are logs, not fields.
3. **Every record carries its own id.** Arrays get reordered by sync; ids do not.
4. **Migrations are forward-only and idempotent**, and coerce hostile input
   rather than throwing — a migration that crashes locks the user out of their
   own ledger.

```js
{
  v: 10, savedAt, device,
  settings:    { skin, mode, startView, heatAlertC, remindRootPruneMo,
                 balconyGeometry: { projection, openingHeight, sillHeight } },
  specimens:   [{ sid, key, name, site, zone, water, watered, hist: [iso], … }],
  orchard:     { mango: { id, acquired, zone, stage, bagIdx,
                          bags: [{ size, litres, on }],
                          lastRootPrune, firstFruitOn,
                          events: [{ id, on, kind, text }], photos } },
  sowings:     [{ id, name, seedKey, sownOn, qtySown, medium, tray, zone,
                  counts: [{ on, up }], pottedOn, hardenFrom, hardenDays,
                  plantedOn, status }],
  readings:    [{ id, at, zone, tempC, rh, note, source }],
  experiments: [{ id, opened, title, hypothesis, zone, subjects, metric,
                  closed, verdict, notes }],
  runs, picks, qty, gear, over, custom, srcx, tasks, journal, log, profile,
  cloud, ckey
}
```

### Storage split

| Store | Holds | Why |
|---|---|---|
| `localStorage` (`almanac_v10`) | the ledger | small, synchronous, survives everything |
| IndexedDB (`balcony-ledger`) | photos | base64 images blow the ~5 MB quota after a dozen shots |

The IndexedDB name is unchanged from v9 — renaming it would orphan every photo
already stored. Images are downscaled to a 1200 px box at q0.82 **before**
storage, which turns a 4 MB camera JPEG into ~150 KB.

Writes are debounced 400 ms and flushed on `pagehide` and `visibilitychange`.
Quota failures surface as a toast rather than being swallowed — silently failing
to save is the worst thing a tracker can do.

### Sync conflict policy

Last-writer-wins on `savedAt`, per whole document. That is the honest choice for
one user with two devices; finer granularity needs per-field vector clocks, a
lot of machinery to resolve a conflict that in practice means "the phone and the
laptop were both open". Pushes are skipped when the payload is byte-identical to
the last one sent.

### The continuous-improvement loop

`readings` is not decoration. `heat.calibrate()` reads every afternoon reading
(12:00–17:00, the only ones that speak to a day high), compares it to the model,
and returns a per-zone bias. At eight readings the zone flips from **Modelled**
to **Measured** and every temperature, watering interval and heat alert for that
zone starts using the user's own data. Below eight the correction would be
noise, and a confident wrong number is worse than an honest estimate. The Zones
screen shows the progress bar toward that switch.

---

## 5. The engine

Pure functions, no DOM, therefore directly testable in Node. This is where the
app's actual value lives.

### `solar.js` — the fact the whole site rests on

At 20.95° N the June sun reaches **87.5°** at noon, within two and a half
degrees of vertical; in December it sits at **45.6°**. That is why a south-facing
overhang shades the balcony all summer and floods it in December, and therefore
why Zone C has an inverted calendar and gets the winter vegetable programme.

v9 asserted this in prose. v10 computes it: solar declination, equation of time,
and the **profile angle** — the sun's altitude projected into the plane
perpendicular to the wall:

```
tan(profile) = tan(altitude) / cos(azimuth − wallAzimuth)
drop         = projection × tan(profile)
```

With the default 0.6 m overhang the model gives 0 % of the glass sunlit at June
noon and 71 % at December noon. The user can measure their own geometry on the
Zones screen and the numbers become facts rather than defaults.

`projection` is measured **from the glass line**, not the wall behind it. On a
closed balcony the glazing sits at the outer edge and the slab above projects
only a little past it. Using the balcony's full depth is the easy mistake and it
makes the model claim December is shaded, which it plainly is not.

`chillHours()` integrates hours below 7.2 °C from the monthly means: **0** for
Talcher. Apple needs 800–1200. That is the number that rules out half the
tempting nursery stock, and it is now computed rather than asserted.

### `heat.js` — five micro-climates, and the root zone

Per-zone offsets from the station average, with Zone C seasonal because it
inverts. Then the two numbers that actually decide plant behaviour: **heat
index** (Rothfusz, flagged `beyondChart` past 54 °C where the published table
ends) and **vapour pressure deficit**.

The alert nobody else gives you is **root-zone temperature**. Feeder roots stop
at about 35 °C and die near 40 °C, while the leaves look untouched — so the
plant "suddenly" collapses a fortnight later. In Zone A in May:

| Setup | Root zone | Verdict |
|---|---|---|
| Black plastic pot, full sun | 54 °C | Lethal |
| Pale 400 GSM fabric bag | 47 °C | Root death starts here |
| Pale fabric + 50 % net + mulch | 44.5 °C | Root death starts here |

The difference between the first and last rows is a pale bag, a net and two
inches of mulch. It is worth more than any fertiliser on the market.

### `water.js` — and the bug that must stay fixed

Base interval → adjusted by season, zone, container material, bag size
(`(L/43)^0.25` — surface area scales as V^⅔ while volume scales as V) and
today's heat. And, critically: when the source is prose — "Rarely", "Change
water weekly" — **no schedule is produced**. `scheduled: false`, the rule is
returned verbatim, and the UI shows the rule instead of a fake countdown. There
is a test for it.

### `orchard.js` — a tree in a bag is a tree on a clock

Parses the shipped prose into dates: `"2–3 years"`, `"month 12–15, ~4 ft"`,
`"year 3 — final"`, `"at ~1.5 ft"`. Produces the bag ladder, the root-prune
schedule (which only applies once a tree is in its **final** bag — before that,
step-ups replace it) and the fruiting countdown, stated as a **window** because
"2–3 years" is not a date.

Root-prune intervals are set by container: fabric air-prunes and buys 30 months;
woven HDPE circles and girdles, so 24 is mandatory. Due dates falling outside
the Oct–Jan window are flagged — cutting roots in the dry gap is a different
mistake.

### `germination.js` — thermal time, not days

A chilli seed needs the same accumulated warmth whether it gets it in six days
at 30 °C or eighteen at 18 °C:

```
days to emergence ≈ TT_required / (meanSoilTemp − baseTemp)
```

Below base temperature there is **no estimate at all**, and the reason is
given: the January sowings that "never came up" did not fail, they were never
warm enough. Thirty crops carry base temperature, thermal requirement and their
reliable band, so lettuce gets flagged thermo-dormant above 28 °C and chilli
gets told it needs bottom heat.

The hardening-off ladder is written for a 45 °C site: exposure is added in the
**morning only**, never the afternoon. A tray raised in Zone D shade and moved
straight into Zone A sun scorches in about two hours, and the bleached patches
never recover.

### `feed.js` — the coal-ash problem

Talcher sits among opencast mines and thermal stations. Fly ash is alkaline
(pH 8–12) and washes into every open bag with each rain. Three consequences:

1. Substrate pH drifts **up** over a season. Modelled per zone — the terrace
   catches most, the closed balcony almost none, and mulch cuts it by two-thirds.
2. Above pH 7.5 iron, manganese and zinc go chemically unavailable. The plant is
   standing in them and starving.
3. Feeding harder makes it worse: more salt, same lock-out.

So the module gives both a slow fix (elemental sulphur, dosed per litre of
substrate per pH unit, 4–8 weeks because it is bacterial and cannot be rushed)
and a same-week fix (acidified irrigation). And the single most useful piece of
fertiliser advice for an alkaline site, which is almost never on the label:
**above pH 7 only Fe-EDDHA stays chelated.** Buying EDTA for an alkaline bag is
money poured on the floor.

### `agenda.js` — the Action Desk

One priority queue assembled from every other engine, because the user has one
morning, not eight screens. The rule for admission:

> A task appears only if it is actionable **today** and something bad happens if
> it is skipped.

Anything merely interesting belongs on its own screen. A daily list that cries
wolf gets ignored within a week, and then the one that mattered gets ignored
with it. Every task carries `why` — the consequence of skipping — because that
is what turns an instruction into knowledge.

Water and heat tasks are keyed per day (`id@2026-08-29`), so yesterday's tick
does not hide today's watering. Structural tasks — a pot-up that is genuinely
done — use a stable id and stay ticked.

---

## 6. Testing

`npm run check` — 526 assertions, no dependencies, ~1 second.

**Static half.** Every relative import in `src/` resolves, and every named
import corresponds to something that file actually exports. Every module listed
in the service worker precache exists, and every module on disk is listed —
because a PWA that installs a broken cache is worse than one that does not
install.

**Behavioural half.** The engines are pure, so the horticultural claims are
asserted directly: June noon sun within 2.5° of vertical; chill hours under 60;
the balcony genuinely inverts between June and December; black plastic crosses
50 °C; prose watering rules produce no schedule; `"year 3 — final"` parses to
1,096 days and a final flag; all eight trees produce a ladder ending in a final
bag; a mango potted two years ago raises a step-up alert; chilli germinates
faster warm and not at all below 12 °C; no shipped fertiliser at standard
strength exceeds "strong"; the Action Desk assembles in four different months;
and a v9 ledger migrates with its numeric species index resolved to the right
slug.

Browser-verified separately: all ten views render with no `undefined` and no
horizontal overflow at 1280 px and 390 px; the bottom tab bar replaces the rail
on a phone; Ctrl+K finds "Amrapali mango"; theme and data survive a reload; a
seeded `bl_v7` ledger migrates on first load; the baked single file runs from
`file://` with zero errors.

---

## 7. What is left

### First, a correction

The first published version of this document said the outstanding work was
"porting four reference screens". That understated the problem badly.

**25 of 46 extracted data blocks reached no screen at all**, including four of
the six blocks on the seeds screen — the audited cherry-tomato list (`CHERRY`,
18 rows), the tomato sowing schedule (`TOMSTEP`), the upgrade paths (`UPG`) and
the supplier ranking (`SRC2`). And **~23 KB of prose was never extracted**:
`tools/extract-data.mjs` lifted JavaScript literals, and most of the almanac's
actual teaching was written directly into v9's HTML.

Four blocks were also filed into the wrong bundle. `OYEAR` is the *orchard*
calendar; it went into `data/mushrooms.json` and `views/shrooms.js` rendered it
as "the oyster year" — and because its rows are arrays rather than objects, the
object-shaped code path fell through to `JSON.stringify` and printed raw JSON
onto the page. `OG` (the orchard's glyphs) and `ART`/`HABIT_LBL` (the
catalogue's habit drawings) were misplaced the same way.

The root cause was one thing: **extraction was tested, arrival was not.** 438
assertions passed while a quarter of the knowledge base was invisible.

All of it is restored, and §6 now describes the coverage tests that make the
failure impossible to repeat.

### Actually outstanding, ordered by value

1. **Photos in the UI.** `persist.js` has the full IndexedDB layer and the
   downscaler; `sync.js` has the push/pull endpoints. No view calls them yet.
   A dated photo strip on a tree card is the highest-value remaining feature —
   for a three-year sapota it is the only evidence anything is happening.
2. **Experiments screen.** The schema, factories and store actions exist
   (`state.experiments`); there is no view.
3. **Replace the vendored function bundle.** `netlify/functions/data.mjs` is a
   checked-in 32 KB esbuild output with `@netlify/blobs` inlined. Since
   `netlify.toml` sets `node_bundler = "esbuild"`, it should be ~80 lines of
   source with the dependency declared.
4. **Web Bluetooth / manual sensor import.** The calibration loop currently
   needs typed readings. A cheap BLE hygrometer per zone would close it.
5. **Notifications.** A 05:30 local notification with the day's list is the
   natural end point of the Action Desk.

### Known limits, stated plainly

- Every zone temperature is **modelled** until eight afternoon readings exist
  for that zone. The UI says which, everywhere.
- Zone offsets, container factors and ash-drift rates are calibrated estimates,
  not measurements. They are all in named tables at the top of their modules,
  precisely so they can be replaced.
- The heat index is unreliable above 54 °C; it is labelled rather than quoted.
- Fruiting countdowns are windows, not dates.
- Sync is last-writer-wins per document.

### Deliberately not carried over

Nine blocks are superseded rather than lost, and each carries a written reason
in `tools/check.mjs` (`SUPERSEDED` and `PROSE_SUPERSEDED`). Five are data
folded into a better model — `COMFORT`/`COMFORT_X` are already baked into every
catalogue row, `ROOM_BUMP` became `heat.ZONE_MODEL.indoor`, `PHBANDS` became
the richer `feed.PH_BANDS`, `WSEASON` became `water.SEASONS`. Four are v9 form
chrome that v10 rebuilds as real components.

One of those is a genuine disagreement worth recording: v9 fed at "about 3% of
bag volume" at label concentration. That under-delivers nitrogen while
concentrating salt in a small patch of root zone. `engine/feed.js` doses per
10 L of substrate and dissolves it in a full soak instead, which lands at
152 ppm N — squarely in the fertigation range — and makes the concentration
independent of bag size.

---

## 8. Running it

```
npm start          # http://localhost:5173  — needed; ES modules require http
npm run check      # 526 assertions
npm run bake       # dist/almanac.html, opens from file:// with no server
npm run smoke      # drives the real app in a browser (needs npx playwright)
npm run extract    # re-lift data from legacy/index-v9.html (one-shot, kept for audit)
```

Deploying: drag the folder onto `netlify.com/drop`, or connect the repository.
No build step. For sync, set `LEDGER_KEY` in the site's environment variables,
redeploy, then enter the same password on every device under **Settings**.

Bump `VERSION` in `sw.js` on every deploy — `activate()` clears every older
cache in one pass.
