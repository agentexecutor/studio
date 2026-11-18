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

/* AX Studio prototype — task page: journey, now/next, activity, changes, terminal (strict single-Axel discipline). */
'use strict';

function lastIndexOf(t, type) { for (let i = t.events.length - 1; i >= 0; i--) if (t.events[i].type === type) return i; return -1; }
function progressOf(t) { return t.status === 'done' ? 1 : (stageOf(t) + 0.5) / JOURNEY.length; }
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

/** The event that says what the agent is doing now (queued messages haven't reached it yet; sleep notes aren't work). */
function currentEvent(t) {
  for (let i = t.events.length - 1; i >= 0; i--) {
    const e = t.events[i];
    if ((e.type === 'user' && e.delivery === 'queued') || e.type === 'slept') continue;
    return e;
  }
  return null;
}

/** One-line, plain-language description of what an event means right now. */
function describeEvent(t, e, short) {
  const A = AGENTS[t.agent];
  if (!e) return 'Getting ready…';
  switch (e.type) {
    case 'thought': { const s = e.text.length > (short ? 80 : 120) ? e.text.slice(0, short ? 78 : 118) + '…' : e.text; return `Thinking: “${esc(s)}”`; }
    case 'tool': return `${cap(esc(e.title))}: <span class="mono">${esc(e.cmd.length > 54 ? e.cmd.slice(0, 52) + '…' : e.cmd)}</span>`;
    case 'edit': { const p = e.paths || []; return `Changed ${plural(p.length, 'file')}: <span class="mono">${esc(p[0] || '')}</span>${p.length > 1 ? ` +${p.length - 1} more` : ''}`; }
    case 'user': return e.answerTo ? 'Reading your answer' : 'Reading your message';
    case 'handoff': return `Picking up from ${AGENTS[e.fromAgent].name}`;
    case 'moved': return `Starting fresh on <span class="mono">${esc(e.cluster)}</span>`;
    case 'resumed': return 'Back at it';
    case 'stopped': return 'Stopped by you';
    case 'applied': return `Applied ${plural((e.paths || []).length, 'file')} to your folder`;
    case 'pr': return `Opened pull request #${e.number}`;
    case 'blocked': return `Waiting on you: <span class="mono">${esc(e.domain)}</span>`;
    case 'question': return 'Waiting for your answer';
    case 'permission': return e.resolved ? `${A.name} is working…` : `Waiting for your OK: <span class="mono">${esc(e.cmd)}</span>`;
    case 'budget': return e.resolved ? `${A.name} is working…` : `Waiting for you: reached the $${e.budget.toFixed(2)} check-in`;
    case 'workspace': return e.failed ? "Couldn't finish setting up the workspace" : `Workspace ready · ${esc(e.secs)} s`;
    case 'done': return esc(e.text);
    case 'fail': return esc(e.title);
    default: return `${A.name} is working…`;
  }
}

/* ---------- "Why was this blocked?" plain-language explainer ---------- */
function whyBlockedHTML(t, e) {
  const layer = e.policy
    ? 'Organization guardrail (VPC perimeter & Model Armor)'
    : `Workspace allowlist (${(GUARDRAIL_PRESETS[state.guardrailPreset] || GUARDRAIL_PRESETS.balanced).name} preset for ${t.repo})`;
  const cmd = e.cmd || `HTTPS connect → ${e.domain}:443`;
  return `<details class="disclosure why-disc"><summary>${icon('chevRight', 'xs chev')}Why was this blocked?</summary>
    <div class="disclosure-body"><dl class="kv xsmall">
      <dt>Attempted</dt><dd class="mono">${esc(cmd)}</dd>
      ${e.purpose ? `<dt>Reason given</dt><dd>${esc(e.purpose)}</dd>` : ''}
      <dt>Stopped by</dt><dd>${esc(layer)}</dd>
      <dt>Key check</dt><dd style="color:var(--done)">0 secrets left the sandbox (stopped before egress)</dd>
    </dl></div></details>`;
}

/* ---------- Next step (top of the right column, on every tab) ----------
   One card that says what needs you, or what happens next, for the task's state right now. It replaces the old
   full-width Now | Next band. What the agent is doing at this moment already shows in Activity (the newest entry and
   the "is working" line) and in the journey, so the band's "Now" half was a repeat. The few facts it carried that
   matter (the question being asked, the site that was blocked, what failed) are this card's headline instead.
   It updates live with every agent event (stage, changed files, a queued message, setup progress, downloads). */
function lowerFirst(s) { return s ? s.charAt(0).toLowerCase() + s.slice(1) : s; }
/** What happens next while the agent works, from the journey stage (forward-looking, not a repeat of Activity). */
function runningNext(t) {
  const A = AGENTS[t.agent], files = plural(filesFor(t).length, 'changed file');
  switch (stageOf(t)) {
    case 0: return `Next, ${A.name} reads the code and makes a plan.`;
    case 1: return `Next, ${A.name} edits a sandbox copy of ${esc(t.repo)}. ${t.noMidTurn ? 'Messages you send wait for its next turn.' : 'You can steer it anytime.'}`;
    case 2: return `Next, ${A.name} runs the tests. Then you review ${files}.`;
    default: return `When ${A.name} finishes, you review ${files}. Nothing leaves the sandbox until you say so.`;
  }
}
function taskTab(t) {
  const r = state.route;
  return r && r.parts[0] === 'task' && r.parts[1] === t.id ? (r.parts[2] || 'activity') : 'activity';
}
function nextStepHTML(t, tab) {
  tab = tab || taskTab(t);
  const A = AGENTS[t.agent];
  const files = filesFor(t);
  let tone = 'calm', k = 'Next', title = '', body = '', quote = '', btns = '';
  const steer = (label, ic) => `<button class="btn ghost sm" data-action="focus-steer" data-task="${t.id}">${ic ? icon(ic, 'sm') : ''}${label}</button>`;
  switch (t.status) {
    case 'starting':
      if (t.queued) {
        const ahead = queuedAhead(t), using = state.tasks.filter((x) => x.env === 'local' && resourceFor(x).on).length;
        tone = 'paused'; k = 'Next';
        title = 'Waiting for room on this computer';
        body = `${plural(using, 'task is', 'tasks are')} using ${localMemInUse(t)} of the ${LOCAL_MEM_GB} GB set aside for sandboxes. ${ahead ? `${ahead} ahead of this one. ` : ''}It starts on its own when a task finishes or you pause one.`;
        btns = `<button class="btn sm" data-action="promote" data-task="${t.id}">${icon('cloudUp', 'sm')}Run on a remote cluster</button>${otherLocalRunning(t).length ? `<button class="btn ghost sm" data-action="fix" data-fix="pause-others" data-code="queued" data-task="${t.id}">${icon('pause', 'sm')}Pause ${plural(otherLocalRunning(t).length, 'other task')}</button>` : ''}`;
        break;
      }
      if (t.hydrate) {
        const h = t.hydrate, s = h.steps[Math.min(h.i, h.steps.length - 1)];
        if (s.dl && isDownloading(t.agent)) {
          title = `Downloading the ${A.name} template`;
          body = `<span data-dl="${t.agent}">${dlPct(t.agent)}%</span> · about <span data-dl-secs="${t.agent}">${dlSecsLeft(t.agent)}</span> s left. Then AX sets up the workspace.`;
        } else {
          title = h.title || 'Setting up the workspace';
          body = `${A.name} starts as soon as it's ready · ${Math.min(h.i, h.steps.length)} of ${h.steps.length} done.`;
        }
      } else { title = `Starting ${A.name}`; body = 'Preparing a sandbox copy. Your folder stays untouched.'; }
      break;
    case 'stopping':
      title = 'Finishing the current turn';
      body = 'The next agent starts right after, so no work is lost.';
      break;
    case 'running':
      /* CUJ 3: "The laptop sleeps mid-turn" → "Paused while your computer slept" → resumes automatically on wake. */
      if (asleepHeld(t)) {
        tone = 'paused'; title = 'Paused while your computer slept';
        body = `${A.name} resumes automatically when your computer wakes. Nothing is lost. For long runs, a remote cluster keeps going with your laptop closed.`;
        btns = `<button class="btn sm" data-action="promote" data-task="${t.id}">${icon('cloudUp', 'sm')}Run on a remote cluster</button>`;
        break;
      }
      title = 'Nothing needs you right now';
      body = runningNext(t);
      if (t.events.some((e) => e.type === 'user' && e.delivery === 'queued')) body = `Your message is queued for the next turn. ${A.name} reads it when it finishes its current step. ${body}`;
      btns = `<button class="btn sm" data-action="pause" data-task="${t.id}">${icon('pause', 'sm')}Pause</button><button class="btn ghost sm" data-action="stop" data-task="${t.id}" title="ax stop ${t.id} · changes are kept">${icon('stop', 'sm')}Stop</button>${steer('Redirect', 'message')}`;
      break;
    case 'blocked': {
      const b = openBlock(t);
      tone = 'attn'; k = 'Your next step';
      title = `Allow <span class="mono">${esc(b ? b.e.domain : 'this site')}</span>?`;
      body = `${A.name} wants to ${b && b.e.purpose ? esc(lowerFirst(b.e.purpose)) : 'reach it'}. It isn't on this workspace's allowlist. Either way, the agent carries on.`;
      if (b) btns = `<button class="btn primary sm" data-action="allow" data-task="${t.id}" data-ev="${b.i}" data-eid="${evId(b.e)}">${icon('check', 'sm')}Allow for ${esc(t.repo)}</button><button class="btn sm" data-action="allow-once" data-task="${t.id}" data-ev="${b.i}" data-eid="${evId(b.e)}">Allow once</button><button class="btn ghost sm" data-action="deny" data-task="${t.id}" data-ev="${b.i}" data-eid="${evId(b.e)}">Keep blocked</button>`;
      break;
    }
    case 'waiting':
      if (t.needs && t.needs.type === 'question') {
        const q = openQuestion(t);
        tone = 'attn'; k = 'Your next step';
        title = `Answer ${A.name}`;
        quote = `<blockquote class="ns-quote">${esc(q ? q.e.text : '')}</blockquote>`;
        btns = (q && q.e.options ? q.e.options : []).map((o, i) => `<button class="btn sm ${i ? '' : 'primary'}" data-action="answer" data-task="${t.id}" data-text="${esc(o)}">${esc(o)}</button>`).join('') + steer('Reply in your own words…');
      } else if (t.needs && t.needs.type === 'permission') {
        /* "Ask before risky commands" is on, so the agent stopped before a risky command inside its sandbox. */
        const p = openPermission(t);
        tone = 'attn'; k = 'Your next step';
        title = `Let ${A.name} run <span class="mono">${esc(p ? p.e.cmd : 'this command')}</span>?`;
        body = `${p ? esc(p.e.why) + ' ' : ''}Only its sandbox copy changes; your folder is untouched either way.`;
        if (p) btns = `<button class="btn primary sm" data-action="perm-once" data-task="${t.id}" data-ev="${p.i}" data-eid="${evId(p.e)}">${icon('check', 'sm')}Allow once</button><button class="btn sm" data-action="perm-task" data-task="${t.id}" data-ev="${p.i}" data-eid="${evId(p.e)}">Allow for this task</button><button class="btn ghost sm" data-action="perm-deny" data-task="${t.id}" data-ev="${p.i}" data-eid="${evId(p.e)}">Don't allow</button>`;
      } else if (t.needs && t.needs.type === 'budget') {
        const b = openBudget(t), amt = b ? b.e.budget : budgetFor(t);
        tone = 'attn'; k = 'Your next step';
        title = `Keep going past $${amt.toFixed(2)}?`;
        body = `${A.name} has used about $${costFor(t).toFixed(2)}, the check-in you set for this task. It's waiting at the end of its turn. ${files.length ? `${plural(files.length, 'changed file')} so far ${files.length === 1 ? 'is' : 'are'} kept either way.` : 'Nothing is lost either way.'}`;
        btns = `<button class="btn primary sm" data-action="budget-raise" data-task="${t.id}">${icon('play', 'sm')}Keep going to $${(amt + BUDGET_STEP).toFixed(2)}</button><button class="btn sm" data-action="budget-stop" data-task="${t.id}">${icon('stop', 'sm')}Stop task</button>`;
      } else if (t.handoffFailed) {
        const kid = t.failedChild && getTask(t.failedChild);
        tone = 'attn'; k = 'Your next step';
        title = `${kid ? AGENTS[kid.agent].name : 'The next agent'} couldn't start`;
        body = `${A.name} is paused, and this workspace is untouched. Resume, or try another agent.`;
        btns = `<button class="btn primary sm" data-action="resume" data-task="${t.id}">${icon('play', 'sm')}Resume with ${A.name}</button><button class="btn sm" data-action="handoff" data-task="${t.id}">${icon('handoff', 'sm')}Try another agent</button>${kid ? `<a class="btn ghost sm" href="#/task/${kid.id}">See what happened ${icon('arrowRight', 'sm')}</a>` : ''}`;
      } else {
        tone = 'paused'; k = 'Your next step';
        title = 'Paused by you';
        body = `Nothing is running. ${A.name} picks up right where it stopped. Or stop the task and keep its changes.`;
        btns = `<button class="btn primary sm" data-action="resume" data-task="${t.id}">${icon('play', 'sm')}Resume</button><button class="btn sm" data-action="stop" data-task="${t.id}" title="ax stop ${t.id}">${icon('stop', 'sm')}Stop task</button>`;
      }
      break;
    case 'failed': {
      const fi = failInfo(t);
      tone = 'fail'; k = 'Your next step';
      title = esc(fi.title);
      body = esc(fi.fix);
      btns = failActionsHTML(fi.code, fi.ctx, 2);
      break;
    }
    case 'done': {
      /* Ship actions (Apply, Push, Open pull request) live once, under the diff in Changes, so on Changes this card
         only says what to do there; elsewhere it links to it. A compared task picks its run in the banner above. */
      const onChanges = tab === 'changes';
      const kid = handedOff(t) ? getTask(t.child) : null;
      if (kid) {
        /* CUJ 4: only one agent is active at a time, and the workspace moved with the handoff. */
        title = `Continued by ${AGENTS[kid.agent].name}`;
        body = `${AGENTS[kid.agent].name} picked up this workspace, with every change. Review and ship from the current task. This Activity is kept for reference.`;
        /* Take it back: the same handoff in the other direction, from whichever task holds the workspace now. */
        const cur = currentOf(t), canTake = cur && cur !== t && cur.agent !== t.agent && cur.status !== 'failed';
        if (canTake) body += ` Or take it back: ${AGENTS[cur.agent].name} ${ACTIVE.includes(cur.status) ? 'stops at the end of its turn' : 'hands the workspace over'}, and ${A.name} continues in a new task.`;
        btns = `<a class="btn sm" href="#/task/${(cur || kid).id}">Open the current task ${icon('arrowRight', 'sm')}</a>${canTake ? `<button class="btn ghost sm" data-action="take-back" data-task="${t.id}" title="ax handoff ${cur.id} --to ${A.cli}">${icon('handoff', 'sm')}Take back with ${A.name}</button>` : ''}`;
      } else if (t.notKept) {
        title = 'Not kept';
        body = 'You kept the other run instead. Restore this one from the banner above for the next 7 days.';
      } else if (t.pushed) {
        tone = 'done'; title = `Shipped to <span class="mono">${esc(t.branch)}</span>`;
        if (t.pr) {
          body = `Pull request #${t.pr.number} is open on GitHub. Review and merge it there.`;
          btns = `<a class="btn sm" href="${esc(t.pr.url)}" target="_blank" rel="noopener">${icon('arrowUpRight', 'sm')}Open pull request #${t.pr.number}</a>`;
        } else {
          body = 'Open a pull request when you\'re ready, or continue with another agent.';
          if (!onChanges) btns = `<a class="btn sm" href="#/task/${t.id}/changes">${icon('pr', 'sm')}Open pull request…</a>`;
        }
      } else if (t.applied && t.applied.paths.length) {
        const ap = t.applied.paths.length, kf = keptFiles(t).length, clash = conflictFiles(t).filter((p) => !t.applied.paths.includes(p)).length;
        tone = 'done'; k = appliedAll(t) ? 'Next' : 'Your next step';
        title = appliedAll(t) ? `Applied to <span class="mono">${esc(t.folder)}</span>` : `Applied ${ap} of ${plural(kf, 'file')}`;
        body = appliedAll(t) ? 'Every file you kept is in your folder. Push a branch when you want to share it.'
          : clash ? `${plural(clash, 'file conflicts', 'files conflict')} with changes in your folder and ${clash === 1 ? 'stays' : 'stay'} in the sandbox. Push a branch to merge ${clash === 1 ? 'it' : 'them'}.`
            : `${kf - ap} more ${kf - ap === 1 ? 'file is' : 'files are'} still only in the sandbox.`;
        if (!onChanges) btns = `<a class="btn sm${appliedAll(t) ? '' : ' primary'}" href="#/task/${t.id}/changes">${appliedAll(t) ? 'Open Changes' : 'Review the rest'} ${icon('arrowRight', 'sm')}</a>`;
      } else if (t.stopped) {
        /* Stopped for good (ax stop). The changes are kept; a message starts a new turn in the same sandbox. */
        k = files.length ? 'Your next step' : 'Next';
        title = 'Stopped by you';
        body = files.length ? `${plural(files.length, 'changed file')} ${files.length === 1 ? 'is' : 'are'} kept in the sandbox. Review them, or send a message to start a new turn.` : 'Nothing was changed. Send a message to start a new turn.';
        btns = `${files.length && !onChanges ? `<a class="btn primary sm" href="#/task/${t.id}/changes">Review changes ${icon('arrowRight', 'sm')}</a>` : ''}${steer('Send a message', 'message')}`;
      } else if (files.length) {
        tone = 'done'; k = 'Your next step';
        const compared = t.altRun || t.compareWith;
        title = compared ? 'Compare the 2 runs, then keep one' : `Review ${plural(files.length, 'changed file')}`;
        body = compared ? 'Pick the run to keep in the comparison above, then push a branch.'
          : onChanges ? 'Keep or discard each file, then push a branch. Your folder is untouched until then.'
            : 'Keep or discard each file, then push a branch. Nothing leaves the sandbox until you do.';
        if (!onChanges && !compared) btns = `<a class="btn primary sm" href="#/task/${t.id}/changes">Review changes ${icon('arrowRight', 'sm')}</a>`;
      } else {
        title = 'Finished with no changes';
        body = `Ask ${A.name} for a follow-up, or continue with another agent.`;
        btns = steer('Ask for a follow-up', 'message');
      }
      break;
    }
    default: break;
  }
  /* Axel lives here on the task page (v12; he used to ride the progress track): the one Axel on the page, in the sticky
     column, his mood matching the task. He's decorative; the card's words say what's going on. */
  return `<section class="card card-pad next-card s-${tone}" id="next-step" data-tone="${tone}" aria-labelledby="ns-k">
    <span class="ns-axel" aria-hidden="true">${axo(axoStateFor(t), { decorative: true, cls: 'axo-ns' }).replace('<svg ', '<svg data-follow ')}</span>
    <h2 class="panel-title" id="ns-k">${tone === 'attn' || tone === 'fail' ? '<span class="ns-dot" aria-hidden="true"></span>' : ''}${k}</h2>
    <p class="ns-title">${title}</p>${body ? `<p class="ns-body">${body}</p>` : ''}${quote}
    ${btns ? `<div class="ns-actions">${btns}</div>` : ''}
  </section>`;
}
/* ---------- Attention on the task tabs ----------
   When something on a tab needs you, and you're on a different tab, that tab gets a dot: amber for a decision (a
   question, a blocked site, a handoff that didn't start), red for a failure, and the key colour on Changes when
   finished work is waiting for review. The dot hides on the tab you're on. */
function tabAttnOf(t, k, tab) {
  if (k === tab) return null;
  if (k === 'activity') {
    if (t.status === 'failed') return { kind: 'fail', sr: 'failed, see what to do' };
    if (t.status === 'blocked') return { kind: 'attn', sr: 'needs your decision' };
    if (t.status === 'waiting' && t.needs && t.needs.type === 'question') return { kind: 'attn', sr: 'needs your answer' };
    if (t.status === 'waiting' && t.needs && t.needs.type === 'permission') return { kind: 'attn', sr: 'needs your OK' };
    if (t.status === 'waiting' && t.needs && t.needs.type === 'budget') return { kind: 'attn', sr: 'reached its budget check-in' };
    if (t.status === 'waiting' && t.handoffFailed) return { kind: 'attn', sr: 'needs your decision' };
    return null;
  }
  if (k === 'changes') {
    const files = filesFor(t);
    const sel = state.diffSel[t.id];
    const unseen = files.some((f) => !(sel && sel.seen && sel.seen[f.path]));
    if (t.status === 'done' && files.length && !t.pushed && !t.notKept && !handedOff(t) && unseen) return { kind: 'review', sr: 'ready for your review' };
  }
  return null;
}
function tabAttnHTML(a, pop) {
  return a ? `<span class="tab-attn ${a.kind}${pop ? ' pop' : ''}" data-kind="${a.kind}" aria-hidden="true"></span><span class="sr-only sr-attn">, ${a.sr}</span>` : '';
}

/* ---------- Header & side ---------- */
function compareBannerHTML(t) {
  const sib = t.compareWith && getTask(t.compareWith);
  if (!t.altRun && !sib) return '';
  const other = AGENTS[sib ? sib.agent : t.altRun.agent];
  const d1 = totalDiff(filesFor(t));
  const d2 = totalDiff(sib ? filesFor(sib) : t.altRun.files);
  const otherNotKept = sib ? sib.notKept : t.altRun.notKept;
  if (t.notKept) {
    return `<div class="cmp-banner muted-banner">
      <span class="cb-ic">${icon('undo', 'sm')}</span>
      <div class="cb-body"><strong>Not kept.</strong> You kept ${other.name}'s run instead. This sandbox is kept for 7 days, then cleaned up.</div>
      <button class="btn sm" data-action="restore-run" data-task="${t.id}">${icon('undo', 'sm')}Restore</button>
      ${sib ? `<a class="btn ghost sm" href="#/task/${sib.id}/changes">Open ${other.name}'s run ${icon('arrowRight', 'xs')}</a>` : ''}
    </div>`;
  }
  if (otherNotKept || t.keptRun) {
    return `<div class="cmp-banner kept">
      <span class="cb-ic">${icon('award', 'sm')}</span>
      <div class="cb-body"><strong>You kept ${AGENTS[t.agent].name}'s run.</strong> ${other.name}'s run is marked not kept (restorable for 7 days, resources freed).</div>
      <button class="btn ghost sm" data-action="compare" data-task="${t.id}">${icon('compare', 'sm')}View comparison</button>
    </div>`;
  }
  return `<div class="cmp-banner">
    <span class="cb-ic">${icon('compare', 'sm')}</span>
    <div class="cb-body"><strong>Isolated comparison:</strong> ${AGENTS[t.agent].name} (<span class="mono">+${d1.add}/−${d1.del}</span>) vs ${other.name} (<span class="mono">+${d2.add}/−${d2.del}</span>) in separate sandboxes. Pick the one to keep.</div>
    <button class="btn sm" data-action="compare" data-task="${t.id}">${icon('compare', 'sm')}Compare side by side</button>
    ${sib ? `<a class="btn ghost sm" href="#/task/${sib.id}">Open ${other.name} ${icon('arrowRight', 'xs')}</a>` : ''}
  </div>`;
}

function taskHeadHTML(t) {
  const A = AGENTS[t.agent];
  const parent = t.parent && getTask(t.parent);
  const child = t.child && getTask(t.child);
  /* Task-level actions only. Pause, Resume, Retry, Allow and Answer live in "Your next step", never twice. */
  let actions = '';
  if (!handedOff(t)) actions += `<button class="btn" data-action="compare" data-task="${t.id}" title="Run or inspect a parallel agent in an isolated sandbox">${t.altRun || t.compareWith ? 'Compare runs' : 'Compare…'}</button>`;
  if (!handedOff(t)) actions += `<button class="btn" data-action="handoff" data-task="${t.id}">Continue with…</button>`;
  actions += `<button class="btn ghost" data-action="manifest" data-task="${t.id}" title="ax export ${t.id}">Export YAML</button>`;
  return `
    ${parent ? `<div class="lineage-crumb">${icon('handoff', 'sm')}Continued from <a href="#/task/${parent.id}">${esc(parent.title)}</a> · ${AGENTS[parent.agent].name}</div>` : ''}
    <div class="task-head">
      <div class="th-main">
        <h1 tabindex="-1" id="task-title">${esc(t.title)}</h1><button type="button" class="skip-inline" data-action="focus-next">Skip to Your next step</button>
        <div class="th-meta">
          ${chip(t.status, t)}${t.notKept ? `<span class="chip">${icon('undo')}Not kept</span>` : ''}
          <span class="th-progress" id="th-progress">${journeyHTML(t)}</span>
          <span class="env">${agentTile(t.agent, 'sm')}${A.name} <span class="muted xsmall">${esc(t.version ? 'v' + t.version : agentVersionLabel(A))}${modelName(t) ? ` · ${esc(modelName(t))}` : ''}</span></span>
          <span class="env mono">${icon('branch')}${esc(t.repo)} · ${esc(t.branch)}</span>
          <span class="env">${icon('clock')}${t.status === 'done' ? 'Finished ' + since(t.finishedAt || now(), 'ago') : since(t.startedAt, 'elapsed')}</span>
          ${child ? `<span class="small muted">Continued by <a href="#/task/${child.id}">${AGENTS[child.agent].name}</a></span>` : ''}
        </div>
      </div>
      <div class="btn-row">${actions}</div>
    </div>
    ${compareBannerHTML(t)}`;
}
/** The task's status and progress for the top bar. It replaces the breadcrumb once the header's status and progress
    scroll under the top bar, so where the task is stays visible while you read Activity or Changes (the Next step card
    in the sticky right column covers what needs you). Chrome never shows Axel; the track is the same mini track as the
    header and the Home rows. */
function topbarTaskHTML(t) {
  return `${chip(t.status, t)}<button type="button" class="tb-title" data-action="task-top" title="Back to the top">${esc(t.title)}</button>${journeyHTML(t)}`;
}
function sparkFor(t) {
  if (!t.spark) {
    const n = 10, out = [];
    for (let k = 1; k <= n; k++) out.push(Math.round(t.tokens * Math.pow(k / n, 1.3)));
    t.spark = t.tokens ? out : [0, 0];
  }
  return t.spark;
}
function taskSideHTML(t, tab) {
  const A = AGENTS[t.agent];
  const reach = reachFor(t).filter((a) => a.scope !== 'org').map((a) => a.domain);
  const blocked = state.blockedLog.filter((b) => b.task === t.id);
  const cost = costFor(t), budget = budgetFor(t);
  const onCluster = t.env === 'cluster';
  const from = t.parent && getTask(t.parent);
  const preset = GUARDRAIL_PRESETS[t.preset || state.guardrailPreset] || GUARDRAIL_PRESETS.balanced;
  return `
    ${nextStepHTML(t, tab)}
    <div class="card card-pad">
      <h2 class="panel-title">Where it runs</h2>
      <div class="where"><div><b>${t.env === 'cluster' ? 'On a remote cluster' : 'On this computer'}</b><span>${t.env === 'cluster' ? `${esc(t.cluster)} · keeps running with your laptop closed` : 'Isolated sandbox copy · your folder is untouched'}</span></div></div>
      <div class="res-usage" id="res-usage" aria-label="CPU and memory this task is using">${resourceHTML(t)}</div>
      <details class="disclosure" style="margin-top:10px"><summary>${icon('chevRight', 'sm chev')}Show details</summary>
        <div class="disclosure-body"><dl class="kv">
          <dt>Sandbox</dt><dd>${onCluster ? `Isolated sandbox on ${esc(t.cluster)}` : 'microVM, own filesystem'}</dd>
          <dt>Harness</dt><dd class="mono" style="font-size:12px">${esc(agentImage(A, t.pin ? t.pin !== 'latest' : undefined))}</dd>
          <dt>Task runner</dt><dd class="mono" style="font-size:12px" title="Default task runner, maintained by AX">${esc(runnerImage())}</dd>
          ${modelName(t) ? `<dt>Model</dt><dd>${esc(modelName(t))}</dd>` : ''}
          <dt>Resources</dt><dd>${{ small: '1 CPU · 2 GB', large: '4 CPU · 8 GB' }[t.size] || '2 CPU · 4 GB'}</dd>
          <dt>Workspace</dt><dd class="mono" style="font-size:12px">/workspace (copy of ${esc(t.repo)})</dd>${from ? `
          <dt>Starts from</dt><dd>${AGENTS[from.agent].name}'s workspace (handoff)</dd>` : ''}
          <dt class="infra">Runtime</dt><dd class="infra mono" style="font-size:12px">${t.env === 'cluster' ? 'GKE · Agent Substrate' : 'microVM · k3s v1.30'}</dd>
          <dt class="infra">Pod</dt><dd class="infra mono" style="font-size:12px">ax-${t.id}-7f9c4</dd>
        </dl></div></details>
      ${t.env === 'local' && t.status !== 'failed' && !handedOff(t) && !t.notKept && !t.queued ? `<button class="btn sm" style="margin-top:12px;width:100%" data-action="promote" data-task="${t.id}">${icon('cloudUp', 'sm')}${t.status === 'done' ? 'Run again on a remote cluster' : 'Run on a remote cluster'}</button>` : ''}
    </div>
    <div class="card card-pad">
      <h2 class="panel-title">What it can reach · ${esc(preset.name)}</h2>
      <ul class="rail-list">
        <li>${icon('folder', 'sm')}Only its sandbox copy of ${esc(t.repo)}</li>
        <li>${icon('key', 'sm')}${onCluster ? "Keys come from your organization's vault" : `${credLabel(A)}, added outbound`}</li>
        <li>${icon('hand', 'sm')}${onCluster ? "Unknown sites are blocked by your organization's policy" : 'Unknown sites ask you first'}</li>${onCluster ? `
        <li>${icon('shield', 'sm')}Organization guardrails apply: VPC perimeter, Model Armor DLP</li>` : ''}
        <li>${icon('terminal', 'sm')}Inside the sandbox: ${state.permMode === 'ask' ? 'asks before risky commands' : 'runs without asking'}</li>
      </ul>
      <a class="link" href="#/guardrails" style="display:inline-flex;align-items:center;gap:4px;margin-top:12px">Manage guardrails ${icon('chevRight', 'xs')}</a>
    </div>
    <div class="card card-pad">
      <h2 class="panel-title">Usage</h2>
      <div class="usage-row"><div id="usage-ring">${ring(Math.min(1, cost / budget), '$' + cost.toFixed(2), 'of $' + budget, cost / budget > 0.8 ? 'var(--coral)' : 'var(--key)')}</div>
        <div style="min-width:0;flex:1"><div style="font-weight:600" id="usage-tokens">${fmtTokens(t.tokens)} tokens</div><div class="xsmall muted">${onCluster ? `Estimated. Your organization caps each task at $${budget.toFixed(2)}.` : `Estimated. AX checks in with you at $${budget.toFixed(2)}.`}</div><div id="usage-spark" style="margin-top:6px">${sparkline(sparkFor(t), 160, 34)}</div></div></div>
    </div>
`;
}
/** What AX is setting up right now, from the task's workspace setup. */
function hydrateNowText(t) {
  const h = t.hydrate;
  const s = h.steps[Math.min(h.i, h.steps.length - 1)];
  if (s.dl && isDownloading(t.agent)) return `Downloading the ${esc(AGENTS[t.agent].name)} template · <span data-dl="${t.agent}">${dlPct(t.agent)}%</span>`;
  return `${h.cluster ? 'Rebuilding the workspace' : 'Setting up the workspace'}: ${esc(s.now.charAt(0).toLowerCase() + s.now.slice(1))}…`;
}
/** The workspace filling in, step by step, before the agent's first turn. It becomes one Activity entry. */
function hydrateHTML(t) {
  const h = t.hydrate, A = AGENTS[t.agent];
  const rows = h.steps.map((s, k) => {
    const done = k < h.i, cur = k === h.i;
    const waiting = cur && s.dl && isDownloading(t.agent);
    const cls = done ? 'ok' : cur ? 'pending' : 'idle';
    const ic = done ? 'check' : cur ? 'loader' : (s.ic || 'clock');
    const title = done ? s.t : cur ? (waiting ? `Downloading the ${A.name} template` : `${s.now}…`) : s.todo;
    const desc = waiting
      ? `<span data-dl="${t.agent}">${dlPct(t.agent)}%</span> · about <span data-dl-secs="${t.agent}">${dlSecsLeft(t.agent)}</span> s left`
      : done || cur ? esc(s.s || '') : '';
    return `<li class="check-item ${cls}"><span class="ci-icon">${icon(ic)}</span><div style="min-width:0"><div class="ci-title">${esc(title)}</div>${desc ? `<div class="ci-desc">${desc}</div>` : ''}</div></li>`;
  }).join('');
  return `<div class="card card-pad hydrate" aria-busy="true">
    <div class="hy-head"><span class="nn-icon running">${icon('loader', 'spin')}</span><div style="flex:1;min-width:0"><div class="hy-title">${esc(h.title || 'Setting up the workspace')}</div><div class="xsmall muted">${esc(h.sub || `From your workspace setup. ${A.name} starts as soon as it's ready.`)}</div></div><span class="hy-count tnum">${Math.min(h.i, h.steps.length)} of ${h.steps.length}</span></div>
    <ul class="check-list hy-list">${rows}</ul>
  </div>`;
}
function workingHTML(t) {
  if (t.queued) return `<div class="card card-pad" style="margin-bottom:16px;display:flex;gap:14px;align-items:center;background:var(--bg-subtle)"><span class="nn-icon">${icon('clock')}</span><div style="flex:1"><div style="font-weight:600">Queued · waiting for room on this computer</div><div class="small muted" style="margin-top:4px">${AGENTS[t.agent].name} starts on its own when a task finishes or you pause one.</div></div></div>`;
  if (t.status === 'starting' && t.hydrate) return hydrateHTML(t);
  if (t.status === 'starting') {
    return `<div class="card card-pad" style="margin-bottom:16px;display:flex;gap:14px;align-items:center;background:var(--bg-subtle)" aria-busy="true">
      <span class="nn-icon running">${icon('loader', 'spin')}</span>
      <div style="flex:1"><div style="font-weight:600">Preparing an isolated sandbox for ${AGENTS[t.agent].name}…</div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:10px"><div class="skeleton" style="height:8px;width:72%"></div><div class="skeleton" style="height:8px;width:52%"></div></div></div></div>`;
  }
  if (asleepHeld(t)) return '';   /* nothing is working while the computer sleeps; Now says so */
  if (t.status === 'running') return `<div class="working" aria-hidden="true"><span class="dots"><i></i><i></i><i></i></span>${AGENTS[t.agent].name} is working · ${since(t.startedAt, 'elapsed')}</div>`;
  return '';
}

/* ---------- Task view ---------- */
function viewTask(id, tab) {
  const t = getTask(id);
  if (!t) return viewNotFound();
  const files = filesFor(t);
  tab = ['activity', 'changes', 'terminal', 'log'].includes(tab) ? tab : 'activity';
  const tabs = [['activity', 'Activity'], ['changes', 'Changes', files.length], ['terminal', 'Terminal'], ['log', 'Log']];
  const panel = tab === 'activity' ? activityPanelHTML(t) : tab === 'changes' ? changesPanelHTML(t) : tab === 'log' ? logPanelHTML(t) : terminalPanelHTML(t);
  /* One standard layout for every tab: same header (title, status and where the task is), same two columns (the next
     step tops the right one), same panel floor. Switching tabs only swaps the panel, so nothing above or beside it moves.
     v12: no progress track under the header; the header's mini track carries the stage. */
  const html = `
    <div id="task-head">${taskHeadHTML(t)}</div>
    <div class="task-grid">
      <div style="min-width:0">
        <!-- One bar: the tabs on the left; the event count and Export trajectory on the right (the same on every tab, so nothing moves). -->
        <div class="tabs-bar">
          <div class="seg task-tabs" role="tablist" aria-label="Task views">
            ${tabs.map(([k, l, n]) => `<a role="tab" id="tab-${k}" href="#/task/${t.id}${k === 'activity' ? '' : '/' + k}" aria-selected="${tab === k}"${tab === k ? ` aria-controls="panel-${k}"` : ''} tabindex="${tab === k ? 0 : -1}">${l}${n ? `<span class="count" id="count-${k}">${n}</span>` : ''}${tabAttnHTML(tabAttnOf(t, k, tab))}</a>`).join('')}
          </div>
          <div class="tabs-tools" id="task-tools">
            <span class="xsmall muted tt-meta"><span id="act-count">${plural(t.events.length, 'event')}</span> · stored ${t.env === 'cluster' ? `on ${esc(t.cluster)}` : 'on this computer'}</span>
            <button class="btn ghost sm" data-action="export-oatr" data-task="${t.id}" title="ax logs ${t.id} --oatr > ${t.id}.oatr.json">${icon('download', 'sm')}Export trajectory (OATR)</button>
          </div>
        </div>
        <div role="tabpanel" class="task-panel" id="panel-${tab}" aria-labelledby="tab-${tab}" tabindex="0">${panel}</div>
      </div>
      <aside class="side" id="task-side" aria-label="Task details">${taskSideHTML(t, tab)}</aside>
    </div>`;
  return {
    title: t.title, crumbs: [{ label: 'Home', href: '#/' }, { label: t.title }], html,
    after: () => {
      if (tab === 'terminal') { const b = $('#term-body'); if (b) b.scrollTop = b.scrollHeight; }
      else if (tab === 'log') { const p = $('#raw-log'); if (p) p.scrollTop = p.scrollHeight; }
    },
  };
}

/* ---------- Activity ---------- */
function activityPanelHTML(t) {
  const A = AGENTS[t.agent];
  /* Only one agent works in a workspace at a time, so a handed-off task takes no more messages. */
  const kid = handedOff(t) ? getTask(t.child) : null;
  const disabled = t.status === 'failed' || !!kid;
  const ph = kid ? `This task continues with ${AGENTS[kid.agent].name}` : t.status === 'done' ? `Ask ${A.name} for a follow-up…` : t.status === 'failed' ? 'Fix the problem above to continue' : `Tell ${A.name} what to change or focus on…`;
  return `
    <h2 class="sr-only">Activity</h2>
    <ol class="timeline" id="timeline" aria-label="Activity">${t.events.map((e, i) => evHTML(t, e, i)).join('')}</ol>
    <div id="live-tail">${workingHTML(t)}</div>
    <form class="steer" data-form="steer" data-task="${t.id}">
      <label for="steer" class="sr-only">Message ${A.name}</label>
      <textarea id="steer" rows="1" placeholder="${ph}" ${disabled ? 'disabled' : ''} aria-describedby="steer-hint">${esc(state.steerDraft || '')}</textarea>
      <button class="btn icon steer-send" type="submit" aria-label="Send to ${esc(A.name)}" ${disabled ? 'disabled' : ''}>${icon('send', 'sm')}</button>
    </form>
    <p class="xsmall muted steer-hint" id="steer-hint">${steerHintHTML(t)}</p>`;
}
function steerHintHTML(t) {
  const A = AGENTS[t.agent];
  if (t.status === 'running' && t.noMidTurn) return `${icon('clock', 'xs')} ${A.name} can't take input mid-turn. Messages wait for its next turn, or you can pause it.`;
  if (t.status === 'running') {
    /* Choose when the message is delivered before you send it. The choice sticks until you change it. */
    const now_ = state.steerMode === 'now';
    return `<span class="steer-mode"><span id="steer-mode-label">Deliver</span><span class="seg sm" role="radiogroup" aria-labelledby="steer-mode-label"><button type="button" role="radio" data-action="steer-mode" data-mode="next" data-task="${t.id}" aria-checked="${!now_}" tabindex="${now_ ? -1 : 0}">At the next turn</button><button type="button" role="radio" data-action="steer-mode" data-mode="now" data-task="${t.id}" aria-checked="${now_}" tabindex="${now_ ? 0 : -1}">Now</button></span></span><span class="steer-mode-note">${now_ ? `${A.name} stops its current step to read it.` : `${A.name} reads it when it finishes its current step.`}</span>`;
  }
  if (t.status === 'waiting' && t.needs && t.needs.type === 'budget') return `${icon('hand', 'xs')} ${A.name} is waiting at your budget check-in. A message you send now waits for its next turn.`;
  if (t.status === 'waiting' && t.needs && t.needs.type === 'permission') return `${icon('hand', 'xs')} ${A.name} is waiting for your OK in Your next step. A message you send now waits for its next turn.`;
  if (handedOff(t)) return `${icon('handoff', 'xs')} Only one agent works in a workspace at a time. Send messages in the current task.`;
  if (t.status === 'done') return `${icon('message', 'xs')} A follow-up starts the sandbox again, with every file kept, and begins a new turn.`;
  return '';
}
function deliveryHTML(t, e, i) {
  if (!e.delivery) return '';
  const A = AGENTS[t.agent];
  if (e.delivery === 'queued') {
    /* A harness that can't take input mid-turn gets the message at the next turn; you can wait, or pause instead. */
    const rest = t.noMidTurn
      ? `<span class="xsmall muted">${A.name} can't take input mid-turn.</span>${t.status === 'running' ? `<button class="btn ghost sm" data-action="pause" data-task="${t.id}">${icon('pause', 'sm')}Pause instead</button>` : ''}`
      : t.status === 'running' ? `<button class="btn ghost sm" data-action="interrupt" data-task="${t.id}" data-ev="${i}" data-eid="${evId(e)}">Interrupt now</button>` : '';
    return `<div class="dline"><span class="dchip queued">${icon('clock', 'xs')}Queued for the next turn</span>${rest}</div>`;
  }
  if (e.delivery === 'interrupted') return `<div class="dline"><span class="dchip ok">${icon('check', 'xs')}Delivered now · interrupted the current turn</span></div>`;
  return `<div class="dline"><span class="dchip ok">${icon('check', 'xs')}Delivered at the next turn</span></div>`;
}
function evLI(cls, iconHTML, body, i, enter) {
  return `<li class="ev ${cls}${enter ? ' enter' : ''}" data-ev="${i}"><div class="ev-icon">${iconHTML}</div><div class="ev-body">${body}</div></li>`;
}
function evTime(e) { return `<time datetime="${new Date(e.at).toISOString()}">${fmtClock(e.at)}</time>`; }
function evHTML(t, e, i, enter) {
  const A = AGENTS[t.agent];
  const who = `<span class="who">${A.name}</span>`;
  switch (e.type) {
    case 'user':
      return evLI('user', `<span class="avatar you" style="width:30px;height:30px" aria-hidden="true">${icon('user', 'xs')}</span>`,
        `<div class="ev-head"><span class="who">You</span>${e.answerTo ? '<span class="what">answered</span>' : ''}${evTime(e)}</div><div class="ev-text">${esc(e.text)}</div>${deliveryHTML(t, e, i)}`, i, enter);
    case 'slept': {
      /* After a sleep: say what happened, confirm nothing was lost, and offer the remote cluster for long local runs. */
      const offer = t.env === 'local' && !['done', 'failed'].includes(t.status);
      return evLI('note', icon('moon', 'sm'), `<div class="ev-head"><span class="who">AX Studio</span><span class="what">paused while your computer slept · ${fmtClock(e.from)}–${fmtClock(e.to)}</span>${evTime(e)}</div><div class="ev-text muted">Resumed automatically when your computer woke. Nothing was lost.${offer ? ` For long runs, <button type="button" class="link" data-action="promote" data-task="${t.id}">run it on a remote cluster</button> to keep going with your laptop closed.` : ''}</div>`, i, enter);
    }
    case 'thought':
      return evLI('thought', icon('brain'), `<div class="ev-head">${who}<span class="what">is thinking</span>${evTime(e)}</div><div class="ev-text" data-text="${esc(e.text)}">${enter ? '<span class="caret"></span>' : esc(e.text)}</div>`, i, enter);
    case 'tool':
      return evLI('tool', icon(e.title === 'searched the code' ? 'search' : 'terminal'),
        `<div class="ev-head">${who}<span class="what">${esc(e.title)}</span>${evTime(e)}</div>
         <details class="tool-card"><summary>${e.ok === false ? icon('xCircle', 'sm bad') : icon('checkCircle', 'sm ok')}<code>${esc(e.cmd)}</code>${icon('chevRight', 'sm chev')}</summary>${toolOutHTML(t, e.out)}</details>`, i, enter);
    case 'edit': {
      const fs = (e.paths || []).map((p) => filesFor(t).find((f) => f.path === p)).filter(Boolean);
      const add = fs.reduce((n, f) => n + diffStats(f.lines).add, 0), del = fs.reduce((n, f) => n + diffStats(f.lines).del, 0);
      /* The diff is part of the live stream. Open it here, or jump to the file in Changes. */
      return evLI('edit', icon('pencil'),
        `<div class="ev-head">${who}<span class="what">changed ${plural(fs.length, 'file')}</span><span class="diffstat"><span class="a">+${add}</span><span class="d">−${del}</span></span>${evTime(e)}</div>
         <div class="file-chips">${fs.map((f) => `<a class="file-chip" href="#/task/${t.id}/changes?f=${encodeURIComponent(f.path)}">${icon('file', 'xs')}${esc(f.path)}</a>`).join('')}</div>
         ${fs.length ? `<details class="tool-card edit-diff"><summary>${icon('eye', 'sm')}<span>Show the changes</span>${icon('chevRight', 'sm chev')}</summary>
           <div class="ed-body">${fs.map((f) => `<div class="ed-file"><div class="ed-path"><span class="mono">${esc(f.path)}</span>${statHTML(f)}</div>${f.lines.length > BIG_DIFF ? `<p class="small muted" style="margin:8px 0">Large file · ${f.lines.length.toLocaleString()} lines. <a class="link" href="#/task/${t.id}/changes?f=${encodeURIComponent(f.path)}">Open it in Changes</a></p>` : `<div class="diff-wrap"><table class="diff" role="presentation">${diffRows(f)}</table></div>`}</div>`).join('')}</div></details>` : ''}`, i, enter);
    }
    case 'budget': {
      /* The budget check-in. The decision lives in "Your next step"; this is the record. */
      const res = !e.resolved ? `<div class="resolution pending">Waiting for you · <button type="button" class="link" data-action="focus-next">Decide in Your next step</button></div>`
        : e.resolved === 'raised' ? `<div class="resolution">${icon('checkCircle', 'sm')}You raised the check-in to $${(e.newBudget || 0).toFixed(2)}. ${A.name} carried on.</div>`
          : e.resolved === 'superseded' ? `<div class="resolution" style="color:var(--muted)">${icon(e.supersededNote ? 'info' : 'cloudUp', 'sm')}${esc(e.supersededNote || "No longer needed. The task moved to a remote cluster, where your organization's cap applies.")}</div>`
            : `<div class="resolution" style="color:var(--muted)">${icon('stop', 'sm')}You stopped the task here.</div>`;
      return evLI('question permission', icon('hand'), `<div class="ev-head"><span class="who">AX Studio</span><span class="what">checked in at your budget</span>${evTime(e)}</div>
        <div class="ev-text">This task has used about $${e.cost.toFixed(2)} (estimated), which reaches the $${e.budget.toFixed(2)} check-in you set. ${A.name} is waiting at the end of its turn.</div>${res}`, i, enter);
    }
    case 'permission': {
      /* The agent asked before a risky command. The decision buttons live in "Your next step"; this is the record. */
      let res;
      if (!e.resolved) {
        res = `<div class="resolution pending">Waiting for your OK · <button type="button" class="link" data-action="focus-next">Decide in Your next step</button>
          <button class="btn ghost sm" data-action="copy" data-text="ax approve ${t.id}" title="Copy the ax command">Copy ax approve</button></div>`;
      } else if (e.resolved === 'once') res = `<div class="resolution">${icon('checkCircle', 'sm')}You allowed it once</div>`;
      else if (e.resolved === 'task') res = `<div class="resolution">${icon('checkCircle', 'sm')}You allowed it for this task. ${A.name} won't ask again until the task ends.</div>`;
      else if (e.resolved === 'superseded') res = `<div class="resolution" style="color:var(--muted)">${icon('info', 'sm')}${esc(e.supersededNote || 'No longer needed.')}</div>`;
      else res = `<div class="resolution" style="color:var(--muted)">${icon('ban', 'sm')}You didn't allow it. ${A.name} carried on without it.</div>`;
      return evLI('question permission', icon('hand'),
        `<div class="ev-head">${who}<span class="what">${e.resolved ? 'asked before a risky command' : 'asks before a risky command'}</span>${evTime(e)}</div>
         <div class="attn-card ${e.resolved ? 'resolved' : ''}"><div class="ac-head"><span>Run <span class="mono">${esc(e.cmd)}</span>?</span></div>
           <div class="ac-body">${esc(e.why)} You asked agents to check with you before risky commands (Guardrails → Inside the sandbox).</div>${res}</div>`, i, enter);
    }
    case 'blocked': {
      let actions;
      if (!e.resolved) {
        /* The decision buttons live in "Your next step"; the timeline keeps the record, the reason and the CLI equivalent. */
        actions = `<div class="resolution pending">Waiting for your decision · <button type="button" class="link" data-action="focus-next">Decide in Your next step</button>
          <button class="btn ghost sm" data-action="copy" data-text="ax allow ${esc(e.domain)} --workspace ${esc(t.repo)}" title="Copy the ax command">Copy ax allow</button></div>`;
      } else if (e.resolved === 'allowed') actions = `<div class="resolution">${icon('checkCircle', 'sm')}Allowed for the ${esc(t.repo)} workspace</div>`;
      else if (e.resolved === 'once') actions = `<div class="resolution">${icon('checkCircle', 'sm')}Allowed once for this request (not added permanently)</div>`;
      else if (e.resolved === 'denied') actions = `<div class="resolution" style="color:var(--muted)">${icon('ban', 'sm')}Kept blocked. ${A.name} continued without it.</div>`;
      else if (e.resolved === 'superseded') actions = `<div class="resolution" style="color:var(--muted)">${icon('info', 'sm')}${esc(e.supersededNote || 'No longer needed. The run on this computer stopped before you decided.')}</div>`;
      else actions = `<div class="resolution" style="color:var(--muted)">${icon('lock', 'sm')}Blocked by your organization's policy · <button type="button" class="link" data-action="ask-admin" data-text="${esc(e.domain)}">Ask ${esc(state.org.admin)}</button></div>`;
      return evLI('blocked', icon('shield'),
        `<div class="ev-head"><span class="who">Guardrails</span><span class="what">${e.resolved ? 'filtered a request' : 'paused a request and needs you'}</span>${evTime(e)}</div>
         <div class="attn-card ${e.resolved ? 'resolved' : ''}">
           <div class="ac-head"><span>${A.name} tried to reach <span class="mono">${esc(e.domain)}</span></span></div>
           <div class="ac-body">${e.policy ? 'This site is blocked for everyone in your organization.' : "It isn't on this workspace's allowlist."}${e.purpose ? ` Reason given: “${esc(e.purpose)}.”` : ''}</div>
           ${whyBlockedHTML(t, e)}
           ${actions}
         </div>`, i, enter);
    }
    case 'workspace': {
      /* The hydration checklist, folded into one entry once the workspace is ready (or where it stopped). */
      const items = (e.items || []).map((x) => `<li class="check-item ${x.failed ? 'no' : 'ok'}"><span class="ci-icon">${icon(x.failed ? 'x' : 'check')}</span><div style="min-width:0"><div class="ci-title">${esc(x.t)}</div>${x.s ? `<div class="ci-desc">${esc(x.s)}</div>` : ''}</div></li>`).join('');
      return evLI(`note ws${e.failed ? ' ws-fail' : ''}`, icon('box', 'sm'), `<div class="ev-head"><span class="who">AX Studio</span><span class="what">${e.failed ? "couldn't finish setting up the workspace" : e.cluster ? `rebuilt the workspace on ${esc(e.cluster)} · ${esc(e.secs)} s` : `set up the workspace · ${esc(e.secs)} s`}</span>${evTime(e)}</div>
        <details class="tool-card ws-card"${e.failed ? ' open' : ''}><summary>${icon(e.failed ? 'xCircle' : 'checkCircle', e.failed ? 'sm bad' : 'sm ok')}<span class="ws-sum">${esc(e.summary || plural((e.items || []).length, 'step'))}</span>${icon('chevRight', 'sm chev')}</summary><ul class="check-list ws-list">${items}</ul></details>`, i, enter);
    }
    case 'question': {
      const body = e.answer
        ? `<div class="resolution" style="color:var(--muted)">${icon('checkCircle', 'sm')}You answered: “${esc(e.answer)}”</div>`
        : e.superseded
          ? `<div class="resolution" style="color:var(--muted)">${icon('info', 'sm')}${esc(e.supersededNote || 'No longer needed. The run on this computer stopped before you answered.')}</div>`
          : `<div class="resolution pending">Waiting for your answer · <button type="button" class="link" data-action="focus-next">Answer in Your next step</button></div>`;
      return evLI('question', icon('help'),
        `<div class="ev-head">${who}<span class="what">has a question</span>${evTime(e)}</div>
         <div class="attn-card ${e.answer || e.superseded ? 'resolved' : ''}"><div class="ac-head"><span style="font-weight:600">${esc(e.text)}</span></div>${body}</div>`, i, enter);
    }
    case 'done': {
      const files = filesFor(t);
      const isLast = i === lastIndexOf(t, 'done');
      return evLI('done', icon('check'),
        `<div class="ev-head">${who}<span class="what">finished</span>${evTime(e)}</div><div class="ev-text">${esc(e.text)}</div>
`, i, enter);
    }
    case 'fail':
      return evLI('fail', icon('xCircle'),
        `<div class="ev-head"><span class="who">AX Studio</span><span class="what">stopped the task</span>${evTime(e)}</div>
         ${failCardHTML(e.code || 'key-rejected', { t, e, noActions: true, pointToNext: t.status === 'failed' && !t.events.slice(i + 1).some((x) => x.type === 'fail'), cluster: t.cluster, repo: t.repo })}${e.fixedAt ? `<div class="resolution" style="margin-top:8px">${icon('checkCircle', 'sm')}Fixed · the task carried on at ${fmtClock(e.fixedAt)}</div>` : ''}`, i, enter);
    case 'handoff': {
      /* CUJ 4: what the new agent starts with. The goal and the workspace state carry over; the conversation doesn't. */
      const p = getTask(e.from), F = AGENTS[e.fromAgent];
      const fl = e.files || [];
      const add = fl.reduce((n, f) => n + f.add, 0), del = fl.reduce((n, f) => n + f.del, 0);
      const row = (label, html) => `<dt>${label}</dt><dd>${html}</dd>`;
      return evLI('handoff', icon('handoff'),
        `<div class="ev-head"><span class="who">${A.name}</span><span class="what">picked up from ${F.name}${p ? ` · <a href="#/task/${p.id}">${esc(p.title)}</a>` : ''}</span>${evTime(e)}</div>
         <div class="attn-card resolved handoff-card"><dl class="kv ho-kv">
           ${e.goal ? row('Goal', `${esc(e.goal)} <span class="muted">(unchanged)</span>`) : ''}
           ${row('Workspace', `Same workspace state${e.stoppedEarly ? `, from when you stopped ${F.name} mid-turn` : e.live ? `, from the end of ${F.name}'s turn` : ''}: ${fl.length ? `${plural(fl.length, 'changed file')} <span class="diffstat"><span class="a">+${add}</span><span class="d">−${del}</span></span>, ` : ''}uncommitted changes, git history and installed dependencies`)}
           ${fl.length ? row('Files', `<span class="file-chips">${fl.map((f) => `<a class="file-chip" href="#/task/${t.id}/changes?f=${encodeURIComponent(f.path)}">${icon('file', 'xs')}${esc(f.path)}</a>`).join('')}</span>`) : ''}
           ${row('Conversation', e.share === false ? `Starts new. ${F.name}'s Activity wasn't shared.` : `Starts new. ${F.name}'s Activity is attached for reference.`)}
           ${e.note ? row('Handoff note', esc(e.note)) : ''}
         </dl></div>`, i, enter);
    }
    case 'moved': {
      /* CUJ 5: a fresh run of the same task file on the remote cluster, not a live move. The cluster rebuilds
         the workspace from the workspace setup, and the organization's policies attach on their own. */
      const from = e.fromLast ? ' and the last pushed commit' : e.from ? ` and <span class="mono">${esc(e.from)}</span>` : '';
      return evLI('handoff', icon('cloudUp'), `<div class="ev-head"><span class="who">AX Studio</span><span class="what">started a fresh run on a remote cluster</span>${evTime(e)}</div>
        <div class="ev-text">Same task file on <span class="mono">${esc(e.cluster)}</span>, with 0 edits. The cluster rebuilds the workspace from your workspace setup${from}: the repo, instructions, skills and MCP servers. Each step shows below.${e.without && e.without.length ? ` It runs without the ${esc(e.without.join(' and '))} MCP server, which this cluster doesn't have.` : ''}</div>
        <div class="xsmall muted" style="margin-top:6px">Your organization's guardrails now apply: VPC perimeter, Model Armor DLP and a $${ORG_BUDGET} budget cap per task.</div>
        <div class="xsmall muted" style="margin-top:6px">The run on this computer stopped at the end of its step. Its conversation stays above for reference; the new run starts without it.</div>`, i, enter);
    }
    case 'paused':
      return evLI('note', icon('pause', 'sm'), `<div class="ev-head"><span class="who">You</span><span class="what">paused the task</span>${evTime(e)}</div>`, i, enter);
    case 'resumed':
      return evLI('note', icon('play', 'sm'), `<div class="ev-head"><span class="who">You</span><span class="what">resumed the task</span>${evTime(e)}</div>`, i, enter);
    case 'stopped':
      return evLI('note', icon('stop', 'sm'), `<div class="ev-head"><span class="who">You</span><span class="what">stopped the task</span><span class="muted small">Changes are kept</span>${evTime(e)}</div>`, i, enter);
    case 'applied':
      return evLI('done', icon('folder'), `<div class="ev-head"><span class="who">You</span><span class="what">applied ${plural(e.paths.length, 'file')} to <span class="mono">${esc(e.folder || t.folder)}</span></span>${evTime(e)}</div>
        <div class="ev-text small muted"><span class="mono">${e.paths.map(esc).join(', ')}</span>${e.conflicts && e.conflicts.length ? ` · ${plural(e.conflicts.length, 'file conflicts', 'files conflict')} with your folder and stayed in the sandbox` : ''}</div>`, i, enter);
    case 'pr':
      return evLI('done', icon('pr'), `<div class="ev-head"><span class="who">You</span><span class="what">opened pull request <a class="link" href="${esc(e.url)}" target="_blank" rel="noopener">#${e.number}</a> for <span class="mono">${esc(e.branch)}</span></span>${evTime(e)}</div>`, i, enter);
    case 'pushed':
      return evLI('done', icon('branch'), `<div class="ev-head"><span class="who">You</span><span class="what">pushed to <span class="mono">${esc(e.branch)}</span></span>${evTime(e)}</div>`, i, enter);
    default:
      return evLI('note', icon('info', 'sm'), `<div class="ev-head"><span class="what">${esc(e.text || '')}</span>${evTime(e)}</div>`, i, enter);
  }
}

/* ---------- Changes / review (strict single-Axel: journey rider above is sole Axel) ---------- */
function changesPanelHTML(t) {
  const files = filesFor(t);
  if (!files.length) return t.status === 'done' || t.status === 'failed'
    ? emptyHTML('No changes', `${AGENTS[t.agent].name} ${t.status === 'done' ? 'finished' : 'stopped'} without editing any files.`)
    : emptyHTML('No changes yet', `${AGENTS[t.agent].name}'s edits stay inside the sandbox and appear here file by file as it works.`);
  const sel = state.diffSel[t.id] || (state.diffSel[t.id] = { i: 0, discarded: {}, seen: {} });
  sel.seen = sel.seen || {};
  const want = new URLSearchParams((location.hash.split('?')[1]) || '').get('f');
  if (want) { const k = files.findIndex((f) => f.path === want); if (k >= 0) sel.i = k; }
  if (sel.i >= files.length) sel.i = 0;
  const f = files[sel.i];
  sel.seen[f.path] = true;
  const kept = files.filter((x) => !sel.discarded[x.path]).length;
  const seenN = files.filter((x) => sel.seen[x.path]).length;
  const allSeen = seenN === files.length;
  const isOff = !!sel.discarded[f.path];
  const nextUnseen = files.findIndex((x) => !sel.seen[x.path]);
  const list = files.map((x, k) => {
    const s = diffStats(x.lines);
    const mark = sel.discarded[x.path] ? `<span class="fv off" title="Discarded">${icon('x')}</span>` : appliedPaths(t).includes(x.path) ? `<span class="fv seen" title="Applied to your folder">${icon('folder')}</span><span class="sr-only">Applied, </span>` : sel.seen[x.path] ? `<span class="fv seen" title="Reviewed">${icon('check')}</span>` : `<span class="fv" title="Not reviewed yet"></span>`;
    return `<button type="button" class="file-item ${sel.discarded[x.path] ? 'discarded' : ''}" data-action="diff-file" data-task="${t.id}" data-i="${k}" aria-current="${k === sel.i}">
      ${mark}<span class="fn" title="${esc(x.path)}">${esc(x.path)}</span>${diffBlocks(s.add, s.del)}</button>`;
  }).join('');
  /* Shipping unlocks only when the agent has finished — the same promise "Your next step" makes above. */
  const A = AGENTS[t.agent];
  const moved = handedOff(t) ? getTask(t.child) : null;
  const finished = t.status === 'done' && !moved;
  const fileN = (n) => plural(n, 'file');
  const statusLine = moved ? `A snapshot from when ${A.name} stopped. ${AGENTS[moved.agent].name} continues in the same workspace.` : t.pushed
    ? `Shipped to <span class="mono">${esc(t.branch)}</span> · Agent: ${A.name} recorded in commit trailer.`
    : !finished
      ? `Reviewed ${seenN} of ${fileN(files.length)} so far · ${A.name} may change more before it finishes.`
      : allSeen
        ? `${files.length === 1 ? 'Reviewed' : `All ${files.length} files reviewed`} · ${kept} kept in the sandbox. Ready to ship.`
        : `Reviewed ${seenN} of ${fileN(files.length)} · your folder is still untouched.`;
  const statusFinal = finished && appliedPaths(t).length && !t.pushed ? `Reviewed ${seenN} of ${fileN(files.length)} · ${appliedPaths(t).length} applied to your folder.` : statusLine;
  const ap = appliedPaths(t).length, apAll = appliedAll(t), clashN = finished ? conflictFiles(t).filter((p) => !appliedPaths(t).includes(p)).length : 0;
  const applyLeft = keptFiles(t).filter((x) => !appliedPaths(t).includes(x.path)).length;
  const takeTitle = moved ? `Continues with ${AGENTS[moved.agent].name}` : t.pushed ? 'Shipped with provenance' : finished ? `${kept} of ${fileN(files.length)} ready to leave the sandbox` : t.status === 'failed' ? 'This run stopped before it finished' : `${A.name} is still working`;
  const takeText = moved ? 'Review and ship these changes from the current task, where the work continues.' : t.pushed
    ? `Pushed to <span class="mono">${esc(t.branch)}</span> with the ${A.name} task summary.${t.pr ? ` Pull request #${t.pr.number} is open.` : ''}${ap ? ` ${plural(ap, 'file')} also applied to your folder.` : ''}`
    : finished && ap
      ? `Applied ${ap} of ${fileN(keptFiles(t).length)} to <span class="mono">${esc(t.folder)}</span>.${clashN ? ` ${plural(clashN, 'file conflicts', 'files conflict')} and ${clashN === 1 ? 'stays' : 'stay'} in the sandbox.` : ''}`
    : finished
      ? `Your local folder <span class="mono">${esc(t.folder)}</span> is untouched until you apply or push.`
      : t.status === 'failed'
        ? 'Fix the problem in Your next step to finish the run, or export what is here.'
        : `Apply and Push unlock when it finishes. Your local folder <span class="mono">${esc(t.folder)}</span> is untouched.`;
  /* One row of tabs per page: the task's Activity · Changes · Terminal. Review progress is a plain status line with one
     action (the same toolbar shape as Activity), not a second row of step labels with an underline. Each step already
     has its own home: the check marks in the file list, Keep · Discard on the diff, and the ship bar under it. */
  return `
    <div class="act-tools review-bar">
      <span class="xsmall muted" role="status">${statusFinal}</span>
      ${!allSeen && !t.pushed && nextUnseen >= 0 ? `<button class="btn ghost sm" data-action="diff-file" data-task="${t.id}" data-i="${nextUnseen}">Next file ${icon('arrowRight', 'sm')}</button>` : ''}
    </div>
    <div class="changes">
      <div class="card file-list" aria-label="Changed files">${list}</div>
      <div style="min-width:0">
        <div class="card diff-card ${isOff ? 'discarded' : ''}">
          <div class="diff-head"><span class="path">${esc(f.path)}</span>${statHTML(f)}
            <div class="btn-row"><div class="seg" role="radiogroup" aria-label="Keep or discard ${esc(f.path)}">
              <button type="button" role="radio" aria-checked="${!isOff}" data-action="keep-file" data-task="${t.id}" data-keep="1" ${t.pushed || moved ? 'disabled' : ''}>Keep</button>
              <button type="button" role="radio" aria-checked="${isOff}" data-action="keep-file" data-task="${t.id}" data-keep="0" ${t.pushed || moved ? 'disabled' : ''}>Discard</button></div></div>
          </div>
          ${f.lines.length > BIG_DIFF && !(sel.big && sel.big[f.path]) ? `<div class="big-diff"><b>Large file · ${f.lines.length.toLocaleString()} lines</b><span class="small muted">Showing a diff this long can slow the page down. Generated and lock files usually don't need a line-by-line review.</span><div class="btn-row"><button class="btn sm" data-action="show-big-diff" data-task="${t.id}" data-path="${esc(f.path)}">Show the diff</button><button class="btn ghost sm" data-action="patch" data-task="${t.id}">${icon('download', 'sm')}Download the patch</button></div></div>`
            : `<div class="diff-wrap" tabindex="0" role="region" aria-label="Changes to ${esc(f.path)}"><table class="diff" role="presentation">${diffRows(f)}</table></div>`}
        </div>
        <div class="card take-bar">
          <div><div style="font-weight:600">${takeTitle}</div><div class="small muted">${takeText}</div></div>
          <div class="btn-row">
            <button class="btn ghost" data-action="export-results" data-task="${t.id}" title="ax export ${t.id} --results">Export…</button>
            ${moved ? `<a class="btn ghost" href="#/task/${moved.id}/changes">Open the current task ${icon('arrowRight', 'sm')}</a>` : t.pushed
              ? `<button class="btn" data-action="apply" data-task="${t.id}" ${applyLeft ? '' : 'disabled'} title="ax apply ${t.id}">${apAll ? 'Applied to my folder' : 'Apply to my folder'}</button>${t.pr ? `<a class="btn primary" href="${esc(t.pr.url)}" target="_blank" rel="noopener">${icon('arrowUpRight', 'sm')}Pull request #${t.pr.number}</a>` : `<button class="btn primary" data-action="open-pr" data-task="${t.id}">${icon('pr', 'sm')}Open pull request</button>`}`
              : finished
                ? `<button class="btn" data-action="apply" data-task="${t.id}" ${kept && applyLeft ? '' : 'disabled'} title="ax apply ${t.id}">${apAll ? 'Applied to my folder' : ap ? `Apply ${plural(applyLeft, 'more file')}` : 'Apply to my folder'}</button><button class="btn primary" data-action="push" data-task="${t.id}" ${kept ? '' : 'disabled'} title="ax push ${t.id}">${icon('branch', 'sm')}Push to new branch</button>`
                : ''}
          </div>
        </div>
      </div>
    </div>`;
}
/* Scale: diffs over 1,000 lines are collapsed, and tool output over 500 lines shows its last 500 (the full text is in the Log tab). */
const BIG_DIFF = 1000, TOOL_TAIL = 500;
function toolOutHTML(t, out) {
  const lines = String(out || '').split('\n');
  if (lines.length <= TOOL_TAIL) return `<pre class="tool-out">${esc(out)}</pre>`;
  return `<p class="xsmall muted tool-tail">Showing the last ${TOOL_TAIL} of ${lines.length.toLocaleString()} lines. <button type="button" class="link" data-action="raw-log" data-task="${t.id}">View the full log</button></p><pre class="tool-out">${esc(lines.slice(-TOOL_TAIL).join('\n'))}</pre>`;
}
function diffRows(f) {
  let o = 1, n = 1;
  return f.lines.map((l) => {
    const ty = l[0], text = esc(l.slice(1));
    if (ty === '@') {
      const m = l.match(/-(\d+)(?:,\d+)? \+(\d+)/);
      if (m) { o = +m[1] || 1; n = +m[2] || 1; }
      return `<tr class="hunk"><td colspan="4">${esc(l)}</td></tr>`;
    }
    if (ty === '+') return `<tr class="add"><td class="ln"></td><td class="ln">${n++}</td><td class="sign"><span aria-hidden="true">+</span><span class="sr-only">Added: </span></td><td>${text}</td></tr>`;
    if (ty === '-') return `<tr class="del"><td class="ln">${o++}</td><td class="ln"></td><td class="sign"><span aria-hidden="true">−</span><span class="sr-only">Removed: </span></td><td>${text}</td></tr>`;
    const row = `<tr><td class="ln">${o}</td><td class="ln">${n}</td><td class="sign"></td><td>${text}</td></tr>`;
    o++; n++;
    return row;
  }).join('');
}

/* ---------- Terminal (an interactive terminal, `ax ssh`, into compatible tasks) ---------- */
function termInit(t) {
  if (!state.term[t.id]) {
    state.term[t.id] = [
      `<span class="m">$</span> ax ssh ${t.id}`,
      ...(['done', 'failed'].includes(t.status) ? [`<span class="m">  The sandbox was suspended. Started it again with every file kept (about 3 s).</span>`] : []),
      `<span class="g">✓</span> Connected to “${esc(t.title)}” · ${t.env === 'cluster' ? 'on ' + esc(t.cluster) : 'isolated microVM sandbox'} · copy-on-write`,
      `<span class="m">  0 raw API keys in this guest shell. Outbound requests filter through Guardrails (${state.guardrailPreset}).</span>`,
      `<span class="m">  Try: ls · git status · npm test · env · curl example.com · help</span>`,
      '',
    ];
  }
  return state.term[t.id];
}
/** A terminal needs a running sandbox. A task whose sandbox never started (or is still starting) says so, instead of
    pretending to connect. */
function termUnavailable(t) {
  const A = AGENTS[t.agent];
  if (t.status === 'starting') return { title: 'The sandbox is starting', desc: `The terminal opens as soon as ${esc(A.name)}'s sandbox is ready, usually in a few seconds.` };
  const f = t.status === 'failed' ? lastFail(t) : null;
  if (f && /^(image-unavailable|handoff-start)$/.test(f.e.code || '')) return { title: "There's no sandbox to open", desc: `${esc(A.name)}'s image didn't download, so its sandbox never started. Fix that in Your next step, then open the terminal.`, next: true };
  return null;
}
function terminalPanelHTML(t) {
  const off = termUnavailable(t);
  if (off) return emptyHTML(off.title, off.desc, off.next ? `<button type="button" class="btn sm" data-action="focus-next">See Your next step</button>` : '');
  const lines = termInit(t);
  return `
    <div class="terminal">
      <div class="term-bar"><span class="term-dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="term-tab" aria-selected="true">${icon('terminal', 'xs')}sandbox shell</span>
        <span style="margin-left:auto;display:inline-flex;align-items:center;gap:6px">${icon('shieldCheck', 'xs')}Guardrails · 0 raw keys</span></div>
      <div class="term-body" id="term-body" data-action="focus-term">${lines.join('\n')}
<form class="term-input-row" data-form="term" data-task="${t.id}"><span class="p">rajitha@${esc(t.repo)}</span><span class="m">:/workspace (${esc(t.branch)}) $</span><label for="term-input" class="sr-only">Terminal command</label><input class="term-input" id="term-input" autocomplete="off" spellcheck="false" autocapitalize="off"></form></div>
    </div>
    <p class="small muted" style="margin-top:12px">Same as running <code>ax ssh ${t.id}</code> in your own terminal.</p>`;
}

/* ---------- Log tab (every task has its status and logs) ----------
   Everything the agent and AX did, one line per event, as the CLI shows it (`ax logs <task> --follow`). Secrets are
   removed. It's the fourth task tab (v26; before, a dialog behind View log) and follows the task live (refreshRawLog). */
function rawLogText(t) {
  const A = AGENTS[t.agent];
  const ts = (at) => { const d = new Date(at); return `[${[d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':')}]`; };
  const clean = (s) => String(s == null ? '' : s).replace(/\b(sk-[A-Za-z0-9-]{4,}|ghp_[A-Za-z0-9]{6,})/g, '[redacted]');
  const indent = (s) => clean(s).split('\n').map((l) => `             ${l}`).join('\n');
  const head = `# ax logs ${t.id} · ${t.title} · ${A.cli}${t.version ? '@' + t.version : ''} · ${t.env === 'cluster' ? t.cluster : 'local sandbox'}`;
  const lines = t.events.map((e) => {
    const p = ts(e.at) + ' ';
    switch (e.type) {
      case 'user': return `${p}you      ${e.answerTo ? 'answered' : 'said'}: ${clean(e.text)}${e.delivery === 'queued' ? '  (queued for the next turn)' : e.delivery === 'interrupted' ? '  (delivered now)' : ''}`;
      case 'thought': return `${p}agent    thinking: ${clean(e.text)}`;
      case 'tool': return `${p}tool     $ ${clean(e.cmd)}  → ${e.ok === false ? 'failed' : 'ok'}${e.out ? '\n' + indent(e.out) : ''}`;
      case 'edit': return `${p}files    ${(e.paths || []).map((x) => { const f = filesFor(t).find((y) => y.path === x); const s = f ? diffStats(f.lines) : { add: 0, del: 0 }; return `${f && f.kind === 'new' ? 'A' : 'M'} ${x} (+${s.add} −${s.del})`; }).join(', ')}`;
      case 'blocked': return `${p}guard    blocked ${e.domain}:443 · ${e.policy ? "your organization's policy" : 'not on the allowlist'}${e.resolved ? ` · ${e.resolved}` : ' · waiting for you'}`;
      case 'question': return `${p}agent    asked: ${clean(e.text)}${e.answer ? ` · you answered “${clean(e.answer)}”` : ' · waiting for you'}`;
      case 'budget': return `${p}task     budget check-in at $${e.budget.toFixed(2)} (used $${e.cost.toFixed(2)})${e.resolved ? ` · ${e.resolved === 'raised' ? 'raised to $' + (e.newBudget || 0).toFixed(2) : e.resolved}` : ' · waiting for you'}`;
      case 'permission': return `${p}sandbox  permission asked: ${clean(e.cmd)}${e.resolved ? ` · ${e.resolved === 'denied' ? 'not allowed' : 'allowed ' + (e.resolved === 'task' ? 'for this task' : 'once')}` : ' · waiting for you'}`;
      case 'workspace': return `${p}setup    ${e.failed ? 'stopped' : `ready in ${e.secs} s`} · ${clean(e.summary || '')}${(e.items || []).length ? '\n' + (e.items || []).map((x) => `             ${x.failed ? '✗' : '✓'} ${clean(x.t)}${x.s ? ' · ' + clean(x.s) : ''}`).join('\n') : ''}`;
      case 'fail': { const E = ERRORS[e.code] || ERRORS.crash; const ctx = { t, e }; const log = e.log || val(E.log, ctx); return `${p}task     stopped · ${clean(e.title || val(E.title, ctx))}${log ? '\n' + indent(log) : ''}`; }
      case 'paused': return `${p}task     paused by you`;
      case 'resumed': return `${p}task     resumed by you`;
      case 'stopped': return `${p}task     stopped by you · changes kept`;
      case 'slept': return `${p}host     computer slept ${fmtClock(e.from)}–${fmtClock(e.to)} · task held, resumed on wake`;
      case 'handoff': return `${p}task     picked up from ${AGENTS[e.fromAgent].name} · note: ${clean(e.note)}`;
      case 'moved': return `${p}task     fresh run on ${e.cluster} · workspace rebuilt from the workspace setup · organization guardrails attached`;
      case 'pushed': return `${p}git      pushed ${e.branch}`;
      case 'applied': return `${p}files    applied ${e.paths.join(', ')} to ${e.folder || t.folder}${e.conflicts && e.conflicts.length ? ` (${e.conflicts.length} conflicting, kept in sandbox)` : ''}`;
      case 'pr': return `${p}git      opened pull request #${e.number} ${e.url}`;
      case 'done': return `${p}agent    finished: ${clean(e.text)}`;
      default: return `${p}note     ${clean(e.text || e.type)}`;
    }
  });
  const tail = t.status === 'running' ? `${ts(now())} ...      ${A.name} is working` : t.status === 'done' ? '' : `${ts(now())} task     ${STATUS[t.status].label.toLowerCase()}`;
  return [head, ...lines, tail].filter(Boolean).join('\n');
}
function logPanelHTML(t) {
  return `
    <h2 class="sr-only">Log</h2>
    <div class="log-bar"><span class="lb-text">Everything the agent and AX did, as plain text. It follows the task live, and secrets are removed.</span>
      <span class="lb-actions"><button type="button" class="btn sm" data-action="copy-log" data-task="${t.id}">${icon('copy', 'sm')}Copy</button><button type="button" class="btn sm" data-action="download-log" data-task="${t.id}">${icon('download', 'sm')}Download .txt</button></span></div>
    <pre class="tool-out well raw-log" id="raw-log" data-task="${t.id}" tabindex="0" aria-label="Log for ${esc(t.title)}">${esc(rawLogText(t))}</pre>
    <p class="small muted" style="margin-top:12px">Same as running <code>ax logs ${t.id} --follow</code> in your own terminal.</p>`;
}
/** Keep the Log tab current. New lines show up as they happen; it scrolls with them only while you're at the end. */
function refreshRawLog(t) {
  const rl = $('#raw-log');
  if (!rl || !rl.dataset || rl.dataset.task !== t.id) return;
  const atEnd = rl.scrollTop + rl.clientHeight >= rl.scrollHeight - 24;
  rl.textContent = rawLogText(t);
  if (atEnd) rl.scrollTop = rl.scrollHeight;
}
