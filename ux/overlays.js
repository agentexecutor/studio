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

/* AX Studio: theme, toasts, dialogs, the command palette, shortcuts and Axel's story. */
'use strict';

/* ---------- Theme ---------- */
function themePref() { try { return localStorage.getItem('ax.theme') || 'system'; } catch (e) { return 'system'; } }
function resolvedTheme(pref) {
  pref = pref || themePref();
  return pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
}
function applyTheme() {
  document.documentElement.setAttribute('data-theme', resolvedTheme());
  updateThemeToggle();
}
function updateThemeToggle() {
  const b = $('#theme-toggle');
  if (!b) return;
  const dark = resolvedTheme() === 'dark';
  b.innerHTML = icon(dark ? 'sun' : 'moon');
  b.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
  b.title = (dark ? 'Light theme' : 'Dark theme') + ' (T)';
}
function setTheme(pref, origin) {
  const before = resolvedTheme();
  try { localStorage.setItem('ax.theme', pref); } catch (e) { /* ignore */ }
  const after = resolvedTheme(pref);
  const swap = () => { applyTheme(); if (state.route && state.route.parts[0] === 'settings') render({ keepScroll: true }); };
  if (before === after || !document.startViewTransition || reducedMotion()) { swap(); return; }
  const x = origin ? origin.x : window.innerWidth - 80;
  const y = origin ? origin.y : 28;
  const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  const vt = document.startViewTransition(swap);
  /* A click during the ~0.5 s reveal lands on the transition snapshot (the root element) and would be lost.
     Finish the reveal at once and hand the click to whatever is under the pointer, so the reveal never swallows a click. */
  const onDown = (e) => {
    if (e.button !== 0) return;
    try { vt.skipTransition(); } catch (err) { /* ignore */ }
    if (e.target !== document.documentElement) return;
    const x = e.clientX, y = e.clientY;
    const onClick = (ce) => {
      document.removeEventListener('click', onClick, true);
      if (ce.target !== document.documentElement) return;
      const el = document.elementFromPoint(x, y);
      const t = el && el.closest('a[href], button, [role="radio"], [role="tab"], [role="switch"], summary, label, input, select, textarea, [data-action]');
      if (!t) return;
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) && t.type !== 'checkbox') t.focus(); else t.click();
    };
    document.addEventListener('click', onClick, true);
    setTimeout(() => document.removeEventListener('click', onClick, true), 1500);
  };
  document.addEventListener('pointerdown', onDown, true);
  const done = () => document.removeEventListener('pointerdown', onDown, true);
  vt.finished.then(done, done);
  vt.ready.then(() => {
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
      { duration: 520, easing: 'cubic-bezier(.2,.8,.2,1)', pseudoElement: '::view-transition-new(root)' });
  }).catch(() => {});
}
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (themePref() === 'system') applyTheme(); });

/* ---------- Toasts & announcements (clean icons — never duplicates Axel) ---------- */
const TOAST_ICON_FOR_MOOD = {
  done: 'checkCircle', wave: 'sparkle', working: 'activity', thinking: 'info',
  waiting: 'hand', blocked: 'ban', failed: 'alert', sleeping: 'pause', building: 'loader', idle: 'shieldCheck',
};
/* A toast about another task (it needs you, it failed, it's ready for review) waits while a dialog is open, so it
   never covers the thing you're deciding. It shows when the dialog closes. */
const heldToasts = [];
function flushHeldToasts() {
  if (typeof dialogState !== 'undefined' && dialogState) return;
  heldToasts.splice(0).forEach(([m, o]) => toast(m, Object.assign({}, o, { background: false })));
}
function toast(msg, opts) {
  opts = opts || {};
  if (opts.background && typeof dialogState !== 'undefined' && dialogState) { heldToasts.push([msg, opts]); if (heldToasts.length > 3) heldToasts.shift(); return () => {}; }
  const wrap = $('#toasts');
  if (!wrap) return;
  const el = document.createElement('div');
  const ic = opts.icon || TOAST_ICON_FOR_MOOD[opts.axo] || 'checkCircle';
  el.className = 'toast';
  el.dataset.born = Date.now();
  el.innerHTML = `<span class="toast-ic">${icon(ic, ic === 'loader' ? 'spin' : '')}</span><span class="t-msg">${msg}</span>${opts.action ? `<button class="t-act">${esc(opts.action.label)}</button>` : ''}<button class="btn ghost sm icon" aria-label="Dismiss" style="color:inherit">${icon('x', 'sm')}</button>`;
  const close = () => { clearTimeout(timer); el.classList.add('out'); setTimeout(() => el.remove(), 220); };
  if (opts.action) el.querySelector('.t-act').addEventListener('click', () => { opts.action.run(); close(); });
  el.querySelector('[aria-label="Dismiss"]').addEventListener('click', close);
  wrap.appendChild(el);
  while (wrap.children.length > 3) wrap.firstChild.remove();
  /* WCAG 2.2.1: a toast whose action is the only way back (Undo) stays until you dismiss it. Other action toasts
     (Review, Resume, Retry, Open pull request) repeat something that's also on the page, so they stay longer (8 s)
     and pause while hovered or focused, instead of piling up. */
  const persistent = !!opts.action && !opts.timeout && (opts.persist || /^undo$/i.test(opts.action.label));
  let timer = persistent ? null : setTimeout(close, opts.timeout || (opts.action ? 8000 : 5200));
  const hold = () => clearTimeout(timer);
  const resume = () => { if (!persistent) { clearTimeout(timer); timer = setTimeout(close, 2600); } };
  el.addEventListener('mouseenter', hold); el.addEventListener('focusin', hold);
  el.addEventListener('mouseleave', resume); el.addEventListener('focusout', resume);
  return close;
}
function announce(msg) {
  const a = $('#announcer');
  if (!a) return;
  a.textContent = '';
  setTimeout(() => { a.textContent = msg; }, 40);
}

/* ---------- Dialog primitive (focus trap, Esc, restore focus, zero duplicate mascots) ---------- */
let dialogState = null;
function openDialog(html, opts) {
  opts = opts || {};
  /* Focus returns to whatever opened the first dialog, even if this one was opened from another (the palette). */
  const act = document.activeElement;
  const prev = act && act !== document.body && !$('#overlay').contains(act) ? act : (dialogState && dialogState.prev) || $('#search-trigger') || act;
  closeDialog(true);
  closeBell();
  const ov = $('#overlay');
  ov.innerHTML = `<div class="scrim" data-scrim>${html}</div>`;
  const dlg = ov.querySelector('[role="dialog"]');
  if (dlg && !dlg.hasAttribute('tabindex')) dlg.setAttribute('tabindex', '-1');
  dialogState = { prev, prevKey: typeof focusKeyOf === 'function' ? focusKeyOf(prev) : null, onClose: opts.onClose, el: dlg };
  /* The page behind a modal dialog can't be reached by Tab or by a screen reader's virtual cursor. */
  const root = $('#root'); if (root) root.inert = true;
  ov.querySelector('[data-scrim]').addEventListener('mousedown', (e) => { if (e.target.hasAttribute('data-scrim')) closeDialog(); });
  const first = dlg.querySelector('[autofocus]') || dlg.querySelector('input:not([type="checkbox"]):not([type="radio"]), textarea') || dlg;
  if (first) setTimeout(() => first.focus(), 30);
  return dlg;
}
function closeDialog(silent) {
  if (!dialogState) return;
  const { prev, prevKey, onClose } = dialogState;
  dialogState = null;
  /* If a redraw replaced the control that opened the dialog, focus its replacement (or the page heading), never the body. */
  setTimeout(() => {
    const a = document.activeElement;
    if (dialogState || (a && a !== document.body)) return;
    if (prev && document.contains(prev)) { prev.focus({ preventScroll: true }); return; }
    if (prevKey && typeof restoreFocus === 'function') restoreFocus(prevKey);
    const b = document.activeElement;
    if (!b || b === document.body) { const h = $('#main h1'); if (h) { if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); } }
  }, 60);
  const root = $('#root'); if (root) root.inert = false;
  $('#overlay').innerHTML = '';
  /* Toasts held while the dialog was open show now (unless another dialog opens right away). */
  if (typeof flushHeldToasts === 'function') setTimeout(flushHeldToasts, 300);
  if (onClose && !silent) onClose();
  if (prev && document.contains(prev) && !silent) prev.focus();
}
function trapFocus(e) {
  if (!dialogState || e.key !== 'Tab') return;
  const f = $$('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', dialogState.el).filter((x) => x.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}
function dialogShell(id, title, sub, body, foot, wide, badgeIcon) {
  return `<div class="dialog ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="${id}-title" ${sub ? `aria-describedby="${id}-sub"` : ''} id="${id}">
    <div class="dialog-head"><div style="min-width:0;flex:1"><h2 id="${id}-title">${title}</h2>${sub ? `<p id="${id}-sub">${sub}</p>` : ''}</div>
      <button class="btn ghost icon" data-action="close-dialog" aria-label="Close">${icon('x')}</button></div>
    <div class="dialog-body">${body}</div>
    ${foot ? `<div class="dialog-foot">${foot}</div>` : ''}
  </div>`;
}

/* ---------- Command palette (⌘K) ---------- */
let paletteSel = 0;
function paletteItems() {
  return livePaletteItems();
}
function fuzzy(q, s) {
  q = q.toLowerCase(); s = s.toLowerCase();
  if (!q) return true;
  if (s.includes(q)) return true;
  let i = 0;
  for (const c of s) { if (c === q[i]) i++; if (i === q.length) return true; }
  return false;
}
function openPalette(initial) {
  paletteSel = 0;
  const ph = typeof liveOn === 'function' && liveOn() ? 'Search tasks, clusters, pages, or actions…' : 'Search tasks, go to a page, or run ax doctor / export / compare…';
  const html = `<div class="palette" role="dialog" aria-modal="true" aria-label="Command palette">
    <div class="palette-input">${icon('search')}<input id="palette-input" role="combobox" aria-label="Search pages, tasks and commands" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list" placeholder="${ph}" autocomplete="off" value="${esc(initial || '')}" autofocus></div>
    <ul class="palette-list" id="palette-list" role="listbox" aria-label="Results"></ul><p class="sr-only" id="palette-count" role="status"></p>
    <div class="palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> to move</span><span><kbd>↵</kbd> to run</span><span><kbd>esc</kbd> to close</span><span style="margin-left:auto">${icon('terminal', 'xs')} shows the <code>ax</code> equivalent</span></div>
  </div>`;
  const dlg = openDialog(html);
  const input = $('#palette-input', dlg);
  const draw = () => {
    const q = input.value.trim();
    const items = paletteItems().filter((it) => fuzzy(q, it.label + ' ' + it.group + ' ' + (it.cli || '')));
    paletteSel = Math.max(0, Math.min(paletteSel, items.length - 1));
    let g = '', out = '';
    items.forEach((it, k) => {
      if (it.group !== g) { g = it.group; out += `<li class="palette-group" role="presentation">${esc(g)}</li>`; }
      out += `<li class="palette-item" role="option" id="pi-${k}" data-k="${k}" aria-selected="${k === paletteSel}">${icon(it.icon)}<span>${esc(it.label)}</span>${it.meta ? `<span class="xsmall muted">· ${esc(it.meta)}</span>` : ''}${it.cli ? `<span class="pi-cli">${esc(it.cli)}</span>` : it.keys ? `<span class="pi-cli"><kbd>${it.keys}</kbd></span>` : ''}</li>`;
    });
    $('#palette-list', dlg).innerHTML = out || `<li class="palette-group" role="presentation">No matches. Press ↵ to start a new task: “${esc(q)}”</li>`;
    const pc = $('#palette-count', dlg); if (pc) { const n = (out.match(/role="option"/g) || []).length; pc.textContent = n ? plural(n, 'result') : 'No results'; }
    input.setAttribute('aria-activedescendant', items.length ? 'pi-' + paletteSel : '');
    const selEl = $(`#pi-${paletteSel}`, dlg);
    if (selEl) selEl.scrollIntoView({ block: 'nearest' });
    return items;
  };
  let items = draw();
  input.addEventListener('input', () => { paletteSel = 0; items = draw(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); paletteSel = Math.min(items.length - 1, paletteSel + 1); items = draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); paletteSel = Math.max(0, paletteSel - 1); items = draw(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const it = items[paletteSel];
      closeDialog(true);
      if (it) it.run();
      else if (input.value.trim()) {
        if (typeof liveOn === 'function' && liveOn()) { LIVE.draft = liveNewDraft(''); LIVE.draft.goal = input.value.trim(); navigate('#/new'); }
        else { state.draft = null; navigate('#/new?goal=' + encodeURIComponent(input.value.trim())); }
      }
    }
  });
  $('#palette-list', dlg).addEventListener('click', (e) => {
    const li = e.target.closest('.palette-item');
    if (!li) return;
    const it = items[+li.dataset.k];
    closeDialog(true);
    if (it) it.run();
  });
  $('#palette-list', dlg).addEventListener('mousemove', (e) => {
    const li = e.target.closest('.palette-item');
    if (li && +li.dataset.k !== paletteSel) { paletteSel = +li.dataset.k; items = draw(); }
  });
}

/* ---------- Shortcuts ---------- */
function openShortcuts() {
  /* With real data, only the shortcuts that lead somewhere real (live-settings.js has the same list). */
  const live = typeof liveOn === 'function' && liveOn() && typeof liveShortcutRows === 'function';
  const rows = live ? liveShortcutRows()
    : [[`${MOD} K`, 'Search or run any command'], ['N', 'New task'], ['G then H', 'Go home'], ['G then R', 'Go to Guardrails'], ['G then P', 'Go to Where agents run'], ['G then S', 'Go to Settings'], ['T', 'Switch light / dark theme'], [`${MOD} ↵`, 'Run task / send message'], ['?', 'Show this list'], ['Esc', 'Close dialogs']];
  openDialog(dialogShell('sc', 'Keyboard shortcuts', `Everything in AX Studio works from the keyboard. Arrow keys move between tabs and options.${state.singleKeys ? '' : ' Single-key shortcuts are off.'}`,
    `<table class="table"><tbody>${rows.map(([k, d]) => `<tr><td style="width:42%">${k.split(' ').map((x) => (x === 'then' ? '<span class="muted small"> then </span>' : `<kbd>${x}</kbd> `)).join('')}</td><td>${d}</td></tr>`).join('')}</tbody></table>
    <p class="small muted" style="margin-top:12px">Turn single-key shortcuts on or off under <a href="#/settings/accessibility" data-action="close-dialog">Accessibility in Settings</a>.</p>`, '', false));
}

/* ---------- Axel's story ("Why an axolotl?") ----------
   Short on purpose: Axel in his spring, one line of story, then four pairs (his trait, and what it means in AX).
   It's the one dialog with Axel in it, because it's about him. The page's own Axel steps out while it's open
   (polish.css), so there's still one Axel on screen. */
function openStory() {
  const body = `
    <div class="story-scene" aria-hidden="true">
      <svg class="story-rings" viewBox="0 0 250 62" focusable="false"><ellipse cx="125" cy="31" rx="56" ry="11" class="st-r"/><ellipse cx="125" cy="31" rx="86" ry="18" class="st-r r2"/><ellipse cx="125" cy="31" rx="116" ry="26" class="st-r r3"/></svg>
      ${axo('wave', { decorative: true, cls: 'story-axo' })}
    </div>
    <p class="story-lead">${esc(AXEL_STORY.lead)}</p>
    <ul class="story-grid">${AXEL_STORY.chapters.map((c) => `<li class="story-item"><span class="si-ic" aria-hidden="true">${icon(c.icon, 'sm')}</span><div class="si-text"><div class="si-trait">${esc(c.trait)}</div><div class="si-prod">${esc(c.product)}</div></div></li>`).join('')}</ul>
    <p class="xsmall muted story-ps">P.S. Axel knows a few tricks. Say hi to him on Home.</p>`;
  openDialog(dialogShell('story', 'Axel & the Clear Spring', 'Why AX’s mascot is an axolotl', body,
    `<span class="left story-credit">${icon('droplet', 'xs')}<span>Official <code>google/ax</code> mascot · artwork by Nan Hockin</span></span><button class="btn primary" data-action="close-dialog">Back to Studio</button>`, true, 'waves'));
}

function closeBell() {
  const pop = $('#bell-pop');
  if (pop && pop.innerHTML) { pop.innerHTML = ''; const b = $('#bell'); if (b) b.setAttribute('aria-expanded', 'false'); }
}

