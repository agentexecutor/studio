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

/* AX Studio prototype — theme, toasts, dialogs, palette, sanctuary story, compare, manifest, doctor, handoff, promote. */
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
/** Moving to another page clears toasts that belong to the page you left (fresh ones, shown by the move itself, stay). */
function pruneToasts(maxAgeMs) {
  const t0 = Date.now();
  $$('#toasts .toast').forEach((t) => { if (t0 - (+t.dataset.born || 0) > (maxAgeMs || 1500)) t.remove(); });
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
  if (typeof liveOn === 'function' && liveOn() && typeof livePaletteItems === 'function') return livePaletteItems();
  const r = state.route || { parts: [] };
  const items = [];
  const go = (h) => () => navigate(h);
  items.push(
    { group: 'Go to', label: 'New task', icon: 'plus', cli: 'ax run', run: go('#/new'), keys: 'N' },
    { group: 'Go to', label: 'Home', icon: 'inbox', cli: 'ax ls', run: go('#/') },
    { group: 'Go to', label: 'Guardrails', icon: 'shield', cli: 'ax guardrails', run: go('#/guardrails') },
    { group: 'Go to', label: 'Where agents run', icon: 'server', cli: 'ax status', run: go('#/places') },
    { group: 'Go to', label: 'Settings', icon: 'sliders', cli: 'ax config', run: go('#/settings') },
  );
  if (r.parts[0] === 'task') {
    const t = getTask(r.parts[1]);
    if (t) {
      if (t.status === 'running') items.push({ group: 'This task', label: 'Pause', icon: 'pause', cli: `ax pause ${t.id}`, run: () => pauseTask(t) });
      if (t.status === 'waiting' && t.needs && t.needs.type === 'paused') items.push({ group: 'This task', label: 'Resume', icon: 'play', cli: `ax resume ${t.id}`, run: () => resumeTask(t) });
      if ((ACTIVE.includes(t.status) || NEEDS_YOU.includes(t.status)) && t.status !== 'failed') items.push({ group: 'This task', label: 'Stop task (keep its changes)', icon: 'stop', cli: `ax stop ${t.id}`, run: () => stopTask(t) });
      items.push(
        { group: 'This task', label: 'Send a message', icon: 'message', cli: `ax send ${t.id} "…"`, run: () => ACTIONS['focus-steer']({ dataset: { task: t.id } }) },
        { group: 'This task', label: 'Review changes', icon: 'eye', cli: `ax diff ${t.id}`, run: go(`#/task/${t.id}/changes`) },
        { group: 'This task', label: 'Open a terminal', icon: 'terminal', cli: `ax ssh ${t.id}`, run: go(`#/task/${t.id}/terminal`) },
        { group: 'This task', label: 'View log', icon: 'terminal', cli: `ax logs ${t.id} --follow`, run: go(`#/task/${t.id}/log`) },
        { group: 'This task', label: t.altRun || t.compareWith ? 'Compare agent runs side by side' : 'Compare with another agent (isolated fork)', icon: 'compare', cli: `ax compare ${t.id}`, run: () => openCompare(t) },
        { group: 'This task', label: 'Continue with another agent', icon: 'handoff', cli: `ax handoff ${t.id} --to …`, run: () => openHandoff(t) },
        { group: 'This task', label: 'Export portable YAML / Sandbox Kit', icon: 'code', cli: `ax export ${t.id}`, run: () => openManifest(t) },
        { group: 'This task', label: 'Export trajectory (OATR)', icon: 'download', cli: `ax logs ${t.id} --oatr`, run: () => downloadText(`${t.id}.oatr.json`, oatrJSON(t), `Saved <span class="mono">${t.id}.oatr.json</span> · secrets redacted`) },
      );
      if (t.env === 'local' && t.status !== 'failed' && !handedOff(t) && !t.notKept) items.push({ group: 'This task', label: t.status === 'done' ? 'Run again on a remote cluster' : 'Run on a remote cluster', icon: 'cloudUp', cli: `ax promote ${t.id}`, run: () => openPromote(t) });
    }
  }
  items.push(
    { group: 'Tools', label: 'All tasks', icon: 'layers', cli: 'ax list', run: () => navigate('#/tasks') },
    { group: 'Tools', label: 'Run health check', icon: 'doctor', cli: 'ax doctor', run: () => openDoctor() },
    { group: 'Tools', label: 'Find a template (your team, AX catalog)', icon: 'search', cli: 'ax templates search', run: () => openAgentCatalog({ tab: 'browse' }) },
    { group: 'Tools', label: 'Bring your own agent', icon: 'box', cli: 'ax templates add <folder|image|repo>', run: () => openAgentCatalog({ tab: 'byo' }) },
    { group: 'Tools', label: 'Export portable YAML / Sandbox Kit', icon: 'code', cli: 'ax export', run: () => openManifest(state.tasks[0]) },
    { group: 'Tools', label: 'Privacy & data', icon: 'lock', cli: 'ax config privacy', run: go('#/settings/privacy') },
    { group: 'Tools', label: 'CUJ 1 · The installation experience (review on its own)', icon: 'play', cli: '', run: () => navigate('#/cuj/1') },
    { group: 'Tools', label: "Why an axolotl? · Axel's story", icon: 'waves', cli: '', run: () => openStory() },
  );
  const dark = resolvedTheme() === 'dark';
  items.push(
    { group: 'Preferences', label: dark ? 'Switch to light theme' : 'Switch to dark theme', icon: dark ? 'sun' : 'moon', cli: '', run: () => setTheme(dark ? 'light' : 'dark'), keys: 'T' },
    { group: 'Preferences', label: 'Match system theme', icon: 'monitor', cli: '', run: () => setTheme('system') },
    { group: 'Preferences', label: state.showInfra ? 'Hide infrastructure details' : 'Show infrastructure details', icon: 'layers', cli: '', run: () => { state.showInfra = !state.showInfra; savePrefs(); document.body.classList.toggle('show-infra', state.showInfra); toast(state.showInfra ? 'Infrastructure details shown under “Show details”' : 'Infrastructure details hidden', { icon: 'layers' }); } },
    { group: 'Preferences', label: 'Keyboard shortcuts', icon: 'keyboard', cli: '', run: openShortcuts, keys: '?' },
  );
  state.tasks.forEach((t) => items.push({ group: 'Tasks', label: t.title, icon: STATUS[t.status].icon === 'loader' ? 'activity' : STATUS[t.status].icon, cli: `ax logs ${t.id}`, run: go(`#/task/${t.id}`), meta: STATUS[t.status].label }));
  return items;
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

/* ---------- Portable Manifest & Sandbox Kit Drawer (beats vendor lock-in & secret leaks) ---------- */
function openManifest(target) {
  const spec = target || state.tasks[0];
  if (!spec) { toast('Start a task first. Its task file is what you export.', { icon: 'info' }); return; }
  let fmt = 'ax';
  const body = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px">
      <div class="seg" role="tablist" aria-label="Manifest format" id="mf-tabs">
        <button type="button" role="tab" id="mf-tab-ax" data-mf="ax" aria-selected="true" aria-controls="mf-code">Agent Substrate (ax.yaml)</button>
        <button type="button" role="tab" id="mf-tab-kit" data-mf="kit" aria-selected="false" aria-controls="mf-code">Sandbox Kit (sbxenv.yaml)</button>
      </div>
      <span class="chip done">${icon('lock')}0 secrets in file</span>
    </div>
    <p class="small muted" id="mf-desc" style="margin-bottom:10px"></p>
    <pre class="manifest" id="mf-code" role="tabpanel" aria-labelledby="mf-tab-ax" tabindex="0" style="max-height:310px"></pre>`;
  const dlg = openDialog(dialogShell('mf', 'Portable manifest & Sandbox Kit', 'Check this file into Git or run it on your own Kubernetes cluster. No vendor cloud lock-in.', body,
    `<span class="left">${icon('terminal', 'xs')}<code id="mf-cli"></code></span><button class="btn" id="mf-dl">${icon('download', 'sm')}Download</button><button class="btn primary" id="mf-copy">${icon('copy', 'sm')}Copy YAML</button>`, true, 'code'));
  const draw = () => {
    const raw = manifestYAML(spec, fmt);
    $$('#mf-tabs [role="tab"]', dlg).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mf === fmt)));
    $('#mf-code', dlg).setAttribute('aria-labelledby', 'mf-tab-' + fmt);
    $('#mf-desc', dlg).textContent = fmt === 'ax'
      ? 'CNCF Agent Substrate Workspace + Task spec. Runs unchanged on this computer or on your own GKE / Kubernetes cluster.'
      : 'OCI Sandbox Kit spec (sbxenv.yaml). Share reproducible sandbox setups across teams or import existing kits.';
    $('#mf-code', dlg).textContent = raw;
    $('#mf-cli', dlg).textContent = fmt === 'ax' ? `ax export ${spec.id || ''} > ax.yaml`.replace(/\s+>/, ' >') : 'ax kit export -o sbxenv.yaml';
    return raw;
  };
  let cur = draw();
  dlg.addEventListener('click', (e) => {
    const b = e.target.closest('[data-mf]');
    if (b) { fmt = b.dataset.mf; cur = draw(); }
  });
  $('#mf-copy', dlg).addEventListener('click', () => copyText(cur, `Copied <span class="mono">${fmt === 'ax' ? 'ax.yaml' : 'sbxenv.yaml'}</span> (0 secrets included)`));
  $('#mf-dl', dlg).addEventListener('click', () => downloadText(fmt === 'ax' ? 'ax.yaml' : 'sbxenv.yaml', cur));
}

/* ---------- Interactive ax doctor Self-Check ---------- */
function openDoctor() {
  const preset = GUARDRAIL_PRESETS[state.guardrailPreset] || GUARDRAIL_PRESETS.balanced;
  /* Each row reports what is true now: nothing passes that isn't set up, and keys are counted, not assumed. */
  const local = state.env.mode === 'local';
  const keys = Object.values(AGENTS).filter((a) => a.connected && !a.custom).length;
  const dls = prebuiltAgents().filter((a) => isDownloading(a.id));
  const checks = [
    local ? ['ok', 'Sandbox isolation', 'microVM · Apple Virtualization.framework · host folders unmounted (copy-on-write clean)']
      : ['warn', 'This computer isn\'t set up', 'No local sandbox yet. Set up this computer to run tasks here, or keep using a remote cluster.'],
    keys ? ['ok', 'Zero secrets inside the sandbox', `${plural(keys, 'sign-in or key', 'sign-ins and keys')} held in the system keychain and added outside the sandbox`]
      : ['warn', 'No templates signed in', 'Sign in to a template on New task. Keys stay in the system keychain, outside the sandbox.'],
    local ? ['ok', 'Guardrails filter', `ax-gateway 0.9.2 · ${preset.name} preset · ${plural(state.allow.length, 'allowed site')}, ${plural(state.orgBlocked.length, 'org block')}`]
      : ['warn', 'Guardrails filter', 'Runs with the local sandbox. Remote clusters use your organization\'s guardrails.'],
    dls.length ? ['warn', 'Template images', `${andList(dls.map((a) => a.name))} still downloading · ${dlPct(dls[0].id)}%`]
      : ['ok', 'Template images', `${prebuiltAgents().map((a) => `${a.name} ${a.version}`).join(' · ')} (${state.pinImages ? 'versions pinned' : 'auto-update'})`],
    state.env.clusterConnected ? ['ok', 'Remote cluster', `Connected to ${state.env.cluster} · Agent Substrate v1alpha1`]
      : ['warn', 'Remote cluster', 'Not connected. Connect one on Where agents run to keep tasks running with your laptop closed.'],
  ];
  const bad = checks.filter((c) => c[0] !== 'ok').length;
  const dlg = openDialog(dialogShell('doc', 'System health check', 'Verifying sandbox isolation, key boundary, Guardrails, and cluster portability.',
    `<ul class="check-list" id="doc-list"></ul><p class="small" id="doc-sum" role="status" style="margin-top:12px"></p>`,
    `<span class="left">${icon('terminal', 'xs')}<code>ax doctor --json</code></span><button class="btn" id="doc-copy">${icon('copy', 'sm')}Copy redacted report</button><button class="btn primary" data-action="close-dialog">Done</button>`, true, 'doctor'));
  const ul = $('#doc-list', dlg);
  (async () => {
    for (const [st, title, desc] of checks) {
      const li = document.createElement('li');
      li.className = 'check-item pending enter';
      li.innerHTML = `<span class="ci-icon">${icon('loader')}</span><div><div class="ci-title">${esc(title)}</div><div class="ci-desc">Checking…</div></div>`;
      ul.appendChild(li);
      await sleep(reducedMotion() ? 0 : 280);
      if (!document.contains(ul)) return;
      li.className = 'check-item ' + st;
      li.innerHTML = `<span class="ci-icon">${icon(st === 'ok' ? 'check' : 'alert')}</span><div><div class="ci-title">${esc(title)}</div><div class="ci-desc">${esc(desc)}</div></div>`;
    }
    const sum = $('#doc-sum', dlg);
    if (sum) sum.textContent = bad ? `${plural(bad, 'check needs', 'checks need')} attention.` : `All ${checks.length} checks passed.`;
    if (sum) announce(sum.textContent);
  })();
  $('#doc-copy', dlg).addEventListener('click', () => {
    const rep = JSON.stringify({
      ax: '0.9.2', localSandbox: state.env.mode === 'local' ? 'healthy' : 'not-set-up', guestSecretsExposed: 0,
      cluster: state.env.clusterConnected ? state.env.cluster : null,
      checks: checks.map(([st, title]) => ({ status: st, title })),
      guardrails: { gateway: '0.9.2', preset: state.guardrailPreset, allowedCount: state.allow.length },
      imagesPinned: state.pinImages,
      agents: Object.values(AGENTS).map((a) => ({ cli: a.cli, version: a.version, connected: a.connected, key: '[redacted]' })),
    }, null, 2);
    copyText(rep, 'Health report copied. All credentials redacted.');
  });
}

/* ---------- Side-by-Side Isolated Agent Comparison (beats Cursor un-isolated worktrees) ---------- */
function openCompare(t) {
  const sib = t.compareWith && getTask(t.compareWith);
  if (t.altRun || sib) {
    const a1 = AGENTS[t.agent];
    const f1 = filesFor(t), d1 = totalDiff(f1), c1 = costFor(t);
    const dur1 = t.finishedAt ? Math.max(1, Math.round((t.finishedAt - t.startedAt) / MIN)) + 'm' : fmtElapsed(t.startedAt);

    const a2 = AGENTS[sib ? sib.agent : t.altRun.agent];
    const f2 = sib ? filesFor(sib) : t.altRun.files;
    const d2 = totalDiff(f2);
    const c2 = sib ? costFor(sib) : (t.altRun.tokens / 1000) * a2.rate;
    const dur2 = sib ? (sib.finishedAt ? Math.max(1, Math.round((sib.finishedAt - sib.startedAt) / MIN)) + 'm' : fmtElapsed(sib.startedAt)) : t.altRun.durationLabel;
    const sum2 = sib ? (sib.status === 'done' ? 'Finished in its own isolated sandbox.' : `${STATUS[sib.status].label} in parallel sandbox.`) : t.altRun.summary;

    const decided1 = sib ? (t.notKept ? 'Not kept' : sib.notKept ? 'Kept' : '') : (t.altRun.notKept ? 'Kept' : '');
    const decided2 = sib ? (sib.notKept ? 'Not kept' : t.notKept ? 'Kept' : '') : (t.altRun.notKept ? 'Not kept' : '');
    const col = (A, badge, statusLbl, files, diff, dur, cost, note, actionHTML, active, decided) => `
      <div class="cmp-col ${active ? 'active' : ''} ${decided === 'Not kept' ? 'dropped' : ''}">
        <div class="cmp-head">${agentTile(A.id)}<div style="min-width:0"><b>${A.name}</b><span class="xsmall muted" style="display:block">${esc(badge)}</span></div><span class="chip ${decided === 'Not kept' ? '' : statusLbl === 'Running' ? 'running' : 'done'}" style="margin-left:auto">${esc(decided || statusLbl)}</span></div>
        <dl class="cmp-stats">
          <div><dt>Isolation</dt><dd>Own microVM copy</dd></div>
          <div><dt>Changes</dt><dd><span class="diffstat"><span class="a">+${diff.add}</span><span class="d">−${diff.del}</span></span> · ${plural(files.length, 'file')}</dd></div>
          <div><dt>Time</dt><dd class="tnum">${esc(dur)}</dd></div>
          <div><dt>Est. cost</dt><dd class="tnum">$${cost.toFixed(2)}</dd></div>
        </dl>
        <p class="small sub" style="margin-top:10px">${esc(note)}</p>
        <div class="file-chips" style="margin-top:8px">${files.map((f) => `<span class="file-chip">${icon('file', 'xs')}${esc(f.path)}</span>`).join('') || '<span class="xsmall muted">Editing in progress…</span>'}</div>
        <div class="btn-row" style="margin-top:14px">${actionHTML}</div>
      </div>`;

    const body = `
      <div class="callout" style="margin-bottom:14px">${icon('shieldCheck')}<div>Each agent ran in its <strong>own kernel-isolated sandbox</strong> on a clean snapshot of <span class="mono">${esc(t.repo)}</span>. Keep one run; the other is marked not kept, its resources are freed, and you can restore it for 7 days.</div></div>
      <div class="cmp-grid">
        ${col(a1, 'Current view', STATUS[t.status].label, f1, d1, dur1, c1, ((t.events.filter((x) => x.type === 'done').pop() || {}).text) || (t.status === 'done' ? 'Finished in its own isolated sandbox.' : `${STATUS[t.status].label} in its own sandbox.`), decided1 === 'Kept' ? `<span class="xsmall muted">${icon('award', 'xs')} You kept this run</span>` : `<button class="btn sm" id="cmp-keep-1">${icon('award', 'sm')}Keep ${a1.name}'s run</button>`, true, decided1)}
        ${col(a2, 'Parallel sandbox #2', sib ? STATUS[sib.status].label : 'Done', f2, d2, dur2, c2, sum2,
          decided2 === 'Kept' ? `<span class="xsmall muted">${icon('award', 'xs')} You kept this run</span>` : `<button class="btn sm" id="cmp-keep-2">${icon('award', 'sm')}Keep ${a2.name}'s run</button>${sib
            ? `<a class="btn ghost sm" href="#/task/${sib.id}" data-action="close-dialog">Open run ${icon('arrowRight', 'sm')}</a>`
            : `<button class="btn ghost sm" id="cmp-swap">${icon('eye', 'sm')}Preview its diff</button>`}`, false, decided2)}
      </div>`;
    const dlg = openDialog(dialogShell('cmp', 'Compare isolated agent runs', `“${esc(t.title)}”`, body,
      `<span class="left">${icon('terminal', 'xs')}<code>ax compare ${t.id} --keep &lt;agent&gt;</code></span><button class="btn ghost" data-action="close-dialog">Close</button>`, true, 'compare'));
    const sw = $('#cmp-swap', dlg);
    if (sw) sw.addEventListener('click', () => {
      swapAltRun(t);
      closeDialog(true);
      navigate(`#/task/${t.id}/changes`);
    });
    const k1 = $('#cmp-keep-1', dlg); if (k1) k1.addEventListener('click', () => keepRun(t, 'self'));
    const k2 = $('#cmp-keep-2', dlg); if (k2) k2.addEventListener('click', () => keepRun(t, 'other'));
    return;
  }

  /* Fork a new parallel isolated comparison run */
  const others = agentList().filter((a) => a.id !== t.agent);
  let pick = others.find((a) => a.connected) || others[0];
  const body = `
    <p class="small sub" style="margin-bottom:12px">Start a second agent on a fresh isolated copy of <span class="mono">${esc(t.repo)}</span> with the same goal and guardrails, then compare diffs, tests, speed and cost side by side.</p>
    <div class="radio-list" role="radiogroup" aria-label="Second agent" id="cmp-agents"></div>`;
  const dlg = openDialog(dialogShell('cmp', 'Compare with another agent', `Race ${AGENTS[t.agent].name} against a second agent in parallel sandboxes.`, body,
    `<span class="left">${icon('terminal', 'xs')}<code id="cmp-cli"></code></span><button class="btn ghost" data-action="close-dialog">Cancel</button><button class="btn primary" id="cmp-go"></button>`, true, 'compare'));
  const draw = () => {
    $('#cmp-agents', dlg).innerHTML = others.map((a) => `<button type="button" class="radio-card" role="radio" aria-checked="${pick.id === a.id}" data-ca="${a.id}"><span class="rc-dot"></span>${agentTile(a.id, 'lg')}<span class="rc-main"><span class="rc-title">${a.name}</span><span class="rc-desc">${a.desc}</span></span><span class="rc-right">${a.connected ? 'Isolated sandbox' : `<span style="color:var(--wait)">${icon('key', 'xs')} Needs key</span>`}</span></button>`).join('');
    $('#cmp-cli', dlg).textContent = `ax fork ${t.id} --compare --agent ${pick.cli}`;
    $('#cmp-go', dlg).innerHTML = `${icon('compare', 'sm')}Run ${pick.name} in parallel`;
  };
  draw();
  dlg.addEventListener('click', (e) => { const b = e.target.closest('[data-ca]'); if (b) { pick = AGENTS[b.dataset.ca]; draw(); } });
  $('#cmp-go', dlg).addEventListener('click', () => {
    if (!pick.connected) { closeDialog(true); openKeyDialog(pick.id); toast(`Connect ${pick.name} first to compare.`, { icon: 'key' }); return; }
    closeDialog(true);
    forkCompareTask(t, pick.id);
  });
}

/* ---------- Notifications popover ---------- */
function toggleBell() {
  const pop = $('#bell-pop');
  if (!pop) return;
  if (pop.innerHTML) { closeBell(); return; }
  const needs = state.tasks.filter(needsYou);
  const BELL_MAX = 8;
  const recent = state.tasks.filter((t) => t.status === 'done').sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0)).slice(0, 2);
  const item = (t, sub) => `<a class="pop-item" href="#/task/${t.id}" data-action="close-bell"><span class="pi-ic ${t.status}">${icon(STATUS[t.status].icon, 'sm')}</span><span><span style="font-weight:600">${esc(t.title)}</span><div class="pi-sub">${sub}</div></span></a>`;
  pop.innerHTML = `<div class="popover" role="dialog" aria-label="Notifications">
    <div class="popover-head">Needs you · ${needs.length}<a href="#/settings/notifications" data-action="close-bell" style="margin-left:auto;font-weight:600;letter-spacing:0;text-transform:none">Settings</a></div>
    ${needs.slice(0, BELL_MAX).map((t) => item(t, `${quotaWaiting(t) ? 'Waiting for the rate limit' : STATUS[t.status].label} · ${AGENTS[t.agent].name}`)).join('') || '<div class="pop-item"><span></span><span class="muted">Nothing needs you right now.</span></div>'}
    ${needs.length > BELL_MAX ? `<a class="pop-item pop-more" href="#/tasks" data-action="close-bell"><span></span><span>See all ${needs.length} in All tasks</span></a>` : ''}
    <div class="popover-head" style="border-top:1px solid var(--hair);margin-top:6px">Recently finished</div>
    ${recent.map((t) => item(t, `Finished ${fmtAgo(t.finishedAt || now())}`)).join('')}
  </div>`;
  $('#bell').setAttribute('aria-expanded', 'true');
  state.bellSeen = needs.length;
  updateChrome();
}
function closeBell() {
  const pop = $('#bell-pop');
  if (pop && pop.innerHTML) { pop.innerHTML = ''; const b = $('#bell'); if (b) b.setAttribute('aria-expanded', 'false'); }
}

/* ---------- Key dialog (F7: account sign-in or API key; both stay outside the sandbox) ---------- */
function openKeyDialog(agentId, taskId) {
  const A = AGENTS[agentId];
  let method = A.signIn ? 'account' : 'key';
  const keyForm = `
    <form data-form="key-dialog" data-agent="${agentId}" ${taskId ? `data-task="${taskId}"` : ''} class="field" id="key-dialog-form">
      <label for="kd-input">${A.keyLabel}</label>
      <input class="input mono" id="kd-input" type="password" placeholder="${A.keyPrefix}…" autocomplete="off" spellcheck="false" aria-describedby="kd-status kd-hint" autofocus>
      <span class="hint" id="kd-hint">Stored in your system keychain. Guardrails adds it to requests on the way out, so agents never see raw keys.</span>
      <div class="field-status" id="kd-status" role="status"></div>
    </form>`;
  const accountBody = `
    <div class="signin-row" style="margin-top:4px"><button type="button" class="btn primary" id="kd-signin">${icon('globe', 'sm')}${A.signIn || 'Sign in'}</button><span class="hint">${A.signInNote || ''}</span></div>
    <div class="field-status" id="kd-status" role="status" style="margin-top:8px"></div>`;
  const body = `
    ${A.signIn ? `<div class="seg kp-methods" role="radiogroup" aria-label="How ${A.name} signs in" id="kd-methods" style="margin-bottom:14px">
      <button type="button" role="radio" aria-checked="true" data-m="account">${accountName(A)}</button>
      <button type="button" role="radio" aria-checked="false" data-m="key">API key</button></div>` : ''}
    <div id="kd-body">${A.signIn ? accountBody : keyForm}</div>`;
  const foot = (m) => `<span class="left">${icon('terminal', 'xs')}<code>${m === 'account' ? `ax auth login ${A.cli}` : `ax keys set ${A.cli}`}</code></span><button class="btn ghost" data-action="close-dialog">Cancel</button>${m === 'key' ? '<button class="btn primary" type="submit" form="key-dialog-form">Check and save</button>' : ''}`;
  const dlg = openDialog(dialogShell('kd', A.connected ? `Change how ${A.name} signs in` : `Connect ${A.name}`, A.keyProblem && !A.connected ? `${A.maker} rejected the current key. Sign in again or paste a new key to continue.` : 'Credentials stay in your system keychain and are added outside the sandbox.', body,
    foot(method), false, 'key'));
  const wire = () => {
    const b = $('#kd-signin', dlg);
    if (!b) return;
    b.addEventListener('click', async () => {
      b.disabled = true;
      const st = $('#kd-status', dlg);
      st.className = 'field-status busy'; st.innerHTML = `${icon('loader', 'sm')}Finish signing in in your browser…`;
      await sleep(1300);
      accountSignedIn(A);
      st.className = 'field-status ok'; st.innerHTML = `${icon('checkCircle', 'sm')}Signed in. Saved to your keychain.`;
      await sleep(600);
      closeDialog();
      const task = taskId && getTask(taskId);
      toast(`${A.name} is connected`, { icon: 'checkCircle', action: task && task.status === 'failed' ? { label: 'Retry task', run: () => retryTask(task) } : null });
      render({ keepScroll: true });
    });
  };
  wire();
  const ms = $('#kd-methods', dlg);
  if (ms) ms.addEventListener('click', (e) => {
    const m = e.target.closest('[data-m]');
    if (!m || m.dataset.m === method) return;
    method = m.dataset.m;
    $$('[data-m]', ms).forEach((x) => x.setAttribute('aria-checked', String(x.dataset.m === method)));
    $('#kd-body', dlg).innerHTML = method === 'account' ? accountBody : keyForm;
    $('.dialog-foot', dlg).innerHTML = foot(method);
    wire();
    const f = $('#kd-input', dlg) || $('#kd-signin', dlg); if (f) f.focus();
  });
}
function accountSignedIn(A) {
  A.connected = true; A.auth = 'account'; A.keyProblem = ''; A.keyHint = '';
}
async function validateKey(agentId, value, statusEl) {
  const A = AGENTS[agentId];
  const set = (cls, html) => { statusEl.className = 'field-status ' + cls; statusEl.innerHTML = html; };
  value = (value || '').trim();
  if (!value) { set('err', `${icon('alert', 'sm')}Paste your ${A.keyLabel} first.`); return false; }
  if (!value.startsWith(A.keyPrefix) || value.length < 16) { set('err', `${icon('alert', 'sm')}That doesn't look like an ${A.maker} key. Keys start with “${A.keyPrefix}”.`); return false; }
  set('busy', `${icon('loader', 'sm')}Checking with ${A.maker}…`);
  await sleep(900);
  if (/bad|revoked/i.test(value)) { set('err', `${icon('alert', 'sm')}${A.maker} rejected this key (401). Check that it's active, then try again.`); return false; }
  A.connected = true; A.keyProblem = ''; A.keyHint = '••••' + value.slice(-4);
  set('ok', `${icon('checkCircle', 'sm')}Key works. Saved to your keychain.`);
  return true;
}

/* ---------- Folder picker (New task → Set up the workspace → Change…) ----------
   Folders on this computer, each with what AX found in it (AGENTS.md, the setup command and where it came from). */
function openFolderPicker() {
  const d = state.draft; if (!d) return null;
  const rows = FOLDERS.map((f, k) => {
    const cur = d.source === 'folder' && d.folderIdx === k;
    return `<button type="button" class="fp-row" data-action="pick-folder" data-i="${k}"${cur ? ' aria-current="true"' : ''}>
      ${icon('folder')}<span class="fp-main"><span class="fp-name mono">${esc(f.path)}</span>
      <span class="fp-desc">${esc(f.lang)} · ${esc(f.files)} · ${esc(f.branch)} · ${f.clean ? 'no uncommitted changes' : `${f.dirty} uncommitted changes`}</span>
      <span class="fp-desc">${f.agentsMd ? `AGENTS.md (${f.agentsMd} lines)` : 'No AGENTS.md'} · setup <span class="mono">${esc(f.setup)}</span> from ${esc(f.setupFrom)}</span></span>
      ${cur ? `<span class="fp-cur">${icon('check', 'xs')}Selected</span>` : ''}</button>`;
  }).join('');
  return openDialog(dialogShell('fp', 'Choose a folder', 'The agent works on a copy of the folder. Your files stay untouched until you apply or push its changes.',
    `<div class="fp-list" role="group" aria-label="Folders on this computer">${rows}</div>`,
    `<span class="left"><button type="button" class="btn ghost sm" data-action="noop-toast" data-text="In the app, this opens your system folder picker.">${icon('folder', 'sm')}Choose another folder…</button></span><button class="btn ghost" data-action="close-dialog">Cancel</button>`, false, 'folder'));
}

/* ---------- Continue with another agent (CUJ 4: one action; show what carries over; the current agent stops
   cleanly at a turn boundary before the next one starts, so only one is active at a time) ---------- */
function openHandoff(t) {
  /* An agent that just failed to start for this task goes last, says so, and isn't preselected. You can still pick it. */
  const failedAt = t.failedAgents || {};
  const others = agentList().filter((a) => a.id !== t.agent).sort((a, b) => (failedAt[a.id] ? 1 : 0) - (failedAt[b.id] ? 1 : 0));
  let pick = others.find((a) => a.connected && !failedAt[a.id]) || others.find((a) => !failedAt[a.id]) || others[0];
  const files = filesFor(t);
  const A = AGENTS[t.agent];
  const live = ACTIVE.includes(t.status);
  const tot = totalDiff(files);
  const note = `${A.name} ${t.status === 'done' ? 'finished' : 'was working on'} “${t.title}”. ${files.length ? files.length + ' file' + (files.length > 1 ? 's' : '') + ' changed so far.' : ''}`.trim();
  const draw = () => {
    $('#ho-agents').innerHTML = others.map((a) => `<button type="button" class="radio-card" role="radio" aria-checked="${pick.id === a.id}" data-ho="${a.id}"><span class="rc-dot"></span>${agentTile(a.id, 'lg')}<span class="rc-main"><span class="rc-title">${a.name}</span><span class="rc-desc">${a.desc}</span></span><span class="rc-right">${failedAt[a.id] ? `<span style="color:var(--fail)">${icon('alert', 'xs')} Couldn't start ${fmtAgo(failedAt[a.id])}</span>` : a.connected ? '' : `<span style="color:var(--wait)">${icon('key', 'xs')} Needs sign-in</span>`}</span></button>`).join('');
    $('#ho-go').innerHTML = `${icon('handoff', 'sm')}Continue with ${pick.name}`;
    $('#ho-cli').textContent = `ax handoff ${t.id} --to ${pick.cli}`;
    const y = $('#ho-yaml'); if (y) y.textContent = `harness: ${pick.cli}`;
  };
  const carry = `
    <div class="carry" aria-label="What carries over">
      <div class="carry-head">${icon('folder', 'sm')}<b>What carries over</b><span class="muted">Same workspace · branch <span class="mono">${esc(t.branch)}</span></span>${files.length ? `<span class="diffstat" style="margin-left:auto"><span class="a">+${tot.add}</span><span class="d">−${tot.del}</span></span>` : ''}</div>
      ${files.length ? `<div class="file-chips">${files.map((f) => { const s = diffStats(f.lines); return `<span class="file-chip">${icon('file', 'xs')}${esc(f.path)} <span class="diffstat"><span class="a">+${s.add}</span><span class="d">−${s.del}</span></span></span>`; }).join('')}</div>` : '<div class="xsmall muted">No file changes yet. The next agent starts from the same workspace.</div>'}
      <div class="xsmall muted" style="margin-top:6px">Plus uncommitted changes, git history, installed dependencies and build output. The goal stays the same.</div>
    </div>`;
  const body = `
    <div class="radio-list" role="radiogroup" aria-label="Next agent" id="ho-agents"></div>
    ${carry}
    <div class="field" style="margin-top:16px"><label for="ho-note">Handoff note</label><textarea class="textarea" id="ho-note" rows="3">${esc(note)}</textarea><span class="hint">Optional. Say what's done and what to do next.</span></div>
    <label style="display:flex;align-items:flex-start;gap:10px;margin-top:12px;font-size:13.5px"><input type="checkbox" id="ho-history" checked style="margin-top:3px"><span>Attach ${A.name}'s Activity for reference<span class="hint" style="display:block">The next agent starts a new conversation. It gets the goal, the workspace and your note either way.</span></span></label>
    <p class="xsmall muted" style="margin-top:12px">${icon('info', 'xs')} Only one agent works in a workspace at a time. In the task file this is one line: <code id="ho-yaml"></code></p>
    ${live ? `<div class="callout" style="margin-top:14px">${icon('clock')}<div>${A.name} is mid-turn. It finishes its current turn first, so no work is lost. You can stop it right away if you need to.</div></div>` : ''}`;
  const dlg = openDialog(dialogShell('ho', 'Continue with another agent', `Pick up “${esc(t.title)}” with a different agent.`, body,
    `<span class="left">${icon('terminal', 'xs')}<code id="ho-cli"></code></span><button class="btn ghost" data-action="close-dialog">Cancel</button><button class="btn primary" id="ho-go"></button>`, true, 'handoff'));
  draw();
  dlg.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ho]');
    if (b) { pick = AGENTS[b.dataset.ho]; draw(); }
  });
  $('#ho-go', dlg).addEventListener('click', () => {
    if (!pick.connected) { closeDialog(true); openKeyDialog(pick.id); toast(`Connect ${pick.name} first, then continue.`, { icon: 'key' }); return; }
    const noteVal = $('#ho-note', dlg).value.trim();
    const share = !!($('#ho-history', dlg) || {}).checked;
    if (!live) { closeDialog(true); handoffTask(t, pick.id, noteVal, { share }); return; }
    waitForTurn(t, pick, noteVal, dlg, share);
  });
}
/** F5: wait for the current turn to end before handing off; offer "Stop now" if it takes too long. */
function waitForTurn(t, B, noteVal, dlg, share) {
  const A = AGENTS[t.agent];
  clearTimeout(t._timer);
  const prev = t.status;
  t.status = 'stopping';
  refreshAfterStatus(t);
  const started = now();
  const slow = !!state.flags.slowTurn;
  $('#ho-title', dlg).textContent = `Handing off to ${B.name}`;
  const body = $('.dialog-body', dlg), foot = $('.dialog-foot', dlg);
  const paint = () => {
    const secs = Math.round((now() - started) / 1000);
    const late = slow && secs >= 4;
    body.innerHTML = `<div class="wait-turn" role="status" aria-live="polite">
      <span class="nn-icon running">${icon('loader', 'sm spin')}</span>
      <div><div class="wt-title">${late ? `${A.name} is still mid-turn (running <span class="mono">npm test</span>)` : `Waiting for ${A.name} to finish its current turn…`}</div>
      <div class="wt-sub">${late ? 'This turn is taking longer than usual. You can keep waiting, or stop now.' : `${B.name} starts as soon as ${A.name} stops, in the same workspace. Only one agent works in it at a time.`} <span class="tnum">${secs} s</span></div></div></div>
      ${late ? `<div class="callout warn" style="margin-top:14px">${icon('alert')}<div><b>Stop now</b> ends ${A.name}'s turn immediately. Files already saved carry over, but work from this turn may be lost.</div></div>` : ''}`;
  };
  paint();
  foot.innerHTML = `<span class="left">${icon('terminal', 'xs')}<code>ax handoff ${t.id} --to ${B.cli} --wait</code></span><button class="btn ghost" id="ho-cancel">Cancel handoff</button><button class="btn danger" id="ho-stop">Stop now</button>`;
  const iv = setInterval(() => { if (!document.contains(body)) { clearInterval(iv); return; } paint(); }, 1000);
  let done = false;
  const finish = (stoppedEarly) => {
    if (done) return; done = true;
    clearInterval(iv); clearTimeout(tm);
    closeDialog(true);
    t.status = prev;
    if (stoppedEarly) pushEvent(t, { type: 'note', at: now(), text: `You stopped ${A.name} mid-turn to hand off. Work from that turn may be lost.` });
    handoffTask(t, B.id, noteVal, { share, stoppedEarly });
  };
  const tm = slow ? null : setTimeout(() => finish(false), 2600);
  $('#ho-stop', dlg).addEventListener('click', () => finish(true));
  const cancel = () => {
    if (done) return;
    done = true; clearInterval(iv); clearTimeout(tm);
    state.flags.slowTurn = false;
    t.status = prev; closeDialog(true); refreshAfterStatus(t);
    if (t.status === 'running') scheduleNext(t);
    toast(`Handoff canceled. ${A.name} keeps working.`, { icon: 'info' });
  };
  $('#ho-cancel', dlg).addEventListener('click', cancel);
  /* Closing the dialog any other way (X, Esc, clicking outside) also cancels, so the task is never left in Stopping. */
  if (dialogState) dialogState.onClose = cancel;
}

/* ---------- Run on a remote cluster (CUJ 5: the same task file starts a fresh run on the cluster; versions,
   reachability, uncommitted → branch, blockers + rerun). Carrying live work over ("close your laptop") is P1. ---------- */
function openPromote(t, opts) {
  opts = opts || {};
  /* 1 Choose cluster · 2 Check · 3 Run. There is no sign-in step: the clusters come from your kubeconfig. */
  let step = opts.step || 1;
  let cluster = opts.cluster || 'ax-dev-us-central';
  let pushedFirst = !!(t.pushed || t.wipBranch);
  let skipUncommitted = false;
  let credFixed = !state.flags.repoCredMissing;
  let reachable = !state.flags.clusterUnreachable;
  /* What the workspace setup names, so the check can say exactly what the cluster has, and what it doesn't. */
  const wsSkills = t.skills || [], wsMcp = t.mcp || ['github'];
  let missing = state.flags.clusterMissing ? (wsMcp.find((x) => x !== 'github') || null) : null;
  let without = [];
  let run = 0;
  const A = AGENTS[t.agent];
  const steps = ['Choose cluster', 'Check', 'Run'];
  const stepper = () => `<div class="stepper" aria-label="Step ${step} of 3">${steps.map((s, k) => `${k ? '<span class="bar"></span>' : ''}<span class="st ${k < step - 1 ? 'ok' : k === step - 1 ? 'on' : ''}"><span class="b">${k < step - 1 ? icon('check', 'xs') : k + 1}</span>${s}</span>`).join('')}</div>`;
  /* Where the cluster's fresh run gets its files: the pushed branch, or the last pushed commit if you continue without your changes. */
  const startsFrom = () => (filesFor(t).length && !pushedFirst && skipUncommitted ? { label: 'Last pushed commit', html: 'the last pushed commit', fromLast: true }
    : !filesFor(t).length && !pushedFirst ? { label: 'Base branch main', html: '<span class="mono">main</span> (the task branch was never pushed)', fromBase: 'main' }
      : { label: `Branch ${t.branch}`, html: `<span class="mono">${esc(t.branch)}</span>`, from: t.branch });
  const dlg = openDialog(`<div class="dialog wide" role="dialog" aria-modal="true" aria-labelledby="pm-title" id="pm">
    <div class="dialog-head"><div style="flex:1;min-width:0"><h2 id="pm-title">Run on a remote cluster</h2><p>“${esc(t.title)}” runs again on a remote cluster from the same task file. It's a fresh run with the same goal, agent and workspace setup, and it keeps running with your laptop closed.</p><div id="pm-stepper"></div></div>
      <button class="btn ghost icon" data-action="close-dialog" aria-label="Close">${icon('x')}</button></div>
    <div class="dialog-body" id="pm-body"></div>
    <div class="dialog-foot" id="pm-foot"></div></div>`);
  const body = $('#pm-body', dlg), foot = $('#pm-foot', dlg);
  const cli = () => `<span class="left">${icon('terminal', 'xs')}<code>ax promote ${t.id} --cluster ${cluster}</code></span>`;
  const C = () => CLUSTERS.find((c) => c.name === cluster) || CLUSTERS[0];
  const wsParts = (skip) => [`the repo acme/${t.repo}`].concat(
    wsSkills.length ? [`${plural(wsSkills.length, 'skill')} (${wsSkills.join(', ')})`] : [],
    wsMcp.filter((x) => !skip.includes(x)).length ? [`${plural(wsMcp.filter((x) => !skip.includes(x)).length, 'MCP server')} (${wsMcp.filter((x) => !skip.includes(x)).map(mcpName).join(', ')})`] : []);

  dlg.addEventListener('click', (e) => {
    const f = e.target.closest('[data-fix]'), pm = e.target.closest('[data-pm]');
    if (!f && !pm) return;
    e.stopPropagation();
    const id = f ? f.dataset.fix : pm.dataset.pm;
    if (id === 'retry-preflight') { reachable = true; state.flags.clusterUnreachable = false; draw(); }
    else if (id === 'keep-local') { closeDialog(); toast(`Keeping “${esc(t.title)}” on this computer. Nothing changed.`, { icon: 'laptop' }); }
    else if (id === 'copy-upgrade') copyText(`Hi! Could ${cluster} be upgraded to AX 0.9 or later? My AX Studio tasks use guardrails presets, which need it. Thanks!`, 'Upgrade request copied. Paste it to the cluster owner.');
    else if (id === 'pick-cluster') { step = 1; cluster = 'ax-dev-us-central'; draw(); }
    else if (id === 'add-repo-cred') {
      f.disabled = true; f.innerHTML = `${icon('loader', 'sm spin')}Waiting for your browser…`;
      setTimeout(() => { credFixed = true; state.flags.repoCredMissing = false; toast(`GitHub access added for ${esc(cluster)} · team-agents`, { icon: 'checkCircle' }); draw(); }, 1300);
    } else if (id === 'ask-admin-cred') copyText(`Hi! Could you add a GitHub credential for the team-agents namespace on ${cluster}, so AX tasks can read acme/${t.repo}? Thanks!`, 'Request copied. Paste it to your admin.');
    else if (id === 'push-first') {
      pushedFirst = true; t.wipBranch = true;
      pushEvent(t, { type: 'pushed', at: now(), branch: t.branch });
      toast(`Pushed ${plural(filesFor(t).length, 'file')} to <span class="mono">${esc(t.branch)}</span>`, { icon: 'branch' });
      draw();
    } else if (id === 'skip-uncommitted') { skipUncommitted = true; draw(); }
    else if (id === 'run-without') { without = [missing]; missing = null; state.flags.clusterMissing = false; draw(); }
    else if (id === 'ask-admin-mcp') copyText(`Hi! Could the ${mcpName(missing)} MCP server be added to ${cluster}'s catalog? My AX task “${t.title}” uses it in its workspace setup. Thanks!`, 'Request copied. Paste it to your admin.');
    else if (id === 'ask-admin-role') copyText(`Hi! Could you give me the agent-runner role in the team-agents namespace on ${cluster}? I'd like to run AX tasks there. Thanks!`, 'Request copied. Paste it to your admin.');
    else if (id === 'rerun') draw();
  });

  const draw = async () => {
    const my = ++run;
    $('#pm-stepper', dlg).innerHTML = stepper();
    if (step === 1) {
      body.innerHTML = `<div class="radio-list" role="radiogroup" aria-label="Cluster">${CLUSTERS.filter((c) => c.access).map((c) => `<button type="button" class="radio-card" role="radio" data-cl="${c.name}" aria-checked="${cluster === c.name}"><span class="rc-dot"></span><span class="rc-main"><span class="rc-title">${c.name}</span><span class="rc-desc">${c.desc}</span></span><span class="rc-right">${versionBadge(c)}<span class="xsmall muted" style="display:block;margin-top:6px">${c.running} agents running</span></span></button>`).join('')}</div>${noAccessHTML()}${otherConnectHTML(cluster, 'promote')}`;
      foot.innerHTML = `${cli()}<button class="btn ghost" data-action="close-dialog">Cancel</button><button class="btn primary" id="pm-next">Continue${icon('arrowRight', 'sm')}</button>`;
      body.querySelectorAll('[data-cl]').forEach((b) => b.addEventListener('click', (e) => {
        state.inviteOpen = !!b.closest('.other-connect');
        cluster = b.dataset.cl; draw();
      }));
      const inv = $('#pm-invite', dlg);
      if (inv) inv.addEventListener('click', () => {
        const inp = $('#invite-url', dlg); const st = $('#invite-status', dlg);
        const cl = inviteCluster(inp && inp.value);
        if (!cl) { st.className = 'field-status err'; st.innerHTML = `${icon('alert', 'sm')}Paste the full link your team sent, like https://ax.acme.dev/join/…`; inp.setAttribute('aria-invalid', 'true'); inp.focus(); return; }
        state.inviteOpen = false; cluster = cl; draw();
        toast(`Invite accepted. ${cl} is selected.`, { icon: 'checkCircle' });
      });
      $('#pm-next', dlg).addEventListener('click', () => { step = 2; draw(); });
    } else if (step === 2) {
      const c = C();
      const files = filesFor(t);
      if (!reachable) {
        body.innerHTML = `<div class="wait-turn"><span class="nn-icon running">${icon('loader', 'sm spin')}</span><div><div class="wt-title">Connecting to ${esc(cluster)}…</div><div class="wt-sub">Checking access, versions and policies.</div></div></div>`;
        foot.innerHTML = `${cli()}<button class="btn ghost" id="pm-back">Back</button><button class="btn primary" disabled>${icon('cloudUp', 'sm')}Run on ${esc(cluster)}</button>`;
        $('#pm-back', dlg).addEventListener('click', () => { step = 1; draw(); });
        await sleep(reducedMotion() ? 0 : 900);
        if (my !== run || !document.contains(body)) return;
        body.innerHTML = failCardHTML('cluster-unreachable', { cluster });
        return;
      }
      const allowCount = state.allow.filter((a) => a.scope === 'all' || a.scope === t.repo).length;
      const needsDecision = files.length && !pushedFirst && !skipUncommitted;
      const sf = startsFrom();
      const rows = [
        state.flags.clusterForbidden === cluster ? { cls: 'no', block: 'cluster-forbidden' } : { cls: 'ok', title: `Access verified on ${cluster}`, desc: 'GKE · Agent Substrate v1alpha1 · you have the agent-runner role in team-agents' },
        c.compat ? { cls: 'ok', title: 'Versions are compatible', desc: `Cluster runs AX ${c.version} · your Studio and CLI are 0.9.2` } : { cls: 'no', block: 'cluster-version' },
        { cls: 'ok', title: 'Same task file, 0 edits', desc: `The task (goal and template), the workspace setup and the guardrails are valid on ${cluster} as they are · ${allowCount} allowed sites carry over` },
        missing ? { cls: 'no', block: 'cluster-missing' }
          : without.length ? { cls: 'warn', title: `Running without the ${mcpName(without[0])} MCP server`, desc: `It isn't in ${cluster}'s catalog, so the agent won't have those tools there. The rest is rebuilt as it is: ${wsParts(without).join(', ')}` }
            : { cls: 'ok', title: 'The workspace can be rebuilt there', desc: `${cluster} has everything your workspace setup names: ${wsParts([]).join(', ')}` },
        credFixed ? { cls: 'ok', title: `${cluster} can read acme/${t.repo}`, desc: 'GitHub access through the team-agents credential · no token in the sandbox' } : { cls: 'no', block: 'cluster-blocker' },
        files.length ? (pushedFirst ? { cls: 'ok', title: `Files come from ${t.branch}`, desc: 'The cluster rebuilds the workspace from your workspace setup and this branch' }
          : skipUncommitted ? { cls: 'warn', title: `Starting without ${plural(files.length, 'unpushed file')}`, desc: 'They stay in your sandbox on this computer. The cluster starts from the last pushed commit.' }
            : { cls: 'warn', decide: true, title: `${plural(files.length, 'changed file isn\'t', 'changed files aren\'t')} on a branch yet`, desc: "The cluster rebuilds the workspace from your workspace setup and branch, so changes that aren't pushed stay on this computer." })
          : { cls: 'ok', title: 'No unpushed changes', desc: 'The cluster rebuilds the workspace from your workspace setup' },
        { cls: 'warn', title: 'Starts a fresh run', desc: `Files move through the branch. The conversation doesn't move: ${cluster} starts a new session, ${A.name}'s conversation so far stays on this computer, and the run here stops at the end of its current step. Moving live work over comes in a later release.` },
        { cls: 'warn', title: 'Organization guardrails attach on their own', desc: `VPC perimeter · Model Armor DLP · $${ORG_BUDGET} budget cap per task · blocks pastebin.com and transfer.sh. Nothing to configure.` },
      ];
      const blockers = rows.filter((r) => r.block).length;
      body.innerHTML = `
        <div class="policy-diff">
          <div class="pd-col"><div class="pd-lbl">${icon('laptop', 'xs')}On this computer</div><div class="pd-row"><span>Task file</span><b>ax.yaml</b></div><div class="pd-row"><span>Starts from</span><b>Local sandbox</b></div><div class="pd-row"><span>Conversation</span><b>This run</b></div><div class="pd-row"><span>Keys</span><b>Keychain proxy</b></div><div class="pd-row"><span>Budget</span><b>$${t.budget || 5} check-in</b></div><div class="pd-row"><span>Laptop closed</span><b>Pauses</b></div></div>
          <div class="pd-arrow" aria-hidden="true">${icon('arrowRight')}</div>
          <div class="pd-col on"><div class="pd-lbl">${icon('cloud', 'xs')}${esc(cluster)}</div><div class="pd-row"><span>Task file</span><b class="ok">Unchanged (0 edits)</b></div><div class="pd-row"><span>Starts from</span><b>${esc(sf.label)}</b></div><div class="pd-row"><span>Conversation</span><b>Starts fresh</b></div><div class="pd-row"><span>Keys</span><b>Org vault + DLP</b></div><div class="pd-row"><span>Budget</span><b>$${ORG_BUDGET} cap (org)</b></div><div class="pd-row"><span>Laptop closed</span><b class="ok">Keeps running</b></div></div>
        </div>
        <ul class="check-list" id="pm-checks" style="margin-top:12px"></ul>`;
      const okToMove = () => !blockers && !needsDecision;
      foot.innerHTML = `${cli()}<button class="btn ghost" id="pm-back">Back</button><button class="btn" data-pm="rerun">${icon('refresh', 'sm')}Check again</button><button class="btn primary" id="pm-next" disabled>${icon('cloudUp', 'sm')}Run on ${esc(cluster)}</button>`;
      $('#pm-back', dlg).addEventListener('click', () => { step = 1; draw(); });
      const ul = $('#pm-checks', dlg);
      for (const r of rows) {
        const li = document.createElement('li');
        li.className = 'check-item pending enter';
        li.innerHTML = `<span class="ci-icon">${icon('loader')}</span><div><div class="ci-title">${esc(r.title || 'Checking compatibility…')}</div><div class="ci-desc">Checking…</div></div>`;
        ul.appendChild(li);
        await sleep(reducedMotion() ? 0 : 260);
        if (my !== run || !document.contains(ul)) return;
        if (r.block) {
          li.className = 'check-item no blocker';
          li.innerHTML = `<span class="ci-icon">${icon('x')}</span><div style="min-width:0">${failCardHTML(r.block, { cluster, repo: t.repo, compact: true, missing: missing ? mcpName(missing) : '', others: wsParts([missing]).join(', ') })}</div>`;
        } else {
          li.className = 'check-item ' + r.cls;
          li.innerHTML = `<span class="ci-icon">${icon(r.cls === 'ok' ? 'check' : 'alert')}</span><div><div class="ci-title">${esc(r.title)}</div><div class="ci-desc">${esc(r.desc)}</div>${r.decide ? `<div class="btn-row" style="margin-top:10px"><button class="btn sm primary" data-pm="push-first">${icon('branch', 'sm')}Push to ${esc(t.branch)} first</button><button class="btn sm" data-pm="skip-uncommitted">Continue without them</button></div>` : ''}</div>`;
        }
      }
      const nx = $('#pm-next', dlg);
      if (nx && okToMove()) { nx.disabled = false; nx.addEventListener('click', () => { step = 3; draw(); }); }
      else if (nx) nx.title = blockers ? 'Fix the blocker above, then check again' : 'Choose what to do with your unpushed changes';
    } else if (step === 3) {
      const sf = startsFrom();
      const phases = [`Sending the task file to ${cluster}`, 'Stopping the run on this computer at the end of its step', `Asking ${cluster} to rebuild the workspace from ${sf.fromLast ? 'the last pushed commit' : t.branch}`];
      foot.innerHTML = `<span class="left">You can close this. We'll keep going.</span><button class="btn ghost" data-action="close-dialog">Hide</button>`;
      for (let k = 0; k <= phases.length; k++) {
        if (!document.contains(body)) break;
        body.innerHTML = `<div role="progressbar" aria-label="Starting on ${esc(cluster)}" aria-valuemin="0" aria-valuemax="${phases.length}" aria-valuenow="${k}" aria-valuetext="Step ${Math.min(k + 1, phases.length)} of ${phases.length}: ${esc(k < phases.length ? phases[k] : 'Done')}"><div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:14px"><strong>${k < phases.length ? phases[k] + '…' : 'Done'}</strong><span class="muted">${Math.min(k + 1, phases.length)} of ${phases.length}</span></div><div class="meter"><span style="width:${Math.max(4, (k / phases.length) * 100)}%"></span></div></div>
          <ul class="check-list" style="margin-top:12px">${phases.map((p, j) => `<li class="check-item ${j < k ? 'ok' : j === k ? 'pending' : 'idle'}"><span class="ci-icon">${icon(j < k ? 'check' : j === k ? 'loader' : 'clock')}</span><div><div class="ci-title">${esc(p)}</div></div></li>`).join('')}</ul>`;
        await sleep(reducedMotion() ? 0 : 620);
      }
      promoteTask(t, cluster, Object.assign({}, sf, { without }));
      if (document.contains(body)) {
        $('#pm-stepper', dlg).innerHTML = '';
        body.innerHTML = `<div style="display:grid;justify-items:center;text-align:center;padding:12px 0 4px">
          <span class="dialog-badge lg ok">${icon('checkCircle', 'lg')}</span>
          <h3 class="h-display-sm" style="margin-top:12px">Starting on ${esc(cluster)}</h3>
          <p class="sub small" style="margin-top:6px;max-width:48ch">A fresh run is starting from the same task file and ${sf.html}. The cluster is rebuilding the workspace now, and each step shows in Activity. The run on this computer stopped at the end of its step, and its Activity stays here. Close your laptop anytime, and watch here or with <code style="white-space:nowrap">ax logs ${t.id} --follow</code>.</p></div>`;
        foot.innerHTML = `<span class="left"></span><button class="btn primary" data-action="close-dialog">Done</button>`;
        const b = foot.querySelector('.btn'); if (b) b.focus();
      }
    }
  };
  draw();
}

/* ---------- Generic failure dialog (review failures use the same fail-card) ---------- */
function openFailureDialog(code, t, title) {
  openDialog(dialogShell('fd', title || 'Something needs your attention', '', failCardHTML(code, { t, noTitle: false }), '', true, (ERRORS[code] && ERRORS[code].icon) || 'alert'));
}
function openProxyHelp() {
  openDialog(dialogShell('px', 'Proxy settings', 'AX uses your system proxy for downloads.', `
    <ol class="after-list" style="margin-top:0">
      <li><span class="ab">1</span><span><b>Check the proxy</b>System Settings → Network → Details → Proxies. AX uses the same settings as your browser.</span></li>
      <li><span class="ab">2</span><span><b>Sign in to the proxy if it asks</b>Some company proxies need you to sign in once in a browser before command-line tools can use them.</span></li>
      <li><span class="ab">3</span><span><b>Or set it for AX only</b><code>ax config set proxy http://proxy.acme.internal:8080</code></span></li>
    </ol>`, `<span class="left">${icon('terminal', 'xs')}<code>ax setup --resume</code></span><button class="btn primary" data-action="close-dialog">Done</button>`, false, 'globe'));
}

/* ---------- Results export (F17: changes, files, Activity and logs together) ---------- */
function openExportResults(t) {
  const items = [['patch', 'Changes as a patch', `${t.id}-changes.patch`, true], ['files', 'Changed files, full text', `${t.id}-files.txt`, true], ['oatr', 'Activity (OATR trajectory)', `${t.id}.oatr.json`, true], ['logs', 'Logs', `${t.id}-logs.txt`, true]];
  const dlg = openDialog(dialogShell('ex', 'Export results', `Everything from “${esc(t.title)}”, with secrets removed.`, `
    <div class="check-rows">${items.map(([k, l, f, on]) => `<label class="check-row" style="padding:8px 0"><input type="checkbox" data-ex="${k}" ${on ? 'checked' : ''}> <span><b>${l}</b> <span class="mono xsmall muted">${f}</span></span></label>`).join('')}</div>
    <p class="xsmall muted" style="margin-top:10px">${icon('lock', 'xs')} Credentials are injected outside the sandbox, so they never appear in exports.</p>`,
    `<span class="left">${icon('terminal', 'xs')}<code>ax export ${t.id} --results --out ./${t.id}-results</code></span><button class="btn ghost" data-action="close-dialog">Cancel</button><button class="btn primary" id="ex-go">${icon('download', 'sm')}Download</button>`, false, 'download'));
  $('#ex-go', dlg).addEventListener('click', () => {
    const picked = $$('[data-ex]', dlg).filter((x) => x.checked).map((x) => x.dataset.ex);
    closeDialog(true);
    if (!picked.length) { toast('Nothing selected, so nothing was saved.', { icon: 'info' }); return; }
    const files = filesFor(t);
    const out = {
      patch: () => [`${t.id}-changes.patch`, patchText(t)],
      files: () => [`${t.id}-files.txt`, files.map((f) => `===== ${f.path} =====\n${f.lines.filter((l) => l[0] !== '-' && l[0] !== '@').map((l) => l.slice(1)).join('\n')}`).join('\n\n')],
      oatr: () => [`${t.id}.oatr.json`, oatrJSON(t)],
      logs: () => [`${t.id}-logs.txt`, rawLogText(t)],
    };
    picked.forEach((k, i) => { const [name, text] = out[k](); setTimeout(() => downloadText(name, text), i * 150); });
    toast(`Saved ${plural(picked.length, 'file')} to your Downloads folder · secrets removed`, { icon: 'download' });
  });
}

/* ---------- Privacy: delete all Activity (F10) ---------- */
function openDeleteActivity() {
  const dlg = openDialog(dialogShell('da', 'Delete all Activity?', '', `
    <p class="small">This removes the Activity (trajectories) for all ${state.tasks.length} tasks on this computer. It can't be undone.</p>
    <ul class="check-list" style="margin-top:10px">
      <li class="check-item no"><span class="ci-icon">${icon('trash')}</span><div><div class="ci-title">Removed</div><div class="ci-desc">Prompts, agent thoughts, tool calls and outputs</div></div></li>
      <li class="check-item ok"><span class="ci-icon">${icon('check')}</span><div><div class="ci-title">Kept</div><div class="ci-desc">Changes, branches, workspaces and settings</div></div></li>
    </ul>`, `<span class="left">${icon('terminal', 'xs')}<code>ax activity delete --all</code></span><button class="btn ghost" data-action="close-dialog">Cancel</button><button class="btn danger" id="da-go">${icon('trash', 'sm')}Delete all Activity</button>`, false, 'trash'));
  $('#da-go', dlg).addEventListener('click', () => {
    closeDialog(true);
    /* Removes prompts, thoughts, tool calls and outputs. Anything still waiting on you stays, so no decision is lost. */
    const day = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    let n = 0;
    state.tasks.forEach((t) => {
      const keep = t.events.filter((e) => (e.type === 'question' && !e.answer && !e.superseded) || (['blocked', 'permission', 'budget'].includes(e.type) && !e.resolved) || (e.type === 'fail' && t.status === 'failed' && e === lastFail(t).e));
      t.events = [{ type: 'note', at: now(), text: `Activity deleted on ${day}. Changes and branches are kept.` }].concat(keep);
      t.spark = null; n++;
    });
    state.blockedLog = [];
    render({ keepScroll: true });
    toast(`Deleted Activity for ${plural(n, 'task')}. Changes and branches are kept.`, { icon: 'trash' });
  });
}

/* ---------- Uninstall (F11: say what's removed, offer to keep workspaces) ---------- */
function openUninstall() {
  const dlg = openDialog(dialogShell('un', 'Uninstall AX Studio', 'Your code folders are never touched.', `
    <ul class="check-list">
      <li class="check-item no"><span class="ci-icon">${icon('trash')}</span><div><div class="ci-title">Local sandbox environment</div><div class="ci-desc">microVM, k3s and Guardrails · 1.1 GB</div></div></li>
      <li class="check-item no"><span class="ci-icon">${icon('trash')}</span><div><div class="ci-title">Agent images</div><div class="ci-desc">Antigravity, Claude Code, Codex · 3.8 GB</div></div></li>
      <li class="check-item no"><span class="ci-icon">${icon('trash')}</span><div><div class="ci-title">Activity and settings</div><div class="ci-desc">Trajectories for ${state.tasks.length} tasks, preferences, allowlists</div></div></li>
      <li class="check-item no"><span class="ci-icon">${icon('trash')}</span><div><div class="ci-title">Stored credentials</div><div class="ci-desc">AX keychain entries for your agents and GitHub</div></div></li>
    </ul>
    <label class="consent-row" style="margin-top:14px"><span class="cr-text"><b>Keep my workspaces</b><span>Task files and branches stay in <code>~/.ax/workspaces</code> (1.2 GB), so you can pick up later.</span></span><span class="switch"><input type="checkbox" role="switch" id="un-keep" checked aria-label="Keep my workspaces"><span class="track"></span><span class="thumb"></span></span></label>`,
    `<span class="left">${icon('terminal', 'xs')}<code id="un-cli">ax uninstall --keep-workspaces</code></span><button class="btn ghost" data-action="close-dialog">Cancel</button><button class="btn danger" id="un-go">Uninstall</button>`, true, 'trash'));
  const keep = $('#un-keep', dlg);
  keep.addEventListener('change', () => { $('#un-cli', dlg).textContent = keep.checked ? 'ax uninstall --keep-workspaces' : 'ax uninstall'; });
  $('#un-go', dlg).addEventListener('click', async () => {
    const b = $('#un-go', dlg); b.disabled = true; b.innerHTML = `${icon('loader', 'sm spin')}Removing…`;
    await sleep(reducedMotion() ? 0 : 1200);
    if (!document.contains(b)) return;
    $('.dialog-body', dlg).innerHTML = `<div style="display:grid;justify-items:center;text-align:center;padding:14px 0 6px"><span class="dialog-badge lg ok">${icon('checkCircle', 'lg')}</span><h3 class="h-display-sm" style="margin-top:12px">AX Studio was removed</h3><p class="sub small" style="margin-top:6px;max-width:46ch">${keep.checked ? 'Your workspaces are kept in ~/.ax/workspaces. ' : ''}Your code folders were not touched. (Prototype: nothing was actually removed.)</p></div>`;
    $('.dialog-foot', dlg).innerHTML = `<span class="left"></span><button class="btn" data-action="close-dialog">Close</button>`;
  });
}

/* ---------- Add a template (CUJ 2 · pre-built vs. find a template or bring your own agent) ----------
   Browse: agents your team shared (org registry, after sign-in), verified by AX, or community, each with what it needs,
   what it can reach and why you can trust it. Bring your own: a folder (e.g. an ADK agent), a container image, or a Git repo.
   AX checks it first (builds in the sandbox, speaks the AX harness protocol, no secrets inside), then it joins your agents. */
const BYO_KINDS = {
  folder: { label: 'Folder', desc: 'An agent you built, e.g. with ADK. No Dockerfile needed.', field: 'Folder' },
  image: { label: 'Container image', desc: 'Any OCI image that runs your agent.', field: 'Image', placeholder: 'ghcr.io/you/your-agent:1.0' },
  git: { label: 'Git repository', desc: 'AX clones it and builds it in the sandbox.', field: 'Repository URL', placeholder: 'https://github.com/you/your-agent' },
};
const BYO_FOLDERS = ['~/code/triage-agent', '~/code/release-notes-agent', '~/code/legacy-bot'];
const BYO_KNOWN = {
  'triage-agent': { desc: 'Labels new issues, finds duplicates and drafts a first reply.', files: 38 },
  'release-notes-agent': { desc: 'Drafts release notes from the pull requests merged since the last tag.', files: 24 },
  'legacy-bot': { desc: 'An older Python bot.', files: 61, legacy: true },
  'standup-agent': { desc: 'Summarizes yesterday’s commits and open reviews for stand-up.', files: 19, secret: true },
};
const HARNESS_SNIPPET = 'pip install ax-harness\n\n# agent.py\nfrom ax_harness import serve\nserve(root_agent)  # start, stream Activity, stop at a turn';
let catState = null;

function catSrcBadge(c) {
  const ic = { team: 'lock', verified: 'shieldCheck', community: 'globe', yours: 'laptop' }[c.source] || 'box';
  return `<span class="src-badge s-${c.source}">${icon(ic, 'xs')}${agentSource(c).label}</span>`;
}
function catMatches(c, cs) {
  if (cs.filter !== 'all' && c.source !== cs.filter) return false;
  const q = cs.q.trim().toLowerCase();
  return !q || [c.name, c.desc, c.publisher, c.framework, c.model, c.cli].join(' ').toLowerCase().includes(q);
}
function catRowHTML(c) {
  const added = AGENTS[c.id] && !AGENTS[c.id].removed;
  return `<button type="button" class="cat-row" data-cat="${c.id}">
    ${agentTile(c.id, 'lg')}
    <span class="cr-main"><span class="cr-title">${esc(c.name)}</span><span class="cr-desc">${esc(c.desc)}</span><span class="cr-meta">${esc(c.publisher)} · v${esc(c.version)} · ${esc(c.users)}</span></span>
    <span class="cr-right">${added ? `<span class="cr-added">${icon('check', 'xs')}Added</span>` : ''}${catSrcBadge(c)}${icon('chevRight', 'sm cr-chev')}</span>
  </button>`;
}
function catResultsHTML(cs) {
  const groups = [['team', state.teamRegistry ? `Your team · ${esc(state.teamRegistry.split('/')[0])}` : 'Your team'], ['verified', 'Verified by AX'], ['community', 'Community']];
  let out = '', n = 0;
  for (const [src, label] of groups) {
    if (cs.filter !== 'all' && cs.filter !== src) continue;
    if (src === 'team' && !state.teamRegistry) {
      out += `<div class="cat-group"><div class="cat-kicker">${label}</div>
        <div class="cat-signin"><div class="cs-copy"><b>See templates your team shared</b><span>Add the registry address your platform team gave you. Its templates run with your organization’s guardrails.</span></div>
        ${cs.regOpen ? `<div class="cat-reg"><label class="sr-only" for="cat-reg">Registry address</label><input class="input mono" id="cat-reg" placeholder="registry.acme.dev/ax" autocomplete="off" spellcheck="false" aria-describedby="cat-reg-status"><button type="button" class="btn sm" data-catx="registry-add">Add</button><span class="field-status cat-reg-status" id="cat-reg-status" role="status"><span class="hint">Same from the command line: <span class="mono">ax templates registry add &lt;address&gt;</span></span></span></div>`
          : `<button type="button" class="btn sm" data-catx="registry">${icon('plus', 'sm')}Add registry…</button>`}</div></div>`;
      continue;
    }
    const items = AGENT_CATALOG.filter((c) => c.source === src && catMatches(c, cs));
    if (!items.length) continue;
    n += items.length;
    out += `<div class="cat-group" role="group" aria-label="${esc(label)}"><div class="cat-kicker" aria-hidden="true">${label}</div>${items.map(catRowHTML).join('')}</div>`;
  }
  if (!n && cs.q.trim()) out += `<div class="cat-empty"><b>No templates match “${esc(cs.q.trim())}”</b><span>Try another word, or bring an agent you built.</span><button type="button" class="link" data-catx="to-byo">Bring your own agent</button></div>`;
  return { html: out, n };
}
function catBrowseHTML(cs) {
  const r = catResultsHTML(cs);
  return `<div class="cat-tools">
      <div class="cat-search">${icon('search', 'sm')}<label class="sr-only" for="cat-q">Search templates</label><input id="cat-q" class="input" type="search" placeholder="Search templates, e.g. review, upgrade, Gemini" autocomplete="off" spellcheck="false" value="${esc(cs.q)}" autofocus></div>
      <div class="seg cat-filters" role="radiogroup" aria-label="Show templates from">${[['all', 'All'], ['team', 'Your team'], ['verified', 'Verified'], ['community', 'Community']].map(([k, l]) => `<button type="button" role="radio" aria-checked="${cs.filter === k}" data-catf="${k}">${l}</button>`).join('')}</div>
    </div>
    <div class="sr-only" id="cat-status" role="status">${plural(r.n, 'template')} shown</div>
    <div class="cat-results" id="cat-results">${r.html}</div>`;
}
/** Your team's templates come from a registry address (there's no login). A plausible host, with an optional path. */
function addTeamRegistry(cs, dlg) {
  const inp = $('#cat-reg', dlg), st = $('#cat-reg-status', dlg);
  const v = cleanText(inp ? inp.value : '', 120).replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/[\w.-]+)*$/i.test(v)) {
    if (st) { st.className = 'field-status cat-reg-status err'; st.innerHTML = `${icon('alert', 'sm')}Paste the address your platform team shared, like registry.acme.dev/ax`; }
    if (inp) { inp.setAttribute('aria-invalid', 'true'); inp.focus(); }
    return false;
  }
  state.teamRegistry = v;
  try { localStorage.setItem('ax.registry', v); } catch (e) { /* ignore */ }
  cs.regOpen = false;
  catRedrawResults(cs, dlg);
  announce(`Added ${v}. Your team's templates are shown.`);
  const first = $('.cat-group [data-cat]', dlg); if (first) first.focus({ preventScroll: true });
  return true;
}
function catDetailHTML(cs) {
  const c = AGENT_CATALOG.find((x) => x.id === cs.sel);
  if (!c) return '';
  const k = c.keyFrom && AGENTS[c.keyFrom];
  const modelOk = c.keyFrom ? !!(k && k.connected) : googleSignedIn();
  const modelDesc = c.keyFrom
    ? (modelOk ? `Uses your key from ${k.name} (${k.keyHint || '••••'})` : `Needs an ${c.keyLabel}, added once`)
    : (modelOk ? 'Uses your Google sign-in' : 'Sign in with Google when you pick it');
  const allowed = (dmn) => state.allow.some((a) => a.domain === dmn || dmn.endsWith('.' + a.domain));
  const row = (cls, title, desc, mono) => `<li class="check-item ${cls}"><span class="ci-icon">${icon(cls === 'ok' ? 'check' : cls === 'warn' ? 'hand' : 'info')}</span><div><div class="ci-title${mono ? ' mono' : ''}">${title}</div><div class="ci-desc">${desc}</div></div></li>`;
  const reach = [row('ok', esc(c.modelApi), 'Model API · key added outside the sandbox', true)]
    .concat((c.reach || []).map((dmn) => row(allowed(dmn) ? 'ok' : 'warn', esc(dmn), allowed(dmn) ? `Already allowed by your ${esc((GUARDRAIL_PRESETS[state.guardrailPreset] || GUARDRAIL_PRESETS.balanced).name)} preset` : 'Guardrails asks you first', true)));
  const trust = c.source === 'community'
    ? `<div class="cd-trust warn">${icon('alert', 'sm')}<span><b>Not reviewed by AX.</b> It runs in its own sandbox with Guardrails, so check what it can reach first. Remote clusters may not allow community images.</span></div>`
    : `<div class="cd-trust">${icon('shieldCheck', 'sm')}<span><b>Signed image</b> <span class="mono">${esc(c.digest)}</span> · ${c.source === 'team' ? `published by ${esc(c.publisher)}` : 'rebuilt and checked by AX for every release'}. Runs on this computer and on remote clusters, unchanged.</span></div>`;
  return `<div class="cat-detail">
    <button type="button" class="btn ghost sm cat-back" data-catx="back">${icon('chevLeft', 'sm')}All templates</button>
    <div class="cd-head">${agentTile(c.id, 'lg')}<div class="cd-id"><h3 class="cd-name" id="cd-name" tabindex="-1">${esc(c.name)}</h3><div class="cd-meta">${esc(c.publisher)} · v${esc(c.version)} · ${esc(c.framework)} · updated ${esc(c.updated)}</div></div>${catSrcBadge(c)}</div>
    <p class="cd-desc">${esc(c.desc)}</p>
    ${trust}
    <div class="cd-grid">
      <section aria-labelledby="cd-k1"><h4 class="cat-kicker" id="cd-k1">Model and sign-in</h4><ul class="check-list">${row(modelOk ? 'ok' : 'warn', esc(c.model), modelDesc)}${(c.tools || []).length ? row('ok', esc(c.tools.join(', ')), 'Tokens stay outside the sandbox') : ''}</ul></section>
      <section aria-labelledby="cd-k2"><h4 class="cat-kicker" id="cd-k2">What it can reach</h4><ul class="check-list">${reach.join('')}</ul><p class="cd-note">Everything else is paused until you allow it.</p></section>
    </div>
  </div>`;
}
function byoInputError(kind, v) {
  if (kind === 'image' && !/^[\w.-]+(:\d+)?(\/[\w.-]+)+(:[\w.-]+)?(@sha256:[a-f0-9]{6,})?$/i.test(v)) return v ? 'That doesn’t look like an image name, e.g. ghcr.io/you/your-agent:1.0' : 'Enter the image name, e.g. ghcr.io/you/your-agent:1.0';
  if (kind === 'git' && !/^(https:\/\/[\w.-]+\/[\w./-]+|git@[\w.-]+:[\w./-]+)$/i.test(v)) return v ? 'Use an https:// or git@ link to the repository' : 'Enter the repository URL, e.g. https://github.com/you/your-agent';
  return '';
}
/** The agent's short name from a folder, image or repo ("~/code/triage-agent", "ghcr.io/you/triage-agent:1.0" → triage-agent). */
function byoBase(kind, v) {
  let s = String(v || '').trim();
  if (kind === 'image') s = s.replace(/@sha256:.*$/i, '');
  s = s.replace(/\.git$/i, '').replace(/\/+$/, '');
  let last = s.split('/').pop() || '';
  if (kind === 'image') last = last.replace(/:[^:]*$/, '');
  if (kind === 'git') last = last.split(':').pop();
  return (last || 'my-agent').toLowerCase().replace(/[^a-z0-9._-]/g, '-');
}
/** What AX finds when it checks an agent you bring (simulated, deterministic per input). */
function byoPlan(kind, v, fixed) {
  const base = byoBase(kind, v);
  const known = BYO_KNOWN[base] || {};
  /* `fixed`: you followed "How to fix it" and checked again, so the check that failed now passes (and says what it found). */
  const wasLegacy = !!known.legacy || /legacy/i.test(v), wasSecret = !!known.secret || /secret/i.test(v);
  const legacy = wasLegacy && !fixed, secret = wasSecret && !fixed;
  const name = cleanText(base.replace(/[-_]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()), 40) || 'My Agent';
  const tag = kind === 'image' ? ((v.match(/:([\w.-]+)$/) || [])[1] || 'latest') : 'dev';
  const host = kind === 'image' ? v.split('/')[0] : kind === 'git' ? v.replace(/^https:\/\/|^git@/, '').replace(/\.git$/, '').replace(':', '/') : v;
  const rows = [];
  if (kind === 'folder') rows.push(legacy ? { cls: 'ok', title: 'Found a Python agent', desc: 'bot.py · no agent.yaml yet' }
    : wasLegacy ? { cls: 'ok', title: 'Found a Python agent', desc: 'bot.py · agent.py with the AX harness adapter' } : { cls: 'ok', title: 'Found an ADK agent', desc: 'agent.py → root_agent · Python 3.12 · agent.yaml' });
  if (kind === 'image') rows.push({ cls: 'ok', title: 'Pulled the image', desc: `${v} · 386 MB` });
  if (kind === 'git') rows.push({ cls: 'ok', title: 'Cloned the repository', desc: `${host} · main · agent.yaml found` });
  if (kind === 'image') rows.push(/unsigned|:latest$/i.test(v) || tag === 'latest' ? { cls: 'warn', title: 'Not signed', desc: 'Fine to try on this computer. Remote clusters may only accept signed images.' } : { cls: 'ok', title: 'Signed with Sigstore', desc: 'Signature checked · the image hasn’t changed since it was signed' });
  else rows.push({ cls: 'ok', title: 'Built in the sandbox', desc: 'No Docker needed · 418 MB · cached for next time' });
  rows.push(legacy
    ? { cls: 'no', title: 'Doesn’t speak the AX harness protocol yet', desc: 'AX couldn’t find a way to start it, stream its Activity, or stop it at a turn boundary.', fix: 'harness' }
    : { cls: 'ok', title: 'Speaks the AX harness protocol', desc: wasLegacy ? 'Found the ax-harness adapter · starts, streams Activity, and stops cleanly at a turn boundary' : 'Starts, streams Activity, and stops cleanly at a turn boundary' });
  rows.push(secret
    ? { cls: 'no', title: 'Found a secret in .env', desc: 'GEMINI_API_KEY=AIza•••• would be copied into the agent’s image.', fix: 'secret' }
    : { cls: 'ok', title: 'No secrets inside', desc: wasSecret ? `.env is left out now · 0 keys or tokens in ${known.files || 42} files` : `0 keys or tokens in ${known.files || 42} files` });
  rows.push(googleSignedIn()
    ? { cls: 'ok', title: 'Uses Gemini 3 Flash', desc: 'With your Google sign-in from the keychain, added outside the sandbox' }
    : { cls: 'warn', title: 'Uses Gemini 3 Flash', desc: 'You’ll sign in with Google, or add a Gemini API key, before it runs' });
  return { kind, v, base, name, tag, host, rows, desc: known.desc };
}
function byoFixHTML(r) {
  if (r.fix === 'harness') return `<div class="byo-fix"><div class="bf-title">How to fix it</div><p>Wrap your agent with the AX harness adapter, then check again.</p><pre class="manifest bf-code">${esc(HARNESS_SNIPPET)}</pre><button type="button" class="btn sm" data-catx="copy-fix">${icon('copy', 'sm')}Copy snippet</button></div>`;
  if (r.fix === 'secret') return `<div class="byo-fix"><div class="bf-title">How to fix it</div><p>Delete the key from <span class="mono">.env</span>, or add <span class="mono">.env</span> to <span class="mono">.axignore</span>. AX adds keys outside the sandbox, so your agent never needs them in its files.</p></div>`;
  return '';
}
function byoChecksHTML(cs) {
  const b = cs.byo;
  if (b.phase === 'idle') return `<p class="byo-hint">Before adding it, AX checks that your agent builds in the sandbox, speaks the AX harness protocol, and has no secrets inside.</p>`;
  const items = b.rows.map((r) => `<li class="check-item ${r.cls}"><span class="ci-icon">${icon(r.cls === 'pending' ? 'loader' : r.cls === 'ok' ? 'check' : r.cls === 'no' ? 'x' : 'alert')}</span><div style="min-width:0"><div class="ci-title">${esc(r.title)}</div><div class="ci-desc">${r.cls === 'pending' ? 'Checking…' : esc(r.desc)}</div>${r.cls === 'no' ? byoFixHTML(r) : ''}</div></li>`).join('');
  const fails = b.rows.filter((r) => r.cls === 'no').length;
  const summary = b.phase === 'checking' ? 'Checking your agent…' : fails ? `${plural(fails, 'check needs', 'checks need')} a fix before you can add it.` : `All checks passed. ${esc(b.plan.name)} is ready to add.`;
  const where = b.plan.kind === 'image' ? 'On this computer now, and on remote clusters that can pull from ' + esc(b.plan.host) + '.' : `On this computer now. To run it on a remote cluster, publish it to your team registry: <code>ax templates publish ${esc(b.plan.base)}</code>`;
  return `<ul class="check-list byo-checks">${items}</ul>
    <div class="sr-only" role="status">${summary}</div>
    ${b.phase === 'ok' ? `<div class="byo-done">
      <div class="field"><label for="byo-name">Name in AX Studio</label><input class="input" id="byo-name" value="${esc(b.name)}" maxlength="40" autocomplete="off"></div>
      <p class="byo-where"><b>Where it runs</b>${where}</p></div>` : ''}`;
}
function byoFieldHTML(cs) {
  const b = cs.byo, K = BYO_KINDS[b.kind];
  return b.kind === 'folder'
    ? `<div class="field"><span class="field-label" id="byo-folder-label">Folder</span><div class="src-line src-field" role="group" aria-labelledby="byo-folder-label"><span class="src-ic" aria-hidden="true">${icon('folder')}</span><span class="src-main"><span class="src-path">${esc(b.folder)}</span><span class="src-meta">${BYO_KNOWN[byoBase('folder', b.folder)] && BYO_KNOWN[byoBase('folder', b.folder)].legacy ? 'Python' : 'ADK · Python'}</span></span><button type="button" class="btn sm" data-catx="byo-folder">Change…</button></div></div>`
    : `<div class="field"><label for="byo-input">${K.field}</label><input class="input mono" id="byo-input" placeholder="${K.placeholder}" value="${esc(b.value[b.kind])}" autocomplete="off" spellcheck="false" aria-describedby="byo-err"${b.err ? ' aria-invalid="true"' : ''}><span class="field-status err" id="byo-err" role="alert">${b.err ? icon('alert', 'sm') + esc(b.err) : ''}</span></div>`;
}
function byoHTML(cs) {
  const b = cs.byo;
  return `<div class="byo">
    <div class="field-label" id="byo-kind-label">Where is your agent?</div>
    <div class="byo-kinds" role="radiogroup" aria-labelledby="byo-kind-label">${Object.entries(BYO_KINDS).map(([k, x]) => `<button type="button" class="radio-card" role="radio" aria-checked="${b.kind === k}" data-byok="${k}"${b.kind === k ? ' autofocus' : ''}><span class="rc-dot"></span><span class="rc-main"><span class="rc-title">${x.label}</span><span class="rc-desc">${x.desc}</span></span></button>`).join('')}</div>
    <div class="byo-field" id="byo-field">${byoFieldHTML(cs)}</div>
    <div class="byo-results" id="byo-checks">${byoChecksHTML(cs)}</div>
  </div>`;
}
function catFootHTML(cs) {
  const cli = (cmd) => `<span class="left">${icon('terminal', 'xs')}<code>${esc(cmd)}</code></span>`;
  if (cs.tab === 'browse' && cs.view === 'detail') {
    const c = AGENT_CATALOG.find((x) => x.id === cs.sel);
    const added = c && AGENTS[c.id] && !AGENTS[c.id].removed;
    return `${cli(`ax templates add ${c ? c.cli : ''}`)}<button class="btn ghost" data-action="close-dialog">Cancel</button><button class="btn primary" data-catx="add" id="cat-add">${added ? 'Use this template' : 'Add and use'}</button>`;
  }
  if (cs.tab === 'browse') return `${cli(cs.q.trim() ? `ax templates search "${cs.q.trim()}"` : 'ax templates search')}<button class="btn ghost" data-action="close-dialog">Close</button>`;
  const b = cs.byo;
  /* The full folder path (not ./name), so the command works from whatever folder your terminal is in. */
  const arg = b.kind === 'folder' ? b.folder : (b.value[b.kind] || '<' + BYO_KINDS[b.kind].field.toLowerCase() + '>');
  const primary = b.phase === 'checking' ? `<button class="btn primary" disabled>${icon('loader', 'sm spin')}Checking…</button>`
    : b.phase === 'ok' ? '<button class="btn primary" data-catx="byo-add" id="byo-add">Add and use</button>'
      : `<button class="btn primary" data-catx="byo-check" id="byo-check">${b.phase === 'fail' ? 'Check again' : 'Check agent'}</button>`;
  return `${cli(`ax templates add ${arg}`)}<button class="btn ghost" data-action="close-dialog">Cancel</button>${primary}`;
}
function catDraw(cs, dlg, part) {
  if (!dlg) return;
  const panel = $('#cat-panel', dlg), foot = $('#cat-foot', dlg);
  if (part !== 'foot') {
    $$('[data-cat-tab]', dlg).forEach((x) => x.setAttribute('aria-selected', String(x.dataset.catTab === cs.tab)));
    if (panel) {
      panel.setAttribute('aria-labelledby', cs.tab === 'byo' ? 'cat-tab-byo' : 'cat-tab-browse');
      panel.innerHTML = cs.tab === 'byo' ? byoHTML(cs) : cs.view === 'detail' ? catDetailHTML(cs) : catBrowseHTML(cs);
      panel.scrollTop = 0;
    }
  }
  if (foot) foot.innerHTML = catFootHTML(cs);
}
function catRedrawResults(cs, dlg) {
  const r = catResultsHTML(cs);
  const res = $('#cat-results', dlg); if (res) res.innerHTML = r.html;
  const st = $('#cat-status', dlg); if (st) st.textContent = `${plural(r.n, 'template')} shown`;
  const f = $('#cat-foot', dlg); if (f) f.innerHTML = catFootHTML(cs);
}
function openAgentCatalog(opts) {
  opts = opts || {};
  const cs = catState = {
    tab: opts.tab === 'byo' ? 'byo' : 'browse', q: '', filter: opts.filter || 'all', view: opts.id ? 'detail' : 'list', sel: opts.id || null,
    byo: { kind: BYO_KINDS[opts.kind] ? opts.kind : 'folder', folder: opts.folder || BYO_FOLDERS[0], value: { image: '', git: '' }, phase: 'idle', rows: [], name: '', err: '', plan: null },
  };
  if (opts.value && cs.byo.kind !== 'folder') cs.byo.value[cs.byo.kind] = opts.value;
  const dlg = openDialog(`<div class="dialog wide cat-dialog" role="dialog" aria-modal="true" aria-labelledby="cat-title" aria-describedby="cat-sub" id="cat">
    <div class="dialog-head"><div style="flex:1;min-width:0"><h2 id="cat-title">Add a template</h2>
      <p id="cat-sub">Use a template your team shared or one from the AX catalog, or bring an agent you built. Each one runs in its own sandbox with the same Guardrails.</p>
      <div class="seg cat-tabs" role="tablist" aria-label="Ways to add a template">
        <button type="button" role="tab" id="cat-tab-browse" aria-controls="cat-panel" aria-selected="${cs.tab === 'browse'}" data-cat-tab="browse">Browse templates</button>
        <button type="button" role="tab" id="cat-tab-byo" aria-controls="cat-panel" aria-selected="${cs.tab === 'byo'}" data-cat-tab="byo">Bring your own agent</button>
      </div></div>
      <button class="btn ghost icon" data-action="close-dialog" aria-label="Close">${icon('x')}</button></div>
    <div class="dialog-body cat-body"><div class="cat-panel" id="cat-panel" role="tabpanel" aria-labelledby="cat-tab-${cs.tab}">${cs.tab === 'byo' ? byoHTML(cs) : cs.view === 'detail' ? catDetailHTML(cs) : catBrowseHTML(cs)}</div></div>
    <div class="dialog-foot" id="cat-foot">${catFootHTML(cs)}</div>
  </div>`);
  if (!dlg) return null;
  cs.dlg = dlg;
  dlg.addEventListener('click', (e) => catClick(e, cs, dlg));
  dlg.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'cat-q') { cs.q = t.value; catRedrawResults(cs, dlg); }
    else if (t.id === 'byo-input') {
      cs.byo.value[cs.byo.kind] = t.value;
      if (cs.byo.err) { cs.byo.err = ''; t.removeAttribute('aria-invalid'); const er = $('#byo-err', dlg); if (er) er.innerHTML = ''; }
      if (cs.byo.phase !== 'idle') { cs.byo.phase = 'idle'; cs.byo.rows = []; cs.byo.plan = null; const bc = $('#byo-checks', dlg); if (bc) bc.innerHTML = byoChecksHTML(cs); }
      catDraw(cs, dlg, 'foot');
    } else if (t.id === 'byo-name') cs.byo.name = t.value;
  });
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'byo-input') { e.preventDefault(); runByoCheck(cs, dlg); }
    else if (e.key === 'Enter' && e.target.id === 'cat-reg') { e.preventDefault(); addTeamRegistry(cs, dlg); }
  });
  if (opts.autoCheck) setTimeout(() => runByoCheck(cs, dlg), reducedMotion() ? 0 : 300);
  return dlg;
}
async function catClick(e, cs, dlg) {
  const el = e.target.closest('[data-cat-tab], [data-catf], [data-cat], [data-catx], [data-byok]');
  if (!el || !dlg.contains(el)) return;
  if (el.dataset.catTab) {
    if (cs.tab === el.dataset.catTab && cs.view === 'list') return;
    cs.tab = el.dataset.catTab; cs.view = 'list';
    catDraw(cs, dlg);
    return;
  }
  if (el.dataset.catf) {
    cs.filter = el.dataset.catf;
    $$('[data-catf]', dlg).forEach((x) => x.setAttribute('aria-checked', String(x.dataset.catf === cs.filter)));
    catRedrawResults(cs, dlg);
    return;
  }
  if (el.dataset.cat) {
    cs.view = 'detail'; cs.sel = el.dataset.cat;
    catDraw(cs, dlg);
    const h = $('#cd-name', dlg); if (h) h.focus({ preventScroll: true });
    return;
  }
  if (el.dataset.byok) {
    if (cs.byo.kind === el.dataset.byok) return;
    cs.byo.kind = el.dataset.byok; cs.byo.phase = 'idle'; cs.byo.rows = []; cs.byo.err = ''; cs.byo.plan = null;
    catDraw(cs, dlg);
    const r = $(`[data-byok="${cs.byo.kind}"]`, dlg); if (r) r.focus({ preventScroll: true });
    return;
  }
  const x = el.dataset.catx;
  if (x === 'back') {
    const sel = cs.sel; cs.view = 'list';
    catDraw(cs, dlg);
    const row = $(`[data-cat="${sel}"]`, dlg); if (row) row.focus({ preventScroll: true });
  } else if (x === 'registry') {
    cs.regOpen = true; catRedrawResults(cs, dlg);
    const inp = $('#cat-reg', dlg); if (inp) inp.focus();
  } else if (x === 'registry-add') {
    addTeamRegistry(cs, dlg);
  } else if (x === 'to-byo') { cs.tab = 'byo'; cs.view = 'list'; catDraw(cs, dlg); }
  else if (x === 'add') addCatalogAgent(cs.sel);
  else if (x === 'byo-folder') {
    const i = BYO_FOLDERS.indexOf(cs.byo.folder);
    cs.byo.folder = BYO_FOLDERS[(i + 1) % BYO_FOLDERS.length]; cs.byo.phase = 'idle'; cs.byo.rows = []; cs.byo.plan = null;
    const bf = $('#byo-field', dlg); if (bf) bf.innerHTML = byoFieldHTML(cs);
    const bc = $('#byo-checks', dlg); if (bc) bc.innerHTML = byoChecksHTML(cs);
    catDraw(cs, dlg, 'foot');
    const ch = $('[data-catx="byo-folder"]', dlg); if (ch) ch.focus({ preventScroll: true });
  } else if (x === 'byo-check') runByoCheck(cs, dlg);
  else if (x === 'byo-add') addByoAgent(cs);
  else if (x === 'copy-fix') copyText(HARNESS_SNIPPET, 'Snippet copied. Add it to your agent, then check again.');
}
async function runByoCheck(cs, dlg) {
  const b = cs.byo;
  if (b.phase === 'checking') return;
  const v = b.kind === 'folder' ? b.folder : String(b.value[b.kind] || '').trim();
  const err = byoInputError(b.kind, v);
  if (err) {
    b.err = err;
    const er = $('#byo-err', dlg); if (er) er.innerHTML = icon('alert', 'sm') + esc(err);
    const inp = $('#byo-input', dlg); if (inp) { inp.setAttribute('aria-invalid', 'true'); inp.focus(); }
    return;
  }
  /* "Check again" after a failed check: the prototype takes it that you made the fix shown, so the recovery can be seen. */
  b.fixed = b.fixed || {};
  if (b.phase === 'fail') b.fixed[b.kind + ':' + v] = true;
  b.err = ''; b.phase = 'checking'; b.rows = [];
  const plan = b.plan = byoPlan(b.kind, v, !!b.fixed[b.kind + ':' + v]); b.name = plan.name;
  /* Results stream in below the form; keep the newest one in view inside the fixed-height panel. */
  const reveal = (sel) => { const el = $(sel, dlg); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' }); };
  const paint = (sel) => { const bc = $('#byo-checks', dlg); if (bc) bc.innerHTML = byoChecksHTML(cs); reveal(sel || '.byo-checks .check-item:last-child'); };
  catDraw(cs, dlg, 'foot');
  for (const r of plan.rows) {
    b.rows.push(Object.assign({}, r, { cls: 'pending' }));
    paint();
    await sleep(reducedMotion() ? 0 : 380);
    /* Stop if the dialog closed, or you changed the folder, kind or input mid-check (that cancels this run). */
    if (catState !== cs || b.plan !== plan || !document.contains(dlg)) return;
    b.rows[b.rows.length - 1] = r;
    paint(r.cls === 'no' ? '.byo-fix' : null);
    if (r.cls === 'no') break;
  }
  b.phase = b.rows.some((r) => r.cls === 'no') ? 'fail' : 'ok';
  paint(b.phase === 'ok' ? '.byo-done' : '.byo-fix');
  catDraw(cs, dlg, 'foot');
}
/** Use an agent for the task you're setting up: select it on New task (keeping your goal), or open New task with it. */
function useAgentInDraft(a, verb) {
  closeDialog(true);
  const onNew = state.route && state.route.parts[0] === 'new' && state.draft;
  if (onNew) {
    const d = state.draft;
    d.agent = a.id; d.keyState = null; d.keyMsg = ''; d.keyMethod = 'account';
    if (d.agent2 === d.agent) d.agent2 = defaultSecondAgent(d.agent);
    render({ keepScroll: true });
    const card = $('#agent-' + a.id);
    if (card) {
      card.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
      card.focus({ preventScroll: true });
      if (card.classList) { card.classList.add('just-added'); setTimeout(() => card.classList.remove('just-added'), 1600); }
    }
  } else { state.draft = null; navigate('#/new?agent=' + encodeURIComponent(a.id)); }
  toast(`${verb} <strong>${esc(a.name)}</strong>. It’s selected for this task${a.connected ? '.' : ' · sign in to use it.'}`, { icon: 'checkCircle' });
}
function addCatalogAgent(id) {
  const c = AGENT_CATALOG.find((x) => x.id === id);
  if (!c) return null;
  const had = AGENTS[c.id] && !AGENTS[c.id].removed;
  const a = addAgent(Object.assign({}, c));
  useAgentInDraft(a, had ? 'Using' : 'Added');
  return a;
}
function addByoAgent(cs) {
  const p = cs.byo.plan;
  if (!p || cs.byo.phase !== 'ok') return null;
  const name = cleanText(cs.byo.name || p.name, 40) || p.name;
  let id = slug(p.base), k = 2;
  while (AGENTS[id] && !(AGENTS[id].custom && AGENTS[id].source === 'yours' && AGENTS[id].byo === p.v)) id = slug(p.base) + '-' + k++;
  const shortSrc = p.kind === 'folder' ? p.v : p.host;
  const a = addAgent(Object.assign({
    id, source: 'yours', byo: p.v, name, maker: 'You', publisher: `You · ${cleanText(shortSrc, 60)}`,
    /* Once added, a folder template is run by its name (works from any folder); an image or repo by its address. */
    cli: p.kind === 'folder' ? id : cleanText(p.v, 80), version: p.kind === 'image' ? cleanText(p.tag, 20) : 'dev',
    image: p.kind === 'image' ? cleanText(p.v, 80) : `ax.local/${slug(p.base)}:dev`, framework: 'ADK · Python', localOnly: p.kind !== 'image',
    desc: cleanText(p.desc || `Your agent from ${shortSrc}.`, 140), auth: 'google', model: 'Gemini 3 Flash', modelApi: 'generativelanguage.googleapis.com',
    reach: [], tools: [], color: '#0E7490', glyph: AGENT_GLYPHS.custom, rate: 0.003,
  }, GOOGLE_SIGNIN));
  if (a.name !== name) { a.name = name; saveCustomAgents(); }
  useAgentInDraft(a, 'Added');
  return a;
}


/* ---------- Choose a remote cluster (New task, when none is connected yet) ---------- */
function openConnectCluster(then) {
  const usable = CLUSTERS.filter((c) => c.access);
  let pick = (usable.find((c) => c.compat) || usable[0]).name;
  const list = () => usable.map((c) => `<button type="button" class="radio-card" role="radio" aria-checked="${pick === c.name}" data-cc="${c.name}" ${c.compat ? '' : 'aria-disabled="true"'}><span class="rc-dot"></span><span class="rc-main"><span class="rc-title">${esc(c.name)}</span><span class="rc-desc">${esc(c.desc)}</span></span><span class="rc-right">${versionBadge(c)}</span></button>`).join('') + noAccessHTML();
  const body = `<p class="small" style="margin-bottom:12px">From your kubeconfig (<span class="mono">~/.kube/config</span>). Tasks there keep running with your laptop closed, with your organization's guardrails.</p>
    <div class="radio-list" role="radiogroup" aria-label="Remote cluster" id="cc-list">${list()}</div>`;
  const dlg = openDialog(dialogShell('cc', 'Choose a remote cluster', 'This task runs on a remote cluster. Pick the one to use; it becomes the default for new tasks.', body,
    `<span class="left">${icon('terminal', 'xs')}<code id="cc-cli">ax cluster use ${esc(pick)}</code></span><button class="btn ghost" data-action="close-dialog">Cancel</button><button class="btn primary" id="cc-go">${icon('cloud', 'sm')}Connect and run</button>`, true, 'cloud'));
  dlg.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cc]');
    if (!b || b.getAttribute('aria-disabled') === 'true') return;
    pick = b.dataset.cc; $('#cc-list', dlg).innerHTML = list(); $('#cc-cli', dlg).textContent = `ax cluster use ${pick}`;
    const nb = $(`[data-cc="${pick}"]`, dlg); if (nb) nb.focus();
  });
  $('#cc-go', dlg).addEventListener('click', async (e) => {
    connectCluster(pick);
    closeDialog(true);
    toast(`Connected to ${esc(pick)}. It's the default for new tasks.`, { icon: 'cloud' });
    if (typeof then === 'function') then();
  });
}

/* ---------- Guardrails policy as YAML ---------- */
function openPolicyYAML() {
  const raw = policyYAML();
  const dlg = openDialog(dialogShell('py', 'Guardrails policy', 'Your preset, what agents can do inside the sandbox, and which sites they can reach. No keys are in this file.',
    `<pre class="manifest" id="py-code" tabindex="0" style="max-height:340px">${esc(raw)}</pre>`,
    `<span class="left">${icon('terminal', 'xs')}<code>ax guardrails export > guardrails.yaml</code></span><button class="btn" id="py-dl">${icon('download', 'sm')}Download</button><button class="btn primary" id="py-copy">${icon('copy', 'sm')}Copy YAML</button>`, true, 'shield'));
  $('#py-dl', dlg).addEventListener('click', () => downloadText('guardrails.yaml', raw, 'Saved <span class="mono">guardrails.yaml</span>'));
  $('#py-copy', dlg).addEventListener('click', () => copyText(raw, 'Guardrails policy copied.'));
}
