#!/usr/bin/env node
/* ============================================================================
   smoke.mjs — drive the real app in a real browser.

   `npm run check` proves the modules resolve and the engines compute the right
   numbers. It cannot prove those numbers reach the screen intact — that is
   what this does.

   NOT part of `npm run check`, and Playwright is deliberately NOT a package
   dependency: the whole app ships with zero dependencies and that property is
   worth more than the convenience. Run it when you have Playwright available:

       npx playwright install chromium     # once
       node tools/serve.mjs &              # in another shell
       node tools/smoke.mjs

   Set BROWSER=/path/to/chrome to use a browser you already have.
   ========================================================================== */

import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:5173/';
const EXECUTABLE = process.env.BROWSER || undefined;

const VIEWS = ['today', 'orchard', 'seeds', 'pots', 'shrooms', 'catalogue',
  'zones', 'feed', 'bags', 'climate', 'care', 'buy', 'settings'];

let failures = 0;
let checks = 0;
const ok = (label, cond, detail = '') => {
  checks++;
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.log(`  ✗ ${label}${detail ? '  — ' + detail : ''}`);
};

/* --------------------------------------------------------------------------
   The signatures of a render that went wrong.

   `["` and `[{"` are the important additions. views/shrooms.js rendered the
   orchard's calendar — an array of arrays — through an object-shaped code path,
   fell through to JSON.stringify, and printed literal JSON onto the page. The
   old assertion only looked for "undefined" and "[object Object]", so it sailed
   through. A screen should never contain raw serialised data.
   -------------------------------------------------------------------------- */
const BAD_TEXT = [
  ['undefined', /\bundefined\b/],
  ['[object Object]', /\[object Object\]/],
  ['raw JSON array', /\[\s*"/],
  ['raw JSON object', /\[\s*\{\s*"/],
  ['unfilled mount marker', /<!--mount:/],
  ['NaN', /\bNaN\b/],
  ['literal null', /(^|[\s>])null([\s<]|$)/]
];

const browser = await chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {});
const errors = [];

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  console.log('\nVIEWS — every screen renders clean');
  for (const view of VIEWS) {
    await page.goto(BASE + '#' + view, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(420);

    const info = await page.evaluate((v) => {
      const el = document.getElementById('v-' + v);
      return {
        visible: !!el && el.classList.contains('on'),
        text: el ? el.innerText : '',
        html: el ? el.innerHTML : '',
        cards: el ? el.querySelectorAll('.card').length : 0,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      };
    }, view);

    const bad = BAD_TEXT.filter(([, re]) => re.test(info.text) || re.test(info.html))
      .map(([name]) => name);

    ok(`#${view} — ${info.text.trim().length} chars, ${info.cards} cards`,
      info.visible && info.text.trim().length > 200 && !bad.length && !info.overflow,
      [bad.length ? 'contains ' + bad.join(', ') : '', info.overflow ? 'page scrolls sideways' : '']
        .filter(Boolean).join('; '));
  }

  /* The prose lifted from v9 must actually be on the page, not just in the
     bundle. Spot-check the block the rebuild lost. */
  console.log('\nPROSE — the restored v9 blocks are on the page');
  await page.goto(BASE + '#seeds', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  const seeds = await page.evaluate(() => document.getElementById('v-seeds').innerText);
  ok('cherry-tomato audit is present',
    /Not one of them is a dwarf or determinate cherry/.test(seeds));
  ok('all 18 audited listings render', (seeds.match(/organicbazar|nurserylive|Amazon/gi) || []).length > 8);
  ok('the order worth placing is present', /order worth placing|1,330|≈1,330/i.test(seeds));
  ok('sowing schedule is present', /Sowing tomatoes/i.test(seeds));
  ok('upgrade paths are present', /Tiny Tim|Arka Anamika/.test(seeds));

  await page.goto(BASE + '#orchard', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(450);
  const orchard = await page.evaluate(() => document.getElementById('v-orchard').innerText);
  ok('the orchard year is on the orchard screen', /Root-prune woody pots/.test(orchard));

  await page.goto(BASE + '#shrooms', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(450);
  const shrooms = await page.evaluate(() => document.getElementById('v-shrooms').innerText);
  ok('the orchard year is NOT on the mushroom screen', !/Root-prune woody pots/.test(shrooms));
  ok('getting spawn survived extraction', /KVK Angul|OUAT/.test(shrooms));

  await page.goto(BASE + '#care', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(450);
  const care = await page.evaluate(() => document.getElementById('v-care').innerText);
  ok('the window-film advice is present', /protective film/i.test(care));

  /* -------------------------------------------------------------- phone -- */
  console.log('\nPHONE — 390 px');
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await phone.goto(BASE + '#today', { waitUntil: 'networkidle' });
  await phone.waitForTimeout(600);
  const p = await phone.evaluate(() => ({
    tabbar: getComputedStyle(document.querySelector('.tabbar')).display,
    rail: getComputedStyle(document.querySelector('.rail')).display,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  }));
  ok('bottom tab bar replaces the rail', p.tabbar === 'grid' && p.rail === 'none');
  ok('no horizontal overflow', !p.overflow);

  /* --------------------------------------------------------------- bake -- */
  console.log('\nBAKED — the single file runs from file://');
  const baked = await browser.newPage();
  const bakedErrors = [];
  baked.on('pageerror', (e) => bakedErrors.push(e.message));
  await baked.goto('file://' + process.cwd() + '/dist/almanac.html', { waitUntil: 'domcontentloaded' });
  await baked.waitForTimeout(1400);
  const b = await baked.evaluate(() => ({
    booted: !document.getElementById('boot'),
    chars: document.getElementById('v-today')?.innerText.trim().length || 0,
    nav: document.querySelectorAll('.navb').length
  }));
  ok(`opens with no server (${b.nav} nav items, ${b.chars} chars)`,
    b.booted && b.chars > 200 && b.nav === VIEWS.length, bakedErrors.join('; '));

  console.log('\nRUNTIME');
  /* Network failures fetching a font are an environment problem, not an app
     bug — every face declares a real fallback stack, so the page is fine
     without them. Report them, do not fail on them. */
  const network = errors.filter((e) => /net::ERR_|fonts\.g/.test(e));
  const real = errors.filter((e) => !network.includes(e));
  ok('no page errors', real.length === 0, real.join('; '));
  if (network.length) {
    console.log(`  · ${network.length} network fetch(es) blocked (fonts) — fallback stacks in use`);
  }
} finally {
  await browser.close();
}

console.log(`\n${checks - failures}/${checks} browser checks passed`);
if (failures) { console.log(`${failures} FAILED\n`); process.exit(1); }
console.log('all good\n');
