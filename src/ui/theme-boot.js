/* ============================================================================
   theme-boot.js — runs BEFORE first paint, as a blocking classic script.

   Why it is a separate file rather than an inline <script>: an inline script
   would force `script-src 'unsafe-inline'` in the Content-Security-Policy for
   the whole app. One 20-line file keeps the policy at 'self'.

   Why it must be blocking: reading the theme after the module graph loads
   means the user watches a white page repaint to dark. On a phone in a garden
   that is the difference between "an app" and "a website".

   Deliberately ES5 and dependency-free — it runs before anything else exists.
   ========================================================================== */
(function () {
  var KEY = 'almanac_v10';
  var skin = 'jungle';
  var mode = 'auto';

  try {
    var raw = localStorage.getItem(KEY) || localStorage.getItem('bl_v7');
    if (raw) {
      var parsed = JSON.parse(raw);
      var s = (parsed && parsed.settings) || null;
      if (s) {
        if (s.skin) skin = s.skin;
        if (s.mode) mode = s.mode;
      } else if (parsed) {
        /* v9 stored a single day/night flag, possibly inside a wrapper. */
        var legacy = (parsed.state && parsed.state.theme) || parsed.theme;
        if (legacy === 'night') mode = 'dark';
        else if (legacy === 'day') mode = 'light';
      }
    }
  } catch (e) { /* private browsing: fall through to defaults */ }

  var resolved = mode;
  if (mode === 'auto') {
    resolved = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
      ? 'dark' : 'light';
  }

  var root = document.documentElement;
  root.setAttribute('data-skin', skin);
  root.setAttribute('data-mode', resolved);
  root.setAttribute('data-mode-pref', mode);

  /* Paint the browser chrome to match, so the status bar does not flash. */
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    var COLORS = {
      'jungle:light': '#E7EBE4', 'jungle:dark': '#0E1411',
      'precision:light': '#F6F7F8', 'precision:dark': '#0A0B0C'
    };
    meta.setAttribute('content', COLORS[skin + ':' + resolved] || '#E7EBE4');
  }
})();
