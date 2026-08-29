#!/usr/bin/env node
/* ============================================================================
   serve.mjs — a zero-dependency static server for local development.

   ES modules and fetch() both require http, so `open index.html` will not work
   during development. This is the four-line answer, kept in the repo so the
   instruction is "npm start" rather than "install something first".
   ========================================================================== */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, normalize, join } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 5173;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8'
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith('/')) path += 'index.html';

    /* Contain everything under ROOT — no ../ escapes. */
    const file = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }

    let body;
    try {
      const info = await stat(file);
      if (info.isDirectory()) throw new Error('dir');
      body = await readFile(file);
    } catch {
      /* Hash routes only, so anything unknown falls back to the shell. */
      body = await readFile(join(ROOT, 'index.html'));
      res.writeHead(200, { 'content-type': TYPES['.html'] });
      res.end(body);
      return;
    }

    res.writeHead(200, {
      'content-type': TYPES[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-cache'
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500).end(String(err));
  }
}).listen(PORT, () => {
  console.log(`The Angul Almanac — http://localhost:${PORT}`);
});
