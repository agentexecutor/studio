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

/* AX Studio: shared helpers, icons, Axel's story, and the small UI pieces the pages use. */
'use strict';

/* ---------- Helpers ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const now = () => Date.now();
const reducedMotion = () => (typeof state !== 'undefined' && state.reduceMotion) || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 28) || 'task';
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

/* Agent tiles: a small mark for a task's image (live.js), Antigravity and Claude Code by their own glyph and colour,
   anything else as a plain box. */
const AGENT_TILES = {
  antigravity: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19 12 5l7 14" stroke="currentColor" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.5 14.5c2.2-1.2 4.8-1.2 7 0" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round"/></svg>',
  claude: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
};
const AGENT_GLYPHS = { custom: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2 19.5 7.4v9.2L12 20.8 4.5 16.6V7.4Z" stroke="currentColor" stroke-width="2.3" fill="none" stroke-linejoin="round"/><path d="M4.8 7.6 12 11.7l7.2-4.1M12 11.7v8.8" stroke="currentColor" stroke-width="2.1" fill="none" stroke-linejoin="round"/></svg>' };
function agentTile(id, size) {
  const glyph = AGENT_TILES[id];
  return glyph ? `<span class="agent-tile ${id} ${size || ''}" aria-hidden="true">${glyph}</span>` : byoTile(size);
}
function cliHint(cmd) {
  return `<div class="cli"><span class="prompt">$</span><code>${esc(cmd)}</code><button class="btn ghost sm icon" data-action="copy" data-text="${esc(cmd)}" aria-label="Copy command">${icon('copy', 'sm')}</button></div>`;
}

/* What the page keeps between renders. The data itself comes from AX (LIVE, in live.js). */
const state = {
  route: null,
  openSelect: null,      // the dropdown that is open: { key, active }
  singleKeys: true,      // single-key shortcuts (Settings, Accessibility)
  reduceMotion: false,
  docTitle: '',
  settingsFocus: false,
};

/* Persisted preferences */
(function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem('ax.prefs') || '{}');
    if (typeof p.singleKeys === 'boolean') state.singleKeys = p.singleKeys;
    if (typeof p.reduceMotion === 'boolean') state.reduceMotion = p.reduceMotion;
  } catch (e) { /* ignore */ }
})();
function savePrefs() {
  try { localStorage.setItem('ax.prefs', JSON.stringify({ singleKeys: state.singleKeys, reduceMotion: !!state.reduceMotion })); } catch (e) { /* ignore */ }
}

/* ---------- Connection to AX (the local daemon or the cluster) ---------- */

/* ---------- Shared UI pieces ---------- */
const MOD = /Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘' : 'Ctrl';

function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

/* ---------- Dropdown select (works like a regular select) ----------
   Click it, or press Down, Up, Enter or Space, to open the list. Arrow keys, Home, End or typing a name move through
   it; Enter, Space, Tab or a click picks; Escape or a click outside closes without a change. ARIA select-only combobox:
   focus stays on the box and aria-activedescendant points at the highlighted option. The open list lives in state.openSelect, so a background redraw keeps it
   open. Behaviour: openSelect, pickSelect and selKeydown in app.js. */
function selectHTML({ key, label, value, options, btnClass }) {
  const id = 'sel-' + key;
  const open = !!(state.openSelect && state.openSelect.key === key);
  const cur = options.find((o) => o.value === value) || options[0];
  if (!cur) return '';
  const active = open && options.some((o) => o.value === state.openSelect.active) ? state.openSelect.active : cur.value;
  return `<div class="sel${open ? ' open' : ''}" data-sel="${key}">
    <div class="sel-btn ${btnClass || ''}" id="${id}" role="combobox" tabindex="0" aria-label="${esc(label)}" aria-haspopup="listbox" aria-controls="${id}-list" aria-expanded="${open}"${open ? ` aria-activedescendant="${id}-${active}"` : ''} data-action="sel-toggle" data-key="${key}">${cur.lead || ''}<span class="sel-val">${esc(cur.name)}</span>${icon('chevDown', 'xs')}</div>
    <ul class="sel-list" id="${id}-list" role="listbox" aria-label="${esc(label)}"${open ? '' : ' hidden'}>${options.map((o) => `
      <li class="sel-opt${o.value === active ? ' is-active' : ''}" role="option" id="${id}-${o.value}" aria-selected="${o.value === cur.value}" data-action="sel-pick" data-key="${key}" data-value="${o.value}">${o.lead || ''}<span class="sel-txt"><b>${esc(o.name)}</b>${o.sub ? `<small>${o.sub}</small>` : ''}</span>${icon('check', 'sm')}</li>`).join('')}
    </ul>
  </div>`;
}
/* The tile for an image that isn't a known agent. */
function byoTile(size) { return `<span class="agent-tile byo ${size || ''}" aria-hidden="true">${AGENT_GLYPHS.custom}</span>`; }

/** One labelled row in a panel (style guide §18): a label (and a short line about it), its content, an optional action. */
function prow(label, body, o) {
  o = o || {};
  return `<div class="prow${o.act ? ' has-act' : ''}${o.cls ? ' ' + o.cls : ''}"${o.id ? ` id="${o.id}"` : ''}>
    <div class="prow-k"${o.labelId ? ` id="${o.labelId}"` : ''}>${label}${o.sub ? `<span class="prow-sub"${o.subId ? ` id="${o.subId}"` : ''}>${o.sub}</span>` : ''}</div>
    <div class="prow-v">${body}</div>${o.act ? `<div class="prow-act">${o.act}</div>` : ''}
  </div>`;
}

function setupStonesHTML(s, steps, failAt) {
  const cur = steps[Math.min(s.step, steps.length - 1)];
  const sp = typeof s.progress === 'number' ? s.progress : Math.min(1, s.step / Math.max(1, steps.length - 1));
  return `<div class="stones ${failAt != null ? 'has-fail' : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="4" aria-valuenow="${s.step}" aria-valuetext="Step ${Math.min(s.step + 1, 4)} of 4: ${esc(cur.title)}" style="--sp:${sp}">
    <span class="fillbar"></span>
    ${steps.map((st, k) => `<div class="stone ${k < s.step ? 'ok' : k === failAt ? 'fail' : k === s.step ? 'now' : ''}"><span class="sb">${icon(k < s.step ? 'check' : k === failAt ? 'alert' : k === s.step ? 'loader' : st.ic)}</span><span class="sl">${esc(st.short)}</span></div>`).join('')}
  </div>`;
}
function setupCheckItem(cls, ic, title, desc) {
  return `<li class="check-item ${cls}"><span class="ci-icon">${icon(ic)}</span><div><div class="ci-title">${title}</div><div class="ci-desc">${desc}</div></div></li>`;
}

/* ---------- Gate map: the sandbox, its Gateway, and the sites it can reach (a task's side panel) ---------- */
function trunc(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function gateMap(allowed, blocked, max) {
  max = max || 4;
  blocked = blocked.filter((b) => !allowed.includes(b.domain));
  const rows = allowed.slice(0, max).map((d) => ({ d, ok: true })).concat(blocked.slice(0, 2).map((b) => ({ d: b.domain, ok: false })));
  const extra = Math.max(0, allowed.length - max);
  const rowH = 26, W = 312;
  const H = Math.max(122, rows.length * rowH + 24 + (extra ? 16 : 0));
  const cy = (H - (extra ? 16 : 0)) / 2;
  const gx = 92, bx = 146;
  const y0 = rows.length ? cy - ((rows.length - 1) * rowH) / 2 : cy;
  const parts = rows.map((r, k) => {
    const y = y0 + k * rowH;
    const p = `M${gx + 13} ${cy.toFixed(1)} C${gx + 34} ${cy.toFixed(1)} ${gx + 28} ${y.toFixed(1)} ${bx - 8} ${y.toFixed(1)}`;
    return r.ok
      ? `<g><path d="${p}" class="gm-link"/><circle r="2.3" class="rm-packet"><animateMotion dur="${(1.9 + k * 0.4).toFixed(1)}s" repeatCount="indefinite" path="M48 ${cy.toFixed(1)} L${gx - 13} ${cy.toFixed(1)} ${p.replace('M', 'L')}"/></circle>
        <circle cx="${bx}" cy="${y.toFixed(1)}" r="6.5" class="gm-bead ok"/><path d="M${bx - 3.2} ${y.toFixed(1)} l2.1 2.2 l4.1 -4.3" class="gm-mark ok"/><text x="${bx + 12}" y="${(y + 4).toFixed(1)}" class="gm-text">${esc(trunc(r.d, 20))}</text></g>`
      : `<g><path d="${p}" class="gm-link no"/><circle cx="${bx}" cy="${y.toFixed(1)}" r="6.5" class="gm-bead no"/><path d="M${bx - 2.6} ${(y - 2.6).toFixed(1)} l5.2 5.2 M${bx + 2.6} ${(y - 2.6).toFixed(1)} l-5.2 5.2" class="gm-mark no"/><text x="${bx + 12}" y="${(y + 4).toFixed(1)}" class="gm-text no">${esc(trunc(r.d, 20))}</text></g>`;
  }).join('');
  return `<svg class="gate-map" viewBox="0 0 ${W} ${H}" role="img" aria-label="Traffic from the isolated sandbox passes through Guardrails. ${allowed.length} sites allowed${blocked.length ? `, ${blocked.length} blocked` : ''}.">
    <line x1="48" y1="${cy.toFixed(1)}" x2="${gx - 12}" y2="${cy.toFixed(1)}" class="gm-link"/>
    ${parts}
    <circle cx="26" cy="${cy.toFixed(1)}" r="21" class="gm-core"/>
    <circle cx="26" cy="${cy.toFixed(1)}" r="15" class="gm-inner-ring"/>
    <path d="M26 ${(cy - 8.5).toFixed(1)} C21 ${(cy - 2).toFixed(1)} 19.5 ${(cy + 1).toFixed(1)} 19.5 ${(cy + 4).toFixed(1)} a6.5 6.5 0 0 0 13 0 c0 -3 -1.5 -6 -6.5 -12.5 z" class="gm-drop"/>
    <text x="26" y="${(cy + 34).toFixed(1)}" text-anchor="middle" class="gm-cap">Sandbox</text>
    <path d="M${gx - 11} ${(cy - 13).toFixed(1)} h22 v10.5 c0 10 -11 15.5 -11 15.5 c0 0 -11 -5.5 -11 -15.5 z" class="gm-shield"/>
    <path d="M${gx - 4.5} ${(cy - 1).toFixed(1)} l3.4 3.4 l6 -6.6" class="gm-shield-mark"/>
    <text x="${gx}" y="${(cy + 27).toFixed(1)}" text-anchor="middle" class="gm-cap">Guardrails</text>
    ${extra ? `<text x="${bx + 12}" y="${(H - 6).toFixed(1)}" class="gm-more">+${extra} more allowed</text>` : ''}
  </svg>`;
}
