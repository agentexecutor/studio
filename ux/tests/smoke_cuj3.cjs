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

// Smoke test · CUJ 3 (watch, steer and unblock). Loads AX Studio with the demo data in a stubbed DOM and checks every
// CUJ 3 requirement and its "What can go wrong" rows: the overview, the live stream (thoughts, tool calls,
// diffs, and Changes updating while you watch), pause/resume, steering at the next turn or mid-turn, the terminal
// (`ax ssh`, only when a sandbox exists), exports and the plain-text log, blocked requests, permission prompts with
// "Ask before risky commands", notifications (including failures while you're elsewhere), and the out-of-memory,
// crash, sleep and queued-input paths. Usage: node smoke_cuj3.js <prototype dir>
const fs = require('fs');
const vm = require('vm');
/* Run from the repo root: node tests/<suite>.js   (or pass the app folder as the first argument) */
const dir = process.argv[2] || require('path').resolve(__dirname, '..');

const namedEls = {};
function fakeEl(id) {
  const el = {
    innerHTML: '', textContent: '', value: '', hidden: false, disabled: false, checked: false, id: id || '', tagName: 'DIV',
    style: { setProperty() {}, getPropertyValue() { return ''; }, removeProperty() {} }, dataset: { axo: 'idle', stage: '0' }, children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; }, [Symbol.iterator]: function* () {} },
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {}, toggleAttribute() {}, hasAttribute() { return false; },
    focus() {}, blur() {}, click() {},
    querySelector(s) { return fakeEl(s); }, querySelectorAll() { return []; },
    insertAdjacentHTML(_p, h) { this.innerHTML += h; }, addEventListener() {},
    appendChild(c) { this.children.push(c); this.innerHTML += (c && c.innerHTML) || ''; },
    remove() {}, replaceWith() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 10, height: 10 }; },
    scrollIntoView() {}, closest() { return null; }, setSelectionRange() {}, animate() {},
  };
  el.parentElement = el; el.lastElementChild = el; el.firstChild = { remove() { el.children.shift(); } }; el.form = { requestSubmit() {} };
  Object.defineProperty(el, 'outerHTML', { set() {}, get() { return el.innerHTML; } });
  return el;
}
['#root', '#main', '#overlay', '#toasts', '#bell-pop', '#announcer'].forEach((k) => { namedEls[k] = fakeEl(k); });
const store = { 'ax.setup': '1', 'ax.env': 'local' };
const doc = {
  addEventListener() {}, hidden: false,
  querySelector(s) { return namedEls[s] || fakeEl(s); },
  querySelectorAll() { return []; },
  getElementById(id) { return namedEls['#' + id] || fakeEl(id); },
  createElement() { return fakeEl(); },
  contains() { return true; }, activeElement: null,
  documentElement: Object.assign(fakeEl(), { scrollHeight: 1000 }),
  body: fakeEl('body'),
};
const timers = [];
const ctx = {
  console, URLSearchParams, JSON, Math, Date, String, Number, Object, Array, Promise, RegExp, encodeURIComponent,
  Blob: function Blob(a) { this.a = a; },
  URL: { createObjectURL: () => 'blob:ax', revokeObjectURL: () => {} },
  document: doc,
  navigator: { platform: 'MacIntel', clipboard: { writeText: () => Promise.resolve() } },
  location: { hash: '#/', search: '', pathname: '/index.html', get href() { return 'http://localhost' + this.pathname + this.search + this.hash; }, replace(u) { u = String(u); this.hash = u.includes('#') ? u.slice(u.indexOf('#')) : ''; } },
  history: { replaceState() {} },
  localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
  setTimeout: (f) => { timers.push(f); return timers.length; }, clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
  innerWidth: 1440, innerHeight: 900, scrollY: 0, scrollTo() {}, requestAnimationFrame: () => 0,
  getSelection: () => '',
};
ctx.window = ctx;
ctx.window.matchMedia = () => ({ matches: false, addEventListener() {} });
ctx.window.addEventListener = () => {};
vm.createContext(ctx);
const files = ['core.js', 'mascot.js', 'viz.js', 'failures.js', 'views.js', 'task.js', 'overlays.js', 'app.js'];
vm.runInContext(files.map((f) => fs.readFileSync(dir + '/' + f, 'utf8')).join('\n;\n') + `
;globalThis.__api = { state, render, viewHome, viewTask, viewSettings, shellHTML, getTask, evHTML, nextStepHTML, tabAttnOf, needsCardHTML,
  steerTask, interruptTask, pauseTask, resumeTask, deliverQueued, runStep, scheduleNext, termRun, terminalPanelHTML, termUnavailable,
  rawLogText, logPanelHTML, pushEvent, openExportResults, oatrJSON, allowRequest, resolvePermission, openPermission, SCRIPTS, ACTIONS,
  failActionsHTML, failCardHTML, runFix, runScenario, spawnFailure, spawnRunning, paletteItems, refreshLive, setStatus, createTaskFromDraft,
  ensureDraft, AGENTS, STATUS, needsCount, describeEvent, ERRORS };`, ctx);
const api = ctx.__api;
const S = api.state;
let fails = 0, n = 0;
const countAxo = (h) => (String(h || '').match(/<svg[^>]*\bclass="[^"]*\baxo\b/g) || []).length;
function check(name, fn) {
  n++;
  try {
    const r = fn();
    if (r && typeof r.html === 'string') {
      const html = String(r.html).replace(/aria-describedby|"undefined"/g, '');
      if (/undefined|NaN|\[object/.test(html)) throw new Error('bad token: ' + (html.match(/.{0,40}(undefined|NaN|\[object).{0,40}/) || [])[0]);
      if (r.axo != null && countAxo(r.html) > r.axo) throw new Error(`expected at most ${r.axo} Axel, got ${countAxo(r.html)}`);
    }
    console.log('ok  ', name);
  } catch (e) { fails++; console.log('FAIL', name, e && e.stack ? e.stack.split('\n').slice(0, 2).join(' | ') : e); }
}
function drain(until, max = 300) { for (let k = 0; k < max && !(until && until()); k++) { const f = timers.shift(); if (!f) break; try { f(); } catch (e) { /* stubs */ } } }
const go = (h) => { ctx.location.hash = h; api.render(); };
const toastsSince = (mark) => namedEls['#toasts'].innerHTML.slice(mark);
const fixture = (o) => Object.assign({ id: 'tc' + Math.random().toString(36).slice(2, 7), title: 'Fixture task', agent: 'claude', status: 'running', env: 'local', repo: 'web-app', folder: '~/code/web-app', branch: 'ax/fixture', startedAt: Date.now() - 60000, tokens: 1200, files: [], script: 'generic', step: 0, events: [{ type: 'user', at: Date.now() - 60000, text: 'Fixture goal' }] }, o);

// ---------- 3.1 · Overview ----------
check('3.1 overview: every task with a plain-language status (Running · Waiting for you · Blocked · Done · Failed)', () => {
  go('#/');
  const v = api.viewHome();
  for (const s of ['Waiting for you', 'Failed', 'Done']) if (!v.html.includes(`</svg>${s}</span>`)) throw new Error('missing status chip ' + s);
  if (!/<span>Running <span data-since="\d+" data-fmt="elapsed">\d/.test(v.html)) throw new Error('working rows should say Running');
  const labels = ['running', 'waiting', 'blocked', 'done', 'failed'].map((k) => api.STATUS[k].label).join(' · ');
  if (labels !== 'Running · Waiting for you · Blocked · Done · Failed') throw new Error('status words: ' + labels);
  /* Home is the aggregated overview: every task shows up in one of its sections (the sidebar keeps the 8 most relevant). */
  const missing = S.tasks.filter((t) => !t.notKept && !v.html.includes(`#/task/${t.id}`));
  if (missing.length) throw new Error('Home should list every task: missing ' + missing.map((t) => t.id).join(', '));
  return { html: v.html, axo: 1 };
});
check('3.1 logs: Log is the fourth task tab, with the plain-text log (ax logs --follow); it redacts secrets and follows the task live', () => {
  go('#/task/t4');
  const v = api.viewTask('t4', 'activity');
  const tabs = [...v.html.matchAll(/<a role="tab" id="tab-([a-z]+)"/g)].map((m) => m[1]).join(',');
  if (tabs !== 'activity,changes,terminal,log') throw new Error('tabs should be Activity, Changes, Terminal, Log: ' + tabs);
  if (!/<a role="tab" id="tab-log" href="#\/task\/t4\/log" aria-selected="false" tabindex="-1">Log<\/a>/.test(v.html)) throw new Error('Log tab markup');
  if (/>View log</.test(v.html) || !/data-action="export-oatr" data-task="t4"/.test(v.html)) throw new Error('the tab bar keeps Export trajectory, without a View log button');
  const txt = api.rawLogText(api.getTask('t4'));
  if (!/^# ax logs t4 · Upgrade web-app to Node 22 · codex/.test(txt) || !/tool     \$ Starting Codex in a secure sandbox  → ok/.test(txt) || !/task     stopped · Codex couldn't start/.test(txt)) throw new Error('log lines: ' + txt.slice(0, 300));
  if (/sk-[A-Za-z0-9]{4,}/.test(txt)) throw new Error('secrets must be removed');
  go('#/task/t1/log');
  const lv = api.viewTask('t1', 'log');
  if (!/id="tab-log" href="#\/task\/t1\/log" aria-selected="true" aria-controls="panel-log" tabindex="0"/.test(lv.html) || !/role="tabpanel" class="task-panel" id="panel-log" aria-labelledby="tab-log"/.test(lv.html)) throw new Error('Log tab and panel');
  if (!/id="raw-log" data-task="t1"/.test(lv.html) || !/<code>ax logs t1 --follow<\/code>/.test(lv.html) || !/data-action="copy-log" data-task="t1"/.test(lv.html) || !/data-action="download-log" data-task="t1">[\s\S]*?Download \.txt/.test(lv.html)) throw new Error('log panel: ' + lv.html.slice(0, 300));
  if (namedEls['#overlay'].innerHTML.includes('id="raw-log"')) throw new Error('the log is no longer a dialog');
  const pre = fakeEl('raw-log'); pre.dataset = { task: 't1' }; namedEls['#raw-log'] = pre;
  api.pushEvent(api.getTask('t1'), { type: 'thought', at: Date.now(), text: 'A brand new thought for the log' });
  delete namedEls['#raw-log'];
  if (!/A brand new thought for the log/.test(pre.textContent)) throw new Error('the Log tab should follow new events');
  api.ACTIONS['raw-log']({ dataset: { task: 't4' } });
  if (ctx.location.hash !== '#/task/t4/log') throw new Error('View the full log (and the palette) should open the Log tab: ' + ctx.location.hash);
  return { html: lv.html, axo: 1 };
});

// ---------- 3.2 · Live stream ----------
check('3.2 live stream: thoughts, tool calls with output, and diffs you can open in place', () => {
  const t2 = api.getTask('t2');
  const v = api.viewTask('t2', 'activity');
  if (!/class="ev thought/.test(v.html) || !/<details class="tool-card"><summary>.*<code>pytest --collect-only -q<\/code>/.test(v.html) || !/<pre class="tool-out">42 tests collected/.test(v.html)) throw new Error('thought or tool call missing');
  const ed = t2.events.findIndex((e) => e.type === 'edit');
  const h = api.evHTML(t2, t2.events[ed], ed);
  if (!/<details class="tool-card edit-diff"><summary>/.test(h) || !/Show the changes/.test(h) || !/<table class="diff" role="presentation">/.test(h) || !/tests\/test_auth\.py/.test(h) || !/class="file-chip" href="#\/task\/t2\/changes\?f=tests%2Ftest_auth\.py"/.test(h)) throw new Error('edit entry: ' + h.slice(0, 400));
  return { html: v.html, axo: 1 };
});
check('3.2 live diffs: Changes updates while you watch, as the agent edits (no stale "No changes yet")', () => {
  const t = api.spawnRunning('Live diff fixture', { repo: 'web-app' });
  go('#/task/' + t.id + '/changes');
  if (!/No changes yet/.test(namedEls['#main'].innerHTML)) throw new Error('should start empty');
  drain(() => t.files.length > 0);
  if (!t.files.length) throw new Error('agent should have edited');
  const main = namedEls['#main'].innerHTML;
  if (/No changes yet/.test(main.slice(main.lastIndexOf('task-head'))) || !/class="file-item/.test(main)) throw new Error('Changes should show the new files right away');
  t.status = 'done'; S.tasks.splice(S.tasks.indexOf(t), 1);
});

// ---------- 3.3 / 3.4 · Pause, resume, steer ----------
check('3.3 pause and resume: the Next step holds the only Pause/Resume; Activity records both', () => {
  const t = fixture({ events: [{ type: 'user', at: Date.now(), text: 'Go' }, { type: 'thought', at: Date.now(), text: 'Reading' }] });
  S.tasks.unshift(t); go('#/task/' + t.id);
  if (!/data-action="pause"/.test(api.nextStepHTML(t, 'activity'))) throw new Error('Pause missing');
  api.pauseTask(t);
  if (t.status !== 'waiting' || t.needs.type !== 'paused' || !/Paused by you/.test(api.nextStepHTML(t, 'activity')) || !/data-action="resume"/.test(api.nextStepHTML(t, 'activity'))) throw new Error('pause state');
  api.resumeTask(t);
  if (t.status !== 'running' || !t.events.some((e) => e.type === 'paused') || !t.events.some((e) => e.type === 'resumed')) throw new Error('resume');
  S.tasks.splice(S.tasks.indexOf(t), 1);
});
check('3.3 / 3.4 steer: a message waits for the next turn, or interrupts now; a harness that can’t take input mid-turn offers Pause instead', () => {
  const t = fixture({ events: [{ type: 'user', at: Date.now(), text: 'Go' }] });
  S.tasks.unshift(t); go('#/task/' + t.id);
  api.steerTask(t, 'Use a sliding window');
  let i = t.events.length - 1;
  let h = api.evHTML(t, t.events[i], i);
  if (!/Queued for the next turn/.test(h) || !/data-action="interrupt"/.test(h)) throw new Error('queued: ' + h);
  api.interruptTask(t, i);
  if (t.events[i].delivery !== 'interrupted' || !/Delivered now · interrupted the current turn/.test(api.evHTML(t, t.events[i], i))) throw new Error('interrupt');
  api.steerTask(t, 'And keep the tests');
  i = t.events.length - 1;
  api.deliverQueued(t);
  if (t.events[i].delivery !== 'delivered' || !/Delivered at the next turn/.test(api.evHTML(t, t.events[i], i))) throw new Error('next turn delivery');
  t.noMidTurn = true; api.steerTask(t, 'One more');
  i = t.events.length - 1;
  h = api.evHTML(t, t.events[i], i);
  if (!/can't take input mid-turn/.test(h) || !/Pause instead/.test(h)) throw new Error('no mid-turn: ' + h);
  t.status = 'done';
  if (!/A follow-up starts the sandbox again, with every file kept/.test(api.viewTask(t.id, 'activity').html)) throw new Error('follow-up after done');
  S.tasks.splice(S.tasks.indexOf(t), 1);
});
check('3.4 terminal: `ax ssh` into the sandbox; not offered when there’s no sandbox to open', () => {
  const v = api.terminalPanelHTML(api.getTask('t1'));
  if (!/ax ssh t1/.test(v) || /ax attach/.test(v) || !/id="term-input"/.test(v)) throw new Error('terminal: ' + v.slice(0, 200));
  api.termRun(api.getTask('t1'), 'git status');
  const img = api.spawnFailure('image-unavailable');
  const off = api.terminalPanelHTML(img);
  if (!/There's no sandbox to open/.test(off) || /id="term-input"/.test(off) || !/data-action="focus-next"/.test(off)) throw new Error('no-sandbox state: ' + off.slice(0, 300));
  const starting = fixture({ status: 'starting' });
  if (!/The sandbox is starting/.test(api.terminalPanelHTML(starting))) throw new Error('starting state');
  const items = api.paletteItems();
  return { html: off };
});
check('built for agents: the palette gives the CLI for messages, logs and the terminal', () => {
  go('#/task/t1');
  const items = api.paletteItems();
  const cli = (label) => (items.find((x) => x.label === label) || {}).cli;
  if (cli('Send a message') !== 'ax send t1 "…"' || cli('View log') !== 'ax logs t1 --follow' || cli('Open a terminal') !== 'ax ssh t1') throw new Error('palette CLI: ' + [cli('Send a message'), cli('View log'), cli('Open a terminal')].join(' | '));
});

// ---------- 3.4 · Export, 3.5 · Trajectories ----------
check('3.4 export results: patch, changed files, OATR trajectory and logs, with secrets removed', () => {
  api.openExportResults(api.getTask('t6'));
  const ov = namedEls['#overlay'].innerHTML;
  for (const f of ['t6-changes.patch', 't6-files.txt', 't6.oatr.json', 't6-logs.txt']) if (!ov.includes(f)) throw new Error('missing ' + f);
  if (!/ax export t6 --results/.test(ov)) throw new Error('CLI');
  return { html: ov, axo: 0 };
});
check('3.5 trajectories: OATR export has every event and no raw secrets; Activity says where it is stored', () => {
  const j = JSON.parse(api.oatrJSON(api.getTask('t4')));
  if (j.format !== 'OATR' || j.events.length !== api.getTask('t4').events.length || /sk-[A-Za-z0-9]{6,}/.test(JSON.stringify(j))) throw new Error('oatr');
  if (!/stored on this computer/.test(api.viewTask('t1', 'activity').html) || !/stored on ax-dev-us-central/.test(api.viewTask('t3', 'activity').html)) throw new Error('storage line should say where the trajectory is');
});

// ---------- 3.6 · Blocked requests ----------
check('3.6 blocked: the domain and reason; locally "Allow for <workspace>", on a remote cluster "Blocked by your organization’s policy"', () => {
  const t = fixture({ status: 'blocked', events: [{ type: 'blocked', at: Date.now(), domain: 'raw.githubusercontent.com', purpose: 'Read the example config', cmd: 'curl x' }] });
  S.tasks.unshift(t);
  const ns = api.nextStepHTML(t, 'activity');
  if (!/Allow <span class="mono">raw\.githubusercontent\.com<\/span>\?/.test(ns) || !/Allow for web-app/.test(ns) || !/Allow once/.test(ns) || !/Keep blocked/.test(ns)) throw new Error('local: ' + ns);
  const h = api.evHTML(t, t.events[0], 0);
  if (!/It isn't on this workspace's allowlist/.test(h) || !/Why was this blocked\?/.test(h) || !/ax allow raw\.githubusercontent\.com --workspace web-app/.test(h)) throw new Error('timeline');
  const t3 = api.getTask('t3'); const bi = t3.events.findIndex((e) => e.type === 'blocked');
  if (!/Blocked by your organization's policy/.test(api.evHTML(t3, t3.events[bi], bi))) throw new Error('cluster');
  S.tasks.splice(S.tasks.indexOf(t), 1);
});

// ---------- 3.7 · Permission prompts ----------
check('3.7 decided: by default agents run without asking inside the sandbox (the risky step just runs)', () => {
  S.permMode = 'auto';
  const t = api.spawnRunning('Risky default fixture', { repo: 'web-app' });
  t.step = api.SCRIPTS.generic.findIndex((s) => s.risky);
  api.runStep(t);
  if (t.status !== 'running' || !t.events.some((e) => e.type === 'tool' && /rm -rf dist \.cache/.test(e.cmd)) || t.events.some((e) => e.type === 'permission')) throw new Error('auto mode should not ask');
  t.status = 'done'; S.tasks.splice(S.tasks.indexOf(t), 1);
});
check('3.7 "Ask before risky commands": the agent stops, the Next step and Home ask, and Allow once runs it', () => {
  S.permMode = 'ask';
  const t = api.spawnRunning('Risky ask fixture', { repo: 'web-app' });
  const k = api.SCRIPTS.generic.findIndex((s) => s.risky);
  t.step = k;
  const mark = namedEls['#toasts'].innerHTML.length;
  go('#/');
  api.runStep(t);
  if (t.status !== 'waiting' || !t.needs || t.needs.type !== 'permission' || t.step !== k) throw new Error('should wait before the risky step: ' + t.status);
  if (!/wants to run <span class="mono">rm -rf dist \.cache<\/span>/.test(toastsSince(mark))) throw new Error('should notify while away');
  const ns = api.nextStepHTML(t, 'activity');
  if (!/Let Claude Code run <span class="mono">rm -rf dist \.cache<\/span>\?/.test(ns) || !/data-action="perm-once"/.test(ns) || !/Allow for this task/.test(ns) || !/Don't allow/.test(ns) || !/s-attn/.test(ns)) throw new Error('next step: ' + ns);
  const card = api.needsCardHTML(t);
  if (!/wants to run/.test(card) || !/data-action="perm-task"/.test(card)) throw new Error('Home card');
  if (!api.tabAttnOf(t, 'activity', 'changes') || api.tabAttnOf(t, 'activity', 'changes').sr !== 'needs your OK') throw new Error('tab dot');
  if (!/Waiting for your OK/.test(api.describeEvent(t, t.events[t.events.length - 1], true))) throw new Error('now line');
  const p = api.openPermission(t);
  const h = api.evHTML(t, p.e, p.i);
  if (!/asks before a risky command/.test(h) || !/Guardrails → Inside the sandbox/.test(h) || !/ax approve/.test(h)) throw new Error('timeline: ' + h.slice(0, 300));
  api.resolvePermission(t, p.i, 'once');
  if (t.status !== 'running') throw new Error('Allow once should resume');
  api.runStep(t);
  if (!t.events.some((e) => e.type === 'tool' && /rm -rf dist/.test(e.cmd))) throw new Error('the approved step should run');
  t.status = 'done'; S.tasks.splice(S.tasks.indexOf(t), 1);
  return { html: card };
});
check('3.7 Don’t allow skips the command (the agent carries on); Allow for this task stops asking', () => {
  S.permMode = 'ask';
  const k = api.SCRIPTS.generic.findIndex((s) => s.risky);
  const t = api.spawnRunning('Risky deny fixture', { repo: 'web-app' }); t.step = k;
  api.runStep(t);
  let p = api.openPermission(t);
  api.resolvePermission(t, p.i, 'denied');
  if (t.status !== 'running' || t.step !== k + 1 || !/won't run rm -rf dist \.cache/.test(t.events[t.events.length - 1].text)) throw new Error('deny');
  const t2 = api.spawnRunning('Risky task-wide fixture', { repo: 'web-app' }); t2.step = k;
  api.runStep(t2);
  p = api.openPermission(t2);
  api.resolvePermission(t2, p.i, 'task');
  if (!t2.permForTask) throw new Error('allow for task');
  t2.step = k; api.runStep(t2);
  if (t2.status !== 'running' || t2.events.filter((e) => e.type === 'permission').length !== 1) throw new Error('should not ask again in this task');
  [t, t2].forEach((x) => { x.status = 'done'; S.tasks.splice(S.tasks.indexOf(x), 1); });
  S.permMode = 'auto';
});

// ---------- 3.8 · Notifications ----------
check('3.8 notifications: a task that fails while you’re elsewhere says so (finishes, questions and blocks already did)', () => {
  go('#/');
  const t = fixture({ status: 'starting' });
  S.tasks.unshift(t);
  const mark = namedEls['#toasts'].innerHTML.length;
  t.events.push({ type: 'fail', at: Date.now(), code: 'crash' });
  api.setStatus(t, 'failed');
  if (!/<strong>Fixture task<\/strong> stopped: Claude Code exited unexpectedly/.test(toastsSince(mark)) || !/See what happened/.test(toastsSince(mark))) throw new Error('failure toast: ' + toastsSince(mark).slice(0, 200));
  const m2 = namedEls['#toasts'].innerHTML.length;
  const t2 = fixture({ status: 'starting' }); S.tasks.unshift(t2); go('#/task/' + t2.id);
  t2.events.push({ type: 'fail', at: Date.now(), code: 'crash' }); api.setStatus(t2, 'failed');
  if (toastsSince(m2).includes('stopped:')) throw new Error('no toast on the task you are looking at');
  const sv = api.viewSettings('notifications');
  if (!/Outside AX Studio/.test(sv.html) || !/data-pref="desktop"/.test(sv.html) || !/permission prompts and failures/.test(sv.html)) throw new Error('settings rows');
  [t, t2].forEach((x) => S.tasks.splice(S.tasks.indexOf(x), 1));
  return { html: sv.html, axo: 1 };
});

// ---------- What can go wrong ----------
check('out of memory: which task and its resource use; "Pause N other tasks" when others run here, or move to a remote cluster', () => {
  const other = fixture({ title: 'Other running task' }); S.tasks.unshift(other);
  const t = api.spawnFailure('oom');
  const ctxF = { t, e: t.events[t.events.length - 1] };
  const others = S.tasks.filter((x) => x !== t && x.env === 'local' && (x.status === 'running' || x.status === 'starting'));
  const nOther = others.length;
  const acts = api.failActionsHTML('oom', ctxF, 2);
  if (!/Restart with 8 GB/.test(acts) || !new RegExp('data-fix="pause-others"[^>]*>.*Pause ' + nOther + ' other task').test(acts) || !/Run on a remote cluster/.test(acts)) throw new Error('actions: ' + acts);
  const card = api.failCardHTML('oom', ctxF);
  if (!/used all 4 GB \(Medium\) at their peak/.test(card) || !new RegExp(nOther + ' other tasks? on this computer (is|are) using about').test(card) || !/memory 4\.0 \/ 4\.0 GB \(peak\)/.test(card)) throw new Error('card: ' + card.slice(0, 500));
  api.runFix('pause-others', { dataset: { task: t.id, code: 'oom' } });
  if (others.some((x) => x.status !== 'waiting' || !x.needs || x.needs.type !== 'paused')) throw new Error('other tasks should pause');
  if (/pause-others/.test(api.failActionsHTML('oom', ctxF, 2)) || !/^Restart with 8 GB, or run this task on a remote cluster\.$/.test(api.ERRORS.oom.fix(ctxF))) throw new Error('with nothing else running, no pause action');
  S.tasks.splice(S.tasks.indexOf(other), 1);
  return { html: card };
});
check('the harness crashes: last activity plus a log summary; restart from the current workspace', () => {
  const t = api.spawnFailure('crash');
  const ctxF = { t, e: t.events[t.events.length - 1] };
  const card = api.failCardHTML('crash', ctxF);
  if (!/Its last activity is above/.test(card) || !/SIGABRT \(exit 134\)/.test(card) || !/Restart from current workspace/.test(api.failActionsHTML('crash', ctxF, 2))) throw new Error('crash');
  api.runFix('restart-workspace', { dataset: { task: t.id } });
  if (t.status !== 'starting') throw new Error('restart');
});
check('the laptop sleeps mid-turn and the harness can’t take input mid-turn: both scenarios exist and use the agreed words', () => {
  const ids = api.ACTIONS && true;
  const sc = ['env-sleep', 'task-midturn', 'task-oom', 'task-crash', 'task-permission'];
  const missing = sc.filter((id) => !ctx.__api.runScenario || !vm.runInContext(`SCENARIOS.some((s) => s.id === '${id}')`, ctx));
  if (missing.length) throw new Error('missing scenarios: ' + missing.join(', '));
  const t = fixture({ _held: true }); S.tasks.unshift(t); S.env.health = 'asleep';
  if (!/Paused while your computer slept/.test(api.nextStepHTML(t, 'activity'))) throw new Error('asleep');
  S.env.health = 'healthy'; S.tasks.splice(S.tasks.indexOf(t), 1);
});
check('usage keeps the task’s own budget while it updates live', () => {
  const t = api.getTask('t1'); t.budget = 10;
  const ring = fakeEl('usage-ring'); namedEls['#usage-ring'] = ring;
  go('#/task/t1'); api.refreshLive(t);
  delete namedEls['#usage-ring']; t.budget = 5;
  if (!/of \$10/.test(ring.innerHTML)) throw new Error('ring: ' + ring.innerHTML.slice(0, 200));
});
check('the task-permission scenario opens a task that asks first', () => {
  api.runScenario('task-permission');
  const t = S.tasks[0];
  drain(() => t.status === 'waiting');
  if (t.status !== 'waiting' || t.needs.type !== 'permission' || S.permMode !== 'ask') throw new Error('scenario: ' + t.status);
  S.permMode = 'auto';
  return { html: api.viewTask(t.id, 'activity').html, axo: 1 };
});

Promise.resolve().then(() => {
  console.log(fails ? `\n${fails} of ${n} FAILED` : `\nALL OK (${n} checks)`);
  if (fails) process.exitCode = 1;
});
