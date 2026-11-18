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

// Smoke test v4: load AX Studio in a stubbed DOM, exercise every view/flow/competitor feature,
// and mathematically assert <= 1 Axel (svg.axo) on every single screen, tab, state, overlay, and toast.
const fs = require('fs');
const vm = require('vm');
/* Run from the repo root: node tests/<suite>.js   (or pass the app folder as the first argument) */
const dir = process.argv[2] || require('path').resolve(__dirname, '..');

const namedEls = {};
function fakeEl(id) {
  const el = {
    innerHTML: '', textContent: '', value: '', hidden: false, disabled: false, checked: false, id: id || '', tagName: 'DIV',
    style: { setProperty() {}, getPropertyValue() { return ''; }, removeProperty() {} }, dataset: { axo: 'idle', stage: '0' }, children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
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
['#root', '#main', '#overlay', '#toasts', '#bell-pop', '#announcer'].forEach((k) => { namedEls[k] = fakeEl(k); });

const store = {};
const listeners = {};
const doc = {
  addEventListener(t, f) { (listeners[t] = listeners[t] || []).push(f); },
  querySelector(s) { return namedEls[s] || fakeEl(s); },
  querySelectorAll() { return []; },
  getElementById(id) { return namedEls['#' + id] || fakeEl(id); },
  createElement() { return fakeEl(); },
  contains() { return true; }, activeElement: null,
  documentElement: Object.assign(fakeEl(), { scrollHeight: 1000 }),
  body: fakeEl('body'),
};
const timers = [];
const ctx = {
  console, URLSearchParams, JSON, Math, Date, String, Number, Object, Array, Promise, RegExp, encodeURIComponent,
  Blob: function Blob(a) { this.a = a; },
  URL: { createObjectURL: () => 'blob:ax', revokeObjectURL: () => {} },
  document: doc,
  navigator: { platform: 'MacIntel', clipboard: { writeText: () => Promise.resolve() } },
  location: { hash: '#/', get href() { return 'http://localhost/index.html' + this.hash; }, replace(u) { u = String(u); this.hash = u.includes('#') ? u.slice(u.indexOf('#')) : ''; } },
  history: { replaceState() {} },
  localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
  setTimeout: (f) => { timers.push(f); return timers.length; }, clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
  innerWidth: 1440, innerHeight: 900, scrollY: 0, scrollTo() {}, requestAnimationFrame: () => 0,
  getSelection: () => '',
};
ctx.window = ctx;
ctx.window.matchMedia = () => ({ matches: false, addEventListener() {} });
ctx.window.addEventListener = () => {};
vm.createContext(ctx);

const files = ['core.js', 'mascot.js', 'viz.js', 'failures.js', 'views.js', 'task.js', 'overlays.js', 'app.js'];
const src = files.map((f) => fs.readFileSync(dir + '/' + f, 'utf8')).join('\n;\n');
vm.runInContext(src + `
;globalThis.__api = {
  state, render, shellHTML, viewHome, viewNew, viewTask, viewGuardrails, viewPlaces, viewSettings, viewSetup, viewNotFound,
  evHTML, getTask, runStep, allowRequest, allowOnceRequest, denyRequest, answerTask, pauseTask, resumeTask, steerTask, retryTask,
  handoffTask, forkCompareTask, swapAltRun, promoteTask, termRun,
  openPalette, paletteItems, openShortcuts, openStory, openManifest, openDoctor, openCompare, toggleBell, openKeyDialog, openHandoff, openPromote,
  validateKey, createTaskFromDraft, ensureDraft, manifestYAML, SCRIPTS, AGENTS, ACTIONS, GUARDRAIL_PRESETS, AXEL_STORY,
  axo, springPoolHTML, reachMap, gateMap, aqueductMap, journeyHTML, nowNextHTML: nextStepHTML, nextStepHTML, tabAttnOf, titleWithNeeds, refreshNextStep, updateTabAttn, topbarTaskHTML, stageOf, ring, weekBars, sparkline, updateJourney, refreshLive, readyHTML, planHeadHTML, speechFor, toast,
  ERRORS, SCENARIOS, failCardHTML, failActionsHTML, runFix, runScenario, setHealth, healthCardHTML, envBannerHTML, keepRun, restoreRun, pushTask,
  interruptTask, deliverQueued, openUninstall, openDeleteActivity, openExportResults, openFailureDialog, openProxyHelp, oatrJSON, setupInstall,
  accountSignedIn, parseEnvVars, draftSpec, setEnvMode, connectPanelHTML, spawnFailure, waitForTurn,
  currentEvent, nowLine, isFolded, needsCount, navTasksHTML, inviteCluster, otherConnectHTML,
  AXO_DEFS, draftCli, draftChecks, countUp, axoTap, AXO_TRICKS, axoStreak, axoEndTrick, axoBusy, axoYield,
  updateAxoInPlace, patchSetupDOM, patchTaskDOM, selectHTML, templateSelectHTML, openSelect, closeSelect, pickSelect, selKeydown,
  openAgentCatalog, catBrowseHTML, catDetailHTML, catResultsHTML, catFootHTML, byoHTML, byoChecksHTML, byoPlan, byoBase, byoInputError,
  addCatalogAgent, addByoAgent, useAgentInDraft, goalHelpHTML, GOAL_TIPS, AGENT_CATALOG, addAgent, removeAgent, agentList, addedAgents, prebuiltAgents,
  viewCuj1, cujRibbonHTML, startCujPath, startCujScenario, CUJ1_FAILS, viewReview, viewGet, startPreinstalled, SETTINGS_SECTIONS, settingsSection,
  addAllowedSite, siteAllowed, presetSites, mySites, openConnectCluster, DEFAULT_AGENT, quickAgentId, byoTile, setupSteps, reachFor, andList
};`, ctx);

const api = ctx.__api;
let fails = 0;

function countAxo(html) {
  return (String(html || '').match(/<svg[^>]*\bclass="[^"]*\baxo\b/g) || []).length;
}
function checkHtmlClean(name, html, maxAxo = 1) {
  const cleaned = String(html).replace(/aria-describedby|"undefined"/g, '');
  if (/undefined|NaN|\[object/.test(cleaned)) {
    fails++;
    console.log('FAIL', name, 'bad token:', (cleaned.match(/.{0,35}(undefined|NaN|\[object).{0,35}/) || [])[0]);
    return false;
  }
  const n = countAxo(html);
  if (n > maxAxo) {
    fails++;
    console.log('FAIL', name, `axo count ${n} > ${maxAxo}`);
    return false;
  }
  return true;
}
function check(name, fn, opts = {}) {
  try {
    const r = fn();
    if (r && typeof r.html === 'string') {
      const full = r.full ? r.html : api.shellHTML() + r.html;
      if (!checkHtmlClean(name, full, opts.maxAxo == null ? 1 : opts.maxAxo)) return;
      if (opts.exactAxo != null && countAxo(full) !== opts.exactAxo) {
        fails++;
        console.log('FAIL', name, `expected exact axo=${opts.exactAxo}, got ${countAxo(full)}`);
        return;
      }
    }
    console.log('ok  ', name);
  } catch (e) {
    fails++;
    console.log('FAIL', name, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e);
  }
}

const S = api.state;
check('shellHTML has 0 Axel (uses BRAND_MARK)', () => ({ html: api.shellHTML(), full: true }), { exactAxo: 0 });
check('the logo is the Clear Spring AX ligature, in the app and as the favicon', () => {
  const sh = api.shellHTML();
  if (!/class="brand-mark"[^>]*viewBox="0 0 32 32"/.test(sh)) throw new Error('expected a 32x32 .brand-mark');
  if (!/class="bm-main"/.test(sh) || !/class="bm-cross"/.test(sh) || !/class="bm-rose"/.test(sh)) throw new Error('BRAND_MARK should be the Clear Spring AX ligature');
  if (/axel-body-art|axel-eye-orb|axel-mouth/.test(sh)) throw new Error('BRAND_MARK must not reuse the mascot art');
  const html = fs.readFileSync(dir + '/index.html', 'utf8');
  if (!/<link rel="icon"[^>]*href="assets\/logo\.svg(\?v=\d+)?"/.test(html)) throw new Error('the favicon should be assets/logo.svg');
  const logo = fs.readFileSync(dir + '/assets/logo.svg', 'utf8');
  const main = 'M4.85 24.4 Q4.2 24.4 4.44 23.8 L10.78 8.16';
  if (!sh.includes(main) || !logo.includes(main) || /axel-body-art/.test(logo)) throw new Error('assets/logo.svg should match the BRAND_MARK drawing');
});
check('render welcome', () => { ctx.location.hash = '#/welcome'; api.render(); });
check('the first-run redirect uses the full page address, so it stays in the frame inside Artifacts (iframe srcdoc)', () => {
  const replace = ctx.location.replace; let to = null;
  ctx.location.replace = function (u) { to = u; replace.call(this, u); };
  try { ctx.location.hash = '#/settings'; api.render(); } finally { ctx.location.replace = replace; }
  if (to !== 'http://localhost/index.html#/welcome') throw new Error('expected location.replace with the full address, got ' + to);
  if (ctx.location.hash !== '#/welcome') throw new Error('should land on #/welcome, got ' + ctx.location.hash);
});
check('setup before (exact 1 Axel)', () => { S.setup = null; return api.viewSetup(); }, { exactAxo: 1 });
check('setup installing (exact 1 Axel)', () => { S.setup = { phase: 'installing', step: 2, pick: 'claude' }; return api.viewSetup(); }, { exactAxo: 1 });
check('setup ready (exact 1 Axel)', () => { S.setup = { phase: 'ready', step: 4, pick: 'codex' }; return api.viewSetup(); }, { exactAxo: 1 });

store['ax.setup'] = '1';
for (const h of ['#/', '#/new', '#/new?goal=Hello&agent=codex', '#/guardrails', '#/places', '#/settings', '#/settings/notifications', '#/settings/command-line', '#/settings/nope', '#/review', '#/nope']) {
  check('render ' + h, () => { ctx.location.hash = h; api.render(); });
}

check('home all (exact 1 Axel)', () => api.viewHome(), { exactAxo: 1 });
check('home local (exact 1 Axel)', () => { S.homeFilter = 'local'; const v = api.viewHome(); S.homeFilter = 'all'; return v; }, { exactAxo: 1 });
check('home cluster (exact 1 Axel, caught-up + empty sections)', () => { S.homeFilter = 'cluster'; const v = api.viewHome(); S.homeFilter = 'all'; return v; }, { exactAxo: 1 });
check('new claude (exact 1 Axel)', () => { S.draft = null; return api.viewNew(new URLSearchParams('')); }, { exactAxo: 1 });
check('new codex key (exact 1 Axel)', () => { S.draft = null; return api.viewNew(new URLSearchParams('agent=codex')); }, { exactAxo: 1 });
check('new compare mode (exact 1 Axel)', () => { S.draft = null; const d = api.ensureDraft(new URLSearchParams('goal=Refactor+auth')); d.compare = true; return api.viewNew(new URLSearchParams('')); }, { exactAxo: 1 });
check('new git + sample cluster (exact 1 Axel)', () => { S.draft.source = 'git'; S.draft.git = 'https://github.com/a/b.git'; api.viewNew(new URLSearchParams('')); S.draft.source = 'sample'; S.draft.env = 'cluster'; return api.viewNew(new URLSearchParams('')); }, { exactAxo: 1 });

for (const t of S.tasks) {
  for (const tab of ['activity', 'changes', 'terminal']) {
    check(`task ${t.id} (${t.status}) ${tab} [1 Axel]`, () => {
      ctx.location.hash = `#/task/${t.id}/${tab}`;
      api.render();
      return api.viewTask(t.id, tab);
    }, { exactAxo: 1 });
  }
}

check('guardrails balanced (exact 1 Axel)', () => api.viewGuardrails(), { exactAxo: 1 });
check('guardrails strict (exact 1 Axel)', () => { S.guardrailPreset = 'strict'; const v = api.viewGuardrails(); S.guardrailPreset = 'balanced'; return v; }, { exactAxo: 1 });
check('places signed out (0 Axel)', () => api.viewPlaces(), { exactAxo: 0 });
check('places with clusters from your kubeconfig (0 Axel)', () => api.viewPlaces(), { exactAxo: 0 });
check('settings (exact 0 Axel)', () => api.viewSettings(), { exactAxo: 0 });
for (const sec of api.SETTINGS_SECTIONS) check(`settings ${sec.slug} (exact 0 Axel)`, () => api.viewSettings(sec.slug), { exactAxo: 0 });
check('review links page (full page, 0 Axel)', () => api.viewReview(), { exactAxo: 0 });
check('not found (exact 1 Axel)', () => api.viewNotFound(), { exactAxo: 1 });

// Verify overlays & toasts have ZERO Axel (so opening over any 1-Axel view stays at 1!)
const overlayFns = [
  ['manifest', () => api.openManifest(api.getTask('t1'))],
  ['doctor', () => api.openDoctor()],
  ['compare-altRun (t5)', () => api.openCompare(api.getTask('t5'))],
  ['compare-fork (t1)', () => api.openCompare(api.getTask('t1'))],
  ['palette', () => api.openPalette()],
  ['shortcuts', () => api.openShortcuts()],
  ['keyDialog', () => api.openKeyDialog('codex', 't4')],
  ['handoff', () => api.openHandoff(api.getTask('t1'))],
  ['promote', () => api.openPromote(api.getTask('t2'))],
];
for (const [nm, fn] of overlayFns) {
  check(`overlay ${nm} (0 Axel)`, () => {
    namedEls['#overlay'].innerHTML = '';
    fn();
    return { html: namedEls['#overlay'].innerHTML, full: true };
  }, { exactAxo: 0 });
}
// The story is about Axel, so it's the one dialog with him in it; the page's own Axel hides while it's open.
check('overlay story (exactly 1 Axel, and the page Axel steps out)', () => {
  namedEls['#overlay'].innerHTML = '';
  api.openStory();
  const h = namedEls['#overlay'].innerHTML;
  if (!/class="story-scene" aria-hidden="true"/.test(h)) throw new Error('Axel should be in the story scene, hidden from assistive tech');
  if (!/body:has\(#story\) #root svg\.axo \{ visibility: hidden; \}/.test(fs.readFileSync(dir + '/polish.css', 'utf8'))) throw new Error('the page Axel should hide behind the story');
  return { html: h, full: true };
}, { exactAxo: 1 });
check('story is short: one line of story and four short pairs', () => {
  const words = (x) => x.split(/\s+/).filter(Boolean).length;
  if (words(api.AXEL_STORY.lead) > 30) throw new Error('the story line should stay under 30 words');
  if (api.AXEL_STORY.chapters.length !== 4) throw new Error('four pairs');
  for (const c of api.AXEL_STORY.chapters) if (words(c.trait) > 5 || words(c.product) > 6 || c.desc) throw new Error('pairs stay short: ' + c.product);
  namedEls['#overlay'].innerHTML = '';
  api.openStory();
  const h = namedEls['#overlay'].innerHTML;
  if (/—/.test(h)) throw new Error('no em dashes in the story');
  if (!/Say hi to him on Home/.test(h)) throw new Error('the P.S. points to the tricks on Home');
});
check('bell popover (0 Axel)', () => {
  namedEls['#bell-pop'].innerHTML = '';
  api.toggleBell();
  return { html: namedEls['#bell-pop'].innerHTML, full: true };
}, { exactAxo: 0 });
check('toasts (0 Axel)', () => {
  namedEls['#toasts'].innerHTML = '';
  for (const m of ['done', 'wave', 'working', 'blocked', 'waiting', 'failed', 'sleeping', 'building', 'idle']) api.toast('msg ' + m, { axo: m });
  return { html: namedEls['#toasts'].innerHTML, full: true };
}, { exactAxo: 0 });

// Test allow-once vs workspace allow vs deny
const t1 = api.getTask('t1');
check('allowOnceRequest does not persist to allowlist', () => {
  const tc = JSON.parse(JSON.stringify(t1));
  tc.id = 'tonce'; tc.step = 2; tc.status = 'running';
  S.tasks.push(tc);
  api.runStep(tc);
  if (tc.status !== 'blocked') throw new Error('expected blocked');
  const beforeLen = S.allow.length;
  const bi = tc.events.findIndex((e) => e.type === 'blocked' && !e.resolved);
  api.allowOnceRequest(tc, bi);
  if (S.allow.length !== beforeLen) throw new Error('allow-once polluted allowlist');
  if (tc.events[bi].resolved !== 'once') throw new Error('expected resolved=once');
  return api.viewTask('tonce', 'activity');
}, { exactAxo: 1 });

// Run t1 through its whole script
ctx.location.hash = '#/task/t1';
api.render();
check('t1 full script + blocked view (1 Axel)', () => {
  let guard = 0, checkedBlocked = false;
  while (t1.step < api.SCRIPTS.t1.length && guard++ < 20) {
    if (t1.status === 'blocked') {
      if (!checkedBlocked) {
        checkedBlocked = true;
        checkHtmlClean('t1 blocked view', api.shellHTML() + api.viewTask('t1', 'activity').html, 1);
        checkHtmlClean('home with blocked card', api.shellHTML() + api.viewHome().html, 1);
      }
      const i = t1.events.findIndex((e) => e.type === 'blocked' && !e.resolved);
      api.allowRequest(t1, i);
    }
    api.runStep(t1);
  }
  if (t1.status !== 'done' || t1.files.length !== 4) throw new Error('t1 end: ' + t1.status);
  return api.viewTask('t1', 'changes');
}, { exactAxo: 1 });

check('t5 swapAltRun roundtrip', () => {
  const t5 = api.getTask('t5');
  if (t5.agent !== 'antigravity') throw new Error('expected antigravity');
  api.swapAltRun(t5);
  if (t5.agent !== 'claude' || t5.files.length !== 3) throw new Error('swap 1 failed');
  api.swapAltRun(t5);
  if (t5.agent !== 'antigravity' || t5.files.length !== 2) throw new Error('swap 2 failed');
  return api.viewTask('t5', 'changes');
}, { exactAxo: 1 });

check('forkCompareTask links siblings', () => {
  api.forkCompareTask(t1, 'antigravity');
  const sib = api.getTask(t1.compareWith);
  if (!sib || sib.compareWith !== 't1') throw new Error('missing compareWith link');
  namedEls['#overlay'].innerHTML = '';
  api.openCompare(t1);
  checkHtmlClean('compare linked modal', namedEls['#overlay'].innerHTML, 0);
  return api.viewTask(sib.id, 'activity');
}, { exactAxo: 1 });

check('createTaskFromDraft with 2-agent compare', () => {
  S.draft = null;
  const d = api.ensureDraft(new URLSearchParams('goal=Add+OpenTelemetry+tracing+spans'));
  d.compare = true; d.agent = 'claude'; d.agent2 = 'antigravity'; d.env = 'local';
  const before = S.tasks.length;
  api.createTaskFromDraft();
  if (S.tasks.length !== before + 2) throw new Error('expected 2 tasks created, got ' + (S.tasks.length - before));
  if (S.tasks[0].compareWith !== S.tasks[1].id || S.tasks[1].compareWith !== S.tasks[0].id) throw new Error('tasks not cross-linked');
});

check('manifestYAML ax + kit contain 0 secrets', () => {
  const y1 = api.manifestYAML(t1, 'ax');
  const y2 = api.manifestYAML(t1, 'kit');
  if (/\bsk-ant-|\bsk-[a-z0-9]{6,}/i.test(y1 + y2)) throw new Error('raw key leaked in YAML');
  if (!y1.includes('agents.x-k8s.io/v1alpha1') || !y2.includes('schemaVersion: 1')) throw new Error('missing schema header');
  return { html: y1 + y2, full: true };
}, { exactAxo: 0 });

check('t2 answer + t3 pause/resume + handoff + promote + terminal', () => {
  const t2 = api.getTask('t2'); api.answerTask(t2, 'Delete them'); while (t2.status === 'running') api.runStep(t2);
  const t3 = api.getTask('t3'); api.pauseTask(t3); api.resumeTask(t3);
  api.handoffTask(t3, 'claude', 'continue');
  api.promoteTask(t2, 'ax-batch-eu');
  ['help', 'ls', 'git status', 'git diff --stat', 'npm test', 'env', 'ax doctor', 'curl https://example.com/x', 'curl github.com', 'curl pastebin.com', 'clear', 'exit'].forEach((c) => api.termRun(t1, c));
});

for (const a of ['story','doctor','compare','manifest','manifest-draft','poke','jump','home-filter','sel-toggle','sel-pick','suggest','pick-agent','toggle-compare','pick-agent2','pick-source','pick-size','change-folder','diff-file','keep-file','push','apply','patch','open-pr','set-preset','remove-allow','allow-domain','noop-toast','toggle-pref','rerun-setup','setup-finish']) {
  check('action ' + a, () => {
    const el = fakeEl();
    el.dataset = { task: 't5', i: '6', keep: '0', target: 'sec-needs', filter: 'local', text: 'x', agent: 'antigravity', source: 'git', size: 'large', domain: 'z.example.com', scope: 'all', pref: 'pinImages', preset: 'balanced' };
    el.checked = true;
    ctx.location.hash = '#/task/t5/changes';
    api.render();
    if (!S.draft) api.ensureDraft(new URLSearchParams(''));
    api.ACTIONS[a](el, { preventDefault() {} });
  });
}

/* ======================= P0 prototype checks (v5) ======================= */
const mainHTML = () => namedEls['#main'].innerHTML + namedEls['#root'].innerHTML;
function flush(n) { let k = 0; while (timers.length && k++ < (n || 40)) { try { timers.shift()(); } catch (e) { /* async timers may reject in the stub */ } } }
const pin = (name, fn, opts) => check(name, fn, opts);

// Setup: every phase, path and failure (exactly 1 Axel each)
const setupStates = [
  ['before local', { phase: 'before', step: 0, pick: 'claude', path: 'local' }],
  ['before cluster', { phase: 'before', step: 0, pick: 'claude', path: 'cluster' }],
  ['before disk issue', { phase: 'before', step: 0, pick: 'claude', path: 'local', issue: 'disk' }],
  ['before virt issue', { phase: 'before', step: 0, pick: 'codex', path: 'local', issue: 'virt' }],
  ['before admin issue', { phase: 'before', step: 0, pick: 'antigravity', path: 'local', issue: 'admin' }],
  ['before interrupted', { phase: 'before', step: 0, pick: 'claude', path: 'local', interrupted: 1 }],
  ['installing step 3', { phase: 'installing', step: 3, pick: 'antigravity', path: 'local' }],
  ['failed download', { phase: 'failed', step: 3, pick: 'claude', path: 'local' }],
  ['connect pick cluster', { phase: 'connect', step: 0, pick: 'claude', path: 'cluster', cluster: 'ax-batch-eu' }],
  ['ready local (bg downloading)', { phase: 'ready', step: 4, pick: 'claude', path: 'local', bgDone: false }],
  ['ready cluster', { phase: 'ready', step: 4, pick: 'codex', path: 'cluster' }],
  ['before local, your own agent first', { phase: 'before', step: 0, pick: 'byo', path: 'local' }],
  ['installing the agent runner', { phase: 'installing', step: 3, pick: 'byo', path: 'local' }],
  ['failed agent runner download', { phase: 'failed', step: 3, pick: 'byo', path: 'local' }],
  ['ready local, your own agent', { phase: 'ready', step: 4, pick: 'byo', path: 'local' }],
  ['ready cluster, your own agent', { phase: 'ready', step: 4, pick: 'byo', path: 'cluster' }],
];
for (const [nm, st] of setupStates) pin('setup ' + nm + ' (exact 1 Axel)', () => { S.setup = Object.assign({}, st); return api.viewSetup(); }, { exactAxo: 1 });
pin('connect lists clusters from your kubeconfig and offers an invite link', () => {
  S.setup = { phase: 'connect', step: 0, pick: 'claude', path: 'cluster', cluster: 'ax-dev-us-central' };
  const h = api.viewSetup().html;
  if (!/id="invite-url"/.test(h) || !/data-action="setup-invite"/.test(h)) throw new Error('missing invite link');
  if (!/From your kubeconfig/.test(h) || !/Don't see your cluster\?/.test(h) || !/gcloud container clusters get-credentials/.test(h)) throw new Error('missing kubeconfig wording');
  if (api.inviteCluster('https://ax.acme.dev/join/abc123') !== 'ax-dev-us-central' || api.inviteCluster('not a link')) throw new Error('invite parsing');
  const el = fakeEl(); el.dataset = { cluster: 'ax-batch-eu' }; api.ACTIONS['setup-cluster'](el, {});
  if (S.setup.cluster !== 'ax-batch-eu') throw new Error('picking a cluster should select it');
  const pm = api.otherConnectHTML('ax-dev-us-central', 'promote');
  if (!/id="pm-invite"/.test(pm) || /data-action="setup-cluster"|data-action="setup-invite"/.test(pm)) throw new Error('promote variant should wire to the dialog');
  if (!/otherConnectHTML\(cluster, 'promote'\)/.test(require('fs').readFileSync(dir + '/overlays.js', 'utf8'))) throw new Error('promote picker should include the connect options');
  return { html: h, full: true };
}, { exactAxo: 1 });
pin('setup disk issue disables local CTA and offers Connect', () => {
  S.setup = { phase: 'before', step: 0, pick: 'claude', path: 'local', issue: 'disk' };
  const h = api.viewSetup().html;
  if (!/id="setup-start" disabled/.test(h)) throw new Error('setup CTA should be disabled');
  if (!/data-fix="connect-instead"/.test(h)) throw new Error('missing Connect instead');
  return { html: h, full: true };
});

// Error catalog: every entry renders through the one fail-card with zero undefined
for (const code of Object.keys(api.ERRORS)) {
  pin(`fail-card ${code}`, () => ({ html: api.failCardHTML(code, { t: api.getTask('t4'), cluster: 'ax-batch-eu', repo: 'accounts', agent: 'claude' }), full: true }), { exactAxo: 0 });
}

// Environment health states
for (const [nm, fn] of [
  ['starting', () => { S.env.mode = 'local'; S.env.health = 'starting'; S.env.startsIn = 9; }],
  ['attention', () => { S.env.health = 'attention'; S.env.issue = 'env-disk-low'; }],
  ['asleep', () => { S.env.health = 'asleep'; }],
  ['healthy', () => { S.env.health = 'healthy'; S.env.issue = null; }],
  ['not set up', () => { S.env.mode = 'none'; }],
  ['cluster only', () => { S.env.mode = 'cluster'; }],
]) {
  pin(`health ${nm}: shell + home + places`, () => {
    fn();
    const h = api.healthCardHTML() + api.envBannerHTML();
    checkHtmlClean(`health card ${nm}`, h, 0);
    checkHtmlClean(`places ${nm}`, api.shellHTML() + api.viewPlaces().html, 1);
    return api.viewHome();
  }, { exactAxo: 1 });
}
pin('new task when this computer is not set up asks to finish setup', () => {
  S.env.mode = 'none'; S.draft = null;
  const v = api.viewNew(new URLSearchParams(''));
  if (S.draft.env !== 'cluster') throw new Error('draft should default to cluster when local is not set up');
  if (!/Finish setup/.test(v.html)) throw new Error('missing Finish setup link');
  S.env.mode = 'local'; S.env.health = 'healthy'; S.draft = null;
  return v;
}, { exactAxo: 1 });

// New task: sign-in methods, uncommitted toggle, recipe builder, secret-safe YAML
pin('new task codex: account sign-in method', () => { S.draft = null; const d = api.ensureDraft(new URLSearchParams('agent=codex')); d.keyMethod = 'account'; const v = api.viewNew(new URLSearchParams('')); if (!/Sign in with ChatGPT/.test(v.html)) throw new Error('missing ChatGPT sign-in'); return v; }, { exactAxo: 1 });
pin('new task codex: API key method', () => { S.draft.keyMethod = 'key'; const v = api.viewNew(new URLSearchParams('')); if (!/id="key-input"/.test(v.html)) throw new Error('missing key input'); return v; }, { exactAxo: 1 });
pin('new task dirty folder + advanced recipe open', () => {
  S.draft = null; const d = api.ensureDraft(new URLSearchParams('goal=Add+metrics'));
  d.folderIdx = 1; d.advOpen = true; d.mcp = ['github', 'linear']; d.skills = ['ax-task', 'test-runner']; d.envVars = 'NODE_ENV=test\nSTRIPE_API_KEY=sk_live_123'; d.instructions = 'Use pnpm.';
  const v = api.viewNew(new URLSearchParams(''));
  if (!/Include my 2 uncommitted changes/.test(v.html)) throw new Error('missing uncommitted toggle');
  if (!/looks like a secret/.test(v.html)) throw new Error('missing secret warning');
  if (!/ax run --template antigravity --workspace ax\.yaml/.test(v.html)) throw new Error('customized recipe should run from its Workspace spec');
  if (!/aria-label="More repos"/.test(v.html) || /data-val="web-app"[^>]*data-key="extraRepos"|data-key="extraRepos" data-val="web-app"/.test(v.html)) throw new Error('More repos row should list the other folders only');
  d.extraRepos = ['accounts'];
  if (!/~\/code\/accounts · read-only/.test(api.viewNew(new URLSearchParams('')).html)) throw new Error('picked repo should read as read-only');
  return v;
}, { exactAxo: 1 });
pin('recipe YAML drops secret env vars and keeps recipe fields', () => {
  const y = api.manifestYAML(api.draftSpec(S.draft), 'ax') + api.manifestYAML(api.draftSpec(S.draft), 'kit');
  if (/sk_live_123/.test(y)) throw new Error('secret value leaked into YAML');
  if (!/STRIPE_API_KEY removed/.test(y)) throw new Error('missing secret-removed comment');
  if (!/mcpServers: \[github, linear\]/.test(y) || !/includeUncommitted: true/.test(y) || !/AGENTS\.md/.test(y) || !/checkInUSD/.test(y)) throw new Error('recipe fields missing');
  if (!/extraRepos:[^\n]*\n\s+- \{ source: "~\/code\/accounts", mode: read-only \}/.test(y)) throw new Error('extra repo missing from YAML');
  return { html: y, full: true };
}, { exactAxo: 0 });
pin('account sign-in connects an agent without a key', () => {
  const A = api.AGENTS.codex; api.accountSignedIn(A);
  if (!A.connected || A.auth !== 'account') throw new Error('not connected via account');
  const v = api.viewSettings();
  if (!/ChatGPT sign-in in your keychain/.test(v.html) || /rajitha@example\.com/.test(v.html)) throw new Error('settings auth line (no email)');
  A.connected = false; A.auth = 'key'; A.keyProblem = 'Key was rejected';
  return v;
}, { exactAxo: 0 });

// Steering: queued -> delivered at the turn boundary, and interrupt
pin('steer while running queues, then delivers at the next turn', () => {
  const t = api.getTask('t3'); if (t.status !== 'running') { t.status = 'running'; t.step = 0; }
  api.steerTask(t, 'Also keep PNG for icons');
  const ev = t.events[t.events.length - 1];
  if (ev.delivery !== 'queued') throw new Error('expected queued');
  checkHtmlClean('queued chip', api.viewTask('t3', 'activity').html, 1);
  if (api.currentEvent(t) === ev) throw new Error('queued message must not count as current work');
  if (/Reading your message/.test(api.nowLine(t))) throw new Error('Now line claims the agent read a queued message');
  if (!/queued for the next turn/.test(api.nowNextHTML(t))) throw new Error('Next line should mention the queued message');
  api.deliverQueued(t);
  if (ev.delivery !== 'delivered') throw new Error('expected delivered');
  api.steerTask(t, 'Stop and summarize');
  const i = t.events.length - 1; api.interruptTask(t, i);
  if (t.events[i].delivery !== 'interrupted') throw new Error('expected interrupted');
  return api.viewTask('t3', 'activity');
}, { exactAxo: 1 });

// Compare: keep one run (altRun and sibling) + restore
pin('keepRun on altRun marks the other run not kept', () => {
  const t5 = api.getTask('t5'); api.keepRun(t5, 'self');
  if (!t5.altRun.notKept || !t5.keptRun) throw new Error('altRun keep failed');
  return api.viewTask('t5', 'changes');
}, { exactAxo: 1 });
pin('keepRun on sibling pair + restore', () => {
  const t1 = api.getTask('t1'); const sib = api.getTask(t1.compareWith);
  api.keepRun(t1, 'other');
  if (!t1.notKept || sib.notKept) throw new Error('sibling keep failed');
  checkHtmlClean('not-kept banner', api.shellHTML() + api.viewTask('t1', 'activity').html, 1);
  api.restoreRun(t1);
  if (t1.notKept) throw new Error('restore failed');
  return api.viewHome();
}, { exactAxo: 1 });

// Review failures open the shared fail-card
pin('apply conflict + push rejected open fail-card dialogs', () => {
  S.flags.applyConflict = true; namedEls['#overlay'].innerHTML = '';
  const el = fakeEl(); el.dataset = { task: 't6' };
  api.ACTIONS.apply(el, {});
  if (!/data-fail="apply-conflict"/.test(namedEls['#overlay'].innerHTML)) throw new Error('no conflict card');
  S.flags.pushRejected = true; namedEls['#overlay'].innerHTML = '';
  api.pushTask(api.getTask('t6'), el);
  if (!/data-fail="push-rejected"/.test(namedEls['#overlay'].innerHTML)) throw new Error('no push-rejected card');
  S.flags.applyConflict = false; S.flags.pushRejected = false;
  return { html: namedEls['#overlay'].innerHTML, full: true };
}, { exactAxo: 0 });

// Handoff: carry-over list, wait-for-turn, and failure keeps Task A untouched
pin('handoff dialog shows what carries over', () => {
  namedEls['#overlay'].innerHTML = ''; api.openHandoff(api.getTask('t2'));
  if (!/What carries over/.test(namedEls['#overlay'].innerHTML)) throw new Error('missing carry-over');
  return { html: namedEls['#overlay'].innerHTML, full: true };
}, { exactAxo: 0 });
pin('handoff failure keeps the source task resumable', () => {
  const src = JSON.parse(JSON.stringify(api.getTask('t2'))); src.id = 'thf'; src.status = 'waiting'; src.needs = { type: 'question' };
  S.tasks.push(src); S.flags.handoffFail = true;
  timers.length = 0;
  api.handoffTask(src, 'antigravity', 'continue');
  flush(6);
  const child = S.tasks.find((x) => x.parent === 'thf');
  if (!child || child.status !== 'failed') throw new Error('child should fail to start');
  if (src.status !== 'waiting' || !src.handoffFailed) throw new Error('source should be paused + untouched');
  if (!api.isFolded(child) || src.failedChild !== child.id) throw new Error('failed attempt should fold into the source');
  checkHtmlClean('source after failed handoff', api.viewTask('thf', 'activity').html, 1);
  S.homeFilter = 'all';
  const home = api.viewHome().html;
  if (home.includes('id="needs-' + child.id + '"')) throw new Error('folded attempt should not get its own Needs-you card');
  if (!/couldn.t start.<\/strong>/.test(home) || !/Resume with /.test(home)) throw new Error('source card should explain the failed handoff');
  if (S.tasks.filter((x) => ['blocked', 'waiting', 'failed'].includes(x.status) && !api.isFolded(x)).length !== api.needsCount()) throw new Error('needsCount mismatch');
  ctx.location.hash = '#/task/' + child.id;
  if (!api.navTasksHTML().includes('#/task/' + child.id + '"')) throw new Error('the attempt you are viewing stays in the sidebar');
  ctx.location.hash = '#/';
  if (api.navTasksHTML().includes('#/task/' + child.id + '"')) throw new Error('folded attempt should be hidden from the sidebar');
  return api.viewTask(child.id, 'activity');
}, { exactAxo: 1 });
pin('retrying a folded handoff re-hands-off the source', () => {
  const src = api.getTask('thf'); const child = api.getTask(src.failedChild);
  timers.length = 0;
  api.retryTask(child);
  if (api.isFolded(child) || src.status !== 'done' || src.handoffFailed || src.child !== child.id) throw new Error('retry should unfold and hand off');
  flush(4);
  return api.viewHome();
}, { exactAxo: 1 });

// Promote variants render (version mismatch, unreachable, repo blocker)
for (const [nm, setup] of [['version', () => ({ cluster: 'ax-batch-eu', step: 2 })], ['unreachable', () => { S.flags.clusterUnreachable = true; return { step: 2 }; }], ['blocker', () => { S.flags.repoCredMissing = true; return { step: 2 }; }]]) {
  pin(`promote ${nm} (0 Axel)`, () => { namedEls['#overlay'].innerHTML = ''; api.openPromote(api.getTask('t2') || S.tasks[0], setup()); return { html: namedEls['#overlay'].innerHTML, full: true }; }, { exactAxo: 0 });
}
S.flags = {};

// New dialogs
for (const [nm, fn] of [['uninstall', () => api.openUninstall()], ['delete activity', () => api.openDeleteActivity()], ['export results', () => api.openExportResults(api.getTask('t5'))], ['proxy help', () => api.openProxyHelp()], ['key dialog (account)', () => api.openKeyDialog('claude')]]) {
  pin(`overlay ${nm} (0 Axel)`, () => { namedEls['#overlay'].innerHTML = ''; fn(); return { html: namedEls['#overlay'].innerHTML, full: true }; }, { exactAxo: 0 });
}
pin('OATR export has events and no secrets', () => {
  const j = api.oatrJSON(api.getTask('t4'));
  const o = JSON.parse(j);
  if (o.format !== 'OATR' || !o.events.length) throw new Error('bad OATR');
  if (/sk-[A-Za-z0-9]{6,}/.test(j)) throw new Error('secret in OATR');
  return { html: j, full: true };
}, { exactAxo: 0 });

// Every prototype scenario runs and lands on a clean screen with <= 1 Axel
/* The already-set-up scenarios open a first launch, which starts day 0 (no tasks, nothing signed in). The demo data
   goes back after them, so the checks below still have the seeded tasks. */
function demoSnapshot() {
  return {
    s: { tasks: S.tasks.slice(), blockedLog: S.blockedLog.slice(), nextId: S.nextId, allow: S.allow.slice(), firstRun: S.firstRun, setup: S.setup, cuj: S.cuj, downloads: S.downloads },
    github: S.github.connected, env: { mode: S.env.mode, cluster: S.env.cluster, clusterConnected: S.env.clusterConnected },
    agents: Object.keys(api.AGENTS).map((k) => [k, Object.assign({}, api.AGENTS[k])]),
    store: ['ax.firstrun', 'ax.downloads', 'ax.env', 'ax.cluster'].map((k) => [k, store[k]]),
  };
}
function demoRestore(d) {
  Object.assign(S, d.s); S.github.connected = d.github; Object.assign(S.env, d.env);
  d.agents.forEach(([k, a]) => { const cur = api.AGENTS[k]; Object.keys(cur).forEach((p) => { if (!(p in a)) delete cur[p]; }); Object.assign(cur, a); });
  d.store.forEach(([k, v]) => { if (v === undefined) delete store[k]; else store[k] = v; });
}
for (const sc of api.SCENARIOS) {
  pin(`scenario ${sc.id}`, () => {
    const demo = demoSnapshot();
    store['ax.setup'] = '1'; S.env.mode = 'local'; S.env.health = 'healthy'; S.flags = {};
    namedEls['#main'].innerHTML = ''; namedEls['#root'].innerHTML = ''; namedEls['#overlay'].innerHTML = '';
    api.runScenario(sc.id);
    api.render();
    flush(3);
    try {
      if (!checkHtmlClean(`scenario ${sc.id} screen`, mainHTML(), 1)) return;
      checkHtmlClean(`scenario ${sc.id} overlay`, namedEls['#overlay'].innerHTML, 0);
    } finally { if (S.firstRun && !demo.s.firstRun) demoRestore(demo); }
  });
}
store['ax.setup'] = '1'; S.env.mode = 'local'; S.env.health = 'healthy'; S.flags = {};

// New actions
for (const a of ['fix', 'key-method', 'toggle-draft', 'draft-set', 'draft-toggle', 'set-perm', 'set-retention', 'skill-toggle', 'export-oatr', 'export-results', 'restore-run', 'setup-path', 'setup-cluster', 'setup-skip', 'setup-resume-path', 'agent-signout', 'delete-activity', 'uninstall']) {
  check('action ' + a, () => {
    const el = fakeEl();
    el.dataset = { task: 't5', fix: 'patch', code: 'push-rejected', method: 'key', key: 'skills', val: 'test-runner', mode: 'ask', agent: 'codex', path: 'cluster', cluster: 'ax-dev-us-central', id: 'task-oom' };
    el.checked = true;
    if (!S.setup) S.setup = { phase: 'before', step: 0, pick: 'claude', path: 'local' };
    if (!S.draft) api.ensureDraft(new URLSearchParams(''));
    api.ACTIONS[a](el, { preventDefault() {} });
  });
}
check('settings shows one section at a time, and the nav marks the open one (exact 0 Axel)', () => {
  const v = api.viewSettings();
  const links = v.html.match(/<a href="#\/settings\/[a-z-]+"[^>]*>/g) || [];
  if (links.length !== 8) throw new Error('expected 8 section links, got ' + links.length);
  if ((v.html.match(/aria-current="page"/g) || []).length !== 1 || !/href="#\/settings\/agents" aria-current="page"/.test(v.html)) throw new Error('#/settings opens Agents & keys, marked as the current section');
  if ((v.html.match(/class="set-section"/g) || []).length !== 1 || !/id="set-agents"/.test(v.html)) throw new Error('only the open section renders');
  const pv = api.viewSettings('privacy');
  if (!/href="#\/settings\/privacy" aria-current="page"/.test(pv.html) || !pv.html.includes('Delete all Activity') || pv.html.includes('Uninstall…')) throw new Error('privacy section');
  if (pv.title !== 'Privacy & data · Settings' || pv.crumbs.length !== 3 || pv.crumbs[1].href !== '#/settings') throw new Error('title and breadcrumbs name the section');
  if (!api.viewSettings('advanced').html.includes('Uninstall…') || !api.viewSettings('skills').html.includes('ax skills install')) throw new Error('advanced and skills sections');
  if (!/id="set-agents"/.test(api.viewSettings('nope').html)) throw new Error('an unknown section falls back to Agents & keys');
  if (!/id="h-notify" tabindex="-1"/.test(api.viewSettings('notifications').html)) throw new Error('section headings take focus after a switch');
  return v;
}, { exactAxo: 0 });
check('prototype tools are not in the product: no scenarios in Settings or the command palette', () => {
  const all = api.SETTINGS_SECTIONS.map((x) => api.viewSettings(x.slug).html).join('');
  if (/Prototype scenarios|data-action="scenario"|scen-grid/.test(all)) throw new Error('Settings still lists prototype scenarios');
  if (api.paletteItems().some((i) => /Prototype|scenario/i.test(i.label))) throw new Error('the command palette still lists prototype scenarios');
  const app = fs.readFileSync(dir + '/app.js', 'utf8');
  if (!/state\.settingsFocus = true/.test(app) || /'scroll-to'/.test(app)) throw new Error('switching sections should focus the new section; the old jump-link action should be gone');
});
check('review links page lists every scenario as a copyable link, outside the product', () => {
  const v = api.viewReview();
  if (!v.full) throw new Error('the review page is a full page, outside the app chrome');
  for (const sc of api.SCENARIOS) if (!v.html.includes(`href="?scenario=${sc.id}"`)) throw new Error('missing review link for ' + sc.id);
  if (!/href="\?reset"/.test(v.html) || !/href="#\/cuj\/1"/.test(v.html) || !/href="\?cuj=2"/.test(v.html)) throw new Error('journey links');
  if (!/isn't part of AX Studio/.test(v.html)) throw new Error('the page should say it is not part of the product');
  const app = fs.readFileSync(dir + '/app.js', 'utf8');
  if (!/r\.parts\[0\] !== 'review'/.test(app)) throw new Error('the review page should open before setup is done');
  return { html: v.html, full: true };
}, { exactAxo: 0 });
check('guardrails shows the inside-the-sandbox policy', () => { const v = api.viewGuardrails(); if (!/Inside the sandbox/.test(v.html) || /Allowed current/.test(v.html)) throw new Error('guardrails copy'); return v; }, { exactAxo: 1 });
check('V1: no story metaphors in functional labels', () => {
  S.setup = { phase: 'installing', step: 1, pick: 'claude', path: 'local' };
  const all = api.shellHTML() + api.viewHome().html + api.viewNew(new URLSearchParams('')).html + api.viewGuardrails().html + api.viewPlaces().html + api.viewSetup().html + api.viewTask('t4', 'activity').html;
  const all2 = all + api.viewSettings().html + api.viewTask('t1', 'activity').html;
  const bad = (all2.match(/spring ready|Isolated spring|Preparing your sanctuary|water is clear|water's clear|Allowed current|Local spring|Clear water|swimming cleanly|water's edge|Morning Spring|Moonlit Cenote|sheltered sandboxes|Axel checks with you|Axel pauses|team K8s|in guest/g) || []);
  if (bad.length) throw new Error('metaphor copy left: ' + [...new Set(bad)].join(', '));
});

// v5: renamed user, tail-wag rig, steady setup track, connected cluster in New task, prevent-before-Run
check('demo user is Rajitha: greeted by first name, with no account shown (no login)', () => {
  const all = api.shellHTML() + api.viewHome().html + api.viewSettings().html + api.viewTask('t1', 'terminal').html;
  if (/Rajitha Leonhard/.test(all) || !/Rajitha/.test(api.viewHome().html)) throw new Error('greet by first name only; no full name or account');
  if (/Sam Rivera|sam@|\bSam\b/.test(all)) throw new Error('old name left');
});
check('Axel has a clip-separated tail that can wag', () => {
  const h = api.axo('idle');
  if (!/class="axo-tail-wag"/.test(h) || !/clip-path="url\(#axel-tail-clip\)"/.test(h) || !/clip-path="url\(#axel-body-clip\)"/.test(h)) throw new Error('tail rig missing');
  if (!/id="axel-tail-clip"/.test(api.AXO_DEFS) || !/id="axel-body-clip"/.test(api.AXO_DEFS) || !/clip-rule="evenodd"/.test(api.AXO_DEFS)) throw new Error('clip defs missing');
  return { html: h, full: true };
}, { exactAxo: 1 });
check('setup keeps one step track at the top and animates only on phase change', () => {
  S.setup = { phase: 'before', step: 0, pick: 'claude', path: 'local' };
  const a = api.viewSetup().html, b = api.viewSetup().html;
  if (!/class="su-track"/.test(a) || !/aria-current="step"[^>]*>[\s\S]*?Choose where/.test(a)) throw new Error('track missing');
  if (!/setup-card view-enter/.test(a) || /setup-card view-enter/.test(b)) throw new Error('card should animate only when the phase changes');
  S.setup.phase = 'connect'; S.setup.path = 'cluster';
  const c = api.viewSetup().html;
  if (!/setup-card view-enter/.test(c) || !/Connect<\/li>/.test(c)) throw new Error('connect phase track');
  return { html: c, full: true };
}, { exactAxo: 1 });
check('New task uses the connected remote cluster', () => {
  S.env.cluster = 'ax-batch-eu';
  S.draft = null; const d = api.ensureDraft(new URLSearchParams('goal=Add+metrics')); d.env = 'cluster';
  if (!/--cluster ax-batch-eu/.test(api.draftCli(d)) || !/ax-batch-eu/.test(api.viewNew(new URLSearchParams('')).html)) throw new Error('cluster not used');
  S.env.cluster = 'ax-dev-us-central'; d.env = 'local';
});
check('readiness card flags MCP sign-in and pasted secrets before Run', () => {
  S.draft = null; const d = api.ensureDraft(new URLSearchParams('goal=Add+metrics')); S.mcpConnected = false;
  if (!api.draftChecks(d).every((c) => c.ok)) throw new Error('default draft should be ready');
  d.mcp = ['github', 'linear'];
  const c1 = api.draftChecks(d).find((c) => c.t === 'Workspace set up');
  if (!c1 || c1.ok || !/Linear needs sign-in/.test(c1.s)) throw new Error('MCP sign-in not flagged');
  d.mcp = ['github']; d.envVars = 'STRIPE_API_KEY=sk_live_123';
  const c2 = api.draftChecks(d).find((c) => c.t === 'Workspace set up');
  if (c2.ok || !/looks like a secret/.test(c2.s)) throw new Error('secret not flagged');
  d.envVars = '';
});

check('cluster runs push uncommitted changes first instead of copying them', () => {
  S.env.cluster = 'ax-batch-eu';
  S.draft = null; const d = api.ensureDraft(new URLSearchParams('goal=Add+metrics')); d.folderIdx = 1; d.env = 'cluster';
  let h = api.viewNew(new URLSearchParams('')).html;
  if (/data-key="includeUncommitted"/.test(h) || !/data-action="draft-push-first"/.test(h)) throw new Error('cluster run should offer push-first, not a local copy');
  let y = api.manifestYAML(api.draftSpec(d));
  if (/includeUncommitted/.test(y) || !/source: "https:\/\/github\.com\/acme\/web-app"/.test(y) || !/ax-batch-eu/.test(y)) throw new Error('cluster YAML should clone the repo on the chosen cluster');
  api.ACTIONS['draft-push-first'](fakeEl(), {});
  y = api.manifestYAML(api.draftSpec(d));
  if (!/branch: ax\/wip-web-app/.test(y) || !/Pushed 2 changes/.test(api.viewNew(new URLSearchParams('')).html)) throw new Error('push-first should switch the branch');
  S.env.cluster = 'ax-dev-us-central'; S.draft = null;
});
check('org blocks say who to ask', () => {
  const html = api.viewGuardrails().html;
  if (!/Ask platform-team@example\.com/.test(html)) throw new Error('org contact missing');
});
check('Guardrails: two presets, your sites on top, every block says why, rows instead of tables (exact 1 Axel)', () => {
  S.guardrailPreset = 'balanced';
  const mine = { domain: 'docs.example.org', scope: 'shop-api', by: 'You' };
  S.allow.push(mine);
  const v = api.viewGuardrails();
  if (Object.keys(api.GUARDRAIL_PRESETS).length !== 2 || /Custom|Tailored|Air-tight/.test(v.html)) throw new Error('two presets: Balanced and Locked down');
  if (/<table/.test(v.html)) throw new Error('lists are rows, not tables');
  for (const s of ['Network access', 'Sites you allowed', 'Recently blocked', 'Inside the sandbox', "Your organization's policy", 'Export policy YAML', 'ax guardrails preset balanced', 'href="#/settings/agents"', 'data-action="remove-allow"', 'id="sel-allow-scope"'])
    if (!v.html.includes(s)) throw new Error('missing ' + s);
  if (!/Not on the ax workspace's allowlist/.test(v.html) || !/Blocked by your organization's policy/.test(v.html)) throw new Error('each block says why');
  S.guardrailPreset = 'strict';
  const l = api.viewGuardrails().html;
  const inc = (l.match(/<div class="g-included">[\s\S]*?<\/ul>/) || [''])[0];
  if (/github\.com/.test(inc) || !/api\.anthropic\.com/.test(inc) || !/ax guardrails preset locked-down/.test(l)) throw new Error('Locked down includes only the model APIs');
  if (!/docs\.example\.org/.test(l)) throw new Error('your sites still apply under Locked down');
  S.guardrailPreset = 'balanced';
  S.allow.splice(S.allow.indexOf(mine), 1);
  return v;
}, { exactAxo: 1 });
check('Guardrails: adding a site is scoped, honest about duplicates, and never switches the preset', () => {
  S.guardrailPreset = 'balanced';
  const n0 = S.allow.length;
  if (api.addAllowedSite('not a site', 'all') !== false || !S.allowMsg || !S.allowMsg.err) throw new Error('invalid input says so');
  if (api.addAllowedSite('github.com', 'all') !== false || !/already included in Balanced/.test(S.allowMsg.text) || S.allow.length !== n0) throw new Error('a preset site is already included, and nothing is added');
  if (api.addAllowedSite('pastebin.com', 'shop-api') !== false || !/organization/.test(S.allowMsg.text)) throw new Error('org-blocked sites say so');
  if (api.addAllowedSite('https://api.stripe.com/v1', 'shop-api') !== true || S.allowMsg) throw new Error('add for one workspace');
  const r = S.allow.find((a) => a.domain === 'api.stripe.com');
  if (!r || r.scope !== 'shop-api' || r.by !== 'You' || !r.at) throw new Error('recorded with its workspace and time');
  if (api.addAllowedSite('api.stripe.com', 'shop-api') !== false) throw new Error('the same rule twice says so');
  if (api.addAllowedSite('api.stripe.com', 'all') !== true || S.allow.filter((a) => a.domain === 'api.stripe.com').length !== 1 || S.allow.find((a) => a.domain === 'api.stripe.com').scope !== 'all') throw new Error('allowing everywhere replaces the narrower rule');
  S.guardrailPreset = 'strict';
  if (api.siteAllowed('github.com', 'web-app')) throw new Error('Locked down leaves out github.com');
  if (api.addAllowedSite('github.com', 'all') !== true || S.guardrailPreset !== 'strict') throw new Error('under Locked down, a site you add goes on top, and the preset stays');
  if (!api.siteAllowed('github.com', 'web-app')) throw new Error('your site applies under Locked down');
  S.allow = S.allow.filter((a) => !(a.by === 'You' && ['api.stripe.com', 'github.com'].includes(a.domain)));
  S.guardrailPreset = 'balanced'; S.allowMsg = null; S.allowDraft = '';
});
check('Guardrails: allowing a site a task is waiting on lets the task carry on, and a cluster block says who to ask', () => {
  const tc = JSON.parse(JSON.stringify(api.getTask('t1')));
  tc.id = 'twait'; tc.step = 2; tc.status = 'running';
  S.tasks.push(tc);
  api.runStep(tc);
  if (tc.status !== 'blocked') throw new Error('expected blocked');
  const b = tc.events.filter((e) => e.type === 'blocked' && !e.resolved).pop();
  if (!/Waiting for you<\/b>/.test(api.viewGuardrails().html)) throw new Error('the blocked row should say the task is waiting');
  const el = fakeEl(); el.dataset = { domain: b.domain, scope: tc.repo, task: 'twait' };
  api.ACTIONS['allow-domain'](el, { preventDefault() {} });
  if (b.resolved !== 'allowed' || tc.status !== 'running') throw new Error('the waiting task should carry on');
  S.tasks.splice(S.tasks.indexOf(tc), 1);
  S.allow = S.allow.filter((a) => !(a.domain === b.domain && a.by === 'You'));
  S.blockedLog.push({ at: Date.now(), task: 't3', domain: 'cdn.example.net', reason: 'policy', purpose: 'Fetch a font' });
  const h = api.viewGuardrails().html;
  const row = (h.match(/cdn\.example\.net[\s\S]*?<\/div>\s*<\/div>\s*([\s\S]*?)<\/div>/) || [])[1] || '';
  if (!/Blocked by your organization's policy · “Fetch a font”/.test(h) || !/Ask platform-team@example\.com/.test(row) || /data-domain="cdn\.example\.net"/.test(h)) throw new Error('a block on a remote cluster is the organization\'s call');
  S.blockedLog.pop();
});
check('Guardrails: allowing a blocked request records its workspace and task, and the row says Allowed', () => {
  const el = fakeEl(); el.dataset = { domain: 'unpkg.com', scope: 'ax', task: 't6' };
  api.ACTIONS['allow-domain'](el, { preventDefault() {} });
  const r = S.allow.find((a) => a.domain === 'unpkg.com' && a.scope === 'ax');
  if (!r || r.task !== 't6') throw new Error('the rule should record the task it came from');
  const h = api.viewGuardrails().html;
  if (!/allowed from <a href="#\/task\/t6"/.test(h) || !/<span class="chip done">/.test(h)) throw new Error('the row links back to the task, and the block shows Allowed');
  S.allow.splice(S.allow.indexOf(r), 1);
});

check('Copy diagnostics includes the failure it was copied from', () => {
  let copied = '';
  ctx.navigator.clipboard.writeText = (txt) => { copied = txt; return Promise.resolve(); };
  const t = api.spawnFailure('quota');
  const el = fakeEl(); el.dataset = { code: 'quota', task: t.id };
  api.ACTIONS.diagnostics(el, {});
  const j = JSON.parse(copied);
  if (!j.failure || j.failure.code !== 'quota' || !j.failure.cause || !j.environment || j.environment.health == null) throw new Error('diagnostics missing failure/environment');
  if (/sk_live|ghp_[A-Za-z0-9]{6,}/.test(copied)) throw new Error('secret leaked into diagnostics');
});

/* ---------- v6: one standard task layout, no icons on tabs/titles, one button language, no duplicate content, a11y ---------- */
check('v6: every task tab keeps the same layout (inspector on all tabs, no wide mode, no tab icons, roving tabindex)', () => {
  let last;
  for (const tab of ['activity', 'changes', 'terminal']) {
    const v = api.viewTask('t3', tab);
    if (v.wide) throw new Error('wide mode on ' + tab);
    if (!/id="task-side"/.test(v.html)) throw new Error('inspector missing on ' + tab);
    const tl = (v.html.match(/role="tablist"[\s\S]*?<\/div>/) || [''])[0];
    if (/class="svg/.test(tl)) throw new Error('icon in tabs on ' + tab);
    if ((tl.match(/tabindex="0"/g) || []).length !== 1) throw new Error('roving tabindex broken on ' + tab);
    if (!new RegExp('role="tabpanel" class="task-panel" id="panel-' + tab + '"').test(v.html)) throw new Error('tabpanel missing on ' + tab);
    last = v;
  }
  return last;
});
check('v6: task header has no Pause/Resume/Retry (they live once, in Your next step)', () => {
  for (const id of ['t1', 't2', 't3', 't6']) {
    const h = api.viewTask(id, 'activity').html;
    const head = (h.match(/id="task-head">([\s\S]*?)<div class="task-grid">/) || [, ''])[1];
    if (/data-action="(retry|pause|resume)"/.test(head)) throw new Error('duplicate control in header of ' + id);
    if (/class="svg[^"]*"[^>]*>[\s\S]{0,400}?<\/svg>\s*<\/span>\s*<h1/.test(head)) throw new Error('icon before title in ' + id);
  }
});
check('v6: Changes ships only when the agent has finished; one primary per screen', () => {
  const run = api.viewTask('t3', 'changes').html;
  if (/data-action="push"|data-action="apply"/.test(run)) throw new Error('running task offers Push/Apply');
  if (!/is still working/.test(run)) throw new Error('running task should explain when shipping unlocks');
  /* CUJ 4: t6 was handed off to t5, so its Changes is a snapshot that points to the current task; t5 ships. */
  const handed = api.viewTask('t6', 'changes').html;
  if (/data-action="push"|data-action="apply"/.test(handed) || !/Continues with Antigravity/.test(handed) || !/href="#\/task\/t5\/changes"/.test(handed)) throw new Error('a handed-off task should not ship; it points to the current task');
  const done = api.viewTask('t5', 'changes').html;
  const prim = (done.match(/class="btn primary/g) || []).length;
  if (prim !== 1 || !/data-action="(push|open-pr)"/.test(done)) throw new Error('done task should have exactly one primary (Push, or Open pull request once pushed), got ' + prim);
  if (/\b1 files\b/.test(run + done)) throw new Error('"1 files" copy');
  return { html: done };
});
check('v6: a failed task says the fix once (Your next step), the timeline points to it', () => {
  const t = api.spawnFailure('quota');
  const h = api.viewTask(t.id, 'activity').html;
  const tl = (h.match(/<ol class="timeline"[\s\S]*?<\/ol>/) || [''])[0];
  if (/data-action="fix"/.test(tl)) throw new Error('fix buttons duplicated in the timeline');
  if (!/data-action="focus-next"/.test(tl)) throw new Error('timeline should point to Your next step');
  const fix = api.ERRORS.quota && typeof api.ERRORS.quota.fix === 'string' ? api.ERRORS.quota.fix : null;
  if (fix && h.split(fix).length - 1 > 1) throw new Error('fix sentence repeated');
  if (/data-action="promote"/.test(h)) throw new Error('failed task offers Run on a remote cluster');
  return { html: h };
});
check('v6: Home has no icon tiles, no duplicate New task primary, compact rail', () => {
  ctx.location.hash = '#/';
  const h = api.viewHome().html;
  if (/needs-badge|st-icon|h-icon|One unified CLI|This computer<\/h2>/.test(h)) throw new Error('removed Home content is back');
  const src = fs.readFileSync(dir + '/views.js', 'utf8');
  if (/emptyHTML\([^)]*btn primary/.test(src)) throw new Error('an empty state repeats the New task primary');
  return { html: h };
});
check('v6: Guardrails/Places/Settings de-duplicated; Settings has the shortcut switch', () => {
  const g = api.viewGuardrails().html, p = api.viewPlaces().html, s = api.viewSettings('accessibility').html;
  if (/class="stats"/.test(g)) throw new Error('Guardrails stats strip is back');
  if (/aqueduct-map/.test(p)) throw new Error('Places aqueduct is back');
  if (!/id="singleKeys"[^>]*role="switch"|role="switch"[^>]*id="singleKeys"/.test(s)) throw new Error('single-key switch missing');
});
check('v6: actions are buttons, not href="#" links; static rows are not aria-disabled', () => {
  const pages = [api.viewHome().html, api.viewTask('t3', 'activity').html, api.viewGuardrails().html, api.viewPlaces().html, api.viewSettings().html];
  for (const h of pages) {
    if (/href="#"/.test(h)) throw new Error('href="#" found: ' + (h.match(/.{0,60}href="#".{0,60}/) || [])[0]);
    if (/<div class="radio-card[^"]*"[^>]*aria-disabled/.test(h)) throw new Error('aria-disabled on a static row');
  }
  const idx = fs.readFileSync(dir + '/index.html', 'utf8');
  if (!/<button type="button" class="skip-link" data-action="skip-to-main">/.test(idx)) throw new Error('skip link should be a button (hash router)');
});

/* ---------- Easter egg: Axel's tricks ---------- */
check('Axel has a gill rig (clip-separated, recombines at rest) and trick layers', () => {
  const h = api.axo('idle');
  if (!/class="axo-gill axo-gill-l"/.test(h) || !/class="axo-gill axo-gill-r"/.test(h)) throw new Error('gill groups missing');
  if (!/clip-path="url\(#axel-gill-l-clip\)"/.test(h) || !/id="axel-gill-r-clip"/.test(api.AXO_DEFS)) throw new Error('gill clips missing');
  if (!/class="axo-tfx-under"/.test(h) || !/class="axo-tfx"/.test(h) || !/class="axo-act"/.test(h)) throw new Error('trick layers missing');
  if ((api.AXO_DEFS.match(/id="axel-body-clip"[\s\S]*?<\/clipPath>/) || [''])[0].split(' Z').length < 4) throw new Error('static body must cut out tail + both gill regions');
  return { html: h, full: true };
}, { exactAxo: 1 });
check('easter egg: 2 wags, then 7 different tricks; a click mid-trick plays next (never lost, never more than one); poking the nap wakes him; a 4 s pause resets', () => {
  const realNow = Date.now; let t = realNow() + 1e7; Date.now = () => t;   // far enough ahead that any earlier streak has lapsed
  try {
    const S = api.axoStreak;
    S.queued = null; S.endsAt = 0; S.napping = false;
    const cls = new Set(); const over = { innerHTML: '' }, under = { innerHTML: '' };
    const svg = {
      classList: { add: (...c) => c.forEach((x) => cls.add(x)), remove: (...c) => c.forEach((x) => cls.delete(x)), contains: (x) => cls.has(x), [Symbol.iterator]: () => cls.values() },
      querySelector: (q) => (q === '.axo-tfx' ? over : q === '.axo-tfx-under' ? under : null), querySelectorAll: () => [over, under], getBoundingClientRect: () => ({}),
    };
    const seq = [], fx = {};
    const note = (r) => { const k = r ? (r.queued ? 'queued' : r.trick ? r.trick.k : r.woke ? 'woke' : 'wag') : 'null'; seq.push(k); if (r && r.trick) fx[k] = { cls: [...cls].join(' '), over: over.innerHTML, under: under.innerHTML }; };
    /* advance the clock; when a trick's time is up, run its end-of-trick timer (the fake DOM's setTimeout never fires) */
    const wait = (ms) => { t += ms; if (S.endsAt && t >= S.endsAt) api.axoEndTrick(false); };
    const tap = () => note(api.axoTap(svg, { onPlay: (r) => note(r) }));
    tap(); wait(1200); tap(); wait(1200);
    tap();                       // gills
    wait(300); tap();            // mid-gills: queued …
    tap();                       // … and a second extra click is dropped (returns queued, nothing else lined up)
    wait(800);                   // gills ends → the queued click plays: wink
    wait(1000);                  // wink ends
    tap(); wait(1600);           // bubble
    tap(); wait(1300);           // look
    tap(); wait(1600);           // blush
    tap(); wait(1200);           // flip
    tap();                       // nap
    if (!api.axoBusy()) throw new Error('Axel should report busy during the nap');
    wait(1500); tap();           // poke the nap → he wakes (counts as click 1)
    wait(1000); tap();           // click 2 → wag
    wait(4500); tap();           // after a 4 s pause → wag again (streak reset)
    wait(1000); tap(); wait(1000); tap();   // wag, gills
    const want = ['wag', 'wag', 'gills', 'queued', 'queued', 'wink', 'bubble', 'look', 'blush', 'flip', 'nap', 'woke', 'wag', 'wag', 'wag', 'gills'];
    if (JSON.stringify(seq) !== JSON.stringify(want)) throw new Error('sequence ' + seq.join(','));
    if (!/axo-trick--wink/.test(fx.wink.cls) || !/tf-spark/.test(fx.wink.over)) throw new Error('wink fx');
    if (!/tf-blush/.test(fx.blush.under) || !/tf-bub/.test(fx.bubble.over) || !/tf-z/.test(fx.nap.over) || !/tf-happy/.test(fx.flip.over)) throw new Error('trick fx');
    api.axoYield();
    if (api.axoBusy()) throw new Error('axoYield should release held renders');
    if (new Set(api.AXO_TRICKS.map((x) => x.k)).size !== 7 || api.AXO_TRICKS.some((x) => !x.say || x.say.length > 70 || x.ms > 4000)) throw new Error('tricks must be distinct, short and brief');
  } finally { Date.now = realNow; api.axoEndTrick(true); }
});
check('background refreshes wait for Axel; user actions do not', () => {
  const realNow = Date.now; let t = realNow() + 2e7; Date.now = () => t;
  try {
    const S = api.axoStreak;
    ctx.location.hash = '#/'; api.render();
    const before = namedEls['#main'].innerHTML;
    S.animUntil = t + 900;                       // Axel mid-trick
    namedEls['#main'].innerHTML = 'SENTINEL';
    api.render({ keepScroll: true, background: true });
    if (namedEls['#main'].innerHTML !== 'SENTINEL') throw new Error('a background render replaced the page while Axel was busy');
    api.render({ keepScroll: true });            // a user action renders immediately
    if (namedEls['#main'].innerHTML === 'SENTINEL') throw new Error('a user-initiated render was held back');
    S.animUntil = 0;
    if (!before) throw new Error('home did not render');
  } finally { Date.now = realNow; api.axoStreak.animUntil = 0; }
});

check('after signing in again, a key-rejected task points to Retry (no stale "add a new key")', () => {
  const t = api.getTask('t4'); const A = api.AGENTS[t.agent];
  const before = api.failActionsHTML('key-rejected', { t }, 2);
  if (A.connected && !A.keyProblem) throw new Error('fixture: t4 agent should start disconnected');
  if (!/data-fix="update-key"/.test(before)) throw new Error('Fix sign-in should lead before the fix');
  const saved = [A.connected, A.keyProblem]; A.connected = true; A.keyProblem = '';
  try {
    const after = api.failActionsHTML('key-rejected', { t }, 2);
    if (!/class="btn sm primary" data-action="fix" data-fix="retry"/.test(after) || /update-key/.test(after)) throw new Error('Retry should be the primary once signed in: ' + after.slice(0, 120));
    if (!/signed in again/.test(api.viewTask('t4', 'activity').html)) throw new Error('Your next step should say the sign-in is fixed');
  } finally { A.connected = saved[0]; A.keyProblem = saved[1]; }
});

check('compatible circle fill (no black circle fills) and smooth pipeline/Axel glide transitions', () => {
  const styles = fs.readFileSync(dir + '/styles.css', 'utf8');
  const views = fs.readFileSync(dir + '/views.css', 'utf8');
  const polish = fs.readFileSync(dir + '/polish.css', 'utf8');
  /* v15: primary buttons are black ink (white in dark mode). "On" states (step checks, circle fills, switches) use the
     spring-water accent, never black. */
  if (!/--primary:\s*#223142;[\s\S]*--grad-primary:\s*linear-gradient\(180deg,\s*var\(--primary\) 0%,\s*var\(--primary-2\) 100%\)/.test(styles)) throw new Error('missing light --primary / --grad-primary');
  if (!/--primary:\s*#FFFFFF;/.test(styles)) throw new Error('missing dark --primary');
  if (!/--accent:\s*#0369A1;/.test(styles) || !/--accent:\s*#38BDF8;/.test(styles)) throw new Error('missing the light or dark --accent');
  if ((styles.match(/--circle-fill:\s*var\(--grad-accent\)/g) || []).length !== 2) throw new Error('circle fill should be the accent gradient in both themes');
  if (!/\.btn\.primary \{[^}]*color: var\(--primary-ink\);[^}]*background: var\(--grad-primary\)/.test(styles)) throw new Error('the primary button should use the primary gradient');
  if (/--btn-bg|--btn-ink|--btn-hover|--grad-ink/.test(styles + views + polish + fs.readFileSync(dir + '/core.js', 'utf8'))) throw new Error('the old black button tokens should be gone');
  if (/\.btn\.primary[^{]*\{[^}]*background/.test(polish)) throw new Error('the primary button is defined once (styles.css), not again in polish.css');
  if (!/--ease-glide:\s*cubic-bezier\(\.22,\s*1,\s*\.36,\s*1\)/.test(styles)) throw new Error('missing --ease-glide');
  if (!/\.stone\.ok\s+\.sb\s*\{[^}]*var\(--circle-fill\)/.test(views)) throw new Error('.stone.ok .sb must use --circle-fill');
  if (!/\.jr-step\.ok\s+\.jr-bead\s*\{[^}]*var\(--circle-fill\)/.test(views) || !/\.jr-step\.ok\s+\.jr-bead\s*\{[^}]*var\(--circle-fill\)/.test(polish)) throw new Error('.jr-step.ok .jr-bead must use --circle-fill');
  if (!/\.ready-list\s+\.ok\s+\.rb\s*\{[^}]*var\(--circle-fill\)/.test(views)) throw new Error('.ready-list .ok .rb must use --circle-fill');
  if (/\.review-steps|\.seg-progress/.test(views + polish)) throw new Error('Changes has no second row of step labels (one row of tabs per page)');
  if (!/\.file-item\s+\.fv\.seen\s*\{[^}]*var\(--circle-fill\)/.test(views)) throw new Error('.file-item .fv.seen must use --circle-fill');
  if (/\.stone\.ok\s+\.sb\s*\{[^}]*var\(--btn-bg\)/.test(views) || /\.jr-step\.ok\s+\.jr-bead\s*\{[^}]*var\(--(btn-bg|grad-ink)\)/.test(views + polish)) throw new Error('black circle fill still present');
  const jh = api.journeyHTML(api.getTask('t1'));
  if (!/^<span class="mini-journey" role="img" aria-label="Step \d of 6: [A-Z][a-z]+[^"]*" title="/.test(jh) || (jh.match(/<i class=/g) || []).length !== 6) throw new Error('journeyHTML is the mini track (six bars, step N of 6): ' + jh.slice(0, 160));
});

// ---------- CUJ 2 · Deploy your first agent: the user prompt, pre-built vs. find or bring your own ----------
check('CUJ 2: New task shows four equal cards: Antigravity (picked), Claude Code, Codex, then Your own agent; Browse templates below', () => {
  ctx.location.hash = '#/new'; api.render();
  S.draft = null;
  const v = api.viewNew(new URLSearchParams(''));
  if (/Pre-built templates · maintained by AX/.test(v.html)) throw new Error('the old pre-built label should be gone');
  const ids = (v.html.match(/data-action="pick-agent" data-agent="[a-z]+"/g) || []).map((m) => m.split('"')[3]).join(',');
  if (ids !== 'antigravity,claude,codex') throw new Error('template cards should read Antigravity, Claude Code, Codex: ' + ids);
  if (!/role="radio" aria-checked="true" data-action="pick-agent" data-agent="antigravity"/.test(v.html)) throw new Error('Antigravity should be picked by default');
  if (!/<div class="tpl-wrap"><div class="tpl-grid">\s*<div class="agent-picker" role="radiogroup" aria-labelledby="step-agent">/.test(v.html)) throw new Error('the four cards should share one grid, with the templates as one radio group');
  if (!/<\/button>\s*<\/div>\s*<button type="button" class="choice byo-card" data-action="find-agent" data-tab="byo" id="find-byo" aria-haspopup="dialog">/.test(v.html)) throw new Error('Your own agent should be a button right after the radio group, so arrowing through the templates never opens a dialog');
  if (!/<span class="c-title">Your own agent<\/span><span class="c-desc">Built with ADK or anything else/.test(v.html)) throw new Error('Your own agent card copy');
  if (!/More templates from your team or the AX catalog/.test(v.html) || !/data-action="find-agent" data-tab="browse"/.test(v.html)) throw new Error('missing Browse templates');
  if (/Your templates/.test(v.html)) throw new Error('no added templates yet');
  if (!/class="gh-label">Try/.test(v.html)) throw new Error('empty goal should show suggestions');
  return v;
}, { exactAxo: 1 });
check('CUJ 2: prompt help shows missing tips, adds editable lines, then says the goal is clear', () => {
  const d = S.draft; d.goal = 'Add metrics to the orders API';
  let h = api.goalHelpHTML(d);
  if ((h.match(/data-action="goal-tip"/g) || []).length !== 3) throw new Error('expected 3 tips: ' + h);
  api.ACTIONS['goal-tip']({ dataset: { tip: 'done' } });
  if (!/\nDone when:/.test(d.goal)) throw new Error('tip not appended: ' + d.goal);
  h = api.goalHelpHTML(d);
  if (/data-tip="done"/.test(h) || (h.match(/data-action="goal-tip"/g) || []).length !== 2) throw new Error('done tip should be gone');
  api.ACTIONS['goal-tip']({ dataset: { tip: 'where' } }); api.ACTIONS['goal-tip']({ dataset: { tip: 'keep' } });
  if (!/Clear goal/.test(api.goalHelpHTML(d))) throw new Error('should say clear goal');
  if (!/Goal described/.test(api.readyHTML(d)) || /Done when/.test(api.readyHTML(d))) throw new Error('ready card should show only the first line');
  return api.viewNew(new URLSearchParams(''));
}, { exactAxo: 1 });
check('CUJ 2: catalog asks for your team\'s registry address and lists verified + community, with no Axel', () => {
  S.teamRegistry = null;
  api.openAgentCatalog({ tab: 'browse' });
  const html = namedEls['#overlay'].innerHTML;
  if (!/See templates your team shared/.test(html) || !/Add registry…/.test(html) || /Sign in with Google/.test(html)) throw new Error('missing team registry row');
  if (!/data-cat="gemini-cli"/.test(html) || !/data-cat="openhands"/.test(html) || !/data-cat="aider"/.test(html)) throw new Error('missing catalog rows');
  if (/data-cat="review-bot"/.test(html)) throw new Error('team agents wait for a registry address');
  if (!/role="tablist"/.test(html) || !/role="tabpanel"/.test(html) || !/ax templates search/.test(html)) throw new Error('tabs or CLI missing');
  if (countAxo(html) !== 0) throw new Error('dialogs have no Axel');
  api.openAgentCatalog({ tab: 'byo' });
  const b = namedEls['#overlay'].innerHTML;
  if (!/Where is your agent\?/.test(b) || !/data-byok="image"/.test(b) || !/Check agent/.test(b) || !/ax templates add ~\/code\/triage-agent</.test(b) || /ax templates add \.\//.test(b)) throw new Error('bring-your-own panel incomplete (the command should use the full path, so it works from any folder)');
});
check('CUJ 2: with your team\'s registry, team agents appear; search and filters narrow results; empty search offers bring your own', () => {
  S.teamRegistry = 'registry.acme.dev/ax';
  const cs = { tab: 'browse', q: '', filter: 'all', view: 'list', byo: {} };
  let r = api.catResultsHTML(cs);
  if (!/data-cat="review-bot"/.test(r.html) || r.n !== 5) throw new Error('expected 5 agents, got ' + r.n);
  cs.q = 'upgrade'; r = api.catResultsHTML(cs);
  if (r.n !== 1 || !/dep-upgrader/.test(r.html)) throw new Error('search failed: ' + r.n);
  cs.q = ''; cs.filter = 'community'; r = api.catResultsHTML(cs);
  if (r.n !== 2 || /review-bot/.test(r.html)) throw new Error('filter failed');
  cs.filter = 'all'; cs.q = 'zzzz'; r = api.catResultsHTML(cs);
  if (r.n !== 0 || !/No templates match/.test(r.html) || !/data-catx="to-byo"/.test(r.html)) throw new Error('empty state missing');
});
check('CUJ 2: agent details say what it needs, what it can reach, trust, and where it runs', () => {
  const html = api.catDetailHTML({ sel: 'review-bot' });
  for (const k of ['Model and sign-in', 'What it can reach', 'Signed image', 'remote clusters', 'hooks.slack.com', 'asks you first', 'Already allowed', 'paused until you allow it']) if (!html.includes(k)) throw new Error('missing ' + k);
  const c = api.catDetailHTML({ sel: 'openhands' });
  if (!/Not reviewed by AX/.test(c) || !/from Claude Code/.test(c)) throw new Error('community trust / key reuse missing');
  const foot = api.catFootHTML({ tab: 'browse', view: 'detail', sel: 'review-bot', q: '', byo: {} });
  if (!/ax templates add acme\/review-bot/.test(foot) || !/Add and use/.test(foot)) throw new Error('detail footer wrong: ' + foot);
});
check('CUJ 2: Add and use selects a team agent on New task; manifest uses its image', () => {
  ctx.location.hash = '#/new'; api.render();
  S.draft = null; api.ensureDraft(new URLSearchParams(''));
  S.draft.goal = 'Review the checkout branch';
  const a = api.addCatalogAgent('review-bot');
  if (!a || !api.AGENTS['review-bot'] || S.draft.agent !== 'review-bot') throw new Error('not selected: ' + (S.draft && S.draft.agent));
  if (S.draft.goal !== 'Review the checkout branch') throw new Error('goal should be kept');
  const v = api.viewNew(new URLSearchParams(''));
  if (!/Your templates/.test(v.html) || !/id="agent-review-bot"/.test(v.html) || !/c-tag s-team">Team/.test(v.html)) throw new Error('your agents row missing');
  if (!/Team template · /.test(api.readyHTML(S.draft))) throw new Error('ready card should name the source');
  if (!S.allow.some((x) => x.domain === 'generativelanguage.googleapis.com')) throw new Error('model API should be allowed like pre-built ones');
  const y = api.manifestYAML(api.draftSpec(S.draft));
  if (!/image: registry\.acme\.dev\/agents\/review-bot:2\.3\.0/.test(y) || !/harness: acme\/review-bot/.test(y)) throw new Error('manifest image wrong');
  return v;
}, { exactAxo: 1 });
check('CUJ 2: the first task runs with the added agent; title is the first line of the goal', () => {
  S.draft.goal = 'Review the checkout branch\nDone when: the tests pass and the new behavior has a test.';
  const before = S.tasks.length;
  api.createTaskFromDraft();
  const t = S.tasks[0];
  if (S.tasks.length !== before + 1 || t.agent !== 'review-bot') throw new Error('task not created with review-bot');
  if (t.title !== 'Review the checkout branch') throw new Error('title should be the first line: ' + t.title);
  const v = api.viewTask(t.id, 'activity');
  if (!/registry\.acme\.dev\/agents\/review-bot:2\.3\.0/.test(v.html)) throw new Error('inspector should show the agent image');
  return v;
}, { exactAxo: 1 });
check('CUJ 2: bring your own · a folder passes the checks and becomes one of your agents', () => {
  const p = api.byoPlan('folder', '~/code/triage-agent');
  if (p.name !== 'Triage Agent' || p.rows.some((r) => r.cls === 'no')) throw new Error('triage-agent should pass');
  const cs = { tab: 'byo', byo: { kind: 'folder', folder: '~/code/triage-agent', value: {}, phase: 'ok', rows: p.rows, plan: p, name: 'Triage Agent' } };
  const h = api.byoChecksHTML(cs);
  if (!/All checks passed/.test(h) || !/ax templates publish triage-agent/.test(h) || !/id="byo-name"/.test(h)) throw new Error('ok state incomplete');
  if (!/Add and use/.test(api.catFootHTML(cs))) throw new Error('primary should be Add and use');
  S.draft = null; api.ensureDraft(new URLSearchParams(''));
  const a = api.addByoAgent(cs);
  if (!a || a.source !== 'yours' || !a.localOnly || a.image !== 'ax.local/triage-agent:dev' || S.draft.agent !== a.id) throw new Error('byo agent not added/selected');
  if (a.cli !== a.id || !/--template triage-agent\b/.test(api.draftCli(S.draft)) || /\.\/triage-agent/.test(api.draftCli(S.draft) + api.manifestYAML(api.draftSpec(S.draft)))) throw new Error('an added folder template runs by its name, from any folder: ' + api.draftCli(S.draft));
  const v = api.viewNew(new URLSearchParams(''));
  if (!/c-tag s-yours">Yours/.test(v.html) || !/local build|Sign in with Google to use/.test(v.html)) throw new Error('yours card missing');
  return v;
}, { exactAxo: 1 });
check('CUJ 2: bring your own · failures explain the fix (harness, secret, unsigned image, bad input)', () => {
  const leg = api.byoPlan('folder', '~/code/legacy-bot');
  if (!leg.rows.some((r) => r.cls === 'no' && r.fix === 'harness')) throw new Error('legacy-bot should fail the harness check');
  const sec = api.byoPlan('folder', '~/code/standup-agent');
  if (!sec.rows.some((r) => r.cls === 'no' && r.fix === 'secret')) throw new Error('standup-agent should fail the secret check');
  const cs = { tab: 'byo', byo: { kind: 'folder', folder: '~/code/legacy-bot', value: {}, phase: 'fail', rows: leg.rows.slice(0, 3), plan: leg } };
  const h = api.byoChecksHTML(cs);
  if (!/How to fix it/.test(h) || !/ax-harness/.test(h) || !/Check again/.test(api.catFootHTML(cs))) throw new Error('fix missing');
  const img = api.byoPlan('image', 'ghcr.io/rajitha/triage-agent:latest');
  if (!img.rows.some((r) => r.cls === 'warn' && /Not signed/.test(r.title))) throw new Error('unsigned image should warn');
  if (!api.byoInputError('image', 'not an image') || !api.byoInputError('git', 'ftp://x') || api.byoInputError('git', 'https://github.com/you/agent') || api.byoInputError('image', 'ghcr.io/you/agent:1.0')) throw new Error('input validation wrong');
  if (api.byoBase('git', 'git@github.com:you/my-agent.git') !== 'my-agent' || api.byoBase('image', 'ghcr.io/you/triage-agent:1.0@sha256:abcdef12') !== 'triage-agent') throw new Error('base name wrong');
});
check('CUJ 2: an agent built on this computer runs here; a remote cluster waits until it is published', () => {
  const d = S.draft; d.goal = 'Label the open issues'; d.env = 'cluster';
  api.AGENTS[d.agent].connected = true;
  const where = api.draftChecks(d)[1];
  if (where.ok || !/Publish/.test(where.t)) throw new Error('cluster + local-only agent should block: ' + JSON.stringify(where));
  const before = S.tasks.length; api.createTaskFromDraft();
  if (S.tasks.length !== before) throw new Error('should not start on a cluster');
  d.env = 'local';
  if (!api.draftChecks(d)[1].ok) throw new Error('local should be fine');
});
check('CUJ 2: remove + undo, setup lists pre-built only and links to find, ?find opens once, Settings manages agents', () => {
  const id = 'review-bot';
  api.ACTIONS['remove-agent']({ dataset: { agent: id } });
  if (!api.AGENTS[id].removed || api.agentList().some((a) => a.id === id)) throw new Error('not removed');
  if (/id="agent-review-bot"/.test(api.viewNew(new URLSearchParams('')).html)) throw new Error('removed agent still listed');
  api.addAgent(api.AGENTS[id]);
  if (api.AGENTS[id].removed) throw new Error('undo failed');
  S.setup = { phase: 'ready', step: 4, pick: 'claude', path: 'local' };
  const sv = api.viewSetup();
  if (/review-bot|triage-agent/.test(sv.html) || !/#\/new\?find=browse/.test(sv.html)) throw new Error('setup should list pre-built only and link to find');
  if (!/data-action="setup-find"/.test(sv.html) || !/^[\s\S]*?data-action="setup-finish"/.exec(sv.html)[0].includes('btn primary lg')) throw new Error('the first setup-finish must stay Start my first task (demo recorder relies on it)');
  S.draft = null;
  const v = api.viewNew(new URLSearchParams('find=byo'));
  if (typeof v.after !== 'function') throw new Error('?find should open the dialog');
  if (api.viewNew(new URLSearchParams('find=byo')).after) throw new Error('?find should open only once');
  const st = api.viewSettings();
  if (!/data-action="remove-agent"/.test(st.html) || !/Add an agent…/.test(st.html)) throw new Error('settings should manage added agents');
  return st;
}, { exactAxo: 0 });
check('CUJ 2: added agents persist without credentials; palette can find or bring an agent', () => {
  const saved = JSON.parse(store['ax.agents'] || '[]');
  if (!saved.some((x) => x.id === 'review-bot') || saved.some((x) => 'connected' in x || 'keyHint' in x)) throw new Error('persisted list wrong');
  const items = api.paletteItems().map((i) => i.label + ' ' + i.cli).join('\n');
  if (!/Find a template/.test(items) || !/ax templates add/.test(items)) throw new Error('palette entries missing');
});

// ---------- CUJ 1 on its own (?cuj=1): overview, ribbon, end strip ----------
check('CUJ 1: overview has the title, description, both paths, 7 failures and success criteria (exact 1 Axel)', () => {
  delete store['ax.setup'];
  ctx.location.hash = '#/cuj/1'; api.render();
  if (ctx.location.hash !== '#/cuj/1') throw new Error('overview should not redirect before setup: ' + ctx.location.hash);
  if (S.cuj !== 1) throw new Error('state.cuj should be 1');
  const v = api.viewCuj1();
  for (const k of ['CUJ 1', 'The installation experience', 'Path A', 'Path B', 'On this computer', 'Connect to a remote cluster', 'What can go wrong', 'Success looks like', 'Next: CUJ 2']) if (!v.html.includes(k)) throw new Error('missing ' + k);
  if ((v.html.match(/data-action="cuj-path"/g) || []).length !== 2) throw new Error('expected 2 path tiles');
  if ((v.html.match(/data-action="cuj-scenario"/g) || []).length !== 7) throw new Error("expected 7 failure chips (disk, free memory and installed memory are separate states)");
  if ((v.html.match(/class="btn primary/g) || []).length) throw new Error('overview should not add a competing primary');
  return Object.assign({}, v, { full: true });
}, { exactAxo: 1 });
check('CUJ 1: each path starts fresh with a ribbon that names it; the Ready screen offers the other path', () => {
  store['ax.setup'] = '1';
  api.startCujPath('cluster');
  if (store['ax.setup'] || S.setup.path !== 'cluster' || S.setup.phase !== 'before') throw new Error('cluster path should start fresh');
  let h = api.viewSetup().html;
  if (!/class="cuj-ribbon"/.test(h) || !/Path B · Connect to a remote cluster/.test(h) || !/href="#\/cuj\/1"/.test(h)) throw new Error('ribbon missing for Path B');
  api.startCujPath('local');
  h = api.viewSetup().html;
  if (!/Path A · On this computer/.test(h)) throw new Error('ribbon missing for Path A');
  S.setup.phase = 'ready'; S.setup.path = 'local';
  h = api.viewSetup().html;
  if (!/End of CUJ 1/.test(h) || !/data-action="cuj-path" data-path="cluster"/.test(h)) throw new Error('end strip should offer the cluster path');
  if (!/^[\s\S]*?data-action="setup-finish"/.exec(h)[0].includes('btn primary lg')) throw new Error('Start my first task must stay the first setup-finish');
  return { html: h, full: true };
}, { exactAxo: 1 });
check('CUJ 1: failure scenarios start from the overview and say which failure you are looking at', () => {
  api.startCujScenario('disk');
  let h = api.viewSetup().html;
  if (!/What can go wrong · Not enough disk space/.test(h) || !/This Mac has 3\.1 GB free/.test(h)) throw new Error('disk scenario missing');
  api.startCujScenario('download');
  if (S.setup.failAt !== 3 || !/Download blocked by a proxy/.test(api.cujRibbonHTML())) throw new Error('download scenario wrong');
  S.cuj = 0;
  if (api.cujRibbonHTML() !== '') throw new Error('no ribbon outside CUJ review');
  S.cuj = 1;
  return { html: h, full: true };
}, { exactAxo: 1 });

// ---------- v9: CUJ 5 fresh run, "Queued for the next turn", "Paused while your computer slept" ----------
check('CUJ 5: Run on a remote cluster starts a fresh run from the same task file (no "Move")', () => {
  S.cuj = 0; store['ax.setup'] = '1'; api.setEnvMode('local');
  const ov = fs.readFileSync(dir + '/overlays.js', 'utf8');
  if (/Move and keep running|'Move'\]|Reconnecting live Activity|paused cleanly/.test(ov)) throw new Error('old live-move copy is still in the dialog');
  if (!/\['Choose cluster', 'Check', 'Run'\]/.test(ov) || !/Starts a fresh run/.test(ov) || !/Conversation<\/span><b>Starts fresh/.test(ov)) throw new Error('fresh-run copy missing from the dialog');
  const t = api.getTask('t2') || S.tasks.find((x) => x.env === 'local');
  t.status = 'running'; t.env = 'local';
  const n = t.events.length;
  timers.length = 0;
  api.promoteTask(t, 'ax-dev-us-central', { from: t.branch });
  const mv = t.events[n];
  if (!mv || mv.type !== 'moved' || mv.from !== t.branch || t.env !== 'cluster') throw new Error('expected a moved event from the branch');
  /* The cluster rebuilds the workspace step by step first; the new session starts when it's ready. */
  if (t.status !== 'starting' || !t.hydrate || !/Rebuilding the workspace on ax-dev-us-central/.test(t.hydrate.title)) throw new Error('the cluster should rebuild the workspace step by step');
  for (let k = 0; k < 300 && t.status === 'starting'; k++) { const f = timers.shift(); if (!f) break; try { f(); } catch (e) { /* stubs */ } }
  timers.length = 0;
  if (!t.events.slice(n).some((e) => /New session on ax-dev-us-central/.test(e.text || ''))) throw new Error('the new run should start a new session');
  const h = api.evHTML(t, mv, n);
  if (!/started a fresh run on a remote cluster/.test(h) || !/stays above for reference/.test(h) || /moved this task/.test(h)) throw new Error('moved event should describe a fresh run');
  const t2 = S.tasks.find((x) => x.id !== t.id && x.env === 'local') || t;
  const m2 = { type: 'moved', at: Date.now(), cluster: 'ax-batch-eu', from: null, fromLast: true };
  if (!/the last pushed commit/.test(api.evHTML(t2, m2, 0))) throw new Error('continuing without changes should say the last pushed commit');
  return api.viewTask(t.id, 'activity');
}, { exactAxo: 1 });
check('CUJ 3: a harness that can\'t take input mid-turn shows "Queued for the next turn" with Pause instead', () => {
  const t = api.getTask('t3'); t.status = 'running'; t.noMidTurn = true;
  api.steerTask(t, 'Keep the existing error codes');
  const i = t.events.length - 1;
  let h = api.evHTML(t, t.events[i], i);
  if (!/Queued for the next turn/.test(h) || !/Pause instead/.test(h) || /Interrupt now/.test(h)) throw new Error('noMidTurn queued line wrong');
  t.noMidTurn = false;
  h = api.evHTML(t, t.events[i], i);
  if (!/Interrupt now/.test(h) || /Pause instead/.test(h)) throw new Error('mid-turn agents should offer Interrupt now');
  api.pauseTask(t);
  t.noMidTurn = true;
  if (/Pause instead/.test(api.evHTML(t, t.events[i], i))) throw new Error('Pause instead should hide while paused');
  api.resumeTask(t); api.deliverQueued(t); t.noMidTurn = false;
  return api.viewTask('t3', 'activity');
}, { exactAxo: 1 });
check('CUJ 3: "Paused while your computer slept" while asleep, then a resume note that offers a remote cluster', () => {
  api.setEnvMode('local'); store['ax.setup'] = '1';
  const t = S.tasks.find((x) => x.env === 'local' && x.status !== 'done' && x.status !== 'failed') || S.tasks[0];
  t.env = 'local'; t.status = 'running'; t._held = true;
  S.env.health = 'asleep';
  const nn = api.nowNextHTML(t);
  if (!/Paused while your computer slept/.test(nn) || !/resumes automatically/.test(nn) || !/data-action="promote"/.test(nn)) throw new Error('asleep Now/Next wrong');
  if (!/Paused while your computer slept/.test(api.healthCardHTML())) throw new Error('health pill should say Paused while your computer slept');
  const v = api.viewTask(t.id, 'activity');
  if (!/chip paused/.test(v.html)) throw new Error('header chip should show Paused while asleep');
  S.env.health = 'healthy'; t._held = false;
  const ev = { type: 'slept', at: Date.now(), from: Date.now() - 39 * 60000, to: Date.now() };
  const h = api.evHTML(t, ev, 0);
  if (!/Resumed automatically when your computer woke/.test(h) || !/run it on a remote cluster/.test(h)) throw new Error('slept note should offer a remote cluster for local runs');
  if (/Paused while your computer slept/.test(api.nowNextHTML(t))) throw new Error('awake tasks should not show the sleep state');
  return v;
}, { exactAxo: 1 });
check('Review links: ?scenario=<id> opens a scenario, and the remote-cluster happy path is a scenario', () => {
  const app = fs.readFileSync(dir + '/app.js', 'utf8');
  if (!/get\('scenario'\)/.test(app) || !/runScenario\(id\)/.test(app)) throw new Error('missing ?scenario= handler');
  if (!api.SCENARIOS.some((s) => s.id === 'cluster-run')) throw new Error('missing cluster-run scenario');
  return { html: '' };
});
check('A new block on a remote cluster says "Blocked by your organization\'s policy" and the agent carries on', () => {
  const t = { id: 'tz', title: 'Cluster block', agent: 'claude', status: 'running', env: 'cluster', cluster: 'ax-dev-us-central', repo: 'accounts', branch: 'ax/x', startedAt: Date.now(), tokens: 0, files: [], events: [], script: '__blk', step: 0 };
  api.SCRIPTS.__blk = [{ d: 10, ev: { type: 'blocked', domain: 'raw.githubusercontent.com', cmd: 'curl https://raw.githubusercontent.com/x' } }, { d: 10, ev: { type: 'thought', text: 'next' } }];
  S.tasks.unshift(t);
  api.runStep(t);
  const b = t.events.find((e) => e.type === 'blocked');
  if (t.status !== 'running' || !b || b.resolved !== 'policy' || !b.policy) throw new Error('cluster block should resolve as org policy, not wait for you: ' + t.status);
  if (!/Blocked by your organization's policy/.test(api.evHTML(t, b, t.events.indexOf(b)))) throw new Error('missing org-policy copy');
  S.tasks.shift(); delete api.SCRIPTS.__blk;
  return { html: '' };
});

check('v12: no progress track on the task page; the header holds where the task is, the top bar docks it, Axel is in Next step', () => {
  for (const id of ['t1', 't2', 't3', 't6']) {
    const t = api.getTask(id);
    const v = api.viewTask(id, 'activity');
    if (/journey-card|class="journey|jr-steps|jr-axo|axo-rider/.test(v.html)) throw new Error('the progress track should be gone on ' + id);
    const head = (v.html.match(/id="task-head">([\s\S]*?)<div class="task-grid">/) || [, ''])[1];
    const meta = (head.match(/<div class="th-meta">([\s\S]*?)<\/div>/) || [, ''])[1];
    if (!/<span class="th-progress" id="th-progress"><span class="mini-journey" role="img" aria-label="Step \d of 6: /.test(meta)) throw new Error('header should hold the mini track on ' + id);
    if (meta.indexOf('class="chip ') < 0 || meta.indexOf('class="chip ') > meta.indexOf('th-progress')) throw new Error('the mini track sits right after the status chip on ' + id);
    if (countAxo(head) !== 0) throw new Error('no Axel in the header on ' + id);
    const side = (v.html.match(/<aside class="side"[\s\S]*<\/aside>/) || [''])[0];
    if (countAxo(side) !== 1 || !/<span class="ns-axel" aria-hidden="true"><svg data-follow class="axo axo--/.test(side)) throw new Error('Axel should be in the Next step card on ' + id);
    if (!new RegExp('axo--' + ({ running: 'working', starting: 'thinking', done: 'done', failed: 'failed', blocked: 'blocked' }[t.status] || '')).test(side)) throw new Error('Axel mood should match the task on ' + id + ' (' + t.status + ')');
  }
  const t = api.getTask('t1');
  const tb = api.topbarTaskHTML(t);
  if (!/class="chip /.test(tb) || !/class="tb-title" data-action="task-top"/.test(tb) || !/class="mini-journey"/.test(tb)) throw new Error('docked status incomplete: ' + tb.slice(0, 200));
  if (countAxo(tb) !== 0) throw new Error('the top bar never shows Axel');
  const sh = api.shellHTML();
  if (!/class="tb-left"[\s\S]*id="crumbs"[\s\S]*id="tb-task"/.test(sh)) throw new Error('top bar should hold the breadcrumb and the docked status in one slot');
  const polish = fs.readFileSync(dir + '/polish.css', 'utf8'), app = fs.readFileSync(dir + '/app.js', 'utf8');
  if (!/\.topbar\.docked \.tb-task/.test(polish) || !/\.task-head \.th-progress \{/.test(polish) || !/\.next-card \.ns-axel \.axo \{ --axo-size: 46px; \}/.test(polish)) throw new Error('header progress / dock / Axel CSS missing');
  if (!/function updateDock/.test(app) || !/addEventListener\('scroll'/.test(app) || !/\$\('#th-progress'\)/.test(app)) throw new Error('the dock should follow the header row while scrolling');
  const f = api.spawnFailure('repo-denied');
  const fh = api.journeyHTML(f);
  if (!/aria-label="Step 1 of 6: Start, stopped here"/.test(fh) || !/<i class="now failed"><\/i>/.test(fh)) throw new Error('a failed task says where it stopped: ' + fh.slice(0, 200));
  const p = api.getTask('t2');
  if (p && p.status === 'waiting' && !/waiting on you|paused/.test(api.journeyHTML(p))) throw new Error('a waiting task says so in the mini track');
  return { html: api.viewTask('t1', 'activity').html };
}, { exactAxo: 1 });

check('blank Home (no tasks): one focused scene replaces the sections, with exactly one Axel', () => {
  const saved = S.tasks; S.tasks = [];
  try {
    const v = api.viewHome();
    if (!/first-stage/.test(v.html) || /id="sec-working"|Nothing to review yet|class="card flow"/.test(v.html)) throw new Error('blank Home should replace the sections');
    return { html: v.html };
  } finally { S.tasks = saved; }
}, { exactAxo: 1 });

check('template dropdown is a regular select: combobox + listbox, one option per template plus Your own agent…, open state survives a redraw', () => {
  ctx.location.hash = '#/'; api.render();
  S.openSelect = null; S.quickAgent = 'claude';
  let v = api.viewHome();
  const box = (v.html.match(/<div class="sel-btn[^>]*>/) || [''])[0];
  if (!/role="combobox"/.test(box) || !/aria-label="Template"/.test(box) || !/aria-haspopup="listbox"/.test(box) || !/aria-expanded="false"/.test(box) || /aria-activedescendant/.test(box)) throw new Error('closed box should be a collapsed combobox: ' + box);
  if (!/<ul class="sel-list" id="sel-quick-agent-list" role="listbox" aria-label="Template" hidden>/.test(v.html)) throw new Error('list should be hidden while closed');
  const n = api.agentList().length;
  if ((v.html.match(/role="option"/g) || []).length !== n + 1 || v.html.lastIndexOf('role="option"') !== v.html.indexOf('role="option" id="sel-quick-agent-byo"')) throw new Error('one option per template, then Your own agent… last');
  if ((v.html.match(/aria-selected="true"/g) || []).length !== 1 || !/id="sel-quick-agent-claude" aria-selected="true"/.test(v.html)) throw new Error('exactly the current template is selected');
  if (/cycle-quick-agent/.test(v.html)) throw new Error('the old click-to-cycle pill is gone');
  S.openSelect = { key: 'quick-agent', active: 'codex' };
  v = api.viewHome();
  if (!/aria-expanded="true" aria-activedescendant="sel-quick-agent-codex"/.test(v.html) || /role="listbox" aria-label="Template" hidden/.test(v.html) || !/class="sel-opt is-active" role="option" id="sel-quick-agent-codex"/.test(v.html)) throw new Error('a redraw should keep the list open on the same option');
  S.openSelect = null;
  return { html: v.html };
}, { exactAxo: 1 });

check('template dropdown keyboard and picking: arrows, Home/End, typing a name, Escape, Enter, Tab, Alt+Up', () => {
  const key = 'quick-agent', vals = ['claude', 'codex', 'antigravity'], names = ['Claude Code', 'Codex', 'Antigravity'];
  let selected = 'claude';
  const opts = vals.map((val, i) => {
    const o = fakeEl('sel-' + key + '-' + val);
    o.dataset = { value: val, key }; o.offsetTop = i * 52; o.offsetHeight = 52; o._on = false;
    o.getAttribute = (a) => (a === 'aria-selected' ? String(val === selected) : null);
    o.classList = { toggle(_c, on) { o._on = !!on; }, add() {}, remove() {}, contains() { return o._on; } };
    o.querySelector = () => ({ textContent: names[i] });
    return o;
  });
  const list = fakeEl('sel-' + key + '-list'); list.querySelectorAll = () => opts; list.scrollTop = 0; list.clientHeight = 400;
  const wrap = fakeEl();
  const btn = fakeEl('sel-' + key); btn.dataset = { key }; btn.attrs = {};
  btn.setAttribute = (a, val) => { btn.attrs[a] = String(val); }; btn.removeAttribute = (a) => { delete btn.attrs[a]; }; btn.closest = () => wrap;
  namedEls['#sel-' + key] = btn; namedEls['#sel-' + key + '-list'] = list;
  const press = (k, mods) => { const e = Object.assign({ key: k, altKey: false, ctrlKey: false, metaKey: false, prevented: false, preventDefault() { this.prevented = true; } }, mods || {}); const r = api.selKeydown(e, btn); return { r, e }; };
  const activeIs = (val) => S.openSelect && S.openSelect.active === val && btn.attrs['aria-activedescendant'] === 'sel-' + key + '-' + val && opts[vals.indexOf(val)]._on;
  const pause = () => vm.runInContext('selTypedAt = 0;', ctx); /* as if the person paused between letters */
  try {
    ctx.location.hash = '#/'; api.render();
    S.openSelect = null; S.quickAgent = 'claude'; S.quickGoal = '';
    if (press('Tab').r) throw new Error('Tab on a closed box should do nothing');
    if (!press('ArrowDown').r || !S.openSelect || btn.attrs['aria-expanded'] !== 'true' || !activeIs('claude')) throw new Error('Down opens on the current template');
    press('ArrowDown'); if (!activeIs('codex')) throw new Error('Down moves to the next option');
    press('End'); if (!activeIs('antigravity')) throw new Error('End jumps to the last option');
    press('ArrowDown'); if (!activeIs('antigravity')) throw new Error('Down stops at the last option (no wrap)');
    press('Home'); if (!activeIs('claude')) throw new Error('Home jumps to the first option');
    pause(); press('a'); if (!activeIs('antigravity')) throw new Error('typing a name jumps to it');
    const esc = press('Escape');
    if (!esc.e.prevented || S.openSelect || btn.attrs['aria-expanded'] !== 'false' || S.quickAgent !== 'claude') throw new Error('Escape closes without a change');
    press('Enter'); press('ArrowDown');
    if (!activeIs('codex')) throw new Error('Enter opens; Down moves');
    press('Enter');
    if (S.openSelect || S.quickAgent !== 'codex') throw new Error('Enter picks the highlighted option and closes');
    selected = 'codex';
    pause(); press('c'); if (!activeIs('claude')) throw new Error('typing the same letter again cycles to the next match');
    const tab = press('Tab');
    if (tab.e.prevented || S.openSelect || S.quickAgent !== 'claude') throw new Error('Tab picks the highlighted option and lets focus move on');
    selected = 'claude';
    press(' '); press('End'); press('ArrowUp', { altKey: true });
    if (S.openSelect || S.quickAgent !== 'antigravity') throw new Error('Alt+Up picks and closes');
    selected = 'antigravity';
    api.openSelect(key); api.ACTIONS['sel-pick']({ dataset: { key, value: 'claude' } });
    if (S.openSelect || S.quickAgent !== 'claude') throw new Error('clicking an option picks it');
    selected = 'claude';
    api.ACTIONS['sel-toggle']({ dataset: { key } }); if (!S.openSelect) throw new Error('clicking the box opens it');
    api.ACTIONS['sel-toggle']({ dataset: { key } }); if (S.openSelect) throw new Error('clicking it again closes it');
    api.openSelect(key); ctx.location.hash = '#/settings'; api.render();
    if (S.openSelect) throw new Error('leaving the page closes the list');
  } finally {
    delete namedEls['#sel-' + key]; delete namedEls['#sel-' + key + '-list'];
    S.openSelect = null; S.quickAgent = 'claude'; ctx.location.hash = '#/'; api.render();
  }
});

// ---------- v11 (mine, kept through v12) · Task page: Next step tops the right column, no Now band, attention dots on the tabs ----------
check('v11: no Now band; the Next step tops the right column on every tab', () => {
  let last;
  for (const tab of ['activity', 'changes', 'terminal']) {
    const h = api.viewTask('t3', tab).html;
    if (/id="now-text"|class="now-next"|nn-panel/.test(h)) throw new Error('Now band still on ' + tab);
    const side = (h.match(/<aside class="side" id="task-side"[\s\S]*?<\/aside>/) || [''])[0];
    const ns = side.indexOf('id="next-step"'), where = side.indexOf('Where it runs');
    if (ns < 0 || where < 0 || ns > where) throw new Error('Next step should be the first card in the right column on ' + tab);
    last = { html: h };
  }
  return last;
}, { exactAxo: 1 });
/* v11 fixtures: tasks built here, so earlier checks that answer, retry or promote the seeded tasks can't change them. */
function v11Task(o) {
  return Object.assign({ id: 'tv' + Math.random().toString(36).slice(2, 7), title: 'Fixture', agent: 'claude', status: 'running', env: 'local', repo: 'accounts', folder: '~/code/accounts', branch: 'ax/fixture', startedAt: Date.now() - 60000, tokens: 1200, files: [], script: 'generic', step: 0, events: [{ type: 'user', at: Date.now() - 60000, text: 'Fixture goal' }] }, o);
}
check('v11: the Next step is dynamic per state, with the crucial facts as its headline', () => {
  const run = v11Task({ events: [{ type: 'user', at: Date.now(), text: 'Go' }, { type: 'thought', at: Date.now(), text: 'Reading the code' }] });
  const r = api.nextStepHTML(run, 'activity');
  if (!/Nothing needs you right now/.test(r) || !/data-action="pause"/.test(r) || !/s-calm/.test(r) || !/Next, Claude Code edits a sandbox copy of accounts/.test(r)) throw new Error('running: ' + r);
  run.files = [{ path: 'a.ts', kind: 'new', lines: ['+x'] }]; run.events.push({ type: 'edit', at: Date.now(), paths: ['a.ts'] });
  if (!/Next, Claude Code runs the tests. Then you review 1 changed file/.test(api.nextStepHTML(run, 'activity'))) throw new Error('build stage should look ahead to the tests');
  const q = v11Task({ status: 'waiting', needs: { type: 'question' }, events: [{ type: 'question', at: Date.now(), text: 'Delete the 6 unused fixtures?', options: ['Delete them', 'Keep for now'] }] });
  const qh = api.nextStepHTML(q, 'activity');
  if (!/Answer Claude Code/.test(qh) || !/Delete the 6 unused fixtures\?/.test(qh) || (qh.match(/data-action="answer"/g) || []).length !== 2 || !/s-attn/.test(qh) || !/Your next step/.test(qh)) throw new Error('question: ' + qh);
  const b = v11Task({ status: 'blocked', events: [{ type: 'blocked', at: Date.now(), domain: 'raw.githubusercontent.com', purpose: 'Read the example config' }] });
  const bh = api.nextStepHTML(b, 'activity');
  if (!/Allow <span class="mono">raw\.githubusercontent\.com<\/span>\?/.test(bh) || !/wants to read the example config/.test(bh) || !/data-action="allow"/.test(bh)) throw new Error('blocked: ' + bh);
  const f = v11Task({ status: 'failed', events: [{ type: 'fail', at: Date.now(), code: 'mcp-failed' }] });
  const fh = api.nextStepHTML(f, 'activity');
  if (!/s-fail/.test(fh) || !/didn&#39;t start|didn't start/.test(fh) || !/Edit workspace setup/.test(fh)) throw new Error('failed: ' + fh);
  const p = v11Task({ status: 'waiting', needs: { type: 'paused' } });
  if (!/Paused by you/.test(api.nextStepHTML(p, 'activity')) || !/data-action="resume"/.test(api.nextStepHTML(p, 'activity'))) throw new Error('paused');
  const d = v11Task({ status: 'done', finishedAt: Date.now(), files: [{ path: 'b.ts', kind: 'new', lines: ['+y'] }] });
  const da = api.nextStepHTML(d, 'activity'), dc = api.nextStepHTML(d, 'changes');
  if (!/Review 1 changed file/.test(da) || !new RegExp('class="btn primary sm" href="#/task/' + d.id + '/changes"').test(da)) throw new Error('done on Activity should link to Changes: ' + da);
  if (/class="btn primary/.test(dc) || !/Keep or discard each file/.test(dc)) throw new Error('on Changes, the take-bar keeps the only primary');
  d.pushed = true;
  if (!/Shipped to/.test(api.nextStepHTML(d, 'activity'))) throw new Error('shipped');
});
check('v11: a tab gets an attention dot when something on it needs you (amber decision, red failure, key colour review)', () => {
  const q = v11Task({ status: 'waiting', needs: { type: 'question' }, events: [{ type: 'question', at: Date.now(), text: 'Keep it?', options: ['Yes', 'No'] }] });
  const f = v11Task({ status: 'failed', events: [{ type: 'fail', at: Date.now(), code: 'quota' }] });
  const run = v11Task({});
  const d = v11Task({ status: 'done', finishedAt: Date.now(), files: [{ path: 'c.ts', kind: 'new', lines: ['+z'] }] });
  S.tasks.unshift(q, f, run, d);
  try {
    const qc = api.viewTask(q.id, 'changes').html;
    if (!/id="tab-activity"[^>]*>Activity<span class="tab-attn attn"/.test(qc) || !/needs your answer/.test(qc)) throw new Error('question: Activity tab should get an amber dot');
    if (/id="tab-activity"[^>]*>Activity<span class="tab-attn/.test(api.viewTask(q.id, 'activity').html)) throw new Error('no dot on the tab you are on');
    if (!/id="tab-activity"[^>]*>Activity<span class="tab-attn fail"/.test(api.viewTask(f.id, 'terminal').html)) throw new Error('failed: red dot on Activity');
    if (/class="tab-attn/.test(api.viewTask(run.id, 'changes').html)) throw new Error('a running task needs no dot');
    if (!/id="tab-changes"[\s\S]{0,260}tab-attn review/.test(api.viewTask(d.id, 'activity').html)) throw new Error('done with unreviewed files: Changes gets a review dot');
    api.viewTask(d.id, 'changes');   /* viewing the file marks it seen */
    if (/tab-attn review/.test(api.viewTask(d.id, 'activity').html)) throw new Error('review dot should clear once every file is seen');
    return { html: api.viewTask(q.id, 'changes').html };
  } finally { [q, f, run, d].forEach((x) => { const i = S.tasks.indexOf(x); if (i >= 0) S.tasks.splice(i, 1); }); }
}, { exactAxo: 1 });
check('v11: the browser tab counts what needs you', () => {
  const n = api.needsCount();
  S.docTitle = 'Home · AX Studio';
  const tt = api.titleWithNeeds();
  if (n ? tt !== `(${n}) Home · AX Studio` : tt !== 'Home · AX Studio') throw new Error('title: ' + tt);
});

// ---------- CUJ 1: Get AX Studio (#/get) and a first launch on a computer that's already set up ----------
// ---------- v28: no login ----------
check('No login: no name or avatar in the shell, no Google sign-in for clusters or team templates, no email in credential lines', () => {
  const keep = { setup: S.setup, reg: S.teamRegistry };
  try {
    const sh = api.shellHTML();
    if (/class="user-row"|class="avatar"|Rajitha Leonhard|rajitha@example\.com/.test(sh)) throw new Error('the shell should show no account');
    S.setup = { phase: 'before', step: 0, pick: 'antigravity', path: 'cluster' };
    let h = api.viewSetup().html;
    if (/Sign in with Google|Signed in as/.test(h) || !/data-action="setup-connect" id="setup-connect">[\s\S]*?Choose a cluster/.test(h) || !/Pick a cluster from your kubeconfig/.test(h)) throw new Error('Path B should pick from your kubeconfig, without signing in');
    S.setup = { phase: 'connect', step: 0, pick: 'antigravity', path: 'cluster', cluster: 'ax-dev-us-central' };
    h = api.viewSetup().html;
    if (/Signed in as|Sign in with Google/.test(h) || !/From your kubeconfig/.test(h) || !/data-action="setup-cluster" data-cluster="ax-dev-us-central"/.test(h)) throw new Error('connect step lists clusters from your kubeconfig');
    const pl = api.viewPlaces().html;
    const plBad = (pl.match(/Sign in with Google|Sign out of Google|Signed in as|data-action="sign-in"|google-signout/) || [])[0];
    if (plBad) throw new Error('Where agents run still says: ' + plBad);
    if (!/Clusters from your kubeconfig/.test(pl)) throw new Error('Where agents run should say the clusters come from your kubeconfig');
    if (!/class="rc-title">ax-dev-us-central</.test(pl) || !/class="rc-title">ax-batch-eu</.test(pl)) throw new Error('Where agents run should list the kubeconfig clusters');
    const g = api.viewGet().html, cuj = api.viewCuj1().html;
    if (/sign in with Google|Sign in with Google/.test(g + cuj)) throw new Error('the download page and CUJ 1 overview should not mention a Google sign-in');
    const ov = fs.readFileSync(dir + '/overlays.js', 'utf8') + fs.readFileSync(dir + '/app.js', 'utf8');
    if (/async function signIn|state\.signedIn|google-signout|Waiting for your browser…`;\s*await signIn/.test(ov)) throw new Error('no Studio sign-in code should be left');
    S.teamRegistry = null;
    const cs = { tab: 'browse', q: '', filter: 'all', view: 'list', byo: {} };
    let r = api.catResultsHTML(cs);
    if (!/See templates your team shared/.test(r.html) || !/data-catx="registry"/.test(r.html) || /Sign in with Google/.test(r.html) || /data-cat="review-bot"/.test(r.html)) throw new Error('team templates wait for a registry address, not a sign-in');
    cs.regOpen = true; r = api.catResultsHTML(cs);
    if (!/id="cat-reg"/.test(r.html) || !/data-catx="registry-add"/.test(r.html) || !/ax templates registry add/.test(r.html)) throw new Error('Add registry… opens an address field');
    S.teamRegistry = 'registry.acme.dev/ax'; cs.regOpen = false; r = api.catResultsHTML(cs);
    if (!/data-cat="review-bot"/.test(r.html) || !/Your team · registry\.acme\.dev/.test(r.html)) throw new Error('with a registry, your team templates show');
    const A = api.AGENTS.antigravity, was = A.connected; A.connected = true;
    const line = api.viewSettings().html;
    A.connected = was;
    if (/rajitha@example\.com|Signed in with Google as/.test(line) || !/Google sign-in in your keychain/.test(line)) throw new Error('credential lines show no email');
  } finally { S.setup = keep.setup; S.teamRegistry = keep.reg; }
}, { exactAxo: 0 });
check('No login: Run on a remote cluster starts at Choose cluster (3 steps), and Choose a remote cluster lists clusters right away', () => {
  namedEls['#overlay'].innerHTML = '';
  api.openPromote(api.getTask('t2') || S.tasks[0], {});
  const ov = namedEls['#overlay'].innerHTML;
  if (/Sign in to see|Sign in with Google/.test(ov)) throw new Error('no sign-in step');
  namedEls['#overlay'].innerHTML = '';
  api.openConnectCluster(() => {});
  const cc = namedEls['#overlay'].innerHTML;
  if (/Sign in with Google|Signed in as/.test(cc) || !/From your kubeconfig/.test(cc) || !/data-cc="ax-dev-us-central"/.test(cc) || !/Connect and run/.test(cc)) throw new Error('Choose a remote cluster: ' + cc.slice(0, 200));
  return { html: cc, full: true };
}, { exactAxo: 0 });
// ---------- v29: no usage data. No usage-data switch in setup, on the already-set-up Ready screen or in Settings ----------
check('No usage data: setup (both paths), the already-set-up Ready screen and Settings → Privacy & data have no usage-data switch', () => {
  const keep = S.setup;
  const bad = /usage data|telemetry|data-action="setup-consent"|data-pref="telemetry"/i;
  try {
    for (const path of ['local', 'cluster']) {
      S.setup = { phase: 'before', step: 0, pick: 'antigravity', path };
      const h = api.viewSetup().html;
      if (bad.test(h)) throw new Error('the first setup screen should not ask about usage data (' + path + ')');
      if (!/<div class="setup-actions">/.test(h)) throw new Error('the setup buttons should still show (' + path + ')');
    }
    for (const by of ['it', 'cli']) {
      S.setup = { phase: 'ready', step: 4, pick: 'antigravity', path: 'local', preinstalled: by };
      const h = api.viewSetup().html;
      if (!h.includes('Already set up: run your first agent') || bad.test(h)) throw new Error('the already-set-up Ready screen should not ask about usage data (' + by + ')');
    }
  } finally { S.setup = keep; }
  const pv = api.viewSettings('privacy').html;
  if (bad.test(pv)) throw new Error('Settings → Privacy & data should not have a usage-data switch');
  for (const k of ['Keep Activity for', 'Delete all Activity…', 'Diagnostics you copy always have secrets removed']) if (!pv.includes(k)) throw new Error('Privacy & data keeps ' + k);
  if ((pv.match(/role="switch"/g) || []).length) throw new Error('Privacy & data has no switches left');
  if (api.ACTIONS['setup-consent']) throw new Error('the setup-consent action should be gone');
  if ('telemetry' in S.privacy || Object.keys(S.privacy).join() !== 'retention') throw new Error('the only privacy preference is how long Activity is kept: ' + Object.keys(S.privacy));
});
check('CUJ 1: Get AX Studio (#/get) opens before setup with one small download or ax setup, then a fresh first run', () => {
  delete store['ax.setup']; S.cuj = 0; S.getDownloaded = false;
  ctx.location.hash = '#/get'; api.render();
  if (ctx.location.hash !== '#/get') throw new Error('#/get should open before setup, got ' + ctx.location.hash);
  const v = api.viewGet();
  for (const k of ['Get AX Studio', 'Download for Mac', 'Installs AX Studio and the', 'ax setup', 'What happens next', 'Nothing else is installed on this computer', 'ax uninstall']) if (!v.html.includes(k)) throw new Error('missing ' + k);
  if (!/data-action="copy" data-text="ax setup"/.test(v.html)) throw new Error('ax setup should be copyable');
  if ((v.html.match(/class="btn primary/g) || []).length !== 1) throw new Error('one primary button: Download for Mac');
  api.ACTIONS['get-download']();
  const d = api.viewGet().html;
  if (!/data-action="get-open"/.test(d) || /data-action="get-download"/.test(d) || !/in your Downloads folder/.test(d)) throw new Error('after the download, Open AX Studio replaces Download');
  api.ACTIONS['get-open']();
  if (S.setup.phase !== 'before' || store['ax.setup'] || ctx.location.hash !== '#/welcome') throw new Error('Open AX Studio should start a fresh first run');
  return Object.assign({}, v, { full: true });
}, { exactAxo: 1 });
check('CUJ 1: a computer IT already set up opens on Ready with nothing to install, every template ready, and no usage-data switch', () => {
  api.startPreinstalled('it');
  if (!store['ax.setup'] || !S.firstRun || S.tasks.length || S.env.mode !== 'local' || ctx.location.hash !== '#/welcome') throw new Error('should be a day 0 first run on a set-up computer');
  if (S.setup.phase !== 'ready' || S.setup.preinstalled !== 'it') throw new Error('should open on Ready');
  const h = api.viewSetup().html;
  for (const k of ['Already set up: run your first agent', 'Your IT team already set up AX on this Mac', 'nothing to install', '2 sites your organization blocks']) if (!h.includes(k)) throw new Error('missing ' + k);
  if (/Downloading ·/.test(h)) throw new Error('IT installs every template ahead of time');
  if (/data-action="setup-start"|Skip for now/.test(h)) throw new Error('nothing to install, so no setup button and no Skip');
  if (!/^[\s\S]*?data-action="setup-finish"/.exec(h)[0].includes('btn primary lg')) throw new Error('Start my first task must stay the first setup-finish');
  if (/usage data|data-action="setup-consent"/i.test(h)) throw new Error('no usage-data switch: AX Studio does not collect usage data');
  api.ACTIONS['setup-finish']();
  if ('telemetry' in S.privacy) throw new Error('finishing setup should not save a usage-data choice');
  return { html: h, full: true };
}, { exactAxo: 1 });
check('CUJ 1: after ax setup in a terminal, Studio opens on Ready with the first template and the others still downloading', () => {
  api.startPreinstalled('cli', true);
  const h = api.viewSetup().html;
  for (const k of ['Already set up: run your first agent', 'You already set up this Mac with', 'ax setup', 'Secure sandbox running']) if (!h.includes(k)) throw new Error('missing ' + k);
  if (!/Downloading ·/.test(h)) throw new Error('ax setup gets the first template; the others keep downloading');
  if (!/Already set up with ax setup/.test(api.cujRibbonHTML()) || !/End of CUJ 1/.test(h) || !/Try a fresh install/.test(h)) throw new Error('from the CUJ 1 overview it keeps the ribbon and the end strip');
  S.cuj = 0;
  return { html: h, full: true };
}, { exactAxo: 1 });
check('CUJ 1: the overview and the review page link the download page and both already-set-up launches', () => {
  const ov = api.viewCuj1().html;
  if (!/href="#\/get"/.test(ov) || !/data-action="cuj-preinstalled" data-by="it"/.test(ov) || !/data-action="cuj-preinstalled" data-by="cli"/.test(ov)) throw new Error('overview links missing');
  const rv = api.viewReview().html;
  if (!/href="#\/get"/.test(rv) || !/\?scenario=setup-preinstalled-it/.test(rv) || !/\?scenario=setup-preinstalled-cli/.test(rv)) throw new Error('review page links missing');
});

// ---------- v24: Antigravity is the default template; Your own agent is a first-class fourth option ----------
check('Antigravity is the default template: first in every list, and picked in setup, New task and Home', () => {
  if (api.DEFAULT_AGENT !== 'antigravity') throw new Error('DEFAULT_AGENT should be antigravity');
  const order = api.prebuiltAgents().map((a) => a.id).join(',');
  if (order !== 'antigravity,claude,codex') throw new Error('template order: ' + order);
  const A = api.AGENTS.antigravity;
  if (A.maker !== 'Google' || A.models[0].name !== 'Gemini 3 Pro' || A.models[1].name !== 'Gemini 3 Flash') throw new Error('Antigravity should run Gemini 3 Pro, with Gemini 3 Flash as the faster option');
  const keep = { q: S.quickAgent, d: S.draft, s: S.setup };
  try {
    S.quickAgent = null;
    if (api.quickAgentId() !== 'antigravity') throw new Error('Home should start on Antigravity');
    S.draft = null;
    const d = api.ensureDraft(new URLSearchParams(''));
    if (d.agent !== 'antigravity' || d.agent2 !== 'claude') throw new Error('New task should pick Antigravity, with Claude Code to compare: ' + d.agent + ', ' + d.agent2);
    S.setup = null;
    const h = api.viewSetup().html;
    if (S.setup.pick !== 'antigravity' || api.setupSteps('antigravity')[3].title !== 'Downloading Antigravity') throw new Error('setup should get Antigravity first');
    const grp = h.slice(h.indexOf('aria-label="Which agent first?"'), h.indexOf('class="setup-actions"'));
    const ids = (grp.match(/data-agent="[a-z]+"/g) || []).map((m) => m.slice(12, -1)).join(',');
    if (ids !== 'antigravity,claude,codex,byo') throw new Error('Which agent first? should list the three templates, then Your own agent: ' + ids);
    if ((grp.match(/aria-checked="true"/g) || []).length !== 1 || !/aria-checked="true" data-action="setup-pick" data-agent="antigravity"/.test(grp)) throw new Error('only Antigravity should be checked');
    const g = api.viewGet().html;
    if (!/Downloaded Antigravity 1\.2\.0/.test(g) || !/Claude Code and Codex keep downloading in the background/.test(g)) throw new Error('ax setup on the download page should get Antigravity first');
  } finally { S.quickAgent = keep.q; S.draft = keep.d; S.setup = keep.s; }
});
check('Your own agent in setup: it gets the agent runner first, every template follows, and Ready says Add your agent', () => {
  const keep = S.setup;
  try {
    S.setup = { phase: 'before', step: 0, pick: 'byo', path: 'local' };
    let h = api.viewSetup().html;
    if (!/aria-checked="true" data-action="setup-pick" data-agent="byo"/.test(h) || !/Setup gets the agent runner first, and you add your agent right after/.test(h)) throw new Error('picking Your own agent should say what setup does');
    const st = api.setupSteps('byo');
    if (st.length !== 4 || st[3].title !== 'Getting the agent runner' || !/ax-task-runner 0\.9\.2/.test(st[3].desc)) throw new Error('step 4 should get the agent runner: ' + JSON.stringify(st[3]));
    S.setup = { phase: 'installing', step: 3, pick: 'byo', path: 'local' };
    h = api.viewSetup().html;
    if (!/Getting the agent runner…/.test(h) || !/The agent runner is ready for your agent\. Antigravity, Claude Code and Codex keep downloading in the background/.test(h)) throw new Error('installing should name the runner, then the templates that follow');
    S.setup = { phase: 'failed', step: 3, pick: 'byo', path: 'local' };
    h = api.viewSetup().html;
    if (!/download the agent runner/.test(h) || !/pull ghcr\.io\/google\/ax-task-runner:0\.9\.2 through/.test(h) || /Antigravity image/.test(h)) throw new Error('a failed download should name the agent runner');
    S.setup = { phase: 'ready', step: 4, pick: 'byo', path: 'local' };
    h = api.viewSetup().html;
    if (!/<h1 tabindex="-1">Ready: add your agent<\/h1>/.test(h) || !/the agent runner is ready/.test(h)) throw new Error('Ready head for Your own agent');
    if (!/<a class="btn primary lg" href="#\/new\?find=byo" data-action="setup-finish">Add your agent/.test(h)) throw new Error('the primary action should be Add your agent');
    if (!/<a class="choice byo-card on" href="#\/new\?find=byo" data-action="setup-find">/.test(h) || /role="radio" aria-checked="true"/.test(h)) throw new Error('Your own agent should be the selected card, with no template checked');
    if (!/^[\s\S]*?data-action="setup-finish"/.exec(h)[0].includes('btn primary lg')) throw new Error('Add your agent must stay the first setup-finish');
    S.setup = { phase: 'ready', step: 4, pick: 'antigravity', path: 'local' };
    h = api.viewSetup().html;
    if ((h.match(/data-action="setup-pick"/g) || []).length !== 3 || !/<a class="choice byo-card" href="#\/new\?find=byo" data-action="setup-find">/.test(h)) throw new Error('default Ready: three template cards, then Your own agent');
    if (!/href="#\/new\?agent=antigravity" data-action="setup-finish">Start my first task/.test(h)) throw new Error('Start my first task should open New task with Antigravity');
    return { html: h, full: true };
  } finally { S.setup = keep; }
}, { exactAxo: 1 });
check('Guardrails: the Gemini API comes first in Balanced (key added outbound), and Strict still lets an Antigravity task reach it', () => {
  const keep = S.guardrailPreset;
  try {
    S.guardrailPreset = 'balanced';
    const ps = api.presetSites();
    if (!ps.length || ps[0].domain !== 'generativelanguage.googleapis.com' || ps[0].note !== 'Key added outbound by Guardrails') throw new Error('Balanced should list the Gemini API first: ' + (ps[0] && ps[0].domain));
    if (!api.siteAllowed('generativelanguage.googleapis.com', 'shop-api')) throw new Error('an agent should reach the Gemini API');
    S.guardrailPreset = 'strict';
    if (!api.presetSites().some((a) => a.domain === 'generativelanguage.googleapis.com')) throw new Error('Strict keeps the model APIs');
    const reach = api.reachFor({ agent: 'antigravity', repo: 'shop-api' }).map((a) => a.domain);
    if (!reach.includes('generativelanguage.googleapis.com') || reach.includes('api.anthropic.com')) throw new Error('Strict: an Antigravity task reaches the Gemini API and no other model API: ' + reach.join(', '));
    S.guardrailPreset = 'balanced';
    ctx.location.hash = '#/guardrails'; api.render();
    const v = api.viewGuardrails();
    if (!/generativelanguage\.googleapis\.com/.test(v.html)) throw new Error('Guardrails should show the Gemini API');
    return v;
  } finally { S.guardrailPreset = keep; }
});
check('Home: Your own agent… in the template dropdown opens Bring your own agent on New task, and keeps the goal', () => {
  const keep = { q: S.quickAgent, g: S.quickGoal };
  try {
    ctx.location.hash = '#/'; api.render();
    S.quickAgent = null; S.quickGoal = '';
    const v = api.viewHome();
    if (!/<span class="sel-val">Antigravity<\/span>/.test(v.html)) throw new Error('Home should show Antigravity');
    if (!/role="option" id="sel-quick-agent-byo"[\s\S]*?Your own agent…[\s\S]*?An ADK agent, a container image or a Git repo/.test(v.html)) throw new Error('Your own agent… option');
    namedEls['#quick-goal'] = Object.assign(fakeEl('#quick-goal'), { value: 'Add metrics to the orders API' });
    api.openSelect('quick-agent'); api.ACTIONS['sel-pick']({ dataset: { key: 'quick-agent', value: 'byo' } });
    if (S.quickAgent === 'byo') throw new Error('Your own agent is not a template to remember on Home');
    if (ctx.location.hash !== '#/new?find=byo&goal=Add%20metrics%20to%20the%20orders%20API') throw new Error('should open New task on Bring your own agent with the goal: ' + ctx.location.hash);
    if (S.draft) throw new Error('the pick should leave the redraw to the page load, so ?find=byo opens the dialog once');
    api.render(); /* the hashchange */
    if (!S.draft || S.draft.goal !== 'Add metrics to the orders API' || S.draft.agent !== 'antigravity') throw new Error('New task should keep the goal');
    return { html: v.html };
  } finally { delete namedEls['#quick-goal']; S.quickAgent = keep.q; S.quickGoal = keep.g; S.openSelect = null; }
}, { exactAxo: 1 });

Promise.resolve().then(() => {
  console.log(fails ? `\n${fails} FAILURES` : '\nALL OK');
  if (fails) process.exitCode = 1;
});
