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

/* AX Studio, live mode: Settings.

   Only what is real with the Studio server, one section at a time:
   - Appearance & story: the theme, compact task lists, and Axel's story
   - Keyboard & commands: the command palette and the shortcuts that work here
   - Accessibility: single-key shortcuts and reduced motion
   - Notifications: a browser notification when something needs you (live-nav.js)
   - AX & this computer: what this Studio is and runs against (its version, the ax command, the local cluster, the
     kubeconfig, the images setup uses), and a diagnostics report from the server with secrets removed. This
     computer's checks are on Local cluster, so they aren't repeated here.
   - Command line: the ax commands that do what Studio does

   The first three are kept in this browser. Nothing here changes AX or your kubeconfig. */

const LIVE_SETTINGS = [
  { slug: 'about', h: 'ls-h-about', label: 'AX & this computer' },
  { slug: 'keyboard', h: 'ls-h-keyboard', label: 'Keyboard & commands' },
  { slug: 'notifications', h: 'ls-h-notify', label: 'Notifications' },
  { slug: 'accessibility', h: 'ls-h-a11y', label: 'Accessibility' },
  { slug: 'appearance', h: 'ls-h-appearance', label: 'Appearance & story' },
];

/** The shortcuts that work with real data. The Keyboard shortcuts dialog shows the same list. */
function liveShortcutRows() {
  return [
    [`${MOD} K`, 'Open the command palette'],
    ['N', 'New task'],
    ['G then H', 'Go home'],
    ['G then P', 'Go to Local cluster'],
    ['G then S', 'Go to Settings'],
    ['T', 'Switch light / dark theme'],
    ['/', 'Open the command palette'],
    ['?', 'Show the keyboard shortcuts'],
    ['Esc', 'Close a dialog'],
  ];
}
function liveKeysHTML(k) {
  return k.split(' ').map((x) => (x === 'then' ? '<span class="muted small"> then </span>' : `<kbd>${esc(x)}</kbd> `)).join('');
}
function liveGiB(bytes) { return bytes > 0 ? `${(bytes / 1073741824).toFixed(1)} GiB` : ''; }

/* ---------- The sections ---------- */
function liveSetAppearanceHTML() {
  const pref = themePref();
  const preview = (k) => `<span class="theme-preview ${k}" aria-hidden="true"><span class="tp-ui"><i class="tp-sb"></i><i class="tp-bd"><b></b><s></s><s></s></i></span>${k === 'system' ? '<span class="tp-ui tp-dark"><i class="tp-sb"></i><i class="tp-bd"><b></b><s></s><s></s></i></span>' : ''}</span>`;
  return `<div class="card">
      <div class="theme-cards" role="radiogroup" aria-labelledby="ls-h-appearance">
        ${[['system', 'Match system'], ['light', 'Light'], ['dark', 'Dark']].map(([k, l]) => `<button type="button" class="theme-card" role="radio" aria-checked="${pref === k}" data-action="set-theme" data-theme="${k}">${preview(k)}<span class="tc-label">${l}</span></button>`).join('')}
      </div>
      <div class="set-row"><div class="sr-main"><div class="sr-title" id="ls-compact-title">Compact task lists</div><div class="sr-desc" id="ls-compact-desc">More tasks on screen on Home: tighter rows, the same facts.</div></div>
        <label class="switch"><input type="checkbox" role="switch" id="ls-compact" data-action="live-compact" ${liveCompact() ? 'checked' : ''} aria-labelledby="ls-compact-title" aria-describedby="ls-compact-desc"><span class="track"></span><span class="thumb"></span></label></div>
      <div class="set-row ls-story" id="ls-story-row">
        <span class="ls-axel" aria-hidden="true">${axo('wave', { decorative: true, cls: 'axo-ls' })}</span>
        <div class="sr-main"><div class="sr-title">Axel &amp; the Clear Spring</div><div class="sr-desc">Why AX's mascot is an axolotl: four of its traits, and what each one means in AX.</div></div>
        <button type="button" class="btn sm" data-action="story" id="ls-story">${icon('waves', 'sm')}Why an axolotl?</button>
      </div>
    </div>`;
}
function liveSetKeyboardHTML() {
  return `<div class="card">
      <div class="set-row"><div class="sr-main"><div class="sr-title">Command palette</div>
        <div class="sr-desc">Jump to a task or a page, or act on the task you have open. Each entry shows the <span class="mono">ax</span> command that does the same. It opens from any page with ${liveKeysHTML(`${MOD} K`)}</div></div>
        <button type="button" class="btn sm" data-action="live-palette" id="ls-palette">${icon('search', 'sm')}Open command palette</button></div>
      <div class="set-row ls-keys-row"><div class="sr-main"><div class="sr-title">Keyboard shortcuts</div>
        <div class="sr-desc">${state.singleKeys ? 'Single-key shortcuts are on.' : `Single-key shortcuts are off, so only ${MOD} K and Esc work.`} Turn them on or off in <a href="#/settings/accessibility">Accessibility</a>.</div>
        <table class="table ls-keys" aria-label="Keyboard shortcuts"><tbody>${liveShortcutRows().map(([k, d]) => `<tr><td>${liveKeysHTML(k)}</td><td>${esc(d)}</td></tr>`).join('')}</tbody></table></div></div>
    </div>
    ${liveSetCliHTML()}`;
}
function liveSetA11yHTML() {
  const sw = (pref, on, labelId, descId) => `<label class="switch"><input type="checkbox" role="switch" id="ls-${pref}" data-action="toggle-pref" data-pref="${pref}" ${on ? 'checked' : ''} aria-labelledby="${labelId}" aria-describedby="${descId}"><span class="track"></span><span class="thumb"></span></label>`;
  return `<div class="card">
      <div class="set-row"><div class="sr-main"><div class="sr-title" id="ls-sk-title">Single-key shortcuts</div><div class="sr-desc" id="ls-sk-desc">N for a new task, T for the theme, / for the command palette, ? for the shortcuts, and G then H, P or S to move around. Turn these off if you use speech input or assistive tech that sends single keys. ${MOD} K always works.</div></div>${sw('singleKeys', state.singleKeys, 'ls-sk-title', 'ls-sk-desc')}</div>
      <div class="set-row"><div class="sr-main"><div class="sr-title" id="ls-rm-title">Reduce motion</div><div class="sr-desc" id="ls-rm-desc">Axel, the flowing lines and the shimmer stay still. AX Studio also follows your system's reduce-motion setting.</div></div>${sw('reduceMotion', !!state.reduceMotion, 'ls-rm-title', 'ls-rm-desc')}</div>
    </div>`;
}
function liveSetAboutHTML() {
  const info = STUDIO.info || {};
  const env = LIVE.env || {};
  const mono = (s) => `<span class="mono ls-wrap">${esc(s)}</span>`;
  const muted = (s) => `<span class="muted">${s}</span>`;
  const ax = LIVE.axError
    ? `<span class="ls-bad">${esc(LIVE.axError)}</span>`
    : `${info.axBinary ? `${mono(info.axBinary)}<br>` : ''}${muted('ax version')} ${LIVE.axVersion ? esc(LIVE.axVersion) : 'Checking…'}`;
  const kept = (k) => (LIVE.images && LIVE.images[k] ? String(LIVE.images[k]).trim() : '');
  const def = (env.setupImages || {});
  const imgLine = (label, typed, img, from) => `${label}: ${typed ? `${mono(typed)} ${muted('(kept in this browser)')}` : img ? `${mono(img)} ${muted(from === 'env' ? '(from Studio\'s environment)' : '(Studio\'s default)')}` : 'None yet'}`;
  const images = `${imgLine('AX server', kept('serverImage'), def.serverImage || env.serverImageEnv, def.serverImageFrom || 'env')}<br>
    ${def.runnerVolumeImageAllowed ? `${imgLine('Runner volume', kept('runnerVolumeImage'), def.runnerVolumeImage, def.runnerVolumeImageFrom)}<br>` : ''}
    ${muted('Change them under AX images on')} <a href="#/places">Local cluster</a>`;
  /* The atespace Studio lists and starts tasks in. It's Studio's own choice. */
  const ates = `<span class="ls-ates"><input class="input mono" id="ls-atespace" value="${esc(LIVE.atespace)}" aria-label="Atespace" autocomplete="off" spellcheck="false" maxlength="63">
      <button type="button" class="btn sm" data-action="live-atespace-use">Use</button>${LIVE.atespace !== 'default' ? '<button type="button" class="pill" data-action="live-atespace-use" data-value="default">default</button>' : ''}</span>
      <span class="ls-ates-why muted" id="ls-atespace-why">Where your tasks are listed and started. AX's own is <span class="mono">default</span>.</span>`;
  const rows = liveKV([
    ['AX Studio', `${esc(info.studioVersion || 'dev')} ${muted(`· AX API ${esc(info.version || 'v1alpha1')}`)}`],
    ['Address', `${mono(location.origin)} ${muted('· only this computer can connect')}`],
    ['The ax command', ax],
    ['Cluster', LIVE.context ? `${liveWhere(LIVE.context)} ${mono(LIVE.context)}` : 'None yet. <a href="#/places">Set up AX on this computer</a>'],
    ['Kubeconfig', `${mono(info.kubeconfig || '~/.kube/config')}${env.currentContext ? ` ${muted('· current context')} ${mono(env.currentContext)}` : ''}<br>${muted('Studio reads it and never changes it.')}`],
    ['AX namespace', mono(info.axNamespace || 'ax-system')],
    ['Atespace', ates],
    ['Images for setup', images],
  ]);
  return `<div class="card card-pad">
      ${rows}
      <div class="set-row" style="margin-top:14px"><div class="sr-main"><div class="sr-title">Diagnostics</div>
        <div class="sr-desc">A report of this computer${LIVE.context ? ` and ${esc(LIVE.context)}` : ''}: the checks, AX's pods and the latest <span class="mono">ax-server</span> log lines. Secrets are removed before you see it, so it's safe to share.</div></div>
        <button type="button" class="btn sm" data-action="live-diagnostics" id="ls-diagnostics">${icon('doctor', 'sm')}Diagnostics…</button></div>
    </div>`;
}
function liveSetCliHTML() {
  const c = (args) => liveCmd(args);
  const rows = [
    ['Set up or start AX on this computer', 'ax local start'],
    ['See how AX on this computer is doing', 'ax local status'],
    ['Stop it, keeping your tasks', 'ax local stop'],
    ['Remove it', 'ax local delete'],
    ['List your tasks', c(['get', 'tasks'])],
    ['Read a task and its task file', c(['get', 'task', '<name>'])],
    ['Start a task from its files', `${c(['apply', '-f', 'task.yaml'])} · ${c(['resume', 'task', '<name>'])}`],
    ['Suspend or resume a task', `${c(['suspend', 'task', '<name>'])} · ${c(['resume', 'task', '<name>'])}`],
    ['Open a shell in its sandbox', c(['ssh', '<name>'])],
    ['Delete a task', c(['delete', 'task', '<name>'])],
  ];
  return `<div class="card card-pad" style="margin-top:14px">
      <div class="sr-title" style="margin-bottom:4px">Command line</div>
      <p class="small sub">Everything AX Studio does is an <span class="mono">ax</span> command, so you or a coding agent can do the same from a terminal. Studio names the cluster with <span class="mono">--context</span> on every command, so your kubeconfig stays as it is.</p>
      <table class="cli-table" aria-label="The ax commands behind AX Studio">
        <thead><tr><th scope="col">To</th><th scope="col">Run</th></tr></thead>
        <tbody>${rows.map(([what, cmd]) => `<tr><th scope="row">${esc(what)}</th><td><code>${esc(cmd)}</code></td></tr>`).join('')}</tbody>
      </table>
      <div style="margin-top:12px">${cliHint('ax version')}</div>
    </div>`;
}

/* ---------- The page ---------- */
function liveViewSettings(slug) {
  const key = slug === 'command-line' ? 'keyboard' : slug;
  const sec = LIVE_SETTINGS.find((x) => x.slug === key) || LIVE_SETTINGS[0];
  const body = {
    about: liveSetAboutHTML, keyboard: liveSetKeyboardHTML, notifications: liveSetNotifyHTML, accessibility: liveSetA11yHTML, appearance: liveSetAppearanceHTML,
  }[sec.slug]();
  const html = `
    <h1 tabindex="-1">Settings</h1>
    <p class="sub" style="margin-top:6px;max-width:66ch">How AX Studio looks and works on this computer, and what it runs against. Nothing here changes AX or your kubeconfig.</p>
    <div class="settings">
      <nav class="settings-nav" id="settings-nav" aria-label="Settings sections">${LIVE_SETTINGS.map((x) => `<a href="#/settings/${x.slug}"${x === sec ? ' aria-current="page"' : ''}>${esc(x.label)}</a>`).join('')}</nav>
      <section class="set-section" id="ls-${sec.slug}" aria-labelledby="${sec.h}"><h2 id="${sec.h}" tabindex="-1">${esc(sec.label)}</h2>
        ${body}
      </section>
    </div>`;
  /* After switching sections (the hashchange handler in app.js sets settingsFocus), focus moves to the new section's
     heading, so a screen reader announces where you are. */
  const after = () => { if (!state.settingsFocus) return; state.settingsFocus = false; const h = document.getElementById(sec.h); if (h) h.focus({ preventScroll: true }); };
  return { title: `${sec.label} · Settings`, crumbs: [{ label: 'Home', href: '#/' }, { label: 'Settings', href: '#/settings' }, { label: sec.label }], html, after };
}

/* ---------- Diagnostics ---------- */
async function liveOpenDiagnostics() {
  const ctx = LIVE.context;
  const dlg = openDialog(dialogShell('ldg', 'Diagnostics', `This computer${ctx ? ` and ${esc(ctx)}` : ''}, with secrets removed`,
    '<div id="ldg-body"><p class="small muted">Collecting… This takes a few seconds.</p></div>',
    `<span class="left"></span><button class="btn ghost" data-action="close-dialog">Close</button><button class="btn" id="ldg-dl" disabled>${icon('download', 'sm')}Download</button><button class="btn primary" id="ldg-copy" disabled>${icon('copy', 'sm')}Copy</button>`, true, 'doctor'));
  let text = '';
  $('#ldg-copy', dlg).addEventListener('click', () => { if (text) copyText(text, 'Copied the diagnostics (secrets removed)'); });
  $('#ldg-dl', dlg).addEventListener('click', () => { if (text) downloadText('ax-studio-diagnostics.txt', text); });
  try {
    const r = await studioApi.diagnostics(ctx);
    text = String((r && r.diagnostics) || '');
    const body = $('#ldg-body', dlg);
    if (body) body.innerHTML = `<pre class="manifest" id="ldg-text" style="max-height:360px" tabindex="0" aria-label="Diagnostics">${esc(text)}</pre>`;
    $('#ldg-copy', dlg).disabled = false;
    $('#ldg-dl', dlg).disabled = false;
  } catch (e) {
    const body = $('#ldg-body', dlg);
    if (body) body.innerHTML = `<div class="callout warn" role="alert">${icon('alert')}<div style="overflow-wrap:anywhere"><strong>Couldn't collect the diagnostics.</strong> ${esc(e.message)}</div></div>`;
  }
}

Object.assign(LIVE_ACTIONS, {
  'live-diagnostics': () => liveOpenDiagnostics(),
  /* Use the atespace typed (or the one on the pill). A name AX can't take says why and changes nothing. */
  'live-atespace-use': (el) => {
    const inp = $('#ls-atespace');
    const v = String((el && el.dataset.value) || (inp && inp.value) || '').trim() || 'default';
    const why = $('#ls-atespace-why');
    if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(v) || v.length > 63) {
      if (why) { why.textContent = 'An atespace name is lowercase letters, digits and dashes, and starts and ends with a letter or digit.'; why.classList.add('ls-bad'); }
      if (inp) { inp.setAttribute('aria-invalid', 'true'); inp.focus(); }
      return;
    }
    liveUseAtespace(v);
    render({ keepScroll: true });
    toast(`Tasks are listed and started in atespace <span class="mono">${esc(v)}</span>`, { icon: 'check' });
    announce(`Using atespace ${v}`);
    liveRefresh(true);
  },
});
