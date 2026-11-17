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

   Inside the Studio app the page gets window.studio, the app's bridge to this computer: it runs ax and kubectl.
   With the bridge, the pages in this file show real data from AX, and every page that has no real source yet stays
   hidden. In a browser there is no bridge, so the app runs on demo data and nothing in this file is used.

   Real today:
   - the clusters in your kubeconfig (ax ctx) and AX on this computer (ax local status)
   - the task list and each task's state (ax get tasks)
   - a task's details and its task file (ax get task)
   - pause, resume and delete (ax suspend task, ax resume task, ax delete task)

   Studio never changes your kubeconfig. It names the cluster on every command (--context). */

const LIVE = {
  on: typeof window !== 'undefined' && !!window.studio,
  phase: 'starting',     // starting, no-ax or ready
  started: false,
  axPath: 'ax',
  axVersion: '',
  axError: '',
  contexts: [],          // { name, cluster, current, tunnel }, from ax ctx
  contextsError: '',
  context: '',           // the cluster Studio talks to
  atespace: 'default',
  local: null,           // { cluster, state, context, substrate, server } from ax local status, or { error }
  tasks: [],             // { name, atespace, state, actor, age }, from ax get tasks
  detail: {},            // task name -> { yaml, doc, error }
  error: '',             // why the last ax get tasks failed
  loaded: false,         // the first task list has arrived (or failed)
  refreshedAt: 0,
  placesAt: 0,
  busy: {},              // task name -> 'suspend', 'resume' or 'delete'
  loading: false,
  lastPath: null,
};
const LIVE_POLL_MS = 4000;
const LIVE_PLACES_MS = 15000;
const LIVE_CONTEXT_KEY = 'ax.live.context';
const LIVE_INSTALL = 'curl -fsSL https://github.com/google/ax/releases/latest/download/install.sh | sh';

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
function liveState(s) { return LIVE_STATES[s] || { label: s || 'Unknown', chip: 'paused', icon: 'clock', rank: 2 }; }
/** "TASK_STATE_REQUIRES_ACTION" (the task file) -> "RequiresAction" (the task list). */
function liveStateName(v) {
  return String(v || '').replace(/^TASK_STATE_/, '').toLowerCase().split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('') || 'Unknown';
}

/* ---------- Running commands ---------- */
/** The last line of what a command printed on failure, without the CLI's "Error: " prefix. */
function liveErrorLine(r) {
  const lines = String((r && (r.stderr || r.stdout)) || '').split('\n').map((l) => l.trim()).filter(Boolean);
  return (lines[lines.length - 1] || 'The command failed').replace(/^Error:\s*/i, '');
}
async function liveRun(program, args, stdin) {
  try {
    const r = await window.studio.run({ program, args, stdin });
    return { ok: r.status === 0, status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.status === 0 ? '' : liveErrorLine(r) };
  } catch (e) {
    return { ok: false, status: -1, stdout: '', stderr: '', error: String((e && e.message) || e) };
  }
}
/** Every command about tasks names the cluster and the atespace, so your kubeconfig is never changed. */
function liveScope() { return (LIVE.context ? ['--context', LIVE.context] : []).concat(['-a', LIVE.atespace]); }
function liveAx(args, stdin) { return liveRun(LIVE.axPath, liveScope().concat(args), stdin); }
/** The same command as text, to show and copy. */
function liveCmd(args) { return ['ax'].concat(LIVE.context ? ['--context', LIVE.context] : [], args).join(' '); }

/* ---------- Reading what the CLI prints ---------- */
/** A table as the CLI prints it: a header, then one row per line, with columns lined up by spaces. Cells are cut at
    the header's column positions, so a cell can be empty or contain spaces. */
function liveParseTable(text) {
  const lines = String(text || '').split('\n').filter((l) => l.trim());
  if (!lines.length) return [];
  const cols = [];
  const re = /\S+(?: \S+)*/g; // a column name may hold single spaces ("AX TUNNEL"); two or more spaces end it
  let m;
  while ((m = re.exec(lines[0]))) cols.push({ key: m[0], at: m.index });
  return lines.slice(1).map((line) => {
    const row = {};
    cols.forEach((c, i) => { row[c.key] = line.slice(c.at, i + 1 < cols.length ? cols[i + 1].at : undefined).trim(); });
    return row;
  });
}
function liveParseTasks(text) {
  return liveParseTable(text).filter((r) => r.NAME).map((r) => ({
    name: r.NAME, atespace: r.ATESPACE || 'default', state: r.STATE || 'Unknown', actor: /^(<none>|-)?$/.test(r.ACTOR || '') ? '' : r.ACTOR, age: r.AGE || '',
  }));
}
function liveParseContexts(text) {
  const one = /^Active Kubernetes Context:\s*(\S+)/m.exec(String(text || ''));
  if (one) return [{ name: one[1], cluster: '', current: true, tunnel: '' }];
  return liveParseTable(text).filter((r) => r.NAME).map((r) => ({
    name: r.NAME, cluster: r.CLUSTER || '', current: r.CURRENT === '*', tunnel: (/\((\w+)\)\s*$/.exec(r['AX TUNNEL'] || '') || [])[1] || '',
  }));
}
/** "Key:   value" lines, as ax local status prints them. */
function liveParseLocal(text) {
  const o = {};
  String(text || '').split('\n').forEach((l) => { const m = /^([A-Za-z ]+):\s*(.*)$/.exec(l.trim()); if (m) o[m[1].trim()] = m[2].trim(); });
  if (!o.State) return null;
  return { cluster: o.Cluster || '', state: o.State, context: o['Kube Context'] || '', substrate: o.Substrate || '', server: o['AX Server'] || '' };
}

/* ---------- Loading ---------- */
function liveRouteTask() { const r = parseRoute(); return r.parts[0] === 'task' && r.parts[1] ? decodeURIComponent(r.parts[1]) : ''; }
function liveSnapshot() {
  const cur = liveRouteTask();
  return JSON.stringify([LIVE.phase, LIVE.tasks, LIVE.error, LIVE.contexts, LIVE.contextsError, LIVE.local, LIVE.context, LIVE.busy, LIVE.loaded, cur && LIVE.detail[cur]]);
}
/** Finds ax: on the PATH the app uses, or where AX's installer puts it (~/.ax/bin). */
async function liveFindAx() {
  try {
    if (await window.studio.which('ax')) return 'ax';
    const p = await window.studio.platform();
    const sep = p.os === 'win32' ? '\\' : '/';
    const guess = [p.home, '.ax', 'bin', p.os === 'win32' ? 'ax.exe' : 'ax'].join(sep);
    if (await window.studio.fileExists(guess)) return guess;
  } catch (e) { /* fall through: try the plain name */ }
  return 'ax';
}
async function liveStart() {
  if (!LIVE.on || LIVE.started) return;
  LIVE.started = true;
  Object.assign(ACTIONS, LIVE_ACTIONS);
  state.tasks = []; // no demo tasks in the app, so the simulated agents have nothing to run
  await liveConnect();
  setInterval(() => { if (!document.hidden) liveRefresh(); }, LIVE_POLL_MS);
}
async function liveConnect() {
  LIVE.phase = 'starting';
  LIVE.axPath = await liveFindAx();
  const v = await liveRun(LIVE.axPath, ['version']);
  if (!v.ok) { LIVE.phase = 'no-ax'; LIVE.axError = v.error; render(); return; }
  LIVE.axVersion = v.stdout.trim().replace(/^ax version\s*/i, '');
  LIVE.phase = 'ready';
  await liveLoadContexts();
  /* Checking AX on this computer can take a while, so the task list doesn't wait for it. */
  liveLoadLocal().then(() => render({ keepScroll: true, background: true }));
  await liveRefresh(true);
}
/** The clusters in your kubeconfig, and AX on this computer. */
function liveLoadPlaces() {
  LIVE.placesAt = Date.now();
  return Promise.all([liveLoadContexts(), liveLoadLocal()]);
}
async function liveLoadLocal() {
  const l = await liveRun(LIVE.axPath, ['local', 'status']);
  LIVE.local = liveParseLocal(l.stdout) || { error: l.ok ? 'ax local status printed nothing Studio could read.' : l.error };
}
async function liveLoadContexts() {
  const c = await liveRun(LIVE.axPath, ['ctx']);
  LIVE.contexts = c.ok ? liveParseContexts(c.stdout) : [];
  LIVE.contextsError = c.ok ? '' : c.error;
  let saved = '';
  try { saved = localStorage.getItem(LIVE_CONTEXT_KEY) || ''; } catch (e) { /* ignore */ }
  const names = LIVE.contexts.map((x) => x.name);
  if (!names.includes(LIVE.context)) LIVE.context = names.includes(saved) ? saved : (LIVE.contexts.find((x) => x.current) || LIVE.contexts[0] || { name: '' }).name;
}
async function liveLoadTask(name) {
  const r = await liveAx(['get', 'task', name]);
  if (!r.ok) { LIVE.detail[name] = Object.assign({}, LIVE.detail[name], { error: r.error }); return; }
  let doc = null;
  try { if (typeof window.studio.parseYAML === 'function') doc = (await window.studio.parseYAML(r.stdout))[0] || null; } catch (e) { /* the task file still shows as text */ }
  LIVE.detail[name] = { yaml: r.stdout, doc, error: '' };
}
async function liveRefresh(force) {
  if (LIVE.phase !== 'ready' || (LIVE.loading && !force)) return;
  LIVE.loading = true;
  const ctx = LIVE.context;
  const before = liveSnapshot();
  try {
    if (parseRoute().parts[0] === 'places' && (force || Date.now() - LIVE.placesAt >= LIVE_PLACES_MS)) await liveLoadPlaces();
    const r = await liveAx(['get', 'tasks']);
    if (ctx !== LIVE.context) return; // you picked another cluster while this was on its way
    if (r.ok) { LIVE.tasks = liveParseTasks(r.stdout); LIVE.error = ''; } else LIVE.error = r.error;
    LIVE.loaded = true;
    LIVE.refreshedAt = Date.now();
    const cur = liveRouteTask();
    if (cur) await liveLoadTask(cur);
  } finally {
    LIVE.loading = false;
  }
  if (force || liveSnapshot() !== before) render({ keepScroll: true, background: true });
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
  const r = await liveAx([verb, 'task', name]);
  delete LIVE.busy[name];
  if (r.ok) {
    toast(`${w.done} <span class="mono">${esc(name)}</span>`, { icon: verb === 'delete' ? 'trash' : 'check' });
    if (verb === 'delete') { delete LIVE.detail[name]; LIVE.tasks = LIVE.tasks.filter((t) => t.name !== name); if (liveRouteTask() === name) location.hash = '#/'; }
  } else {
    toast(`${w.fail} <span class="mono">${esc(name)}</span>: ${esc(r.error)}`, { icon: 'alert', timeout: 9000 });
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
  'live-recheck': () => { LIVE.started = true; liveConnect(); render(); },
  'live-refresh': () => liveRefresh(true),
  'live-suspend': (el) => liveTaskAction(el.dataset.task, 'suspend'),
  'live-resume': (el) => liveTaskAction(el.dataset.task, 'resume'),
  'live-delete': (el) => liveOpenDelete(el.dataset.task),
  'live-use-context': (el) => {
    const name = el.dataset.context;
    if (!name || name === LIVE.context) return;
    LIVE.context = name;
    try { localStorage.setItem(LIVE_CONTEXT_KEY, name); } catch (e) { /* ignore */ }
    LIVE.tasks = []; LIVE.detail = {}; LIVE.error = ''; LIVE.loaded = false;
    render({ keepScroll: true });
    announce(`Using ${name}`);
    liveRefresh(true);
  },
};

/* ---------- Small pieces ---------- */
function liveChip(s) { const d = liveState(s); return `<span class="chip ${d.chip}" title="AX state: ${esc(s)}">${icon(d.icon)}${d.label}</span>`; }
function liveIsLocal(context) { return !!(LIVE.local && LIVE.local.context && LIVE.local.context === context); }
function liveWhere(context) {
  return liveIsLocal(context) ? `<span class="env" title="${esc(context)}">${icon('laptop')}On this computer</span>` : `<span class="env" title="${esc(context)}">${icon('cloud')}${esc(context || 'Current cluster')}</span>`;
}
function liveSorted() { return LIVE.tasks.slice().sort((a, b) => liveState(a.state).rank - liveState(b.state).rank || a.name.localeCompare(b.name)); }
/** A banner for "the command failed": what Studio ran, and what AX said. */
function liveProblemHTML(title, message, cmd) {
  return `<div class="card card-pad" role="alert" style="margin-top:14px">
    <div style="display:flex;gap:10px;align-items:flex-start">${icon('alert')}<div style="min-width:0;flex:1">
      <div class="live-title">${title}</div>
      <p class="small" style="margin-top:4px;overflow-wrap:anywhere">${esc(message)}</p>
      ${cmd ? `<div style="margin-top:10px">${cliHint(cmd)}</div>` : ''}
      <div class="btn-row" style="margin-top:12px"><button class="btn sm" data-action="live-refresh">${icon('refresh', 'sm')}Try again</button><a class="btn ghost sm" href="#/places">Where agents run</a></div>
    </div></div></div>`;
}

/* ---------- Pages ---------- */
function liveViewStarting() {
  return { title: 'Connecting', crumbs: [{ label: 'Home' }], html: `<div class="page-head"><h1 tabindex="-1">Connecting to AX…</h1><p class="lede">Looking for the <code>ax</code> command on this computer.</p></div>` };
}
function liveViewNoAx() {
  const html = `
    <div class="page-head"><h1 tabindex="-1">AX isn't installed on this computer yet</h1>
      <p class="lede">AX Studio uses the <code>ax</code> command to reach AX. Install it, then check again.</p></div>
    <div class="card card-pad">
      <div class="live-title">1. Install ax</div>
      <div style="margin-top:8px">${cliHint(LIVE_INSTALL)}</div>
      <p class="small" style="margin-top:8px">It goes into <span class="mono">~/.ax/bin</span>. Nothing else on this computer changes, and it never asks for your password.</p>
      <div class="live-title" style="margin-top:16px">2. Start AX on this computer, or pick a remote cluster</div>
      <div style="margin-top:8px">${cliHint('ax local start')}</div>
      <p class="small" style="margin-top:8px">A local AX needs a container runtime that is already running, such as Docker Desktop, OrbStack or Colima.</p>
      <div class="btn-row" style="margin-top:16px"><button class="btn primary" data-action="live-recheck">${icon('refresh', 'sm')}Check again</button></div>
      <p class="xsmall muted" style="margin-top:12px;overflow-wrap:anywhere">What Studio saw: ${esc(LIVE.axError || 'ax was not found')}</p>
    </div>`;
  return { title: 'Install AX', crumbs: [{ label: 'Home' }], html };
}
function liveRowHTML(t) {
  const d = liveState(t.state);
  const busy = LIVE.busy[t.name];
  return `<a class="task-row" href="#/task/${encodeURIComponent(t.name)}" id="live-row-${esc(t.name)}" aria-label="${esc(t.name)}, ${d.label}">
    <div style="min-width:0">
      <div class="t-title">${esc(t.name)}</div>
      <div class="t-meta"><span>Created ${esc(t.age || 'just now')}${t.age ? ' ago' : ''}</span>${t.atespace !== 'default' ? `<span class="dot"></span><span class="mono">${esc(t.atespace)}</span>` : ''}</div>
    </div>
    <div class="t-right">${busy ? `<span class="chip stopping">${icon('loader')}${LIVE_VERBS[busy].doing}</span>` : liveChip(t.state)}</div>
  </a>`;
}
function liveViewHome() {
  const list = liveSorted();
  const count = (f) => list.filter(f).length;
  const needs = count((t) => liveState(t.state).rank === 0), active = count((t) => liveState(t.state).active), paused = count((t) => t.state === 'Suspended');
  const summary = !LIVE.loaded ? 'Loading your tasks…'
    : LIVE.error ? `Studio can't reach AX right now.${list.length ? ' This is the last list it got.' : ''}`
      : `${plural(list.length, 'task')}${list.length ? `: ${[needs && `${needs} ${needs === 1 ? 'needs' : 'need'} you`, active && `${active} running`, paused && `${paused} paused`].filter(Boolean).join(', ') || 'none running'}` : ''}.`;
  const problem = LIVE.error ? liveProblemHTML(`Can't reach AX on ${esc(LIVE.context || 'this cluster')}`, LIVE.error, liveCmd(['get', 'tasks'])) : '';
  const body = !LIVE.loaded ? ''
    : list.length ? `${problem}<div class="card" id="live-tasks" style="margin-top:14px;padding:6px">${list.map(liveRowHTML).join('')}</div>`
      : problem || `<div class="card card-pad" id="live-empty" style="margin-top:14px">
            <div class="live-title">No tasks here yet</div>
            <p class="small" style="margin-top:4px;max-width:70ch">Tasks on this cluster show up here as soon as they're created. Starting a task from Studio isn't connected yet, so create one from the command line. A new task starts paused, so resume it to run it.</p>
          <div style="margin-top:12px;display:grid;gap:8px">${cliHint(liveCmd(['apply', '-f', 'task.yaml']))}${cliHint(liveCmd(['resume', 'task', '<name>']))}</div></div>`;
  const html = `
    <div class="page-head"><h1 tabindex="-1">Your tasks</h1>
      <p class="lede" id="live-summary">${summary}</p></div>
    <div class="btn-row" style="margin-top:10px">${liveWhere(LIVE.context)}<a class="btn ghost sm" href="#/places">Change cluster</a></div>
    ${body}
    <p class="xsmall muted" style="margin-top:12px">${icon('terminal', 'xs')} The same list from the command line: <code>${esc(liveCmd(['get', 'tasks']))}</code></p>`;
  return { title: 'Your tasks', crumbs: [{ label: 'Home' }], html, wide: true };
}
function liveKV(rows) {
  return `<dl class="kv">${rows.filter((r) => r && r[1] != null && r[1] !== '').map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
}
function liveViewTask(name) {
  const row = LIVE.tasks.find((t) => t.name === name);
  const det = LIVE.detail[name];
  const doc = det && det.doc;
  const crumbs = [{ label: 'Home', href: '#/' }, { label: name }];
  if (!row && !det) {
    const html = LIVE.loaded
      ? `<div class="page-head"><h1 tabindex="-1">${esc(name)} isn't on this cluster</h1><p class="lede">It may have been deleted, or it lives on another cluster.</p></div>
         <div class="btn-row"><a class="btn" href="#/">Your tasks</a><a class="btn ghost" href="#/places">Change cluster</a></div>`
      : `<div class="page-head"><h1 tabindex="-1">${esc(name)}</h1><p class="lede">Loading…</p></div>`;
    return { title: name, crumbs, html };
  }
  const spec = (doc && doc.spec) || {}, status = (doc && doc.status) || {}, meta = (doc && doc.metadata) || {};
  const stateName = row ? row.state : liveStateName(status.state);
  const busy = LIVE.busy[name];
  const canPause = ['Working', 'Queued', 'Idle', 'RequiresAction'].includes(stateName);
  const canResume = stateName === 'Suspended';
  const limits = (spec.profile && spec.profile.resources && spec.profile.resources.limits) || {};
  const conds = (status.conditions || []).map((c) => `${esc(c.type)}: ${esc(c.status)}${c.reason ? ` (${esc(c.reason)})` : ''}${c.message ? ` · ${esc(c.message)}` : ''}`).join('<br>');
  const detail = status.statusDetail && (status.statusDetail.detail || status.statusDetail.reason);
  const labels = Object.keys(meta.labels || {}).map((k) => `<span class="mono">${esc(k)}=${esc(meta.labels[k])}</span>`).join(' ');
  const cmd = (spec.commands && spec.commands.length ? spec.commands : status.resolvedArgv) || [];
  const created = meta.createTime ? new Date(meta.createTime) : null;
  const details = doc ? liveKV([
    ['Goal', spec.goal && spec.goal.text ? esc(spec.goal.text) : ''],
    ['State', `${liveState(stateName).label} <span class="muted">(AX: ${esc(stateName)})</span>${detail ? `<br>${esc(detail)}` : ''}`],
    ['Checks', conds],
    ['Image', spec.profile && spec.profile.image ? `<span class="mono">${esc(spec.profile.image)}</span>` : "AX's default task image"],
    ['Command', cmd.length ? `<span class="mono">${esc(cmd.join(' '))}</span>` : "The image's own command"],
    ['Workspace', spec.workspace && spec.workspace.name ? `<span class="mono">${esc(spec.workspace.name)}</span>${spec.workspace.path ? ` at <span class="mono">${esc(spec.workspace.path)}</span>` : ''}` : 'None: an empty <span class="mono">/workspace</span>'],
    ['Network', spec.gateway && spec.gateway.name ? `Gateway <span class="mono">${esc(spec.gateway.name)}</span>` : 'No gateway, so no network access'],
    ['Limits', limits.cpu || limits.memory ? esc([limits.cpu && `${limits.cpu} CPU`, limits.memory && `${limits.memory} memory`].filter(Boolean).join(' · ')) : ''],
    ['Terminal', spec.debug ? `On. Open a shell with <code>${esc(liveCmd(['ssh', name]))}</code>` : 'Off: this task was created without <span class="mono">debug</span>'],
    ['Session', spec.sessionId ? `<span class="mono">${esc(spec.sessionId)}</span>` : ''],
    ['Labels', labels],
    ['Created', created && !isNaN(created) ? esc(created.toLocaleString()) : ''],
  ]) : det && det.error ? '' : '<p class="small muted">Loading the task…</p>';
  const html = `
    <div class="page-head">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><h1 tabindex="-1" style="margin:0">${esc(name)}</h1>${busy ? `<span class="chip stopping">${icon('loader')}${LIVE_VERBS[busy].doing}</span>` : liveChip(stateName)}${liveWhere(LIVE.context)}</div>
    </div>
    <div class="btn-row" id="live-task-actions">
      ${canResume ? `<button class="btn primary" data-action="live-resume" data-task="${esc(name)}" ${busy ? 'disabled' : ''}>${icon('play', 'sm')}Resume</button>` : ''}
      ${canPause ? `<button class="btn" data-action="live-suspend" data-task="${esc(name)}" ${busy ? 'disabled' : ''}>${icon('pause', 'sm')}Pause</button>` : ''}
      <button class="btn danger" data-action="live-delete" data-task="${esc(name)}" ${busy ? 'disabled' : ''}>${icon('trash', 'sm')}Delete…</button>
    </div>
    ${det && det.error ? liveProblemHTML(`Couldn't read ${esc(name)}`, det.error, liveCmd(['get', 'task', name])) : ''}
    <section class="card card-pad" style="margin-top:14px" aria-labelledby="live-details"><h2 id="live-details" class="h-display-sm">Details</h2><div style="margin-top:12px">${details}</div></section>
    ${det && det.yaml ? `<section class="card card-pad" style="margin-top:14px" aria-labelledby="live-file">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px"><h2 id="live-file" class="h-display-sm">Task file</h2><button class="btn ghost sm" data-action="copy" data-text="${esc(det.yaml)}">${icon('copy', 'sm')}Copy</button></div>
      <pre class="manifest" style="margin-top:12px" tabindex="0" aria-label="Task file">${esc(det.yaml)}</pre>
      <p class="xsmall muted" style="margin-top:10px">${icon('terminal', 'xs')} <code>${esc(liveCmd(['get', 'task', name]))}</code></p></section>` : ''}
    <p class="xsmall muted" style="margin-top:12px">Activity, Changes and the log aren't connected to AX yet, so they aren't shown.</p>`;
  return { title: name, crumbs, html };
}
function liveLocalHTML() {
  const L = LIVE.local;
  if (!L) return '<p class="small muted" style="margin-top:8px">Checking…</p>';
  if (L.error) return `<div class="health-line attn" style="margin-top:4px"><span class="hd"></span>Couldn't check</div><p class="small" style="margin-top:8px;overflow-wrap:anywhere">${esc(L.error)}</p><div style="margin-top:10px">${cliHint('ax local status')}</div>`;
  const running = L.state === 'Running';
  const line = running ? `<div class="health-line" style="margin-top:4px"><span class="hd"></span>Running</div>`
    : `<div class="health-line attn" style="margin-top:4px"><span class="hd"></span>${L.state === 'Stopped' ? 'Stopped' : 'Not set up'}</div>`;
  const facts = running || L.state === 'Stopped' ? `<div style="margin-top:12px">${liveKV([['Cluster', esc(L.cluster)], ['Kube context', `<span class="mono">${esc(L.context)}</span>`], ['Agent Substrate', esc(L.substrate)], ['AX server', esc(L.server)]])}</div>` : '';
  const next = running ? `<div style="margin-top:12px">${cliHint('ax local status')}</div>`
    : `<p class="small" style="margin-top:10px">${L.state === 'Stopped' ? 'Start it again. Your tasks and their files are kept.' : 'Set up AX on this computer. It needs a container runtime that is already running, such as Docker Desktop, OrbStack or Colima.'}</p><div style="margin-top:10px">${cliHint('ax local start')}</div>`;
  return line + facts + next;
}
function liveViewPlaces() {
  const clusters = LIVE.contextsError ? `<p class="small" style="margin-top:10px;overflow-wrap:anywhere">${esc(LIVE.contextsError)}</p>`
    : LIVE.contexts.length ? `<div class="radio-list" style="margin-top:14px">${LIVE.contexts.map((c) => {
      const inUse = c.name === LIVE.context;
      return `<div class="radio-card info${inUse ? ' is-on' : ''}" style="cursor:default;align-items:flex-start">
          <span class="rc-main"><span class="rc-title">${esc(c.name)}</span><span class="rc-desc">${[liveIsLocal(c.name) ? 'This computer' : esc(c.cluster), c.tunnel === 'Healthy' ? 'Connected' : c.tunnel ? 'Connection needs a refresh' : '', c.current ? 'Current in your kubeconfig' : ''].filter(Boolean).join(' · ')}</span></span>
          <span style="text-align:right;min-width:150px">${inUse ? `<span class="chip done">${icon('check')}In use</span>` : `<button type="button" class="btn sm" data-action="live-use-context" data-context="${esc(c.name)}">Use this cluster</button>`}</span></div>`;
    }).join('')}</div>`
      : `<p class="small" style="margin-top:10px">Your kubeconfig has no clusters yet. Start AX on this computer, or add a cluster to <span class="mono">~/.kube/config</span>.</p>`;
  const html = `
    <h1 tabindex="-1">Where agents run</h1>
    <p class="sub" style="margin-top:6px;font-size:14.5px;max-width:64ch">Run tasks on this computer or on a remote cluster. Studio lists the clusters in your kubeconfig and never changes it: it names the cluster on every command.</p>
    <div class="places-grid">
      <section class="card place-card" aria-labelledby="live-pl-local">
        <div class="place-top"><div><h2 id="live-pl-local" class="h-display-sm">On this computer</h2></div></div>
        ${liveLocalHTML()}
      </section>
      <section class="card place-card" aria-labelledby="live-pl-clusters">
        <div class="place-top"><div><h2 id="live-pl-clusters" class="h-display-sm">Clusters</h2></div></div>
        ${clusters}
        <p class="xsmall muted" style="margin-top:12px">${icon('terminal', 'xs')} From your kubeconfig: <code>ax ctx</code></p>
      </section>
    </div>`;
  return { title: 'Where agents run', crumbs: [{ label: 'Home', href: '#/' }, { label: 'Where agents run' }], html, wide: true };
}
const LIVE_HIDDEN = { new: 'New task', guardrails: 'Guardrails', settings: 'Settings', welcome: 'Setup', cuj: 'This page', review: 'This page', get: 'This page' };
function liveViewNotYet(part) {
  const what = LIVE_HIDDEN[part] || 'This page';
  const html = `<div class="page-head"><h1 tabindex="-1">${what} isn't connected to AX yet</h1>
      <p class="lede">It still runs on demo data, so it's hidden in the app. Your tasks and where they run are real.</p></div>
    <div class="btn-row"><a class="btn primary" href="#/">Your tasks</a><a class="btn" href="#/places">Where agents run</a></div>`;
  return { title: what, crumbs: [{ label: 'Home', href: '#/' }, { label: what }], html };
}

/* ---------- The app frame ---------- */
function liveShellHTML() {
  return `
  <div class="app live">
    <aside class="sidebar" aria-label="Primary">
      <a class="brand" href="#/" aria-label="AX Studio home">${BRAND_MARK}<span class="brand-name">AX <span>Studio</span></span></a>
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
        <div class="topbar-actions"><button class="round-btn" id="theme-toggle" data-action="theme-toggle"></button></div>
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
    return `<a href="#/task/${encodeURIComponent(t.name)}" class="nav-task" ${cur === t.name ? 'aria-current="page"' : ''} title="${esc(t.name)} · ${d.label}">
      <span class="bead ${d.chip}">${d.active ? '<i class="pulse-dot"></i>' : icon(d.icon)}</span><span class="tt">${esc(t.name)}</span><span class="sr-only">, ${d.label}</span></a>`;
  }).join('') : '<div class="nav-empty">Tasks on this cluster show up here.</div>';
  const n = LIVE.tasks.filter((t) => liveState(t.state).rank === 0).length;
  const nn = $('#live-nav-needs'); if (nn) { nn.hidden = !n; nn.textContent = n; nn.setAttribute('aria-label', `, ${n} need you`); }
  const foot = $('#live-foot');
  if (foot) {
    const bad = LIVE.phase !== 'ready' || !!LIVE.error;
    const title = LIVE.phase === 'no-ax' ? 'AX not installed' : liveIsLocal(LIVE.context) ? 'This computer' : LIVE.context || 'No cluster';
    const sub = LIVE.phase === 'starting' ? 'Connecting…' : LIVE.phase === 'no-ax' ? 'Install ax to start' : LIVE.error ? "Can't reach AX" : `Connected · ${plural(LIVE.tasks.filter((t) => liveState(t.state).active).length, 'running', 'running')}`;
    foot.innerHTML = `<a class="health-card ${bad ? 'attn' : ''}" href="#/places" id="live-health" aria-label="${esc(title)}: ${esc(sub)}. Open Where agents run.">${icon(liveIsLocal(LIVE.context) ? 'laptop' : 'cloud')}<span class="hc-text"><span class="hc-title">${esc(title)}</span><span class="hc-sub">${esc(sub)}</span></span></a>`;
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
  else if (LIVE.phase === 'no-ax') v = liveViewNoAx();
  else if (!r.parts[0] || r.parts[0] === 'tasks') v = liveViewHome();
  else if (r.parts[0] === 'task') v = liveViewTask(decodeURIComponent(r.parts[1] || ''));
  else if (r.parts[0] === 'places') { v = liveViewPlaces(); top = 'places'; }
  else { v = liveViewNotYet(r.parts[0]); top = ''; }
  const root = $('#root');
  if (!$('.app.live', root)) root.innerHTML = liveShellHTML();
  const fk = focusKeyOf(document.activeElement);
  const moved = r.path !== LIVE.lastPath;
  $('#main').innerHTML = `<div class="content ${v.wide ? 'wide' : ''} ${moved && !opts.keepScroll ? 'view-enter' : ''}">${v.html}</div>`;
  renderCrumbs(v.crumbs || []);
  liveChrome(top);
  updateThemeToggle();
  state.docTitle = v.title + ' · AX Studio';
  document.title = state.docTitle;
  if (moved) {
    /* A new page starts at the top, with focus on its heading. A task you just opened loads its details right away. */
    if (LIVE.lastPath !== null) { window.scrollTo(0, 0); const h = $('#main h1'); if (h) h.focus({ preventScroll: true }); }
    LIVE.lastPath = r.path;
    if (LIVE.phase === 'ready' && (r.parts[0] === 'task' || r.parts[0] === 'places')) liveRefresh(true);
  } else {
    restoreFocus(fk);
  }
}
