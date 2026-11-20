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

// Smoke test · live mode (api.js, live.js, live-env.js, live-new.js).
//
// Loads AX Studio in a stubbed DOM with a stand-in for the Studio server: fetch answers the way ax-studio's /api
// does, and a stand-in EventSource delivers the events it pushes. Checks that the pages show what the server
// returned, that every request names the local cluster instead of changing the kubeconfig, that what Studio sends to
// AX (task files) is what AX reads, and that pages with no real source stay hidden.
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
/* ax, kubectl and kind as the server finds them: kind here is too old, so ax will download its own. */
const TOOLS = () => [
  { name: 'ax', version: 'v0.1.0', status: 'ok', detail: '~/.ax/bin/ax' },
  { name: 'kubectl', version: 'v1.36.0', status: 'ok', detail: '/opt/homebrew/bin/kubectl' },
  { name: 'kind', version: 'v0.31.0', status: 'warn', detail: 'The kind at /opt/homebrew/bin/kind is older than v0.32.0. ax downloads a newer one into ~/.ax/bin when you set up AX on this computer.' },
];
/* The images setup uses unless you choose others: Studio's own, pinned to the AX in its go.mod. */
const SETUP_IMAGES = () => ({ serverImage: 'ghcr.io/acme/ax/ax-server:v1@sha256:' + 'b438'.repeat(16), serverImageFrom: 'studio', taskImage: 'ghcr.io/acme/ax/ax-task-runner:v1@sha256:' + '0ec6'.repeat(16), taskImageFrom: 'studio', taskImageAllowed: true });
const envRunning = () => ({
  os: 'darwin', arch: 'arm64', canStartLocal: true, preflight: CHECKS_OK.map((c) => Object.assign({}, c)),
  local: { name: 'ax-local', state: 'Running', kubeContext: 'ax-local', substrateStatus: 'ate-api-server (1/1 available)', axStatus: 'ax-server (1/1 available in ax-system)', access: 'ok' },
  contexts: CONTEXTS.map((c) => Object.assign({}, c)), currentContext: 'ax-local', tools: TOOLS(), axFlags: { runnerVolumeImage: false, defaultTaskImage: true }, setupImages: SETUP_IMAGES(),
});
const envFresh = () => ({
  os: 'darwin', arch: 'arm64', canStartLocal: true, preflight: CHECKS_OK.map((c) => Object.assign({}, c)),
  local: { name: 'ax-local', state: 'NotFound', kubeContext: 'N/A', substrateStatus: '', axStatus: '' }, contexts: [], currentContext: '', tools: TOOLS(), axFlags: { runnerVolumeImage: false, defaultTaskImage: true }, setupImages: SETUP_IMAGES(),
});
const DIGEST = 'sha256:' + 'f00d'.repeat(16);
/* What a read-only check of a cluster finds: gke-team-dev runs Agent Substrate (AX once it's installed there), and
   gke-broken doesn't answer. */
const clusterCheck = (B, ctx) => (ctx === 'gke-broken' ? null : {
  context: ctx, kubernetes: 'v1.36.1', checked: 1,
  requirements: [
    { id: 'version', label: 'Kubernetes version', status: 'ok', detail: 'v1.36.1' },
    { id: 'nodes', label: 'Nodes', status: 'ok', detail: '3/3 Ready · kernel 6.8.0-1015-gke · amd64' },
    { id: 'apis', label: 'Certificate APIs', status: 'ok', detail: 'ClusterTrustBundle and PodCertificateRequest are served' },
    { id: 'storage', label: 'Default StorageClass', status: 'ok', detail: 'standard-rwo' },
  ],
  substrate: { ready: 1, total: 1 }, router: { ready: 2, total: 2 }, workerPools: { ready: 1, total: 1 },
  ax: B.installed[ctx] ? { ready: 1, total: 1 } : null, axImage: B.installed[ctx] ? 'ghcr.io/acme/ax-server@' + DIGEST : '',
});
const PATCH_SIGNER = 'diff --git a/src/signer.py b/src/signer.py\nindex 1111111..2222222 100644\n--- a/src/signer.py\n+++ b/src/signer.py\n@@ -3,3 +3,4 @@ class Signer:\n     def now(self):\n-        return time.time()\n+        clock = self.clock\n+        return clock()\n \n';
const PATCH_NOTE = 'diff --git a/notes/why.md b/notes/why.md\nnew file mode 100644\n--- /dev/null\n+++ b/notes/why.md\n@@ -0,0 +1,2 @@\n+# Why it was flaky\n+The clock was read twice.\n\\ No newline at end of file\n';

function makeBackend(opts) {
  const B = Object.assign({
    calls: [], posts: [], ax: [], applied: [], secrets: [], es: null, token: 1, offline: false, noAx: false, goalField: 'text', installed: {}, running: null,
    env: envRunning(),
    tasks: {
      'ax-local': [
        taskDoc('readme-polish', 'SUSPENDED', { goal: 'Tighten the README.', spec: { workspace: { name: 'itsdangerous' }, sessionId: 's-readme' }, status: { conditions: [{ type: 'Ready', status: 'False', reason: 'Suspended', message: 'Actor is suspended' }] } }),
        taskDoc('fix-flaky-tests', 'WORKING', {
          goal: 'Fix the flaky tests.\nExplain the cause.', labels: { team: 'platform' },
          spec: { profile: { image: 'gcr.io/p/claude-code@sha256:abc', resources: { limits: { cpu: '2', memory: '4Gi' } } }, workspace: { name: 'itsdangerous' }, gateway: { name: 'review-bot-gw' }, debug: true, sessionId: 's-fix' },
          status: { conditions: [{ type: 'Ready', status: 'True', reason: 'TaskRunning', message: 'Task is running and its workspace is ready' }] },
        }),
        /* An older AX calls the goal field "spec". */
        taskDoc('upgrade-node-22', 'FAILED', { goal: 'Upgrade to Node 22.', goalField: 'spec', spec: { sessionId: 's-up' }, status: { statusDetail: { reason: 'TASK_STATUS_REASON_SANDBOX_CRASHED', detail: 'sandbox exited: out of memory (limit 512Mi)' } } }),
        taskDoc('changelog-draft', 'COMPLETED', { goal: 'Draft the changelog.', spec: { sessionId: 's-log', workspace: { name: 'ws-changelog-draft' }, gateway: { name: 'gw-changelog-draft' } }, status: { outcome: { result: 'TASK_RESULT_SUCCEEDED', output: 'Wrote CHANGES.rst for 2.3.\nPushed branch ax/changelog-draft.' } } }),
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
    logsError: '',
    /* What the cluster keeps besides tasks: workspaces (one failed its setup, and no task uses it) and Gateways. */
    workspaces: [
      { kind: 'Workspace', metadata: { name: 'itsdangerous', atespace: 'default' }, status: { phase: 'Ready' } },
      { kind: 'Workspace', metadata: { name: 'ws-changelog-draft', atespace: 'default' }, status: { phase: 'Ready' } },
      { kind: 'Workspace', metadata: { name: 'ws-old-task', atespace: 'default' }, status: { phase: 'Failed', lastSetupError: 'git clone https://github.com/acme/gone: repository not found' } },
    ],
    gatewayList: [
      { kind: 'Gateway', metadata: { name: 'review-bot-gw', atespace: 'default' }, spec: { egress: [{ https: { hostnames: ['api.anthropic.com', 'github.com'] } }] } },
      { kind: 'Gateway', metadata: { name: 'gw-changelog-draft', atespace: 'default' }, spec: { egress: [{ https: { hostnames: ['github.com'] } }] } },
      { kind: 'Gateway', metadata: { name: 'gw-print-the-date', atespace: 'default' }, spec: { egress: [] } },
    ],
    /* What the worker logged for each task: the sandbox starting, gVisor, AX's runner, and the agent. fix-flaky-tests'
       agent is at work; signer-b2c3's agent exited with an error while AX still calls the task running. */
    logs: {
      'fix-flaky-tests': [
        { t: '2026-11-17T05:33:41.594Z', src: 'event', text: 'Actor starting' },
        { t: '2026-11-17T05:33:41.706Z', src: 'sandbox', text: 'I1117 05:33:41.706683     134 cli.go:282] **************** gVisor ****************' },
        { t: '2026-11-17T05:33:41.939Z', src: 'event', text: 'Actor started' },
        { t: '2026-11-17T05:33:41.944Z', src: 'runner', text: 'time=2026-11-17T05:33:41.943Z level=INFO msg="started task command" pid=9 command=[/usr/local/bin/ax-agent]' },
        { t: '2026-11-17T05:33:42.258Z', src: 'agent', text: 'Reading tests/test_signer.py' },
        { t: '2026-11-17T05:33:44.100Z', src: 'agent', text: 'WARN the clock is read twice in Signer.now' },
      ],
      'signer-b2c3': [
        { t: '2026-11-17T10:05:01.000Z', src: 'event', text: 'Actor started' },
        { t: '2026-11-17T10:05:01.100Z', src: 'runner', text: 'time=2026-11-17T10:05:01.100Z level=INFO msg="started task command" pid=9 command=[/usr/local/bin/ax-agent]' },
        { t: '2026-11-17T10:05:02.258Z', src: 'agent', text: '2026/11/17 10:05:02 ERROR agent failed err="turn 1: error sending request: Post \\"https://generativelanguage.googleapis.com/v1beta/interactions\\": tls: failed to verify certificate: x509: certificate signed by unknown authority"' },
        { t: '2026-11-17T10:05:02.263Z', src: 'runner', text: 'time=2026-11-17T10:05:02.263Z level=ERROR msg="task command exited with error" pid=9 exitCode=1 error="exit status 1"' },
      ],
    },
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
    if (u.pathname === '/api/bootstrap') return answer(200, { csrfToken: 'tok-' + B.token, os: 'darwin', home: '/Users/me', pathSeparator: ':', axNamespace: 'ax-system', version: 'v1alpha1', studioVersion: 'v0.2.0', axBinary: '/Users/me/.ax/bin/ax', kubeconfig: '/Users/me/.kube/config', user: B.user || { name: 'Ada Lovelace', source: 'account' } });
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
      case '/api/gateways/get':
        if (name !== 'review-bot-gw') return answer(404, { error: `gateway default/${name} not found`, code: 'NotFound' });
        return answer(200, { gateway: { kind: 'Gateway', metadata: { name }, spec: { egress: [
          { https: { hostnames: ['api.anthropic.com'], effects: { replaceHeaders: [{ header: 'x-api-key', credentialUri: 'ate-secret://k8s.io/default/ax-system/anthropic-api-creds/ANTHROPIC_API_KEY' }] } } },
          { https: { hostnames: ['github.com', 'api.github.com', '*.githubusercontent.com', 'pypi.org', 'files.pythonhosted.org', 'registry.npmjs.org'] } }] } } });
      case '/api/tasks/suspend': case '/api/tasks/resume': case '/api/tasks/delete': {
        const t = find(ctx, name);
        if (!t) return answer(404, { error: `task default/${name} not found`, code: 'NotFound' });
        if (u.pathname.endsWith('/resume') && name === 'upgrade-node-22') return answer(502, { error: 'no free workers available', code: 'ResourceExhausted' });
        if (u.pathname.endsWith('/delete')) list(ctx).splice(list(ctx).indexOf(t), 1);
        else t.status.state = u.pathname.endsWith('/suspend') ? 'TASK_STATE_SUSPENDED' : 'TASK_STATE_WORKING';
        return answer(200, { ok: true });
      }
      case '/api/workspaces': return answer(200, { workspaces: B.workspaces });
      case '/api/models': return B.models ? answer(200, { models: B.models }) : answer(501, { error: 'unknown method ListModels', code: 'Unimplemented' });
      case '/api/gateways': return answer(200, { gateways: B.gatewayList });
      case '/api/workspaces/delete': case '/api/gateways/delete': {
        const arr = u.pathname.startsWith('/api/workspaces') ? B.workspaces : B.gatewayList;
        const i = arr.findIndex((d) => d.metadata.name === body.name);
        if (i < 0) return answer(404, { error: `${body.name} not found`, code: 'NotFound' });
        arr.splice(i, 1);
        return answer(200, { ok: true });
      }
      case '/api/tasks/logs': {
        if (B.logsError) return answer(502, { error: B.logsError });
        const all = (B.logs[name] || []).filter((x) => !q.since || x.t.slice(0, 19) >= q.since.slice(0, 19));
        return answer(200, { lines: all, namespaces: ['ate-workers'], command: `kubectl --context ${ctx} -n ate-workers logs -l ate.dev/worker-pool --all-containers --prefix=false --since=24h` });
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
        B.running = { id: 'op-' + B.posts.length, action, target: 'ax-local', status: 'running', stage: action === 'local-up' ? 'kind' : '', started: 1, purpose: body.purpose || '' };
        return answer(200, B.running);
      }
      case '/api/env/install':
        B.installed[body.context] = true;
        B.running = { id: 'op-' + B.posts.length, action: 'remote-install', target: body.context, status: 'running', stage: 'ax', started: 1 };
        return answer(202, B.running);
      case '/api/env/uninstall':
        delete B.installed[body.context];
        B.running = { id: 'op-' + B.posts.length, action: 'remote-uninstall', target: body.context, status: 'running', started: 1 };
        return answer(202, B.running);
      case '/api/env/cancel':
        if (!B.running) return answer(409, { error: 'nothing is running' });
        return answer(200, { ok: true, id: B.running.id });
      case '/api/env/check': {
        const c = clusterCheck(B, q.context);
        /* The server answers 200 either way; a cluster it couldn't reach comes back with only its error. */
        return answer(200, c || { context: q.context, error: 'Unable to connect to the server: dial tcp 34.118.12.7:443: i/o timeout', requirements: null, substrate: null, router: null, workerPools: { ready: 0, total: 0 }, ax: null, checked: 1 });
      }
      case '/api/env/diagnostics':
        return answer(200, { diagnostics: `=== AX Studio Diagnostics (Secrets Redacted) ===\nActive Context: ${q.context}\n--- Preflight Checks ---\n[OK] Available disk space: 212 GiB free\ntoken: [REDACTED]\n` });
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
    FileReader: function FileReader() { this.readAsText = (f) => { this.result = f.text; if (this.onload) this.onload(); }; },
    Notification: Object.assign(function Notification(title, o) { (B ? (B.notes = B.notes || []) : []).push({ title, body: o && o.body, tag: o && o.tag }); this.close = () => {}; }, { permission: 'default', requestPermission: async () => 'granted' }),
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
  const files = ['core.js', 'mascot.js', 'viz.js', 'failures.js', 'views.js', 'task.js', 'overlays.js', 'api.js', 'live.js', 'live-env.js', 'live-new.js', 'live-logs.js', 'live-resources.js', 'live-nav.js', 'live-settings.js', 'app.js'];
  vm.runInContext(files.map((f) => fs.readFileSync(dir + '/' + f, 'utf8')).join('\n;\n') + `
;globalThis.__api = { state, render, ACTIONS, STUDIO, LIVE, liveOn, liveState, liveStateName, liveTask, liveAge, liveShellHTML, liveRefresh, liveTaskAction, liveConnect,
  liveCmd, liveViewHome, liveSampleTask, liveViewTask, liveViewPlaces, liveViewSetup, liveViewNotYet, liveViewNew, liveNewYAML, liveNewIssues, liveNewRun, liveDraftName,
  liveTermOpen, liveTermSend, liveTermClose, liveTermInnerHTML, livePaletteItems, liveGoalHelpHTML, liveNewGateMapHTML,
  liveViewSettings, liveShortcutRows, liveOpenDiagnostics, liveLayersHTML, liveOutputInnerHTML, liveLoadLogs, liveLogsError, liveLogLine, liveLogsTick, liveSplitArgs, liveNewLoadFile, liveLinkHere,
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
    const want = { Working: 'Running', Queued: 'Starting', Suspending: 'Suspending', Suspended: 'Suspended', Failed: 'Failed', RequiresAction: 'Waiting for you', Completed: 'Done', Cancelled: 'Stopped' };
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
  await check('Tasks (#/) is the overview: every task in one table, what needs you first, with Suspend or Resume, a shell, Logs and Delete on each row', () => {
    const v = api.liveViewHome();
    const order = (v.html.match(/id="live-trow-[a-z0-9-]+"/g) || []).map((x) => x.slice(14, -1)).join();
    if (order !== 'upgrade-node-22,fix-flaky-tests,signer-a1b2,signer-b2c3,readme-polish,changelog-draft') throw new Error('order: ' + order);
    need(v.html, ['<h1 tabindex="-1" id="live-tasks-title" style="margin-right:0">Tasks</h1>', '6 tasks on this computer.', 'On this computer', 'ax --context ax-local get tasks',
      'class="table tasks-table"', '<th>Task</th><th>State</th><th class="tk-img">Image</th><th class="tk-ws">Workspace</th><th class="tk-res">Resources</th><th class="tk-created">Created</th>', '<a href="#/task/upgrade-node-22" class="mono">upgrade-node-22</a>', 'Upgrade to Node 22.',
      '</svg>Failed</span>', '</svg>Running</span>', '</svg>Suspended</span>', '</svg>Done</span>', 'Turn 1 of 2', 'Turn 2 of 2',
      'id="live-tasks-q"', 'data-action="live-tasks-filter" data-v="all" aria-pressed="true"', '>Suspended<span class="seg-n tnum">', 'href="#/new"', 'data-action="live-sample-task"']);
    /* Each row: Suspend for a running task, Resume for a suspended one, a shell when it has debug access, its logs, and Delete. */
    const row = (name) => { const a = v.html.indexOf(`id="live-trow-${name}"`); return v.html.slice(a, v.html.indexOf('</tr>', a)); };
    need(row('fix-flaky-tests'), ['data-action="live-suspend" data-task="fix-flaky-tests"', 'title="ax --context ax-local suspend task fix-flaky-tests"', 'href="#/task/fix-flaky-tests/terminal"', 'href="#/task/fix-flaky-tests/logs"', 'data-action="live-delete" data-task="fix-flaky-tests"']);
    need(row('readme-polish'), ['data-action="live-resume" data-task="readme-polish"', 'Resume</button>', 'href="#/task/readme-polish/logs"']);
    never(row('readme-polish'), ['live-suspend', '/terminal"']);
    /* ax ssh needs the task Working: an idle task, even with debug on, gets no shell link, but can still be suspended. */
    const ff = L.tasks.find((t) => t.name === 'fix-flaky-tests');
    ff.state = 'Idle';
    const idle = api.liveViewHome().html;
    ff.state = 'Working';
    const at = idle.indexOf('id="live-trow-fix-flaky-tests"');
    const idleRow = idle.slice(at, idle.indexOf('</tr>', at));
    never(idleRow, ['/terminal"']);
    need(idleRow, ['data-action="live-suspend" data-task="fix-flaky-tests"', 'href="#/task/fix-flaky-tests/logs"']);
    never(row('upgrade-node-22'), ['live-suspend', 'live-resume']);
    /* No greeting, prompt box, tiles or sections: one table, filtered by state. */
    never(v.html, ['live-home-h1', 'Good morning', 'Good evening', 'id="live-quick-goal"', 'What should an agent work on next?', 'data-action="jump"', 'class="station', 'id="live-sec-', 'Change cluster', 'axel-speech']);
    never(v.html, ['data-action="live-palette"', 'data-action="story"', 'Why an axolotl?']);
    return v;
  });
  await check('Try a sample task applies a Task that prints a line and waits, with debug on, then resumes it and opens it', async () => {
    const before = B.ax.length;
    await api.liveSampleTask();
    await settle();
    const calls = B.ax.slice(before);
    const name = (/^--context ax-local -a default resume task (sample-[0-9a-f]{6})$/.exec(calls[1] || '') || [])[1];
    if (calls[0] !== '--context ax-local -a default apply -f -' || !name) throw new Error(calls.join(' | '));
    const y = B.applied[B.applied.length - 1];
    need(y, ['kind: Task', `  name: "${name}"`, '  commands: ["sh", "-c", "echo Hello from a sandbox on this computer; sleep infinity"]', '  debug: true']);
    /* The cluster's default task image, and nothing it would need to set up or reach. */
    never(y, ['image:', 'goal:', 'workspace:', 'gateway:']);
    if (p.ctx.location.hash !== `#/task/${name}`) throw new Error('opens it: ' + p.ctx.location.hash);
    need(toasts(p), [`Started <span class="mono">${name}</span>`]);
    if (!L.tasks.some((t) => t.name === name && t.state === 'Working')) throw new Error('listed, and running');
    /* Back to the list the next checks expect. */
    B.tasks['ax-local'] = B.tasks['ax-local'].filter((t) => t.metadata.name !== name);
    await api.liveRefresh(true);
    await go(p, '#/');
  });
  await check('the app frame has what is real: New task, Home, Where agents run, Settings, search and shortcuts. No Guardrails or bell', () => {
    const sh = api.liveShellHTML();
    need(sh, ['class="app live"', 'href="#/new" id="live-new"', 'href="#/places"', 'href="#/settings" data-nav="settings"', 'id="theme-toggle"', 'data-action="palette"', 'data-action="shortcuts"']);
    never(sh, ['#/guardrails', 'id="bell"']);
    return { html: sh };
  });

  // ---------- A task ----------
  await go(p, '#/task/fix-flaky-tests');
  await check('a task page shows what AX has: goal, state, image, workspace, network, limits, debug, session, labels and the task file', async () => {
    const h = main(p);
    need(h, ['fix-flaky-tests', 'Fix the flaky tests.\nExplain the cause.', '</svg>Running</span>', 'started the task in its sandbox', 'Task is running and its workspace is ready', 'title="gcr.io/p/claude-code@sha256:abc"', 'itsdangerous',
      'Gateway <span class="mono">review-bot-gw</span>', '2 CPU · 4Gi memory', 's-fix', 'team=platform', 'On: while it runs, Terminal can open a shell in its sandbox',
      'data-action="copy" data-text="fix-flaky-tests" aria-label="Copy the task name"',
      'data-action="live-suspend"', 'data-action="live-delete"', 'These are the steps AX records. What the task printed is in <a href="#/task/fix-flaky-tests/logs">Logs</a>.',
      /* The State card says where to look: the Terminal, or Logs. */
      '<a href="#/task/fix-flaky-tests/terminal">Terminal</a>']);
    /* No follow-ups, no other clusters, and no Changes: AX runs tasks, it doesn't review what they changed. */
    never(h, ['data-action="live-resume"', 'href="#/new?from=fix-flaky-tests"', 'data-action="live-promote"', 'Run on another cluster', 'Send a follow-up', '/changes"', 'gVisor']);
    /* Said once: the state is the header's chip, each check is a step in the timeline, and the name is in the breadcrumb
       and Details (not in the header too). */
    never(h, ['(AX: Working)', 'Ready: True (TaskRunning)', 'title="Task name"', 'so look in']);
    if (!B.calls.includes('GET /api/tasks/get?context=ax-local&atespace=default&name=fix-flaky-tests')) throw new Error('the task is read from that cluster');
    /* What it can reach comes from the task's Gateway: the sites it allows, and the key it adds outside the sandbox. */
    if (!B.calls.includes('GET /api/gateways/get?context=ax-local&atespace=default&name=review-bot-gw')) throw new Error('the Gateway is read');
    need(h, ['What it can reach · Balanced', 'api.anthropic.com', 'github.com', '+3 more allowed', 'Anthropic API key, added outside the sandbox', 'Every other site is blocked', 'A task keeps the rules it started with.']);
    never(h, ['0 raw keys']);
    await go(p, '#/task/fix-flaky-tests/file');
    need(main(p), ['role="tabpanel" class="task-panel" id="panel-file"', 'apiVersion: ax.io/v1alpha1', 'data-action="copy"', 'ax --context ax-local get task fix-flaky-tests']);
    await go(p, '#/task/fix-flaky-tests');
    return { html: h };
  });
  await check('a task page has the prototype frame: tabs for what is real, one panel, and the inspector with the only Pause', async () => {
    const h = main(p);
    need(h, ['role="tablist" aria-label="Task views"', 'id="tab-activity" href="#/task/fix-flaky-tests" aria-selected="true"', 'id="tab-logs" href="#/task/fix-flaky-tests/logs"',
      'id="tab-terminal" href="#/task/fix-flaky-tests/terminal"', 'id="tab-file" href="#/task/fix-flaky-tests/file" aria-selected="false" tabindex="-1">YAML</a>', 'role="tabpanel" class="task-panel" id="panel-activity"',
      '<h1 tabindex="-1" id="task-title">Fix the flaky tests.</h1>', 'Where it runs', 'What it can reach', 'id="next-step"', '>State</h2>', 'Running in its sandbox']);
    never(h, ['id="tab-log"', 'Export trajectory', 'id="tab-changes"', 'Task file</a>']);
    /* Suspend and Resume are in the header, once, with Delete. */
    if ((h.match(/data-action="live-suspend"/g) || []).length !== 1) throw new Error('one Suspend');
    const head = h.slice(h.indexOf('id="task-head"'), h.indexOf('class="task-grid"'));
    need(head, ['data-action="live-suspend"', 'Suspend</button>', 'title="ax --context ax-local suspend task fix-flaky-tests"', 'Delete…']);
    never(head, ['live-promote', 'Send a follow-up']);
    /* Activity: the goal you set, then what AX recorded, then that it runs. */
    need(h, ['<span class="who">You</span><span class="what">set the goal</span>', 'started the task in its sandbox', 'Task is running and its workspace is ready', 'Running ·']);
    /* A task without debug access has no Terminal tab. */
    await go(p, '#/task/readme-polish');
    need(main(p), ['id="tab-activity"', 'id="tab-file"']);
    never(main(p), ['id="tab-changes"', 'id="tab-terminal"']);
    await go(p, '#/task/fix-flaky-tests');
  });
  await check('pause asks the server to suspend that task on that cluster, and the page follows the new state', async () => {
    api.ACTIONS['live-suspend']({ dataset: { task: 'fix-flaky-tests' } });
    await settle();
    const sent = B.posts.find((x) => x.path === '/api/tasks/suspend');
    if (!sent || JSON.stringify(sent.body) !== '{"context":"ax-local","atespace":"default","name":"fix-flaky-tests"}') throw new Error(JSON.stringify(sent));
    if (L.tasks.find((t) => t.name === 'fix-flaky-tests').state !== 'Suspended') throw new Error('state should be Suspended');
    need(main(p), ['</svg>Suspended</span>', 'data-action="live-resume"', 'Resume</button>']);
    never(main(p), ['data-action="live-suspend"']);
    need(toasts(p), ['Suspended <span class="mono">fix-flaky-tests</span>']);
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
  await check('a failed task says why, and offers no suspend, resume or follow-up', async () => {
    await go(p, '#/task/upgrade-node-22');
    const h = main(p);
    need(h, ['Upgrade to Node 22.', 'sandbox exited: out of memory (limit 512Mi)', '</svg>Failed</span>', 'data-action="live-delete"', 'Stopped with an error',
      'Give it more memory when you start it again.']);
    never(h, ['data-action="live-suspend"', 'data-action="live-resume"', 'live-try-again', 'again=1']);
    /* AX's default image is named in the header, so Where it runs doesn't name it again. */
    never(h.slice(h.indexOf('id="live-where-card"')), ['<dt>Image</dt>']);
    /* The browser tab says how many tasks need you. */
    if (!/^\(1\) /.test(p.ctx.document.title)) throw new Error('tab title: ' + p.ctx.document.title);
    return { html: h };
  });
  await check('a finished task shows its result, exit code and output', async () => {
    await go(p, '#/task/changelog-draft');
    const h = main(p);
    need(h, ['id="live-result"', '<dt>Result</dt><dd>Succeeded</dd>', '<dt>Exit code</dt><dd><span class="mono">0</span></dd>', 'Wrote CHANGES.rst for 2.3.\nPushed branch ax/changelog-draft.']);
    return { html: h };
  });
  await check('a task with no gateway and no debug access says so', async () => {
    await go(p, '#/task/readme-polish');
    const h = main(p);
    need(h, ["It has no Gateway, so it can't reach the network.", 'What it can reach · Nothing', 'Off, so there is no shell into the sandbox', 'It was started without debug access, so it has no shell.',
      /* Suspending is a step in its own words, not AX's ("Actor is suspended"). */
      'suspended the task']);
    /* The timeline says it in its own words; AX's raw conditions are only in the table under Details. */
    never(h.slice(h.indexOf('id="live-timeline"'), h.indexOf('class="live-details"')), ['Actor is suspended', "says it isn't ready"]);
    need(h, ["AX's conditions, as recorded (1)", '<td class="mono">Suspended</td><td>Actor is suspended</td>']);
    if (B.calls.some((c) => /\/api\/tasks\/changes/.test(c))) throw new Error('Studio never asks for what a task changed');
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
    need(main(p), ["long-gone isn't on this cluster", "it's in another atespace", 'href="#/"']);
    never(main(p), ['Change cluster']);
  });

  // ---------- Logs, for every task ----------
  await check('the task page reads the logs: a Logs tab for every task, quiet while the agent works', async () => {
    await go(p, '#/task/fix-flaky-tests');
    await settle();
    api.render();
    if (!B.calls.includes('GET /api/tasks/logs?context=ax-local&atespace=default&name=fix-flaky-tests')) throw new Error('logs are read for that task');
    need(main(p), ['id="tab-logs" href="#/task/fix-flaky-tests/logs"', 'id="dot-logs" hidden', 'Running in its sandbox', 'Running ·']);
    never(main(p), ['It logged an error', 'stopped with an error']);
  });
  await check("when the agent's command exits with an error while AX still says running, Activity and the Next card say so", async () => {
    await go(p, '#/task/signer-b2c3');
    await settle();
    api.render();
    const h = main(p);
    need(h, ['id="dot-logs" >', ', has an error', 'class="ns-dot"', 'Its command stopped with an error', 'Its command exited at', 'though AX still shows the task as running',
      /* The runner only says the command exited; the agent's own line says why, and its end (the cause) is what shows. */
      'Its error: <span class="mono">…tls: failed to verify certificate: x509: certificate signed by unknown authority</span>', '<a href="#/task/signer-b2c3/logs">Logs</a>',
      'stopped with an error (exit code 1)', 'See what it printed in Logs', 'data-action="live-suspend"']);
    never(h, ['err=&quot;turn 1', '<div class="working"', 'live-try-again']);
  });
  await check('Logs shows what the sandbox printed: the agent plainly, AX and the worker quieter, errors marked, sandbox start-up off', async () => {
    await go(p, '#/task/signer-b2c3/logs');
    let h = main(p);
    need(h, ['role="tabpanel" class="task-panel" id="panel-logs"', 'What the task and its sandbox print, as it happens.', 'Live</span>', '4 lines', 'From the Agent Substrate worker',
      'Sandbox started', '<span class="ll ll-runner"><span class="ll-t">', 'started task command pid=9',
      '<span class="ll ll-agent ll-err">', 'ERROR agent failed err=', 'class="ll ll-runner ll-err"', 'task command exited with error',
      'kubectl --context ax-local -n ate-workers logs -l ate.dev/worker-pool']);
    never(h, ['time=2026-11-17T10:05:01.100Z', '2026/11/17 10:05:02 ERROR']);
    await go(p, '#/task/fix-flaky-tests/logs');
    h = main(p);
    need(h, ['Sandbox start-up (1)', '<span class="ll ll-agent ll-warn">', 'WARN the clock is read twice']);
    never(h, ['**************** gVisor']);
    p.store['ax.live.logs.sandbox'] = '1';
    await go(p, '#/task/fix-flaky-tests/logs');
    need(main(p), ['**************** gVisor', '6 lines']);
    delete p.store['ax.live.logs.sandbox'];
  });
  await check('while the Logs tab is open on a running task, it reads only what is new, and keeps each line once', async () => {
    await go(p, '#/task/fix-flaky-tests/logs');
    const before = B.calls.length;
    B.logs['fix-flaky-tests'].push({ t: '2026-11-17T05:40:00.100Z', src: 'agent', text: 'Fixed: read the clock once' });
    L.logs['fix-flaky-tests'].at = 0.001;
    api.liveLogsTick();
    await settle();
    const call = B.calls.slice(before).find((c) => c.startsWith('GET /api/tasks/logs'));
    if (!call || !call.includes('since=2026-11-17T05%3A33%3A44.100Z')) throw new Error('asks from the last line: ' + call);
    const lines = L.logs['fix-flaky-tests'].lines;
    if (lines.length !== 7 || lines.filter((x) => x.text.includes('read twice')).length !== 1) throw new Error(JSON.stringify(lines.map((x) => x.text)));
    api.render();
    need(main(p), ['Fixed: read the clock once', '6 lines']);
  });
  await check("a task with nothing logged says so, and logs that can't be read say why", async () => {
    await go(p, '#/task/changelog-draft/logs');
    need(main(p), ['What the task and its sandbox printed.', 'Nothing from this task in the last 24 hours.']);
    never(main(p), ['Live</span>']);
    B.logsError = 'kubectl isn\'t installed, so Studio can\'t read the logs.';
    await api.liveLoadLogs('changelog-draft', true);
    api.render();
    need(main(p), ["Studio couldn't read the logs.", 'kubectl isn&#39;t installed']);
    B.logsError = '';
    await go(p, '#/task/fix-flaky-tests');
  });

  // ---------- Workspaces and Gateways ----------
  await check('Workspaces and Gateways are two sections under the tasks: which tasks use each, and which failed or are unused', async () => {
    await go(p, '#/');
    await settle();
    api.render();
    const h = main(p);
    const sec = (id) => { const a = h.indexOf(`id="${id}"`); return h.slice(a, h.indexOf('</section>', a)); };
    need(sec('live-res-workspaces'), ['id="live-res-workspaces-h">Workspaces</h2>', 'What a task starts from · 3', '1 unused', '1 failed setup', 'data-action="live-res-delete-unused" data-kind="workspace"', 'Delete 1 unused…', 'ax --context ax-local get workspaces']);
    need(sec('live-res-gateways'), ['id="live-res-gateways-h">Gateways</h2>', 'What a task can reach · 3', '1 unused', 'data-action="live-res-delete-unused" data-kind="gateway"', 'ax --context ax-local get gateways']);
    never(h, ['Workspaces and Gateways', 'id="live-fold-res"']);
    need(h, [
      'Used by <a href="#/task/fix-flaky-tests" class="mono">fix-flaky-tests</a>', 'Used by <a href="#/task/changelog-draft" class="mono">changelog-draft</a>',
      'No task uses it', 'Setup failed', 'git clone https://github.com/acme/gone: repository not found', '2 sites',
      'ax --context ax-local get workspaces']);
    if (!/data-name="itsdangerous" disabled/.test(h)) throw new Error('a workspace in use cannot be deleted');
    if (/data-name="ws-old-task" disabled/.test(h)) throw new Error('an unused one can');
  });
  await check('an AX that lists models shows them too, read-only; one that does not just leaves them out', async () => {
    never(main(p), ['id="live-res-models"']);
    B.models = [{ kind: 'Model', metadata: { name: 'gemini-flash', atespace: 'default' }, spec: { provider: 'gemini', model: 'gemini-3.8-flash', secretKey: { name: 'gemini-api-creds', key: 'GEMINI_API_KEY' } } }];
    L.res.at = 1;
    await go(p, '#/');
    await settle();
    api.render();
    need(main(p), ['id="live-res-models-h">Models</h2>', 'What tasks can call by name · 1', 'id="live-res-model-gemini-flash"', 'gemini-3.8-flash', 'key from <span class="mono">gemini-api-creds</span>', 'ax --context ax-local get models']);
    never(main(p), ['data-kind="model"']);
    B.models = null;
    L.res.at = 1;
    await go(p, '#/');
    await settle();
    api.render();
  });
  await check('Delete unused asks first, lists what goes, and deletes each', async () => {
    api.ACTIONS['live-res-delete-unused']({ dataset: {} });
    const d = dialog(p);
    need(p.els['#overlay'].innerHTML, ['Delete 2 unused items?', 'Workspace <span class="mono">ws-old-task</span>', 'Gateway <span class="mono">gw-print-the-date</span>']);
    await fire(d.querySelector('#lru-go'), 'click');
    const posts = B.posts.filter((x) => /\/api\/(workspaces|gateways)\/delete/.test(x.path)).map((x) => `${x.path} ${x.body.name}`);
    if (posts.join(',') !== '/api/workspaces/delete ws-old-task,/api/gateways/delete gw-print-the-date') throw new Error(posts.join(','));
    need(toasts(p), ['Deleted 2 unused items']);
    api.render();
    never(main(p), ['Delete 2 unused', 'ws-old-task', 'gw-print-the-date']);
  });
  await check('deleting a task offers its own workspace and Gateway, ticked, and deletes them after the task', async () => {
    api.ACTIONS['live-delete']({ dataset: { task: 'changelog-draft' } });
    const d = dialog(p);
    need(p.els['#overlay'].innerHTML, ['No other task uses', 'data-ld="workspace/ws-changelog-draft" checked', 'data-ld="gateway/gw-changelog-draft" checked',
      'ax --context ax-local delete workspace ws-changelog-draft', 'Its model, for other tasks to use']);
    /* Untick the Gateway: it stays, and the dialog says so. */
    await fire(d, 'change', { target: { dataset: { ld: 'gateway/gw-changelog-draft' }, checked: false } });
    need(d.querySelector('#ld-kept').innerHTML, ['Its Gateway <span class="mono">gw-changelog-draft</span>, for other tasks to use']);
    never(d.querySelector('#ld-cmds').innerHTML, ['delete gateway']);
    await fire(d.querySelector('#ld-go'), 'click');
    await settle();
    if (!B.posts.some((x) => x.path === '/api/tasks/delete' && x.body.name === 'changelog-draft')) throw new Error('task deleted');
    if (!B.posts.some((x) => x.path === '/api/workspaces/delete' && x.body.name === 'ws-changelog-draft')) throw new Error('its workspace deleted');
    if (B.posts.some((x) => x.path === '/api/gateways/delete' && x.body.name === 'gw-changelog-draft')) throw new Error('its Gateway kept');
    need(toasts(p), ['with its workspace']);
  });
  await check("a task whose workspace failed its setup says so in Activity and on its header", async () => {
    B.workspaces.push({ kind: 'Workspace', metadata: { name: 'ws-broken', atespace: 'default' }, status: { phase: 'Failed', lastSetupError: 'setup step 2 exited 1: pip install: no matching distribution' } });
    B.tasks['ax-local'].push(taskDoc('needs-setup', 'QUEUED', { goal: 'Run the setup.', spec: { sessionId: 's-ns', workspace: { name: 'ws-broken' } } }));
    await api.liveRefresh(true);
    L.res.at = 1;
    await go(p, '#/task/needs-setup');
    await settle();
    api.render();
    need(main(p), ["couldn't set up the workspace", 'setup step 2 exited 1: pip install: no matching distribution', 'ax --context ax-local describe workspace ws-broken', 'env-bad', 'title="Workspace setup failed"']);
  });

  // ---------- New task ----------
  await check('New task runs on AX on this computer: while it is stopped, New task is setup; once it runs, the form', async () => {
    const keep = L.local;
    L.local = Object.assign({}, keep, { state: 'Stopped' }); L.draft = null;
    await go(p, '#/new');
    need(main(p), ['AX on this computer is stopped', 'data-verb="start"']);
    never(main(p), ['id="live-new-run"']);
    L.local = keep;
    await go(p, '#/new');
    if (L.draft.where !== 'ax-local' || !L.draft.debug) throw new Error(JSON.stringify([L.draft.where, L.draft.debug]));
    need(main(p), ['id="live-new-run"', '1 of 3 done · next: add a Git repo, or choose Empty workspace']);
    /* Nothing changed on the cluster side: a background refresh leaves the form alone. */
    p.els['#main'].innerHTML = main(p) + '<!--kept-->';
    api.render({ keepScroll: true, background: true });
    await settle();
    if (!main(p).endsWith('<!--kept-->')) throw new Error('the form was drawn again');
    L.draft = null;
  });
  await go(p, '#/new');
  await check('New task: three steps, with the best defaults (Antigravity, Balanced, debug access on), and it runs on this computer', () => {
    const h = main(p);
    need(h, ['Start a task', 'id="live-agent-antigravity"', 'id="live-agent-claude"', 'id="live-agent-image"', 'Your own image', 'Gemini API key', 'Git repo', 'Debug access', 'id="live-new-run"',
      'Pick a template', 'Set up the workspace', 'Customize workspace', 'Describe the goal', 'More options: network, resources, command, environment, task file',
      'aria-checked="true" data-action="live-new-source" data-source="git"', 'data-action="live-new-branch-pick" data-branch="main"',
      'class="card plan-card"', 'Almost ready', 'On by default.', 'aria-checked="true" data-action="live-new-network" data-network="balanced"', 'aria-checked="true" data-action="live-new-size" data-size="medium"',
      'AX runs the task on this computer, in its own sandbox.']);
    never(h, ['Where should it run?', 'id="live-where-remote"', 'remote cluster', 'gVisor', 'review what it changed']);
    if (!/aria-checked="true"[^>]*id="live-agent-antigravity"/.test(h)) throw new Error('Antigravity is the default');
    if (!/id="live-new-debug"[^>]*checked/.test(h) || !L.draft.debug) throw new Error('debug access is on by default');
    /* Nothing runs before there is code (or an empty workspace) and a goal, and the plan says what's next. */
    if (api.liveNewIssues(L.draft)[0] !== 'Add a Git repo, or choose Empty workspace.') throw new Error(api.liveNewIssues(L.draft).join(' | '));
    need(h, ['1 of 3 done · next: add a Git repo, or choose Empty workspace']);
    api.ACTIONS['live-new-source']({ dataset: { source: 'empty' } });
    if (api.liveNewIssues(L.draft)[0] !== 'Describe the goal.') throw new Error(api.liveNewIssues(L.draft).join(' | '));
    need(main(p), ['starts in an empty <span class="mono">/workspace</span>', 'next: describe the goal']);
    api.ACTIONS['live-new-source']({ dataset: { source: 'git' } });
    return { html: h };
  });
  await check('New task: branch pills fill the branch, and resources set the limits in the Task', () => {
    need(main(p), ['ax --context ax-local apply -f task.yaml']);
    if (api.ACTIONS['live-new-where'] || api.ACTIONS['live-new-cluster']) throw new Error('there is no other cluster to pick');
    /* Branch pills fill the branch; pressing the same one again goes back to the repo's default branch. */
    api.ACTIONS['live-new-branch-pick']({ dataset: { branch: 'develop' } });
    if (L.draft.branch !== 'develop') throw new Error(L.draft.branch);
    api.ACTIONS['live-new-branch-pick']({ dataset: { branch: 'develop' } });
    if (L.draft.branch !== '') throw new Error(L.draft.branch);
    /* Resources set the limits in the Task. */
    api.ACTIONS['live-new-size']({ dataset: { size: 'large' } });
    need(api.liveNewYAML(L.draft, 'text', ''), ['cpu: "4"', 'memory: "8Gi"']);
    api.ACTIONS['live-new-size']({ dataset: { size: 'medium' } });
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
    Object.assign(L.draft, { goal: 'Make the signer tests pass.\nExplain what was wrong.', repo: 'https://gitlab.example.com/me/project.git', branch: 'dev', debug: false, debugTouched: true });
    const y = api.liveNewYAML(L.draft, 'text', '');
    const name = api.liveDraftName(L.draft);
    if (!/^make-the-signer-tests-ab[0-9a-f]{2}$/.test(name)) throw new Error('name: ' + name);
    need(y, ['kind: Gateway', `name: "gw-${name}"`, 'tlsPassthrough:\n        hostnames: ["storage.googleapis.com"]\n        ports:\n          numbers: [443]', 'hostnames: ["generativelanguage.googleapis.com"]', 'header: "x-goog-api-key"', 'credentialUri: "ate-secret://k8s.io/default/ax-system/gemini-api-creds/GEMINI_API_KEY"',
      'hostnames: ["gitlab.example.com", "github.com", "api.github.com"', 'kind: Workspace', `name: "ws-${name}"`, 'repo: "https://gitlab.example.com/me/project.git"', 'dir: "."', 'ref: "dev"',
      'kind: Task', 'image: "ghcr.io/agentexecutor/antigravity@sha256:0ccd91d03f996c375d6d391dc20106102187f15210a0016212b6721cd8044078"', '  goal:\n    text: |\n      Make the signer tests pass.\n      Explain what was wrong.', '- name: "GEMINI_API_KEY"\n      value: "placeholder"', '- name: "AGY_RUNTIME_INSTALL"\n      value: "true"',
      `  workspace:\n    name: "ws-${name}"`, `  gateway:\n    name: "gw-${name}"`]);
    never(y, ['debug:', 'sessionId:', 'sk-', 'config:', 'maxTurns:']);
    if (y.split('\n---\n').length !== 3) throw new Error('three files');
  });
  await check('Locked down reaches only the model and the repo; debug access and your own image show in the Task', () => {
    const d = Object.assign({}, L.draft, { network: 'locked', debug: true });
    const y = api.liveNewYAML(d, 'text', '');
    need(y, ['hostnames: ["storage.googleapis.com"]', 'hostnames: ["gitlab.example.com"]', '\n  debug: true']);
    never(y, ['pypi.org', 'registry.npmjs.org']);
    const own = api.liveNewYAML(Object.assign({}, L.draft, { agent: 'image', image: 'ghcr.io/me/agent@sha256:' + 'a'.repeat(64), repo: '', network: 'locked', nameEdited: true, name: 'my-agent' }), 'text', '');
    need(own, ['kind: Task', 'name: "my-agent"', 'image: "ghcr.io/me/agent@sha256:']);
    never(own, ['kind: Gateway', 'kind: Workspace', 'config:', 'GEMINI_API_KEY', 'AGY_RUNTIME_INSTALL', 'storage.googleapis.com']);
  });
  await check('More options: a custom size, a command, environment variables, and what each makes of the Task', () => {
    const base = Object.assign({}, L.draft, { files: [], mcp: [], repos: '', setup: '' });
    let d = Object.assign({}, base, { size: 'custom', cpu: '3', memory: '6Gi', command: 'sh -c "npm test && npm run lint"', envText: 'CI=true\nLOG_LEVEL=debug' });
    let y = api.liveNewYAML(d, 'text', '');
    need(y, ['cpu: "3"', 'memory: "6Gi"', 'commands: ["sh", "-c", "npm test && npm run lint"]', '- name: "GEMINI_API_KEY"\n      value: "placeholder"', '- name: "CI"\n      value: "true"', '- name: "LOG_LEVEL"\n      value: "debug"']);
    if (api.liveNewIssues(d).length) throw new Error(api.liveNewIssues(d).join(' | '));
    d = Object.assign({}, base, { size: 'custom', cpu: 'lots', memory: '6GB', command: 'echo "unclosed', envText: 'not a variable' });
    const issues = api.liveNewIssues(d).join(' | ');
    need(issues, ['Give the CPU as a number, like 2 or 500m.', 'Give the memory with its unit, like 4Gi or 512Mi.', "The command has a quote that isn't closed.", 'Write each environment variable as NAME=value, one per line.']);
    const split = api.liveSplitArgs;
    if (JSON.stringify(split("python -m pytest -k 'flaky and not slow' tests\\ dir").args) !== JSON.stringify(['python', '-m', 'pytest', '-k', 'flaky and not slow', 'tests dir'])) throw new Error(JSON.stringify(split("python -m pytest -k 'flaky and not slow' tests\\ dir")));
  });
  await check("More options: the workspace's setup (more repos, setup commands, files, MCP servers) goes in its Workspace, and its hosts in the Gateway", () => {
    const d = Object.assign({}, L.draft, { repos: 'https://github.com/acme/shared-lib.git\nhttps://gitlab.example.com/acme/api.git', setup: 'npm ci\nnpm run build',
      files: [{ path: 'AGENTS.md', content: 'Run the tests with npm test.\nNever push to main.' }], mcp: [{ name: 'github', endpoint: 'https://mcp.github.example/sse' }] });
    const y = api.liveNewYAML(d, 'text', '');
    need(y, ['kind: Workspace', '    git:\n      - name: "origin"', '      - name: "shared-lib"\n        repo: "https://github.com/acme/shared-lib.git"\n        dir: "shared-lib"', '      - name: "api"',
      '    files:\n      - path: "AGENTS.md"\n        content: |\n          Run the tests with npm test.\n          Never push to main.', '    commands:\n      - "npm ci"\n      - "npm run build"',
      '  mcp:\n    servers:\n      - name: "github"\n        endpoint: "https://mcp.github.example/sse"', 'mcp.github.example']);
    if (api.liveNewIssues(d).length) throw new Error(api.liveNewIssues(d).join(' | '));
    const bad = Object.assign({}, d, { repos: 'git@github.com:acme/x.git', files: [{ path: '/etc/passwd', content: 'x' }], mcp: [{ name: '', endpoint: 'http://insecure' }] });
    need(api.liveNewIssues(bad).join(' | '), ['Each extra repo must be an https:// Git address.', 'Give each file a path inside /workspace, like AGENTS.md.', 'Give each MCP server a name and an https:// address.']);
    /* An empty workspace with setup still gets a Workspace, without the repo. */
    const empty = api.liveNewYAML(Object.assign({}, L.draft, { source: 'empty', repos: '', setup: 'apt-get install -y jq', files: [], mcp: [] }), 'text', '');
    need(empty, ['kind: Workspace', '    commands:\n      - "apt-get install -y jq"']);
    never(empty, ['name: "origin"']);
  });
  await check('New task can start from a workspace already on the cluster: it names it, and a failed one is refused', async () => {
    await go(p, '#/new');
    api.ACTIONS['live-new-source']({ dataset: { source: 'existing' } });
    await settle();
    api.render();
    let h = main(p);
    need(h, ['aria-checked="true" data-action="live-new-source" data-source="existing"', 'data-action="live-new-ws-pick" data-ws="itsdangerous"', 'next: pick a workspace']);
    need(api.liveNewIssues(L.draft).join(' | '), ['Pick a workspace, or choose another way to start.']);
    api.ACTIONS['live-new-ws-pick']({ dataset: { ws: 'itsdangerous' } });
    h = main(p);
    need(h, ['aria-pressed="true" data-action="live-new-ws-pick" data-ws="itsdangerous"', 'The task starts from its snapshot', '<span class="mono">itsdangerous</span>']);
    const y = api.liveNewYAML(L.draft, 'text', '');
    need(y, ['  workspace:\n    name: "itsdangerous"']);
    never(y, ['kind: Workspace']);
    if (L.res.workspaces.some((w) => w.metadata.name === 'ws-broken')) {
      api.ACTIONS['live-new-ws-pick']({ dataset: { ws: 'ws-broken' } });
      need(api.liveNewIssues(L.draft).join(' | '), ['The workspace ws-broken failed its setup. Pick another one.']);
      need(main(p), ['Its setup failed: setup step 2 exited 1']);
    }
    api.ACTIONS['live-new-source']({ dataset: { source: 'git' } });
  });
  await check('the task file can be downloaded, and a task file from this computer opens in the editor', async () => {
    api.ACTIONS['live-new-download']();
    api.liveNewLoadFile({ name: 'nightly.yaml', size: 120, text: 'apiVersion: ax.io/v1alpha1\nkind: Task\nmetadata:\n  name: nightly-check\nspec: {}\n' });
    await settle();
    if (!L.draft.raw || !L.draft.yaml.includes('name: nightly-check')) throw new Error('loaded into the editor');
    need(toasts(p), ['Loaded <span class="mono">nightly.yaml</span>']);
    need(main(p), ['data-action="live-new-download"', 'data-action="live-new-load"']);
    api.ACTIONS['live-new-form']();
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
    /* The repo is remembered for next time: the next New task starts with it, and offers it as a pill. */
    if (JSON.parse(p.store['ax.live.recentRepos'])[0] !== 'https://gitlab.example.com/me/project.git') throw new Error(p.store['ax.live.recentRepos']);
    await go(p, '#/new');
    if (L.draft.repo !== 'https://gitlab.example.com/me/project.git') throw new Error('the last repo is the default: ' + L.draft.repo);
    need(main(p), ['<span class="gh-label">Recent</span>', 'aria-pressed="true" data-action="live-new-repo-pick" data-repo="https://gitlab.example.com/me/project.git"', 'gitlab.example.com/me/project']);
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
    /* Both turns are rows in the Tasks table, each saying which turn it is. */
    need(api.liveViewHome().html, [`id="live-trow-${first.name}"`, `id="live-trow-${name}"`, 'Turn 1 of 2', 'Turn 2 of 2']);
  });

  // ---------- Local cluster ----------
  await check('Local cluster shows AX on this computer: its checks, the tools AX uses, the layers it runs, and what you can do. No other clusters', async () => {
    await go(p, '#/places');
    const h = main(p);
    need(h, ['<h1 tabindex="-1">Local cluster</h1>', 'AX on this computer', '<span class="hd"></span>Running', 'Kind cluster <span class="mono">ax-local</span> · context <span class="mono">ax-local</span>',
      'A container runtime that is running', 'docker 27.3 is running', 'Free disk space', '212 GiB free',
      'Tools AX uses', '<span class="mono">kubectl</span> <span class="tool-v mono">v1.36.0</span>', '/opt/homebrew/bin/kubectl', 'is older than v0.32.0. ax downloads a newer one into ~/.ax/bin',
      'Kubernetes (Kind)', 'kind · ax-local', 'Agent Substrate + sandbox workers', 'ate-api-server (1/1 available)', 'AX control plane (ax-server + Postgres)', 'ax-server (1/1 available in ax-system)',
      'id="live-local-update"', 'data-action="live-local-stop"', 'Update runs <span class="mono">ax local start</span> again',
      'id="live-env-recheck"', 'never changes your kubeconfig', 'id="live-output"', 'Set up, start, update, stop or remove AX on this computer to see its output here']);
    if ((h.match(/<\/svg>Running<\/span>/g) || []).length !== 3) throw new Error('each of the three layers says it is running');
    /* Studio names its own images, so Update needs nothing from you. */
    if (/id="live-local-update"[^>]*disabled/.test(h)) throw new Error('update is on: Studio has images of its own');
    need(h, ['<span class="acc-title">AX images</span><span class="acc-sub" id="live-images-sum"><span class="acc-pill">Studio default</span><span class="acc-meta mono">ax-server:v1@', 'Empty uses the image Studio pins for the AX it was built with.', 'Default task image', "For tasks that don't name an image."]);
    /* No remote clusters, no install on one, no cluster switch. This ax has no --runner-volume-image, so that field isn't offered. */
    never(h, ['Remote clusters', 'gke-team-dev', 'gke-broken', 'data-action="live-use-context"', 'data-action="live-cluster-check"', 'Install AX…', 'id="live-cl-needs"', 'ax promote', 'gVisor',
      '<span class="chip waiting">Needed</span>', '127.0.0.1', 'Runner volume image', 'data-action="live-uninstall"']);
    if (api.ACTIONS['live-install'] || api.ACTIONS['live-uninstall'] || api.ACTIONS['live-cluster-check'] || api.ACTIONS['live-use-context']) throw new Error('no remote cluster actions');
    return { html: h };
  });
  await check('an older Studio server names no images of its own, so setup asks for the AX server image first', () => {
    const keep = L.env.setupImages;
    delete L.env.setupImages;
    const h = api.liveViewPlaces().html;
    need(h, ['<span class="acc-title">AX images</span><span class="acc-sub" id="live-images-sum"><span class="chip waiting">Needed</span>', 'Give the AX server image: AX has none of its own yet.']);
    if (!/id="live-local-update"[^>]*disabled/.test(h)) throw new Error('update waits for a server image');
    L.env.setupImages = keep;
  });
  await check('AX on this computer that kubectl can\'t see, or that doesn\'t answer, says so, offers Repair, and calls its layers unknown', async () => {
    L.local.access = 'no-context';
    let h = api.liveViewPlaces().html;
    need(h, ['Not in your kubeconfig', 'id="live-local-repair"', 'Repair runs <span class="mono">ax local start</span>', 'Unknown: the ax-local context isn&#39;t in your kubeconfig. Repair puts it back.', '</svg>Unknown</span>']);
    never(h, ['id="live-local-update"']);
    L.local.access = 'unreachable';
    h = api.liveViewPlaces().html;
    need(h, ['Not answering', 'id="live-local-repair"', 'Unknown: the cluster&#39;s API server isn&#39;t answering.']);
    L.local.access = 'ok';
    L.local.substrate = 'ate-api-server (0/1 available)';
    need(api.liveViewPlaces().html, ['Starting or degraded', 'id="live-local-repair"']);
    L.local.substrate = 'ate-api-server (1/1 available)';
  });
  await check('a layer that is still coming up says Starting, and setup shows each layer with how long it took', async () => {
    const before = L.local.server;
    L.local.server = 'ax-server (0/1 available in ax-system)';
    need(api.liveLayersHTML(), ['</svg>Starting</span>']);
    L.local.server = before;
    L.op = { id: 'op-x', action: 'local-up', target: 'ax-local', status: 'running', stage: 'workers', logs: [], started: Date.now() };
    let h = api.liveLayersHTML();
    need(h, ['</svg>Already in place</span>', '</svg>Installing · <span data-fmt="elapsed" data-since=', '</svg>Waiting</span>']);
    /* Each layer took from when its first stage began to when the next one did. */
    L.op = { id: 'op-y', action: 'local-up', target: 'ax-local', status: 'ok', stage: 'ax', logs: [], started: 1000, finished: 200000, stageStarted: { kind: 1000, substrate: 61000, workers: 125000, ax: 150000 } };
    h = api.liveLayersHTML();
    need(h, ['</svg>Ready · 1m 00s</span>', '</svg>Ready · 1m 29s</span>', '</svg>Ready · 50s</span>']);
    L.op = null;
  });
  await check('the AX images are checked as you type and kept in this browser; Update then runs ax local start for an update', async () => {
    L.images.serverImage = '--kubeconfig=/etc/x';
    need(api.liveViewPlaces().html, ['The AX server image isn&#39;t an image name.']);
    L.images.serverImage = 'ghcr.io/acme/ax-server@sha256:feed';
    need(api.liveViewPlaces().html, ['The AX server image must give its digest as name@sha256: and 64 characters.']);
    L.images.serverImage = 'ghcr.io/acme/ax-server@' + DIGEST;
    await go(p, '#/places');
    if (/id="live-local-update"[^>]*disabled/.test(main(p))) throw new Error('Update is on once the image is good');
    never(main(p), ['<span class="chip waiting">Needed</span>']);
    need(main(p), ['<span class="acc-title">AX images</span><span class="acc-sub" id="live-images-sum"><span class="acc-pill custom">Custom</span><span class="acc-meta mono">']);
    await api.ACTIONS['live-setup-start']({ dataset: { verb: 'update' } });
    await settle();
    const sent = B.posts.filter((x) => x.path === '/api/env/local/up').pop();
    if (JSON.stringify(sent.body) !== JSON.stringify({ name: 'ax-local', workers: 1, purpose: 'update', serverImage: 'ghcr.io/acme/ax-server@' + DIGEST })) throw new Error(JSON.stringify(sent.body));
    need(main(p), ['Updating AX on this computer', 'id="live-op-cancel"', 'Updating · <span data-fmt="elapsed" data-since=']);
    never(main(p), ['Setting up AX on this computer']);
  });
  await check('Cancel stops the command; it ends as canceled, says what it already did stays done, and Dismiss clears it', async () => {
    await api.ACTIONS['live-op-cancel']({ disabled: false });
    if (!B.posts.some((x) => x.path === '/api/env/cancel')) throw new Error('cancel goes to the server');
    const id = L.op.id;
    B.push('envOp', { id, action: 'local-up', target: 'ax-local', status: 'failed', stage: 'kind', error: 'Canceled', canceled: true, purpose: 'update', started: 1, finished: 4000 });
    await settle();
    /* Local cluster says so on the operation's own line, as a note: canceling isn't a failure. */
    need(main(p), ['Updating AX on this computer: canceled', 'What it already set up is kept. Running setup again picks up from there.', 'data-action="live-op-dismiss"']);
    never(main(p), ['role="alert"']);
    never(toasts(p), ['canceled']);
    api.ACTIONS['live-op-dismiss']();
    never(main(p), ['data-action="live-op-dismiss"', 'Updating AX on this computer: canceled']);
    B.running = null;
  });
  await check('Check again looks at this computer and the tools again; healthy sections fold to one line', async () => {
    const before = B.calls.length;
    await api.ACTIONS['live-env-refresh']({ dataset: { fresh: '1' }, id: 'live-env-recheck' });
    await settle();
    const calls = B.calls.slice(before);
    need(calls.join(' '), ['GET /api/env/status?fresh=1']);
    never(calls.join(' '), ['/api/env/check']);
    /* The checks all pass, so they fold; kind is too old, so the tools stay open. What you open stays open. */
    const h = main(p);
    need(h, ['id="live-fold-checks" >', '3 of 3 pass', 'id="live-fold-tools" open', '<span class="mono">kind</span> <span class="tool-v mono">v0.31.0</span>']);
    L.folds['live-fold-checks'] = true;
    need(api.liveViewPlaces().html, ['id="live-fold-checks" open']);
    L.folds['live-fold-checks'] = false;
  });
  await check('Clear empties the Output panel', async () => {
    L.op = { id: 'op-out', action: 'local-up', target: 'ax-local', status: 'ok', stage: 'ax', logs: ['==> Creating cluster', '==> Done'], started: 1, finished: 2 };
    need(api.liveOutputInnerHTML(), ['2 lines', '==&gt; Creating cluster']);
    api.ACTIONS['live-output-clear']();
    need(api.liveOutputInnerHTML(), ['0 lines', 'Cleared. New output shows here as it arrives.']);
    L.op = null;
  });
  await check("Studio stays on AX on this computer, whatever your kubeconfig's current context is, and never changes it", async () => {
    const keep = L.contexts;
    L.contexts = keep.map((c) => Object.assign({}, c, { current: c.name === 'gke-team-dev' }));
    api.render();
    await settle();
    if (L.context !== 'ax-local') throw new Error('context: ' + L.context);
    if (B.calls.some((c) => /context=gke-/.test(c)) || B.calls.some((c) => /\/api\/env\/context/.test(c))) throw new Error('only ax-local is asked, and the kubeconfig is left alone');
    L.contexts = keep;
  });
  await check("AX on this computer that Studio can't reach: it says so with the server's own words and the command, and claims no task count", async () => {
    const before = L.error;
    L.error = 'Unable to connect to the server: dial tcp 127.0.0.1:39101: connect: connection refused';
    const v = api.liveViewHome();
    need(v.html, ["Can't reach AX on ax-local", 'connection refused', 'ax --context ax-local get tasks', 'data-action="live-refresh"', "Studio can't reach AX right now."]);
    never(v.html, ['0 tasks']);
    L.error = before;
    return v;
  });
  await check('when AX and AX Studio are different versions, the page says that, not just the decoding error', async () => {
    const before = L.error;
    L.error = 'grpc: failed to unmarshal the received message: proto: cannot parse invalid wire-format data';
    const v = api.liveViewHome();
    need(v.html, ['AX on ax-local and AX Studio are different versions', 'Update the older one so the two match.', 'cannot parse invalid wire-format data', "Studio can't read what AX sent.", 'data-action="live-refresh"']);
    never(v.html, ["Can't reach AX"]);
    L.error = before;
    return v;
  });
  await check("a local cluster without AX says AX isn't installed there, with the command that repairs it", async () => {
    const before = L.error;
    L.error = 'kubectl port-forward exited for context "ax-local": Error from server (NotFound): services "ax-server" not found';
    const v = api.liveViewHome();
    need(v.html, ["AX isn't installed on ax-local", 'Repair it on Local cluster', 'ax local start', 'services &quot;ax-server&quot; not found', "AX isn't on this cluster yet."]);
    never(v.html, ["Can't reach AX", 'different versions', 'data-action="live-install"', 'Install AX…']);
    L.error = before;
    return v;
  });
  await check('pages with no real source say so instead of showing demo data', async () => {
    for (const [part, what] of [['guardrails', 'Guardrails'], ['welcome', 'Setup']]) need(api.liveViewNotYet(part).html, [`${what} isn't connected to AX yet`, 'href="#/"']);
    await go(p, '#/guardrails');
    need(main(p), ["Guardrails isn't connected to AX yet"]);
  });
  // ---------- Settings ----------
  await check('Settings: AX & this computer first, Appearance & story last, with the nav marking where you are', async () => {
    await go(p, '#/settings');
    need(main(p), ['<h1 tabindex="-1">Settings</h1>', 'aria-label="Settings sections"', 'href="#/settings/about" aria-current="page"', 'AX &amp; this computer']);
    never(main(p), ['href="#/settings/command-line"']);
    if (!/href="#\/settings\/appearance">Appearance &amp; story<\/a><\/nav>/.test(main(p))) throw new Error('Appearance & story is the last Settings tab');
    await go(p, '#/settings/appearance');
    const h = main(p);
    need(h, ['href="#/settings/appearance" aria-current="page"', 'Appearance &amp; story',
      'data-action="set-theme" data-theme="system"', 'data-action="set-theme" data-theme="dark"', 'Axel &amp; the Clear Spring', 'data-action="story"', 'Why an axolotl?']);
    if ((h.match(/<svg [^>]*class="axo\b/g) || []).length !== 1) throw new Error('Axel sits next to his story, once');
    never(h, ['Agents &amp; keys', 'Privacy']);
    need(h, ['href="#/settings/notifications"', 'Compact task lists', 'id="ls-compact"']);
    /* Home is the Tasks page now, with no greeting, so there is no name to set. */
    never(h, ['Your name on Home', 'id="ls-name"']);
  });
  await check('Settings: Keyboard & commands holds the palette, the shortcuts and the ax commands; accessibility switches', async () => {
    await go(p, '#/settings/keyboard');
    need(main(p), ['Command palette', 'data-action="live-palette"', 'Open command palette', '<kbd>⌘</kbd> <kbd>K</kbd>', 'G</kbd> <span class="muted small"> then </span><kbd>S', 'Go to Settings', 'href="#/settings/accessibility"',
      'Command line', 'ax local start', 'ax --context ax-local get tasks']);
    never(main(p), ['Guardrails']);
    const rows = api.liveShortcutRows().map((r) => r[1]).join(' | ');
    if (/Guardrails|Run task/.test(rows)) throw new Error('only shortcuts that work: ' + rows);
    await go(p, '#/settings/accessibility');
    need(main(p), ['Single-key shortcuts', 'data-pref="singleKeys" checked', 'Reduce motion', 'data-pref="reduceMotion"']);
  });
  await check('Settings: what this Studio runs against, read from the server, and diagnostics with secrets removed', async () => {
    await go(p, '#/settings/about');
    const h = main(p);
    need(h, ['AX &amp; this computer', 'v0.2.0', 'AX API v1alpha1', 'only this computer can connect', 'v0.1.0', '/Users/me/.ax/bin/ax', 'On this computer',
      '/Users/me/.kube/config', 'current context', 'ax-system', 'Atespace', "AX's own", 'data-action="live-diagnostics"']);
    /* This computer's checks are on Where agents run (and in Diagnostics), so Settings doesn't repeat them. */
    never(h, ['darwin/arm64', '>This computer<']);
    await api.ACTIONS['live-diagnostics']();
    await settle();
    if (!B.calls.includes('GET /api/env/diagnostics?context=ax-local')) throw new Error('diagnostics are read for the cluster in use');
    const d = dialog(p);
    need(d.querySelector('#ldg-body').innerHTML, ['AX Studio Diagnostics (Secrets Redacted)', 'Active Context: ax-local', 'token: [REDACTED]']);
    await fire(d.querySelector('#ldg-copy'), 'click');
    need(toasts(p), ['Copied the diagnostics (secrets removed)']);
  });
  await check('Settings: the atespace is Studio\'s own choice; a name AX can\'t take is refused, and the rest follows it', async () => {
    await go(p, '#/settings/about');
    need(main(p), ['id="ls-atespace" value="default"', 'data-action="live-atespace-use"', "AX's own is <span class=\"mono\">default</span>"]);
    const inp = p.els['#ls-atespace'] = Object.assign(p.ctx.document.querySelector('#x'), { value: 'Team_A' });
    p.ctx.document.querySelector = ((orig) => (sel) => (sel === '#ls-atespace' ? inp : orig(sel)))(p.ctx.document.querySelector);
    api.ACTIONS['live-atespace-use']({ dataset: {} });
    if (L.atespace !== 'default') throw new Error('a bad name changes nothing');
    inp.value = 'team-a';
    api.ACTIONS['live-atespace-use']({ dataset: {} });
    await settle();
    if (L.atespace !== 'team-a' || p.store['ax.live.atespace'] !== 'team-a') throw new Error('atespace: ' + L.atespace);
    if (!B.calls.some((c) => c.startsWith('GET /api/tasks?') && c.includes('atespace=team-a'))) throw new Error('the list is read from that atespace');
    if (api.liveCmd(['get', 'tasks']) !== 'ax --context ax-local -a team-a get tasks') throw new Error(api.liveCmd(['get', 'tasks']));
    await go(p, '#/');
    need(main(p), ['<span class="muted">atespace</span>&nbsp;<span class="mono">team-a</span>']);
    api.ACTIONS['live-atespace-use']({ dataset: { value: 'default' } });
    await settle();
    if (L.atespace !== 'default' || 'ax.live.atespace' in p.store) throw new Error('back to default');
  });
  await check('Home says when the list was read, with Refresh; Details names the sandbox and the previous attempt; the shell needs a Working task', async () => {
    await go(p, '#/');
    need(main(p), ['Updated <span data-live-updated data-fmt="ago"', 'data-action="live-refresh" aria-label="Refresh the list"']);
    const t = B.tasks['ax-local'].find((x) => x.metadata.name === 'fix-flaky-tests');
    Object.assign(t.status, { actor: 'fix-flaky-tests', actorUid: '427663e8-5707-4ea2-9dce-d38d059e8fbe', previousFailure: 'attempt 1: sandbox crashed' });
    await api.liveRefresh(true);
    await go(p, '#/task/fix-flaky-tests');
    await settle();
    need(main(p), ['<dt>Sandbox</dt>', '427663e8-5707-4ea2-9dce-d38d059e8fbe', 'aria-label="Copy the sandbox uid"', '<dt>Previous attempt</dt><dd>attempt 1: sandbox crashed</dd>']);
    need(api.liveTermInnerHTML('fix-flaky-tests', 'Working'), ['id="live-term-open" data-action="live-term-open" data-task="fix-flaky-tests" >']);
    need(api.liveTermInnerHTML('fix-flaky-tests', 'Idle'), ['The task is not running right now', 'data-task="fix-flaky-tests" disabled']);
  });
  await check('Settings: notifications are opt-in; once on, a task that newly needs you rings while the tab is in the background', async () => {
    await go(p, '#/settings/notifications');
    need(main(p), ['When something needs you', 'Off. Your browser asks first', 'id="ls-notify" data-action="live-notify-toggle"']);
    await api.ACTIONS['live-notify-toggle']({ checked: true });
    await settle();
    p.ctx.Notification.permission = 'granted';
    if (p.store['ax.live.notify'] !== '1') throw new Error('on');
    await go(p, '#/settings/notifications');
    need(main(p), ['On. Studio tells you while this tab is in the background', 'data-action="live-notify-test"']);
    /* The first list on a cluster only learns what already needs you; a new one rings, once, while the tab is hidden. */
    B.notes = [];
    p.ctx.document.hidden = true;
    await api.liveRefresh(true);
    const t = B.tasks[L.context].find((x) => x.status.state === 'TASK_STATE_WORKING');
    t.status.state = 'TASK_STATE_REQUIRES_ACTION';
    await api.liveRefresh(true);
    await api.liveRefresh(true);
    if (B.notes.length !== 1 || !/Waiting for you/.test(B.notes[0].body)) throw new Error(JSON.stringify(B.notes));
    t.status.state = 'TASK_STATE_WORKING';
    p.ctx.document.hidden = false;
    await api.liveRefresh(true);
    await api.ACTIONS['live-notify-toggle']({ checked: false });
    if ('ax.live.notify' in p.store) throw new Error('off');
  });
  await check('the sidebar footer card is this computer, linking to Local cluster; a link opens on an atespace; compact lists', async () => {
    need(api.liveShellHTML(), ['id="live-foot"', '<span class="label">Local cluster</span>']);
    never(api.liveShellHTML(), ['id="live-ctx-switch"', 'Where agents run']);
    await go(p, '#/');
    const foot = p.els['#live-foot'].innerHTML;
    need(foot, ['class="health-card ', 'href="#/places" id="live-health"', 'This computer', 'Connected · ', 'Open Local cluster.']);
    never(foot, ['aria-haspopup="menu"', 'live-use-context', 'gke-']);
    /* A link to this page names no cluster: Studio only works with AX on this computer. */
    p.ctx.location.hash = '#/task/fix-flaky-tests';
    if (!api.liveLinkHere().endsWith('/#/task/fix-flaky-tests') || /context=/.test(api.liveLinkHere())) throw new Error(api.liveLinkHere());
    await go(p, '#/');
    api.ACTIONS['live-compact']({ checked: true });
    if (p.store['ax.live.compact'] !== '1') throw new Error('compact');
    api.ACTIONS['live-compact']({ checked: false });
    /* A new page opened with ?atespace= starts there; an older link's ?context= is dropped. */
    const D = makeBackend();
    const q = makeContext(D);
    q.ctx.location.search = '?context=gke-team-dev&atespace=team';
    await settle();
    if (q.api.LIVE.context !== 'ax-local' || q.api.LIVE.atespace !== 'team') throw new Error(q.api.LIVE.context + ' ' + q.api.LIVE.atespace);
    if (!D.calls.some((c) => c.startsWith('GET /api/tasks?context=ax-local&atespace=team'))) throw new Error('lists there');
    if (D.calls.some((c) => /context=gke-/.test(c))) throw new Error('never another cluster');
  });
  await check('#/tasks is the same Tasks page as #/, the sidebar shows recent tasks; #/settings/command-line redirects to Keyboard & commands', async () => {
    const shell = api.liveShellHTML();
    need(shell, ['<div class="nav-label">Recent</div>', 'href="#/" data-nav="home"']);
    never(shell, ['class="nav-all"', 'See all']);
    await go(p, '#/tasks');
    need(main(p), ['id="live-tasks-title"', '>Tasks</h1>', 'id="live-tasks-q"', 'data-action="live-tasks-filter" data-v="all" aria-pressed="true"',
      'class="table tasks-table"', 'id="live-trow-fix-flaky-tests"', '>Image</th>', '>Workspace</th>', '>Resources</th>', '>Created</th>']);
    never(main(p), ['All tasks', '>Template</th>']);
    api.ACTIONS['live-tasks-filter']({ dataset: { v: 'done' } });
    need(main(p), ['data-v="done" aria-pressed="true"']);
    never(main(p), ['id="live-trow-fix-flaky-tests"']);
    api.ACTIONS['live-tasks-filter']({ dataset: { v: 'all' } });
    L.tasksFilter.q = 'zzzz-nothing';
    api.render();
    need(main(p), ['No tasks match', 'Nothing matches “zzzz-nothing”']);
    L.tasksFilter.q = '';
    await go(p, '#/settings/command-line');
    need(main(p), ['href="#/settings/keyboard" aria-current="page"', 'ax local start', 'ax local status', 'ax --context ax-local get tasks', 'ax --context ax-local ssh &lt;name&gt;',
      'Suspend or resume a task', 'your kubeconfig stays as it is']);
    never(main(p), ['ax --context &lt;cluster&gt; install', 'promote']);
    await go(p, '#/settings/nonsense');
    need(main(p), ['href="#/settings/about" aria-current="page"']);
  });
  await check('the palette offers Settings, Local cluster and diagnostics, and no other clusters', async () => {
    const items = api.livePaletteItems();
    const labels = items.map((x) => x.label).join(' | ');
    need(labels, ['Settings', 'Local cluster', 'Diagnostics (secrets removed)…']);
    never(labels, ['Connect to', 'Where agents run']);
    if (items.some((x) => /^ax ctx /.test(x.cli || ''))) throw new Error('ax ctx changes the kubeconfig');
  });
  await check('a server restart hands out a new token, and the next change gets it and goes through', async () => {
    B.token = 2;
    const r = await api.studioPost('/api/tasks/suspend', { context: 'ax-local', atespace: 'default', name: 'signer-a1b2' });
    const last = B.posts.slice(-2).map((x) => x.token).join();
    if (!r.ok || last !== 'tok-1,tok-2') throw new Error(last);
  });

  // ---------- The Studio server stops answering ----------
  await check("when the Studio server stops answering, the page says so and how to start it again", async () => {
    B.offline = true;
    api.ACTIONS['live-refresh']();
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
  await check("first run: Home is setup, with the real checks and what gets installed; Studio's own images make it one click", async () => {
    let h = main(f);
    if (f.api.LIVE.context !== '' || f.api.LIVE.local.state !== 'NotFound') throw new Error(JSON.stringify([f.api.LIVE.context, f.api.LIVE.local]));
    need(h, ['Set up AX on this computer', 'A container runtime that is running', 'docker 27.3 is running', 'Free disk space', '212 GiB free', 'What gets installed?', 'It runs each task in its own sandbox',
      '<div class="setup-sec-head"><div class="setup-sec-label">System checks</div><button type="button" class="btn sm" data-action="live-env-refresh">',
      'id="live-setup-whats-in"', '4 components', '<span class="acc-title">AX images</span><span class="acc-sub" id="live-images-sum"><span class="acc-pill">Studio default</span><span class="acc-meta mono">ax-server:v1@',
      'Empty uses the image Studio pins for the AX it was built with.', 'data-action="live-setup-start"', 'ax local start']);
    never(h, ['microVM', 'administrator', 'Or run on a remote cluster', 'gVisor', 'Give the AX server image', '<span class="chip waiting">Needed</span>', 'aria-label="After setup"', 'Not set up']);
    /* Expanding "What gets installed?" or "AX images" stays open across redraws. */
    f.api.LIVE.folds['live-setup-whats-in'] = true;
    f.api.LIVE.imagesOpen = true;
    f.api.render({ keepScroll: true });
    need(main(f), ['id="live-setup-whats-in" open', 'id="live-images" open']);
    f.api.LIVE.folds['live-setup-whats-in'] = false;
    f.api.LIVE.imagesOpen = false;
    if (/id="live-setup-start"[^>]*disabled/.test(h)) throw new Error("setup needs nothing typed: Studio has images of its own");
    if (F.calls.some((c) => /\/api\/tasks/.test(c))) throw new Error('with no cluster there is nothing to list');
    /* Every page is setup until AX runs here; Local cluster and Settings stay open. */
    await go(f, '#/new');
    need(main(f), ['Set up AX on this computer']);
    never(main(f), ['id="live-new-run"']);
    await go(f, '#/tasks');
    need(main(f), ['Set up AX on this computer']);
    await go(f, '#/settings');
    need(main(f), ['<h1 tabindex="-1">Settings</h1>']);
    await go(f, '#/');
    /* An image the server's environment sets (AX_SERVER_IMAGE) is what an empty field uses. */
    F.env.setupImages = Object.assign({}, F.env.setupImages, { serverImage: 'ghcr.io/acme/ax-server@' + DIGEST, serverImageFrom: 'env' });
    await f.api.ACTIONS['live-env-refresh']();
    await settle();
    h = main(f);
    if (/id="live-setup-start"[^>]*disabled/.test(h)) throw new Error('the image from the environment is enough');
    need(h, ["Empty uses the image from Studio's environment."]);
    return { html: h };
  });
  await check('a check that fails says how to fix it, and setup waits', async () => {
    F.env.canStartLocal = false;
    F.env.preflight[1] = { id: 'container_engine', label: 'Container engine', status: 'fail', detail: 'No container runtime is running', command: 'open -a Docker' };
    await f.api.ACTIONS['live-env-refresh']();
    await settle();
    need(main(f), ['No container runtime is running', 'open -a Docker', 'One requirement needs attention before setup', 'Resolve the blocked check above, then click Check again.']);
    if (!/id="live-setup-start"[^>]*disabled/.test(main(f))) throw new Error('setup waits for the checks');
    F.env.canStartLocal = true;
    F.env.preflight[1] = Object.assign({}, CHECKS_OK[1]);
    await f.api.ACTIONS['live-env-refresh']();
    await settle();
  });
  await check('Set up starts it on the server, with the images you gave, and shows each stage as its output arrives', async () => {
    f.api.LIVE.images.serverImage = ' registry.example.com/ax-server@' + DIGEST + ' ';
    f.api.ACTIONS['live-setup-start']();
    await settle();
    const sent = F.posts.find((x) => x.path === '/api/env/local/up');
    if (JSON.stringify(sent.body) !== JSON.stringify({ name: 'ax-local', workers: 1, purpose: 'setup', serverImage: 'registry.example.com/ax-server@' + DIGEST })) throw new Error(JSON.stringify(sent.body));
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
    need(main(f), ['Couldn&#39;t pull a container image', 'Setup stopped.', 'installing Substrate: pulling image: 403 Forbidden', 'Try setup again', 'data-action="live-setup-start"']);
    never(main(f), ['id="live-home-title"', 'id="live-tasks-title"']);
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
    need(main(f), ['id="live-tasks-title"', 'No tasks on this computer yet.', 'Start your first task', 'id="live-sample"', 'href="#/new"']);
    never(main(f), ['Your tasks', 'id="live-quick-go"']);
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
    need(main(q), ["Studio couldn't find the <span class=\"mono\">ax</span> command", 'executable file not found']);
    if (!/id="live-setup-start"[^>]*disabled/.test(main(q))) throw new Error('setup waits for ax');
  });

  // ---------- Sanctuary UI/UX & MVP features ----------
  await check('every live page has Axel in his Sanctuary role, and never more than one Axel on screen', async () => {
    const M = makeBackend();
    const m = makeContext(M);
    await settle();
    for (const [page, v] of [
      ['Home', m.api.liveViewHome()],
      ['Local cluster', m.api.liveViewPlaces()],
      ['Task', m.api.liveViewTask('fix-flaky-tests')],
      ['New task', m.api.liveViewNew()],
      ['Setup', m.api.liveViewSetup(false)],
      ['Settings', m.api.liveViewSettings('appearance')],
    ]) {
      const count = (v.html.match(/<svg [^>]*class="axo\b/g) || []).length;
      if (count !== 1) throw new Error(`${page} should have 1 Axel, got ${count}`);
    }
  });
  await check('in-page Terminal opens an ax ssh session, streams output, sends commands and disconnects', async () => {
    const M = makeBackend();
    const m = makeContext(M);
    await settle();
    await go(m, '#/task/fix-flaky-tests/terminal');
    need(main(m), ['id="live-term"', 'id="live-term-open"', 'Open shell in sandbox', 'role="tabpanel" class="task-panel" id="panel-terminal"', 'class="terminal live-terminal"']);
    await m.api.liveTermOpen('fix-flaky-tests');
    await settle();
    const startPost = M.posts.find((x) => x.path === '/api/sessions/start');
    if (!startPost || startPost.body.args.join(' ') !== '--context ax-local -a default ssh fix-flaky-tests') throw new Error(JSON.stringify(startPost));
    const id = startPost.body.id;
    M.push('sessionData', { id, data: 'root@sandbox:/workspace# \x1b[1;32mok\x1b[0m \x1b[?2004h', stream: 'stdout' });
    const h = m.api.liveTermInnerHTML('fix-flaky-tests', 'Working');
    /* Colors show as colors; other escape sequences don't show at all. */
    need(h, ['Connected', 'root@sandbox:/workspace#', '<span class="a-bold a-g">ok</span>', 'id="live-term-in"', 'earlier commands', 'data-action="live-term-add"']);
    never(h, ['2004h', '\x1b']);
    /* A second shell in the same sandbox opens next to the first, as a tab. */
    m.api.ACTIONS['live-term-add']({ dataset: { task: 'fix-flaky-tests' } });
    await settle();
    const starts = M.posts.filter((x) => x.path === '/api/sessions/start').map((x) => x.body.id);
    if (starts.length !== 2 || starts[0] === starts[1]) throw new Error(JSON.stringify(starts));
    need(m.api.liveTermInnerHTML('fix-flaky-tests', 'Working'), ['Shell 1', 'Shell 2', 'aria-selected="true" data-action="live-term-pick" data-task="fix-flaky-tests" data-i="1"']);
    m.api.ACTIONS['live-term-pick']({ dataset: { task: 'fix-flaky-tests', i: '0' } });
    await m.api.liveTermClose('fix-flaky-tests');
    if (!M.posts.some((x) => x.path === '/api/sessions/close' && x.body.id === id)) throw new Error('close session');
  });
  await check('New task shows prompt-clarity helper pills and the visual Guardrails gateMap', async () => {
    const M = makeBackend();
    const m = makeContext(M);
    await settle();
    await go(m, '#/new');
    need(main(m), ['id="live-goal-help"', 'data-action="live-new-suggest"', 'id="live-new-gatemap"', 'generativelanguage.', 'github.com']);
    m.api.ACTIONS['live-new-suggest']({ dataset: { text: 'Fix the failing tests' } });
    if (m.api.LIVE.draft.goal !== 'Fix the failing tests') throw new Error(m.api.LIVE.draft.goal);
    need(m.api.liveGoalHelpHTML(m.api.LIVE.draft), ['<span class="gh-label">Make it clearer</span>', 'data-action="live-new-tip"']);
    m.api.ACTIONS['live-new-tip']({ dataset: { tip: 'done' } });
    if (!/Done when:/.test(m.api.LIVE.draft.goal)) throw new Error(m.api.LIVE.draft.goal);
  });
  await check('stopping AX on this computer when tasks are running offers to suspend them first so checkpoints survive', async () => {
    const M = makeBackend();
    const m = makeContext(M);
    await settle();
    await go(m, '#/places');
    m.api.ACTIONS['live-local-stop']();
    need(m.els['#overlay'].innerHTML, ['Stop AX on this computer?', 'id="ls-go"']);
    need(dialog(m).querySelector('#ls-body').innerHTML, ['Suspend running tasks first']);
    await fire(dialog(m).querySelector('#ls-go'), 'click');
    const paused = M.posts.filter((x) => x.path === '/api/tasks/suspend').map((x) => x.body.name).sort().join();
    if (paused !== 'fix-flaky-tests,signer-b2c3') throw new Error('paused before stop: ' + paused);
    if (!M.posts.some((x) => x.path === '/api/env/local/stop')) throw new Error('local stop called after pausing');
  });
  await check('the live command palette lists real tasks and actions with their ax CLI equivalents', async () => {
    const M = makeBackend();
    const m = makeContext(M);
    await settle();
    await go(m, '#/task/fix-flaky-tests');
    const items = m.api.livePaletteItems();
    const labels = items.map((x) => x.label).join(' | ');
    need(labels, ['New task', 'Suspend fix-flaky-tests', 'Open shell in sandbox', 'Fix the flaky tests.', 'Delete task…']);
    never(labels, ['Connect to', 'Send a follow-up', 'Run on another cluster', 'Pause ']);
    const s = items.find((x) => x.label === 'Suspend fix-flaky-tests');
    if (s.cli !== 'ax --context ax-local suspend task fix-flaky-tests') throw new Error(s.cli);
  });

  console.log(fails ? `\n${fails} FAILED of ${n}` : `\nALL OK (${n} checks)`);
  process.exit(fails ? 1 : 0);
})();
