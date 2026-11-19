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

   This computer and the clusters in your kubeconfig, and setting up AX on this computer, as the desktop app's
   Environment page has them. Everything here comes from the Studio server (see api.js and live.js):
   - what AX on this computer needs, checked for real: the operating system, a running container runtime, free disk
   - the tools AX uses (ax, kubectl, kind), with their versions and where they are
   - how AX on this computer is doing (running, not in your kubeconfig, not answering, starting or degraded, stopped,
     not set up), and the state of each layer it runs (Kubernetes in Kind, Agent Substrate with its gVisor workers, and
     AX's own control plane), with how long each took while setup runs
   - setup, start, update and repair: the server runs `ax local start` and sends its output as it arrives; Cancel stops it
   - the AX images those deploy, kept in this browser
   - a read-only check of a remote cluster, and installing, upgrading or uninstalling AX there (`ax install`, `ax uninstall`)
   - the output of whichever of these ran last, in one Output panel at the bottom of the page */

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
const LIVE_OP_SHORT = { 'local-up': 'Setting up', 'local-stop': 'Stopping', 'local-delete': 'Removing', 'remote-install': 'Installing AX', 'remote-uninstall': 'Removing AX', 'task-move': 'Sending a task' };
/** Setup, start, stop and remove run on this computer; installs, uninstalls and task moves run elsewhere. */
function liveOpIsLocal(op) { return !!op && /^local-/.test(op.action || ''); }
/** "gke-team-dev/team" (where a task move sends it) in words: the cluster, and the atespace when it isn't default. */
function liveOpDest(op) {
  const [ctx, ates] = String((op && op.to) || '').split('/');
  return `${liveShortCtx(ctx) || 'the cluster'}${ates && ates !== 'default' ? ` (atespace ${ates})` : ''}`;
}
/** An operation in a word or two, for a chip: a setup run says what it was for. */
function liveOpShort(op) {
  if (op && op.action === 'local-up') return { start: 'Starting', update: 'Updating', repair: 'Repairing' }[op.purpose || LIVE.localVerb] || 'Setting up';
  if (op && op.action === 'remote-install' && LIVE.clusterChecks[op.target] && LIVE.clusterChecks[op.target].ax) return 'Upgrading AX';
  return LIVE_OP_SHORT[op && op.action] || 'Working';
}
const LIVE_LOG_LINES = 400;
/** What an operation is doing, did, or why it stopped, in the UI's words. An install names its cluster. */
function liveOpWords(op) {
  if (op && op.action === 'remote-install') {
    const t = liveShortCtx(op.target) || 'the cluster';
    return { doing: `Installing AX on ${t}`, done: `AX is installed on ${t}`, fail: `Couldn't install AX on ${t}` };
  }
  if (op && op.action === 'remote-uninstall') {
    const t = liveShortCtx(op.target) || 'the cluster';
    return { doing: `Removing AX from ${t}`, done: `AX is removed from ${t}`, fail: `Couldn't remove AX from ${t}` };
  }
  if (op && op.action === 'task-move') {
    const t = liveOpDest(op);
    return { doing: `Sending ${op.target} to ${t}`, done: `${op.target} is on ${t}`, fail: `Couldn't send ${op.target} to ${t}` };
  }
  if (op && op.action === 'local-up' && LIVE_LOCAL_VERBS[op.purpose || LIVE.localVerb]) return LIVE_LOCAL_VERBS[op.purpose || LIVE.localVerb];
  return LIVE_OP_WORDS[op && op.action] || { doing: 'Working', done: 'Done', fail: 'It failed' };
}
/* `ax local start` under the name of the button that ran it: it sets up, starts, updates or repairs AX on this computer. */
const LIVE_LOCAL_VERBS = {
  setup: { doing: 'Setting up AX on this computer', done: 'AX is running on this computer', fail: 'Setup stopped' },
  start: { doing: 'Starting AX on this computer', done: 'AX is running on this computer', fail: "Couldn't start AX on this computer" },
  update: { doing: 'Updating AX on this computer', done: 'AX on this computer is updated', fail: "Couldn't update AX on this computer" },
  repair: { doing: 'Repairing AX on this computer', done: 'AX on this computer is repaired', fail: "Couldn't repair AX on this computer" },
};
/** The ax command the server runs for an operation, to show above its output. */
function liveOpCommand(op) {
  if (!op) return '';
  if (op.action === 'remote-install') return `ax --context ${op.target} install`;
  if (op.action === 'remote-uninstall') return `ax --context ${op.target} uninstall`;
  if (op.action === 'task-move') return `Run ${op.target} on ${liveOpDest(op)}`;
  return { 'local-up': 'ax local start', 'local-stop': 'ax local stop', 'local-delete': 'ax local delete' }[op.action] || '';
}
/* What you typed under "AX images", kept in this browser (they are image names, not secrets), as the desktop app does. */
const LIVE_IMAGES_KEY = 'ax.live.images';
LIVE.images = (() => {
  const empty = { serverImage: '', runnerVolumeImage: '' };
  try { return Object.assign(empty, JSON.parse(localStorage.getItem(LIVE_IMAGES_KEY) || '{}')); } catch (e) { return empty; }
})();
LIVE.imagesOpen = false;
function liveSaveImages() { try { localStorage.setItem(LIVE_IMAGES_KEY, JSON.stringify(LIVE.images)); } catch (e) { /* ignore */ } }
/** What's wrong with the images. They apply to setup on this computer and to installing AX on a cluster. */
function liveImageProblems() {
  const env = LIVE.env || {};
  const im = LIVE.images;
  const out = [];
  /* ax has no ax-server image of its own yet, and only finds that out at its last step, after Kubernetes and Agent
     Substrate are up. So it's asked for first. */
  if (!im.serverImage.trim() && !env.serverImageEnv) out.push('Give the AX server image: AX has none of its own yet.');
  [['The AX server image', im.serverImage], ['The runner volume image', LIVE.axFlags && LIVE.axFlags.runnerVolumeImage ? im.runnerVolumeImage : '']].forEach(([label, raw]) => {
    const v = String(raw || '').trim();
    if (v && (v.startsWith('-') || /\s/.test(v))) out.push(`${label} isn't an image name.`);
    else if (v.includes('sha256:') && !/@sha256:[0-9a-f]{64}$/.test(v)) out.push(`${label} must give its digest as name@sha256: and 64 characters.`);
  });
  return out;
}
/** The images to send with setup or an install: the ones typed here; the server adds its own from its environment. */
function liveImagesToSend() {
  const out = {};
  ['serverImage'].concat(LIVE.axFlags && LIVE.axFlags.runnerVolumeImage ? ['runnerVolumeImage'] : []).forEach((k) => {
    const v = String(LIVE.images[k] || '').trim();
    if (v) out[k] = v;
  });
  return out;
}
/** A kubeconfig name as people say it: gke_project_zone_cluster is "cluster". */
function liveShortCtx(name) {
  const parts = String(name || '').split('_');
  return String(name || '').startsWith('gke_') && parts.length >= 4 ? parts.slice(3).join('_') : String(name || '');
}
/** The command that gets a cluster's credentials again. A GKE cluster's kubeconfig entry names its project, location
    and name (gke_project_location_name), so the command is filled in; otherwise it shows where they go. */
function liveCredsCmd(name) {
  const entry = LIVE.contexts.find((x) => x.name === name) || {};
  const m = /^gke_([^_]+)_([^_]+)_(.+)$/.exec(entry.cluster || name || '');
  if (!m) return 'gcloud container clusters get-credentials <cluster> --region <region>';
  return `gcloud container clusters get-credentials ${m[3]} --${/-[a-z]$/.test(m[2]) ? 'zone' : 'region'} ${m[2]} --project ${m[1]}`;
}
/* Where AX's and Agent Substrate's documentation covers a cluster that isn't this computer. */
const LIVE_DOCS = {
  prerequisites: 'https://github.com/google/ax/blob/main/docs/local_installer.md#remote-cluster-prerequisites-for-step-5',
  substrateSetup: 'https://github.com/google/ax/blob/main/docs/installation.md#substrate-setup',
  substrateInstall: 'https://github.com/agent-substrate/substrate/blob/f86fde9dfb5424c8d16f613de80469bdbef06541/docs/guides/operator-install.md',
  workerPool: 'https://github.com/agent-substrate/substrate/blob/f86fde9dfb5424c8d16f613de80469bdbef06541/docs/reference/api-guide.md#1-workerpool-the-physical-capacity',
};
function liveDoc(key, text) { return `<a href="${LIVE_DOCS[key]}" target="_blank" rel="noreferrer">${text}${icon('arrowUpRight', 'xs')}</a>`; }
/** "42s" or "3m 07s", as the app's clock counts elapsed time (its 1-second tick updates [data-since] in place). */
function liveDuration(ms) { return fmtElapsed(Date.now() - Math.max(0, ms)); }
/* Clear in the Output panel hides the lines that were there: { id: operation, n: lines hidden }. */
LIVE.outClear = null;
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
    /* When it started and each stage began, the step ax announced last, and whether you cancelled it. */
    started: op.started || (same ? LIVE.op.started : Date.now()), finished: op.finished || 0,
    stageStarted: op.stageStarted || (same ? LIVE.op.stageStarted : {}) || {},
    step: op.step || (same ? LIVE.op.step : ''), canceled: !!op.canceled,
    /* What a setup run was for (setup, start, update or repair), as the button that started it said. */
    purpose: op.purpose || (same ? LIVE.op.purpose : ''),
    /* The command's exit status when it failed, and where a task move sends the task. */
    exitCode: op.exitCode || 0, to: op.to || (same ? LIVE.op.to : ''),
  };
  if (op.status === 'running') LIVE.opDismissed = '';
}
function liveOnStreamLine(l) {
  if (!l || !LIVE.op || LIVE.op.id !== l.id) return;
  LIVE.op.logs.push(String(l.line || ''));
  if (LIVE.op.logs.length > 2000) {
    const cut = LIVE.op.logs.length - 2000;
    LIVE.op.logs.splice(0, cut);
    if (LIVE.outClear && LIVE.outClear.id === LIVE.op.id) LIVE.outClear.n = Math.max(0, LIVE.outClear.n - cut);
  }
  if (l.stage) LIVE.op.stage = l.stage;
  if (l.step) LIVE.op.step = l.step;
  if (l.stageStarted) LIVE.op.stageStarted = l.stageStarted;
  if (LIVE.opWatch) LIVE.opWatch(LIVE.op);
  if (!liveOpPaintTimer) liveOpPaintTimer = setTimeout(() => { liveOpPaintTimer = 0; liveOpPaint(); }, 200);
}
function liveOnEnvOp(op) {
  if (!op) return;
  const wasRunning = liveOpRunning();
  liveSetOp(op);
  /* A dialog that started this operation (Run on another cluster) follows it. */
  if (LIVE.opWatch) LIVE.opWatch(LIVE.op);
  if (op.status === 'running') { render({ keepScroll: true, background: true }); return; }
  if (wasRunning || op.status === 'failed') liveOpFinished();
}
async function liveOpFinished() {
  const op = LIVE.op;
  const words = liveOpWords(op);
  await liveLoadEnv();
  render({ keepScroll: true });
  /* A dialog that watched the operation already said how it ended. */
  const told = !!LIVE.opWatch || LIVE.opHandled === op.id;
  if (op.status === 'ok' && op.action === 'task-move') {
    if (!told) {
      const [ctx, ates] = String(op.to || '').split('/');
      toast(`${esc(words.done)}. <button type="button" class="btn ghost sm" data-action="live-show-moved" data-context="${esc(ctx)}" data-atespace="${esc(ates || 'default')}" data-task="${esc(op.target)}">Show it</button>`, { icon: 'cloudUp', timeout: 12000 });
    }
    announce(words.done);
  } else if (op.status === 'ok') {
    toast(esc(words.done), { icon: 'check' });
    announce(words.done);
    /* Setup finished and there was nothing else to talk to: use AX on this computer. */
    const local = LIVE.local && LIVE.local.context;
    if (op.action === 'local-up' && local && local !== LIVE.context && !LIVE.context && LIVE.contexts.some((c) => c.name === local)) liveUseContext(local, true);
  } else if (op.canceled) {
    announce(`${words.doing}: canceled`);
    /* Where agents run says so where the command ran; elsewhere a toast does. */
    if (parseRoute().parts[0] !== 'places') toast(`${esc(words.doing)}: canceled. What it already did stays done.`, { icon: 'alert', timeout: 9000 });
  } else {
    announce(words.fail);
    if (op.action === 'remote-install' || op.action === 'remote-uninstall') toast(`${esc(words.fail)}${op.exitCode ? ` (exit ${esc(op.exitCode)})` : ''}. The Output panel has what <span class="mono">${esc(liveOpCommand(op))}</span> said.`, { icon: 'alert', timeout: 9000 });
    else if (op.action === 'task-move' && !told) toast(`${esc(words.fail)}: ${esc(op.error || liveLastLine(op.logs.join('\n')))}`, { icon: 'alert', timeout: 9000 });
  }
  /* While you're in another tab, a notification says it finished (if you turned them on). */
  if (typeof liveNotify === 'function' && !op.canceled) liveNotify(op.status === 'ok' ? words.done : words.fail, op.status === 'ok' ? 'AX Studio' : (op.error || 'See Where agents run'), '#/places', `ax-op-${op.id}`);
  /* What a check found about the cluster is out of date now. */
  if ((op.action === 'remote-install' || op.action === 'remote-uninstall') && op.target) liveCheckCluster(op.target);
  LIVE.failedAt = 0;
  await liveRefresh(true);
}
/** Redraws only the progress block and the Output panel, so the output keeps its place and nothing else moves. */
function liveOpPaint() {
  const out = $('#live-output');
  const box = $('#live-op');
  const log = $('#live-op-log');
  const stuck = !log || log.scrollTop + log.clientHeight >= log.scrollHeight - 24;
  const at = log ? log.scrollTop : 0;
  /* Only Where agents run has the Output panel, and it lists the layers, so it needs neither here. */
  if (box) box.innerHTML = liveOpInnerHTML({ log: !out, stones: !out });
  if (out) out.innerHTML = liveOutputInnerHTML();
  const log2 = $('#live-op-log');
  if (log2) log2.scrollTop = stuck ? log2.scrollHeight : at;
}
/** Setup's progress, or why an operation stopped. With { log: false } the output is left to the Output panel. */
function liveOpInnerHTML(opts) {
  const op = LIVE.op;
  if (!op) return '';
  const withLog = !opts || opts.log !== false;
  /* Where agents run lists the layers with their progress, so the stones are only for the setup page. */
  const withStones = !opts || opts.stones !== false;
  const running = op.status === 'running', failed = op.status === 'failed';
  const words = liveOpWords(op);
  /* One line says what runs, for how long, and what ax is doing right now; Cancel interrupts it. */
  const elapsed = running ? `<span class="num" data-fmt="elapsed" data-since="${op.started}">${liveDuration(Date.now() - op.started)}</span>`
    : `<span class="num">${liveDuration((op.finished || Date.now()) - op.started)}</span>`;
  const title = running ? words.doing : failed ? (op.canceled ? `${words.doing}: canceled` : words.fail) : words.done;
  const bar = `<div class="op-line" id="live-op-line">${running ? icon('loader', 'sm spin') : failed ? icon('xCircle', 'sm') : icon('checkCircle', 'sm')}
      <span class="op-title">${esc(title)}</span><span class="op-time">${elapsed}</span>${failed && !op.canceled && op.exitCode ? `<span class="op-exit" title="The command's exit status">exit ${esc(op.exitCode)}</span>` : ''}
      ${running && op.step ? `<span class="op-step" id="live-op-step" title="${esc(op.step)}">${esc(op.step)}</span>` : '<span class="op-step"></span>'}
      ${running ? `<button type="button" class="btn ghost sm" data-action="live-op-cancel" id="live-op-cancel" aria-label="Cancel: ${esc(words.doing)}">${icon('x', 'sm')}Cancel</button>`
        : `<button type="button" class="btn ghost sm" data-action="live-op-dismiss" aria-label="Dismiss: ${esc(title)}">Dismiss</button>`}</div>`;
  let head = bar;
  if (op.action === 'local-up' && withStones) {
    const at = Math.max(0, LIVE_SETUP_STEPS.findIndex((s) => s.key === op.stage));
    head += setupStonesHTML({ step: op.status === 'ok' ? LIVE_SETUP_STEPS.length : at }, LIVE_SETUP_STEPS, failed && !op.canceled ? at : null);
  }
  const lines = op.logs.slice(-LIVE_LOG_LINES);
  const why = failed && !op.canceled ? (liveLastLine(lines.join('\n')) || op.error || 'It stopped without saying why.') : '';
  return `${head}
    ${op.canceled ? '<p class="small sub op-note">What it already did stays done. Running it again picks up from there.</p>' : ''}
    ${why ? `<div class="callout warn" role="alert" style="margin-top:14px">${icon('alert')}<div><strong>${esc(words.fail + '.')}</strong> <span style="overflow-wrap:anywhere">${esc(why)}</span></div></div>` : ''}
    ${withLog && lines.length ? `<div class="live-title" style="margin-top:14px">Output</div>
      <pre class="manifest" id="live-op-log" style="margin-top:8px;max-height:260px;overflow:auto" tabindex="0" aria-label="Output">${esc(lines.join('\n'))}</pre>` : ''}`;
}
/** Progress, or the result until you dismiss it. Installing or removing AX on a cluster shows on that cluster's card. */
function liveOpHTML(opts) {
  const op = LIVE.op;
  if (!op || LIVE.opDismissed === op.id || !liveOpIsLocal(op)) return '';
  if (op.status === 'ok' && parseRoute().parts[0] !== 'places') return '';
  if (op.action === 'local-up' && op.status === 'failed' && !op.canceled && LIVE.local && LIVE.local.state === 'Running' && /available/i.test(LIVE.local.server || '')) return '';
  return `<div id="live-op" class="live-op" style="margin-top:12px">${liveOpInnerHTML(opts)}</div>`;
}

/* ---------- Output: what the last setup, stop, remove or install printed ---------- */
function liveOutputLines() {
  const op = LIVE.op;
  if (!op) return [];
  const from = LIVE.outClear && LIVE.outClear.id === op.id ? LIVE.outClear.n : 0;
  return op.logs.slice(from).slice(-LIVE_LOG_LINES);
}
function liveOutputInnerHTML() {
  const op = LIVE.op;
  const lines = liveOutputLines();
  const cmd = liveOpCommand(op);
  const st = !op ? ''
    : op.status === 'running' ? `<span class="chip running">${icon('loader')}Running</span>`
      : op.status === 'failed' ? `<span class="chip failed">${icon('xCircle')}Stopped</span>`
        : `<span class="chip done">${icon('checkCircle')}Done</span>`;
  const empty = op && op.logs.length ? 'Cleared. New output shows here as it arrives.'
    : 'Set up AX on this computer, or install AX on a remote cluster, to see its output here as it arrives.';
  return `<div class="term-bar">
      <span class="term-dots" aria-hidden="true"><i></i><i></i><i></i></span>
      <h2 class="lo-title" id="live-output-h">${icon('terminal', 'sm')}Output</h2>
      ${cmd ? `<code class="lo-cmd">${esc(cmd)}</code>` : ''}${st}
      <span class="lo-count" id="live-output-count">${plural(lines.length, 'line')}</span>
      <button type="button" class="btn ghost sm lo-clear" data-action="live-output-clear" ${lines.length ? '' : 'disabled'}>Clear</button>
    </div>
    <pre class="term-body lo-body" id="live-op-log" tabindex="0" aria-label="Output">${lines.length ? esc(lines.join('\n')) : `<span class="m">${empty}</span>`}</pre>`;
}
function liveOutputHTML() {
  return `<section class="terminal live-output" id="live-output" aria-labelledby="live-output-h">${liveOutputInnerHTML()}</section>`;
}

/* ---------- AX on this computer ---------- */
/* Sections that are fine fold to one line that says so; a section with a problem stays open. What you opened or closed
   is kept while the page redraws. */
LIVE.folds = {};
function liveFoldHTML(id, title, sum, body, attention) {
  const open = attention || !!LIVE.folds[id];
  return `<details class="pl-fold" id="${id}" ${open ? 'open' : ''}><summary>${icon('chevRight', 'sm chev')}${title ? `<span class="pl-sub">${title}</span>` : ''}<span class="fold-sum">${sum}</span></summary><div class="fold-body">${body}</div></details>`;
}
/** "3 of 3 pass", or how many need a look, with the look of the worst. */
function liveFoldSum(items) {
  const bad = items.filter((x) => x.status === 'fail').length, warn = items.filter((x) => x.status === 'warn').length;
  if (bad) return `<span class="fs-bad">${icon('x', 'xs')}${plural(bad, 'problem')}</span>`;
  if (warn) return `<span class="fs-warn">${icon('alert', 'xs')}${warn} to look at</span>`;
  return `<span class="fs-ok">${icon('check', 'xs')}${items.length} of ${items.length} pass</span>`;
}
function liveChecksHTML() {
  if (!LIVE.checks.length) return '';
  const look = { ok: ['ok', 'check'], warn: ['warn', 'alert'], fail: ['no', 'x'] };
  return `<div class="setup-panel live-checks"><ul class="check-list" aria-label="What AX on this computer needs">${LIVE.checks.map((c) => {
    const [cls, ic] = look[c.status] || look.warn;
    const fix = c.command ? `<div style="margin-top:8px">${cliHint(c.command)}</div>` : '';
    return setupCheckItem(cls, ic, esc(LIVE_CHECK_TITLES[c.id] || c.label || 'Check'), `<span id="live-check-${esc(c.id)}">${esc(c.detail || '')}</span>${fix}`);
  }).join('')}</ul></div>`;
}
function liveImageProblemsHTML(problems) {
  return problems.map((p) => `<div class="problem-line" role="note">${icon('alert', 'sm')}<span>${esc(p)}</span></div>`).join('');
}
/** The images in a word, next to their heading: Needed, or the AX server image in use. */
function liveImagesSummaryHTML(problems) {
  const using = LIVE.images.serverImage.trim() || (LIVE.env || {}).serverImageEnv || '';
  return problems.length ? '<span class="chip waiting">Needed</span>'
    : using ? `<span class="muted small mono">· ${esc(typeof liveImageShort === 'function' ? liveImageShort(using) : using)}</span>` : '';
}
function liveImagesHTML() {
  const env = LIVE.env || {};
  const problems = liveImageProblems();
  const field = (key, label, hint, required) => `<label class="small img-field"><span>${label}${required ? ' <span class="muted">· required</span>' : ''}</span>
      <input class="input mono" type="text" data-live-image="${key}" value="${esc(LIVE.images[key])}" placeholder="${esc(hint)}" autocomplete="off" spellcheck="false" ${required && !LIVE.images[key].trim() ? 'aria-invalid="true"' : ''}></label>`;
  /* The server passes this one on from its own environment, so say when it's set. */
  const own = (fromEnv, name, fallback) => (fromEnv ? `${fromEnv} (from ${name})` : fallback);
  return `<details class="disclosure" id="live-images" style="margin-top:12px" ${LIVE.imagesOpen || problems.length ? 'open' : ''}><summary>${icon('chevRight', 'sm chev')}AX images <span id="live-images-sum">${liveImagesSummaryHTML(problems)}</span></summary>
    <div class="disclosure-body"><p class="small sub">Setting up, updating or repairing AX here, and installing it on a cluster, deploy these. They're kept in this browser.</p>
      ${field('serverImage', 'AX server image', own(env.serverImageEnv, 'AX_SERVER_IMAGE', 'registry.example.com/ax/ax-server@sha256:…'), !env.serverImageEnv)}
      ${LIVE.axFlags && LIVE.axFlags.runnerVolumeImage ? field('runnerVolumeImage', 'Runner volume image', "Optional. Leave empty to run the runner in each task's image") : ''}
      <div id="live-image-problems">${liveImageProblemsHTML(problems)}</div></div></details>`;
}
/** ax, kubectl and kind, as ax will find them: version, where each is, or that ax downloads it. */
function liveToolsHTML() {
  const tools = LIVE.tools || [];
  if (!tools.length) return '';
  const look = { ok: ['ok', 'check'], warn: ['warn', 'alert'], fail: ['no', 'x'], none: ['info', 'download'] };
  return `<div class="setup-panel live-checks"><ul class="check-list" id="live-tools" aria-label="Tools AX uses">${tools.map((t) => {
    const [cls, ic] = look[t.status] || look.none;
    return setupCheckItem(cls, ic, `<span class="mono">${esc(t.name)}</span>${t.version ? ` <span class="tool-v mono">${esc(t.version)}</span>` : ''}`, `<span class="ls-wrap">${esc(t.detail)}</span>`);
  }).join('')}</ul></div>`;
}
/** The tools in one line: each with its version, or that ax downloads it. */
function liveToolsSum() {
  return `<span class="fs-tools">${(LIVE.tools || []).map((t) => `<span class="mono">${esc(t.name)}</span>${t.version ? ` <span class="tool-v mono">${esc(t.version)}</span>` : t.status === 'none' ? ' <span class="muted">downloaded by ax</span>' : t.status === 'fail' ? ' <span class="fs-bad">missing</span>' : ''}`).join('<span class="dot"></span>')}</span>`;
}
/** AX on this computer in one word: running and ready, or why not. Without access, what's installed is unknown. */
function liveLocalHealth() {
  const L = LIVE.local || {};
  if (L.state === 'Running') {
    if (L.access === 'no-context') return { ok: false, text: 'Not in your kubeconfig', fix: 'repair' };
    if (L.access === 'unreachable') return { ok: false, text: 'Not answering', fix: 'repair' };
    if (liveAvailable(L.substrate) && liveAvailable(L.server) && !/degraded/i.test(L.substrate || '')) return { ok: true, text: 'Running' };
    return { ok: false, text: 'Starting or degraded', fix: 'repair' };
  }
  return { ok: false, text: L.state === 'Stopped' ? 'Stopped' : 'Not set up' };
}
/** What stops `ax local start`: ax missing, a failed check (only before setup), or the images. */
function liveLocalBlockers(forSetup) {
  const out = [];
  if (LIVE.axError) out.push("Studio can't run the ax command.");
  if (forSetup) LIVE.checks.filter((c) => c.status === 'fail').forEach((c) => out.push(c.detail || c.label));
  return out.concat(liveImageProblems());
}
/** Redraws what the images decide (the problems and the buttons they turn off) as you type, without moving the cursor. */
function liveRefreshImageProblems() {
  const problems = liveImageProblems();
  const box = $('#live-image-problems'); if (box) box.innerHTML = liveImageProblemsHTML(problems);
  const sum = $('#live-images-sum'); if (sum) sum.innerHTML = liveImagesSummaryHTML(problems);
  const blocked = problems.length > 0 || liveOpRunning();
  $$('[data-needs-images]').forEach((b) => { b.disabled = blocked || b.dataset.blockedOther === '1'; });
  $$('[data-why-images]').forEach((p) => { p.hidden = !problems.length; p.textContent = `${p.dataset.verb || 'Install'} AX: ${problems.join(' ')}`; });
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
    const blockers = liveLocalBlockers(false);
    body = `<p class="small" style="margin-top:10px">Start it again. Your tasks and their files are kept.</p>${noAx}
      ${liveImagesHTML()}
      <div class="btn-row" style="margin-top:14px"><button class="btn primary" data-action="live-setup-start" data-verb="start" id="live-setup-start" data-needs-images data-blocked-other="${LIVE.axError ? 1 : 0}" ${blockers.length ? 'disabled' : ''}>${icon('play', 'sm')}Start</button><button class="btn ghost sm" data-action="live-local-delete">${icon('trash', 'sm')}Remove…</button></div>
      <p class="xsmall muted" style="margin-top:10px">${icon('terminal', 'xs')} <code>ax local start</code></p>`;
  } else {
    const blockers = liveLocalBlockers(true);
    const otherBlock = !LIVE.canStartLocal || !!LIVE.axError;
    body = `${liveChecksHTML()}${noAx}
      <details class="disclosure" style="margin-top:12px"><summary>${icon('chevRight', 'sm chev')}What gets installed?</summary><div class="disclosure-body small sub">
        ${LIVE_SETUP_STEPS.map((s) => `<div style="padding:3px 0"><strong style="color:var(--ink)">${esc(s.short)}</strong> <span class="muted">${esc(s.desc)}</span></div>`).join('')}
        <p style="margin-top:8px">It all runs inside your container runtime. Setup may download <span class="mono">kind</span> and <span class="mono">kubectl</span> into <span class="mono">~/.ax/bin</span>, and it adds a context named <span class="mono">ax-local</span> to your kubeconfig. It doesn't ask for your password.</p></div></details>
      ${liveImagesHTML()}
      <div class="btn-row" style="margin-top:14px"><button class="btn primary" data-action="live-setup-start" data-verb="setup" id="live-setup-start" data-needs-images data-blocked-other="${otherBlock ? 1 : 0}" ${blockers.length ? 'disabled' : ''}>Set up AX on this computer${icon('arrowRight', 'sm')}</button><button class="btn ghost sm" data-action="live-env-refresh">${icon('refresh', 'sm')}Check again</button></div>
      ${!LIVE.canStartLocal ? '<p class="small" style="margin-top:8px">Fix what the checks found, then check again.</p>' : ''}
      <p class="xsmall muted" style="margin-top:10px">${icon('terminal', 'xs')} The same from the command line: <code>ax local start</code></p>`;
  }
  return line + liveOpHTML() + body;
}
function liveClustersHTML() {
  if (LIVE.envError && !LIVE.contexts.length) return `<p class="small" style="margin-top:10px;overflow-wrap:anywhere">${esc(LIVE.envError)}</p>`;
  const remote = LIVE.contexts.filter((c) => !liveIsLocal(c.name));
  if (!remote.length) {
    return `<div class="cl-empty" id="live-cl-empty">${icon('cloud')}<div><div class="live-title">No remote clusters in your kubeconfig yet</div>
      <p class="small sub" style="margin-top:4px">Get your team cluster's credentials, then check again:</p>
      <div class="live-cli-wrap" style="margin-top:8px">${cliHint('gcloud container clusters get-credentials <cluster> --region <region>')}</div></div></div>
      ${liveClusterGuideHTML()}`;
  }
  return `<div class="cl-list" role="list" aria-label="Remote clusters">${remote.map(liveClusterCardHTML).join('')}</div>${liveClusterGuideHTML()}`;
}
/** What a cluster needs before AX can go on it, and the order to set one up in, as two disclosures like AX images. */
function liveClusterGuideHTML() {
  return `<div class="cl-guides" id="live-cl-guide">
    <details class="disclosure cl-guide" id="live-cl-needs" ${LIVE.folds['live-cl-needs'] ? 'open' : ''}>
      <summary>${icon('chevRight', 'sm chev')}A cluster for AX needs <span class="muted small">· GKE 1.37+, Agent Substrate, storage</span></summary>
      <div class="disclosure-body small">
        <ul class="cl-guide-list">
          <li>GKE 1.37 or later, or Kubernetes 1.36 or later, with <span class="mono">ClusterTrustBundle</span> and <span class="mono">PodCertificateRequest</span> turned on</li>
          <li>Agent Substrate v1.0.0 in <span class="mono">ate-system</span>, with a ready gVisor WorkerPool</li>
          <li>A snapshot location set on Agent Substrate for the whole cluster, such as a GCS bucket</li>
          <li>A default StorageClass for the 10Gi volume of AX's Postgres database</li>
          <li>Credentials in your kubeconfig that can manage <span class="mono">ax-system</span> and change Agent Substrate's allowlists in <span class="mono">ate-system</span></li>
        </ul>
        <p class="sub" style="margin-top:8px">The full list is in AX's ${liveDoc('prerequisites', 'remote cluster prerequisites')}.</p>
      </div>
    </details>
    <details class="disclosure cl-guide" id="live-cl-setup" ${LIVE.folds['live-cl-setup'] ? 'open' : ''}>
      <summary>${icon('chevRight', 'sm chev')}To set one up <span class="muted small">· 3 steps</span></summary>
      <div class="disclosure-body small">
        <ol class="cl-guide-list">
          <li>Create the cluster and get its credentials. It shows up here after Check again.<div class="live-cli-wrap" style="margin-top:6px">${cliHint('gcloud container clusters get-credentials <cluster> --region <region>')}</div></li>
          <li>Install Agent Substrate and create a WorkerPool. <span class="mono">ax</span> doesn't do this on a remote cluster: follow Substrate's ${liveDoc('substrateInstall', 'operator install guide')} and ${liveDoc('workerPool', 'WorkerPool guide')}, with the settings AX needs from ${liveDoc('substrateSetup', 'Substrate setup')}.<div class="live-cli-wrap" style="margin-top:6px">${cliHint('kubectl get workerpools -A')}</div></li>
          <li>Check the cluster here, then Install AX.</li>
        </ol>
      </div>
    </details>
  </div>`;
}
/** What a check found: the cluster's own requirements, then Agent Substrate and AX, and what to do next. */
function liveClusterCheckHTML(name, c) {
  if (!c) return '';
  if (c.checking && !(c.requirements && c.requirements.length) && !c.error) return `<p class="small muted cl-check" id="live-cl-check-${esc(name)}">${icon('loader', 'xs spin')} Checking the cluster…</p>`;
  if (c.error) {
    return `<div class="cl-check" id="live-cl-check-${esc(name)}"><div class="problem-line">${icon('alert', 'sm')}<span>Couldn't reach the cluster: ${esc(c.error)}</span></div>
      <p class="xsmall muted" style="margin-top:6px">If your credentials have expired, get them again:</p><div class="live-cli-wrap" style="margin-top:4px">${cliHint(liveCredsCmd(name))}</div>
      ${c.checking ? `<p class="small muted" style="margin-top:6px">${icon('loader', 'xs spin')} Checking again…</p>` : ''}</div>`;
  }
  const look = { ok: ['ok', 'check'], warn: ['warn', 'alert'], fail: ['no', 'x'], none: ['idle', 'clock'] };
  const full = (r) => !!r && r.total > 0 && r.ready >= r.total;
  const subUp = full(c.substrate) && full(c.router);
  const pools = c.workerPools || { ready: 0, total: 0 };
  const subHealth = !c.substrate ? 'none' : subUp && pools.ready > 0 ? 'ok' : 'warn';
  const axHealth = !c.ax ? 'none' : full(c.ax) ? 'ok' : 'warn';
  const rows = (c.requirements || []).map((r) => { const [cls, ic] = look[r.status] || look.warn; return setupCheckItem(cls, ic, esc(r.label), esc(r.detail)); })
    .concat([
      setupCheckItem(look[subHealth][0], look[subHealth][1], 'Agent Substrate', !c.substrate ? 'Not installed'
        : `ate-api-server ${c.substrate.ready}/${c.substrate.total}${c.router ? ` · router ${c.router.ready}/${c.router.total}` : ''} · ${pools.ready}/${pools.total} WorkerPools ready`),
      setupCheckItem(look[axHealth][0], look[axHealth][1], 'AX', !c.ax ? 'Not installed' : `ax-server ${c.ax.ready}/${c.ax.total}${c.axImage ? ` · <span class="mono" title="${esc(c.axImage)}">${esc(typeof liveImageShort === 'function' ? liveImageShort(c.axImage) : c.axImage)}</span>` : ''}`),
    ]);
  const reqs = c.requirements || [];
  const failed = reqs.some((r) => r.status === 'fail');
  const warned = reqs.some((r) => r.status === 'warn');
  const next = failed ? `This cluster doesn't meet what AX needs. See the ${liveDoc('prerequisites', 'prerequisites')}.`
    : !c.substrate ? `Next: install Agent Substrate. <span class="mono">ax</span> can't do that on a remote cluster: follow the ${liveDoc('substrateInstall', 'operator install guide')} and ${liveDoc('substrateSetup', 'the settings AX needs')}, then check again.`
      : !subUp ? 'Agent Substrate is installed, but not all of it is ready yet.'
        : pools.ready === 0 ? `Next: create a gVisor WorkerPool. Tasks can't start without one. See the ${liveDoc('workerPool', 'WorkerPool guide')}.`
          : !c.ax ? 'Next: install AX.'
            : full(c.ax) ? 'AX is installed and ready. Connect to use it.' : 'AX is installed, but ax-server isn\'t ready yet.';
  /* One line says what the check found; the details fold away unless something needs a look. */
  const subReady = !!c.substrate && subUp && pools.ready > 0;
  const axReady = !!c.ax && full(c.ax);
  const worst = failed ? 'bad' : warned || !subReady || !axReady ? 'warn' : 'ok';
  const sum = `<span class="fs-${worst}">${icon(worst === 'bad' ? 'x' : worst === 'warn' ? 'alert' : 'check', 'xs')}${[
    failed ? `${plural(reqs.filter((r) => r.status === 'fail').length, 'requirement')} not met` : warned ? 'Requirements met, with a warning' : 'Meets what AX needs',
    !c.substrate ? 'no Agent Substrate' : subReady ? 'Agent Substrate ready' : 'Agent Substrate not ready',
    !c.ax ? 'AX not installed' : axReady ? 'AX ready' : 'AX not ready',
  ].join(' · ')}</span>`;
  const when = c.checked ? new Date(c.checked).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const body = `<div class="setup-panel"><ul class="check-list" aria-label="What a check of ${esc(liveShortCtx(name))} found">${rows.join('')}</ul></div>`;
  return `<div class="cl-check" id="live-cl-check-${esc(name)}">${liveFoldHTML(`live-fold-cl-${esc(name)}`, '', sum + (when ? ` <span class="fs-when">· Checked ${esc(when)}</span>` : ''), body, failed || warned)}
    <p class="small cl-next">${next}${c.checking ? ` <span class="muted">${icon('loader', 'xs spin')} Checking again…</span>` : ''}</p></div>`;
}
/** One remote cluster: its kubeconfig entry, Connect (Studio's own choice), a read-only Check, and Install, Upgrade or
    Uninstall AX there once the check says what's on it. */
function liveClusterCardHTML(c) {
  const inUse = c.name === LIVE.context;
  const op = LIVE.op;
  const mine = !!(op && (op.action === 'remote-install' || op.action === 'remote-uninstall') && op.target === c.name && LIVE.opDismissed !== op.id);
  const working = mine && op.status === 'running';
  const failed = mine && op.status === 'failed';
  const busy = liveOpRunning();
  const check = LIVE.clusterChecks[c.name];
  const checked = !!(check && check.requirements && !check.error);
  const hasAX = checked && !!check.ax;
  const short = liveShortCtx(c.name);
  const status = working ? `<span class="chip running">${icon('loader')}${esc(liveOpShort(op))} · <span data-fmt="elapsed" data-since="${op.started}">${liveDuration(Date.now() - op.started)}</span></span>`
    : inUse ? `<span class="chip done">${icon('check')}Connected</span>` : '';
  /* ax install needs a check that found Agent Substrate there, and an AX server image. */
  const clusterBlock = !checked ? 'Check the cluster first.' : !check.substrate ? 'Agent Substrate has to be installed on the cluster first.' : '';
  const blockers = clusterBlock ? [clusterBlock] : liveImageProblems();
  const why = failed ? (op.canceled ? 'Canceled. What it already did stays done.' : liveLastLine(op.logs.join('\n')) || op.error || 'It stopped without saying why.') : '';
  return `<div class="radio-card info cl-card${inUse ? ' is-on' : ''}" role="listitem" id="live-cl-${esc(c.name)}">
      <span class="rc-icon" aria-hidden="true">${icon('server')}</span>
      <div class="rc-main">
        <div class="cl-head"><span class="rc-title" title="${esc(c.name)}">${esc(short)}</span>${status}</div>
        ${short !== c.name ? `<span class="rc-desc mono cl-ctx">${esc(c.name)}</span>` : ''}
        <span class="rc-desc cl-cluster">${esc(c.cluster || 'No cluster name in the kubeconfig')}${c.current ? ' · Current in your kubeconfig' : ''}</span>
        ${liveClusterCheckHTML(c.name, check)}
        <div class="btn-row cl-actions">${working ? `
          <button type="button" class="btn sm" data-action="live-op-cancel" id="live-cl-cancel" aria-label="Cancel: ${esc(liveOpWords(op).doing)}">${icon('x', 'sm')}Cancel</button>
          ${op.step ? `<span class="op-step" title="${esc(op.step)}">${esc(op.step)}</span>` : ''}` : `
          ${inUse ? '' : `<button type="button" class="btn sm" data-action="live-use-context" data-context="${esc(c.name)}">${icon('link', 'sm')}Connect</button>`}
          <button type="button" class="btn ghost sm" data-action="live-cluster-check" data-context="${esc(c.name)}" ${check && check.checking ? 'disabled' : ''}>${icon('refresh', 'sm')}Check</button>
          <button type="button" class="btn ghost sm" data-action="live-install" data-context="${esc(c.name)}" data-needs-images data-blocked-other="${clusterBlock || LIVE.axError ? 1 : 0}" ${busy || blockers.length || LIVE.axError ? 'disabled' : ''}>${icon('wrench', 'sm')}${hasAX ? 'Upgrade AX…' : 'Install AX…'}</button>
          ${hasAX ? `<button type="button" class="btn ghost sm danger-text" data-action="live-uninstall" data-context="${esc(c.name)}" ${busy || LIVE.axError ? 'disabled' : ''}>${icon('trash', 'sm')}Uninstall AX…</button>` : ''}`}
        </div>
        ${!busy && checked ? (clusterBlock ? `<p class="xsmall muted cl-why">${hasAX ? 'Upgrade' : 'Install'} AX: ${esc(clusterBlock)}</p>`
          : `<p class="xsmall muted cl-why" data-why-images data-verb="${hasAX ? 'Upgrade' : 'Install'}" ${blockers.length ? '' : 'hidden'}>${hasAX ? 'Upgrade' : 'Install'} AX: ${esc(blockers.join(' '))}</p>`) : ''}
        ${failed ? `<div class="callout warn" role="alert" style="margin-top:10px">${icon('alert')}<div><strong>${esc(op.canceled ? `${liveOpWords(op).doing}: canceled` : liveOpWords(op).fail)}.</strong> <span style="overflow-wrap:anywhere">${esc(why)}</span>
          <div class="btn-row" style="margin-top:8px"><button type="button" class="btn ghost sm" data-action="live-op-dismiss">Dismiss</button></div></div></div>` : ''}
      </div>
    </div>`;
}
/** Looks at a cluster, read-only. The card shows what it found. */
async function liveCheckCluster(name) {
  if (!name) return;
  const prev = LIVE.clusterChecks[name];
  LIVE.clusterChecks[name] = Object.assign({}, prev, { checking: true });
  if (parseRoute().parts[0] === 'places') render({ keepScroll: true, background: true });
  try {
    LIVE.clusterChecks[name] = Object.assign(await studioApi.envCheck(name), { checking: false });
  } catch (e) {
    LIVE.clusterChecks[name] = { checking: false, error: e.message };
  }
  if (parseRoute().parts[0] === 'places') render({ keepScroll: true, background: true });
}
/* ---------- What runs on this computer: the layers `ax local start` builds, each with its state ---------- */
/** "ate-api-server (1/1 available)" is ready; "(0/1 available)" isn't. */
function liveAvailable(s) {
  const m = /(\d+)\s*\/\s*(\d+)\s+available/i.exec(s || '');
  return m ? +m[1] > 0 && +m[1] === +m[2] : /\bavailable\b/i.test(s || '') && !/unavailable/i.test(s || '');
}
/** How long each layer took (or has taken so far) in the setup that runs or ran last, from when each stage began. */
function liveStageTimes(op) {
  const at = (k) => (op.stageStarted || {})[k];
  const end = op.finished || Date.now();
  const keys = LIVE_SETUP_STEPS.map((s) => s.key);
  /* A stage ends when the next one that ran begins. */
  return keys.map((k, i) => {
    const start = at(k);
    if (start === undefined) return 0;
    const next = keys.slice(i + 1).map(at).find((t) => t !== undefined);
    return Math.max(0, (next !== undefined ? next : end) - start);
  });
}
function liveLayersHTML() {
  const L = LIVE.local || { state: 'NotFound' };
  const op = LIVE.op;
  const setupOp = op && op.action === 'local-up' && LIVE.opDismissed !== op.id ? op : null;
  const settingUp = !!(setupOp && setupOp.status === 'running');
  const at = setupOp ? Math.max(0, LIVE_SETUP_STEPS.findIndex((s) => s.key === setupOp.stage)) : -1;
  const times = setupOp ? liveStageTimes(setupOp) : [];
  const running = L.state === 'Running', stopped = L.state === 'Stopped';
  const real = (s) => (s && s !== 'N/A' ? s : '');
  const chip = (cls, ic, text) => `<span class="chip ${cls}">${icon(ic)}${text}</span>`;
  /* A cluster kubectl can't look into isn't one with nothing installed: say it's unknown, and why. */
  const unknown = running && L.access === 'no-context' ? `Unknown: the ${L.context || 'ax-local'} context isn't in your kubeconfig. Repair puts it back.`
    : running && L.access === 'unreachable' ? "Unknown: the cluster's API server isn't answering." : '';
  /* Each layer covers some of setup's steps (by index in LIVE_SETUP_STEPS). */
  const layers = [
    { ic: 'box', name: 'Kubernetes (Kind)', steps: [0, 0], tech: running || stopped ? `kind · ${L.name || 'ax-local'}${running && L.access === 'no-context' ? ' · its containers run, but your kubeconfig has no context for it' : ''}` : 'Not created yet', ready: running, live: '' },
    { ic: 'shield', name: 'Agent Substrate + gVisor workers', steps: [1, 2], tech: unknown || real(L.substrate) || 'Installed by setup', ready: running && liveAvailable(L.substrate), live: real(L.substrate) },
    { ic: 'server', name: 'AX control plane (ax-server + Postgres)', steps: [3, 3], tech: unknown || real(L.server) || 'Installed by setup', ready: running && liveAvailable(L.server), live: real(L.server) },
  ];
  return `<div class="layers" id="live-layers">${layers.map((l, i) => {
    let st;
    const ms = setupOp ? times.slice(l.steps[0], l.steps[1] + 1).reduce((a, b) => a + b, 0) : 0;
    if (setupOp && (settingUp || setupOp.status === 'failed' || setupOp.status === 'ok')) {
      const done = setupOp.status === 'ok' || at > l.steps[1];
      const now = !done && at >= l.steps[0];
      if (done) st = chip('done', 'checkCircle', ms > 0 ? `Ready · ${liveDuration(ms)}` : 'Already in place');
      else if (now && setupOp.status === 'failed') st = chip('failed', 'xCircle', setupOp.canceled ? 'Canceled' : 'Failed');
      else if (now) st = chip('running', 'loader', `Installing · <span data-fmt="elapsed" data-since="${(setupOp.stageStarted || {})[LIVE_SETUP_STEPS[Math.max(at, l.steps[0])].key] || setupOp.started}">${liveDuration(ms)}</span>`);
      else st = chip('paused', 'clock', setupOp.status === 'failed' ? 'Not reached' : 'Waiting');
    } else if (running && unknown && i > 0) st = chip('waiting', 'alert', 'Unknown');
    else if (running) st = l.ready ? chip('done', 'checkCircle', 'Running') : chip('waiting', 'clock', 'Starting');
    else if (stopped) st = chip('paused', 'pause', 'Stopped');
    else st = chip('paused', 'clock', 'Not set up');
    return `<div class="layer"><span class="l-ic" aria-hidden="true">${icon(l.ic)}</span><div class="l-text"><div class="l-name">${l.name}</div><div class="l-tech">${esc(l.tech)}</div></div>${st}</div>`;
  }).join('')}</div>`;
}
/** AX on this computer, as Where agents run shows it: the checks, the tools, the layers, and what you can do. */
function liveLocalPlaceHTML() {
  const L = LIVE.local;
  if (LIVE.envError && !L) return `<div class="health-line attn" style="margin-top:10px"><span class="hd"></span>Couldn't check</div><p class="small" style="margin-top:8px;overflow-wrap:anywhere">${esc(LIVE.envError)}</p><div class="btn-row" style="margin-top:10px"><button class="btn sm" data-action="live-env-refresh">${icon('refresh', 'sm')}Check again</button></div>`;
  if (!L) return '<p class="small muted" style="margin-top:10px">Checking…</p>';
  const busy = liveOpRunning();
  /* While AX is installed on another cluster, this computer's buttons stay where they are, turned off. */
  const localBusy = busy && liveOpIsLocal(LIVE.op);
  const off = busy ? 'disabled' : '';
  const running = L.state === 'Running', stopped = L.state === 'Stopped';
  const health = liveLocalHealth();
  const inUse = !!(L.context && L.context === LIVE.context);
  const noAx = LIVE.axError ? `<div class="callout warn" style="margin-top:12px">${icon('alert')}<div><strong>Studio couldn't run the <span class="mono">ax</span> command, and setup needs it.</strong> Install AX (see github.com/google/ax), then check again. <span class="muted" style="overflow-wrap:anywhere">${esc(LIVE.axError)}</span></div></div>` : '';
  /* `ax local start` sets up, starts, updates or repairs, depending on where AX on this computer is. */
  const upBtn = (verb, label, primary) => {
    const blockers = liveLocalBlockers(verb === 'setup');
    const other = verb === 'setup' ? (!LIVE.canStartLocal || !!LIVE.axError) : !!LIVE.axError;
    return `<button class="btn ${primary ? 'primary ' : ''}sm" data-action="live-setup-start" data-verb="${verb}" id="live-${verb === 'setup' ? 'setup-start' : `local-${verb}`}" data-needs-images data-blocked-other="${other ? 1 : 0}" ${blockers.length || busy ? 'disabled' : ''}>${icon(verb === 'repair' ? 'wrench' : verb === 'update' ? 'refresh' : 'play', 'sm')}${label}</button>`;
  };
  let actions = '', cli = 'ax local status', note = '';
  if (localBusy) {
    actions = '';
  } else if (running) {
    const connect = inUse ? '' : `<button type="button" class="btn sm" data-action="live-use-context" data-context="${esc(L.context)}">${icon('link', 'sm')}Connect</button>`;
    actions = health.ok
      ? `${connect}${upBtn('update', 'Update', false)}<button class="btn sm" data-action="live-local-stop" ${off}>${icon('pause', 'sm')}Stop</button><button class="btn ghost sm" data-action="live-local-delete" ${off}>${icon('trash', 'sm')}Remove…</button>`
      : `${upBtn('repair', 'Repair', true)}${connect}<button class="btn sm" data-action="live-local-stop" ${off}>${icon('pause', 'sm')}Stop</button><button class="btn ghost sm" data-action="live-local-delete" ${off}>${icon('trash', 'sm')}Remove…</button>`;
    note = health.ok ? 'Update runs <span class="mono">ax local start</span> again: it checks every layer and redeploys AX with the AX images above.'
      : 'Repair runs <span class="mono">ax local start</span>: it puts the context back in your kubeconfig if it\'s missing, checks every layer and installs what\'s missing.';
  } else if (stopped) {
    cli = 'ax local start';
    actions = `${upBtn('start', 'Start', true)}<button class="btn ghost sm" data-action="live-local-delete" ${off}>${icon('trash', 'sm')}Remove…</button>`;
    note = 'Start it again. Your tasks and their files are kept.';
  } else {
    cli = 'ax local start';
    actions = `${upBtn('setup', 'Set up AX on this computer', true)}`;
    note = !LIVE.canStartLocal ? 'Fix what the checks found, then check again.' : '';
  }
  const blockers = !localBusy ? liveLocalBlockers(!running && !stopped) : [];
  return `${liveOpHTML({ log: false, stones: false })}
    ${LIVE.checks.length ? liveFoldHTML('live-fold-checks', 'This computer', liveFoldSum(LIVE.checks), liveChecksHTML(), LIVE.checks.some((c) => c.status !== 'ok'))
      : '<div class="pl-sub">This computer</div><p class="small muted" style="margin-top:8px">Checking…</p>'}
    ${(LIVE.tools || []).length ? liveFoldHTML('live-fold-tools', 'Tools AX uses', liveToolsSum(), liveToolsHTML(), LIVE.tools.some((t) => t.status === 'fail' || t.status === 'warn'))
      : '<div class="pl-sub">Tools AX uses</div><p class="small muted" style="margin-top:8px">Looking for ax, kubectl and kind…</p>'}
    <div class="pl-sub">What runs here</div>
    ${liveLayersHTML()}
    ${noAx}
    ${!localBusy ? liveImagesHTML() : ''}
    ${actions ? `<div class="btn-row" style="margin-top:14px">${actions}</div>` : ''}
    ${blockers.length && actions ? `<div class="problem-lines">${liveImageProblemsHTML(blockers.filter((b) => !liveImageProblems().includes(b)))}</div>` : ''}
    ${note ? `<p class="small sub" style="margin-top:8px">${note}</p>` : ''}
    <p class="xsmall muted" style="margin-top:10px">${icon('terminal', 'xs')} <code>${cli}</code></p>`;
}
/** The state of AX on this computer, in the card's head. */
function liveLocalStateHTML() {
  const L = LIVE.local;
  if (!L) return '';
  const op = LIVE.op;
  if (liveOpRunning() && liveOpIsLocal(op)) {
    return `<span class="chip running" id="live-local-state">${icon('loader')}${esc(liveOpShort(op))} · <span data-fmt="elapsed" data-since="${op.started}">${liveDuration(Date.now() - op.started)}</span></span>`;
  }
  const h = liveLocalHealth();
  return `<div class="health-line${h.ok ? '' : ' attn'}" id="live-local-state"><span class="hd"></span>${esc(h.text)}</div>`;
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
  const L = LIVE.local;
  const localCtx = L && L.context ? LIVE.contexts.find((c) => c.name === L.context) : null;
  const ctxLine = L && L.context
    ? `Context <span class="mono">${esc(L.context)}</span>${localCtx && localCtx.current ? ' · Current in your kubeconfig' : ''}`
    : 'Nothing set up here yet';
  const remote = LIVE.contexts.filter((c) => !liveIsLocal(c.name));
  /* The cluster Studio is connected to is worth a look without being asked; the others wait for Check. */
  if (LIVE.context && !liveIsLocal(LIVE.context) && !LIVE.clusterChecks[LIVE.context] && remote.some((c) => c.name === LIVE.context)) setTimeout(() => liveCheckCluster(LIVE.context), 0);
  const html = `
    <div class="head-row places-head"><div><h1 tabindex="-1">Where agents run</h1>
      <p class="sub" style="margin-top:6px;font-size:14.5px;max-width:64ch">Run tasks on this computer or on a remote cluster. Connecting to a cluster here doesn't change your kubeconfig: Studio names the cluster on every request.</p></div>
      <div class="btn-row"><button type="button" class="btn sm" data-action="live-env-refresh" data-fresh="1" id="live-env-recheck" ${liveOpRunning() ? 'disabled' : ''}>${icon('refresh', 'sm')}Check again</button></div></div>
    ${liveAqueductHTML()}
    <div class="places-grid">
      <section class="card place-card" aria-labelledby="live-pl-local">
        <div class="place-top"><span class="p-icon" aria-hidden="true">${icon('laptop')}</span>
          <div class="pl-head"><h2 id="live-pl-local" class="h-display-sm">On this computer</h2><div class="pl-ctx">${ctxLine}</div></div>
          <div class="pl-state">${liveLocalStateHTML()}</div></div>
        ${liveLocalPlaceHTML()}
      </section>
      <section class="card place-card" aria-labelledby="live-pl-clusters">
        <div class="place-top"><span class="p-icon" aria-hidden="true">${icon('cloud')}</span>
          <div class="pl-head"><h2 id="live-pl-clusters" class="h-display-sm">Remote clusters</h2><div class="pl-ctx">${remote.length ? `${plural(remote.length, 'cluster')} from your kubeconfig` : 'From your kubeconfig'}</div></div></div>
        <p class="small sub" style="margin-top:12px;max-width:62ch">Skip local setup and run tasks on a shared GKE or Kubernetes cluster. Nothing is installed on this computer for that. Check a cluster to see whether it can run AX, then install AX on one that runs Agent Substrate.</p>
        ${liveClustersHTML()}
        <p class="xsmall muted" style="margin-top:12px">${icon('terminal', 'xs')} From your kubeconfig: <code>ax ctx</code></p>
      </section>
    </div>
    ${liveOutputHTML()}`;
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
    LIVE.outClear = null;
    announce(liveOpWords(LIVE.op).doing);
  } catch (e) {
    toast(`${failWords}: ${esc(e.message)}`, { icon: 'alert', timeout: 9000 });
  }
  render({ keepScroll: true });
}
/** Install or upgrade AX on a remote cluster (`ax install` there). It asks first: it changes a shared cluster. */
function liveOpenInstall(context) {
  if (!context || liveOpRunning()) return;
  const env = LIVE.env || {};
  const ns = (STUDIO.info && STUDIO.info.axNamespace) || 'ax-system';
  const check = LIVE.clusterChecks[context];
  const upgrade = !!(check && check.ax);
  const verb = upgrade ? 'Upgrade' : 'Install';
  const p = { error: '' };
  const runner = !!(LIVE.axFlags && LIVE.axFlags.runnerVolumeImage);
  const cmd = () => ['ax', '--context', context].concat(ns !== 'ax-system' ? ['-n', ns] : [], ['install'],
    LIVE.images.serverImage.trim() ? ['--server-image', LIVE.images.serverImage.trim()] : [],
    runner && LIVE.images.runnerVolumeImage.trim() ? ['--runner-volume-image', LIVE.images.runnerVolumeImage.trim()] : []).join(' ');
  const own = (fromEnv, name, fallback) => (fromEnv ? `${fromEnv} (from ${name})` : fallback);
  const dlg = openDialog(dialogShell('li', `${verb} AX on ${esc(liveShortCtx(context))}?`, '', '<div id="li-body"></div>',
    `<span class="left"></span><button class="btn ghost" data-action="close-dialog">Cancel</button><button class="btn primary" id="li-go">${icon('wrench', 'sm')}${verb} AX</button>`, false, 'wrench'));
  const field = (key, label, hint) => `<label class="small" style="display:grid;gap:4px;margin-top:8px">${label}
      <input class="input mono" type="text" data-li="${key}" value="${esc(LIVE.images[key])}" placeholder="${esc(hint)}" autocomplete="off" spellcheck="false"></label>`;
  const paint = () => {
    const body = $('#li-body', dlg);
    if (!body) return;
    body.innerHTML = `
      <p class="small">${upgrade ? `This redeploys <span class="mono">ax-server</span> and its Postgres database in the <span class="mono">${esc(ns)}</span> namespace of <span class="mono">${esc(context)}</span> with the images below.`
        : `This creates the <span class="mono">${esc(ns)}</span> namespace on <span class="mono">${esc(context)}</span>, deploys AX (<span class="mono">ax-server</span> and its Postgres database) and registers <span class="mono">ax-server</span> with Agent Substrate.`}</p>
      ${upgrade ? '' : '<div class="callout warn" style="margin-top:10px">' + icon('alert') + '<div>The first time, registering restarts Agent Substrate\'s API server and router, which everyone on the cluster shares.</div></div>'}
      <p class="small" style="margin-top:8px">The cluster must already run Agent Substrate. Nothing is installed on this computer, and your kubeconfig stays as it is.</p>
      ${field('serverImage', `AX server image${env.serverImageEnv ? '' : ' (required)'}`, own(env.serverImageEnv, 'AX_SERVER_IMAGE', 'registry.example.com/ax/ax-server@sha256:…'))}
      ${runner ? field('runnerVolumeImage', 'Runner volume image (optional)', "Leave empty to run the runner in each task's image") : ''}
      <div class="live-cli-wrap" id="li-cli" style="margin-top:12px">${cliHint(cmd())}</div>
      <p class="xsmall muted" style="margin-top:8px">The output shows in the Output panel on Where agents run as it arrives.</p>
      <div id="li-err">${p.error ? `<div class="callout warn" role="alert" style="margin-top:12px">${icon('alert')}<div style="overflow-wrap:anywhere">${esc(p.error)}</div></div>` : ''}</div>`;
  };
  dlg.addEventListener('input', (e) => {
    const k = e.target && e.target.dataset && e.target.dataset.li;
    if (!k) return;
    /* The same images as on Where agents run: what you type here is kept for next time. */
    LIVE.images[k] = e.target.value;
    liveSaveImages();
    const c = $('#li-cli', dlg);
    if (c) c.innerHTML = cliHint(cmd());
    /* What you type answers the problem, so the message goes. */
    if (p.error) { p.error = ''; const er = $('#li-err', dlg); if (er) er.innerHTML = ''; }
  });
  $('#li-go', dlg).addEventListener('click', () => {
    const problems = liveImageProblems();
    if (problems.length) {
      p.error = problems.join(' ');
      paint();
      return;
    }
    closeDialog(true);
    if (parseRoute().parts[0] !== 'places') location.hash = '#/places';
    liveStartOp(() => studioApi.remoteInstall(context, liveImagesToSend()), `Couldn't ${verb.toLowerCase()} AX on ${esc(liveShortCtx(context))}`);
  });
  paint();
}
/** Removes AX from a remote cluster (`ax uninstall` there). It asks first: everyone on the cluster loses AX. */
function liveOpenUninstall(context) {
  if (!context || liveOpRunning()) return;
  const ns = (STUDIO.info && STUDIO.info.axNamespace) || 'ax-system';
  const dlg = openDialog(dialogShell('lu', `Uninstall AX from ${esc(liveShortCtx(context))}?`, '', `
    <p class="small">This removes <span class="mono">ax-server</span> and its Postgres database from <span class="mono">${esc(ns)}</span> on <span class="mono">${esc(context)}</span>, so nobody can use AX on this cluster until it's installed again. It also takes <span class="mono">ax-server</span> off Agent Substrate's allowlists, which restarts Substrate's API server and router.</p>
    <ul class="check-list" style="margin-top:10px">
      <li class="check-item no"><span class="ci-icon">${icon('trash')}</span><div><div class="ci-title">Removed</div><div class="ci-desc">AX's server and database pods, and its permissions in Agent Substrate</div></div></li>
      <li class="check-item ok"><span class="ci-icon">${icon('check')}</span><div><div class="ci-title">Kept</div><div class="ci-desc">The database's volume, Agent Substrate itself, and your kubeconfig</div></div></li>
    </ul>
    <div style="margin-top:14px">${cliHint(`ax --context ${context} uninstall`)}</div>`,
  `<span class="left"></span><button class="btn ghost" data-action="close-dialog">Cancel</button><button class="btn danger" id="lu-go">${icon('trash', 'sm')}Uninstall AX</button>`, false, 'trash'));
  $('#lu-go', dlg).addEventListener('click', () => {
    closeDialog(true);
    if (parseRoute().parts[0] !== 'places') location.hash = '#/places';
    liveStartOp(() => studioApi.remoteUninstall(context), `Couldn't uninstall AX from ${esc(liveShortCtx(context))}`);
  });
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
  /* Set up, Start, Update and Repair all run `ax local start`; the button says which, for the words while it runs. */
  'live-setup-start': (el) => {
    const verb = (el && el.dataset.verb) || 'setup';
    const blockers = liveLocalBlockers(verb === 'setup');
    if (blockers.length) {
      LIVE.imagesOpen = true;
      toast(esc(blockers[0]), { icon: 'alert', timeout: 7000 });
      render({ keepScroll: true });
      return;
    }
    LIVE.localVerb = verb;
    liveStartOp(() => studioApi.localUp(liveImagesToSend(), verb), `Couldn't ${verb === 'setup' ? 'start setup' : verb + ' AX on this computer'}`);
  },
  'live-local-stop': () => liveOpenStopLocal(),
  'live-local-delete': () => liveOpenRemoveLocal(),
  /* Check again looks at everything again: this computer, the tools (with fresh=1), and the clusters already checked. */
  'live-env-refresh': async (el) => {
    const btn = el && el.id ? el : null;
    if (btn) btn.disabled = true;
    await liveLoadEnv(!!(el && el.dataset.fresh === '1'));
    LIVE.failedAt = 0;
    Object.keys(LIVE.clusterChecks).forEach((name) => { if (LIVE.contexts.some((c) => c.name === name)) liveCheckCluster(name); else delete LIVE.clusterChecks[name]; });
    await liveRefresh(true);
    render({ keepScroll: true });
    announce('Checked again');
  },
  'live-install': (el) => liveOpenInstall(el.dataset.context),
  'live-uninstall': (el) => liveOpenUninstall(el.dataset.context),
  'live-cluster-check': (el) => liveCheckCluster(el.dataset.context),
  /* Cancel stops the command the server runs. What it already did stays done. */
  'live-op-cancel': async (el) => {
    if (!liveOpRunning()) return;
    if (el) el.disabled = true;
    try {
      await studioApi.envCancel();
      announce('Canceling');
    } catch (e) {
      if (el) el.disabled = false;
      toast(`Couldn't cancel: ${esc(e.message)}`, { icon: 'alert', timeout: 9000 });
    }
  },
  'live-op-dismiss': () => { if (LIVE.op) LIVE.opDismissed = LIVE.op.id; render({ keepScroll: true }); },
  'live-output-clear': () => {
    const op = LIVE.op;
    if (!op) return;
    LIVE.outClear = { id: op.id, n: op.logs.length };
    liveOpPaint();
    announce('Output cleared');
  },
};
if (LIVE.on) {
  /* Keep what you type (in this browser too), and whether the section is open, while the page redraws. What the images
     decide (the problems and the buttons they turn off) follows as you type, without moving the cursor. */
  document.addEventListener('input', (e) => {
    const k = e.target && e.target.dataset && e.target.dataset.liveImage;
    if (!k) return;
    LIVE.images[k] = e.target.value;
    liveSaveImages();
    liveRefreshImageProblems();
    if (k === 'serverImage' && !(LIVE.env || {}).serverImageEnv) e.target.setAttribute('aria-invalid', String(!e.target.value.trim()));
  });
  document.addEventListener('toggle', (e) => {
    const t = e.target;
    if (!t || !t.id) return;
    if (t.id === 'live-images') LIVE.imagesOpen = t.open;
    else if (t.classList && (t.classList.contains('pl-fold') || t.classList.contains('cl-guide'))) LIVE.folds[t.id] = t.open;
  }, true);
}
