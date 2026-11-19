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
   - this computer and the clusters in your kubeconfig, with setup of AX on this computer and checking, installing,
     upgrading and uninstalling AX on a remote cluster (live-env.js)
   - the task list, each task's goal and state, and a task's details, result and task file
   - what a task's sandbox printed, from Agent Substrate's workers (live-logs.js)
   - for a task with debug access, what it changed in its sandbox, with push to a branch (live-changes.js), and a shell
     in its sandbox (the Terminal, below)
   - pause, resume and delete
   - the workspaces and Gateways on the cluster, and deleting the ones no task uses (live-resources.js)
   - starting a task, following up on one, and running one on another cluster (live-new.js)
   - Settings: appearance, keyboard and the command palette, accessibility, what this Studio runs against (with the
     atespace), and diagnostics (live-settings.js)

   Tasks come from the AX server as data. Studio never changes your kubeconfig: it names the cluster on every request. */

const LIVE = {
  on: typeof STUDIO !== 'undefined' && STUDIO.on,
  phase: 'starting',     // starting, offline (the Studio server isn't answering) or ready
  started: false,
  offlineError: '',
  offlineAt: 0,
  axVersion: '',         // from ax version
  axError: '',           // why the ax command couldn't run; setup, New task and sending a task to a cluster need it
  axUpdate: null,        // { reason, version, command } when this ax is too old for Studio (no `ax local status -o json`)
  env: null,             // what the server last said about this computer and your kubeconfig
  envError: '',
  envAt: 0,
  checks: [],            // { id, label, status: ok | warn | fail, detail, command }: what AX on this computer needs
  tools: [],             // { name, version, status: ok | warn | fail | none, detail }: ax, kubectl and kind
  axFlags: {},           // which optional flags this ax takes ({ runnerVolumeImage })
  clusterChecks: {},     // context -> a read-only check of that cluster: { checking, error, requirements, substrate, router, workerPools, ax, axImage }
  canStartLocal: false,
  local: null,           // { name, state: NotFound | Stopped | Running | Unknown (ax too old to say), context, substrate, server }
  op: null,              // setup in progress, or the last one: { id, action, stage, status, error, logs, started, finished, stageStarted, step, canceled }
  opDismissed: '',       // the operation whose result you dismissed
  localVerb: 'setup',    // what the `ax local start` that runs was for: setup, start, update or repair
  contexts: [],          // { name, cluster, current, isLocal }, from your kubeconfig
  context: '',           // the cluster Studio talks to
  atespace: (() => { try { return localStorage.getItem('ax.live.atespace') || 'default'; } catch (e) { return 'default'; } })(), // the atespace Studio lists and starts tasks in
  tasks: [],             // see liveTask
  detail: {},            // task name -> { doc, yaml, error, missing }
  gateways: {},          // Gateway name -> { doc, error }: what a task can reach. A task keeps the rules it started with.
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
function liveCmd(args) { return ['ax'].concat(LIVE.context ? ['--context', LIVE.context] : [], LIVE.atespace && LIVE.atespace !== 'default' ? ['-a', LIVE.atespace] : [], args).join(' '); }
const LIVE_ATESPACE_KEY = 'ax.live.atespace';
/** Lists and starts tasks in another atespace. Like picking a cluster, it is Studio's own choice, kept in this browser. */
function liveUseAtespace(name) {
  name = String(name || '').trim() || 'default';
  if (name === LIVE.atespace) return;
  LIVE.atespace = name;
  try { if (name === 'default') localStorage.removeItem(LIVE_ATESPACE_KEY); else localStorage.setItem(LIVE_ATESPACE_KEY, name); } catch (e) { /* ignore */ }
  LIVE.tasks = []; LIVE.detail = {}; LIVE.gateways = {}; LIVE.changes = {}; LIVE.logs = {}; LIVE.error = ''; LIVE.errorCode = ''; LIVE.failedAt = 0; LIVE.loaded = false;
  if (LIVE.res) LIVE.res.ctx = null;
  LIVE.needsKnown = null;
}

/* ---------- Loading ---------- */
function liveRouteTask() { const r = parseRoute(); return r.parts[0] === 'task' && r.parts[1] ? decodeURIComponent(r.parts[1]) : ''; }
function liveSnapshot() {
  const cur = liveRouteTask();
  return JSON.stringify([LIVE.phase, LIVE.tasks.map((t) => [t.name, t.state, t.goal, t.created]), LIVE.error, LIVE.contexts, LIVE.envError, LIVE.local, LIVE.checks, LIVE.tools, LIVE.axUpdate,
    LIVE.context, LIVE.busy, LIVE.loaded, LIVE.axError, LIVE.op && [LIVE.op.id, LIVE.op.status], cur && LIVE.detail[cur], cur && LIVE.gateways]);
}
async function liveStart() {
  if (!LIVE.on || LIVE.started) return;
  LIVE.started = true;
  Object.assign(ACTIONS, LIVE_ACTIONS, LIVE_ENV_ACTIONS, LIVE_NEW_ACTIONS, LIVE_CHANGES_ACTIONS, LIVE_LOGS_ACTIONS, LIVE_RES_ACTIONS, LIVE_NAV_ACTIONS);
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
  /* Show this computer and the kubeconfig now: the first answer from a cluster can take a minute when it's unreachable. */
  render({ keepScroll: true, background: true });
  /* A link can name the cluster and atespace to open on. */
  if (typeof liveApplyDeepLink === 'function') liveApplyDeepLink();
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
/** This computer and your kubeconfig. Picks the cluster to talk to if the one in use is gone. fresh asks for the tools'
    versions again (Check again). */
async function liveLoadEnv(fresh) {
  LIVE.envAt = Date.now();
  try {
    const env = await studioApi.env(!!fresh);
    const l = env.local || {};
    LIVE.env = env;
    LIVE.envError = '';
    LIVE.checks = env.preflight || [];
    LIVE.tools = env.tools || [];
    LIVE.axFlags = env.axFlags || {};
    LIVE.axUpdate = env.axUpdate && env.axUpdate.command ? { reason: env.axUpdate.reason || '', version: env.axUpdate.version || '', command: env.axUpdate.command } : null;
    LIVE.canStartLocal = !!env.canStartLocal;
    LIVE.local = { name: l.name || '', state: l.state || 'NotFound', context: l.kubeContext && l.kubeContext !== 'N/A' ? l.kubeContext : '', substrate: l.substrateStatus || '', server: l.axStatus || '', access: l.access || 'ok' };
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
  LIVE.tasks = []; LIVE.detail = {}; LIVE.gateways = {}; LIVE.changes = {}; LIVE.logs = {}; LIVE.error = ''; LIVE.errorCode = ''; LIVE.failedAt = 0; LIVE.loaded = false;
  if (LIVE.res) LIVE.res.ctx = null;
  LIVE.needsKnown = null;
  if (!quiet) { try { localStorage.setItem(LIVE_CONTEXT_KEY, name); } catch (e) { /* ignore */ } }
}
async function liveLoadTask(name) {
  try {
    const r = await studioApi.task(LIVE.context, LIVE.atespace, name);
    LIVE.detail[name] = { doc: r.task || null, yaml: r.yaml || '', error: '' };
    const gw = r.task && r.task.spec && r.task.spec.gateway && r.task.spec.gateway.name;
    const had = gw && LIVE.gateways[gw];
    if (gw && (!had || (had.error && Date.now() - had.at > LIVE_ENV_MS))) await liveLoadGateway(gw);
  } catch (e) {
    LIVE.detail[name] = Object.assign({}, LIVE.detail[name], { error: e.message, missing: e.code === 'NotFound' });
  }
}
/** A Gateway's rules, read once: a task copies them when it starts, so they don't change under it. */
async function liveLoadGateway(name) {
  const ctx = LIVE.context;
  let entry;
  try {
    entry = { doc: (await studioApi.gateway(ctx, LIVE.atespace, name)).gateway || null, error: '', at: Date.now() };
  } catch (e) {
    entry = { doc: null, error: e.message, missing: e.code === 'NotFound', at: Date.now() };
  }
  if (ctx === LIVE.context) LIVE.gateways[name] = entry;
}
async function liveRefresh(force) {
  if (LIVE.phase !== 'ready' || (LIVE.loading && !force)) return;
  LIVE.loading = true;
  const before = liveSnapshot();
  try {
    const part = parseRoute().parts[0];
    const envPage = part === 'places' || part === 'setup' || !LIVE.context || liveLocalDown();
    if (envPage && !liveOpRunning() && (force || Date.now() - LIVE.envAt >= LIVE_ENV_MS)) { await liveLoadEnv(); render({ keepScroll: true, background: true }); }
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
        if (typeof liveNotifyNeeds === 'function') liveNotifyNeeds();
      } catch (e) {
        if (ctx !== LIVE.context) return;
        if (e.status === 0) liveWentOffline(e);
        LIVE.error = e.message; LIVE.errorCode = e.code || ''; LIVE.failedAt = Date.now();
      }
      LIVE.loaded = true;
      LIVE.refreshedAt = Date.now();
      $$('[data-live-updated]').forEach((el) => { el.dataset.since = String(LIVE.refreshedAt); el.textContent = fmtAgo(LIVE.refreshedAt); });
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
  if (typeof liveLogsTick === 'function') liveLogsTick();
}

/* ---------- Actions ---------- */
const LIVE_VERBS = {
  suspend: { doing: 'Pausing', done: 'Paused', fail: "Couldn't pause" },
  resume: { doing: 'Resuming', done: 'Resumed', fail: "Couldn't resume" },
  delete: { doing: 'Deleting', done: 'Deleted', fail: "Couldn't delete" },
};
async function liveTaskAction(name, verb) {
  if (!name || !LIVE_VERBS[verb] || LIVE.busy[name]) return false;
  const w = LIVE_VERBS[verb];
  LIVE.busy[name] = verb;
  render({ keepScroll: true });
  announce(`${w.doing} ${name}`);
  let error = '';
  try { await studioApi.taskAction(verb, LIVE.context, LIVE.atespace, name); } catch (e) { error = e.message; }
  delete LIVE.busy[name];
  if (!error) {
    toast(`${w.done} <span class="mono">${esc(name)}</span>`, { icon: verb === 'delete' ? 'trash' : 'check' });
    if (verb === 'delete') { delete LIVE.detail[name]; delete LIVE.changes[name]; delete LIVE.logs[name]; LIVE.tasks = LIVE.tasks.filter((t) => t.name !== name); if (liveRouteTask() === name) location.hash = '#/'; }
  } else {
    toast(`${w.fail} <span class="mono">${esc(name)}</span>: ${esc(error)}`, { icon: 'alert', timeout: 9000 });
  }
  await liveRefresh(true);
  return !error;
}
function liveOpenDelete(name) {
  /* Its workspace and Gateway stay unless you tick them; the ones made for this task are ticked. */
  const left = typeof liveTaskLeftovers === 'function' ? liveTaskLeftovers(name) : [];
  const pick = {};
  left.forEach((x) => { pick[`${x.kind}/${x.name}`] = x.own; });
  const keptWords = () => {
    const kept = left.filter((x) => !pick[`${x.kind}/${x.name}`]).map((x) => `${x.kind === 'workspace' ? 'workspace' : 'Gateway'} <span class="mono">${esc(x.name)}</span>`);
    return kept.length ? `Its ${kept.join(' and ')}, for other tasks to use` : left.length ? 'Its model, for other tasks to use' : 'Its workspace, Gateway and model, for other tasks to use';
  };
  const cmds = () => [liveCmd(['delete', 'task', name])].concat(left.filter((x) => pick[`${x.kind}/${x.name}`]).map((x) => liveCmd(['delete', x.kind, x.name])));
  const dlg = openDialog(dialogShell('ld', `Delete ${esc(name)}?`, '', `
    <p class="small">This removes the task from AX and tears down its sandbox. It can't be undone.</p>
    <ul class="check-list" style="margin-top:10px">
      <li class="check-item no"><span class="ci-icon">${icon('trash')}</span><div><div class="ci-title">Removed</div><div class="ci-desc">The task, its sandbox and the files in it</div></div></li>
      <li class="check-item ok"><span class="ci-icon">${icon('check')}</span><div><div class="ci-title">Kept</div><div class="ci-desc" id="ld-kept">${keptWords()}</div></div></li>
    </ul>
    ${left.length ? `<div class="ld-also"><div class="res-h" style="margin-top:12px">No other task uses</div>${left.map((x) => `<label class="ld-opt"><input type="checkbox" data-ld="${x.kind}/${esc(x.name)}" ${x.own ? 'checked' : ''}> Delete its ${x.kind === 'workspace' ? 'workspace' : 'Gateway'} <span class="mono">${esc(x.name)}</span> too</label>`).join('')}</div>` : ''}
    <div style="margin-top:14px;display:grid;gap:6px" id="ld-cmds">${cmds().map(cliHint).join('')}</div>`, `<span class="left"></span><button class="btn ghost" data-action="close-dialog">Cancel</button><button class="btn danger" id="ld-go">${icon('trash', 'sm')}Delete task</button>`, false, 'trash'));
  dlg.addEventListener('change', (e) => {
    const k = e.target && e.target.dataset && e.target.dataset.ld;
    if (!k) return;
    pick[k] = e.target.checked;
    const kept = $('#ld-kept', dlg); if (kept) kept.innerHTML = keptWords();
    const c = $('#ld-cmds', dlg); if (c) c.innerHTML = cmds().map(cliHint).join('');
  });
  $('#ld-go', dlg).addEventListener('click', async () => {
    closeDialog(true);
    const also = left.filter((x) => pick[`${x.kind}/${x.name}`]);
    const ok = await liveTaskAction(name, 'delete');
    if (!ok || !also.length) return;
    const failed = [];
    for (const x of also) { const err = await liveResDelete(x.kind, x.name); if (err) failed.push(`${x.name}: ${err}`); }
    if (failed.length) toast(`Deleted the task, but not ${esc(failed.join('; '))}`, { icon: 'alert', timeout: 9000 });
    else toast(`Deleted <span class="mono">${esc(name)}</span> with its ${also.map((x) => (x.kind === 'workspace' ? 'workspace' : 'Gateway')).join(' and ')}`, { icon: 'trash' });
    render({ keepScroll: true });
  });
}
const LIVE_ACTIONS = {
  'live-recheck': () => { liveConnect(); render(); },
  'live-refresh': () => { LIVE.failedAt = 0; liveRefresh(true); },
  'live-suspend': (el) => liveTaskAction(el.dataset.task, 'suspend'),
  'live-resume': (el) => liveTaskAction(el.dataset.task, 'resume'),
  'live-delete': (el) => liveOpenDelete(el.dataset.task),
  'live-use-context': (el) => {
    const name = el.dataset.context;
    if (LIVE.ctxMenu) LIVE.ctxMenu = false;
    if (!name || name === LIVE.context) { render({ keepScroll: true }); return; }
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
  'live-term-add': (el) => liveTermAdd(el.dataset.task),
  'live-term-pick': (el) => liveTermPick(el.dataset.task, +el.dataset.i),
  'live-term-drop': (el) => liveTermDrop(el.dataset.task, +el.dataset.i),
  'live-tasks-filter': (el) => { liveTasksFilter().status = el.dataset.v || 'all'; render({ keepScroll: true }); },
};

/* ---------- Interactive sandbox terminal (ax ssh) ----------
   A shell in the sandbox: `ax ssh` runs /bin/sh in it, without a terminal of its own (AX's guest exec has none), so
   this is a line at a time rather than a full terminal: type a command, Run (or Enter) sends it. Each task can have
   several shells at once, as tabs. Up and Down go through the commands you ran, Ctrl-C interrupts, Ctrl-D ends the
   shell's input and Ctrl-L clears. Colors programs print are shown. */
LIVE.terms = {};               // task name -> { list: [shell], active, history: [commands], hpos }
const LIVE_TERM_MAX = 4;       // shells per task
function liveTermSet(name) {
  return (LIVE.terms[name] = LIVE.terms[name] || { list: [], active: 0, history: [], hpos: -1, seq: 0 });
}
/** The shell on screen for a task (one is made the first time). */
function liveTermOf(name) {
  const set = liveTermSet(name);
  if (!set.list.length) set.list.push(liveTermNew(name, set));
  return set.list[Math.min(set.active, set.list.length - 1)];
}
function liveTermNew(name, set) {
  set.seq += 1;
  return { id: `term-${name}-${set.seq}`, label: `Shell ${set.seq}`, status: 'idle', out: '', error: '', exitCode: null };
}
function liveTermById(id) {
  for (const name of Object.keys(LIVE.terms)) {
    const tm = LIVE.terms[name].list.find((x) => x.id === id);
    if (tm) return { name, tm };
  }
  return null;
}
/* SGR colors in what a program prints, as spans; every other escape sequence is dropped. */
const LIVE_ANSI_FG = { 30: 'k', 31: 'r', 32: 'g', 33: 'y', 34: 'bl', 35: 'm', 36: 'c', 37: 'w', 90: 'k', 91: 'r', 92: 'g', 93: 'y', 94: 'bl', 95: 'm', 96: 'c', 97: 'w' };
function liveAnsiHTML(text) {
  let out = '', open = false, bold = false, fg = '';
  const close = () => { if (open) { out += '</span>'; open = false; } };
  const start = () => { close(); if (bold || fg) { out += `<span class="${[bold ? 'a-bold' : '', fg ? `a-${fg}` : ''].filter(Boolean).join(' ')}">`; open = true; } };
  const re = /\x1b\[([0-9;?]*)([A-Za-z])|\x1b[()][A-Za-z0-9]|\x1b[=>]|\r(?!\n)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    out += esc(text.slice(last, m.index));
    last = re.lastIndex;
    if (m[2] !== 'm') continue;
    (m[1] || '0').split(';').forEach((c) => {
      const n = +c || 0;
      if (n === 0) { bold = false; fg = ''; } else if (n === 1) bold = true; else if (n === 22) bold = false;
      else if (n === 39) fg = ''; else if (LIVE_ANSI_FG[n]) fg = LIVE_ANSI_FG[n];
    });
    start();
  }
  out += esc(text.slice(last));
  close();
  return out;
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
  const hit = liveTermById(p.id);
  if (!hit) return;
  const { name, tm } = hit;
  tm.out += String(p.data || '');
  if (tm.out.length > 32000) tm.out = tm.out.slice(-32000);
  const out = $('#live-term-out');
  const shown = out && $('#live-term') && $('#live-term').dataset.task === name && liveTermOf(name) === tm;
  if (shown) {
    out.innerHTML = liveAnsiHTML(tm.out);
    out.scrollTop = out.scrollHeight;
  } else {
    liveTermPaint(name);
  }
}
function liveOnSessionExit(p) {
  if (!p || !p.id) return;
  const hit = liveTermById(p.id);
  if (!hit) return;
  hit.tm.status = 'closed';
  hit.tm.exitCode = typeof p.status === 'number' ? p.status : 0;
  liveTermPaint(hit.name);
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
/** Another shell in the same sandbox, next to the ones open. */
function liveTermAdd(name) {
  const set = liveTermSet(name);
  if (set.list.length >= LIVE_TERM_MAX) return;
  set.list.push(liveTermNew(name, set));
  set.active = set.list.length - 1;
  liveTermOpen(name);
}
function liveTermPick(name, idx) {
  const set = liveTermSet(name);
  if (!set.list[idx]) return;
  set.active = idx;
  liveTermPaint(name);
  const inp = $('#live-term-in'); if (inp) inp.focus({ preventScroll: true });
}
/** Ends a shell and takes its tab away (the last one stays, closed). */
async function liveTermDrop(name, idx) {
  const set = liveTermSet(name);
  const tm = set.list[idx];
  if (!tm) return;
  if (tm.status === 'open' || tm.status === 'starting') { try { await studioApi.sessionClose(tm.id); } catch (e) { /* ignore */ } }
  if (set.list.length > 1) { set.list.splice(idx, 1); set.active = Math.min(set.active, set.list.length - 1); } else tm.status = 'closed';
  liveTermPaint(name);
}
async function liveTermSend(name) {
  const tm = liveTermOf(name);
  const set = liveTermSet(name);
  const inp = $('#live-term-in');
  if (!inp || tm.status !== 'open') return;
  const cmd = inp.value;
  inp.value = '';
  if (cmd.trim() && set.history[set.history.length - 1] !== cmd) set.history.push(cmd);
  if (set.history.length > 100) set.history.shift();
  set.hpos = -1;
  tm.out += `$ ${cmd}\n`;
  const out = $('#live-term-out');
  if (out) { out.innerHTML = liveAnsiHTML(tm.out); out.scrollTop = out.scrollHeight; }
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
/** Ctrl-D: the end of the shell's input, which ends a shell (or a program reading it). */
async function liveTermEOF(name) {
  const tm = liveTermOf(name);
  if (tm.status !== 'open') return;
  tm.out += '^D\n';
  try { await studioApi.sessionEOF(tm.id); } catch (e) { tm.error = e.message; }
  liveTermPaint(name);
}
async function liveTermClose(name) {
  const tm = liveTermOf(name);
  try { await studioApi.sessionClose(tm.id); } catch (e) { /* ignore */ }
  tm.status = 'closed';
  liveTermPaint(name);
}
function liveTermInnerHTML(name, stateName) {
  const tm = liveTermOf(name);
  const set = liveTermSet(name);
  /* `ax ssh` only connects to a task that is Working. */
  const canShell = stateName === 'Working';
  const open = tm.status === 'open', starting = tm.status === 'starting';
  const anyOpen = set.list.some((x) => x.status === 'open');
  const controls = open
    ? `<span class="chip running"><i class="pulse-dot"></i>Connected</span><button type="button" class="btn ghost sm" data-action="live-term-ctrlc" data-task="${esc(name)}" title="Send SIGINT (Ctrl-C)">Ctrl-C</button><button type="button" class="btn ghost sm" data-action="live-term-clear" data-task="${esc(name)}" title="Clear (Ctrl-L)">Clear</button><button type="button" class="btn sm" data-action="live-term-close" data-task="${esc(name)}">Disconnect</button>`
    : `<button type="button" class="btn ${canShell ? 'primary' : ''} sm" id="live-term-open" data-action="live-term-open" data-task="${esc(name)}" ${!canShell || starting ? 'disabled' : ''}>${icon(starting ? 'loader' : 'terminal', 'sm')}${starting ? 'Connecting…' : tm.status === 'closed' ? 'Open the shell again' : 'Open shell in sandbox'}</button>`;
  const placeholder = canShell ? 'Open a shell to run commands inside the sandbox, in /workspace.' : 'The task is not running right now, so its sandbox shell is closed.';
  /* The shells, as tabs: the one on screen, and New shell while one is connected. */
  const tabs = set.list.length > 1 || anyOpen ? `<div class="term-tabs" role="tablist" aria-label="Shells">${set.list.map((x, i) => `<span class="tt-item${i === set.active ? ' on' : ''}">
      <button type="button" role="tab" aria-selected="${i === set.active}" data-action="live-term-pick" data-task="${esc(name)}" data-i="${i}">${x.status === 'open' ? '<i class="tt-dot"></i>' : ''}${esc(x.label)}</button>
      ${set.list.length > 1 ? `<button type="button" class="tt-x" data-action="live-term-drop" data-task="${esc(name)}" data-i="${i}" aria-label="Close ${esc(x.label)}">${icon('x', 'xs')}</button>` : ''}</span>`).join('')}
      ${canShell && set.list.length < LIVE_TERM_MAX ? `<button type="button" class="tt-new" data-action="live-term-add" data-task="${esc(name)}" aria-label="New shell">${icon('plus', 'xs')}New shell</button>` : ''}</div>` : '';
  const ended = tm.status === 'closed' && tm.exitCode != null ? `\n<span class="m">The shell ended${tm.exitCode ? ` (exit ${esc(tm.exitCode)})` : ''}.</span>` : '';
  return `<h2 id="live-term-h" class="sr-only">Terminal</h2>
    <div class="log-bar"><span class="lb-text">${canShell ? 'A shell inside its gVisor sandbox, in <span class="mono">/workspace</span>, a line at a time.' : 'The task is not running right now, so its sandbox shell is closed.'}</span><span class="lb-actions">${controls}</span></div>
    ${tm.error ? `<div class="callout warn" role="alert" style="margin-bottom:10px">${icon('alert')}<div style="overflow-wrap:anywhere">${esc(tm.error)}</div></div>` : ''}
    <div class="terminal live-terminal">
      <div class="term-bar"><span class="term-dots" aria-hidden="true"><i></i><i></i><i></i></span>${tabs || `<span class="term-tab" aria-hidden="true">${esc(name)} · /workspace</span>`}</div>
      <pre class="term-body" id="live-term-out" tabindex="0" aria-label="Terminal output">${open || tm.out ? liveAnsiHTML(tm.out || 'Connected. Run a command below.\n') + ended : `<span class="m">${placeholder}</span>`}</pre>
      ${open ? `<div class="term-input-row live-term-row"><span class="p" aria-hidden="true">$</span><label class="sr-only" for="live-term-in">Command to run in the sandbox</label><input class="term-input mono" id="live-term-in" data-term-task="${esc(name)}" placeholder="pwd, ls -la, git status…" autocomplete="off" spellcheck="false" aria-describedby="live-term-keys"><button type="button" class="btn sm" id="live-term-send" data-action="live-term-send" data-task="${esc(name)}">${icon('send', 'sm')}Run</button></div>
        <div class="term-keys" id="live-term-keys"><kbd>↑</kbd> <kbd>↓</kbd> earlier commands · <kbd>Ctrl</kbd> <kbd>C</kbd> interrupt · <kbd>Ctrl</kbd> <kbd>D</kbd> end input · <kbd>Ctrl</kbd> <kbd>L</kbd> clear</div>` : ''}
    </div>
    <p class="xsmall muted" style="margin-top:10px">${icon('terminal', 'xs')} <code>${esc(liveCmd(['ssh', name]))}</code></p>`;
}
function liveTermHTML(name, t, stateName) {
  if (!t.debug) return '';
  return `<section aria-labelledby="live-term-h" id="live-term" data-task="${esc(name)}">${liveTermInnerHTML(name, stateName)}</section>`;
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
/** The cluster in use is AX on this computer, and it isn't running. When ax is too old to say (Unknown), it isn't
    called down: the task list shows what the cluster says, and a banner asks you to update ax. */
function liveLocalDown() { return !!(LIVE.context && liveIsLocal(LIVE.context) && LIVE.local && LIVE.local.state !== 'Running' && LIVE.local.state !== 'Unknown'); }
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
  groups.forEach((g) => { const r = rank(g); g.forEach((t) => { t.groupRank = r; }); });
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
/** A banner for "this didn't work": what AX said, and the command that asks the same. `extra` is one more button. */
function liveProblemHTML(title, message, cmd, extra) {
  return `<div class="card card-pad" role="alert" style="margin-top:14px">
    <div style="display:flex;gap:10px;align-items:flex-start">${icon('alert')}<div style="min-width:0;flex:1">
      <div class="live-title">${title}</div>
      <p class="small" style="margin-top:4px;overflow-wrap:anywhere">${esc(message)}</p>
      ${cmd ? `<div style="margin-top:10px">${cliHint(cmd)}</div>` : ''}
      <div class="btn-row" style="margin-top:12px">${extra || ''}<button class="btn sm" data-action="live-refresh">${icon('refresh', 'sm')}Try again</button><a class="btn ghost sm" href="#/places">Where agents run</a></div>
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
/* Home's sections, by how much a task needs you (its session's most urgent turn). The tiles jump to them. */
const LIVE_HOME_SECTIONS = [
  { rank: 0, key: 'needs', cls: 'needs', label: 'Needs you', sub: (n) => (n ? 'Stopped or waiting' : 'All caught up') },
  { rank: 1, key: 'running', cls: 'working', label: 'Running', sub: (n) => (n ? 'In gVisor sandboxes' : 'No agents running') },
  { rank: 2, key: 'paused', cls: 'review', label: 'Paused', sub: (n) => (n ? 'Checkpointed' : 'None paused') },
  { rank: 3, key: 'done', cls: 'shipped', label: 'Done', sub: (n) => (n ? 'Finished runs' : 'None finished yet') },
];
const LIVE_CALL_ME_KEY = 'ax.live.callMe';
/** What Home calls you: the name you gave in Settings, else the first word of the name this computer knows (your
    account, else git), else nothing. Studio never makes a name up from your login. */
function liveCallMe() {
  let mine = '';
  try { mine = (localStorage.getItem(LIVE_CALL_ME_KEY) || '').trim(); } catch (e) { /* ignore */ }
  if (mine) return mine;
  const name = ((STUDIO.info && STUDIO.info.user && STUDIO.info.user.name) || '').trim();
  return name ? name.split(/\s+/)[0] : '';
}
function liveViewHome() {
  /* Nothing to list from: no cluster yet, or AX on this computer isn't running. Start with setup. */
  if (LIVE.loaded && (!LIVE.context || liveLocalDown())) return liveViewSetup(true);
  const list = liveSorted();
  const inSec = (r) => list.filter((t) => t.groupRank === r);
  const needs = inSec(0).length, active = inSec(1).length, paused = inSec(2).length;
  /* The tiles carry the counts; the lede only says where to start (as in the prototype). */
  const lede = !LIVE.loaded ? 'Loading your tasks…'
    : LIVE.error ? `${LIVE_ERROR_WORDS[liveErrorKind()].summary}${list.length ? ' This is the last list it got.' : ''}`
      : needs ? 'Start with what needs you below. Agents keep working in their own sandboxes while you decide.'
        : active ? 'Nothing needs you right now. Agents are working in their own gVisor sandboxes.'
          : paused ? 'Every sandbox is quiet. Resume a paused task below, or describe your next outcome.'
            : list.length ? 'Every sandbox is quiet. Describe your next outcome and an agent will pick it up.'
              : 'Describe the outcome you want. AX sets up a gVisor sandbox for the agent, and you review what it changed.';
  const where = esc(LIVE.context || 'this cluster');
  const kind = liveErrorKind();
  const problem = !LIVE.error ? ''
    : kind === 'missing' ? liveProblemHTML(`AX isn't installed on ${where}`, `Install it here or with the command below, then try again. What AX Studio got: ${LIVE.error}`, liveCmd(['install']),
      liveIsLocal(LIVE.context) ? '' : `<button class="btn primary sm" data-action="live-install" data-context="${esc(LIVE.context)}" ${liveOpRunning() ? 'disabled' : ''}>${icon('wrench', 'sm')}Install AX…</button>`)
      : kind === 'versions' ? liveProblemHTML(`AX on ${where} and AX Studio are different versions`, `They can't read each other's data. Update the older one so the two match. What AX Studio got: ${LIVE.error}`, '')
        : liveProblemHTML(`Can't reach AX on ${where}`, LIVE.error, liveCmd(['get', 'tasks']));
  const heroMood = LIVE.error || needs ? 'wave' : active ? 'working' : 'idle';
  const heroTone = LIVE.error || needs ? 'needs' : active ? 'working' : 'calm';
  /* Axel only speaks when he has something the page doesn't already say: what you poked him for, or hello on an empty
     cluster. */
  const said = state.axelSpeech && Date.now() - state.axelSpeech.at < 8000 ? state.axelSpeech.text
    : LIVE.loaded && !LIVE.error && !list.length ? "Hi! I'm Axel. Pick a template, point it at a repo and describe the goal. Each agent runs in its own gVisor sandbox." : '';
  const callMe = liveCallMe();
  const tile = (s) => {
    const n = inSec(s.rank).length;
    return `<button type="button" class="station st-${s.cls} ${n ? 'has' : ''}" id="live-station-${s.key}" ${n ? `data-action="jump" data-target="live-sec-${s.key}" aria-label="${s.label}: ${n}. Go to the list."` : `disabled aria-label="${s.label}: none"`}>
      <span class="st-top"><span class="st-num tnum">${n}</span></span><span class="st-label">${s.label}</span><span class="st-sub">${s.sub(n)}</span></button>`;
  };
  const flow = list.length ? `<div class="card flow" role="group" aria-label="Where your tasks are right now" style="margin-top:14px">
    ${LIVE_HOME_SECTIONS.map(tile).join('<span class="flow-link" aria-hidden="true"></span>')}</div>` : '';
  const sections = LIVE_HOME_SECTIONS.filter((s) => inSec(s.rank).length).map((s) => `<section class="section live-sec" aria-labelledby="live-sec-${s.key}">
      <div class="section-head"><h3 id="live-sec-${s.key}">${s.label}</h3></div>
      <div class="card task-card">${inSec(s.rank).map(liveRowHTML).join('')}</div></section>`).join('');
  /* Whose tasks these are: the cluster in use, with a way to switch. New tasks start there too. */
  const upd = LIVE.refreshedAt ? `<span class="llh-upd" title="Studio asks again every few seconds">Updated <span data-live-updated data-fmt="ago" data-since="${LIVE.refreshedAt}">${fmtAgo(LIVE.refreshedAt)}</span></span><button type="button" class="btn ghost sm icon" data-action="live-refresh" aria-label="Refresh the list">${icon('refresh', 'sm')}</button>` : '';
  const ates = LIVE.atespace !== 'default' ? `<span class="env" title="Atespace"><span class="muted">atespace</span>&nbsp;<span class="mono">${esc(LIVE.atespace)}</span></span>` : '';
  const listHead = `<div class="live-list-head"><h2 class="h-display-sm">Your tasks</h2><span class="llh-scope">${liveWhere(LIVE.context)}${ates}<a class="btn ghost sm" href="#/places">Change cluster</a>${list.length ? '<a class="btn ghost sm" href="#/tasks">All tasks</a>' : ''}</span>${upd}</div>`;
  const ideas = typeof FIRST_IDEAS !== 'undefined' ? `<div class="first-ideas" role="group" aria-label="Ideas to start with" style="margin-top:12px">
      <span class="fi-label">Start with an idea</span>
      ${FIRST_IDEAS.map((x) => `<button type="button" class="pill fi-idea" data-action="live-first-idea" data-goal="${esc(x.goal)}">${icon(x.ic, 'xs')}${esc(x.label)}</button>`).join('')}
    </div>` : '';
  const res = typeof liveResHTML === 'function' && !LIVE.error ? liveResHTML() : '';
  /* An ax too old for Studio comes first: it is why this computer can't be checked, and why some actions fail. */
  const axUpd = typeof liveAxUpdateHTML === 'function' ? liveAxUpdateHTML() : '';
  const body = axUpd + (!LIVE.loaded ? ''
    : list.length ? `${problem}${flow}<div id="live-tasks">${listHead}${sections}</div>${res}`
      : problem || `${listHead}<div class="card card-pad" id="live-empty" style="margin-top:10px">
            <div class="live-title">No tasks here yet</div>
            <p class="small" style="margin-top:4px;max-width:70ch">Start one above, or from the command line. Tasks on this cluster show up as soon as they're created.</p>
          ${ideas}
          <div style="margin-top:12px;display:grid;gap:8px">${cliHint(liveCmd(['apply', '-f', 'task.yaml']))}${cliHint(liveCmd(['resume', 'task', '<name>']))}</div></div>${res}`);
  const html = `
    <section class="stage" aria-labelledby="live-home-h1">
      <div class="stage-copy">
        <h1 id="live-home-h1" tabindex="-1">${callMe ? `${greeting()}, <em>${esc(callMe)}</em>.` : `${greeting()}.`}</h1>
        <p class="lede" id="live-summary">${lede}</p>
        <div class="input-group" style="margin-top:14px;max-width:560px">
          <label class="sr-only" for="live-quick-goal">Describe a goal to start a task</label>
          <input class="input" id="live-quick-goal" placeholder="What should an agent work on next?" autocomplete="off" value="${esc((LIVE.draft && LIVE.draft.goal) || '')}">
          <button type="button" class="btn" id="live-quick-go" data-action="live-quick-go">Set up task${icon('arrowRight', 'sm')}</button>
        </div>
      </div>
      <div class="stage-axo">
        <div class="stage-bubble-col"><div class="speech still" id="axel-speech" aria-live="off" ${said ? '' : 'hidden'}>${said}</div></div>
        ${springPoolHTML(heroMood, heroTone, 'hero-axo')}
      </div>
    </section>
    ${body}
    <p class="xsmall muted" style="margin-top:12px">${icon('terminal', 'xs')} The same list from the command line: <code>${esc(liveCmd(['get', 'tasks']))}</code></p>`;
    return { title: 'Your tasks', crumbs: [{ label: 'Home' }], html, wide: true };
}

/* ---------- All tasks: one searchable, filterable table (like the prototype's #/tasks) ---------- */
const LIVE_TASK_FILTERS = [['all', 'All', -1], ['needs', 'Needs you', 0], ['running', 'Running', 1], ['paused', 'Paused', 2], ['done', 'Done', 3]];
function liveTasksFilter() {
  if (!LIVE.tasksFilter) LIVE.tasksFilter = { q: '', status: 'all' };
  return LIVE.tasksFilter;
}
function liveTasksMatching(all) {
  const f = liveTasksFilter();
  const q = f.q.trim().toLowerCase();
  const entry = LIVE_TASK_FILTERS.find((x) => x[0] === f.status) || LIVE_TASK_FILTERS[0];
  return all.filter((t) => {
    if (entry[2] >= 0 && liveState(t.state).rank !== entry[2]) return false;
    if (!q) return true;
    const spec = (t.doc && t.doc.spec) || {};
    const tpl = liveTaskTemplate(spec);
    const ws = (spec.workspace && spec.workspace.name) || '';
    return `${t.goal} ${t.name} ${tpl.name} ${tpl.model || ''} ${ws} ${t.state} ${liveState(t.state).label}`.toLowerCase().includes(q);
  });
}
function liveTasksTableHTML(all) {
  const list = liveTasksMatching(all || liveSorted());
  if (!list.length) {
    const f = liveTasksFilter();
    return `<div class="tasks-empty"><b>No tasks match</b><span>${f.q.trim() ? `Nothing matches “${esc(f.q.trim())}” with these filters.` : (all || LIVE.tasks).length ? 'No tasks are in this state right now.' : 'Start a task and it shows up here.'}</span></div>`;
  }
  const where = liveIsLocal(LIVE.context) ? 'This computer' : esc(liveShortCtx(LIVE.context));
  const rows = list.map((t) => {
    const spec = (t.doc && t.doc.spec) || {};
    const tpl = liveTaskTemplate(spec);
    const ws = (spec.workspace && spec.workspace.name) || '';
    const lim = liveLimitsText(spec);
    const busy = LIVE.busy[t.name];
    const age = liveAge(t.created);
    const turn = t.turns > 1 ? `Turn ${t.turn} of ${t.turns}` : '';
    return `<tr id="live-trow-${esc(t.name)}">
      <td class="tk-title"><a href="#/task/${encodeURIComponent(t.name)}">${esc(t.goal || t.name)}</a><div class="xsmall muted"><span class="mono">${esc(t.name)}</span>${turn ? ` · ${turn}` : ''}${t.atespace !== 'default' ? ` · ${esc(t.atespace)}` : ''}</div></td>
      <td>${busy ? `<span class="chip stopping">${icon('loader')}${LIVE_VERBS[busy].doing}</span>` : liveChip(t.state)}</td>
      <td><span class="tk-agent">${tpl.tile}${esc(tpl.name)}</span></td>
      <td>${ws ? `<span class="mono">${esc(ws)}</span>` : '<span class="muted">Empty</span>'}</td>
      <td><span title="${esc(LIVE.context)}">${where}</span></td>
      <td class="tnum">${lim ? esc(lim) : '<span class="muted">Default</span>'}</td>
      <td class="muted">${age ? `${esc(age)} ago` : 'Just now'}</td></tr>`;
  }).join('');
  return `<table class="table tasks-table"><thead><tr><th>Task</th><th>Status</th><th>Template</th><th>Workspace</th><th>Where</th><th>Resources</th><th>Created</th></tr></thead><tbody>${rows}</tbody></table>`;
}
function liveViewTasks() {
  if (LIVE.loaded && (!LIVE.context || liveLocalDown())) return liveViewSetup(false);
  const all = liveSorted();
  const f = liveTasksFilter();
  const active = all.filter((t) => liveState(t.state).active).length;
  const count = (rank) => (rank < 0 ? all.length : all.filter((t) => liveState(t.state).rank === rank).length);
  const whereWords = liveIsLocal(LIVE.context) ? 'this computer' : esc(liveShortCtx(LIVE.context || 'this cluster'));
  const ates = LIVE.atespace !== 'default' ? `<span class="env" title="Atespace"><span class="muted">atespace</span>&nbsp;<span class="mono">${esc(LIVE.atespace)}</span></span>` : '';
  const upd = LIVE.refreshedAt ? `<span class="llh-upd" title="Studio asks again every few seconds">Updated <span data-live-updated data-fmt="ago" data-since="${LIVE.refreshedAt}">${fmtAgo(LIVE.refreshedAt)}</span></span><button type="button" class="btn ghost sm icon" data-action="live-refresh" aria-label="Refresh the list">${icon('refresh', 'sm')}</button>` : '';
  const kind = liveErrorKind();
  const where = esc(LIVE.context || 'this cluster');
  const problem = !LIVE.error ? ''
    : kind === 'missing' ? liveProblemHTML(`AX isn't installed on ${where}`, `Install it here or with the command below, then try again. What AX Studio got: ${LIVE.error}`, liveCmd(['install']),
      liveIsLocal(LIVE.context) ? '' : `<button class="btn primary sm" data-action="live-install" data-context="${esc(LIVE.context)}" ${liveOpRunning() ? 'disabled' : ''}>${icon('wrench', 'sm')}Install AX…</button>`)
      : kind === 'versions' ? liveProblemHTML(`AX on ${where} and AX Studio are different versions`, `They can't read each other's data. Update the older one so the two match. What AX Studio got: ${LIVE.error}`, '')
        : liveProblemHTML(`Can't reach AX on ${where}`, LIVE.error, liveCmd(['get', 'tasks']));
  const html = `
    <div class="page-head">
      <div class="live-list-head" style="margin-top:0"><h1 tabindex="-1" id="live-tasks-title" style="margin-right:0">All tasks</h1><span class="llh-scope">${liveWhere(LIVE.context)}${ates}<a class="btn ghost sm" href="#/places">Change cluster</a></span>${upd}</div>
      <p class="lede">${!LIVE.loaded ? 'Loading your tasks…' : `${plural(all.length, 'task')} on ${whereWords}. ${active ? `${plural(active, 'sandbox', 'sandboxes')} running.` : 'No sandboxes running right now.'}`}</p>
    </div>
    ${problem}
    <div class="tasks-tools">
      <label class="sr-only" for="live-tasks-q">Search tasks</label>
      <span class="tasks-search">${icon('search', 'sm')}<input class="input" id="live-tasks-q" type="search" placeholder="Search by goal, name, template or workspace" autocomplete="off" value="${esc(f.q)}"></span>
      <div class="seg" role="group" aria-label="Filter by state">${LIVE_TASK_FILTERS.map(([k, l, r]) => `<button type="button" data-action="live-tasks-filter" data-v="${k}" aria-pressed="${f.status === k}">${l}<span class="seg-n tnum">${count(r)}</span></button>`).join('')}</div>
    </div>
    <p class="sr-only" id="live-tasks-count" role="status"></p>
    <div class="card tasks-card" id="live-tasks-table">${liveTasksTableHTML(all)}</div>
    <p class="xsmall muted" style="margin-top:10px">${icon('terminal', 'xs')} The same list from the command line: <code>${esc(liveCmd(['get', 'tasks']))}</code></p>`;
  return { title: 'All tasks', crumbs: [{ label: 'Home', href: '#/' }, { label: 'All tasks' }], html, wide: true };
}
/* ---------- A task's page ----------
   The prototype's frame (style guide §4.2): the header (title, then status, template, workspace and age, and the task-level
   actions), then two columns. On the left, tabs: Activity, and for a task with debug access Changes and Terminal, then
   Task file. Switching tabs swaps only the panel. On the right, the inspector: the Next step card with Axel (the only
   Pause and Resume), where it runs (with Run on another cluster), what it can reach, and the turns of its session. */
const LIVE_TASK_TABS = [['activity', 'Activity'], ['logs', 'Logs'], ['changes', 'Changes'], ['terminal', 'Terminal'], ['file', 'Task file']];
/* What AX's conditions say, in the UI's words. */
const LIVE_COND_WORDS = {
  WorkspaceReady: (ok) => (ok ? 'set up the workspace' : 'is setting up the workspace'),
  Ready: (ok, c) => (ok ? (c.reason === 'TaskRunning' ? 'started the agent in its sandbox' : 'marked it ready')
    : c.reason === 'Suspended' ? 'paused the task' : `says it isn't ready${c.reason ? ` (${c.reason})` : ''}`),
};
/* Conditions whose message only repeats the words above in AX's own terms ("Actor is suspended"). */
const LIVE_COND_QUIET = { Ready: ['Suspended'] };
/** The template a task runs (by its image), or its own image, and the model its config names. */
function liveTaskTemplate(spec) {
  const image = (spec.profile && spec.profile.image) || '';
  const k = typeof LIVE_AGENTS !== 'undefined' ? Object.keys(LIVE_AGENTS).find((x) => LIVE_AGENTS[x].image === image) : '';
  const cfg = spec.config || {};
  const model = cfg.model || (cfg.agent && cfg.agent.model) || '';
  if (k) return { id: k, name: LIVE_AGENTS[k].name, tile: agentTile(k, 'sm'), model: model || LIVE_AGENTS[k].model };
  return { id: '', name: image ? (typeof liveImageShort === 'function' ? liveImageShort(image) : image) : 'No image', tile: byoTile('sm'), model };
}
function liveLimitsText(spec) {
  const l = (spec.profile && spec.profile.resources && spec.profile.resources.limits) || {};
  return l.cpu || l.memory ? [l.cpu && `${l.cpu} CPU`, l.memory && `${l.memory} memory`].filter(Boolean).join(' · ') : '';
}
function liveEvTime(iso) {
  const t = iso ? new Date(iso) : null;
  if (!t || isNaN(t)) return '';
  const day = Date.now() - t.getTime() > 20 * 3600 * 1000;
  return `<time datetime="${esc(t.toISOString())}">${esc(day ? t.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</time>`;
}
function liveEv(cls, iconHTML, head, body, at) {
  return `<li class="ev ${cls}"><div class="ev-icon">${iconHTML}</div><div class="ev-body"><div class="ev-head">${head}${liveEvTime(at)}</div>${body || ''}</div></li>`;
}
/** What a finished task left: its result, exit code and output, when AX has recorded them. */
function liveResultHTML(status) {
  const o = status.outcome;
  if (!o) return '';
  const result = LIVE_RESULTS[o.result] || '';
  const code = typeof o.exitCode === 'number' ? o.exitCode : result ? 0 : null;
  const why = o.status && o.status.message;
  if (!result && code == null && !o.output && !why) return '';
  return `<div id="live-result" style="margin-top:8px">${liveKV([['Result', esc(result)], ['Exit code', code == null ? '' : `<span class="mono">${esc(code)}</span>`], ['Reason', why ? esc(why) : '']])}</div>
      ${o.output ? `<pre class="manifest" style="margin-top:10px" tabindex="0" aria-label="Task output">${esc(o.output)}</pre>` : ''}`;
}
/** Activity: what AX records about the task, in order. AX doesn't stream the agent's own steps yet. */
function liveActivityEvents(name, t, stateName, spec, status, meta, tpl) {
  const out = [];
  if (t.goal) out.push({ at: meta.createTime, order: 0, html: liveEv('user', `<span class="avatar you" style="width:30px;height:30px" aria-hidden="true">${icon('user', 'xs')}</span>`, '<span class="who">You</span><span class="what">set the goal</span>', `<div class="ev-text">${esc(t.goal)}</div>`, meta.createTime) });
  else out.push({ at: meta.createTime, order: 0, html: liveEv('note', icon('plus', 'sm'), '<span class="who">AX</span><span class="what">created the task</span>', '', meta.createTime) });
  (status.conditions || []).forEach((c) => {
    const ok = c.status === 'True';
    const words = LIVE_COND_WORDS[c.type] ? LIVE_COND_WORDS[c.type](ok, c) : `${c.type}: ${c.status}${c.reason ? ` (${c.reason})` : ''}`;
    const quiet = (LIVE_COND_QUIET[c.type] || []).includes(c.reason);
    out.push({ at: c.updateTime || c.lastTransitionTime, order: 1, html: liveEv('note', icon(ok ? 'checkCircle' : quiet ? 'pause' : 'clock', 'sm'), `<span class="who">AX</span><span class="what">${esc(words)}</span>`, c.message && !quiet ? `<div class="ev-text muted">${esc(c.message)}</div>` : '', c.updateTime || c.lastTransitionTime) });
  });
  /* The workspace's own state: AX's WorkspaceReady condition doesn't say when setup failed, the Workspace does. */
  const wsDoc = typeof liveTaskWorkspace === 'function' ? liveTaskWorkspace(spec) : null;
  const wsSt = (wsDoc && wsDoc.status) || {};
  if (wsSt.phase === 'Failed') out.push({ at: (wsDoc.metadata && wsDoc.metadata.updateTime) || meta.createTime, order: 1, html: liveEv('fail', icon('xCircle', 'sm'), `<span class="who">AX</span><span class="what">couldn't set up the workspace</span>`,
    `<div class="ev-text">${esc(wsSt.lastSetupError || 'Its setup failed.')}</div><div class="ev-text muted mono">${esc(liveCmd(['describe', 'workspace', spec.workspace.name]))}</div>`, (wsDoc.metadata && wsDoc.metadata.updateTime) || meta.createTime) });
  /* AX can still call a task running after its agent's command exited: the worker's logs say when, and why. */
  const exit = typeof liveLogsAgentExit === 'function' && ['Working', 'Idle', 'RequiresAction'].includes(stateName) ? liveLogsAgentExit(name) : null;
  if (exit) out.push({ at: exit.at, order: 1, html: liveEv('fail', icon('xCircle', 'sm'), `<span class="who">${esc(tpl.name)}</span><span class="what">stopped with an error${exit.code ? ` (exit code ${esc(exit.code)})` : ''}</span>`,
    `${exit.error ? `<div class="ev-text mono">${esc(exit.error)}</div>` : ''}<div class="ev-text muted"><a href="#/task/${encodeURIComponent(name)}/logs">See what it printed in Logs</a></div>`, exit.at) });
  const detail = status.statusDetail && (status.statusDetail.detail || status.statusDetail.reason);
  if (stateName === 'Failed' && detail) out.push({ at: meta.updateTime, order: 2, html: liveEv('fail', icon('xCircle', 'sm'), '<span class="who">AX</span><span class="what">stopped the task</span>', `<div class="ev-text">${esc(detail)}</div>`, meta.updateTime) });
  const result = liveResultHTML(status);
  if (result) {
    const failed = status.outcome && status.outcome.result === 'TASK_RESULT_FAILED';
    out.push({ at: (status.outcome && status.outcome.finishTime) || meta.updateTime, order: 3, html: liveEv(failed ? 'fail' : 'done', icon(failed ? 'xCircle' : 'checkCircle', 'sm'), `<span class="who">${esc(tpl.name)}</span><span class="what">finished</span>`, result, (status.outcome && status.outcome.finishTime) || meta.updateTime) });
  }
  const ms = (x) => { const v = Date.parse(x.at || ''); return isNaN(v) ? Infinity : v; };
  return out.sort((a, b) => a.order - b.order || ms(a) - ms(b));
}
function liveActivityHTML(name, t, stateName, spec, status, meta, tpl, events) {
  const labels = Object.keys(meta.labels || {}).map((k) => `<span class="mono">${esc(k)}=${esc(meta.labels[k])}</span>`).join(' ');
  const cmd = (spec.commands && spec.commands.length ? spec.commands : status.resolvedArgv) || [];
  const created = meta.createTime ? new Date(meta.createTime) : null;
  const working = ['Working', 'Queued'].includes(stateName) && !(typeof liveLogsAgentExit === 'function' && liveLogsAgentExit(name));
  /* Only what the page doesn't show elsewhere: the state is in the header, each check is in the timeline above, and
     the workspace is in the header too. */
  const details = liveKV([
    ['Task name', `<span class="mono">${esc(name)}</span> <button class="btn ghost sm icon" data-action="copy" data-text="${esc(name)}" aria-label="Copy the task name">${icon('copy', 'sm')}</button>`],
    ['Command', cmd.length ? `<span class="mono">${esc(cmd.join(' '))}</span>` : "The image's own command"],
    ['Debug access', spec.debug ? 'On: while it runs, Changes and Terminal can look inside its sandbox' : 'Off, so there is no shell into the sandbox'],
    ['Session', spec.sessionId ? `<span class="mono">${esc(spec.sessionId)}</span>` : ''],
    /* The sandbox's names in Agent Substrate (the actor and its uid), for kubectl and the worker's logs. */
    ['Sandbox', status.actor ? `<span class="mono">${esc(status.actor)}</span>${status.actorUid ? ` <span class="muted">· uid</span> <span class="mono">${esc(status.actorUid)}</span> <button class="btn ghost sm icon" data-action="copy" data-text="${esc(status.actorUid)}" aria-label="Copy the sandbox uid">${icon('copy', 'sm')}</button>` : ''}` : ''],
    ['Previous attempt', status.previousFailure ? esc(status.previousFailure) : ''],
    ['Labels', labels],
    ['Created', created && !isNaN(created) ? esc(created.toLocaleString()) : ''],
  ]);
  return `<h2 class="sr-only">Activity</h2>
    <ol class="timeline" id="live-timeline" aria-label="Activity">${events.map((e) => e.html).join('')}</ol>
    ${working ? `<div class="working" aria-hidden="true"><span class="dots"><i></i><i></i><i></i></span>${esc(tpl.name)} is working · ${esc(liveAge(meta.createTime) || 'moments')}</div>` : ''}
    <p class="xsmall muted" style="margin-top:12px" id="live-task-note">${spec.debug
      ? `These are the steps AX records. What the agent printed is in <a href="#/task/${encodeURIComponent(name)}/logs">Logs</a>.`
      : `This task was started without debug access, so its sandbox stays closed. What it printed is in <a href="#/task/${encodeURIComponent(name)}/logs">Logs</a>; review its result here, and the branch or pull request it pushes.`}</p>
    <section class="live-details" aria-labelledby="live-details"><h2 id="live-details" class="panel-title">Details</h2><div style="margin-top:10px">${details}</div>
      ${(status.conditions || []).length ? `<details class="disclosure" style="margin-top:10px"><summary>${icon('chevRight', 'sm chev')}AX's conditions, as recorded (${status.conditions.length})</summary><div class="disclosure-body">
        <table class="cond-table"><thead><tr><th scope="col">Type</th><th scope="col">Status</th><th scope="col">Reason</th><th scope="col">Message</th><th scope="col">Updated</th></tr></thead>
        <tbody>${status.conditions.map((c) => `<tr><td class="mono">${esc(c.type || '')}</td><td>${esc(c.status || '')}</td><td class="mono">${esc(c.reason || '')}</td><td>${esc(c.message || '')}</td><td>${liveEvTime(c.updateTime || c.lastTransitionTime) || ''}</td></tr>`).join('')}</tbody></table></div></details>` : ''}</section>`;
}
function liveTaskFileHTML(name, det) {
  if (!det || !det.yaml) return `<p class="small muted">${icon('loader', 'xs')} Reading the task file…</p>`;
  return `<section aria-labelledby="live-file-h"><h2 id="live-file-h" class="sr-only">Task file</h2>
      <div class="log-bar"><span class="lb-text">What AX stores for this task, as <span class="mono">ax get task</span> prints it.</span><span class="lb-actions"><button class="btn ghost sm" data-action="copy" data-text="${esc(det.yaml)}">${icon('copy', 'sm')}Copy</button></span></div>
      <pre class="manifest" tabindex="0" aria-label="Task file">${esc(det.yaml)}</pre>
      <p class="xsmall muted" style="margin-top:10px">${icon('terminal', 'xs')} <code>${esc(liveCmd(['get', 'task', name]))}</code></p></section>`;
}
function liveTaskHeadHTML(name, t, stateName, spec, meta, tpl, busy) {
  const title = t.goal ? t.goal.split('\n')[0].slice(0, 140) : name;
  const ws = spec.workspace && spec.workspace.name;
  const wsDoc = typeof liveTaskWorkspace === 'function' ? liveTaskWorkspace(spec) : null;
  const wsFailed = !!(wsDoc && wsDoc.status && wsDoc.status.phase === 'Failed');
  const age = liveAge(meta.createTime);
  return `<div class="task-head">
      <div class="th-main">
        <h1 tabindex="-1" id="task-title">${esc(title)}</h1>
        <div class="th-meta">
          ${busy ? `<span class="chip stopping">${icon('loader')}${LIVE_VERBS[busy].doing}</span>` : liveChip(stateName)}
          <span class="env">${tpl.tile}${esc(tpl.name)}${tpl.model ? ` <span class="muted xsmall mono">${esc(tpl.model)}</span>` : ''}</span>
          <span class="env${ws ? ' mono' : ''}${wsFailed ? ' env-bad' : ''}" title="${wsFailed ? 'Workspace setup failed' : 'Workspace'}">${icon(wsFailed ? 'alert' : 'folder')}${ws ? esc(ws) : 'Empty <span class="mono">/workspace</span>'}</span>
          <span class="env">${icon('clock')}${age ? `Created ${esc(age)} ago` : 'Just created'}</span>
        </div>
      </div>
      <div class="btn-row"><button type="button" class="btn ghost icon" data-action="live-copy-link" aria-label="Copy a link to this task" title="Copy a link to this task">${icon('link', 'sm')}</button><a class="btn" href="#/new?from=${encodeURIComponent(name)}" id="live-follow">Send a follow-up</a><button class="btn danger" data-action="live-delete" data-task="${esc(name)}" ${busy ? 'disabled' : ''}>Delete…</button></div>
    </div>`;
}
/** The sites a Gateway lets a task reach, and the keys it adds on the way out. */
function liveGatewayRules(doc) {
  const hosts = [], keys = [];
  ((doc && doc.spec && doc.spec.egress) || []).forEach((rule) => {
    const r = rule.https || rule.http || rule.tlsPassthrough || {};
    const names = r.hostnames || [];
    names.forEach((h) => { if (!hosts.includes(h)) hosts.push(h); });
    ((r.effects && r.effects.replaceHeaders) || []).forEach((x) => keys.push({ hosts: names, header: x.header || '' }));
  });
  return { hosts, keys };
}
/** What it can reach, in the task's inspector: the sites its Gateway allows, and where its keys are added. */
function liveReachHTML(gw) {
  const head = (label) => `<h2 class="panel-title" id="live-ns-guard">What it can reach${label ? ` · ${esc(label)}` : ''}</h2>`;
  const map = (allowed, blocked) => (typeof gateMap === 'function' ? `<div class="reach-map">${gateMap(allowed, blocked, 4)}</div>` : '');
  if (!gw) return `${head('Nothing')}${map([], [{ domain: 'All outbound network' }])}<p class="small muted" style="margin-top:6px">It has no Gateway, so it can't reach the network.</p>`;
  const entry = LIVE.gateways[gw];
  const from = `<p class="xsmall muted" style="margin-top:10px">From Gateway <span class="mono">${esc(gw)}</span>. A task keeps the rules it started with.</p>`;
  if (!entry) return `${head('')}<p class="small muted" style="margin-top:8px">${icon('loader', 'xs')} Reading Gateway <span class="mono">${esc(gw)}</span>…</p>`;
  if (!entry.doc) {
    return `${head('')}<p class="small muted" style="margin-top:8px">${entry.missing
      ? `Gateway <span class="mono">${esc(gw)}</span> is gone. The task keeps the rules it started with.`
      : `Outbound traffic goes through Gateway <span class="mono">${esc(gw)}</span>. Studio couldn't read its rules: ${esc(entry.error)}`}</p>`;
  }
  const { hosts, keys } = liveGatewayRules(entry.doc);
  const balanced = typeof LIVE_BALANCED_HOSTS !== 'undefined' && LIVE_BALANCED_HOSTS.every((h) => hosts.includes(h));
  const label = !hosts.length ? 'Nothing' : balanced ? 'Balanced' : plural(hosts.length, 'site');
  const fact = (ic, html) => `<li class="fact">${icon(ic, 'sm')}<span>${html}</span></li>`;
  const keyFacts = keys.map((k) => {
    const A = typeof LIVE_AGENTS !== 'undefined' ? Object.values(LIVE_AGENTS).find((a) => k.hosts.includes(a.host)) : null;
    return fact('key', `${A ? `${esc(A.keyFrom)} API key` : `A key in <span class="mono">${esc(k.header)}</span>`}, added outside the sandbox`);
  });
  const facts = keyFacts.concat([fact('shield', hosts.length ? 'Every other site is blocked' : 'Every site is blocked')]);
  return `${head(label)}${map(hosts, hosts.length ? [] : [{ domain: 'All outbound network' }])}<ul class="facts one-col reach-facts">${facts.join('')}</ul>${from}`;
}
function liveTaskSideHTML(name, t, stateName, spec, status, busy) {
  const detail = status.statusDetail && (status.statusDetail.detail || status.statusDetail.reason);
  const canPause = ['Working', 'Queued', 'Idle', 'RequiresAction'].includes(stateName);
  const canResume = stateName === 'Suspended';
  /* The agent's command exited with an error while AX still calls the task running: that's what needs you. */
  const exited = ['Working', 'Idle'].includes(stateName) && typeof liveLogsAgentExit === 'function' ? liveLogsAgentExit(name) : null;
  const nsTone = stateName === 'Failed' ? 'fail' : stateName === 'RequiresAction' || exited ? 'attn' : stateName === 'Completed' ? 'done' : stateName === 'Suspended' ? 'paused' : 'calm';
  const nsTitle = exited ? 'The agent stopped with an error'
    : stateName === 'Failed' ? 'Stopped with an error'
    : stateName === 'RequiresAction' ? 'Waiting for you'
      : stateName === 'Completed' ? 'Finished'
        : stateName === 'Suspended' ? 'Paused'
          : 'Working in its sandbox';
  const tab = (k, label) => `<a href="#/task/${encodeURIComponent(name)}/${k}">${label}</a>`;
  /* When AX says why it stopped, the next step can say what to change. */
  const remedy = /out of memory|oom/i.test(detail || '') ? ' Pick a larger size under More options when you try again.' : '';
  const nsBody = (exited ? `Its command exited${exited.time ? ` at ${esc(exited.time)}` : ''}, though AX still shows the task as running. Fix what it hit, then send a follow-up or try again.`
    : stateName === 'Failed' ? (detail ? esc(detail) + remedy : `${tab('logs', 'Logs')} has what the agent printed. Try again to start a new turn in the same session.`)
    : stateName === 'Suspended' ? "Its gVisor sandbox is checkpointed and nothing is running. Resume when you're ready."
      : stateName === 'Completed' ? 'Review the result in Activity, or send a follow-up to continue in the same session.'
        : spec.debug ? `Look at what it changed in ${tab('changes', 'Changes')}, or open a shell in ${tab('terminal', 'Terminal')}. Pause anytime.`
          : 'Running inside an isolated gVisor sandbox. Pause anytime, or send a follow-up in the same session.')
    /* What AX says about the state, when it says something and the state isn't already explained by it. */
    + (detail && stateName !== 'Failed' ? ` <span class="ns-detail">AX says: ${esc(detail)}</span>` : '')
    /* The agent can stop with an error while AX still calls the task running: its logs say so. */
    + (typeof liveLogsNextHTML === 'function' && stateName !== 'Completed' ? liveLogsNextHTML(name) : '');
  /* A failed task can't be resumed; trying again is a new turn in its session, with the same goal to start from. */
  const tryAgain = `<a class="btn primary sm" id="live-try-again" href="#/new?from=${encodeURIComponent(name)}&amp;again=1">${icon('undo', 'sm')}Try again</a>`;
  const pauseBtn = `<button class="btn sm" data-action="live-suspend" data-task="${esc(name)}" ${busy ? 'disabled' : ''}>${icon(busy ? 'loader' : 'pause', 'sm')}${busy ? LIVE_VERBS[busy].doing + '…' : 'Pause'}</button>`;
  const btn = canResume ? `<button class="btn primary sm" data-action="live-resume" data-task="${esc(name)}" ${busy ? 'disabled' : ''}>${icon(busy ? 'loader' : 'play', 'sm')}${busy ? LIVE_VERBS[busy].doing + '…' : 'Resume'}</button>`
    /* Its agent stopped: try again, or pause the sandbox it left running. */
    : exited && canPause ? tryAgain + pauseBtn
      : canPause ? pauseBtn
        : stateName === 'Failed' ? tryAgain : '';
  const next = `<section class="card card-pad next-card s-${nsTone}" id="next-step" data-tone="${nsTone}" aria-labelledby="ns-k">
      <span class="ns-axel" aria-hidden="true">${axo(liveAxoMood(stateName), { decorative: true, cls: 'axo-ns' }).replace('<svg ', '<svg data-follow ')}</span>
      <h2 class="panel-title" id="ns-k">${nsTone === 'attn' || nsTone === 'fail' ? '<span class="ns-dot" aria-hidden="true"></span>Your next step' : 'Next'}</h2>
      <p class="ns-title">${nsTitle}</p><p class="ns-body">${nsBody}</p>
      ${btn ? `<div class="btn-row" style="margin-top:12px">${btn}</div>` : ''}
    </section>`;
  const local = liveIsLocal(LIVE.context);
  const limits = liveLimitsText(spec);
  const where = `<div class="card card-pad" id="live-where-card"><h2 class="panel-title">Where it runs</h2>
      <div class="where"><div><b>${local ? 'On this computer' : 'On a remote cluster'}</b><span>${local ? `gVisor sandbox on ${esc(LIVE.context)}` : `${esc(LIVE.context)} · keeps running with your laptop closed`}</span></div></div>
      <dl class="kv xsmall" style="margin-top:12px">${spec.profile && spec.profile.image ? `<dt>Image</dt><dd><span class="img-short"><span class="mono" title="${esc(spec.profile.image)}">${esc(typeof liveImageShort === 'function' ? liveImageShort(spec.profile.image) : spec.profile.image)}</span><button class="btn ghost sm icon" data-action="copy" data-text="${esc(spec.profile.image)}" aria-label="Copy the image address">${icon('copy', 'sm')}</button></span></dd>` : ''}${limits ? `<dt>Limits</dt><dd>${esc(limits)}</dd>` : ''}${status.attempt ? `<dt>Attempt</dt><dd>${esc(status.attempt)}</dd>` : ''}</dl>
      <button class="btn sm" style="margin-top:12px;width:100%" data-action="live-promote" data-task="${esc(name)}" ${busy ? 'disabled' : ''}>${icon('cloudUp', 'sm')}Run on another cluster…</button>
    </div>`;
  const gw = spec.gateway && spec.gateway.name;
  const reach = `<div class="card card-pad" id="live-ns-guard-card">${liveReachHTML(gw)}</div>`;
  const turns = t.session ? LIVE.tasks.filter((x) => x.session === t.session).sort((a, b) => String(a.created).localeCompare(String(b.created)) || a.name.localeCompare(b.name)) : [];
  const session = turns.length > 1 ? `<div class="card card-pad" id="live-session-card"><h2 class="panel-title">Session · ${plural(turns.length, 'turn')}</h2>
      <ol class="rail-list live-turns">${turns.map((x, i) => `<li>${x.name === name ? `<b>Turn ${i + 1}</b><span class="muted">· this task</span>` : `<a href="#/task/${encodeURIComponent(x.name)}">Turn ${i + 1}</a><span class="muted lt-goal">· ${esc((x.goal || x.name).split('\n')[0])}</span>`}<span class="r-val">${liveChip(x.state)}</span></li>`).join('')}</ol></div>` : '';
  return next + where + reach + session;
}
function liveViewTask(name, tab) {
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
  if (row) { t.session = row.session || t.session; }
  const spec = (t.doc && t.doc.spec) || {}, status = (t.doc && t.doc.status) || {}, meta = (t.doc && t.doc.metadata) || {};
  const stateName = row ? row.state : t.state;
  const busy = LIVE.busy[name];
  const tpl = liveTaskTemplate(spec);
  const tabs = LIVE_TASK_TABS.filter(([k]) => spec.debug || (k !== 'changes' && k !== 'terminal'));
  tab = tabs.some(([k]) => k === tab) ? tab : 'activity';
  /* Changes is read as soon as the page opens, so its tab can say how many files changed. */
  if (spec.debug && typeof liveChangesWanted === 'function') liveChangesWanted(name, stateName);
  /* The logs are read as the page opens too, so the Logs tab and the Next card can say when the agent logged an error. */
  if (typeof liveLogsWanted === 'function') liveLogsWanted(name);
  if (spec.workspace && spec.workspace.name && typeof liveResWanted === 'function') liveResWanted();
  const logErr = typeof liveLogsError === 'function' && !!liveLogsError(name);
  const changed = typeof liveChangesCount === 'function' ? liveChangesCount(name) : 0;
  const events = liveActivityEvents(name, t, stateName, spec, status, meta, tpl);
  const panel = tab === 'logs' ? liveLogsHTML(name, t, stateName)
    : tab === 'changes' ? liveChangesHTML(name, t, stateName)
    : tab === 'terminal' ? liveTermHTML(name, t, stateName)
      : tab === 'file' ? liveTaskFileHTML(name, det)
        : liveActivityHTML(name, t, stateName, spec, status, meta, tpl, events);
  const html = `
    <div id="task-head">${liveTaskHeadHTML(name, t, stateName, spec, meta, tpl, busy)}</div>
    ${det && det.error && !det.missing ? liveProblemHTML(`Couldn't read ${esc(name)}`, det.error, liveCmd(['get', 'task', name])) : ''}
    <div class="task-grid">
      <div style="min-width:0">
        <div class="tabs-bar">
          <div class="seg task-tabs" role="tablist" aria-label="Task views">
            ${tabs.map(([k, l]) => `<a role="tab" id="tab-${k}" href="#/task/${encodeURIComponent(name)}${k === 'activity' ? '' : '/' + k}" aria-selected="${tab === k}"${tab === k ? ` aria-controls="panel-${k}"` : ''} tabindex="${tab === k ? 0 : -1}">${l}${k === 'changes' ? `<span class="count" id="count-changes" ${changed ? '' : 'hidden'}>${changed || ''}</span>` : ''}${k === 'logs' ? `<span class="tab-dot" id="dot-logs" ${logErr ? '' : 'hidden'}><span class="sr-only">, has an error</span></span>` : ''}</a>`).join('')}
          </div>
          <div class="tabs-tools"><span class="xsmall muted tt-meta">${tab === 'logs' ? 'From the Agent Substrate worker' : `${plural(events.length, 'event')} · recorded by AX`}</span></div>
        </div>
        <div role="tabpanel" class="task-panel" id="panel-${tab}" aria-labelledby="tab-${tab}" tabindex="0">${panel}</div>
      </div>
      <aside class="side" id="live-task-side" aria-label="Task details">${liveTaskSideHTML(name, t, stateName, spec, status, busy)}</aside>
    </div>`;
  return { title: t.goal ? t.goal.split('\n')[0].slice(0, 60) : name, crumbs, html, wide: true };
}
const LIVE_HIDDEN = { guardrails: 'Guardrails', welcome: 'Setup', cuj: 'This page', review: 'This page', get: 'This page' };
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
        <a href="#/settings" data-nav="settings" id="nav-settings">${icon('sliders')}<span class="label">Settings</span></a>
      </nav>
      <div class="nav nav-tasks" role="navigation" aria-label="Tasks"><div class="nav-label">Tasks<a class="nav-all" href="#/tasks" data-nav="tasks">See all</a></div><div id="live-nav-tasks"></div></div>
      <div class="sidebar-foot" id="live-foot"></div>
    </aside>
    <div class="main">
      <div class="sanctuary-atmo" aria-hidden="true"></div>
      <header class="topbar">
        <div class="tb-left"><nav class="crumbs" aria-label="Breadcrumb" id="crumbs"></nav></div>
        <div class="topbar-actions">${STUDIO.classic ? `<a class="btn ghost sm" id="live-classic" href="${esc(STUDIO.classic)}" title="The terminal and Guardrails are still in the previous pages">Previous pages</a>` : ''}
          <button class="search-trigger" data-action="palette" id="search-trigger" aria-label="Search or run a command (${MOD}K)">${icon('search', 'sm')}<span class="st-label">Search or run a command</span><span class="kbds" aria-hidden="true"><kbd>${MOD}</kbd><kbd>K</kbd></span></button>
          <button class="round-btn" id="theme-toggle" data-action="theme-toggle"></button>
          <button class="round-btn" id="shortcuts-btn" data-action="shortcuts" aria-label="Keyboard shortcuts">${icon('keyboard')}</button></div>
      </header>
      <main id="main" tabindex="-1"></main>
    </div>
  </div>`;
}
function liveFootStatus() {
  /* An operation counts here when it is on the cluster in use: AX on this computer, or the remote one it installs on. */
  const op = LIVE.op;
  const remoteOp = !!op && (op.action === 'remote-install' || op.action === 'remote-uninstall');
  const opHere = liveOpRunning() && (remoteOp ? op.target === LIVE.context : liveOpIsLocal(op) && (!LIVE.context || liveIsLocal(LIVE.context)));
  const setup = opHere || !LIVE.context || liveLocalDown();
  const bad = LIVE.phase !== 'ready' || !!LIVE.error || setup || (!!LIVE.axUpdate && liveIsLocal(LIVE.context));
  const title = LIVE.phase === 'offline' ? 'Not connected' : !LIVE.context ? 'No cluster yet' : liveIsLocal(LIVE.context) ? 'This computer' : liveShortCtx(LIVE.context);
  const sub = LIVE.phase === 'starting' ? 'Connecting…' : LIVE.phase === 'offline' ? "AX Studio isn't answering"
    : opHere ? `${typeof liveOpShort === 'function' ? liveOpShort(op) : 'Working'}…` : !LIVE.context ? (LIVE.axUpdate ? 'Update ax to start' : 'Set up AX to start') : liveLocalDown() ? (LIVE.local.state === 'Stopped' ? 'AX is stopped' : 'AX is not set up')
      : LIVE.error ? (LIVE.axUpdate && liveIsLocal(LIVE.context) ? 'Update ax' : LIVE_ERROR_WORDS[liveErrorKind()].foot)
        : `Connected · ${plural(LIVE.tasks.filter((t) => liveState(t.state).active).length, 'running', 'running')}${LIVE.axUpdate && liveIsLocal(LIVE.context) ? ' · Update ax' : ''}`;
  return { bad, title, sub };
}
function liveChrome(top) {
  $$('.nav a[data-nav]').forEach((a) => { if (a.dataset.nav === top) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  const app = $('.app.live');
  if (app && app.classList && typeof liveCompact === 'function') app.classList.toggle('live-compact', liveCompact());
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
  /* The browser tab starts with how many tasks need you, so you notice from another tab (style guide v11). */
  if (state.docTitle) document.title = (n ? `(${n}) ` : '') + state.docTitle;
  const foot = $('#live-foot');
  if (foot) {
    if (typeof liveCtxSwitchHTML === 'function') foot.innerHTML = liveCtxSwitchHTML();
    else {
      const { bad, title, sub } = liveFootStatus();
      foot.innerHTML = `<a class="health-card ${bad ? 'attn' : ''}" href="#/places" id="live-health" aria-label="${esc(title)}: ${esc(sub)}. Open Where agents run.">${icon(!LIVE.context || liveIsLocal(LIVE.context) ? 'laptop' : 'cloud')}<span class="hc-text"><span class="hc-title">${esc(title)}</span><span class="hc-sub">${esc(sub)}</span></span></a>`;
    }
  }
}
function liveRender(opts) {
  opts = opts || {};
  liveStart();
  const r = parseRoute();
  state.route = r;
  if (!opts.keepScroll) closeDialog(true);
  const root = $('#root');
  const moved = r.path !== LIVE.lastPath;
  /* A form you are typing in isn't redrawn because a task changed state somewhere: only the sidebar is. (Only once the
     form is on screen: opened straight at #/new, the page still has to replace "Connecting…" with the form.) When what
     the form shows from the cluster changed (it loaded after the form did, or AX stopped), the form is drawn again; while
     you type in it, only where it runs and the plan are. */
  if (opts.background && !moved && r.parts[0] === 'new' && LIVE.phase === 'ready' && $('.app.live', root) && $('#live-new-run')) {
    const d = LIVE.draft;
    const stale = !!d && !d.raw && d.envSig !== liveNewEnvSig();
    if (!stale) { liveChrome(''); return; }
    if (isTypingIn('#main')) { liveNewEnvRefresh(d); liveChrome(''); return; }
  }
  if (opts.background && !moved && r.parts[0] === 'tasks' && LIVE.phase === 'ready' && $('.app.live', root) && isTypingIn('#main')) {
    const tbl = $('#live-tasks-table'); if (tbl) tbl.innerHTML = liveTasksTableHTML();
    liveChrome('tasks');
    return;
  }
  let v, top = 'home';
  if (LIVE.phase === 'starting') v = liveViewStarting();
  else if (LIVE.phase === 'offline') v = liveViewOffline();
  else if (!r.parts[0]) v = liveViewHome();
  else if (r.parts[0] === 'tasks') { v = liveViewTasks(); top = 'tasks'; }
  else if (r.parts[0] === 'task') v = liveViewTask(decodeURIComponent(r.parts[1] || ''), r.parts[2]);
  else if (r.parts[0] === 'places') { v = liveViewPlaces(); top = 'places'; }
  else if (r.parts[0] === 'setup') { v = liveViewSetup(false); top = 'places'; }
  else if (r.parts[0] === 'new') { v = liveViewNew(); top = ''; }
  else if (r.parts[0] === 'settings') { v = liveViewSettings(r.parts[1]); top = 'settings'; }
  else { v = liveViewNotYet(r.parts[0]); top = ''; }
  if (!$('.app.live', root)) root.innerHTML = liveShellHTML();
  const fk = focusKeyOf(document.activeElement);
  /* Switching tabs on one task swaps only the panel: the page stays where it is, focus stays on the tab, and Axel in
     the Next step card keeps moving (style guide §4.2). */
  const prev = (LIVE.lastPath || '').split('/').filter(Boolean);
  const tabSwitch = moved && LIVE.lastPath !== null && r.parts[0] === 'task' && prev[0] === 'task' && prev[1] === r.parts[1];
  /* The setup output and Axel's animation keep their place while the page redraws around them. */
  const oldAx = !moved || tabSwitch ? $('#main svg.axo') : null;
  const log = $('#live-op-log');
  const logAt = log ? { top: log.scrollTop, stuck: log.scrollTop + log.clientHeight >= log.scrollHeight - 24 } : null;
  $('#main').innerHTML = `<div class="content ${v.wide ? 'wide' : ''} ${moved && !opts.keepScroll && !tabSwitch ? 'view-enter' : ''}">${v.html}</div>`;
  if (oldAx && typeof keepAxel === 'function') keepAxel(oldAx, $('#main'));
  const log2 = $('#live-op-log');
  if (log2) log2.scrollTop = !logAt || logAt.stuck ? log2.scrollHeight : logAt.top;
  renderCrumbs(v.crumbs || []);
  state.docTitle = v.title + ' · AX Studio';
  liveChrome(top);
  updateThemeToggle();
  if (moved && !tabSwitch) {
    /* A new page starts at the top, with focus on its heading. A task you just opened loads its details right away. */
    if (LIVE.lastPath !== null) { window.scrollTo(0, 0); const h = $('#main h1'); if (h) h.focus({ preventScroll: true }); }
    LIVE.lastPath = r.path;
    if (LIVE.phase === 'ready' && ['task', 'places', 'setup'].includes(r.parts[0])) { LIVE.failedAt = 0; liveRefresh(true); }
  } else {
    LIVE.lastPath = r.path;
    restoreFocus(fk);
  }
  /* A page can finish its own job once it is on screen (Settings moves focus to the section you switched to). */
  if (typeof v.after === 'function') v.after();
}

function livePaletteItems() {
  const r = parseRoute();
  const items = [];
  const go = (h) => () => { location.hash = h; };
  items.push(
    { group: 'Go to', label: 'New task', icon: 'plus', cli: liveCmd(['apply', '-f', 'task.yaml']), run: go('#/new'), keys: 'N' },
    { group: 'Go to', label: 'Home (Your tasks)', icon: 'inbox', cli: liveCmd(['get', 'tasks']), run: go('#/') },
    { group: 'Go to', label: 'All tasks', icon: 'layers', cli: liveCmd(['get', 'tasks']), run: go('#/tasks') },
    { group: 'Go to', label: 'Where agents run', icon: 'server', cli: 'ax local status', run: go('#/places') },
    { group: 'Go to', label: 'Settings', icon: 'sliders', cli: '', run: go('#/settings') },
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
      items.push({ group: 'This task', label: 'Open shell in sandbox', icon: 'terminal', cli: liveCmd(['ssh', name]), run: () => { location.hash = `#/task/${encodeURIComponent(name)}/terminal`; liveTermOpen(name); } });
    }
    items.push(
      { group: 'This task', label: 'Send a follow-up', icon: 'message', cli: liveCmd(['apply', '-f', 'task.yaml']), run: go(`#/new?from=${encodeURIComponent(name)}`) },
      { group: 'This task', label: 'Run on another cluster…', icon: 'cloudUp', cli: liveCmd(['promote', 'task', name]), run: () => liveOpenPromote(name) },
      { group: 'This task', label: 'Delete task…', icon: 'trash', cli: liveCmd(['delete', 'task', name]), run: () => liveOpenDelete(name) },
    );
  }
  LIVE.contexts.forEach((c) => {
    if (c.name !== LIVE.context) {
      /* Connecting is Studio's own choice: the command names the cluster, and the kubeconfig stays as it is. */
      items.push({ group: 'Clusters', label: `Connect to ${c.name}`, icon: liveIsLocal(c.name) ? 'laptop' : 'cloud', cli: `ax --context ${c.name} get tasks`, run: () => LIVE_ACTIONS['live-use-context']({ dataset: { context: c.name } }) });
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
    { group: 'Studio', label: 'Diagnostics (secrets removed)…', icon: 'doctor', cli: '', run: () => liveOpenDiagnostics() },
    { group: 'Studio', label: 'Copy a link to this page', icon: 'link', cli: '', run: () => LIVE_NAV_ACTIONS['live-copy-link']() },
  );
  return items;
}

if (LIVE.on) {
  document.addEventListener('keydown', (e) => {
    const el = e.target;
    if (el && el.id === 'live-term-in' && el.dataset && el.dataset.termTask) {
      const name = el.dataset.termTask;
      const set = liveTermSet(name);
      if (e.key === 'Enter') { e.preventDefault(); liveTermSend(name); return; }
      /* Up and Down go through the commands run in this sandbox, newest first. */
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && set.history.length) {
        e.preventDefault();
        set.hpos = e.key === 'ArrowUp' ? (set.hpos < 0 ? set.history.length - 1 : Math.max(0, set.hpos - 1)) : (set.hpos < 0 ? -1 : set.hpos + 1);
        if (set.hpos >= set.history.length) set.hpos = -1;
        el.value = set.hpos < 0 ? '' : set.history[set.hpos];
        return;
      }
      if (e.ctrlKey && !e.metaKey && !e.altKey) {
        const k = String(e.key).toLowerCase();
        if (k === 'c' && !(window.getSelection && String(window.getSelection()))) { e.preventDefault(); liveTermInterrupt(name); return; }
        if (k === 'd' && !el.value) { e.preventDefault(); liveTermEOF(name); return; }
        if (k === 'l') { e.preventDefault(); liveTermOf(name).out = ''; liveTermPaint(name); const i = $('#live-term-in'); if (i) i.focus({ preventScroll: true }); return; }
      }
      return;
    }
    if (e.key === 'Enter' && el && el.id === 'live-quick-goal') {
      e.preventDefault();
      LIVE_ACTIONS['live-quick-go']();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && el && el.id === 'live-new-goal') {
      /* Ctrl/⌘ ↵ in the goal box runs the task, as the hint under it says. */
      e.preventDefault();
      liveNewRun();
    }
  });
  document.addEventListener('input', (e) => {
    if (!e.target || e.target.id !== 'live-tasks-q') return;
    liveTasksFilter().q = e.target.value;
    const all = liveSorted();
    const tbl = $('#live-tasks-table'); if (tbl) tbl.innerHTML = liveTasksTableHTML(all);
    const cnt = $('#live-tasks-count'); if (cnt) cnt.textContent = plural(liveTasksMatching(all).length, 'task');
  });
}
