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

/* AX Studio: live mode.

   When the Studio server (ax-studio) serves this page, the pages in this file and in live-env.js show real data from
   AX, and every page that has no real source yet stays hidden. In a plain browser there is no server, so the app runs
   on demo data and nothing here is used. api.js is the way to the server.

   Real today:
   - this computer and the clusters in your kubeconfig, with setup of AX on this computer (live-env.js)
   - the task list, each task's goal and state, and a task's details, result and task file
   - for a task with debug access, what it changed in its sandbox, with push to a branch (live-changes.js)
   - pause, resume and delete
   - starting a task, following up on one, and running one on another cluster (live-new.js)

   Tasks come from the AX server as data. Studio never changes your kubeconfig: it names the cluster on every request. */

const LIVE = {
  on: typeof STUDIO !== 'undefined' && STUDIO.on,
  phase: 'starting',     // starting, offline (the Studio server isn't answering) or ready
  started: false,
  offlineError: '',
  offlineAt: 0,
  axVersion: '',         // from ax version
  axError: '',           // why the ax command couldn't run; setup, New task and sending a task to a cluster need it
  env: null,             // what the server last said about this computer and your kubeconfig
  envError: '',
  envAt: 0,
  checks: [],            // { id, label, status: ok | warn | fail, detail, command }: what AX on this computer needs
  canStartLocal: false,
  local: null,           // { name, state: NotFound | Stopped | Running, context, substrate, server }
  op: null,              // setup in progress, or the last one: { id, action, stage, status, error, logs }
  contexts: [],          // { name, cluster, current, isLocal }, from your kubeconfig
  context: '',           // the cluster Studio talks to
  atespace: 'default',
  tasks: [],             // see liveTask
  detail: {},            // task name -> { doc, yaml, error, missing }
  error: '',             // why the last task list failed
  errorCode: '',
  failedAt: 0,
  loaded: false,         // the first task list has arrived (or failed)
  refreshedAt: 0,
  busy: {},              // task name -> 'suspend', 'resume' or 'delete'
  loading: false,
  lastPath: null,
};
const LIVE_POLL_MS = 4000;
const LIVE_RETRY_MS = 20000; // after AX couldn't be reached, wait this long before asking again on its own
const LIVE_ENV_MS = 15000;
const LIVE_CONTEXT_KEY = 'ax.live.context';

/* AX's task states in the UI's words. `chip` is the status style the rest of the app uses; `rank` sorts the list:
   what needs you first, then what's working, then the rest. */
const LIVE_STATES = {
  RequiresAction: { label: 'Waiting for you', chip: 'waiting', icon: 'hand', rank: 0 },
  Failed: { label: 'Failed', chip: 'failed', icon: 'xCircle', rank: 0 },
  Working: { label: 'Running', chip: 'running', icon: 'loader', rank: 1, active: true },
  Queued: { label: 'Starting', chip: 'starting', icon: 'loader', rank: 1, active: true },
  Suspending: { label: 'Pausing', chip: 'stopping', icon: 'loader', rank: 1, active: true },
  Terminating: { label: 'Deleting', chip: 'stopping', icon: 'loader', rank: 1, active: true },
  Suspended: { label: 'Paused', chip: 'paused', icon: 'pause', rank: 2 },
  Idle: { label: 'Idle', chip: 'paused', icon: 'pause', rank: 2 },
  Completed: { label: 'Done', chip: 'done', icon: 'checkCircle', rank: 3 },
  Cancelled: { label: 'Stopped', chip: 'paused', icon: 'pause', rank: 3 },
};
function liveState(s) { return LIVE_STATES[s] || { label: 'Unknown', chip: 'paused', icon: 'clock', rank: 2 }; }
/** "TASK_STATE_REQUIRES_ACTION" (the API) -> "RequiresAction" (what `ax get tasks` prints). */
function liveStateName(v) {
  return String(v || '').replace(/^TASK_STATE_/, '').toLowerCase().split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('') || 'Unknown';
}
const LIVE_RESULTS = { TASK_RESULT_SUCCEEDED: 'Succeeded', TASK_RESULT_FAILED: 'Failed', TASK_RESULT_CANCELLED: 'Cancelled' };

/** A Task from the API, with what the pages read most. The goal field is `text` in newer AX and `spec` in older. */
function liveTask(doc) {
  const meta = (doc && doc.metadata) || {}, spec = (doc && doc.spec) || {}, status = (doc && doc.status) || {};
  return {
    name: meta.name || '',
    atespace: meta.atespace || 'default',
    state: liveStateName(status.state),
    created: meta.createTime || '',
    goal: String((spec.goal && (spec.goal.text || spec.goal.spec)) || '').trim(),
    session: spec.sessionId || '',
    debug: !!spec.debug,
    doc,
  };
}
/** "12 min", "3 hr", "2 days": how long ago an API timestamp was. '' when there is none. */
function liveAge(iso) {
  const t = iso ? Date.parse(iso) : NaN;
  if (isNaN(t)) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'moments';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr`;
  return plural(Math.round(h / 24), 'day');
}
function liveLastLine(text) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  return (lines[lines.length - 1] || '').replace(/^Error:\s*/i, '');
}
/** The ax command that does the same, to show and copy. It names the cluster, so your kubeconfig is never changed. */
function liveCmd(args) { return ['ax'].concat(LIVE.context ? ['--context', LIVE.context] : [], args).join(' '); }

/* ---------- Loading ---------- */
function liveRouteTask() { const r = parseRoute(); return r.parts[0] === 'task' && r.parts[1] ? decodeURIComponent(r.parts[1]) : ''; }
function liveSnapshot() {
  const cur = liveRouteTask();
  return JSON.stringify([LIVE.phase, LIVE.tasks.map((t) => [t.name, t.state, t.goal, t.created]), LIVE.error, LIVE.contexts, LIVE.envError, LIVE.local, LIVE.checks,
    LIVE.context, LIVE.busy, LIVE.loaded, LIVE.axError, LIVE.op && [LIVE.op.id, LIVE.op.status], cur && LIVE.detail[cur]]);
}
async function liveStart() {
  if (!LIVE.on || LIVE.started) return;
  LIVE.started = true;
  Object.assign(ACTIONS, LIVE_ACTIONS, LIVE_ENV_ACTIONS, LIVE_NEW_ACTIONS, LIVE_CHANGES_ACTIONS);
  state.tasks = []; // no demo tasks here, so the simulated agents have nothing to run
  studioOn('envOp', liveOnEnvOp);
  studioOn('streamLine', liveOnStreamLine);
  studioOn('sessionData', liveOnSessionData);
  studioOn('sessionExit', liveOnSessionExit);
  await liveConnect();
  setInterval(() => { if (!document.hidden) liveTick(); }, LIVE_POLL_MS);
}
async function liveConnect() {
  LIVE.phase = 'starting';
  try {
    await studioBootstrap(true);
  } catch (e) {
    liveWentOffline(e);
    render();
    return;
  }
  LIVE.phase = 'ready';
  liveCheckAx();
  await liveLoadEnv();
  await liveRefresh(true);
}
function liveWentOffline(e) {
  LIVE.phase = 'offline';
  LIVE.offlineError = (e && e.message) || "AX Studio isn't answering.";
  LIVE.offlineAt = Date.now();
}
/** Is the ax command there? The task list doesn't need it, but setup and a few actions do. */
async function liveCheckAx() {
  try {
    const r = await studioApi.ax(['version']);
    if (r.status === 0) { LIVE.axVersion = String(r.stdout || '').trim().replace(/^ax version\s*/i, ''); LIVE.axError = ''; }
    else LIVE.axError = liveLastLine(r.stderr || r.stdout) || 'Studio could not run the ax command.';
  } catch (e) {
    LIVE.axError = e.message;
  }
  render({ keepScroll: true, background: true });
}
/** This computer and your kubeconfig. Picks the cluster to talk to if the one in use is gone. */
async function liveLoadEnv() {
  LIVE.envAt = Date.now();
  try {
    const env = await studioApi.env();
    const l = env.local || {};
    LIVE.env = env;
    LIVE.envError = '';
    LIVE.checks = env.preflight || [];
    LIVE.canStartLocal = !!env.canStartLocal;
    LIVE.local = { name: l.name || '', state: l.state || 'NotFound', context: l.kubeContext && l.kubeContext !== 'N/A' ? l.kubeContext : '', substrate: l.substrateStatus || '', server: l.axStatus || '' };
    LIVE.contexts = (env.contexts || []).map((c) => ({ name: c.name, cluster: c.cluster || '', current: !!c.current, isLocal: !!c.isLocal }));
    if (env.operation) liveSetOp(env.operation);
  } catch (e) {
    if (e.status === 0) liveWentOffline(e);
    LIVE.envError = e.message;
  }
  liveChooseContext();
}
function liveChooseContext() {
  const names = LIVE.contexts.map((x) => x.name);
  if (names.includes(LIVE.context)) return;
  let saved = '';
  try { saved = localStorage.getItem(LIVE_CONTEXT_KEY) || ''; } catch (e) { /* ignore */ }
  const current = LIVE.contexts.find((x) => x.current);
  const local = LIVE.local && LIVE.local.state === 'Running' && names.includes(LIVE.local.context) ? LIVE.local.context : '';
  const next = names.includes(saved) ? saved : current ? current.name : local || names[0] || '';
  if (next !== LIVE.context) liveUseContext(next, true);
}
function liveUseContext(name, quiet) {
  LIVE.context = name;
  LIVE.tasks = []; LIVE.detail = {}; LIVE.changes = {}; LIVE.error = ''; LIVE.errorCode = ''; LIVE.failedAt = 0; LIVE.loaded = false;
  if (!quiet) { try { localStorage.setItem(LIVE_CONTEXT_KEY, name); } catch (e) { /* ignore */ } }
}
async function liveLoadTask(name) {
  try {
    const r = await studioApi.task(LIVE.context, LIVE.atespace, name);
    LIVE.detail[name] = { doc: r.task || null, yaml: r.yaml || '', error: '' };
  } catch (e) {
    LIVE.detail[name] = Object.assign({}, LIVE.detail[name], { error: e.message, missing: e.code === 'NotFound' });
  }
}
async function liveRefresh(force) {
  if (LIVE.phase !== 'ready' || (LIVE.loading && !force)) return;
  LIVE.loading = true;
  const before = liveSnapshot();
  try {
    const part = parseRoute().parts[0];
    const envPage = part === 'places' || part === 'setup' || !LIVE.context || liveLocalDown();
    if (envPage && !liveOpRunning() && (force || Date.now() - LIVE.envAt >= LIVE_ENV_MS)) await liveLoadEnv();
    const ctx = LIVE.context;
    if (!ctx || liveLocalDown()) {
      /* No cluster yet, or AX on this computer isn't running: there is nothing to ask. Home shows setup instead. */
      LIVE.tasks = []; LIVE.error = ''; LIVE.errorCode = ''; LIVE.failedAt = 0; LIVE.loaded = true;
    } else {
      try {
        const r = await studioApi.tasks(ctx, LIVE.atespace);
        if (ctx !== LIVE.context) return; // you picked another cluster while this was on its way
        LIVE.tasks = (r.tasks || []).map(liveTask);
        LIVE.error = ''; LIVE.errorCode = ''; LIVE.failedAt = 0;
      } catch (e) {
        if (ctx !== LIVE.context) return;
        if (e.status === 0) liveWentOffline(e);
        LIVE.error = e.message; LIVE.errorCode = e.code || ''; LIVE.failedAt = Date.now();
      }
      LIVE.loaded = true;
      LIVE.refreshedAt = Date.now();
      const cur = liveRouteTask();
      if (cur && !LIVE.error) await liveLoadTask(cur);
    }
  } finally {
    LIVE.loading = false;
  }
  if (force || liveSnapshot() !== before) render({ keepScroll: true, background: true });
}
/** Runs every few seconds while the page is visible. */
function liveTick() {
  if (LIVE.phase === 'offline') { if (Date.now() - LIVE.offlineAt >= LIVE_RETRY_MS) liveConnect(); return; }
  if (LIVE.failedAt && Date.now() - LIVE.failedAt < LIVE_RETRY_MS) return;
  liveRefresh();
}

/* ---------- Actions ---------- */
const LIVE_VERBS = {
  suspend: { doing: 'Pausing', done: 'Paused', fail: "Couldn't pause" },
  resume: { doing: 'Resuming', done: 'Resumed', fail: "Couldn't resume" },
  delete: { doing: 'Deleting', done: 'Deleted', fail: "Couldn't delete" },
};
async function liveTaskAction(name, verb) {
  if (!name || !LIVE_VERBS[verb] || LIVE.busy[name]) return;
  const w = LIVE_VERBS[verb];
  LIVE.busy[name] = verb;
  render({ keepScroll: true });
  announce(`${w.doing} ${name}`);
  let error = '';
  try { await studioApi.taskAction(verb, LIVE.context, LIVE.atespace, name); } catch (e) { error = e.message; }
  delete LIVE.busy[name];
  if (!error) {
    toast(`${w.done} <span class="mono">${esc(name)}</span>`, { icon: verb === 'delete' ? 'trash' : 'check' });
    if (verb === 'delete') { delete LIVE.detail[name]; delete LIVE.changes[name]; LIVE.tasks = LIVE.tasks.filter((t) => t.name !== name); if (liveRouteTask() === name) location.hash = '#/'; }
  } else {
    toast(`${w.fail} <span class="mono">${esc(name)}</span>: ${esc(error)}`, { icon: 'alert', timeout: 9000 });
  }
  await liveRefresh(true);
}
function liveOpenDelete(name) {
  const dlg = openDialog(dialogShell('ld', `Delete ${esc(name)}?`, '', `
    <p class="small">This removes the task from AX and tears down its sandbox. It can't be undone.</p>
    <ul class="check-list" style="margin-top:10px">
      <li class="check-item no"><span class="ci-icon">${icon('trash')}</span><div><div class="ci-title">Removed</div><div class="ci-desc">The task, its sandbox and the files in it</div></div></li>
      <li class="check-item ok"><span class="ci-icon">${icon('check')}</span><div><div class="ci-title">Kept</div><div class="ci-desc">Its workspace, gateway and model, for other tasks to use</div></div></li>
    </ul>
    <div style="margin-top:14px">${cliHint(liveCmd(['delete', 'task', name]))}</div>`, `<span class="left"></span><button class="btn ghost" data-action="close-dialog">Cancel</button><button class="btn danger" id="ld-go">${icon('trash', 'sm')}Delete task</button>`, false, 'trash'));
  $('#ld-go', dlg).addEventListener('click', () => { closeDialog(true); liveTaskAction(name, 'delete'); });
}
const LIVE_ACTIONS = {
  'live-recheck': () => { liveConnect(); render(); },
  'live-refresh': () => { LIVE.failedAt = 0; liveRefresh(true); },
  'live-suspend': (el) => liveTaskAction(el.dataset.task, 'suspend'),
  'live-resume': (el) => liveTaskAction(el.dataset.task, 'resume'),
  'live-delete': (el) => liveOpenDelete(el.dataset.task),
  'live-use-context': (el) => {
    const name = el.dataset.context;
    if (!name || name === LIVE.context) return;
    liveUseContext(name);
    render({ keepScroll: true });
    announce(`Using ${name}`);
    liveRefresh(true);
  },
  'live-first-idea': (el) => {
    LIVE.draft = liveNewDraft('');
    LIVE.draft.goal = el.dataset.goal || '';
    location.hash = '#/new';
  },
  'live-quick-go': () => {
    const inp = $('#live-quick-goal');
    const val = (inp && inp.value || '').trim();
    LIVE.draft = liveNewDraft('');
    if (val) LIVE.draft.goal = val;
    location.hash = '#/new';
  },
  'live-palette': () => { if (typeof openPalette === 'function') openPalette(); },
  'live-shortcuts': () => { if (typeof openShortcuts === 'function') openShortcuts(); },
  'live-term-open': (el) => liveTermOpen(el.dataset.task),
  'live-term-close': (el) => liveTermClose(el.dataset.task),
  'live-term-ctrlc': (el) => liveTermInterrupt(el.dataset.task),
  'live-term-clear': (el) => { const tm = liveTermOf(el.dataset.task); tm.out = ''; liveTermPaint(el.dataset.task); },
  'live-term-send': (el) => liveTermSend(el.dataset.task),
};

/* ---------- Interactive sandbox terminal (ax ssh) ---------- */
LIVE.terms = {};
function liveTermOf(name) {
  return (LIVE.terms[name] = LIVE.terms[name] || { id: 'term-' + name, status: 'idle', out: '', error: '', exitCode: null });
}
function liveTermPaint(name) {
  const box = $('#live-term');
  if (!box || !box.dataset || box.dataset.task !== name) return;
  const row = LIVE.tasks.find((t) => t.name === name);
  box.innerHTML = liveTermInnerHTML(name, row ? row.state : 'Working');
  const out = $('#live-term-out', box);
  if (out) out.scrollTop = out.scrollHeight;
}
function liveOnSessionData(p) {
  if (!p || !p.id) return;
  const name = Object.keys(LIVE.terms).find((k) => LIVE.terms[k].id === p.id);
  if (!name) return;
  const tm = LIVE.terms[name];
  tm.out += String(p.data || '');
  if (tm.out.length > 32000) tm.out = tm.out.slice(-32000);
  const out = $('#live-term-out');
  if (out && $('#live-term') && $('#live-term').dataset.task === name) {
    out.textContent = tm.out;
    out.scrollTop = out.scrollHeight;
  } else {
    liveTermPaint(name);
  }
}
function liveOnSessionExit(p) {
  if (!p || !p.id) return;
  const name = Object.keys(LIVE.terms).find((k) => LIVE.terms[k].id === p.id);
  if (!name) return;
  const tm = LIVE.terms[name];
  tm.status = 'closed';
  tm.exitCode = typeof p.status === 'number' ? p.status : 0;
  liveTermPaint(name);
}
async function liveTermOpen(name) {
  if (!name) return;
  const tm = liveTermOf(name);
  if (tm.status === 'starting' || tm.status === 'open') return;
  tm.status = 'starting'; tm.error = ''; tm.exitCode = null;
  liveTermPaint(name);
  const args = (LIVE.context ? ['--context', LIVE.context] : []).concat(['-a', LIVE.atespace, 'ssh', name]);
  try {
    await studioApi.sessionStart(tm.id, args);
    tm.status = 'open';
    if (!tm.out) tm.out = `$ ${liveCmd(['ssh', name])}\n`;
    liveTermPaint(name);
    const inp = $('#live-term-in'); if (inp) inp.focus({ preventScroll: true });
  } catch (e) {
    tm.status = 'idle'; tm.error = e.message;
    liveTermPaint(name);
  }
}
async function liveTermSend(name) {
  const tm = liveTermOf(name);
  const inp = $('#live-term-in');
  if (!inp || tm.status !== 'open') return;
  const cmd = inp.value;
  inp.value = '';
  tm.out += `$ ${cmd}\n`;
  const out = $('#live-term-out');
  if (out) { out.textContent = tm.out; out.scrollTop = out.scrollHeight; }
  try {
    await studioApi.sessionWrite(tm.id, cmd + '\n');
  } catch (e) {
    tm.error = e.message;
    liveTermPaint(name);
  }
  inp.focus({ preventScroll: true });
}
async function liveTermInterrupt(name) {
  const tm = liveTermOf(name);
  if (tm.status !== 'open') return;
  try { await studioApi.sessionInterrupt(tm.id); } catch (e) { tm.error = e.message; liveTermPaint(name); }
}
async function liveTermClose(name) {
  const tm = liveTermOf(name);
  try { await studioApi.sessionClose(tm.id); } catch (e) { /* ignore */ }
  tm.status = 'closed';
  liveTermPaint(name);
}
function liveTermInnerHTML(name, stateName) {
  const tm = liveTermOf(name);
  const canShell = stateName === 'Working' || stateName === 'Idle' || stateName === 'RequiresAction';
  const open = tm.status === 'open', starting = tm.status === 'starting';
  const controls = open
    ? `<div class="btn-row"><span class="chip running"><i class="pulse-dot"></i>Connected</span><button type="button" class="btn ghost sm" data-action="live-term-ctrlc" data-task="${esc(name)}" title="Send SIGINT (Ctrl-C)">Ctrl-C</button><button type="button" class="btn ghost sm" data-action="live-term-clear" data-task="${esc(name)}">Clear</button><button type="button" class="btn sm" data-action="live-term-close" data-task="${esc(name)}">Disconnect</button></div>`
    : `<button type="button" class="btn ${canShell ? 'primary' : ''} sm" id="live-term-open" data-action="live-term-open" data-task="${esc(name)}" ${!canShell || starting ? 'disabled' : ''}>${icon(starting ? 'loader' : 'terminal', 'sm')}${starting ? 'Connecting…' : 'Open shell in sandbox'}</button>`;
  const consoleBox = (open || tm.out) ? `<pre class="manifest" id="live-term-out" style="margin-top:10px;max-height:260px;overflow:auto" tabindex="0" aria-label="Terminal output">${esc(tm.out || 'Connected. Run a command below.\n')}</pre>` : '';
  const inputRow = open ? `<div class="input-group" style="margin-top:8px"><label class="sr-only" for="live-term-in">Command to run in the sandbox</label><input class="input mono" id="live-term-in" data-term-task="${esc(name)}" placeholder="pwd, ls -la, git status…" autocomplete="off" spellcheck="false"><button type="button" class="btn primary sm" id="live-term-send" data-action="live-term-send" data-task="${esc(name)}">${icon('send', 'sm')}Run</button></div>` : '';
  return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
      <h2 id="live-term-h" class="h-display-sm">Terminal</h2>${controls}</div>
    <p class="small muted" style="margin-top:4px">${canShell ? `Interactive shell inside the gVisor sandbox (<span class="mono">/workspace</span>) via <code>${esc(liveCmd(['ssh', name]))}</code>.` : 'The task is not running right now, so its sandbox shell is closed.'}</p>
    ${tm.error ? `<div class="callout warn" role="alert" style="margin-top:10px">${icon('alert')}<div style="overflow-wrap:anywhere">${esc(tm.error)}</div></div>` : ''}
    ${consoleBox}${inputRow}`;
}
function liveTermHTML(name, t, stateName) {
  if (!t.debug) return '';
  return `<section class="card card-pad" style="margin-top:14px" aria-labelledby="live-term-h" id="live-term" data-task="${esc(name)}">${liveTermInnerHTML(name, stateName)}</section>`;
}

function liveAxoMood(stateName) {
  if (stateName === 'Failed') return 'alert';
  if (stateName === 'RequiresAction') return 'wave';
  if (stateName === 'Completed') return 'done';
  if (stateName === 'Suspended' || stateName === 'Suspending') return 'sleeping';
  if (stateName === 'Working' || stateName === 'Queued' || stateName === 'Idle') return 'working';
  return 'idle';
}

/* ---------- Small pieces ---------- */
function liveChip(s) { const d = liveState(s); return `<span class="chip ${d.chip}" title="AX state: ${esc(s)}">${icon(d.icon)}${d.label}</span>`; }
function liveIsLocal(context) {
  if (!context) return false;
  if (LIVE.local && LIVE.local.context && LIVE.local.context === context) return true;
  const c = LIVE.contexts.find((x) => x.name === context);
  return !!(c && c.isLocal);
}
/** The cluster in use is AX on this computer, and it isn't running. */
function liveLocalDown() { return !!(LIVE.context && liveIsLocal(LIVE.context) && LIVE.local && LIVE.local.state !== 'Running'); }
function liveWhere(context) {
  return liveIsLocal(context) ? `<span class="env" title="${esc(context)}">${icon('laptop')}On this computer</span>` : `<span class="env" title="${esc(context)}">${icon('cloud')}${esc(context || 'Current cluster')}</span>`;
}
/** Tasks in list order: what needs you first. The turns of one session stay together, oldest first, and each task
    learns which turn it is. */
function liveSorted() {
  const sessions = {};
  LIVE.tasks.forEach((t) => { const k = t.session || `task:${t.name}`; (sessions[k] = sessions[k] || []).push(t); });
  const groups = Object.keys(sessions).map((k) => sessions[k].sort((a, b) => String(a.created).localeCompare(String(b.created)) || a.name.localeCompare(b.name)));
  groups.forEach((g) => g.forEach((t, i) => { t.turn = i + 1; t.turns = g.length; }));
  const rank = (g) => Math.min(...g.map((t) => liveState(t.state).rank));
  groups.sort((a, b) => rank(a) - rank(b) || a[0].name.localeCompare(b[0].name));
  return [].concat(...groups);
}
/** Why the last task list failed, as far as the error tells: AX isn't on that cluster ("missing"), AX there and this
    Studio were built from different versions of AX's API and can't read each other's data ("versions"), or AX
    couldn't be reached ("unreachable"). */
function liveErrorKind() {
  if (/(services|namespaces) "[^"]+" not found/i.test(LIVE.error)) return 'missing';
  if (/failed to unmarshal|invalid wire-format/i.test(LIVE.error)) return 'versions';
  return 'unreachable';
}
const LIVE_ERROR_WORDS = {
  missing: { summary: "AX isn't on this cluster yet.", foot: 'AX is not installed' },
  versions: { summary: "Studio can't read what AX sent.", foot: 'A different AX version' },
  unreachable: { summary: "Studio can't reach AX right now.", foot: "Can't reach AX" },
};
/** A banner for "this didn't work": what AX said, and the command that asks the same. */
function liveProblemHTML(title, message, cmd) {
  return `<div class="card card-pad" role="alert" style="margin-top:14px">
    <div style="display:flex;gap:10px;align-items:flex-start">${icon('alert')}<div style="min-width:0;flex:1">
      <div class="live-title">${title}</div>
      <p class="small" style="margin-top:4px;overflow-wrap:anywhere">${esc(message)}</p>
      ${cmd ? `<div style="margin-top:10px">${cliHint(cmd)}</div>` : ''}
      <div class="btn-row" style="margin-top:12px"><button class="btn sm" data-action="live-refresh">${icon('refresh', 'sm')}Try again</button><a class="btn ghost sm" href="#/places">Where agents run</a></div>
    </div></div></div>`;
}
function liveKV(rows) {
  return `<dl class="kv">${rows.filter((r) => r && r[1] != null && r[1] !== '').map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
}

/* ---------- Pages ---------- */
function liveViewStarting() {
  return { title: 'Connecting', crumbs: [{ label: 'Home' }], html: `<div class="page-head"><h1 tabindex="-1">Connecting to AX…</h1><p class="lede">Checking this computer and your clusters.</p></div>` };
}
function liveViewOffline() {
  const html = `
    <div class="page-head"><h1 tabindex="-1">AX Studio isn't answering</h1>
      <p class="lede">This page talks to the Studio server on this computer, and it has stopped answering. Your clusters and tasks keep running.</p></div>
    <div class="card card-pad">
      <div class="live-title">Start it again</div>
      <div style="margin-top:8px">${cliHint('ax studio')}</div>
      <div class="btn-row" style="margin-top:16px"><button class="btn primary" data-action="live-recheck">${icon('refresh', 'sm')}Check again</button></div>
      <p class="xsmall muted" style="margin-top:12px;overflow-wrap:anywhere">What happened: ${esc(LIVE.offlineError)}</p>
    </div>`;
  return { title: 'Not connected', crumbs: [{ label: 'Home' }], html };
}
function liveRowHTML(t) {
  const d = liveState(t.state);
  const busy = LIVE.busy[t.name];
  const age = liveAge(t.created);
  const turn = t.turns > 1 ? `Turn ${t.turn} of ${t.turns}` : '';
  return `<a class="task-row" href="#/task/${encodeURIComponent(t.name)}" id="live-row-${esc(t.name)}" aria-label="${esc(t.goal || t.name)}, ${d.label}${turn ? `, ${turn}` : ''}" ${t.turn > 1 ? 'style="padding-left:34px"' : ''}>
    <div style="min-width:0">
      <div class="t-title">${esc(t.goal || t.name)}</div>
      <div class="t-meta">${turn ? `<span>${turn}</span><span class="dot"></span>` : ''}${t.goal ? `<span class="mono">${esc(t.name)}</span><span class="dot"></span>` : ''}<span>${age ? `Created ${esc(age)} ago` : 'Just created'}</span>${t.atespace !== 'default' ? `<span class="dot"></span><span class="mono">${esc(t.atespace)}</span>` : ''}</div>
    </div>
    <div class="t-right">${busy ? `<span class="chip stopping">${icon('loader')}${LIVE_VERBS[busy].doing}</span>` : liveChip(t.state)}</div>
  </a>`;
}
function liveViewHome() {
  /* Nothing to list from: no cluster yet, or AX on this computer isn't running. Start with setup. */
  if (LIVE.loaded && (!LIVE.context || liveLocalDown())) return liveViewSetup(true);
  const list = liveSorted();
  const count = (f) => list.filter(f).length;
  const needs = count((t) => liveState(t.state).rank === 0), active = count((t) => liveState(t.state).active), paused = count((t) => t.state === 'Suspended'), done = count((t) => t.state === 'Completed');
  const summary = !LIVE.loaded ? 'Loading your tasks…'
    : LIVE.error ? `${LIVE_ERROR_WORDS[liveErrorKind()].summary}${list.length ? ' This is the last list it got.' : ''}`
      : `${plural(list.length, 'task')}${list.length ? `: ${[needs && `${needs} ${needs === 1 ? 'needs' : 'need'} you`, active && `${active} running`, paused && `${paused} paused`].filter(Boolean).join(', ') || 'none running'}` : ''}.`;
  const where = esc(LIVE.context || 'this cluster');
  const kind = liveErrorKind();
  const problem = !LIVE.error ? ''
    : kind === 'missing' ? liveProblemHTML(`AX isn't installed on ${where}`, `Install it with the command below, then try again. What AX Studio got: ${LIVE.error}`, liveCmd(['install']))
      : kind === 'versions' ? liveProblemHTML(`AX on ${where} and AX Studio are different versions`, `They can't read each other's data. Update the older one so the two match. What AX Studio got: ${LIVE.error}`, '')
        : liveProblemHTML(`Can't reach AX on ${where}`, LIVE.error, liveCmd(['get', 'tasks']));
  const heroMood = LIVE.error || needs ? 'wave' : active ? 'working' : 'idle';
  const heroTone = LIVE.error || needs ? 'needs' : active ? 'working' : 'calm';
  const said = state.axelSpeech && Date.now() - state.axelSpeech.at < 8000 ? state.axelSpeech.text
    : needs ? `${plural(needs, 'task needs', 'tasks need')} a look below.`
    : active ? `${plural(active, 'agent is', 'agents are')} running in their gVisor sandboxes.`
    : list.length ? 'Every sandbox is quiet. Start a new task or resume a paused one.'
    : "Hi! I'm Axel. Pick a template, point it at a repo and describe the goal. Each agent runs in its own gVisor sandbox.";
  const flow = list.length ? `<div class="card flow" role="group" aria-label="Where your tasks are right now" style="margin-top:14px">
    <div class="station st-needs ${needs ? 'has' : ''}"><span class="st-top"><span class="st-num tnum">${needs}</span></span><span class="st-label">Needs you</span><span class="st-sub">${needs ? 'Stopped or waiting' : 'All caught up'}</span></div><span class="flow-link" aria-hidden="true"></span>
    <div class="station st-working ${active ? 'has' : ''}"><span class="st-top"><span class="st-num tnum">${active}</span></span><span class="st-label">Running</span><span class="st-sub">${active ? 'In gVisor sandboxes' : 'No agents running'}</span></div><span class="flow-link" aria-hidden="true"></span>
    <div class="station st-review ${paused ? 'has' : ''}"><span class="st-top"><span class="st-num tnum">${paused}</span></span><span class="st-label">Paused</span><span class="st-sub">${paused ? 'Checkpointed' : 'None paused'}</span></div><span class="flow-link" aria-hidden="true"></span>
    <div class="station st-shipped ${done ? 'has' : ''}"><span class="st-top"><span class="st-num tnum">${done}</span></span><span class="st-label">Done</span><span class="st-sub">${done ? 'Finished runs' : 'None finished yet'}</span></div>
  </div>` : '';
  const ideas = typeof FIRST_IDEAS !== 'undefined' ? `<div class="first-ideas" role="group" aria-label="Ideas to start with" style="margin-top:12px">
      <span class="fi-label">Start with an idea</span>
      ${FIRST_IDEAS.map((x) => `<button type="button" class="pill fi-idea" data-action="live-first-idea" data-goal="${esc(x.goal)}">${icon(x.ic, 'xs')}${esc(x.label)}</button>`).join('')}
    </div>` : '';
  const body = !LIVE.loaded ? ''
    : list.length ? `${problem}${flow}<div class="card" id="live-tasks" style="margin-top:14px;padding:6px">${list.map(liveRowHTML).join('')}</div>`
      : problem || `<div class="card card-pad" id="live-empty" style="margin-top:14px">
            <div class="live-title">No tasks here yet</div>
            <p class="small" style="margin-top:4px;max-width:70ch">Start one here, or from the command line. Tasks on this cluster show up as soon as they're created.</p>
          <div class="btn-row" style="margin-top:12px"><a class="btn primary" href="#/new">${icon('plus', 'sm')}New task</a></div>
          ${ideas}
          <div style="margin-top:12px;display:grid;gap:8px">${cliHint(liveCmd(['apply', '-f', 'task.yaml']))}${cliHint(liveCmd(['resume', 'task', '<name>']))}</div></div>`;
  const html = `
    <section class="stage" aria-labelledby="live-home-h1">
      <div class="stage-copy">
        <h1 id="live-home-h1" tabindex="-1">Your tasks</h1>
        <p class="lede" id="live-summary">${summary}</p>
        <div class="input-group" style="margin-top:12px;max-width:560px">
          <label class="sr-only" for="live-quick-goal">Describe a goal to start a task</label>
          <input class="input" id="live-quick-goal" placeholder="Describe a goal, like “Fix the failing tests”" autocomplete="off" value="${esc((LIVE.draft && LIVE.draft.goal) || '')}">
          <button type="button" class="btn primary" id="live-quick-go" data-action="live-quick-go">${icon('plus', 'sm')}Set up task</button>
        </div>
        <div class="btn-row" style="margin-top:12px">${liveWhere(LIVE.context)}<a class="btn ghost sm" href="#/places">Change cluster</a><button type="button" class="btn ghost sm" data-action="live-palette">${icon('search', 'xs')}Commands (${MOD}K)</button><button type="button" class="btn ghost sm" data-action="story">${icon('waves', 'xs')}Why an axolotl?</button></div>
      </div>
      <div class="stage-axo">
        <div class="stage-bubble-col"><div class="speech still" id="axel-speech" aria-live="off">${said}</div></div>
        ${springPoolHTML(heroMood, heroTone, 'hero-axo')}
      </div>
    </section>
    ${body}
    <p class="xsmall muted" style="margin-top:12px">${icon('terminal', 'xs')} The same list from the command line: <code>${esc(liveCmd(['get', 'tasks']))}</code></p>`;
  return { title: 'Your tasks', crumbs: [{ label: 'Home' }], html, wide: true };
}
/** What a finished task left: its result, exit code and output, when AX has recorded them. */
function liveResultHTML(status) {
  const o = status.outcome;
  if (!o) return '';
  const result = LIVE_RESULTS[o.result] || '';
  const code = typeof o.exitCode === 'number' ? o.exitCode : result ? 0 : null;
  const why = o.status && o.status.message;
  if (!result && code == null && !o.output && !why) return '';
  return `<section class="card card-pad" style="margin-top:14px" aria-labelledby="live-result"><h2 id="live-result" class="h-display-sm">Result</h2>
      <div style="margin-top:12px">${liveKV([['Result', esc(result)], ['Exit code', code == null ? '' : `<span class="mono">${esc(code)}</span>`], ['Reason', why ? esc(why) : '']])}</div>
      ${o.output ? `<div class="live-title" style="margin-top:14px">Output</div><pre class="manifest" style="margin-top:8px" tabindex="0" aria-label="Task output">${esc(o.output)}</pre>` : ''}</section>`;
}
function liveViewTask(name) {
  const row = LIVE.tasks.find((t) => t.name === name);
  const det = LIVE.detail[name];
  const doc = det && det.doc;
  const crumbs = [{ label: 'Home', href: '#/' }, { label: name }];
  if ((!row && !doc) || (det && det.missing && !row)) {
    const html = LIVE.loaded
      ? `<div class="page-head"><h1 tabindex="-1">${esc(name)} isn't on this cluster</h1><p class="lede">It may have been deleted, or it lives on another cluster.</p></div>
         <div class="btn-row"><a class="btn" href="#/">Your tasks</a><a class="btn ghost" href="#/places">Change cluster</a></div>`
      : `<div class="page-head"><h1 tabindex="-1">${esc(name)}</h1><p class="lede">Loading…</p></div>`;
    return { title: name, crumbs, html };
  }
  const t = liveTask(doc || (row && row.doc));
  const spec = (t.doc && t.doc.spec) || {}, status = (t.doc && t.doc.status) || {}, meta = (t.doc && t.doc.metadata) || {};
  const stateName = row ? row.state : t.state;
  const busy = LIVE.busy[name];
  const canPause = ['Working', 'Queued', 'Idle', 'RequiresAction'].includes(stateName);
  const canResume = stateName === 'Suspended';
  const limits = (spec.profile && spec.profile.resources && spec.profile.resources.limits) || {};
  const conds = (status.conditions || []).map((c) => `${esc(c.type)}: ${esc(c.status)}${c.reason ? ` (${esc(c.reason)})` : ''}${c.message ? ` · ${esc(c.message)}` : ''}`).join('<br>');
  const detail = status.statusDetail && (status.statusDetail.detail || status.statusDetail.reason);
  const labels = Object.keys(meta.labels || {}).map((k) => `<span class="mono">${esc(k)}=${esc(meta.labels[k])}</span>`).join(' ');
  const cmd = (spec.commands && spec.commands.length ? spec.commands : status.resolvedArgv) || [];
  const created = meta.createTime ? new Date(meta.createTime) : null;
  const details = liveKV([
    ['Goal', t.goal ? esc(t.goal) : ''],
    ['State', `${liveState(stateName).label} <span class="muted">(AX: ${esc(stateName)})</span>${detail ? `<br>${esc(detail)}` : ''}`],
    ['Checks', conds],
    ['Image', spec.profile && spec.profile.image ? `<span class="mono">${esc(spec.profile.image)}</span>` : "AX's default task image"],
    ['Command', cmd.length ? `<span class="mono">${esc(cmd.join(' '))}</span>` : "The image's own command"],
    ['Workspace', spec.workspace && spec.workspace.name ? `<span class="mono">${esc(spec.workspace.name)}</span>${spec.workspace.path ? ` at <span class="mono">${esc(spec.workspace.path)}</span>` : ''}` : 'None: an empty <span class="mono">/workspace</span>'],
    ['Network', spec.gateway && spec.gateway.name ? `Gateway <span class="mono">${esc(spec.gateway.name)}</span>` : 'No gateway, so no network access'],
    ['Limits', limits.cpu || limits.memory ? esc([limits.cpu && `${limits.cpu} CPU`, limits.memory && `${limits.memory} memory`].filter(Boolean).join(' · ')) : ''],
    ['Debug', spec.debug ? `On. Open a shell with <code>${esc(liveCmd(['ssh', name]))}</code> <button class="btn ghost sm icon" data-action="copy" data-text="${esc(liveCmd(['ssh', name]))}" aria-label="Copy the command">${icon('copy', 'sm')}</button>` : 'Off, so there is no shell into the sandbox'],
    ['Session', spec.sessionId ? `<span class="mono">${esc(spec.sessionId)}</span>` : ''],
    ['Labels', labels],
    ['Created', created && !isNaN(created) ? esc(created.toLocaleString()) : ''],
  ]);
  const nsTone = stateName === 'Failed' ? 'fail' : stateName === 'RequiresAction' ? 'attn' : stateName === 'Completed' ? 'done' : stateName === 'Suspended' ? 'paused' : 'calm';
  const nsTitle = stateName === 'Failed' ? 'Stopped with an error'
    : stateName === 'RequiresAction' ? 'Waiting for you'
    : stateName === 'Completed' ? 'Finished'
    : stateName === 'Suspended' ? 'Paused'
    : 'Working in its sandbox';
  const nsBody = stateName === 'Failed' ? (detail ? esc(detail) : 'Check the status details below, or send a follow-up to start a new turn.')
    : stateName === 'Suspended' ? "Its gVisor sandbox is checkpointed and nothing is running. Resume when you're ready."
    : stateName === 'Completed' ? 'Review the result and changes on the left, or send a follow-up to continue in the same session.'
    : spec.debug ? 'You can inspect uncommitted files in Changes, or open a shell in the Terminal below.'
    : 'Running inside an isolated gVisor sandbox. Pause anytime, or send a follow-up in the same session.';
  const nextStep = `<section class="card card-pad next-card s-${nsTone}" id="next-step" data-tone="${nsTone}" aria-labelledby="ns-k">
    <span class="ns-axel" aria-hidden="true">${axo(liveAxoMood(stateName), { decorative: true, cls: 'axo-ns' }).replace('<svg ', '<svg data-follow ')}</span>
    <h2 class="panel-title" id="ns-k">${nsTone === 'attn' || nsTone === 'fail' ? '<span class="ns-dot" aria-hidden="true"></span>' : ''}${nsTone === 'attn' || nsTone === 'fail' ? 'Your next step' : 'Next'}</h2>
    <p class="ns-title">${nsTitle}</p><p class="ns-body">${nsBody}</p>
  </section>
  <section class="card card-pad" id="live-ns-guard-card" style="margin-top:14px" aria-labelledby="live-ns-guard">
    <h2 class="panel-title" id="live-ns-guard">Sandbox &amp; network</h2>
    <p class="small muted" style="margin-top:8px">${spec.gateway && spec.gateway.name ? `Outbound traffic goes through Gateway <span class="mono">${esc(spec.gateway.name)}</span>. API keys are added outside the gVisor sandbox.` : 'No Gateway is attached, so outbound network access is closed.'}</p>
    ${typeof gateMap === 'function' ? `<div style="margin-top:10px">${spec.gateway && spec.gateway.name ? gateMap([spec.gateway.name, '0 raw keys in sandbox'], [], 2) : gateMap([], [{ domain: 'All outbound network' }], 1)}</div>` : ''}
  </section>`;
  const html = `
    <div class="page-head">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><h1 tabindex="-1" style="margin:0">${esc(name)}</h1>${busy ? `<span class="chip stopping">${icon('loader')}${LIVE_VERBS[busy].doing}</span>` : liveChip(stateName)}${liveWhere(LIVE.context)}</div>
    </div>
    <div class="btn-row" id="live-task-actions">
      ${canResume ? `<button class="btn primary" data-action="live-resume" data-task="${esc(name)}" ${busy ? 'disabled' : ''}>${icon('play', 'sm')}Resume</button>` : ''}
      ${canPause ? `<button class="btn" data-action="live-suspend" data-task="${esc(name)}" ${busy ? 'disabled' : ''}>${icon('pause', 'sm')}Pause</button>` : ''}
      <a class="btn" href="#/new?from=${encodeURIComponent(name)}" id="live-follow">${icon('message', 'sm')}Send a follow-up</a>
      <button class="btn" data-action="live-promote" data-task="${esc(name)}" ${busy ? 'disabled' : ''}>${icon('cloudUp', 'sm')}Run on another cluster…</button>
      <button class="btn danger" data-action="live-delete" data-task="${esc(name)}" ${busy ? 'disabled' : ''}>${icon('trash', 'sm')}Delete…</button>
    </div>
    <div class="task-grid" style="margin-top:14px">
      <div class="task-main" style="min-width:0">
        ${det && det.error && !det.missing ? liveProblemHTML(`Couldn't read ${esc(name)}`, det.error, liveCmd(['get', 'task', name])) : ''}
        ${liveResultHTML(status)}
        ${liveChangesHTML(name, t, stateName)}
        ${liveTermHTML(name, t, stateName)}
        <section class="card card-pad" style="margin-top:14px" aria-labelledby="live-details"><h2 id="live-details" class="h-display-sm">Details</h2><div style="margin-top:12px">${details}</div></section>
        ${det && det.yaml ? `<section class="card card-pad" style="margin-top:14px" aria-labelledby="live-file">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px"><h2 id="live-file" class="h-display-sm">Task file</h2><button class="btn ghost sm" data-action="copy" data-text="${esc(det.yaml)}">${icon('copy', 'sm')}Copy</button></div>
          <pre class="manifest" style="margin-top:12px" tabindex="0" aria-label="Task file">${esc(det.yaml)}</pre>
          <p class="xsmall muted" style="margin-top:10px">${icon('terminal', 'xs')} <code>${esc(liveCmd(['get', 'task', name]))}</code></p></section>` : ''}
        <p class="xsmall muted" style="margin-top:12px" id="live-task-note">${spec.debug
          ? 'Use the Terminal above or run ax ssh in your own shell to inspect the sandbox.'
          : 'This task was started without debug access, so its sandbox stays closed. Review its result here, and the branch or pull request it pushes.'} AX doesn't offer a task's activity or a live log yet, so they aren't shown.</p>
      </div>
      <aside class="task-side" id="live-task-side" aria-label="Next step">${nextStep}</aside>
    </div>`;
  return { title: name, crumbs, html, wide: true };
}
const LIVE_HIDDEN = { guardrails: 'Guardrails', settings: 'Settings', welcome: 'Setup', cuj: 'This page', review: 'This page', get: 'This page' };
function liveViewNotYet(part) {
  const what = LIVE_HIDDEN[part] || 'This page';
  const html = `<div class="page-head"><h1 tabindex="-1">${what} isn't connected to AX yet</h1>
      <p class="lede">It still runs on demo data, so it's hidden here. Your tasks and where they run are real.${STUDIO.classic ? ' Until it is connected, the previous pages do this job.' : ''}</p></div>
    <div class="btn-row"><a class="btn primary" href="#/">Your tasks</a><a class="btn" href="#/places">Where agents run</a>${STUDIO.classic ? `<a class="btn ghost" href="${esc(STUDIO.classic)}">${icon('arrowUpRight', 'sm')}Open the previous pages</a>` : ''}</div>`;
  return { title: what, crumbs: [{ label: 'Home', href: '#/' }, { label: what }], html };
}

/* ---------- The app frame ---------- */
function liveShellHTML() {
  return `
  <div class="app live">
    <aside class="sidebar" aria-label="Primary">
      <a class="brand" href="#/" aria-label="AX Studio home">${BRAND_MARK}<span class="brand-name">AX <span>Studio</span></span></a>
      <a class="btn primary new-btn" href="#/new" id="live-new">${icon('plus', 'sm')}New task</a>
      <nav class="nav" aria-label="Main">
        <a href="#/" data-nav="home" id="nav-home">${icon('inbox')}<span class="label">Home</span><span class="count attn" id="live-nav-needs" hidden></span></a>
        <a href="#/places" data-nav="places" id="nav-places">${icon('server')}<span class="label">Where agents run</span></a>
      </nav>
      <div class="nav nav-tasks" role="navigation" aria-label="Tasks"><div class="nav-label">Tasks</div><div id="live-nav-tasks"></div></div>
      <div class="sidebar-foot" id="live-foot"></div>
    </aside>
    <div class="main">
      <div class="sanctuary-atmo" aria-hidden="true"></div>
      <header class="topbar">
        <div class="tb-left"><nav class="crumbs" aria-label="Breadcrumb" id="crumbs"></nav></div>
        <div class="topbar-actions">${STUDIO.classic ? `<a class="btn ghost sm" id="live-classic" href="${esc(STUDIO.classic)}" title="The terminal and Guardrails are still in the previous pages">Previous pages</a>` : ''}<button class="round-btn" id="theme-toggle" data-action="theme-toggle"></button></div>
      </header>
      <main id="main" tabindex="-1"></main>
    </div>
  </div>`;
}
function liveChrome(top) {
  $$('.nav a[data-nav]').forEach((a) => { if (a.dataset.nav === top) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  const cur = liveRouteTask();
  const list = liveSorted().slice(0, 8);
  const nt = $('#live-nav-tasks');
  if (nt) nt.innerHTML = list.length ? list.map((t) => {
    const d = liveState(t.state);
    return `<a href="#/task/${encodeURIComponent(t.name)}" class="nav-task" ${cur === t.name ? 'aria-current="page"' : ''} title="${esc(t.goal || t.name)} · ${d.label}">
      <span class="bead ${d.chip}">${d.active ? '<i class="pulse-dot"></i>' : icon(d.icon)}</span><span class="tt">${esc(t.goal || t.name)}</span><span class="sr-only">, ${d.label}</span></a>`;
  }).join('') : '<div class="nav-empty">Tasks on this cluster show up here.</div>';
  const n = LIVE.tasks.filter((t) => liveState(t.state).rank === 0).length;
  const nn = $('#live-nav-needs'); if (nn) { nn.hidden = !n; nn.textContent = n; nn.setAttribute('aria-label', `, ${n} need you`); }
  const foot = $('#live-foot');
  if (foot) {
    const setup = liveOpRunning() || !LIVE.context || liveLocalDown();
    const bad = LIVE.phase !== 'ready' || !!LIVE.error || setup;
    const title = LIVE.phase === 'offline' ? 'Not connected' : !LIVE.context ? 'No cluster yet' : liveIsLocal(LIVE.context) ? 'This computer' : LIVE.context;
    const sub = LIVE.phase === 'starting' ? 'Connecting…' : LIVE.phase === 'offline' ? "AX Studio isn't answering"
      : liveOpRunning() ? `${LIVE_OP_SHORT[LIVE.op.action] || 'Working'}…` : !LIVE.context ? 'Set up AX to start' : liveLocalDown() ? (LIVE.local.state === 'Stopped' ? 'AX is stopped' : 'AX is not set up')
        : LIVE.error ? LIVE_ERROR_WORDS[liveErrorKind()].foot : `Connected · ${plural(LIVE.tasks.filter((t) => liveState(t.state).active).length, 'running', 'running')}`;
    foot.innerHTML = `<a class="health-card ${bad ? 'attn' : ''}" href="#/places" id="live-health" aria-label="${esc(title)}: ${esc(sub)}. Open Where agents run.">${icon(!LIVE.context || liveIsLocal(LIVE.context) ? 'laptop' : 'cloud')}<span class="hc-text"><span class="hc-title">${esc(title)}</span><span class="hc-sub">${esc(sub)}</span></span></a>`;
  }
}
function liveRender(opts) {
  opts = opts || {};
  liveStart();
  const r = parseRoute();
  state.route = r;
  if (!opts.keepScroll) closeDialog(true);
  let v, top = 'home';
  if (LIVE.phase === 'starting') v = liveViewStarting();
  else if (LIVE.phase === 'offline') v = liveViewOffline();
  else if (!r.parts[0] || r.parts[0] === 'tasks') v = liveViewHome();
  else if (r.parts[0] === 'task') v = liveViewTask(decodeURIComponent(r.parts[1] || ''));
  else if (r.parts[0] === 'places') { v = liveViewPlaces(); top = 'places'; }
  else if (r.parts[0] === 'setup') { v = liveViewSetup(false); top = 'places'; }
  else if (r.parts[0] === 'new') { v = liveViewNew(); top = ''; }
  else { v = liveViewNotYet(r.parts[0]); top = ''; }
  const root = $('#root');
  if (!$('.app.live', root)) root.innerHTML = liveShellHTML();
  const fk = focusKeyOf(document.activeElement);
  const moved = r.path !== LIVE.lastPath;
  /* A form you are typing in isn't redrawn because a task changed state somewhere: only the sidebar is. */
  if (opts.background && !moved && r.parts[0] === 'new' && $('.app.live', root)) { liveChrome(top); return; }
  /* The setup output and Axel's animation keep their place while the page redraws around them. */
  const oldAx = !moved ? $('#main svg.axo') : null;
  const log = $('#live-op-log');
  const logAt = log ? { top: log.scrollTop, stuck: log.scrollTop + log.clientHeight >= log.scrollHeight - 24 } : null;
  $('#main').innerHTML = `<div class="content ${v.wide ? 'wide' : ''} ${moved && !opts.keepScroll ? 'view-enter' : ''}">${v.html}</div>`;
  if (oldAx && typeof keepAxel === 'function') keepAxel(oldAx, $('#main'));
  const log2 = $('#live-op-log');
  if (log2) log2.scrollTop = !logAt || logAt.stuck ? log2.scrollHeight : logAt.top;
  renderCrumbs(v.crumbs || []);
  liveChrome(top);
  updateThemeToggle();
  state.docTitle = v.title + ' · AX Studio';
  document.title = state.docTitle;
  if (moved) {
    /* A new page starts at the top, with focus on its heading. A task you just opened loads its details right away. */
    if (LIVE.lastPath !== null) { window.scrollTo(0, 0); const h = $('#main h1'); if (h) h.focus({ preventScroll: true }); }
    LIVE.lastPath = r.path;
    if (LIVE.phase === 'ready' && ['task', 'places', 'setup'].includes(r.parts[0])) { LIVE.failedAt = 0; liveRefresh(true); }
  } else {
    restoreFocus(fk);
  }
}

function livePaletteItems() {
  const r = parseRoute();
  const items = [];
  const go = (h) => () => { location.hash = h; };
  items.push(
    { group: 'Go to', label: 'New task', icon: 'plus', cli: liveCmd(['apply', '-f', 'task.yaml']), run: go('#/new'), keys: 'N' },
    { group: 'Go to', label: 'Home (Your tasks)', icon: 'inbox', cli: liveCmd(['get', 'tasks']), run: go('#/') },
    { group: 'Go to', label: 'Where agents run', icon: 'server', cli: 'ax local status', run: go('#/places') },
  );
  if (r.parts[0] === 'task' && r.parts[1]) {
    const name = decodeURIComponent(r.parts[1]);
    const row = LIVE.tasks.find((t) => t.name === name);
    const st = row ? row.state : '';
    if (['Working', 'Queued', 'Idle', 'RequiresAction'].includes(st)) {
      items.push({ group: 'This task', label: `Pause ${name}`, icon: 'pause', cli: liveCmd(['suspend', 'task', name]), run: () => liveTaskAction(name, 'suspend') });
    }
    if (st === 'Suspended') {
      items.push({ group: 'This task', label: `Resume ${name}`, icon: 'play', cli: liveCmd(['resume', 'task', name]), run: () => liveTaskAction(name, 'resume') });
    }
    if (row && row.debug) {
      items.push({ group: 'This task', label: 'Open shell in sandbox', icon: 'terminal', cli: liveCmd(['ssh', name]), run: () => liveTermOpen(name) });
    }
    items.push(
      { group: 'This task', label: 'Send a follow-up', icon: 'message', cli: liveCmd(['apply', '-f', 'task.yaml']), run: go(`#/new?from=${encodeURIComponent(name)}`) },
      { group: 'This task', label: 'Run on another cluster…', icon: 'cloudUp', cli: liveCmd(['promote', 'task', name]), run: () => liveOpenPromote(name) },
      { group: 'This task', label: 'Delete task…', icon: 'trash', cli: liveCmd(['delete', 'task', name]), run: () => liveOpenDelete(name) },
    );
  }
  LIVE.contexts.forEach((c) => {
    if (c.name !== LIVE.context) {
      items.push({ group: 'Clusters', label: `Use cluster ${c.name}`, icon: liveIsLocal(c.name) ? 'laptop' : 'cloud', cli: `ax ctx ${c.name}`, run: () => LIVE_ACTIONS['live-use-context']({ dataset: { context: c.name } }) });
    }
  });
  LIVE.tasks.forEach((t) => {
    const d = liveState(t.state);
    items.push({ group: 'Tasks', label: t.goal || t.name, icon: d.icon === 'loader' ? 'activity' : d.icon, cli: liveCmd(['get', 'task', t.name]), run: go(`#/task/${encodeURIComponent(t.name)}`), meta: `${t.name} · ${d.label}` });
  });
  const dark = resolvedTheme() === 'dark';
  items.push(
    { group: 'Studio', label: "Why an axolotl? · Axel's story", icon: 'waves', cli: '', run: () => openStory() },
    { group: 'Studio', label: dark ? 'Switch to light theme' : 'Switch to dark theme', icon: dark ? 'sun' : 'moon', cli: '', run: () => setTheme(dark ? 'light' : 'dark'), keys: 'T' },
    { group: 'Studio', label: 'Keyboard shortcuts', icon: 'keyboard', cli: '', run: () => openShortcuts(), keys: '?' },
  );
  return items;
}

if (LIVE.on) {
  document.addEventListener('keydown', (e) => {
    const el = e.target;
    if (e.key === 'Enter' && el && el.id === 'live-term-in' && el.dataset && el.dataset.termTask) {
      e.preventDefault();
      liveTermSend(el.dataset.termTask);
    } else if (e.key === 'Enter' && el && el.id === 'live-quick-goal') {
      e.preventDefault();
      LIVE_ACTIONS['live-quick-go']();
    }
  });
}
