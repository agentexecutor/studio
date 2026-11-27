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
   AX, and every page that has no real source yet stays hidden. In a plain browser there is no server, so the page says
   how to start it and nothing here is used. api.js is the way to the server.

   Studio works with AX on this computer only: the local cluster `ax local` sets up (ax-local). Real today:
   - setting up, starting, updating, stopping and removing AX on this computer (live-env.js)
   - the task list, each task's state, and a task's details and YAML
   - what a task's sandbox printed, from Agent Substrate's workers (live-logs.js)
   - for a task with debug access, a shell in its sandbox (the Terminal, below)
   - suspend, resume and delete
   - the workspaces and Gateways on the cluster, and deleting the ones no task uses (live-resources.js)
   - starting a task (live-new.js)
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
  env: null,             // what the server last said about this computer and your kubeconfig
  envError: '',
  envAt: 0,
  checks: [],            // { id, label, status: ok | warn | fail, detail, command }: what AX on this computer needs
  tools: [],             // { name, version, status: ok | warn | fail | none, detail }: ax, kubectl and kind
  axFlags: {},           // which optional flags this ax takes ({ runnerVolumeImage })
  canStartLocal: false,
  local: null,           // { name, state: NotFound | Stopped | Running, context, substrate, server }
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

/* AX's task states in the UI's words. `chip` is the status style the rest of the app uses; `rank` sorts the list:
   what needs you first, then what's working, then the rest. */
const LIVE_STATES = {
  RequiresAction: { label: 'Waiting for you', chip: 'waiting', icon: 'hand', rank: 0 },
  Failed: { label: 'Failed', chip: 'failed', icon: 'xCircle', rank: 0 },
  Working: { label: 'Running', chip: 'running', icon: 'loader', rank: 1, active: true },
  Queued: { label: 'Starting', chip: 'starting', icon: 'loader', rank: 1, active: true },
  Suspending: { label: 'Suspending', chip: 'stopping', icon: 'loader', rank: 1, active: true },
  Terminating: { label: 'Deleting', chip: 'stopping', icon: 'loader', rank: 1, active: true },
  Suspended: { label: 'Suspended', chip: 'paused', icon: 'pause', rank: 2 },
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
/** Lists and starts tasks in another atespace. It is Studio's own choice, kept in this browser. */
function liveUseAtespace(name) {
  name = String(name || '').trim() || 'default';
  if (name === LIVE.atespace) return;
  LIVE.atespace = name;
  try { if (name === 'default') localStorage.removeItem(LIVE_ATESPACE_KEY); else localStorage.setItem(LIVE_ATESPACE_KEY, name); } catch (e) { /* ignore */ }
  LIVE.tasks = []; LIVE.detail = {}; LIVE.gateways = {}; LIVE.logs = {}; LIVE.error = ''; LIVE.errorCode = ''; LIVE.failedAt = 0; LIVE.loaded = false;
  if (LIVE.res) LIVE.res.ctx = null;
  LIVE.needsKnown = null;
}

/* ---------- Loading ---------- */
function liveRouteTask() { const r = parseRoute(); return r.parts[0] === 'task' && r.parts[1] ? decodeURIComponent(r.parts[1]) : ''; }
function liveSnapshot() {
  const cur = liveRouteTask();
  return JSON.stringify([LIVE.phase, LIVE.tasks.map((t) => [t.name, t.state, t.goal, t.created]), LIVE.error, LIVE.contexts, LIVE.envError, LIVE.local, LIVE.checks, LIVE.tools,
    LIVE.context, LIVE.busy, LIVE.loaded, LIVE.axError, LIVE.op && [LIVE.op.id, LIVE.op.status], cur && LIVE.detail[cur], cur && LIVE.gateways]);
}
async function liveStart() {
  if (!LIVE.on || LIVE.started) return;
  LIVE.started = true;
  Object.assign(ACTIONS, LIVE_ACTIONS, LIVE_ENV_ACTIONS, LIVE_NEW_ACTIONS, LIVE_LOGS_ACTIONS, LIVE_RES_ACTIONS, LIVE_NAV_ACTIONS);
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
  /* Show this computer now: the first answer from the cluster can take a while when it's starting. */
  render({ keepScroll: true, background: true });
  /* A link can name the atespace to open on. */
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
/** This computer and AX on it. fresh asks for the tools' versions again (Check again). */
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
/* Studio talks to AX on this computer only: the context `ax local` names (ax-local), whatever your kubeconfig's
   current context is. Before setup there's none yet, so pages show setup. */
function liveChooseContext() {
  const L = LIVE.local || {};
  const local = LIVE.contexts.find((c) => c.isLocal);
  const name = L.context || (local && local.name) || '';
  if (name !== LIVE.context) liveUseContext(name);
}
function liveUseContext(name) {
  LIVE.context = name;
  LIVE.tasks = []; LIVE.detail = {}; LIVE.gateways = {}; LIVE.logs = {}; LIVE.error = ''; LIVE.errorCode = ''; LIVE.failedAt = 0; LIVE.loaded = false;
  if (LIVE.res) LIVE.res.ctx = null;
  LIVE.needsKnown = null;
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
  suspend: { doing: 'Suspending', done: 'Suspended', fail: "Couldn't suspend" },
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
    if (verb === 'delete') { delete LIVE.detail[name]; delete LIVE.logs[name]; LIVE.tasks = LIVE.tasks.filter((t) => t.name !== name); if (liveRouteTask() === name) location.hash = '#/'; }
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
  /* What the task uses, by kind: Kept names only these, so a task with no model never reads "Its model". */
  const t = LIVE.tasks.find((x) => x.name === name) || (LIVE.detail[name] && LIVE.detail[name].doc ? { doc: LIVE.detail[name].doc } : null);
  const sp = (t && t.doc && t.doc.spec) || {};
  const uses = [['workspace', 'workspace'], ['gateway', 'Gateway'], ['model', 'model']].filter(([k]) => sp[k] && sp[k].name).map(([k, word]) => ({ kind: k, word, name: sp[k].name }));
  const keptList = () => uses.filter((u) => !pick[`${u.kind}/${u.name}`]).map((u) => `${u.word} <span class="mono">${esc(u.name)}</span>`);
  const keptWords = () => { const kept = keptList(); return kept.length ? `Its ${kept.join(' and ')}, for other tasks to use` : ''; };
  const keptRow = () => `<li class="check-item ok" id="ld-kept-row"${keptList().length ? '' : ' hidden'}><span class="ci-icon">${icon('check')}</span><div><div class="ci-title">Kept</div><div class="ci-desc" id="ld-kept">${keptWords()}</div></div></li>`;
  const cmds = () => [liveCmd(['delete', 'task', name])].concat(left.filter((x) => pick[`${x.kind}/${x.name}`]).map((x) => liveCmd(['delete', x.kind, x.name])));
  const dlg = openDialog(dialogShell('ld', `Delete ${esc(name)}?`, '', `
    <p class="small">This removes the task from AX and tears down its sandbox. It can't be undone.</p>
    <ul class="check-list" style="margin-top:10px">
      <li class="check-item no"><span class="ci-icon">${icon('trash')}</span><div><div class="ci-title">Removed</div><div class="ci-desc">The task, its sandbox and the files in it</div></div></li>
      ${keptRow()}
    </ul>
    ${left.length ? `<div class="ld-also"><div class="res-h" style="margin-top:12px">No other task uses</div>${left.map((x) => `<label class="ld-opt"><input type="checkbox" data-ld="${x.kind}/${esc(x.name)}" ${x.own ? 'checked' : ''}> Delete its ${x.kind === 'workspace' ? 'workspace' : 'Gateway'} <span class="mono">${esc(x.name)}</span> too</label>`).join('')}</div>` : ''}
    <div style="margin-top:14px;display:grid;gap:6px" id="ld-cmds">${cmds().map(cliHint).join('')}</div>`, `<span class="left"></span><button class="btn ghost" data-action="close-dialog">Cancel</button><button class="btn danger" id="ld-go">${icon('trash', 'sm')}Delete task</button>`, false, 'trash'));
  dlg.addEventListener('change', (e) => {
    const k = e.target && e.target.dataset && e.target.dataset.ld;
    if (!k) return;
    pick[k] = e.target.checked;
    const kept = $('#ld-kept', dlg); if (kept) kept.innerHTML = keptWords();
    const row = $('#ld-kept-row', dlg); if (row) row.hidden = !keptList().length;
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
  'live-sample-task': () => liveSampleTask(),
  'live-palette': () => { if (typeof openPalette === 'function') openPalette(); },
  'live-shortcuts': () => { if (typeof openShortcuts === 'function') openShortcuts(); },
  'live-term-open': (el) => liveTermOpen(el.dataset.task),
  'live-term-add': (el) => liveTermAdd(el.dataset.task),
  'live-term-pick': (el) => liveTermPick(el.dataset.task, +el.dataset.i),
  'live-term-drop': (el) => liveTermDrop(el.dataset.task, +el.dataset.i),
  'live-tasks-filter': (el) => { liveTasksFilter().status = el.dataset.v || 'all'; render({ keepScroll: true }); },
  'live-home-filter': (el) => { liveTasksFilter().status = el.dataset.v || 'all'; liveTasksFilter().q = ''; location.hash = '#/tasks'; },
};

/* ---------- The Terminal: shells in a task's sandbox (ax ssh) ----------
   Each shell is `ax ssh <task>`, run by the Studio server under a pseudo-terminal, with a terminal of its own inside
   the sandbox, drawn here by xterm.js (vendor/xterm). Keys go to the server as they are typed (a few milliseconds of
   them per request, one request at a time, in order), and what the shell prints comes back as "sessionData" events
   (base64 of the raw bytes). Ctrl-C, Ctrl-D, Tab, the arrow keys and full-screen programs work as in any terminal.
   A task can have a few shells at once, as tabs. They stay connected while you look at other pages: each keeps its
   xterm, scrollback and all, and the Terminal tab puts it back on screen. Without xterm.js (the smoke tests run
   without it) a shell shows what it printed as text, read-only. */
LIVE.terms = {};               // cluster, atespace and task -> { list: [shell], active, seq, opened }
const LIVE_TERM_MAX = 4;       // shells per task
const LIVE_TERM_BATCH_MS = 12; // keys typed within this long go in one request
const LIVE_TERM_CHUNK = 65536; // the most text one request carries (a long paste goes in several)
const LIVE_TERM_RESIZE_MS = 150;
const LIVE_TERM_BACKLOG = 1 << 20; // what a shell may print before its xterm is made
function liveTermXterm() { return typeof Terminal === 'function'; }
function liveTermSet(name) {
  const k = `${LIVE.context}\n${LIVE.atespace}\n${name}`;
  return (LIVE.terms[k] = LIVE.terms[k] || { list: [], active: 0, seq: 0, opened: false });
}
/** The shell on screen for a task, or null when it has none. */
function liveTermActive(name) {
  const set = liveTermSet(name);
  return set.list[Math.min(set.active, set.list.length - 1)] || null;
}
function liveTermNewId() {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return 'sh-' + Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}
function liveTermNew(name) {
  const set = liveTermSet(name);
  set.seq += 1;
  /* status: idle (not started), starting, open, or closed (it ended, or couldn't start). heard: it printed something. */
  return { id: '', name, label: `Shell ${set.seq}`, status: 'idle', error: '', exitCode: null, heard: false, lastSeq: 0,
    term: null, fit: null, host: null, backlog: [], backlogSize: 0, text: '', dec: null, carry: null, queue: [], sending: false,
    timer: 0, sent: null, sizeTimer: 0 };
}
function liveTermById(id) {
  if (!id) return null;
  for (const k of Object.keys(LIVE.terms)) {
    const sh = LIVE.terms[k].list.find((x) => x.id === id);
    if (sh) return sh;
  }
  return null;
}

/* What the shell prints arrives as base64. */
function liveB64(s) {
  s = String(s || '');
  if (typeof atob === 'function') { const bin = atob(s); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const out = [];
  let acc = 0, bits = 0;
  for (const ch of s) {
    const v = abc.indexOf(ch);
    if (v < 0) continue;
    acc = ((acc << 6) | v) & 0xffffff; bits += 6;
    if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 255); }
  }
  return Uint8Array.from(out);
}
/** Bytes as text, for the read-only view. A character split between two events comes out whole. */
function liveTermText(sh, bytes) {
  if (typeof TextDecoder === 'function') { sh.dec = sh.dec || new TextDecoder('utf-8'); return sh.dec.decode(bytes, { stream: true }); }
  /* Without TextDecoder: keep the bytes of a character that isn't complete yet for the next event. */
  const all = sh.carry && sh.carry.length ? Uint8Array.from([...sh.carry, ...bytes]) : bytes;
  let end = all.length;
  for (let k = 1; k <= Math.min(3, all.length); k++) {
    const b = all[all.length - k];
    if ((b & 0xc0) === 0x80) continue;
    const need = b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : b >= 0xc0 ? 2 : 1;
    if (need > k) end = all.length - k;
    break;
  }
  sh.carry = all.slice(end);
  let bin = '';
  for (let i = 0; i < end; i++) bin += String.fromCharCode(all[i]);
  try { return decodeURIComponent(escape(bin)); } catch (e) { return bin; }
}
/* SGR colors in what a program prints, as spans; every other escape sequence is dropped. For the read-only view. */
const LIVE_ANSI_FG = { 30: 'k', 31: 'r', 32: 'g', 33: 'y', 34: 'bl', 35: 'm', 36: 'c', 37: 'w', 90: 'k', 91: 'r', 92: 'g', 93: 'y', 94: 'bl', 95: 'm', 96: 'c', 97: 'w' };
function liveAnsiHTML(text) {
  let out = '', open = false, bold = false, fg = '';
  const close = () => { if (open) { out += '</span>'; open = false; } };
  const start = () => { close(); if (bold || fg) { out += `<span class="${[bold ? 'a-bold' : '', fg ? `a-${fg}` : ''].filter(Boolean).join(' ')}">`; open = true; } };
  const re = /\x1b\[([0-9;?]*)([A-Za-z])|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Za-z0-9]|\x1b[=>]|\r(?!\n)/g;
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

/* ---------- xterm.js ---------- */
const LIVE_TERM_COLORS = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];
/** The terminal's colors and font, from the theme's CSS variables (styles.css and polish.css). */
function liveTermLook() {
  const cs = typeof getComputedStyle === 'function' ? getComputedStyle(document.documentElement) : null;
  const v = (k) => ((cs && cs.getPropertyValue(k)) || '').trim();
  const theme = {
    background: v('--term-bg') || '#090E14', foreground: v('--term-ink') || '#E6EEF6',
    cursor: v('--term-cursor') || '#5CCBF9', cursorAccent: v('--term-bg') || '#090E14',
    selectionBackground: v('--term-selection') || 'rgba(92, 203, 249, .3)',
  };
  LIVE_TERM_COLORS.forEach((c) => {
    const bright = 'bright' + c.charAt(0).toUpperCase() + c.slice(1);
    if (v(`--term-${c}`)) theme[c] = v(`--term-${c}`);
    if (v(`--term-bright-${c}`)) theme[bright] = v(`--term-bright-${c}`);
  });
  return { theme, font: v('--font-mono') || 'ui-monospace, Menlo, Consolas, monospace' };
}
/** Makes the shell's xterm inside el, once. Later its element moves to wherever the Terminal tab shows it. */
function liveTermMake(sh, el) {
  const look = liveTermLook();
  const term = new Terminal({ fontFamily: look.font, fontSize: 13, lineHeight: 1.2, cursorBlink: true, scrollback: 5000, theme: look.theme });
  const fit = typeof FitAddon !== 'undefined' && FitAddon.FitAddon ? new FitAddon.FitAddon() : null;
  if (fit) term.loadAddon(fit);
  const host = document.createElement('div');
  host.className = 'term-xterm';
  el.appendChild(host);
  term.open(host);
  sh.term = term; sh.fit = fit; sh.host = host;
  term.onData((d) => liveTermInput(sh, d));
  term.onBinary((d) => liveTermInput(sh, d, true));
  term.onResize(() => liveTermSizeLater(sh));
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown' || e.altKey || e.metaKey) return true;
    /* Shift-Esc leaves the terminal, which keeps Tab for the shell. */
    if (e.key === 'Escape' && e.shiftKey && !e.ctrlKey) {
      e.preventDefault();
      const tab = $('#live-term-tabs [aria-selected="true"]');
      if (tab) tab.focus(); else term.blur();
      return false;
    }
    /* With text selected, Ctrl-C (or Ctrl-Shift-C) copies it; with nothing selected, Ctrl-C is an interrupt. */
    if (e.ctrlKey && String(e.key).toLowerCase() === 'c' && term.hasSelection()) {
      if (e.shiftKey && navigator.clipboard) { e.preventDefault(); navigator.clipboard.writeText(term.getSelection()).catch(() => {}); }
      return false; // a plain Ctrl-C goes to the browser, which copies the selection
    }
    return true;
  });
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => liveTermFit(sh)).observe(host);
  /* What it printed before it had an xterm. */
  sh.backlog.forEach((b) => term.write(b));
  sh.backlog = []; sh.backlogSize = 0;
  return term;
}
function liveTermFit(sh) {
  if (!sh.fit || !sh.host || !sh.host.isConnected || !sh.host.clientWidth || !sh.host.clientHeight) return;
  try { sh.fit.fit(); } catch (e) { /* not measurable yet */ }
}
/** The size to start a shell with, once its xterm is on screen. */
function liveTermSizeOf(sh) {
  return sh.term && sh.term.cols && sh.term.rows ? { cols: sh.term.cols, rows: sh.term.rows } : null;
}
/** Tells the server the shell's new size, once resizing settles. */
function liveTermSizeLater(sh) {
  clearTimeout(sh.sizeTimer);
  sh.sizeTimer = setTimeout(() => {
    const size = liveTermSizeOf(sh);
    if (!size || sh.status !== 'open' || (sh.sent && sh.sent.cols === size.cols && sh.sent.rows === size.rows)) return;
    sh.sent = size;
    studioApi.sessionResize(sh.id, size.cols, size.rows).catch(() => { sh.sent = null; });
  }, LIVE_TERM_RESIZE_MS);
}
/** What the shell printed, into its xterm, or kept until it has one. */
function liveTermWrite(sh, data) {
  if (sh.term) { sh.term.write(data); return; }
  if (liveTermXterm()) {
    sh.backlog.push(data);
    sh.backlogSize += data.length;
    while (sh.backlogSize > LIVE_TERM_BACKLOG && sh.backlog.length > 1) sh.backlogSize -= sh.backlog.shift().length;
    return;
  }
  sh.text += typeof data === 'string' ? data : liveTermText(sh, data);
  if (sh.text.length > 64000) sh.text = sh.text.slice(-64000);
  const out = $('#live-term-out');
  if (out && out.dataset && out.dataset.shell === sh.id) out.innerHTML = liveAnsiHTML(sh.text);
}
/** A line from Studio in the terminal, dimmed, such as "The shell ended." */
function liveTermNote(sh, text) { liveTermWrite(sh, `\r\n\x1b[2m${text}\x1b[0m\r\n`); }
/** Puts the task's shell on screen: makes its xterm the first time, or moves it back into the Terminal tab. */
function liveTermMount(name) {
  const screen = $('#live-term-screen');
  const sh = liveTermActive(name);
  const refocus = LIVE.termRefocus;
  LIVE.termRefocus = false;
  if (!screen || !sh || !liveTermXterm() || !screen.dataset || screen.dataset.task !== name || !document.contains(screen)) return;
  if (!sh.term) liveTermMake(sh, screen);
  else if (sh.host.parentNode !== screen) { screen.textContent = ''; screen.appendChild(sh.host); }
  liveTermFit(sh);
  sh.term.refresh(0, sh.term.rows - 1);
  if (refocus) sh.term.focus();
}
function liveTermFocus(name) {
  const sh = liveTermActive(name);
  if (sh && sh.term) sh.term.focus();
}
function liveTermDispose(sh) {
  clearTimeout(sh.timer); clearTimeout(sh.sizeTimer);
  if (sh.term) { try { sh.term.dispose(); } catch (e) { /* ignore */ } }
  if (sh.host && sh.host.parentNode) sh.host.parentNode.removeChild(sh.host);
  sh.term = null; sh.fit = null; sh.host = null; sh.backlog = [];
}
/* The terminals follow the light and dark themes. */
if (LIVE.on && typeof MutationObserver === 'function' && document.documentElement) {
  new MutationObserver(() => {
    const look = liveTermLook();
    Object.keys(LIVE.terms).forEach((k) => LIVE.terms[k].list.forEach((sh) => { if (sh.term) sh.term.options.theme = look.theme; }));
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}
/* Shells belong to this page: when it goes (closed, reloaded), so do they, rather than run on with no one to see them. */
if (LIVE.on) {
  window.addEventListener('pagehide', () => {
    Object.keys(LIVE.terms).forEach((k) => LIVE.terms[k].list.forEach((sh) => {
      if (sh.status !== 'open' && sh.status !== 'starting') return;
      studioApi.sessionCloseOnLeave(sh.id);
      sh.status = 'closed';
      liveTermNote(sh, 'The shell ended when you left the page.');
    }));
  });
}

/* ---------- Talking to the server ---------- */
/** Starts the shell's ax ssh, sized to its xterm when it has one. */
async function liveTermStart(name, sh) {
  if (sh.status === 'starting' || sh.status === 'open') return;
  if (sh.status === 'closed') liveTermNote(sh, 'Opening the shell again…');
  Object.assign(sh, { id: liveTermNewId(), status: 'starting', error: '', exitCode: null, heard: false, lastSeq: 0, queue: [], sent: null });
  liveTermPaint(name);
  const size = liveTermSizeOf(sh);
  sh.sent = size;
  const args = (LIVE.context ? ['--context', LIVE.context] : []).concat(['-a', LIVE.atespace, 'ssh', name]);
  try {
    await studioApi.sessionStart(sh.id, args, size);
    /* It may have ended already: ax couldn't connect, say. */
    if (sh.status === 'starting') { sh.status = 'open'; liveTermFlush(sh); liveTermSizeLater(sh); }
  } catch (e) {
    if (sh.status === 'starting') { sh.status = 'closed'; sh.error = e.message; }
  }
  liveTermPaint(name);
}
/** Keys for the shell. They wait a moment for the next ones, then go in one request. */
function liveTermInput(sh, data, binary) {
  if (!sh || !data || (sh.status !== 'open' && sh.status !== 'starting')) return;
  const last = sh.queue[sh.queue.length - 1];
  if (last && !last.binary && !binary) last.data += data;
  else sh.queue.push({ data, binary: !!binary });
  if (sh.status === 'open' && !sh.timer && !sh.sending) sh.timer = setTimeout(() => { sh.timer = 0; liveTermFlush(sh); }, LIVE_TERM_BATCH_MS);
}
/** Sends the keys waiting, one request at a time, so they arrive in order. */
async function liveTermFlush(sh) {
  if (!sh || sh.sending || sh.status !== 'open') return;
  sh.sending = true;
  try {
    while (sh.queue.length && sh.status === 'open') {
      const item = sh.queue[0];
      let data = item.data;
      if (data.length > LIVE_TERM_CHUNK) {
        let cut = LIVE_TERM_CHUNK;
        const c = data.charCodeAt(cut);
        if (c >= 0xdc00 && c <= 0xdfff) cut -= 1; // never between the two halves of one character
        data = item.data.slice(0, cut);
        item.data = item.data.slice(cut);
      } else sh.queue.shift();
      await studioApi.sessionWrite(sh.id, data, item.binary);
    }
  } catch (e) {
    sh.queue = [];
    /* A shell that is gone says so with its exit; anything else is worth showing. */
    if (sh.status === 'open' && e.status !== 404 && e.status !== 409) { sh.error = e.message; liveTermPaint(sh.name); }
  }
  sh.sending = false;
}
function liveOnSessionData(p) {
  const sh = p && liveTermById(p.id);
  if (!sh) return;
  if (p.seq && sh.lastSeq && p.seq > sh.lastSeq + 1) liveTermNote(sh, 'Some output was skipped.');
  if (p.seq) sh.lastSeq = p.seq;
  liveTermWrite(sh, liveB64(p.data));
  if (!sh.heard) { sh.heard = true; liveTermPaint(sh.name); }
}
function liveOnSessionExit(p) {
  const sh = p && liveTermById(p.id);
  if (!sh || sh.status === 'closed') return;
  sh.status = 'closed';
  sh.exitCode = typeof p.status === 'number' ? p.status : 0;
  liveTermNote(sh, sh.exitCode ? `The shell ended (exit ${sh.exitCode}).` : 'The shell ended.');
  liveTermPaint(sh.name);
}

/* ---------- Opening, switching and closing shells ---------- */
/** Makes sure the task has a shell open: the one on screen, again if it ended, or a new one. */
function liveTermOpen(name) {
  if (!name) return;
  const sh = liveTermActive(name);
  if (!sh) { liveTermAdd(name); return; }
  liveTermSet(name).opened = true;
  if (sh.status === 'closed' || sh.status === 'idle') liveTermStart(name, sh);
  liveTermFocus(name);
}
/** Another shell in the same sandbox, next to the ones open. */
function liveTermAdd(name, quiet) {
  const set = liveTermSet(name);
  if (set.list.length >= LIVE_TERM_MAX) return;
  set.opened = true;
  const sh = liveTermNew(name);
  set.list.push(sh);
  set.active = set.list.length - 1;
  liveTermPaint(name);
  liveTermStart(name, sh);
  if (!quiet) liveTermFocus(name);
}
function liveTermPick(name, idx) {
  const set = liveTermSet(name);
  if (!set.list[idx]) return;
  set.active = idx;
  liveTermPaint(name);
  /* A click on a shell's tab is for typing in it. (Arrow keys on the tabs keep focus on them.) */
  if (!document.activeElement || document.activeElement === document.body) liveTermFocus(name);
}
/** Ends a shell and takes its tab away. */
async function liveTermDrop(name, idx) {
  const set = liveTermSet(name);
  const sh = set.list[idx];
  if (!sh) return;
  set.list.splice(idx, 1);
  if (set.active > idx || set.active >= set.list.length) set.active = Math.max(0, set.active - 1);
  const live = sh.status === 'open' || sh.status === 'starting';
  sh.status = 'closed';
  liveTermDispose(sh);
  liveTermPaint(name);
  if (set.list.length) liveTermFocus(name);
  else { const open = $('#live-term-open'); if (open && open.focus) open.focus(); }
  if (live) { try { await studioApi.sessionClose(sh.id); } catch (e) { /* it ends when Studio does, too */ } }
}
/** The Terminal tab is on screen: the first time, a task that can have a shell gets one; then its shell goes back on. */
function liveTermShown(name, canShell) {
  const set = liveTermSet(name);
  if (canShell && !set.opened && !set.list.length) { liveTermAdd(name, true); return; }
  liveTermMount(name);
}

/* ---------- The Terminal tab ---------- */
/** Why the task can't have a shell now, or '' when it can. */
function liveTermWhyNot(t, stateName) {
  if (!t.debug) return 'This task has no shell. A shell needs debug on when the task starts.';
  if (stateName === 'Working') return '';
  if (stateName === 'Suspended' || stateName === 'Suspending') return 'Resume the task to open a shell.';
  if (stateName === 'Queued') return 'The task is starting. A shell can open once it runs.';
  return 'A shell can open only while the task is running.';
}
function liveTermBarHTML(name, sh, canShell) {
  if (!sh) return '<span class="lb-text">A shell inside the task\'s sandbox.</span>';
  const chip = sh.status === 'open' && sh.heard ? '<span class="chip running"><i class="pulse-dot"></i>Connected</span>'
    : sh.status === 'open' || sh.status === 'starting' ? `<span class="chip starting">${icon('loader')}Connecting…</span>`
      : '<span class="chip paused">Ended</span>';
  const again = sh.status === 'closed' && canShell ? `<button type="button" class="btn sm" data-action="live-term-open" data-task="${esc(name)}">${icon('refresh', 'sm')}Open the shell again</button>` : '';
  return `<span class="lb-text">A shell inside the task's sandbox.</span><span class="lb-actions">${chip}${again}</span>`;
}
function liveTermErrHTML(sh) {
  return sh && sh.error ? `<div class="callout warn" role="alert">${icon('alert')}<div style="overflow-wrap:anywhere">${esc(sh.error)}</div></div>` : '';
}
function liveTermTabsHTML(name, canShell) {
  const set = liveTermSet(name);
  const on = Math.min(set.active, set.list.length - 1);
  return set.list.map((x, i) => `<span class="tt-item${i === on ? ' on' : ''}"><button type="button" role="tab" id="live-term-tab-${i}" aria-selected="${i === on}" aria-controls="live-term-screen" tabindex="${i === on ? 0 : -1}" data-action="live-term-pick" data-task="${esc(name)}" data-i="${i}">${x.status === 'open' ? '<i class="tt-dot" aria-hidden="true"></i>' : ''}${esc(x.label)}</button><button type="button" class="tt-x" data-action="live-term-drop" data-task="${esc(name)}" data-i="${i}" aria-label="Close ${esc(x.label)}" title="Close ${esc(x.label)}">${icon('x', 'xs')}</button></span>`).join('')
    + (canShell && set.list.length < LIVE_TERM_MAX ? `<button type="button" class="tt-new" data-action="live-term-add" data-task="${esc(name)}" aria-label="New shell" title="New shell">${icon('plus', 'xs')}</button>` : '');
}
function liveTermScreenHTML(name, sh, canShell) {
  if (!sh) return `<div class="term-empty"><p>No shell is open.</p>${canShell ? `<button type="button" class="btn sm" id="live-term-open" data-action="live-term-open" data-task="${esc(name)}">${icon('terminal', 'sm')}Open a shell</button>` : ''}</div>`;
  if (liveTermXterm()) return '';
  /* No xterm.js: what the shell printed, read-only. */
  return `<pre class="term-body term-fallback" id="live-term-out" data-shell="${esc(sh.id)}" tabindex="0" aria-label="Shell output">${liveAnsiHTML(sh.text)}</pre>`;
}
/** The Terminal tab's panel for a task (t from liveTask, stateName as in LIVE_STATES). */
function liveTermInnerHTML(name, t, stateName) {
  const set = liveTermSet(name);
  const why = liveTermWhyNot(t, stateName);
  const cli = `<p class="xsmall muted" style="margin-top:10px">${icon('terminal', 'xs')} <code>${esc(liveCmd(['ssh', name]))}</code></p>`;
  /* No shell can open, and none is left from before: say why. */
  if (why && !set.list.length) {
    const resume = t.debug && stateName === 'Suspended' ? `<div class="btn-row" style="margin-top:12px">${liveSuspendResumeHTML(name, stateName, LIVE.busy[name], 'sm')}</div>` : '';
    return `<h2 id="live-term-h" class="sr-only">Terminal</h2>
      <div class="log-bar"><span class="lb-text">A shell inside the task's sandbox.</span></div>
      <div class="callout term-why" role="status" id="live-term-why">${icon('terminal')}<div><p>${esc(why)}</p>${resume}</div></div>${cli}`;
  }
  const canShell = !why;
  const sh = liveTermActive(name);
  const on = Math.min(set.active, set.list.length - 1);
  return `<h2 id="live-term-h" class="sr-only">Terminal</h2>
    <div class="log-bar" id="live-term-bar">${liveTermBarHTML(name, sh, canShell)}</div>
    <div id="live-term-err">${liveTermErrHTML(sh)}</div>
    <div class="terminal live-terminal">
      <div class="term-bar"><span class="term-dots" aria-hidden="true"><i></i><i></i><i></i></span><div class="term-tabs" id="live-term-tabs" role="tablist" aria-label="Shells">${liveTermTabsHTML(name, canShell)}</div></div>
      <div class="term-screen${sh ? '' : ' empty'}" id="live-term-screen" data-task="${esc(name)}"${sh ? ` role="tabpanel" aria-labelledby="live-term-tab-${on}"` : ''}>${liveTermScreenHTML(name, sh, canShell)}</div>
      ${sh && liveTermXterm() ? '<div class="term-keys"><kbd>Shift</kbd> <kbd>Esc</kbd> leaves the terminal</div>' : ''}
    </div><div id="live-term-note">${liveTermNoteHTML(why)}</div>${cli}`;
}
/** Why no shell can open now, under shells left from before. */
function liveTermNoteHTML(why) {
  return why ? `<p class="small muted" style="margin-top:8px">${esc(why)}</p>` : '';
}
function liveTermHTML(name, t, stateName) {
  return `<section aria-labelledby="live-term-h" id="live-term" data-task="${esc(name)}">${liveTermInnerHTML(name, t, stateName)}</section>`;
}
/** The task and state the Terminal tab is drawn for. */
function liveTermTaskOf(name) {
  const row = LIVE.tasks.find((x) => x.name === name);
  const det = LIVE.detail[name];
  const t = liveTask((det && det.doc) || (row && row.doc) || { metadata: { name } });
  return { t, stateName: row ? row.state : t.state };
}
/** Draws the Terminal tab again where it is on screen. With a shell on screen, only what is around it is drawn, so
    its xterm stays where it is. */
function liveTermPaint(name) {
  const box = $('#live-term');
  if (!box || !box.dataset || box.dataset.task !== name) return;
  const { t, stateName } = liveTermTaskOf(name);
  const sh = liveTermActive(name);
  const screen = $('#live-term-screen', box);
  const why = liveTermWhyNot(t, stateName);
  if (liveTermXterm() && sh && sh.host && screen && screen.contains(sh.host)) {
    const set = liveTermSet(name);
    const bar = $('#live-term-bar', box); if (bar) bar.innerHTML = liveTermBarHTML(name, sh, !why);
    const err = $('#live-term-err', box); if (err) err.innerHTML = liveTermErrHTML(sh);
    const tabs = $('#live-term-tabs', box); if (tabs) tabs.innerHTML = liveTermTabsHTML(name, !why);
    const note = $('#live-term-note', box); if (note) note.innerHTML = liveTermNoteHTML(why);
    screen.setAttribute('aria-labelledby', `live-term-tab-${Math.min(set.active, set.list.length - 1)}`);
    return;
  }
  box.innerHTML = liveTermInnerHTML(name, t, stateName);
  liveTermMount(name);
}
/** A refresh in the background while a shell is on screen: the page around the shell is drawn again, the shell isn't.
    True when that was all it took. */
function liveTermPatchPage(v) {
  const screen = $('#live-term-screen');
  const name = screen && screen.dataset ? screen.dataset.task : '';
  const sh = name ? liveTermActive(name) : null;
  if (!liveTermXterm() || !sh || !sh.host || !screen.contains(sh.host)) return false;
  const next = document.createElement('div');
  next.innerHTML = v.html;
  const nextScreen = next.querySelector('#live-term-screen');
  if (!nextScreen || nextScreen.dataset.task !== name || nextScreen.classList.contains('empty')) return false;
  ['#task-head', '#live-task-side', '.tabs-bar', '#live-term-bar', '#live-term-err', '#live-term-tabs', '#live-term-note'].forEach((sel) => {
    const now = $(sel), want = next.querySelector(sel);
    if (now && want && now.innerHTML !== want.innerHTML) now.innerHTML = want.innerHTML;
  });
  return true;
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
      <div class="btn-row" style="margin-top:12px">${extra || ''}<button class="btn sm" data-action="live-refresh">${icon('refresh', 'sm')}Try again</button><a class="btn ghost sm" href="#/places">Local cluster</a></div>
    </div></div></div>`;
}
function liveKV(rows) {
  return `<dl class="kv">${rows.filter((r) => r && r[1] != null && r[1] !== '').map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
}

/* ---------- Pages ---------- */
function liveViewStarting() {
  return { title: 'Connecting', crumbs: [{ label: 'Home' }], html: `<div class="page-head"><h1 tabindex="-1">Connecting to AX…</h1><p class="lede">Checking this computer and your local cluster.</p></div>` };
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
/* ---------- Tasks: the overview ----------
   Every task on AX on this computer in one table: its state in AX's words, its image and workspace, Suspend or Resume,
   a shell and its logs, and Delete. Filters by state and a search narrow it. Under it, the workspaces and Gateways the
   tasks use, each in its own section (live-resources.js). #/ and #/tasks are this page. */
const LIVE_TASK_FILTERS = [['all', 'All', -1], ['needs', 'Needs you', 0], ['running', 'Running', 1], ['paused', 'Suspended', 2], ['done', 'Done', 3]];
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
    const img = (spec.profile && spec.profile.image) || '';
    return `${t.goal} ${t.name} ${tpl.name} ${img} ${ws} ${t.state} ${liveState(t.state).label}`.toLowerCase().includes(q);
  });
}
/** What you can do with a task from its row: Suspend or Resume, open a shell, read its logs, delete it. */
function liveRowActionsHTML(t) {
  const busy = LIVE.busy[t.name];
  const enc = encodeURIComponent(t.name);
  /* ax ssh needs the task Working and started with debug on. */
  const shell = t.debug && t.state === 'Working'
    ? `<a class="btn ghost sm icon" href="#/task/${enc}/terminal" aria-label="Open a shell in ${esc(t.name)}" title="Open a shell (${esc(liveCmd(['ssh', t.name]))})">${icon('terminal', 'sm')}</a>` : '';
  return `<div class="tk-actions">${liveSuspendResumeHTML(t.name, t.state, busy, 'sm')}${shell}
    <a class="btn ghost sm icon" href="#/task/${enc}/logs" aria-label="Logs of ${esc(t.name)}" title="Logs">${icon('file', 'sm')}</a>
    <button type="button" class="btn ghost sm icon" data-action="live-delete" data-task="${esc(t.name)}" ${busy ? 'disabled' : ''} aria-label="Delete ${esc(t.name)}" title="Delete (${esc(liveCmd(['delete', 'task', t.name]))})">${icon('trash', 'sm')}</button></div>`;
}
function liveTasksTableHTML(all, opts) {
  const raw = opts && opts.unfiltered ? (all || liveSorted()) : liveTasksMatching(all || liveSorted());
  const list = opts && opts.limit ? raw.slice(0, opts.limit) : raw;
  if (!list.length) {
    const f = liveTasksFilter();
    return `<div class="tasks-empty"><b>No tasks match</b><span>${f.q.trim() ? `Nothing matches “${esc(f.q.trim())}” with these filters.` : 'No tasks are in this state right now.'}</span></div>`;
  }
  const rows = list.map((t) => {
    const spec = (t.doc && t.doc.spec) || {};
    const tpl = liveTaskTemplate(spec);
    const ws = (spec.workspace && spec.workspace.name) || '';
    const lim = liveLimitsText(spec);
    const busy = LIVE.busy[t.name];
    const age = liveAge(t.created);
    const turn = t.turns > 1 ? `Turn ${t.turn} of ${t.turns}` : '';
    const goal = t.goal ? t.goal.split('\n')[0] : '';
    return `<tr id="live-trow-${esc(t.name)}">
      <td class="tk-title"><a href="#/task/${encodeURIComponent(t.name)}" class="mono">${esc(t.name)}</a>${goal || turn || t.atespace !== 'default' ? `<div class="xsmall muted tk-goal">${esc(goal)}${turn ? `${goal ? ' · ' : ''}${turn}` : ''}${t.atespace !== 'default' ? ` · ${esc(t.atespace)}` : ''}</div>` : ''}</td>
      <td>${busy ? `<span class="chip stopping">${icon('loader')}${LIVE_VERBS[busy].doing}</span>` : liveChip(t.state)}</td>
      <td class="tk-img"><span class="tk-agent" title="${esc((spec.profile && spec.profile.image) || 'The default task image')}">${tpl.tile}<span class="tk-img-name">${esc(tpl.name)}</span></span></td>
      <td class="tk-ws">${ws ? `<span class="mono">${esc(ws)}</span>` : '<span class="muted">None</span>'}</td>
      <td class="tk-res tnum">${lim ? esc(lim) : '<span class="muted">Default</span>'}</td>
      <td class="tk-created muted">${age ? `${esc(age)} ago` : 'Just now'}</td>
      <td class="tk-act">${liveRowActionsHTML(t)}</td></tr>`;
  }).join('');
  return `<table class="table tasks-table"><thead><tr><th>Task</th><th>State</th><th class="tk-img">Image</th><th class="tk-ws">Workspace</th><th class="tk-res">Resources</th><th class="tk-created">Created</th><th class="tk-act"><span class="sr-only">Actions</span></th></tr></thead><tbody>${rows}</tbody></table>`;
}
/** A first task that always works: the cluster's default task image, a shell that waits, with debug on so Terminal
    can open a shell in it. */
async function liveSampleTask() {
  if (LIVE.sampleBusy || !LIVE.context) return;
  const name = `sample-${typeof liveHex === 'function' ? liveHex(3) : Date.now().toString(16).slice(-6)}`;
  const scope = ['--context', LIVE.context, '-a', LIVE.atespace];
  const yaml = `apiVersion: ax.io/v1alpha1\nkind: Task\nmetadata:\n  name: "${name}"\nspec:\n  commands: ["sh", "-c", "echo Hello from a sandbox on this computer; sleep infinity"]\n  debug: true\n`;
  LIVE.sampleBusy = true;
  render({ keepScroll: true });
  try {
    const r = await studioApi.ax(scope.concat(['apply', '-f', '-']), yaml);
    if (r.status !== 0) throw new Error(liveLastLine(r.stderr || r.stdout) || 'ax apply failed.');
    const s = await studioApi.ax(scope.concat(['resume', 'task', name]));
    if (s.status !== 0) toast(`Created <span class="mono">${esc(name)}</span>, but it didn't start: ${esc(liveLastLine(s.stderr || s.stdout))}`, { icon: 'alert', timeout: 9000 });
    else toast(`Started <span class="mono">${esc(name)}</span>`, { icon: 'play' });
    location.hash = `#/task/${encodeURIComponent(name)}`;
  } catch (e) {
    toast(`Couldn't start a sample task: ${esc(e.message)}`, { icon: 'alert', timeout: 9000 });
  } finally {
    LIVE.sampleBusy = false;
  }
  await liveRefresh(true);
}
function liveListMetaHTML() {
  const ates = LIVE.atespace !== 'default' ? `<span class="env" title="Atespace"><span class="muted">atespace</span>&nbsp;<span class="mono">${esc(LIVE.atespace)}</span></span>` : '';
  const upd = LIVE.refreshedAt ? `<span class="llh-upd" title="Studio asks again every few seconds">Updated <span data-live-updated data-fmt="ago" data-since="${LIVE.refreshedAt}">${fmtAgo(LIVE.refreshedAt)}</span></span><button type="button" class="btn ghost sm icon" data-action="live-refresh" aria-label="Refresh the list">${icon('refresh', 'sm')}</button>` : '';
  return `<span class="llh-scope">${liveWhere(LIVE.context)}${ates}</span>${upd}`;
}
function liveListProblemHTML() {
  if (!LIVE.error) return '';
  const kind = liveErrorKind();
  const where = esc(LIVE.context || 'this cluster');
  return kind === 'missing' ? liveProblemHTML(`AX isn't installed on ${where}`, `Repair it on Local cluster, then try again. What AX Studio got: ${LIVE.error}`, 'ax local start')
    : kind === 'versions' ? liveProblemHTML(`AX on ${where} and AX Studio are different versions`, `They can't read each other's data. Update the older one so the two match. What AX Studio got: ${LIVE.error}`, '')
      : liveProblemHTML(`Can't reach AX on ${where}`, LIVE.error, liveCmd(['get', 'tasks']));
}
function liveSampleBtnHTML(primary) {
  return `<button type="button" class="btn${primary ? ' primary' : ''}" data-action="live-sample-task" id="live-sample" ${LIVE.sampleBusy ? 'disabled' : ''} title="A shell in the cluster's default task image, with debug on">${icon(LIVE.sampleBusy ? 'loader' : 'play', 'sm')}${LIVE.sampleBusy ? 'Starting…' : 'Try a sample task'}</button>`;
}
/** Home (#/): setup while AX isn't running, a clean zero state right after setup, or a quick launchpad once tasks exist. */
function liveViewHome() {
  if (LIVE.loaded && (!LIVE.context || liveLocalDown())) return liveViewSetup(true);
  if (typeof liveResWanted === 'function' && !LIVE.error) liveResWanted();
  const all = liveSorted();
  const active = all.filter((t) => liveState(t.state).active).length;
  const count = (rank) => all.filter((t) => liveState(t.state).rank === rank).length;
  const problem = liveListProblemHTML();
  const kind = liveErrorKind();
  const mood = LIVE.error ? 'alert' : !all.length ? 'done' : count(0) ? 'wave' : active ? 'working' : 'idle';
  const resTotal = typeof liveResCount === 'function' ? liveResCount() : 0;
  /* Zero state: the user just set up AX or has no tasks yet. */
  if (LIVE.loaded && !all.length && !LIVE.error) {
    const html = `
      <div class="head-row tasks-head"><div class="cuj-head">${axo(mood, { decorative: true, id: 'home-axo' })}<div class="cuj-head-copy">
          <div class="live-list-head" style="margin-top:0"><h1 tabindex="-1" id="live-home-title" style="margin-right:0">AX is running on this computer</h1>${liveListMetaHTML()}</div>
          <p class="lede" id="live-summary">Your local cluster is ready. Start a task to run an agent or open an interactive shell in its own sandbox.</p></div></div></div>
      <div class="home-zero-grid" id="live-empty">
        <section class="card home-start-card featured">
          <div class="hsc-ic" aria-hidden="true">${icon('plus', 'sm')}</div>
          <h2>Create a new task</h2>
          <p class="small sub">Start from Antigravity or Blank, or load a task YAML file. Configure its Workspace and Network rules on one page.</p>
          <div class="btn-row hsc-act"><a class="btn primary" href="#/new">${icon('plus', 'sm')}New task</a></div>
        </section>
        <section class="card home-start-card">
          <div class="hsc-ic" aria-hidden="true">${icon('terminal', 'sm')}</div>
          <h2>Try a sample task</h2>
          <p class="small sub">Launch a ready-to-use sandbox in the cluster's default task image with debug enabled, so you can read its logs and open a shell right away.</p>
          <div class="btn-row hsc-act">${liveSampleBtnHTML(false)}</div>
        </section>
      </div>
      <section class="card home-cli-card" aria-label="From the command line">
        <div class="hcc-copy"><strong>Or start from the command line</strong><span class="small muted">Tasks started with <span class="mono">ax</span> appear here automatically.</span></div>
        <div class="hcc-cmds">${cliHint(liveCmd(['apply', '-f', 'task.yaml']))}${cliHint(liveCmd(['resume', 'task', '<name>']))}</div>
      </section>`;
    return { title: 'Home', crumbs: [{ label: 'Home' }], html, wide: true };
  }
  const lede = !LIVE.loaded ? 'Loading your tasks…'
    : LIVE.error ? `${LIVE_ERROR_WORDS[kind].summary}${all.length ? ' This is the last list it got.' : ''}`
      : `${plural(all.length, 'task')} on this computer. ${active ? `${plural(active, 'sandbox', 'sandboxes')} running.` : 'No sandboxes running right now.'}`;
  const stats = all.length ? `<div class="home-stats" aria-label="Summary">
    <button type="button" class="card home-stat" data-action="live-home-filter" data-v="running"><span class="hs-label">Running</span><span class="hs-num tnum">${count(1)}</span></button>
    <button type="button" class="card home-stat${count(0) ? ' attn' : ''}" data-action="live-home-filter" data-v="needs"><span class="hs-label">Needs you</span><span class="hs-num tnum">${count(0)}</span></button>
    <button type="button" class="card home-stat" data-action="live-home-filter" data-v="paused"><span class="hs-label">Suspended</span><span class="hs-num tnum">${count(2)}</span></button>
    <a class="card home-stat" href="#/tasks/resources"><span class="hs-label">Workspaces &amp; Gateways</span><span class="hs-num tnum">${resTotal}</span></a>
  </div>` : '';
  const recent = all.length ? `<section class="home-recent" aria-labelledby="home-recent-h">
    <div class="live-list-head"><h2 class="h-display-sm" id="home-recent-h">Recent tasks</h2>
      <a class="btn sm" href="#/tasks">View all ${all.length > 5 ? `(${all.length})` : 'tasks'}${icon('arrowRight', 'sm')}</a></div>
    <div class="card tasks-card" id="live-home-table">${liveTasksTableHTML(all, { unfiltered: true, limit: 5 })}</div>
  </section>` : '';
  const html = `
    <div class="head-row tasks-head"><div class="cuj-head">${axo(mood, { decorative: true, id: 'home-axo' })}<div class="cuj-head-copy">
        <div class="live-list-head" style="margin-top:0"><h1 tabindex="-1" id="live-home-title" style="margin-right:0">Home</h1>${liveListMetaHTML()}</div>
        <p class="lede" id="live-summary">${lede}</p></div></div>
      <div class="btn-row">${liveSampleBtnHTML(false)}<a class="btn primary" href="#/new">${icon('plus', 'sm')}New task</a></div></div>
    ${problem}${stats}${recent}`;
  return { title: 'Home', crumbs: [{ label: 'Home' }], html, wide: true };
}
/** Tasks (#/tasks and #/tasks/resources): two tabs — Tasks (searchable/filterable table) and Workspaces and Gateways. */
function liveViewTasks(rawTab) {
  if (LIVE.loaded && (!LIVE.context || liveLocalDown())) return liveViewSetup(false);
  if (typeof liveResWanted === 'function' && !LIVE.error) liveResWanted();
  const tab = rawTab === 'resources' ? 'resources' : 'tasks';
  const all = liveSorted();
  const f = liveTasksFilter();
  const active = all.filter((t) => liveState(t.state).active).length;
  const count = (rank) => (rank < 0 ? all.length : all.filter((t) => liveState(t.state).rank === rank).length);
  const resTotal = typeof liveResCount === 'function' ? liveResCount() : 0;
  const problem = liveListProblemHTML();
  const kind = liveErrorKind();
  const lede = !LIVE.loaded ? 'Loading your tasks…'
    : LIVE.error ? `${LIVE_ERROR_WORDS[kind].summary}${all.length ? ' This is the last list it got.' : ''}`
      : all.length ? `${plural(all.length, 'task')} on this computer. ${active ? `${plural(active, 'sandbox', 'sandboxes')} running.` : 'No sandboxes running right now.'}`
        : 'No tasks on this computer yet.';
  const mood = LIVE.error ? 'alert' : count(0) ? 'wave' : active ? 'working' : 'idle';
  const tabs = `<div class="tabs-bar tasks-tabs">
    <div class="seg task-tabs" role="tablist" aria-label="Tasks sections">
      <a role="tab" id="tab-tasks" href="#/tasks" aria-selected="${tab === 'tasks'}" tabindex="${tab === 'tasks' ? 0 : -1}">Tasks<span class="tab-n tnum">${all.length}</span></a>
      <a role="tab" id="tab-resources" href="#/tasks/resources" aria-selected="${tab === 'resources'}" tabindex="${tab === 'resources' ? 0 : -1}">Workspaces and Gateways<span class="tab-n tnum">${resTotal}</span></a>
    </div>
  </div>`;
  let panel;
  if (tab === 'resources') {
    panel = `<div class="tasks-res-panel" id="live-tasks-resources">${typeof liveResHTML === 'function' && !LIVE.error ? liveResHTML({ always: true }) : ''}</div>`;
  } else {
    const table = all.length ? `
      <div class="tasks-tools">
        <label class="sr-only" for="live-tasks-q">Search tasks</label>
        <span class="tasks-search">${icon('search', 'sm')}<input class="input" id="live-tasks-q" type="search" placeholder="Search by name, goal, image or workspace" autocomplete="off" value="${esc(f.q)}"></span>
        <div class="seg" role="group" aria-label="Filter by state">${LIVE_TASK_FILTERS.map(([k, l, r]) => `<button type="button" data-action="live-tasks-filter" data-v="${k}" aria-pressed="${f.status === k}">${l}<span class="seg-n tnum">${count(r)}</span></button>`).join('')}</div>
      </div>
      <p class="sr-only" id="live-tasks-count" role="status"></p>
      <div class="card tasks-card" id="live-tasks-table">${liveTasksTableHTML(all)}</div>` : '';
    const empty = LIVE.loaded && !all.length && !LIVE.error ? `<div class="card card-pad" id="live-tasks-empty" style="margin-top:16px">
        <div class="live-title">No tasks yet</div>
        <p class="small sub" style="margin-top:4px;max-width:66ch">Start a task from a preset or YAML file, or launch a sample task to test logs and the interactive terminal.</p>
        <div class="btn-row" style="margin-top:14px"><a class="btn primary" href="#/new">${icon('plus', 'sm')}New task</a>${liveSampleBtnHTML(false)}</div>
      </div>` : '';
    panel = `${table}${empty}<p class="xsmall muted" style="margin-top:12px">${icon('terminal', 'xs')} The same list from the command line: <code>${esc(liveCmd(['get', 'tasks']))}</code></p>`;
  }
  const html = `
    <div class="head-row tasks-head"><div class="cuj-head">${axo(mood, { decorative: true, id: 'tasks-axo' })}<div class="cuj-head-copy">
        <div class="live-list-head" style="margin-top:0"><h1 tabindex="-1" id="live-tasks-title" style="margin-right:0">Tasks</h1>${liveListMetaHTML()}</div>
        <p class="lede" id="live-summary">${lede}</p></div></div>
      <div class="btn-row">${liveSampleBtnHTML(false)}<a class="btn primary" href="#/new">${icon('plus', 'sm')}New task</a></div></div>
    ${problem}${tabs}${panel}`;
  const crumbs = tab === 'resources' ? [{ label: 'Home', href: '#/' }, { label: 'Tasks', href: '#/tasks' }, { label: 'Workspaces and Gateways' }] : [{ label: 'Home', href: '#/' }, { label: 'Tasks' }];
  return { title: tab === 'resources' ? 'Workspaces and Gateways · Tasks' : 'Tasks', crumbs, html, wide: true };
}
/* ---------- A task's page ----------
   The header (title, then status, template, workspace and age, and Suspend or Resume and Delete), then two columns. On
   the left, tabs: Activity, Logs, Terminal and YAML. Switching tabs swaps only the panel. On the right: the task's
   state in AX's words, where it runs, and what it can reach. */
const LIVE_TASK_TABS = [['activity', 'Activity'], ['logs', 'Logs'], ['terminal', 'Terminal'], ['file', 'YAML']];
/* What AX's conditions say, in the UI's words. */
const LIVE_COND_WORDS = {
  WorkspaceReady: (ok) => (ok ? 'set up the workspace' : 'is setting up the workspace'),
  Ready: (ok, c) => (ok ? (c.reason === 'TaskRunning' ? 'started the task in its sandbox' : 'marked it ready')
    : c.reason === 'Suspended' ? 'suspended the task' : `says it isn't ready${c.reason ? ` (${c.reason})` : ''}`),
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
  return { id: '', name: image ? (typeof liveImageShort === 'function' ? liveImageShort(image) : image) : 'Default image', tile: byoTile('sm'), model };
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
    ['Debug access', spec.debug ? 'On: while it runs, Terminal can open a shell in its sandbox' : 'Off, so there is no shell into the sandbox'],
    ['Session', spec.sessionId ? `<span class="mono">${esc(spec.sessionId)}</span>` : ''],
    /* The sandbox's names in Agent Substrate (the actor and its uid), for kubectl and the worker's logs. */
    ['Sandbox', status.actor ? `<span class="mono">${esc(status.actor)}</span>${status.actorUid ? ` <span class="muted">· uid</span> <span class="mono">${esc(status.actorUid)}</span> <button class="btn ghost sm icon" data-action="copy" data-text="${esc(status.actorUid)}" aria-label="Copy the sandbox uid">${icon('copy', 'sm')}</button>` : ''}` : ''],
    ['Previous attempt', status.previousFailure ? esc(status.previousFailure) : ''],
    ['Labels', labels],
    ['Created', created && !isNaN(created) ? esc(created.toLocaleString()) : ''],
  ]);
  return `<h2 class="sr-only">Activity</h2>
    <ol class="timeline" id="live-timeline" aria-label="Activity">${events.map((e) => e.html).join('')}</ol>
    ${working ? `<div class="working" aria-hidden="true"><span class="dots"><i></i><i></i><i></i></span>Running · ${esc(liveAge(meta.createTime) || 'moments')}</div>` : ''}
    <p class="xsmall muted" style="margin-top:12px" id="live-task-note">${spec.debug
      ? `These are the steps AX records. What the task printed is in <a href="#/task/${encodeURIComponent(name)}/logs">Logs</a>.`
      : `These are the steps AX records. What the task printed is in <a href="#/task/${encodeURIComponent(name)}/logs">Logs</a>. It was started without debug access, so it has no shell.`}</p>
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
/** Suspend for a running task, Resume for a suspended one, as `ax suspend` and `ax resume` do. '' for neither. */
function liveSuspendResumeHTML(name, stateName, busy, cls) {
  const canSuspend = ['Working', 'Queued', 'Idle', 'RequiresAction'].includes(stateName);
  const canResume = stateName === 'Suspended';
  if (!canSuspend && !canResume) return '';
  const verb = canResume ? 'resume' : 'suspend';
  const label = busy ? `${LIVE_VERBS[busy].doing}…` : canResume ? 'Resume' : 'Suspend';
  return `<button type="button" class="btn ${cls || ''}" data-action="live-${verb}" data-task="${esc(name)}" ${busy ? 'disabled' : ''} title="${esc(liveCmd([verb, 'task', name]))}">${icon(busy ? 'loader' : canResume ? 'play' : 'pause', 'sm')}${label}</button>`;
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
      <div class="btn-row"><button type="button" class="btn ghost icon" data-action="live-copy-link" aria-label="Copy a link to this task" title="Copy a link to this task">${icon('link', 'sm')}</button>${liveSuspendResumeHTML(name, stateName, busy, '')}<button class="btn danger" data-action="live-delete" data-task="${esc(name)}" ${busy ? 'disabled' : ''}>Delete…</button></div>
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
  /* The task's command exited with an error while AX still calls the task running: its logs say so. */
  const exited = ['Working', 'Idle'].includes(stateName) && typeof liveLogsAgentExit === 'function' ? liveLogsAgentExit(name) : null;
  const nsTone = stateName === 'Failed' ? 'fail' : stateName === 'RequiresAction' || exited ? 'attn' : stateName === 'Completed' ? 'done' : stateName === 'Suspended' ? 'paused' : 'calm';
  const nsTitle = exited ? 'Its command stopped with an error'
    : stateName === 'Failed' ? 'Stopped with an error'
    : stateName === 'RequiresAction' ? 'Waiting for you'
      : stateName === 'Completed' ? 'Finished'
        : stateName === 'Suspended' ? 'Suspended'
          : stateName === 'Queued' ? 'Starting'
            : 'Running in its sandbox';
  const tab = (k, label) => `<a href="#/task/${encodeURIComponent(name)}/${k}">${label}</a>`;
  /* When AX says why it stopped, say what to change. */
  const remedy = /out of memory|oom/i.test(detail || '') ? ' Give it more memory when you start it again.' : '';
  const nsBody = (exited ? `Its command exited${exited.time ? ` at ${esc(exited.time)}` : ''}, though AX still shows the task as running. ${tab('logs', 'Logs')} has what it printed.`
    : stateName === 'Failed' ? (detail ? esc(detail) + remedy : `${tab('logs', 'Logs')} has what it printed.`)
    : stateName === 'Suspended' ? "Its sandbox is checkpointed and nothing is running. Resume it when you're ready."
      : stateName === 'Completed' ? `Its command finished. ${tab('logs', 'Logs')} has what it printed.`
        : spec.debug ? `Open a shell in ${tab('terminal', 'Terminal')}, or read ${tab('logs', 'Logs')}.`
          : `${tab('logs', 'Logs')} has what it prints.`)
    /* What AX says about the state, when it says something and the state isn't already explained by it. */
    + (detail && stateName !== 'Failed' ? ` <span class="ns-detail">AX says: ${esc(detail)}</span>` : '')
    + (typeof liveLogsNextHTML === 'function' && stateName !== 'Completed' ? liveLogsNextHTML(name) : '');
  const next = `<section class="card card-pad next-card s-${nsTone}" id="next-step" data-tone="${nsTone}" aria-labelledby="ns-k">
      <span class="ns-axel" aria-hidden="true">${axo(liveAxoMood(stateName), { decorative: true, cls: 'axo-ns' }).replace('<svg ', '<svg data-follow ')}</span>
      <h2 class="panel-title" id="ns-k">${nsTone === 'attn' || nsTone === 'fail' ? '<span class="ns-dot" aria-hidden="true"></span>' : ''}State</h2>
      <p class="ns-title">${nsTitle}</p><p class="ns-body">${nsBody}</p>
    </section>`;
  const limits = liveLimitsText(spec);
  const where = `<div class="card card-pad" id="live-where-card"><h2 class="panel-title">Where it runs</h2>
      <div class="where"><div><b>On this computer</b><span>In its own sandbox on ${esc(LIVE.context || 'ax-local')}</span></div></div>
      <dl class="kv xsmall" style="margin-top:12px">${spec.profile && spec.profile.image ? `<dt>Image</dt><dd><span class="img-short"><span class="mono" title="${esc(spec.profile.image)}">${esc(typeof liveImageShort === 'function' ? liveImageShort(spec.profile.image) : spec.profile.image)}</span><button class="btn ghost sm icon" data-action="copy" data-text="${esc(spec.profile.image)}" aria-label="Copy the image address">${icon('copy', 'sm')}</button></span></dd>` : ''}${limits ? `<dt>Limits</dt><dd>${esc(limits)}</dd>` : ''}${status.attempt ? `<dt>Attempt</dt><dd>${esc(status.attempt)}</dd>` : ''}</dl>
    </div>`;
  const gw = spec.gateway && spec.gateway.name;
  const reach = `<div class="card card-pad" id="live-ns-guard-card">${liveReachHTML(gw)}</div>`;
  return next + where + reach;
}
function liveViewTask(name, tab) {
  const row = LIVE.tasks.find((t) => t.name === name);
  const det = LIVE.detail[name];
  const doc = det && det.doc;
  const crumbs = [{ label: 'Home', href: '#/' }, { label: 'Tasks', href: '#/tasks' }, { label: name }];
  if ((!row && !doc) || (det && det.missing && !row)) {
    const html = LIVE.loaded
      ? `<div class="page-head"><h1 tabindex="-1">${esc(name)} isn't on this cluster</h1><p class="lede">It may have been deleted, or it's in another atespace.</p></div>
         <div class="btn-row"><a class="btn" href="#/">Tasks</a></div>`
      : `<div class="page-head"><h1 tabindex="-1">${esc(name)}</h1><p class="lede">Loading…</p></div>`;
    return { title: name, crumbs, html };
  }
  const t = liveTask(doc || (row && row.doc));
  if (row) { t.session = row.session || t.session; }
  const spec = (t.doc && t.doc.spec) || {}, status = (t.doc && t.doc.status) || {}, meta = (t.doc && t.doc.metadata) || {};
  const stateName = row ? row.state : t.state;
  const busy = LIVE.busy[name];
  const tpl = liveTaskTemplate(spec);
  /* Every task has a Terminal tab: one that can't have a shell says why. */
  const tabs = LIVE_TASK_TABS;
  tab = tabs.some(([k]) => k === tab) ? tab : 'activity';
  /* The logs are read as the page opens too, so the Logs tab and the Next card can say when the agent logged an error. */
  if (typeof liveLogsWanted === 'function') liveLogsWanted(name);
  if (spec.workspace && spec.workspace.name && typeof liveResWanted === 'function') liveResWanted();
  const logErr = typeof liveLogsError === 'function' && !!liveLogsError(name);
  const events = liveActivityEvents(name, t, stateName, spec, status, meta, tpl);
  const panel = tab === 'logs' ? liveLogsHTML(name, t, stateName)
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
            ${tabs.map(([k, l]) => `<a role="tab" id="tab-${k}" href="#/task/${encodeURIComponent(name)}${k === 'activity' ? '' : '/' + k}" aria-selected="${tab === k}"${tab === k ? ` aria-controls="panel-${k}"` : ''} tabindex="${tab === k ? 0 : -1}">${l}${k === 'logs' ? `<span class="tab-dot" id="dot-logs" ${logErr ? '' : 'hidden'}><span class="sr-only">, has an error</span></span>` : ''}</a>`).join('')}
          </div>
          <div class="tabs-tools"><span class="xsmall muted tt-meta">${tab === 'logs' ? 'From the Agent Substrate worker' : `${plural(events.length, 'event')} · recorded by AX`}</span></div>
        </div>
        <div role="tabpanel" class="task-panel" id="panel-${tab}" aria-labelledby="tab-${tab}" tabindex="0">${panel}</div>
      </div>
      <aside class="side" id="live-task-side" aria-label="Task details">${liveTaskSideHTML(name, t, stateName, spec, status, busy)}</aside>
    </div>`;
  /* Once the Terminal tab is on screen, its shell goes on it (a task that can have one gets one the first time). */
  const after = tab === 'terminal' ? () => liveTermShown(name, !liveTermWhyNot(t, stateName)) : null;
  return { title: t.goal ? t.goal.split('\n')[0].slice(0, 60) : name, crumbs, html, wide: true, after };
}
const LIVE_HIDDEN = { guardrails: 'Guardrails' };
function liveViewNotYet(part) {
  const what = LIVE_HIDDEN[part] || 'This page';
  const html = `<div class="page-head"><h1 tabindex="-1">${what} isn't connected to AX yet</h1>
      <p class="lede">Studio shows what AX can back today. Your tasks and AX on this computer are real.</p></div>
    <div class="btn-row"><a class="btn primary" href="#/">Home</a><a class="btn" href="#/tasks">Tasks</a><a class="btn" href="#/places">Local cluster</a></div>`;
  return { title: what, crumbs: [{ label: 'Home', href: '#/' }, { label: what }], html };
}

/* ---------- The app frame ---------- */
function liveShellHTML() {
  return `
  <div class="app live">
    <aside class="sidebar" aria-label="Primary">
      <a class="brand" href="#/" aria-label="AX Studio home">${BRAND_MARK}<span class="brand-name">AX <span>Studio</span></span></a>
      <a class="btn primary new-btn" href="#/new" id="live-new" aria-label="New task">${icon('plus', 'sm')}<span class="label">New task</span></a>
      <nav class="nav" aria-label="Main">
        <a href="#/" data-nav="home" id="nav-home">${icon('home')}<span class="label">Home</span></a>
        <a href="#/tasks" data-nav="tasks" id="nav-tasks">${icon('layers')}<span class="label">Tasks</span><span class="count attn" id="live-nav-needs" hidden></span></a>
        <a href="#/places" data-nav="places" id="nav-places">${icon('server')}<span class="label">Local cluster</span></a>
        <a href="#/settings" data-nav="settings" id="nav-settings">${icon('sliders')}<span class="label">Settings</span></a>
      </nav>
      <div class="nav nav-tasks" role="navigation" aria-label="Tasks"><div class="nav-label">Recent</div><div id="live-nav-tasks"></div></div>
      <div class="sidebar-foot" id="live-foot"></div>
    </aside>
    <div class="main">
      <div class="sanctuary-atmo" aria-hidden="true"></div>
      <header class="topbar">
        <div class="tb-left"><nav class="crumbs" aria-label="Breadcrumb" id="crumbs"></nav></div>
        <div class="topbar-actions"><button class="search-trigger" data-action="palette" id="search-trigger" aria-label="Search or run a command (${MOD}K)">${icon('search', 'sm')}<span class="st-label">Search or run a command</span><span class="kbds" aria-hidden="true"><kbd>${MOD}</kbd><kbd>K</kbd></span></button>
          <button class="round-btn" id="theme-toggle" data-action="theme-toggle"></button>
          <button class="round-btn" id="shortcuts-btn" data-action="shortcuts" aria-label="Keyboard shortcuts">${icon('keyboard')}</button></div>
      </header>
      <main id="main" tabindex="-1"></main>
    </div>
  </div>`;
}
function liveFootStatus() {
  /* Setup, start, update, stop or remove of AX on this computer, while it runs. */
  const op = LIVE.op;
  const opHere = liveOpRunning() && liveOpIsLocal(op);
  const setup = opHere || !LIVE.context || liveLocalDown();
  const bad = LIVE.phase !== 'ready' || !!LIVE.error || setup;
  const title = LIVE.phase === 'offline' ? 'Not connected' : 'This computer';
  const sub = LIVE.phase === 'starting' ? 'Connecting…' : LIVE.phase === 'offline' ? "AX Studio isn't answering"
    : opHere ? `${typeof liveOpShort === 'function' ? liveOpShort(op) : 'Working'}…` : !LIVE.context ? 'AX is not set up' : liveLocalDown() ? (LIVE.local.state === 'Stopped' ? 'AX is stopped' : 'AX is not set up')
      : LIVE.error ? LIVE_ERROR_WORDS[liveErrorKind()].foot : `Connected · ${plural(LIVE.tasks.filter((t) => liveState(t.state).active).length, 'running', 'running')}`;
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
    const { bad, title, sub } = liveFootStatus();
    foot.innerHTML = `<a class="health-card ${bad ? 'attn' : ''}" href="#/places" id="live-health" aria-label="${esc(title)}: ${esc(sub)}. Open Local cluster.">${icon('laptop')}<span class="hc-text"><span class="hc-title">${esc(title)}</span><span class="hc-sub">${esc(sub)}</span></span></a>`;
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
  /* While you type in the search on Tasks, a refresh redraws only the table. */
  if (opts.background && !moved && r.parts[0] === 'tasks' && LIVE.phase === 'ready' && $('.app.live', root) && isTypingIn('#main')) {
    const tbl = $('#live-tasks-table'); if (tbl) tbl.innerHTML = liveTasksTableHTML();
    liveChrome('tasks');
    return;
  }
  /* While you type in AX images on Setup or Local cluster, don't clobber the input on a background refresh. */
  const onEnv = r.parts[0] === 'places' || r.parts[0] === 'setup' || (!r.parts[0] && (!LIVE.context || liveLocalDown()));
  if (opts.background && !moved && onEnv && LIVE.phase === 'ready' && $('.app.live', root) && isTypingIn('#main')) {
    liveChrome(r.parts[0] === 'places' || r.parts[0] === 'setup' ? 'places' : 'home');
    return;
  }
  let v, top = 'home';
  if (LIVE.phase === 'starting') v = liveViewStarting();
  else if (LIVE.phase === 'offline') v = liveViewOffline();
  /* Until AX runs on this computer, every page but Local cluster and Settings is setup. */
  else if (LIVE.loaded && (!LIVE.context || liveLocalDown()) && !['places', 'setup', 'settings'].includes(r.parts[0])) v = liveViewSetup(!r.parts[0]);
  else if (!r.parts[0]) v = liveViewHome();
  else if (r.parts[0] === 'tasks') { v = liveViewTasks(r.parts[1]); top = 'tasks'; }
  else if (r.parts[0] === 'task') { v = liveViewTask(decodeURIComponent(r.parts[1] || ''), r.parts[2]); top = 'tasks'; }
  else if (r.parts[0] === 'places') { v = liveViewPlaces(); top = 'places'; }
  else if (r.parts[0] === 'setup') { v = liveViewSetup(false); top = 'places'; }
  else if (r.parts[0] === 'new') { v = liveViewNew(); top = ''; }
  else if (r.parts[0] === 'settings') { v = liveViewSettings(r.parts[1]); top = 'settings'; }
  else { v = liveViewNotYet(r.parts[0]); top = ''; }
  if (!$('.app.live', root)) root.innerHTML = liveShellHTML();
  /* A shell on screen isn't redrawn by a refresh in the background: the page around it is. */
  if (opts.background && !moved && r.parts[0] === 'task' && r.parts[2] === 'terminal' && liveTermPatchPage(v)) {
    renderCrumbs(v.crumbs || []);
    state.docTitle = v.title + ' · AX Studio';
    liveChrome(top);
    return;
  }
  const fk = focusKeyOf(document.activeElement);
  /* Typing in a shell carries on after the page is drawn again around it. */
  const act = document.activeElement;
  LIVE.termRefocus = !moved && !!(act && act.closest && act.closest('#live-term-screen'));
  /* Switching tabs on one task or between Tasks tabs swaps smoothly without scrolling back to top. */
  const prev = (LIVE.lastPath || '').split('/').filter(Boolean);
  const tabSwitch = moved && LIVE.lastPath !== null && ((r.parts[0] === 'task' && prev[0] === 'task' && prev[1] === r.parts[1]) || (r.parts[0] === 'tasks' && prev[0] === 'tasks'));
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
  LIVE.termRefocus = false;
}

function livePaletteItems() {
  const r = parseRoute();
  const items = [];
  const go = (h) => () => { location.hash = h; };
  items.push(
    { group: 'Go to', label: 'Home', icon: 'home', cli: '', run: go('#/') },
    { group: 'Go to', label: 'New task', icon: 'plus', cli: liveCmd(['apply', '-f', 'task.yaml']), run: go('#/new'), keys: 'N' },
    { group: 'Go to', label: 'Tasks', icon: 'layers', cli: liveCmd(['get', 'tasks']), run: go('#/tasks') },
    { group: 'Go to', label: 'Workspaces and Gateways', icon: 'folder', cli: liveCmd(['get', 'workspaces']), run: go('#/tasks/resources') },
    { group: 'Go to', label: 'Local cluster', icon: 'server', cli: 'ax local status', run: go('#/places') },
    { group: 'Go to', label: 'Settings', icon: 'sliders', cli: '', run: go('#/settings') },
  );
  if (r.parts[0] === 'task' && r.parts[1]) {
    const name = decodeURIComponent(r.parts[1]);
    const row = LIVE.tasks.find((t) => t.name === name);
    const st = row ? row.state : '';
    if (['Working', 'Queued', 'Idle', 'RequiresAction'].includes(st)) {
      items.push({ group: 'This task', label: `Suspend ${name}`, icon: 'pause', cli: liveCmd(['suspend', 'task', name]), run: () => liveTaskAction(name, 'suspend') });
    }
    if (st === 'Suspended') {
      items.push({ group: 'This task', label: `Resume ${name}`, icon: 'play', cli: liveCmd(['resume', 'task', name]), run: () => liveTaskAction(name, 'resume') });
    }
    if (row && row.debug) {
      items.push({ group: 'This task', label: 'Open shell in sandbox', icon: 'terminal', cli: liveCmd(['ssh', name]), run: () => { location.hash = `#/task/${encodeURIComponent(name)}/terminal`; liveTermOpen(name); } });
    }
    items.push({ group: 'This task', label: 'Delete task…', icon: 'trash', cli: liveCmd(['delete', 'task', name]), run: () => liveOpenDelete(name) });
  }
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
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && el && el.id === 'live-new-goal') {
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
