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

/* AX Studio, live mode: where agents run.

   This computer and the clusters in your kubeconfig, and setting up AX on this computer. Everything here comes from
   the Studio server (see api.js and live.js):
   - what AX on this computer needs, checked for real: the operating system, a running container runtime, free disk
   - whether AX on this computer is running, stopped or not set up
   - setup itself: the server runs `ax local start` and sends its output as it arrives */

/* What setup builds, in the order `ax local start` builds it. `key` is the stage the server reports. */
const LIVE_SETUP_STEPS = [
  { key: 'kind', title: 'Creating the Kubernetes cluster', short: 'Kubernetes', desc: 'A small cluster (Kind) inside your container runtime', ic: 'box' },
  { key: 'substrate', title: 'Installing Agent Substrate', short: 'Agent Substrate', desc: 'It runs each agent in its own gVisor sandbox', ic: 'shield' },
  { key: 'workers', title: 'Starting the sandbox workers', short: 'Workers', desc: 'Where the sandboxes run', ic: 'cpu' },
  { key: 'ax', title: 'Starting the AX server', short: 'AX server', desc: 'It keeps your tasks', ic: 'server' },
];
/* The checks the server runs, in plain words. Its own label is the fallback for a check this file doesn't know. */
const LIVE_CHECK_TITLES = {
  os_arch: 'Operating system and processor',
  container_engine: 'A container runtime that is running',
  disk_space: 'Free disk space',
};
const LIVE_OP_WORDS = {
  'local-up': { doing: 'Setting up AX on this computer', done: 'AX is running on this computer', fail: 'Setup stopped' },
  'local-stop': { doing: 'Stopping AX on this computer', done: 'AX on this computer is stopped', fail: "Couldn't stop AX on this computer" },
  'local-delete': { doing: 'Removing AX from this computer', done: 'AX is removed from this computer', fail: "Couldn't remove AX from this computer" },
};
const LIVE_OP_SHORT = { 'local-up': 'Setting up', 'local-stop': 'Stopping', 'local-delete': 'Removing' };
const LIVE_LOG_LINES = 400;
/* What you typed under "Use other AX images", kept while the page redraws. */
LIVE.images = { serverImage: '', defaultTaskImage: '', runnerVolumeImage: '' };
LIVE.imagesOpen = false;
let liveOpPaintTimer = 0;

/* ---------- Setup in progress ---------- */
function liveOpRunning() { return !!(LIVE.op && LIVE.op.status === 'running'); }
/** Takes the server's word on an operation. Output already received is kept when the update carries none. */
function liveSetOp(op) {
  if (!op || !op.id) return;
  const same = LIVE.op && LIVE.op.id === op.id;
  LIVE.op = {
    id: op.id, action: op.action || '', target: op.target || '', status: op.status || 'running', error: op.error || '',
    stage: op.stage || (same ? LIVE.op.stage : ''),
    logs: op.logs && op.logs.length ? op.logs.slice() : same ? LIVE.op.logs : [],
  };
}
function liveOnStreamLine(l) {
  if (!l || !LIVE.op || LIVE.op.id !== l.id) return;
  LIVE.op.logs.push(String(l.line || ''));
  if (LIVE.op.logs.length > 2000) LIVE.op.logs.splice(0, LIVE.op.logs.length - 2000);
  if (l.stage) LIVE.op.stage = l.stage;
  if (!liveOpPaintTimer) liveOpPaintTimer = setTimeout(() => { liveOpPaintTimer = 0; liveOpPaint(); }, 200);
}
function liveOnEnvOp(op) {
  if (!op) return;
  const wasRunning = liveOpRunning();
  liveSetOp(op);
  if (op.status === 'running') { render({ keepScroll: true, background: true }); return; }
  if (wasRunning || op.status === 'failed') liveOpFinished();
}
async function liveOpFinished() {
  const op = LIVE.op;
  const words = LIVE_OP_WORDS[op.action] || { done: 'Done', fail: 'It failed' };
  await liveLoadEnv();
  render({ keepScroll: true });
  if (op.status === 'ok') {
    toast(words.done, { icon: 'check' });
    announce(words.done);
    /* Setup finished and there was nothing else to talk to: use AX on this computer. */
    const local = LIVE.local && LIVE.local.context;
    if (op.action === 'local-up' && local && local !== LIVE.context && !LIVE.context && LIVE.contexts.some((c) => c.name === local)) liveUseContext(local, true);
  } else {
    announce(words.fail);
  }
  LIVE.failedAt = 0;
  await liveRefresh(true);
}
/** Redraws only the progress block, so the output keeps its place and nothing else on the page moves. */
function liveOpPaint() {
  const box = $('#live-op');
  if (!box) return;
  const log = $('#live-op-log', box);
  const stuck = !log || log.scrollTop + log.clientHeight >= log.scrollHeight - 24;
  const at = log ? log.scrollTop : 0;
  box.innerHTML = liveOpInnerHTML();
  const log2 = $('#live-op-log', box);
  if (log2) log2.scrollTop = stuck ? log2.scrollHeight : at;
}
function liveOpInnerHTML() {
  const op = LIVE.op;
  if (!op) return '';
  const running = op.status === 'running', failed = op.status === 'failed';
  const words = LIVE_OP_WORDS[op.action] || { doing: 'Working', fail: 'It failed' };
  let head;
  if (op.action === 'local-up') {
    const at = Math.max(0, LIVE_SETUP_STEPS.findIndex((s) => s.key === op.stage));
    const cur = LIVE_SETUP_STEPS[at];
    head = setupStonesHTML({ step: op.status === 'ok' ? LIVE_SETUP_STEPS.length : at }, LIVE_SETUP_STEPS, failed ? at : null)
      + (running ? `<div class="su-now" id="live-op-now"><b>Now</b>${esc(cur.title)}… <span class="muted">${esc(cur.desc)}</span></div>` : '');
  } else {
    head = running ? `<div class="health-line" style="margin-top:4px"><span class="hd"></span>${esc(words.doing)}…</div>` : '';
  }
  const lines = op.logs.slice(-LIVE_LOG_LINES);
  const why = failed ? (liveLastLine(lines.join('\n')) || op.error || 'It stopped without saying why.') : '';
  return `${head}
    ${failed ? `<div class="callout warn" role="alert" style="margin-top:14px">${icon('alert')}<div><strong>${esc(words.fail)}.</strong> <span style="overflow-wrap:anywhere">${esc(why)}</span></div></div>` : ''}
    ${lines.length ? `<div class="live-title" style="margin-top:14px">Output</div>
      <pre class="manifest" id="live-op-log" style="margin-top:8px;max-height:260px;overflow:auto" tabindex="0" aria-label="Output">${esc(lines.join('\n'))}</pre>` : ''}`;
}
function liveOpHTML() {
  const op = LIVE.op;
  if (!op || op.status === 'ok') return '';
  if (op.action === 'local-up' && op.status === 'failed' && LIVE.local && LIVE.local.state === 'Running' && /available/i.test(LIVE.local.server || '')) return '';
  return `<div id="live-op" style="margin-top:12px">${liveOpInnerHTML()}</div>`;
}

/* ---------- AX on this computer ---------- */
function liveChecksHTML() {
  if (!LIVE.checks.length) return '';
  const look = { ok: ['ok', 'check'], warn: ['warn', 'alert'], fail: ['no', 'x'] };
  return `<div class="setup-panel" style="margin-top:12px"><ul class="check-list" aria-label="What AX on this computer needs">${LIVE.checks.map((c) => {
    const [cls, ic] = look[c.status] || look.warn;
    const fix = c.command ? `<div style="margin-top:8px">${cliHint(c.command)}</div>` : '';
    return setupCheckItem(cls, ic, esc(LIVE_CHECK_TITLES[c.id] || c.label || 'Check'), `<span id="live-check-${esc(c.id)}">${esc(c.detail || '')}</span>${fix}`);
  }).join('')}</ul></div>`;
}
function liveImagesHTML() {
  const env = LIVE.env || {};
  const field = (key, label, hint) => `<label class="small" style="display:grid;gap:4px;margin-top:8px">${label}
      <input class="input mono" type="text" data-live-image="${key}" value="${esc(LIVE.images[key])}" placeholder="${esc(hint)}" autocomplete="off" spellcheck="false"></label>`;
  /* The server passes these two on from its own environment, so say when one is set. */
  const own = (fromEnv, name) => (fromEnv ? `${fromEnv} (from ${name})` : "Leave empty for AX's own");
  return `<details class="disclosure" id="live-images" style="margin-top:12px" ${LIVE.imagesOpen ? 'open' : ''}><summary>${icon('chevRight', 'sm chev')}Use other AX images</summary>
    <div class="disclosure-body"><p class="small sub">Optional. Setup uses the images that come with AX unless you give others here.</p>
      ${field('serverImage', 'AX server image', own(env.serverImageEnv, 'AX_SERVER_IMAGE'))}
      ${field('defaultTaskImage', 'Default task image', own(env.defaultTaskImageEnv, 'AX_DEFAULT_TASK_IMAGE'))}
      <p class="xsmall muted" style="margin-top:4px">A task that names no image of its own runs in this one. AX's built-in one isn't public yet, so give one here if you plan to run such tasks. It must end in its digest (<span class="mono">@sha256:…</span>). The templates on New task bring their own image.</p>
      ${field('runnerVolumeImage', 'Runner volume image', "Leave empty to use the runner in each task's image")}</div></details>`;
}
function liveLocalHTML() {
  const L = LIVE.local;
  if (LIVE.envError && !L) return `<div class="health-line attn" style="margin-top:4px"><span class="hd"></span>Couldn't check</div><p class="small" style="margin-top:8px;overflow-wrap:anywhere">${esc(LIVE.envError)}</p><div class="btn-row" style="margin-top:10px"><button class="btn sm" data-action="live-env-refresh">${icon('refresh', 'sm')}Check again</button></div>`;
  if (!L) return '<p class="small muted" style="margin-top:8px">Checking…</p>';
  const busy = liveOpRunning();
  const running = L.state === 'Running', stopped = L.state === 'Stopped';
  const line = busy ? '' : running ? `<div class="health-line" style="margin-top:4px" id="live-local-state"><span class="hd"></span>Running</div>`
    : `<div class="health-line attn" style="margin-top:4px" id="live-local-state"><span class="hd"></span>${stopped ? 'Stopped' : 'Not set up'}</div>`;
  const noAx = LIVE.axError ? `<div class="callout warn" style="margin-top:12px">${icon('alert')}<div><strong>Studio couldn't run the <span class="mono">ax</span> command, and setup needs it.</strong> Install AX (see github.com/google/ax), then check again. <span class="muted" style="overflow-wrap:anywhere">${esc(LIVE.axError)}</span></div></div>` : '';
  let body;
  if (busy) {
    body = '';
  } else if (running) {
    body = `<div style="margin-top:12px">${liveKV([['Cluster', esc(L.name)], ['Kube context', `<span class="mono">${esc(L.context)}</span>`], ['Agent Substrate', esc(L.substrate)], ['AX server', esc(L.server)]])}</div>
      <div class="btn-row" style="margin-top:14px"><button class="btn sm" data-action="live-local-stop">${icon('pause', 'sm')}Stop</button><button class="btn ghost sm" data-action="live-local-delete">${icon('trash', 'sm')}Remove…</button></div>
      <p class="xsmall muted" style="margin-top:10px">${icon('terminal', 'xs')} <code>ax local status</code></p>`;
  } else if (stopped) {
    body = `<p class="small" style="margin-top:10px">Start it again. Your tasks and their files are kept.</p>${noAx}
      <div class="btn-row" style="margin-top:14px"><button class="btn primary" data-action="live-setup-start" id="live-setup-start" ${LIVE.axError ? 'disabled' : ''}>${icon('play', 'sm')}Start</button><button class="btn ghost sm" data-action="live-local-delete">${icon('trash', 'sm')}Remove…</button></div>
      <p class="xsmall muted" style="margin-top:10px">${icon('terminal', 'xs')} <code>ax local start</code></p>`;
  } else {
    const blocked = !LIVE.canStartLocal || !!LIVE.axError;
    body = `${liveChecksHTML()}${noAx}
      <details class="disclosure" style="margin-top:12px"><summary>${icon('chevRight', 'sm chev')}What gets installed?</summary><div class="disclosure-body small sub">
        ${LIVE_SETUP_STEPS.map((s) => `<div style="padding:3px 0"><strong style="color:var(--ink)">${esc(s.short)}</strong> <span class="muted">${esc(s.desc)}</span></div>`).join('')}
        <p style="margin-top:8px">It all runs inside your container runtime. Setup may download <span class="mono">kind</span> and <span class="mono">kubectl</span> into <span class="mono">~/.ax/bin</span>, and it adds a context named <span class="mono">ax-local</span> to your kubeconfig. It doesn't ask for your password.</p></div></details>
      ${liveImagesHTML()}
      <div class="btn-row" style="margin-top:14px"><button class="btn primary" data-action="live-setup-start" id="live-setup-start" ${blocked ? 'disabled' : ''}>Set up AX on this computer${icon('arrowRight', 'sm')}</button><button class="btn ghost sm" data-action="live-env-refresh">${icon('refresh', 'sm')}Check again</button></div>
      ${!LIVE.canStartLocal ? '<p class="small" style="margin-top:8px">Fix what the checks found, then check again.</p>' : ''}
      <p class="xsmall muted" style="margin-top:10px">${icon('terminal', 'xs')} The same from the command line: <code>ax local start</code></p>`;
  }
  return line + liveOpHTML() + body;
}
function liveClustersHTML() {
  if (LIVE.envError && !LIVE.contexts.length) return `<p class="small" style="margin-top:10px;overflow-wrap:anywhere">${esc(LIVE.envError)}</p>`;
  if (!LIVE.contexts.length) return `<p class="small" style="margin-top:10px">Your kubeconfig has no clusters yet. Set up AX on this computer, or add a cluster to <span class="mono">~/.kube/config</span>.</p>`;
  return `<div class="radio-list" style="margin-top:14px">${LIVE.contexts.map((c) => {
    const inUse = c.name === LIVE.context;
    const local = liveIsLocal(c.name);
    const facts = [local ? 'This computer' : esc(c.cluster), local && LIVE.local && LIVE.local.state !== 'Running' ? (LIVE.local.state === 'Stopped' ? 'Stopped' : 'Not set up') : '', c.current ? 'Current in your kubeconfig' : ''].filter(Boolean).join(' · ');
    return `<div class="radio-card info${inUse ? ' is-on' : ''}" style="cursor:default;align-items:flex-start">
        <span class="rc-main"><span class="rc-title">${esc(c.name)}</span><span class="rc-desc">${facts}</span></span>
        <span style="text-align:right;min-width:150px">${inUse ? `<span class="chip done">${icon('check')}In use</span>` : `<button type="button" class="btn sm" data-action="live-use-context" data-context="${esc(c.name)}">Use this cluster</button>`}</span></div>`;
  }).join('')}</div>`;
}
function liveAqueductHTML() {
  const L = LIVE.local || {};
  const remote = LIVE.contexts.filter((c) => !liveIsLocal(c.name));
  const active = LIVE.tasks.filter((t) => liveState(t.state).active).length;
  const localSub = L.state === 'Running' ? `gVisor · ${liveIsLocal(LIVE.context) ? `${active} running` : 'Running'}` : L.state === 'Stopped' ? 'gVisor · Stopped' : 'gVisor · Not set up';
  const remoteSub = remote.length ? `Kubernetes · ${plural(remote.length, 'cluster')}` : 'Kubernetes · ~/.kube/config';
  const s = 54;
  return `<svg class="aqueduct-map" viewBox="0 0 820 132" role="img" aria-label="Tasks move from this computer to a remote Kubernetes cluster with the same task file and network rules." style="margin-top:14px">
    <rect x="6" y="22" width="218" height="88" rx="14" class="aq-basin"/>
    <circle cx="38" cy="54" r="14" class="aq-icon-bg"/>
    <path d="M31 58V50h14v8M29 58h18" class="aq-stroke"/>
    <text x="60" y="51" class="aq-title">On this computer</text>
    <text x="60" y="68" class="aq-sub">${esc(localSub)}</text>
    <text x="115" y="95" text-anchor="middle" class="aq-meta">gVisor sandbox · ax local</text>
    <path d="M224 66 C312 46, 364 86, 410 66 C456 46, 508 86, 596 66" class="aq-stream-bg"/>
    <path d="M224 66 C312 46, 364 86, 410 66 C456 46, 508 86, 596 66" class="aq-stream"/>
    <circle r="3" class="rm-packet"><animateMotion dur="3.8s" begin="-0.4s" repeatCount="indefinite" path="M224 66 C312 46, 364 86, 410 66 C456 46, 508 86, 596 66"/></circle>
    <circle r="2.4" class="rm-packet coral"><animateMotion dur="3.8s" begin="-2.3s" repeatCount="indefinite" path="M224 66 C312 46, 364 86, 410 66 C456 46, 508 86, 596 66"/></circle>
    <circle cx="410" cy="56" r="31" class="rm-core"/>
    ${axo(active ? 'working' : 'idle', { decorative: true }).replace('<svg class="axo', `<svg data-follow x="${410 - s / 2}" y="${56 - s / 2 + 1}" width="${s}" height="${s}" style="width:${s}px;height:${s}px" class="axo`)}
    <text x="410" y="106" text-anchor="middle" class="aq-pill-txt">Same Task + Workspace + Gateway YAML · ax promote</text>
    <rect x="596" y="22" width="218" height="88" rx="14" class="aq-basin lake"/>
    <circle cx="628" cy="54" r="14" class="aq-icon-bg"/>
    <path d="M623 58h11a4 4 0 0 0 .5-7.9A5.5 5.5 0 0 0 624 49a3.5 3.5 0 0 0-1 9Z" class="aq-stroke"/>
    <text x="650" y="51" class="aq-title">On a remote cluster</text>
    <text x="650" y="68" class="aq-sub">${esc(remoteSub)}</text>
    <text x="705" y="95" text-anchor="middle" class="aq-meta">Agent Substrate · ax ctx</text>
  </svg>`;
}
function liveViewPlaces() {
  const html = `
    <h1 tabindex="-1">Where agents run</h1>
    <p class="sub" style="margin-top:6px;font-size:14.5px;max-width:64ch">Run tasks on this computer or on a remote cluster. Choosing a cluster here doesn't change your kubeconfig: Studio names the cluster on every request.</p>
    ${liveAqueductHTML()}
    <div class="places-grid">
      <section class="card place-card" aria-labelledby="live-pl-local">
        <div class="place-top"><div><h2 id="live-pl-local" class="h-display-sm">On this computer</h2></div></div>
        ${liveLocalHTML()}
      </section>
      <section class="card place-card" aria-labelledby="live-pl-clusters">
        <div class="place-top"><div><h2 id="live-pl-clusters" class="h-display-sm">Clusters</h2></div></div>
        ${liveClustersHTML()}
        <p class="xsmall muted" style="margin-top:12px">${icon('terminal', 'xs')} From your kubeconfig: <code>ax ctx</code></p>
      </section>
    </div>`;
  return { title: 'Where agents run', crumbs: [{ label: 'Home', href: '#/' }, { label: 'Where agents run' }], html, wide: true };
}
/** Setup of AX on this computer. It is also what Home shows while there is no AX to list tasks from. */
function liveViewSetup(asHome) {
  const L = LIVE.local || { state: 'NotFound' };
  const settingUp = liveOpRunning() && LIVE.op.action === 'local-up';
  const failed = (LIVE.op && LIVE.op.status === 'failed') || (!LIVE.canStartLocal && L.state !== 'Running') || !!LIVE.axError;
  const mood = settingUp ? 'working' : L.state === 'Running' ? 'done' : failed ? 'alert' : 'wave';
  const remote = LIVE.contexts.filter((c) => !liveIsLocal(c.name));
  let title, lede;
  if (settingUp) { title = 'Setting up AX on this computer'; lede = 'This takes a few minutes. You can leave this page: setup keeps going.'; }
  else if (L.state === 'Running') { title = 'AX is running on this computer'; lede = 'Your agents run here, each in its own sandbox.'; }
  else if (L.state === 'Stopped') { title = 'AX on this computer is stopped'; lede = 'Start it to see your tasks and run new ones.'; }
  else { title = 'Set up AX on this computer'; lede = 'AX runs your agents on this computer, each in its own sandbox. Setup takes a few minutes.'; }
  const html = `
    <div class="cuj-head" style="margin-bottom:14px">${axo(mood, { decorative: true, id: 'setup-axo' })}<div class="cuj-head-copy"><h1 tabindex="-1">${title}</h1><p class="lede">${lede}</p></div></div>
    <section class="card card-pad" style="margin-top:14px" aria-label="AX on this computer" id="live-setup">
      ${liveLocalHTML()}
      ${L.state === 'Running' && !liveOpRunning() && !asHome ? `<div class="btn-row" style="margin-top:14px"><a class="btn primary" href="#/">Your tasks${icon('arrowRight', 'sm')}</a></div>` : ''}
    </section>
    <section class="card card-pad" style="margin-top:14px" aria-labelledby="live-setup-remote">
      <h2 id="live-setup-remote" class="h-display-sm">Or run on a remote cluster</h2>
      <p class="small" style="margin-top:6px;max-width:70ch">${remote.length
        ? `Your kubeconfig has ${plural(remote.length, 'other cluster')}. Nothing is installed on this computer for that.`
        : 'Add a cluster to <span class="mono">~/.kube/config</span> and it shows up in Where agents run. Nothing is installed on this computer for that.'}</p>
      <div class="btn-row" style="margin-top:12px"><a class="btn sm" href="#/places">${remote.length ? 'Choose a cluster' : 'Where agents run'}</a></div>
    </section>`;
  const crumbs = asHome ? [{ label: 'Home' }] : [{ label: 'Home', href: '#/' }, { label: 'Where agents run', href: '#/places' }, { label: 'This computer' }];
  return { title, crumbs, html };
}

/* ---------- Actions ---------- */
async function liveStartOp(call, failWords) {
  if (liveOpRunning()) return;
  try {
    liveSetOp(await call());
    const words = LIVE_OP_WORDS[LIVE.op.action];
    if (words) announce(words.doing);
  } catch (e) {
    toast(`${failWords}: ${esc(e.message)}`, { icon: 'alert', timeout: 9000 });
  }
  render({ keepScroll: true });
}
function liveOpenStopLocal() {
  const active = liveIsLocal(LIVE.context) ? LIVE.tasks.filter((t) => liveState(t.state).active) : [];
  if (!active.length) {
    liveStartOp(() => studioApi.localStop(), "Couldn't stop AX on this computer");
    return;
  }
  const p = { pauseFirst: true, busy: false, error: '' };
  const dlg = openDialog(dialogShell('ls', 'Stop AX on this computer?', '', '<div id="ls-body"></div>', `<span class="left"></span><button class="btn ghost" data-action="close-dialog">Cancel</button><button class="btn primary" id="ls-go">${icon('pause', 'sm')}Stop</button>`, false, 'pause'));
  const paint = () => {
    const body = $('#ls-body', dlg);
    if (!body) return;
    body.innerHTML = `
      <p class="small">${plural(active.length, 'task is', 'tasks are')} running on this computer: ${active.map((t) => `<span class="mono">${esc(t.name)}</span>`).join(', ')}.</p>
      <label class="toggle-line" style="margin-top:12px"><span class="tl-text"><b>Pause running tasks first</b><span>Saves each task's gVisor checkpoint so you can resume it later. Stopping the cluster while a task is running marks that attempt Failed when the cluster starts again.</span></span>
        <span class="switch"><input type="checkbox" role="switch" id="ls-pause" ${p.pauseFirst ? 'checked' : ''} ${p.busy ? 'disabled' : ''} aria-label="Pause running tasks first"><span class="track"></span><span class="thumb"></span></span></label>
      <div style="margin-top:12px">${cliHint('ax local stop')}</div>
      ${p.error ? `<div class="callout warn" role="alert" style="margin-top:12px">${icon('alert')}<div style="overflow-wrap:anywhere">${esc(p.error)}</div></div>` : ''}`;
    $('#ls-pause', body).addEventListener('change', (e) => { p.pauseFirst = e.target.checked; });
    const go = $('#ls-go', dlg);
    go.disabled = p.busy;
    go.innerHTML = p.busy ? `${icon('loader', 'sm')}Pausing tasks…` : `${icon('pause', 'sm')}Stop`;
  };
  $('#ls-go', dlg).addEventListener('click', async () => {
    if (p.busy) return;
    if (p.pauseFirst) {
      p.busy = true; p.error = '';
      paint();
      try {
        for (const t of active) await studioApi.taskAction('suspend', LIVE.context, LIVE.atespace, t.name);
      } catch (e) {
        p.busy = false; p.error = `Couldn't pause running tasks: ${e.message}`;
        paint();
        return;
      }
    }
    closeDialog(true);
    liveStartOp(() => studioApi.localStop(), "Couldn't stop AX on this computer");
  });
  paint();
}
function liveOpenRemoveLocal() {
  const dlg = openDialog(dialogShell('lr', 'Remove AX from this computer?', '', `
    <p class="small">This deletes the local cluster. It can't be undone.</p>
    <ul class="check-list" style="margin-top:10px">
      <li class="check-item no"><span class="ci-icon">${icon('trash')}</span><div><div class="ci-title">Removed</div><div class="ci-desc">Every task on this computer, its sandbox and the files in it</div></div></li>
      <li class="check-item ok"><span class="ci-icon">${icon('check')}</span><div><div class="ci-title">Kept</div><div class="ci-desc">Your container runtime, the <span class="mono">ax</span> command, and the other clusters in your kubeconfig</div></div></li>
    </ul>
    <div style="margin-top:14px">${cliHint('ax local delete')}</div>`, `<span class="left"></span><button class="btn ghost" data-action="close-dialog">Cancel</button><button class="btn danger" id="lr-go">${icon('trash', 'sm')}Remove</button>`, false, 'trash'));
  $('#lr-go', dlg).addEventListener('click', () => { closeDialog(true); liveStartOp(() => studioApi.localDelete(), "Couldn't remove AX from this computer"); });
}
const LIVE_ENV_ACTIONS = {
  'live-setup-start': () => {
    const images = {};
    Object.keys(LIVE.images).forEach((k) => { const v = LIVE.images[k].trim(); if (v) images[k] = v; });
    liveStartOp(() => studioApi.localUp(images), "Couldn't start setup");
  },
  'live-local-stop': () => liveOpenStopLocal(),
  'live-local-delete': () => liveOpenRemoveLocal(),
  'live-env-refresh': async () => { await liveLoadEnv(); LIVE.failedAt = 0; await liveRefresh(true); },
};
if (LIVE.on) {
  /* Keep what you type, and whether the section is open, while the page redraws. */
  document.addEventListener('input', (e) => { const k = e.target && e.target.dataset && e.target.dataset.liveImage; if (k) LIVE.images[k] = e.target.value; });
  document.addEventListener('toggle', (e) => { if (e.target && e.target.id === 'live-images') LIVE.imagesOpen = e.target.open; }, true);
}
