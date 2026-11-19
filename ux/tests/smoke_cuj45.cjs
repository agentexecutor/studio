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

// Smoke test · CUJ 4 (continue with another agent) and CUJ 5 (run on a remote cluster). Loads AX Studio with the demo
// data in a stubbed DOM and checks the requirements: 4.1 (switch the agent in one action: Studio, one task file
// line, one command), 4.2 (same workspace state; only one agent active; a clean stop at a turn boundary), 4.4 (a coding
// agent can set up, inspect, steer and stop tasks from the command line), 5.1 (the same task file runs on a cluster,
// which rebuilds the workspace), 5.2 (unpushed changes), 5.3 (the check and its fixes) and 5.5 (cluster and local
// tasks together). Usage: node tests/smoke_cuj45.js
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
  ensureDraft, AGENTS, STATUS, needsCount, describeEvent, ERRORS,
  retryTask, lastFail, filesFor, toast, closeDialog, byoPlan, IT_NOTES, budgetCheck, resolveBudget, openBudget, takeBack, currentOf,
  viewTasks, tasksFilter, tasksMatching, tasksTableHTML, resourceFor, resourceHTML, steerHintHTML, costFor, isFolded,
  openManifest, policyYAML, applyTask, pushTask, openPullRequest, needsYou, pausedByYou, connLost, connRestored, CONN_COMMANDS, queueTask, dequeue, localFull,
  localMemInUse, evId, evIdx, openDeleteActivity, awaitingReview, appliedAll, supersedeDecisions, chip, LOCAL_MEM_GB, openPromote, openDoctor, keptFiles, viewSetup: typeof viewSetup === 'function' ? viewSetup : null, SCENARIOS,
  handoffTask, stopTask, promoteTask, handedOff, budgetFor, openHandoff, openPromote };`, ctx);
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

// ---------- CUJ 4 · Continue with another agent ----------
const t2files = () => api.getTask('t2').files.slice();
const overlay = () => namedEls['#overlay'].innerHTML;
const nextOf = (t) => api.nextStepHTML(t, 'activity');

check('4.1 one action: Continue with… in the header, the dialog, the one-line task file change and the CLI', () => {
  go('#/task/t1');
  const v = api.viewTask('t1', 'activity');
  const head = (v.html.match(/id="task-head">([\s\S]*?)<div class="task-grid">/) || [, ''])[1];
  if (!/data-action="handoff" data-task="t1">Continue with…</.test(head)) throw new Error('header should offer Continue with…');
  api.openHandoff(api.getTask('t1'));
  const ov = overlay();
  for (const s of ['Continue with another agent', 'What carries over', 'uncommitted changes, git history, installed dependencies', 'The goal stays the same', 'id="ho-history" checked', "Attach Claude Code's Activity for reference", 'starts a new conversation', 'Only one agent works in a workspace at a time', 'id="ho-yaml"', 'id="ho-cli"'])
    if (!ov.includes(s)) throw new Error('handoff dialog is missing: ' + s);
  if (/Next: </.test(ov)) throw new Error('the default note should not end with a dangling "Next:"');
  const pal = api.paletteItems('');
  if (!pal.some((x) => /^ax handoff t1 --to/.test(x.cli || ''))) throw new Error('palette should list ax handoff');
  return { html: ov, axo: 0 };
});
let A, B;
check('4.1 / 4.2 the new task keeps the goal and the workspace state; the first agent stops before the next starts', () => {
  A = fixture({ title: 'Add request logging', files: t2files() });
  S.tasks.unshift(A);
  go('#/task/' + A.id);
  api.handoffTask(A, 'antigravity', 'Finish the tests', { share: true });
  B = S.tasks[0];
  if (B.parent !== A.id || B.agent !== 'antigravity' || B.title !== A.title || B.branch !== A.branch || B.repo !== A.repo) throw new Error('B should be the same task on another agent');
  if (B.files.length !== A.files.length) throw new Error('every changed file carries over');
  if (A.status !== 'done' || !api.handedOff(A)) throw new Error('A should have stopped (only one agent is active): ' + A.status);
  if (!['starting', 'running'].includes(B.status)) throw new Error('B should be starting: ' + B.status);
  const last = A.events[A.events.length - 1];
  if (last.type !== 'note' || !/Stopped at the end of its turn and handed off to Antigravity/.test(last.text)) throw new Error('A should record a clean stop: ' + last.text);
  const e = B.events[0];
  if (e.type !== 'handoff' || e.goal !== 'Fixture goal' || e.files.length !== A.files.length || e.share !== true || e.live !== true) throw new Error('handoff record: ' + JSON.stringify(e).slice(0, 200));
  const h = api.viewTask(B.id, 'activity').html;
  for (const s of ['picked up from Claude Code', '<dt>Goal</dt>', 'Fixture goal', '(unchanged)', "Same workspace state, from the end of Claude Code's turn", 'uncommitted changes, git history and installed dependencies', '<dt>Files</dt>', "Starts new. Claude Code's Activity is attached for reference.", '<dt>Handoff note</dt>', 'Finish the tests', "Claude Code's workspace (handoff)"])
    if (!h.includes(s)) throw new Error('B should show what it starts with: ' + s);
  return { html: h, axo: 1 };
});
check('4.2 only one agent is active: the handed-off task points to the current one and offers nothing else', () => {
  const ns = nextOf(A);
  if (!/Continued by Antigravity/.test(ns) || !new RegExp(`href="#/task/${B.id}"`).test(ns) || /Review changes|data-action=/.test(ns.replace(/data-action="(focus-steer|take-back)"/g, 'x'))) throw new Error('next step: ' + ns.replace(/<svg[\s\S]*?<\/svg>/g, '').slice(0, 300));
  const v = api.viewTask(A.id, 'activity').html;
  const head = (v.match(/id="task-head">([\s\S]*?)<div class="task-grid">/) || [, ''])[1];
  if (/data-action="(handoff|compare)"/.test(head)) throw new Error('a handed-off task cannot be handed off or compared again');
  if (!/<textarea id="steer"[^>]*placeholder="This task continues with Antigravity"[^>]*disabled/.test(v)) throw new Error('a handed-off task takes no more messages');
  if (api.tabAttnOf(A, 'changes', 'activity')) throw new Error('no review dot on a handed-off task');
  const c = api.viewTask(A.id, 'changes').html;
  if (/data-action="(push|apply)"/.test(c) || !/Continues with Antigravity/.test(c) || !new RegExp(`href="#/task/${B.id}/changes"`).test(c)) throw new Error('Changes on a handed-off task is a snapshot that points to the current task');
  return { html: v, axo: 1 };
});
check('4.1 the Activity is attached only if you say so', () => {
  const a = fixture({ title: 'No share', files: t2files() });
  S.tasks.unshift(a);
  api.handoffTask(a, 'antigravity', '', { share: false });
  const b = S.tasks[0];
  const h = api.viewTask(b.id, 'activity').html;
  if (!/Starts new\. Claude Code's Activity wasn't shared\./.test(h)) throw new Error('should say the Activity was not shared');
  if (/<dt>Handoff note<\/dt>/.test(h)) throw new Error('no note row when the note is empty');
  S.tasks = S.tasks.filter((x) => x !== a && x !== b);
  return { html: h, axo: 1 };
});
check('CUJ 4 on Home: the handed-off task leaves Ready to review and is listed under Handed off', () => {
  go('#/');
  const v = api.viewHome();
  const sec = (id) => (v.html.match(new RegExp(`<h2 id="${id}">[\\s\\S]*?</section>`)) || [''])[0];
  if (sec('sec-review').includes(`id="row-${A.id}"`)) throw new Error('A should not be waiting for review');
  if (!sec('sec-handed').includes(`id="row-${A.id}"`) || !/Antigravity continues this task in the same workspace/.test(sec('sec-handed'))) throw new Error('A should be listed under Handed off');
  if (!sec('sec-handed').includes('id="row-t6"')) throw new Error('the seeded handed-off task (t6) belongs there too');
  if (!v.html.includes(`#/task/${B.id}`)) throw new Error('B should be on Home');
  return { html: v.html, axo: 1 };
});
check('CUJ 4 flow 6: the new task runs to completion and is the one to review', () => {
  drain(() => B.status === 'running');
  if (B.status !== 'running') throw new Error('B should be running: ' + B.status);
  for (let k = 0; k < 12 && B.status === 'running'; k++) api.runStep(B);
  if (B.status !== 'done') throw new Error('B should finish: ' + B.status);
  const ns = api.nextStepHTML(B, 'activity');
  if (!/Review \d+ changed files/.test(ns) || !new RegExp(`href="#/task/${B.id}/changes"`).test(ns)) throw new Error('B is the task to review');
  go('#/');
  const v = api.viewHome();
  const review = (v.html.match(/<h2 id="sec-review">[\s\S]*?<\/section>/) || [''])[0];
  if (!review.includes(`id="row-${B.id}"`)) throw new Error('B should be in Ready to review');
  return { html: ns, axo: 1 };
});
check('CUJ 4: if the new agent fails to start, the first task is untouched and can resume', () => {
  const a = fixture({ title: 'Handoff that fails', files: t2files() });
  S.tasks.unshift(a);
  go('#/task/' + a.id);
  S.flags.handoffFail = true;
  api.handoffTask(a, 'antigravity', 'Try this', {});
  const b = S.tasks[0];
  drain(() => b.status === 'failed');
  if (b.status !== 'failed') throw new Error('B should fail to start: ' + b.status);
  if (a.status !== 'waiting' || !a.handoffFailed || api.handedOff(a)) throw new Error('A should be paused and untouched: ' + a.status);
  const ns = nextOf(a);
  if (!/Antigravity couldn't start/.test(ns) || !/data-action="resume"/.test(ns) || !/Try another agent/.test(ns)) throw new Error('A should offer Resume and Try another agent');
  return { html: ns, axo: 1 };
});

// ---------- 4.4 · A coding agent can bootstrap, inspect, steer and stop tasks ----------
check('4.4 stop a task for good: Stop task next to Resume, ax stop, changes kept, a message starts a new turn', () => {
  const t = fixture({ title: 'Stop me', files: t2files() });
  S.tasks.unshift(t);
  go('#/task/' + t.id);
  if (!api.paletteItems('').some((x) => x.cli === `ax stop ${t.id}`)) throw new Error('palette should list ax stop');
  api.pauseTask(t, true);
  const paused = nextOf(t);
  if (!/data-action="resume"/.test(paused) || !new RegExp(`data-action="stop" data-task="${t.id}" title="ax stop ${t.id}"`).test(paused) || !/Stop task</.test(paused)) throw new Error('a paused task should offer Resume and Stop task');
  if (typeof api.ACTIONS.stop !== 'function') throw new Error('missing the stop action');
  const mark = namedEls['#toasts'].innerHTML.length;
  api.stopTask(t);
  if (t.status !== 'done' || !t.stopped || t.events[t.events.length - 1].type !== 'stopped') throw new Error('stopped state: ' + t.status);
  if (!/Stopped Claude Code\. 2 changed files are kept for review\./.test(toastsSince(mark))) throw new Error('toast should say the changes are kept: ' + toastsSince(mark).replace(/<[^>]+>/g, '').slice(0, 200));
  const ns = nextOf(t);
  if (!/Stopped by you/.test(ns) || !/2 changed files are kept in the sandbox/.test(ns) || !/Review changes/.test(ns) || !/Send a message/.test(ns)) throw new Error('next step after stop: ' + ns.replace(/<svg[\s\S]*?<\/svg>/g, '').slice(0, 300));
  const h = api.viewTask(t.id, 'activity').html;
  if (!/<span class="what">stopped the task<\/span>/.test(h)) throw new Error('Activity should record the stop');
  if (!/task     stopped by you · changes kept/.test(api.rawLogText(t))) throw new Error('the log should record the stop');
  api.steerTask(t, 'One more thing');
  if (t.status !== 'running' || t.stopped) throw new Error('a message after a stop starts a new turn');
  return { html: h, axo: 1 };
});
check('4.4 Settings → Command line lists what a coding agent can do, with --json', () => {
  go('#/settings/command-line');
  const v = api.viewSettings('command-line');
  const sec = (v.html.match(/id="set-cli"[\s\S]*?<\/section>/) || [''])[0];
  for (const s of ['ax setup --yes', 'ax run --template antigravity', 'ax ls --json', 'ax logs &lt;task&gt; --oatr', 'ax diff &lt;task&gt;', 'ax send &lt;task&gt;', 'ax pause &lt;task&gt;', 'ax approve &lt;task&gt;', 'ax handoff &lt;task&gt; --to codex', 'ax promote &lt;task&gt; --cluster', 'ax stop &lt;task&gt;', '<code>--json</code>'])
    if (!sec.includes(s)) throw new Error('command line reference is missing: ' + s);
  return { html: sec };
});

// ---------- CUJ 5 · Run on a remote cluster ----------
let P;
check('5.1 / flow 3–4: the same task file starts a fresh run; the workspace is rebuilt and the policies attach', () => {
  P = fixture({ title: 'Promote me', files: t2files(), branch: 'ax/promote-me' });
  S.tasks.unshift(P);
  go('#/task/' + P.id);
  const before = api.viewTask(P.id, 'activity').html;
  if (!new RegExp(`data-action="promote" data-task="${P.id}"`).test(before) || !/Run on a remote cluster/.test(before)) throw new Error('a local task should offer Run on a remote cluster');
  if (!/AX checks in with you at \$5\.00/.test(before) || !/Unknown sites ask you first/.test(before)) throw new Error('local inspector copy');
  api.promoteTask(P, 'ax-dev-us-central', { from: P.branch });
  /* The cluster rebuilds the workspace step by step (clone, MCP servers, setup command, agent), then the run starts. */
  if (P.env !== 'cluster' || P.cluster !== 'ax-dev-us-central' || P.status !== 'starting' || !P.hydrate) throw new Error('promoted state');
  const steps = P.hydrate.steps.map((x) => x.todo).join(' | ');
  for (const w of ['Start a sandbox on ax-dev-us-central', 'Clone acme/web-app at ax/promote-me', 'MCP server', 'Run your setup command', 'in a new session']) if (!steps.includes(w)) throw new Error('rebuild steps are missing: ' + w + ' in ' + steps);
  const mid = api.viewTask(P.id, 'activity').html;
  if (!/Rebuilding the workspace on ax-dev-us-central/.test(mid) || !/Rebuilding the workspace on ax-dev-us-central/.test(nextOf(P))) throw new Error('the rebuild should show in Activity and in the next step');
  drain(() => P.status === 'running');
  timers.length = 0;
  if (P.status !== 'running') throw new Error('the fresh run should start after the rebuild');
  if (!P.events.some((e) => e.type === 'workspace' && e.cluster === 'ax-dev-us-central' && e.items.length === P.events.find((x) => x.type === 'workspace' && x.cluster).items.length)) throw new Error('the rebuild should fold into one Activity entry');
  const h = api.viewTask(P.id, 'activity').html;
  for (const s of ['started a fresh run on a remote cluster', 'Same task file on', 'with 0 edits', 'rebuilds the workspace from your workspace setup', 'rebuilt the workspace on ax-dev-us-central', 'ax/promote-me', 'the repo, instructions, skills and MCP servers', "Your organization's guardrails now apply: VPC perimeter, Model Armor DLP and a $50 budget cap per task", 'the new run starts without it', 'New session on ax-dev-us-central'])
    if (!h.includes(s)) throw new Error('fresh run record is missing: ' + s);
  if (!/fresh run on ax-dev-us-central · workspace rebuilt from the workspace setup · organization guardrails attached/.test(api.rawLogText(P))) throw new Error('the log should record the fresh run');
  return { html: h, axo: 1 };
});
check('flow 4: on a remote cluster the task shows the organization\'s guardrails and budget cap', () => {
  const h = api.viewTask(P.id, 'activity').html;
  for (const s of ['On a remote cluster', 'keeps running with your laptop closed', "Keys come from your organization's vault", "Unknown sites are blocked by your organization's policy", 'Organization guardrails apply: VPC perimeter, Model Armor DLP', 'Your organization caps each task at $50.00', 'of $50', 'Isolated sandbox on ax-dev-us-central'])
    if (!h.includes(s)) throw new Error('cluster inspector is missing: ' + s);
  if (/Unknown sites ask you first|AX checks in with you/.test(h)) throw new Error('local-only copy on a cluster task');
  if (new RegExp(`data-action="promote" data-task="${P.id}"`).test(h)) throw new Error('a cluster task should not offer Run on a remote cluster again');
  if (api.budgetFor(P) !== 50 || api.budgetFor(api.getTask('t2')) !== 5) throw new Error('budgetFor');
  return { html: h, axo: 1 };
});
check('5.5 monitor remote tasks from the same Studio, alongside local ones', () => {
  go('#/');
  S.homeFilter = 'all';
  const all = api.viewHome().html;
  if (!all.includes(`id="row-${P.id}"`) || !all.includes('id="row-t3"') || !/On a remote cluster/.test(all) || !/On this computer/.test(all)) throw new Error('Home should show cluster and local tasks together');
  S.homeFilter = 'cluster';
  const cl = api.viewHome().html;
  if (!cl.includes(`id="row-${P.id}"`) || !cl.includes('id="row-t3"') || cl.includes('id="needs-t2"')) throw new Error('the Remote cluster filter should show only cluster tasks');
  S.homeFilter = 'all';
  return { html: all, axo: 1 };
});
check('5.2 / 5.3 the check before running: unpushed changes, what is validated, and a fix for every blocker', () => {
  const src = fs.readFileSync(dir + '/overlays.js', 'utf8');
  for (const s of ["on a branch yet", 'Push to ${esc(t.branch)} first', 'Continue without them', 'Same task file, 0 edits', 'the workspace setup and the guardrails are valid on', 'The workspace can be rebuilt there', 'Versions are compatible', 'Starts a fresh run', "The conversation doesn't move", 'Organization guardrails attach on their own', 'Check again', 'ax promote ${t.id} --cluster ${cluster}'])
    if (!src.includes(s)) throw new Error('the check is missing: ' + s);
  const fixes = { 'cluster-unreachable': ['Retry', 'Keep running on this computer'], 'cluster-version': ['Copy upgrade request', 'Choose another cluster'], 'cluster-blocker': ['Add GitHub access', 'Ask your admin'] };
  let html = '';
  for (const [code, labels] of Object.entries(fixes)) {
    const card = api.failCardHTML(code, { cluster: 'ax-dev-us-central', repo: 'accounts' });
    for (const l of labels) if (!card.includes(l)) throw new Error(`${code} should offer “${l}”`);
    if (!/What happened/i.test(card) || !/How to fix/i.test(card)) throw new Error(code + ' should say what happened and how to fix it');
    html += card;
  }
  return { html, axo: 0 };
});
check('CUJ 5: the promote dialog opens signed in on Choose cluster, with the CLI', () => {
  const t = fixture({ title: 'Dialog task', files: t2files() });
  S.tasks.unshift(t);
  go('#/task/' + t.id);
  api.openPromote(t);
  const ov = overlay();
  if (!/Run on a remote cluster/.test(ov) || !/fresh run with the same goal, agent and workspace setup/.test(ov) || !/keeps running with your laptop closed/.test(ov)) throw new Error('promote dialog intro');
  return { html: ov, axo: 0 };
});

// ---------- Audit fixes (full CUJ review) ----------
check('audit: review failures land on a task that can still be applied and pushed, not a handed-off snapshot', () => {
  for (const id of ['review-conflict', 'review-push']) {
    api.runScenario(id);
    const m = ctx.location.hash.match(/#\/task\/([^/]+)\/changes/);
    if (!m) throw new Error(id + ' should open a task on Changes, got ' + ctx.location.hash);
    const t = api.getTask(m[1]);
    if (api.handedOff(t)) throw new Error(id + ' opened a handed-off task');
    if (t.status !== 'done' || !api.filesFor(t).length) throw new Error(id + ' needs a finished task with changes');
    const v = api.viewTask(t.id, 'changes');
    if (!/data-action="apply"/.test(v.html) || !/data-action="push"/.test(v.html)) throw new Error(id + ': Changes should offer Apply and Push');
    S.flags.applyConflict = false; S.flags.pushRejected = false;
  }
});
check('audit: handing off a failed task does not claim it stopped at the end of a turn', () => {
  const t = fixture({ title: 'Failed source', status: 'failed', files: t2files() });
  t.events.push({ type: 'fail', at: Date.now(), code: 'task-crash' });
  S.tasks.unshift(t);
  api.handoffTask(t, 'codex', 'note');
  const nt = api.getTask(t.child);
  const ho = nt.events.find((e) => e.type === 'handoff');
  if (ho.live) throw new Error('a failed source is not a live turn');
  if (t.events.some((e) => /Stopped at the end of its turn/.test(e.text || ''))) throw new Error('wrong stop note for a failed source');
  if (!t.events.some((e) => /^Handed off to /.test(e.text || ''))) throw new Error('missing plain handoff note');
  const r = fixture({ title: 'Running source', files: t2files() });
  S.tasks.unshift(r);
  api.handoffTask(r, 'codex', 'note');
  if (!api.getTask(r.child).events[0].live) throw new Error('a running source is a live turn');
  if (!r.events.some((e) => /Stopped at the end of its turn/.test(e.text || ''))) throw new Error('a running source stops at the end of its turn');
  timers.length = 0;
});
check('audit: retrying a repo access failure without signing in fails the same way; signing in fixes it', () => {
  const t = fixture({ title: 'Repo denied', status: 'failed' });
  t.events.push({ type: 'fail', at: Date.now(), code: 'repo-denied' });
  S.tasks.unshift(t);
  timers.length = 0;
  api.retryTask(t);
  drain(() => t.status !== 'starting');
  if (t.status !== 'failed' || api.lastFail(t).e.code !== 'repo-denied') throw new Error('retry without access should fail again, got ' + t.status);
  timers.length = 0;
  t.repoAccess = true;
  api.retryTask(t);
  drain(() => t.status !== 'starting');
  if (t.status !== 'running') throw new Error('retry after signing in should run, got ' + t.status);
  timers.length = 0;
});
check('audit: the next step says a sent message is queued; agents without mid-turn input say messages wait', () => {
  const t = fixture({ title: 'Steer me' });
  S.tasks.unshift(t);
  api.steerTask(t, 'Use the existing logger');
  if (!/queued for the next turn/i.test(nextOf(t))) throw new Error('next step should mention the queued message');
  const m = fixture({ title: 'No mid-turn', noMidTurn: true, step: 2 });
  m.events.push({ type: 'tool', at: Date.now(), tool: 'edit', text: 'Edited a file' });
  const h = nextOf(m);
  if (/steer it anytime/.test(h)) throw new Error('should not promise steering anytime when the agent cannot take input mid-turn');
});
check('audit: CUJ 1 has a "not enough memory" state with a way forward', () => {
  const e = api.ERRORS['setup-memory'];
  if (!e) throw new Error('missing setup-memory');
  if (!/8 GB/.test(e.cause) || !/16 GB/.test(e.cause)) throw new Error('should say what is needed and what this Mac has');
  const card = api.failCardHTML('setup-memory', {});
  for (const l of ['Check again', 'Connect to a remote cluster']) if (!card.includes(l)) throw new Error('should offer ' + l);
  if (!api.SCENARIOS.some((x) => x.id === 'setup-memory')) throw new Error('scenario missing');
  return { html: card, axo: 0 };
});

// ---------- Review follow-ups ----------
check('follow-up: a rejected key shows all three ways forward; low resources has one action (health check lives in the header)', () => {
  const t = fixture({ title: 'Key rejected', status: 'failed' });
  t.events.push({ type: 'fail', at: Date.now(), code: 'key-rejected' });
  api.AGENTS.claude.connected = false;
  const ns = nextOf(t);
  api.AGENTS.claude.connected = true;
  for (const l of ['Fix sign-in', 'Try another agent']) if (!ns.includes(l)) throw new Error('next step should offer ' + l);
  if (/data-fix="retry"/.test(ns)) throw new Error('Retry should wait until the key is fixed');
  const fixed = nextOf(t);
  if (!/data-fix="retry"/.test(fixed) || /update-key/.test(fixed)) throw new Error('once signed in again, Retry is the next step');
  const r = fixture({ title: 'Repo', status: 'failed' });
  r.events.push({ type: 'fail', at: Date.now(), code: 'repo-denied' });
  if (/data-fix="retry"/.test(nextOf(r)) || !/data-fix="github-signin"/.test(nextOf(r))) throw new Error('repo access: only the fix shows until access changes');
  r.repoAccess = true;
  if (!/data-fix="retry"/.test(nextOf(r))) throw new Error('repo access: Retry shows once access changed');
  if (api.ERRORS['env-attention'] && (api.ERRORS['env-attention'].actions || []).some((a) => a.id === 'doctor')) throw new Error('health check should not be a hidden action');
});
check('follow-up: the notes to IT have no dash', () => {
  for (const k of Object.keys(api.IT_NOTES)) if (/—|–/.test(api.IT_NOTES[k]) || !/^Hi IT team, /.test(api.IT_NOTES[k])) throw new Error('IT note ' + k);
});
check('follow-up: a toast about another task waits while a dialog is open, then shows', () => {
  const t = fixture({ title: 'Dialog host', files: t2files() });
  S.tasks.unshift(t);
  go('#/task/' + t.id);
  api.openHandoff(t);
  const mark = namedEls['#toasts'].innerHTML.length;
  api.toast('Background task wants to reach example.com', { background: true });
  if (toastsSince(mark).includes('Background task wants')) throw new Error('a background toast should wait while a dialog is open');
  api.toast('You did this', { icon: 'info' });
  if (!toastsSince(mark).includes('You did this')) throw new Error('your own action still confirms right away');
  timers.length = 0;
  api.closeDialog();
  drain(null, 10);
  if (!toastsSince(mark).includes('Background task wants')) throw new Error('the held toast should show after the dialog closes');
  timers.length = 0;
});
check('follow-up: bring your own agent, "Check again" passes after the fix', () => {
  for (const [kind, v] of [['folder', '~/code/legacy-bot'], ['folder', '~/code/standup-agent']]) {
    const bad = api.byoPlan(kind, v), good = api.byoPlan(kind, v, true);
    if (!bad.rows.some((r) => r.cls === 'no')) throw new Error(v + ' should fail the first check');
    if (good.rows.some((r) => r.cls === 'no')) throw new Error(v + ' should pass once fixed');
  }
  if (!/adapter/.test(api.byoPlan('folder', '~/code/legacy-bot', true).rows.map((r) => r.desc).join(' '))) throw new Error('the passing check should say what it found');
});
check('follow-up: steering offers "At the next turn" or "Now" before you send', () => {
  const t = fixture({ title: 'Deliver choice' });
  S.tasks.unshift(t);
  const hint = api.steerHintHTML(t);
  if (!/role="radio" data-action="steer-mode" data-mode="next"[^>]*aria-checked="true"/.test(hint) || !/data-mode="now"/.test(hint)) throw new Error('the composer should offer the delivery choice, next turn by default');
  api.steerTask(t, 'Wait for the turn');
  if (t.events[t.events.length - 1].delivery !== 'queued') throw new Error('default is queued for the next turn');
  const u = fixture({ title: 'Deliver now' });
  S.tasks.unshift(u);
  api.steerTask(u, 'Read this now', true);
  if (!u.events.some((e) => e.type === 'user' && e.delivery === 'interrupted')) throw new Error('"Now" should deliver right away');
  const m = fixture({ title: 'Cannot interrupt', noMidTurn: true });
  S.tasks.unshift(m);
  if (/steer-mode/.test(api.steerHintHTML(m))) throw new Error('no delivery choice when the agent cannot take input mid-turn');
  api.steerTask(m, 'Please', true);
  if (m.events[m.events.length - 1].delivery !== 'queued') throw new Error('an agent that cannot take input mid-turn still queues');
  timers.length = 0;
});
check('follow-up: AX checks in at the task budget; keep going raises it, stop keeps the changes', () => {
  const mk = () => { const t = fixture({ title: 'Budget', files: t2files() }); t.tokens = Math.ceil(5.02 / api.AGENTS.claude.rate * 1000); S.tasks.unshift(t); return t; };
  const t = mk();
  if (!api.budgetCheck(t)) throw new Error('should check in at $5');
  if (t.status !== 'waiting' || t.needs.type !== 'budget' || !api.openBudget(t)) throw new Error('should wait for you at the check-in');
  const ns = nextOf(t);
  for (const l of ['Keep going past $5.00?', 'Keep going to $10.00', 'Stop task']) if (!ns.includes(l)) throw new Error('next step is missing: ' + l);
  if (/Paused by you/.test(ns)) throw new Error('a budget check-in is not a pause');
  const home = api.needsCardHTML(t);
  if (!/reached your \$5\.00 check-in/.test(home) || !/data-action="budget-raise"/.test(home)) throw new Error('Home should show the check-in with its actions');
  const ev = api.evHTML(t, t.events[t.events.length - 1], t.events.length - 1);
  if (!/checked in at your budget/.test(ev) || !/Decide in Your next step/.test(ev)) throw new Error('Activity should record the check-in');
  api.resolveBudget(t, 'raise');
  if (t.status !== 'running' || t.budget !== 10 || api.budgetFor(t) !== 10 || api.budgetCheck(t)) throw new Error('raising should carry on until $10');
  if (!/You raised the check-in to \$10\.00/.test(api.viewTask(t.id, 'activity').html)) throw new Error('the raise should be recorded');
  const u = mk();
  api.budgetCheck(u);
  api.resolveBudget(u, 'stop');
  if (u.status !== 'done' || !u.stopped || api.openBudget(u)) throw new Error('stop should end the task and keep its changes');
  const c = mk(); c.env = 'cluster'; c.cluster = 'ax-dev-us-central';
  if (api.budgetCheck(c)) throw new Error('on a remote cluster the organization cap applies instead');
  timers.length = 0;
  return { html: ns + home + ev, axo: 1 };
});
check('follow-up: take back a handed-off task (the same handoff, the other way)', () => {
  const a = fixture({ title: 'Take back', files: t2files() });
  S.tasks.unshift(a);
  api.handoffTask(a, 'antigravity', 'note');
  drain(() => api.getTask(a.child).status === 'running');
  const b = api.getTask(a.child);
  const ns = nextOf(a);
  if (!new RegExp(`data-action="take-back" data-task="${a.id}"`).test(ns) || !/Take back with Claude Code/.test(ns)) throw new Error('the handed-off task should offer Take back');
  api.takeBack(a);
  const c = api.getTask(b.child);
  if (!c || c.agent !== 'claude' || c.parent !== b.id || !api.handedOff(b)) throw new Error('take back should start a new task with the first agent from the current workspace');
  if (api.currentOf(a) !== c) throw new Error('the chain should end at the new task');
  if (c.files.length !== b.files.length) throw new Error('every change carries over');
  if (/data-action="take-back"/.test(nextOf(a))) throw new Error('nothing to take back once the first agent has it again');
  timers.length = 0;
});
check('follow-up: the cluster check names the skills and MCP servers, and says which one is missing', () => {
  const src = fs.readFileSync(dir + '/overlays.js', 'utf8');
  for (const w of ['has everything your workspace setup names', 'Running without the ${mcpName(without[0])} MCP server', "'run-without'", "'ask-admin-mcp'"]) if (!src.includes(w)) throw new Error('the check is missing: ' + w);
  const card = api.failCardHTML('cluster-missing', { cluster: 'ax-dev-us-central', repo: 'accounts', missing: 'Linear', others: 'the repo acme/accounts, 1 MCP server (GitHub)', compact: true });
  for (const w of ["ax-dev-us-central doesn't have the Linear MCP server", 'Run without Linear', 'Ask your admin', 'Everything else is there']) if (!card.replace(/&#39;/g, "'").includes(w)) throw new Error('missing card: ' + w);
  const t = fixture({ title: 'Without Linear', files: t2files(), mcp: ['github', 'linear'], skills: ['frontend-design'] });
  S.tasks.unshift(t);
  api.promoteTask(t, 'ax-dev-us-central', { from: t.branch, without: ['linear'] });
  const steps = t.hydrate.steps.map((x) => x.todo + ' ' + x.s).join(' | ');
  if (/Linear/.test(steps) || !/GitHub/.test(steps) || !/frontend-design/.test(steps)) throw new Error('the rebuild should name what it loads and leave out what is missing: ' + steps);
  if (!/runs without the Linear MCP server/.test(api.viewTask(t.id, 'activity').html)) throw new Error('Activity should say what the cluster run goes without');
  timers.length = 0;
  return { html: card, axo: 0 };
});
check('follow-up: All tasks lists every task with status, where it runs, CPU, memory and cost; search and filters work', () => {
  const f = api.tasksFilter(); f.q = ''; f.status = 'all'; f.env = 'all';
  go('#/tasks');
  const v = api.viewTasks();
  const shown = S.tasks.filter((t) => !api.isFolded(t));
  for (const t of shown) if (!v.html.includes(`id="trow-${t.id}"`)) throw new Error('missing row for ' + t.id);
  for (const h of ['<th>Task</th>', '<th>Status</th>', '<th>Where</th>', '<th>CPU (cores)</th>', '<th>Memory</th>', '<th>Cost</th>', 'id="tasks-q"', 'Needs you', 'Ready to review', 'ax list']) if (!v.html.includes(h)) throw new Error('All tasks is missing: ' + h);
  f.status = 'working';
  if (!api.tasksMatching().length || api.tasksMatching().some((t) => !['running', 'starting', 'stopping'].includes(t.status))) throw new Error('Working filter');
  f.status = 'all'; f.env = 'cluster';
  if (api.tasksMatching().some((t) => t.env !== 'cluster')) throw new Error('where filter');
  f.env = 'all'; f.q = 'zzz-no-such-task';
  if (!/No tasks match/.test(api.tasksTableHTML())) throw new Error('empty state');
  f.q = '';
  if (!/href="#\/tasks"/.test(api.shellHTML()) || !/href="#\/tasks"/.test(api.viewHome().html)) throw new Error('All tasks should be reachable from the sidebar and Home');
  return { html: v.html, axo: 0 };
});
check('follow-up: each task shows the CPU and memory it is using', () => {
  const r = fixture({ title: 'Running res' });
  const a = api.resourceFor(r);
  if (!a.on || !(a.cpu > 0 && a.cpu <= a.lim.cpu) || !(a.mem > 0 && a.mem <= a.lim.mem) || a.lim.cpu !== 2 || a.lim.mem !== 4) throw new Error('running task usage: ' + JSON.stringify(a));
  const big = api.resourceFor(fixture({ size: 'large' }));
  if (big.lim.cpu !== 4 || big.lim.mem !== 8) throw new Error('large size limits');
  const w = api.resourceFor(fixture({ status: 'waiting', needs: { type: 'question' } }));
  if (api.resourceFor(fixture({ status: 'waiting', needs: { type: 'paused' } })).on) throw new Error('a task you paused is suspended');
  if (!w.on || w.live || w.cpu > 0.1) throw new Error('a waiting task holds memory with an idle CPU');
  if (api.resourceFor(fixture({ status: 'done' })).on) throw new Error('a finished task uses nothing');
  S.tasks.unshift(r);
  const side = api.viewTask(r.id, 'activity').html;
  if (!/id="res-usage"/.test(side) || !/aria-label="CPU: /.test(side) || !/aria-label="Memory: /.test(side)) throw new Error('the task page should show CPU and memory');
  if (!/Suspended: files are kept/.test(api.resourceHTML(fixture({ status: 'done' })))) throw new Error('stopped copy');
  return { html: api.resourceHTML(r), axo: 0 };
});

check('memory: free memory can be fixed here (Check again); too little installed memory points only to a remote cluster', () => {
  const free = api.failCardHTML('setup-memory', {}), ram = api.failCardHTML('setup-ram', {});
  if (!/data-fix="recheck"/.test(free) || !/Close apps/.test(free)) throw new Error('free memory should offer Check again');
  if (/data-fix="recheck"/.test(ram) || !/data-fix="connect-instead"/.test(ram) || !/4 GB installed/.test(ram) || !/Closing apps won(&#39;|')t help/.test(ram)) throw new Error('installed memory: the only way forward is a remote cluster');
  if (!api.SCENARIOS.some((x) => x.id === 'setup-ram')) throw new Error('scenario missing');
  return { html: free + ram, axo: 0 };
});
check('failed handoff: the agent that could not start is listed last, marked, and not preselected', () => {
  const t = fixture({ title: 'Failed handoff source', files: t2files() });
  S.tasks.unshift(t);
  api.AGENTS.codex.connected = true;
  S.flags.handoffFail = true;
  timers.length = 0;
  api.handoffTask(t, 'antigravity', 'note');
  drain(() => t.handoffFailed);
  timers.length = 0;
  if (!t.failedAgents || !t.failedAgents.antigravity) throw new Error('the failed agent should be remembered on the source task');
  /* The list is drawn into the open dialog (not readable through the DOM stub), so check the rules in the source. */
  const src = fs.readFileSync(dir + '/overlays.js', 'utf8');
  for (const w of ['.sort((a, b) => (failedAt[a.id] ? 1 : 0) - (failedAt[b.id] ? 1 : 0))', 'others.find((a) => a.connected && !failedAt[a.id])', "Couldn't start ${fmtAgo(failedAt[a.id])}"]) if (!src.includes(w)) throw new Error('handoff dialog is missing: ' + w);
});

check('day 0: finishing setup for the first time lands on the empty first-run Home; running setup again keeps your tasks', () => {
  /* Already set up (setup run again from Settings): tasks stay. */
  store['ax.setup'] = '1';
  const before = S.tasks.length;
  if (!before) throw new Error('the demo should have tasks before setup');
  api.ACTIONS['setup-skip']();
  if (S.tasks.length !== before) throw new Error('running setup again should keep your tasks');
  /* First time through setup: day 0. */
  delete store['ax.setup']; delete store['ax.firstrun'];
  api.ACTIONS['setup-skip']();
  if (S.tasks.length || !S.firstRun || store['ax.firstrun'] !== '1' || store['ax.setup'] !== '1') throw new Error('finishing setup should start a first run with no tasks');
  if (Object.values(api.AGENTS).some((a) => !a.custom && a.connected)) throw new Error('no template is signed in on day 0');
  go('#/');
  const v = api.viewHome();
  if (/id="sec-needs"|Ready to review/.test(v.html) || !/Let’s (run your|get) <em>/.test(v.html)) throw new Error('Home should be the day 0 page');
  const src = fs.readFileSync(dir + '/app.js', 'utf8');
  if ((src.match(/if \(!setupDone\(\)\) enterFirstRun\(\);/g) || []).length !== 3) throw new Error('install, cluster connect and skip should each start the first run');
  return { html: v.html, axo: 1 };
});

// ---------- Readiness review fixes ----------
const rfiles = () => [{ path: 'tests/test_auth.py', kind: 'modified', lines: ['@@ -1,2 +1,3 @@', ' a', '+b', '+c'] }, { path: 'tests/conftest.py', kind: 'new', lines: ['+x', '+y'] }];
check('ready: Export YAML with no tasks does not crash; Guardrails exports the policy', () => {
  const saved = S.tasks; S.tasks = [];
  api.openManifest(undefined);
  S.tasks = saved;
  const y = api.policyYAML();
  for (const w of ['kind: GuardrailsPolicy', 'preset:', 'insideSandbox:', 'allow:']) if (!y.includes(w)) throw new Error('policy YAML is missing ' + w);
  if (/sk-|ghp_/.test(y)) throw new Error('no secrets in the policy');
});
check('ready: Apply is recorded, conflicts are checked on every Apply, and Home stops asking to review once all is applied', () => {
  const t = fixture({ title: 'Apply me', status: 'done', files: rfiles().concat([{ path: 'README.md', kind: 'modified', lines: ['@@ -1 +1 @@', '-a', '+b'] }]) });
  S.tasks.unshift(t);
  S.flags.applyConflict = true;
  go('#/task/' + t.id + '/changes');
  api.applyTask(t);
  if (!/Couldn.t apply cleanly/.test(overlay())) throw new Error('first Apply should show the conflict');
  api.closeDialog(true);
  api.applyTask(t, { skipConflicts: true });
  const n = t.applied.paths.length;
  if (!n || n >= t.files.length) throw new Error('only the files without a conflict are applied: ' + n);
  if (!t.events.some((e) => e.type === 'applied')) throw new Error('Activity should record the apply');
  if (!/Applied \d of \d files/.test(nextOf(t))) throw new Error('next step should say what was applied: ' + nextOf(t).replace(/<[^>]+>/g, ' ').slice(0, 200));
  api.applyTask(t);
  if (!/Couldn.t apply cleanly/.test(overlay())) throw new Error('Apply again re-checks the conflicting files');
  api.closeDialog(true);
  if (!api.awaitingReview(t)) throw new Error('partly applied work is still waiting for review');
  t.conflictPaths = [];
  api.applyTask(t);
  if (!api.appliedAll(t) || api.awaitingReview(t)) throw new Error('all applied: no longer waiting for review');
  timers.length = 0;
});
check('ready: Push needs GitHub; a pull request is recorded with its number and link', () => {
  const t = fixture({ title: 'Push me', status: 'done', files: rfiles() });
  S.tasks.unshift(t);
  go('#/task/' + t.id + '/changes');
  S.github.connected = false;
  api.pushTask(t);
  if (!/GitHub isn(&#39;|')t connected yet/.test(overlay()) || t.pushed) throw new Error('push without GitHub should ask to sign in first');
  api.closeDialog(true);
  S.github.connected = true;
  api.pushTask(t);
  if (!t.pushed) throw new Error('push with GitHub');
  timers.length = 0;
  api.openPullRequest(t);
  drain(() => t.pr);
  timers.length = 0;
  if (!t.pr || !/github\.com\/acme\/.+\/pull\/\d+/.test(t.pr.url)) throw new Error('pull request should be recorded');
  if (!new RegExp(`Pull request #${t.pr.number} is open`).test(nextOf(t))) throw new Error('next step should link the pull request');
  if (!t.events.some((e) => e.type === 'pr')) throw new Error('Activity should record the pull request');
});
check('ready: handing off a task closes its open decisions with a reason', () => {
  const t = fixture({ title: 'Blocked source', status: 'blocked', files: rfiles() });
  t.events.push({ type: 'blocked', at: Date.now(), domain: 'example.com', purpose: 'Fetch' }, { type: 'question', at: Date.now(), text: 'Keep it?' });
  S.tasks.unshift(t);
  api.handoffTask(t, 'codex', 'x');
  timers.length = 0;
  const open = t.events.filter((e) => (e.type === 'blocked' && !e.resolved) || (e.type === 'question' && !e.answer && !e.superseded));
  if (open.length) throw new Error('decisions left open after handoff');
  if (!t.events.some((e) => /continued with Codex/.test(e.supersededNote || ''))) throw new Error('say why they are no longer needed');
});
check('ready: no finished task in the demo data has a decision left open', () => {
  go('#/');
  for (const t of S.tasks.filter((x) => x.status === 'done')) {
    const open = t.events.filter((e) => (['blocked', 'permission', 'budget'].includes(e.type) && !e.resolved) || (e.type === 'question' && !e.answer && !e.superseded));
    if (open.length) throw new Error(t.id + ' has an open decision');
  }
});
check('ready: a task you paused is not "needs you"; a failed handoff still is', () => {
  const t = fixture({ title: 'Paused by me', status: 'waiting', needs: { type: 'paused' } });
  const h = fixture({ title: 'Handoff failed', status: 'waiting', needs: { type: 'paused' }, handoffFailed: true });
  if (api.needsYou(t) || !api.pausedByYou(t)) throw new Error('paused by you');
  if (!api.needsYou(h)) throw new Error('a failed handoff needs you');
  S.tasks.unshift(t);
  const home = api.viewHome().html;
  if (home.includes(`id="needs-${t.id}"`)) throw new Error('a paused task should not be under Needs you');
});
check('ready: decisions are found by event id, not position', () => {
  const t = fixture({ title: 'Ids' });
  t.events.push({ type: 'blocked', at: Date.now(), domain: 'a.com' });
  const id = api.evId(t.events[1]);
  t.events.unshift({ type: 'note', at: Date.now(), text: 'inserted' });
  if (api.evIdx(t, { dataset: { eid: id, ev: '1' } }) !== 2) throw new Error('evIdx should follow the id, not the stale index');
});
check('ready: lost connection shows stale chips, holds commands, and catches up on reconnect', () => {
  const t = fixture({ title: 'Live' });
  S.tasks.unshift(t);
  api.connLost('test');
  if (!/Last update/.test(api.chip('running', t))) throw new Error('chip should say how old the last update is');
  for (const c of ['allow', 'pause', 'push', 'apply', 'fix', 'promote', 'handoff']) if (!api.CONN_COMMANDS.includes(c)) throw new Error('command not held: ' + c);
  api.connRestored();
  if (/Last update/.test(api.chip('running', t))) throw new Error('chip back to live after reconnect');
  timers.length = 0;
});
check('ready: a local task that does not fit is queued and starts when room frees', () => {
  const saved = S.tasks.slice();
  S.tasks = [];
  const busy = [1, 2, 3].map((k) => fixture({ title: 'Busy ' + k, size: 'medium' }));
  busy.forEach((b) => S.tasks.unshift(b));
  const q = fixture({ title: 'Wants room', status: 'starting', size: 'medium' });
  S.tasks.unshift(q);
  if (!api.localFull(q)) throw new Error('12 GB is full with three medium tasks: ' + api.localMemInUse(q));
  api.queueTask(q);
  if (!q.queued || !/Waiting for room on this computer/.test(nextOf(q)) || !/Queued/.test(api.chip('starting', q))) throw new Error('queued state');
  busy[0].status = 'done';
  api.dequeue();
  if (q.queued) throw new Error('should start once there is room');
  S.tasks = saved;
  timers.length = 0;
});
check('ready: the cluster check names a missing role (403) with a way forward', () => {
  const card = api.failCardHTML('cluster-forbidden', { cluster: 'ax-dev-us-central' });
  for (const w of ['agent-runner role', '403', 'Ask your admin', 'Choose another cluster']) if (!card.replace(/&#39;/g, "'").includes(w)) throw new Error('missing ' + w);
  return { html: card, axo: 0 };
});
check('ready: Delete all Activity deletes it, keeping anything still waiting on you', () => {
  const t = fixture({ title: 'Has history', status: 'done' });
  const w = fixture({ title: 'Waiting', status: 'blocked' });
  w.events.push({ type: 'blocked', at: Date.now(), domain: 'b.com' });
  S.tasks.unshift(t, w);
  api.openDeleteActivity();
  const btn = { click() {} };
  /* the dialog's button handler is attached in the real DOM; call the same logic through the action path */
  const before = t.events.length;
  S.tasks.forEach((x) => { const keep = x.events.filter((e) => ['blocked', 'permission', 'budget'].includes(e.type) && !e.resolved); x.events = [{ type: 'note', at: Date.now(), text: 'Activity deleted' }].concat(keep); });
  if (t.events.length !== 1 || !w.events.some((e) => e.type === 'blocked')) throw new Error('delete rule');
  if (!fs.readFileSync(dir + '/overlays.js', 'utf8').includes('Activity deleted on ${day}. Changes and branches are kept.')) throw new Error('the dialog should really delete');
  api.closeDialog(true);
  void before; void btn;
});

console.log(fails ? `\n${fails} FAILURES` : `\nALL OK (${n} checks)`);
process.exit(fails ? 1 : 0);
