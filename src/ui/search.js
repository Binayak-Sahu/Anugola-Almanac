/* ============================================================================
   search.js — subsequence scoring, tuned for plant names.

   Not a generic fuzzy matcher. Two behaviours matter here:

     · "red dia" must find "Red Diamond guava" — word-prefix runs score high.
     · "amrapali" must find the mango even though the catalogue calls it
       "Amrapali mango" and the orchard calls it "Amrapali mango (Mangifera
       indica)". Substring hits outrank scattered-letter hits, always.

   Botanical names are searched too, because half the reason to own a rare
   plant is knowing what it is called.
   ========================================================================== */

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Score `text` against `query`. Returns 0 for no match, higher is better.
 * Also returns the matched index ranges, for highlighting.
 */
export function score(text, query) {
  const t = norm(text);
  const q = norm(query).trim();
  if (!q) return { score: 1, ranges: [] };
  if (!t) return { score: 0, ranges: [] };

  /* 1. Exact and prefix hits dominate everything else. */
  if (t === q) return { score: 1000, ranges: [[0, q.length]] };
  if (t.startsWith(q)) return { score: 900 - t.length * 0.1, ranges: [[0, q.length]] };

  /* 2. Word-boundary prefix: "red dia" in "Red Diamond guava". */
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    const all = words.every((w) => new RegExp(`\\b${escapeRe(w)}`).test(t));
    if (all) {
      const ranges = words.map((w) => {
        const i = t.search(new RegExp(`\\b${escapeRe(w)}`));
        return [i, i + w.length];
      }).sort((a, b) => a[0] - b[0]);
      return { score: 780 - t.length * 0.1, ranges };
    }
  }

  /* 3. Plain substring. */
  const at = t.indexOf(q);
  if (at >= 0) {
    const boundary = at === 0 || /[\s\-'(]/.test(t[at - 1]);
    return { score: (boundary ? 700 : 560) - at * 0.5 - t.length * 0.1, ranges: [[at, at + q.length]] };
  }

  /* 4. Subsequence, last resort. Penalised hard so it never outranks a real
        substring hit on another field. */
  let ti = 0, hits = 0, gaps = 0;
  const ranges = [];
  for (const ch of q) {
    if (ch === ' ') continue;
    const found = t.indexOf(ch, ti);
    if (found < 0) return { score: 0, ranges: [] };
    if (found > ti) gaps += found - ti;
    ranges.push([found, found + 1]);
    ti = found + 1;
    hits++;
  }
  return { score: Math.max(1, 240 - gaps * 3 - t.length * 0.2), ranges: merge(ranges) };
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function merge(ranges) {
  const out = [];
  for (const r of ranges) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([...r]);
  }
  return out;
}

/**
 * Rank a list of records against a query.
 * @param {object[]} items
 * @param {string} query
 * @param {object} opts { fields: [{ key, weight }], limit }
 */
export function rank(items, query, { fields = [{ key: 'name', weight: 1 }], limit = 50 } = {}) {
  if (!query || !query.trim()) return items.slice(0, limit).map((item) => ({ item, score: 1, ranges: [], field: null }));

  const scored = [];
  for (const item of items) {
    let best = { score: 0, ranges: [], field: null };
    for (const f of fields) {
      const value = typeof f.key === 'function' ? f.key(item) : item[f.key];
      if (!value) continue;
      const r = score(value, query);
      const weighted = r.score * (f.weight ?? 1);
      if (weighted > best.score) best = { score: weighted, ranges: r.ranges, field: f.key };
    }
    if (best.score > 0) scored.push({ item, ...best });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/** Wrap matched ranges in <mark>. Escapes as it goes. */
export function highlight(text, ranges) {
  const s = String(text ?? '');
  if (!ranges?.length) return escapeHtml(s);
  let out = '';
  let cursor = 0;
  for (const [a, b] of ranges) {
    if (a > cursor) out += escapeHtml(s.slice(cursor, a));
    out += '<mark>' + escapeHtml(s.slice(a, b)) + '</mark>';
    cursor = b;
  }
  return out + escapeHtml(s.slice(cursor));
}

const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ENT[c]);
