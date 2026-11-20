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

/* AX Studio: the app shell. Actions, dropdowns, keyboard, focus, routing and start-up. Pages are in live*.js. */
'use strict';

/** After part of the task page is redrawn, put the existing Axel back (moved to his new mood) so he doesn't restart. */
function keepAxel(oldAx, scope) {
  if (!oldAx || !oldAx.innerHTML || !scope || !scope.querySelector) return;
  const nu = scope.querySelector('svg.axo');
  if (!nu || nu === oldAx || !nu.parentNode) return;
  const mood = nu.dataset ? nu.dataset.axo : null;
  nu.replaceWith(oldAx);
  if (mood && typeof updateAxoInPlace === 'function') updateAxoInPlace(oldAx, mood);
}
function isTypingIn(sel) {
  const a = document.activeElement;
  return a && a.closest(sel) && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') && a.value;
}
/* ---------- Dropdown selects (selectHTML in core.js) ----------
   They work like a regular select. Focus stays on the box; the highlighted option is aria-activedescendant. The open
   list is kept in state.openSelect, so a background redraw (a task changing status) re-draws it open, in place. */
const SELECT_PICK = {
  /* Guardrails: which workspace a new site applies to. Keeps what you typed across the redraw. */
};
const selParts = (key) => { const btn = document.getElementById('sel-' + key); return btn ? { btn, list: document.getElementById('sel-' + key + '-list'), wrap: btn.closest('.sel') } : null; };
const selOpts = (list) => (list ? [...list.querySelectorAll('[role="option"]')] : []);
function openSelect(key, active) {
  if (state.openSelect && state.openSelect.key !== key) closeSelect();
  const p = selParts(key);
  if (!p || !p.list) return;
  const opts = selOpts(p.list);
  const cur = opts.find((o) => o.getAttribute('aria-selected') === 'true') || opts[0];
  state.openSelect = { key, active: active || (cur && cur.dataset.value) };
  p.list.hidden = false;
  p.btn.setAttribute('aria-expanded', 'true');
  if (p.wrap) p.wrap.classList.add('open', 'anim');
  setSelActive(key, state.openSelect.active);
}
function closeSelect() {
  const s = state.openSelect;
  if (!s) return;
  state.openSelect = null;
  const p = selParts(s.key);
  if (!p) return;
  if (p.list) p.list.hidden = true;
  p.btn.setAttribute('aria-expanded', 'false');
  p.btn.removeAttribute('aria-activedescendant');
  if (p.wrap) p.wrap.classList.remove('open', 'anim');
}
function setSelActive(key, value) {
  const p = selParts(key);
  if (!p || !p.list || !state.openSelect || state.openSelect.key !== key) return;
  state.openSelect.active = value;
  let el = null;
  selOpts(p.list).forEach((o) => { const on = o.dataset.value === value; o.classList.toggle('is-active', on); if (on) el = o; });
  if (!el) return;
  p.btn.setAttribute('aria-activedescendant', el.id);
  /* Keep the highlighted option in view inside the list, without scrolling the page. */
  const L = p.list;
  if (el.offsetTop < L.scrollTop) L.scrollTop = el.offsetTop - 6;
  else if (el.offsetTop + el.offsetHeight > L.scrollTop + L.clientHeight) L.scrollTop = el.offsetTop + el.offsetHeight - L.clientHeight + 6;
}
/** Pick an option: close the list, apply the choice (if it changed) and keep focus on the box. */
function pickSelect(key, value, keepFocus) {
  const p = selParts(key);
  const same = !!(p && p.list && selOpts(p.list).some((o) => o.dataset.value === value && o.getAttribute('aria-selected') === 'true'));
  closeSelect();
  /* A pick that opens another page (Your own agent… on Home) leaves the redraw to that page load. */
  if (!same && SELECT_PICK[key]) { const h = location.hash; SELECT_PICK[key](value); if (location.hash === h) render({ keepScroll: true }); }
  if (keepFocus !== false) { const b = document.getElementById('sel-' + key); if (b && b !== document.activeElement) b.focus(); }
}
let selTyped = '', selTypedAt = 0;
/** Keyboard for a focused dropdown (APG select-only combobox). Returns true when it handled the key. */
function selKeydown(e, btn) {
  const key = btn.dataset.key;
  const p = selParts(key);
  if (!p || !p.list) return false;
  const opts = selOpts(p.list);
  const vals = opts.map((o) => o.dataset.value);
  if (!vals.length) return false;
  const open = !!(state.openSelect && state.openSelect.key === key);
  const selected = (opts.find((o) => o.getAttribute('aria-selected') === 'true') || opts[0]).dataset.value;
  const cur = open ? state.openSelect.active : selected;
  const k = Math.max(0, vals.indexOf(cur));
  const move = (i) => setSelActive(key, vals[Math.max(0, Math.min(vals.length - 1, i))]);
  /* Typing a name opens the list and jumps to the first match; typing the same letter again cycles through matches. */
  if (e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    if (!open) openSelect(key);
    const t = Date.now();
    selTyped = (t - selTypedAt < 700 ? selTyped : '') + e.key.toLowerCase();
    selTypedAt = t;
    const names = opts.map((o) => (o.querySelector('.sel-txt b') || o).textContent.trim().toLowerCase());
    const same = selTyped.split('').every((c) => c === selTyped[0]);
    const q = same ? selTyped[0] : selTyped;
    const from = same ? k + 1 : k;
    for (let i = 0; i < vals.length; i++) { const j = (from + i) % vals.length; if (names[j].startsWith(q)) { move(j); break; } }
    return true;
  }
  if (!open) {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); openSelect(key); return true; }
    if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); openSelect(key, e.key === 'Home' ? vals[0] : vals[vals.length - 1]); return true; }
    return false;
  }
  switch (e.key) {
    case 'ArrowDown': e.preventDefault(); if (!e.altKey) move(k + 1); return true;
    case 'ArrowUp': e.preventDefault(); if (e.altKey) pickSelect(key, cur); else move(k - 1); return true;
    case 'Home': e.preventDefault(); move(0); return true;
    case 'End': e.preventDefault(); move(vals.length - 1); return true;
    case 'PageDown': e.preventDefault(); move(k + 10); return true;
    case 'PageUp': e.preventDefault(); move(k - 10); return true;
    case 'Enter': case ' ': e.preventDefault(); pickSelect(key, cur); return true;
    case 'Escape': e.preventDefault(); closeSelect(); return true;
    case 'Tab': pickSelect(key, cur, false); return true; /* no preventDefault: focus moves on as usual */
    default: return false;
  }
}

/* ---------- Router ---------- */
function parseRoute() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = h.split('?');
  return { path, parts: path.split('/').filter(Boolean), q: new URLSearchParams(qs || '') };
}
function navigate(h) { if (location.hash === h) render(); else location.hash = h; }
let lastPath = null;
const RENDER_HOLD_MAX = 6000;
let renderHeld = 0, renderHeldSince = 0, renderHeldOpts = null;
/** Called by Axel between two tricks: if a held refresh is overdue, run it now, before the next trick starts. */
function axoOnTrickEnd() {
  if (renderHeld && Date.now() - renderHeldSince >= RENDER_HOLD_MAX) render(Object.assign({}, renderHeldOpts, { background: false }));
}
/* A stable description of the focused control that survives a re-render: its id, its slot in a radio group or
   tab list (groups are matched by aria-label, aria-labelledby or id), or its data-action + data-* attributes. */
function focusKeyOf(el) {
  if (!el || el === document.body || el === document.documentElement || !document.contains(el)) return null;
  if (el.id) return { id: el.id };
  const g = el.closest('[role="radiogroup"], [role="tablist"]');
  if (g) {
    const attr = ['aria-label', 'aria-labelledby', 'id'].find((a) => g.getAttribute(a));
    if (attr) { const role = g.getAttribute('role') === 'tablist' ? 'tab' : 'radio'; return { group: [attr, g.getAttribute(attr)], role, index: [...g.querySelectorAll(`[role="${role}"]`)].indexOf(el) }; }
  }
  if (el.dataset && el.dataset.action) return { action: el.dataset.action, data: JSON.stringify(el.dataset) };
  if (el.getAttribute && el.getAttribute('href')) { const sc = el.closest('[id]:not(a)'); return { href: el.getAttribute('href'), scope: sc ? sc.id : null }; }
  if (el.form && el.form.dataset && el.form.dataset.form && el.type === 'submit') return { form: el.form.dataset.form };
  return null;
}
function restoreFocus(k) {
  if (!k) return;
  let el = null;
  if (k.id) el = document.getElementById(k.id);
  else if (k.group) {
    const g = [...document.querySelectorAll('[role="radiogroup"], [role="tablist"]')].find((x) => x.getAttribute(k.group[0]) === k.group[1]);
    if (g) {
      const items = [...g.querySelectorAll(`[role="${k.role}"]`)];
      el = items.find((x) => x.getAttribute(k.role === 'tab' ? 'aria-selected' : 'aria-checked') === 'true') || items[k.index];
    }
  } else if (k.action) el = [...document.querySelectorAll(`[data-action="${k.action}"]`)].find((x) => JSON.stringify(x.dataset) === k.data);
  else if (k.href) { const sc = k.scope && document.getElementById(k.scope); el = [...(sc || document).querySelectorAll('a[href]')].find((x) => x.getAttribute('href') === k.href) || [...document.querySelectorAll('a[href]')].find((x) => x.getAttribute('href') === k.href); }
  else if (k.form) el = document.querySelector(`[data-form="${k.form}"] [type="submit"]`);
  if (el && el !== document.activeElement && !el.disabled) el.focus({ preventScroll: true });
}
/** Inside the Studio app, the page has a bridge to this computer and shows real data from AX (live.js). */
function liveOn() { return typeof LIVE !== 'undefined' && LIVE.on; }
function render(opts) {
  opts = opts || {};
  if (liveOn()) { liveRender(opts); return; }
  /* No Studio server: this folder was opened as plain files. Studio shows real data only, so say how to start it. */
  const root = $('#root');
  if (!root || root.dataset.noServer) return;
  root.dataset.noServer = '1';
  state.docTitle = 'Start AX Studio · AX Studio';
  document.title = state.docTitle;
  root.innerHTML = `<main class="no-server" id="main"><div class="card no-server-card">
    <h1 tabindex="-1">Start AX Studio to use it</h1>
    <p class="muted">This page needs the Studio server, which talks to AX on this computer. Run it from the repo root, then open the address it prints.</p>
    ${cliHint('make build && ./bin/ax-studio')}
    <p class="small muted">To work on the UI, add <span class="mono">--ux-dir ux</span> so a reload shows your edits.</p>
  </div></main>`;
}
function renderCrumbs(crumbs) {
  const c = $('#crumbs');
  if (!c) return;
  c.innerHTML = crumbs.map((x, k) => (k ? icon('chevRight', 'xs') : '') + (x.href ? `<a href="${x.href}">${esc(x.label)}</a>` : `<span class="here" aria-current="page">${esc(x.label)}</span>`)).join('');
}

/* ---------- Event delegation ---------- */
function centerOf(el, e) {
  if (e && e.clientX) return { x: e.clientX, y: e.clientY };
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
const POKES = [
  'Welcome to my spring — clear water so you see every step, stone banks so nothing leaks.',
  'My six rose gills filter water; Guardrails filters traffic and keeps raw keys outside.',
  'Axolotls regenerate cleanly without scars — retry or race 2 agents without touching your repo.',
  'Spring to mountain lake, unchanged: your YAML runs identically on team Kubernetes.',
  'Psst: press ⌘K for ax doctor, portable YAML, or keyboard shortcuts.',
];
let pokeIdx = 0;
const ACTIONS = {
  palette: () => openPalette(),
  'close-dialog': () => closeDialog(),
  shortcuts: () => openShortcuts(),
  story: () => openStory(),
  'theme-toggle': (el, e) => setTheme(resolvedTheme() === 'dark' ? 'light' : 'dark', centerOf(el, e)),
  'set-theme': (el, e) => setTheme(el.dataset.theme, centerOf(el, e)),
  copy: (el) => copyText(el.dataset.text, `Copied <span class="mono">${esc(el.dataset.text.length > 48 ? el.dataset.text.slice(0, 45) + '…' : el.dataset.text)}</span>`),
  poke: (el) => {
    /* Clicks 1–2 hop and wag with a line about the spring; keep clicking for Axel's tricks (see axoTap).
       A click during a trick plays when it ends, so its caption is shown then (onPlay). */
    const say = (r) => {
      const text = r.woke ? AXO_WAKE_SAY : r.trick ? r.trick.say : POKES[pokeIdx++ % POKES.length];
      state.axelSpeech = { text, at: Date.now() };
      const sp = $('.stage .speech');
      if (sp) { sp.hidden = false; sp.classList.remove('still'); sp.innerHTML = text; sp.style.animation = 'none'; void sp.offsetWidth; sp.style.animation = ''; }
    };
    const r = axoTap(el.querySelector('svg.axo'), { hop: true, onPlay: say, find: () => document.querySelector('#hero-axo') });
    if (r && !r.queued) say(r);
  },
  /* Dropdown selects (selectHTML in core.js): click the box to open or close it, click an option to pick it. */
  'sel-toggle': (el) => { if (state.openSelect && state.openSelect.key === el.dataset.key) closeSelect(); else openSelect(el.dataset.key); },
  'sel-pick': (el) => pickSelect(el.dataset.key, el.dataset.value),
  /* The skip link: jump past the sidebar to the page heading. */
  'skip-to-main': () => { const m = $('#main h1') || $('#main'); if (m) { if (!m.hasAttribute('tabindex')) m.setAttribute('tabindex', '-1'); m.focus(); } },
  /* Settings switches (Accessibility). */
  'toggle-pref': (el) => {
    const p = el.dataset.pref;
    if (p === 'reduceMotion') { state.reduceMotion = el.checked; document.body.classList.toggle('reduce-motion', el.checked); }
    else if (p === 'singleKeys') state.singleKeys = el.checked;
    else return;
    savePrefs();
    toast('Saved', { icon: 'check', timeout: 1800 });
  },
};

document.addEventListener('click', (e) => {
  /* Doing anything other than playing with Axel lets held-back refreshes render right away. */
  if (!e.target.closest('svg.axo, [data-action="poke"]')) axoYield();
  if (state.openSelect && !e.target.closest(`[data-sel="${state.openSelect.key}"]`)) closeSelect();
  const el = e.target.closest('[data-action]');
  if (!el) return;
  if (el.getAttribute('aria-disabled') === 'true') return;
  const fn = ACTIONS[el.dataset.action];
  if (fn) fn(el, e);
});
/* Dropdown lists: moving the mouse over an option highlights it (as in a regular select), pressing on the list never
   takes focus off the box, and focus leaving the box closes the list (checked after a redraw has put focus back).
   Only real mouse movement counts: a list opening under a resting pointer must not undo the arrow keys. */
let selPointer = '';
document.addEventListener('mousemove', (e) => {
  const at = e.clientX + ',' + e.clientY;
  if (at === selPointer) return;
  selPointer = at;
  const s = state.openSelect;
  const o = s && e.target.closest && e.target.closest('.sel-opt');
  if (o && o.dataset.key === s.key && o.dataset.value !== s.active) setSelActive(s.key, o.dataset.value);
});
document.addEventListener('mousedown', (e) => { if (e.target.closest && e.target.closest('.sel-list')) e.preventDefault(); });
document.addEventListener('focusout', (e) => {
  if (!state.openSelect || !e.target.classList || !e.target.classList.contains('sel-btn')) return;
  setTimeout(() => { const a = document.activeElement; if (state.openSelect && !(a && a.closest && a.closest('.sel'))) closeSelect(); }, 0);
});

/* ---------- Keyboard ---------- */
let gPending = false;
document.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  trapFocus(e);
  /* The command palette works with real data too: live.js gives it the real tasks, clusters and actions. */
  if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); if (dialogState) closeDialog(); else openPalette(); return; }
  /* A focused dropdown handles its own keys first (arrows, Enter, Space, Escape, Tab, typing a name). */
  const selBtn = e.target && e.target.closest && e.target.closest('.sel-btn');
  if (selBtn && selKeydown(e, selBtn)) return;
  if (e.key === 'Escape') {
    if (dialogState) { e.preventDefault(); closeDialog(); return; }
  }
  const tgt = e.target;
  const typing = tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable);
  if (typing) return;
  /* ARIA tabs and radio groups: arrow keys move between options (selection follows focus), Home/End jump. */
  const role = tgt && tgt.getAttribute ? tgt.getAttribute('role') : null;
  if ((role === 'radio' || role === 'tab') && ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(e.key) && !mod) {
    const groupRole = role === 'tab' ? 'tablist' : 'radiogroup';
    const group = tgt.closest(`[role="${groupRole}"]`);
    const enabled = (x) => x.getAttribute('aria-disabled') !== 'true' && !x.disabled;
    const items = group ? [...group.querySelectorAll(`[role="${role}"]`)].filter(enabled) : [];
    const k = items.indexOf(tgt);
    if (k >= 0 && items.length > 1) {
      e.preventDefault();
      const fwd = e.key === 'ArrowRight' || e.key === 'ArrowDown';
      const n = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (k + (fwd ? 1 : -1) + items.length) % items.length;
      const fk = focusKeyOf(items[n]);
      items[n].focus();
      items[n].click();
      /* Most choices re-render the view; render() restores focus, this covers choices that re-render later. */
      if (!document.contains(items[n])) restoreFocus(fk);
    }
    return;
  }
  if (dialogState || mod || e.altKey) return;
  /* WCAG 2.1.4: single-key shortcuts can be turned off under Accessibility in Settings. */
  if (!state.singleKeys) return;
  if (gPending) {
    gPending = false;
    const map = { h: '#/', t: '#/tasks', s: '#/settings', p: '#/places', n: '#/new' };
    if (map[e.key]) { e.preventDefault(); navigate(map[e.key]); }
    return;
  }
  if (e.key === 'g') { gPending = true; setTimeout(() => { gPending = false; }, 1200); return; }
  /* A New task you started stays as you left it. */
  if (e.key === 'n') { e.preventDefault(); navigate('#/new'); }
  else if (e.key === '?') { e.preventDefault(); openShortcuts(); }
  else if (e.key === '/') { e.preventDefault(); openPalette(); }
  else if (e.key === 't') { setTheme(resolvedTheme() === 'dark' ? 'light' : 'dark'); }
});

/* ---------- Roving tabindex: one tab stop per tab list or radio group (the selected option) ---------- */
function applyRoving(root) {
  (root || document).querySelectorAll('[role="tablist"], [role="radiogroup"]').forEach((g) => {
    const role = g.getAttribute('role') === 'tablist' ? 'tab' : 'radio';
    const items = [...g.querySelectorAll(`[role="${role}"]`)];
    if (!items.length) return;
    const enabled = items.filter((x) => x.getAttribute('aria-disabled') !== 'true' && !x.disabled);
    const sel = enabled.find((x) => x.getAttribute(role === 'tab' ? 'aria-selected' : 'aria-checked') === 'true') || enabled[0];
    items.forEach((x) => x.setAttribute('tabindex', x === sel ? '0' : '-1'));
  });
}
if (typeof MutationObserver !== 'undefined') {
  let rovingRaf = 0;
  new MutationObserver(() => {
    if (rovingRaf) return;
    rovingRaf = requestAnimationFrame(() => { rovingRaf = 0; applyRoving(); });
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-checked', 'aria-selected'] });
}

/* ---------- Live clock for elapsed / relative times ---------- */
setInterval(() => {
  $$('[data-since]').forEach((el) => {
    const ts = +el.dataset.since;
    el.textContent = el.dataset.fmt === 'elapsed' ? fmtElapsed(ts) : el.dataset.fmt === 'secs' ? `${Math.round((now() - ts) / 1000)} s` : fmtAgo(ts);
  });
}, 1000);

/* ---------- Init ---------- */
document.body.insertAdjacentHTML('afterbegin', AXO_DEFS);
applyTheme();
/* Switching tabs inside one task keeps the page still: same scroll position, no entrance animation,
   and keyboard focus stays on the tab you chose. Every other navigation is a full page change. */
window.addEventListener('hashchange', () => {
  const r = parseRoute();
  /* Compare with the route on screen (go(), navigate() and redirects all render through render()). */
  const p = state.route;
  const sameTask = p && p.parts[0] === 'task' && r.parts[0] === 'task' && p.parts[1] === r.parts[1];
  if (sameTask) {
    /* Switching task tabs swaps only the panel: no scroll jump, no entrance animation, focus stays on the tab. */
    lastPath = r.path;
    render({ keepScroll: true });
    return;
  }
  if (p && p.parts[0] === 'settings' && r.parts[0] === 'settings') {
    /* Switching Settings sections replaces only the section: the heading and the nav stay still (no entrance
       animation), the new section starts at the top, and focus moves to its heading (viewSettings' after()). */
    lastPath = r.path;
    state.settingsFocus = true;
    render({ keepScroll: true });
    window.scrollTo(0, 0);
    return;
  }
  render();
});
render();

/* ---------- Never drop focus (WCAG 2.4.3) ----------
   When a redraw removes the focused control (a dialog step, a live table, a background refresh), focus moves to the same
   control in the new markup, else to the dialog's next sensible control, else to the page heading. It never falls back
   to the page body, which would send keyboard and screen reader users to the top with nothing announced. */
let lastFocusInfo = null;
document.addEventListener('focusin', (e) => {
  if (e.target && e.target !== document.body) lastFocusInfo = { el: e.target, key: focusKeyOf(e.target), inDialog: !!(e.target.closest && e.target.closest('#overlay')) };
});
let focusRaf = 0;
function recoverFocus() {
  const a = document.activeElement;
  if (a && a !== document.body && a !== document.documentElement) return;
  const L = lastFocusInfo;
  if (!L || document.contains(L.el)) return;
  if (L.key) { restoreFocus(L.key); if (document.activeElement && document.activeElement !== document.body) return; }
  const dlg = dialogState && dialogState.el;
  if (dlg && document.contains(dlg)) {
    const t = dlg.querySelector('[data-autofocus]:not([disabled]), #pm-next:not([disabled]), .dialog-foot .btn.primary:not([disabled]), .dialog-body input:not([type="checkbox"]), .dialog-body button:not([disabled])') || dlg;
    t.focus({ preventScroll: true });
    return;
  }
  if (L.inDialog) return;
  const h = $('#main h1');
  if (h) { if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
}
if (typeof MutationObserver === 'function') new MutationObserver(() => { if (focusRaf) return; focusRaf = requestAnimationFrame(() => { focusRaf = 0; recoverFocus(); }); }).observe(document.body, { childList: true, subtree: true });
if (document.body && document.body.classList) document.body.classList.toggle('reduce-motion', !!state.reduceMotion);
