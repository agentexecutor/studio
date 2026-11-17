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

// Smoke test · live mode (live.js). Loads AX Studio in a stubbed DOM with a stand-in for the Studio app's bridge
// (window.studio), which answers the way the ax CLI does: the same tables, the same "Key:  value" lines, the same task
// file. Checks that the pages show what ax printed, that every command names the cluster instead of changing the
// kubeconfig, and that pages with no real source stay hidden. Usage: node tests/smoke_live.js [app folder]
const fs = require('fs');
const vm = require('vm');
const dir = process.argv[2] || require('path').resolve(__dirname, '..');

/* ---------- What ax prints (google/ax: cmd/ax) ---------- */
const CTX = `CURRENT  NAME          CLUSTER                        AX TUNNEL
*        ax-local      kind-ax-local                  127.0.0.1:41873 -> ax-system/ax-server (Healthy)
         gke-team-dev  gke_acme_us-central1_team-dev  -
         gke-broken    gke_acme_europe-west4_old      127.0.0.1:38211 -> ax-system/ax-server (Stale)
`;
const LOCAL = `Cluster:       ax-local (kind)
State:         Running
Kube Context:  ax-local
Substrate:     ate-api-server (1/1 available)
AX Server:     ax-server (1/1 available in ax-system)
`;
const tasksTable = (rows) => ['NAME              ATESPACE   STATE            ACTOR             AGE'].concat(rows.map((r) => `${r.name.padEnd(18)}default    ${r.state.padEnd(17)}${r.name.padEnd(18)}${r.age}`)).join('\n') + '\n';
const taskYAML = (t) => `apiVersion: ax.io/v1alpha1\nkind: Task\nmetadata:\n  name: ${t.name}\n  atespace: default\n  createTime: "2026-11-16T23:40:12Z"\nspec:\n  goal:\n    text: ${t.goal}\nstatus:\n  state: TASK_STATE_${t.state.toUpperCase()}\n`;
const taskDoc = (t) => ({
  apiVersion: 'ax.io/v1alpha1', kind: 'Task',
  metadata: { name: t.name, atespace: 'default', createTime: '2026-11-16T23:40:12Z', labels: { team: 'platform' } },
  spec: { profile: { image: 'gcr.io/p/claude-code@sha256:abc', resources: { limits: { cpu: '2', memory: '4Gi' } } }, workspace: { name: 'itsdangerous' }, debug: t.debug !== false, goal: { text: t.goal }, gateway: t.gateway === false ? undefined : { name: 'review-bot-gw' }, sessionId: 's-1' },
  status: { state: 'TASK_STATE_' + t.state.toUpperCase(), conditions: [{ type: 'Ready', status: 'True', reason: 'TaskRunning', message: 'Task is running and its workspace is ready' }], statusDetail: t.detail },
});

const ax = {
  installed: true,
  calls: [],
  tasks: {
    'ax-local': [
      { name: 'readme-polish', state: 'Suspended', age: '3h', goal: 'Tighten the README.', debug: false, gateway: false },
      { name: 'fix-flaky-tests', state: 'Working', age: '12m', goal: 'Fix the flaky tests.' },
      { name: 'upgrade-node-22', state: 'Failed', age: '1d', goal: 'Upgrade to Node 22.', detail: { reason: 'TASK_STATUS_REASON_SANDBOX_CRASHED', detail: 'sandbox exited: out of memory (limit 512Mi)' } },
    ],
    'gke-team-dev': [{ name: 'nightly-triage', state: 'Working', age: '2h', goal: 'Triage the failing builds.' }],
  },
};
function fakeAx(args) {
  ax.calls.push(args.join(' '));
  if (!ax.installed) return { status: 127, stdout: '', stderr: 'ax: spawn ax ENOENT' };
  const a = args.slice();
  let ctx = 'ax-local';
  if (a[0] === '--context') { ctx = a[1]; a.splice(0, 2); }
  if (a[0] === '-a') a.splice(0, 2);
  const ok = (stdout) => ({ status: 0, stdout, stderr: '' });
  const err = (m) => ({ status: 1, stdout: '', stderr: 'Error: ' + m + '\n' });
  if (a[0] === 'version') return ok('ax version v1alpha1\n');
  if (a[0] === 'ctx') return a.length === 1 ? ok(CTX) : err('this test never switches the kubeconfig');
  if (a.join(' ') === 'local status') return ok(LOCAL);
  if (ctx === 'gke-broken') return err('listing tasks: rpc error: code = Unavailable desc = connection refused');
  const list = ax.tasks[ctx] || [];
  if (a.join(' ') === 'get tasks') return ok(tasksTable(list));
  const t = list.find((x) => x.name === a[2]);
  if (a[0] === 'get' && a[1] === 'task') return t ? ok(taskYAML(t)) : err(`getting task "${a[2]}": rpc error: code = NotFound desc = not found`);
  if (a[1] === 'task' && t && a[0] === 'suspend') { t.state = 'Suspended'; return ok(`task.ax.io/${t.name} suspended\n`); }
  if (a[1] === 'task' && t && a[0] === 'resume') {
    if (t.name === 'upgrade-node-22') return err('resuming task: rpc error: code = ResourceExhausted desc = no free workers available');
    t.state = 'Working'; return ok(`task.ax.io/${t.name} resumed\n`);
  }
  if (a[1] === 'task' && t && a[0] === 'delete') { list.splice(list.indexOf(t), 1); return ok(`task.ax.io/${t.name} deleted\n`); }
  return err('unknown command ' + a.join(' '));
}
const bridge = {
  platform: async () => ({ os: 'darwin', home: '/Users/me', pathSeparator: ':', version: '0.1.0' }),
  which: async (p) => (p === 'ax' && ax.installed ? '/Users/me/.ax/bin/ax' : null),
  fileExists: async () => false,
  run: async ({ args }) => fakeAx(args),
  parseYAML: async (text) => { const name = (/^\s+name: (\S+)/m.exec(text) || [])[1]; const t = Object.values(ax.tasks).flat().find((x) => x.name === name); return [taskDoc(t)]; },
};

/* ---------- A stubbed page (the same stubs as the other smoke tests) ---------- */
function makeContext(studio) {
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
  ['#root', '#main', '#overlay', '#toasts', '#bell-pop', '#announcer', '#crumbs', '#live-nav-tasks', '#live-foot'].forEach((k) => { namedEls[k] = fakeEl(k); });
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
  const ctx = {
    console, URLSearchParams, JSON, Math, Date, String, Number, Object, Array, Promise, RegExp, encodeURIComponent, decodeURIComponent,
    Blob: function Blob(a) { this.a = a; },
    URL: { createObjectURL: () => 'blob:ax', revokeObjectURL: () => {} },
    document: doc,
    navigator: { platform: 'MacIntel', clipboard: { writeText: () => Promise.resolve() } },
    location: { hash: '#/', search: '', pathname: '/index.html', get href() { return 'http://localhost' + this.pathname + this.search + this.hash; }, replace(u) { u = String(u); this.hash = u.includes('#') ? u.slice(u.indexOf('#')) : ''; } },
    history: { replaceState() {} },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    setTimeout: () => 0, clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
    innerWidth: 1440, innerHeight: 900, scrollY: 0, scrollTo() {}, requestAnimationFrame: () => 0,
    getSelection: () => '',
  };
  ctx.window = ctx;
  ctx.window.matchMedia = () => ({ matches: false, addEventListener() {} });
  ctx.window.addEventListener = () => {};
  if (studio) ctx.window.studio = studio;
  vm.createContext(ctx);
  const files = ['core.js', 'mascot.js', 'viz.js', 'failures.js', 'views.js', 'task.js', 'overlays.js', 'live.js', 'app.js'];
  vm.runInContext(files.map((f) => fs.readFileSync(dir + '/' + f, 'utf8')).join('\n;\n') + `
;globalThis.__api = { state, render, ACTIONS, LIVE, liveOn, liveParseTable, liveParseTasks, liveParseContexts, liveParseLocal, liveStateName, liveState,
  liveShellHTML, liveRefresh, liveTaskAction, liveConnect, liveCmd, liveViewHome, liveViewTask, liveViewPlaces, liveViewNotYet, liveViewNoAx, viewHome };`, ctx);
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
const settle = async () => { for (let k = 0; k < 40; k++) await new Promise((r) => setImmediate(r)); };
const main = (p) => p.els['#main'].innerHTML;

(async () => {
  // ---------- Without the bridge (a browser): demo data, untouched ----------
  const demo = makeContext(null);
  await check('in a browser there is no bridge, so the app stays on demo data', () => {
    if (demo.api.liveOn() || demo.api.LIVE.on) throw new Error('live mode must be off without window.studio');
    if (demo.api.state.tasks.length < 5) throw new Error('the demo tasks should still be there');
    const v = demo.api.viewHome();
    if (!v.html.includes('Add rate limiting to the checkout API')) throw new Error('demo Home should render');
    return v;
  });

  // ---------- Reading what the CLI prints ----------
  const p = makeContext(bridge);
  const { api } = p;
  const L = api.LIVE;
  await check('reads ax get tasks: name, atespace, state, age', () => {
    const t = api.liveParseTasks(tasksTable([{ name: 'a-task', state: 'RequiresAction', age: '5s' }, { name: 'b', state: 'Working', age: '2d' }]));
    if (t.length !== 2 || t[0].name !== 'a-task' || t[0].state !== 'RequiresAction' || t[0].atespace !== 'default' || t[0].age !== '5s' || t[1].state !== 'Working') throw new Error(JSON.stringify(t));
    if (api.liveParseTasks('').length || api.liveParseTasks('NAME   ATESPACE   STATE   ACTOR   AGE\n').length) throw new Error('an empty list has no rows');
  });
  await check('reads ax ctx: an empty CURRENT cell and a tunnel with spaces don\'t shift the columns', () => {
    const c = api.liveParseContexts(CTX);
    if (c.length !== 3) throw new Error('expected 3 contexts: ' + JSON.stringify(c));
    if (!c[0].current || c[0].name !== 'ax-local' || c[0].cluster !== 'kind-ax-local' || c[0].tunnel !== 'Healthy') throw new Error(JSON.stringify(c[0]));
    if (c[1].current || c[1].name !== 'gke-team-dev' || c[1].cluster !== 'gke_acme_us-central1_team-dev' || c[1].tunnel !== '') throw new Error(JSON.stringify(c[1]));
    if (c[2].tunnel !== 'Stale') throw new Error(JSON.stringify(c[2]));
    const one = api.liveParseContexts('Active Kubernetes Context: minikube\n');
    if (one.length !== 1 || one[0].name !== 'minikube' || !one[0].current) throw new Error('the one-line form: ' + JSON.stringify(one));
  });
  await check('reads ax local status, and says nothing when it prints something else', () => {
    const l = api.liveParseLocal(LOCAL);
    if (l.state !== 'Running' || l.context !== 'ax-local' || l.cluster !== 'ax-local (kind)' || !/1\/1 available/.test(l.substrate) || !/ax-system/.test(l.server)) throw new Error(JSON.stringify(l));
    if (api.liveParseLocal('kind: command not found') !== null) throw new Error('unreadable output should be null');
  });
  await check('AX\'s states read in the UI\'s words, and an unknown state shows as it is', () => {
    const want = { Working: 'Running', Queued: 'Starting', Suspending: 'Pausing', Suspended: 'Paused', Failed: 'Failed', RequiresAction: 'Waiting for you', Completed: 'Done', Cancelled: 'Stopped' };
    for (const k of Object.keys(want)) if (api.liveState(k).label !== want[k]) throw new Error(`${k} should read ${want[k]}, got ${api.liveState(k).label}`);
    if (api.liveState('Hibernating').label !== 'Hibernating') throw new Error('an unknown state keeps its name');
    if (api.liveStateName('TASK_STATE_REQUIRES_ACTION') !== 'RequiresAction' || api.liveStateName('TASK_STATE_WORKING') !== 'Working') throw new Error('task file state names');
  });

  // ---------- Connected ----------
  await settle();
  await check('connects: finds ax, picks the current cluster, lists its tasks, and drops the demo tasks', () => {
    if (!api.liveOn() || L.phase !== 'ready') throw new Error('phase: ' + L.phase);
    if (L.axVersion !== 'v1alpha1' || L.context !== 'ax-local' || L.contexts.length !== 3) throw new Error(JSON.stringify([L.axVersion, L.context, L.contexts.length]));
    if (L.tasks.map((t) => t.name).join() !== 'readme-polish,fix-flaky-tests,upgrade-node-22') throw new Error(JSON.stringify(L.tasks));
    if (api.state.tasks.length) throw new Error('demo tasks should be gone in the app');
  });
  await check('every task command names the cluster and the atespace; Studio never switches the kubeconfig', () => {
    if (!ax.calls.includes('--context ax-local -a default get tasks')) throw new Error('get tasks should name the cluster: ' + ax.calls.join(' | '));
    if (ax.calls.some((c) => /^ctx \S/.test(c) || /config use-context/.test(c))) throw new Error('Studio must not change the kubeconfig');
  });
  await check('Home lists the real tasks: what needs you first, each with its state in plain words', () => {
    const v = api.liveViewHome();
    const order = (v.html.match(/id="live-row-[a-z0-9-]+"/g) || []).join();
    if (order !== 'id="live-row-upgrade-node-22",id="live-row-fix-flaky-tests",id="live-row-readme-polish"') throw new Error('order: ' + order);
    for (const k of ['Your tasks', '3 tasks: 1 needs you, 1 running, 1 paused.', '</svg>Failed</span>', '</svg>Running</span>', '</svg>Paused</span>', 'Created 12m ago', 'ax --context ax-local get tasks']) if (!v.html.includes(k)) throw new Error('missing ' + k);
    if (/Good (morning|afternoon|evening)|What should an agent work on next|This week/.test(v.html)) throw new Error('demo-only parts of Home must stay hidden');
    return v;
  });
  await check('the app frame has only what is real: no New task, Guardrails, Settings, bell or command palette', () => {
    const sh = api.liveShellHTML();
    if (!/class="app live"/.test(sh) || !/href="#\/places"/.test(sh) || !/id="theme-toggle"/.test(sh)) throw new Error('live frame');
    if (/#\/new|#\/guardrails|#\/settings|id="bell"|data-action="palette"|data-action="shortcuts"/.test(sh)) throw new Error('demo-only controls must stay hidden');
    return { html: sh };
  });

  // ---------- A task ----------
  p.ctx.location.hash = '#/task/fix-flaky-tests';
  api.render();
  await settle();
  await check('a task page shows what ax get task says: goal, state, image, workspace, network, terminal, and the task file', () => {
    const h = main(p);
    for (const k of ['fix-flaky-tests', 'Fix the flaky tests.', 'Running <span class="muted">(AX: Working)</span>', 'gcr.io/p/claude-code@sha256:abc', 'itsdangerous', 'Gateway <span class="mono">review-bot-gw</span>', '2 CPU · 4Gi memory', 'ax --context ax-local ssh fix-flaky-tests', 'team=platform', 'apiVersion: ax.io/v1alpha1', 'data-action="live-suspend"', 'data-action="live-delete"']) if (!h.includes(k)) throw new Error('missing ' + k);
    if (h.includes('data-action="live-resume"')) throw new Error('a running task offers Pause, not Resume');
    if (!/Activity, Changes and the log aren't connected to AX yet/.test(h)) throw new Error('say what is not shown');
    return { html: h };
  });
  await check('pause runs ax suspend task on that cluster, and the page follows the new state', async () => {
    api.ACTIONS['live-suspend']({ dataset: { task: 'fix-flaky-tests' } });
    await settle();
    if (!ax.calls.includes('--context ax-local -a default suspend task fix-flaky-tests')) throw new Error(ax.calls.slice(-4).join(' | '));
    if (L.tasks.find((t) => t.name === 'fix-flaky-tests').state !== 'Suspended') throw new Error('state should be Suspended');
    const h = main(p);
    if (!h.includes('</svg>Paused</span>') || !h.includes('data-action="live-resume"') || h.includes('data-action="live-suspend"')) throw new Error('a paused task offers Resume');
    if (!/Paused <span class="mono">fix-flaky-tests<\/span>/.test(p.els['#toasts'].innerHTML)) throw new Error('say it was paused');
  });
  await check('resume runs ax resume task', async () => {
    api.ACTIONS['live-resume']({ dataset: { task: 'fix-flaky-tests' } });
    await settle();
    if (!ax.calls.includes('--context ax-local -a default resume task fix-flaky-tests') || L.tasks.find((t) => t.name === 'fix-flaky-tests').state !== 'Working') throw new Error('resume');
  });
  await check('when ax refuses, Studio says what ax said and changes nothing', async () => {
    await api.liveTaskAction('upgrade-node-22', 'resume');
    await settle();
    if (!/Couldn't resume <span class="mono">upgrade-node-22<\/span>: resuming task: rpc error: code = ResourceExhausted desc = no free workers available/.test(p.els['#toasts'].innerHTML)) throw new Error('the toast should carry the CLI\'s last line: ' + p.els['#toasts'].innerHTML.slice(-300));
    if (L.tasks.find((t) => t.name === 'upgrade-node-22').state !== 'Failed') throw new Error('state unchanged');
  });
  await check('a failed task says why, and offers only Delete', async () => {
    p.ctx.location.hash = '#/task/upgrade-node-22';
    api.render();
    await settle();
    const h = main(p);
    if (!h.includes('sandbox exited: out of memory (limit 512Mi)') || !h.includes('</svg>Failed</span>')) throw new Error('failure detail');
    if (h.includes('data-action="live-suspend"') || h.includes('data-action="live-resume"')) throw new Error('a failed task can only be deleted');
    return { html: h };
  });
  await check('a task with no gateway and no debug says so', async () => {
    p.ctx.location.hash = '#/task/readme-polish';
    api.render();
    await settle();
    const h = main(p);
    if (!h.includes('No gateway, so no network access') || !/Off: this task was created without/.test(h)) throw new Error('network and terminal facts');
  });
  await check('delete asks first, with the exact command, then runs ax delete task', async () => {
    api.ACTIONS['live-delete']({ dataset: { task: 'readme-polish' } });
    const d = p.els['#overlay'].innerHTML;
    for (const k of ['Delete readme-polish?', "It can't be undone", 'ax --context ax-local delete task readme-polish', 'id="ld-go"', 'data-action="close-dialog"']) if (!d.includes(k)) throw new Error('dialog missing ' + k);
    if (ax.calls.some((c) => /delete task/.test(c))) throw new Error('nothing is deleted before you confirm');
    await api.liveTaskAction('readme-polish', 'delete');
    await settle();
    if (!ax.calls.includes('--context ax-local -a default delete task readme-polish') || L.tasks.some((t) => t.name === 'readme-polish')) throw new Error('delete');
    if (p.ctx.location.hash !== '#/') throw new Error('after deleting the open task, go back to the list');
  });

  // ---------- Where agents run ----------
  await check('Where agents run shows AX on this computer and the clusters in the kubeconfig', async () => {
    p.ctx.location.hash = '#/places';
    api.render();
    await settle();
    const h = main(p);
    for (const k of ['On this computer', '<span class="hd"></span>Running', 'ax-local (kind)', 'ate-api-server (1/1 available)', 'gke-team-dev', 'gke_acme_us-central1_team-dev', 'In use', 'data-action="live-use-context" data-context="gke-team-dev"', 'Connection needs a refresh', 'never changes it']) if (!h.includes(k)) throw new Error('missing ' + k);
    if (/data-context="ax-local"/.test(h)) throw new Error('the cluster in use has no Use button');
    if (/127\.0\.0\.1|-&gt;|->/.test(h)) throw new Error('the tunnel reads in plain words, not as a port mapping');
    return { html: h };
  });
  await check('picking a cluster is Studio\'s own choice: it is remembered, and the kubeconfig is left alone', async () => {
    api.ACTIONS['live-use-context']({ dataset: { context: 'gke-team-dev' } });
    await settle();
    if (L.context !== 'gke-team-dev' || p.store['ax.live.context'] !== 'gke-team-dev') throw new Error('context');
    if (L.tasks.map((t) => t.name).join() !== 'nightly-triage') throw new Error(JSON.stringify(L.tasks));
    if (!ax.calls.includes('--context gke-team-dev -a default get tasks')) throw new Error('get tasks on the new cluster');
    if (ax.calls.some((c) => /^ctx \S/.test(c))) throw new Error('Studio must not run ax ctx <name>');
  });
  await check('a cluster AX can\'t reach: Studio says so with ax\'s own words and the command, and claims no task count', async () => {
    api.ACTIONS['live-use-context']({ dataset: { context: 'gke-broken' } });
    await settle();
    const v = api.liveViewHome();
    for (const k of ["Can't reach AX on gke-broken", 'listing tasks: rpc error: code = Unavailable desc = connection refused', 'ax --context gke-broken get tasks', 'data-action="live-refresh"', "Studio can't reach AX right now."]) if (!v.html.includes(k)) throw new Error('missing ' + k);
    if (/0 tasks/.test(v.html)) throw new Error("don't say 0 tasks when the list couldn't be read");
    return v;
  });

  // ---------- Hidden pages ----------
  await check('pages with no real source say so instead of showing demo data', () => {
    for (const [part, what] of [['new', 'New task'], ['guardrails', 'Guardrails'], ['settings', 'Settings'], ['welcome', 'Setup']]) {
      const v = api.liveViewNotYet(part);
      if (!v.html.includes(`${what} isn't connected to AX yet`) || !/href="#\/"/.test(v.html)) throw new Error(part);
    }
    p.ctx.location.hash = '#/new';
    api.render();
    if (!main(p).includes("New task isn't connected to AX yet")) throw new Error('#/new should not open the demo New task page');
  });

  // ---------- No ax on this computer ----------
  ax.installed = false;
  const q = makeContext(bridge);
  await settle();
  await check('without ax, Studio says how to install it and offers to check again', () => {
    if (q.api.LIVE.phase !== 'no-ax') throw new Error('phase: ' + q.api.LIVE.phase);
    const h = main(q);
    for (const k of ["AX isn't installed on this computer yet", 'curl -fsSL https://github.com/google/ax/releases/latest/download/install.sh | sh', 'ax local start', 'data-action="live-recheck"', 'spawn ax ENOENT']) if (!h.includes(k)) throw new Error('missing ' + k);
    return { html: h };
  });
  await check('Check again connects once ax is there', async () => {
    ax.installed = true;
    q.api.ACTIONS['live-recheck']();
    await settle();
    if (q.api.LIVE.phase !== 'ready' || !q.api.LIVE.tasks.length) throw new Error('phase: ' + q.api.LIVE.phase);
  });

  console.log(fails ? `\n${fails} FAILED of ${n}` : `\nALL OK (${n} checks)`);
  process.exit(fails ? 1 : 0);
})();
