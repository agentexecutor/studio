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

/* AX Studio prototype — core: helpers, icons, vocabulary, storyline, seed data. */
'use strict';

/* ---------- Helpers ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MIN = 60 * 1000;
const now = () => Date.now();
const reducedMotion = () => (typeof state !== 'undefined' && state.reduceMotion) || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fmtAgo(ts) {
  const s = Math.round((now() - ts) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return m + ' min ago';
  const h = Math.round(m / 60);
  if (h < 24) return h + ' hr ago';
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : d + ' days ago';
}
function fmtElapsed(ts) {
  const s = Math.max(0, Math.floor((now() - ts) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h) return h + 'h ' + m + 'm';
  if (m) return m + 'm ' + String(sec).padStart(2, '0') + 's';
  return sec + 's';
}
function fmtClock(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
function since(ts, fmt) {
  return `<span data-since="${ts}" data-fmt="${fmt}">${fmt === 'elapsed' ? fmtElapsed(ts) : fmtAgo(ts)}</span>`;
}
function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 28) || 'task';
}
/** A task's branch name from its title, cut at a word boundary: "ax/clean-up-the-old", not "ax/clean-up-the-old-bui". */
function branchFor(title, max = 20) {
  let out = '';
  for (const w of String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').split('-')) {
    const next = out ? out + '-' + w : w;
    if (next.length > max) break;
    out = next;
  }
  /* Don't end on a joining word: "ax/add-rate-limiting", not "ax/add-rate-limiting-to". */
  out = out.replace(/(-(to|the|a|an|of|for|and|in|on|with|from|by))+$/, '');
  return 'ax/' + (out || slug(title).slice(0, max));
}
function copyText(text, msg) {
  try { navigator.clipboard && navigator.clipboard.writeText(text).catch(() => {}); } catch (e) { /* ignore */ }
  toast(msg || 'Copied to clipboard', { icon: 'copy' });
}
function downloadText(filename, text, msg) {
  try {
    const blob = new Blob([text], { type: 'text/yaml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) { /* ignore in stubbed DOM */ }
  toast(msg || `Saved <span class="mono">${esc(filename)}</span>`, { icon: 'download' });
}

/* ---------- Icons (Lucide-style, 24px grid) ---------- */
const ICONS = {
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  play: '<polygon points="7 4 19 12 7 20 7 4"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  checkCircle: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  xCircle: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  shieldCheck: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
  branch: '<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  pr: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" x2="6" y1="9" y2="21"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  laptop: '<path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  cloudUp: '<path d="M12 13v8"/><path d="M4 14.9A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.24"/><path d="m8 17 4-4 4 4"/>',
  server: '<rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  chevRight: '<path d="m9 18 6-6-6-6"/>',
  chevDown: '<path d="m6 9 6 6 6-6"/>',
  chevLeft: '<path d="m15 18-6-6 6-6"/>',
  sliders: '<line x1="4" x2="4" y1="21" y2="14"/><line x1="4" x2="4" y1="10" y2="3"/><line x1="12" x2="12" y1="21" y2="12"/><line x1="12" x2="12" y1="8" y2="3"/><line x1="20" x2="20" y1="21" y2="16"/><line x1="20" x2="20" y1="12" y2="3"/><line x1="2" x2="6" y1="14" y2="14"/><line x1="10" x2="14" y1="8" y2="8"/><line x1="18" x2="22" y1="16" y2="16"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  arrowUpRight: '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  loader: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  message: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  hand: '<path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  keyboard: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  brain: '<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M12 5v13"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  pencil: '<path d="M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"/>',
  handoff: '<path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/>',
  send: '<path d="M14.54 21.69a.5.5 0 0 0 .94-.03l6.5-19a.5.5 0 0 0-.64-.64l-19 6.5a.5.5 0 0 0-.03.94l7.93 3.18a2 2 0 0 1 1.11 1.11z"/><path d="m21.85 2.15-10.94 10.94"/>',
  box: '<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M12 22V12"/><path d="m3.3 7 8.7 5 8.7-5"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>',
  command: '<path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/>',
  cpu: '<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2"/>',
  power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>',
  sparkle: '<path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z"/>',
  droplet: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
  waves: '<path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>',
  compare: '<circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9"/><path d="M12 12v3"/>',
  code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  doctor: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/><path d="M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27"/>',
  award: '<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/>',
  pin: '<line x1="12" x2="12" y1="17" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/>',
};
function icon(name, cls) {
  return `<svg class="svg ${cls || ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`;
}

/* The AX Studio logo, the Clear Spring AX ligature: one cerulean-to-teal ribbon runs from the A into the X, woven with an
   ice stroke, a gill-rose wing and a keystone, on a deep cenote glass tile in both themes. Same drawing as assets/logo.svg
   (the favicon). It never reuses the mascot art, so Axel stays the one mascot on screen. */
const BRAND_MARK = `<svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="axm-bg" x1="2" y1="2" x2="30" y2="30" gradientUnits="userSpaceOnUse">
      <stop offset="0%" style="stop-color:var(--mark-bg,#0E1A28)"/>
      <stop offset="100%" style="stop-color:var(--mark-bg-deep,#070D14)"/>
    </linearGradient>
    <linearGradient id="axm-water" x1="16" y1="16" x2="16" y2="31" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#38BDF8" stop-opacity=".22"/>
      <stop offset="100%" stop-color="#14B8A6" stop-opacity=".05"/>
    </linearGradient>
    <linearGradient id="axm-wave" x1="4" y1="24" x2="26" y2="6" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#38BDF8"/>
      <stop offset="56%" stop-color="#2DD4BF"/>
      <stop offset="100%" stop-color="#7DD3FC"/>
    </linearGradient>
    <linearGradient id="axm-rose" x1="11" y1="7" x2="27" y2="23" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#FBCFE8"/>
      <stop offset="100%" stop-color="#E4769D"/>
    </linearGradient>
  </defs>
  <rect class="bm-tile" x="0.75" y="0.75" width="30.5" height="30.5" rx="9" fill="url(#axm-bg)"/>
  <path class="bm-water" d="M0.75 18.8 Q8.5 16.5 16 18.8 T31.25 18.8 V22.25 A9 9 0 0 1 22.25 31.25 H9.75 A9 9 0 0 1 0.75 22.25 Z" fill="url(#axm-water)"/>
  <path class="bm-cross" d="M15.82 18.38 Q16.07 18.0 16.37 18.34 L18.04 20.24 Q18.34 20.58 18.09 20.96 L16.15 23.86 Q15.79 24.4 15.14 24.4 L12.44 24.4 Q11.79 24.4 12.15 23.86 Z" fill="#EEF4F9"/>
  <path class="bm-rose" d="M22.93 7.74 Q23.29 7.2 23.94 7.2 L26.64 7.2 Q27.29 7.2 26.93 7.74 L21.97 15.14 Q21.72 15.52 21.42 15.18 L19.76 13.28 Q19.46 12.94 19.71 12.56 Z" fill="url(#axm-rose)"/>
  <path class="bm-main" d="M4.85 24.4 Q4.2 24.4 4.44 23.8 L10.78 8.16 Q11.66 5.98 13.21 7.75 L27.37 23.91 Q27.8 24.4 27.15 24.4 L24.03 24.4 Q23.38 24.4 22.95 23.91 L13.11 12.66 Q12.72 12.22 12.5 12.76 L8.02 23.8 Q7.78 24.4 7.13 24.4 Z" fill="url(#axm-wave)"/>
  <path class="bm-rose" d="M11.15 19.41 Q11.36 18.9 11.91 18.9 L13.42 18.9 Q13.97 18.9 13.66 19.36 L12.27 21.44 Q11.96 21.9 11.41 21.9 L10.69 21.9 Q10.14 21.9 10.35 21.39 Z" fill="url(#axm-rose)"/>
  <rect class="bm-rim" x="0.75" y="0.75" width="30.5" height="30.5" rx="9" fill="none" stroke="var(--mark-rim,rgba(255,255,255,.10))" stroke-width="1.2"/>
</svg>`;

/* ---------- Axel's Sanctuary Storyline ("Why an axolotl?") ---------- */
const AXEL_STORY = {
  lead: 'Wild axolotls live in just one place: the spring-fed waters of Xochimilco. AX gives your agents a home like that: clear, contained and safe.',
  chapters: [
    { icon: 'droplet', trait: 'Clear water, stone banks', product: 'A sandbox you can see into' },
    { icon: 'shieldCheck', trait: 'Gills that filter', product: 'Guardrails check what goes out' },
    { icon: 'compare', trait: 'Regrows without a scar', product: 'Discard, retry or compare freely' },
    { icon: 'waves', trait: 'Keeps its form for life', product: 'The same task, laptop to cluster' },
  ],
};

/* ---------- Guardrail Presets (zero allowlist fatigue, safe by default) ---------- */
/* Two starting points. Sites you allow go on top of either one, so there's no separate "Custom" preset. */
const GUARDRAIL_PRESETS = {
  balanced: {
    id: 'balanced',
    cli: 'balanced',
    name: 'Balanced',
    badge: 'Default',
    desc: 'GitHub, npm, PyPI and your model APIs work out of the box. Other sites ask you first.',
  },
  strict: {
    id: 'strict',
    cli: 'locked-down',
    name: 'Locked down',
    badge: '',
    desc: 'Only your model APIs. Every other site asks you first, including package installs.',
  },
};

/* ---------- Vocabulary ----------
   Status families (V2): amber = needs a decision (Waiting, Blocked), red = broken (Failed) only,
   neutral = transitional (Starting, Stopping, Paused). Every status pairs an icon with a word. */
const STATUS = {
  running: { label: 'Running', icon: 'loader', color: 'var(--run)' },
  starting: { label: 'Starting', icon: 'loader', color: 'var(--faint)' },
  stopping: { label: 'Stopping', icon: 'loader', color: 'var(--faint)' },
  waiting: { label: 'Waiting for you', icon: 'hand', color: 'var(--wait)' },
  blocked: { label: 'Blocked', icon: 'shield', color: 'var(--wait)' },
  done: { label: 'Done', icon: 'checkCircle', color: 'var(--done)' },
  failed: { label: 'Failed', icon: 'xCircle', color: 'var(--fail)' },
};
const NEEDS_YOU = ['blocked', 'waiting', 'failed'];
const ACTIVE = ['running', 'starting', 'stopping'];
function isPaused(t) { return !!(t && t.status === 'waiting' && t.needs && t.needs.type === 'paused'); }
/** Paused on purpose (not a failed handoff, which does need you). A task you paused isn't waiting on you. */
function pausedByYou(t) { return isPaused(t) && !t.handoffFailed; }
/** One rule for "needs you", used by Home, the sidebar, the bell, the tab title and All tasks. */
function needsYou(t) { return NEEDS_YOU.includes(t.status) && !pausedByYou(t) && !(typeof isFolded === 'function' && isFolded(t)); }
/** A rate limit is a wait, not a failure: AX retries on its own when the provider's limit resets (retry-after). */
const QUOTA_WAIT_MS = 120000;
function quotaRetryAt(t) {
  if (!t || t.status !== 'failed') return 0;
  const f = typeof lastFail === 'function' && lastFail(t);
  if (!f || f.e.code !== 'quota') return 0;
  if (!t.retryAt) t.retryAt = (f.e.at || Date.now()) + QUOTA_WAIT_MS;
  return t.retryAt;
}
function quotaWaiting(t) { const at = quotaRetryAt(t); return !!at && at > Date.now(); }
function fmtCountdown(ms) { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
/** A local task held while this computer sleeps (CUJ 3: "Paused while your computer slept"; it resumes on wake). */
function asleepHeld(t) { return !!(t && t._held && t.env === 'local' && t.status === 'running' && state.env && state.env.health === 'asleep'); }

/* Pre-built templates (CUJ 2: "Pick a pre-built template"). Antigravity, Google's agent, comes first and is the one
   Studio picks for you (DEFAULT_AGENT). Each one is a harness with sensible defaults, the models
   it can use (the first is the default; `fast` marks the lighter one offered when you hit a rate limit), and its latest
   release (new releases reach templates fast, and each task can stay pinned). */
const AGENTS = {
  antigravity: {
    id: 'antigravity', name: 'Antigravity', maker: 'Google', cli: 'antigravity', version: '1.2.0',
    desc: 'Plans first, then works across editor, terminal and browser.',
    auth: 'google', connected: true,
    signIn: 'Sign in with Google', signInNote: 'Uses your Google account. Opens your browser once.', keyLabel: 'Gemini API key', keyPrefix: 'AIza',
    models: [
      { id: 'gemini-3-pro', name: 'Gemini 3 Pro', hint: 'Best for most tasks' },
      { id: 'gemini-3-flash', name: 'Gemini 3 Flash', hint: 'Faster · lower cost', fast: true },
    ],
    glyph: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19 12 5l7 14" stroke="currentColor" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.5 14.5c2.2-1.2 4.8-1.2 7 0" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round"/></svg>',
    rate: 0.005,
  },
  claude: {
    id: 'claude', name: 'Claude Code', maker: 'Anthropic', cli: 'claude-code', version: '1.0.4', latest: '1.0.5', latestWhen: '2 days ago',
    desc: 'Careful multi-file changes and refactors.',
    auth: 'key', keyLabel: 'Anthropic API key', keyPrefix: 'sk-ant-', connected: true, keyHint: '••••3f2a',
    signIn: 'Sign in with Claude', signInNote: 'Uses your Claude plan. Opens your browser once.',
    models: [
      { id: 'claude-sonnet', name: 'Claude Sonnet', hint: 'Best for most tasks' },
      { id: 'claude-opus', name: 'Claude Opus', hint: 'Most capable · uses more of your quota' },
      { id: 'claude-haiku', name: 'Claude Haiku', hint: 'Fastest · lowest cost', fast: true },
    ],
    glyph: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
    rate: 0.008,
  },
  codex: {
    id: 'codex', name: 'Codex', maker: 'OpenAI', cli: 'codex', version: '0.31.2',
    desc: 'Quick iterations on tests, scripts and fixes.',
    auth: 'key', keyLabel: 'OpenAI API key', keyPrefix: 'sk-', connected: false, keyProblem: 'Key was rejected',
    signIn: 'Sign in with ChatGPT', signInNote: 'Uses your ChatGPT plan. Opens your browser once.',
    models: [
      { id: 'gpt-5-codex', name: 'GPT-5 Codex', hint: 'Best for most tasks' },
      { id: 'gpt-5-mini', name: 'GPT-5 mini', hint: 'Faster · lower cost', fast: true },
    ],
    glyph: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 8 4 4-4 4M12.5 16H18" stroke="currentColor" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    rate: 0.006,
  },
};
/* The template Studio picks for you: the first download in setup, New task, Home and the CLI examples. People can pick
   another one anytime, or bring their own agent. */
const DEFAULT_AGENT = 'antigravity';
/** The models a template can use (P0). Pre-built templates offer a few; added ones bring the one they were built for. */
function modelsFor(a) { return (a && a.models) || (a && a.model ? [{ id: slug(a.model), name: a.model, hint: 'Set by this template' }] : []); }
function modelOf(agentId, modelId) { const ms = modelsFor(AGENTS[agentId]); return ms.find((m) => m.id === modelId) || ms[0] || null; }
function modelName(t) { const m = t && modelOf(t.agent, t.model); return m ? m.name : ''; }
/** Rate-limit recovery (CUJ 2: "Wait, or switch key or model"): the lighter model, or the default if you're on it. */
function altModel(agentId, modelId) {
  const ms = modelsFor(AGENTS[agentId]);
  const cur = modelOf(agentId, modelId);
  if (ms.length < 2 || !cur) return null;
  return cur.fast ? ms[0] : (ms.find((m) => m.fast) || ms.find((m) => m.id !== cur.id));
}
/** Plain-language description of how an agent is signed in (never shows a raw key). */
function authLine(a) {
  if (a.auth === 'google') return a.connected ? 'Google sign-in in your keychain' : (a.keyProblem || 'Sign in with Google to use it');
  if (a.auth === 'account' && a.connected) return `${a.signIn.replace('Sign in with ', '')} sign-in in your keychain`;
  if (a.connected) return `API key ${a.keyHint || '••••'} in your keychain${a.keyFrom && AGENTS[a.keyFrom] ? ` · shared with ${AGENTS[a.keyFrom].name}` : ''}`;
  return a.keyProblem || 'Not connected yet';
}
/** The Google sign-in that Gemini-based templates share (Antigravity, your own agents). It's a template's credential in
    the keychain, not a Studio login: AX Studio has no account. */
function googleSignedIn() { return Object.values(AGENTS).some((a) => !a.removed && a.connected && a.signIn === 'Sign in with Google'); }
function credLabel(a) { return a.auth === 'google' ? 'Google sign-in' : a.auth === 'account' ? a.signIn.replace('Sign in with ', '') + ' sign-in' : a.keyLabel; }
function agentTile(id, size) {
  const a = AGENTS[id] || AGENT_CATALOG.find((c) => c.id === id) || AGENTS.claude;
  /* Added agents carry their own tile colour; the three pre-built agents keep their CSS colours. */
  return `<span class="agent-tile ${a.custom || a.source ? 'x-agent' : id} ${size || ''}" aria-hidden="true"${a.color ? ` style="--t:${a.color}"` : ''}>${a.glyph}</span>`;
}

/* ---------- Find or bring your own agent (CUJ 2) ----------
   Pre-built agents ship with AX. Builders can also add an agent their team shared (org registry), one from the AX catalog
   (verified or community), or one they built themselves (a folder, container image or Git repo). Added agents join AGENTS,
   so every picker, the task page, handoff, compare and the manifest treat them exactly like the pre-built ones. */
const AGENT_GLYPHS = {
  review: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5 9.6 17 19 7.5" stroke="currentColor" stroke-width="2.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  upgrade: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5.5M6.2 11.3 12 5.5l5.8 5.8" stroke="currentColor" stroke-width="2.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  gemini: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8c.7 4.9 3.6 7.9 9.2 9.2-5.6 1.3-8.5 4.3-9.2 9.2-.7-4.9-3.6-7.9-9.2-9.2 5.6-1.3 8.5-4.3 9.2-9.2Z" fill="currentColor"/></svg>',
  hands: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6.6" stroke="currentColor" stroke-width="2.6" fill="none"/><circle cx="12" cy="12" r="1.9" fill="currentColor"/></svg>',
  pair: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7 4.5 12 9 17M15 7l4.5 5-4.5 5" stroke="currentColor" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  custom: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2 19.5 7.4v9.2L12 20.8 4.5 16.6V7.4Z" stroke="currentColor" stroke-width="2.3" fill="none" stroke-linejoin="round"/><path d="M4.8 7.6 12 11.7l7.2-4.1M12 11.7v8.8" stroke="currentColor" stroke-width="2.1" fill="none" stroke-linejoin="round"/></svg>',
};
const AGENT_SOURCES = {
  prebuilt: { label: 'Pre-built', long: 'Pre-built · maintained by AX' },
  team: { label: 'Team', long: 'Shared by your team' },
  verified: { label: 'Verified', long: 'Verified by AX' },
  community: { label: 'Community', long: 'Community · not reviewed by AX' },
  yours: { label: 'Yours', long: 'Built by you' },
};
const GOOGLE_SIGNIN = { signIn: 'Sign in with Google', signInNote: 'Uses your Google account. Opens your browser once.', keyLabel: 'Gemini API key', keyPrefix: 'AIza' };
const AGENT_CATALOG = [
  Object.assign({
    id: 'review-bot', source: 'team', name: 'Review Bot', maker: 'acme', publisher: 'acme / platform-team', cli: 'acme/review-bot', version: '2.3.0',
    image: 'registry.acme.dev/agents/review-bot:2.3.0', digest: 'sha256:4f9c…e21a', framework: 'ADK · Python',
    desc: 'Reviews a branch against your team’s style guide, pushes small fix-up commits and posts a summary to Slack.',
    auth: 'google', model: 'Gemini 3 Pro', modelApi: 'generativelanguage.googleapis.com', reach: ['api.github.com', 'hooks.slack.com'], tools: ['GitHub MCP server'],
    users: '38 people on your team', updated: '3 days ago', color: '#BE185D', glyph: AGENT_GLYPHS.review, rate: 0.004,
  }, GOOGLE_SIGNIN),
  Object.assign({
    id: 'dep-upgrader', source: 'team', name: 'Dependency Upgrader', maker: 'acme', publisher: 'acme / devex', cli: 'acme/dep-upgrader', version: '1.6.1',
    image: 'registry.acme.dev/agents/dep-upgrader:1.6.1', digest: 'sha256:b71d…09c4', framework: 'ADK · Python',
    desc: 'Upgrades one dependency at a time and runs your tests after each step.',
    auth: 'google', model: 'Gemini 3 Flash', modelApi: 'generativelanguage.googleapis.com', reach: ['registry.npmjs.org', 'pypi.org'], tools: ['test-runner skill'],
    users: '112 people on your team', updated: 'last week', color: '#4D7C0F', glyph: AGENT_GLYPHS.upgrade, rate: 0.003,
  }, GOOGLE_SIGNIN),
  Object.assign({
    id: 'gemini-cli', source: 'verified', name: 'Gemini CLI', maker: 'Google', publisher: 'Google', cli: 'gemini-cli', version: '0.9.0',
    image: 'ghcr.io/google/ax-gemini-cli:0.9.0', digest: 'sha256:2ac0…7d13', framework: 'Node.js',
    desc: 'Large-context edits and questions about your whole codebase.',
    auth: 'google', model: 'Gemini 3 Pro', modelApi: 'generativelanguage.googleapis.com', reach: [], tools: [],
    users: '24k builders', updated: '2 days ago', color: '#1A73E8', glyph: AGENT_GLYPHS.gemini, rate: 0.004,
  }, GOOGLE_SIGNIN),
  {
    id: 'openhands', source: 'community', name: 'OpenHands', maker: 'All Hands AI', publisher: 'All Hands AI · open source', cli: 'openhands', version: '0.52',
    image: 'docker.all-hands.dev/all-hands-ai/openhands:0.52', framework: 'Python',
    desc: 'Writes code, runs commands and reads docs until the goal is met.',
    auth: 'key', keyFrom: 'claude', keyLabel: 'Anthropic API key', keyPrefix: 'sk-ant-', model: 'Claude Sonnet', modelApi: 'api.anthropic.com', reach: ['github.com', 'pypi.org'], tools: [],
    users: '9.1k builders', updated: 'yesterday', color: '#B45309', glyph: AGENT_GLYPHS.hands, rate: 0.008,
  },
  {
    id: 'aider', source: 'community', name: 'Aider', maker: 'Aider', publisher: 'Aider · open source', cli: 'aider', version: '0.86',
    image: 'paulgauthier/aider:v0.86', framework: 'Python',
    desc: 'Pair-programs in small steps and commits each change with a clear message.',
    auth: 'key', keyFrom: 'claude', keyLabel: 'Anthropic API key', keyPrefix: 'sk-ant-', model: 'Claude Sonnet', modelApi: 'api.anthropic.com', reach: ['github.com'], tools: [],
    users: '6.4k builders', updated: '5 days ago', color: '#475569', glyph: AGENT_GLYPHS.pair, rate: 0.007,
  },
];
/** Agents you can pick right now: the pre-built ones plus any you added (removed ones stay defined for old tasks). */
function agentList() { return Object.values(AGENTS).filter((a) => !a.removed); }
function prebuiltAgents() { return Object.values(AGENTS).filter((a) => !a.custom); }
function addedAgents() { return Object.values(AGENTS).filter((a) => a.custom && !a.removed); }
/** "Antigravity, Claude Code and Codex": a plain-language list of names. */
function andList(xs) { return xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`; }
function agentSource(a) { return AGENT_SOURCES[(a && a.source) || 'prebuilt'] || AGENT_SOURCES.prebuilt; }
/** "v1.0.4", or "local build" for an agent built from your folder or repo. */
function agentVersionLabel(a) { return a.version === 'dev' ? 'local build' : 'v' + a.version; }
/** The image a task runs: pre-built templates come from AX's registry; added ones bring their own. `pin` (per task) overrides the global "Pin pre-built image versions" setting. */
function agentImage(a, pin) { const p = pin == null ? state.pinImages : pin; return a.image || `ghcr.io/google/ax-${a.cli}:${p ? a.version : 'latest'}`; }
/* Every task runs on AX's default task runner image, maintained by AX alongside the pre-built templates. */
const TASK_RUNNER = { name: 'ax-task-runner', image: 'ghcr.io/google/ax-task-runner', version: '0.9.2' };
function runnerImage() { return `${TASK_RUNNER.image}:${TASK_RUNNER.version}`; }
function runnerLabel() { return `${TASK_RUNNER.name} ${TASK_RUNNER.version}`; }
/** Strip markup from anything a person typed before it becomes part of an agent's definition. */
function cleanText(s, max) { return String(s || '').replace(/[<>&"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, max || 60); }
/** Add a catalog or bring-your-own agent to your library (or bring a removed one back). Returns the agent. */
function addAgent(def) {
  const prev = AGENTS[def.id];
  if (prev && prev.custom) { prev.removed = false; saveCustomAgents(); return prev; }
  const a = Object.assign({ custom: true, rate: 0.005, connected: false, desc: '', version: 'dev' }, def, { custom: true, removed: false });
  if (a.keyFrom && AGENTS[a.keyFrom]) { a.connected = !!AGENTS[a.keyFrom].connected; a.keyHint = AGENTS[a.keyFrom].keyHint; }
  else if (a.auth === 'google') a.connected = googleSignedIn();
  /* A connected agent's model API works out of the box, like the pre-built ones (Balanced preset). */
  if (a.modelApi && !state.allow.some((x) => x.domain === a.modelApi)) state.allow.push({ domain: a.modelApi, scope: 'all', by: 'Balanced preset', note: `Model API for ${a.name} · key added outbound by Guardrails` });
  AGENTS[a.id] = a;
  saveCustomAgents();
  return a;
}
function removeAgent(id) { const a = AGENTS[id]; if (a && a.custom) { a.removed = true; saveCustomAgents(); } return a; }
function saveCustomAgents() {
  try {
    const keep = addedAgents().map((a) => {
      const o = Object.assign({}, a);
      delete o.connected; delete o.keyHint; delete o.keyProblem;
      if (o.auth === 'account' && o.signIn === GOOGLE_SIGNIN.signIn) o.auth = 'google';   /* sign-in itself is never saved */
      return o;
    });
    localStorage.setItem('ax.agents', JSON.stringify(keep));
  } catch (e) { /* ignore */ }
}
function chip(status, t) {
  /* Lost connection: never show a live pulse for news we aren't getting. Say how old the last update is instead. */
  if (t && state.conn && state.conn.lost && ACTIVE.includes(status)) return `<span class="chip stale" title="Reconnecting. The task keeps running.">${icon('clock')}Last update <span data-since="${state.conn.since}" data-fmt="secs">${Math.round((Date.now() - state.conn.since) / 1000)} s</span> ago</span>`;
  if (t && t.queued) return `<span class="chip paused" title="Waiting for room on this computer">${icon('clock')}Queued</span>`;
  if (quotaWaiting(t)) return `<span class="chip waiting" title="Retrying automatically when the rate limit resets">${icon('clock')}Waiting</span>`;
  if (isPaused(t)) return `<span class="chip paused">${icon('pause')}Paused</span>`;
  if (asleepHeld(t)) return `<span class="chip paused" title="Paused while your computer slept">${icon('moon')}Paused</span>`;
  const s = STATUS[status];
  return `<span class="chip ${status}">${icon(s.icon)}${s.label}</span>`;
}
/* ---------- Per-task CPU and memory ----------
   Each task's sandbox has a size (small, medium, large). While an agent works it uses part of it; while the task waits
   for you the CPU is idle and the memory is held; once the task ends the sandbox is stopped. Simulated, steady per task. */
const SIZES = { small: { cpu: 1, mem: 2, name: 'Small' }, medium: { cpu: 2, mem: 4, name: 'Medium' }, large: { cpu: 4, mem: 8, name: 'Large' } };
function resourceFor(t) {
  const lim = SIZES[t.size] || SIZES.medium;
  /* A queued task hasn't started, and a task you paused is suspended: neither uses CPU or memory. */
  const live = ['running', 'starting', 'stopping'].includes(t.status) && !t.queued, held = ['waiting', 'blocked'].includes(t.status) && !pausedByYou(t);
  if (!live && !held) return { lim, on: false };
  let h = 0; const key = t.id + ':' + (t.step || 0);
  for (let k = 0; k < key.length; k++) h = (h * 31 + key.charCodeAt(k)) % 997;
  const cpuF = live ? (t.status === 'starting' ? 0.25 : 0.35 + (h % 50) / 100) : 0.01;
  const memF = 0.42 + ((h * 7) % 36) / 100;
  return { lim, on: true, live, cpu: Math.round(lim.cpu * cpuF * 10) / 10, mem: Math.round(lim.mem * memF * 10) / 10, cpuF, memF };
}
function resourceHTML(t) {
  const r = resourceFor(t);
  /* Sandbox lifecycle (prototype default, see docs/backend-handoff.md): a task that isn't working is suspended. Its files
     are kept and it uses no CPU or memory; a follow-up or the terminal starts it again in a few seconds. */
  if (!r.on) return `<p class="xsmall muted res-off">${pausedByYou(t) ? 'Paused: suspended, files are kept and nothing is using CPU or memory. Resume starts it again.' : t.queued ? 'Queued: it starts when there is room on this computer.' : handedOff(t) ? 'The workspace moved to the current task. Nothing runs here.' : 'Suspended: files are kept, nothing is using CPU or memory. A follow-up or the terminal starts it again.'}</p>`;
  const bar = (label, val, max, unit, f) => `<div class="res-row"><span class="res-k">${label}</span><span class="meter res-meter${f > 0.85 ? ' hot' : ''}" role="img" aria-label="${label}: ${val} of ${max} ${unit}"><span style="width:${Math.max(2, Math.round(f * 100))}%"></span></span><span class="res-v tnum">${val} of ${max} ${unit}</span></div>`;
  return bar('CPU', r.cpu, r.lim.cpu, r.lim.cpu === 1 ? 'core' : 'cores', r.cpuF) + bar('Memory', r.mem, r.lim.mem, 'GB', r.memF)
    + (r.live ? '' : '<p class="xsmall muted res-off">Waiting for you: the CPU is idle and the memory is held.</p>');
}
function envBadge(t) {
  return t.env === 'cluster'
    ? `<span class="env" title="${esc(t.cluster || '')}">${icon('cloud')}On a remote cluster</span>`
    : `<span class="env">${icon('laptop')}On this computer</span>`;
}
function cliHint(cmd) {
  return `<div class="cli"><span class="prompt">$</span><code>${esc(cmd)}</code><button class="btn ghost sm icon" data-action="copy" data-text="${esc(cmd)}" aria-label="Copy command">${icon('copy', 'sm')}</button></div>`;
}

/* ---------- Diffs ---------- */
function newFile(text) { return ['@@ -0,0 +1,' + text.split('\n').length + ' @@'].concat(text.split('\n').map((l) => '+' + l)); }
function diffStats(lines) {
  let a = 0, d = 0;
  lines.forEach((l) => { if (l[0] === '+') a++; else if (l[0] === '-') d++; });
  return { add: a, del: d };
}
function statHTML(f) {
  const s = diffStats(f.lines);
  return `<span class="diffstat"><span class="a">+${s.add}</span><span class="d">−${s.del}</span></span>`;
}

const FILES = {
  rateLimit: { path: 'src/middleware/rateLimit.ts', kind: 'new', lines: newFile(
`import rateLimit from "express-rate-limit";
import type { Request } from "express";

/**
 * Limits each client to 20 checkout attempts per minute.
 * Responds with 429 and a Retry-After header when exceeded.
 */
export const checkoutLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.user?.id ?? req.ip ?? "anonymous",
  handler: (req, res, _next, options) => {
    res.setHeader("Retry-After", Math.ceil(options.windowMs / 1000));
    res.status(429).json({
      error: "too_many_requests",
      message: "Too many checkout attempts. Try again in a minute.",
    });
  },
});`) },
  checkout: { path: 'src/routes/checkout.ts', kind: 'modified', lines: [
    '@@ -1,9 +1,10 @@',
    ' import { Router } from "express";',
    ' import { createOrder } from "../services/orders";',
    '+import { checkoutLimiter } from "../middleware/rateLimit";',
    ' ',
    ' export const checkout = Router();',
    ' ',
    '-checkout.post("/", async (req, res) => {',
    '+checkout.post("/", checkoutLimiter, async (req, res) => {',
    '   const order = await createOrder(req.user, req.body);',
    '   res.status(201).json(order);',
    ' });',
  ] },
  rateTest: { path: 'test/rateLimit.test.ts', kind: 'new', lines: newFile(
`import request from "supertest";
import { app } from "../src/app";

describe("POST /checkout rate limit", () => {
  it("allows 20 requests per minute", async () => {
    for (let i = 0; i < 20; i++) {
      await request(app).post("/checkout").send({}).expect(201);
    }
  });

  it("returns 429 with Retry-After on the 21st", async () => {
    const res = await request(app).post("/checkout").send({});
    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBe("60");
  });
});`) },
  pkg: { path: 'package.json', kind: 'modified', lines: [
    '@@ -14,6 +14,7 @@',
    '   "dependencies": {',
    '     "express": "^4.19.2",',
    '+    "express-rate-limit": "^7.4.0",',
    '     "zod": "^3.23.8"',
    '   },',
  ] },
  pytestAuth: { path: 'tests/test_auth.py', kind: 'modified', lines: [
    '@@ -1,14 +1,12 @@',
    '-import unittest',
    '+import pytest',
    ' from app.auth import login, InvalidCredentials',
    ' ',
    ' ',
    '-class LoginTests(unittest.TestCase):',
    '-    def test_rejects_bad_password(self):',
    '-        with self.assertRaises(InvalidCredentials):',
    '-            login("rajitha", "wrong")',
    '+def test_rejects_bad_password(user):',
    '+    with pytest.raises(InvalidCredentials):',
    '+        login(user.name, "wrong")',
    ' ',
    '-    def test_accepts_good_password(self):',
    '-        self.assertTrue(login("rajitha", "s3cret"))',
    '+def test_accepts_good_password(user):',
    '+    assert login(user.name, user.password)',
  ] },
  conftest: { path: 'tests/conftest.py', kind: 'new', lines: newFile(
`import pytest
from app.models import User


@pytest.fixture
def user():
    return User(name="rajitha", password="s3cret")`) },
  webp: { path: 'pipeline/encode.py', kind: 'modified', lines: [
    '@@ -8,7 +8,9 @@ def encode(image, quality=85):',
    '     """Encode an image for the CDN."""',
    '-    return image.save(buffer(), format="JPEG", quality=quality)',
    '+    if supports_webp(image):',
    '+        return image.save(buffer(), format="WEBP", quality=quality, method=6)',
    '+    return image.save(buffer(), format="JPEG", quality=quality)',
  ] },
  readme: { path: 'cli/README.md', kind: 'new', lines: newFile(
`# ax — the AX Studio command line

Everything you can do in AX Studio, you can do with ax.

## Quick start

    ax run --agent antigravity "Fix the failing tests"
    ax ls
    ax ssh <task>

## Output for scripts

Add --json to any command for machine-readable output.`) },
  cliRef: { path: 'cli/docs/reference.md', kind: 'new', lines: newFile(
`# Command reference

| Command      | What it does                              |
| ------------ | ----------------------------------------- |
| ax run       | Start a task with an agent                |
| ax ls        | List tasks and their status               |
| ax ssh       | Open a terminal in a task's sandbox       |
| ax diff      | Show a task's changes                     |
| ax handoff   | Continue a task with another agent        |
| ax promote   | Run a task on a remote cluster            |`) },
  readmeAlt: { path: 'cli/README.md', kind: 'new', lines: newFile(
`# ax CLI

Run, watch, and steer coding agents safely from your terminal.

## Install & verify

    ax doctor
    ax run --agent antigravity --repo . "Fix the failing tests"
    ax diff <task> && ax push <task>

## Automation & CI

Every command accepts --json and exits non-zero on policy blocks.`) },
  examplesAlt: { path: 'cli/docs/examples.md', kind: 'new', lines: newFile(
`# Common workflows

## Compare two agents in isolated sandboxes

    ax run --compare antigravity,claude-code "Refactor auth middleware"

## Run a long build on a remote cluster

    ax promote t1 --cluster ax-dev-us-central`) },
  tokens: { path: 'web/styles/tokens.css', kind: 'modified', lines: [
    '@@ -1,6 +1,14 @@',
    ' :root {',
    '   --bg: #ffffff;',
    '   --text: #17181a;',
    ' }',
    '+',
    '+@media (prefers-color-scheme: dark) {',
    '+  :root {',
    '+    --bg: #0a0f15;',
    '+    --text: #eef4f9;',
    '+  }',
    '+}',
  ] },
};
function genericFiles(task) {
  const s = slug(task.title);
  return [
    { path: `src/${s}.ts`, kind: 'new', lines: newFile(`// ${task.title}\nexport function run() {\n  // Implemented by ${AGENTS[task.agent].name}\n  return true;\n}`) },
    { path: 'README.md', kind: 'modified', lines: ['@@ -3,3 +3,5 @@', ' ## Features', ' ', `+- ${task.title}`, '+'] },
  ];
}

/* ---------- Seed state ---------- */
const T0 = now();
function ev(type, minsAgo, extra) { return Object.assign({ type, at: T0 - minsAgo * MIN }, extra || {}); }

const state = {
  /* AX Studio has no account and no login. The first name comes from this computer's user account (the greeting). */
  user: { first: 'Rajitha', handle: 'rajitha' },
  org: { admin: 'platform-team@example.com' },
  /* Your team's template registry (Add a template → Your team). There's no login, so it's an address you add once. */
  teamRegistry: null,
  /* Repo keys are set up once, like a template's sign-in. GitHub covers private repos, pushes and the GitHub
     MCP server; the token stays in the keychain and is added outside the sandbox. A first run starts without it. */
  github: { connected: true, user: 'rajitha' },
  showInfra: false,
  pinImages: true,
  guardrailPreset: 'balanced',
  permMode: 'auto',
  singleKeys: true,
  homeFilter: 'all',
  notify: { needs: true, done: true, party: true, desktop: false },
  privacy: { retention: '30' },
  skills: { claude: true, codex: false, antigravity: false },
  /* Environment lifecycle (F19): mode = local | cluster (connected only) | none (setup skipped). */
  /* clusterConnected: a remote cluster has been chosen and connected (setup, New task or Where agents run). */
  env: { mode: 'local', health: 'healthy', issue: null, startsIn: 0, cluster: 'ax-dev-us-central', clusterConnected: true },
  /* Prototype-only toggles set by review scenarios (#/review, ?scenario=<id>) for usability studies. */
  flags: {},
  bellSeen: 0,
  nextId: 8,
  draft: null,
  /* Templates still downloading in the background after setup: { id: { start, ms } }. */
  downloads: {},
  /* Workspace setups you saved from New task, to reuse for the next task. */
  savedSetups: [],
  diffSel: {},
  term: {},
  allow: [
    { domain: 'generativelanguage.googleapis.com', scope: 'all', by: 'Balanced preset', note: 'Key added outbound by Guardrails' },
    { domain: 'github.com', scope: 'all', by: 'Balanced preset' },
    { domain: 'registry.npmjs.org', scope: 'all', by: 'Balanced preset' },
    { domain: 'pypi.org', scope: 'all', by: 'Balanced preset' },
    { domain: 'files.pythonhosted.org', scope: 'all', by: 'Balanced preset' },
    { domain: 'api.anthropic.com', scope: 'all', by: 'Balanced preset', note: 'Key added outbound by Guardrails' },
    { domain: 'api.openai.com', scope: 'all', by: 'Balanced preset', note: 'Key added outbound by Guardrails' },
    { domain: 'docs.stripe.com', scope: 'shop-api', by: 'You' },
    { domain: '*.corp.example.com', scope: 'org', by: 'Your organization' },
  ],
  orgBlocked: ['pastebin.com', 'transfer.sh'],
  blockedLog: [
    { at: T0 - 38 * MIN, task: 't3', domain: 'pastebin.com', reason: 'org', cmd: 'curl -F "file=@reports/sizes.txt" https://pastebin.com/api/api_post.php', purpose: 'Upload a size report to share' },
    { at: T0 - 26 * MIN, task: 't6', domain: 'unpkg.com', reason: 'list', cmd: 'curl -sL https://unpkg.com/markdown-table@3.0.3/index.js', purpose: 'Load a Markdown table formatter' },
  ],
  tasks: [
    {
      id: 't1', title: 'Add rate limiting to the checkout API', agent: 'claude', status: 'running', env: 'local',
      repo: 'shop-api', folder: '~/code/shop-api', branch: 'ax/rate-limit', startedAt: T0 - 3 * MIN, tokens: 41200, files: [], script: 't1', step: 0,
      events: [
        ev('user', 3, { text: 'Add rate limiting to the checkout API. 20 requests per minute per user, return 429 with Retry-After.' }),
        ev('thought', 2.8, { text: "I'll find where the checkout route is defined and check whether the app already has middleware I can reuse." }),
        ev('tool', 2.5, { title: 'searched the code', cmd: 'rg -n "checkout" src', out: 'src/routes/checkout.ts:4:export const checkout = Router();\nsrc/app.ts:12:app.use("/checkout", checkout);', ok: true }),
      ],
    },
    {
      id: 't2', title: 'Migrate auth tests to pytest', agent: 'claude', status: 'waiting', env: 'local',
      repo: 'accounts', folder: '~/code/accounts', branch: 'ax/pytest-auth', startedAt: T0 - 22 * MIN, tokens: 96400,
      files: [FILES.pytestAuth, FILES.conftest], script: 'answer', step: 0,
      needs: { type: 'question' },
      events: [
        ev('user', 22, { text: 'Migrate the auth test suite from unittest to pytest. Keep coverage the same.' }),
        ev('thought', 21, { text: 'There are 14 unittest classes under tests/. I will convert them one file at a time and run the suite after each.' }),
        ev('tool', 19, { title: 'ran a command', cmd: 'pytest --collect-only -q', out: '42 tests collected in 0.61s', ok: true }),
        ev('edit', 9, { paths: ['tests/test_auth.py', 'tests/conftest.py'] }),
        ev('question', 6, { text: 'tests/legacy_fixtures.py has 6 fixtures that nothing imports anymore. Should I delete them, or keep them for now?', options: ['Delete them', 'Keep for now'] }),
      ],
    },
    {
      id: 't3', title: 'Convert the image pipeline to WebP', agent: 'antigravity', status: 'running', env: 'cluster', cluster: 'ax-dev-us-central',
      repo: 'media-pipeline', folder: '~/code/media-pipeline', branch: 'ax/webp', startedAt: T0 - 48 * MIN, tokens: 233800,
      files: [FILES.webp], script: 't3', step: 0,
      events: [
        ev('user', 48, { text: 'Serve WebP where the browser supports it, fall back to JPEG. Re-encode the sample set and compare sizes.' }),
        ev('thought', 47, { text: 'Plan: 1) add format detection, 2) update the encoder, 3) re-encode 2,400 sample images and report savings.' }),
        ev('moved', 41, { cluster: 'ax-dev-us-central', from: 'ax/webp' }),
        ev('thought', 40, { text: "New session on ax-dev-us-central. I don't have the earlier conversation, so I'm re-reading the goal and the code on ax/webp before I pick the next step." }),
        ev('blocked', 38, { domain: 'pastebin.com', cmd: 'curl -F "file=@reports/sizes.txt" https://pastebin.com/api/api_post.php', purpose: 'Upload a size report to share', policy: true, resolved: 'policy' }),
        ev('thought', 37, { text: "That site is blocked by your organization, so I'll write the report to reports/webp.md in the workspace instead." }),
        ev('edit', 30, { paths: ['pipeline/encode.py'] }),
        ev('tool', 12, { title: 'ran a command', cmd: 'python -m pipeline.reencode samples/ --format webp', out: 'Re-encoding 2,400 images…\n  1,488 / 2,400 done (62%)\n  Average size: −31% vs JPEG', ok: true }),
      ],
    },
    {
      id: 't4', title: 'Upgrade web-app to Node 22', agent: 'codex', status: 'failed', env: 'local',
      repo: 'web-app', folder: '~/code/web-app', branch: 'ax/node-22', startedAt: T0 - 14 * MIN, tokens: 0, files: [], script: 'generic', step: 0,
      events: [
        ev('user', 14, { text: 'Upgrade web-app to Node 22 and fix anything that breaks.' }),
        ev('tool', 13.9, { title: 'started the agent', cmd: 'Starting Codex in a secure sandbox', out: 'Sandbox ready in 3.1s\nWorkspace copied: web-app (1,204 files)', ok: true }),
        ev('fail', 13.8, {
          code: 'key-rejected',
          title: "Codex couldn't start: your OpenAI key was rejected",
          cause: 'OpenAI answered “401 Unauthorized”. The key may have been revoked, or it expired.',
          fix: 'Add a new OpenAI key, then retry. Your workspace and goal are saved. Or try another agent.',
          log: '[13:02:11] guardrails: egress api.openai.com:443 → 401 Unauthorized\n[13:02:11] agent: auth failed (Authorization: Bearer sk-••••••••[redacted])\n[13:02:11] task: stopped, workspace kept',
        }),
      ],
    },
    {
      id: 't5', title: 'Write a README for the ax CLI', agent: 'antigravity', status: 'done', env: 'local', parent: 't6',
      repo: 'ax', folder: '~/code/ax', branch: 'ax/cli-readme', startedAt: T0 - 95 * MIN, finishedAt: T0 - 70 * MIN, tokens: 58100,
      files: [FILES.readme, FILES.cliRef], script: 'followup', step: 0,
      altRun: {
        agent: 'claude',
        tokens: 68400,
        durationLabel: '31m',
        tests: 'Markdown lint passed',
        summary: 'Adds CI exit-code notes and a separate examples.md workflow guide.',
        files: [FILES.readmeAlt, FILES.cliRef, FILES.examplesAlt],
      },
      events: [
        ev('handoff', 95, { from: 't6', fromAgent: 'claude', note: 'Reference table is drafted in cli/docs/reference.md. Please write a friendly README that links to it, with a 3-command quick start.' }),
        ev('thought', 94, { text: 'I will keep the README short: what ax is, a quick start, and how to get JSON output for scripts.' }),
        ev('edit', 80, { paths: ['cli/README.md'] }),
        ev('done', 70, { text: 'README added with a quick start and a link to the reference. 2 files changed.' }),
      ],
    },
    {
      id: 't6', title: 'Draft a CLI reference from --help output', agent: 'claude', status: 'done', env: 'local',
      repo: 'ax', folder: '~/code/ax', branch: 'ax/cli-readme', startedAt: T0 - 130 * MIN, finishedAt: T0 - 96 * MIN, tokens: 71900,
      files: [FILES.cliRef], script: 'followup', step: 0, child: 't5',
      events: [
        ev('user', 130, { text: 'Generate a command reference for ax from the --help output of every subcommand.' }),
        ev('tool', 128, { title: 'ran a command', cmd: 'for c in run ls ssh diff handoff promote; do ax $c --help; done', out: '6 commands, 31 flags found', ok: true }),
        ev('blocked', 126, { domain: 'unpkg.com', cmd: 'curl -sL https://unpkg.com/markdown-table@3.0.3/index.js', purpose: 'Load a Markdown table formatter', resolved: 'denied' }),
        ev('edit', 110, { paths: ['cli/docs/reference.md'] }),
        ev('done', 96, { text: 'Reference drafted for 6 commands. Handed off to Antigravity for the README.' }),
      ],
    },
    {
      id: 't7', title: 'Add dark-mode design tokens', agent: 'claude', status: 'done', env: 'cluster', cluster: 'ax-dev-us-central',
      repo: 'web-app', folder: '~/code/web-app', branch: 'ax/dark-tokens', startedAt: T0 - 26 * 60 * MIN, finishedAt: T0 - 25 * 60 * MIN, tokens: 38800,
      files: [FILES.tokens], pushed: true, script: 'followup', step: 0,
      events: [
        ev('user', 26 * 60, { text: 'Add dark-mode values for our color tokens using prefers-color-scheme.' }),
        ev('edit', 25.5 * 60, { paths: ['web/styles/tokens.css'] }),
        ev('done', 25 * 60, { text: 'Dark-mode tokens added. Contrast checked at 4.5:1 or better.' }),
        ev('pushed', 24.8 * 60, { branch: 'ax/dark-tokens' }),
      ],
    },
  ],
};

function getTask(id) { return state.tasks.find((t) => t.id === id); }
function filesFor(t) { return t.files || []; }
function totalDiff(files) {
  return (files || []).reduce((acc, f) => {
    const s = diffStats(f.lines);
    return { add: acc.add + s.add, del: acc.del + s.del };
  }, { add: 0, del: 0 });
}
function costFor(t) { return (t.tokens / 1000) * AGENTS[t.agent].rate; }
function fmtTokens(n) { return n >= 1000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1) + 'k' : String(n); }
/** A failed handoff attempt is folded into its source task (the source card explains it), so it never double-counts. */
function isFolded(t) { return !!(t && t.foldedInto && t.status === 'failed'); }
/** CUJ 4: a task another agent continued. Its workspace moved to the new task (only one agent is active at a time),
    so there's nothing left to review or ship here; its Activity stays for reference. */
function handedOff(t) { return !!(t && t.status === 'done' && t.child && !t.handoffFailed && getTask(t.child)); }
/** CUJ 5: on a remote cluster the organization's budget cap applies; on this computer AX checks in at the task's budget. */
const ORG_BUDGET = 50;
function budgetFor(t) { return t.env === 'cluster' ? ORG_BUDGET : (t.budget || 5); }
function needsCount() { return state.tasks.filter(needsYou).length; }
function openBlock(t) { for (let i = t.events.length - 1; i >= 0; i--) { const e = t.events[i]; if (e.type === 'blocked' && !e.resolved) return { e, i }; } return null; }
function openQuestion(t) { for (let i = t.events.length - 1; i >= 0; i--) { const e = t.events[i]; if (e.type === 'question' && !e.answer && !e.superseded) return { e, i }; } return null; }
function lastFail(t) { for (let i = t.events.length - 1; i >= 0; i--) { if (t.events[i].type === 'fail') return { e: t.events[i], i }; } return null; }
/** Sites a preset includes on its own: Balanced has the common package hosts and the model APIs; Locked down keeps
    only the model APIs (the rows with a key note). */
function presetSites(p) {
  const base = state.allow.filter((a) => /preset/.test(a.by || ''));
  return (p || state.guardrailPreset) === 'strict' ? base.filter((a) => a.note) : base;
}
/** Sites you allowed yourself, on top of the preset (for one workspace or for all of them). */
function mySites() { return state.allow.filter((a) => a.by === 'You'); }
/** Can an agent in this workspace reach this site under the current preset, your sites and your organization's rules? */
function siteAllowed(domain, repo) {
  return presetSites().some((a) => a.domain === domain)
    || state.allow.some((a) => a.domain === domain && (a.scope === 'org' || (a.by === 'You' && (a.scope === 'all' || a.scope === repo))));
}
function reachFor(t) {
  const mine = (a) => a.by === 'You' && (a.scope === 'all' || a.scope === t.repo);
  if (state.guardrailPreset === 'strict') {
    const allowedApi = t.agent === 'antigravity' ? 'generativelanguage.googleapis.com' : t.agent === 'claude' ? 'api.anthropic.com' : t.agent === 'codex' ? 'api.openai.com' : '*.corp.example.com';
    return state.allow.filter((a) => a.domain === allowedApi || mine(a) || a.scope === 'org');
  }
  return state.allow.filter((a) => a.scope === 'all' || a.scope === t.repo || a.scope === 'org');
}

/* Workspace recipe catalogs (F8) — skills and MCP servers an agent builder can add without editing YAML. */
const SKILLS = [
  { id: 'ax-task', name: 'ax-task', desc: 'Run, inspect and hand off tasks with ax (bundled)', locked: true },
  { id: 'test-runner', name: 'test-runner', desc: 'Find and run the right tests after each change' },
  { id: 'security-review', name: 'security-review', desc: 'Check diffs for secrets and risky patterns' },
  { id: 'frontend-design', name: 'frontend-design', desc: 'Accessible, consistent UI changes. Uses the Playwright browser to check pages.', needs: 'playwright' },
];
const MCP_SERVERS = [
  { id: 'github', name: 'GitHub', desc: 'Issues and pull requests', auth: 'Connected · through Guardrails' },
  { id: 'linear', name: 'Linear', desc: 'Read and update issues', auth: 'Sign-in needed' },
  { id: 'postgres', name: 'Postgres (read-only)', desc: 'Query a dev database', auth: 'Uses a keychain entry' },
  { id: 'playwright', name: 'Playwright browser', desc: 'Open and test web pages', auth: 'Runs inside the sandbox' },
];
function mcpName(id) { return (MCP_SERVERS.find((m) => m.id === id) || { name: id }).name; }
/** An MCP server that signs in (GitHub, Linear) can't start until you connect it once. */
function mcpNeedsSignIn(id) { return (id === 'github' && !state.github.connected) || (id === 'linear' && !state.mcpConnected); }
function mcpAuthLabel(m) {
  if (m.id === 'github') return state.github.connected ? `Connected as ${state.github.user} · through Guardrails` : 'Sign-in needed';
  if (m.id === 'linear') return state.mcpConnected ? 'Connected · through Guardrails' : 'Sign-in needed';
  return m.auth;
}
/** New workspaces start with the GitHub MCP server once GitHub is connected (it can't start without a sign-in). */
function defaultMcp() { return state.github.connected ? ['github'] : []; }
function connectGithub() { state.github.connected = true; }
/** A skill that needs an MCP server the workspace doesn't have can't load (CUJ 2: "An MCP server / skill fails to start"). */
function skillGaps(skills, mcp) { return (skills || []).map((id) => SKILLS.find((s) => s.id === id)).filter((s) => s && s.needs && !(mcp || []).includes(s.needs)); }
/* Inline files are written into the workspace before the agent starts. Like env vars, a file that looks like it
   holds a secret is kept out of the sandbox (keys belong in Settings → Agents & keys). */
function cleanFiles(list) { return (list || []).filter((f) => f && String(f.path || '').trim()); }
function fileHasSecret(f) {
  const c = String((f && f.content) || '');
  return /\b(sk-[A-Za-z0-9-]{6,}|ghp_[A-Za-z0-9]{6,}|gho_[A-Za-z0-9]{6,}|AKIA[A-Z0-9]{8,}|xox[abp]-[A-Za-z0-9-]{6,}|AIza[0-9A-Za-z_-]{10,})/.test(c)
    || parseEnvVars(c).some((x) => x.secret && x.v);
}
/** Parse "NAME=value" lines; anything that looks like a secret is flagged and never written to YAML. */
function parseEnvVars(text) {
  return String(text || '').split('\n').map((l) => l.trim()).filter((l) => l && l.includes('=')).map((l) => {
    const k = l.slice(0, l.indexOf('=')).trim(), v = l.slice(l.indexOf('=') + 1).trim();
    const secret = /(key|secret|token|passw|credential|auth)/i.test(k) || /^(sk-|ghp_|gho_|AKIA|xox[abp]-|AIza)/.test(v);
    return { k, v, secret };
  }).filter((x) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(x.k));
}

/* Portable YAML builders (Agent Substrate CRD + OCI Sandbox Kit compatibility, zero raw secrets) */
function manifestYAML(spec, format) {
  const a = AGENTS[spec.agent || DEFAULT_AGENT];
  /* Added templates bring their own image (team registry, catalog, or built in the sandbox from your folder).
     Pre-built ones are pinned per task, or follow the latest release. */
  const pinned = spec.pin ? spec.pin !== 'latest' : state.pinImages;
  const img = agentImage(a, pinned);
  const imgNote = a.image ? '' : pinned ? ' # pinned for this task' : ` # ${a.latest || a.version} today`;
  const m = modelOf(a.id, spec.model);
  const setup = String(spec.setup || 'npm ci');
  const setupLine = setup === 'auto' ? '  setup: auto # detected from the repo after cloning' : `  setup: "${setup.replace(/"/g, "'")}"${spec.setupFrom ? ` # detected from ${spec.setupFrom}` : ''}`;
  const goal = (spec.goal || spec.title || 'Describe the goal').replace(/"/g, "'").replace(/\s*\n+\s*/g, ' · ');
  const repo = spec.repo || 'workspace';
  const source = spec.folder || '~/code/' + repo;
  const cred = a.keyFrom ? AGENTS[a.keyFrom].maker.toLowerCase() + '-key' : a.auth === 'google' || (a.custom && a.auth === 'account') ? 'google-oauth' : a.auth === 'account' ? a.maker.toLowerCase() + '-account' : a.maker.toLowerCase() + '-key';
  const preset = spec.preset || state.guardrailPreset;
  const domains = state.allow.filter((x) => x.scope === 'all' || x.scope === repo).map((x) => x.domain);
  const skills = spec.skills || ['ax-task'];
  const mcp = spec.mcp || [];
  const vars = parseEnvVars(spec.envVars);
  const files = cleanFiles(spec.files);
  /* Inline files show their first lines; the header comment says how long each one is. */
  const fileLines = (f) => {
    if (fileHasSecret(f)) return [`    # ${f.path.trim()} removed: looks like it has a secret. Add keys in Settings → Agents & keys.`];
    const lines = String(f.content || '').split('\n');
    return [`    - path: ${f.path.trim()}`, `      content: | # ${plural(lines.length, 'line')}${lines.length > 3 ? ', first 3 shown' : ''}`, ...lines.slice(0, 3).map((l) => `        ${l}`)];
  };
  const budget = Number(spec.budget) > 0 ? Number(spec.budget) : 5;
  const recipe = [
    ...(spec.branch ? [`  branch: ${spec.branch}`] : []),
    ...(spec.includeUncommitted != null ? [`  includeUncommitted: ${spec.includeUncommitted ? 'true # copied into the sandbox snapshot' : 'false # starts from the last commit'}`] : []),
    ...((spec.extraRepos || []).length ? ['  extraRepos: # read-only copies for context', ...spec.extraRepos.map((p) => `    - { source: "${p}", mode: read-only }`)] : []),
    ...(spec.useAgentsMd !== false || (spec.instructions || '').trim() ? ['  instructions:'] : []),
    ...(spec.useAgentsMd !== false ? ['    - file: AGENTS.md'] : []),
    ...((spec.instructions || '').trim() ? [`    - inline: "${spec.instructions.trim().replace(/"/g, "'").replace(/\s+/g, ' ').slice(0, 60)}${spec.instructions.trim().length > 60 ? '…' : ''}"`] : []),
    ...(files.length ? ['  files: # written into the workspace before the agent starts', ...files.flatMap(fileLines)] : []),
    `  skills: [${skills.join(', ')}]`,
    ...(mcp.length ? [`  mcpServers: [${mcp.join(', ')}] # credentials injected by Guardrails`] : []),
    ...(vars.length ? ['  env:'] : []),
    ...vars.map((x) => (x.secret ? `    # ${x.k} removed: looks like a secret. Add it in Settings → Agents & keys.` : `    ${x.k}: "${x.v.replace(/"/g, "'")}"`)),
  ];
  if (format === 'kit') {
    return [
      '# sbxenv.yaml — Portable OCI Sandbox Kit (compatible with ax & OCI registries)',
      '# Zero secrets in this file: credentials are injected outbound by Guardrails.',
      'schemaVersion: 1',
      `name: ${repo}-kit`,
      'runtime:',
      '  isolation: microvm',
      `  harness: ${a.cli}`,
      `  runner: ${runnerImage()} # default task runner, maintained by AX`,
      ...(m ? [`  model: ${m.id}`] : []),
      `  image: ${img}`,
      `  resources: ${spec.size || 'medium'} # ${{ small: '1 CPU, 2 GB', medium: '2 CPU, 4 GB', large: '4 CPU, 8 GB' }[spec.size || 'medium']}`,
      'workspace:',
      '  mount: copy-on-write # host folder untouched until you apply or push',
      setupLine,
      ...recipe,
      'network:',
      `  preset: ${preset}`,
      '  allow:',
      ...domains.map((d) => `    - ${d}`),
      'credentials:',
      `  - ref: ${cred}`,
      '    mode: proxy-inject # never mounted into sandbox env or filesystem',
    ].join('\n');
  }
  return [
    '# ax.yaml — Portable Agent Substrate manifest (CNCF-aligned)',
    '# Runs unchanged on this computer or on your own Kubernetes / GKE cluster.',
    'apiVersion: agents.x-k8s.io/v1alpha1',
    'kind: Workspace',
    'metadata:',
    `  name: ${slug(repo)}`,
    'spec:',
    `  source: "${source}"`,
    ...recipe,
    '  isolation: microvm-copy # host files untouched',
    setupLine,
    `  resources: ${spec.size || 'medium'}`,
    '  guardrails:',
    `    preset: ${preset}`,
    `    insideSandbox: ${state.permMode === 'ask' ? 'ask-before-risky-commands' : 'run-without-asking'}`,
    `    allow: [${domains.slice(0, 4).join(', ')}${domains.length > 4 ? ', …' : ''}]`,
    `    credentials: [${cred}] # injected at egress, 0 raw secrets in sandbox`,
    '---',
    'apiVersion: ax.studio/v1alpha1',
    'kind: Task',
    'spec:',
    `  workspaceRef: ${slug(repo)}`,
    `  harness: ${a.cli}${a.custom ? '' : ' # one-line swap: antigravity, claude-code or codex'}`,
    ...(m ? [`  model: ${m.id}`] : []),
    `  image: ${img}${imgNote}`,
    `  runner: ${runnerImage()} # default task runner, maintained by AX`,
    `  target: ${spec.env === 'cluster' ? (spec.cluster || 'ax-dev-us-central') : 'local'}`,
    `  budget: { checkInUSD: ${budget} }`,
    `  goal: "${goal.length > 72 ? goal.slice(0, 69) + '…' : goal}"`,
  ].join('\n');
}

/* Persisted preferences */
(function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem('ax.prefs') || '{}');
    if (typeof p.showInfra === 'boolean') state.showInfra = p.showInfra;
    if (typeof p.pinImages === 'boolean') state.pinImages = p.pinImages;
    if (p.guardrailPreset && GUARDRAIL_PRESETS[p.guardrailPreset]) state.guardrailPreset = p.guardrailPreset;
    if (p.permMode === 'auto' || p.permMode === 'ask') state.permMode = p.permMode;
    if (typeof p.singleKeys === 'boolean') state.singleKeys = p.singleKeys;
    if (typeof p.reduceMotion === 'boolean') state.reduceMotion = p.reduceMotion;
    if (p.notify) state.notify = Object.assign(state.notify, p.notify);
    if (p.privacy && typeof p.privacy.retention === 'string') state.privacy.retention = p.privacy.retention;
    if (p.skills) state.skills = Object.assign(state.skills, p.skills);
    const mode = localStorage.getItem('ax.env');
    if (mode === 'local' || mode === 'cluster' || mode === 'none') state.env.mode = mode;
    const reg = localStorage.getItem('ax.registry'); if (reg) state.teamRegistry = reg;
  } catch (e) { /* ignore */ }
})();
/* Agents you added (CUJ 2) stay in your library across visits; ?reset clears them with the rest of AX's saved state. */
(function loadCustomAgents() {
  try {
    const list = JSON.parse(localStorage.getItem('ax.agents') || '[]');
    if (!Array.isArray(list)) return;
    list.forEach((d) => {
      if (!d || !d.id || AGENTS[d.id] && !AGENTS[d.id].custom) return;
      const cat = AGENT_CATALOG.find((c) => c.id === d.id);
      const def = Object.assign({}, cat || {}, d, { glyph: (cat && cat.glyph) || AGENT_GLYPHS.custom });
      ['name', 'desc', 'publisher', 'cli', 'version', 'image', 'framework'].forEach((k) => { if (def[k] != null) def[k] = cleanText(def[k], k === 'desc' ? 140 : 80); });
      /* A folder template saved as ./name before v27 is run by its name now, so its commands work from any folder. */
      if (def.source === 'yours' && /^\.\//.test(def.cli || '')) def.cli = def.id;
      def.color = /^#[0-9a-f]{3,8}$/i.test(def.color || '') ? def.color : '#0E7490';
      def.reach = (Array.isArray(def.reach) ? def.reach : []).map((x) => cleanText(x, 80)).filter(Boolean);
      def.tools = (Array.isArray(def.tools) ? def.tools : []).map((x) => cleanText(x, 60)).filter(Boolean);
      if (def.modelApi) def.modelApi = cleanText(def.modelApi, 80);
      addAgent(def);
    });
  } catch (e) { /* ignore */ }
})();
function savePrefs() {
  try {
    localStorage.setItem('ax.prefs', JSON.stringify({
      showInfra: state.showInfra,
      pinImages: state.pinImages,
      guardrailPreset: state.guardrailPreset,
      permMode: state.permMode,
      singleKeys: state.singleKeys,
      reduceMotion: !!state.reduceMotion,
      notify: state.notify,
      privacy: state.privacy,
      skills: state.skills,
    }));
  } catch (e) { /* ignore */ }
}
/* CUJ 2 review mode (…?cuj=2): a true first run, right where CUJ 1 ends. Setup is done, nothing has run yet, no
   template is signed in, and the templates you didn't pick first are still downloading. ?reset goes back to the demo. */
(function applyFirstRun() {
  let on = false;
  try { on = localStorage.getItem('ax.firstrun') === '1'; } catch (e) { /* ignore */ }
  if (!on) return;
  state.firstRun = true;
  state.tasks = [];
  state.blockedLog = [];
  state.nextId = 1;
  state.allow = state.allow.filter((a) => /preset/.test(a.by));
  /* Keep where setup left you (this computer, a remote cluster, or skipped); the CUJ 2 link stores "local". */
  let mode = null;
  try { mode = localStorage.getItem('ax.env'); } catch (e) { /* ignore */ }
  if (!['local', 'cluster', 'none'].includes(mode)) state.env.mode = 'local';
  /* A remote cluster is connected only if you chose one (setup, New task or Where agents run). */
  let cl = null;
  try { cl = localStorage.getItem('ax.cluster'); } catch (e) { /* ignore */ }
  state.env.clusterConnected = !!cl || state.env.mode === 'cluster';
  if (cl) state.env.cluster = cl;
  state.github.connected = false;
  Object.values(AGENTS).forEach((a) => { if (!a.custom) { a.connected = false; delete a.keyProblem; delete a.keyHint; } });
})();
/* Saved workspace setups survive a reload (sign-ins and tasks don't; this is a prototype). */
(function loadSavedSetups() {
  try {
    const list = JSON.parse(localStorage.getItem('ax.setups') || '[]');
    if (Array.isArray(list)) state.savedSetups = list.filter((x) => x && x.name).slice(0, 6).map((x) => Object.assign({}, x, { name: cleanText(x.name, 40) }));
  } catch (e) { /* ignore */ }
})();
function saveSetups() { try { localStorage.setItem('ax.setups', JSON.stringify(state.savedSetups)); } catch (e) { /* ignore */ } }

/* ---------- Template downloads ----------
   Setup downloads the template you picked first; the others keep downloading in the background. Their status follows
   you to New task, and a task you start with one of them waits for its download instead of failing. */
function startDownloads(ids, ms) {
  state.downloads = state.downloads || {};
  ids.forEach((id) => { if (AGENTS[id]) state.downloads[id] = { start: now(), ms: Math.max(1000, ms || 45000) }; });
  /* Downloads keep going across reloads (the image store owns them); they never restart from 0%. */
  saveDownloads();
}
function saveDownloads() { try { localStorage.setItem('ax.downloads', JSON.stringify(state.downloads || {})); } catch (e) { /* ignore */ } }
(function loadDownloads() {
  try {
    const d = JSON.parse(localStorage.getItem('ax.downloads') || 'null');
    if (d && typeof d === 'object') { Object.keys(d).forEach((id) => { if (Date.now() - d[id].start >= d[id].ms) delete d[id]; }); state.downloads = d; }
  } catch (e) { /* ignore */ }
})();
function downloadsSaved() { try { return !!localStorage.getItem('ax.downloads'); } catch (e) { return false; } }
/** Connect a remote cluster as the default for new tasks (setup, New task, Where agents run). */
function connectCluster(name) {
  state.env.cluster = name;
  state.env.clusterConnected = true;
  try { localStorage.setItem('ax.cluster', name); } catch (e) { /* ignore */ }
}
function disconnectCluster() {
  state.env.clusterConnected = false;
  try { localStorage.removeItem('ax.cluster'); } catch (e) { /* ignore */ }
}
/** Review state: which kept files were applied to your folder, and whether that is all of them. */
function appliedPaths(t) { return (t && t.applied && t.applied.paths) || []; }
function keptFiles(t) { const sel = state.diffSel[t.id]; return filesFor(t).filter((f) => !(sel && sel.discarded && sel.discarded[f.path])); }
function appliedAll(t) { const k = keptFiles(t); return k.length > 0 && k.every((f) => appliedPaths(t).includes(f.path)); }
/** Finished work that still waits for you to review it (not shipped, not applied in full, not handed off). */
function awaitingReview(t) { return t.status === 'done' && !t.pushed && !t.notKept && !handedOff(t) && filesFor(t).length > 0 && !appliedAll(t); }
/** The guardrails policy as portable YAML (preset, inside-sandbox mode, allowed and blocked sites). */
function policyYAML() {
  const preset = GUARDRAIL_PRESETS[state.guardrailPreset] || GUARDRAIL_PRESETS.balanced;
  const rows = state.allow.map((a) => `    - domain: ${a.domain}\n      scope: ${a.scope}\n      addedBy: ${JSON.stringify(a.by || 'you')}`).join('\n');
  const blocked = (state.orgBlocked || []).map((b) => `    - ${typeof b === 'string' ? b : b.domain}`).join('\n');
  return [
    '# guardrails.yaml · AX Guardrails policy (no secrets: keys are added outside the sandbox)',
    'apiVersion: ax.dev/v1alpha1',
    'kind: GuardrailsPolicy',
    'metadata:',
    `  name: ${state.user.handle}-local`,
    'spec:',
    `  preset: ${preset.cli}   # ${preset.name}`,
    `  insideSandbox: ${state.permMode === 'ask' ? 'ask-before-risky' : 'run-without-asking'}`,
    '  unknownSites: ask',
    '  allow:',
    rows || '    []',
    '  orgBlocked:',
    blocked || '    []',
  ].join('\n');
}
function isDownloading(id) { const d = state.downloads && state.downloads[id]; return !!d && now() - d.start < d.ms; }
function dlPct(id) {
  const d = state.downloads && state.downloads[id];
  if (!d) return 100;
  return Math.max(1, Math.min(99, Math.floor(((now() - d.start) / d.ms) * 100)));
}
function dlSecsLeft(id) { const d = state.downloads && state.downloads[id]; return d ? Math.max(1, Math.ceil((d.ms - (now() - d.start)) / 1000)) : 0; }
/** "Downloading · 62%", kept live by the 1-second download ticker (data-dl). */
function dlLabel(id) { return `Downloading · <span data-dl="${id}">${dlPct(id)}%</span>`; }
function setEnvMode(mode) {
  state.env.mode = mode;
  try { localStorage.setItem('ax.env', mode); } catch (e) { /* ignore */ }
}

/* ---------- Stable event IDs ----------
   Decisions address an event by its id, never by its position, so a server stream that trims, reorders or replays
   events can't resolve the wrong one. Ids are assigned on first use (seed data, pushEvent, events built inline). */
let evSeq = 0;
function evId(e) { if (!e.id) e.id = 'e' + (++evSeq).toString(36); return e.id; }
function evIdx(t, el) {
  if (!t) return -1;
  const id = el && el.dataset && el.dataset.eid;
  if (id) { const k = t.events.findIndex((e) => e.id === id); if (k >= 0) return k; }
  return +((el && el.dataset && el.dataset.ev) || -1);
}

/* ---------- Capacity on this computer (queue) ----------
   Sandboxes on this computer share 12 GB of its memory. A new task that doesn't fit waits in line ("Queued") and
   starts on its own when a task finishes or you pause one. Run on a remote cluster is the way out of the line. */
const LOCAL_MEM_GB = 12;
function localMemInUse(except) {
  return state.tasks.filter((x) => x !== except && x.env === 'local').reduce((n, x) => n + (resourceFor(x).on ? (SIZES[x.size] || SIZES.medium).mem : 0), 0);
}
function localFull(t) { return localMemInUse(t) + (SIZES[t.size] || SIZES.medium).mem > LOCAL_MEM_GB; }
function queuedAhead(t) { return state.tasks.filter((x) => x.queued && x !== t && x.queued < t.queued).length; }

/* ---------- Connection to AX (the local daemon or the cluster) ---------- */
state.conn = { lost: false, since: 0, attempts: 0 };
