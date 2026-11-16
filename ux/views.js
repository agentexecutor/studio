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

/* AX Studio prototype — views. Strict <=1 Axel on screen at all times; seamless sanctuary atmosphere. */
'use strict';

const MOD = /Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘' : 'Ctrl';

/* ---------- Shell ---------- */
function shellHTML() {
  return `
  <div class="app">
    <aside class="sidebar" aria-label="Primary">
      <a class="brand" href="#/" aria-label="AX Studio home">${BRAND_MARK}<span class="brand-name">AX <span>Studio</span></span></a>
      <a class="btn primary new-btn" href="#/new" id="nav-new" aria-label="New task (N)">${icon('plus')}<span class="label">New task</span><span class="kbd-hint">N</span></a>
      <nav class="nav" aria-label="Main">
        <a href="#/" data-nav="home" id="nav-home">${icon('inbox')}<span class="label">Home</span><span class="count attn" id="nav-needs" hidden></span></a>
        <a href="#/guardrails" data-nav="guardrails" id="nav-guardrails">${icon('shield')}<span class="label">Guardrails</span></a>
        <a href="#/places" data-nav="places" id="nav-places">${icon('server')}<span class="label">Where agents run</span></a>
        <a href="#/settings" data-nav="settings" id="nav-settings">${icon('sliders')}<span class="label">Settings</span></a>
      </nav>
      <div class="nav nav-tasks" role="navigation" aria-label="Recent tasks"><div class="nav-label">Tasks<a class="nav-all" href="#/tasks">See all</a></div><div id="nav-tasks"></div></div>
      <div class="sidebar-foot">
        ${healthCardHTML()}
      </div>
    </aside>
    <div class="main">
      <div class="sanctuary-atmo" aria-hidden="true"></div>
      <header class="topbar">
        <div class="tb-left">
          <nav class="crumbs" aria-label="Breadcrumb" id="crumbs"></nav>
          <div class="tb-task" id="tb-task"></div>
        </div>
        <div class="topbar-actions">
          <button class="search-trigger" data-action="palette" id="search-trigger" aria-label="Search or run a command (${MOD}K)">
            ${icon('search', 'sm')}<span class="st-label">Search or run a command</span><span class="kbds" aria-hidden="true"><kbd>${MOD}</kbd><kbd>K</kbd></span>
          </button>
          <div class="bell-wrap">
            <button class="round-btn" id="bell" data-action="bell" aria-haspopup="dialog" aria-expanded="false" aria-label="Notifications">${icon('bell')}</button>
            <span class="bell-badge" id="bell-badge" hidden aria-hidden="true"></span>
            <div id="bell-pop"></div>
          </div>
          <button class="round-btn" id="theme-toggle" data-action="theme-toggle"></button>
          <button class="round-btn" id="shortcuts-btn" data-action="shortcuts" aria-label="Keyboard shortcuts">${icon('keyboard')}</button>
        </div>
      </header>
      <div class="conn-banner" id="conn-banner" role="status" hidden></div>
      <main id="main" tabindex="-1"></main>
    </div>
  </div>`;
}

function navTasksHTML() {
  const order = (t) => (NEEDS_YOU.includes(t.status) && !pausedByYou(t) ? 0 : ACTIVE.includes(t.status) || pausedByYou(t) ? 1 : 2);
  const cur = (location.hash.match(/#\/task\/([^/?]+)/) || [])[1];
  const list = state.tasks.filter((t) => !isFolded(t) || t.id === cur).sort((a, b) => order(a) - order(b) || b.startedAt - a.startedAt).slice(0, 8);
  if (!list.length) return '<div class="nav-empty">Tasks you start show up here.</div>';
  return list.map((t) => {
    /* The bead says what the task is doing now: paused and asleep tasks show a pause or moon, never the running pulse. */
    const held = pausedByYou(t) || asleepHeld(t);
    const s = held ? { label: 'Paused', icon: asleepHeld(t) ? 'moon' : 'pause' } : quotaWaiting(t) ? { label: 'Waiting', icon: 'clock' } : STATUS[t.status];
    /* A task continued by another agent keeps its title; name the agent so the two entries can be told apart. */
    const twin = state.tasks.some((x) => x !== t && x.title === t.title);
    const who = twin ? AGENTS[t.agent].name : '';
    return `<a href="#/task/${t.id}" class="nav-task" ${cur === t.id ? 'aria-current="page"' : ''} title="${esc(t.title)}${who ? ' · ' + who : ''} · ${s.label}">
      <span class="bead ${held ? 'paused' : quotaWaiting(t) ? 'waiting' : t.status}">${ACTIVE.includes(t.status) && !held ? '<i class="pulse-dot"></i>' : icon(s.icon)}</span>
      <span class="tt">${esc(t.title)}</span>${who ? `<span class="tt-agent">${who}</span>` : ''}<span class="sr-only">, ${s.label}</span></a>`;
  }).join('');
}

/* ---------- Shared bits (emptyHTML uses calm icons, NEVER duplicates Axel) ---------- */
function emptyHTML(title, desc, extra) {
  return `<div class="card empty">
    <div><div class="e-title">${title}</div><div class="small" style="margin-top:4px">${desc}</div></div>${extra || ''}</div>`;
}
function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}
/** The sign-in method as a noun, e.g. "ChatGPT account", so the choice and the Sign in button don't repeat each other. */
function accountName(A) { return (A.signIn || 'Sign in').replace(/^Sign in with /, '') + ' account'; }
function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

/* Most urgent thing, used by Axel's speech bubble on Home. */
function topNeed() {
  const order = ['blocked', 'waiting', 'failed'];
  for (const s of order) { const t = state.tasks.find((x) => x.status === s && !isFolded(x)); if (t) return t; }
  return null;
}
function speechFor() {
  const t = topNeed();
  if (t) {
    const A = AGENTS[t.agent];
    if (t.status === 'blocked') { const b = openBlock(t); return { t, text: `${A.name} is waiting for your OK to reach <span class="mono">${esc(b ? b.e.domain : 'a site')}</span>.`, cta: 'Decide' }; }
    if (t.status === 'waiting' && t.needs && t.needs.type === 'question') return { t, text: `${A.name} has a quick question about “${esc(t.title)}”.`, cta: 'Answer' };
    if (t.status === 'waiting' && t.handoffFailed) return { t, text: `The handoff didn't start, so “${esc(t.title)}” is paused with its work untouched.`, cta: 'Open' };
    if (t.status === 'waiting') return { t, text: `“${esc(t.title)}” is paused. Resume whenever you're ready.`, cta: 'Open' };
    return { t, text: `“${esc(t.title)}” stopped: ${esc(failInfo(t).title.charAt(0).toLowerCase() + failInfo(t).title.slice(1))}.`, cta: 'See the fix' };
  }
  const running = state.tasks.filter((x) => ACTIVE.includes(x.status)).length;
  if (running) return { text: `${plural(running, 'agent is', 'agents are')} running in their sandboxes. I'll wave if one needs you.` };
  return { text: 'Nothing running right now. What should we build next?' };
}

/* ---------- Home ---------- */
function stationHTML(cls, key, label, n, sub, ic, target) {
  return `<button type="button" class="station st-${cls} ${n ? 'has' : ''}" data-action="jump" data-target="${target}" id="station-${key}" aria-label="${label}: ${n}">
    <span class="st-top"><span class="st-num tnum">${n}</span></span>
    <span class="st-label">${label}</span><span class="st-sub">${sub}</span></button>`;
}
function nowLine(t) {
  if (t.queued) return 'Queued · waiting for room on this computer';
  if (asleepHeld(t)) return 'Paused while your computer slept';
  if (t.status === 'starting' && t.hydrate) return hydrateNowText(t);
  return describeEvent(t, currentEvent(t), true);
}
function taskRowHTML(t, kind) {
  const A = AGENTS[t.agent];
  const files = filesFor(t);
  const parent = t.parent && getTask(t.parent);
  const compared = t.altRun || t.compareWith;
  let lower = '', right = '', href = `#/task/${t.id}`;
  if (kind === 'working') {
    lower = `<div class="t-now"><span class="lbl">Now</span><span class="txt" id="now-${t.id}">${nowLine(t)}</span></div>`;
    right = `${journeyHTML(t, true)}${envBadge(t)}`;
  } else if (kind === 'review') {
    const add = files.reduce((n, f) => n + diffStats(f.lines).add, 0), del = files.reduce((n, f) => n + diffStats(f.lines).del, 0);
    lower = `<div class="t-now"><span class="lbl" style="color:var(--key-ink)">Next</span><span class="txt">${compared ? 'Compare 2 agent runs or review ' : 'Review '}${plural(files.length, 'changed file')}, then push a branch</span></div>`;
    right = `${compared ? `<span class="env" title="Ran in 2 isolated sandboxes">${icon('compare')}2 runs</span>` : ''}<span class="diffstat"><span class="a">+${add}</span><span class="d">−${del}</span></span>${diffBlocks(add, del)}<span class="btn sm" aria-hidden="true">Review</span>`;
    href = `#/task/${t.id}/changes`;
  } else if (kind === 'handed') {
    const kid = getTask(t.child);
    lower = `<div class="t-now"><span class="lbl">Handed off</span><span class="txt">${AGENTS[kid.agent].name} continues this task in the same workspace</span></div>`;
    right = envBadge(t);
  } else {
    lower = `<div class="t-now"><span class="lbl" style="color:var(--done)">Shipped</span><span class="txt">Pushed to <span class="mono">${esc(t.branch)}</span> · open a pull request when ready</span></div>`;
    right = `${envBadge(t)}${chip('done')}`;
  }
  return `<a class="task-row" href="${href}" id="row-${t.id}" aria-label="${esc(t.title)}, ${esc(quotaWaiting(t) ? 'Waiting' : t.queued ? 'Queued' : pausedByYou(t) ? 'Paused' : STATUS[t.status].label)}${kind === 'review' ? `, ${plural(files.length, 'changed file')} to review` : ''}">
    <div style="min-width:0">
      <div class="t-title">${esc(t.title)}</div>
      <div class="t-meta"><span>${A.name}</span><span class="dot"></span><span class="mono">${esc(t.repo)}</span><span class="dot"></span>
        ${t.status === 'done' ? `<span>${kind === 'handed' ? 'Stopped' : 'Finished'} ${since(t.finishedAt || t.startedAt, 'ago')}</span>` : `<span>Running ${since(t.startedAt, 'elapsed')}</span>`}
        ${parent ? `<span class="dot"></span><span>${icon('handoff', 'xs')} Continued from ${AGENTS[parent.agent].name}</span>` : ''}
      </div>
      ${lower}
    </div>
    <div class="t-right">${right}</div>
  </a>`;
}

function needsCardHTML(t) {
  const A = AGENTS[t.agent];
  let ic = 'hand', cls = t.status, nowTxt = '', next = '', extra = '', actions = '';
  if (t.status === 'blocked') {
    const b = openBlock(t);
    ic = 'shield';
    nowTxt = `${A.name} paused at Guardrails. It tried to reach <span class="mono">${esc(b ? b.e.domain : '')}</span>${b && b.e.purpose ? ` to ${esc(b.e.purpose.charAt(0).toLowerCase() + b.e.purpose.slice(1))}` : ''}.`;
    next = 'Decide whether this workspace can reach it. Zero secrets left the sandbox.';
    extra = b ? whyBlockedHTML(t, b.e) : '';
    actions = `<button class="btn primary sm" data-action="allow" data-task="${t.id}" data-ev="${b ? b.i : ''}" data-eid="${b ? evId(b.e) : ''}">${icon('check', 'sm')}Allow for ${esc(t.repo)}</button>
      <button class="btn sm" data-action="allow-once" data-task="${t.id}" data-ev="${b ? b.i : ''}" data-eid="${b ? evId(b.e) : ''}">Allow once</button>
      <button class="btn sm" data-action="deny" data-task="${t.id}" data-ev="${b ? b.i : ''}" data-eid="${b ? evId(b.e) : ''}">Keep blocked</button>
      <a class="btn ghost sm" href="#/task/${t.id}">Open task ${icon('arrowRight', 'sm')}</a>`;
  } else if (t.status === 'waiting' && t.needs && t.needs.type === 'question') {
    const q = openQuestion(t);
    ic = 'help';
    nowTxt = `${A.name} stopped to ask you something.`;
    next = 'Pick an answer, or reply in your own words.';
    extra = `<div class="n-quote">“${esc(q ? q.e.text : '')}”</div>`;
    actions = (q && q.e.options ? q.e.options : []).map((o, k) => `<button class="btn sm ${k ? '' : 'primary'}" data-action="answer" data-task="${t.id}" data-text="${esc(o)}">${esc(o)}</button>`).join('') +
      `<a class="btn ghost sm" href="#/task/${t.id}">Open task ${icon('arrowRight', 'sm')}</a>`;
    actions += `</div><form class="n-reply" data-form="answer" data-task="${t.id}"><label class="sr-only" for="reply-${t.id}">Reply to ${A.name}</label><input class="input" id="reply-${t.id}" placeholder="Or reply in your own words…" autocomplete="off"><button class="btn" type="submit">${icon('send', 'sm')}Send</button></form><div>`;
  } else if (t.status === 'waiting' && t.needs && t.needs.type === 'permission') {
    /* "Ask before risky commands" is on; the agent waits for your OK before a risky command in its sandbox. */
    const p = typeof openPermission === 'function' ? openPermission(t) : null;
    ic = 'hand';
    nowTxt = `${A.name} wants to run <span class="mono">${esc(p ? p.e.cmd : '')}</span> in its sandbox.`;
    next = 'Allow it once, for this task, or not at all. Your folder is untouched either way.';
    actions = p ? `<button class="btn primary sm" data-action="perm-once" data-task="${t.id}" data-ev="${p.i}" data-eid="${evId(p.e)}">${icon('check', 'sm')}Allow once</button>
      <button class="btn sm" data-action="perm-task" data-task="${t.id}" data-ev="${p.i}" data-eid="${evId(p.e)}">Allow for this task</button>
      <button class="btn sm" data-action="perm-deny" data-task="${t.id}" data-ev="${p.i}" data-eid="${evId(p.e)}">Don't allow</button>
      <a class="btn ghost sm" href="#/task/${t.id}">Open task ${icon('arrowRight', 'sm')}</a>` : '';
  } else if (t.status === 'waiting' && t.needs && t.needs.type === 'budget') {
    const b = openBudget(t), amt = b ? b.e.budget : budgetFor(t);
    ic = 'hand';
    nowTxt = `${A.name} reached your $${amt.toFixed(2)} check-in and is waiting at the end of its turn.`;
    next = 'Keep going, or stop the task. Changes so far are kept either way.';
    actions = `<button class="btn primary sm" data-action="budget-raise" data-task="${t.id}">${icon('play', 'sm')}Keep going to $${(amt + BUDGET_STEP).toFixed(2)}</button>
      <button class="btn sm" data-action="budget-stop" data-task="${t.id}">${icon('stop', 'sm')}Stop task</button>
      <a class="btn ghost sm" href="#/task/${t.id}">Open task ${icon('arrowRight', 'sm')}</a>`;
  } else if (t.status === 'waiting' && t.handoffFailed) {
    /* F5: a failed handoff folds into its source task — one card, Task A untouched, two clear ways forward. */
    const kid = t.failedChild && getTask(t.failedChild);
    ic = 'handoff'; cls = 'paused';
    nowTxt = `<strong>${kid ? AGENTS[kid.agent].name : 'The next agent'} couldn't start.</strong> ${A.name}'s work is untouched and paused.`;
    next = `Resume with ${A.name}, or try another agent.`;
    actions = `<button class="btn primary sm" data-action="resume" data-task="${t.id}">${icon('play', 'sm')}Resume with ${A.name}</button><button class="btn sm" data-action="handoff" data-task="${t.id}">${icon('handoff', 'sm')}Try another agent</button>${kid ? `<a class="btn ghost sm" href="#/task/${kid.id}">See what happened ${icon('arrowRight', 'sm')}</a>` : ''}`;
  } else if (t.status === 'waiting') {
    ic = 'pause'; cls = 'paused';
    nowTxt = 'Paused by you. Nothing is running.';
    next = `Resume when you're ready. ${A.name} picks up exactly where it stopped.`;
    actions = `<button class="btn primary sm" data-action="resume" data-task="${t.id}">${icon('play', 'sm')}Resume</button><a class="btn ghost sm" href="#/task/${t.id}">Open task ${icon('arrowRight', 'sm')}</a>`;
  } else if (t.status === 'failed') {
    const fi = failInfo(t);
    ic = (ERRORS[fi.code] && ERRORS[fi.code].icon) || 'alert';
    nowTxt = `<strong>${esc(fi.title)}.</strong>`;
    next = esc(fi.fix);
    actions = `${failActionsHTML(fi.code, fi.ctx, 2)}
      <a class="btn ghost sm" href="#/task/${t.id}">See what happened ${icon('arrowRight', 'sm')}</a>`;
  }
  return `<article class="needs-card s-${cls}" id="needs-${t.id}" aria-labelledby="needs-title-${t.id}">
    <div style="min-width:0">
      <div class="n-top"><a class="n-title" id="needs-title-${t.id}" href="#/task/${t.id}">${esc(t.title)}</a>${chip(t.status, t)}<span class="env">${agentTile(t.agent, 'sm')}${A.name}</span>${envBadge(t)}</div>
      <dl class="nn"><dt>Now</dt><dd>${nowTxt}</dd><dt style="color:var(--coral-ink)">Next</dt><dd style="color:var(--ink);font-weight:600">${next}</dd></dl>
      ${extra}
      <div class="n-actions">${actions}</div>
    </div>
  </article>`;
}

/* ---------- Dropdown select (works like a regular select) ----------
   Click it, or press Down, Up, Enter or Space, to open the list. Arrow keys, Home, End or typing a name move through
   it; Enter, Space, Tab or a click picks; Escape or a click outside closes without a change. ARIA select-only combobox:
   focus stays on the box and aria-activedescendant points at the highlighted option. Every template dropdown uses it
   (Home's goal box, with or without tasks). The open list lives in state.openSelect, so a background redraw keeps it
   open. Behaviour: openSelect, pickSelect and selKeydown in app.js. */
function selectHTML({ key, label, value, options, btnClass }) {
  const id = 'sel-' + key;
  const open = !!(state.openSelect && state.openSelect.key === key);
  const cur = options.find((o) => o.value === value) || options[0];
  if (!cur) return '';
  const active = open && options.some((o) => o.value === state.openSelect.active) ? state.openSelect.active : cur.value;
  return `<div class="sel${open ? ' open' : ''}" data-sel="${key}">
    <div class="sel-btn ${btnClass || ''}" id="${id}" role="combobox" tabindex="0" aria-label="${esc(label)}" aria-haspopup="listbox" aria-controls="${id}-list" aria-expanded="${open}"${open ? ` aria-activedescendant="${id}-${active}"` : ''} data-action="sel-toggle" data-key="${key}">${cur.lead || ''}<span class="sel-val">${esc(cur.name)}</span>${icon('chevDown', 'xs')}</div>
    <ul class="sel-list" id="${id}-list" role="listbox" aria-label="${esc(label)}"${open ? '' : ' hidden'}>${options.map((o) => `
      <li class="sel-opt${o.value === active ? ' is-active' : ''}" role="option" id="${id}-${o.value}" aria-selected="${o.value === cur.value}" data-action="sel-pick" data-key="${key}" data-value="${o.value}">${o.lead || ''}<span class="sel-txt"><b>${esc(o.name)}</b>${o.sub ? `<small>${o.sub}</small>` : ''}</span>${icon('check', 'sm')}</li>`).join('')}
    </ul>
  </div>`;
}
/** The template dropdown in Home's goal box: every template you can pick, with what it's good at (or its download). */
function quickAgentId() { const a = AGENTS[state.quickAgent]; return a && !a.removed ? a.id : DEFAULT_AGENT; }
/* Bring your own agent, as its own option next to the templates (CUJ 2): the same tile shape, the Yours colour. */
function byoTile(size) { return `<span class="agent-tile byo ${size || ''}" aria-hidden="true">${AGENT_GLYPHS.custom}</span>`; }
function templateSelectHTML() {
  return selectHTML({
    key: 'quick-agent', label: 'Template', value: quickAgentId(), btnClass: 'agent-pick',
    options: agentList().map((a) => ({
      value: a.id, name: a.name, lead: agentTile(a.id, 'sm'),
      sub: isDownloading(a.id) ? `Downloading · <span data-dl="${a.id}">${dlPct(a.id)}%</span>` : esc(a.desc || agentSource(a).long),
    })).concat([{ value: 'byo', name: 'Your own agent…', lead: byoTile('sm'), sub: 'An ADK agent, a container image or a Git repo' }]),
  });
}

/* ---------- Home on day 0 (no tasks yet) ----------
   No empty sections, counters or rail. One focused, playful scene: Axel greets you, says in one casual sentence how it
   works (template, workspace, goal, then you review), and nudges you to start your first task (or to finish setup if
   you skipped it), with ideas to start from. Axel reacts as you go (see homeNudge in app.js). */
const FIRST_IDEAS = [
  { label: 'Fix the failing tests', goal: 'Fix the failing tests', ic: 'checkCircle' },
  { label: 'Write a README', goal: 'Write a README with a quick start and how to run the tests', ic: 'file' },
  { label: 'Add missing tests', goal: 'Add tests for the code that has none, and make sure they pass', ic: 'sparkle' },
];
function homeIsBlank() { return !state.tasks.some((t) => !isFolded(t)); }
function viewHomeBlank() {
  const qa = quickAgentId();
  const setUp = state.env.mode !== 'none';
  /* Axel's reaction (homeNudge) survives redraws of this page, such as theme changes or download progress, but not a
     fresh visit: come back later and he says hello again instead of an old "Great pick!". */
  const again = !!(state.route && typeof lastPath !== 'undefined' && lastPath === state.route.path);
  if (!again) { state.homeNudged = null; state.axelSpeech = null; }
  if (!setUp) state.homeNudged = null;
  const L = state.homeNudged && typeof FIRST_LINES !== 'undefined' ? FIRST_LINES[state.homeNudged] : null;
  const recent = again && setUp && state.axelSpeech && Date.now() - state.axelSpeech.at < 8000 ? state.axelSpeech.text : null;
  const said = recent || (L ? L.text : null);
  const hello = setUp
    ? `Hi ${esc(state.user.first)}! I'm Axel. Pick a template and a workspace, tell me what you want done, and I'll get an agent working on it. You review the changes at the end. <b>Let’s start your first task!</b>`
    : `Hi ${esc(state.user.first)}! Before your first agent, let's set up where agents run. It only takes a few minutes.`;
  const cta = setUp ? `
    <form class="quick first-quick" data-form="quick" aria-label="Start your first task">
      <label class="sr-only" for="quick-goal">What should an agent work on?</label>
      <input id="quick-goal" placeholder="Describe the outcome, like “Fix the failing tests”" autocomplete="off" value="${esc(state.quickGoal || '')}">
      ${templateSelectHTML()}
      <button class="btn primary first-go" type="submit">Set up task${icon('arrowRight', 'sm')}</button>
    </form>
    <div class="first-ideas" role="group" aria-label="Ideas to start with">
      <span class="fi-label">Or start with</span>
      ${FIRST_IDEAS.map((x) => `<button type="button" class="pill fi-idea" data-action="first-idea" data-goal="${esc(x.goal)}">${icon(x.ic, 'xs')}${esc(x.label)}</button>`).join('')}
      <a class="pill fi-idea sample" href="#/new?agent=${qa}&amp;sample=1">${icon('box', 'xs')}Try the sample project</a>
    </div>`
    : `
    <div class="first-setup">
      <a class="btn primary lg first-go" href="#/welcome" data-action="setup-resume-path" data-path="local">${icon('laptop', 'sm')}Set up this computer</a>
      <a class="btn lg" href="#/welcome" data-action="setup-resume-path" data-path="cluster">${icon('cloud', 'sm')}Connect to a remote cluster</a>
    </div>`;
  const banner = setUp ? envBannerHTML() : '';
  const html = `
  ${banner}
  <section class="stage first-stage" aria-labelledby="hello-title">
    <div class="fs-axel">
      <span class="fs-bubbles" aria-hidden="true">${[[16, 9, 7.5, 0], [29, 6, 6, 2.4], [43, 12, 8.5, 4.6], [60, 7, 6.5, 1.2], [73, 10, 7.8, 3.4], [86, 6, 6.2, 5.6]].map(([x, s, d, t]) => `<i style="--x:${x}%;--s:${s}px;--d:${d}s;--t:${t}s"></i>`).join('')}</span>
      ${springPoolHTML(L ? L.mood : 'wave', 'working', 'hero-axo')}
      <div class="speech fs-speech${said ? ' still' : ''}" id="axel-speech" aria-live="off">${said || hello}</div>
    </div>
    <h1 id="hello-title" tabindex="-1">${setUp ? 'Let’s run your <em>first agent</em>' : 'Let’s get <em>you set up</em>'}</h1>
    <p class="lede">${setUp ? 'Describe the outcome you want. AX sets up a secure sandbox, and nothing reaches your code until you review it.' : 'Run agents in a secure sandbox on this computer, or connect to a cluster your team already runs.'}</p>
    ${cta}
  </section>`;
  return { title: 'Home', crumbs: [{ label: 'Home' }], html, after: () => { if (typeof startFirstNudge === 'function') startFirstNudge(); } };
}

const HOME_NEEDS_MAX = 8;
function viewHome() {
  if (homeIsBlank()) return viewHomeBlank();
  const f = state.homeFilter;
  const list = state.tasks.filter((t) => !isFolded(t) && (f === 'all' || t.env === f));
  const needs = list.filter(needsYou);
  /* Paused on purpose isn't "needs you": it stays under Working with its Paused chip. */
  const working = list.filter((t) => ACTIVE.includes(t.status) || pausedByYou(t));
  const review = list.filter(awaitingReview).sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
  const shipped = list.filter((t) => t.status === 'done' && !t.notKept && !handedOff(t) && (t.pushed || appliedAll(t) || !filesFor(t).length)).sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
  /* CUJ 4: a task another agent continued isn't waiting for review (its workspace moved on); it's listed last. */
  const handed = list.filter(handedOff).sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
  const allNeeds = needsCount();
  const allRunning = state.tasks.filter((t) => ACTIVE.includes(t.status)).length;
  const heroMood = allNeeds ? 'wave' : allRunning ? 'working' : 'idle';
  const heroTone = allNeeds ? 'needs' : allRunning ? 'working' : 'calm';
  /* The tiles below carry the counts; the lede only says where to start. */
  const lede = allNeeds
    ? 'Start with what needs you below. Agents keep working in their own sandboxes while you decide.'
    : allRunning ? 'Nothing needs you right now. Agents are working in their own sandboxes.' : 'Every sandbox is quiet. Describe your next outcome and an agent will pick it up.';
  const runningAgents = [...new Set(state.tasks.filter((t) => ACTIVE.includes(t.status)).map((t) => t.agent))];
  const allReview = state.tasks.filter(awaitingReview);
  const reviewFiles = allReview.reduce((n, t) => n + filesFor(t).length, 0);
  const allShipped = state.tasks.filter((t) => t.status === 'done' && t.pushed).length;
  const doneToday = state.tasks.filter((t) => t.status === 'done' && t.finishedAt && now() - t.finishedAt < 24 * 3600 * 1000).length;
  /* A first run (CUJ 2) starts with an empty week; the demo shows a typical one. */
  const week = state.firstRun ? [0, 0, 0, 0, 0, 0, doneToday] : [3, 5, 2, 6, 4, 1, doneToday];
  const weekTotal = week.reduce((a, b) => a + b, 0);
  const preset = GUARDRAIL_PRESETS[state.guardrailPreset] || GUARDRAIL_PRESETS.balanced;

  /* Whatever Axel last said stays up for a few seconds, even if the page refreshes underneath him. */
  const said = state.axelSpeech && Date.now() - state.axelSpeech.at < 8000 ? state.axelSpeech : null;
  const html = `
  <section class="stage" aria-labelledby="hello-title">
    <div class="stage-copy">
      <h1 id="hello-title" tabindex="-1">${greeting()}, <em>${state.user.first}</em>.</h1>
      <p class="lede">${lede}</p>
      <form class="quick" data-form="quick" aria-label="Start a task">
        <label class="sr-only" for="quick-goal">What should an agent work on?</label>
        <input id="quick-goal" placeholder="What should an agent work on next?" autocomplete="off" value="${esc(state.quickGoal || '')}">
        ${templateSelectHTML()}
        <button class="btn" type="submit">Set up task${icon('arrowRight', 'sm')}</button>
      </form>
    </div>
    <div class="stage-axo">
      <div class="stage-bubble-col">
        <div class="speech${said ? ' still' : ''}" id="axel-speech" aria-live="off" ${said ? '' : 'hidden'}>${said ? said.text : ''}</div>
      </div>
      ${springPoolHTML(heroMood, heroTone, 'hero-axo')}
    </div>
  </section>
  ${envBannerHTML()}

  <div class="card flow" role="group" aria-label="Where your tasks are right now">
    ${stationHTML('needs', 'needs', 'Needs you', allNeeds, allNeeds ? 'Answer, allow or fix' : 'All caught up', 'hand', 'sec-needs')}<span class="flow-link" aria-hidden="true"></span>
    ${stationHTML('working', 'working', 'Working', allRunning, runningAgents.length ? `<span class="stack">${runningAgents.map((a) => agentTile(a, 'sm')).join('')}</span>` : 'No agents running', 'activity', 'sec-working')}<span class="flow-link" aria-hidden="true"></span>
    ${stationHTML('review', 'review', 'Ready to review', allReview.length, allReview.length ? plural(reviewFiles, 'file') + ' in sandbox' : 'Nothing to review', 'eye', 'sec-review')}<span class="flow-link" aria-hidden="true"></span>
    ${stationHTML('shipped', 'shipped', 'Shipped', allShipped, 'Pushed this week', 'branch', 'sec-shipped')}
  </div>

  <div class="home-grid">
    <div>
      <div class="section" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:26px">
        <h2 class="h-display-sm" style="margin-right:auto">Your tasks</h2>
        <a class="link" href="#/tasks">All tasks</a>
        <div class="seg" role="group" aria-label="Filter tasks by where they run">
          ${[['all', 'All'], ['local', 'This computer'], ['cluster', 'Remote cluster']].map(([k, l]) =>
            `<button type="button" data-action="home-filter" data-filter="${k}" aria-pressed="${f === k}">${l}</button>`).join('')}
        </div>
      </div>
      <section class="section" style="margin-top:18px" aria-labelledby="sec-needs" id="sec-needs-wrap">
        <div class="section-head"><h2 id="sec-needs">Needs you</h2></div>
        ${needs.length ? needs.slice(0, HOME_NEEDS_MAX).map(needsCardHTML).join('') + (needs.length > HOME_NEEDS_MAX ? `<a class="link see-all-needs" href="#/tasks" data-action="tasks-needs">See all ${needs.length} that need you in All tasks</a>` : '') : `<div class="card caught-up"><div><div style="font-weight:600">You're all caught up</div><div class="small muted">Axel waves above the moment an agent needs a decision.</div></div></div>`}
      </section>
      <section class="section" aria-labelledby="sec-working">
        <div class="section-head"><h2 id="sec-working">Working</h2></div>
        ${working.length ? `<div class="task-list">${working.map((t) => taskRowHTML(t, 'working')).join('')}</div>` : emptyHTML('No agents running', 'Describe a task above to start one. You can also race two agents side by side, each in its own sandbox.')}
      </section>
      <section class="section" aria-labelledby="sec-review">
        <div class="section-head"><h2 id="sec-review">Ready to review</h2></div>
        ${review.length ? `<div class="task-list">${review.map((t) => taskRowHTML(t, 'review')).join('')}</div>` : emptyHTML('Nothing to review yet', 'Finished edits stay inside the sandbox until you keep or push them.')}
      </section>
      <section class="section" aria-labelledby="sec-shipped">
        <div class="section-head"><h2 id="sec-shipped">Shipped</h2></div>
        ${shipped.length ? `<div class="task-list">${shipped.map((t) => taskRowHTML(t, 'shipped')).join('')}</div>` : emptyHTML('Nothing shipped yet', 'Pushed branches appear here with task provenance.')}
      </section>
      ${handed.length ? `<section class="section" aria-labelledby="sec-handed">
        <div class="section-head"><h2 id="sec-handed">Handed off</h2></div>
        <div class="task-list">${handed.map((t) => taskRowHTML(t, 'handed')).join('')}</div>
      </section>` : ''}
    </div>

    <aside class="rail" aria-label="At a glance">
      <section class="card card-pad" aria-labelledby="rail-week">
        <h2 class="panel-title" id="rail-week">This week</h2>
        <div style="display:flex;align-items:baseline;gap:8px;margin-top:10px">${weekTotal ? `<span class="stat-num tnum">${weekTotal}</span><span class="small muted">tasks finished safely</span>` : '<span class="small muted">No finished tasks yet. Your first one shows up here.</span>'}</div>
        ${weekBars(week, 'Tasks finished per day')}
      </section>
      <section class="card card-pad" aria-labelledby="rail-guard">
        <h2 class="panel-title" id="rail-guard">Guardrails · ${esc(preset.name)}</h2>
        <p class="small muted" style="margin-top:8px">${plural(state.blockedLog.length, 'site', 'sites')} stopped this week · 0 secrets sent. Same rules on this computer and on remote clusters.</p>
        <a class="link" href="#/guardrails">Manage guardrails ${icon('chevRight', 'xs')}</a>
      </section>
    </aside>
  </div>`;
  return { title: 'Home', crumbs: [{ label: 'Home' }], html };
}

/* ---------- New task (CUJ 2, in order: template → where → workspace → goal → Run) ----------
   Each folder knows its setup command (detected from its lockfile or project file). */
const FOLDERS = [
  { path: '~/code/shop-api', repo: 'shop-api', branch: 'main', branches: ['main', 'develop', 'release/2.4'], clean: true, agentsMd: 42, setup: 'npm ci', setupFrom: 'package-lock.json', lang: 'TypeScript', files: '1,204 files' },
  { path: '~/code/web-app', repo: 'web-app', branch: 'main', branches: ['main', 'next'], clean: false, dirty: 2, agentsMd: 18, setup: 'pnpm install --frozen-lockfile', setupFrom: 'pnpm-lock.yaml', lang: 'TypeScript', files: '2,318 files' },
  { path: '~/code/accounts', repo: 'accounts', branch: 'develop', branches: ['develop', 'main'], clean: true, agentsMd: 0, setup: 'pip install -e ".[dev]"', setupFrom: 'pyproject.toml', lang: 'Python', files: '486 files' },
];
const SAMPLE = { repo: 'ax-sample-todo', path: 'Sample: ax-sample-todo', setup: 'npm ci', setupFrom: 'package-lock.json', agentsMd: 12 };
/* The sample project comes with a goal, so a first-timer can run it right away. */
const SAMPLE_GOAL = 'Fix the failing tests in the sample to-do app';
const SUGGESTIONS = ['Fix the failing tests', 'Validate the signup form', 'Document the public API', 'Fix accessibility issues'];
/* CUJ 2 · the user prompt: three plain-language ingredients that help any agent. Each tip shows only while it's missing,
   and adds an editable line to the goal (never rewrites what you wrote). */
const GOAL_TIPS = [
  { id: 'done', label: 'How to check it’s done', add: 'Done when: the tests pass and the new behavior has a test.',
    test: /\b(done when|so that|until|should (pass|return|show|work)|tests? (pass|still pass)|returns? \d{3})\b/i },
  { id: 'where', label: 'Where to start', add: 'Start in: the code that handles this. Read AGENTS.md first.',
    test: /\b(start in|focus on|look (in|at)|in (src|app|lib|api|web|tests?)\/)|\.(tsx?|jsx?|py|go|java|rb|rs|md)\b/i },
  { id: 'keep', label: 'What not to change', add: "Don't change: public APIs or unrelated files. Ask before adding dependencies.",
    test: /\b(don[’']?t|do not|without|avoid|keep .{1,40}(unchanged|the same|as is))\b/i },
];
function goalHelpHTML(d) {
  const g = (d.goal || '').trim();
  if (!g) return `<span class="gh-label">Try</span>${SUGGESTIONS.map((s) => `<button type="button" class="pill" data-action="suggest" data-text="${esc(s)}">${esc(s)}</button>`).join('')}`;
  const missing = GOAL_TIPS.filter((t) => !t.test.test(g));
  if (!missing.length) return `<span class="gh-ok">${icon('checkCircle', 'sm')}Clear goal. The agent plans from this, and you can steer it anytime.</span>`;
  return `<span class="gh-label">Make it clearer</span>${missing.map((t) => `<button type="button" class="pill gh-add" data-action="goal-tip" data-tip="${t.id}">${icon('plus', 'xs')}${esc(t.label)}</button>`).join('')}`;
}

function localReady() { return state.env.mode === 'local'; }
function ensureDraft(q) {
  if (!state.draft) {
    state.draft = {
      goal: '', agent: DEFAULT_AGENT, model: null, compare: false, agent2: 'claude', source: 'folder', folderIdx: 0, git: '', env: localReady() ? 'local' : 'cluster',
      setup: '', setupEdited: false, size: 'medium', keyInput: '', keyState: null, keyMsg: '', keyMethod: 'account', error: '', pin: state.pinImages ? 'pinned' : 'latest',
      branch: null, includeUncommitted: true, useAgentsMd: true, instructions: '', skills: ['ax-task'], mcp: defaultMcp(), envVars: '', budget: 5, preset: null, extraRepos: [], inlineFiles: [],
    };
  }
  const d = state.draft;
  /* Apply URL params only when the URL changes, so picking a card isn't undone by the next render. */
  const qs = q.toString();
  if (d._qs !== qs) {
    d._qs = qs;
    if (q.get('goal')) d.goal = q.get('goal');
    const tpl = q.get('template') || q.get('agent');
    if (tpl && AGENTS[tpl] && !AGENTS[tpl].removed && d.agent !== tpl) { d.agent = tpl; d.model = null; }
    if (q.get('sample')) { d.source = 'sample'; prefillSampleGoal(d); }
    if (q.get('env') === 'cluster' || q.get('env') === 'local') d.env = q.get('env');
    /* ?find=browse|byo (from the setup screen or a shared link) opens "Add a template" once per link. */
    d.openFind = q.get('find') === 'byo' ? 'byo' : q.get('find') ? 'browse' : null;
  }
  if (!AGENTS[d.agent] || AGENTS[d.agent].removed) { d.agent = DEFAULT_AGENT; d.model = null; }
  if (d.model && !modelsFor(AGENTS[d.agent]).some((m) => m.id === d.model)) d.model = null;
  if (d.agent2 === d.agent || !AGENTS[d.agent2] || AGENTS[d.agent2].removed) d.agent2 = agentList().find((a) => a.id !== d.agent && a.connected) ? agentList().find((a) => a.id !== d.agent && a.connected).id : agentList().find((a) => a.id !== d.agent).id;
  return d;
}
function prefillSampleGoal(d) { if (!(d.goal || '').trim()) { d.goal = SAMPLE_GOAL; d.goalFromSample = true; d.error = ''; } }
function draftRepo(d) {
  if (d.source === 'sample') return { repo: SAMPLE.repo, path: SAMPLE.path };
  if (d.source === 'git') { const m = d.git.match(/([^/]+?)(\.git)?$/); return { repo: m && d.git ? m[1] : 'repo', path: d.git || 'https://github.com/…' }; }
  const f = FOLDERS[d.folderIdx];
  return { repo: f.repo, path: f.path };
}
function draftBranch(d) { return d.source === 'folder' ? (d.branch || FOLDERS[d.folderIdx].branch) : d.source === 'git' ? (d.branch || 'main') : null; }
/** The setup command comes from the repo (its lockfile or project file), and says where it came from. A Git repo is
    read after cloning ("auto"). */
function detectedSetup(d) {
  if (d.source === 'sample') return { cmd: SAMPLE.setup, from: SAMPLE.setupFrom };
  if (d.source === 'git') return { cmd: 'auto', from: null };
  const f = FOLDERS[d.folderIdx];
  return { cmd: f.setup, from: f.setupFrom };
}
function draftSetup(d) { return d.setupEdited && (d.setup || '').trim() ? d.setup.trim() : detectedSetup(d).cmd; }
function draftModel(d) { return modelOf(d.agent, d.model); }
function draftCli(d) {
  const r = draftRepo(d);
  const A = AGENTS[d.agent];
  /* A customized setup runs from its Workspace spec, so the CLI stays an exact equivalent of the form. */
  const custom = (d.extraRepos || []).length || (d.instructions || '').trim() || (d.envVars || '').trim() || d.mcp.join() !== defaultMcp().join() || d.skills.join() !== 'ax-task' || cleanFiles(d.inlineFiles).length
    || (d.preset && d.preset !== state.guardrailPreset) || Number(d.budget) !== 5 || draftSetup(d) !== detectedSetup(d).cmd || d.size !== 'medium' || (d.pin === 'latest') === state.pinImages;
  const src = custom ? '--workspace ax.yaml' : d.source === 'git' ? `--git ${d.git || '<url>'}` : d.source === 'sample' ? '--sample' : `--repo ${r.path}`;
  const goal = (d.goal || 'Describe the goal').replace(/\s*\n+\s*/g, ' ').replace(/"/g, '\\"');
  const m = draftModel(d), m0 = modelsFor(A)[0];
  const tpl = d.compare ? `--compare ${A.cli},${AGENTS[d.agent2].cli}` : `--template ${A.cli}${m && m0 && m.id !== m0.id ? ` --model ${m.id}` : ''}`;
  const br = !custom && d.source === 'folder' && d.branch && d.branch !== FOLDERS[d.folderIdx].branch ? ` --branch ${d.branch}` : '';
  return `ax run ${tpl} ${src}${br}${d.env === 'cluster' ? ` --cluster ${state.env.cluster}` : ''} "${goal.length > 54 ? goal.slice(0, 51) + '…' : goal}"`;
}
/* A remote cluster rebuilds the workspace from the repo, so local folders map to their remote and
   uncommitted changes must be pushed to a branch first (never copied from this computer). */
function clusterSource(d) { return d.env === 'cluster' && d.source === 'folder' ? `https://github.com/acme/${FOLDERS[d.folderIdx].repo}` : null; }
function pushFirstBranch(d) { return `ax/wip-${FOLDERS[d.folderIdx].repo}`; }
function draftSpec(d) {
  const r = draftRepo(d);
  const f = FOLDERS[d.folderIdx];
  const det = detectedSetup(d);
  const setup = draftSetup(d);
  const m = draftModel(d);
  return {
    agent: d.agent, model: m ? m.id : undefined, pin: d.pin, goal: d.goal || 'Describe the goal', repo: r.repo, folder: clusterSource(d) || r.path,
    setup, setupFrom: setup === det.cmd ? det.from : null, size: d.size, env: d.env, cluster: d.env === 'cluster' ? state.env.cluster : undefined,
    branch: d.env === 'cluster' && d.pushedFirst ? pushFirstBranch(d) : draftBranch(d),
    includeUncommitted: d.source === 'folder' && !f.clean && d.env !== 'cluster' ? d.includeUncommitted : undefined,
    useAgentsMd: d.source === 'folder' ? (f.agentsMd ? d.useAgentsMd : false) : d.useAgentsMd, instructions: d.instructions,
    skills: d.skills, mcp: d.mcp, envVars: d.envVars, budget: d.budget, preset: d.preset || state.guardrailPreset, files: cleanFiles(d.inlineFiles),
    extraRepos: d.source === 'folder' ? FOLDERS.filter((x, k) => k !== d.folderIdx && (d.extraRepos || []).includes(x.repo)).map((x) => x.path) : [],
  };
}
function draftManifest(d) {
  const raw = manifestYAML(draftSpec(d));
  return raw.split('\n').map((l) => {
    if (l.trim().startsWith('#')) return `<span class="c">${esc(l)}</span>`;
    return esc(l).replace(/^(\s*[a-zA-Z]+):/, '<span class="k">$1</span>:').replace(/(#.*)$/, '<span class="c">$1</span>');
  }).join('\n');
}
/** What the workspace starts with, in short: AGENTS.md · 1 skill · GitHub MCP server · npm ci. */
function workspaceBits(d) {
  const f = FOLDERS[d.folderIdx];
  const agentsMd = d.useAgentsMd && (d.source === 'folder' ? !!f.agentsMd : true);
  const mcpNames = (d.mcp || []).map((id) => (MCP_SERVERS.find((x) => x.id === id) || { name: id }).name);
  const setup = draftSetup(d);
  const files = cleanFiles(d.inlineFiles).filter((x) => !fileHasSecret(x));
  return [
    ...(agentsMd ? ['AGENTS.md'] : []),
    ...((d.instructions || '').trim() ? ['your instructions'] : []),
    ...(files.length ? [plural(files.length, 'file')] : []),
    plural((d.skills || []).length, 'skill'),
    mcpNames.length === 1 ? `${mcpNames[0]} MCP server` : mcpNames.length ? plural(mcpNames.length, 'MCP server') : 'no MCP servers',
    setup === 'auto' ? 'setup found after cloning' : setup,
  ];
}
/** A template that's still downloading doesn't block Run: the task waits for it. */
function draftDownloading(d) { return [AGENTS[d.agent], d.compare ? AGENTS[d.agent2] : null].find((x) => x && isDownloading(x.id)) || null; }
function draftChecks(d) {
  const A = AGENTS[d.agent];
  const B = d.compare ? AGENTS[d.agent2] : null;
  const r = draftRepo(d);
  const f = FOLDERS[d.folderIdx];
  const goalOk = (d.goal || '').trim().length >= 6;
  const codeOk = d.source !== 'git' || /^https?:\/\/|^git@/.test(d.git);
  const agentOk = A.connected && (!B || B.connected);
  /* A template built on this computer runs here right away; a remote cluster needs it published to the team registry first. */
  const localOnly = [A, B].filter((x) => x && x.localOnly);
  const whereOk = d.env === 'cluster' ? !localOnly.length && state.env.clusterConnected : localReady();
  const srcTxt = (x) => (x.custom ? `${x.source === 'yours' ? 'Your' : agentSource(x).label} template · ` : '');
  const preset = GUARDRAIL_PRESETS[d.preset || state.guardrailPreset];
  const m = draftModel(d);
  const dl = draftDownloading(d);
  const codeSub = !codeOk ? 'Add a Git URL, or pick a folder'
    : d.source === 'folder' && d.env === 'cluster' ? `${esc(clusterSource(d).replace('https://', ''))} · ${esc(d.pushedFirst ? pushFirstBranch(d) : draftBranch(d))}${f.clean || d.pushedFirst ? '' : ` · ${f.dirty} uncommitted changes stay on this computer`}`
    : d.source === 'folder' ? `${esc(r.path)} · ${esc(draftBranch(d))}${f.clean ? '' : d.includeUncommitted ? ` · ${f.dirty} uncommitted changes included` : ' · from last commit'}`
      : esc(r.path) + ' (copy-on-write)';
  /* Prevent before Run: an MCP server that still needs sign-in, a skill missing the MCP server it uses, or a secret pasted
     into env vars or an inline file shows up here first. */
  const mcpNeeds = (d.mcp || []).filter(mcpNeedsSignIn).map(mcpName);
  const skillNeeds = skillGaps(d.skills, d.mcp);
  const secretVars = parseEnvVars(d.envVars).filter((x) => x.secret);
  const secretFiles = cleanFiles(d.inlineFiles).filter(fileHasSecret);
  const toolsOk = !mcpNeeds.length && !skillNeeds.length && !secretVars.length && !secretFiles.length;
  const toolsSub = mcpNeeds.length ? `${esc(mcpNeeds[0])} needs sign-in · see Set up the workspace`
    : skillNeeds.length ? `${esc(skillNeeds[0].name)} needs the ${esc(mcpName(skillNeeds[0].needs))} MCP server · see Set up the workspace`
      : secretVars.length ? `${esc(secretVars[0].k)} looks like a secret and won't be saved`
        : secretFiles.length ? `${esc(secretFiles[0].path.trim())} looks like it has a secret and won't be added`
          : esc(workspaceBits(d).join(' · '));
  const toolsTodo = mcpNeeds.length ? `connect ${mcpNeeds[0]} or remove it`
    : skillNeeds.length ? `add ${mcpName(skillNeeds[0].needs)} or remove ${skillNeeds[0].name}`
      : 'move the secret to Settings → Agents & keys';
  const tplSub = d.compare ? '2 separate sandboxes'
    : !A.connected ? `${srcTxt(A)}Once, with ${A.signIn ? `your ${accountName(A)} or ` : ''}an API key`
      : dl === A ? `${dlLabel(A.id)} · runs when it finishes`
        : `${srcTxt(A)}${authLine(A)} · added outside the sandbox`;
  return [
    { ok: agentOk, todo: `sign in to ${!A.connected ? A.name : B ? B.name : A.name}`, t: d.compare ? `${A.name} vs ${B.name}` : (A.connected ? `${A.name}${m ? ` · ${m.name}` : ''}` : `Sign in to ${A.name}`), s: tplSub },
    { ok: whereOk, todo: d.env === 'cluster' ? (localOnly.length ? `run on this computer, or publish ${localOnly[0].name}` : 'choose a remote cluster') : 'finish setup or pick a remote cluster',
      t: d.env === 'cluster' ? (localOnly.length ? `Publish ${localOnly[0].name} first` : whereOk ? 'On a remote cluster' : 'Choose a remote cluster') : whereOk ? 'On this computer' : 'This computer isn\'t set up',
      s: d.env === 'cluster' ? (localOnly.length ? `Built on this computer · publish it to your team registry, or run it here` : whereOk ? `${esc(state.env.cluster)} · keeps running with your laptop closed` : 'Run asks you to sign in and pick one') : whereOk ? `${preset.name} guardrails · ${dl ? `starts when ${esc(dl.name)} finishes downloading` : 'starts in ~3 s'}` : 'Finish setup (about 5 min), or run on a remote cluster' },
    { ok: codeOk, todo: 'add a Git URL', t: 'Code chosen', s: codeSub },
    { ok: toolsOk, todo: toolsTodo, t: 'Workspace set up', s: toolsSub },
    { ok: goalOk, todo: 'describe the goal', t: 'Goal described', s: goalOk ? esc(d.goal.trim().split('\n')[0].slice(0, 48)) + (d.goal.trim().split('\n')[0].length > 48 ? '…' : '') : 'Describe the outcome you want' },
  ];
}
function readyHTML(d) {
  return draftChecks(d).map((c) => `<li class="${c.ok ? 'ok' : 'todo'}"><span class="rb">${c.ok ? icon('check') : ''}</span><span><span class="rt">${c.t}</span><span class="rs">${c.s}</span></span></li>`).join('');
}
/** Step numbers turn into checks as each step is done (template, where, workspace, goal). */
function stepStates(d) { const c = draftChecks(d); return [c[0].ok, c[1].ok, c[2].ok && c[3].ok, c[4].ok]; }
function stepNumHTML(k, ok) { return ok ? icon('check') : String(k); }
function planHeadHTML(d) {
  const checks = draftChecks(d);
  const n = checks.filter((c) => c.ok).length;
  const ready = n === checks.length;
  const dl = draftDownloading(d);
  const sub = ready
    ? (d.env === 'cluster' ? `Runs on ${esc(state.env.cluster)}.` : dl ? `Starts when ${esc(dl.name)} finishes downloading · about <span data-dl-secs="${dl.id}">${dlSecsLeft(dl.id)}</span> s` : 'Sandbox ready · starts in ~3 s.')
    : `${n} of ${checks.length} done · next: ${esc(checks.find((c) => !c.ok).todo)}`;
  return `${axo(ready ? 'wave' : 'thinking', { decorative: true }).replace('<svg ', '<svg data-follow ')}<div><div class="h-display-sm">${ready ? (d.compare ? 'Ready to race 2 templates' : 'Ready to run') : 'Almost ready'}</div><div class="small muted">${sub}</div></div>`;
}
function keyStatusHTML(d) {
  const A = AGENTS[d.agent];
  if (d.keyState === 'busy') return d.keyMethod === 'account' ? `${icon('loader', 'sm')}Finish signing in in your browser…` : `${icon('loader', 'sm')}Checking with ${A.maker}…`;
  if (d.keyState === 'ok') return d.keyMethod === 'account' ? `${icon('checkCircle', 'sm')}Signed in. Saved to your keychain.` : `${icon('checkCircle', 'sm')}Key works. Saved to your keychain.`;
  if (d.keyState === 'err') return `${icon('alert', 'sm')}${esc(d.keyMsg)}`;
  return '';
}
/** F8: inline warning when an environment variable looks like a secret (it's never written to YAML). */
function fileSecretMsg() { return `${icon('alert', 'sm')}This looks like it has a secret, so AX won't add it. Add keys in Settings → Agents & keys.`; }
function envWarnHTML(d) {
  const secretVars = parseEnvVars(d.envVars).filter((x) => x.secret);
  return secretVars.length
    ? `${icon('alert', 'sm')}${esc(secretVars.map((x) => x.k).join(', '))} ${secretVars.length > 1 ? 'look' : 'looks'} like a secret, so ${secretVars.length > 1 ? 'they' : 'it'} won't be saved here. Add keys in Settings → Agents & keys.`
    : `<span class="xsmall muted">Keys and tokens never go here. They stay in your keychain and Guardrails adds them outside the sandbox.</span>`;
}
/** Sign in to each template once, with its account or an API key. Both stay outside the sandbox. */
/** One labelled row in a panel (style guide §18): a label (and a short line about it), its content, an optional action. */
function prow(label, body, o) {
  o = o || {};
  return `<div class="prow${o.act ? ' has-act' : ''}${o.cls ? ' ' + o.cls : ''}"${o.id ? ` id="${o.id}"` : ''}>
    <div class="prow-k"${o.labelId ? ` id="${o.labelId}"` : ''}>${label}${o.sub ? `<span class="prow-sub"${o.subId ? ` id="${o.subId}"` : ''}>${o.sub}</span>` : ''}</div>
    <div class="prow-v">${body}</div>${o.act ? `<div class="prow-act">${o.act}</div>` : ''}
  </div>`;
}
function connectPanelHTML(A, d) {
  const method = A.signIn ? (d.keyMethod || 'account') : 'key';
  const keyForm = `<form data-form="key" data-agent="${A.id}" class="field">
      <label for="key-input" class="sr-only">${A.keyLabel}</label>
      <div class="input-group"><input class="input mono" id="key-input" type="password" autocomplete="off" spellcheck="false" placeholder="${A.keyPrefix}…" value="${esc(d.keyInput)}" aria-describedby="key-status"><button class="btn" type="submit">Check key</button></div>
      <div class="field-status ${d.keyState || ''}" id="key-status" role="status">${keyStatusHTML(d)}</div>
    </form>`;
  return `
    <div class="panel signin-panel" id="key-panel">
      <div class="panel-head kp-head"><span class="ph-ic" aria-hidden="true">${icon('lock')}</span><div><div class="ph-title">Sign in to ${A.name}</div>
        <p class="ph-sub">${A.keyProblem ? `${A.maker} rejected the last key. ` : 'You only do this once. '}Your credentials stay in your system keychain, and AX adds them outside the sandbox, so the agent never sees them.</p></div></div>
      <div class="panel-body">
        ${A.signIn ? `<div class="seg kp-methods" role="radiogroup" aria-label="How ${A.name} signs in">
          <button type="button" role="radio" aria-checked="${method === 'account'}" data-action="key-method" data-method="account">${accountName(A)}</button>
          <button type="button" role="radio" aria-checked="${method === 'key'}" data-action="key-method" data-method="key">API key</button></div>` : ''}
        ${method === 'account'
          ? `<div class="signin-row"><button type="button" class="btn primary" data-action="agent-signin" data-agent="${A.id}" id="agent-signin">${icon('globe', 'sm')}${A.signIn}</button><span class="hint">${A.signInNote}</span></div>
             <div class="field-status ${d.keyState || ''}" id="key-status" role="status">${keyStatusHTML(d)}</div>`
          : keyForm}
        <p class="xsmall muted kp-cli">${icon('terminal', 'xs')}Same from the command line: <code>${method === 'account' ? `ax auth login ${A.cli}` : `ax keys set ${A.cli}`}</code></p>
      </div>
    </div>`;
}
/** Connect GitHub once, right where the workspace needs it: private repos, pushing a branch at the end, and the
    GitHub MCP server. Like a template's sign-in, the token stays in the keychain and is added outside the sandbox. */
function ghConnectHTML(d) {
  if (state.github.connected || d.source === 'sample') return '';
  const why = d.source === 'git' ? 'You need it for private repos.'
    : d.mcp.includes('github') ? 'The GitHub MCP server needs it to start.'
      : 'You need it to push a branch when you review, and for the GitHub MCP server.';
  return prow('GitHub', `<span class="gh-tile" aria-hidden="true">${icon('branch', 'sm')}</span><div class="prow-text"><b>Connect GitHub once</b><span>${why} AX keeps the token in your keychain and adds it outside the sandbox.</span></div>`,
    { id: 'gh-connect', cls: 'prow-notice', act: `<button type="button" class="btn sm" data-action="connect-github" id="connect-github">${icon('globe', 'sm')}Connect GitHub</button>` });
}
/** The setup command's source, under its field: detected from the repo, or edited by you (with a way back). */
function setupHintHTML(d) {
  const det = detectedSetup(d);
  const cur = draftSetup(d);
  if (cur === 'auto') return `<span class="xsmall muted">AX reads the repo after cloning and picks the command from its lockfile or project file.</span>`;
  if (cur === det.cmd) return `<span class="xsmall muted">${icon('checkCircle', 'xs')} Detected from <span class="mono">${esc(det.from)}</span>. Change it if your project needs something else.</span>`;
  return `<span class="xsmall muted">You changed this.${det.cmd === 'auto' ? '' : ` Detected: <span class="mono">${esc(det.cmd)}</span>.`}</span> <button type="button" class="link" data-action="use-detected-setup">Use detected</button>`;
}
/** "Starts with" for the workspace step: what the agent starts with, as facts (icon + text). Amber when
    something needs you; faint when it's off. */
function wsChipsHTML(d) {
  const f = FOLDERS[d.folderIdx];
  const det = detectedSetup(d);
  const setup = draftSetup(d);
  const fact = (ic, html, cls) => `<li class="fact${cls ? ' ' + cls : ''}">${icon(ic, 'sm')}<span>${html}</span></li>`;
  const mdLines = d.source === 'folder' ? f.agentsMd : d.source === 'sample' ? SAMPLE.agentsMd : null;
  const md = !d.useAgentsMd || mdLines === 0
    ? fact('file', mdLines === 0 ? 'No AGENTS.md in this repo' : 'AGENTS.md off', 'off')
    : fact('file', `AGENTS.md${mdLines ? ` · ${mdLines} lines` : ' · if the repo has one'}`);
  const mine = (d.instructions || '').trim() ? fact('pencil', 'Your instructions') : '';
  const files = cleanFiles(d.inlineFiles);
  const secretFile = files.some(fileHasSecret);
  const fileF = files.length ? fact('file', `${plural(files.length, 'file')}: ${esc(files.map((x) => x.path.trim()).join(', '))}${secretFile ? ' · has a secret' : ''}`, secretFile ? 'need' : '') : '';
  const gaps = skillGaps(d.skills, d.mcp);
  const skills = fact('sparkle', `${plural(d.skills.length, 'skill')}: ${esc(d.skills.join(', '))}${gaps.length ? ` · ${esc(gaps[0].name)} needs ${esc(mcpName(gaps[0].needs))}` : ''}`, gaps.length ? 'need' : '');
  const names = d.mcp.map(mcpName);
  const needs = d.mcp.filter(mcpNeedsSignIn).map(mcpName);
  const mcp = fact('server', names.length ? `${esc(names.join(', '))} MCP ${names.length === 1 ? 'server' : 'servers'}${needs.length ? ` · ${esc(needs.join(' and '))} ${needs.length > 1 ? 'need' : 'needs'} sign-in` : ''}` : 'No MCP servers', needs.length ? 'need' : names.length ? '' : 'off');
  const run = setup === 'auto'
    ? fact('terminal', 'Setup command found after cloning')
    : fact('terminal', `<code>${esc(setup)}</code>${setup === det.cmd && det.from ? ` · from ${esc(det.from)}` : ' · edited'}`);
  return md + mine + fileF + skills + mcp + run;
}
function viewNew(q) {
  const d = ensureDraft(q);
  const A = AGENTS[d.agent];
  const f = FOLDERS[d.folderIdx];
  const ok = stepStates(d);
  const stepN = (k) => `<span class="n${ok[k - 1] ? ' ok' : ''}" id="sn-${k}" aria-hidden="true">${stepNumHTML(k, ok[k - 1])}</span>`;

  /* 1 · Pick a template */
  const templateCard = (a) => {
    const ver = agentVersionLabel(a);
    const foot = isDownloading(a.id)
      ? `<span class="c-foot dl">${icon('loader', 'xs spin')}${dlLabel(a.id)}</span>`
      : a.connected
        ? `<span class="c-foot ok">${icon('checkCircle', 'xs')}${a.custom ? 'Ready' : a.auth === 'key' ? 'Connected' : 'Signed in'} · ${esc(ver)}</span>`
        : `<span class="c-foot need">${icon('key', 'xs')}${esc(a.keyProblem || 'Sign in once to use')}</span>`;
    const tag = a.custom ? `<span class="c-tag s-${a.source}">${agentSource(a).label}</span>` : '';
    return `<button type="button" class="choice" role="radio" aria-checked="${d.agent === a.id}" data-action="pick-agent" data-agent="${a.id}" id="agent-${a.id}">
      <span class="c-check">${icon('check')}</span>${agentTile(a.id, 'lg')}
      <span><span class="c-title">${a.name}${tag}</span><span class="c-desc">${a.desc}</span></span>${foot}</button>`;
  };
  const added = addedAgents();
  /* Four equal cards: the three pre-built templates (Antigravity first) and Your own agent, which opens Bring your own
     agent. The templates, and any you added, are one radio group (arrow keys move across both rows); the fourth card
     is a button beside it, so arrowing through the templates never opens a dialog. */
  const templatePicker = `
    <div class="tpl-wrap"><div class="tpl-grid">
      <div class="agent-picker" role="radiogroup" aria-labelledby="step-agent">
        ${prebuiltAgents().map(templateCard).join('')}
        ${added.length ? `<div class="agent-group-label">Your templates</div>${added.map(templateCard).join('')}` : ''}
      </div>
      <button type="button" class="choice byo-card" data-action="find-agent" data-tab="byo" id="find-byo" aria-haspopup="dialog">${byoTile('lg')}
        <span><span class="c-title">Your own agent</span><span class="c-desc">Built with ADK or anything else: a folder, a container image or a Git repo.</span></span>
        <span class="c-foot">${icon('plus', 'xs')}Add it once, run it like a template</span></button>
    </div></div>`;
  const models = modelsFor(A);
  const curM = draftModel(d);
  const options = [];
  if (curM) {
    options.push(prow('Model', models.length > 1
      ? `<div class="prow-inline"><div class="seg" role="radiogroup" aria-labelledby="model-label">${models.map((m) => `<button type="button" role="radio" aria-checked="${curM.id === m.id}" data-action="pick-model" data-model="${m.id}">${esc(m.name)}</button>`).join('')}</div><span class="prow-hint" id="model-hint">${esc(curM.hint || '')}</span></div>`
      : `<div class="prow-text"><b>${esc(curM.name)}</b><span id="model-hint">${esc(curM.hint || '')}</span></div>`, { labelId: 'model-label' }));
  }
  const secondOpts = agentList().filter((a) => a.id !== d.agent).map((a) =>
    `<button type="button" role="radio" aria-checked="${d.agent2 === a.id}" data-action="pick-agent2" data-agent="${a.id}">${agentTile(a.id, 'sm')}${a.name}${!a.connected ? ' (sign-in needed)' : ''}</button>`).join('');
  options.push(prow('Compare', `<label class="toggle-line"><span class="tl-text"><b>Run a second template in parallel</b><span>Each one runs in its own sandbox copy (not a shared git worktree), so you can keep the better result.</span></span>
      <span class="switch"><input type="checkbox" role="switch" data-action="toggle-compare" ${d.compare ? 'checked' : ''} aria-label="Compare a second template in parallel"><span class="track"></span><span class="thumb"></span></span></label>
    ${d.compare ? `<div class="prow-inline"><span class="prow-hint">Race ${A.name} against</span><div class="seg" role="radiogroup" aria-label="Second template">${secondOpts}</div></div>` : ''}`));
  const optionsPanel = `<div class="panel tpl-panel">${options.join('')}</div>`;
  const findFoot = `<div class="step-foot"><span class="sf-text">More templates from your team or the AX catalog</span><span class="spacer"></span>
      <button type="button" class="btn sm" data-action="find-agent" data-tab="browse" id="find-browse">Browse templates…</button></div>`;
  const keyPanel = !A.connected ? connectPanelHTML(A, d) : '';

  /* 2 · Where should it run? */
  const whereLocalDesc = localReady() ? 'Starts in ~3 s in a microVM sandbox. $0 cloud cost; pauses if this computer sleeps.' : "This computer isn't set up yet. Finish setup (about 5 min) to run here.";

  /* 3 · Set up the workspace: code and branch up front, with what the agent starts with; details one click away. */
  const branches = d.source === 'folder' ? f.branches : ['main', 'develop'];
  const sourceDetail = d.source === 'folder'
    ? `<div class="src-line"><span class="src-ic" aria-hidden="true">${icon('folder')}</span>
        <span class="src-main"><span class="src-path">${esc(f.path)}</span><span class="src-meta">${f.clean ? 'No uncommitted changes' : `${f.dirty} uncommitted changes`} · ${esc(f.lang)} · ${esc(f.files)}</span></span>
        <button type="button" class="btn sm" data-action="change-folder" aria-haspopup="dialog">Change…</button></div>
      ${f.clean ? '' : d.env === 'cluster' ? (d.pushedFirst
        ? `<div class="toggle-line static"><span class="tl-text"><b>${icon('checkCircle', 'xs')} Pushed ${f.dirty} changes to <span class="mono">${esc(pushFirstBranch(d))}</span></b><span>The remote cluster starts from that branch. Your folder isn't modified.</span></span></div>`
        : `<div class="toggle-line static push-first"><span class="tl-text"><b>${f.dirty} uncommitted changes aren't on a branch yet</b><span>Remote clusters rebuild the workspace from your repo. Push them first, or the agent starts from the last commit on ${esc(draftBranch(d))}.</span></span><button type="button" class="btn sm" data-action="draft-push-first">${icon('branch', 'sm')}Push to ${esc(pushFirstBranch(d))} first</button></div>`)
        : `<label class="toggle-line"><span class="tl-text"><b>Include my ${f.dirty} uncommitted changes</b><span>${d.includeUncommitted ? 'Copied into the sandbox snapshot. Your folder isn\'t modified.' : `The agent starts from the last commit on ${esc(draftBranch(d))}.`}</span></span><span class="switch"><input type="checkbox" role="switch" data-action="toggle-draft" data-key="includeUncommitted" ${d.includeUncommitted ? 'checked' : ''} aria-label="Include my uncommitted changes"><span class="track"></span><span class="thumb"></span></span></label>`}
      ${d.env === 'cluster' ? `<p class="prow-hint">On ${esc(state.env.cluster)} the agent clones <span class="mono">${esc(clusterSource(d))}</span>.</p>` : ''}`
    : d.source === 'git'
      ? `<div class="field"><label for="git-url">Repository URL</label><input class="input mono" id="git-url" data-bind="git" placeholder="https://github.com/your-org/your-repo" value="${esc(d.git)}" autocomplete="off"><span class="hint">${state.github.connected ? `Private repos use your GitHub sign-in (${esc(state.github.user)}), added outside the sandbox, so the token never reaches it.` : 'Public repos clone right away. For a private repo, connect GitHub once below.'}</span></div>`
      : `<div class="src-line"><span class="src-ic" aria-hidden="true">${icon('box')}</span><span class="src-main"><span class="src-path">ax-sample-todo</span><span class="src-meta">A small to-do app with failing tests. A safe place to watch an agent plan, edit, test and review.</span></span></div>`;
  const saved = state.savedSetups || [];
  const vars = parseEnvVars(d.envVars);
  const secretVars = vars.filter((x) => x.secret);
  const setup = draftSetup(d);
  const wsRows = [
    saved.length ? prow('Saved setups', `<div class="pills" role="group" aria-label="Saved setups">${saved.map((s, k) => `<button type="button" class="pill" data-action="use-setup" data-i="${k}" title="${esc(s.summary || '')}">${icon('layers', 'xs')}${esc(s.name)}</button>`).join('')}</div>`) : '',
    prow('Code', `<div class="seg" role="radiogroup" aria-label="Code">${[['folder', 'Use a folder'], ['git', 'Clone from Git'], ['sample', 'Try a sample project']].map(([k, l]) =>
      `<button type="button" role="radio" aria-checked="${d.source === k}" data-action="pick-source" data-source="${k}">${l}</button>`).join('')}</div>${sourceDetail}`),
    d.source !== 'sample' ? prow('Branch', `<div class="prow-inline"><div class="seg" role="radiogroup" aria-labelledby="branch-label">${branches.map((b) => `<button type="button" role="radio" aria-checked="${draftBranch(d) === b}" data-action="draft-set" data-key="branch" data-val="${esc(b)}">${esc(b)}</button>`).join('')}</div><span class="prow-hint">Where the agent starts</span></div>`, { labelId: 'branch-label' }) : '',
    prow('Starts with', `<ul class="facts" id="ws-chips" aria-label="What the workspace starts with">${wsChipsHTML(d)}</ul>`),
  ].join('');
  const wsDetails = [
    d.source === 'folder' ? prow('More repos', `<div class="pills" role="group" aria-label="More repos">${FOLDERS.filter((x, k) => k !== d.folderIdx).map((x) => { const on = (d.extraRepos || []).includes(x.repo); return `<button type="button" class="pill mono" aria-pressed="${on}" data-action="draft-toggle" data-key="extraRepos" data-val="${esc(x.repo)}">${icon(on ? 'check' : 'plus', 'xs')}${esc(x.path)}${on ? ' · read-only' : ''}</button>`; }).join('')}</div>`, { sub: 'Read-only, for context' }) : '',
    prow('Instructions', `${d.source === 'folder' && f.agentsMd ? `<label class="check-row"><input type="checkbox" data-action="toggle-draft" data-key="useAgentsMd" ${d.useAgentsMd ? 'checked' : ''}> Use <code>AGENTS.md</code> from this repo <span class="muted">(found · ${f.agentsMd} lines)</span></label>` : d.source === 'folder' ? `<div class="prow-hint">No <code>AGENTS.md</code> found in this repo.</div>` : ''}
      <textarea class="textarea" rows="2" id="rcp-instructions" aria-label="Instructions for the agent" data-bind="instructions" placeholder="Extra instructions, e.g. “Use pnpm, not npm. Keep PRs under 300 lines.”">${esc(d.instructions)}</textarea>`, { sub: 'What the agent always knows' }),
    prow('Files', `<div class="files" id="rcp-files">${(d.inlineFiles || []).map((x, k) => `
        <div class="file-row">
          <div class="fr-head"><input class="input mono" data-file-i="${k}" data-file-k="path" value="${esc(x.path)}" placeholder="e.g. config/test.json" aria-label="File ${k + 1}: path in the workspace" autocomplete="off" spellcheck="false">
            <button type="button" class="btn ghost sm icon" data-action="file-remove" data-i="${k}" aria-label="Remove file ${k + 1}${x.path ? `, ${esc(x.path)}` : ''}" title="Remove">${icon('x', 'sm')}</button></div>
          <textarea class="textarea mono" rows="3" data-file-i="${k}" data-file-k="content" aria-label="File ${k + 1}: contents" placeholder="What goes in the file" spellcheck="false">${esc(x.content)}</textarea>
          <div class="field-status${fileHasSecret(x) ? ' err' : ''}" id="file-warn-${k}" role="status">${fileHasSecret(x) ? fileSecretMsg() : ''}</div>
        </div>`).join('')}
        <button type="button" class="btn ghost sm" data-action="file-add" id="file-add">${icon('plus', 'sm')}Add a file</button></div>`, { sub: 'Added before the agent starts. No keys or tokens.' }),
    prow('Skills', `<div class="pills" role="group" aria-label="Skills">${SKILLS.map((sk) => `<button type="button" class="pill mono" aria-pressed="${d.skills.includes(sk.id)}" ${sk.locked ? 'aria-disabled="true" title="Bundled with AX, always on"' : `title="${esc(sk.desc)}"`} data-action="draft-toggle" data-key="skills" data-val="${sk.id}">${icon(d.skills.includes(sk.id) ? 'check' : 'plus', 'xs')}${esc(sk.name)}${sk.locked ? ' · bundled' : ''}</button>`).join('')}</div>`, { sub: 'Reusable know-how' }),
    prow('MCP servers', `<div class="mcp-list">${MCP_SERVERS.map((m) => { const on = d.mcp.includes(m.id); const auth = mcpAuthLabel(m); return `<button type="button" class="mcp-item" aria-pressed="${on}" data-action="draft-toggle" data-key="mcp" data-val="${m.id}"><span class="mi-check">${on ? icon('check', 'xs') : ''}</span><span class="mi-main"><b>${esc(m.name)}</b><span>${esc(m.desc)}</span></span><span class="mi-auth ${/needed/.test(auth) ? 'need' : ''}">${esc(auth)}</span></button>`; }).join('')}</div>`, { sub: 'Tools the agent can call. Tokens stay outside the sandbox.' }),
    prow('Setup command', `<input class="input mono" id="setup-cmd" data-bind="setup" value="${esc(setup === 'auto' ? '' : setup)}" placeholder="${setup === 'auto' ? 'Found after cloning, e.g. npm ci' : ''}" autocomplete="off" spellcheck="false" aria-label="Setup command" aria-describedby="setup-hint">
      <div class="field-status" id="setup-hint" role="status">${setupHintHTML(d)}</div>`, { sub: 'Runs once before the agent' }),
    prow('Environment variables', `<textarea class="textarea mono" rows="2" id="rcp-env" aria-label="Environment variables" aria-describedby="env-warn" data-bind="envVars" placeholder="NODE_ENV=test&#10;LOG_LEVEL=debug" spellcheck="false">${esc(d.envVars)}</textarea>
      <div class="field-status ${secretVars.length ? 'err' : ''}" id="env-warn" role="status">${envWarnHTML(d)}</div>`, { sub: 'Non-secret values only' }),
  ].join('');
  const wsPanel = `<div class="panel ws-panel">${wsRows}${ghConnectHTML(d)}
      <details class="panel-more" id="ws-more" ${d.wsOpen ? 'open' : ''}>
        <summary>${icon('chevRight', 'sm chev')}<b>Customize</b><span>Instructions, files, skills, MCP servers and setup</span></summary>
        <div class="panel-more-body">${wsDetails}</div>
      </details></div>`;
  const saveFoot = `<div class="step-foot"><button type="button" class="btn ghost sm" data-action="save-setup" id="save-setup">${icon('plus', 'sm')}Save this setup</button><span>Reuse it for your next task.</span></div>`;

  /* More options: per-task template version, resources, guardrails, budget, and the generated YAML and CLI. */
  const preset = d.preset || state.guardrailPreset;
  const newer = A.latest && A.latest !== A.version;
  const moreRows = [
    !A.image
      ? prow('Template version', `<div class="seg" role="radiogroup" aria-labelledby="ver-label">
          <button type="button" role="radio" aria-checked="${d.pin !== 'latest'}" data-action="draft-set" data-key="pin" data-val="pinned">${icon('pin', 'xs')}Pin ${esc(A.version)}</button>
          <button type="button" role="radio" aria-checked="${d.pin === 'latest'}" data-action="draft-set" data-key="pin" data-val="latest">Always use the latest${newer ? ` · ${esc(A.latest)}` : ''}</button>
        </div><span class="prow-hint">${newer ? `${esc(A.latest)} came out ${esc(A.latestWhen || 'recently')}. A pinned task stays on ${esc(A.version)} until you change it.` : `${esc(A.version)} is the latest release.`}</span>`, { labelId: 'ver-label', sub: 'Pin it, or follow releases' })
      : prow('Template version', `<span class="mono xsmall" style="padding-top:6px">${esc(agentImage(A))}</span>`, { sub: "Set by the template's image" }),
    prow('Resources', `<div class="seg" role="radiogroup" aria-label="Resources">${[['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']].map(([k, l]) => `<button type="button" role="radio" aria-checked="${d.size === k}" data-action="pick-size" data-size="${k}">${l}</button>`).join('')}</div>`, { sub: { small: '1 CPU · 2 GB', medium: '2 CPU · 4 GB', large: '4 CPU · 8 GB' }[d.size], subId: 'size-hint' }),
    prow('Guardrails', `<div class="seg" role="radiogroup" aria-label="Guardrails preset for this task">${Object.values(GUARDRAIL_PRESETS).map((p) => `<button type="button" role="radio" aria-checked="${preset === p.id}" data-action="draft-set" data-key="preset" data-val="${p.id}">${esc(p.name)}</button>`).join('')}</div><span class="prow-hint">${esc(GUARDRAIL_PRESETS[preset].desc)}</span>`, { sub: 'For this task' }),
    prow('Budget check-in', `<div class="budget-input"><span>$</span><input class="input tnum" type="number" min="1" step="1" id="rcp-budget" data-bind="budget" value="${esc(d.budget)}" aria-label="Budget check-in in US dollars"></div><span class="prow-hint">AX pauses the agent and asks before going past this estimate.</span>`, { sub: 'Ask before spending more' }),
    prow('Task file', `<pre class="manifest" id="manifest">${draftManifest(d)}</pre><button type="button" class="btn ghost sm" data-action="manifest-draft">${icon('code', 'sm')}Export / Sandbox Kit…</button>`, { sub: 'Portable Agent Substrate YAML' }),
    prow('Command line', `<div id="draft-cli" class="stretch">${cliHint(draftCli(d))}</div>`, { sub: 'Same task from the command line' }),
  ].join('');

  const html = `
  <div class="new-head"><div><h1 tabindex="-1">Start a task</h1>
    <p class="lede">Pick a template, choose where it runs, set up its workspace, and describe the goal. The agent works in a secure sandbox, and you review every change before it reaches your code.</p></div></div>
  <div class="new-grid">
    <div>
      <section class="step-block first" aria-labelledby="step-agent">
        <div class="step-head" id="sh-agent">${stepN(1)}<h2 id="step-agent">Pick a template</h2><span class="muted">Switch or hand off anytime.</span></div>
        ${templatePicker}
        ${keyPanel}
        ${optionsPanel}
        ${findFoot}
      </section>
      <section class="step-block" aria-labelledby="step-where">
        <div class="step-head">${stepN(2)}<h2 id="step-where">Where should it run?</h2><span class="muted">Same setup and guardrails either way.</span></div>
        <div class="radio-list" role="radiogroup" aria-labelledby="step-where">
          <button type="button" class="radio-card" role="radio" aria-checked="${d.env === 'local'}" data-action="pick-env" data-env="local">
            <span class="rc-dot"></span><span class="rc-main"><span class="rc-title">On this computer</span><span class="rc-desc">${whereLocalDesc}</span></span><span class="rc-right">${localReady() ? 'Best to start' : 'Not set up'}</span></button>
          <button type="button" class="radio-card" role="radio" aria-checked="${d.env === 'cluster'}" data-action="pick-env" data-env="cluster">
            <span class="rc-dot"></span><span class="rc-main"><span class="rc-title">On a remote cluster</span><span class="rc-desc">Runs on your own Kubernetes / GKE cluster when your laptop closes. Org policies apply.</span></span><span class="rc-right">${state.env.clusterConnected ? esc(state.env.cluster) : 'Not connected'}</span></button>
        </div>
        ${localReady() ? '' : `<p class="hint" style="margin-top:8px"><a href="#/welcome" data-action="setup-resume-path" data-path="local">Finish setting up this computer</a> to run here.</p>`}
      </section>
      <section class="step-block" aria-labelledby="step-workspace" id="ws-step">
        <div class="step-head">${stepN(3)}<h2 id="step-workspace">Set up the workspace</h2><span class="muted">What the agent starts with. AX sets it up for you.</span></div>
        ${wsPanel}
        ${saveFoot}
      </section>
      <section class="step-block" aria-labelledby="step-goal">
        <div class="step-head">${stepN(4)}<h2 id="step-goal">Describe the goal</h2><span class="muted">The agent plans from this. Steer it anytime.</span></div>
        <div class="goal">
          <textarea id="goal" data-bind="goal" aria-labelledby="step-goal" placeholder="e.g. Add rate limiting to the checkout API: 20 requests per minute per user, return 429 with Retry-After." aria-describedby="goal-err">${esc(d.goal)}</textarea>
          <div class="goal-foot"><span class="xsmall muted"><kbd>${MOD}</kbd> <kbd>↵</kbd> to run</span><span class="spacer"></span>
            <span id="goal-err" class="field-status err" role="alert">${d.error ? icon('alert', 'sm') + esc(d.error) : ''}</span></div>
        </div>
        <div class="pills goal-help" id="goal-help" role="group" aria-label="Help with your goal">${goalHelpHTML(d)}</div>
      </section>
      <details class="step-block more-block" id="advanced" ${d.advOpen ? 'open' : ''}>
        <summary>${icon('chevRight', 'sm chev')}<span>More options: template version, resources, guardrails, budget, YAML</span></summary>
        <div class="panel more-panel">${moreRows}</div>
      </details>
    </div>

    <aside class="card plan-card" aria-label="Run plan">
      <div class="pc-head" id="plan-head">${planHeadHTML(d)}</div>
      <ul class="ready-list" id="ready-list" aria-label="Checklist">${readyHTML(d)}</ul>
      <button class="btn primary lg" data-action="run-task" id="run-task">${d.compare ? 'Run comparison' : 'Run task'}<span class="kbd-hint">${MOD}↵</span></button>
    </aside>
  </div>`;
  const openFind = d.openFind;
  d.openFind = null;
  const focusWs = d.focusWs;
  d.focusWs = false;
  return {
    title: 'New task', crumbs: [{ label: 'Home', href: '#/' }, { label: 'New task' }], html,
    after: openFind ? () => openAgentCatalog({ tab: openFind })
      : focusWs ? () => { const w = $('#ws-step'); if (w) window.scrollTo({ top: Math.max(0, w.getBoundingClientRect().top + window.scrollY - 80), behavior: reducedMotion() ? 'auto' : 'smooth' }); }
        : null,
  };
}

/* ---------- Guardrails (1 Axel inside Sanctuary Reach Ring + Zero-Friction Presets) ---------- */
/* ---------- Guardrails ----------
   One page for everything that controls what agents can reach, in the order people use it: pick a starting point
   (the preset) and see its effect on the map, manage the sites you allowed on top, act on recent blocks, set how
   agents ask inside the sandbox, then read what your organization adds and where keys live. Lists are rows, like
   Settings, so they work at any width. */
function viewGuardrails() {
  /* A fresh visit starts with an empty add-site field and no leftover message. */
  if (typeof lastPath !== 'undefined' && lastPath !== '/guardrails') { state.allowDraft = ''; state.allowMsg = null; }
  const curP = state.guardrailPreset === 'strict' ? 'strict' : 'balanced';
  const P = GUARDRAIL_PRESETS[curP];
  const included = presetSites(curP);
  const mine = mySites();
  const orgAllowed = state.allow.filter((a) => a.scope === 'org');
  const repos = [...new Set(state.tasks.map((t) => t.repo).concat(mine.map((a) => a.scope)))].filter((r) => r && r !== 'all' && r !== 'org').sort();
  const scopeName = (sc) => (sc === 'all' ? 'All workspaces' : `${esc(sc)} workspace`);

  const card = (on, action, data, title, badge, desc) => `<button type="button" class="choice preset-card" role="radio" aria-checked="${on}" data-action="${action}" ${data}>
      <span class="c-check">${icon('check')}</span>
      <div class="c-row"><span class="c-title">${title}</span>${badge ? `<span class="env">${badge}</span>` : ''}</div>
      <span class="c-desc">${desc}</span>
    </button>`;
  const presetCards = Object.values(GUARDRAIL_PRESETS).map((p) => card(curP === p.id, 'set-preset', `data-preset="${p.id}"`, esc(p.name), p.badge ? esc(p.badge) : '', esc(p.desc))).join('');
  const includedFacts = included.map((a) => `<li class="fact">${icon(a.note ? 'key' : 'globe', 'sm')}<span><code>${esc(a.domain)}</code>${a.note ? '<span class="g-note">Your key is added on the way out</span>' : ''}</span></li>`).join('');
  const mapSites = [...new Set(included.concat(mine).map((a) => a.domain))];
  /* A block on a remote cluster ('policy') is your organization's call, like the seeded 'org' blocks. */
  const orgBlock = (b) => b.reason === 'org' || b.reason === 'policy';
  const stillBlocked = state.blockedLog.filter((b) => orgBlock(b) || !siteAllowed(b.domain, (getTask(b.task) || {}).repo || null));

  const mineRows = mine.map((a) => {
    const t = a.task && getTask(a.task);
    return `<div class="set-row">
      <span class="g-ic" aria-hidden="true">${icon('globe', 'sm')}</span>
      <div class="sr-main"><div class="sr-title mono">${esc(a.domain)}</div>
        <div class="sr-desc">${scopeName(a.scope)} · ${t ? `allowed from <a href="#/task/${t.id}">${esc(t.title)}</a>` : 'added by you'}${a.at ? ` · ${fmtAgo(a.at)}` : ''}</div></div>
      <button class="btn ghost sm" data-action="remove-allow" data-i="${state.allow.indexOf(a)}" aria-label="Remove ${esc(a.domain)}">Remove</button>
    </div>`;
  }).join('');
  const msg = state.allowMsg;
  const scopeSel = selectHTML({
    key: 'allow-scope', label: 'Applies to', btnClass: 'btn',
    value: repos.includes(state.allowScope) ? state.allowScope : 'all',
    options: [{ value: 'all', name: 'All workspaces' }].concat(repos.map((r) => ({ value: r, name: `${r} workspace` }))),
  });
  const addRow = `<form data-form="add-domain" class="set-row g-add" novalidate>
      <label for="new-domain" class="sr-only">Site to allow</label>
      <input class="input mono" id="new-domain" placeholder="docs.example.com" autocomplete="off" spellcheck="false" value="${esc(state.allowDraft || '')}"${msg ? ` aria-describedby="new-domain-msg"${msg.err ? ' aria-invalid="true"' : ''}` : ''}>
      ${scopeSel}
      <button class="btn" type="submit">${icon('plus', 'sm')}Allow site</button>
    </form>${msg ? `<p class="g-msg${msg.err ? ' err' : ''}" id="new-domain-msg">${icon(msg.err ? 'alert' : 'info', 'xs')}<span>${msg.text}</span></p>` : ''}`;

  const blockedRows = state.blockedLog.slice().sort((a, b) => b.at - a.at).map((b) => {
    const t = getTask(b.task);
    const repo = t ? t.repo : null;
    const org = orgBlock(b);
    /* A task still waiting on this site gets the Allow button even if a rule exists, so it can carry on. */
    const ob = t && !org && openBlock(t);
    const waiting = !!(ob && ob.e.domain === b.domain);
    const ok = !org && !waiting && siteAllowed(b.domain, repo);
    const why = org ? "Blocked by your organization's policy" : repo ? `Not on the ${esc(repo)} workspace's allowlist` : 'Not on your allowlist';
    const act = org ? `<button type="button" class="link" data-action="ask-admin" data-text="${esc(b.domain)}">Ask ${esc(state.org.admin)}</button>`
      : ok ? `<span class="chip done">${icon('check')}Allowed</span>`
        : `<button class="btn sm" data-action="allow-domain" data-domain="${esc(b.domain)}" data-scope="${repo ? esc(repo) : 'all'}" data-task="${t ? t.id : ''}">${repo ? `Allow for ${esc(repo)}` : 'Allow everywhere'}</button>`;
    return `<div class="set-row">
      <span class="g-ic ${org ? 'org' : 'no'}" aria-hidden="true">${icon(org ? 'lock' : 'ban', 'sm')}</span>
      <div class="sr-main"><div class="sr-title mono">${esc(b.domain)}</div>
        <div class="sr-desc">${waiting ? '<b class="g-wait">Waiting for you</b> · ' : ''}${why}${b.purpose ? ` · “${esc(b.purpose)}”` : ''} · ${t ? `<a href="#/task/${t.id}">${esc(t.title)}</a> · ` : ''}${fmtAgo(b.at)}</div></div>
      ${act}
    </div>`;
  }).join('');

  const infoRow = (ic, cls, title, desc, act) => `<div class="set-row"><span class="g-ic ${cls}" aria-hidden="true">${icon(ic, 'sm')}</span><div class="sr-main"><div class="sr-title">${title}</div><div class="sr-desc">${desc}</div></div>${act || ''}</div>`;
  const codes = (xs) => xs.map((d) => `<code>${esc(d)}</code>`).join(' · ');
  const orgRows = infoRow('check', 'org', 'Always allowed', orgAllowed.length ? codes(orgAllowed.map((a) => a.domain)) : 'Nothing extra')
    + infoRow('ban', 'org', 'Always blocked', state.orgBlocked.length ? codes(state.orgBlocked) : 'Nothing extra')
    + infoRow('cloud', 'org', 'On remote clusters', `Sites that aren't allowed are blocked instead of asking you. Model Armor checks requests for sensitive data, and each task is capped at $${ORG_BUDGET}.`);
  const keysRow = infoRow('key', '', 'Keys stay outside the sandbox', "They're kept in your system keychain on this computer, or in your organization's vault on a remote cluster. Guardrails adds them to requests to approved sites, so agents never see them in files or <code>env</code>.",
    `<a class="link g-link" href="#/settings/agents">Agents &amp; keys ${icon('chevRight', 'xs')}</a>`);
  const inside = [['auto', 'Run without asking', 'Recommended', 'Agents edit files and run commands in their sandbox copy without stopping to ask. Your folder and keys stay out of reach.'],
    ['ask', 'Ask before risky commands', '', 'Agents pause for your OK before deleting many files, rewriting git history or force-pushing, even inside the sandbox.']]
    .map(([k, n, b, d]) => card(state.permMode === k, 'set-perm', `data-mode="${k}"`, n, b, d)).join('');

  const html = `
    <div class="head-row">
      <div><h1 tabindex="-1">Guardrails</h1>
        <p class="lede">Guardrails checks every request that leaves the sandbox. Agents reach only the sites you allow, and your keys are added on the way out, never inside the sandbox.</p></div>
      <div class="btn-row"><button class="btn ghost" data-action="policy-yaml">Export policy YAML</button></div>
    </div>
    <section class="set-section" aria-labelledby="g-net">
      <h2 id="g-net">Network access</h2>
      <p class="set-sub">Choose a starting point. Sites you allow are added on top, and any other site pauses the agent and asks you.</p>
      <div class="g-net">
        <div>
          <div class="g-cards" role="radiogroup" aria-label="Guardrails preset">${presetCards}</div>
          <div class="g-included"><div class="panel-title">Included in ${esc(P.name)}</div><ul class="facts">${includedFacts}</ul></div>
          <p class="set-sub g-cli">${icon('terminal', 'xs')}<span>Same from the command line: <code>ax guardrails preset ${P.cli}</code></span></p>
        </div>
        <figure class="g-map">${reachMap(mapSites, stillBlocked, 'lg')}<figcaption>${plural(mapSites.length, 'site')} allowed · ${stillBlocked.length} blocked · 0 keys inside the sandbox</figcaption></figure>
      </div>
    </section>
    <section class="set-section" aria-labelledby="g-allow">
      <h2 id="g-allow">Sites you allowed</h2>
      <p class="set-sub">Added on top of ${esc(P.name)}. Allow a site for one workspace, or for all of them.</p>
      <div class="card g-list">${mineRows || `<div class="set-row g-empty"><div class="sr-main"><div class="sr-desc">No sites of your own yet. When an agent asks to reach a new site, allow it from the task, or add one here.</div></div></div>`}${addRow}</div>
    </section>
    <section class="set-section" aria-labelledby="g-blocked">
      <h2 id="g-blocked">Recently blocked</h2>
      <p class="set-sub">Requests Guardrails stopped before they left the sandbox. Nothing was sent, and no keys left.</p>
      <div class="card g-list">${blockedRows || '<div class="set-row g-empty"><div class="sr-main"><div class="sr-desc">Nothing blocked recently.</div></div></div>'}</div>
    </section>
    <section class="set-section" aria-labelledby="g-inside">
      <h2 id="g-inside">Inside the sandbox</h2>
      <p class="set-sub">How agents handle their own permission prompts. A change applies at each task's next turn. Guardrails always controls the network and keys.</p>
      <div class="choice-grid two" role="radiogroup" aria-labelledby="g-inside">${inside}</div>
      <p class="set-sub g-cli">${icon('terminal', 'xs')}<span>Same from the command line: <code>ax config set inside-sandbox ${state.permMode === 'ask' ? 'ask' : 'auto'}</code></span></p>
    </section>
    <section class="set-section" aria-labelledby="g-org">
      <h2 id="g-org">Your organization's policy</h2>
      <p class="set-sub">Set by ${esc(state.org.admin)}, so you can't change it here. It adds to your rules and never removes them.</p>
      <div class="card g-list">${orgRows}</div>
    </section>
    <section class="set-section" aria-labelledby="g-keys">
      <h2 id="g-keys">Keys</h2>
      <div class="card g-list">${keysRow}</div>
    </section>`;
  return { title: 'Guardrails', crumbs: [{ label: 'Home', href: '#/' }, { label: 'Guardrails' }], html };
}

/* ---------- All tasks ----------
   Every task in one table: search by title, repo or agent, filter by state and by where it runs, and see what each
   one is using right now (CPU, memory, cost). Home groups tasks by what needs you; this is the flat list. */
function tasksFilter() { if (!state.tasksFilter) state.tasksFilter = { q: '', status: 'all', env: 'all' }; return state.tasksFilter; }
const TASK_STATES = [['all', 'All'], ['needs', 'Needs you'], ['working', 'Working'], ['review', 'Ready to review'], ['done', 'Done']];
function taskStateOf(t) {
  if (needsYou(t)) return 'needs';
  if (pausedByYou(t)) return 'working';
  if (ACTIVE.includes(t.status)) return 'working';
  if (awaitingReview(t)) return 'review';
  return 'done';
}
function tasksMatching() {
  const f = tasksFilter(), q = f.q.trim().toLowerCase();
  return state.tasks.filter((t) => !isFolded(t)
    && (f.env === 'all' || t.env === f.env)
    && (f.status === 'all' || taskStateOf(t) === f.status)
    && (!q || `${t.title} ${t.repo} ${AGENTS[t.agent].name} ${t.branch || ''} ${t.id}`.toLowerCase().includes(q)))
    .sort((a, b) => b.startedAt - a.startedAt);
}
function tasksTableHTML() {
  const list = tasksMatching();
  if (!list.length) {
    const f = tasksFilter();
    return `<div class="tasks-empty"><b>No tasks match</b><span>${f.q.trim() ? `Nothing matches “${esc(f.q.trim())}” with these filters.` : 'No tasks are in this state right now.'}</span></div>`;
  }
  const rows = list.map((t) => {
    const A = AGENTS[t.agent], r = resourceFor(t), files = filesFor(t);
    const add = files.reduce((n, x) => n + diffStats(x.lines).add, 0), del = files.reduce((n, x) => n + diffStats(x.lines).del, 0);
    const kid = handedOff(t) ? getTask(t.child) : null;
    const note = kid ? `Handed off to ${AGENTS[kid.agent].name}` : t.notKept ? 'Not kept' : t.pushed ? 'Shipped' : '';
    return `<tr id="trow-${t.id}">
      <td class="tk-title"><a href="#/task/${t.id}">${esc(t.title)}</a><div class="xsmall muted"><span class="mono">${esc(t.repo)}</span>${note ? ' · ' + note : ''}</div></td>
      <td>${chip(t.status, t)}</td>
      <td><span class="tk-agent">${agentTile(t.agent, 'sm')}${A.name}</span></td>
      <td>${t.env === 'cluster' ? `<span title="${esc(t.cluster || '')}">Remote cluster</span>` : 'This computer'}</td>
      <td class="tnum">${files.length ? `<span class="diffstat"><span class="a">+${add}</span><span class="d">−${del}</span></span>` : '<span class="muted">None</span>'}</td>
      <td class="tnum">${r.on ? `${r.cpu} of ${r.lim.cpu}` : '<span class="muted">Stopped</span>'}</td>
      <td class="tnum">${r.on ? `${r.mem} of ${r.lim.mem} GB` : '<span class="muted">Stopped</span>'}</td>
      <td class="tnum">$${costFor(t).toFixed(2)}</td>
      <td class="muted">${fmtAgo(t.startedAt)}</td></tr>`;
  }).join('');
  return `<table class="table tasks-table"><thead><tr><th>Task</th><th>Status</th><th>Agent</th><th>Where</th><th>Changes</th><th>CPU (cores)</th><th>Memory</th><th>Cost</th><th>Started</th></tr></thead><tbody>${rows}</tbody></table>`;
}
function viewTasks() {
  const f = tasksFilter();
  const all = state.tasks.filter((t) => !isFolded(t));
  const count = (k) => (k === 'all' ? all.length : all.filter((t) => taskStateOf(t) === k).length);
  const using = all.map(resourceFor).filter((r) => r.on);
  const cpu = using.reduce((n, r) => n + r.cpu, 0), mem = using.reduce((n, r) => n + r.mem, 0);
  const html = `
    <div class="page-head"><h1 tabindex="-1" id="tasks-title">All tasks</h1>
      <p class="lede">${plural(all.length, 'task')}. ${using.length ? `${plural(using.length, 'sandbox', 'sandboxes')} in use: ${cpu.toFixed(1)} CPU cores and ${mem.toFixed(1)} GB of memory.` : 'No sandboxes are in use.'}</p></div>
    <div class="tasks-tools">
      <label class="sr-only" for="tasks-q">Search tasks</label>
      <span class="tasks-search">${icon('search', 'sm')}<input class="input" id="tasks-q" type="search" placeholder="Search by title, repo or agent" autocomplete="off" value="${esc(f.q)}"></span>
      <div class="seg" role="group" aria-label="Filter by state">${TASK_STATES.map(([k, l]) => `<button type="button" data-action="tasks-filter" data-k="status" data-v="${k}" aria-pressed="${f.status === k}">${l}<span class="seg-n tnum">${count(k)}</span></button>`).join('')}</div>
      <div class="seg" role="group" aria-label="Filter by where it runs">${[['all', 'Anywhere'], ['local', 'This computer'], ['cluster', 'Remote cluster']].map(([k, l]) => `<button type="button" data-action="tasks-filter" data-k="env" data-v="${k}" aria-pressed="${f.env === k}">${l}</button>`).join('')}</div>
    </div>
    <p class="sr-only" id="tasks-count" role="status"></p>
    <div class="card tasks-card" id="tasks-table">${tasksTableHTML()}</div>
    <p class="xsmall muted" style="margin-top:10px">${icon('terminal', 'xs')} Same list from the command line: <code>ax list</code></p>`;
  return { title: 'All tasks', crumbs: [{ label: 'Home', href: '#/' }, { label: 'All tasks' }], html, wide: true };
}

/* ---------- Where agents run (1 Axel swimming in Spring-to-Lake Aqueduct + ax doctor) ---------- */
const LAYERS = [
  { name: 'Virtualization', tech: 'Apple Virtualization.framework' },
  { name: 'Sandbox runtime', tech: 'microVM · k3s v1.30 · copy-on-write' },
  { name: 'Guardrails', tech: 'ax-gateway 0.9.2 · outbound key proxy' },
  { name: 'Agent images', tech: 'ax-task-runner 0.9.2 · antigravity 1.2.0 · claude-code 1.0.4 · codex 0.31.2' },
];
const CLUSTERS = [
  { name: 'ax-dev-us-central', desc: 'Your GKE · us-central1 · Agent Substrate v1alpha1', access: true, running: 12, load: .46, version: '0.9.2', compat: true },
  { name: 'ax-batch-eu', desc: 'Batch K8s · europe-west4 · spot pool', access: true, running: 3, load: .18, version: '0.8.1', compat: false },
  { name: 'ax-gpu-research', desc: 'GPU pool · restricted to Research', access: false, running: 0, load: 0, version: '0.9.2', compat: true, role: 'agent-runner' },
];
function versionBadge(c) {
  return c.compat
    ? `<span class="vbadge ok" title="AX ${c.version} on the cluster · your Studio and CLI are 0.9.2">${icon('check', 'xs')}AX ${c.version} · compatible</span>`
    : `<span class="vbadge warn" title="This cluster runs AX ${c.version}; tasks that use guardrails presets need 0.9 or later">${icon('alert', 'xs')}AX ${c.version} · needs 0.9+</span>`;
}
/* Clusters you can't use aren't radio options; they sit below the list and say who can grant access (no link inside a button). */
function noAccessHTML() {
  return CLUSTERS.filter((x) => !x.access).map((x) => `<div class="radio-card no-access"><span class="rc-main"><span class="rc-title">${x.name}</span><span class="rc-desc">${x.desc} · needs the <b>${x.role}</b> role</span></span><span class="rc-right"><button type="button" class="link" data-action="ask-admin" data-text="${x.name}" data-role="${x.role}">Ask ${esc(state.org.admin)}</button></span></div>`).join('');
}
/* The list is the clusters in your kubeconfig; an invite link from your platform team adds one. */
function inviteCluster(url) { return /^https:\/\/[^\s/]+\/join\/[\w-]{4,}/.test((url || '').trim()) ? 'ax-dev-us-central' : null; }
function otherConnectHTML(sel, mode) {
  return `<details class="disclosure other-connect" ${state.inviteOpen ? 'open' : ''}><summary>${icon('chevRight', 'xs chev')}Don't see your cluster?</summary>
    <div class="disclosure-body">
      <div class="field"><label for="invite-url">Invite link</label>
        <div class="invite-row"><input class="input mono" id="invite-url" placeholder="https://ax.acme.dev/join/…" autocomplete="off" spellcheck="false"><button type="button" class="btn sm" ${mode === 'setup' ? 'data-action="setup-invite"' : 'id="pm-invite"'}>Open link</button></div>
        <span class="field-status" id="invite-status" role="status"><span class="hint">Your platform team can send one. It adds the cluster to your kubeconfig and picks it for you.</span></span></div>
      <p class="hint" style="margin:10px 0 0">Or add the cluster to your kubeconfig yourself (for example with <span class="mono">gcloud container clusters get-credentials</span>), and it shows up in the list. Same from the command line: <span class="mono">ax connect --context &lt;name&gt;</span></p>
    </div></details>`;
}
function workingChip(label) { return `<span class="chip done">${icon('checkCircle')}${label || 'Working'}</span>`; }
function viewPlaces() {
  const local = state.tasks.filter((t) => t.env === 'local' && ACTIVE.includes(t.status)).length;
  /* Where agents run is the one home for "where": the clusters in your kubeconfig, the connected one marked, and
     Disconnect. There's no sign-in (AX Studio has no login). */
  const E0 = state.env;
  const clusters = `
      <div class="radio-list" style="margin-top:16px">
        ${CLUSTERS.map((c) => {
          const on = E0.clusterConnected && E0.cluster === c.name;
          const right = !c.access ? `<button type="button" class="link" data-action="ask-admin" data-text="${c.name}" data-role="${c.role}">Ask ${esc(state.org.admin)}</button>`
            : `${versionBadge(c)}<span class="xsmall muted" style="display:block;margin-top:6px">${c.running} agents running</span>${on ? `<span class="chip done" style="margin-top:8px">${icon('check')}Connected · default</span>` : c.compat ? `<button type="button" class="btn sm" style="margin-top:8px" data-action="cluster-connect" data-cluster="${c.name}">${E0.clusterConnected ? 'Make default' : 'Connect'}</button>` : ''}`;
          return `<div class="radio-card info${c.access ? '' : ' no-access'}${on ? ' is-on' : ''}" style="cursor:default;align-items:flex-start"><span class="rc-main"><span class="rc-title">${c.name}</span><span class="rc-desc">${c.desc}</span>${c.access ? `<span class="cap"><span class="meter"><span style="width:${c.load * 100}%"></span></span>${Math.round(c.load * 100)}% busy</span>` : `<span class="rc-desc">Needs the <b>${c.role}</b> role</span>`}</span><span class="rc-right">${right}</span></div>`;
        }).join('')}
      </div>
      ${E0.clusterConnected && E0.mode !== 'cluster' ? `<div class="btn-row" style="margin-top:14px"><button class="btn ghost sm" data-action="cluster-disconnect">Disconnect from ${esc(E0.cluster)}</button></div>` : ''}
      <p class="xsmall muted" style="margin-top:12px">From your kubeconfig (<span class="mono">~/.kube/config</span>). Studio checks your access and the AX version before anything runs. <span class="mono">ax connect --context &lt;name&gt;</span></p>`;
  const E = state.env;
  const localHealth = E.mode !== 'local' ? `<div class="health-line attn" style="margin-top:4px"><span class="hd"></span>Not set up on this computer</div>`
    : E.health === 'attention' ? `<div class="health-line attn" style="margin-top:4px"><span class="hd"></span>Needs attention · disk almost full</div>`
      : E.health === 'starting' ? `<div class="health-line" style="margin-top:4px"><span class="hd"></span>Starting · <span class="env-secs">${E.startsIn}</span> s</div>`
        : `<div class="health-line" style="margin-top:4px"><span class="hd"></span>Healthy · verified ${fmtAgo(now() - 2 * MIN)}</div>`;
  const localBody = E.mode !== 'local'
    ? `<div class="empty" style="padding:22px 6px 6px"><div><div class="e-title">Run agents on this computer too</div><div class="small" style="margin-top:4px;max-width:40ch">Set up a secure local sandbox in about 5 minutes. Tasks start in ~3 s and cost nothing in cloud resources.</div></div><a class="btn primary" href="#/welcome" data-action="setup-resume-path" data-path="local">Set up this computer</a></div>`
    : `${E.health === 'attention' && E.issue ? `<div style="margin-top:14px">${failCardHTML(E.issue, { omit: ['doctor'] })}</div>` : ''}
        <div class="rings" style="margin-top:20px">${ring(.39, '39%', 'Memory')}${ring(E.health === 'attention' ? .996 : .21, E.health === 'attention' ? '99%' : '21%', 'Disk', E.health === 'attention' ? 'var(--wait)' : 'var(--run)')}${ring(.18, '18%', 'CPU', 'var(--coral)')}<div class="small" style="margin-left:6px"><div class="stat-num tnum" style="font-size:26px">${local}</div><div class="muted">running here</div></div></div>
        <details class="disclosure" style="margin-top:18px"><summary>${icon('chevRight', 'sm chev')}Show runtime layers</summary><div class="disclosure-body"><div class="layers">
          ${LAYERS.map((l) => `<div class="layer"><div><div class="l-name">${l.name}</div><div class="l-tech">${l.tech}${l.name === 'Agent images' && state.pinImages ? ' · pinned' : ''}</div></div>${workingChip()}</div>`).join('')}
        </div></div></details>
        <div class="btn-row" style="margin-top:18px"><button class="btn sm" data-action="restart-sandbox">${icon('refresh', 'sm')}Restart sandbox</button>${E.health === 'attention' && E.issue ? '' : `<button class="btn ghost sm" data-action="diagnostics">${icon('copy', 'sm')}Copy diagnostics</button>`}</div>`;
  const html = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap">
      <div>
        <h1 tabindex="-1">Where agents run</h1>
        <p class="sub" style="margin-top:6px;font-size:14.5px;max-width:60ch">Run tasks on this computer or on a remote cluster. The same manifest and Guardrails apply to both, with zero YAML edits.</p>
      </div>
      <div class="btn-row">
        <button class="btn" data-action="doctor">Run health check</button>
        ${state.tasks.length ? '<button class="btn ghost" data-action="manifest" title="The latest task\'s task file">Export task YAML</button>' : ''}
      </div>
    </div>
    <div class="places-grid">
      <section class="card place-card" aria-labelledby="pl-local">
        <div class="place-top"><div><h2 id="pl-local" class="h-display-sm">On this computer</h2>${localHealth}</div></div>
        ${localBody}
      </section>
      <section class="card place-card" aria-labelledby="pl-cluster">
        <div class="place-top"><div><h2 id="pl-cluster" class="h-display-sm">On a remote cluster</h2><div class="small muted" style="margin-top:4px">Clusters from your kubeconfig · keeps running when your laptop closes</div></div></div>
        ${clusters}
      </section>
    </div>`;
  return { title: 'Where agents run', crumbs: [{ label: 'Home', href: '#/' }, { label: 'Where agents run' }], html };
}

/* ---------- Settings ----------
   One section at a time, like Docker Desktop, Chrome, GitHub and macOS System Settings. The nav marks the open section
   (aria-current="page"), every section has its own address (#/settings/notifications), and switching sections replaces
   only the section. A long page with jump links left the nav unchanged while you scrolled, so it never said where you were. */
const SETTINGS_SECTIONS = [
  { slug: 'agents', id: 'set-agents', h: 'h-agents', label: 'Agents & keys' },
  { slug: 'skills', id: 'set-skills', h: 'h-skills', label: 'Agent skills' },
  { slug: 'appearance', id: 'set-appearance', h: 'h-appearance', label: 'Appearance & story' },
  { slug: 'accessibility', id: 'set-a11y', h: 'h-a11y', label: 'Accessibility' },
  { slug: 'notifications', id: 'set-notify', h: 'h-notify', label: 'Notifications' },
  { slug: 'privacy', id: 'set-privacy', h: 'h-privacy', label: 'Privacy & data' },
  { slug: 'command-line', id: 'set-cli', h: 'h-cli', label: 'Command line' },
  { slug: 'advanced', id: 'set-advanced', h: 'h-adv', label: 'Advanced' },
];
/** The section for #/settings/<slug>. #/settings and unknown slugs open the first one, Agents & keys. */
function settingsSection(slug) { return SETTINGS_SECTIONS.find((x) => x.slug === slug) || SETTINGS_SECTIONS[0]; }
function viewSettings(slug) {
  const pref = themePref();
  const agents = agentList().map((a) => {
    const img = a.version === 'dev' ? 'built on this computer' : `image v${a.version}`;
    const status = a.connected ? `${authLine(a)} · ${esc(img)}` : `<span style="color:var(${a.keyProblem ? '--fail' : '--wait'});font-weight:600">${a.keyProblem || (a.custom ? 'Not signed in yet' : 'Not connected yet')}</span> · ${esc(img)}`;
    const btn = a.custom ? `${a.connected ? '' : `<button class="btn sm" data-action="key-dialog" data-agent="${a.id}">Connect</button>`}<button class="btn ghost sm" data-action="remove-agent" data-agent="${a.id}">Remove</button>`
      : a.auth === 'google' && a.connected ? `<button class="btn sm" data-action="agent-signout" data-agent="${a.id}">Sign out</button>`
      : a.auth === 'account' && a.connected ? `<button class="btn sm" data-action="agent-signout" data-agent="${a.id}">Sign out</button>`
        : `<button class="btn sm" data-action="key-dialog" data-agent="${a.id}">${a.connected ? 'Replace key' : a.keyProblem ? 'Fix sign-in' : 'Connect'}</button>`;
    const tag = a.custom ? `<span class="c-tag s-${a.source}">${agentSource(a).label}</span>` : '';
    return `<div class="set-row">${agentTile(a.id)}<div class="sr-main"><div class="sr-title">${a.name}${tag}</div><div class="sr-desc">${status}</div></div>${btn}</div>`;
  }).join('') + `<div class="set-row"><div class="sr-main"><div class="sr-title">Add an agent</div><div class="sr-desc">Use one your team shared or one from the AX catalog, or bring an agent you built.</div></div><button class="btn sm" data-action="find-agent" data-tab="browse">Add an agent…</button></div>`;
  const skills = prebuiltAgents().map((a) => {
    const on = !!state.skills[a.id];
    return `<div class="set-row">${agentTile(a.id)}<div class="sr-main"><div class="sr-title">${a.name}</div><div class="sr-desc">${on ? `AX skill installed · ${a.name} can set up, run and inspect tasks with <code>ax</code>` : `Not installed · <code>ax skills install --agent ${a.cli}</code>`}</div></div>${on ? `<span class="chip done">${icon('check')}Installed</span><button class="btn ghost sm" data-action="skill-toggle" data-agent="${a.id}">Remove</button>` : `<button class="btn sm" data-action="skill-toggle" data-agent="${a.id}">${icon('download', 'sm')}Install</button>`}</div>`;
  }).join('');
  /* Repo keys live next to model keys. Connect GitHub once; AX adds the token outside the sandbox. */
  const gh = state.github;
  const ghRow = `<div class="set-row" id="set-github"><span class="agent-tile x-agent" aria-hidden="true" style="--t:#24292f">${icon('branch')}</span><div class="sr-main"><div class="sr-title">GitHub<span class="c-tag">Code host</span></div>
      <div class="sr-desc">${gh.connected ? `Signed in as ${esc(gh.user)} · for private repos, pushes and the GitHub MCP server · added outside the sandbox` : '<span style="color:var(--wait);font-weight:600">Not connected yet</span> · public repos still clone. Connect it once for private repos, pushes and the GitHub MCP server.'}</div>
      <div class="sr-desc">${icon('terminal', 'xs')} Same from the command line: <code>ax auth login github</code></div></div>
      ${gh.connected ? '<button class="btn sm" data-action="disconnect-github">Sign out</button>' : `<button class="btn sm" data-action="connect-github">${icon('globe', 'sm')}Connect GitHub</button>`}</div>`;
  const sw = (id, on, label) => `<label class="switch"><input type="checkbox" role="switch" id="${id}" data-action="toggle-pref" data-pref="${id}" ${on ? 'checked' : ''} aria-label="${label}"><span class="track"></span><span class="thumb"></span></label>`;
  const sec = settingsSection(slug);
  const body = {
    agents: () => `<div class="card">
          ${agents}
          ${ghRow}
          <div class="set-row"><div class="sr-main"><div class="sr-title">Pin prebuilt agent image versions</div><div class="sr-desc">Prevents unexpected harness CLI upgrades from changing behavior mid-sprint.</div></div>${sw('pinImages', state.pinImages, 'Pin prebuilt agent image versions')}</div>
        </div>`,
    skills: () => `<p class="small sub" style="margin:-4px 0 10px">Install the bundled AX skill so coding agents can drive <code>ax</code> themselves: set up, run, inspect and hand off tasks, with <code>--json</code> output.</p>
          <div class="card">${skills}</div>`,
    appearance: () => `<div class="card">
            <div class="theme-cards" role="radiogroup" aria-labelledby="h-appearance">
              ${[['system', 'Match system', 'monitor'], ['light', 'Light', 'sun'], ['dark', 'Dark', 'moon']].map(([k, l, ic]) => `<button type="button" class="theme-card" role="radio" aria-checked="${pref === k}" data-action="set-theme" data-theme="${k}"><span class="theme-preview ${k}" aria-hidden="true"><span class="tp-ui"><i class="tp-sb"></i><i class="tp-bd"><b></b><s></s><s></s></i></span>${k === 'system' ? '<span class="tp-ui tp-dark"><i class="tp-sb"></i><i class="tp-bd"><b></b><s></s><s></s></i></span>' : ''}</span><span class="tc-label">${l}</span></button>`).join('')}
            </div>
            <div class="set-row" style="margin-top:10px"><div class="sr-main"><div class="sr-title">Axel & the Clear Spring</div><div class="sr-desc">Why AX’s mascot is an axolotl.</div></div><button class="btn sm" data-action="story">${icon('waves', 'sm')}Read story</button></div>
          </div>`,
    accessibility: () => `<div class="card">
          <div class="set-row"><div class="sr-main"><div class="sr-title" id="sk-title">Single-key shortcuts</div><div class="sr-desc" id="sk-desc">N for a new task, T for the theme, / for search, ? for help, and G then a letter to move around. Turn these off if you use speech input or assistive tech that sends single keys. ${MOD} K always works.</div></div><label class="switch"><input type="checkbox" role="switch" id="singleKeys" data-action="toggle-pref" data-pref="singleKeys" ${state.singleKeys ? 'checked' : ''} aria-labelledby="sk-title" aria-describedby="sk-desc"><span class="track"></span><span class="thumb"></span></label></div>
          <div class="set-row"><div class="sr-main"><div class="sr-title" id="rm-title">Reduce motion</div><div class="sr-desc" id="rm-desc">The mascot, shimmer, flowing lines and confetti stay still. AX also follows your system's reduce-motion setting.</div></div><label class="switch"><input type="checkbox" role="switch" data-action="toggle-pref" data-pref="reduceMotion" ${state.reduceMotion ? 'checked' : ''} aria-labelledby="rm-title" aria-describedby="rm-desc"><span class="track"></span><span class="thumb"></span></label></div>
        </div>`,
    notifications: () => `<div class="card">
          <div class="set-row"><div class="sr-main"><div class="sr-title">When an agent needs you</div><div class="sr-desc">Questions, Guardrails pauses, permission prompts and failures.</div></div>${sw('needs', state.notify.needs, 'Notify when an agent needs you')}</div>
          <div class="set-row"><div class="sr-main"><div class="sr-title">When a task finishes</div><div class="sr-desc">With a summary of sandbox changes ready for review.</div></div>${sw('done', state.notify.done, 'Notify when a task finishes')}</div>
          <div class="set-row"><div class="sr-main"><div class="sr-title">Outside AX Studio</div><div class="sr-desc">A system notification when AX Studio is in the background and a task needs you, fails or finishes. The browser tab also shows how many tasks need you.</div></div>${sw('desktop', !!state.notify.desktop, 'Notify me outside AX Studio')}</div>
          <div class="set-row"><div class="sr-main"><div class="sr-title">Celebrate with confetti</div><div class="sr-desc">A tiny burst when a branch ships. Automatically off when you prefer reduced motion.</div></div>${sw('party', state.notify.party !== false, 'Celebrate with confetti')}</div>
        </div>`,
    privacy: () => `<div class="card">
          <div class="set-row"><div class="sr-main"><div class="sr-title">Keep Activity for</div><div class="sr-desc">Activity (each agent's trajectory) stays on this computer in <code>~/.ax/trajectories</code>.</div></div>
            <div class="seg" role="radiogroup" aria-label="Keep Activity for">${[['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['forever', 'Forever']].map(([k, l]) => `<button type="button" role="radio" aria-checked="${state.privacy.retention === k}" data-action="set-retention" data-val="${k}">${l}</button>`).join('')}</div></div>
          <div class="set-row"><div class="sr-main"><div class="sr-title">Delete all Activity</div><div class="sr-desc">Removes trajectories for every task on this computer. Changes, branches and workspaces are kept.</div></div><button class="btn sm danger" data-action="delete-activity">Delete all Activity…</button></div>
          <div class="set-row"><div class="sr-main"><div class="sr-desc">${icon('lock', 'xs')} Diagnostics you copy always have secrets removed. Studio only accepts connections from this computer.</div></div></div>
        </div>`,
    'command-line': () => `<div class="card card-pad">
          <p class="small sub">Everything in AX Studio also works from the <code>ax</code> command line, so a coding agent can set up, run, inspect, steer and stop tasks for you. Add <code>--json</code> to any command for machine-readable output.</p>
          <table class="cli-table" aria-label="What a coding agent can do from the command line">
            <thead><tr><th scope="col">To</th><th scope="col">Run</th></tr></thead>
            <tbody>${[
              ['Set up this computer', 'ax setup --yes'],
              ['Start a task', 'ax run --template antigravity --goal "…"'],
              ['List tasks and what needs you', 'ax ls --json'],
              ['Read a task\'s Activity (OATR trajectory)', 'ax logs <task> --oatr'],
              ['See its changes', 'ax diff <task>'],
              ['Send a message, pause or resume', 'ax send <task> "…" · ax pause <task> · ax resume <task>'],
              ['Allow a blocked site or a risky command', 'ax allow <site> --workspace <name> · ax approve <task>'],
              ['Continue with another agent', 'ax handoff <task> --to codex'],
              ['Run on a remote cluster', 'ax promote <task> --cluster <name>'],
              ['Stop a task and keep its changes', 'ax stop <task>'],
            ].map(([what, cmd]) => `<tr><th scope="row">${what}</th><td><code>${esc(cmd)}</code></td></tr>`).join('')}</tbody>
          </table>
          <div style="margin-top:12px">${cliHint('ax doctor && ax version   # 0.9.2 · /usr/local/bin/ax')}</div></div>`,
    advanced: () => `<div class="card">
          <div class="set-row"><div class="sr-main"><div class="sr-title">Show infrastructure details</div><div class="sr-desc">Adds microVM, Agent Substrate CRD, pod and namespace details under “Show details”.</div></div>${sw('showInfra', state.showInfra, 'Show infrastructure details')}</div>
          <div class="set-row"><div class="sr-main"><div class="sr-title">Run setup again</div><div class="sr-desc">Re-check this computer, or switch between running here and on a remote cluster.</div></div><a class="btn sm" href="#/welcome" data-action="rerun-setup">Run setup</a></div>
          <div class="set-row"><div class="sr-main"><div class="sr-title">Uninstall AX Studio</div><div class="sr-desc">Removes the local sandbox, agent images, Activity and stored credentials. You choose whether to keep workspaces.</div></div><button class="btn sm danger" data-action="uninstall">Uninstall…</button></div>
        </div>`,
  }[sec.slug]();
  const html = `
    <h1 tabindex="-1">Settings</h1>
    <div class="settings">
      <nav class="settings-nav" id="settings-nav" aria-label="Settings sections">${SETTINGS_SECTIONS.map((x) => `<a href="#/settings/${x.slug}"${x === sec ? ' aria-current="page"' : ''}>${x.label}</a>`).join('')}</nav>
      <section class="set-section" id="${sec.id}" aria-labelledby="${sec.h}"><h2 id="${sec.h}" tabindex="-1">${sec.label}</h2>
        ${body}
      </section>
    </div>`;
  /* After switching sections (the hashchange handler in app.js sets settingsFocus), focus moves to the new section's
     heading, so a screen reader announces where you are. A fresh visit focuses the page heading as usual. */
  const after = () => { if (!state.settingsFocus) return; state.settingsFocus = false; const h = document.getElementById(sec.h); if (h) h.focus({ preventScroll: true }); };
  return { title: `${sec.label} · Settings`, crumbs: [{ label: 'Home', href: '#/' }, { label: 'Settings', href: '#/settings' }, { label: sec.label }], html, after };
}

function viewNotFound() {
  return {
    title: 'Not found', crumbs: [{ label: 'Home', href: '#/' }, { label: 'Not found' }],
    html: `<div class="card empty">${axo('thinking', { decorative: true })}<div><div class="e-title">Axel couldn't find that page</div><div class="small" style="margin-top:4px">It may have moved, or the link is incomplete.</div></div><a class="btn primary" href="#/">Go home</a></div>`,
  };
}

/* ---------- Prototype review links (#/review) ----------
   For reviews and usability studies only. It isn't part of AX Studio: nothing in the app links here, and Settings and the
   command palette don't list it. Each link is a fresh page load (?scenario=<id>, ?reset, ?cuj=2), so every state starts
   from the same demo data and the link can be copied into a doc or a study script. */
function viewReview() {
  const groups = [...new Set(SCENARIOS.map((x) => x.group))];
  const row = (href, label, meta) => `<li><a href="${href}">${esc(label)}</a>${meta ? `<span class="rl-meta">${esc(meta)}</span>` : ''}<code>${esc(href)}</code></li>`;
  const html = `
    <div class="setup cuj review">
      <div class="setup-atmo" aria-hidden="true"></div>
      <header class="setup-top"><span class="brand" style="padding:0">${BRAND_MARK}<span class="brand-name">AX <span>Studio</span></span></span>
        <div class="btn-row"><button class="round-btn" id="theme-toggle" data-action="theme-toggle"></button></div></header>
      <main class="setup-main" id="main" tabindex="-1"><div class="cuj-card view-enter">
        <div class="cuj-kicker">Prototype review</div>
        <div class="cuj-head"><div class="cuj-head-copy">
          <h1 tabindex="-1">Review links</h1>
          <p class="lede">Open a journey, or any failure and recovery state where a builder would meet it. For reviews and usability studies only: this page isn't part of AX Studio, and nothing in the app links here.</p>
        </div></div>
        <section class="cuj-sec" aria-labelledby="rv-journeys"><h2 class="cuj-sk" id="rv-journeys">Journeys</h2>
          <ul class="review-list">
            ${row('#/get', 'Get AX Studio', 'The download page, before AX Studio is on the computer')}
            ${row('?reset', 'Fresh install', 'Setup, then the day 0 Home')}
            ${row('#/cuj/1', 'CUJ 1 · The installation experience', 'Both paths, and what can go wrong')}
            ${row('?cuj=2', 'CUJ 2 · Deploy your first agent', 'A first run, right where CUJ 1 ends')}
          </ul></section>
        <div class="review-groups">
          ${groups.map((g, k) => `<section class="cuj-sec" aria-labelledby="rv-g${k}"><h2 class="cuj-sk" id="rv-g${k}">${esc(g)} · ${SCENARIOS.filter((x) => x.group === g).length}</h2>
            <ul class="review-list">${SCENARIOS.filter((x) => x.group === g).map((x) => row(`?scenario=${x.id}`, x.label)).join('')}</ul></section>`).join('')}
        </div>
        <div class="cuj-foot"><span>Prototype: nothing is installed, and nothing leaves this page. ${SCENARIOS.length} scenarios.</span><a href="#/">Back to Studio</a></div>
      </div></main>
    </div>`;
  return { title: 'Review links · Prototype', full: true, html };
}

/* ---------- Get AX Studio (#/get): the download page, before AX Studio is on the computer ----------
   A mock of the page builders get AX Studio from, so it isn't part of the app. One small package puts AX Studio and
   the ax command on the computer. The sandbox is set up later, inside Studio, and only if they choose this computer.
   People who already use ax can run ax setup instead, and Studio then opens on Ready (startPreinstalled). */
function viewGet() {
  const done = !!state.getDownloaded;
  const setupOut = [
    '$ ax setup',
    'Checking this Mac: macOS 15.1, 16 GB memory, 212 GB free',
    'Set up a secure sandbox on this computer? About 6 GB. [Y/n] y',
    'Turning on hardware isolation needs your password once.',
    '✓ Created your secure sandbox (microVM, k3s)',
    '✓ Started Guardrails (Balanced)',
    `✓ Downloaded ${AGENTS[DEFAULT_AGENT].name} ${AGENTS[DEFAULT_AGENT].version}`,
    `Ready. ${andList(prebuiltAgents().filter((a) => a.id !== DEFAULT_AGENT).map((a) => a.name))} keep downloading in the background.`,
    'Open AX Studio: ax studio',
  ].join('\n');
  const html = `
    <div class="setup cuj get">
      <div class="setup-atmo" aria-hidden="true"></div>
      <header class="setup-top"><span class="brand" style="padding:0">${BRAND_MARK}<span class="brand-name">AX <span>Studio</span></span></span>${cujRibbonHTML('Before it opens · Get AX Studio')}
        <div class="btn-row"><button class="round-btn" id="theme-toggle" data-action="theme-toggle"></button></div></header>
      <main class="setup-main" id="main" tabindex="-1"><div class="cuj-card view-enter">
        <div class="cuj-kicker">Before AX Studio opens · Download page</div>
        <div class="cuj-head">${axo('wave', { decorative: true, id: 'get-axo' })}<div class="cuj-head-copy">
          <h1 tabindex="-1">Get AX Studio</h1>
          <p class="lede">Run coding agents in a secure sandbox on this Mac or on a remote cluster, and review every change before it reaches your code. It’s one small download. AX Studio sets up the rest after you choose where agents run.</p>
        </div></div>
        <div class="get-opts">
          <section class="get-opt" aria-labelledby="get-app">
            <span class="cp-k">Recommended</span>
            <h2 class="cp-title" id="get-app">Download the app</h2>
            <p class="cp-desc">Installs AX Studio and the <span class="mono">ax</span> command. About 150 MB, for macOS 14 or later.</p>
            ${done
              ? `<p class="get-done" role="status">${icon('checkCircle', 'sm')}<span>AX Studio is in your Downloads folder. Drag it to Applications, then open it.</span></p>
            <button type="button" class="btn primary" data-action="get-open">Open AX Studio${icon('arrowRight', 'sm')}</button>`
              : `<button type="button" class="btn primary" data-action="get-download">${icon('download', 'sm')}Download for Mac</button>`}
          </section>
          <section class="get-opt" aria-labelledby="get-cli">
            <span class="cp-k">Command line</span>
            <h2 class="cp-title" id="get-cli">Already use ax?</h2>
            <p class="cp-desc">Set up this computer from your terminal. It runs the same setup as AX Studio.</p>
            <div class="get-cmd"><code>ax setup</code><button type="button" class="btn ghost sm" data-action="copy" data-text="ax setup" aria-label="Copy ax setup">Copy</button></div>
            <details class="disclosure"><summary>${icon('chevRight', 'sm chev')}What <span class="mono">ax setup</span> shows</summary><div class="disclosure-body"><pre class="tool-out well get-term">${esc(setupOut)}</pre></div></details>
            <button type="button" class="btn" data-action="get-open-cli">Open AX Studio after ax setup</button>
          </section>
        </div>
        <section class="cuj-sec" aria-labelledby="get-next"><h2 class="cuj-sk" id="get-next">What happens next</h2>
          <ol class="get-steps">
            <li><b>Open AX Studio.</b> It checks this Mac and asks where agents should run.</li>
            <li><b>On this computer:</b> about 5 minutes, and about 6 GB for the sandbox and agents. Admin permission is asked once.</li>
            <li><b>On a remote cluster:</b> pick a cluster from your kubeconfig. Nothing else is installed on this computer.</li>
          </ol></section>
        <div class="cuj-foot"><span>Prototype: nothing is downloaded or installed.</span><span>AX Studio and <span class="mono">ax</span> share one setup, so <span class="mono">ax doctor</span> and <span class="mono">ax uninstall</span> work either way.</span></div>
      </div></main>
      <footer class="setup-foot"><span>${icon('lock', 'xs')} Agents never see raw keys or files outside the sandbox copy you choose.</span></footer>
    </div>`;
  return { title: 'Get AX Studio', full: true, html };
}

/* ---------- CUJ 1 · The installation experience (shareable on its own: ?cuj=1 or #/cuj/1) ----------
   One journey at a time for team review: title, description, the two paths, what can go wrong, and what success means.
   While you're in it, a ribbon in the setup header says which path or failure you're looking at, with a way back. */
const CUJ1_FAILS = [
  ['disk', 'Not enough disk space'], ['memory', 'Not enough free memory'], ['ram', 'Too little memory installed'], ['virt', 'Virtualization blocked by IT'], ['admin', 'No admin rights'],
  ['download', 'Download blocked by a proxy'], ['interrupted', 'Install was interrupted'],
];
function cujRibbonHTML(here) {
  if (state.cuj !== 1) return '';
  const s = state.setup || {};
  const fail = s.scenario && CUJ1_FAILS.find((x) => x[0] === s.scenario);
  const ctx = here || (s.preinstalled ? (s.preinstalled === 'it' ? 'Already set up by IT' : 'Already set up with ax setup')
    : fail ? `What can go wrong · ${fail[1]}` : s.path === 'cluster' ? 'Path B · Connect to a remote cluster' : 'Path A · On this computer');
  return `<div class="cuj-ribbon" role="note" aria-label="Critical user journey"><span class="cr-k">CUJ 1</span><span class="cr-t">The installation experience</span><span class="cr-sep" aria-hidden="true"></span><span class="cr-c">${esc(ctx)}</span><a class="cr-link" href="#/cuj/1">Overview</a></div>`;
}
function viewCuj1() {
  const tile = (path, k, title, desc, meta) => `<button type="button" class="cuj-path" data-action="cuj-path" data-path="${path}">
      <span class="cp-k">${k}</span><span class="cp-title">${title}</span><span class="cp-desc">${desc}</span>
      <span class="cp-meta">${meta}</span><span class="cp-go">Start this path${icon('arrowRight', 'sm')}</span></button>`;
  const html = `
    <div class="setup cuj">
      <div class="setup-atmo" aria-hidden="true"></div>
      <header class="setup-top"><span class="brand" style="padding:0">${BRAND_MARK}<span class="brand-name">AX <span>Studio</span></span></span>
        <div class="btn-row"><button class="round-btn" id="theme-toggle" data-action="theme-toggle"></button></div></header>
      <main class="setup-main" id="main" tabindex="-1"><div class="cuj-card view-enter">
        <div class="cuj-kicker">Critical user journey 1 of 3</div>
        <div class="cuj-head">${axo('wave', { decorative: true, id: 'cuj-axo' })}<div class="cuj-head-copy">
          <h1 tabindex="-1"><span class="cuj-num">CUJ 1</span>The installation experience</h1>
          <p class="lede">Go from a clean laptop to a safe, ready place to run coding agents in minutes, without touching Kubernetes. First, choose where agents run: a secure sandbox on this computer, or a cluster your team already runs.</p>
        </div></div>
        <div class="cuj-paths">
          ${tile('local', 'Path A', 'On this computer', 'A secure sandbox on this Mac. Agents work on a copy of your code, and nothing leaves without your OK.', 'About 5 min · needs about 6 GB')}
          ${tile('cluster', 'Path B', 'Connect to a remote cluster', 'Nothing to install. Pick a cluster from your kubeconfig and run there, under your organization’s guardrails.', 'About 1 min · no admin rights needed')}
        </div>
        <p class="cuj-also">Also in this journey: <a href="#/get">Get AX Studio</a>, the download page, and a first launch that was already set up <button type="button" class="link" data-action="cuj-preinstalled" data-by="it">by IT</button> or <button type="button" class="link" data-action="cuj-preinstalled" data-by="cli">with ax setup</button>.</p>
        <section class="cuj-sec" aria-labelledby="cuj-fail"><h2 class="cuj-sk" id="cuj-fail">What can go wrong</h2>
          <p class="cuj-sd">Each one opens where a builder would meet it, with the cause in plain words and a way forward.</p>
          <div class="cuj-chips">${CUJ1_FAILS.map(([k, l]) => `<button type="button" class="pill" data-action="cuj-scenario" data-issue="${k}">${esc(l)}</button>`).join('')}</div></section>
        <section class="cuj-sec" aria-labelledby="cuj-ok"><h2 class="cuj-sk" id="cuj-ok">Success looks like</h2>
          <ul class="cuj-ok">
            <li>${icon('check', 'sm')}<span><b>Ready to run a first agent</b> in about 5 minutes on this computer, or about 1 minute on a remote cluster</span></li>
            <li>${icon('check', 'sm')}<span><b>Zero infrastructure commands</b> on the default path: no kubectl, Helm or YAML</span></li>
            <li>${icon('check', 'sm')}<span><b>Every failure says why</b> and offers a next step, including connecting to a remote cluster instead</span></li>
          </ul></section>
        <div class="cuj-foot"><span>Prototype: nothing is installed, and nothing leaves this page.</span><span>Next: CUJ 2 · Deploy your first agent</span></div>
      </div></main>
      <footer class="setup-foot"><span>${icon('lock', 'xs')} Agents never see raw keys or files outside the sandbox copy you choose.</span></footer>
    </div>`;
  return { title: 'CUJ 1 · The installation experience', full: true, html };
}

/* ---------- First-run setup (CUJ 1): fork (F1) · agent-first download (F3) · failures (F2) ---------- */
function setupSteps(pick) {
  const A = AGENTS[pick];
  return [
    { title: 'Checking this computer', short: 'Check computer', desc: 'macOS 15.1 · 16 GB memory · 212 GB free', ic: 'laptop' },
    { title: 'Creating your secure sandbox', short: 'Start sandbox', desc: 'microVM · copy-on-write · host files untouched', ic: 'box' },
    { title: 'Starting Guardrails', short: 'Start Guardrails', desc: 'Balanced preset · keys stay in your keychain', ic: 'shield' },
    A ? { title: `Downloading ${A.name}`, short: `Get ${A.name}`, desc: `${A.cli}:${A.version} first, so you can start sooner`, ic: 'download' }
      : { title: 'Getting the agent runner', short: 'Get runner', desc: 'ax-task-runner 0.9.2, so your own agent can run; the templates follow', ic: 'download' },
  ];
}
const SETUP_STEPS = setupSteps(DEFAULT_AGENT);
function setupStonesHTML(s, steps, failAt) {
  const cur = steps[Math.min(s.step, steps.length - 1)];
  const sp = typeof s.progress === 'number' ? s.progress : Math.min(1, s.step / Math.max(1, steps.length - 1));
  return `<div class="stones ${failAt != null ? 'has-fail' : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="4" aria-valuenow="${s.step}" aria-valuetext="Step ${Math.min(s.step + 1, 4)} of 4: ${esc(cur.title)}" style="--sp:${sp}">
    <span class="fillbar"></span>
    ${steps.map((st, k) => `<div class="stone ${k < s.step ? 'ok' : k === failAt ? 'fail' : k === s.step ? 'now' : ''}"><span class="sb">${icon(k < s.step ? 'check' : k === failAt ? 'alert' : k === s.step ? 'loader' : st.ic)}</span><span class="sl">${esc(st.short)}</span></div>`).join('')}
  </div>`;
}
function setupCheckItem(cls, ic, title, desc) {
  return `<li class="check-item ${cls}"><span class="ci-icon">${icon(ic)}</span><div><div class="ci-title">${title}</div><div class="ci-desc">${desc}</div></div></li>`;
}
function viewSetup() {
  const s = state.setup || (state.setup = { phase: 'before', step: 0, pick: DEFAULT_AGENT, path: 'local' });
  s.path = s.path || 'local';
  s.pick = AGENTS[s.pick] || s.pick === 'byo' ? s.pick : DEFAULT_AGENT;
  /* Your own agent: setup gets the agent runner first, every template downloads in the background, and Ready offers
     Add your agent. */
  const byo = s.pick === 'byo';
  const A = AGENTS[s.pick] || AGENTS[DEFAULT_AGENT];
  const steps = setupSteps(s.pick);
  const others = prebuiltAgents().filter((a) => a.id !== s.pick);
  let mood = 'wave', head = '', body = '';
  if (s.phase === 'before') {
    const issue = s.issue;
    head = `<h1 tabindex="-1">Hi, I'm Axel.</h1><p class="lede">AX Studio runs coding agents in a secure sandbox, and you review every change before it reaches your code.</p>`;
    const pathCard = (k, ic, title, desc, tag, tagCls) => `<button type="button" class="choice path-card" role="radio" aria-checked="${s.path === k}" data-action="setup-path" data-path="${k}"><span class="c-check">${icon('check')}</span><span><span class="c-title">${title}</span><span class="c-desc">${desc}</span></span><span class="pc-tag ${tagCls || ''}">${tag}</span></button>`;
    const checks = s.path === 'local' ? `
      <div class="setup-panel"><ul class="check-list" aria-label="Before you start">
        ${issue === 'virt' ? setupCheckItem('no', 'x', 'Apple Virtualization', 'Turned off by your organization\'s device management') : setupCheckItem('ok', 'check', 'macOS 14 or later', 'You have macOS 15.1 (Apple Virtualization ready)')}
        ${issue === 'disk' ? setupCheckItem('no', 'x', 'About 6 GB of free space', 'This Mac has 3.1 GB free') : setupCheckItem('ok', 'check', 'About 6 GB of free space', '212 GB available for the sandbox and agent images')}
        ${issue === 'ram' ? setupCheckItem('no', 'x', 'At least 8 GB of memory', 'This Mac has 4 GB installed') : issue === 'memory' ? setupCheckItem('no', 'x', 'About 8 GB of free memory', 'This Mac has 3 GB free of 16 GB') : setupCheckItem('ok', 'check', 'About 8 GB of free memory', '11 GB free of 16 GB; the sandbox uses up to 8 GB while agents run')}
        ${setupCheckItem('ok', 'check', 'Balanced Guardrails ready', 'Git, npm, PyPI and model APIs work right away; keys stay outside the sandbox')}
        ${issue === 'admin' ? setupCheckItem('no', 'x', 'Administrator permission', "Your account isn't an administrator on this Mac") : setupCheckItem('warn', 'key', 'Administrator permission', 'Asked once, to turn on hardware isolation')}
      </ul></div>
      ${issue ? `<div style="margin-top:14px">${failCardHTML('setup-' + issue, {})}</div>` : ''}
      <div class="su-q"><b>Which agent first?</b><span>${byo ? 'Setup gets the agent runner first, and you add your agent right after. The templates follow in the background.' : 'It downloads first so you can start sooner. The others follow in the background.'}</span></div>
      <div class="agent-first" role="radiogroup" aria-label="Which agent first?">${prebuiltAgents().map((a) => `<button type="button" role="radio" aria-checked="${s.pick === a.id}" data-action="setup-pick" data-agent="${a.id}">${agentTile(a.id, 'sm')}${a.name}</button>`).join('')}<button type="button" role="radio" aria-checked="${byo}" data-action="setup-pick" data-agent="byo">${byoTile('sm')}Your own agent</button></div>`
      : `<div class="su-now"><b>What happens next</b>Pick a cluster from your kubeconfig (<span class="mono">~/.kube/config</span>). Tasks run there with your organization's guardrails, and nothing is installed on this computer. You can set up this computer later.</div>`;
    body = `
      ${s.interrupted ? `<div style="margin-top:18px">${failCardHTML('setup-interrupted', {})}</div>` : ''}
      <div class="su-q" style="margin-top:22px"><b>Where should agents run?</b></div>
      <div class="path-cards" role="radiogroup" aria-label="Where should agents run?">
        ${pathCard('local', 'laptop', 'On this computer', 'A secure sandbox on this Mac. About 5 minutes to set up; needs about 6 GB.', issue ? "Can't run here yet" : 'Recommended', issue ? 'warn' : '')}
        ${pathCard('cluster', 'cloud', 'Connect to a remote cluster', "Nothing to install. Pick a cluster from your kubeconfig and run there. About 1 minute.", issue ? 'Recommended for this Mac' : 'Needs a remote cluster', issue ? '' : 'muted')}
      </div>
      ${checks}
      <div class="setup-actions">
        ${s.path === 'local'
          ? `<button class="btn primary lg" data-action="setup-start" id="setup-start" ${issue || s.interrupted ? 'disabled' : ''}>Set up on this computer${icon('arrowRight', 'sm')}</button>
             <details class="disclosure"><summary>${icon('chevRight', 'sm chev')}What gets installed?</summary><div class="disclosure-body small sub">${LAYERS.map((l) => `<div style="padding:3px 0"><strong style="color:var(--ink)">${l.name}</strong> <span class="mono xsmall muted">${l.tech}</span></div>`).join('')}</div></details>`
          : `<button class="btn primary lg" data-action="setup-connect" id="setup-connect">${icon('cloud', 'sm')}Choose a cluster${icon('arrowRight', 'sm')}</button>`}
      </div>`;
  } else if (s.phase === 'installing' || s.phase === 'failed') {
    const failed = s.phase === 'failed';
    mood = failed ? 'failed' : 'building';
    const cur = steps[Math.min(s.step, steps.length - 1)];
    const nxt = steps[s.step + 1];
    const minsLeft = Math.max(1, 4 - s.step);
    head = failed
      ? `<h1 tabindex="-1">Setup paused at step ${s.step + 1} of 4</h1><p class="lede">Fix the problem below to continue.</p>`
      : `<h1 tabindex="-1">Setting up your secure agent sandbox</h1><p class="lede">About ${minsLeft} ${minsLeft === 1 ? 'minute' : 'minutes'} left.</p>`;
    body = `
      ${setupStonesHTML(s, steps, failed ? s.step : null)}
      ${failed ? `<div style="margin-top:18px">${failCardHTML('setup-download', { agent: s.pick })}</div>`
        : `<div class="su-now"><b>Now</b>${esc(cur.title)}… <span class="muted">${esc(cur.desc)}</span>${nxt ? `<div style="margin-top:8px"><b style="display:inline;color:var(--faint)">Next</b> ${esc(nxt.title)}</div>` : `<div style="margin-top:8px"><b style="display:inline;color:var(--faint)">Next</b> ${byo ? 'The agent runner is ready for your agent.' : `${esc(A.name)} is ready to use.`} ${esc(andList(others.map((a) => a.name)))} keep downloading in the background.</div>`}</div>`}
      <details class="disclosure" style="margin-top:16px"><summary>${icon('chevRight', 'sm chev')}Show details</summary><div class="disclosure-body"><div class="layers">
        ${LAYERS.map((l, k) => `<div class="layer"><div><div class="l-name">${l.name}</div><div class="l-tech">${l.tech}</div></div>${k < s.step ? workingChip() : k === s.step ? (failed ? `<span class="chip waiting">${icon('alert')}Needs attention</span>` : `<span class="chip running">${icon('loader')}Installing</span>`) : '<span class="chip">Waiting</span>'}</div>`).join('')}
      </div></div></details>`;
  } else if (s.phase === 'connect') {
    mood = 'thinking';
    const sel = s.cluster || 'ax-dev-us-central';
    const c = CLUSTERS.find((x) => x.name === sel) || CLUSTERS[0];
    head = `<h1 tabindex="-1">Choose a remote cluster</h1><p class="lede">From your kubeconfig (<span class="mono">~/.kube/config</span>). Pick a cluster your team gave you access to.</p>`;
    body = `
      <div class="radio-list" role="radiogroup" aria-label="Remote cluster" style="margin-top:22px">
        ${CLUSTERS.filter((x) => x.access).map((x) => `<button type="button" class="radio-card" role="radio" data-action="setup-cluster" data-cluster="${x.name}" aria-checked="${sel === x.name}"><span class="rc-dot"></span><span class="rc-main"><span class="rc-title">${x.name}</span><span class="rc-desc">${x.desc}</span></span><span class="rc-right">${versionBadge(x)}</span></button>`).join('')}
      </div>
      ${noAccessHTML()}
      ${c.compat ? '' : `<div class="callout warn" style="margin-top:12px">${icon('alert')}<div>${c.name} runs AX ${c.version}. Some tasks need AX 0.9 or later; preflight will tell you before anything runs.</div></div>`}
      ${otherConnectHTML(sel, 'setup')}
      <div class="setup-actions"><button class="btn primary lg" data-action="setup-connect-done">Connect to ${esc(sel)}${icon('arrowRight', 'sm')}</button><button class="btn ghost sm" data-action="setup-path" data-path="local">Set up this computer instead</button></div>`;
  } else {
    const cluster = s.path === 'cluster';
    /* Already set up by IT, or with ax setup in a terminal: Studio found the environment, so it opens here (CUJ 1). */
    const pre = !cluster && s.preinstalled ? s.preinstalled : null;
    mood = pre ? 'wave' : 'done';
    /* The templates you didn't pick first keep downloading; their status follows you to New task. */
    const pending = cluster ? [] : others.filter((a) => isDownloading(a.id));
    head = pre
      ? `<h1 tabindex="-1">Already set up: run your first agent</h1><p class="lede">${pre === 'it' ? 'Your IT team already set up AX on this Mac' : 'You already set up this Mac with <span class="mono">ax setup</span>'}, so there’s nothing to install. Your sandbox and Guardrails are running.</p>`
      : cluster
      ? `<h1 tabindex="-1">Connected: run your first agent</h1><p class="lede">Tasks run on ${esc(state.env.cluster)} with your organization's guardrails. You can set up this computer later from Where agents run.</p>`
      : byo
      ? `<h1 tabindex="-1">Ready: add your agent</h1><p class="lede">Your sandbox and Guardrails are running, and the agent runner is ready${pending.length ? `. ${esc(andList(pending.map((a) => a.name)))} keep downloading in the background` : ''}.</p>`
      : `<h1 tabindex="-1">Ready: run your first agent</h1><p class="lede">Your sandbox and Guardrails are running. The ${esc(A.name)} template is ready${pending.length ? `; ${esc(andList(pending.map((a) => a.name)))} ${pending.length > 1 ? 'are' : 'is'} still downloading in the background` : ''}.</p>`;
    const found = pre ? `<ul class="su-found" aria-label="Already on this Mac"><li>${icon('checkCircle', 'sm')}Secure sandbox running</li><li>${icon('checkCircle', 'sm')}Guardrails on: Balanced${pre === 'it' ? `, plus ${plural(state.orgBlocked.length, 'site')} your organization blocks` : ''}</li></ul>` : '';
    body = `
      ${found}
      <div class="tpl-wrap" style="margin-top:22px"><div class="tpl-grid">
        <div role="radiogroup" aria-label="Template">${prebuiltAgents().map((a) => { const busy = !cluster && a.id !== s.pick && isDownloading(a.id); return `<button type="button" class="choice" role="radio" aria-checked="${s.pick === a.id}" data-action="setup-pick" data-agent="${a.id}" ${busy ? 'aria-disabled="true"' : ''}><span class="c-check">${icon('check')}</span>${agentTile(a.id, 'lg')}<span><span class="c-title">${a.name}</span><span class="c-desc">${a.maker} · v${a.version}</span></span><span class="c-foot ${busy ? '' : 'ok'}">${busy ? `${icon('loader', 'xs spin')}${dlLabel(a.id)}` : `${icon('checkCircle', 'xs')}Ready`}</span></button>`; }).join('')}</div>
        <a class="choice byo-card${byo ? ' on' : ''}" href="#/new?find=byo${cluster ? '&env=cluster' : ''}" data-action="setup-find">${byo ? `<span class="c-check">${icon('check')}</span>` : ''}${byoTile('lg')}<span><span class="c-title">Your own agent</span><span class="c-desc">ADK, an image or a repo</span></span><span class="c-foot">${icon('plus', 'xs')}Add it next</span></a>
      </div></div>
      <p class="su-alt">Want a different template? <a class="link" href="#/new?find=browse${cluster ? '&env=cluster' : ''}" data-action="setup-find">Browse templates</a> from your team or the AX catalog.</p>
      <div class="su-now"><b>What happens next</b>${byo ? 'Add your agent from a folder, a container image or a Git repo. AX checks it, then you choose where it runs, set up its workspace, and describe the goal.' : 'Pick a template and sign in to it once, choose where it runs, set up its workspace, and describe the goal.'} Then run it, watch every step, and review every change before anything leaves the sandbox.</div>
      <div class="setup-actions">
        ${byo
          ? `<a class="btn primary lg" href="#/new?find=byo${cluster ? '&env=cluster' : ''}" data-action="setup-finish">Add your agent${icon('arrowRight', 'sm')}</a>`
          : `<a class="btn primary lg" href="#/new?agent=${s.pick}${cluster ? '&env=cluster' : ''}" data-action="setup-finish">Start my first task${icon('arrowRight', 'sm')}</a>`}
        <a class="btn lg" href="#/new?agent=${A.id}&sample=1${cluster ? '&env=cluster' : ''}" data-action="setup-finish">${icon('box', 'sm')}Try a sample project</a>
        <a class="btn ghost lg" href="#/" data-action="setup-finish">Go to Studio</a>
      </div>
      ${state.cuj === 1 ? `<div class="cuj-end"><span class="ce-copy"><b>End of CUJ 1.</b> ${pre ? `This computer was already set up ${pre === 'it' ? 'by your IT team' : 'with <span class="mono">ax setup</span>'}, so Studio opened on Ready. Try a fresh install, or go back to the overview.` : `${cluster ? 'You connected to a remote cluster.' : 'You set up this computer.'} Try the other path, or go back to the overview.`}</span><span class="btn-row"><button type="button" class="btn sm" data-action="cuj-path" data-path="${cluster || pre ? 'local' : 'cluster'}">${pre ? 'Try a fresh install' : cluster ? 'Try On this computer' : 'Try a remote cluster'}</button><a class="btn ghost sm" href="#/cuj/1">Overview</a></span></div>` : ''}`;
  }
  /* A steady step track sits at the top of every phase, so the content below never jumps; the card only animates in when the phase changes. */
  const stepIdx = s.phase === 'before' ? 0 : s.phase === 'ready' ? 2 : 1;
  const trackLabels = ['Choose where', s.path === 'cluster' ? 'Connect' : 'Install', 'Ready'];
  const track = `<ol class="su-track" aria-label="Setup progress">${trackLabels.map((l, k) => {
    const cls = k < stepIdx ? 'ok' : k === stepIdx ? (s.phase === 'failed' ? 'now fail' : 'now') : '';
    return `<li class="${cls}" ${k === stepIdx ? 'aria-current="step"' : ''}><span class="st-b">${k < stepIdx ? icon('check', 'xs') : k === stepIdx && s.phase === 'failed' ? icon('alert', 'xs') : k + 1}</span>${l}</li>`;
  }).join('')}</ol>`;
  const enter = s._shownPhase !== s.phase;
  s._shownPhase = s.phase;
  const html = `
    <div class="setup">
      <div class="setup-atmo" aria-hidden="true"></div>
      <header class="setup-top"><span class="brand" style="padding:0">${BRAND_MARK}<span class="brand-name">AX <span>Studio</span></span></span>${cujRibbonHTML()}
        <div class="btn-row"><button class="round-btn" id="theme-toggle" data-action="theme-toggle"></button>${s.phase !== 'ready' ? '<a class="btn ghost sm" href="#/" data-action="setup-skip">Skip for now</a>' : ''}</div></header>
      <main class="setup-main" id="main" tabindex="-1"><div class="setup-card ${enter ? 'view-enter' : ''}" data-phase="${s.phase}">
        ${track}
        <div class="su-head">${axo(mood, { decorative: true, id: 'setup-axo' }).replace('<svg ', '<svg data-follow ')}<div class="su-head-copy">${head}</div></div>
        <div class="su-body">${body}</div>
      </div></main>
      <footer class="setup-foot"><span>${icon('lock', 'xs')} Agents never see raw keys or files outside the sandbox copy you choose.</span></footer>
    </div>`;
  return { title: 'Set up AX Studio', full: true, html };
}
