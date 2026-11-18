/*
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/* Runs in <head>, before the first paint. It is a file of its own because the Studio server's content security
   policy doesn't allow scripts written into the page. */

// Demo reset: open ...?reset to start over from a fresh install (clears AX Studio's saved state only).
// CUJ review links: ...?cuj=1 opens CUJ 1 (the installation experience) on its own, from a fresh install.
// ...?cuj=2 opens CUJ 2 (deploy your first agent) as a true first run: setup is done, nothing has run yet,
// no template is signed in, and the templates you didn't pick first are still downloading.
(function () {
  try {
    var cuj = (location.search.match(/[?&]cuj=(\d)\b/) || [])[1];
    if (/[?&]reset\b/.test(location.search) || cuj) {
      Object.keys(localStorage).forEach(function (k) { if (k.indexOf('ax.') === 0) localStorage.removeItem(k); });
      if (cuj === '2') { localStorage.setItem('ax.firstrun', '1'); localStorage.setItem('ax.setup', '1'); localStorage.setItem('ax.env', 'local'); }
      /* A review link can name the page to open, e.g. ...?cuj=2#/new opens New task in a first run. */
      var keep = cuj === '2' && /^#\/(new|settings|guardrails|places)\b/.test(location.hash) ? location.hash : '';
      location.replace(location.pathname + (keep || (cuj === '1' ? '#/cuj/1' : '#/welcome')));
    }
  } catch (e) {}
})();
// Resolve theme before first paint to avoid a flash.
(function () {
  try {
    var pref = localStorage.getItem('ax.theme') || 'system';
    var dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  } catch (e) {}
})();
