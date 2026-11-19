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

/* AX Studio prototype — simulation, actions, router, keyboard, init (v4). */
'use strict';

/* ---------- Agent scripts (simulated live activity) ---------- */
function lastUserText(t) { for (let i = t.events.length - 1; i >= 0; i--) if (t.events[i].type === 'user') return t.events[i].text; return ''; }
/** Quotes your message inside the agent's line, ending the sentence once: “…one.” rather than “…one.”. */
function quoted(text) { const s = String(text || '').trim(); return /[.!?…]$/.test(s) ? `“${s}”` : `“${s}”.`; }
const SCRIPTS = {
  t1: [
    { d: 2600, ev: { type: 'thought', text: "The checkout route is mounted in src/app.ts. I'll add a middleware that allows 20 requests per minute per user and returns 429 with a Retry-After header." } },
    { d: 2600, ev: { type: 'tool', title: 'read a file', cmd: 'cat src/app.ts', out: 'import express from "express";\nimport { checkout } from "./routes/checkout";\n\nexport const app = express();\napp.use(express.json());\napp.use("/checkout", checkout);', ok: true } },
    { d: 3000, ev: { type: 'blocked', domain: 'raw.githubusercontent.com', cmd: 'curl -s https://raw.githubusercontent.com/express-rate-limit/express-rate-limit/main/readme.md', purpose: 'Read the example config in the express-rate-limit repo' } },
    { d: 2000, skipIfDenied: true, ev: { type: 'tool', title: 'fetched a page', cmd: 'curl -s https://raw.githubusercontent.com/express-rate-limit/express-rate-limit/main/readme.md', out: '200 OK · 14.2 KB\n…\nconst limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 100, standardHeaders: "draft-7" })', ok: true } },
    { d: 3000, files: [FILES.rateLimit, FILES.checkout], ev: { type: 'edit', paths: [FILES.rateLimit.path, FILES.checkout.path] } },
    { d: 2400, ev: { type: 'thought', text: 'Now adding tests for the 429 response and the Retry-After header.' } },
    { d: 2600, files: [FILES.rateTest, FILES.pkg], ev: { type: 'edit', paths: [FILES.rateTest.path, FILES.pkg.path] } },
    { d: 3000, ev: { type: 'tool', title: 'ran the tests', cmd: 'npm test', out: 'PASS test/rateLimit.test.ts\nPASS test/checkout.test.ts\n\nTests: 14 passed, 14 total\nTime:  3.42 s', ok: true } },
    { d: 2000, ev: { type: 'done', text: 'Ready for review. POST /checkout now allows 20 requests per minute per user and returns 429 with a Retry-After header. 4 files changed, and all 14 tests pass.' } },
  ],
  t3: [
    { d: 9000, ev: { type: 'tool', title: 'ran a command', cmd: 'python -m pipeline.reencode samples/ --format webp --resume', out: '2,400 / 2,400 done (100%)\nAverage size: −31% vs JPEG\nLargest saving: hero images (−44%)', ok: true } },
    { d: 7000, ev: { type: 'thought', text: 'Writing the size report to reports/webp.md and adding a JPEG fallback test for older Safari.' } },
    { d: 8000, files: [{ path: 'reports/webp.md', kind: 'new', lines: newFile('# WebP results\n\n- 2,400 sample images\n- Average size: −31% vs JPEG\n- Hero images: −44%\n- Fallback: JPEG for browsers without WebP') }], ev: { type: 'edit', paths: ['reports/webp.md'] } },
    { d: 6000, ev: { type: 'tool', title: 'ran the tests', cmd: 'pytest tests/test_encode.py -q', out: '9 passed in 1.12s', ok: true } },
    { d: 4000, ev: { type: 'done', text: 'WebP is served where supported, with JPEG fallback. Images are 31% smaller on average. Report in reports/webp.md.' } },
  ],
  answer: [
    { d: 1400, ev: (t) => ({ type: 'thought', text: /delete/i.test(lastUserText(t)) ? 'Deleting the unused fixtures, then finishing the last 3 test files.' : 'Keeping the legacy fixtures for now and finishing the last 3 test files.' }) },
    { d: 2600, ev: { type: 'tool', title: 'ran the tests', cmd: 'pytest -q', out: '42 passed in 3.81s', ok: true } },
    { d: 1800, ev: { type: 'done', text: 'All 42 auth tests now run on pytest. Coverage is unchanged at 91%.' } },
  ],
  generic: [
    { d: 1800, ev: (t) => ({ type: 'thought', text: `I'll start by getting oriented in ${t.repo}: the README, the project layout and how the tests run.` }) },
    { d: 2400, ev: (t) => ({ type: 'tool', title: 'ran a command', cmd: 'ls && head -5 README.md', out: `README.md  package.json  src/  test/\n# ${t.repo}\nA small service. Run tests with npm test.`, ok: true }) },
    { d: 2600, ev: { type: 'thought', text: 'Plan: 1) find where this belongs, 2) make the change in small steps, 3) run the tests after each step.' } },
    { d: 3000, files: 'generic', ev: (t) => ({ type: 'edit', paths: genericFiles(t).map((f) => f.path) }) },
    /* A command that deletes many files. With "Ask before risky commands" on (Guardrails → Inside the sandbox),
       the agent stops and asks in Studio first; with the default ("Run without asking") it just runs in the sandbox. */
    { d: 2200, risky: 'It deletes the old build output (dist/ and .cache/) in the sandbox copy before a clean test run.', ev: { type: 'tool', title: 'ran a command', cmd: 'rm -rf dist .cache', out: 'Removed dist/ and .cache/ (38 MB)', ok: true } },
    { d: 2800, ev: { type: 'tool', title: 'ran the tests', cmd: 'npm test', out: 'Tests: 22 passed, 22 total\nTime:  2.91 s', ok: true } },
    { d: 2000, ev: (t) => ({ type: 'done', text: `Ready for review. ${t.files.length} files changed and all tests pass.` }) },
  ],
  /* CUJ 5: a fresh run on a remote cluster. The new session checks what the branch already has, finishes the goal and tests. */
  fresh: [
    { d: 2200, ev: (t) => ({ type: 'tool', title: 'ran a command', cmd: 'git log --oneline -2 && git status --short', out: t.freshFromBase ? `7d3e0b1 (HEAD -> ${t.branch}, origin/main) Start from main\n(clean)` : t.freshFromLast ? `7d3e0b1 (HEAD -> ${t.branch}) Last pushed commit\n(clean)` : `a1f9c2e (HEAD -> ${t.branch}) Work in progress pushed from this computer\n7d3e0b1 Last pushed commit\n(clean)`, ok: true }) },
    { d: 2600, ev: (t) => ({ type: 'thought', text: t.freshFromBase ? "This branch was never pushed, so I'm starting from main. I'll redo the earlier steps, then run the tests." : t.freshFromLast ? "I'm starting from the last pushed commit, so I'll redo the earlier steps, then run the tests." : 'The earlier changes are on this branch. I\'ll finish what\'s left of the goal, then run the tests.' }) },
    { d: 2800, ev: (t) => { const py = (t.files || []).some((f) => /\.py$/.test(f.path)); return { type: 'tool', title: 'ran the tests', cmd: py ? 'pytest -q' : 'npm test', out: py ? '42 passed in 3.12s' : 'Tests: 22 passed, 22 total\nTime:  2.91 s', ok: true }; } },
    { d: 2000, ev: (t) => ({ type: 'done', text: `Ready for review on ${t.cluster}. ${plural((t.files || []).length, 'file')} changed and all tests pass.` }) },
  ],
  followup: [
    { d: 1400, ev: (t) => ({ type: 'thought', text: `On it: ${quoted(lastUserText(t))} I'll keep the change small and re-run the tests.` }) },
    { d: 2600, ev: { type: 'tool', title: 'ran the tests', cmd: 'npm test', out: 'All tests passed', ok: true } },
    { d: 1600, ev: { type: 'done', text: 'Follow-up done. Tests still pass.' } },
  ],
};

/* ---------- Simulation engine ---------- */
/** Home's station numbers count up when you arrive (navigation only; live updates don't replay it). */
function countUp(root) {
  if (!root || reducedMotion() || typeof performance === 'undefined') return;
  root.querySelectorAll('.st-num').forEach((el) => {
    const to = parseInt(el.textContent, 10);
    if (!(to > 1)) return;
    const t0 = performance.now(), dur = 620;
    el.textContent = '0';
    const step = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      el.textContent = String(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}
function scheduleNext(t) {
  clearTimeout(t._timer);
  const s = SCRIPTS[t.script];
  if (!s || t.step >= s.length || t.status !== 'running') return;
  /* state.simScale slows the simulated agent down for narrated recordings (default 1). */
  const d = s[t.step].d * (state.simScale || 1);
  t._timer = setTimeout(() => runStep(t), reducedMotion() ? Math.min(d, 1200) : d);
}
/* On this computer AX checks in when a task reaches its budget. The agent waits at the end of its turn until
   you raise the check-in or stop the task. (On a remote cluster the organization's cap applies instead.) */
const BUDGET_STEP = 5;
function openBudget(t) { for (let i = t.events.length - 1; i >= 0; i--) { const e = t.events[i]; if (e.type === 'budget' && !e.resolved) return { e, i }; } return null; }
function budgetCheck(t) {
  if (!t || t.env === 'cluster' || t.status !== 'running') return false;
  const b = budgetFor(t);
  if (costFor(t) < b) return false;
  clearTimeout(t._timer);
  pushEvent(t, { type: 'budget', at: now(), cost: costFor(t), budget: b });
  t.needs = { type: 'budget' };
  setStatus(t, 'waiting');
  notifyNeeds(t, `${AGENTS[t.agent].name} reached your $${b.toFixed(2)} check-in`, 'waiting');
  return true;
}
function resolveBudget(t, how) {
  const o = t && openBudget(t);
  if (!o) return;
  if (how === 'stop') { stopTask(t); return; }
  o.e.resolved = 'raised';
  o.e.newBudget = o.e.budget + BUDGET_STEP;
  t.budget = o.e.newBudget;
  replaceEvent(t, o.i);
  toast(`Check-in raised to $${o.e.newBudget.toFixed(2)}. ${esc(AGENTS[t.agent].name)} is working again.`, { icon: 'checkCircle' });
  setStatus(t, 'running');
  refreshQueued(t);
  scheduleNext(t);
}
function runStep(t) {
  if (t.status !== 'running') return;
  /* While Studio can't reach AX, the agent keeps working; its updates arrive when the connection is back. */
  if (state.conn.lost) { t._connHeld = true; t._timer = setTimeout(() => runStep(t), 700); return; }
  if (budgetCheck(t)) return;
  if (deliverQueued(t)) { scheduleNext(t); return; }
  const s = SCRIPTS[t.script];
  /* With "Ask before risky commands" on, a risky step waits for your OK in Studio before it runs. */
  if (s[t.step] && askFirst(t, s[t.step])) return;
  const step = s[t.step];
  t.step++;
  if (step.skipIfDenied && t._denied) { scheduleNext(t); return; }
  if (step.files === 'generic') genericFiles(t).forEach((f) => { if (!t.files.some((x) => x.path === f.path)) t.files.push(f); });
  else if (step.files) step.files.forEach((f) => { if (!t.files.some((x) => x.path === f.path)) t.files.push(f); });
  const e = Object.assign({ at: now() }, typeof step.ev === 'function' ? step.ev(t) : step.ev);
  t.tokens += 2000 + Math.round(Math.random() * 6000);
  sparkFor(t).push(t.tokens);
  pushEvent(t, e);
  /* Diffs are live. If you're reviewing Changes while the agent edits, the new files show up right away. */
  if (e.type === 'edit' && onTask(t, 'changes')) { render({ keepScroll: true, background: true }); announce(`${AGENTS[t.agent].name} changed ${plural((e.paths || []).length, 'file')}. Changes is up to date.`); }
  const A = AGENTS[t.agent];
  /* On a remote cluster, a new destination is the organization's call, not yours. Say "Blocked by your
     organization's policy" (with who to ask) and let the agent carry on without it, instead of asking you to allow it. */
  if (e.type === 'blocked' && t.env === 'cluster') {
    e.policy = true; e.resolved = 'policy'; t._denied = true;
    replaceEvent(t, t.events.length - 1);
    state.blockedLog.push({ at: e.at, task: t.id, domain: e.domain, reason: 'policy', cmd: e.cmd, purpose: e.purpose });
    pushEvent(t, { type: 'thought', at: now(), text: `${e.domain} is blocked by your organization's policy on ${t.cluster}, so I'll carry on without it.` });
    refreshLive(t);
    scheduleNext(t);
    return;
  }
  if (e.type === 'blocked') {
    state.blockedLog.push({ at: e.at, task: t.id, domain: e.domain, reason: 'list', cmd: e.cmd, purpose: e.purpose });
    setStatus(t, 'blocked');
    notifyNeeds(t, `${A.name} wants to reach ${esc(e.domain)}`, 'blocked');
    return;
  }
  if (e.type === 'question') { t.needs = { type: 'question' }; setStatus(t, 'waiting'); notifyNeeds(t, `${A.name} has a question`, 'waiting'); return; }
  if (e.type === 'done') {
    t.finishedAt = now();
    setStatus(t, 'done');
    if (onTask(t)) { celebrate($('#next-step .ns-axel') || $('#task-title')); announce(`${A.name} finished. ${t.files.length} files ready for review.`); }
    else if (state.notify.done) toast(`<strong>${esc(t.title)}</strong> is ready for review`, { axo: 'done', background: true, action: { label: 'Review', run: () => navigate(`#/task/${t.id}/changes`) } });
    if (state.notify.done) desktopNotify(t, `${t.title} is ready for review`, `${A.name} finished. ${plural(t.files.length, 'changed file')} to review.`);
    return;
  }
  refreshLive(t);
  scheduleNext(t);
}
function onTask(t, tab) {
  const r = state.route;
  return r && r.parts[0] === 'task' && r.parts[1] === t.id && (!tab || (r.parts[2] || 'activity') === tab);
}
function notifyNeeds(t, msg, mood) {
  desktopNotify(t, t.title, msg.replace(/<[^>]+>/g, ''));
  if (onTask(t)) { announce(msg); return; }
  if (state.notify.needs) toast(msg, { axo: mood || 'wave', background: true, action: { label: 'Review', run: () => navigate(`#/task/${t.id}`) } });
}
/** A task that fails while you're elsewhere says so (in the page, and outside it if you turned that on). */
function notifyFailed(t) {
  if (isFolded(t) || !state.notify.needs) return;
  const fi = failInfo(t);
  desktopNotify(t, `${t.title} stopped`, fi.title);
  if (onTask(t)) return;
  toast(`<strong>${esc(t.title)}</strong> stopped: ${esc(fi.title)}`, { axo: 'failed', background: true, action: { label: 'See what happened', run: () => navigate(`#/task/${t.id}`) } });
}
/** A system notification while AX Studio is in the background (Settings → Notifications, off by default).
    Browsers only allow it on a secure address, such as AX Studio running on this computer (localhost). */
function desktopNotify(t, title, body) {
  if (!state.notify.desktop || typeof document === 'undefined' || !document.hidden) return;
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const n = new Notification(title, { body, tag: 'ax-' + t.id, icon: 'assets/logo.svg' });
      n.onclick = () => { window.focus(); navigate(`#/task/${t.id}`); n.close(); };
    }
  } catch (e) { /* not supported here */ }
}
function celebrate(el) {
  if (state.notify.party === false || !el) return;
  const r = el.getBoundingClientRect();
  confetti(r.left + r.width / 2, r.top + r.height / 2);
}
function pushEvent(t, e) {
  evId(e);
  t.events.push(e);
  /* The Log tab follows the task live. */
  refreshRawLog(t);
  /* The event count sits in the tab bar, so it stays current on every tab of this task. */
  if (onTask(t)) { const ac = $('#act-count'); if (ac) ac.textContent = plural(t.events.length, 'event'); }
  if (!onTask(t, 'activity')) return;
  const tl = $('#timeline');
  if (!tl) return;
  const nearBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 260;
  const i = t.events.length - 1;
  tl.insertAdjacentHTML('beforeend', evHTML(t, e, i, true));
  const li = tl.lastElementChild;
  if (e.type === 'thought') typeThought(li, e.text);
  if (!nearBottom) return;
  /* An event that needs you (a blocked request, a question, a permission prompt, a failure) puts its decision in Your
     next step. Don't drag the page to the very bottom then: on a short Activity that would push the card under the top
     bar. Scroll only as far as needed to show the event. */
  if (/^(blocked|question|permission|fail)$/.test(e.type)) {
    const over = li.getBoundingClientRect().bottom + 16 - window.innerHeight;
    if (over > 0) window.scrollBy({ top: over, behavior: reducedMotion() ? 'auto' : 'smooth' });
    return;
  }
  window.scrollTo({ top: document.documentElement.scrollHeight, behavior: reducedMotion() ? 'auto' : 'smooth' });
}
function replaceEvent(t, i) {
  const li = $(`#timeline [data-ev="${i}"]`);
  if (li) li.outerHTML = evHTML(t, t.events[i], i);
}
function typeThought(li, text) {
  const el = li && li.querySelector('.ev-text');
  if (!el) return;
  if (reducedMotion()) { el.textContent = text; return; }
  let k = 0;
  const iv = setInterval(() => {
    if (!document.contains(el)) { clearInterval(iv); return; }
    k = Math.min(text.length, k + 3);
    el.innerHTML = esc(text.slice(0, k)) + (k < text.length ? '<span class="caret"></span>' : '');
    if (k >= text.length) clearInterval(iv);
  }, 18);
}
function setStatus(t, s) {
  const prev = t.status;
  t.status = s;
  /* Leaving a failure: the old failure card in Activity now says it was fixed (no stale "See Your next step"). */
  if (prev === 'failed' && s !== 'failed') { const f = lastFail(t); if (f) { f.e.fixedAt = now(); replaceEvent(t, f.i); } t.retryAt = 0; }
  if (s !== 'waiting') t.needs = null;
  refreshAfterStatus(t);
  if (s === 'failed' && prev !== 'failed') notifyFailed(t);
  if (t.env === 'local' && ACTIVE.includes(prev) && !ACTIVE.includes(s)) setTimeout(dequeue, 0);
}
/* Where the task is lives in its header (v12) and, once the header scrolls away, in the top bar. Update both in place;
   when the task moves on to the next stage, the current bar pops once (this replaces Axel's glide on the old track). */
const stageShown = {};
function updateJourney(t) {
  refreshTopbarTask(t);
  if (!t || !onTask(t)) return;
  const i = stageOf(t);
  const prev = stageShown[t.id];
  stageShown[t.id] = i;
  const el = $('#th-progress');
  if (!el || !el.classList) return;
  const html = journeyHTML(t);
  if (el._h !== html) { el.innerHTML = html; el._h = html; }
  if (prev != null && i > prev && !reducedMotion()) {
    el.classList.remove('advanced');
    void el.offsetWidth;
    el.classList.add('advanced');
    clearTimeout(el._advT);
    el._advT = setTimeout(() => el.classList.remove('advanced'), 900);
  }
}
/** After part of the task page is redrawn, put the existing Axel back (moved to his new mood) so he doesn't restart. */
function keepAxel(oldAx, scope) {
  if (!oldAx || !oldAx.innerHTML || !scope || !scope.querySelector) return;
  const nu = scope.querySelector('svg.axo');
  if (!nu || nu === oldAx || !nu.parentNode) return;
  const mood = nu.dataset ? nu.dataset.axo : null;
  nu.replaceWith(oldAx);
  if (mood && typeof updateAxoInPlace === 'function') updateAxoInPlace(oldAx, mood);
}
/* ---------- Next step (right column) and attention on the task tabs ---------- */
/** When the next step turns into something that needs you, it arrives with one soft pulse. */
function markArrival(prevTone) {
  const nu = $('#next-step');
  if (!nu || !nu.dataset || !nu.classList) return;
  if (prevTone && prevTone !== nu.dataset.tone && /^(attn|fail)$/.test(nu.dataset.tone) && !reducedMotion()) nu.classList.add('arrive');
}
/** Redraw the right column (next step, where it runs, reach, usage). */
function renderSide(t) {
  const side = $('#task-side'); if (!side) return;
  const prev = $('#next-step');
  const prevTone = prev && prev.dataset ? prev.dataset.tone : null;
  side.innerHTML = taskSideHTML(t);
  markArrival(prevTone);
}
/** Keep the next step current between status changes: stage, changed files, a queued message, setup progress. */
function refreshNextStep(t) {
  if (!onTask(t)) return;
  const el = $('#next-step');
  if (!el || !el.parentElement) return;
  const html = nextStepHTML(t);
  if (el._h === html) return;
  const prevTone = el.dataset ? el.dataset.tone : null;
  const a = document.activeElement;
  const fk = a && el.contains && el.contains(a) ? focusKeyOf(a) : null;
  const oldAx = el.querySelector ? el.querySelector('svg.axo') : null;
  el.outerHTML = html;
  const nu = $('#next-step'); if (nu) nu._h = html;
  keepAxel(oldAx, nu);
  markArrival(prevTone);
  if (fk) restoreFocus(fk);
}
/** Add, change or remove the attention dot on the Activity and Changes tabs (never on the tab you're on). */
function updateTabAttn(t) {
  if (!onTask(t)) return;
  const tab = taskTab(t);
  ['activity', 'changes'].forEach((k) => {
    const a = $('#tab-' + k);
    if (!a || !a.querySelector) return;
    const want = tabAttnOf(t, k, tab);
    const cur = a.querySelector('.tab-attn');
    if (cur && want && cur.dataset && cur.dataset.kind === want.kind) return;
    if (cur && cur.remove) cur.remove();
    const sr = a.querySelector('.sr-attn'); if (sr && sr.remove) sr.remove();
    if (want) a.insertAdjacentHTML('beforeend', tabAttnHTML(want, true));
  });
}
function refreshAfterStatus(t) {
  updateChrome();
  const r = state.route || { parts: [] };
  const top = r.parts[0];
  if (!top) { if (!isTypingIn('#main')) render({ keepScroll: true, background: true }); return; }
  if (top === 'tasks') { const tb = $('#tasks-table'); if (tb) tb.innerHTML = tasksTableHTML(); return; }
  if (top === 'task' && (r.parts[1] === t.id || (t.compareWith && r.parts[1] === t.compareWith))) {
    const cur = getTask(r.parts[1]);
    if (!cur) return;
    const tab = r.parts[2] || 'activity';
    if (tab === 'changes') { render({ keepScroll: true, background: true }); return; }
    const head = $('#task-head'); if (head) head.innerHTML = taskHeadHTML(cur);
    if (cur.id === t.id) {
      updateJourney(t);
      renderSide(t);
      updateTabAttn(t);
      const tail = $('#live-tail'); if (tail) tail.innerHTML = workingHTML(t);
      const steer = $('#steer');
      if (steer) {
        const A = AGENTS[t.agent];
        const kid = handedOff(t) ? getTask(t.child) : null;
        steer.disabled = t.status === 'failed' || !!kid;
        steer.placeholder = kid ? `This task continues with ${AGENTS[kid.agent].name}` : t.status === 'done' ? `Ask ${A.name} for a follow-up…` : t.status === 'failed' ? 'Fix the problem above to continue' : `Tell ${A.name} what to change or focus on…`;
        const btn = steer.parentElement.querySelector('button'); if (btn) btn.disabled = steer.disabled;
      }
      const hint = $('#steer-hint'); if (hint) hint.innerHTML = steerHintHTML(t);
      refreshLive(t);
    }
  }
}
function refreshLive(t) {
  if (onTask(t)) {
    updateJourney(t);
    refreshNextStep(t);
    const c = $('#count-changes');
    if (c) c.textContent = t.files.length;
    else if (t.files.length) { const tab = $('#tab-changes'); if (tab) tab.insertAdjacentHTML('beforeend', `<span class="count" id="count-changes">${t.files.length}</span>`); }
    const cost = costFor(t), budget = budgetFor(t);
    const ur = $('#usage-ring'); if (ur) ur.innerHTML = ring(Math.min(1, cost / budget), '$' + cost.toFixed(2), 'of $' + budget, cost / budget > 0.8 ? 'var(--coral)' : 'var(--key)');
    const ut = $('#usage-tokens'); if (ut) ut.textContent = fmtTokens(t.tokens) + ' tokens';
    const us = $('#usage-spark'); if (us) us.innerHTML = sparkline(sparkFor(t), 160, 34);
    const ru = $('#res-usage'); if (ru) ru.innerHTML = resourceHTML(t);
    updateTabAttn(t);
    refreshRawLog(t);
  }
  const nowEl = $(`#now-${t.id}`); if (nowEl) nowEl.innerHTML = nowLine(t);
  const mj = $(`#row-${t.id} .mini-journey`); if (mj) mj.outerHTML = journeyHTML(t, true);
}
function isTypingIn(sel) {
  const a = document.activeElement;
  return a && a.closest(sel) && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') && a.value;
}
/* ---------- Task progress stays visible (v11, v12) ----------
   The task header shows the task's status and a mini track of where it is (v12: no separate progress track). Once that
   row scrolls under the sticky top bar, the top bar swaps its breadcrumb for the task's status, title and mini track.
   No extra bar and no layout shift: the two cross-fade in place. */
function refreshTopbarTask(t) {
  const tb = $('#tb-task');
  if (!tb) return;
  const r = state.route;
  const cur = r && r.parts[0] === 'task' ? getTask(r.parts[1]) : null;
  if (t && cur && t.id !== cur.id) return;
  const html = cur ? topbarTaskHTML(cur) : '';
  if (tb._h !== html) { tb.innerHTML = html; tb._h = html; }
}
let dockRaf = 0;
/* ---------- Home on day 0: Axel nudges you to start your first task ----------
   Focus the goal box and he gets curious; type and he cheers you on; pick an idea and he celebrates. Until you do
   anything, he wags (after 2 s), then wags again with a gentle "Psst!" (12 s later). One line at a time, never
   repeated back to back. */
const FIRST_LINES = {
  focus: { mood: 'thinking', text: 'Ooh, what are we building? Describe the outcome, like “Fix the failing tests.”' },
  typing: { mood: 'working', text: 'Love it. Pick a template, then press Enter to set up the rest.' },
  idea: { mood: 'done', text: 'Great pick! Press Enter and I’ll set it up.' },
  idle: { mood: 'wave', text: 'Psst! Not sure where to start? Pick an idea below, or type your own goal.' },
};
function homeNudge(kind) {
  const L = FIRST_LINES[kind];
  if (!L || !$('.first-stage') || state.homeNudged === kind) return;
  state.homeNudged = kind;
  state.axelSpeech = { text: L.text, at: Date.now() };
  const sp = $('.first-stage .speech');
  if (sp) { sp.classList.remove('still'); sp.textContent = L.text; sp.style.animation = 'none'; void sp.offsetWidth; sp.style.animation = ''; }
  const svg = $('#hero-axo'); if (svg && typeof updateAxoInPlace === 'function') updateAxoInPlace(svg, L.mood);
}
let firstNudgeT = 0;
function startFirstNudge() {
  if (firstNudgeT) return;
  let n = 0;
  const tick = () => {
    const svg = $('.first-stage #hero-axo');
    if (!svg || state.homeNudged || n >= 2) { firstNudgeT = 0; return; }
    n++;
    if (typeof axoWag === 'function' && !reducedMotion()) axoWag(svg);
    /* Still nothing after the second wag: a gentle "Psst!" toward the ideas (only where there's a goal box). */
    if (n === 2) { if ($('.first-quick')) homeNudge('idle'); firstNudgeT = 0; return; }
    firstNudgeT = setTimeout(tick, 12000);
  };
  firstNudgeT = setTimeout(tick, 2200);
}
/* ---------- Dropdown selects (selectHTML in views.js) ----------
   They work like a regular select. Focus stays on the box; the highlighted option is aria-activedescendant. The open
   list is kept in state.openSelect, so a background redraw (a task changing status) re-draws it open, in place. */
const SELECT_PICK = {
  'quick-agent': (v) => {
    const q = $('#quick-goal'); if (q) state.quickGoal = q.value;
    if (v !== 'byo') { state.quickAgent = v; return; }
    const goal = (state.quickGoal || '').trim();
    state.draft = null; state.quickGoal = '';
    navigate(`#/new?find=byo${goal ? '&goal=' + encodeURIComponent(goal) : ''}`);
  },
  /* Guardrails: which workspace a new site applies to. Keeps what you typed across the redraw. */
  'allow-scope': (v) => { const i = $('#new-domain'); if (i) state.allowDraft = i.value; state.allowScope = v; },
};
/** Guardrails: a task waiting on a site you just allowed carries on, instead of waiting for an Allow that's already
    given. Returns the tasks that resumed. Organization blocks can't be allowed, so they never resume here. */
function resumeWaitingOn(domain, scope) {
  return state.tasks.filter((t) => {
    if (scope !== 'all' && t.repo !== scope) return false;
    const b = openBlock(t);
    if (!b || b.e.domain !== domain || b.e.policy) return false;
    allowRequest(t, b.i, { quiet: true });
    return true;
  });
}
function carriesOn(ts) { return !ts.length ? '' : ts.length === 1 ? `. <strong>${esc(ts[0].title)}</strong> carries on` : `. ${ts.length} tasks carry on`; }
/** Guardrails: allow a site you typed, for all workspaces or one. Every outcome is real: a site that's already allowed,
    isn't a site name, or is blocked by your organization says so under the field, and nothing is added. */
function addAllowedSite(raw, scopeIn) {
  const v = String(raw || '').trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
  const scope = scopeIn && scopeIn !== 'all' ? scopeIn : 'all';
  const where = scope === 'all' ? 'for all workspaces' : `for the ${esc(scope)} workspace`;
  const say = (text, err) => { state.allowDraft = String(raw || ''); state.allowMsg = { text, err: !!err }; render({ keepScroll: true }); return false; };
  if (!/^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v)) return say('Enter a site name, like docs.example.com.', true);
  if (state.orgBlocked.includes(v)) return say(`<span class="mono">${esc(v)}</span> is blocked by your organization's policy. Ask ${esc(state.org.admin)} if you need it.`, true);
  const preset = GUARDRAIL_PRESETS[state.guardrailPreset] || GUARDRAIL_PRESETS.balanced;
  if (presetSites().some((a) => a.domain === v)) return say(`<span class="mono">${esc(v)}</span> is already included in ${esc(preset.name)}.`);
  if (state.allow.some((a) => a.domain === v && a.scope === 'org')) return say(`<span class="mono">${esc(v)}</span> is already allowed by your organization.`);
  if (state.allow.some((a) => a.domain === v && a.by === 'You' && a.scope === 'all')) return say(`<span class="mono">${esc(v)}</span> is already allowed for all workspaces.`);
  if (scope !== 'all' && state.allow.some((a) => a.domain === v && a.by === 'You' && a.scope === scope)) return say(`<span class="mono">${esc(v)}</span> is already allowed ${where}.`);
  /* Allowing a site everywhere replaces the narrower rules you had for it. */
  const before = state.allow.length;
  if (scope === 'all') state.allow = state.allow.filter((a) => !(a.domain === v && a.by === 'You'));
  const widened = state.allow.length < before;
  state.allow.push({ domain: v, scope, by: 'You', at: now() });
  state.allowDraft = ''; state.allowMsg = null;
  const resumed = resumeWaitingOn(v, scope);
  render({ keepScroll: true });
  toast((widened ? `<span class="mono">${esc(v)}</span> is now allowed for all workspaces` : `Allowed <span class="mono">${esc(v)}</span> ${where}`) + carriesOn(resumed), { icon: 'shieldCheck' });
  return true;
}
const selParts = (key) => { const btn = document.getElementById('sel-' + key); return btn ? { btn, list: document.getElementById('sel-' + key + '-list'), wrap: btn.closest('.sel') } : null; };
const selOpts = (list) => (list ? [...list.querySelectorAll('[role="option"]')] : []);
function openSelect(key, active) {
  if (state.openSelect && state.openSelect.key !== key) closeSelect();
  const p = selParts(key);
  if (!p || !p.list) return;
  const opts = selOpts(p.list);
  const cur = opts.find((o) => o.getAttribute('aria-selected') === 'true') || opts[0];
  state.openSelect = { key, active: active || (cur && cur.dataset.value) };
  p.list.hidden = false;
  p.btn.setAttribute('aria-expanded', 'true');
  if (p.wrap) p.wrap.classList.add('open', 'anim');
  setSelActive(key, state.openSelect.active);
}
function closeSelect() {
  const s = state.openSelect;
  if (!s) return;
  state.openSelect = null;
  const p = selParts(s.key);
  if (!p) return;
  if (p.list) p.list.hidden = true;
  p.btn.setAttribute('aria-expanded', 'false');
  p.btn.removeAttribute('aria-activedescendant');
  if (p.wrap) p.wrap.classList.remove('open', 'anim');
}
function setSelActive(key, value) {
  const p = selParts(key);
  if (!p || !p.list || !state.openSelect || state.openSelect.key !== key) return;
  state.openSelect.active = value;
  let el = null;
  selOpts(p.list).forEach((o) => { const on = o.dataset.value === value; o.classList.toggle('is-active', on); if (on) el = o; });
  if (!el) return;
  p.btn.setAttribute('aria-activedescendant', el.id);
  /* Keep the highlighted option in view inside the list, without scrolling the page. */
  const L = p.list;
  if (el.offsetTop < L.scrollTop) L.scrollTop = el.offsetTop - 6;
  else if (el.offsetTop + el.offsetHeight > L.scrollTop + L.clientHeight) L.scrollTop = el.offsetTop + el.offsetHeight - L.clientHeight + 6;
}
/** Pick an option: close the list, apply the choice (if it changed) and keep focus on the box. */
function pickSelect(key, value, keepFocus) {
  const p = selParts(key);
  const same = !!(p && p.list && selOpts(p.list).some((o) => o.dataset.value === value && o.getAttribute('aria-selected') === 'true'));
  closeSelect();
  /* A pick that opens another page (Your own agent… on Home) leaves the redraw to that page load. */
  if (!same && SELECT_PICK[key]) { const h = location.hash; SELECT_PICK[key](value); if (location.hash === h) render({ keepScroll: true }); }
  if (keepFocus !== false) { const b = document.getElementById('sel-' + key); if (b && b !== document.activeElement) b.focus(); }
}
let selTyped = '', selTypedAt = 0;
/** Keyboard for a focused dropdown (APG select-only combobox). Returns true when it handled the key. */
function selKeydown(e, btn) {
  const key = btn.dataset.key;
  const p = selParts(key);
  if (!p || !p.list) return false;
  const opts = selOpts(p.list);
  const vals = opts.map((o) => o.dataset.value);
  if (!vals.length) return false;
  const open = !!(state.openSelect && state.openSelect.key === key);
  const selected = (opts.find((o) => o.getAttribute('aria-selected') === 'true') || opts[0]).dataset.value;
  const cur = open ? state.openSelect.active : selected;
  const k = Math.max(0, vals.indexOf(cur));
  const move = (i) => setSelActive(key, vals[Math.max(0, Math.min(vals.length - 1, i))]);
  /* Typing a name opens the list and jumps to the first match; typing the same letter again cycles through matches. */
  if (e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    if (!open) openSelect(key);
    const t = Date.now();
    selTyped = (t - selTypedAt < 700 ? selTyped : '') + e.key.toLowerCase();
    selTypedAt = t;
    const names = opts.map((o) => (o.querySelector('.sel-txt b') || o).textContent.trim().toLowerCase());
    const same = selTyped.split('').every((c) => c === selTyped[0]);
    const q = same ? selTyped[0] : selTyped;
    const from = same ? k + 1 : k;
    for (let i = 0; i < vals.length; i++) { const j = (from + i) % vals.length; if (names[j].startsWith(q)) { move(j); break; } }
    return true;
  }
  if (!open) {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); openSelect(key); return true; }
    if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); openSelect(key, e.key === 'Home' ? vals[0] : vals[vals.length - 1]); return true; }
    return false;
  }
  switch (e.key) {
    case 'ArrowDown': e.preventDefault(); if (!e.altKey) move(k + 1); return true;
    case 'ArrowUp': e.preventDefault(); if (e.altKey) pickSelect(key, cur); else move(k - 1); return true;
    case 'Home': e.preventDefault(); move(0); return true;
    case 'End': e.preventDefault(); move(vals.length - 1); return true;
    case 'PageDown': e.preventDefault(); move(k + 10); return true;
    case 'PageUp': e.preventDefault(); move(k - 10); return true;
    case 'Enter': case ' ': e.preventDefault(); pickSelect(key, cur); return true;
    case 'Escape': e.preventDefault(); closeSelect(); return true;
    case 'Tab': pickSelect(key, cur, false); return true; /* no preventDefault: focus moves on as usual */
    default: return false;
  }
}
function updateDock() {
  dockRaf = 0;
  const bar = $('.topbar');
  if (!bar || !bar.classList || !bar.getBoundingClientRect) return;
  const r = state.route;
  /* Dock once the header's status and progress row scrolls under the top bar (v12: the header holds the progress). */
  const j = r && r.parts[0] === 'task' ? $('#th-progress') : null;
  const edge = bar.getBoundingClientRect().bottom || 54;
  /* Dock as soon as half the header's status row is under the top bar, so it's never half hidden. */
  const docked = !!j && typeof j.getBoundingClientRect().bottom === 'number' && (j.getBoundingClientRect().top + j.getBoundingClientRect().bottom) / 2 < edge;
  if (bar.classList.contains('docked') !== docked) bar.classList.toggle('docked', docked);
}
window.addEventListener('scroll', () => { if (!dockRaf) dockRaf = requestAnimationFrame(updateDock) || 0; }, { passive: true });
window.addEventListener('resize', () => { if (!dockRaf) dockRaf = requestAnimationFrame(updateDock) || 0; });
let simsStarted = false;
function startSims() {
  if (simsStarted) return;
  simsStarted = true;
  state.tasks.forEach((t) => { if (t.status === 'running') scheduleNext(t); });
}

/* ---------- Task actions ---------- */
function allowRequest(t, i, opts) {
  if (!t) return;
  const e = t.events[i];
  if (!e || e.resolved) return;
  e.resolved = 'allowed';
  if (!siteAllowed(e.domain, t.repo)) state.allow.push({ domain: e.domain, scope: t.repo, by: 'You', at: now(), task: t.id });
  replaceEvent(t, i);
  if (!(opts && opts.quiet)) toast(`Allowed <span class="mono">${esc(e.domain)}</span> for the ${esc(t.repo)} workspace`, { icon: 'shieldCheck' });
  setStatus(t, 'running');
  scheduleNext(t);
}
function allowOnceRequest(t, i) {
  if (!t) return;
  const e = t.events[i];
  if (!e || e.resolved) return;
  e.resolved = 'once';
  replaceEvent(t, i);
  toast(`Allowed <span class="mono">${esc(e.domain)}</span> once (not saved to allowlist)`, { icon: 'shieldCheck' });
  setStatus(t, 'running');
  scheduleNext(t);
}
function denyRequest(t, i) {
  if (!t) return;
  const e = t.events[i];
  if (!e || e.resolved) return;
  e.resolved = 'denied';
  t._denied = true;
  replaceEvent(t, i);
  setStatus(t, 'running');
  setTimeout(() => {
    pushEvent(t, { type: 'thought', at: now(), text: "Understood. I'll write the limiter config without the reference." });
    refreshLive(t);
    scheduleNext(t);
  }, 900);
}
function answerTask(t, text) {
  if (!t) return;
  const q = openQuestion(t);
  if (!q || !text) return;
  q.e.answer = text;
  replaceEvent(t, q.i);
  pushEvent(t, { type: 'user', at: now(), text, answerTo: true });
  t.script = 'answer'; t.step = 0;
  setStatus(t, 'running');
  scheduleNext(t);
  if (!onTask(t)) toast(`Sent to ${AGENTS[t.agent].name}. It's back to work.`, { axo: 'working' });
}
function pauseTask(t, quiet) {
  if (!t || t.status !== 'running') return;
  clearTimeout(t._timer);
  pushEvent(t, { type: 'paused', at: now() });
  t.needs = { type: 'paused' };
  setStatus(t, 'waiting');
  refreshQueued(t);
  if (!quiet) toast(`Paused. ${AGENTS[t.agent].name} will pick up exactly where it stopped.`, { axo: 'sleeping', action: { label: 'Resume', run: () => resumeTask(t) } });
}
/* ---------- Permission prompts inside the sandbox ----------
   Decision: by default agents run without asking inside their sandbox (Guardrails still controls the network and keys).
   With "Ask before risky commands" on, a risky step (deleting many files, rewriting git history, force-pushing) waits
   for your OK in Studio: Allow once, Allow for this task, or Don't allow (the agent carries on without it). */
function askFirst(t, step) {
  if (!step.risky || state.permMode !== 'ask' || t.permForTask || t._permOk === t.step) return false;
  const ev = typeof step.ev === 'function' ? step.ev(t) : step.ev;
  clearTimeout(t._timer);
  pushEvent(t, { type: 'permission', at: now(), cmd: ev.cmd, why: step.risky, step: t.step });
  t.needs = { type: 'permission' };
  setStatus(t, 'waiting');
  notifyNeeds(t, `${AGENTS[t.agent].name} wants to run <span class="mono">${esc(ev.cmd)}</span>`, 'waiting');
  return true;
}
function openPermission(t) { for (let i = t.events.length - 1; i >= 0; i--) { const e = t.events[i]; if (e.type === 'permission' && !e.resolved) return { e, i }; } return null; }
function resolvePermission(t, i, how) {
  const e = t && t.events[i];
  if (!e || e.type !== 'permission' || e.resolved) return;
  e.resolved = how;
  replaceEvent(t, i);
  const A = AGENTS[t.agent];
  if (how === 'denied') {
    t.step = e.step + 1;   /* skip the risky step */
    setStatus(t, 'running');
    pushEvent(t, { type: 'thought', at: now(), text: `Okay, I won't run ${e.cmd}. I'll carry on without it.` });
    refreshLive(t);
    scheduleNext(t);
    return;
  }
  if (how === 'task') t.permForTask = true;
  t._permOk = e.step;
  toast(how === 'task' ? `${esc(A.name)} won't ask again during this task. Guardrails still checks the network.` : `Allowed once. ${esc(A.name)} is running it in the sandbox.`, { icon: 'shieldCheck' });
  setStatus(t, 'running');
  scheduleNext(t);
}
/** Stop a task for good (ax stop). The agent ends, and its changes stay in the sandbox to review, ship or
    continue: a message starts a new turn in the same sandbox, so nothing is lost and no confirmation is needed. */
function stopTask(t) {
  if (!t || !(ACTIVE.includes(t.status) || NEEDS_YOU.includes(t.status)) || t.status === 'failed') return;
  clearTimeout(t._timer);
  const A = AGENTS[t.agent];
  t.events.forEach((e, i) => {
    if (e.type === 'question' && !e.answer && !e.superseded) { e.superseded = true; replaceEvent(t, i); }
    if (e.type === 'blocked' && !e.resolved) { e.resolved = 'superseded'; replaceEvent(t, i); }
    if (e.type === 'permission' && !e.resolved) { e.resolved = 'denied'; replaceEvent(t, i); }
    if (e.type === 'budget' && !e.resolved) { e.resolved = 'stopped'; replaceEvent(t, i); }
  });
  pushEvent(t, { type: 'stopped', at: now() });
  t.stopped = true; t.finishedAt = now(); t.handoffFailed = false;
  setStatus(t, 'done');
  refreshQueued(t);
  const n = t.files.length;
  toast(`Stopped ${esc(A.name)}. ${n ? `${plural(n, 'changed file')} ${n === 1 ? 'is' : 'are'} kept for review.` : 'Nothing was changed.'}`, { icon: 'stop' });
}
function resumeTask(t) {
  if (!t || !(t.status === 'waiting' && t.needs && t.needs.type === 'paused')) return;
  t.handoffFailed = false;
  pushEvent(t, { type: 'resumed', at: now() });
  setStatus(t, 'running');
  refreshQueued(t);
  scheduleNext(t);
}
/** Queued messages show "Pause instead" only while the task runs, so redraw them when it pauses or resumes. */
function refreshQueued(t) { t.events.forEach((e, i) => { if (e.type === 'user' && e.delivery === 'queued') replaceEvent(t, i); }); }
function steerTask(t, text, sendNow) {
  if (!t || !text) return;
  if (t.status === 'waiting' && t.needs && t.needs.type === 'question') { answerTask(t, text); return; }
  const live = t.status === 'running' || (t.status === 'waiting' && t.needs && (t.needs.type === 'permission' || t.needs.type === 'budget'));
  pushEvent(t, Object.assign({ type: 'user', at: now(), text }, live ? { delivery: 'queued' } : {}));
  /* "Send now" interrupts the current step; the default waits for the next turn. A harness that can't take
     input mid-turn always waits. */
  if (sendNow && t.status === 'running' && !t.noMidTurn) {
    interruptTask(t, t.events.length - 1);
    refreshNextStep(t);
    announce(`Sent now. ${AGENTS[t.agent].name} stopped its current step to read it.`);
    return;
  }
  if (t.status === 'waiting' && t.needs && t.needs.type === 'paused') { setStatus(t, 'running'); scheduleNext(t); }
  if (t.status === 'done') {
    t.script = 'followup'; t.step = 0; t.finishedAt = null; t.startedAt = now(); t.pushed = false; t.stopped = false;
    setStatus(t, 'running'); scheduleNext(t);
    return;
  }
  if (live) refreshNextStep(t);
  if (live) announce(`Queued for the next turn. ${AGENTS[t.agent].name} reads it when it finishes its current step.`);
}
/** F6: queued messages are delivered at the next turn boundary (the next simulated step). */
function deliverQueued(t) {
  let delivered = false;
  t.events.forEach((e, i) => {
    if (e.type === 'user' && e.delivery === 'queued') { e.delivery = 'delivered'; replaceEvent(t, i); delivered = e.text; }
  });
  if (delivered) pushEvent(t, { type: 'thought', at: now(), text: `Got your message at the start of my next turn: ${quoted(delivered)} Adjusting my plan.` });
  return !!delivered;
}
function interruptTask(t, i) {
  const e = t && t.events[i];
  if (!e || e.delivery !== 'queued') return;
  e.delivery = 'interrupted';
  replaceEvent(t, i);
  clearTimeout(t._timer);
  pushEvent(t, { type: 'thought', at: now(), text: `Stopping my current step to read your message: ${quoted(e.text)}` });
  refreshLive(t);
  scheduleNext(t);
}
function retryTask(t, note) {
  if (!t) return;
  const A = AGENTS[t.agent];
  const f = lastFail(t);
  const code = (f && f.e.code) || 'key-rejected';
  if (code === 'key-rejected' && !A.connected) { openKeyDialog(t.agent, t.id); return; }
  if (code === 'handoff-start') {
    state.flags.handoffFail = false;
    /* Retrying a failed handoff: if it now starts, the source task is handed off again and the attempt unfolds. */
    const src = t.parent && getTask(t.parent);
    if (src && src.handoffFailed && src.failedChild === t.id) {
      if (src.failedAgents) delete src.failedAgents[t.agent];
      src.handoffFailed = false; src.failedChild = null; src.child = t.id; src.status = 'done'; src.needs = null; src.finishedAt = now();
      pushEvent(src, { type: 'note', at: now(), text: `Handed off to ${A.name}` });
    }
    t.foldedInto = null;
  }
  pushEvent(t, { type: 'note', at: now(), text: note || (code === 'key-rejected' ? `Retrying cleanly with your ${A.maker} sign-in` : 'Retrying from the saved workspace') });
  t.script = 'generic'; t.step = 0; t.startedAt = now(); t.failCode = null;
  setStatus(t, 'starting');
  /* Retrying without fixing repo access fails the same way: the cause hasn't changed. */
  if (code === 'repo-denied' && !t.repoAccess) {
    setTimeout(() => { pushEvent(t, Object.assign({}, f.e, { at: now() })); setStatus(t, 'failed'); }, 1600);
    return;
  }
  setTimeout(() => { setStatus(t, 'running'); scheduleNext(t); }, 1600);
}
/* CUJ 4: continue a task with another agent. Task A stops cleanly at the end of its turn (only one agent is active at
   a time), and a new task B starts with the same goal in the same workspace state: every file, uncommitted change, the
   git history and installed dependencies. B starts a new conversation; A's Activity can be attached for reference. */
function handoffTask(t, agentId, note, opts) {
  opts = opts || {};
  clearTimeout(t._timer);
  const B = AGENTS[agentId];
  const id = 't' + state.nextId++;
  const fail = !!state.flags.handoffFail;
  const prevStatus = t.status;
  const firstUser = t.events.find((e) => e.type === 'user');
  const carried = t.files.map((f) => { const s = diffStats(f.lines); return { path: f.path, add: s.add, del: s.del }; });
  const nt = {
    id, title: t.title, agent: agentId, status: 'starting', env: t.env, cluster: t.cluster, repo: t.repo, folder: t.folder, branch: t.branch,
    startedAt: now(), tokens: 0, files: t.files.slice(), script: 'generic', step: 0, parent: t.id,
    size: t.size, preset: t.preset, budget: t.budget, skills: t.skills, mcp: t.mcp,
    events: [{ type: 'handoff', at: now(), from: t.id, fromAgent: t.agent, note: note || '', goal: firstUser ? firstUser.text : t.title,
      files: carried, share: opts.share !== false, live: ACTIVE.includes(prevStatus), stoppedEarly: !!opts.stoppedEarly }],
  };
  t.child = id;
  state.flags.slowTurn = false;
  supersedeDecisions(t, `No longer needed. The task continued with ${B.name}.`);
  if (t.status !== 'done') { pushEvent(t, { type: 'note', at: now(), text: ACTIVE.includes(prevStatus) ? `Stopped at the end of its turn and handed off to ${B.name}` : `Handed off to ${B.name}` }); t.finishedAt = now(); t.status = 'done'; t.needs = null; }
  else pushEvent(t, { type: 'note', at: now(), text: `Handed off to ${B.name}` });
  state.tasks.unshift(nt);
  navigate(`#/task/${id}`);
  const pickUp = toast(`${B.name} is picking up where ${AGENTS[t.agent].name} left off`, { icon: 'handoff' });
  setTimeout(() => {
    if (fail) {
      state.flags.handoffFail = false;
      if (typeof pickUp === 'function') pickUp();
      toast(`${B.name} couldn't start. ${AGENTS[t.agent].name}'s work is untouched.`, { icon: 'alert' });
      /* Remembered on the source task, so "Try another agent" lists this one last and says it just failed. */
      t.failedAgents = Object.assign({}, t.failedAgents, { [agentId]: now() });
      pushEvent(nt, { type: 'fail', at: now(), code: 'handoff-start' });
      setStatus(nt, 'failed');
      /* CUJ 5: Task A's state is untouched — put it back as a paused task the builder can resume. */
      if (prevStatus !== 'done') { t.status = 'waiting'; t.needs = { type: 'paused' }; t.finishedAt = null; t.handoffFailed = true; t.failedChild = nt.id; nt.foldedInto = t.id; }
      t.child = null;
      pushEvent(t, { type: 'note', at: now(), text: `${B.name} didn't start, so nothing changed here. This workspace is untouched.` });
      refreshAfterStatus(t);
      return;
    }
    setStatus(nt, 'running'); scheduleNext(nt);
  }, 1500);
}
/** Close any decision the task was still waiting on (a question, a site, a risky command, the budget), with why. */
function supersedeDecisions(t, note) {
  t.events.forEach((e, i) => {
    const open = (e.type === 'question' && !e.answer && !e.superseded) || (['blocked', 'permission', 'budget'].includes(e.type) && !e.resolved);
    if (!open) return;
    if (e.type === 'question') e.superseded = true; else e.resolved = 'superseded';
    e.supersededNote = note;
    replaceEvent(t, i);
  });
}
/** The task that holds the workspace now: follow the handoffs from `t` to the last one. */
function currentOf(t) { let k = t; const seen = {}; while (k && handedOff(k) && !seen[k.id]) { seen[k.id] = 1; k = getTask(k.child); } return k; }
/** Take a handed-off task back: the agent that has the workspace now stops at the end of its turn, and the first
    agent continues in a new task with every change (the same handoff, in the other direction). */
function takeBack(t) {
  if (!t || !handedOff(t)) return;
  const cur = currentOf(t);
  if (!cur || cur === t || cur.agent === t.agent) return;
  const n = cur.files.length;
  handoffTask(cur, t.agent, `Taken back from ${AGENTS[cur.agent].name}.${n ? ` ${plural(n, 'file')} changed so far.` : ''}`, { share: true });
}
/** F9: keep one compared run; mark the other "not kept" (restorable for 7 days) and go to review. */
function keepRun(t, which) {
  const sib = t.compareWith && getTask(t.compareWith);
  closeDialog(true);
  if (sib) {
    const keep = which === 'self' ? t : sib, drop = which === 'self' ? sib : t;
    keep.notKept = false; keep.keptRun = true; drop.notKept = true; drop.keptRun = false;
    if (ACTIVE.includes(drop.status)) { clearTimeout(drop._timer); pushEvent(drop, { type: 'note', at: now(), text: `Stopped: you kept ${AGENTS[keep.agent].name}'s run` }); drop.status = 'done'; drop.finishedAt = now(); }
    updateChrome();
    navigate(`#/task/${keep.id}/changes`);
    toast(`Kept ${AGENTS[keep.agent].name}'s run. ${AGENTS[drop.agent].name}'s sandbox is marked not kept (restorable for 7 days).`, { icon: 'award', action: { label: 'Undo', run: () => restoreRun(drop) } });
    return;
  }
  if (!t.altRun) return;
  if (which === 'other') swapAltRun(t);
  t.altRun.notKept = true; t.keptRun = true;
  navigate(`#/task/${t.id}/changes`);
  render({ keepScroll: true });
  toast(`Kept ${AGENTS[t.agent].name}'s run. ${AGENTS[t.altRun.agent].name}'s run is marked not kept (restorable for 7 days).`, { icon: 'award', action: { label: 'Undo', run: () => { t.altRun.notKept = false; t.keptRun = false; render({ keepScroll: true }); } } });
}
function restoreRun(x) {
  if (!x) return;
  x.notKept = false;
  const other = x.compareWith && getTask(x.compareWith);
  if (other) other.keptRun = false;
  render({ keepScroll: true });
  updateChrome();
  toast(`Restored ${AGENTS[x.agent].name}'s run. Both runs are back in review.`, { icon: 'undo' });
}
function pushTask(t, el) {
  if (!t) return;
  /* AX pushes with your GitHub sign-in: without one, sign in first (then it pushes), or download a patch. */
  if (!state.github.connected) { openFailureDialog('github-needed', t, 'Sign in to GitHub to push'); return; }
  if (state.flags.pushRejected) {
    pushEvent(t, { type: 'note', at: now(), text: "Push to GitHub didn't go through: your GitHub sign-in expired (401)" });
    openFailureDialog('push-rejected', t, "Push didn't go through"); return;
  }
  const sel = state.diffSel[t.id] || { discarded: {} };
  const kept = filesFor(t).filter((f) => !sel.discarded[f.path]).length;
  const origin = el && el.getBoundingClientRect ? el.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 };
  t.pushed = true;
  t.events.push({ type: 'pushed', at: now(), branch: t.branch });
  render({ keepScroll: true });
  if (state.notify.party !== false) confetti(origin.left + origin.width / 2, origin.top + origin.height / 2);
  toast(`Shipped ${plural(kept, 'file')} to <span class="mono">${esc(t.branch)}</span>`, { icon: 'checkCircle' });
}
/** Apply kept files to your folder. A conflict belongs to the files (checked on every Apply), and what was applied is
    recorded on the task, in Activity and in Your next step. */
function applyTask(t, opts) {
  if (!t) return;
  opts = opts || {};
  if (state.flags.applyConflict) { t.conflictPaths = conflictFiles(t); state.flags.applyConflict = false; }
  const done = appliedPaths(t);
  const todo = keptFiles(t).filter((f) => !done.includes(f.path)).map((f) => f.path);
  const clashing = todo.filter((p) => (t.conflictPaths || []).includes(p));
  if (clashing.length && !opts.skipConflicts) { openFailureDialog('apply-conflict', t, "Couldn't apply cleanly"); return; }
  const paths = todo.filter((p) => !clashing.includes(p));
  if (!paths.length) { toast(clashing.length ? 'No other files to apply. Push a branch to merge the conflicting files.' : 'Everything you kept is already in your folder.', { icon: 'folder' }); return; }
  t.applied = { at: now(), paths: done.concat(paths) };
  pushEvent(t, { type: 'applied', at: now(), paths, folder: t.folder, conflicts: clashing });
  render({ keepScroll: true });
  toast(`Applied ${plural(paths.length, 'file')} to <span class="mono">${esc(t.folder)}</span>${clashing.length ? `. ${plural(clashing.length, 'conflicting file stays', 'conflicting files stay')} in the sandbox.` : ''}`, { icon: 'folder', action: { label: 'Undo', run: () => unapplyTask(t, paths) } });
}
function unapplyTask(t, paths) {
  if (!t || !t.applied) return;
  t.applied.paths = t.applied.paths.filter((p) => !paths.includes(p));
  if (!t.applied.paths.length) t.applied = null;
  pushEvent(t, { type: 'note', at: now(), text: `Took ${plural(paths.length, 'file')} back out of ${t.folder}. ${paths.length === 1 ? 'It is' : 'They are'} still in the sandbox.` });
  render({ keepScroll: true });
  toast(`Took the changes back out of <span class="mono">${esc(t.folder)}</span>. They're still in the sandbox.`, { icon: 'undo' });
}
/** Open a pull request for a pushed branch. Records its number and link on the task. */
function openPullRequest(t) {
  if (!t || !t.pushed || t.pr) return;
  if (!state.github.connected) { openFailureDialog('github-needed', t, 'Sign in to GitHub to open a pull request'); return; }
  const done = toast('Opening a pull request on github.com…', { icon: 'loader', timeout: 1400 });
  setTimeout(() => {
    if (typeof done === 'function') done();
    const n = 100 + (parseInt(String(t.id).replace(/\D/g, ''), 10) || 0) * 7 % 400;
    t.pr = { number: n, url: `https://github.com/acme/${t.repo}/pull/${n}`, at: now() };
    pushEvent(t, { type: 'pr', at: now(), number: n, url: t.pr.url, branch: t.branch });
    render({ keepScroll: true });
    toast(`Opened pull request #${n} for <span class="mono">${esc(t.branch)}</span>`, { icon: 'pr' });
  }, 1400);
}
function forkCompareTask(t, agentId) {
  const B = AGENTS[agentId];
  if (!t || !B) return;
  const firstUser = t.events.find((e) => e.type === 'user');
  const goal = firstUser ? firstUser.text : t.title;
  const id = 't' + state.nextId++;
  const nt = {
    id, title: t.title, agent: agentId, status: 'starting', env: t.env, cluster: t.cluster,
    repo: t.repo, folder: t.folder, branch: `${t.branch}-${B.id}`,
    startedAt: now(), tokens: 0, files: [], script: 'generic', step: 0, compareWith: t.id,
    events: [
      { type: 'user', at: now(), text: goal },
      { type: 'note', at: now(), text: `Isolated comparison sandbox #2 started alongside ${AGENTS[t.agent].name} (${t.id})` },
    ],
  };
  t.compareWith = id;
  state.tasks.unshift(nt);
  navigate(`#/task/${id}`);
  toast(`Racing ${B.name} vs ${AGENTS[t.agent].name} in separate sandboxes`, { icon: 'compare' });
  setTimeout(() => { setStatus(nt, 'running'); scheduleNext(nt); }, 1500);
}
function swapAltRun(t) {
  if (!t || !t.altRun) return;
  const prev = {
    agent: t.agent,
    tokens: t.tokens,
    durationLabel: t.finishedAt ? Math.max(1, Math.round((t.finishedAt - t.startedAt) / MIN)) + 'm' : fmtElapsed(t.startedAt),
    tests: 'All checks passed',
    summary: `${AGENTS[t.agent].name}'s isolated sandbox run (${filesFor(t).length} files).`,
    files: filesFor(t),
  };
  const next = t.altRun;
  t.agent = next.agent;
  t.tokens = next.tokens;
  t.files = next.files;
  t.spark = null;
  t.altRun = prev;
  delete state.diffSel[t.id];
  render({ keepScroll: true });
  toast(`Switched diff view to ${AGENTS[t.agent].name}'s isolated run`, { icon: 'compare' });
}
/* CUJ 5: the same task file starts a fresh run on the remote cluster. The run on this computer stops at the end
   of its step; its conversation stays in Activity, and the new session starts from the pushed branch (or the last pushed
   commit) without it. Carrying live work over is P1. */
function promoteTask(t, cluster, opts) {
  opts = opts || {};
  clearTimeout(t._timer);
  t.env = 'cluster'; t.cluster = cluster; t.queued = null;
  setTimeout(dequeue, 0);
  /* Anything the old session was waiting on (a question, a site to allow, a pause) belonged to the run on this
     computer. The fresh run starts without it, so mark those as no longer needed and start running. */
  t.events.forEach((e, i) => {
    if (e.type === 'question' && !e.answer && !e.superseded) { e.superseded = true; replaceEvent(t, i); }
    if (e.type === 'blocked' && !e.resolved) { e.resolved = 'superseded'; replaceEvent(t, i); }
    if (e.type === 'budget' && !e.resolved) { e.resolved = 'superseded'; replaceEvent(t, i); }
  });
  t.handoffFailed = false;
  const from = opts.fromBase ? opts.fromBase : opts.fromLast ? null : (opts.from || t.branch);
  t.freshFromBase = !!opts.fromBase;
  const without = opts.without || [];
  if (without.length && t.mcp) t.mcp = t.mcp.filter((x) => !without.includes(x));
  pushEvent(t, { type: 'moved', at: now(), cluster, from, fromLast: !!opts.fromLast, without: without.map(mcpName) });
  /* The new session re-orients on the branch, finishes the goal and runs the tests (a short, repo-agnostic script). */
  t.script = 'fresh'; t.step = 0; t.finishedAt = null; t.startedAt = now(); t.freshFromLast = !!opts.fromLast || !!opts.fromBase;
  t.stopped = false; t.pushed = false; t.pr = null; t.applied = null;
  /* The cluster rebuilds the workspace from the workspace setup. Show each step, the same way the first
     run's setup shows (clone, skills, MCP servers, setup command, agent), then the new session starts. */
  const A = AGENTS[t.agent];
  const mk = (ic, verb, what, s) => ({ ic, todo: `${verb[0]} ${what}`, now: `${verb[1]} ${what}`, t: `${verb[2]} ${what}`, s });
  const sk = t.skills || [], mcp = t.mcp || ['github'];
  const steps = [
    mk('cloud', ['Start', 'Starting', 'Started'], `a sandbox on ${cluster}`, "Agent Substrate · your organization's guardrails attached"),
    mk('branch', ['Clone', 'Cloning', 'Cloned'], `acme/${t.repo} at ${from || 'the last pushed commit'}`, 'Through the team-agents credential · no token in the sandbox'),
    sk.length ? mk('sparkle', ['Add', 'Adding', 'Added'], plural(sk.length, 'skill'), sk.join(', ')) : null,
    mcp.length ? mk('server', ['Start', 'Starting', 'Started'], plural(mcp.length, 'MCP server'), `${mcp.map(mcpName).join(', ')} · tokens come from your organization's vault`) : null,
    mk('terminal', ['Run', 'Running', 'Ran'], 'your setup command', 'From your workspace setup'),
    mk('play', ['Start', 'Starting', 'Started'], `${A.name} in a new session`, "Same goal · the earlier conversation stays on this computer"),
  ].filter(Boolean);
  t.hydrate = {
    steps, i: 0, t0: now(), cluster,
    summary: [`acme/${t.repo} at ${from || 'the last pushed commit'}`].concat(sk.length ? [plural(sk.length, 'skill')] : [], mcp.length ? [plural(mcp.length, 'MCP server')] : []).join(' · '),
    title: `Rebuilding the workspace on ${cluster}`,
    sub: `From the same task file. ${A.name} starts a fresh run as soon as it's ready.`,
    after: () => pushEvent(t, { type: 'thought', at: now(), text: `New session on ${cluster}. I don't have the earlier conversation, so I'm re-reading the goal and the code${from ? ` on ${from}` : ''} before I pick the next step.` }),
  };
  t.needs = null;
  if (t.status !== 'starting') setStatus(t, 'starting');
  else refreshAfterStatus(t);
  runHydration(t);
  toast(`Fresh run starting on ${esc(cluster)} from the same task file.`, { icon: 'cloudUp' });
}
/** What connecting GitHub changes. The sign-in is saved once (keychain, added outside the sandbox), and a New
    task workspace picks up the GitHub MCP server, as every new workspace does from then on. Returns whether it was added. */
function finishGithubConnect() {
  connectGithub();
  const d = state.draft;
  const added = !!(d && parseRoute().parts[0] === 'new' && d.source !== 'sample' && !d.mcp.includes('github'));
  if (added) d.mcp = ['github'].concat(d.mcp);
  return added;
}
/* ---------- Workspace hydration ----------
   Before the agent's first turn, AX sets up the sandbox from the Workspace spec and shows each step: the code, AGENTS.md
   and instructions, skills, MCP servers, the setup command, then the agent with its model. Each step has a to-do, an
   in-progress and a done label. When it's ready, the checklist folds into one "set up the workspace" Activity entry. */
const HYDRATE_MS = 430;
function hydrationSteps(t, d) {
  const A = AGENTS[t.agent];
  const f = d.source === 'folder' ? FOLDERS[d.folderIdx] : null;
  const step = (ic, verb, what, s, extra) => Object.assign({ ic, todo: `${verb[0]} ${what}`, now: `${verb[1]} ${what}`, t: `${verb[2]} ${what}`, s }, extra || {});
  const steps = [];
  /* A template that's still downloading doesn't fail the run. The task waits for it, and says so. */
  if (isDownloading(t.agent)) steps.push(step('download', ['Download', 'Downloading', 'Downloaded'], `the ${A.name} template`, `${A.cli}:${t.version}`, { dl: true }));
  steps.push(t.env === 'cluster'
    ? step('cloud', ['Start', 'Starting', 'Started'], `a sandbox on ${t.cluster}`, `Agent Substrate · ${runnerLabel()} · your organization's guardrails`)
    : step('box', ['Start', 'Starting', 'Started'], 'a secure sandbox', `microVM · ${runnerLabel()} · your folder stays untouched`));
  if (d.source === 'folder') {
    const where = `${t.env === 'cluster' ? clusterSource(d).replace('https://', '') : f.path} at ${t.baseBranch}`;
    steps.push(step('folder', t.env === 'cluster' ? ['Clone', 'Cloning', 'Cloned'] : ['Copy', 'Copying', 'Copied'], where,
      `${f.files}${!f.clean && t.env !== 'cluster' ? (d.includeUncommitted ? ` · with your ${f.dirty} uncommitted changes` : ' · from the last commit') : ''}`));
  } else if (d.source === 'git') {
    steps.push(step('branch', ['Clone', 'Cloning', 'Cloned'], `${d.git.replace(/^https?:\/\//, '').replace(/\.git$/, '')} at ${t.baseBranch}`, 'Signed in through Guardrails · no token in the sandbox'));
  } else {
    steps.push(step('box', ['Copy', 'Copying', 'Copied'], 'the sample to-do app', 'ax-sample-todo · 3 failing tests'));
  }
  const extra = draftSpec(d).extraRepos;
  if (extra.length) steps.push(step('layers', ['Add', 'Adding', 'Added'], plural(extra.length, 'read-only repo'), extra.join(', ')));
  const mdLines = d.source === 'folder' ? f.agentsMd : d.source === 'sample' ? SAMPLE.agentsMd : null;
  const md = d.useAgentsMd && mdLines !== 0;
  const mine = (d.instructions || '').trim();
  if (md || mine) steps.push(step('file', ['Add', 'Adding', 'Added'], md && mine ? 'AGENTS.md and your instructions' : md ? 'AGENTS.md' : 'your instructions', md && mdLines ? `${mdLines} lines of project instructions` : md ? 'From the repo' : mine.slice(0, 60)));
  /* Inline files from the workspace setup; one that looks like it holds a secret was never added. */
  const files = cleanFiles(d.inlineFiles).filter((x) => !fileHasSecret(x));
  if (files.length) steps.push(step('file', ['Add', 'Adding', 'Added'], `${plural(files.length, 'file')} from your setup`, files.map((x) => x.path.trim()).join(', ')));
  const sk = d.skills || [];
  const mcp = d.mcp || [];
  /* CUJ 2: "An MCP server / skill fails to start" → which one, its log, and Edit the Workspace setup. */
  const gap = skillGaps(sk, mcp)[0];
  steps.push(step('sparkle', ['Add', 'Adding', 'Added'], plural(sk.length, 'skill'), sk.join(', '),
    gap ? { fail: 'skill-failed', failAt: 'skills', skill: gap.id, needs: gap.needs, failT: `Skill “${gap.name}” didn't load`,
      failS: `${sk.filter((x) => x !== gap.id).join(', ') || 'Nothing else'} loaded. ${gap.name} needs the ${mcpName(gap.needs)} MCP server.` } : null));
  if (mcp.length) {
    const TOOLS = { github: 3, linear: 5, postgres: 2, playwright: 4 };
    const failId = mcp.find(mcpNeedsSignIn);
    const started = mcp.filter((x) => !mcpNeedsSignIn(x)).map((id) => `${mcpName(id)} started`).join(', ');
    steps.push(step('server', ['Start', 'Starting', 'Started'], plural(mcp.length, 'MCP server'), `${mcp.map((id) => `${mcpName(id)} (${TOOLS[id] || 2} tools)`).join(', ')} · tokens added outside the sandbox`,
      failId ? { fail: 'mcp-failed', failAt: 'MCP servers', server: failId, failT: `${mcpName(failId)} MCP server didn't start`, failS: `${started || 'Nothing else to start'}. ${mcpName(failId)} needs you to sign in.` } : null));
  }
  const setup = draftSetup(d), det = detectedSetup(d);
  const cmd = setup === 'auto' ? 'npm ci' : setup;
  steps.push(step('terminal', ['Run', 'Running', 'Ran'], cmd, setup === 'auto' ? 'Found package-lock.json after cloning' : setup === det.cmd && det.from ? `Detected from ${det.from}` : 'Your setup command', { slow: true }));
  const vars = parseEnvVars(d.envVars).filter((x) => !x.secret);
  if (vars.length) steps.push(step('sliders', ['Set', 'Setting', 'Set'], plural(vars.length, 'environment variable'), vars.map((x) => x.k).join(', ')));
  const mn = modelName(t);
  steps.push(step('play', ['Start', 'Starting', 'Started'], `${A.name}${mn ? ` with ${mn}` : ''}`, `${t.version === 'dev' ? 'Local build' : 'v' + t.version}${A.image ? '' : t.pin === 'latest' ? ' · latest' : ' · pinned'} · sign-in added outside the sandbox`));
  return steps;
}
/** One line for the Activity entry: shop-api at main · AGENTS.md · 1 skill · GitHub MCP server · npm ci. */
function hydrationSummary(t, d) {
  const code = d.source === 'folder' ? `${FOLDERS[d.folderIdx].repo} at ${t.baseBranch}` : d.source === 'git' ? `${draftRepo(d).repo} at ${t.baseBranch}` : 'Sample to-do app';
  return [code].concat(workspaceBits(d).map((b) => (b === 'setup found after cloning' ? 'npm ci' : b))).join(' · ');
}
function refreshHydrate(t) {
  if (onTask(t)) {
    const tail = $('#live-tail'); if (tail) tail.innerHTML = workingHTML(t);
    updateJourney(t);
    refreshNextStep(t);
  }
  const nowEl = $(`#now-${t.id}`); if (nowEl) nowEl.innerHTML = nowLine(t);
}
/* Capacity: a task that doesn't fit waits; when room frees up (a task finishes, fails, pauses or moves), the oldest
   queued task starts on its own. */
function queueTask(t) {
  t.queued = now();
  pushEvent(t, { type: 'note', at: now(), text: `Queued: tasks on this computer are using ${localMemInUse(t)} of ${LOCAL_MEM_GB} GB. It starts on its own when there is room.` });
  refreshAfterStatus(t);
}
function dequeue() {
  const q = state.tasks.filter((x) => x.queued && x.env === 'local').sort((a, b) => a.queued - b.queued)[0];
  if (!q || localFull(q)) return;
  q.queued = null;
  pushEvent(q, { type: 'note', at: now(), text: 'There is room on this computer now, so the task started.' });
  if (onTask(q)) announce(`${q.title} started. There was room on this computer.`);
  if (q.hydrate) runHydration(q); else { setStatus(q, 'running'); scheduleNext(q); }
}
function runHydration(t) {
  if (t.queued) return;
  const h = t.hydrate;
  if (!h) { setStatus(t, 'running'); scheduleNext(t); return; }
  const tick = () => {
    if (t.status !== 'starting' || t.hydrate !== h) return;
    const cur = h.steps[h.i];
    if (cur.dl && isDownloading(t.agent)) { t._timer = setTimeout(tick, 400); return; }
    if (cur.fail) {
      /* CUJ 2: an MCP server or skill that fails to start names itself, shows its log, and offers "Edit workspace setup". */
      const items = h.steps.slice(0, h.i).map((s) => ({ t: s.t, s: s.s })).concat({ t: cur.failT, s: cur.failS, failed: true });
      t.hydrate = null;
      pushEvent(t, { type: 'workspace', at: now(), failed: true, items, summary: `Stopped at ${cur.failAt || 'MCP servers'} · ${plural(h.i, 'step')} done` });
      const fe = { type: 'fail', at: now(), code: cur.fail };
      ['server', 'skill', 'needs'].forEach((k) => { if (cur[k]) fe[k] = cur[k]; });
      pushEvent(t, fe);
      setStatus(t, 'failed');
      return;
    }
    h.i++;
    if (h.i >= h.steps.length) {
      const secs = ((now() - h.t0) / 1000).toFixed(1);
      t.hydrate = null;
      pushEvent(t, { type: 'workspace', at: now(), items: h.steps.map((s) => ({ t: s.t, s: s.s })), secs, summary: h.summary, cluster: h.cluster });
      if (h.after) h.after();
      setStatus(t, 'running');
      scheduleNext(t);
      if (onTask(t)) announce(h.cluster ? `Workspace rebuilt on ${h.cluster} in ${secs} seconds. ${AGENTS[t.agent].name} is starting a fresh run.` : `Workspace ready in ${secs} seconds. ${AGENTS[t.agent].name} is starting its first turn.`);
      return;
    }
    refreshHydrate(t);
    const ms = state.hydrateMs || HYDRATE_MS;   /* state.hydrateMs paces a narrated recording */
    t._timer = setTimeout(tick, reducedMotion() ? 120 : (h.steps[h.i].slow ? ms * 1.8 : ms));
  };
  refreshHydrate(t);
  /* state.hydrateFirstMs lets a narrated recording hold the first step while the voice introduces the setup. */
  t._timer = setTimeout(tick, reducedMotion() ? 120 : (state.hydrateFirstMs || state.hydrateMs || HYDRATE_MS));
}
async function createTaskFromDraft() {
  const d = state.draft;
  if (!d) return;
  const goal = (d.goal || '').trim();
  const A = AGENTS[d.agent];
  /* Checks follow the page's order (template, where, workspace, goal), so the first thing flagged is the first step. */
  if (!A.connected) {
    toast(`Sign in to ${esc(A.name)} first. You only do this once.`, { icon: 'key' });
    const k = $('#agent-signin') || $('#key-input'); if (k) { k.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' }); k.focus({ preventScroll: true }); }
    return;
  }
  const B = d.compare ? AGENTS[d.agent2] : null;
  if (B && !B.connected) { openKeyDialog(B.id); toast(`Sign in to ${esc(B.name)} first to run a comparison.`, { icon: 'key' }); return; }
  if (d.env === 'local' && !localReady()) { toast("This computer isn't set up yet. Finish setup, or run on a remote cluster.", { icon: 'laptop', action: { label: 'Finish setup', run: () => { state.setup = { phase: 'before', step: 0, pick: d.agent, path: 'local' }; navigate('#/welcome'); } } }); return; }
  /* A template built on this computer (folder or Git) isn't in a registry yet, so a remote cluster can't pull it. */
  const localOnly = [A, B].find((x) => x && x.localOnly);
  if (d.env === 'cluster' && localOnly) {
    toast(`${esc(localOnly.name)} was built on this computer, so it runs here for now. Publish it to your team registry to run it on a cluster.`, { icon: 'laptop', action: localReady() ? { label: 'Run here', run: () => { d.env = 'local'; render({ keepScroll: true }); } } : null });
    return;
  }
  if (d.source === 'git' && !/^https?:\/\/|^git@/.test(d.git)) { toast('Add a Git URL, or choose a folder', { icon: 'info' }); const gu = $('#git-url'); if (gu) gu.focus(); return; }
  if (!goal) {
    d.error = 'Describe what the agent should do.';
    const err = $('#goal-err'); if (err) err.innerHTML = icon('alert', 'sm') + esc(d.error);
    const g = $('#goal'); if (g) { g.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' }); g.focus({ preventScroll: true }); g.setAttribute('aria-invalid', 'true'); }
    return;
  }
  if (d.env === 'cluster' && !state.env.clusterConnected) { openConnectCluster(() => createTaskFromDraft()); return; }
  const r = draftRepo(d);
  /* The task title is the goal's first line or sentence (prompt-help lines like "Done when: …" go on their own lines). */
  const first = goal.split(/\n|(?<=[.!?:])\s/)[0].trim().replace(/:$/, '');
  const title = first.length > 72 ? first.slice(0, 70).replace(/\s+\S*$/, '') + '…' : first.replace(/[.]$/, '');
  const baseBranch = branchFor(title);
  const clusterName = d.env === 'cluster' ? state.env.cluster : undefined;
  const spec = draftSpec(d);
  const recipe = { size: d.size, preset: d.preset || state.guardrailPreset, budget: Math.max(1, Number(d.budget) || 5), mcp: d.mcp.slice(), skills: d.skills.slice(), baseBranch: spec.branch || 'main', extraRepos: spec.extraRepos, setup: spec.setup, setupFrom: spec.setupFrom, pin: d.pin,
    inlineFiles: cleanFiles(d.inlineFiles).filter((x) => !fileHasSecret(x)).map((x) => ({ path: x.path.trim(), content: x.content || '' })) };
  const mk = (agentId, extra) => {
    const X = AGENTS[agentId];
    const m = agentId === d.agent ? draftModel(d) : modelOf(agentId, null);
    const t = Object.assign({
      id: 't' + state.nextId++, title, agent: agentId, model: m ? m.id : undefined, version: d.pin === 'latest' && !X.image ? (X.latest || X.version) : X.version,
      status: 'starting', env: d.env, cluster: clusterName, repo: r.repo, folder: r.path, startedAt: now(), tokens: 0, files: [], script: 'generic', step: 0,
      events: [{ type: 'user', at: now(), text: goal }],
    }, recipe, extra || {});
    t.hydrate = { steps: hydrationSteps(t, d), i: 0, t0: now(), summary: hydrationSummary(t, d) };
    return t;
  };
  if (B) {
    const t = mk(d.agent, { branch: `${baseBranch}-${d.agent}` });
    const t2 = mk(B.id, { branch: `${baseBranch}-${B.id}`, compareWith: t.id });
    t2.events.push({ type: 'note', at: now(), text: `Isolated comparison sandbox #2 running in parallel with ${A.name} (${t.id})` });
    t.compareWith = t2.id;
    state.tasks.unshift(t, t2);
    state.draft = null;
    navigate(`#/task/${t.id}`);
    toast(`Started 2 separate sandboxes: ${A.name} vs ${B.name}`, { icon: 'compare' });
    runHydration(t);
    setTimeout(() => runHydration(t2), 300);
    return;
  }
  const t = mk(d.agent, { branch: baseBranch });
  state.tasks.unshift(t);
  state.draft = null;
  navigate(`#/task/${t.id}`);
  if (t.env === 'local' && localFull(t)) queueTask(t); else runHydration(t);
}

/* ---------- Terminal ---------- */
function hostAllowed(t, host) {
  return reachFor(t).some((a) => a.domain === host || (a.domain.startsWith('*.') && host.endsWith(a.domain.slice(1))));
}
function termRun(t, cmd) {
  const L = termInit(t);
  const files = filesFor(t);
  const c = cmd.trim();
  L.push(`<span class="p">rajitha@${esc(t.repo)}</span><span class="m">:/workspace (${esc(t.branch)}) $</span> ${esc(c)}`);
  let out = '';
  if (!c) out = '';
  else if (c === 'help') out = 'Try: ls · git status · git diff --stat · npm test · env · curl &lt;site&gt; · clear · exit';
  else if (c === 'ls') out = t.repo === 'shop-api' ? 'README.md  package.json  src/  test/  tsconfig.json' : 'README.md  src/  tests/';
  else if (c === 'git status') out = files.length ? `On branch ${esc(t.branch)}\nChanges not staged for commit:\n` + files.map((f) => `  <span class="y">${f.kind === 'new' ? 'new file:' : 'modified:'}   ${esc(f.path)}</span>`).join('\n') : `On branch ${esc(t.branch)}\nnothing to commit, working tree clean`;
  else if (c.startsWith('git diff')) out = files.length ? files.map((f) => { const s = diffStats(f.lines); return ` ${esc(f.path)} | ${s.add + s.del} <span class="g">${'+'.repeat(Math.min(s.add, 24))}</span><span style="color:#ff8a8a">${'-'.repeat(Math.min(s.del, 12))}</span>`; }).join('\n') + `\n ${files.length} files changed` : '';
  else if (c === 'npm test' || c === 'pytest') out = '<span class="g">PASS</span> test/rateLimit.test.ts\n<span class="g">PASS</span> test/checkout.test.ts\n\nTests: <span class="g">14 passed</span>, 14 total';
  else if (c === 'env' || c.startsWith('printenv')) out = 'HOME=/home/agent\nPATH=/usr/local/bin:/usr/bin:/bin\nHTTPS_PROXY=http://guardrails:3128\n<span class="m"># 0 API keys here. Guardrails injects approved credentials outside this sandbox.</span>';
  else if (c === 'ax doctor') out = '<span class="g">✓</span> Guest sandbox verified: copy-on-write clean · 0 raw secrets · Guardrails proxy active.';
  else if (/^curl\s+/.test(c)) {
    const host = c.split(/\s+/).filter((x) => !x.startsWith('-')).pop().replace(/^https?:\/\//, '').split('/')[0];
    if (hostAllowed(t, host)) out = `<span class="g">200 OK</span> · ${esc(host)}`;
    else if (state.orgBlocked.includes(host)) out = `<span class="y">Blocked by Guardrails:</span> ${esc(host)} is blocked by your organization's policy.`;
    else out = `<span class="y">Paused by Guardrails (${esc(state.guardrailPreset)}):</span> ${esc(host)} isn't on this workspace's allowlist.\n<span class="m">  Allow once in Studio, or run: ax allow ${esc(host)} --workspace ${esc(t.repo)}</span>`;
  } else if (c === 'clear') { state.term[t.id] = []; out = null; }
  else if (c === 'exit') out = '<span class="m">Detached. The agent keeps running in its isolated sandbox.</span>';
  else out = `${esc(c.split(' ')[0])}: command not found <span class="m">(try “help”)</span>`;
  if (out) state.term[t.id].push(out);
  render({ keepScroll: true });
  const inp = $('#term-input'); if (inp) inp.focus({ preventScroll: true });
}

/* ---------- Router ---------- */
function parseRoute() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = h.split('?');
  return { path, parts: path.split('/').filter(Boolean), q: new URLSearchParams(qs || '') };
}
function navigate(h) { if (location.hash === h) render(); else location.hash = h; }
/* The full address for route h. A bare '#/…' resolves against the page's base URL, and inside an iframe srcdoc
   (how Artifacts shows HTML) that is the host page, so location.replace('#/…') would load the host page instead. */
function routeUrl(h) { return location.href.split('#')[0] + h; }
function setupDone() { try { return localStorage.getItem('ax.setup') === '1'; } catch (e) { return true; } }
let lastPath = null;
const RENDER_HOLD_MAX = 6000;
let renderHeld = 0, renderHeldSince = 0, renderHeldOpts = null;
/** Called by Axel between two tricks: if a held refresh is overdue, run it now, before the next trick starts. */
function axoOnTrickEnd() {
  if (renderHeld && Date.now() - renderHeldSince >= RENDER_HOLD_MAX) render(Object.assign({}, renderHeldOpts, { background: false }));
}
/* A stable description of the focused control that survives a re-render: its id, its slot in a radio group or
   tab list (groups are matched by aria-label, aria-labelledby or id), or its data-action + data-* attributes. */
function focusKeyOf(el) {
  if (!el || el === document.body || el === document.documentElement || !document.contains(el)) return null;
  if (el.id) return { id: el.id };
  const g = el.closest('[role="radiogroup"], [role="tablist"]');
  if (g) {
    const attr = ['aria-label', 'aria-labelledby', 'id'].find((a) => g.getAttribute(a));
    if (attr) { const role = g.getAttribute('role') === 'tablist' ? 'tab' : 'radio'; return { group: [attr, g.getAttribute(attr)], role, index: [...g.querySelectorAll(`[role="${role}"]`)].indexOf(el) }; }
  }
  if (el.dataset && el.dataset.action) return { action: el.dataset.action, data: JSON.stringify(el.dataset) };
  if (el.getAttribute && el.getAttribute('href')) { const sc = el.closest('[id]:not(a)'); return { href: el.getAttribute('href'), scope: sc ? sc.id : null }; }
  if (el.form && el.form.dataset && el.form.dataset.form && el.type === 'submit') return { form: el.form.dataset.form };
  return null;
}
function restoreFocus(k) {
  if (!k) return;
  let el = null;
  if (k.id) el = document.getElementById(k.id);
  else if (k.group) {
    const g = [...document.querySelectorAll('[role="radiogroup"], [role="tablist"]')].find((x) => x.getAttribute(k.group[0]) === k.group[1]);
    if (g) {
      const items = [...g.querySelectorAll(`[role="${k.role}"]`)];
      el = items.find((x) => x.getAttribute(k.role === 'tab' ? 'aria-selected' : 'aria-checked') === 'true') || items[k.index];
    }
  } else if (k.action) el = [...document.querySelectorAll(`[data-action="${k.action}"]`)].find((x) => JSON.stringify(x.dataset) === k.data);
  else if (k.href) { const sc = k.scope && document.getElementById(k.scope); el = [...(sc || document).querySelectorAll('a[href]')].find((x) => x.getAttribute('href') === k.href) || [...document.querySelectorAll('a[href]')].find((x) => x.getAttribute('href') === k.href); }
  else if (k.form) el = document.querySelector(`[data-form="${k.form}"] [type="submit"]`);
  if (el && el !== document.activeElement && !el.disabled) el.focus({ preventScroll: true });
}
/** Inside the Studio app, the page has a bridge to this computer and shows real data from AX (live.js). */
function liveOn() { return typeof LIVE !== 'undefined' && LIVE.on; }
function render(opts) {
  opts = opts || {};
  if (liveOn()) { liveRender(opts); return; }
  /* Background refreshes (simulated agent progress, sandbox health) wait while Axel is mid-wag or mid-trick, so a click
     on him is never cut off by the page redrawing underneath. Anything the person does renders at once (see axoYield in
     the click handler). After 6 s a held refresh is overdue, and it runs in the next gap between tricks — never mid-trick. */
  if (opts.background && typeof axoBusy === 'function' && axoBusy()) {
    if (!renderHeldSince) renderHeldSince = Date.now();
    const overdue = Date.now() - renderHeldSince >= RENDER_HOLD_MAX;
    if (!overdue || Date.now() < axoStreak.endsAt) {
      renderHeldOpts = opts;
      clearTimeout(renderHeld);
      renderHeld = setTimeout(() => render(opts), Math.max(80, (overdue ? axoStreak.endsAt : axoStreak.animUntil) - Date.now() + 40));
      return;
    }
  }
  clearTimeout(renderHeld);
  renderHeld = 0;
  renderHeldSince = 0;
  renderHeldOpts = null;
  const r = parseRoute();
  state.route = r;
  if (!setupDone() && r.parts[0] !== 'welcome' && r.parts[0] !== 'cuj' && r.parts[0] !== 'review' && r.parts[0] !== 'get') { location.replace(routeUrl('#/welcome')); return; }
  if (!opts.keepScroll) { closeDialog(true); closeBell(); state.openSelect = null; }
  let v;
  switch (r.parts[0]) {
    case undefined: v = viewHome(); break;
    case 'welcome': v = viewSetup(); break;
    case 'cuj': state.cuj = 1; v = viewCuj1(); break;
    case 'new': v = viewNew(r.q); break;
    case 'task': v = viewTask(r.parts[1], r.parts[2]); break;
    case 'guardrails': v = viewGuardrails(); break;
    case 'places': v = viewPlaces(); break;
    case 'tasks': v = viewTasks(); break;
    case 'settings': v = viewSettings(r.parts[1]); break;
    case 'review': v = viewReview(); break;
    case 'get': v = viewGet(); break;
    default: v = viewNotFound();
  }
  const root = $('#root');
  const active = document.activeElement;
  const aid = active && active.id;
  const fk = focusKeyOf(active);
  let sel = null;
  try { sel = active && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null; } catch (e) { sel = null; }
  if (v.full) {
    if (!patchSetupDOM(v.html)) root.innerHTML = v.html;
  } else {
    if (!$('.app', root)) { root.innerHTML = shellHTML(); startSims(); }
    if (!(r.parts[0] === 'task' && patchTaskDOM(v, r))) {
      const prevHero = !r.parts[0] && $('#hero-axo');
      const keepHero = prevHero && prevHero.innerHTML ? prevHero : null;
      $('#main').innerHTML = `<div class="content ${v.wide ? 'wide' : ''} ${opts.keepScroll ? '' : 'view-enter'}">${v.html}</div>`;
      if (keepHero) {
        const nextHero = $('#hero-axo');
        if (nextHero && nextHero.parentNode) {
          const targetMood = nextHero.dataset.axo;
          nextHero.replaceWith(keepHero);
          if (typeof updateAxoInPlace === 'function') updateAxoInPlace(keepHero, targetMood);
        }
      }
      if (!opts.keepScroll) countUp($('#main'));
    }
    renderCrumbs(v.crumbs || []);
    updateChrome();
    refreshTopbarTask();
    updateDock();
  }
  updateThemeToggle();
  state.docTitle = v.title + ' · AX Studio';
  document.title = v.full ? state.docTitle : titleWithNeeds();
  /* Re-renders replace the DOM. Put keyboard focus back on the same control (or the newly chosen option in a
     radio group / tab list) so keyboard and screen-reader users never get dropped back to the top of the page. */
  if (opts.keepScroll || r.path === lastPath) {
    restoreFocus(fk);
    const el = aid && document.getElementById(aid);
    if (el && el === document.activeElement && sel && el.setSelectionRange) { try { el.setSelectionRange(sel[0], sel[1]); } catch (e) { /* ignore */ } }
  }
  if (!opts.keepScroll && r.path !== lastPath) {
    if (lastPath !== null && typeof pruneToasts === 'function') pruneToasts();
    window.scrollTo(0, 0);
    if (lastPath !== null) { const h = $('#main h1'); if (h) h.focus({ preventScroll: true }); }
    lastPath = r.path;
  }
  if (v.after) v.after();
}
function renderCrumbs(crumbs) {
  const c = $('#crumbs');
  if (!c) return;
  c.innerHTML = crumbs.map((x, k) => (k ? icon('chevRight', 'xs') : '') + (x.href ? `<a href="${x.href}">${esc(x.label)}</a>` : `<span class="here" aria-current="page">${esc(x.label)}</span>`)).join('');
}
function updateChrome() {
  if (!$('.app')) return;
  const top = (state.route && state.route.parts[0]) || 'home';
  $$('.nav a[data-nav]').forEach((a) => { if (a.dataset.nav === top) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  const n = needsCount();
  const nn = $('#nav-needs'); if (nn) { nn.hidden = !n; nn.textContent = n; nn.setAttribute('aria-label', `, ${n} need you`); }
  const tc = $('#tasks-count'); if (tc && state.route && state.route.parts[0] === 'tasks') tc.textContent = `${plural(tasksMatching().length, 'task')} shown`;
  const nt = $('#nav-tasks'); if (nt) nt.innerHTML = navTasksHTML();
  const bb = $('#bell-badge'); if (bb) { bb.hidden = !n; bb.textContent = n; }
  const bell = $('#bell'); if (bell) bell.setAttribute('aria-label', n ? `Notifications: ${n} need you` : 'Notifications');
  if (state.docTitle) document.title = titleWithNeeds();
  refreshHealth();
}
/** The browser tab shows how many tasks need you, e.g. "(2) Add rate limiting… · AX Studio", so you notice from
    another browser tab or window too. */
function titleWithNeeds() { const n = needsCount(); return (n ? `(${n}) ` : '') + (state.docTitle || 'AX Studio'); }

/* ---------- Event delegation ---------- */
function centerOf(el, e) {
  if (e && e.clientX) return { x: e.clientX, y: e.clientY };
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
const POKES = [
  'Welcome to my spring — clear water so you see every step, stone banks so nothing leaks.',
  'My six rose gills filter water; Guardrails filters traffic and keeps raw keys outside.',
  'Axolotls regenerate cleanly without scars — retry or race 2 agents without touching your repo.',
  'Spring to mountain lake, unchanged: your YAML runs identically on team Kubernetes.',
  'Psst: press ⌘K for ax doctor, portable YAML, or keyboard shortcuts.',
];
let pokeIdx = 0;
function defaultSecondAgent(primary) {
  const ids = agentList().map((a) => a.id);
  return ids.find((k) => k !== primary && AGENTS[k].connected) || ids.find((k) => k !== primary);
}
const ACTIONS = {
  palette: () => openPalette(),
  bell: () => toggleBell(),
  'close-bell': () => closeBell(),
  'close-dialog': () => closeDialog(),
  shortcuts: () => openShortcuts(),
  story: () => openStory(),
  doctor: () => openDoctor(),
  compare: (el) => { const t = getTask(el.dataset.task); if (t) openCompare(t); },
  manifest: (el) => openManifest(el.dataset.task ? getTask(el.dataset.task) : state.tasks[0]),
  'manifest-draft': () => {
    const d = state.draft || ensureDraft(new URLSearchParams(''));
    openManifest(draftSpec(d));
  },
  'theme-toggle': (el, e) => setTheme(resolvedTheme() === 'dark' ? 'light' : 'dark', centerOf(el, e)),
  'set-theme': (el, e) => setTheme(el.dataset.theme, centerOf(el, e)),
  copy: (el) => copyText(el.dataset.text, `Copied <span class="mono">${esc(el.dataset.text.length > 48 ? el.dataset.text.slice(0, 45) + '…' : el.dataset.text)}</span>`),
  poke: (el) => {
    /* Clicks 1–2 hop and wag with a line about the spring; keep clicking for Axel's tricks (see axoTap).
       A click during a trick plays when it ends, so its caption is shown then (onPlay). */
    const say = (r) => {
      const text = r.woke ? AXO_WAKE_SAY : r.trick ? r.trick.say : POKES[pokeIdx++ % POKES.length];
      state.axelSpeech = { text, at: Date.now() };
      const sp = $('.stage .speech');
      if (sp) { sp.hidden = false; sp.classList.remove('still'); sp.innerHTML = text; sp.style.animation = 'none'; void sp.offsetWidth; sp.style.animation = ''; }
    };
    const r = axoTap(el.querySelector('svg.axo'), { hop: true, onPlay: say, find: () => document.querySelector('#hero-axo') });
    if (r && !r.queued) say(r);
  },
  jump: (el) => {
    const t = document.getElementById(el.dataset.target);
    const sec = t && (t.closest('section') || t);
    if (sec) sec.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  },
  'home-filter': (el) => { state.homeFilter = el.dataset.filter; render({ keepScroll: true }); },
  'tasks-needs': () => { const f = tasksFilter(); f.status = 'needs'; f.env = 'all'; f.q = ''; },
  'tasks-filter': (el) => {
    const f = tasksFilter();
    f[el.dataset.k === 'env' ? 'env' : 'status'] = el.dataset.v;
    render({ keepScroll: true });
    const tc = $('#tasks-count'); if (tc) tc.textContent = `${plural(tasksMatching().length, 'task')} shown`;
    const b = $(`[data-action="tasks-filter"][data-k="${el.dataset.k}"][data-v="${el.dataset.v}"]`); if (b) b.focus();
  },
  /* Dropdown selects (selectHTML in views.js): click the box to open or close it, click an option to pick it. */
  'sel-toggle': (el) => { if (state.openSelect && state.openSelect.key === el.dataset.key) closeSelect(); else openSelect(el.dataset.key); },
  'sel-pick': (el) => pickSelect(el.dataset.key, el.dataset.value),
  allow: (el) => allowRequest(getTask(el.dataset.task), evIdx(getTask(el.dataset.task), el)),
  'allow-once': (el) => allowOnceRequest(getTask(el.dataset.task), evIdx(getTask(el.dataset.task), el)),
  deny: (el) => denyRequest(getTask(el.dataset.task), evIdx(getTask(el.dataset.task), el)),
  answer: (el) => answerTask(getTask(el.dataset.task), el.dataset.text),
  'perm-once': (el) => resolvePermission(getTask(el.dataset.task), evIdx(getTask(el.dataset.task), el), 'once'),
  'perm-task': (el) => resolvePermission(getTask(el.dataset.task), evIdx(getTask(el.dataset.task), el), 'task'),
  'perm-deny': (el) => resolvePermission(getTask(el.dataset.task), evIdx(getTask(el.dataset.task), el), 'denied'),
  'steer-mode': (el) => {
    state.steerMode = el.dataset.mode === 'now' ? 'now' : 'next';
    const t = getTask(el.dataset.task), hint = $('#steer-hint');
    if (t && hint) { hint.innerHTML = steerHintHTML(t); const b = hint.querySelector(`[data-mode="${state.steerMode}"]`); if (b) b.focus(); announce(state.steerMode === 'now' ? 'Deliver now: the agent stops its current step to read your message.' : 'Deliver at the next turn.'); }
  },
  'budget-raise': (el) => resolveBudget(getTask(el.dataset.task), 'raise'),
  'budget-stop': (el) => resolveBudget(getTask(el.dataset.task), 'stop'),
  'take-back': (el) => takeBack(getTask(el.dataset.task)),
  pause: (el) => pauseTask(getTask(el.dataset.task)),
  resume: (el) => resumeTask(getTask(el.dataset.task)),
  stop: (el) => stopTask(getTask(el.dataset.task)),
  retry: (el) => retryTask(getTask(el.dataset.task)),
  handoff: (el) => openHandoff(getTask(el.dataset.task)),
  promote: (el) => openPromote(getTask(el.dataset.task)),
  'key-dialog': (el) => openKeyDialog(el.dataset.agent, el.dataset.task),
  diagnostics: (el) => {
    const t = el.dataset.task && getTask(el.dataset.task);
    /* Diagnostics describe the failure they were copied from, plus the real environment state (secrets redacted). */
    const code = el.dataset.code || (t && t.status === 'failed' ? failInfo(t).code : null);
    const E = code && ERRORS[code];
    const f = t && lastFail(t);
    const ctx = { t, e: f ? f.e : {}, cluster: el.dataset.cluster || (t && t.cluster) || state.env.cluster, repo: el.dataset.repo || (t && t.repo), agent: t ? t.agent : undefined };
    const redact = (s) => String(s || '').replace(/\b(sk-[\w-]{4})[\w-]+/g, '$1…').replace(/\b(ghp_|gho_)[\w]+/g, '$1…');
    const diag = JSON.stringify({
      studio: '0.9.2', cli: '0.9.2', os: 'macOS 15.1',
      environment: { mode: state.env.mode, health: state.env.health, issue: state.env.issue || null, cluster: state.env.mode === 'cluster' ? state.env.cluster : null },
      failure: E ? { code, title: (f && f.e.code === code && f.e.title) || val(E.title, ctx), cause: (f && f.e.code === code && f.e.cause) || val(E.cause, ctx), log: redact((f && f.e.code === code && f.e.log) || val(E.log, ctx)), cluster: el.dataset.cluster || null, repo: el.dataset.repo || null } : null,
      recentEvents: t ? t.events.slice(-20).map((e) => ({ at: new Date(e.at).toISOString(), type: e.type, summary: redact(String(describeEvent(t, e) || '').replace(/<[^>]+>/g, '')) })) : [],
      correlationId: `ax-${(t && t.id) || 'env'}-${Date.now().toString(36)}`,
      guardrails: { preset: state.guardrailPreset, insideSandbox: state.permMode },
      imagesPinned: state.pinImages,
      task: t ? { id: t.id, agent: AGENTS[t.agent].cli, version: AGENTS[t.agent].version, status: t.status, env: t.env, cluster: t.cluster || null } : null,
      guestSecretsExposed: 0,
      auth: '[redacted]',
    }, null, 2);
    copyText(diag, `Diagnostics copied${E ? ` for “${esc(val(E.title, ctx))}”` : ''}. Secrets removed.`);
  },
  'ask-admin': (el, e) => { e.preventDefault(); copyText(el.dataset.role ? `Hi! Could you give me the ${el.dataset.role} role on ${el.dataset.text} so I can run AX Studio tasks there? Thanks!` : `Hi! Could you give me access to ${el.dataset.text} for AX Studio? Thanks!`, `Access request copied. Send it to ${state.org.admin}.`); },
  /* The docked task title in the top bar goes back to the top of the task (title, progress, header actions). */
  'task-top': () => { window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' }); const h = $('#task-title'); if (h) h.focus({ preventScroll: true }); },
  /* Home with nothing yet: an idea fills the goal box (still editable), and Axel celebrates the pick. */
  'first-idea': (el) => {
    const q = $('#quick-goal');
    state.quickGoal = el.dataset.goal;
    if (q) { q.value = el.dataset.goal; q.focus(); try { q.setSelectionRange(q.value.length, q.value.length); } catch (e) { /* ignore */ } }
    homeNudge('idea');
  },
  'focus-steer': (el) => {
    const go = (s) => { s.focus(); s.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' }); };
    const s = $('#steer');
    if (s) { go(s); return; }
    /* From Changes or Terminal, the next step's Redirect or Reply goes to Activity, where you write to the agent. */
    const id = (el && el.dataset && el.dataset.task) || (state.route && state.route.parts[0] === 'task' ? state.route.parts[1] : null);
    if (!id) return;
    navigate(`#/task/${id}`);
    setTimeout(() => { const s2 = $('#steer'); if (s2) go(s2); }, 80);
  },
  'focus-next': (el, e) => {
    if (e && e.preventDefault) e.preventDefault();
    const p = $('#next-step');
    if (!p) return;
    p.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
    const b = p.querySelector('button, a[href]');
    if (b) b.focus({ preventScroll: true });
  },
  'skip-to-main': () => { const m = $('#main h1') || $('#main'); if (m) { if (!m.hasAttribute('tabindex')) m.setAttribute('tabindex', '-1'); m.focus(); } },
  'focus-term': () => { if (!String(window.getSelection())) { const i = $('#term-input'); if (i) i.focus({ preventScroll: true }); } },
  suggest: (el) => { state.draft.goal = el.dataset.text; state.draft.error = ''; const g = $('#goal'); if (g) { g.value = el.dataset.text; g.focus(); } updateDraftLive(); },
  /* CUJ 2 · prompt help: add one plain-language line to the goal (editable), then keep typing where you were. */
  'goal-tip': (el) => {
    const d = state.draft; if (!d) return;
    const tip = GOAL_TIPS.find((x) => x.id === el.dataset.tip); if (!tip) return;
    const g = String(d.goal || '').replace(/\s+$/, '');
    d.goal = g + (g ? '\n' : '') + tip.add; d.error = '';
    const ta = $('#goal');
    if (ta) { ta.value = d.goal; ta.removeAttribute('aria-invalid'); ta.focus(); try { ta.setSelectionRange(d.goal.length, d.goal.length); } catch (e) { /* ignore */ } ta.scrollTop = ta.scrollHeight || 0; }
    updateDraftLive();
    announce(`Added to your goal: ${tip.add}`);
  },
  'find-agent': (el) => openAgentCatalog({ tab: el.dataset.tab }),
  'remove-agent': (el) => {
    const a = removeAgent(el.dataset.agent); if (!a) return;
    if (state.draft && state.draft.agent === a.id) state.draft.agent = DEFAULT_AGENT;
    if (state.draft && state.draft.agent2 === a.id) state.draft.agent2 = defaultSecondAgent(state.draft.agent);
    if (state.quickAgent === a.id) state.quickAgent = DEFAULT_AGENT;
    render({ keepScroll: true });
    toast(`Removed <strong>${esc(a.name)}</strong> from your agents. Tasks it already ran are kept.`, { icon: 'trash', action: { label: 'Undo', run: () => { addAgent(a); render({ keepScroll: true }); } } });
  },
  'pick-agent': (el) => {
    const d = state.draft;
    if (d.agent !== el.dataset.agent) d.model = null;   /* each template starts on its default model */
    d.agent = el.dataset.agent; d.keyState = null; d.keyMsg = '';
    if (d.agent2 === d.agent) d.agent2 = defaultSecondAgent(d.agent);
    render({ keepScroll: true });
    const b = $('#agent-' + d.agent); if (b) b.focus({ preventScroll: true });
  },
  'pick-model': (el) => { const d = state.draft; if (!d) return; d.model = el.dataset.model; render({ keepScroll: true }); },
  'toggle-compare': (el) => {
    const d = state.draft; if (!d) return;
    d.compare = el.checked;
    if (d.agent2 === d.agent) d.agent2 = defaultSecondAgent(d.agent);
    render({ keepScroll: true });
  },
  'pick-agent2': (el) => { const d = state.draft; if (!d) return; d.agent2 = el.dataset.agent; render({ keepScroll: true }); },
  'pick-source': (el) => {
    const d = state.draft; const src = el.dataset.source;
    if (!d || d.source === src) return;
    /* Leaving the sample takes its prefilled goal with it, unless you edited it. A new repo gets its own setup command. */
    if (d.source === 'sample' && d.goalFromSample && d.goal === SAMPLE_GOAL) { d.goal = ''; d.goalFromSample = false; }
    d.source = src; d.setupEdited = false; d.setup = '';
    if (src === 'sample') prefillSampleGoal(d);
    render({ keepScroll: true });
    if (src === 'git') { const g = $('#git-url'); if (g) g.focus(); }
  },
  'pick-env': (el) => {
    const d = state.draft;
    d.env = el.dataset.env;
    render({ keepScroll: true });
  },
  'pick-size': (el) => { state.draft.size = el.dataset.size; render({ keepScroll: true }); },
  'change-folder': () => openFolderPicker(),
  'pick-folder': (el) => {
    const d = state.draft; const k = +el.dataset.i; const f = FOLDERS[k];
    if (!d || !f) return;
    closeDialog(true);
    if (d.folderIdx !== k) { d.folderIdx = k; d.branch = null; d.pushedFirst = false; d.setupEdited = false; d.setup = ''; d.extraRepos = (d.extraRepos || []).filter((x) => x !== f.repo); }
    d.source = 'folder';
    render({ keepScroll: true });
    toast(`Using <span class="mono">${esc(f.path)}</span>. Setup command detected from ${esc(f.setupFrom)}.`, { icon: 'folder', timeout: 2600 });
    const b = $('[data-action="change-folder"]'); if (b) b.focus({ preventScroll: true });
  },
  /* Saved workspace setups: keep a repo's instructions, skills, MCP servers and setup command for the next task. */
  'save-setup': () => {
    const d = state.draft; if (!d) return;
    const r = draftRepo(d);
    const br = draftBranch(d);
    const name = cleanText(`${r.repo}${d.source === 'folder' && br !== FOLDERS[d.folderIdx].branch ? ' · ' + br : ''} setup`, 40);
    const s = { name, source: d.source, folderIdx: d.folderIdx, git: d.git, branch: d.branch, useAgentsMd: d.useAgentsMd, instructions: d.instructions, skills: d.skills.slice(), mcp: d.mcp.slice(), setup: d.setupEdited ? d.setup : '', setupEdited: !!d.setupEdited, envVars: d.envVars, extraRepos: (d.extraRepos || []).slice(),
      inlineFiles: cleanFiles(d.inlineFiles).filter((x) => !fileHasSecret(x)).map((x) => ({ path: x.path.trim(), content: x.content || '' })), summary: workspaceBits(d).join(' · ') };
    state.savedSetups = [s].concat((state.savedSetups || []).filter((x) => x.name !== s.name)).slice(0, 6);
    saveSetups();
    render({ keepScroll: true });
    toast(`Saved “${esc(name)}”. Pick it under Saved setups next time.`, { icon: 'checkCircle' });
  },
  'use-setup': (el) => {
    const d = state.draft; const s = (state.savedSetups || [])[+el.dataset.i];
    if (!d || !s) return;
    Object.assign(d, { source: s.source || 'folder', folderIdx: FOLDERS[s.folderIdx] ? s.folderIdx : 0, git: s.git || '', branch: s.branch || null, useAgentsMd: s.useAgentsMd !== false, instructions: s.instructions || '', skills: (s.skills || []).slice(), mcp: (s.mcp || []).slice(), setup: s.setup || '', setupEdited: !!s.setupEdited, envVars: s.envVars || '', extraRepos: (s.extraRepos || []).slice(),
      inlineFiles: (s.inlineFiles || []).filter((x) => x && x.path).map((x) => ({ path: String(x.path), content: String(x.content || '') })) });
    if (!d.skills.includes('ax-task')) d.skills.unshift('ax-task');
    if (d.source === 'sample') prefillSampleGoal(d);
    render({ keepScroll: true });
    toast(`Using your saved setup “${esc(s.name)}”.`, { icon: 'layers' });
  },
  'use-detected-setup': () => { const d = state.draft; if (!d) return; d.setupEdited = false; d.setup = ''; render({ keepScroll: true }); const i = $('#setup-cmd'); if (i) i.focus({ preventScroll: true }); },
  /* Connect GitHub once (private repos, pushes, the GitHub MCP server). The token stays in the keychain and is
     added outside the sandbox. From New task, the workspace picks up the GitHub MCP server, as new workspaces do. */
  'connect-github': async (el) => {
    if (state.github.connected) return;
    if (el) { el.disabled = true; el.innerHTML = `${icon('loader', 'sm spin')}Finish in your browser…`; }
    await sleep(reducedMotion() ? 200 : 1300);
    const added = finishGithubConnect();
    render({ keepScroll: true });
    toast(`Connected to GitHub as ${esc(state.github.user)}. ${added ? 'Added the GitHub MCP server to this workspace. ' : ''}You won't be asked again.`, { icon: 'checkCircle' });
    announce('GitHub connected');
  },
  'disconnect-github': () => { state.github.connected = false; render({ keepScroll: true }); toast('Signed out of GitHub. Its token was removed from your keychain.', { icon: 'info' }); },
  /* Inline files, written into the workspace before the agent starts. */
  'file-add': () => {
    const d = state.draft; if (!d) return;
    d.inlineFiles = (d.inlineFiles || []).concat({ path: '', content: '' });
    d.wsOpen = true;
    render({ keepScroll: true });
    const i = $(`[data-file-i="${d.inlineFiles.length - 1}"][data-file-k="path"]`); if (i) i.focus({ preventScroll: true });
  },
  'file-remove': (el) => {
    const d = state.draft; if (!d) return;
    const [f] = (d.inlineFiles || []).splice(+el.dataset.i, 1);
    render({ keepScroll: true });
    const add = $('#file-add'); if (add) add.focus({ preventScroll: true });
    if (f && String(f.path || '').trim()) toast(`Removed <span class="mono">${esc(f.path.trim())}</span> from this workspace`, { icon: 'trash' });
  },
  'run-task': () => createTaskFromDraft(),
  'show-big-diff': (el) => { const t = getTask(el.dataset.task); const sel = state.diffSel[t.id]; sel.big = Object.assign({}, sel.big, { [el.dataset.path]: true }); render({ keepScroll: true }); },
  'diff-file': (el) => {
    const t = getTask(el.dataset.task);
    state.diffSel[t.id].i = +el.dataset.i;
    if (location.hash.includes('?')) try { history.replaceState(null, '', routeUrl(`#/task/${t.id}/changes`)); } catch (e) {}
    render({ keepScroll: true });
  },
  'keep-file': (el) => {
    const t = getTask(el.dataset.task);
    const sel = state.diffSel[t.id];
    sel.discarded[filesFor(t)[sel.i].path] = el.dataset.keep === '0';
    render({ keepScroll: true });
  },
  push: (el) => pushTask(getTask(el.dataset.task), el),
  apply: (el) => applyTask(getTask(el.dataset.task)),
  patch: (el) => { const t = el && el.dataset.task && getTask(el.dataset.task); if (t) downloadText(`${t.id}-changes.patch`, patchText(t)); else toast('Saved changes.patch to your Downloads folder', { icon: 'download' }); },
  'open-pr': (el) => openPullRequest(getTask(el.dataset.task)),
  'set-preset': (el) => {
    const p = el.dataset.preset;
    if (!GUARDRAIL_PRESETS[p]) return;
    state.guardrailPreset = p;
    savePrefs();
    render({ keepScroll: true });
    toast(`Guardrails preset: <strong>${esc(GUARDRAIL_PRESETS[p].name)}</strong>. Sites you allowed still apply.`, { icon: 'shieldCheck', timeout: 2400 });
  },
  'remove-allow': (el) => {
    const idx = +el.dataset.i;
    const [removed] = state.allow.splice(idx, 1);
    if (!removed) return;
    render({ keepScroll: true });
    toast(`Removed <span class="mono">${esc(removed.domain)}</span>`, { icon: 'trash', action: { label: 'Undo', run: () => { state.allow.splice(idx, 0, removed); render({ keepScroll: true }); } } });
  },
  'allow-domain': (el) => {
    const d = el.dataset.domain, scope = el.dataset.scope || 'all';
    if (!d) return;
    if (!siteAllowed(d, scope === 'all' ? null : scope)) state.allow.push({ domain: d, scope, by: 'You', at: now(), task: el.dataset.task && getTask(el.dataset.task) ? el.dataset.task : undefined });
    const resumed = resumeWaitingOn(d, scope);
    render({ keepScroll: true });
    toast(`Allowed <span class="mono">${esc(d)}</span> ${scope === 'all' ? 'for all workspaces' : `for the ${esc(scope)} workspace`}` + carriesOn(resumed), { icon: 'shieldCheck' });
  },
  'restart-sandbox': () => {
    state.tasks.forEach((t) => { if (t.env === 'local' && t.status === 'running') { clearTimeout(t._timer); t._held = true; } });
    state.flags.restarting = true;
    toast('Restarting the sandbox. Running agents pause and resume where they stopped.', { icon: 'refresh', timeout: 2400 });
    setHealth('starting', null, 4);
  },
  'noop-toast': (el) => toast(esc(el.dataset.text), { icon: 'info' }),
  'toggle-pref': (el) => {
    const p = el.dataset.pref;
    if (p === 'reduceMotion') { state.reduceMotion = el.checked; document.body.classList.toggle('reduce-motion', el.checked); savePrefs(); return; }
    if (p === 'showInfra') { state.showInfra = el.checked; document.body.classList.toggle('show-infra', el.checked); }
    else if (p === 'pinImages') { state.pinImages = el.checked; render({ keepScroll: true }); }
    else if (p === 'singleKeys') state.singleKeys = el.checked;
    else state.notify[p] = el.checked;
    savePrefs();
    if (p === 'party' && el.checked) celebrate(el);
    /* Notifications outside AX Studio. The browser asks once; it only allows them on a secure address. */
    if (p === 'desktop') {
      if (!el.checked) { toast('Notifications stay inside AX Studio and its browser tab.', { icon: 'check', timeout: 2200 }); return; }
      const can = typeof Notification !== 'undefined' && window.isSecureContext;
      if (!can) { toast('Saved. System notifications work when AX Studio runs on this computer. In this preview, they show in the page and the browser tab.', { icon: 'info' }); return; }
      Notification.requestPermission().then((r) => {
        if (r === 'granted') toast('You’ll get a notification when a task needs you, fails or finishes while AX Studio is in the background.', { icon: 'checkCircle' });
        else { state.notify.desktop = false; savePrefs(); render({ keepScroll: true }); toast('Your browser blocked notifications for AX Studio. Allow them in its site settings, then turn this on again.', { icon: 'info' }); }
      });
      return;
    }
    toast('Saved', { icon: 'check', timeout: 1800 });
  },
  /* ---- First-run setup (F1, F3, F2) ---- */
  'setup-start': () => setupInstall(0),
  'setup-path': (el) => { const s = state.setup; if (!s) return; s.path = el.dataset.path; if (s.phase !== 'before') s.phase = 'before'; render({ keepScroll: true }); },
  'setup-pick': (el) => { state.setup.pick = el.dataset.agent; render({ keepScroll: true }); const b = $(`[data-action="setup-pick"][data-agent="${el.dataset.agent}"]`); if (b) b.focus(); },
  /* Path B: no sign-in. The clusters come from this computer's kubeconfig. */
  'setup-connect': () => {
    const s = state.setup; s.phase = 'connect'; s.cluster = s.cluster || 'ax-dev-us-central';
    render(); announce('Choose a remote cluster from your kubeconfig.');
  },
  'setup-cluster': (el) => { state.setup.cluster = el.dataset.cluster; state.inviteOpen = !!(el.closest && el.closest('.other-connect')); render({ keepScroll: true }); },
  'setup-invite': () => {
    const inp = $('#invite-url'); const st = $('#invite-status');
    const cl = inviteCluster(inp && inp.value);
    if (!cl) { if (st) { st.className = 'field-status err'; st.innerHTML = `${icon('alert', 'sm')}Paste the full link your team sent, like https://ax.acme.dev/join/…`; } if (inp) { inp.setAttribute('aria-invalid', 'true'); inp.focus(); } return; }
    state.setup.cluster = cl; state.inviteOpen = false; render({ keepScroll: true });
    toast(`Invite accepted. ${cl} is selected.`, { icon: 'checkCircle' });
  },
  'setup-connect-done': () => {
    const s = state.setup;
    if (!(setupDone() && state.env.mode === 'local')) setEnvMode('cluster');
    if (!setupDone()) enterFirstRun();
    connectCluster(s.cluster || 'ax-dev-us-central');
    try { localStorage.setItem('ax.setup', '1'); } catch (e) { /* ignore */ }
    s.phase = 'ready'; s.path = 'cluster';
    render(); announce(`Connected to ${state.env.cluster}`);
    celebrate($('#setup-axo'));
  },
  'setup-skip': () => {
    if (!(setupDone() && state.env.mode !== 'none')) setEnvMode(state.env.mode === 'cluster' ? 'cluster' : 'none');
    if (!setupDone()) enterFirstRun();
    try { localStorage.setItem('ax.setup', '1'); } catch (e) { /* ignore */ }
    state.draft = null;
  },
  'setup-resume-path': (el) => { state.setup = { phase: 'before', step: 0, pick: DEFAULT_AGENT, path: el.dataset.path || 'local' }; },
  'setup-finish': () => {
    try { localStorage.setItem('ax.setup', '1'); } catch (e) { /* ignore */ }
    state.draft = null;
  },
  /* CUJ 1 → CUJ 2 bridge: finish setup and open New task with "Add an agent" (its own action, so "Start my first task" stays the first finish). */
  'setup-find': () => ACTIONS['setup-finish'](),
  /* ---- CUJ 1 (installation experience) on its own: start a path or a failure from the overview ---- */
  'cuj-path': (el) => startCujPath(el.dataset.path),
  'cuj-scenario': (el) => startCujScenario(el.dataset.issue),
  'cuj-preinstalled': (el) => startPreinstalled(el.dataset.by, true),
  /* Get AX Studio (#/get), the download page: the download "finishes", then opening AX Studio is a fresh first run.
     After ax setup in a terminal, AX Studio opens on Ready instead. */
  'get-download': () => {
    state.getDownloaded = true;
    render({ keepScroll: true });
    const b = $('[data-action="get-open"]'); if (b) b.focus();
  },
  'get-open': () => { state.getDownloaded = false; startSetupScenario(null); },
  'get-open-cli': () => { state.getDownloaded = false; startPreinstalled('cli', state.cuj === 1); },
  'rerun-setup': () => { state.setup = { phase: 'before', step: 0, pick: DEFAULT_AGENT, path: state.env.mode === 'cluster' ? 'cluster' : 'local' }; },
  /* ---- P0: failure paths, scenarios, sign-in, recipe, privacy, skills, export ---- */
  fix: (el) => runFix(el.dataset.fix, el),
  'key-method': (el) => { const d = state.draft; if (!d) return; d.keyMethod = el.dataset.method; d.keyState = null; d.keyMsg = ''; render({ keepScroll: true }); },
  'agent-signin': async (el) => {
    const d = state.draft; const A = AGENTS[el.dataset.agent];
    if (d) d.keyState = 'busy';
    el.disabled = true;
    const st = $('#key-status'); if (st && d) { st.className = 'field-status busy'; st.innerHTML = keyStatusHTML(d); }
    await sleep(reducedMotion() ? 200 : 1300);
    accountSignedIn(A);
    if (d) d.keyState = 'ok';
    toast(`Signed in to ${esc(A.name)}. Saved to your keychain, so you won't be asked again.`, { icon: 'checkCircle' });
    if (parseRoute().parts[0] === 'new') render({ keepScroll: true });
  },
  'cluster-connect': (el) => { const c = el.dataset.cluster; connectCluster(c); render({ keepScroll: true }); toast(`Connected to ${esc(c)}. New tasks can run there.`, { icon: 'cloud' }); },
  'cluster-disconnect': () => {
    const c = state.env.cluster;
    disconnectCluster();
    render({ keepScroll: true });
    toast(`Disconnected from ${esc(c)}. Tasks already running there keep going.`, { icon: 'cloud' });
  },
  'policy-yaml': () => openPolicyYAML(),
  'agent-signout': (el) => { const A = AGENTS[el.dataset.agent]; A.connected = false; A.auth = 'key'; A.keyProblem = ''; render({ keepScroll: true }); toast(`Signed out of ${A.name}. Its credentials were removed from your keychain.`, { icon: 'info' }); },
  'toggle-draft': (el) => { const d = state.draft; if (!d) return; d[el.dataset.key] = el.checked; render({ keepScroll: true }); },
  'draft-set': (el) => { const d = state.draft; if (!d) return; d[el.dataset.key] = el.dataset.val; render({ keepScroll: true }); },
  'draft-push-first': () => {
    const d = state.draft; if (!d) return;
    d.pushedFirst = true; render({ keepScroll: true });
    toast(`Pushed ${FOLDERS[d.folderIdx].dirty} changes to <span class="mono">${esc(pushFirstBranch(d))}</span>. The cluster starts from that branch.`, { icon: 'branch' });
  },
  'draft-toggle': (el) => {
    const d = state.draft; if (!d) return;
    const arr = Array.isArray(d[el.dataset.key]) ? d[el.dataset.key] : [], v = el.dataset.val;
    d[el.dataset.key] = arr.includes(v) ? arr.filter((x) => x !== v) : arr.concat(v);
    render({ keepScroll: true });
  },
  'set-perm': (el) => {
    state.permMode = el.dataset.mode === 'ask' ? 'ask' : 'auto'; savePrefs(); render({ keepScroll: true });
    toast(state.permMode === 'ask' ? 'Agents will ask before risky commands inside the sandbox.' : 'Agents run without asking inside the sandbox. Guardrails still controls network and keys.', { icon: 'shieldCheck' });
  },
  'set-retention': (el) => { state.privacy.retention = el.dataset.val; savePrefs(); render({ keepScroll: true }); toast(el.dataset.val === 'forever' ? 'Activity is kept until you delete it.' : `Activity older than ${el.dataset.val} days is deleted automatically.`, { icon: 'check' }); },
  'delete-activity': () => openDeleteActivity(),
  uninstall: () => openUninstall(),
  'skill-toggle': (el) => {
    const A = AGENTS[el.dataset.agent];
    state.skills[A.id] = !state.skills[A.id]; savePrefs(); render({ keepScroll: true });
    toast(state.skills[A.id] ? `Installed the AX skill for ${A.name}. Try asking it to “run my tests in an AX sandbox”.` : `Removed the AX skill from ${A.name}.`, { icon: state.skills[A.id] ? 'checkCircle' : 'trash' });
  },
  'export-oatr': (el) => { const t = getTask(el.dataset.task); if (t) downloadText(`${t.id}.oatr.json`, oatrJSON(t), `Saved <span class="mono">${t.id}.oatr.json</span> · secrets redacted`); },
  'export-results': (el) => { const t = getTask(el.dataset.task); if (t) openExportResults(t); },
  /* The plain-text log is the task's fourth tab. A long tool output's "View the full log" opens it. */
  'raw-log': (el) => { const t = getTask(el.dataset.task); if (t) navigate(`#/task/${t.id}/log`); },
  'copy-log': (el) => { const t = getTask(el.dataset.task); if (t) copyText(rawLogText(t), 'Log copied · secrets removed'); },
  'download-log': (el) => { const t = getTask(el.dataset.task); if (t) downloadText(`${t.id}-log.txt`, rawLogText(t), `Saved <span class="mono">${t.id}-log.txt</span> · secrets removed`); },
  interrupt: (el) => interruptTask(getTask(el.dataset.task), evIdx(getTask(el.dataset.task), el)),
  'restore-run': (el) => restoreRun(getTask(el.dataset.task)),
};

/* ---------- Setup engine: agent-first install with resumable steps (F3, F2) ---------- */
function patchTaskDOM(v, r) {
  const main = $('#main');
  if (!main || !main.querySelector) return false;
  /* Only patch a task page that's already on screen (its header and grid are there). */
  const head0 = main.querySelector('#task-head');
  if (!head0 || !head0.innerHTML || !main.querySelector('#th-progress')) return false;
  const t = getTask(r.parts[1]);
  if (!t) return false;
  const fresh = document.createElement('div');
  fresh.innerHTML = v.html;
  const head = main.querySelector('#task-head'), nHead = fresh.querySelector('#task-head');
  const tabs = main.querySelector('.task-tabs'), nTabs = fresh.querySelector('.task-tabs');
  const panel = main.querySelector('.task-panel'), nPanel = fresh.querySelector('.task-panel');
  const side = main.querySelector('#task-side'), nSide = fresh.querySelector('#task-side');
  if (!head || !nHead || !tabs || !nTabs || !panel || !nPanel || !side || !nSide) return false;
  head.innerHTML = nHead.innerHTML;
  updateJourney(t);
  tabs.innerHTML = nTabs.innerHTML;
  const tools = main.querySelector('#task-tools'), nTools = fresh.querySelector('#task-tools');
  if (tools && nTools && tools.innerHTML !== nTools.innerHTML) tools.innerHTML = nTools.innerHTML;
  panel.id = nPanel.id;
  panel.setAttribute('aria-labelledby', nPanel.getAttribute('aria-labelledby') || '');
  panel.innerHTML = nPanel.innerHTML;
  const oldAx = side.querySelector('svg.axo');
  side.innerHTML = nSide.innerHTML;
  keepAxel(oldAx, side);
  return true;
}
function patchSetupDOM(html) {
  const card = $('.setup-card');
  if (!card || !card.innerHTML || !card.querySelector) return false;
  const curBody = card.querySelector('.su-body');
  if (!curBody || !curBody.innerHTML) return false;
  const fresh = document.createElement('div');
  fresh.innerHTML = html;
  const nc = fresh.querySelector('.setup-card');
  if (!nc || !nc.innerHTML) return false;
  const topRow = $('.setup-top .btn-row'), nTopRow = fresh.querySelector('.setup-top .btn-row');
  if (topRow && nTopRow && topRow.innerHTML !== nTopRow.innerHTML) topRow.innerHTML = nTopRow.innerHTML;
  const rib = $('.setup-top .cuj-ribbon'), nRib = fresh.querySelector('.setup-top .cuj-ribbon');
  if (rib && nRib && rib.innerHTML !== nRib.innerHTML) rib.innerHTML = nRib.innerHTML;
  else if (!!rib !== !!nRib) return false;
  const oldTrackLis = card.querySelectorAll ? card.querySelectorAll('.su-track li') : [];
  const newTrackLis = nc.querySelectorAll ? nc.querySelectorAll('.su-track li') : [];
  if (oldTrackLis.length === newTrackLis.length && oldTrackLis.length > 0) {
    oldTrackLis.forEach((li, i) => {
      const nli = newTrackLis[i];
      li.className = nli.className;
      if (nli.hasAttribute('aria-current')) li.setAttribute('aria-current', 'step');
      else li.removeAttribute('aria-current');
      if (li.innerHTML !== nli.innerHTML) li.innerHTML = nli.innerHTML;
    });
  }
  const svg = card.querySelector('#setup-axo'), nsvg = nc.querySelector('#setup-axo');
  if (svg && nsvg && typeof updateAxoInPlace === 'function') {
    const oldMood = svg.dataset.axo;
    updateAxoInPlace(svg, nsvg.dataset.axo);
    if (oldMood !== nsvg.dataset.axo) axoWag(svg);
  }
  const hcopy = card.querySelector('.su-head-copy'), nhcopy = nc.querySelector('.su-head-copy');
  if (hcopy && nhcopy && hcopy.innerHTML !== nhcopy.innerHTML) hcopy.innerHTML = nhcopy.innerHTML;
  const stones = curBody.querySelector('.stones'), nBody = nc.querySelector('.su-body');
  const nStones = nBody ? nBody.querySelector('.stones') : null;
  if (stones && nStones && stones.innerHTML) {
    stones.className = nStones.className;
    stones.setAttribute('aria-valuenow', nStones.getAttribute('aria-valuenow') || '0');
    stones.setAttribute('aria-valuetext', nStones.getAttribute('aria-valuetext') || '');
    stones.style.setProperty('--sp', nStones.style.getPropertyValue('--sp'));
    const oldSt = stones.querySelectorAll('.stone'), newSt = nStones.querySelectorAll('.stone');
    if (oldSt.length === newSt.length) {
      oldSt.forEach((st, idx) => {
        const nst = newSt[idx];
        st.className = nst.className;
        const sb = st.querySelector('.sb'), nsb = nst.querySelector('.sb');
        if (sb && nsb && sb.innerHTML !== nsb.innerHTML) sb.innerHTML = nsb.innerHTML;
        const sl = st.querySelector('.sl'), nsl = nst.querySelector('.sl');
        if (sl && nsl && sl.textContent !== nsl.textContent) sl.textContent = nsl.textContent;
      });
    }
    const nowBox = curBody.querySelector('.su-now'), nNowBox = nBody.querySelector('.su-now');
    const failBox = nBody.querySelector('.fail-card');
    if (failBox && nowBox) {
      nowBox.outerHTML = `<div style="margin-top:18px">${failBox.outerHTML}</div>`;
    } else if (nowBox && nNowBox && nowBox.innerHTML !== nNowBox.innerHTML) {
      nowBox.innerHTML = nNowBox.innerHTML;
    }
    const layers = curBody.querySelector('.layers'), nLayers = nBody.querySelector('.layers');
    if (layers && nLayers && layers.innerHTML !== nLayers.innerHTML) layers.innerHTML = nLayers.innerHTML;
  } else if (nBody) {
    const phaseChanged = card.dataset.phase !== nc.dataset.phase;
    card.dataset.phase = nc.dataset.phase || '';
    curBody.innerHTML = nBody.innerHTML;
    if (phaseChanged && !reducedMotion()) {
      curBody.classList.remove('phase-fade');
      void curBody.offsetWidth;
      curBody.classList.add('phase-fade');
    }
  }
  return true;
}
function paintSetup() {
  const v = viewSetup();
  if (patchSetupDOM(v.html)) return;
  const card = $('.setup-card');
  if (!card) { render({ keepScroll: true }); return; }
  const fresh = document.createElement('div');
  fresh.innerHTML = v.html;
  const nc = fresh.querySelector('.setup-card');
  if (nc) card.innerHTML = nc.innerHTML;
}
/* Finishing setup for the first time lands on a day 0 Studio: nothing has run yet, so Home is the empty first-run
   page (no demo tasks), and no template is signed in. It sticks across reloads; ?reset brings the demo data back.
   Running setup again from Settings (already set up) keeps your tasks. */
function enterFirstRun() {
  state.tasks.forEach((t) => clearTimeout(t._timer));
  state.firstRun = true;
  state.tasks = [];
  state.blockedLog = [];
  state.nextId = 1;
  state.allow = state.allow.filter((a) => /preset/.test(a.by));
  state.github.connected = false;
  disconnectCluster();
  Object.values(AGENTS).forEach((a) => { if (!a.custom) { a.connected = false; delete a.keyProblem; delete a.keyHint; } });
  try { localStorage.setItem('ax.firstrun', '1'); } catch (e) { /* ignore */ }
  const tw = $('#toasts'); if (tw) tw.innerHTML = '';
}
async function setupInstall(from) {
  const s = state.setup;
  if (!s) return;
  const steps = setupSteps(s.pick);
  const span = Math.max(1, steps.length - 1);
  s.phase = 'installing';
  s.step = from || 0;
  s.progress = Math.min(1, s.step / span);
  render({ keepScroll: true });
  for (let k = s.step; k < steps.length; k++) {
    s.step = k;
    s.progress = Math.min(1, k / span);
    paintSetup();
    announce(`Step ${k + 1} of 4: ${steps[k].title}`);
    /* Advance the water-glide bar smoothly toward the next stone while this step runs. */
    if (k < steps.length - 1 && s.failAt !== k) {
      setTimeout(() => {
        if (state.setup === s && s.phase === 'installing' && s.step === k) {
          s.progress = Math.min(1, (k + 0.92) / span);
          const stEl = $('.setup-card .stones');
          if (stEl && stEl.style) stEl.style.setProperty('--sp', String(s.progress));
        }
      }, 45);
    }
    await sleep(reducedMotion() ? 300 : (state.setupStepMs || 1500));
    if (parseRoute().parts[0] !== 'welcome' || state.setup !== s) return;
    if (s.failAt === k) {
      delete s.progress;
      s.phase = 'failed'; s.failAt = null;
      render({ keepScroll: true });
      announce(`Setup paused at step ${k + 1}: ${val(ERRORS['setup-download'].title, { agent: s.pick })}`);
      return;
    }
  }
  /* Briefly mark all 4 stones complete so the final circle smoothly fills before moving to Ready. */
  s.step = steps.length;
  s.progress = 1;
  paintSetup();
  await sleep(reducedMotion() ? 80 : 320);
  if (parseRoute().parts[0] !== 'welcome' || state.setup !== s) return;
  delete s.progress;
  if (!setupDone()) enterFirstRun();
  try { localStorage.setItem('ax.setup', '1'); } catch (e) { /* ignore */ }
  setEnvMode('local');
  s.phase = 'ready'; s.step = steps.length; s.path = 'local';
  /* The templates you didn't pick first keep downloading in the background; New task shows their progress. */
  startDownloads(prebuiltAgents().filter((a) => a.id !== s.pick).map((a) => a.id), reducedMotion() ? 2000 : (state.bgDownloadMs || 6000));
  render();
  announce(AGENTS[s.pick] ? `Setup complete. ${AGENTS[s.pick].name} is ready.` : 'Setup complete. The agent runner is ready for your agent.');
  const h = $('#main h1'); if (h) h.focus();
  celebrate($('#setup-axo'));
}

document.addEventListener('click', (e) => {
  /* Doing anything other than playing with Axel lets held-back refreshes render right away. */
  if (!e.target.closest('svg.axo, [data-action="poke"]')) axoYield();
  if (!e.target.closest('.bell-wrap')) closeBell();
  if (state.openSelect && !e.target.closest(`[data-sel="${state.openSelect.key}"]`)) closeSelect();
  const el = e.target.closest('[data-action]');
  if (!el) return;
  if (el.getAttribute('aria-disabled') === 'true' && el.dataset.action !== 'run-task') return;
  if (state.conn.lost && CONN_COMMANDS.includes(el.dataset.action)) { e.preventDefault(); toast("Can't reach AX right now, so that wasn't sent. Try again when you're reconnected.", { icon: 'alert' }); return; }
  const fn = ACTIONS[el.dataset.action];
  if (fn) fn(el, e);
});
/* Dropdown lists: moving the mouse over an option highlights it (as in a regular select), pressing on the list never
   takes focus off the box, and focus leaving the box closes the list (checked after a redraw has put focus back).
   Only real mouse movement counts: a list opening under a resting pointer must not undo the arrow keys. */
let selPointer = '';
document.addEventListener('mousemove', (e) => {
  const at = e.clientX + ',' + e.clientY;
  if (at === selPointer) return;
  selPointer = at;
  const s = state.openSelect;
  const o = s && e.target.closest && e.target.closest('.sel-opt');
  if (o && o.dataset.key === s.key && o.dataset.value !== s.active) setSelActive(s.key, o.dataset.value);
});
document.addEventListener('mousedown', (e) => { if (e.target.closest && e.target.closest('.sel-list')) e.preventDefault(); });
document.addEventListener('focusout', (e) => {
  if (!state.openSelect || !e.target.classList || !e.target.classList.contains('sel-btn')) return;
  setTimeout(() => { const a = document.activeElement; if (state.openSelect && !(a && a.closest && a.closest('.sel'))) closeSelect(); }, 0);
});

document.addEventListener('submit', async (e) => {
  const f = e.target.closest('[data-form]');
  if (!f) return;
  e.preventDefault();
  const t = f.dataset.task && getTask(f.dataset.task);
  switch (f.dataset.form) {
    case 'quick': {
      const goal = $('#quick-goal').value.trim();
      const qa = quickAgentId();
      state.draft = null; state.quickGoal = '';
      navigate(`#/new?agent=${qa}${goal ? '&goal=' + encodeURIComponent(goal) : ''}`);
      break;
    }
    case 'answer': { const v = f.querySelector('input').value.trim(); if (v) answerTask(t, v); break; }
    case 'steer': { if (state.conn.lost) { toast("Can't reach AX right now, so your message wasn't sent. It's still in the box.", { icon: 'alert' }); return; } const ta = f.querySelector('textarea'); const v = ta.value.trim(); if (!v) return; ta.value = ''; ta.style.height = ''; state.steerDraft = ''; steerTask(t, v, state.steerMode === 'now'); break; }
    case 'key': {
      const d = state.draft;
      const ok = await validateKey(f.dataset.agent, $('#key-input').value, $('#key-status'));
      if (ok) { d.keyState = 'ok'; await sleep(700); toast(`${AGENTS[f.dataset.agent].name} is connected`, { icon: 'checkCircle' }); if (parseRoute().parts[0] === 'new') render({ keepScroll: true }); }
      break;
    }
    case 'key-dialog': {
      const A = AGENTS[f.dataset.agent];
      const ok = await validateKey(f.dataset.agent, $('#kd-input').value, $('#kd-status'));
      if (ok) {
        await sleep(700);
        closeDialog();
        const task = f.dataset.task && getTask(f.dataset.task);
        toast(`${A.name} is connected`, { icon: 'checkCircle', action: task && task.status === 'failed' ? { label: 'Retry task', run: () => retryTask(task) } : null });
        render({ keepScroll: true });
      }
      break;
    }
    case 'term': { const inp = f.querySelector('input'); termRun(t, inp.value); break; }
    case 'add-domain': {
      const inp = $('#new-domain');
      addAllowedSite(inp ? inp.value : '', state.allowScope);
      const again = $('#new-domain'); if (again) again.focus({ preventScroll: true });
      break;
    }
    default: break;
  }
});

function updateDraftLive() {
  const d = state.draft;
  if (!d) return;
  const gh = $('#goal-help'); if (gh) { const h = goalHelpHTML(d); if (gh._h !== h) { gh.innerHTML = h; gh._h = h; } }
  const m = $('#manifest'); if (m) m.innerHTML = draftManifest(d);
  const c = $('#draft-cli'); if (c) c.innerHTML = cliHint(draftCli(d));
  const rl = $('#ready-list'); if (rl) rl.innerHTML = readyHTML(d);
  const ew = $('#env-warn'); if (ew) { ew.innerHTML = envWarnHTML(d); ew.className = 'field-status' + (parseEnvVars(d.envVars).some((x) => x.secret) ? ' err' : ''); }
  const sh = $('#setup-hint'); if (sh) sh.innerHTML = setupHintHTML(d);
  const wc = $('#ws-chips'); if (wc) wc.innerHTML = wsChipsHTML(d);
  /* Step numbers turn into checks as you finish each step, without redrawing the form you're typing in. */
  stepStates(d).forEach((ok, k) => {
    const n = $('#sn-' + (k + 1));
    if (!n) return;
    const want = stepNumHTML(k + 1, ok);
    if (n._h !== want) { n.innerHTML = want; n._h = want; if (n.classList) n.classList.toggle('ok', ok); }
  });
  const ph = $('#plan-head');
  if (ph) {
    const axEl = ph.querySelector('svg.axo');
    const wasReady = axEl && axEl.dataset.axo === 'wave';
    const isReady = draftChecks(d).every((x) => x.ok);
    if (wasReady !== isReady) ph.innerHTML = planHeadHTML(d);
    else {
      const sub = ph.querySelector('.small');
      const match = planHeadHTML(d).match(/<div class="small muted">(.*?)<\/div>/);
      if (sub && match) sub.innerHTML = match[1];
    }
  }
}
/* Home with nothing yet: Axel gets curious when you put the cursor in the empty goal box. */
document.addEventListener('focusin', (e) => { const el = e.target; if (el && el.id === 'quick-goal' && !String(el.value || '').trim()) homeNudge('focus'); });
document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.id === 'tasks-q') {
    tasksFilter().q = el.value; const tb = $('#tasks-table'); if (tb) tb.innerHTML = tasksTableHTML();
    clearTimeout(window.__tqT); window.__tqT = setTimeout(() => { const tc = $('#tasks-count'); if (tc) tc.textContent = `${plural(tasksMatching().length, 'task')} shown`; }, 500);
    return;
  }
  if (el.dataset && el.dataset.bind && state.draft) {
    state.draft[el.dataset.bind] = el.value;
    if (el.dataset.bind === 'setup') state.draft.setupEdited = true;
    if (el.dataset.bind === 'goal') state.draft.goalFromSample = false;
    if (el.dataset.bind === 'goal' && state.draft.error) { state.draft.error = ''; const err = $('#goal-err'); if (err) err.innerHTML = ''; el.removeAttribute('aria-invalid'); }
    updateDraftLive();
  } else if (el.dataset && el.dataset.fileI != null && state.draft) {
    /* An inline file's path or contents: update the draft, its secret warning, and the chips, checklist, YAML and CLI. */
    const k = +el.dataset.fileI, f = (state.draft.inlineFiles || [])[k];
    if (f) {
      f[el.dataset.fileK === 'content' ? 'content' : 'path'] = el.value;
      const w = $('#file-warn-' + k);
      if (w) { const bad = fileHasSecret(f); w.className = 'field-status' + (bad ? ' err' : ''); w.innerHTML = bad ? fileSecretMsg() : ''; }
      updateDraftLive();
    }
  } else if (el.id === 'steer') {
    state.steerDraft = el.value;
    el.style.height = 'auto';
    el.style.height = Math.min(160, el.scrollHeight) + 'px';
  } else if (el.id === 'quick-goal') {
    state.quickGoal = el.value;
    if (el.value.trim()) homeNudge('typing');
  }
});

/* ---------- Keyboard ---------- */
let gPending = false;
document.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  trapFocus(e);
  /* The command palette works with real data too: live.js gives it the real tasks, clusters and actions. */
  if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); if (dialogState) closeDialog(); else openPalette(); return; }
  /* A focused dropdown handles its own keys first (arrows, Enter, Space, Escape, Tab, typing a name). */
  const selBtn = e.target && e.target.closest && e.target.closest('.sel-btn');
  if (selBtn && selKeydown(e, selBtn)) return;
  if (e.key === 'Escape') {
    if (dialogState) { e.preventDefault(); closeDialog(); return; }
    if ($('#bell-pop') && $('#bell-pop').innerHTML) { closeBell(); const b = $('#bell'); if (b) b.focus(); return; }
  }
  const tgt = e.target;
  const typing = tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable);
  if (typing) {
    if (tgt.id === 'goal' && mod && e.key === 'Enter') { e.preventDefault(); createTaskFromDraft(); }
    else if (tgt.id === 'steer' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); tgt.form.requestSubmit(); }
    return;
  }
  /* ARIA tabs and radio groups: arrow keys move between options (selection follows focus), Home/End jump. */
  const role = tgt && tgt.getAttribute ? tgt.getAttribute('role') : null;
  if ((role === 'radio' || role === 'tab') && ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(e.key) && !mod) {
    const groupRole = role === 'tab' ? 'tablist' : 'radiogroup';
    const group = tgt.closest(`[role="${groupRole}"]`);
    const enabled = (x) => x.getAttribute('aria-disabled') !== 'true' && !x.disabled;
    const items = group ? [...group.querySelectorAll(`[role="${role}"]`)].filter(enabled) : [];
    const k = items.indexOf(tgt);
    if (k >= 0 && items.length > 1) {
      e.preventDefault();
      const fwd = e.key === 'ArrowRight' || e.key === 'ArrowDown';
      const n = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (k + (fwd ? 1 : -1) + items.length) % items.length;
      const fk = focusKeyOf(items[n]);
      items[n].focus();
      items[n].click();
      /* Most choices re-render the view; render() restores focus, this covers choices that re-render later. */
      if (!document.contains(items[n])) restoreFocus(fk);
    }
    return;
  }
  if (dialogState || mod || e.altKey) return;
  /* WCAG 2.1.4: single-key shortcuts can be turned off under Accessibility in Settings. */
  if (!state.singleKeys) return;
  if (gPending) {
    gPending = false;
    /* With real data, only the pages that are real: Guardrails isn't connected to AX yet. */
    const map = liveOn() ? { h: '#/', s: '#/settings', p: '#/places', n: '#/new' } : { h: '#/', r: '#/guardrails', s: '#/settings', p: '#/places', n: '#/new' };
    if (map[e.key]) { e.preventDefault(); navigate(map[e.key]); }
    return;
  }
  if (e.key === 'g') { gPending = true; setTimeout(() => { gPending = false; }, 1200); return; }
  /* A New task you started stays as you left it with real data; the demo starts a fresh one. */
  if (e.key === 'n') { e.preventDefault(); if (!liveOn()) state.draft = null; navigate('#/new'); }
  else if (e.key === '?') { e.preventDefault(); openShortcuts(); }
  else if (e.key === '/') { e.preventDefault(); openPalette(); }
  else if (e.key === 't') { setTheme(resolvedTheme() === 'dark' ? 'light' : 'dark'); }
});

/* ---------- Roving tabindex: one tab stop per tab list or radio group (the selected option) ---------- */
function applyRoving(root) {
  (root || document).querySelectorAll('[role="tablist"], [role="radiogroup"]').forEach((g) => {
    const role = g.getAttribute('role') === 'tablist' ? 'tab' : 'radio';
    const items = [...g.querySelectorAll(`[role="${role}"]`)];
    if (!items.length) return;
    const enabled = items.filter((x) => x.getAttribute('aria-disabled') !== 'true' && !x.disabled);
    const sel = enabled.find((x) => x.getAttribute(role === 'tab' ? 'aria-selected' : 'aria-checked') === 'true') || enabled[0];
    items.forEach((x) => x.setAttribute('tabindex', x === sel ? '0' : '-1'));
  });
}
if (typeof MutationObserver !== 'undefined') {
  let rovingRaf = 0;
  new MutationObserver(() => {
    if (rovingRaf) return;
    rovingRaf = requestAnimationFrame(() => { rovingRaf = 0; applyRoving(); });
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-checked', 'aria-selected'] });
}

/* ---------- Live clock for elapsed / relative times ---------- */
setInterval(() => {
  $$('[data-since]').forEach((el) => {
    const ts = +el.dataset.since;
    el.textContent = el.dataset.fmt === 'elapsed' ? fmtElapsed(ts) : el.dataset.fmt === 'secs' ? `${Math.round((now() - ts) / 1000)} s` : fmtAgo(ts);
  });
}, 1000);

/* ---------- Rate limits: count down, then retry on their own (the provider's retry-after) ---------- */
setInterval(() => {
  state.tasks.forEach((t) => {
    const at = quotaRetryAt(t);
    if (!at) return;
    if (at <= now()) { retryTask(t, 'The rate limit reset, so AX retried on its own'); return; }
    if (onTask(t)) { refreshNextStep(t); const h = $('#task-head'); if (h && !h.contains(document.activeElement)) h.innerHTML = taskHeadHTML(t); }
  });
}, 1000);

/* ---------- Template downloads: "Downloading · N%" stays live on Ready, New task and a waiting task ---------- */
setInterval(() => {
  const dl = state.downloads || {};
  const ids = Object.keys(dl);
  if (!ids.length) return;
  $$('[data-dl]').forEach((el) => { el.textContent = dlPct(el.dataset.dl) + '%'; });
  $$('[data-dl-secs]').forEach((el) => { el.textContent = dlSecsLeft(el.dataset.dlSecs); });
  const done = ids.filter((id) => !isDownloading(id));
  if (!done.length) return;
  done.forEach((id) => { delete dl[id]; });
  saveDownloads();
  if (!Object.keys(dl).length) toast('All templates are downloaded and ready.', { icon: 'checkCircle' });
  const top = state.route && state.route.parts[0];
  if ((top === 'welcome' || top === 'new') && !dialogState && !isTypingIn('#main')) render({ keepScroll: true, background: true });
}, 1000);

/* ---------- Init ---------- */
document.body.insertAdjacentHTML('afterbegin', AXO_DEFS);
document.body.classList.toggle('show-infra', state.showInfra);
document.addEventListener('toggle', (e) => {
  if (!e.target || !state.draft) return;
  if (e.target.id === 'advanced') state.draft.advOpen = e.target.open;
  else if (e.target.id === 'ws-more') state.draft.wsOpen = e.target.open;
}, true);
applyTheme();
/* Switching tabs inside one task keeps the page still: same scroll position, no entrance animation,
   and keyboard focus stays on the tab you chose. Every other navigation is a full page change. */
window.addEventListener('hashchange', () => {
  const r = parseRoute();
  /* Compare with the route on screen (go(), navigate() and redirects all render through render()). */
  const p = state.route;
  const sameTask = p && p.parts[0] === 'task' && r.parts[0] === 'task' && p.parts[1] === r.parts[1];
  if (sameTask) {
    /* Switching task tabs swaps only the panel: no scroll jump, no entrance animation, focus stays on the tab. */
    lastPath = r.path;
    render({ keepScroll: true });
    return;
  }
  if (p && p.parts[0] === 'settings' && r.parts[0] === 'settings') {
    /* Switching Settings sections replaces only the section: the heading and the nav stay still (no entrance
       animation), the new section starts at the top, and focus moves to its heading (viewSettings' after()). */
    lastPath = r.path;
    state.settingsFocus = true;
    render({ keepScroll: true });
    window.scrollTo(0, 0);
    return;
  }
  render();
});
/* CUJ 2 review mode (…?cuj=2): arrive on "Ready: run your first agent" right after setup, with the templates you
   didn't pick first still downloading in the background. */
if (state.firstRun && !state.setup) {
  state.setup = { phase: 'ready', step: 4, pick: DEFAULT_AGENT, path: state.env.mode === 'cluster' ? 'cluster' : 'local' };
  if (!downloadsSaved()) startDownloads(prebuiltAgents().filter((a) => a.id !== DEFAULT_AGENT).map((a) => a.id), 50000);
}
/* Warm start: opening Studio briefly shows the local sandbox starting, then healthy. */
if (!liveOn() && setupDone() && state.env.mode === 'local' && !state.firstRun) setHealth('starting', null, 2);
render();
/* Review links: …?scenario=<id> opens one prototype scenario directly. The review page (#/review) lists them all; it
   isn't linked from anywhere in the app. */
(() => {
  const id = new URLSearchParams(location.search).get('scenario');
  const s = id && SCENARIOS.find((x) => x.id === id);
  if (!s) return;
  try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) {}
  if (s.group !== 'Set up') ensureSetUp();
  setTimeout(() => runScenario(id), 450);
})();


/* ---------- Lost connection to AX ----------
   If Studio loses its link to the local daemon or the cluster (network drop, sleep, daemon restart), tasks keep running.
   Studio says so once in a banner, greys out live indicators ("Last update 40 s ago"), holds commands, retries with
   backoff, and catches up when it's back. A dropped stream never marks a task Failed. */
const CONN_COMMANDS = ['allow', 'allow-once', 'deny', 'perm-once', 'perm-task', 'perm-deny', 'answer', 'pause', 'resume', 'stop', 'push', 'apply', 'open-pr', 'promote', 'handoff', 'budget-raise', 'budget-stop', 'take-back', 'fix', 'interrupt', 'run-task'];
let connTimer = null;
function connLost(why) {
  if (state.conn.lost) return;
  state.conn = { lost: true, since: now(), attempts: 1, why: why || 'network' };
  document.body.classList.add('conn-lost');
  clearInterval(connTimer);
  connTimer = setInterval(() => { state.conn.attempts++; refreshConn(); }, 3000);
  refreshConn(); updateChrome();
  state.tasks.forEach((t) => refreshAfterStatus(t));
}
function connRestored() {
  if (!state.conn.lost) return;
  clearInterval(connTimer);
  const held = state.tasks.filter((t) => t._connHeld);
  state.conn = { lost: false, since: 0, attempts: 0 };
  document.body.classList.remove('conn-lost');
  refreshConn(); updateChrome();
  held.forEach((t) => { t._connHeld = false; clearTimeout(t._timer); runStep(t); });
  state.tasks.forEach((t) => refreshAfterStatus(t));
  toast(held.length ? `Reconnected. Caught up on ${plural(held.length, 'update')}.` : 'Reconnected. Everything is up to date.', { icon: 'checkCircle' });
}
function refreshConn() {
  const b = $('#conn-banner');
  if (!b) return;
  if (!state.conn.lost) { b.hidden = true; b.innerHTML = ''; return; }
  const where = state.env.mode === 'cluster' ? state.env.cluster : "this computer's sandbox";
  b.hidden = false;
  b.innerHTML = `${icon('alert', 'sm')}<span><b>Lost connection to ${esc(where)}.</b> Reconnecting… (attempt ${state.conn.attempts}). Your tasks keep running, and updates arrive when it's back.</span>
    <button class="btn sm" data-action="conn-retry">Retry now</button><button class="btn ghost sm" data-action="diagnostics">${icon('copy', 'sm')}Copy diagnostics</button>`;
}
ACTIONS['conn-retry'] = () => { state.conn.attempts++; refreshConn(); toast('Trying to reconnect…', { icon: 'loader', timeout: 1200 }); if (navigator.onLine !== false) setTimeout(connRestored, 1200); };
window.addEventListener('offline', () => connLost('offline'));
window.addEventListener('online', () => setTimeout(connRestored, 1200));


/* ---------- Never drop focus (WCAG 2.4.3) ----------
   When a redraw removes the focused control (a dialog step, a live table, a background refresh), focus moves to the same
   control in the new markup, else to the dialog's next sensible control, else to the page heading. It never falls back
   to the page body, which would send keyboard and screen reader users to the top with nothing announced. */
let lastFocusInfo = null;
document.addEventListener('focusin', (e) => {
  if (e.target && e.target !== document.body) lastFocusInfo = { el: e.target, key: focusKeyOf(e.target), inDialog: !!(e.target.closest && e.target.closest('#overlay')) };
});
let focusRaf = 0;
function recoverFocus() {
  const a = document.activeElement;
  if (a && a !== document.body && a !== document.documentElement) return;
  const L = lastFocusInfo;
  if (!L || document.contains(L.el)) return;
  if (L.key) { restoreFocus(L.key); if (document.activeElement && document.activeElement !== document.body) return; }
  const dlg = dialogState && dialogState.el;
  if (dlg && document.contains(dlg)) {
    const t = dlg.querySelector('[data-autofocus]:not([disabled]), #pm-next:not([disabled]), .dialog-foot .btn.primary:not([disabled]), .dialog-body input:not([type="checkbox"]), .dialog-body button:not([disabled])') || dlg;
    t.focus({ preventScroll: true });
    return;
  }
  if (L.inDialog) return;
  const h = $('#main h1');
  if (h) { if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
}
if (typeof MutationObserver === 'function') new MutationObserver(() => { if (focusRaf) return; focusRaf = requestAnimationFrame(() => { focusRaf = 0; recoverFocus(); }); }).observe(document.body, { childList: true, subtree: true });
if (document.body && document.body.classList) document.body.classList.toggle('reduce-motion', !!state.reduceMotion);
