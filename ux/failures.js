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

/* AX Studio prototype — failure paths ("What can go wrong"), one fail-card component (V3),
   environment health lifecycle (F19), and prototype scenarios for usability studies. */
'use strict';

/* ---------- Error catalog ----------
   Every known failure maps to: what happened · how to fix · a primary fix · an alternative · Copy diagnostics.
   Fields may be strings or functions of ctx ({ t, e, cluster, repo, agent }). */
const IT_NOTES = {
  'setup-virt': 'Hi IT team, AX Studio needs Apple Virtualization turned on for my Mac so coding agents can run in an isolated sandbox (microVM). Could you allow com.apple.virtualization for my device? If that isn\'t possible, I can use our remote cluster instead. Thanks!',
  'setup-admin': 'Hi IT team, AX Studio needs administrator approval once, to turn on hardware isolation for its local sandbox. Could you approve the "enable-virtualization-helper" step with me, or let me know if I should use our remote cluster instead? Thanks!',
};
const agentOf = (ctx) => AGENTS[(ctx.t && ctx.t.agent) || ctx.agent] || AGENTS[DEFAULT_AGENT];
/* Other tasks using this computer's memory right now (CUJ 3, out of memory: "pause other tasks"). */
const otherLocalRunning = (t) => state.tasks.filter((x) => x !== t && x.env === 'local' && (x.status === 'running' || x.status === 'starting'));
/* Which MCP server or skill a CUJ 2 workspace failure is about (from the failure event; the demo default is Linear). */
const mcpOf = (ctx) => (ctx.e && ctx.e.server) || 'linear';
const mcpsOf = (ctx) => (ctx.t && ctx.t.mcp) || ['github', 'linear'];
const skillOf = (ctx) => (ctx.e && ctx.e.skill) || 'frontend-design';
const skillNeedsOf = (ctx) => (ctx.e && ctx.e.needs) || ((SKILLS.find((s) => s.id === skillOf(ctx)) || {}).needs) || 'playwright';
const ERRORS = {
  /* CUJ 1 · Set up */
  'setup-disk': {
    icon: 'alert', title: 'Not enough free space for the local sandbox',
    cause: 'AX needs about 6 GB free for the sandbox and agent images. This Mac has 3.1 GB free.',
    fix: 'Free up space, then check again. Or connect to a remote cluster: nothing is installed on this computer.',
    actions: [{ id: 'recheck', label: 'Check again', icon: 'refresh', primary: true }, { id: 'connect-instead', label: 'Connect to a remote cluster', icon: 'cloud' }],
    log: 'check.disk  required=6.0 GB  available=3.1 GB  volume=/System/Volumes/Data', cli: 'ax setup --check',
  },
  'setup-memory': {
    icon: 'alert', title: 'Not enough free memory for the local sandbox',
    cause: 'AX needs about 8 GB of free memory to run the sandbox and one agent. This Mac has 16 GB, and other apps are using 13 GB.',
    fix: 'Close apps you aren\'t using, then check again. Or connect to a remote cluster: nothing is installed on this computer.',
    actions: [{ id: 'recheck', label: 'Check again', icon: 'refresh', primary: true }, { id: 'connect-instead', label: 'Connect to a remote cluster', icon: 'cloud' }],
    log: 'check.memory  required=8.0 GB  free=3.0 GB  installed=16.0 GB', cli: 'ax setup --check',
  },
  /* Installed memory is too small: closing apps can't fix it, so the only way forward is a remote cluster. */
  'setup-ram': {
    icon: 'alert', title: "This Mac doesn't have enough memory for the local sandbox",
    cause: 'AX needs a Mac with at least 8 GB of memory to run the sandbox and one agent. This Mac has 4 GB installed.',
    fix: "Closing apps won't help, because the limit is the memory installed. Connect to a remote cluster: tasks run there and nothing is installed on this computer.",
    actions: [{ id: 'connect-instead', label: 'Connect to a remote cluster', icon: 'cloud', primary: true }],
    log: 'check.memory  required=8.0 GB  installed=4.0 GB', cli: 'ax setup --check',
  },
  'setup-virt': {
    icon: 'lock', title: 'Your organization turned off virtualization on this Mac',
    cause: "This Mac's device-management profile blocks Apple Virtualization, which the local sandbox uses for hardware isolation.",
    fix: 'Connect to a remote cluster instead, or send IT a note asking them to allow it.',
    actions: [{ id: 'connect-instead', label: 'Connect to a remote cluster', icon: 'cloud', primary: true }, { id: 'copy-it-note', label: 'Copy note for IT', icon: 'copy' }],
    log: 'check.virtualization  denied by MDM profile "Acme Corp Baseline" (com.acme.mdm.restrictions)', cli: 'ax setup --check',
  },
  'setup-admin': {
    icon: 'key', title: 'Setup needs administrator permission once',
    cause: "Turning on hardware isolation asks for an administrator password one time. Your account isn't an administrator on this Mac.",
    fix: 'Connect to a remote cluster (no admin rights needed), or ask IT to approve this step with you.',
    actions: [{ id: 'connect-instead', label: 'Connect to a remote cluster', icon: 'cloud', primary: true }, { id: 'copy-it-note', label: 'Copy request for IT', icon: 'copy' }],
    log: 'check.admin  user=rajitha groups=staff  step=enable-virtualization-helper requires authorization', cli: 'ax setup --check',
  },
  'setup-download': {
    icon: 'download', title: (c) => (c.agent === 'byo' ? "Couldn't download the agent runner" : `Couldn't download the ${agentOf(c).name} image`),
    cause: 'A proxy on your network blocked registry.ax.dev, where AX downloads agent images (407 Proxy Authentication Required).',
    fix: 'Check your proxy settings, then retry. Setup picks up from this step; steps 1–3 are kept.',
    actions: [{ id: 'retry-setup', label: 'Retry download', icon: 'refresh', primary: true }, { id: 'proxy-help', label: 'Proxy settings', icon: 'globe' }, { id: 'connect-instead', label: 'Connect to a remote cluster', icon: 'cloud' }],
    log: (c) => `pull ${c.agent === 'byo' ? runnerImage() : agentImage(agentOf(c))} through the AX mirror registry.ax.dev:443\nproxy.acme.internal:8080 → 407 Proxy Authentication Required\nsetup: paused at step 4 of 4 (steps 1–3 kept)`, cli: 'ax setup --resume',
  },
  'setup-interrupted': {
    tone: 'warn', icon: 'clock', title: 'Setup was interrupted at step 2 of 4',
    cause: 'This Mac restarted while the sandbox was being created. Step 1 is kept.',
    fix: 'Resume to pick up where it stopped, or start over.',
    actions: [{ id: 'resume-setup', label: 'Resume setup', icon: 'play', primary: true }, { id: 'reset-setup', label: 'Start over', icon: 'undo' }],
    log: 'setup.state  step=2/4 (create-sandbox)  reason=host-restart  kept=[check-computer]', cli: 'ax setup --resume',
  },
  /* CUJ 2 · First agent */
  'key-rejected': {
    icon: 'key', title: (c) => `${agentOf(c).name} couldn't start: your ${agentOf(c).maker} key was rejected`,
    cause: (c) => `${agentOf(c).maker} answered “401 Unauthorized”. The key may have been revoked, or it expired.`,
    fix: 'Sign in again or add a new key, then retry. Your workspace and goal are saved. Or try another agent.',
    actions: [{ id: 'update-key', label: 'Fix sign-in', icon: 'key', primary: true }, { id: 'retry', label: 'Retry', icon: 'refresh' }, { id: 'try-another', label: 'Try another agent', icon: 'handoff' }],
    max: 3,
    cli: (c) => `ax keys set ${agentOf(c).cli}`,
  },
  quota: {
    icon: 'clock', title: (c) => `${agentOf(c).maker} rate limit reached`,
    cause: (c) => `${agentOf(c).maker} answered “429 Too Many Requests”: this key hit its per-minute token limit. Work so far is saved.`,
    /* CUJ 2: "Wait, or switch key or model". */
    fix: (c) => { const m = c.t && altModel(c.t.agent, c.t.model); const at = quotaRetryAt(c.t); return at && at > Date.now() ? `AX retries on its own in ${fmtCountdown(at - Date.now())}, when the limit resets. Or ${m ? `switch to ${m.name} or ` : ''}use a different key now.` : `The limit has reset. Retry now${m ? `, switch to ${m.name},` : ''} or use a different key.`; },
    max: 3,
    actions: [{ id: 'retry', label: 'Retry now', icon: 'refresh', primary: true }, { id: 'switch-model', label: (c) => { const m = c.t && altModel(c.t.agent, c.t.model); return m ? `Switch to ${m.name}` : 'Switch model'; }, icon: 'cpu' }, { id: 'update-key', label: 'Use a different key', icon: 'key' }],
    log: '[22:41:07] guardrails: egress api.anthropic.com:443 → 429 Too Many Requests (retry-after: 120)\n[22:41:07] agent: paused at turn boundary, workspace kept',
  },
  'repo-denied': {
    icon: 'lock', title: "Couldn't clone acme/admin-portal",
    cause: "GitHub answered 403: your GitHub sign-in can't read this private repository.",
    fix: 'Sign in to GitHub with an account that can read acme/admin-portal. The task retries on its own once you have.',
    actions: [{ id: 'github-signin', label: 'Sign in to GitHub', icon: 'globe', primary: true }, { id: 'retry', label: 'Retry', icon: 'refresh' }],
    log: 'git clone https://github.com/acme/admin-portal.git\nremote: Repository not found.\nfatal: 403 (credential: github-oauth · scope: public_repo)', cli: 'ax auth login github',
  },
  /* CUJ 2: "An MCP server / skill fails to start" → which one, plus its log → Edit the Workspace setup. The server
     (or skill) comes from the failure event, so the same card covers GitHub, Linear and a skill that can't load. */
  'mcp-failed': {
    icon: 'server', title: (c) => `MCP server “${mcpOf(c)}” didn't start`,
    cause: (c) => {
      const id = mcpOf(c), ok = mcpsOf(c).filter((x) => x !== id && !mcpNeedsSignIn(x));
      return `${mcpName(id)} needs you to sign in before the agent can use it.${ok.length ? ` The other MCP ${ok.length > 1 ? 'servers' : 'server'} (${ok.join(', ')}) started fine.` : ''}`;
    },
    fix: (c) => `Connect ${mcpName(mcpOf(c))} (its token stays in your keychain), edit the workspace setup, or remove ${mcpName(mcpOf(c))} and retry.`,
    max: 3,
    actions: [{ id: 'connect-mcp', label: (c) => `Connect ${mcpName(mcpOf(c))}`, icon: 'link', primary: true }, { id: 'edit-workspace', label: 'Edit workspace setup', icon: 'pencil' }, { id: 'remove-mcp', label: (c) => `Remove ${mcpName(mcpOf(c))} and retry`, icon: 'trash' }],
    log: (c) => { const id = mcpOf(c); return mcpsOf(c).filter((x) => x !== id && !mcpNeedsSignIn(x)).map((x) => `mcp[${x}]: ready`).concat(`mcp[${id}]: exited with code 1 — no credential "${id}-oauth" in keychain`).join('\n'); },
    cli: (c) => (mcpOf(c) === 'github' ? 'ax auth login github' : ''),
  },
  'skill-failed': {
    icon: 'sparkle', title: (c) => `Skill “${skillOf(c)}” didn't load`,
    cause: (c) => {
      const ok = ((c.t && c.t.skills) || ['ax-task']).filter((x) => x !== skillOf(c));
      return `It uses the ${mcpName(skillNeedsOf(c))} MCP server, and this workspace doesn't include it.${ok.length ? ` The other ${ok.length > 1 ? 'skills' : 'skill'} (${ok.join(', ')}) loaded fine.` : ''}`;
    },
    fix: (c) => `Edit the workspace setup to add ${mcpName(skillNeedsOf(c))}, or remove ${skillOf(c)} and retry.`,
    actions: [{ id: 'edit-workspace', label: 'Edit workspace setup', icon: 'pencil', primary: true }, { id: 'remove-skill', label: (c) => `Remove ${skillOf(c)} and retry`, icon: 'trash' }],
    log: (c) => {
      const ok = ((c.t && c.t.skills) || ['ax-task']).filter((x) => x !== skillOf(c));
      return ok.map((x) => `skills[${x}]: loaded`).concat(`skills[${skillOf(c)}]: needs mcp "${skillNeedsOf(c)}" · not in this workspace`, `skills: ${ok.length} of ${ok.length + 1} loaded`).join('\n');
    },
  },
  'image-unavailable': {
    icon: 'download', title: (c) => `The ${agentOf(c).name} image couldn't be downloaded`,
    cause: (c) => `${agentImage(agentOf(c))} timed out after 3 tries. Your workspace and goal are saved.`,
    fix: 'Retry the download, or start with another agent that is already downloaded.',
    actions: [{ id: 'retry', label: 'Retry download', icon: 'refresh', primary: true }, { id: 'try-another', label: 'Try another agent', icon: 'handoff' }],
    log: (c) => `pull ${agentImage(agentOf(c))}\nattempt 1/3: timeout after 60s\nattempt 2/3: timeout after 60s\nattempt 3/3: timeout after 60s`,
  },
  /* CUJ 3 · Watch, steer, unblock */
  /* CUJ 3: "Out of memory" → which task and its resource use → pause other tasks, or move to a remote cluster. */
  oom: {
    icon: 'cpu', title: 'The sandbox ran out of memory',
    cause: (c) => {
      const others = otherLocalRunning(c.t);
      return `The integration tests used all 4 GB (Medium) at their peak, so the sandbox stopped them. Files changed so far are kept.${others.length ? ` ${plural(others.length, 'other task')} on this computer ${others.length === 1 ? 'is' : 'are'} using about ${(others.length * 1.6).toFixed(1)} GB.` : ''}`;
    },
    fix: (c) => (otherLocalRunning(c.t).length
      ? 'Pause the other tasks on this computer and restart with 8 GB, or run this task on a remote cluster.'
      : 'Restart with 8 GB, or run this task on a remote cluster.'),
    max: 3,
    actions: [{ id: 'restart-large', label: 'Restart with 8 GB', icon: 'refresh', primary: true },
      { id: 'pause-others', label: (c) => { const n = otherLocalRunning(c.t).length; return `Pause ${plural(n, 'other task')}`; }, icon: 'pause' },
      { id: 'promote', label: 'Run on a remote cluster', icon: 'cloudUp' }],
    log: (c) => {
      const others = otherLocalRunning(c.t);
      return `FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory\nsandbox: memory 4.0 / 4.0 GB (peak) → OOM kill (pid 412, node) · CPU 2 / 2\nhost: ${others.length ? `${plural(others.length, 'other task')} running here (${others.map((x) => x.id).join(', ')})` : 'no other tasks running here'}`;
    },
  },
  crash: {
    icon: 'alert', title: (c) => `${agentOf(c).name} exited unexpectedly`,
    cause: 'The agent process crashed (exit code 134) while running “npm run build”. Its last activity is above, and changed files are kept.',
    fix: 'Restart from the current workspace. Nothing in your folder changed.',
    actions: [{ id: 'restart-workspace', label: 'Restart from current workspace', icon: 'refresh', primary: true }, { id: 'try-another', label: 'Try another agent', icon: 'handoff' }],
    log: 'agent: SIGABRT (exit 134) during run_command("npm run build")\nlast output: "Building 214 modules…"\nworkspace: kept (1 changed file)',
  },
  /* CUJ 4 · Review and take results */
  'apply-conflict': {
    tone: 'warn', icon: 'alert', title: (c) => `${plural(conflictFiles(c.t).length, 'file conflicts', 'files conflict')} with changes in your folder`,
    cause: (c) => `${c.t.folder} changed after the task started: ${conflictFiles(c.t).join(' and ')} ${conflictFiles(c.t).length > 1 ? 'were' : 'was'} edited locally.`,
    fix: 'Push to a new branch and merge it there, or apply only the files that don\'t conflict.',
    actions: [{ id: 'push-instead', label: 'Push to a new branch instead', icon: 'branch', primary: true }, { id: 'apply-partial', label: 'Apply the other files', icon: 'folder' }],
    log: (c) => `git apply --check\n${conflictFiles(c.t).map((p) => `error: patch failed: ${p}:3`).join('\n')}\nlocal edits since task start detected`,
  },
  'github-needed': {
    icon: 'globe', title: 'GitHub isn\'t connected yet',
    cause: 'AX pushes branches and opens pull requests with your GitHub sign-in, and this computer isn\'t signed in to GitHub.',
    fix: 'Sign in to GitHub and AX pushes right after. Or download a patch instead.',
    actions: [{ id: 'github-signin-push', label: 'Sign in and push', icon: 'globe', primary: true }, { id: 'patch', label: 'Download a patch', icon: 'download' }],
    cli: 'ax auth login github',
  },
  'push-rejected': {
    icon: 'lock', title: 'GitHub rejected the push',
    cause: "Your GitHub sign-in expired (401), so the branch couldn't be pushed. Nothing was lost.",
    fix: 'Sign in to GitHub again and push. Or download a patch instead.',
    actions: [{ id: 'github-signin-push', label: 'Sign in and push', icon: 'globe', primary: true }, { id: 'patch', label: 'Download a patch', icon: 'download' }],
    log: (c) => `git push origin ${c.t ? c.t.branch : 'ax/branch'}\nremote: Invalid username or token.\nfatal: Authentication failed (401)`,
  },
  /* CUJ 5 · Continue with another agent */
  'handoff-start': {
    icon: 'alert', title: (c) => `${agentOf(c).name} couldn't start`,
    cause: (c) => `The ${agentOf(c).name} image download timed out. ${c.t && c.t.parent && getTask(c.t.parent) ? AGENTS[getTask(c.t.parent).agent].name + "'s" : 'The previous'} workspace is untouched. Nothing was lost.`,
    fix: 'Retry, or continue with a different agent.',
    actions: [{ id: 'retry', label: 'Retry', icon: 'refresh', primary: true }, { id: 'try-another', label: 'Try another agent', icon: 'handoff' }],
    log: (c) => `pull ${agentImage(agentOf(c))}: timeout after 60s\nhandoff: source workspace unchanged`,
  },
  /* CUJ 6 · Remote cluster */
  'cluster-unreachable': {
    icon: 'cloud', title: (c) => `Can't reach ${c.cluster}`,
    cause: 'The connection timed out after 10 s. The cluster may be down, or your network may block it (is your VPN on?).',
    fix: 'Retry, or keep running on this computer. Your task is unaffected.',
    actions: [{ id: 'retry-preflight', label: 'Retry', icon: 'refresh', primary: true }, { id: 'keep-local', label: 'Keep running on this computer', icon: 'laptop' }],
    log: (c) => `dial tcp ${c.cluster}.agents.acme.dev:443: i/o timeout (10s)`,
  },
  'cluster-version': {
    icon: 'layers', title: (c) => `${c.cluster} runs an older AX version`,
    cause: 'It runs AX 0.8.1. This task uses guardrails.preset, which needs AX 0.9 or later (your Studio and CLI are 0.9.2).',
    fix: 'Ask the cluster owner to upgrade, or choose another cluster.',
    actions: [{ id: 'copy-upgrade', label: 'Copy upgrade request', icon: 'copy', primary: true }, { id: 'pick-cluster', label: 'Choose another cluster', icon: 'server' }],
  },
  'cluster-missing': {
    icon: 'server', title: (c) => `${c.cluster} doesn't have the ${c.missing || 'Linear'} MCP server`,
    cause: (c) => `Your workspace setup uses the ${c.missing || 'Linear'} MCP server. It isn't in ${c.cluster}'s catalog, so the cluster can't rebuild the workspace as it is.${c.others ? ` Everything else is there: ${c.others}.` : ''}`,
    fix: (c) => `Run without ${c.missing || 'Linear'} (the agent loses those tools on the cluster), or ask your admin to add it.`,
    actions: [{ id: 'run-without', label: (c) => `Run without ${c.missing || 'Linear'}`, icon: 'cloudUp', primary: true }, { id: 'ask-admin-mcp', label: 'Ask your admin', icon: 'copy' }],
  },
  'cluster-forbidden': {
    icon: 'lock', title: (c) => `You can't run tasks on ${c.cluster} yet`,
    cause: (c) => `Your account doesn't have the agent-runner role in the team-agents namespace on ${c.cluster} (403 Forbidden).`,
    fix: 'Ask your admin for the role, then check again. Or choose another cluster.',
    actions: [{ id: 'ask-admin-role', label: 'Ask your admin', icon: 'copy', primary: true }, { id: 'pick-cluster', label: 'Choose another cluster', icon: 'cloud' }],
    log: (c) => `kubectl auth can-i create agenttasks -n team-agents --context ${c.cluster}\nno (403 Forbidden: your kubeconfig user lacks role agent-runner)`,
  },
  'cluster-blocker': {
    icon: 'key', title: (c) => `${c.cluster} can't read acme/${c.repo}`,
    cause: "There's no GitHub credential for the team-agents namespace, so the remote task can't clone your repository.",
    fix: 'Add GitHub access for this cluster. The check runs again on its own.',
    actions: [{ id: 'add-repo-cred', label: 'Add GitHub access', icon: 'globe', primary: true }, { id: 'ask-admin-cred', label: 'Ask your admin', icon: 'copy' }],
  },
  /* Environment health */
  'env-disk-low': {
    tone: 'warn', icon: 'alert', title: 'Disk almost full',
    cause: "Only 1.8 GB left on this Mac. New tasks may fail to start, and agent images can't update.",
    fix: 'Clean up old sandboxes to free 2.4 GB, or free space on your Mac.',
    actions: [{ id: 'clean-sandboxes', label: 'Clean up old sandboxes', icon: 'trash', primary: true }],
    log: 'disk: 1.8 GB free of 494 GB\nsandboxes: 6 stopped (2.4 GB reclaimable)', cli: 'ax doctor --fix',
  },
};
function val(x, ctx) { return typeof x === 'function' ? x(ctx || {}) : x; }
/* Up to two files conflict, and at least one stays clean when there is more than one, so “Apply the other files” has something to apply. */
function conflictFiles(t) { if (t && t.conflictPaths) return t.conflictPaths.filter((p) => !appliedPaths(t).includes(p)); const fs = filesFor(t); return fs.slice(0, Math.max(1, Math.min(2, fs.length - 1))).map((f) => f.path); }

/** The one fail-card component (V3): same layout in setup, tasks, review, promote and health. */
/** A failure's actions, adjusted to what's already fixed: once the agent is signed in again, Retry is the next step. */
function keyFixed(code, ctx) {
  const t = ctx && ctx.t; const A = t && AGENTS[t.agent];
  return code === 'key-rejected' && !!A && A.connected && !A.keyProblem;
}
function actionsFor(code, ctx) {
  const E = ERRORS[code] || ERRORS.crash;
  const acts = keyFixed(code, ctx)
    ? [{ id: 'retry', label: 'Retry', icon: 'refresh', primary: true }, { id: 'try-another', label: 'Try another agent', icon: 'handoff' }]
    : (E.actions || []);
  /* "Switch model" only shows when the template has another model to switch to. */
  /* Retry only shows once the cause has changed: with repo access or a rejected key, retrying as-is fails the same
     way, so the card offers the fix (which retries on its own) and the ways around it. */
  const t0 = ctx && ctx.t;
  const noRetry = (code === 'repo-denied' && !(t0 && t0.repoAccess)) || (code === 'key-rejected' && !keyFixed(code, ctx)) || (code === 'quota' && quotaWaiting(t0));
  return acts.filter((a) => !(noRetry && a.id === 'retry') && !((ctx && ctx.omit) || []).includes(a.id) && (a.id !== 'switch-model' || !!(ctx && ctx.t && altModel(ctx.t.agent, ctx.t.model)))
    && (a.id !== 'pause-others' || otherLocalRunning(ctx && ctx.t).length > 0));
}
function failCardHTML(code, ctx) {
  ctx = ctx || {};
  const E = ERRORS[code] || ERRORS.crash;
  const ev = ctx.e || {};
  const title = ev.title || val(E.title, ctx);
  const cause = ev.cause || val(E.cause, ctx);
  const fix = ev.fix || val(E.fix, ctx);   /* in the timeline of a still-failed task, the fix lives once in "Your next step" */
  const log = ev.log || val(E.log, ctx);
  const cli = E.cli ? val(E.cli, ctx) : '';
  const tone = E.tone || 'fail';
  const tid = ctx.t ? ctx.t.id : '';
  const attrs = `data-code="${code}"${tid ? ` data-task="${tid}"` : ''}${ctx.cluster ? ` data-cluster="${esc(ctx.cluster)}"` : ''}${ctx.repo ? ` data-repo="${esc(ctx.repo)}"` : ''}`;
  /* ctx.omit drops actions the page already offers elsewhere (e.g. Run health check in the Places header). */
  const acts = actionsFor(code, ctx).map((a) => `<button class="btn sm ${a.primary ? 'primary' : ''}" data-action="fix" data-fix="${a.id}" ${attrs}>${a.icon ? icon(a.icon, 'sm') : ''}${esc(val(a.label, ctx))}</button>`).join('');
  return `<div class="fail-card ${tone}${ctx.compact ? ' compact' : ''}" data-fail="${code}">
    ${ctx.noTitle ? '' : `<h3>${esc(title)}</h3>`}
    <dl class="fail-grid"><dt>What happened</dt><dd>${esc(cause)}</dd><dt>How to fix</dt><dd>${ctx.pointToNext ? '<button type="button" class="link" data-action="focus-next">See Your next step</button>' : esc(fix)}</dd></dl>
    ${ctx.extra || ''}
    <div class="btn-row fc-actions">${ctx.noActions ? '' : acts}<button class="btn ghost sm" data-action="diagnostics" ${attrs}>${icon('copy', 'sm')}Copy diagnostics</button></div>
    ${log && !ctx.compact ? `<details class="disclosure fc-details"><summary>${icon('chevRight', 'sm chev')}Show log</summary><div class="disclosure-body"><pre class="tool-out well" style="border:0">${esc(log)}</pre><p class="xsmall muted" style="margin-top:8px">${icon('lock', 'xs')} Secrets are removed from details and diagnostics.</p></div></details>` : ''}
    ${cli && !ctx.compact ? `<p class="xsmall muted fc-cli">${icon('terminal', 'xs')}Same fix from the command line: <code>${esc(cli)}</code></p>` : ''}
  </div>`;
}
/** Up to `max` catalog actions as buttons, for Now/Next strips and Home cards (an error can ask to show more, `E.max`). */
function failActionsHTML(code, ctx, max) {
  const tid = ctx && ctx.t ? ctx.t.id : '';
  const E = ERRORS[code];
  return actionsFor(code, ctx).slice(0, Math.max(max || 2, (E && E.max) || 0)).map((a) => `<button class="btn sm ${a.primary ? 'primary' : ''}" data-action="fix" data-fix="${a.id}" data-code="${code}"${tid ? ` data-task="${tid}"` : ''}>${a.icon ? icon(a.icon, 'sm') : ''}${esc(val(a.label, ctx))}</button>`).join('');
}
function failInfo(t) {
  const f = lastFail(t);
  const code = (f && f.e.code) || 'key-rejected';
  const ctx = { t, e: f ? f.e : {} };
  const E = ERRORS[code] || ERRORS.crash;
  const fix = keyFixed(code, ctx) ? `${AGENTS[t.agent].name} is signed in again. Retry to pick up where it stopped; your workspace and goal are saved.` : (f && f.e.fix) || val(E.fix, ctx);
  return { code, ctx, title: (f && f.e.title) || val(E.title, ctx), fix };
}

/* ---------- Environment health lifecycle (F19) ---------- */
function healthState() {
  const E = state.env;
  const running = state.tasks.filter((t) => t.env === 'local' && ACTIVE.includes(t.status)).length;
  if (state.conn && state.conn.lost) return { ic: 'alert', title: E.mode === 'cluster' ? 'Remote cluster' : 'This computer', sub: 'Lost connection · Reconnecting…', cls: 'attn' };
  if (E.mode === 'none') return { href: '#/welcome', ic: 'laptop', title: 'This computer', sub: 'Not set up · Finish setup', cls: 'attn' };
  if (E.mode === 'cluster') return { href: '#/places', ic: 'cloud', title: 'Remote cluster', sub: `${E.cluster} · connected`, cls: 'ok', beat: true };
  if (E.health === 'starting') return { ic: 'loader', icCls: 'spin', title: 'This computer', sub: `Starting · <span class="hc-secs">${E.startsIn}</span> s`, cls: 'muted' };
  if (E.health === 'attention') return { ic: 'alert', title: 'This computer', sub: 'Needs attention · Fix', cls: 'attn' };
  if (E.health === 'asleep') return { ic: 'moon', title: 'This computer', sub: 'Paused while your computer slept', cls: 'muted' };
  return { ic: 'laptop', title: 'This computer', sub: running ? `Healthy · ${running} running` : 'Healthy · ready', cls: 'ok', beat: true };
}
function healthCardHTML() {
  const h = healthState();
  const label = `${h.title}: ${h.sub.replace(/<[^>]+>/g, '')}. Open details.`;
  return `<a class="health-card ${h.cls}" href="${h.href || '#/places'}" id="health-pill" aria-label="${esc(label)}">${icon(h.ic, h.icCls || '')}<span class="hc-text"><span class="hc-title">${h.title}</span><span class="hc-sub">${h.sub}</span></span>${h.beat ? HEARTBEAT : ''}</a>`;
}
function refreshHealth() {
  const el = $('#health-pill');
  if (el && el.parentElement) { const w = document.createElement('div'); w.innerHTML = healthCardHTML(); el.replaceWith(w.firstElementChild || w); }
}
let healthTimer = null;
function setHealth(h, issue, secs) {
  clearInterval(healthTimer);
  state.env.health = h;
  state.env.issue = issue || null;
  if (h === 'starting') {
    state.env.startsIn = secs || 3;
    healthTimer = setInterval(() => {
      state.env.startsIn = Math.max(0, state.env.startsIn - 1);
      $$('.hc-secs, .env-secs').forEach((x) => { x.textContent = state.env.startsIn; });
      if (state.env.startsIn <= 0) { clearInterval(healthTimer); setHealth('healthy'); onEnvReady(); }
    }, 1000);
  }
  refreshHealth();
  const top = state.route && state.route.parts[0];
  if ((!top || top === 'places') && !isTypingIn('#main')) render({ keepScroll: true, background: true });
}
/** After a warm start or wake, resume tasks that were held. */
function onEnvReady() {
  const held = state.tasks.filter((t) => t._held);
  held.forEach((t) => { t._held = false; if (t.status === 'running') scheduleNext(t); });
  if (state.flags.restarting) {
    state.flags.restarting = false;
    toast(`Sandbox is ready.${held.length ? ` ${plural(held.length, 'task')} resumed where ${held.length === 1 ? 'it' : 'they'} stopped.` : ''}`, { icon: 'checkCircle' });
  }
}
/** Home / Places banner for environment states that need the user's attention (or explain a wait). */
function envBannerHTML() {
  const E = state.env;
  if (E.mode === 'none') {
    return `<div class="env-banner attn" role="status"><span class="nn-icon waiting">${icon('laptop', 'sm')}</span>
      <div class="eb-main"><b>This computer isn't set up yet</b><span>Run agents here in a secure sandbox (about 5 minutes), or connect to a remote cluster (about 1 minute).</span></div>
      <div class="btn-row"><a class="btn sm primary" href="#/welcome" data-action="setup-resume-path" data-path="local">Finish setup</a><a class="btn sm" href="#/welcome" data-action="setup-resume-path" data-path="cluster">${icon('cloud', 'sm')}Connect to a remote cluster</a></div></div>`;
  }
  if (E.mode === 'local' && E.health === 'starting' && state.flags.restarting) {
    return `<div class="env-banner" role="status"><span class="nn-icon running">${icon('loader', 'sm spin')}</span>
      <div class="eb-main"><b>Starting your sandbox after a restart · <span class="env-secs">${E.startsIn}</span> s</b><span>Your tasks and workspaces are safe. Running tasks resume automatically.</span></div></div>`;
  }
  if (E.mode === 'local' && E.health === 'attention' && E.issue) return failCardHTML(E.issue, { compact: true });
  return '';
}

/* ---------- Fix dispatcher: every fail-card action lands here ---------- */
function runFix(id, el) {
  const t = el && el.dataset.task ? getTask(el.dataset.task) : null;
  const code = el && el.dataset.code;
  const S = state.setup;
  switch (id) {
    /* Set up */
    case 'recheck':
      if (S) S.issue = null;
      render({ keepScroll: true });
      toast('All checks passed. You can set up on this computer.', { icon: 'checkCircle' });
      break;
    case 'connect-instead':
      if (S) { S.path = 'cluster'; S.phase = 'before'; S.failAt = null; }
      render({ keepScroll: true });
      announce('Connect to a remote cluster selected');
      break;
    case 'copy-it-note': copyText(IT_NOTES[code] || IT_NOTES['setup-virt'], code === 'setup-admin' ? 'Request copied. Paste it into a message to your IT team.' : 'Note copied. Paste it into a message to your IT team.'); break;
    case 'retry-setup': if (S) { S.failAt = null; setupInstall(S.step); } break;
    case 'proxy-help': openProxyHelp(); break;
    case 'resume-setup': if (S) { const from = S.interrupted || 1; S.interrupted = null; setupInstall(from); } break;
    case 'reset-setup': state.setup = null; render(); toast('Setup reset. Start whenever you\'re ready.', { icon: 'undo' }); break;
    /* Tasks */
    case 'update-key': if (t) openKeyDialog(t.agent, t.id); break;
    case 'retry': if (t) retryTask(t); break;
    case 'try-another': {
      const src = t && code === 'handoff-start' && t.parent ? getTask(t.parent) : t;
      if (src) openHandoff(src);
      break;
    }
    case 'github-signin':
      toast('Finish signing in to GitHub in your browser…', { icon: 'globe', timeout: 1500 });
      setTimeout(() => { connectGithub(); toast(`Signed in to GitHub as ${esc(state.github.user)} with access to acme. You won't be asked again.`, { icon: 'checkCircle' }); if (t) { t.repoAccess = true; retryTask(t); } }, 1500);
      break;
    case 'connect-mcp': {
      const lf = t && lastFail(t);
      const id = (lf && lf.e.server) || 'linear', name = mcpName(id);
      toast(`Finish connecting ${esc(name)} in your browser…`, { icon: 'link', timeout: 1500 });
      setTimeout(() => {
        if (id === 'github') connectGithub(); else state.mcpConnected = true;
        toast(`${esc(name)} connected. Its token stays in your keychain.`, { icon: 'checkCircle' });
        if (t) retryTask(t, `MCP servers ready: ${(t.mcp || ['github', 'linear']).join(', ')}`);
      }, 1500);
      break;
    }
    case 'remove-mcp': {
      if (!t) break;
      const lf = lastFail(t);
      const id = (lf && lf.e.server) || 'linear';
      t.mcp = (t.mcp || ['github', 'linear']).filter((x) => x !== id);
      toast(`Removed ${esc(mcpName(id))} from this workspace`, { icon: 'trash' });
      retryTask(t, t.mcp.length ? `MCP servers ready: ${t.mcp.join(', ')}` : 'Retrying without MCP servers');
      break;
    }
    case 'remove-skill': {
      if (!t) break;
      const lf = lastFail(t);
      const id = (lf && lf.e.skill) || 'frontend-design';
      t.skills = (t.skills || ['ax-task', id]).filter((x) => x !== id);
      toast(`Removed ${esc(id)} from this workspace`, { icon: 'trash' });
      retryTask(t, `Skills ready: ${t.skills.join(', ') || 'none'}`);
      break;
    }
    case 'edit-workspace': if (t) editWorkspaceFromTask(t); break;
    case 'switch-model': {
      if (!t) break;
      const m = altModel(t.agent, t.model);
      if (!m) { toast(`${esc(AGENTS[t.agent].name)} has one model. Wait for the limit to reset, or use a different key.`, { icon: 'info' }); break; }
      t.model = m.id;
      retryTask(t, `Switched to ${m.name}. Retrying from the saved workspace.`);
      toast(`Switched ${esc(AGENTS[t.agent].name)} to ${esc(m.name)} for this task.`, { icon: 'cpu' });
      break;
    }
    case 'restart-large': if (t) { t.size = 'large'; retryTask(t, 'Restarted with 8 GB of memory (Large)'); } break;
    case 'pause-others': {
      const others = otherLocalRunning(t);
      others.forEach((x) => { if (x.status === 'running') pauseTask(x, true); });
      render({ keepScroll: true });
      toast(`Paused ${plural(others.length, 'other task')}. They pick up where they stopped when you resume them.`, { icon: 'pause', action: t && code !== 'queued' ? { label: 'Restart with 8 GB', run: () => { t.size = 'large'; retryTask(t, 'Restarted with 8 GB of memory (Large), with the other tasks paused'); } } : null });
      break;
    }
    case 'restart-workspace': if (t) retryTask(t, `Restarted from the current workspace (${plural(filesFor(t).length, 'changed file')} kept)`); break;
    case 'promote': if (t) openPromote(t); break;
    /* Review */
    case 'push-instead': closeDialog(true); if (t) pushTask(t, el); break;
    case 'apply-partial': closeDialog(true); if (t) applyTask(t, { skipConflicts: true }); break;
    case 'github-signin-push':
      closeDialog(true);
      toast('Signing in to GitHub…', { icon: 'globe', timeout: 1300 });
      setTimeout(() => { connectGithub(); state.flags.pushRejected = false; if (t) { if (t.pushed && !t.pr) openPullRequest(t); else pushTask(t); } }, 1300);
      break;
    case 'patch': closeDialog(true); if (t) downloadText(`${t.id}-changes.patch`, patchText(t), `Saved <span class="mono">${t.id}-changes.patch</span>`); break;
    /* Environment */
    case 'clean-sandboxes':
      toast('Cleaning up 6 stopped sandboxes…', { icon: 'loader', timeout: 1500 });
      setTimeout(() => { setHealth('healthy'); toast('Freed 2.4 GB. This computer is healthy again.', { icon: 'checkCircle' }); }, 1500);
      break;
    case 'doctor': openDoctor(); break;
    default: toast('This fix is simulated in the prototype.', { icon: 'info' });
  }
}
function patchText(t) {
  return filesFor(t).map((f) => `--- a/${f.path}\n+++ b/${f.path}\n${f.lines.join('\n')}`).join('\n');
}
/** CUJ 2 ("Edit the Workspace setup"): open New task with this task's goal and workspace, at the workspace step. */
function editWorkspaceFromTask(t) {
  closeDialog(true);
  const goal = ((t.events || []).find((e) => e.type === 'user') || {}).text || t.title;
  const k = FOLDERS.findIndex((f) => f.path === t.folder || f.repo === t.repo);
  const git = /^https?:\/\/|^git@/.test(t.folder || '') ? t.folder : '';
  state.draft = null;
  const d = ensureDraft(new URLSearchParams(''));
  Object.assign(d, {
    goal, agent: AGENTS[t.agent] && !AGENTS[t.agent].removed ? t.agent : DEFAULT_AGENT, model: t.model || null, env: t.env === 'cluster' ? 'cluster' : 'local',
    source: t.repo === SAMPLE.repo ? 'sample' : git ? 'git' : 'folder', folderIdx: k >= 0 ? k : 0, git,
    branch: t.baseBranch && k >= 0 && FOLDERS[k].branches.includes(t.baseBranch) ? t.baseBranch : null,
    skills: (t.skills || ['ax-task']).slice(), mcp: (t.mcp || ['github', 'linear']).slice(), size: t.size || 'medium', budget: t.budget || 5, preset: t.preset || null,
    inlineFiles: (t.inlineFiles || []).map((x) => ({ path: x.path, content: x.content })),
    wsOpen: true, focusWs: true,
  });
  navigate('#/new');
  toast(`Editing the workspace setup from “${esc(t.title)}”. Fix it, then run the task again.`, { icon: 'pencil' });
}

/* ---------- Trajectory export (OATR) — F17, A.3 ---------- */
function oatrJSON(t) {
  const A = AGENTS[t.agent];
  const clean = (s) => String(s == null ? '' : s).replace(/\b(sk-[A-Za-z0-9-]{4,}|ghp_[A-Za-z0-9]{6,})/g, '[redacted]');
  return JSON.stringify({
    format: 'OATR', version: '0.1 (prototype)',
    task: { id: t.id, title: t.title, harness: A.cli, harnessVersion: A.version, environment: t.env === 'cluster' ? t.cluster : 'local', repo: t.repo, branch: t.branch, status: t.status },
    events: t.events.map((e) => {
      const o = { type: e.type, at: new Date(e.at).toISOString() };
      ['text', 'title', 'cmd', 'out', 'domain', 'purpose', 'resolved', 'code', 'cause', 'fix', 'note', 'branch', 'cluster', 'delivery'].forEach((k) => { if (e[k] != null) o[k] = clean(e[k]); });
      if (e.paths) o.paths = e.paths.slice();
      return o;
    }),
    redaction: 'Credentials are injected outside the sandbox and never recorded.',
  }, null, 2);
}

/* ---------- Prototype scenarios (review only: #/review lists them, ?scenario=<id> opens one) ---------- */
const FAIL_SPAWNS = {
  /* Used when the demo's seeded Codex task isn't there (a first run): the same failure on a new task. */
  'key-rejected': { title: 'Upgrade web-app to Node 22', agent: 'codex', repo: 'web-app',
    pre: [{ type: 'tool', title: 'started the agent', cmd: 'Starting Codex in a secure sandbox', out: 'Sandbox ready in 3.1s\nWorkspace copied: web-app (2,318 files)', ok: true }] },
  quota: { title: 'Summarize open checkout bugs into a triage list', agent: 'claude', repo: 'shop-api', tokens: 182400,
    pre: [{ type: 'thought', text: "I'll read the open issues labeled checkout and group them by root cause." }, { type: 'tool', title: 'ran a command', cmd: 'gh issue list --label checkout --limit 50', out: '47 open issues', ok: true }] },
  'repo-denied': { title: 'Add SSO to the admin portal', agent: 'claude', repo: 'admin-portal', folder: 'https://github.com/acme/admin-portal',
    pre: [{ type: 'tool', title: 'started the agent', cmd: 'Cloning github.com/acme/admin-portal into a secure sandbox', out: 'Sandbox ready in 2.9s\nCloning… 403', ok: false }] },
  'mcp-failed': { title: "Triage this week's Linear issues", agent: 'antigravity', repo: 'shop-api', mcp: ['github', 'linear'],
    pre: [{ type: 'tool', title: 'started the agent', cmd: 'Starting MCP servers: github, linear', out: 'github: ready (3 tools)\nlinear: failed to start', ok: false }] },
  /* A skill that uses an MCP server the workspace doesn't have: the setup stops at skills, like a live run would. */
  'skill-failed': { title: 'Tidy up the checkout page styles', agent: 'claude', repo: 'web-app', skills: ['ax-task', 'frontend-design'], mcp: ['github'],
    failExtra: { skill: 'frontend-design', needs: 'playwright' },
    pre: [{ type: 'workspace', failed: true, summary: 'Stopped at skills · 3 steps done', items: [
      { t: 'Started a secure sandbox', s: 'microVM · ax-task-runner 0.9.2 · your folder stays untouched' },
      { t: 'Copied ~/code/web-app at main', s: '2,318 files · from the last commit' },
      { t: 'Added AGENTS.md', s: '18 lines of project instructions' },
      { t: "Skill “frontend-design” didn't load", s: 'ax-task loaded. frontend-design needs the Playwright browser MCP server.', failed: true },
    ] }] },
  'image-unavailable': { title: 'Fix the flaky date tests', agent: 'claude', repo: 'web-app',
    pre: [{ type: 'tool', title: 'started the agent', cmd: 'Downloading the Claude Code image', out: 'ghcr.io/google/ax-claude-code:1.0.4 · timed out (3 tries)', ok: false }] },
  oom: { title: 'Run the full integration test suite', agent: 'claude', repo: 'web-app', files: 'generic', tokens: 64200,
    pre: [{ type: 'thought', text: 'Running the integration suite once to get a baseline before changing anything.' }, { type: 'tool', title: 'ran the tests', cmd: 'npm run test:integration', out: 'FATAL ERROR: Reached heap limit', ok: false }] },
  crash: { title: 'Refactor the auth middleware', agent: 'claude', repo: 'accounts', files: [FILES.conftest], tokens: 51800,
    pre: [{ type: 'thought', text: 'Splitting the middleware into separate session and token checks.' }, { type: 'edit', paths: [FILES.conftest.path] }, { type: 'tool', title: 'ran a command', cmd: 'npm run build', out: 'Building 214 modules…', ok: false }] },
};
function spawnFailure(code) {
  const s = FAIL_SPAWNS[code];
  const id = 't' + state.nextId++;
  const t0 = now() - 3 * MIN;
  const t = {
    id, title: s.title, agent: s.agent, status: 'failed', env: 'local', repo: s.repo, folder: s.folder || '~/code/' + s.repo,
    branch: branchFor(s.title), startedAt: t0, tokens: s.tokens || 0, files: [], script: 'generic', step: 0, failCode: code,
    events: [{ type: 'user', at: t0, text: s.title + '.' }],
  };
  if (s.files === 'generic') t.files = genericFiles(t); else if (s.files) t.files = s.files.slice();
  if (s.skills) t.skills = s.skills.slice();
  if (s.mcp) t.mcp = s.mcp.slice();
  (s.pre || []).forEach((e, k) => t.events.push(Object.assign({ at: t0 + (k + 1) * 30000 }, e)));
  t.events.push(Object.assign({ type: 'fail', at: now(), code }, s.failExtra || {}));
  state.tasks.unshift(t);
  navigate(`#/task/${id}`);
  return t;
}
function spawnRunning(title, opts) {
  opts = opts || {};
  const id = 't' + state.nextId++;
  const t = {
    id, title, agent: opts.agent || 'claude', status: 'running', env: 'local', repo: opts.repo || 'shop-api', folder: '~/code/' + (opts.repo || 'shop-api'),
    branch: branchFor(title), startedAt: now() - 2 * MIN, tokens: 21400, files: [], script: 'generic', step: 1, noMidTurn: !!opts.noMidTurn,
    events: [{ type: 'user', at: now() - 2 * MIN, text: title + '.' }, { type: 'thought', at: now() - 100000, text: `I'll start by getting oriented in ${opts.repo || 'shop-api'}: the README, the layout and how the tests run.` }],
  };
  state.tasks.unshift(t);
  scheduleNext(t);
  return t;
}
function promotableTask() {
  const t2 = getTask('t2');
  if (t2 && t2.env === 'local' && t2.status !== 'done') return t2;
  return state.tasks.find((t) => t.env === 'local' && t.status !== 'done') || spawnRunning('Add request logging to the orders API');
}
function reviewableTask() {
  /* A handed-off task is a read-only snapshot (no Apply or Push), so it can't host a review failure. */
  let t = state.tasks.find((x) => x.status === 'done' && !x.pushed && !x.notKept && filesFor(x).length && !x.altRun && !handedOff(x));
  if (!t) {
    t = spawnRunning('Add request logging to the orders API');
    clearTimeout(t._timer);
    t.files = [
      { path: 'src/middleware/request-log.ts', kind: 'new', lines: newFile("import { logger } from '../logger';\nexport function requestLog(req, res, next) {\n  logger.info({ method: req.method, path: req.path });\n  next();\n}") },
      { path: 'src/orders/router.ts', kind: 'modified', lines: ['@@ -1,3 +1,5 @@', " import { Router } from 'express';", "+import { requestLog } from '../middleware/request-log';", ' const router = Router();', '+router.use(requestLog);'] },
      { path: 'README.md', kind: 'modified', lines: ['@@ -3,3 +3,5 @@', ' ## Features', ' ', '+- Request logging on the orders API', '+'] },
    ];
    pushEvent(t, { type: 'done', at: now(), text: 'Added request logging to the orders API. Tests pass.' });
    t.status = 'done'; t.needs = null; t.finishedAt = now();
  }
  return t;
}
function startSetupScenario(issue) {
  try { localStorage.removeItem('ax.setup'); } catch (e) { /* ignore */ }
  state.setup = {
    phase: 'before', step: 0, pick: DEFAULT_AGENT, path: 'local',
    issue: ['disk', 'memory', 'ram', 'virt', 'admin'].includes(issue) ? issue : null,
    failAt: issue === 'download' ? 3 : null,
    interrupted: issue === 'interrupted' ? 1 : null,
  };
  navigate('#/welcome');
}
/* CUJ 1 on its own: every path or failure starts from a clean first run (nothing set up, nothing connected). */
function startCujFresh() {
  try { localStorage.removeItem('ax.setup'); } catch (e) { /* ignore */ }
  setEnvMode('none');
  state.cuj = 1;
}
function startCujPath(path) {
  startCujFresh();
  state.setup = { phase: 'before', step: 0, pick: DEFAULT_AGENT, path: path === 'cluster' ? 'cluster' : 'local' };
  navigate('#/welcome');
}
function startCujScenario(issue) {
  startCujFresh();
  state.setup = {
    phase: 'before', step: 0, pick: DEFAULT_AGENT, path: 'local', scenario: issue,
    issue: ['disk', 'memory', 'ram', 'virt', 'admin'].includes(issue) ? issue : null,
    failAt: issue === 'download' ? 3 : null,
    interrupted: issue === 'interrupted' ? 1 : null,
  };
  navigate('#/welcome');
}
/* CUJ 1: a first launch on a computer that's already set up. IT installed AX with the setup done, or you ran ax setup
   in a terminal. Studio finds the environment and opens on Ready, so there's nothing to install or choose. */
function startPreinstalled(by, fromCuj) {
  by = by === 'it' ? 'it' : 'cli';
  try { localStorage.setItem('ax.setup', '1'); } catch (e) { /* ignore */ }
  enterFirstRun();
  setEnvMode('local');
  state.cuj = fromCuj ? 1 : null;
  /* IT installs every template ahead of time. ax setup gets the first one, and the others keep downloading. */
  state.downloads = {};
  if (by === 'cli') startDownloads(prebuiltAgents().filter((a) => a.id !== DEFAULT_AGENT).map((a) => a.id), 50000);
  else saveDownloads();
  state.setup = { phase: 'ready', step: 4, pick: DEFAULT_AGENT, path: 'local', preinstalled: by };
  navigate('#/welcome');
}
function ensureSetUp() {
  try { localStorage.setItem('ax.setup', '1'); } catch (e) { /* ignore */ }
  if (state.env.mode !== 'local') setEnvMode('local');
}
const SCENARIOS = [
  { id: 'setup-happy', group: 'Set up', label: 'Fresh install (happy path)', run: () => startSetupScenario(null) },
  { id: 'setup-disk', group: 'Set up', label: 'Not enough disk space', run: () => startSetupScenario('disk') },
  { id: 'setup-memory', group: 'Set up', label: 'Not enough free memory (other apps are using it)', run: () => startSetupScenario('memory') },
  { id: 'setup-ram', group: 'Set up', label: 'Too little memory installed', run: () => startSetupScenario('ram') },
  { id: 'setup-virt', group: 'Set up', label: 'Virtualization blocked by IT', run: () => startSetupScenario('virt') },
  { id: 'setup-admin', group: 'Set up', label: 'No admin rights', run: () => startSetupScenario('admin') },
  { id: 'setup-download', group: 'Set up', label: 'Download blocked by a proxy', run: () => startSetupScenario('download') },
  { id: 'setup-interrupted', group: 'Set up', label: 'Install was interrupted', run: () => startSetupScenario('interrupted') },
  { id: 'setup-preinstalled-it', group: 'Set up', label: 'Already set up by IT (opens on Ready)', run: () => startPreinstalled('it') },
  { id: 'setup-preinstalled-cli', group: 'Set up', label: 'Already set up with ax setup (opens on Ready)', run: () => startPreinstalled('cli') },
  { id: 'env-restart', group: 'This computer', label: 'Warm start after a restart', run: () => {
    ensureSetUp(); state.flags.restarting = true;
    state.tasks.forEach((t) => { if (t.env === 'local' && t.status === 'running') { clearTimeout(t._timer); t._held = true; } });
    navigate('#/'); setHealth('starting', null, 9);
  } },
  { id: 'env-sleep', group: 'This computer', label: 'Computer slept mid-task', run: () => {
    ensureSetUp();
    let running = state.tasks.filter((t) => t.env === 'local' && t.status === 'running');
    if (!running.length) running = [spawnRunning('Add request logging to the orders API')];
    running.forEach((t) => { clearTimeout(t._timer); t._held = true; });
    setHealth('asleep'); navigate(`#/task/${running[0].id}`);
    if (onTask(running[0])) refreshAfterStatus(running[0]);
    /* The task shows "Paused while your computer slept" until the computer wakes, then resumes on its own. */
    setTimeout(() => {
      const from = now() - 39 * MIN;
      running.forEach((t) => pushEvent(t, { type: 'slept', at: now(), from, to: now() }));
      setHealth('healthy'); onEnvReady();
      running.forEach((t) => refreshAfterStatus(t));
      toast(`Welcome back. ${running.length === 1 ? 'Your task' : plural(running.length, 'task')} resumed where ${running.length === 1 ? 'it' : 'they'} stopped.`, { icon: 'sun' });
    }, 5000);
  } },
  { id: 'env-attention', group: 'This computer', label: 'Disk almost full', run: () => { ensureSetUp(); navigate('#/places'); setHealth('attention', 'env-disk-low'); } },
  { id: 'key-rejected', group: 'Tasks', label: 'API key rejected', run: () => {
    AGENTS.codex.connected = false; AGENTS.codex.auth = 'key'; AGENTS.codex.keyProblem = 'Key was rejected';
    /* The demo's seeded Codex task, or (on a first run, with no seeded tasks) a new one that fails the same way. */
    const t = state.tasks.find((x) => x.status === 'failed' && x.agent === 'codex' && (lastFail(x) || { e: {} }).e.code === 'key-rejected');
    if (t) navigate(`#/task/${t.id}`); else spawnFailure('key-rejected');
  } },
  { id: 'task-quota', group: 'Tasks', label: 'Rate limit reached', run: () => spawnFailure('quota') },
  { id: 'task-repo', group: 'Tasks', label: 'Repo access denied', run: () => spawnFailure('repo-denied') },
  { id: 'task-mcp', group: 'Tasks', label: 'MCP server failed to start', run: () => spawnFailure('mcp-failed') },
  { id: 'task-skill', group: 'Tasks', label: 'Skill failed to load', run: () => spawnFailure('skill-failed') },
  { id: 'task-image', group: 'Tasks', label: 'Agent image unavailable', run: () => spawnFailure('image-unavailable') },
  { id: 'task-oom', group: 'Tasks', label: 'Out of memory', run: () => spawnFailure('oom') },
  { id: 'task-crash', group: 'Tasks', label: 'Agent crashed', run: () => spawnFailure('crash') },
  /* Guardrails → Inside the sandbox set to "Ask before risky commands"; the agent stops before deleting files. */
  { id: 'task-permission', group: 'Tasks', label: 'Agent asks before a risky command', run: () => {
    state.permMode = 'ask';
    const t = spawnRunning('Clean up the old build scripts', { repo: 'web-app' });
    t.files = genericFiles(t);
    t.events.push({ type: 'thought', at: now() - 70000, text: 'Plan: 1) find where this belongs, 2) make the change in small steps, 3) run the tests after each step.' }, { type: 'edit', at: now() - 40000, paths: t.files.map((f) => f.path) });
    clearTimeout(t._timer); t.step = SCRIPTS.generic.findIndex((s) => s.risky); scheduleNext(t);
    navigate(`#/task/${t.id}`);
    toast('Scenario: Guardrails → Inside the sandbox is set to “Ask before risky commands”.', { icon: 'info' });
  } },
  { id: 'task-midturn', group: 'Tasks', label: "Agent can't take input mid-turn", run: () => {
    const t = spawnRunning('Tidy up the checkout error messages', { noMidTurn: true });
    navigate(`#/task/${t.id}`);
    setTimeout(() => steerTask(t, 'Keep the existing error codes; only change the wording.'), 400);
  } },
  { id: 'task-budget', group: 'Tasks', label: 'Budget check-in reached', run: () => {
    ensureSetUp();
    const t = spawnRunning('Migrate the billing module to TypeScript');
    clearTimeout(t._timer);
    t.files = genericFiles(t);
    t.tokens = Math.ceil((budgetFor(t) + 0.02) / AGENTS[t.agent].rate * 1000);
    t.spark = null;
    navigate(`#/task/${t.id}`);
    /* After the page shows the task, so the check-in lands in Your next step instead of a toast. */
    setTimeout(() => budgetCheck(t), 60);
  } },
  { id: 'agent-harness', group: 'Bring your own agent', label: "Agent doesn't speak the AX harness protocol", run: () => { ensureSetUp(); navigate('#/new'); setTimeout(() => openAgentCatalog({ tab: 'byo', folder: '~/code/legacy-bot', autoCheck: true }), 250); } },
  { id: 'agent-secret', group: 'Bring your own agent', label: 'A secret is found in the agent', run: () => { ensureSetUp(); navigate('#/new'); setTimeout(() => openAgentCatalog({ tab: 'byo', folder: '~/code/standup-agent', autoCheck: true }), 250); } },
  { id: 'agent-image', group: 'Bring your own agent', label: 'Unsigned container image', run: () => { ensureSetUp(); navigate('#/new'); setTimeout(() => openAgentCatalog({ tab: 'byo', kind: 'image', value: 'ghcr.io/rajitha/triage-agent:latest', autoCheck: true }), 250); } },
  { id: 'review-conflict', group: 'Review', label: 'Apply causes a conflict', run: () => { const t = reviewableTask(); state.flags.applyConflict = true; navigate(`#/task/${t.id}/changes`); toast('Scenario ready: choose “Apply to my folder”.', { icon: 'info' }); } },
  { id: 'review-push', group: 'Review', label: 'Push rejected', run: () => { const t = reviewableTask(); state.flags.pushRejected = true; navigate(`#/task/${t.id}/changes`); toast('Scenario ready: choose “Push to new branch”.', { icon: 'info' }); } },
  { id: 'handoff-slow', group: 'Continue with another agent', label: "Current turn doesn't end in time", run: () => {
    state.flags.slowTurn = true;
    const t = state.tasks.find((x) => x.env === 'local' && x.status === 'running') || spawnRunning('Add request logging to the orders API');
    navigate(`#/task/${t.id}`); setTimeout(() => openHandoff(t), 250);
  } },
  { id: 'handoff-fail', group: 'Continue with another agent', label: 'New agent fails to start', run: () => {
    state.flags.handoffFail = true;
    const t = promotableTask();
    navigate(`#/task/${t.id}`); setTimeout(() => openHandoff(t), 250);
  } },
  { id: 'cluster-run', group: 'Remote cluster', label: 'Run on a remote cluster (fresh run)', run: () => { const t = promotableTask(); navigate(`#/task/${t.id}`); setTimeout(() => openPromote(t), 250); } },
  { id: 'cluster-unreachable', group: 'Remote cluster', label: 'Cluster unreachable', run: () => { state.flags.clusterUnreachable = true; const t = promotableTask(); navigate(`#/task/${t.id}`); setTimeout(() => openPromote(t), 250); } },
  { id: 'cluster-permission', group: 'Remote cluster', label: 'Permission denied (missing role)', run: () => { state.flags.clusterForbidden = 'ax-dev-us-central'; const t = promotableTask(); navigate(`#/task/${t.id}`); setTimeout(() => openPromote(t, { step: 2 }), 250); } },
  { id: 'env-disconnected', group: 'This computer', label: 'Lost connection to AX (reconnects after 15 s)', run: () => {
    ensureSetUp();
    const t = state.tasks.find((x) => x.env === 'local' && x.status === 'running') || spawnRunning('Add request logging to the orders API');
    navigate(`#/task/${t.id}`);
    setTimeout(() => { connLost('scenario'); setTimeout(connRestored, 15000); }, 400);
  } },
  { id: 'task-queued', group: 'This computer', label: 'No room on this computer (task queued)', run: () => {
    ensureSetUp();
    let k = 0;
    while (localMemInUse() + 4 <= LOCAL_MEM_GB && k++ < 6) spawnRunning(['Migrate the billing module to TypeScript', 'Speed up the search index build', 'Add retries to the payments client'][k % 3]);
    const t = spawnRunning('Upgrade the image library');
    clearTimeout(t._timer);
    t.status = 'starting'; t.step = 0; t.queued = now(); t.events = t.events.slice(0, 1);
    pushEvent(t, { type: 'note', at: now(), text: `Queued: tasks on this computer are using ${localMemInUse(t)} of ${LOCAL_MEM_GB} GB. It starts on its own when there is room.` });
    navigate(`#/task/${t.id}`);
  } },
  { id: 'cluster-version', group: 'Remote cluster', label: 'Version mismatch', run: () => { const t = promotableTask(); navigate(`#/task/${t.id}`); setTimeout(() => openPromote(t, { cluster: 'ax-batch-eu', step: 2 }), 250); } },
  { id: 'cluster-missing', group: 'Remote cluster', label: 'Cluster lacks an MCP server from the workspace setup', run: () => {
    state.flags.clusterMissing = true;
    const t = promotableTask();
    t.skills = t.skills && t.skills.length ? t.skills : ['frontend-design'];
    t.mcp = ['github', 'linear'];
    navigate(`#/task/${t.id}`); setTimeout(() => openPromote(t, { step: 2 }), 250);
  } },
  { id: 'cluster-blocker', group: 'Remote cluster', label: 'Preflight blocker (repo access)', run: () => { state.flags.repoCredMissing = true; const t = promotableTask(); navigate(`#/task/${t.id}`); setTimeout(() => openPromote(t, { step: 2 }), 250); } },
];
function runScenario(id) {
  const s = SCENARIOS.find((x) => x.id === id);
  if (!s) return;
  closeDialog(true);
  s.run();
  announce(`Scenario: ${s.label}`);
}
