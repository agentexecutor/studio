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

/* AX Studio, live mode: AX on this computer.

   Setting up AX on this computer, and the Local cluster page. Everything here comes from the Studio server (see api.js
   and live.js):
   - what AX on this computer needs, checked for real: the operating system, a running container runtime, free disk
   - the tools AX uses (ax, kubectl, kind), with their versions and where they are
   - how AX on this computer is doing (running, not in your kubeconfig, not answering, starting or degraded, stopped,
     not set up), and the state of each layer it runs (Kubernetes in Kind, Agent Substrate with its sandbox workers, and
     AX's own control plane), with how long each took while setup runs
   - setup, start, update and repair: the server runs `ax local start` and sends its output as it arrives; Cancel stops it
   - the AX images those deploy: Studio's own unless you choose others, kept in this browser
   - the output of whichever of these ran last, in one Output panel at the bottom of the page */

/* What setup builds, in the order `ax local start` builds it. `key` is the stage the server reports. */
const LIVE_SETUP_STEPS = [
  { key: 'kind', title: 'Creating the Kubernetes cluster', short: 'Kubernetes', desc: 'A small cluster (Kind) inside your container runtime', ic: 'box' },
  { key: 'substrate', title: 'Installing Agent Substrate', short: 'Agent Substrate', desc: 'It runs each task in its own sandbox', ic: 'shield' },
  { key: 'workers', title: 'Starting the sandbox workers', short: 'Workers', desc: 'Where the sandboxes run', ic: 'cpu' },
  { key: 'ax', title: 'Starting the AX server', short: 'AX server', desc: 'It keeps your tasks', ic: 'server' },
];
/* The checks the server runs, in plain words. Its own label is the fallback for a check this file doesn't know. */
const LIVE_CHECK_TITLES = {
  os_arch: 'Operating system and processor',
  container_engine: 'A container runtime that is running',
  disk_space: 'Free disk space',
};
/* What each button for AX on this computer does, shown when you point at it. */
const LIVE_LOCAL_TIPS = {
  setup: 'Creates a local cluster on this computer and installs Agent Substrate and AX on it (ax local start).',
  start: 'Starts the local cluster again (ax local start). Your tasks and their files are kept.',
  update: 'Runs ax local start again: checks every layer and redeploys AX with the AX images above. Your tasks are kept.',
  repair: "Runs ax local start: puts the context back in your kubeconfig if it's missing and installs what's missing.",
  stop: 'Stops the local cluster (ax local stop). Your tasks and their files are kept. Asks first when tasks are running.',
  remove: "Deletes the local cluster and every task on it (ax local delete). Asks first. It can't be undone.",
};
const LIVE_OP_WORDS = {
  'local-up': { doing: 'Setting up AX on this computer', done: 'AX is running on this computer', fail: 'Setup stopped' },
  'local-stop': { doing: 'Stopping AX on this computer', done: 'AX on this computer is stopped', fail: "Couldn't stop AX on this computer" },
  'local-delete': { doing: 'Removing AX from this computer', done: 'AX is removed from this computer', fail: "Couldn't remove AX from this computer" },
};
const LIVE_OP_SHORT = { 'local-up': 'Setting up', 'local-stop': 'Stopping', 'local-delete': 'Removing' };
/** Setup, start, update, stop and remove: what runs on this computer. */
function liveOpIsLocal(op) { return !!op && /^local-/.test(op.action || ''); }
/** An operation in a word or two, for a chip: a setup run says what it was for. */
function liveOpShort(op) {
  if (op && op.action === 'local-up') return { start: 'Starting', update: 'Updating', repair: 'Repairing' }[op.purpose || LIVE.localVerb] || 'Setting up';
  return LIVE_OP_SHORT[op && op.action] || 'Working';
}
const LIVE_LOG_LINES = 400;
/** What an operation is doing, did, or why it stopped, in the UI's words. */
function liveOpWords(op) {
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
  return { 'local-up': 'ax local start', 'local-stop': 'ax local stop', 'local-delete': 'ax local delete' }[op.action] || '';
}
/* What you typed under "AX images", kept in this browser (they are image names, not secrets). Empty fields use the
   images the server names in setupImages: Studio's own, pinned to the AX its go.mod uses, or AX_SERVER_IMAGE and
   AX_RUNNER_VOLUME_IMAGE from Studio's environment. */
const LIVE_IMAGES_KEY = 'ax.live.images';
LIVE.images = (() => {
  const empty = { serverImage: '', runnerVolumeImage: '' };
  /* AX dropped its default task image (rc.2): a value kept from before is left behind. */
  try { const kept = JSON.parse(localStorage.getItem(LIVE_IMAGES_KEY) || '{}'); return { serverImage: String(kept.serverImage || ''), runnerVolumeImage: String(kept.runnerVolumeImage || '') }; } catch (e) { return empty; }
})();
LIVE.imagesOpen = false;
function liveSaveImages() { try { localStorage.setItem(LIVE_IMAGES_KEY, JSON.stringify(LIVE.images)); } catch (e) { /* ignore */ } }
/** The images setup uses when you leave the fields empty: { serverImage, runnerVolumeImage, ... } from the server. */
function liveSetupImages() { return (LIVE.env && LIVE.env.setupImages) || {}; }
/** What's wrong with the images you typed. Empty is fine: setup uses Studio's. */
function liveImageProblems() {
  const env = LIVE.env || {};
  const im = LIVE.images;
  const out = [];
  /* An older Studio server names no images of its own; then ax needs one. */
  if (!im.serverImage.trim() && !env.serverImageEnv && !liveSetupImages().serverImage) out.push('Give the AX server image: AX has none of its own yet.');
  [['The AX server image', im.serverImage], ['The runner volume image', LIVE.axFlags && LIVE.axFlags.runnerVolumeImage ? im.runnerVolumeImage : '']].forEach(([label, raw]) => {
    const v = String(raw || '').trim();
    if (v && (v.startsWith('-') || /\s/.test(v))) out.push(`${label} isn't an image name.`);
    else if (v.includes('sha256:') && !/@sha256:[0-9a-f]{64}$/.test(v)) out.push(`${label} must give its digest as name@sha256: and 64 characters.`);
  });
  return out;
}
/** The images to send with setup: the ones typed here. For the rest the server uses its own (setupImages). */
function liveImagesToSend() {
  const out = {};
  ['serverImage'].concat(LIVE.axFlags && LIVE.axFlags.runnerVolumeImage ? ['runnerVolumeImage'] : []).forEach((k) => {
    const v = String(LIVE.images[k] || '').trim();
    if (v) out[k] = v;
  });
  return out;
}
/** "42s" or "3m 07s", as the app's clock counts elapsed time (its 1-second tick updates [data-since] in place). */
function liveDuration(ms) { return fmtElapsed(Date.now() - Math.max(0, ms)); }
/* Clear in the Output panel hides the lines that were there: { id: operation, n: lines hidden }. */
LIVE.outClear = null;
let liveOpPaintTimer = 0;
/* The operation and stage the layers were last drawn for by liveOpPaint. */
let liveLayersStage = '';

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
    /* The command's exit status when it failed. */
    exitCode: op.exitCode || 0,
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
  const words = liveOpWords(op);
  await liveLoadEnv();
  render({ keepScroll: true });
  if (op.status === 'ok') {
    toast(esc(words.done), { icon: 'check' });
    announce(words.done);
  } else if (op.canceled) {
    announce(`${words.doing}: canceled`);
    /* Local cluster says so where the command ran; elsewhere a toast does. */
    if (parseRoute().parts[0] !== 'places') toast(`${esc(words.doing)}: canceled. What it already did stays done.`, { icon: 'alert', timeout: 9000 });
  } else {
    announce(words.fail);
  }
  /* While you're in another tab, a notification says it finished (if you turned them on). */
  if (typeof liveNotify === 'function' && !op.canceled) liveNotify(op.status === 'ok' ? words.done : words.fail, op.status === 'ok' ? 'AX Studio' : (op.error || 'See Local cluster'), '#/places', `ax-op-${op.id}`);
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
  /* Only Local cluster has the Output panel, and it lists the layers, so it needs neither here. */
  if (box) box.innerHTML = liveOpInnerHTML({ log: !out, stones: !out });
  if (out) out.innerHTML = liveOutputInnerHTML();
  /* The layers show which stage setup is at: redraw them when it moves on (not on every line, so the spinner keeps
     turning). */
  const layers = $('#live-layers');
  const stage = LIVE.op ? `${LIVE.op.id}:${LIVE.op.stage}` : '';
  if (layers && stage !== liveLayersStage) layers.outerHTML = liveLayersHTML();
  liveLayersStage = stage;
  const log2 = $('#live-op-log');
  if (log2) log2.scrollTop = stuck ? log2.scrollHeight : at;
}
/** Turns raw setup error lines into a short, helpful headline when we recognize what went wrong. */
function liveSetupErrorAdvice(why, stage) {
  const s = String(why || '');
  if (/403|401|unauthorized|denied|forbidden/i.test(s)) return { title: "Couldn't pull a container image", hint: 'The registry rejected the image pull. Check your image name under AX images or sign in to the registry, then try again.' };
  if (/pull|manifest|not found.*image|image.*not found|ErrImagePull|ImagePullBackOff/i.test(s)) return { title: "Couldn't download a required image", hint: 'Check your network connection and the image addresses under AX images, then try again.' };
  if (/docker|podman|orbstack|container runtime|cannot connect to the docker daemon/i.test(s)) return { title: "Couldn't reach your container runtime", hint: 'Make sure Docker, OrbStack, or Podman is running on this computer, then click Check again.' };
  if (/no space left|disk/i.test(s)) return { title: 'Not enough free disk space', hint: 'Free up disk space on this computer and run setup again.' };
  if (/timeout|timed out|deadline exceeded/i.test(s)) return { title: 'Setup timed out waiting for AX to become ready', hint: 'What already finished is kept. Try setup again to pick up from where it stopped.' };
  const step = LIVE_SETUP_STEPS.find((x) => x.key === stage);
  return { title: step ? `Setup stopped during ${step.short}` : 'Setup stopped', hint: 'What already finished is kept. Review the output below and try again.' };
}
/** Setup's progress, or why an operation stopped. With { log: false } the output is left to the Output panel. */
function liveOpInnerHTML(opts) {
  const op = LIVE.op;
  if (!op) return '';
  const withLog = !opts || opts.log !== false;
  /* Local cluster lists the layers with their progress, so the stones are only for the setup page. */
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
  const adv = why ? liveSetupErrorAdvice(why, op.stage) : null;
  return `${head}
    ${op.canceled ? '<div class="setup-alert info" role="status" style="margin-top:12px">' + icon('alert') + '<div><strong>Setup was canceled.</strong><p class="small">What it already set up is kept. Running setup again picks up from there.</p></div></div>' : ''}
    ${why ? `<div class="setup-alert warn" role="alert" style="margin-top:14px">${icon('alert')}<div class="sa-body"><strong>${esc(adv.title)}</strong><p class="small">${esc(adv.hint)}</p><p class="xsmall mono sa-detail">${esc(words.fail + '.')} ${esc(why)}</p></div></div>` : ''}
    ${withLog && lines.length ? `<div class="setup-out-wrap"><div class="live-title" style="margin-top:14px">Output</div>
      <pre class="manifest" id="live-op-log" style="margin-top:8px;max-height:260px;overflow:auto" tabindex="0" aria-label="Output">${esc(lines.join('\n'))}</pre></div>` : ''}`;
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
    : 'Set up, start, update, stop or remove AX on this computer to see its output here as it arrives.';
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
  const open = LIVE.folds[id] !== undefined ? LIVE.folds[id] : !!attention;
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
/** The images in a word, next to their heading: Needed, or the AX server image setup uses. */
function liveImagesSummaryHTML(problems) {
  const custom = !!LIVE.images.serverImage.trim() || !!LIVE.images.runnerVolumeImage.trim();
  const using = LIVE.images.serverImage.trim() || (LIVE.env || {}).serverImageEnv || liveSetupImages().serverImage || '';
  if (problems.length) return '<span class="chip waiting">Needed</span>';
  const tag = custom ? '<span class="acc-pill custom">Custom</span>' : '<span class="acc-pill">Studio default</span>';
  return using ? `${tag}<span class="acc-meta mono">${esc(typeof liveImageShort === 'function' ? liveImageShort(using) : using)}</span>` : '';
}
function liveImagesHTML() {
  const env = LIVE.env || {};
  const problems = liveImageProblems();
  const def = liveSetupImages();
  const open = LIVE.imagesOpen !== undefined ? LIVE.imagesOpen : problems.length > 0;
  const field = (key, label, hint, required, note) => `<label class="small img-field"><span>${label}${required ? ' <span class="muted">· required</span>' : ''}</span>
      <input class="input mono" type="text" data-live-image="${key}" value="${esc(LIVE.images[key] || '')}" placeholder="${esc(hint)}" autocomplete="off" spellcheck="false" ${required && !String(LIVE.images[key] || '').trim() ? 'aria-invalid="true"' : ''}>${note ? `<span class="xsmall muted">${note}</span>` : ''}</label>`;
  /* Where the image setup uses comes from when the field is empty: Studio's environment, or Studio itself. */
  const from = (img, where) => (!img ? '' : where === 'env' ? 'Empty uses the image from Studio\'s environment.' : 'Empty uses the image Studio pins for the AX it was built with.');
  const short = (img) => (typeof liveImageShort === 'function' ? liveImageShort(img) : img);
  return `<details class="setup-acc" id="live-images" ${open ? 'open' : ''}>
    <summary class="setup-acc-head">
      <span class="acc-ic" aria-hidden="true">${icon('layers', 'sm')}</span>
      <span class="acc-copy"><span class="acc-title">AX images</span><span class="acc-sub" id="live-images-sum">${liveImagesSummaryHTML(problems)}</span></span>
      ${icon('chevRight', 'sm acc-chev')}
    </summary>
    <div class="setup-acc-body"><p class="small sub">Setting up, updating or repairing AX here deploys these. Leave them empty to use the defaults shown. Custom values are saved in this browser.</p>
      ${field('serverImage', 'AX server image', def.serverImage ? short(def.serverImage) : env.serverImageEnv || 'registry.example.com/ax/ax-server@sha256:…', !def.serverImage && !env.serverImageEnv, from(def.serverImage, def.serverImageFrom))}
      ${LIVE.axFlags && LIVE.axFlags.runnerVolumeImage ? field('runnerVolumeImage', 'Runner volume image', def.runnerVolumeImage ? short(def.runnerVolumeImage) : "Optional. Leave empty to run the runner in each task's image", false, def.runnerVolumeImage ? `AX's task runner, mounted into every task, for images that don't ship one (like agy-cli). ${from(def.runnerVolumeImage, def.runnerVolumeImageFrom)}` : '') : ''}
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
  if (LIVE.envError && !L) {
    return `<div class="setup-alert warn" role="alert">${icon('alert')}<div class="sa-body"><strong>Couldn't check this computer</strong><p class="small">Studio couldn't inspect your local environment. Check that the server is running and try again.</p><p class="xsmall mono sa-detail">${esc(LIVE.envError)}</p></div></div>
      <div class="btn-row setup-actions"><button type="button" class="btn" data-action="live-env-refresh">${icon('refresh', 'sm')}Check again</button></div>`;
  }
  if (!L) return '<p class="small muted" style="margin-top:8px">Checking…</p>';
  const busy = liveOpRunning();
  const running = L.state === 'Running', stopped = L.state === 'Stopped';
  const failedOp = !busy && LIVE.op && LIVE.op.action === 'local-up' && LIVE.op.status === 'failed' && LIVE.opDismissed !== LIVE.op.id;
  const line = busy || (!running && !stopped) ? ''
    : running ? `<div class="health-line" style="margin-bottom:12px" id="live-local-state"><span class="hd"></span>Running</div>`
      : `<div class="health-line attn" style="margin-bottom:12px" id="live-local-state"><span class="hd"></span>Stopped</div>`;
  const noAx = LIVE.axError ? `<div class="setup-alert warn" role="alert" style="margin-top:14px">${icon('alert')}<div class="sa-body"><strong>Studio couldn't find the <span class="mono">ax</span> command</strong><p class="small">Install AX (see github.com/google/ax) so it is on your PATH, then click Check again.</p><p class="xsmall mono sa-detail">${esc(LIVE.axError)}</p></div></div>` : '';
  let body;
  if (busy) {
    body = '';
  } else if (running) {
    body = `<div style="margin-top:12px">${liveKV([['Cluster', esc(L.name)], ['Kube context', `<span class="mono">${esc(L.context)}</span>`], ['Agent Substrate', esc(L.substrate)], ['AX server', esc(L.server)]])}</div>
      <div class="btn-row setup-actions"><button type="button" class="btn" data-action="live-local-stop" title="${esc(LIVE_LOCAL_TIPS.stop)}">${icon('pause', 'sm')}Stop</button><button type="button" class="btn ghost" data-action="live-local-delete" title="${esc(LIVE_LOCAL_TIPS.remove)}">${icon('trash', 'sm')}Remove…</button></div>
      <p class="xsmall muted setup-cli">${icon('terminal', 'xs')} <code>ax local status</code></p>`;
  } else if (stopped) {
    const blockers = liveLocalBlockers(false);
    body = `<p class="small sub">Your tasks and their files are kept. Start AX again to pick up where you left off.</p>${noAx}
      <div class="setup-accs">${liveImagesHTML()}</div>
      <div class="btn-row setup-actions"><button type="button" class="btn primary" data-action="live-setup-start" data-verb="start" title="${esc(LIVE_LOCAL_TIPS.start)}" id="live-setup-start" data-needs-images data-blocked-other="${LIVE.axError ? 1 : 0}" ${blockers.length ? 'disabled' : ''}>${icon('play', 'sm')}Start</button><button type="button" class="btn" data-action="live-env-refresh">${icon('refresh', 'sm')}Check again</button><button type="button" class="btn ghost" data-action="live-local-delete" title="${esc(LIVE_LOCAL_TIPS.remove)}">${icon('trash', 'sm')}Remove…</button></div>
      <p class="xsmall muted setup-cli">${icon('terminal', 'xs')} <code>ax local start</code></p>`;
  } else {
    const blockers = liveLocalBlockers(true);
    const otherBlock = !LIVE.canStartLocal || !!LIVE.axError;
    const failedChecks = LIVE.checks.filter((c) => c.status === 'fail');
    const blockerBanner = !LIVE.axError && failedChecks.length ? `<div class="setup-alert warn" role="alert" style="margin-top:14px">${icon('alert')}<div class="sa-body"><strong>${failedChecks.length === 1 ? 'One requirement needs attention before setup' : `${failedChecks.length} requirements need attention before setup`}</strong><p class="small">Resolve the blocked check${failedChecks.length === 1 ? '' : 's'} above, then click Check again.</p></div></div>` : '';
    const whatsOpen = !!LIVE.folds['live-setup-whats-in'];
    const stepIcons = ['box', 'shield', 'layers', 'server'];
    const whatsIn = `<details class="setup-acc" id="live-setup-whats-in" ${whatsOpen ? 'open' : ''}>
      <summary class="setup-acc-head">
        <span class="acc-ic" aria-hidden="true">${icon('box', 'sm')}</span>
        <span class="acc-copy"><span class="acc-title">What gets installed?</span><span class="acc-sub"><span class="acc-pill">4 components</span><span class="acc-meta">Kind, Agent Substrate, Workers, AX server</span></span></span>
        ${icon('chevRight', 'sm acc-chev')}
      </summary>
      <div class="setup-acc-body">
        <div class="setup-stack-grid">${LIVE_SETUP_STEPS.map((s, i) => `<div class="setup-stack-item"><span class="ssi-ic" aria-hidden="true">${icon(stepIcons[i] || 'box', 'sm')}</span><div><div class="ssi-name">${esc(s.short)}</div><div class="ssi-desc">${esc(s.desc)}</div></div></div>`).join('')}</div>
        <p class="xsmall muted" style="margin-top:10px">Runs inside your container runtime without asking for your password. May download <span class="mono">kind</span> and <span class="mono">kubectl</span> into <span class="mono">~/.ax/bin</span> and adds context <span class="mono">ax-local</span> to your kubeconfig.</p>
      </div></details>`;
    const primaryLabel = failedOp ? `${icon('refresh', 'sm')}Try setup again` : `Set up AX on this computer${icon('arrowRight', 'sm')}`;
    body = `<div class="setup-sec-head"><div class="setup-sec-label">System checks</div><button type="button" class="btn sm" data-action="live-env-refresh">${icon('refresh', 'sm')}Check again</button></div>
      ${liveChecksHTML()}${noAx}${blockerBanner}
      <div class="setup-accs">${whatsIn}${liveImagesHTML()}</div>
      <div class="setup-foot">
        <div class="btn-row setup-actions">
          <button type="button" class="btn primary" data-action="live-setup-start" data-verb="setup" title="${esc(LIVE_LOCAL_TIPS.setup)}" id="live-setup-start" data-needs-images data-blocked-other="${otherBlock ? 1 : 0}" ${blockers.length ? 'disabled' : ''}>${primaryLabel}</button>
        </div>
        <p class="xsmall muted setup-cli">${icon('terminal', 'xs')} Command line: <code>ax local start</code></p>
      </div>`;
  }
  return line + liveOpHTML() + body;
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
    { ic: 'shield', name: 'Agent Substrate + sandbox workers', steps: [1, 2], tech: unknown || real(L.substrate) || 'Installed by setup', ready: running && liveAvailable(L.substrate), live: real(L.substrate) },
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
/** AX on this computer, as Local cluster shows it: the checks, the tools, the layers, and what you can do. */
function liveLocalPlaceHTML() {
  const L = LIVE.local;
  if (LIVE.envError && !L) return `<div class="health-line attn" style="margin-top:10px"><span class="hd"></span>Couldn't check</div><p class="small" style="margin-top:8px;overflow-wrap:anywhere">${esc(LIVE.envError)}</p><div class="btn-row" style="margin-top:10px"><button class="btn sm" data-action="live-env-refresh">${icon('refresh', 'sm')}Check again</button></div>`;
  if (!L) return '<p class="small muted" style="margin-top:10px">Checking…</p>';
  const busy = liveOpRunning();
  const localBusy = busy && liveOpIsLocal(LIVE.op);
  const off = busy ? 'disabled' : '';
  const running = L.state === 'Running', stopped = L.state === 'Stopped';
  const health = liveLocalHealth();
  const noAx = LIVE.axError ? `<div class="callout warn" style="margin-top:12px">${icon('alert')}<div><strong>Studio couldn't run the <span class="mono">ax</span> command, and setup needs it.</strong> Install AX (see github.com/google/ax), then check again. <span class="muted" style="overflow-wrap:anywhere">${esc(LIVE.axError)}</span></div></div>` : '';
  /* `ax local start` sets up, starts, updates or repairs, depending on where AX on this computer is. */
  const upBtn = (verb, label, primary) => {
    const blockers = liveLocalBlockers(verb === 'setup');
    const other = verb === 'setup' ? (!LIVE.canStartLocal || !!LIVE.axError) : !!LIVE.axError;
    return `<button class="btn ${primary ? 'primary ' : ''}sm" data-action="live-setup-start" data-verb="${verb}" title="${esc(LIVE_LOCAL_TIPS[verb])}" id="live-${verb === 'setup' ? 'setup-start' : `local-${verb}`}" data-needs-images data-blocked-other="${other ? 1 : 0}" ${blockers.length || busy ? 'disabled' : ''}>${icon(verb === 'repair' ? 'wrench' : verb === 'update' ? 'refresh' : 'play', 'sm')}${label}</button>`;
  };
  let actions = '', cli = 'ax local status', note = '';
  if (localBusy) {
    actions = '';
  } else if (running) {
    actions = health.ok
      ? `${upBtn('update', 'Update', false)}<button class="btn sm" data-action="live-local-stop" title="${esc(LIVE_LOCAL_TIPS.stop)}" ${off}>${icon('pause', 'sm')}Stop</button><button class="btn ghost sm" data-action="live-local-delete" title="${esc(LIVE_LOCAL_TIPS.remove)}" ${off}>${icon('trash', 'sm')}Remove…</button>`
      : `${upBtn('repair', 'Repair', true)}<button class="btn sm" data-action="live-local-stop" title="${esc(LIVE_LOCAL_TIPS.stop)}" ${off}>${icon('pause', 'sm')}Stop</button><button class="btn ghost sm" data-action="live-local-delete" title="${esc(LIVE_LOCAL_TIPS.remove)}" ${off}>${icon('trash', 'sm')}Remove…</button>`;
    note = health.ok ? 'Update runs <span class="mono">ax local start</span> again: it checks every layer and redeploys AX with the AX images above.'
      : 'Repair runs <span class="mono">ax local start</span>: it puts the context back in your kubeconfig if it\'s missing, checks every layer and installs what\'s missing.';
  } else if (stopped) {
    cli = 'ax local start';
    actions = `${upBtn('start', 'Start', true)}<button class="btn ghost sm" data-action="live-local-delete" title="${esc(LIVE_LOCAL_TIPS.remove)}" ${off}>${icon('trash', 'sm')}Remove…</button>`;
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
/** Local cluster: AX on this computer, what runs there and what you can do with it, and what the last command said. */
function liveViewPlaces() {
  const L = LIVE.local;
  const ctxLine = L && L.context ? `Kind cluster <span class="mono">${esc(L.name || 'ax-local')}</span> · context <span class="mono">${esc(L.context)}</span>` : 'Nothing set up here yet';
  const mood = liveOpRunning() ? 'working' : L && L.state === 'Running' ? (liveLocalHealth().ok ? 'idle' : 'alert') : 'wave';
  const html = `
    <div class="head-row places-head"><div class="cuj-head">${axo(mood, { decorative: true, id: 'places-axo' })}<div class="cuj-head-copy"><h1 tabindex="-1">Local cluster</h1>
      <p class="lede" style="max-width:64ch">AX runs your tasks on a Kubernetes cluster in your container runtime, each in its own sandbox. Studio names this cluster on every request and never changes your kubeconfig.</p></div></div>
      <div class="btn-row"><button type="button" class="btn sm" data-action="live-env-refresh" data-fresh="1" id="live-env-recheck" ${liveOpRunning() ? 'disabled' : ''}>${icon('refresh', 'sm')}Check again</button></div></div>
    <section class="card place-card" aria-labelledby="live-pl-local" style="margin-top:16px">
      <div class="place-top"><span class="p-icon" aria-hidden="true">${icon('laptop')}</span>
        <div class="pl-head"><h2 id="live-pl-local" class="h-display-sm">AX on this computer</h2><div class="pl-ctx">${ctxLine}</div></div>
        <div class="pl-state">${liveLocalStateHTML()}</div></div>
      ${liveLocalPlaceHTML()}
    </section>
    ${liveOutputHTML()}`;
  return { title: 'Local cluster', crumbs: [{ label: 'Home', href: '#/' }, { label: 'Local cluster' }], html, wide: true };
}
/** Setup of AX on this computer. It is also what Home shows while there is no AX to list tasks from. */
function liveViewSetup(asHome) {
  const L = LIVE.local || { state: 'NotFound' };
  const settingUp = liveOpRunning() && LIVE.op.action === 'local-up';
  const failed = (LIVE.op && LIVE.op.status === 'failed') || (!LIVE.canStartLocal && L.state !== 'Running') || !!LIVE.axError;
  const mood = settingUp ? 'working' : L.state === 'Running' ? 'done' : failed ? 'alert' : 'wave';
  let title, lede;
  if (settingUp) { title = 'Setting up AX on this computer'; lede = 'This takes a few minutes. You can leave this page: setup keeps going.'; }
  else if (L.state === 'Running') { title = 'AX is running on this computer'; lede = 'Your tasks run here, each in its own sandbox.'; }
  else if (L.state === 'Stopped') { title = 'AX on this computer is stopped'; lede = 'Start it to see your tasks and run new ones.'; }
  else { title = 'Set up AX on this computer'; lede = 'Run AX tasks locally, each in its own isolated sandbox. Setup takes a few minutes.'; }
  const html = `
    <div class="setup-hero cuj-head">${axo(mood, { decorative: true, id: 'setup-axo' })}<div class="cuj-head-copy"><h1 tabindex="-1">${title}</h1><p class="lede">${lede}</p></div></div>
    <section class="card setup-card" aria-label="AX on this computer" id="live-setup">
      ${liveLocalHTML()}
      ${L.state === 'Running' && !liveOpRunning() && !asHome ? `<div class="btn-row setup-actions"><a class="btn primary" href="#/">Go to Home${icon('arrowRight', 'sm')}</a></div>` : ''}
    </section>`;
  const crumbs = asHome ? [{ label: 'Setup' }] : [{ label: 'Home', href: '#/' }, { label: 'Local cluster', href: '#/places' }, { label: 'Setup' }];
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
      <label class="toggle-line" style="margin-top:12px"><span class="tl-text"><b>Suspend running tasks first</b><span>Saves each task's checkpoint so you can resume it later. Stopping the cluster while a task is running marks that attempt Failed when the cluster starts again.</span></span>
        <span class="switch"><input type="checkbox" role="switch" id="ls-pause" ${p.pauseFirst ? 'checked' : ''} ${p.busy ? 'disabled' : ''} aria-label="Suspend running tasks first"><span class="track"></span><span class="thumb"></span></span></label>
      <div style="margin-top:12px">${cliHint('ax local stop')}</div>
      ${p.error ? `<div class="callout warn" role="alert" style="margin-top:12px">${icon('alert')}<div style="overflow-wrap:anywhere">${esc(p.error)}</div></div>` : ''}`;
    $('#ls-pause', body).addEventListener('change', (e) => { p.pauseFirst = e.target.checked; });
    const go = $('#ls-go', dlg);
    go.disabled = p.busy;
    go.innerHTML = p.busy ? `${icon('loader', 'sm')}Suspending tasks…` : `${icon('pause', 'sm')}Stop`;
  };
  $('#ls-go', dlg).addEventListener('click', async () => {
    if (p.busy) return;
    if (p.pauseFirst) {
      p.busy = true; p.error = '';
      paint();
      try {
        for (const t of active) await studioApi.taskAction('suspend', LIVE.context, LIVE.atespace, t.name);
      } catch (e) {
        p.busy = false; p.error = `Couldn't suspend running tasks: ${e.message}`;
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
      <li class="check-item ok"><span class="ci-icon">${icon('check')}</span><div><div class="ci-title">Kept</div><div class="ci-desc">Your container runtime, the <span class="mono">ax</span> command, and your kubeconfig's other clusters</div></div></li>
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
  /* Check again looks at everything again: this computer, the tools (with fresh=1) and AX on it. */
  'live-env-refresh': async (el) => {
    const btn = el && el.id ? el : null;
    if (btn) btn.disabled = true;
    await liveLoadEnv(!!(el && el.dataset.fresh === '1'));
    LIVE.failedAt = 0;
    await liveRefresh(true);
    render({ keepScroll: true });
    announce('Checked again');
  },
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
    if (k === 'serverImage' && !(LIVE.env || {}).serverImageEnv && !liveSetupImages().serverImage) e.target.setAttribute('aria-invalid', String(!e.target.value.trim()));
  });
  document.addEventListener('toggle', (e) => {
    const t = e.target;
    if (!t || !t.id) return;
    if (t.id === 'live-images') LIVE.imagesOpen = t.open;
    else if (t.id === 'live-setup-whats-in' || (t.classList && (t.classList.contains('pl-fold') || t.classList.contains('setup-acc')))) LIVE.folds[t.id] = t.open;
  }, true);
}
