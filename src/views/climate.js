/* ============================================================================
   views/climate.js — the year, as the site actually feels it.

   Angul station data is four numbers a month: mean high, mean low, mean
   relative humidity, and rainfall. Everything else on this screen is derived
   from them, and every derived number says so.

   The point of the screen is that the hard part of the year here is
   March to June, not winter. Most gardening advice — almost all of it written
   for temperate climates — assumes the opposite, and following it is how
   people lose plants in May while planning for a frost that never comes.
   ========================================================================== */

import { esc, mount, on } from '../core/dom.js';
import { MON, MONFULL, round } from '../core/util.js';
import * as store from '../core/store.js';
import { DB, proseHtml, prose } from '../core/data.js';
import { zoneMonth, heatIndexC, heatBand, vpd } from '../engine/heat.js';
import { solarYear, dayLength, noonAltitude, chillHours } from '../engine/solar.js';
import { section, chip, yearStrip, stressColors, facts, empty } from '../ui/components.js';

const VIEW = 'climate';

export function renderClimate() {
  const angul = DB.climate.ANGUL;
  const record = DB.climate.RECORD;

  mount('v-climate', `
    <div class="sec">
      <div class="eyebrow">Angul station · 20.95° N, 85.22° E · inland, not coastal</div>
      <h1 style="margin:4px 0 6px">Climate</h1>
      <p class="lede">
        May averages ${angul[4][0]} °C and has reached ${record.hi} °C. January nights average
        ${angul[0][1]} °C. The hard part of the year is March to June, not winter — which is the
        opposite of what almost every gardening book assumes, and the single most expensive
        assumption to import.
      </p>
    </div>

    ${proseSection('the-year-as-this-room-feels-it')}
    ${section('The extremes', extremes(angul, record), { eyebrow: 'What the station has recorded' })}
    ${proseSection('temperature', { tempchart: temperatureChart(angul) })}
    ${proseSection('rain-and-humidity', { rainchart: rainChart(angul) })}
    ${proseSection('sun-on-your-glass', { sunchart: sunChart() })}
    ${proseSection('what-is-at-risk-month-by-month', { riskbox: riskTable(angul) })}
    ${proseSection('the-twelve-months', { cal: monthCards() })}
  `);
}

/* ------------------------------------------------------------------------- */

function extremes(angul, record) {
  const hottest = angul.reduce((a, m, i) => (m[0] > angul[a][0] ? i : a), 0);
  const coldest = angul.reduce((a, m, i) => (m[1] < angul[a][1] ? i : a), 0);
  const wettest = angul.reduce((a, m, i) => ((m[3] ?? 0) > (angul[a][3] ?? 0) ? i : a), 0);

  return `<div class="grid g4">
    <div class="card"><div class="eyebrow">Hottest month</div>
      <div class="num" style="font-size:24px">${angul[hottest][0]} °C</div>
      <div class="subtle">${MONFULL[hottest]} average high</div></div>
    <div class="card"><div class="eyebrow">Record high</div>
      <div class="num" style="font-size:24px;color:var(--stress-4)">${record.hi} °C</div>
      <div class="subtle">${MONFULL[record.hiM]}</div></div>
    <div class="card"><div class="eyebrow">Coldest night</div>
      <div class="num" style="font-size:24px">${angul[coldest][1]} °C</div>
      <div class="subtle">${MONFULL[coldest]} average low · record ${record.lo} °C</div></div>
    <div class="card"><div class="eyebrow">Chill hours</div>
      <div class="num" style="font-size:24px">${chillHours(angul)}</div>
      <div class="subtle">below 7.2 °C per year</div></div>
  </div>
  <p class="subtle" style="margin-top:10px">
    Wettest month is ${MONFULL[wettest]} at about ${angul[wettest][3] ?? '—'} mm. Nothing here needs
    protecting from frost; everything here needs protecting from May.
  </p>`;
}

/* Two overlaid bars per month: the high above, the low below. Pure SVG, so it
   themes with the rest and needs no charting library. */
function temperatureChart(angul) {
  const highs = angul.map((m) => m[0]);
  const lows = angul.map((m) => m[1]);
  const max = Math.max(...highs);
  const min = Math.min(...lows);
  const span = max - min;

  const bars = angul.map(([high, low], i) => {
    const x = (i / 12) * 100;
    const w = (1 / 12) * 100;
    const top = ((max - high) / span) * 70 + 6;
    const bottom = ((max - low) / span) * 70 + 6;
    const band = heatBand(heatIndexC(high, 55));
    return `<rect x="${(x + w * 0.28).toFixed(2)}%" y="${top.toFixed(1)}"
              width="${(w * 0.44).toFixed(2)}%" height="${(bottom - top).toFixed(1)}"
              rx="2" fill="var(--stress-${band.level})">
              <title>${MONFULL[i]}: ${low}–${high} °C</title></rect>`;
  }).join('');

  const labels = MON.map((m, i) =>
    `<text x="${((i + 0.5) / 12) * 100}%" y="94" font-size="5.5" text-anchor="middle"
       fill="currentColor" opacity=".6">${m[0]}</text>`).join('');

  const rows = angul.map(([high, low, rh], i) => {
    const hi = heatIndexC(high, rh);
    return `<tr>
      <td data-l="Month"><b>${MON[i]}</b></td>
      <td data-l="High" class="num">${high} °C</td>
      <td data-l="Low" class="num">${low} °C</td>
      <td data-l="Humidity" class="num">${rh}%</td>
      <td data-l="Feels like" class="num">${hi} °C</td>
    </tr>`;
  }).join('');

  return `<div class="card">
    <svg viewBox="0 0 100 100" preserveAspectRatio="none"
         style="width:100%;height:190px;color:var(--muted)" role="img"
         aria-label="Monthly mean high and low temperature">${bars}${labels}</svg>
    <p class="subtle" style="margin-top:8px">
      Each bar runs from the month's mean low to its mean high, coloured by heat-index band.
      Nothing in this range is cold enough to matter; the top of the bar is the whole story.
    </p>
    <div class="scrollx" style="margin-top:14px"><table class="data stack">
      <thead><tr><th>Month</th><th>High</th><th>Low</th><th>Humidity</th><th>Feels like</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </div>`;
}

function rainChart(angul) {
  const rain = angul.map((m) => m[3] ?? 0);
  const max = Math.max(...rain, 1);
  const rh = angul.map((m) => m[2] / 100);

  return `<div class="card">
    <div class="eyebrow">Rainfall, mm</div>
    <div style="margin-top:6px;color:var(--season-monsoon)">
      ${yearStrip(rain.map((r) => r / max))}
    </div>
    <div class="eyebrow" style="margin-top:18px">Mean relative humidity</div>
    <div style="margin-top:6px;color:var(--info)">${yearStrip(rh)}</div>
    <p class="subtle" style="margin-top:12px">
      March bottoms out near ${Math.min(...angul.map((m) => m[2]))}% humidity — that, not the
      temperature alone, is what makes the dry gap punishing. Note that this is the monthly
      MEAN; the afternoon figure is lower still, which is why the Today screen quotes the
      afternoon number instead.
    </p>
  </div>`;
}

function sunChart() {
  const year = solarYear();
  const alt = year.map((y) => y.noonAltitude / 90);

  return `<div class="card">
    <div class="eyebrow">Noon sun altitude</div>
    <div style="margin-top:6px;color:var(--zone-a)">${yearStrip(alt)}</div>
    <div class="scrollx" style="margin-top:14px"><table class="data stack">
      <thead><tr><th>Month</th><th>Noon altitude</th><th>Day length</th><th>Declination</th></tr></thead>
      <tbody>${year.map((y) => `<tr>
        <td data-l="Month"><b>${MON[y.month]}</b></td>
        <td data-l="Noon altitude" class="num">${Math.round(y.noonAltitude)}°</td>
        <td data-l="Day length" class="num">${round(y.dayLength, 1)} h</td>
        <td data-l="Declination" class="num">${round(y.declination, 1)}°</td>
      </tr>`).join('')}</tbody>
    </table></div>
    <p class="subtle" style="margin-top:10px">
      Day length varies by barely two hours across the whole year — this is the tropics, and
      almost nothing here responds to photoperiod the way a temperate plant does. What changes
      is the ANGLE, and that is what the Zone C overhang exploits.
    </p>
  </div>`;
}

function riskTable(angul) {
  const rows = angul.map((m, i) => {
    const z = zoneMonth('A', i, angul);
    const hi = heatIndexC(z.high, z.rh);
    const band = heatBand(hi);
    return { i, z, hi, band, vpd: vpd(z.high, z.rh) };
  });
  const levels = rows.map((r) => r.band.level);

  return `<div class="card">
    <div style="margin-bottom:14px">${yearStrip(levels.map((l) => (l + 1) / 5), { colors: stressColors(levels) })}</div>
    <div class="scrollx"><table class="data stack">
      <thead><tr><th>Month</th><th>Zone A high</th><th>Feels like</th><th>VPD</th><th>What is at risk</th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td data-l="Month"><b>${MON[r.i]}</b></td>
        <td data-l="Zone A high" class="num">${r.z.high} °C</td>
        <td data-l="Feels like" class="num" style="color:var(--stress-${r.band.level})">
          ${r.band.beyondChart ? 'over 54' : r.hi} °C</td>
        <td data-l="VPD" class="num">${r.vpd}</td>
        <td data-l="What is at risk">${esc(r.band.advice)}</td>
      </tr>`).join('')}</tbody>
    </table></div>
  </div>`;
}

/* CAL rows: [month, headline, tone, light, plants, mushrooms, caution] */
function monthCards() {
  const cal = DB.sources.CAL;
  if (!cal?.length) return empty('No monthly calendar in the data bundle.');
  const now = new Date().getMonth();

  return `<div class="grid g2">${cal.map((row, i) => {
    const [month, headline, tone, light, plants, shrooms, caution] = row;
    return `<article class="card ${i === now ? '' : 'flat'}">
      <div class="spread">
        <span class="eyebrow">${esc(month)}${i === now ? ' · now' : ''}</span>
        ${tone ? chip(String(tone), { mono: true }) : ''}
      </div>
      <h3 style="margin-top:6px">${esc(headline)}</h3>
      ${facts([
        ['Light', light],
        ['Plants', plants],
        ['Mushrooms', shrooms]
      ])}
      ${caution ? `<p class="subtle" style="margin-top:10px"><b>Watch:</b> ${esc(caution)}</p>` : ''}
    </article>`;
  }).join('')}</div>`;
}

/** Wrap a lifted v9 block in v10's own section furniture. */
function proseSection(slug, mounts = {}, view = VIEW) {
  const block = prose(view, slug);
  if (!block) return '';
  return section(block.heading, proseHtml(view, slug, mounts), {
    eyebrow: block.sub || block.eyebrow || ''
  });
}

export function wireClimate() { /* no interactive state on this screen */ }
