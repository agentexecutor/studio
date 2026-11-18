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

// Smoke test · live mode (api.js, live.js, live-env.js, live-new.js, live-changes.js).
//
// Loads AX Studio in a stubbed DOM with a stand-in for the Studio server: fetch answers the way ax-studio's /api
// does, and a stand-in EventSource delivers the events it pushes. Checks that the pages show what the server
// returned, that every request names the cluster instead of changing the kubeconfig, that what Studio sends to AX
// (task files, ax promote arguments) is what AX reads, and that pages with no real source stay hidden.
//
// Usage: node ux/tests/smoke_live.cjs [app folder]
const fs = require('fs');
const vm = require('vm');
const dir = process.argv[2] || require('path').resolve(__dirname, '..');

/* ---------- A stand-in Studio server ---------- */
const taskDoc = (name, state, o = {}) => ({
  apiVersion: 'ax.io/v1alpha1', kind: 'Task',
  metadata: Object.assign({ name, atespace: 'default', createTime: o.created || '2026-11-16T23:40:12Z', uid: 'uid-' + name }, o.labels ? { labels: o.labels } : {}),
  spec: Object.assign({}, o.goal ? { goal: { [o.goalField || 'text']: o.goal } } : {}, o.spec || {}),
  status: Object.assign({ state: 'TASK_STATE_' + state }, o.status || {}),
});
const CHECKS_OK = [
  { id: 'os_arch', label: 'Operating system & CPU', status: 'ok', detail: 'darwin/arm64' },
  { id: 'container_engine', label: 'Container engine', status: 'ok', detail: 'docker 27.3 is running' },
  { id: 'disk_space', label: 'Free disk space', status: 'ok', detail: '212 GiB free' },
];
const CONTEXTS = [
  { name: 'ax-local', cluster: 'kind-ax-local', current: true, isLocal: true },
  { name: 'gke-broken', cluster: 'gke_acme_europe-west4_old', current: false, isLocal: false },
  { name: 'gke-team-dev', cluster: 'gke_acme_us-central1_team-dev', current: false, isLocal: false },
];
const envRunning = () => ({
  os: 'darwin', arch: 'arm64', canStartLocal: true, preflight: CHECKS_OK.map((c) => Object.assign({}, c)),
  local: { name: 'ax-local', state: 'Running', kubeContext: 'ax-local', substrateStatus: 'ate-api-server (1/1 available)', axStatus: 'ax-server (1/1 available in ax-system)' },
  contexts: CONTEXTS.map((c) => Object.assign({}, c)), currentContext: 'ax-local',
});
const envFresh = () => ({
  os: 'darwin', arch: 'arm64', canStartLocal: true, preflight: CHECKS_OK.map((c) => Object.assign({}, c)),
  local: { name: 'ax-local', state: 'NotFound', kubeContext: 'N/A', substrateStatus: '', axStatus: '' }, contexts: [], currentContext: '',
});
const PATCH_SIGNER = 'diff --git a/src/signer.py b/src/signer.py\nindex 1111111..2222222 100644\n--- a/src/signer.py\n+++ b/src/signer.py\n@@ -3,3 +3,4 @@ class Signer:\n     def now(self):\n-        return time.time()\n+        clock = self.clock\n+        return clock()\n \n';
const PATCH_NOTE = 'diff --git a/notes/why.md b/notes/why.md\nnew file mode 100644\n--- /dev/null\n+++ b/notes/why.md\n@@ -0,0 +1,2 @@\n+# Why it was flaky\n+The clock was read twice.\n\\ No newline at end of file\n';

function makeBackend(opts) {
  const B = Object.assign({
    calls: [], posts: [], ax: [], applied: [], secrets: [], es: null, token: 1, offline: false, noAx: false, goalField: 'text',
    env: envRunning(),
    tasks: {
      'ax-local': [
        taskDoc('readme-polish', 'SUSPENDED', { goal: 'Tighten the README.', spec: { workspace: { name: 'itsdangerous' }, sessionId: 's-readme' } }),
        taskDoc('fix-flaky-tests', 'WORKING', {
          goal: 'Fix the flaky tests.\nExplain the cause.', labels: { team: 'platform' },
          spec: { profile: { image: 'gcr.io/p/claude-code@sha256:abc', resources: { limits: { cpu: '2', memory: '4Gi' } } }, workspace: { name: 'itsdangerous' }, gateway: { name: 'review-bot-gw' }, debug: true, sessionId: 's-fix' },
          status: { conditions: [{ type: 'Ready', status: 'True', reason: 'TaskRunning', message: 'Task is running and its workspace is ready' }] },
        }),
        /* An older AX calls the goal field "spec". */
        taskDoc('upgrade-node-22', 'FAILED', { goal: 'Upgrade to Node 22.', goalField: 'spec', spec: { sessionId: 's-up' }, status: { statusDetail: { reason: 'TASK_STATUS_REASON_SANDBOX_CRASHED', detail: 'sandbox exited: out of memory (limit 512Mi)' } } }),
        taskDoc('changelog-draft', 'COMPLETED', { goal: 'Draft the changelog.', spec: { sessionId: 's-log' }, status: { outcome: { result: 'TASK_RESULT_SUCCEEDED', output: 'Wrote CHANGES.rst for 2.3.\nPushed branch ax/changelog-draft.' } } }),
        taskDoc('signer-b2c3', 'WORKING', { goal: 'Also add a regression test.', created: '2026-11-17T10:05:00Z', spec: { sessionId: 's-sign' } }),
        taskDoc('signer-a1b2', 'COMPLETED', { goal: 'Make the signer tests pass.', created: '2026-11-17T10:00:00Z', spec: { sessionId: 's-sign' } }),
      ],
      'gke-team-dev': [taskDoc('nightly-triage', 'WORKING', { goal: 'Triage the failing builds.', spec: { sessionId: 's-night' } })],
    },
    changes: {
      'fix-flaky-tests': { taskName: 'fix-flaky-tests', available: true, repoDir: '/workspace', branch: 'main', fullPatch: PATCH_SIGNER + PATCH_NOTE, files: [
        { path: 'src/signer.py', status: 'M', additions: 2, deletions: 1, patch: PATCH_SIGNER },
        { path: 'notes/why.md', status: '?', additions: 2, deletions: 0, patch: PATCH_NOTE },
      ] },
    },
    applyConflict: false,
  }, opts);
  const answer = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body), clone() { return this; } });
  const list = (ctx) => (B.tasks[ctx] = B.tasks[ctx] || []);
  const find = (ctx, name) => list(ctx).find((t) => t.metadata.name === name);
  const yamlOf = (t) => `apiVersion: ax.io/v1alpha1\nkind: Task\nmetadata:\n  name: ${t.metadata.name}\n  atespace: default\nspec:\n  sessionId: ${t.spec.sessionId || ''}\nstatus:\n  state: ${t.status.state}\n`;

  /* What the ax command would do with these arguments. */
  function runAx(args, stdin) {
    B.ax.push(args.join(' '));
    if (B.noAx) return { status: 127, stdout: '', stderr: 'exec: "ax": executable file not found in $PATH\n' };
    const a = args.slice();
    let ctx = 'ax-local';
    while (a[0] === '--context' || a[0] === '-a') { if (a[0] === '--context') ctx = a[1]; a.splice(0, 2); }
    const ok = (stdout, stderr) => ({ status: 0, stdout, stderr: stderr || '' });
    const err = (m) => ({ status: 1, stdout: '', stderr: 'Error: ' + m + '\n' });
    if (a[0] === 'version') return ok('ax version v0.1.0\n');
    if (a[0] === 'apply') {
      B.applied.push(stdin);
      const doc = String(stdin).split(/^---$/m).find((d) => /^kind: Task$/m.test(d)) || '';
      const goal = /^    (text|spec): (.*)$/m.exec(doc);
      if (goal && goal[1] !== B.goalField) return err(`parsing Task: proto: (line 1:214): unknown field "${goal[1]}"`);
      const name = (/^  name: "?([a-z0-9-]+)"?$/m.exec(doc) || [])[1];
      if (!name) return err('no Task in the file');
      const pick = (re) => (re.exec(doc) || [])[1];
      /* The goal is one quoted line, or a block of lines indented under the field. */
      const block = /^    (?:text|spec): \|\n((?: {6}.*\n?)+)/m.exec(doc);
      const goalText = !goal ? '' : block ? block[1].split('\n').map((l) => l.slice(6)).join('\n').trim() : JSON.parse(goal[2]);
      list(ctx).push(taskDoc(name, 'SUSPENDED', {
        goal: goalText, goalField: B.goalField, created: '2026-11-17T12:00:00Z',
        spec: { sessionId: pick(/^  sessionId: "([^"]+)"$/m) || 'uid-' + name, debug: /^  debug: true$/m.test(doc), workspace: { name: pick(/^  workspace:\n    name: "([^"]+)"$/m) }, gateway: { name: pick(/^  gateway:\n    name: "([^"]+)"$/m) } },
      }));
      return ok(`task.ax.io/${name} created\n`);
    }
    if (a[0] === 'resume' && a[1] === 'task') { const t = find(ctx, a[2]); if (!t) return err('task not found'); t.status.state = 'TASK_STATE_WORKING'; return ok(`task.ax.io/${a[2]} resumed\n`); }
    if (a[0] === 'promote' && a[1] === 'task') {
      const name = a[2], to = a[a.indexOf('--to') + 1], pre = a.includes('--preflight-only') ? ' (preflight only)' : '';
      const src = find(ctx, name);
      if (!src) return err(`getting task "${name}": rpc error: code = NotFound desc = not found`);
      if (to === 'gke-broken') return err('reaching target "gke-broken": kubectl port-forward exited for context "gke-broken": Unable to connect to the server: dial tcp 34.118.12.7:443: i/o timeout');
      const there = find(to, name);
      if (there && !a.includes('--replace')) return err(`task default/${name} already exists on target; pass --replace to recreate it`);
      const out = [], notes = [];
      if (src.spec.gateway && src.spec.gateway.name) { out.push(`gateway.ax.io/${src.spec.gateway.name} created${pre}`); notes.push(`Note: the target must provide the credentials that gateway ${src.spec.gateway.name} injects: ate-secret://k8s.io/default/ax-system/gemini-api-creds/GEMINI_API_KEY`); }
      if (src.spec.workspace && src.spec.workspace.name) out.push(`workspace.ax.io/${src.spec.workspace.name} unchanged${pre}`);
      out.push(`task.ax.io/${name} ${there ? 'replaced' : 'created'}${pre}`);
      if (a.includes('--suspend-source')) out.push(`task.ax.io/${name} suspended on the source${pre}`);
      out.push(`task.ax.io/${name} resumed${pre}`);
      if (!pre) {
        if (there) list(to).splice(list(to).indexOf(there), 1);
        list(to).push(taskDoc(name, 'WORKING', { goal: (src.spec.goal || {}).text || (src.spec.goal || {}).spec, spec: Object.assign({}, src.spec) }));
        if (a.includes('--suspend-source')) src.status.state = 'TASK_STATE_SUSPENDED';
      }
      return ok(out.join('\n') + '\n', notes.join('\n'));
    }
    return err('the stand-in does not know: ' + a.join(' '));
  }

  B.fetch = async (path, init) => {
    init = init || {};
    const method = init.method || 'GET';
    const u = new URL(path, 'http://127.0.0.1:8080');
    const q = Object.fromEntries(u.searchParams);
    const body = init.body ? JSON.parse(init.body) : {};
    B.calls.push(`${method} ${u.pathname}${u.search}`);
    if (B.offline) throw new TypeError('fetch failed');
    if (u.pathname === '/api/bootstrap') return answer(200, { csrfToken: 'tok-' + B.token, os: 'darwin', home: '/Users/me', pathSeparator: ':', axNamespace: 'ax-system', version: '0.1.0' });
    if (method === 'POST') {
      const token = (init.headers || {})['X-AX-CSRF-Token'];
      B.posts.push({ path: u.pathname, body, token });
      if (token !== 'tok-' + B.token) return answer(403, { error: 'missing or invalid CSRF token' });
    }
    const ctx = method === 'POST' ? body.context : q.context;
    const name = method === 'POST' ? body.name || body.task : q.name || q.task;
    switch (u.pathname) {
      case '/api/env/status': return answer(200, B.env);
      case '/api/tasks':
        if (ctx === 'gke-broken') return answer(502, { error: 'kubectl port-forward exited for context "gke-broken": Unable to connect to the server: dial tcp 34.118.12.7:443: i/o timeout' });
        return answer(200, { tasks: list(ctx) });
      case '/api/tasks/get': {
        const t = find(ctx, name);
        return t ? answer(200, { task: t, yaml: yamlOf(t) }) : answer(404, { error: `task default/${name} not found`, code: 'NotFound' });
      }
      case '/api/tasks/suspend': case '/api/tasks/resume': case '/api/tasks/delete': {
        const t = find(ctx, name);
        if (!t) return answer(404, { error: `task default/${name} not found`, code: 'NotFound' });
        if (u.pathname.endsWith('/resume') && name === 'upgrade-node-22') return answer(502, { error: 'no free workers available', code: 'ResourceExhausted' });
        if (u.pathname.endsWith('/delete')) list(ctx).splice(list(ctx).indexOf(t), 1);
        else t.status.state = u.pathname.endsWith('/suspend') ? 'TASK_STATE_SUSPENDED' : 'TASK_STATE_WORKING';
        return answer(200, { ok: true });
      }
      case '/api/tasks/changes': {
        const t = find(ctx, name);
        if (t && t.status.state === 'TASK_STATE_SUSPENDED') return answer(200, { taskName: name, available: false, reason: 'Task sandbox is currently Suspended. Resume the task to inspect or apply working tree changes.', files: [], fullPatch: '' });
        return answer(200, B.changes[name] || { taskName: name, available: false, reason: 'No Git repository found inside /workspace.', files: [], fullPatch: '' });
      }
      case '/api/tasks/push-branch':
        if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(body.branch) || body.branch.includes('..')) return answer(502, { error: `invalid git branch name "${body.branch}"` });
        B.changes[name] = { taskName: name, available: true, repoDir: '/workspace', branch: body.branch, files: [], fullPatch: '' };
        return answer(200, { branch: body.branch, commitSha: 'abc1234', repoDir: '/workspace' });
      case '/api/tasks/apply-local':
        if (!body.localRepoPath.startsWith('/') && !body.localRepoPath.startsWith('~/')) return answer(400, { error: 'local repository path must be an absolute path (or start with ~/)' });
        if (B.applyConflict) return answer(200, { applied: false, conflict: true, detail: 'error: src/signer.py: patch does not apply' });
        return answer(200, { applied: true, conflict: false, filesApplied: 2, localRepoPath: '/Users/me/code/project' });
      case '/api/tasks/discard-file': {
        const ch = B.changes[name];
        if (ch && ch.files) ch.files = ch.files.filter((f) => f.path !== body.path);
        return answer(200, { ok: true, path: body.path });
      }
      case '/api/sessions/start':
      case '/api/sessions/write':
      case '/api/sessions/interrupt':
      case '/api/sessions/eof':
      case '/api/sessions/close':
        return answer(200, { ok: true, id: body.id });
      case '/api/secrets/credential':
        B.secrets.push({ context: body.context, name: body.name, key: body.key, length: String(body.value).length });
        return answer(200, { credentialUri: `ate-secret://k8s.io/default/ax-system/${body.name}/${body.key}` });
      case '/api/env/local/up': case '/api/env/local/stop': case '/api/env/local/delete': {
        const action = 'local-' + u.pathname.split('/').pop();
        return answer(200, { id: 'op-' + B.posts.length, action, target: 'ax-local', status: 'running', stage: action === 'local-up' ? 'kind' : '', started: 1 });
      }
      case '/api/ax/exec': return answer(200, runAx(body.args, body.stdin));
      default: return answer(404, { error: 'not found: ' + u.pathname });
    }
  };
  /** Pushes an event the way the server does over /api/events. */
  B.push = (type, payload) => { if (B.es && B.es.onmessage) B.es.onmessage({ data: JSON.stringify({ type, payload }) }); };
  return B;
}

/* ---------- A stubbed page ---------- */
/* Elements keep their children by selector and remember their listeners, so a test can click a dialog's buttons.
   Setting innerHTML starts over, as it does in a browser. */
function makeContext(B, env) {
  const namedEls = {};
  function fakeEl(id) {
    let html = '';
    let kids = {};
    const el = {
      textContent: '', value: '', hidden: false, disabled: false, checked: false, id: id || '', tagName: 'DIV', on: {},
      style: { setProperty() {}, getPropertyValue() { return ''; }, removeProperty() {} }, dataset: { axo: 'idle', stage: '0' }, children: [],
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; }, [Symbol.iterator]: function* () {} },
      setAttribute() {}, getAttribute() { return null; }, removeAttribute() {}, toggleAttribute() {}, hasAttribute() { return false; },
      focus() {}, blur() {}, click() {},
      querySelector(s) { return (kids[s] = kids[s] || fakeEl(s)); }, querySelectorAll() { return []; },
      insertAdjacentHTML(_p, h) { html += h; }, addEventListener(type, fn) { (el.on[type] = el.on[type] || []).push(fn); },
      appendChild(c) { el.children.push(c); html += (c && c.innerHTML) || ''; },
      remove() {}, replaceWith() {},
      getBoundingClientRect() { return { left: 0, top: 0, width: 10, height: 10 }; },
      scrollIntoView() {}, closest() { return null; }, setSelectionRange() {}, animate() {},
    };
    Object.defineProperty(el, 'innerHTML', { get() { return html; }, set(v) { html = String(v); kids = {}; } });
    el.parentElement = el; el.lastElementChild = el; el.firstChild = { remove() { el.children.shift(); } }; el.form = { requestSubmit() {} };
    Object.defineProperty(el, 'outerHTML', { set() {}, get() { return html; } });
    return el;
  }
  ['#root', '#main', '#overlay', '#toasts', '#bell-pop', '#announcer', '#crumbs', '#live-nav-tasks', '#live-nav-needs', '#live-foot'].forEach((k) => { namedEls[k] = fakeEl(k); });
  const store = {};
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
  let rand = 0;
  class PageURL extends URL { static createObjectURL() { return 'blob:ax'; } static revokeObjectURL() {} }
  const ctx = {
    console, URLSearchParams, JSON, Math, Date, String, Number, Object, Array, Promise, RegExp, encodeURIComponent, decodeURIComponent,
    Blob: function Blob(a) { this.a = a; },
    URL: PageURL,
    /* Names end in four characters that are different every time: ab01, ab02, … */
    crypto: { getRandomValues(a) { rand++; a[0] = 0xab; a[1] = rand & 255; return a; } },
    document: doc,
    navigator: { platform: 'MacIntel', clipboard: { writeText: () => Promise.resolve() } },
    location: { hash: '#/', search: '', pathname: '/', get href() { return 'http://127.0.0.1:8080' + this.pathname + this.search + this.hash; }, replace(u) { u = String(u); this.hash = u.includes('#') ? u.slice(u.indexOf('#')) : ''; } },
    history: { replaceState() {} },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    setTimeout: () => 0, clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
    innerWidth: 1440, innerHeight: 900, scrollY: 0, scrollTo() {}, requestAnimationFrame: () => 0,
    getSelection: () => '',
  };
  ctx.window = ctx;
  ctx.window.matchMedia = () => ({ matches: false, addEventListener() {} });
  ctx.window.addEventListener = () => {};
  if (B) {
    ctx.window.AX_STUDIO = env || { server: true };     // what the server's /env.js sets
    ctx.fetch = (path, init) => B.fetch(path, init);
    ctx.EventSource = function EventSource(url) { this.url = url; this.readyState = 1; B.es = this; };
  } else {
    ctx.window.AX_STUDIO = null;                        // what the env.js in this folder sets
  }
  vm.createContext(ctx);
  const files = ['core.js', 'mascot.js', 'viz.js', 'failures.js', 'views.js', 'task.js', 'overlays.js', 'api.js', 'live.js', 'live-env.js', 'live-new.js', 'live-changes.js', 'app.js'];
  vm.runInContext(files.map((f) => fs.readFileSync(dir + '/' + f, 'utf8')).join('\n;\n') + `
;globalThis.__api = { state, render, ACTIONS, STUDIO, LIVE, liveOn, liveState, liveStateName, liveTask, liveAge, liveShellHTML, liveRefresh, liveTaskAction, liveConnect,
  liveCmd, liveViewHome, liveViewTask, liveViewPlaces, liveViewSetup, liveViewNotYet, liveViewNew, liveNewYAML, liveNewIssues, liveNewRun, liveDraftName,
  livePromoteArgs, livePromoteLine, livePromoteNote, liveOpenPromote, liveChangesInnerHTML, liveLoadChanges, liveOpenPush, liveOpenApply, liveOpenDiscard, livePatchLines, liveChangesWhy,
  liveTermOpen, liveTermSend, liveTermClose, liveTermInnerHTML, livePaletteItems, liveGoalHelpHTML, liveNewGateMapHTML,
  viewHome, studioPost };`, ctx);
  return { ctx, api: ctx.__api, els: namedEls, store };
}

let fails = 0, n = 0;
async function check(name, fn) {
  n++;
  try {
    const r = await fn();
    if (r && typeof r.html === 'string' && /undefined|NaN|\[object/.test(r.html)) throw new Error('bad token: ' + (r.html.match(/.{0,50}(undefined|NaN|\[object).{0,50}/) || [])[0]);
    console.log('ok  ', name);
  } catch (e) { fails++; console.log('FAIL', name, e && e.stack ? e.stack.split('\n').slice(0, 2).join(' | ') : e); }
}
const settle = async () => { for (let k = 0; k < 60; k++) await new Promise((r) => setImmediate(r)); };
const main = (p) => p.els['#main'].innerHTML;
const toasts = (p) => p.els['#toasts'].innerHTML;
const need = (html, parts) => { for (const k of parts) if (!html.includes(k)) throw new Error('missing: ' + k); };
const never = (html, parts) => { for (const k of parts) if (html.includes(k)) throw new Error('should not show: ' + k); };
/** Opens a page the way a link does. */
const go = async (p, hash) => { p.ctx.location.hash = hash; p.api.render(); await settle(); };
/** The open dialog, and a way to click or type in it. */
const dialog = (p) => p.els['#overlay'].querySelector('[role="dialog"]');
const fire = async (el, type, ev) => { for (const fn of el.on[type] || []) await fn(ev || { target: el }); await settle(); };

(async () => {
  // ---------- Without the Studio server (a plain browser): demo data, untouched ----------
  const demo = makeContext(null);
  await check('in a plain browser there is no Studio server, so the app stays on demo data', () => {
    if (demo.api.liveOn() || demo.api.LIVE.on || demo.api.STUDIO.on) throw new Error('live mode must be off without the server');
    if (demo.api.state.tasks.length < 5) throw new Error('the demo tasks should still be there');
    const v = demo.api.viewHome();
    need(v.html, ['Add rate limiting to the checkout API']);
    return v;
  });

  // ---------- Reading what AX returns ----------
  const B = makeBackend();
  const p = makeContext(B);
  const { api } = p;
  const L = api.LIVE;
  await check("AX's states read in the UI's words, and an unknown state says so", () => {
    const want = { Working: 'Running', Queued: 'Starting', Suspending: 'Pausing', Suspended: 'Paused', Failed: 'Failed', RequiresAction: 'Waiting for you', Completed: 'Done', Cancelled: 'Stopped' };
    for (const k of Object.keys(want)) if (api.liveState(k).label !== want[k]) throw new Error(`${k} should read ${want[k]}, got ${api.liveState(k).label}`);
    if (api.liveState('Hibernating').label !== 'Unknown') throw new Error('an unknown state');
    if (api.liveStateName('TASK_STATE_REQUIRES_ACTION') !== 'RequiresAction' || api.liveStateName('TASK_STATE_WORKING') !== 'Working' || api.liveStateName('') !== 'Unknown') throw new Error('state names');
  });
  await check('a task reads the same whether AX calls the goal field text or spec', () => {
    const a = api.liveTask(taskDoc('a', 'WORKING', { goal: 'New name', spec: { sessionId: 's1', debug: true } }));
    const b = api.liveTask(taskDoc('b', 'QUEUED', { goal: 'Old name', goalField: 'spec' }));
    if (a.goal !== 'New name' || a.state !== 'Working' || a.session !== 's1' || !a.debug) throw new Error(JSON.stringify(a));
    if (b.goal !== 'Old name' || b.state !== 'Queued' || b.debug) throw new Error(JSON.stringify(b));
    if (api.liveTask({}).name !== '' || api.liveTask(null).state !== 'Unknown') throw new Error('an empty task');
  });
  await check('ages read in plain words', () => {
    const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
    const got = [api.liveAge(ago(20)), api.liveAge(ago(12 * 60)), api.liveAge(ago(3 * 3600)), api.liveAge(ago(1 * 86400)), api.liveAge(ago(4 * 86400)), api.liveAge(''), api.liveAge('nonsense')];
    if (got.join('|') !== 'moments|12 min|3 hr|1 day|4 days||') throw new Error(got.join('|'));
  });

  // ---------- Connected ----------
  await settle();
  await check('connects: starts a session, reads this computer and the kubeconfig, picks the current cluster, lists its tasks', () => {
    if (!api.liveOn() || L.phase !== 'ready') throw new Error('phase: ' + L.phase);
    if (L.context !== 'ax-local' || L.contexts.length !== 3 || L.local.state !== 'Running') throw new Error(JSON.stringify([L.context, L.contexts.length, L.local]));
    if (L.tasks.length !== 6 || L.axVersion !== 'v0.1.0') throw new Error(JSON.stringify([L.tasks.length, L.axVersion]));
    if (api.state.tasks.length) throw new Error('demo tasks should be gone');
    if (!B.es || B.es.url !== '/api/events') throw new Error('the page should listen for the server\'s events');
    const order = B.calls.filter((c) => /bootstrap|env\/status|\/api\/tasks\?/.test(c)).map((c) => c.split('?')[0]).join(' ');
    if (!/^GET \/api\/bootstrap .*GET \/api\/env\/status .*GET \/api\/tasks$/.test(order)) throw new Error('order: ' + order);
  });
  await check('every request names the cluster and the atespace, and every change carries the page\'s token', async () => {
    if (!B.calls.includes('GET /api/tasks?context=ax-local&atespace=default')) throw new Error(B.calls.join(' | '));
    if (!B.posts.length || B.posts.some((x) => x.token !== 'tok-1')) throw new Error(JSON.stringify(B.posts));
    if (B.calls.some((c) => /\/api\/env\/context/.test(c)) || B.ax.some((c) => /^ctx \S/.test(c) || /use-context/.test(c))) throw new Error('Studio must not change the kubeconfig');
  });
  await check('Home lists the real tasks: what needs you first, the goal as the title, the turns of a session together', () => {
    const v = api.liveViewHome();
    const order = (v.html.match(/id="live-row-[a-z0-9-]+"/g) || []).map((x) => x.slice(13, -1)).join();
    if (order !== 'upgrade-node-22,fix-flaky-tests,signer-a1b2,signer-b2c3,readme-polish,changelog-draft') throw new Error('order: ' + order);
    need(v.html, ['Your tasks', '6 tasks: 1 needs you, 2 running, 1 paused.', '<div class="t-title">Upgrade to Node 22.</div>', '<span class="mono">upgrade-node-22</span>',
      '</svg>Failed</span>', '</svg>Running</span>', '</svg>Paused</span>', '</svg>Done</span>', '<span>Turn 1 of 2</span>', '<span>Turn 2 of 2</span>', 'On this computer', 'ax --context ax-local get tasks']);
    if (!/id="live-row-signer-b2c3"[^>]*style="padding-left:34px"/.test(v.html)) throw new Error('a later turn sits under the first');
    never(v.html, ['Good morning', 'Good afternoon', 'Good evening', 'What should an agent work on next', 'This week']);
    return v;
  });
  await check('the app frame has what is real: New task, Home, Where agents run. No Guardrails, Settings, bell or command palette', () => {
    const sh = api.liveShellHTML();
    need(sh, ['class="app live"', 'href="#/new" id="live-new"', 'href="#/places"', 'id="theme-toggle"']);
    never(sh, ['#/guardrails', '#/settings', 'id="bell"', 'data-action="palette"', 'data-action="shortcuts"', 'id="live-classic"']);
    return { html: sh };
  });

  // ---------- A task ----------
  await go(p, '#/task/fix-flaky-tests');
  await check('a task page shows what AX has: goal, state, image, workspace, network, limits, debug, session, labels and the task file', () => {
    const h = main(p);
    need(h, ['fix-flaky-tests', 'Fix the flaky tests.\nExplain the cause.', 'Running <span class="muted">(AX: Working)</span>', 'Ready: True (TaskRunning)', 'gcr.io/p/claude-code@sha256:abc', 'itsdangerous',
      'Gateway <span class="mono">review-bot-gw</span>', '2 CPU · 4Gi memory', 'ax --context ax-local ssh fix-flaky-tests', 's-fix', 'team=platform', 'apiVersion: ax.io/v1alpha1',
      'data-action="live-suspend"', 'href="#/new?from=fix-flaky-tests"', 'data-action="live-promote"', 'data-action="live-delete"', "AX doesn't offer a task's activity or a live log yet"]);
    never(h, ['data-action="live-resume"']);
    if (!B.calls.includes('GET /api/tasks/get?context=ax-local&atespace=default&name=fix-flaky-tests')) throw new Error('the task is read from that cluster');
    return { html: h };
  });
  await check('pause asks the server to suspend that task on that cluster, and the page follows the new state', async () => {
    api.ACTIONS['live-suspend']({ dataset: { task: 'fix-flaky-tests' } });
    await settle();
    const sent = B.posts.find((x) => x.path === '/api/tasks/suspend');
    if (!sent || JSON.stringify(sent.body) !== '{"context":"ax-local","atespace":"default","name":"fix-flaky-tests"}') throw new Error(JSON.stringify(sent));
    if (L.tasks.find((t) => t.name === 'fix-flaky-tests').state !== 'Suspended') throw new Error('state should be Suspended');
    need(main(p), ['</svg>Paused</span>', 'data-action="live-resume"']);
    never(main(p), ['data-action="live-suspend"']);
    need(toasts(p), ['Paused <span class="mono">fix-flaky-tests</span>']);
  });
  await check('resume asks the server to resume it', async () => {
    api.ACTIONS['live-resume']({ dataset: { task: 'fix-flaky-tests' } });
    await settle();
    if (!B.posts.some((x) => x.path === '/api/tasks/resume' && x.body.name === 'fix-flaky-tests') || L.tasks.find((t) => t.name === 'fix-flaky-tests').state !== 'Working') throw new Error('resume');
  });
  await check('when AX refuses, Studio says what AX said and changes nothing', async () => {
    await api.liveTaskAction('upgrade-node-22', 'resume');
    await settle();
    need(toasts(p), ["Couldn't resume <span class=\"mono\">upgrade-node-22</span>: no free workers available"]);
    if (L.tasks.find((t) => t.name === 'upgrade-node-22').state !== 'Failed') throw new Error('state unchanged');
  });
  await check('a failed task says why, and offers no pause or resume', async () => {
    await go(p, '#/task/upgrade-node-22');
    const h = main(p);
    need(h, ['Upgrade to Node 22.', 'sandbox exited: out of memory (limit 512Mi)', '</svg>Failed</span>', 'data-action="live-delete"']);
    never(h, ['data-action="live-suspend"', 'data-action="live-resume"']);
    return { html: h };
  });
  await check('a finished task shows its result, exit code and output', async () => {
    await go(p, '#/task/changelog-draft');
    const h = main(p);
    need(h, ['id="live-result"', '<dt>Result</dt><dd>Succeeded</dd>', '<dt>Exit code</dt><dd><span class="mono">0</span></dd>', 'Wrote CHANGES.rst for 2.3.\nPushed branch ax/changelog-draft.']);
    return { html: h };
  });
  await check('a task with no gateway and no debug access says so, and has no Changes section', async () => {
    await go(p, '#/task/readme-polish');
    const h = main(p);
    need(h, ['No gateway, so no network access', 'Off, so there is no shell into the sandbox', 'This task was started without debug access, so its sandbox stays closed.']);
    never(h, ['id="live-changes"']);
    if (B.calls.some((c) => /\/api\/tasks\/changes.*readme-polish/.test(c))) throw new Error('a closed sandbox is not asked for its changes');
  });
  await check('delete asks first, with the command that does the same, then asks the server', async () => {
    api.ACTIONS['live-delete']({ dataset: { task: 'readme-polish' } });
    need(p.els['#overlay'].innerHTML, ['Delete readme-polish?', "It can't be undone", 'ax --context ax-local delete task readme-polish', 'id="ld-go"', 'data-action="close-dialog"']);
    if (B.posts.some((x) => x.path === '/api/tasks/delete')) throw new Error('nothing is deleted before you confirm');
    await fire(dialog(p).querySelector('#ld-go'), 'click');
    if (!B.posts.some((x) => x.path === '/api/tasks/delete' && x.body.name === 'readme-polish') || L.tasks.some((t) => t.name === 'readme-polish')) throw new Error('delete');
    if (p.ctx.location.hash !== '#/') throw new Error('after deleting the open task, go back to the list');
  });
  await check("a task that isn't on this cluster says so instead of an empty page", async () => {
    await go(p, '#/task/long-gone');
    need(main(p), ["long-gone isn't on this cluster", 'href="#/places"']);
  });

  // ---------- Changes, for a task with debug access ----------
  await go(p, '#/task/fix-flaky-tests');
  await check('Changes lists what the agent changed in its sandbox, each file with its diff', async () => {
    if (!B.calls.includes('GET /api/tasks/changes?context=ax-local&atespace=default&task=fix-flaky-tests')) throw new Error('changes are read for that task: ' + B.calls.slice(-4).join(' | '));
    api.render();
    let h = main(p);
    need(h, ['id="live-changes"', '2 files changed on <span class="mono">main</span>', '<span class="lf-status">Changed</span><span class="lf-path">src/signer.py</span>', '<span class="lf-status">New</span><span class="lf-path">notes/why.md</span>',
      '<span class="a">+4</span><span class="d">−1</span>', 'data-action="live-changes-push"', 'data-action="live-changes-apply"']);
    never(h, ['class="diff"']); // a diff is drawn when its file is opened
    L.changes['fix-flaky-tests'].open['src/signer.py'] = true;
    h = api.liveChangesInnerHTML('fix-flaky-tests');
    need(h, ['<table class="diff"', '<tr class="hunk">', '<tr class="del">', '<tr class="add">', 'clock = self.clock']);
    never(h, ['diff --git', 'index 1111111']);
    return { html: h };
  });
  await check('a patch becomes diff lines: no file header, no "No newline" marker', () => {
    const lines = api.livePatchLines(PATCH_NOTE);
    if (lines.join('|') !== '@@ -0,0 +1,2 @@|+# Why it was flaky|+The clock was read twice.') throw new Error(lines.join('|'));
    if (api.livePatchLines('').length || api.livePatchLines(null).length) throw new Error('no patch, no lines');
  });
  await check("when the sandbox can't be read, Changes says why in plain words", () => {
    const why = api.liveChangesWhy;
    if (!/paused/.test(why('Task sandbox is currently Suspended. Resume the task to inspect or apply working tree changes.'))) throw new Error('paused');
    if (!/no Git repo/.test(why('No Git repository found inside /workspace.'))) throw new Error('no repo');
    if (!/hasn't started/.test(why('Task has no active sandbox actor yet.'))) throw new Error('not started');
    if (why('Something new went wrong.') !== 'Something new went wrong.') throw new Error("the server's own words are the fallback");
  });
  await check('Push to a branch sends the branch and the message, says where it went, and the list empties', async () => {
    api.ACTIONS['live-changes-push']({ dataset: { task: 'fix-flaky-tests' } });
    const d = dialog(p);
    const body = d.querySelector('#lpb-body');
    need(body.innerHTML, ['value="ax/fix-flaky-tests"', 'value="Fix the flaky tests."', 'Nothing on this computer changes']);
    await fire(body.querySelector('#lpb-branch'), 'input', { target: { value: 'bad..name' } });
    await fire(d.querySelector('#lpb-go'), 'click');
    need(dialog(p).querySelector('#lpb-body').innerHTML, ['invalid git branch name']);
    await fire(dialog(p).querySelector('#lpb-body').querySelector('#lpb-branch'), 'input', { target: { value: 'ax/fix-flaky-tests' } });
    await fire(dialog(p).querySelector('#lpb-go'), 'click');
    const sent = B.posts.filter((x) => x.path === '/api/tasks/push-branch').pop();
    if (JSON.stringify(sent.body) !== '{"context":"ax-local","atespace":"default","task":"fix-flaky-tests","branch":"ax/fix-flaky-tests","commitMessage":"Fix the flaky tests."}') throw new Error(JSON.stringify(sent.body));
    const h = api.liveChangesInnerHTML('fix-flaky-tests');
    need(h, ['Pushed to <span class="mono">ax/fix-flaky-tests</span> at <span class="mono">abc1234</span>', 'Nothing to push: the files match the last commit on <span class="mono">ax/fix-flaky-tests</span>']);
    never(h, ['data-action="live-changes-push"']);
    need(toasts(p), ['Pushed <span class="mono">ax/fix-flaky-tests</span>']);
  });
  await check("Apply to a folder: when the changes don't fit, nothing is changed and the dialog says so", async () => {
    B.applyConflict = true;
    api.ACTIONS['live-changes-apply']({ dataset: { task: 'fix-flaky-tests' } });
    await fire(dialog(p).querySelector('#lap-go'), 'click');
    need(dialog(p).querySelector('#lap-body').innerHTML, ['Give the folder']);
    await fire(dialog(p).querySelector('#lap-body').querySelector('#lap-path'), 'input', { target: { value: '~/code/project' } });
    await fire(dialog(p).querySelector('#lap-go'), 'click');
    need(dialog(p).querySelector('#lap-body').innerHTML, ['fit that folder as it is now, so nothing was changed. Push them to a branch instead.', 'patch does not apply']);
    B.applyConflict = false;
    await fire(dialog(p).querySelector('#lap-go'), 'click');
    const sent = B.posts.filter((x) => x.path === '/api/tasks/apply-local').pop();
    if (sent.body.localRepoPath !== '~/code/project' || sent.body.task !== 'fix-flaky-tests') throw new Error(JSON.stringify(sent.body));
    need(api.liveChangesInnerHTML('fix-flaky-tests'), ['Applied 2 files to <span class="mono">/Users/me/code/project</span>. Nothing was committed.']);
    if (p.store['ax.live.applyPath'] !== '~/code/project') throw new Error('the folder is remembered for next time');
  });
  await check('a paused task says its sandbox is closed, and the changes are read again once it runs', async () => {
    await api.liveTaskAction('fix-flaky-tests', 'suspend');
    await settle();
    need(api.liveChangesInnerHTML('fix-flaky-tests'), ['The task is paused, so its sandbox is closed. Resume it to see its changes.']);
    await api.liveTaskAction('fix-flaky-tests', 'resume');
    await settle();
    need(api.liveChangesInnerHTML('fix-flaky-tests'), ['Nothing to push']);
  });

  // ---------- New task ----------
  await go(p, '#/new');
  await check('New task: three templates with Antigravity first, debug access off, and nothing runs without a goal', () => {
    const h = main(p);
    need(h, ['Start a task', 'id="live-agent-antigravity"', 'id="live-agent-claude"', 'id="live-agent-image"', 'Your own image', 'Gemini API key', 'Git repo', 'Debug access', 'id="live-new-run"', 'Describe the goal.']);
    if (!/aria-checked="true"[^>]*id="live-agent-antigravity"/.test(h)) throw new Error('Antigravity is the default');
    if (/id="live-new-debug"[^>]*checked/.test(h) || L.draft.debug) throw new Error('debug access is off by default');
    if (api.liveNewIssues(L.draft)[0] !== 'Describe the goal.') throw new Error(api.liveNewIssues(L.draft).join(' | '));
    return { html: h };
  });
  await check('the form says what is wrong: an image without a digest, a repo that is not https', () => {
    const d = Object.assign({}, L.draft, { agent: 'image', image: 'ghcr.io/me/agent:latest', goal: 'x' });
    if (!/must end in its digest/.test(api.liveNewIssues(d)[0])) throw new Error(api.liveNewIssues(d).join(' | '));
    d.image = 'ghcr.io/me/agent@sha256:' + 'a'.repeat(64);
    d.repo = 'git@github.com:me/project.git';
    if (!/https:\/\/ Git address/.test(api.liveNewIssues(d)[0])) throw new Error(api.liveNewIssues(d).join(' | '));
    d.repo = 'https://github.com/me/project.git';
    if (api.liveNewIssues(d).length) throw new Error(api.liveNewIssues(d).join(' | '));
  });
  await check('the task files are what AX reads: a Gateway that adds the key outside the sandbox, a Workspace that clones the repo, a Task', () => {
    Object.assign(L.draft, { goal: 'Make the signer tests pass.\nExplain what was wrong.', repo: 'https://gitlab.example.com/me/project.git', branch: 'dev' });
    const y = api.liveNewYAML(L.draft, 'text', '');
    const name = api.liveDraftName(L.draft);
    if (!/^make-the-signer-tests-ab[0-9a-f]{2}$/.test(name)) throw new Error('name: ' + name);
    need(y, ['kind: Gateway', `name: "gw-${name}"`, 'hostnames: ["generativelanguage.googleapis.com"]', 'header: "x-goog-api-key"', 'credentialUri: "ate-secret://k8s.io/default/ax-system/gemini-api-creds/GEMINI_API_KEY"',
      'hostnames: ["gitlab.example.com", "github.com", "api.github.com"', 'kind: Workspace', `name: "ws-${name}"`, 'repo: "https://gitlab.example.com/me/project.git"', 'dir: "."', 'ref: "dev"',
      'kind: Task', 'image: "ghcr.io/', '@sha256:', '  goal:\n    text: |\n      Make the signer tests pass.\n      Explain what was wrong.', 'model: gemini-3.8-flash', '- name: "GEMINI_API_KEY"\n      value: "placeholder"',
      `  workspace:\n    name: "ws-${name}"`, `  gateway:\n    name: "gw-${name}"`]);
    never(y, ['debug:', 'sessionId:', 'sk-']);
    if (y.split('\n---\n').length !== 3) throw new Error('three files');
  });
  await check('Locked down reaches only the model and the repo; debug access and your own image show in the Task', () => {
    const d = Object.assign({}, L.draft, { network: 'locked', debug: true });
    const y = api.liveNewYAML(d, 'text', '');
    need(y, ['hostnames: ["gitlab.example.com"]', '\n  debug: true']);
    never(y, ['pypi.org', 'registry.npmjs.org']);
    const own = api.liveNewYAML(Object.assign({}, L.draft, { agent: 'image', image: 'ghcr.io/me/agent@sha256:' + 'a'.repeat(64), repo: '', network: 'locked', nameEdited: true, name: 'my-agent' }), 'text', '');
    need(own, ['kind: Task', 'name: "my-agent"', 'image: "ghcr.io/me/agent@sha256:']);
    never(own, ['kind: Gateway', 'kind: Workspace', 'config:', 'GEMINI_API_KEY']);
  });
  await check('Run stores the key on the cluster, applies the files, starts the task and opens it', async () => {
    L.draft.key = 'sk-not-a-real-key';
    const name = api.liveDraftName(L.draft);
    await api.liveNewRun();
    await settle();
    if (JSON.stringify(B.secrets) !== '[{"context":"ax-local","name":"gemini-api-creds","key":"GEMINI_API_KEY","length":17}]') throw new Error(JSON.stringify(B.secrets));
    const tail = B.ax.slice(-2).join(' | ');
    if (tail !== `--context ax-local -a default apply -f - | --context ax-local -a default resume task ${name}`) throw new Error(tail);
    if (B.applied[B.applied.length - 1].includes('sk-not-a-real-key')) throw new Error('the key never goes into the task files');
    const t = L.tasks.find((x) => x.name === name);
    if (!t || t.state !== 'Working' || t.goal !== 'Make the signer tests pass.\nExplain what was wrong.') throw new Error(JSON.stringify(t && [t.state, t.goal]));
    if (p.ctx.location.hash !== `#/task/${name}` || L.draft !== null) throw new Error('opens the task: ' + p.ctx.location.hash);
    need(toasts(p), [`Started <span class="mono">${name}</span>`]);
  });
  await check('with an AX from before the goal field was renamed, the same task is sent again with the old name', async () => {
    B.goalField = 'spec';
    await go(p, '#/new');
    Object.assign(L.draft, { goal: 'Tidy the docs.' });
    const name = api.liveDraftName(L.draft);
    await api.liveNewRun();
    await settle();
    const two = B.applied.slice(-2);
    if (!/\n    text: "Tidy the docs\."/.test(two[0]) || !/\n    spec: "Tidy the docs\."/.test(two[1])) throw new Error(two.map((x) => x.slice(-300)).join('\n=====\n'));
    if (!L.tasks.some((x) => x.name === name && x.goal === 'Tidy the docs.')) throw new Error('the task is created');
    B.goalField = 'text';
  });
  await check('when ax apply fails, the form stays with what AX said', async () => {
    B.noAx = true;
    await go(p, '#/new');
    L.draft.goal = 'Anything.';
    await api.liveNewRun();
    await settle();
    B.noAx = false;
    if (!L.draft || !/executable file not found/.test(L.draft.error) || L.draft.busy) throw new Error(JSON.stringify(L.draft && [L.draft.error, L.draft.busy]));
    need(main(p), ['role="alert"', 'executable file not found', 'Anything.']);
  });

  // ---------- A follow-up ----------
  await check('a follow-up is a new task in the same session, on the same workspace and network rules', async () => {
    const first = L.tasks.find((x) => /^make-the-signer-tests-/.test(x.name));
    await go(p, `#/new?from=${first.name}`);
    const h = main(p);
    need(h, ['Send a follow-up', `Following up on <span class="mono">${first.name}</span>`, "Files the last turn left unpushed don't carry over.", `It uses the workspace <span class="mono">ws-${first.name}</span> from the last turn.`,
      `It uses the network rules <span class="mono">gw-${first.name}</span> from the last turn.`, 'Send follow-up']);
    never(h, ['id="live-new-repo"']);
    L.draft.goal = 'Also add a regression test.';
    const name = api.liveDraftName(L.draft);
    if (name === first.name || !/^make-the-signer-tests-ab[0-9a-f]{2}$/.test(name)) throw new Error('a new name on the same stem: ' + name);
    const y = api.liveNewYAML(L.draft, 'text', '');
    need(y, [`sessionId: "uid-${first.name}"`, `  workspace:\n    name: "ws-${first.name}"`, `  gateway:\n    name: "gw-${first.name}"`, 'text: "Also add a regression test."']);
    never(y, ['kind: Gateway', 'kind: Workspace']);
    await api.liveNewRun();
    await settle();
    const home = api.liveViewHome().html;
    if (!new RegExp(`id="live-row-${first.name}"[\\s\\S]*Turn 1 of 2[\\s\\S]*id="live-row-${name}"[\\s\\S]*Turn 2 of 2`).test(home)) throw new Error('the two turns sit together on Home');
  });

  // ---------- Running on another cluster ----------
  await check('ax promote gets the task, the cluster and the options you chose', () => {
    const a = (o, pre) => api.livePromoteArgs(Object.assign({ name: 'fix-flaky-tests', to: 'gke-team-dev', replace: false, suspend: false }, o), pre).join(' ');
    if (a({}, true) !== 'promote task fix-flaky-tests --to gke-team-dev --to-namespace ax-system --preflight-only') throw new Error(a({}, true));
    if (a({ replace: true, suspend: true }, false) !== 'promote task fix-flaky-tests --to gke-team-dev --to-namespace ax-system --replace --suspend-source') throw new Error(a({ replace: true, suspend: true }, false));
  });
  await check("what ax promote prints reads in the UI's words, and a line it doesn't know stays as it is", () => {
    const line = api.livePromoteLine;
    const got = [line('gateway.ax.io/gw-1 created (preflight only)'), line('gateway.ax.io/gw-1 reused'), line('workspace.ax.io/ws-1 unchanged (preflight only)'), line('task.ax.io/t-1 replaced'),
      line('task.ax.io/t-1 suspended on the source (preflight only)'), line('task.ax.io/t-1 resumed'), line('something <new>')].join(' | ');
    const want = ['Creates the network rules <span class="mono">gw-1</span> there', 'Uses the network rules <span class="mono">gw-1</span> that are already there', 'Uses the workspace <span class="mono">ws-1</span> that is already there',
      'Deletes the task <span class="mono">t-1</span> that is already there, then creates it again', 'Pauses <span class="mono">t-1</span> on this cluster', 'Starts <span class="mono">t-1</span> there', 'something &lt;new&gt;'].join(' | ');
    if (got !== want) throw new Error(got);
    const note = api.livePromoteNote('Note: the target must provide the credentials that gateway gw-1 injects: ate-secret://k8s.io/default/ax-system/gemini-api-creds/GEMINI_API_KEY');
    if (note !== "That cluster needs its own copy of the key <span class=\"mono\">gemini-api-creds</span>. Keys aren't copied.") throw new Error(note);
  });
  await check("Run on another cluster checks first: a cluster it can't reach keeps Send off", async () => {
    await go(p, '#/task/fix-flaky-tests');
    api.liveOpenPromote('fix-flaky-tests');
    await settle();
    const d = dialog(p);
    need(d.querySelector('#lp-body').innerHTML, ['<option value="gke-broken" selected>', 'It pulls from the Git branch that was pushed', "that cluster's own Gateway credentials", 'The check found a problem:', 'i/o timeout',
      'ax --context ax-local promote task fix-flaky-tests --to gke-broken --to-namespace ax-system']);
    if (!d.querySelector('#lp-go').disabled) throw new Error('Send stays off');
    if (!B.ax[B.ax.length - 1].endsWith('--to gke-broken --to-namespace ax-system --preflight-only')) throw new Error(B.ax[B.ax.length - 1]);
    if (B.tasks['gke-team-dev'].length !== 1) throw new Error('a check changes nothing');
  });
  await check('a cluster that passes shows what will happen, and Send runs the task there and switches to it', async () => {
    let d = dialog(p);
    await fire(d.querySelector('#lp-body').querySelector('#lp-to'), 'change', { target: { value: 'gke-team-dev' } });
    await fire(dialog(p).querySelector('#lp-body').querySelector('#lp-suspend'), 'change', { target: { checked: true } });
    d = dialog(p);
    need(d.querySelector('#lp-body').innerHTML, ['The check passed. This is what sending it does:', 'Creates the network rules <span class="mono">review-bot-gw</span> there', 'Uses the workspace <span class="mono">itsdangerous</span> that is already there',
      'Creates the task <span class="mono">fix-flaky-tests</span> there', 'Pauses <span class="mono">fix-flaky-tests</span> on this cluster', 'Starts <span class="mono">fix-flaky-tests</span> there', 'That cluster needs its own copy of the key',
      '--to gke-team-dev --to-namespace ax-system --suspend-source']);
    if (d.querySelector('#lp-go').disabled) throw new Error('Send is on once the check passes');
    await fire(d.querySelector('#lp-go'), 'click');
    if (B.ax[B.ax.length - 1] !== '--context ax-local -a default promote task fix-flaky-tests --to gke-team-dev --to-namespace ax-system --suspend-source') throw new Error(B.ax[B.ax.length - 1]);
    if (L.context !== 'gke-team-dev' || p.store['ax.live.context'] !== 'gke-team-dev') throw new Error('Studio switches to that cluster: ' + L.context);
    if (L.tasks.map((t) => t.name).sort().join() !== 'fix-flaky-tests,nightly-triage') throw new Error(L.tasks.map((t) => t.name).join());
    if (B.tasks['ax-local'].find((t) => t.metadata.name === 'fix-flaky-tests').status.state !== 'TASK_STATE_SUSPENDED') throw new Error('paused where it came from');
    need(toasts(p), ['<span class="mono">fix-flaky-tests</span> is running on gke-team-dev']);
  });
  await check('a task that is already there needs Replace, and the dialog says so', async () => {
    api.ACTIONS['live-use-context']({ dataset: { context: 'ax-local' } });
    await settle();
    await go(p, '#/task/fix-flaky-tests');
    api.liveOpenPromote('fix-flaky-tests');
    await settle();
    await fire(dialog(p).querySelector('#lp-body').querySelector('#lp-to'), 'change', { target: { value: 'gke-team-dev' } });
    need(dialog(p).querySelector('#lp-body').innerHTML, ['already exists on target', 'To send it anyway, turn on <b>Replace the task that is there</b>.']);
    if (!dialog(p).querySelector('#lp-go').disabled) throw new Error('Send stays off');
    await fire(dialog(p).querySelector('#lp-body').querySelector('#lp-replace'), 'change', { target: { checked: true } });
    need(dialog(p).querySelector('#lp-body').innerHTML, ['Deletes the task <span class="mono">fix-flaky-tests</span> that is already there, then creates it again']);
    never(dialog(p).querySelector('#lp-body').innerHTML, ['id="lp-fix"']);
    if (dialog(p).querySelector('#lp-go').disabled) throw new Error('Send is on');
  });

  // ---------- Where agents run ----------
  await check('Where agents run shows AX on this computer and the clusters in the kubeconfig', async () => {
    await go(p, '#/places');
    const h = main(p);
    need(h, ['On this computer', '<span class="hd"></span>Running', 'ate-api-server (1/1 available)', 'ax-server (1/1 available in ax-system)', 'data-action="live-local-stop"', 'gke-team-dev', 'gke_acme_us-central1_team-dev', 'In use',
      'data-action="live-use-context" data-context="gke-team-dev"', "doesn't change your kubeconfig", 'Current in your kubeconfig']);
    never(h, ['data-action="live-use-context" data-context="ax-local"', '127.0.0.1']);
    return { html: h };
  });
  await check("picking a cluster is Studio's own choice: it is remembered, and the kubeconfig is left alone", async () => {
    api.ACTIONS['live-use-context']({ dataset: { context: 'gke-team-dev' } });
    await settle();
    if (L.context !== 'gke-team-dev' || p.store['ax.live.context'] !== 'gke-team-dev') throw new Error('context');
    if (!B.calls.includes('GET /api/tasks?context=gke-team-dev&atespace=default')) throw new Error('tasks are read from the new cluster');
    if (B.calls.some((c) => /\/api\/env\/context/.test(c))) throw new Error('Studio must not switch the kubeconfig');
  });
  await check("a cluster Studio can't reach: it says so with the server's own words and the command, and claims no task count", async () => {
    api.ACTIONS['live-use-context']({ dataset: { context: 'gke-broken' } });
    await settle();
    const v = api.liveViewHome();
    need(v.html, ["Can't reach AX on gke-broken", 'Unable to connect to the server: dial tcp 34.118.12.7:443: i/o timeout', 'ax --context gke-broken get tasks', 'data-action="live-refresh"', "Studio can't reach AX right now."]);
    never(v.html, ['0 tasks']);
    return v;
  });
  await check('when AX and AX Studio are different versions, the page says that, not just the decoding error', async () => {
    const before = L.error;
    L.error = 'grpc: failed to unmarshal the received message: proto: cannot parse invalid wire-format data';
    const v = api.liveViewHome();
    need(v.html, ['AX on gke-broken and AX Studio are different versions', 'Update the older one so the two match.', 'cannot parse invalid wire-format data', "Studio can't read what AX sent.", 'data-action="live-refresh"']);
    never(v.html, ["Can't reach AX"]);
    L.error = before;
    return v;
  });
  await check("a cluster without AX says AX isn't installed there, with the command that installs it", async () => {
    const before = L.error;
    L.error = 'kubectl port-forward exited for context "gke-broken": Error from server (NotFound): services "ax-server" not found';
    const v = api.liveViewHome();
    need(v.html, ["AX isn't installed on gke-broken", 'ax --context gke-broken install', 'services &quot;ax-server&quot; not found', "AX isn't on this cluster yet."]);
    never(v.html, ["Can't reach AX", 'different versions']);
    L.error = before;
    return v;
  });
  await check('pages with no real source say so instead of showing demo data', async () => {
    for (const [part, what] of [['guardrails', 'Guardrails'], ['settings', 'Settings'], ['welcome', 'Setup']]) need(api.liveViewNotYet(part).html, [`${what} isn't connected to AX yet`, 'href="#/"']);
    await go(p, '#/guardrails');
    need(main(p), ["Guardrails isn't connected to AX yet"]);
    never(main(p), ['Open the previous pages']);
  });
  await check('a server restart hands out a new token, and the next change gets it and goes through', async () => {
    B.token = 2;
    const r = await api.studioPost('/api/tasks/suspend', { context: 'gke-team-dev', atespace: 'default', name: 'nightly-triage' });
    const last = B.posts.slice(-2).map((x) => x.token).join();
    if (!r.ok || last !== 'tok-1,tok-2') throw new Error(last);
  });

  // ---------- The Studio server stops answering ----------
  await check("when the Studio server stops answering, the page says so and how to start it again", async () => {
    B.offline = true;
    api.ACTIONS['live-use-context']({ dataset: { context: 'ax-local' } });
    await settle();
    await go(p, '#/');
    if (L.phase !== 'offline') throw new Error('phase: ' + L.phase);
    need(main(p), ["AX Studio isn't answering", 'ax studio', 'data-action="live-recheck"', 'Your clusters and tasks keep running']);
    B.offline = false;
    api.ACTIONS['live-recheck']();
    await settle();
    if (L.phase !== 'ready' || !L.tasks.length) throw new Error('Check again reconnects: ' + L.phase);
  });

  // ---------- First run: no AX on this computer yet ----------
  const F = makeBackend({ env: envFresh(), tasks: {} });
  const f = makeContext(F);
  await settle();
  await check('first run: Home is setup, with the real checks and what gets installed', () => {
    const h = main(f);
    if (f.api.LIVE.context !== '' || f.api.LIVE.local.state !== 'NotFound') throw new Error(JSON.stringify([f.api.LIVE.context, f.api.LIVE.local]));
    need(h, ['Set up AX on this computer', 'A container runtime that is running', 'docker 27.3 is running', 'Free disk space', '212 GiB free', 'What gets installed?', 'gVisor sandbox', 'Use other AX images',
      'data-action="live-setup-start"', 'ax local start', 'Or run on a remote cluster']);
    never(h, ['microVM', 'administrator', 'id="live-setup-start" disabled']);
    if (F.calls.some((c) => /\/api\/tasks/.test(c))) throw new Error('with no cluster there is nothing to list');
    return { html: h };
  });
  await check('a check that fails says how to fix it, and setup waits', async () => {
    F.env.canStartLocal = false;
    F.env.preflight[1] = { id: 'container_engine', label: 'Container engine', status: 'fail', detail: 'No container runtime is running', command: 'open -a Docker' };
    await f.api.ACTIONS['live-env-refresh']();
    await settle();
    need(main(f), ['No container runtime is running', 'open -a Docker', 'id="live-setup-start" disabled', 'Fix what the checks found, then check again.']);
    F.env.canStartLocal = true;
    F.env.preflight[1] = Object.assign({}, CHECKS_OK[1]);
    await f.api.ACTIONS['live-env-refresh']();
    await settle();
  });
  await check('Set up starts it on the server, with the images you gave, and shows each stage as its output arrives', async () => {
    f.api.LIVE.images.defaultTaskImage = ' registry.example.com/task-runner@sha256:abc ';
    f.api.ACTIONS['live-setup-start']();
    await settle();
    const sent = F.posts.find((x) => x.path === '/api/env/local/up');
    if (JSON.stringify(sent.body) !== '{"name":"ax-local","workers":1,"defaultTaskImage":"registry.example.com/task-runner@sha256:abc"}') throw new Error(JSON.stringify(sent.body));
    need(main(f), ['Setting up AX on this computer', 'Creating the Kubernetes cluster']);
    const id = f.api.LIVE.op.id;
    F.push('streamLine', { id, line: '==> Installing Agent Substrate v1.0.0 (ate-system)...', stage: 'substrate' });
    F.push('streamLine', { id: 'another-op', line: 'not ours' });
    if (f.api.LIVE.op.stage !== 'substrate' || f.api.LIVE.op.logs.length !== 1) throw new Error(JSON.stringify(f.api.LIVE.op));
    f.api.render();
    need(main(f), ['Installing Agent Substrate', '==&gt; Installing Agent Substrate v1.0.0 (ate-system)...']);
  });
  await check('when setup fails, the page says where it stopped and keeps the output', async () => {
    const id = f.api.LIVE.op.id;
    F.push('streamLine', { id, line: 'Error: installing Substrate: pulling image: 403 Forbidden' });
    F.push('envOp', { id, action: 'local-up', target: 'ax-local', status: 'failed', stage: 'substrate', error: 'exit status 1' });
    await settle();
    need(main(f), ['Setup stopped.', 'installing Substrate: pulling image: 403 Forbidden', 'data-action="live-setup-start"']);
    never(main(f), ['Your tasks']);
  });
  await check('when setup finishes, Studio uses AX on this computer and Home becomes the task list', async () => {
    f.api.ACTIONS['live-setup-start']();
    await settle();
    const id = f.api.LIVE.op.id;
    F.env = envRunning();
    F.env.contexts = [Object.assign({}, CONTEXTS[0])];
    F.tasks['ax-local'] = [];
    F.push('envOp', { id, action: 'local-up', target: 'ax-local', status: 'ok', stage: 'ax' });
    await settle();
    if (f.api.LIVE.context !== 'ax-local' || f.api.LIVE.local.state !== 'Running') throw new Error(JSON.stringify([f.api.LIVE.context, f.api.LIVE.local.state]));
    f.api.render();
    need(main(f), ['Your tasks', 'No tasks here yet', 'href="#/new"']);
    need(toasts(f), ['AX is running on this computer']);
  });
  await check('AX on this computer, stopped: Home says so and offers Start; nothing is listed until it runs', async () => {
    F.env.local.state = 'Stopped';
    const before = F.calls.filter((c) => /\/api\/tasks\?/.test(c)).length;
    await f.api.ACTIONS['live-env-refresh']();
    await settle();
    f.api.render();
    need(main(f), ['AX on this computer is stopped', 'Your tasks and their files are kept.', 'id="live-setup-start"', '</svg>Start</button>']);
    if (F.calls.filter((c) => /\/api\/tasks\?/.test(c)).length !== before) throw new Error('a stopped cluster is not asked for tasks');
  });
  await check("without the ax command, setup says what is missing and doesn't start", async () => {
    const N = makeBackend({ env: envFresh(), tasks: {}, noAx: true });
    const q = makeContext(N);
    await settle();
    need(main(q), ["Studio couldn't run the <span class=\"mono\">ax</span> command, and setup needs it.", 'executable file not found', 'id="live-setup-start" disabled']);
  });

  // ---------- A build that still includes the pages this UI replaces ----------
  await check('when the build includes the previous pages, the UI links to them for what it lacks', async () => {
    const C = makeBackend();
    const c = makeContext(C, { server: true, classic: '/classic/' });
    await settle();
    need(c.api.liveShellHTML(), ['id="live-classic" href="/classic/"', 'Previous pages']);
    need(c.api.liveViewNotYet('guardrails').html, ['Until it is connected, the previous pages do this job.', 'href="/classic/"', 'Open the previous pages']);
  });

  // ---------- Sanctuary UI/UX & MVP features ----------
  await check('every live page has Axel in his Sanctuary role, and never more than one Axel on screen', async () => {
    const M = makeBackend();
    const m = makeContext(M);
    await settle();
    for (const [page, v] of [
      ['Home', m.api.liveViewHome()],
      ['Where agents run', m.api.liveViewPlaces()],
      ['Task', m.api.liveViewTask('fix-flaky-tests')],
      ['New task', m.api.liveViewNew()],
      ['Setup', m.api.liveViewSetup(false)],
    ]) {
      const count = (v.html.match(/<svg [^>]*class="axo\b/g) || []).length;
      if (count !== 1) throw new Error(`${page} should have 1 Axel, got ${count}`);
    }
  });
  await check('per-file Discard confirms first and removes that file from Changes', async () => {
    const M = makeBackend();
    const m = makeContext(M);
    await settle();
    await go(m, '#/task/fix-flaky-tests');
    await m.api.liveLoadChanges('fix-flaky-tests');
    m.api.liveOpenDiscard('fix-flaky-tests', 'notes/why.md');
    need(m.els['#overlay'].innerHTML, ['Discard changes to notes/why.md?', 'id="ldc-go"']);
    need(dialog(m).querySelector('#ldc-body').innerHTML, ['git checkout -- notes/why.md']);
    await fire(dialog(m).querySelector('#ldc-go'), 'click');
    const sent = M.posts.find((x) => x.path === '/api/tasks/discard-file');
    if (!sent || sent.body.path !== 'notes/why.md' || sent.body.task !== 'fix-flaky-tests') throw new Error(JSON.stringify(sent));
    need(m.api.liveChangesInnerHTML('fix-flaky-tests'), ['Discarded changes to <span class="mono">notes/why.md</span>', 'src/signer.py']);
    never(m.api.liveChangesInnerHTML('fix-flaky-tests'), ['<span class="lf-path">notes/why.md</span>']);
  });
  await check('in-page Terminal opens an ax ssh session, streams output, sends commands and disconnects', async () => {
    const M = makeBackend();
    const m = makeContext(M);
    await settle();
    await go(m, '#/task/fix-flaky-tests');
    need(main(m), ['id="live-term"', 'id="live-term-open"', 'Open shell in sandbox']);
    await m.api.liveTermOpen('fix-flaky-tests');
    await settle();
    const startPost = M.posts.find((x) => x.path === '/api/sessions/start');
    if (!startPost || startPost.body.args.join(' ') !== '--context ax-local -a default ssh fix-flaky-tests') throw new Error(JSON.stringify(startPost));
    M.push('sessionData', { id: 'term-fix-flaky-tests', data: 'root@sandbox:/workspace# ', stream: 'stdout' });
    need(m.api.liveTermInnerHTML('fix-flaky-tests', 'Working'), ['Connected', 'root@sandbox:/workspace#', 'id="live-term-in"']);
    await m.api.liveTermClose('fix-flaky-tests');
    if (!M.posts.some((x) => x.path === '/api/sessions/close' && x.body.id === 'term-fix-flaky-tests')) throw new Error('close session');
  });
  await check('New task shows prompt-clarity helper pills and the visual Guardrails gateMap', async () => {
    const M = makeBackend();
    const m = makeContext(M);
    await settle();
    await go(m, '#/new');
    need(main(m), ['id="live-goal-help"', 'data-action="live-new-suggest"', 'id="live-new-gatemap"', 'generativelanguage.', 'github.com']);
    m.api.ACTIONS['live-new-suggest']({ dataset: { text: 'Fix the failing tests' } });
    if (m.api.LIVE.draft.goal !== 'Fix the failing tests') throw new Error(m.api.LIVE.draft.goal);
    need(m.api.liveGoalHelpHTML(m.api.LIVE.draft), ['Make it clearer:', 'data-action="live-new-tip"']);
    m.api.ACTIONS['live-new-tip']({ dataset: { tip: 'done' } });
    if (!/Done when:/.test(m.api.LIVE.draft.goal)) throw new Error(m.api.LIVE.draft.goal);
  });
  await check('stopping AX on this computer when tasks are running offers to pause them first so checkpoints survive', async () => {
    const M = makeBackend();
    const m = makeContext(M);
    await settle();
    await go(m, '#/places');
    m.api.ACTIONS['live-local-stop']();
    need(m.els['#overlay'].innerHTML, ['Stop AX on this computer?', 'id="ls-go"']);
    need(dialog(m).querySelector('#ls-body').innerHTML, ['Pause running tasks first']);
    await fire(dialog(m).querySelector('#ls-go'), 'click');
    const paused = M.posts.filter((x) => x.path === '/api/tasks/suspend').map((x) => x.body.name).sort().join();
    if (paused !== 'fix-flaky-tests,signer-b2c3') throw new Error('paused before stop: ' + paused);
    if (!M.posts.some((x) => x.path === '/api/env/local/stop')) throw new Error('local stop called after pausing');
  });
  await check('the live command palette lists real tasks, clusters and actions with their ax CLI equivalents', async () => {
    const M = makeBackend();
    const m = makeContext(M);
    await settle();
    await go(m, '#/task/fix-flaky-tests');
    const items = m.api.livePaletteItems();
    const labels = items.map((x) => x.label).join(' | ');
    need(labels, ['New task', 'Pause fix-flaky-tests', 'Open shell in sandbox', 'Use cluster gke-team-dev', 'Fix the flaky tests.']);
  });

  console.log(fails ? `\n${fails} FAILED of ${n}` : `\nALL OK (${n} checks)`);
  process.exit(fails ? 1 : 0);
})();
