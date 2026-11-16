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

// Smoke test v10 · CUJ 2 first run (?cuj=2). Loads AX Studio in a stubbed DOM with the first-run flags set (as index.html
// does for ?cuj=2), then checks the order of the New task page, one-time sign-in, live downloads, models, setup detection,
// workspace hydration, saved setups, the folder picker and the CUJ 2 failure fixes. v13 adds the requirements pass: the
// default task runner (2.1), GitHub connected once (2.2), inline files (2.5) and a skill that fails to load.
// Usage: node smoke_cuj2.js <prototype dir>
const fs = require('fs');
const vm = require('vm');
/* Run from the repo root: node tests/<suite>.js   (or pass the app folder as the first argument) */
const dir = process.argv[2] || require('path').resolve(__dirname, '..');

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
['#root', '#main', '#overlay', '#toasts', '#bell-pop', '#announcer'].forEach((k) => { namedEls[k] = fakeEl(k); });
/* What index.html leaves behind for ?cuj=2. */
const store = { 'ax.firstrun': '1', 'ax.setup': '1', 'ax.env': 'local' };
const doc = {
  addEventListener() {},
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
  location: { hash: '#/welcome', search: '', pathname: '/index.html', get href() { return 'http://localhost' + this.pathname + this.search + this.hash; }, replace(u) { u = String(u); this.hash = u.includes('#') ? u.slice(u.indexOf('#')) : ''; } },
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
vm.runInContext(files.map((f) => fs.readFileSync(dir + '/' + f, 'utf8')).join('\n;\n') + `
;globalThis.__api = { state, render, viewHome, viewNew, viewSetup, viewTask, shellHTML, navTasksHTML, ensureDraft, draftChecks, draftCli, draftSpec,
  manifestYAML, planHeadHTML, readyHTML, wsChipsHTML, setupHintHTML, draftSetup, detectedSetup, workingHTML, evHTML, nowNextHTML: nextStepHTML, nextStepHTML, nowLine,
  createTaskFromDraft, getTask, AGENTS, ACTIONS, accountSignedIn, modelsFor, modelOf, altModel, isDownloading, dlPct, startDownloads,
  failActionsHTML, failCardHTML, runFix, runScenario, homeNudge, startFirstNudge, spawnFailure, openAgentCatalog, openFolderPicker, FOLDERS, SAMPLE_GOAL, stepStates, hydrationSteps,
  viewSettings, finishGithubConnect, connectGithub, LAYERS, runnerImage };`, ctx);
const api = ctx.__api;
const S = api.state;
let fails = 0, n = 0;
const countAxo = (h) => (String(h || '').match(/<svg[^>]*\bclass="[^"]*\baxo\b/g) || []).length;
function check(name, fn) {
  n++;
  try {
    const r = fn();
    if (r && typeof r.html === 'string') {
      const html = String(r.html).replace(/aria-describedby|"undefined"/g, '');
      if (/undefined|NaN|\[object/.test(html)) throw new Error('bad token: ' + (html.match(/.{0,40}(undefined|NaN|\[object).{0,40}/) || [])[0]);
      if (r.axo != null && countAxo(r.html) !== r.axo) throw new Error(`expected ${r.axo} Axel, got ${countAxo(r.html)}`);
    }
    console.log('ok  ', name);
  } catch (e) { fails++; console.log('FAIL', name, e && e.stack ? e.stack.split('\n').slice(0, 2).join(' | ') : e); }
}
/** Run queued timers (setTimeout callbacks) until `until()` is true or nothing is left. */
function drain(until, max = 200) {
  for (let k = 0; k < max && !(until && until()); k++) { const f = timers.shift(); if (!f) break; try { f(); } catch (e) { /* timers may touch stubs */ } }
}
const go = (h) => { ctx.location.hash = h; api.render(); };

// ---------- First run: clean state ----------
check('first run: no seeded tasks, no blocked log, ids start at 1, preset allowlist only', () => {
  if (!S.firstRun) throw new Error('state.firstRun should be set');
  if (S.tasks.length || S.blockedLog.length || S.nextId !== 1) throw new Error('seeded data leaked into the first run');
  if (S.allow.some((a) => !/preset/.test(a.by))) throw new Error('only preset sites should be allowed on a fresh install');
});
check('first run: no template is signed in, and no "Key was rejected" on a fresh install', () => {
  ['claude', 'codex', 'antigravity'].forEach((id) => { const a = api.AGENTS[id]; if (a.connected || a.keyProblem || a.keyHint) throw new Error(id + ' should start not connected'); });
  if (!api.AGENTS.antigravity.signIn || !api.AGENTS.antigravity.keyPrefix) throw new Error('Antigravity needs sign-in fields for the connect panel');
});
check('first run: arrives on Ready with Antigravity ready, Claude Code and Codex still downloading (live %), and Your own agent as the fourth card', () => {
  go('#/welcome');
  if (!S.setup || S.setup.phase !== 'ready') throw new Error('should land on Ready');
  if (S.setup.pick !== 'antigravity') throw new Error('setup should get Antigravity first');
  if (!api.isDownloading('codex') || !api.isDownloading('claude') || api.isDownloading('antigravity')) throw new Error('downloads wrong');
  const v = api.viewSetup();
  if (!/Ready: run your first agent/.test(v.html) || !/The Antigravity template is ready; Claude Code and Codex are still downloading in the background/.test(v.html)) throw new Error('Ready lede wrong');
  if ((v.html.match(/data-dl="(codex|claude)"/g) || []).length !== 2) throw new Error('cards should show live download %');
  if (!/<a class="choice byo-card" href="#\/new\?find=byo" data-action="setup-find">/.test(v.html) || !/<span class="c-title">Your own agent<\/span>/.test(v.html)) throw new Error('Ready should offer Your own agent as the fourth card');
  if (!/aria-label="Template"/.test(v.html) || !/Want a different template\?/.test(v.html) || !/Pick a template and sign in to it once/.test(v.html)) throw new Error('template wording missing on Ready');
  return { html: v.html, axo: 1 };
});
check('first run: Home shows one focused scene (no empty sections): Axel says how it works in a sentence and nudges you to start; goal box; ideas', () => {
  go('#/');
  const v = api.viewHome();
  if (!/class="stage first-stage"/.test(v.html) || !/Let’s run your <em>first agent<\/em>/.test(v.html)) throw new Error('blank scene missing');
  if (/id="sec-needs"|class="card flow"|class="rail"|Nothing to review|No agents running|Nothing shipped|No finished tasks/.test(v.html)) throw new Error('empty sections should not show');
  if (!/data-form="quick"/.test(v.html) || !/class="btn primary first-go" type="submit">Set up task/.test(v.html)) throw new Error('the goal box is the primary action');
  if (!/class="sel-btn agent-pick" id="sel-quick-agent" role="combobox" tabindex="0" aria-label="Template"/.test(v.html) || !/<span class="sel-val">Antigravity<\/span>/.test(v.html)) throw new Error('the template dropdown should be a regular select showing Antigravity');
  if ((v.html.match(/data-action="first-idea"/g) || []).length !== 3 || !/sample=1">/.test(v.html)) throw new Error('ideas missing');
  if (/class="first-how"|class="fp-stone"|>How it works</.test(v.html)) throw new Error('the How it works section should be gone (it crowded the page)');
  const bubble = (v.html.match(/<div class="speech fs-speech[^"]*"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || '';
  if (/<ol|<li>/.test(bubble) || !/^Hi [^!]+! I'm Axel\. Pick a template and a workspace, tell me what you want done, and I'll get an agent working on it\. You review the changes at the end\. <b>Let’s start your first task!<\/b>$/.test(bubble.trim())) throw new Error('Axel should say how it works in one casual sentence and nudge you to start: ' + bubble.slice(0, 240));
  if (!/I'm Axel/.test(v.html)) throw new Error('Axel should greet you');
  if (!/class="fs-bubbles" aria-hidden="true"/.test(v.html) || (v.html.match(/<i style="--x:/g) || []).length !== 6) throw new Error('decorative bubbles should be hidden from screen readers');
  if (!/Tasks you start show up here/.test(api.navTasksHTML())) throw new Error('empty sidebar task list missing');
  return { html: api.shellHTML() + v.html, axo: 1 };
});
check('Axel reacts on the blank Home: focus makes him curious, an idea fills the goal box and he celebrates; a redraw keeps it, a fresh visit says hello', () => {
  go('#/');
  S.homeNudged = null; S.axelSpeech = null;
  api.homeNudge('focus');
  if (S.homeNudged !== 'focus' || !/what are we building/.test(S.axelSpeech.text)) throw new Error('focus reaction');
  api.ACTIONS['first-idea']({ dataset: { goal: 'Fix the failing tests' } });
  if (S.quickGoal !== 'Fix the failing tests' || S.homeNudged !== 'idea' || !/Great pick/.test(S.axelSpeech.text)) throw new Error('idea reaction');
  const redraw = api.viewHome();
  if (!/Great pick/.test(redraw.html) || !/data-axo="done"/.test(redraw.html)) throw new Error('a redraw (theme, download progress) should keep his reaction and mood');
  S.quickGoal = '';
  go('#/settings'); go('#/');
  const back = api.viewHome();
  if (/Great pick/.test(back.html) || !/I'm Axel/.test(back.html) || S.homeNudged) throw new Error('a fresh visit should say hello again, not an old reaction');
  return { html: back.html, axo: 1 };
});
check('if you do nothing, Axel nudges: a wag after 2 s, then another with a gentle "Psst!" toward the ideas', () => {
  go('#/settings'); go('#/');
  S.homeNudged = null; S.axelSpeech = null;
  vm.runInContext('firstNudgeT = 0; var __aw = axoWag; var __wags = 0; axoWag = function () { __wags++; };', ctx);
  try {
    const before = timers.length;
    api.startFirstNudge();
    const tick1 = timers.splice(before)[0];
    if (!tick1) throw new Error('no first nudge scheduled');
    tick1();
    if (S.homeNudged || vm.runInContext('__wags', ctx) !== 1) throw new Error('first nudge is just a wag');
    const tick2 = timers.splice(before)[0];
    if (!tick2) throw new Error('no second nudge scheduled');
    tick2();
    if (vm.runInContext('__wags', ctx) !== 2 || S.homeNudged !== 'idle' || !/^Psst! Not sure where to start\? Pick an idea below, or type your own goal\.$/.test(S.axelSpeech.text)) throw new Error('second nudge should wag and say Psst');
    if (!/Psst! Not sure where to start/.test(api.viewHome().html)) throw new Error('a redraw keeps the nudge');
    if (timers.length > before) throw new Error('no more nudges after the second');
  } finally {
    vm.runInContext('axoWag = __aw; firstNudgeT = 0;', ctx);
    S.homeNudged = null; S.axelSpeech = null;
  }
});
check('first run with setup skipped: Home asks to set up first (no goal box yet)', () => {
  const prev = S.env.mode; S.env.mode = 'none';
  const v = api.viewHome();
  S.env.mode = prev;
  if (!/Let’s get <em>you set up<\/em>/.test(v.html) || !/data-path="local">[\s\S]*?Set up this computer/.test(v.html) || /data-form="quick"/.test(v.html)) throw new Error('setup-first scene wrong');
  return { html: api.shellHTML() + v.html, axo: 1 };
});

// ---------- New task in order ----------
let d;
check('New task follows this order: template → where → workspace → goal (then Run)', () => {
  /* Setup got Antigravity first; Claude Code has finished downloading in the background since. */
  if (S.downloads) delete S.downloads.claude;
  S.draft = null; go('#/new?agent=claude');
  const v = api.viewNew(new URLSearchParams('agent=claude'));
  d = S.draft;
  const pos = ['id="step-agent"', 'id="step-where"', 'id="step-workspace"', 'id="step-goal"', 'id="advanced"'].map((k) => v.html.indexOf(k));
  if (pos.some((p) => p < 0) || pos.some((p, k) => k && p < pos[k - 1])) throw new Error('order wrong: ' + pos.join(','));
  if (!/<h1 tabindex="-1">Start a task<\/h1>/.test(v.html) || !/Pick a template/.test(v.html) || !/class="tpl-grid"/.test(v.html)) throw new Error('template wording missing');
  if (/Pick an agent|Advanced: branch|Pre-built templates · maintained by AX/.test(v.html)) throw new Error('old wording still present');
  if (!/id="find-byo"/.test(v.html) || !/<span class="c-title">Your own agent<\/span>/.test(v.html) || !/More templates from your team or the AX catalog/.test(v.html) || !/Browse templates…/.test(v.html)) throw new Error('Your own agent card and Browse templates wording');
  return { html: api.shellHTML() + v.html, axo: 1 };
});
check('sign in once on New task: connect panel for the selected template; checklist says what is next', () => {
  const v = api.viewNew(new URLSearchParams('agent=claude'));
  if (!/Sign in to Claude Code<\/div>/.test(v.html) || !/You only do this once/.test(v.html) || !/id="agent-signin"/.test(v.html)) throw new Error('connect panel missing');
  if (!/Same from the command line: <code>ax auth login claude-code<\/code>/.test(v.html)) throw new Error('connect panel should give the CLI equivalent');
  const c = api.draftChecks(d);
  if (c.map((x) => x.t.split(' ')[0]).join(',') !== 'Sign,On,Code,Workspace,Goal') throw new Error('checklist order: ' + c.map((x) => x.t).join(' | '));
  if (!/3 of 5 done · next: sign in to Claude Code/.test(api.planHeadHTML(d))) throw new Error('plan head: ' + api.planHeadHTML(d));
  if (!/data-dl="codex"/.test(v.html) || !/Sign in once to use/.test(v.html)) throw new Error('cards should show download % and sign-in need');
  const st = api.stepStates(d);
  if (st.join() !== 'false,true,true,false') throw new Error('step states: ' + st.join());
  api.accountSignedIn(api.AGENTS.claude);
  if (!api.draftChecks(d)[0].ok || !/Claude Code · Claude Sonnet/.test(api.draftChecks(d)[0].t)) throw new Error('signed-in template should be ready with its model');
  return { html: v.html, axo: 1 };
});
check('model (P0): each template lists its models; the choice reaches the CLI, YAML and plan; switching templates resets it', () => {
  if (api.modelsFor(api.AGENTS.claude).length !== 3 || api.modelsFor(api.AGENTS.codex).length !== 2 || api.modelsFor(api.AGENTS.antigravity).length !== 2) throw new Error('model lists');
  let v = api.viewNew(new URLSearchParams('agent=claude'));
  if ((v.html.match(/data-action="pick-model"/g) || []).length !== 3 || !/Best for most tasks/.test(v.html)) throw new Error('model row');
  api.ACTIONS['pick-model']({ dataset: { model: 'claude-haiku' } });
  if (!/--template claude-code --model claude-haiku/.test(api.draftCli(d))) throw new Error('cli: ' + api.draftCli(d));
  const y = api.manifestYAML(api.draftSpec(d));
  if (!/harness: claude-code/.test(y) || !/model: claude-haiku/.test(y) || /\n {2}agent: /.test(y)) throw new Error('yaml: ' + y);
  if (!/Claude Code · Claude Haiku/.test(api.readyHTML(d))) throw new Error('plan card should show the model');
  api.ACTIONS['pick-agent']({ dataset: { agent: 'codex' } });
  if (d.model !== null || api.modelOf('codex', d.model).id !== 'gpt-5-codex') throw new Error('model should reset to the new template default');
  api.ACTIONS['pick-agent']({ dataset: { agent: 'claude' } });
  if (/--model/.test(api.draftCli(d))) throw new Error('default model is implicit in the CLI');
  if (api.altModel('claude', 'claude-sonnet').id !== 'claude-haiku' || api.altModel('claude', 'claude-haiku').id !== 'claude-sonnet') throw new Error('altModel');
});
check('downloads follow you: a template still downloading says so, and Run waits for it instead of failing', () => {
  api.accountSignedIn(api.AGENTS.codex);
  api.ACTIONS['pick-agent']({ dataset: { agent: 'codex' } });
  const c = api.draftChecks(d);
  if (!c[0].ok || !/Downloading · <span data-dl="codex">/.test(c[0].s) || !/runs when it finishes/.test(c[0].s)) throw new Error('template check: ' + c[0].s);
  if (!/starts when Codex finishes downloading/.test(c[1].s)) throw new Error('where check: ' + c[1].s);
  d.goal = 'Fix the failing tests';
  if (!/Starts when Codex finishes downloading · about <span data-dl-secs="codex">/.test(api.planHeadHTML(d))) throw new Error('plan head: ' + api.planHeadHTML(d));
  api.ACTIONS['pick-agent']({ dataset: { agent: 'claude' } });
  d.goal = '';
});
check('workspace step: code, branch and "Starts with" are in the main flow; details one click away; More options holds the rest', () => {
  const v = api.viewNew(new URLSearchParams('agent=claude'));
  if (!/Set up the workspace/.test(v.html) || !/id="ws-chips"/.test(v.html) || !/Starts with/.test(v.html)) throw new Error('summary missing');
  const chips = api.wsChipsHTML(d);
  /* A first run has no GitHub sign-in yet, so the workspace starts without the GitHub MCP server (it couldn't start). */
  if (!/AGENTS\.md · 42 lines/.test(chips) || !/1 skill: ax-task/.test(chips) || !/No MCP servers/.test(chips) || !/<code>npm ci<\/code> · from package-lock\.json/.test(chips)) throw new Error('chips wrong: ' + chips);
  if (!/id="gh-connect"/.test(v.html) || !/Connect GitHub once/.test(v.html) || !/data-action="connect-github"/.test(v.html)) throw new Error('GitHub connect row missing');
  if (!/id="ws-more"/.test(v.html) || !/Instructions, files, skills, MCP servers and setup/.test(v.html)) throw new Error('details disclosure missing');
  if (!/aria-labelledby="branch-label"/.test(v.html)) throw new Error('branch row should be in the main flow');
  if (!/More options: template version, resources, guardrails, budget, YAML/.test(v.html)) throw new Error('More options label');
  return { html: v.html, axo: 1 };
});
check('repo keys once: GitHub connects in the workspace step, the workspace picks up the GitHub MCP server, Settings shows it with the CLI', () => {
  if (S.github.connected) throw new Error('a first run should start without GitHub');
  let v = api.viewNew(new URLSearchParams('agent=claude'));
  if (!/<b>GitHub<\/b><span>Issues and pull requests<\/span><\/span><span class="mi-auth need">Sign-in needed/.test(v.html)) throw new Error('the GitHub MCP server should say it needs a sign-in (not "Connected")');
  if (!/keeps the token in your keychain and adds it outside the sandbox/.test(v.html.match(/id="gh-connect"[\s\S]*?data-action="connect-github"/)[0])) throw new Error('the connect row should say where the token goes');
  /* Turning on the GitHub MCP server without GitHub is flagged before Run, like Linear. */
  d.mcp = ['github'];
  const c = api.draftChecks(d)[3];
  if (c.ok || !/GitHub needs sign-in/.test(c.s) || c.todo !== 'connect GitHub or remove it' || !/GitHub MCP server · GitHub needs sign-in/.test(api.wsChipsHTML(d))) throw new Error('GitHub MCP without a sign-in should be flagged: ' + c.s);
  if (!/The GitHub MCP server needs it to start/.test(api.viewNew(new URLSearchParams('agent=claude')).html)) throw new Error('the connect row should say why');
  d.mcp = [];
  /* Clone from Git: the hint points at the same row. */
  api.ACTIONS['pick-source']({ dataset: { source: 'git' } });
  v = api.viewNew(new URLSearchParams('agent=claude'));
  if (!/For a private repo, connect GitHub once below/.test(v.html) || !/You need it for private repos/.test(v.html)) throw new Error('git hint');
  api.ACTIONS['pick-source']({ dataset: { source: 'sample' } });
  if (/id="gh-connect"/.test(api.viewNew(new URLSearchParams('agent=claude')).html)) throw new Error('the sample project needs no GitHub');
  api.ACTIONS['pick-source']({ dataset: { source: 'folder' } });
  /* Connect once: the sign-in is saved, and this workspace picks up the GitHub MCP server. */
  const added = api.finishGithubConnect();
  if (!S.github.connected || !added || d.mcp.join() !== 'github') throw new Error('connecting should save the sign-in and add the GitHub MCP server');
  v = api.viewNew(new URLSearchParams('agent=claude'));
  if (/id="gh-connect"/.test(v.html) || !/GitHub MCP server<\/span>/.test(api.wsChipsHTML(d)) || !/Connected as rajitha · through Guardrails/.test(v.html)) throw new Error('after connecting');
  if (!api.draftChecks(d)[3].ok) throw new Error('the workspace step should be ready');
  if (/--workspace/.test(api.draftCli(d))) throw new Error('the GitHub MCP server is the default once connected, so the CLI stays a plain ax run: ' + api.draftCli(d));
  const sv = api.viewSettings();
  if (!/id="set-github"/.test(sv.html) || !/Signed in as rajitha · for private repos, pushes and the GitHub MCP server · added outside the sandbox/.test(sv.html) || !/<code>ax auth login github<\/code>/.test(sv.html) || !/data-action="disconnect-github"/.test(sv.html)) throw new Error('Settings → Agents & keys should list GitHub');
  return { html: v.html, axo: 1 };
});
check('task runner: the default ax-task-runner image is named in setup, the YAML and the task details', () => {
  if (api.runnerImage() !== 'ghcr.io/google/ax-task-runner:0.9.2') throw new Error('runner image');
  if (!api.LAYERS.some((l) => l.name === 'Agent images' && /^ax-task-runner 0\.9\.2 · antigravity/.test(l.tech))) throw new Error('setup should list the task runner with the agent images');
  if (!/\n  runner: ghcr\.io\/google\/ax-task-runner:0\.9\.2 # default task runner, maintained by AX/.test(api.manifestYAML(api.draftSpec(d)))) throw new Error('ax.yaml should name the runner');
  if (!/\n  runner: ghcr\.io\/google\/ax-task-runner:0\.9\.2/.test(api.manifestYAML(api.draftSpec(d), 'kit'))) throw new Error('the kit should name the runner');
});
check('setup command is detected per repo and says where it came from; edits can go back to detected', () => {
  api.ACTIONS['pick-folder']({ dataset: { i: '2' } });
  if (api.draftSetup(d) !== 'pip install -e ".[dev]"') throw new Error('accounts should use pip: ' + api.draftSetup(d));
  if (!/detected from pyproject\.toml/.test(api.manifestYAML(api.draftSpec(d)))) throw new Error('yaml should say where it came from');
  if (!/No AGENTS\.md in this repo/.test(api.wsChipsHTML(d))) throw new Error('accounts has no AGENTS.md');
  api.ACTIONS['pick-folder']({ dataset: { i: '1' } });
  if (api.draftSetup(d) !== 'pnpm install --frozen-lockfile') throw new Error('web-app should use pnpm');
  d.setup = 'make deps'; d.setupEdited = true;
  if (!/You changed this/.test(api.setupHintHTML(d)) || !/use-detected-setup/.test(api.setupHintHTML(d)) || !/--workspace ax\.yaml/.test(api.draftCli(d))) throw new Error('edited setup');
  api.ACTIONS['use-detected-setup']();
  if (d.setupEdited || api.draftSetup(d) !== 'pnpm install --frozen-lockfile') throw new Error('use detected');
  api.ACTIONS['pick-source']({ dataset: { source: 'git' } });
  if (api.draftSetup(d) !== 'auto' || !/setup: auto/.test(api.manifestYAML(api.draftSpec(d)))) throw new Error('git repos are read after cloning');
  api.ACTIONS['pick-source']({ dataset: { source: 'folder' } });
  api.ACTIONS['pick-folder']({ dataset: { i: '0' } });
});
check('Change… opens a folder picker (no cycling) with what AX found in each folder; 0 Axel in the dialog', () => {
  api.ACTIONS['change-folder']();
  const h = namedEls['#overlay'].innerHTML;
  if (!/Choose a folder/.test(h) || (h.match(/data-action="pick-folder"/g) || []).length !== 3 || !/Choose another folder…/.test(h) || !/from pyproject\.toml/.test(h)) throw new Error('picker incomplete');
  if (d.folderIdx !== 0) throw new Error('opening the picker must not change the folder');
  return { html: h, axo: 0 };
});
check('Try a sample project prefills the goal; leaving the sample clears it (unless edited)', () => {
  api.ACTIONS['pick-source']({ dataset: { source: 'sample' } });
  if (d.goal !== api.SAMPLE_GOAL) throw new Error('sample goal not prefilled');
  api.ACTIONS['pick-source']({ dataset: { source: 'folder' } });
  if (d.goal) throw new Error('prefilled goal should go with the sample');
  S.draft = null; const d2 = api.ensureDraft(new URLSearchParams('agent=claude&sample=1'));
  if (d2.source !== 'sample' || d2.goal !== api.SAMPLE_GOAL) throw new Error('?sample=1 should prefill');
  S.draft = null; go('#/new'); d = api.ensureDraft(new URLSearchParams(''));
});
check('saved workspace setups: save, list, reuse (and they survive a reload)', () => {
  d.folderIdx = 1; d.mcp = ['github', 'playwright']; d.skills = ['ax-task', 'test-runner']; d.instructions = 'Use pnpm.';
  api.ACTIONS['save-setup']();
  if (!S.savedSetups.length || S.savedSetups[0].name !== 'web-app setup' || !/web-app setup/.test(store['ax.setups'] || '')) throw new Error('not saved');
  const v = api.viewNew(new URLSearchParams(''));
  if (!/Saved setups/.test(v.html) || !/data-action="use-setup" data-i="0"/.test(v.html)) throw new Error('chip missing');
  S.draft = null; d = api.ensureDraft(new URLSearchParams(''));
  api.ACTIONS['use-setup']({ dataset: { i: '0' } });
  if (d.folderIdx !== 1 || d.mcp.join() !== 'github,playwright' || d.instructions !== 'Use pnpm.' || !d.skills.includes('test-runner')) throw new Error('not applied');
  S.draft = null; d = api.ensureDraft(new URLSearchParams(''));
});
check('inline files: add a file in the workspace details; it reaches the chips, YAML, CLI and setup steps; a file with a secret stays out', () => {
  api.ACTIONS['file-add']();
  if (d.inlineFiles.length !== 1 || !d.wsOpen) throw new Error('Add a file should add an empty file and open the details');
  let v = api.viewNew(new URLSearchParams('agent=claude'));
  if (!/data-file-i="0" data-file-k="path"/.test(v.html) || !/data-file-i="0" data-file-k="content"/.test(v.html) || !/data-action="file-remove" data-i="0"/.test(v.html) || !/id="file-add"/.test(v.html)) throw new Error('file row');
  d.inlineFiles[0].path = 'config/test.json'; d.inlineFiles[0].content = '{\n  "mode": "test"\n}';
  if (!/1 file: config\/test\.json/.test(api.wsChipsHTML(d))) throw new Error('chip: ' + api.wsChipsHTML(d));
  const y = api.manifestYAML(api.draftSpec(d));
  if (!/  files: # written into the workspace before the agent starts\n    - path: config\/test\.json\n      content: \| # 3 lines\n        \{\n          "mode": "test"\n        \}/.test(y)) throw new Error('yaml: ' + y);
  if (!/--workspace ax\.yaml/.test(api.draftCli(d))) throw new Error('a custom workspace runs from its spec');
  const tk = { agent: 'claude', env: 'local', baseBranch: 'main', version: '1.0.4', pin: 'pinned' };
  const steps = api.hydrationSteps(tk, d);
  if (!steps.some((s) => s.t === 'Added 1 file from your setup' && s.s === 'config/test.json')) throw new Error('setup steps: ' + steps.map((s) => s.t).join(' | '));
  d.inlineFiles.push({ path: '.env', content: 'STRIPE_SECRET_KEY=sk_live_51HfakeKey' });
  const c = api.draftChecks(d)[3];
  if (c.ok || !/\.env looks like it has a secret and won't be added/.test(c.s)) throw new Error('a file with a secret should be flagged: ' + c.s);
  const y2 = api.manifestYAML(api.draftSpec(d));
  if (/sk_live/.test(y2) || !/# \.env removed: looks like it has a secret/.test(y2)) throw new Error('a secret must never reach the YAML');
  if (api.hydrationSteps(tk, d).some((s) => /\.env/.test(s.s || ''))) throw new Error('a file with a secret must not be written into the sandbox');
  v = api.viewNew(new URLSearchParams('agent=claude'));
  if (!/id="file-warn-1" role="status"><svg[^>]*>[\s\S]*?This looks like it has a secret, so AX won(&#39;|')t add it/.test(v.html)) throw new Error('the file should say why it is kept out');
  api.ACTIONS['file-remove']({ dataset: { i: '1' } }); api.ACTIONS['file-remove']({ dataset: { i: '0' } });
  if (d.inlineFiles.length || !api.draftChecks(d)[3].ok) throw new Error('remove');
  return { html: v.html, axo: 1 };
});
check('template version can be pinned per task, and the latest release is shown', () => {
  const v = api.viewNew(new URLSearchParams(''));
  if (!/Template version/.test(v.html) || !/1\.0\.5 came out 2 days ago/.test(v.html) || !/Pin 1\.0\.4/.test(v.html)) throw new Error('version row');
  if (!/ax-claude-code:1\.0\.4 # pinned for this task/.test(api.manifestYAML(api.draftSpec(d)))) throw new Error('pinned image');
  api.ACTIONS['draft-set']({ dataset: { key: 'pin', val: 'latest' } });
  if (!/ax-claude-code:latest # 1\.0\.5 today/.test(api.manifestYAML(api.draftSpec(d))) || !/--workspace ax\.yaml/.test(api.draftCli(d))) throw new Error('latest image');
  api.ACTIONS['draft-set']({ dataset: { key: 'pin', val: 'pinned' } });
});

// ---------- Run: hydration ----------
let t;
check('Run hydrates the workspace step by step, then folds it into one Activity entry and starts the first turn', () => {
  d.goal = 'Add rate limiting to the checkout API'; d.model = 'claude-opus';
  api.createTaskFromDraft();
  t = S.tasks[0];
  if (!t || t.status !== 'starting' || !t.hydrate || t.model !== 'claude-opus' || t.version !== '1.0.4') throw new Error('task not starting with hydration');
  const titles = t.hydrate.steps.map((s) => s.t).join(' | ');
  for (const k of ['Started a secure sandbox', 'Copied ~/code/shop-api at main', 'Added AGENTS.md', 'Added 1 skill', 'Started 1 MCP server', 'Ran npm ci', 'Started Claude Code with Claude Opus']) if (!titles.includes(k)) throw new Error('missing step ' + k + ': ' + titles);
  if (t.hydrate.steps[0].s !== 'microVM · ax-task-runner 0.9.2 · your folder stays untouched') throw new Error('the sandbox step should name the task runner: ' + t.hydrate.steps[0].s);
  go('#/task/' + t.id);
  const w = api.workingHTML(t);
  if (!/Setting up the workspace/.test(w) || !/check-item pending/.test(w) || !/check-item idle/.test(w) || !/Copy ~\/code\/shop-api at main/.test(w)) throw new Error('checklist: ' + w.slice(0, 300));
  if (!/Setting up the workspace: starting a secure sandbox…/.test(api.nowLine(t))) throw new Error('Home\'s Now line should name the current step');
  if (!/Setting up the workspace/.test(api.nextStepHTML(t)) || !/0 of 7 done/.test(api.nextStepHTML(t))) throw new Error('Next step should show setup progress');
  drain(() => t.status === 'running');
  if (t.status !== 'running' || t.hydrate) throw new Error('should be running: ' + t.status);
  const ws = t.events.find((e) => e.type === 'workspace');
  if (!ws || ws.items.length !== 7 || !/shop-api at main · AGENTS\.md · 1 skill · GitHub MCP server · npm ci/.test(ws.summary)) throw new Error('workspace event: ' + JSON.stringify(ws && ws.summary));
  const h = api.evHTML(t, ws, t.events.indexOf(ws));
  if (!/set up the workspace · \d+(\.\d)? s/.test(h) || !/ws-card/.test(h)) throw new Error('activity entry');
  const v = api.viewTask(t.id, 'activity');
  if (!/v1\.0\.4 · Claude Opus/.test(v.html) || !/<dt>Model<\/dt><dd>Claude Opus/.test(v.html)) throw new Error('header/inspector should show version and model');
  if (!/<dt>Task runner<\/dt><dd class="mono"[^>]*>ghcr\.io\/google\/ax-task-runner:0\.9\.2<\/dd>/.test(v.html) || !/<dt>Resources<\/dt><dd>2 CPU · 4 GB<\/dd>/.test(v.html)) throw new Error('task details should name the task runner and the size');
  return { html: api.shellHTML() + v.html, axo: 1 };
});
check('a task started while its template downloads waits at "Downloading the … template", then continues', () => {
  go('#/new'); S.draft = null; d = api.ensureDraft(new URLSearchParams('agent=antigravity'));
  api.accountSignedIn(api.AGENTS.antigravity);
  if (!api.isDownloading('antigravity')) api.startDownloads(['antigravity'], 60000);
  d.goal = 'Document the public API';
  api.createTaskFromDraft();
  const t2 = S.tasks[0];
  if (!t2.hydrate.steps[0].dl) throw new Error('first step should be the download');
  go('#/task/' + t2.id);
  if (!/Downloading the Antigravity template/.test(api.workingHTML(t2)) || !/data-dl-secs="antigravity"/.test(api.workingHTML(t2))) throw new Error('download wait not shown');
  drain(null, 5);
  if (t2.hydrate.i !== 0) throw new Error('should still wait for the download');
  S.downloads.antigravity.start = 0;   /* download finishes */
  drain(() => t2.status === 'running');
  if (t2.status !== 'running') throw new Error('should continue after the download');
});
check('MCP server fails during setup: the step names it, Activity shows where it stopped, the fix offers Edit workspace setup', () => {
  go('#/new'); S.draft = null; d = api.ensureDraft(new URLSearchParams('agent=claude'));
  d.goal = "Triage this week's Linear issues"; d.mcp = ['github', 'linear']; S.mcpConnected = false;
  if (api.draftChecks(d)[3].ok || !/Linear needs sign-in/.test(api.wsChipsHTML(d))) throw new Error('should be flagged before Run');
  api.createTaskFromDraft();
  const t3 = S.tasks[0];
  drain(() => t3.status !== 'starting');
  const ws = t3.events.find((e) => e.type === 'workspace');
  if (t3.status !== 'failed' || !ws || !ws.failed || !ws.items.some((x) => x.failed && /Linear MCP server didn't start/.test(x.t))) throw new Error('mcp failure path');
  const acts = api.failActionsHTML('mcp-failed', { t: t3 }, 2);
  if (!/Connect Linear/.test(acts) || !/Edit workspace setup/.test(acts) || !/Remove Linear and retry/.test(acts)) throw new Error('actions: ' + acts);
  api.runFix('edit-workspace', { dataset: { task: t3.id } });
  api.render();
  if (!S.draft || !S.draft.wsOpen || !S.draft.mcp.includes('linear') || S.draft.goal !== "Triage this week's Linear issues" || ctx.location.hash !== '#/new') throw new Error('edit workspace should reopen New task at the workspace');
  S.draft.mcp = ['github'];
});
check('GitHub MCP server fails when GitHub was never connected: the card names it, gives the CLI, and Connect GitHub retries', () => {
  S.github.connected = false;
  go('#/new'); S.draft = null; d = api.ensureDraft(new URLSearchParams('agent=claude'));
  d.goal = 'Close the stale GitHub issues'; d.mcp = ['github'];
  api.createTaskFromDraft();
  const tg = S.tasks[0];
  drain(() => tg.status !== 'starting');
  const fe = tg.events.find((e) => e.type === 'fail');
  if (tg.status !== 'failed' || !fe || fe.code !== 'mcp-failed' || fe.server !== 'github') throw new Error('github mcp failure: ' + tg.status);
  const card = api.failCardHTML('mcp-failed', { t: tg, e: fe });
  if (!/MCP server “github” didn&#39;t start/.test(card) || !/GitHub needs you to sign in/.test(card) || !/Same fix from the command line: <code>ax auth login github<\/code>/.test(card) || !/mcp\[github\]: exited with code 1/.test(card)) throw new Error('card: ' + card.slice(0, 500));
  const acts = api.failActionsHTML('mcp-failed', { t: tg, e: fe }, 2);
  if (!/Connect GitHub/.test(acts) || !/Edit workspace setup/.test(acts) || !/Remove GitHub and retry/.test(acts)) throw new Error('actions: ' + acts);
  api.runFix('connect-mcp', { dataset: { task: tg.id } });
  drain(() => S.github.connected);
  if (!S.github.connected || tg.status !== 'starting') throw new Error('Connect GitHub should save the sign-in and retry');
  return { html: card };
});
check('a skill that fails to load: flagged before Run, setup stops at skills with its log, the fix offers Edit workspace setup or Remove', () => {
  go('#/new'); S.draft = null; d = api.ensureDraft(new URLSearchParams('agent=claude'));
  d.goal = 'Tidy up the checkout page styles'; d.skills = ['ax-task', 'frontend-design'];
  const c = api.draftChecks(d)[3];
  if (c.ok || !/frontend-design needs the Playwright browser MCP server/.test(c.s) || c.todo !== 'add Playwright browser or remove frontend-design' || !/frontend-design needs Playwright browser/.test(api.wsChipsHTML(d))) throw new Error('should be flagged before Run: ' + c.s);
  api.createTaskFromDraft();
  const t4 = S.tasks[0];
  drain(() => t4.status !== 'starting');
  const ws = t4.events.find((e) => e.type === 'workspace');
  const fe = t4.events.find((e) => e.type === 'fail');
  if (t4.status !== 'failed' || !ws || !/^Stopped at skills/.test(ws.summary) || !ws.items.some((x) => x.failed && x.t === "Skill “frontend-design” didn't load") || !fe || fe.code !== 'skill-failed' || fe.skill !== 'frontend-design' || fe.needs !== 'playwright') throw new Error('skill failure path: ' + JSON.stringify(ws && ws.summary));
  const card = api.failCardHTML('skill-failed', { t: t4, e: fe });
  if (!/Skill “frontend-design” didn&#39;t load/.test(card) || !/It uses the Playwright browser MCP server, and this workspace doesn&#39;t include it\. The other skill \(ax-task\) loaded fine\./.test(card) || !/skills\[frontend-design\]: needs mcp &quot;playwright&quot;/.test(card)) throw new Error('card: ' + card.slice(0, 600));
  const acts = api.failActionsHTML('skill-failed', { t: t4, e: fe }, 2);
  if (!/class="btn sm primary" data-action="fix" data-fix="edit-workspace"/.test(acts) || !/Remove frontend-design and retry/.test(acts)) throw new Error('actions: ' + acts);
  go('#/task/' + t4.id);
  const v = api.viewTask(t4.id, 'activity');
  if (!/Your next step/.test(v.html) || !/id="tab-changes"/.test(v.html)) throw new Error('task page');
  api.runFix('remove-skill', { dataset: { task: t4.id } });
  if (t4.skills.includes('frontend-design') || t4.status !== 'starting') throw new Error('Remove should retry without the skill');
  return { html: api.shellHTML() + v.html, axo: 1 };
});
check('review link ?scenario=task-skill opens the skill failure, and Edit workspace setup reopens New task with the skill', () => {
  api.runScenario('task-skill');
  const t5 = S.tasks[0];
  if (!t5 || t5.status !== 'failed' || t5.title !== 'Tidy up the checkout page styles' || (t5.skills || []).join() !== 'ax-task,frontend-design') throw new Error('scenario');
  const ns = api.nextStepHTML(t5, 'activity');
  if (!/Skill “frontend-design” didn&#39;t load/.test(ns) || !/data-fix="edit-workspace"/.test(ns) || !/Remove frontend-design and retry/.test(ns)) throw new Error('next step: ' + ns.slice(0, 400));
  api.runFix('edit-workspace', { dataset: { task: t5.id } });
  api.render();
  if (!S.draft || !S.draft.skills.includes('frontend-design') || !S.draft.wsOpen || ctx.location.hash !== '#/new') throw new Error('Edit workspace setup should reopen New task with the skill');
  if (!/frontend-design needs the Playwright browser MCP server/.test(api.draftChecks(S.draft)[3].s)) throw new Error('the reopened setup should say what to fix');
  S.draft.mcp = S.draft.mcp.concat('playwright');
  if (!api.draftChecks(S.draft)[3].ok) throw new Error('adding Playwright browser should fix it');
});
check('rate limit: a countdown to an automatic retry, Switch to a lighter model, and Use a different key; Retry now once the limit resets', () => {
  const tq = api.spawnFailure('quota');
  const acts = api.failActionsHTML('quota', { t: tq }, 3);
  if (/Retry now/.test(acts) || !/Switch to Claude Haiku/.test(acts) || !/Use a different key/.test(acts)) throw new Error('while waiting, no Retry now: ' + acts);
  const card = api.failCardHTML('quota', { t: tq });
  if (!/retries on its own in \d:\d\d/.test(card) || !/switch to Claude Haiku/.test(card)) throw new Error('fix text should count down and mention the model');
  tq.retryAt = Date.now() - 1;
  if (!/Retry now/.test(api.failActionsHTML('quota', { t: tq }, 3))) throw new Error('Retry now once the limit reset');
  tq.retryAt = Date.now() + 60000;
  api.runFix('switch-model', { dataset: { task: tq.id } });
  if (tq.model !== 'claude-haiku' || tq.status !== 'starting') throw new Error('switch-model should retry on Haiku');
});
check('API key rejected works on a fresh install (no seeded task): it spawns the failure', () => {
  const before = S.tasks.length;
  api.runScenario('key-rejected');
  const tk = S.tasks[0];
  if (S.tasks.length !== before + 1 || tk.agent !== 'codex' || tk.failCode !== 'key-rejected' || !api.AGENTS.codex.keyProblem) throw new Error('key-rejected scenario');
});
check('the catalog says template: Add a template · Browse templates · Bring your own agent', () => {
  api.openAgentCatalog({ tab: 'browse' });
  const h = namedEls['#overlay'].innerHTML;
  if (!/>Add a template</.test(h) || !/>Browse templates</.test(h) || !/>Bring your own agent</.test(h) || !/ax templates search/.test(h)) throw new Error('catalog wording');
  return { html: h, axo: 0 };
});
check('every other page renders cleanly in a first run (Settings, Guardrails, Where agents run, Home)', () => {
  let all = '';
  for (const h of ['agents', 'skills', 'appearance', 'accessibility', 'notifications', 'privacy', 'command-line', 'advanced'].map((x) => '#/settings/' + x).concat(['#/guardrails', '#/places', '#/'])) { go(h); all += namedEls['#main'].innerHTML; }
  if (!all.length) throw new Error('nothing rendered');
  return { html: all };
});

Promise.resolve().then(() => {
  console.log(fails ? `\n${fails} of ${n} FAILED` : `\nALL OK (${n} checks)`);
  if (fails) process.exitCode = 1;
});
