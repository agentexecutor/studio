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

/* AX Studio, live mode: starting a task, following up on one, and running one on another cluster.

   - New task writes the task's files (a Gateway, a Workspace and a Task, as ax.io/v1alpha1 YAML), has the Studio
     server run `ax apply` on them, then `ax resume task`. You can read and edit the files before they are applied.
   - A follow-up is a new task in the same session as an earlier one. It reuses that task's workspace and network
     rules. It starts from the workspace's snapshot and the Git refs that were pushed, not from the earlier sandbox.
   - Running on another cluster is `ax promote`: check first (--preflight-only), then send. */

/* The templates. The images and settings are the ones the Studio pages used before this UI, so a task looks the same
   to AX whichever page started it. They are staging images until the templates are published. */
const LIVE_AGENTS = {
  antigravity: {
    id: 'antigravity', name: 'Antigravity', desc: "Google's coding agent, on Gemini", keyFrom: 'Gemini',
    image: 'ghcr.io/rakyll/ax-images/antigravity@sha256:8025a987861673718564e0e648a3c7785d23c2514be8c7a3d3b133413d9bc81e',
    secret: 'gemini-api-creds', keyName: 'GEMINI_API_KEY', host: 'generativelanguage.googleapis.com', header: 'x-goog-api-key',
    config: (goal) => `prompt: ${liveYBlock(goal, 2)}\nmodel: gemini-3.8-flash\nmaxTurns: 100`,
  },
  claude: {
    id: 'claude', name: 'Claude Code', desc: "Anthropic's coding agent", keyFrom: 'Anthropic',
    image: 'ghcr.io/rakyll/ax-images/claude-managed-agents@sha256:1a532d86c58a5fea3005e9c525683cf8f354e2c403be6460a308ad2f8f0510c0',
    secret: 'anthropic-api-creds', keyName: 'ANTHROPIC_API_KEY', host: 'api.anthropic.com', header: 'x-api-key',
    config: (goal) => `agent:\n  model: "claude-opus-5-5"\n  system: "You are a careful software engineer working in /workspace."\nprompt: ${liveYBlock(goal, 2)}`,
  },
};
/* What "Balanced" lets a task reach besides its model and its repo: GitHub, PyPI and npm. */
const LIVE_BALANCED_HOSTS = ['github.com', 'api.github.com', '*.githubusercontent.com', 'pypi.org', 'files.pythonhosted.org', 'registry.npmjs.org'];
const LIVE_NAME_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const LIVE_DIGEST_RE = /@sha256:[0-9a-f]{64}$/;
LIVE.draft = null;

/* ---------- Writing YAML ---------- */
function liveYQ(s) { return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t') + '"'; }
/** One line as a quoted string; several lines as a block, indented `indent` spaces past the key. */
function liveYBlock(s, indent) {
  s = String(s);
  if (!s.includes('\n')) return liveYQ(s);
  const pad = ' '.repeat(indent);
  return '|\n' + s.replace(/\s+$/, '').split('\n').map((l) => (l.trim() ? pad + l : '')).join('\n');
}
function liveIndent(text, n) { const pad = ' '.repeat(n); return text.split('\n').map((l) => (l ? pad + l : l)).join('\n'); }
function liveRepoHost(url) { try { const u = new URL(url); return u.protocol === 'https:' ? u.hostname.toLowerCase() : ''; } catch (e) { return ''; } }

/* ---------- The draft ---------- */
function liveHex(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(''); }
function liveSlug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').split('-').slice(0, 4).join('-').slice(0, 28).replace(/-+$/, '');
}
/** A new draft. `from` names the task to follow up on. */
function liveNewDraft(from) {
  const d = { agent: 'antigravity', image: '', repo: '', branch: '', goal: '', key: '', network: 'balanced', debug: false,
    name: '', nameEdited: false, suffix: liveHex(2), from: '', base: '', session: '', workspace: '', gateway: '', raw: false, yaml: '', busy: '', error: '' };
  const prev = from && ((LIVE.detail[from] && LIVE.detail[from].doc) || (LIVE.tasks.find((t) => t.name === from) || {}).doc);
  if (prev) {
    const spec = prev.spec || {}, meta = prev.metadata || {};
    const image = (spec.profile && spec.profile.image) || '';
    const agent = Object.keys(LIVE_AGENTS).find((k) => LIVE_AGENTS[k].image === image);
    d.from = from;
    d.base = from.replace(/-[0-9a-f]{4}$/, '').slice(0, 56);
    d.session = spec.sessionId || meta.uid || '';
    d.agent = agent || 'image';
    d.image = agent ? '' : image;
    d.workspace = (spec.workspace && spec.workspace.name) || '';
    d.gateway = (spec.gateway && spec.gateway.name) || '';
    d.debug = !!spec.debug;
  }
  return d;
}
function liveDraftName(d) {
  if (d.nameEdited) return d.name.trim();
  return `${d.from ? d.base : liveSlug(d.goal) || 'task'}-${d.suffix}`;
}
/** What stops this draft from running, in the order to fix it. */
function liveNewIssues(d) {
  const out = [];
  if (!LIVE.context) out.push('Choose where it runs first, in Where agents run.');
  if (d.raw) { if (!/^kind:\s*Task\s*$/m.test(d.yaml)) out.push('The file needs a Task.'); return out; }
  const A = LIVE_AGENTS[d.agent];
  if (!A && d.image.trim() && !LIVE_DIGEST_RE.test(d.image.trim())) out.push('The image address must end in its digest: @sha256: and 64 characters.');
  if (!A && !d.image.trim() && !d.from) out.push('Give the address of your image.');
  if (d.repo.trim() && !liveRepoHost(d.repo.trim())) out.push('The repo must be an https:// Git address.');
  if (A && !d.goal.trim()) out.push('Describe the goal.');
  if (!LIVE_NAME_RE.test(liveDraftName(d))) out.push('The name can use lowercase letters, digits and hyphens, up to 63 characters.');
  return out;
}
/** The task's files. goalField is "text" in current AX. It was "spec" until mid-November 2026. */
function liveNewYAML(d, goalField, credentialUri) {
  const A = LIVE_AGENTS[d.agent];
  const name = liveDraftName(d);
  const goal = d.goal.trim();
  const repo = d.repo.trim();
  const docs = [];
  const head = (kind, n) => `apiVersion: ax.io/v1alpha1\nkind: ${kind}\nmetadata:\n  name: ${liveYQ(n)}`;

  /* Network: an existing Gateway (a follow-up), or a new one with what this task may reach. No hosts, no Gateway. */
  let gateway = d.gateway;
  if (!gateway) {
    const hosts = [];
    const add = (h) => { if (h && !hosts.includes(h) && !(A && h === A.host)) hosts.push(h); };
    add(liveRepoHost(repo));
    if (d.network === 'balanced') LIVE_BALANCED_HOSTS.forEach(add);
    if (A || hosts.length) {
      gateway = `gw-${name}`.slice(0, 63);
      let y = `${head('Gateway', gateway)}\nspec:\n  egress:`;
      if (A) {
        const ns = (STUDIO.info && STUDIO.info.axNamespace) || 'ax-system';
        /* The key is added to requests outside the sandbox, so the agent never holds it. */
        const uri = credentialUri || `ate-secret://k8s.io/default/${ns}/${A.secret}/${A.keyName}`;
        y += `\n    - https:\n        hostnames: [${liveYQ(A.host)}]\n        effects:\n          replaceHeaders:\n            - header: ${liveYQ(A.header)}\n              credentialUri: ${liveYQ(uri)}`;
      }
      if (hosts.length) y += `\n    - https:\n        hostnames: [${hosts.map(liveYQ).join(', ')}]`;
      docs.push(y);
    }
  }

  /* Workspace: an existing one (a follow-up), or a new one that clones the repo. */
  let workspace = d.workspace;
  if (!workspace && repo) {
    workspace = `ws-${name}`.slice(0, 63);
    docs.push(`${head('Workspace', workspace)}\nspec:\n  setup:\n    git:\n      - name: "origin"\n        repo: ${liveYQ(repo)}\n        dir: "."${d.branch.trim() ? `\n        ref: ${liveYQ(d.branch.trim())}` : ''}`);
  }

  const image = A ? A.image : d.image.trim();
  let t = `${head('Task', name)}\nspec:\n  profile:${image ? `\n    image: ${liveYQ(image)}` : ''}\n    resources:\n      limits:\n        cpu: ${liveYQ(A ? '2' : '1')}\n        memory: ${liveYQ(A ? '4Gi' : '1Gi')}`;
  if (goal) t += `\n  goal:\n    ${goalField || 'text'}: ${liveYBlock(goal, 6)}`;
  if (d.session) t += `\n  sessionId: ${liveYQ(d.session)}`;
  if (A) t += `\n  config:\n${liveIndent(A.config(goal), 4)}\n  env:\n    - name: ${liveYQ(A.keyName)}\n      value: "placeholder"`;
  if (workspace) t += `\n  workspace:\n    name: ${liveYQ(workspace)}`;
  if (gateway) t += `\n  gateway:\n    name: ${liveYQ(gateway)}`;
  if (d.debug) t += '\n  debug: true';
  docs.push(t);
  return docs.join('\n---\n') + '\n';
}
/** The Task's name in a file someone edited by hand. */
function liveYAMLTaskName(yaml) {
  const doc = String(yaml).split(/^---\s*$/m).find((x) => /^kind:\s*Task\s*$/m.test(x)) || '';
  const m = /^metadata:\s*\n(?:[ \t]+[^\n]*\n)*?[ \t]+name:\s*["']?([a-z0-9-]+)/m.exec(doc);
  return m ? m[1] : '';
}

/* ---------- Running it ---------- */
async function liveNewRun() {
  const d = LIVE.draft;
  if (!d || d.busy) return;
  const issues = liveNewIssues(d);
  if (issues.length) { d.error = issues[0]; render({ keepScroll: true }); return; }
  const scope = ['--context', LIVE.context, '-a', LIVE.atespace];
  const A = LIVE_AGENTS[d.agent];
  const step = (text) => { d.busy = text; d.error = ''; render({ keepScroll: true }); };
  let created = '';
  try {
    let uri = '';
    if (!d.raw && A && d.key.trim()) {
      step('Storing the key…');
      uri = (await studioPost('/api/secrets/credential', { context: LIVE.context, name: A.secret, key: A.keyName, value: d.key.trim() })).credentialUri || '';
      d.key = '';
    }
    step('Creating the task…');
    let r = await studioApi.ax(scope.concat(['apply', '-f', '-']), d.raw ? d.yaml : liveNewYAML(d, 'text', uri));
    if (r.status !== 0 && !d.raw && /unknown field "text"/.test(`${r.stderr}${r.stdout}`)) r = await studioApi.ax(scope.concat(['apply', '-f', '-']), liveNewYAML(d, 'spec', uri));
    if (r.status !== 0) throw new Error(liveLastLine(r.stderr || r.stdout) || 'ax apply failed.');
    created = d.raw ? liveYAMLTaskName(d.yaml) : liveDraftName(d);
    step('Starting it…');
    const s = created ? await studioApi.ax(scope.concat(['resume', 'task', created])) : { status: 0 };
    LIVE.draft = null;
    if (s.status !== 0) toast(`Created <span class="mono">${esc(created)}</span>, but it didn't start: ${esc(liveLastLine(s.stderr || s.stdout))}`, { icon: 'alert', timeout: 9000 });
    else toast(`Started <span class="mono">${esc(created || 'the task')}</span>`, { icon: 'play' });
    announce(`Started ${created}`);
    /* Leave the form first, so it isn't drawn again, empty, while the list reloads. */
    location.hash = created ? `#/task/${encodeURIComponent(created)}` : '#/';
    await liveRefresh(true);
  } catch (e) {
    d.busy = '';
    d.error = e.message;
    render({ keepScroll: true });
  }
}

/* ---------- The page ---------- */
function liveNewAgentHTML(d) {
  const card = (id, tile, title, desc) => `<button type="button" class="choice" role="radio" aria-checked="${d.agent === id}" data-action="live-new-agent" data-agent="${id}" id="live-agent-${id}">
      <span class="c-check">${icon('check')}</span>${tile}<span><span class="c-title">${title}</span><span class="c-desc">${desc}</span></span></button>`;
  const A = LIVE_AGENTS[d.agent];
  const extra = A
    ? `<label class="small" style="display:grid;gap:4px;margin-top:14px" for="live-new-key">${esc(A.keyFrom)} API key
        <input class="input mono" type="password" id="live-new-key" data-live-new="key" value="${esc(d.key)}" placeholder="Leave empty if it is already stored on this cluster" autocomplete="off"></label>
       <p class="xsmall muted" style="margin-top:6px">${icon('lock', 'xs')} It is stored on the cluster as a secret and added to the agent's requests outside the sandbox, so the agent never holds it.</p>`
    : `<label class="small" style="display:grid;gap:4px;margin-top:14px" for="live-new-image">Image address
        <input class="input mono" type="text" id="live-new-image" data-live-new="image" value="${esc(d.image)}" placeholder="registry.example.com/team/agent@sha256:…" autocomplete="off" spellcheck="false"></label>
       <p class="xsmall muted" style="margin-top:6px">It must end in its digest. ${d.from ? "Leave it empty to use AX's default task image, as the last turn did." : 'AX runs the image as it is, with your goal.'}</p>`;
  return `<div class="choice-grid" role="radiogroup" aria-label="Template" style="grid-template-columns:repeat(3,minmax(0,1fr))">
      ${Object.keys(LIVE_AGENTS).map((k) => card(k, agentTile(k, 'lg'), LIVE_AGENTS[k].name, LIVE_AGENTS[k].desc)).join('')}
      ${card('image', byoTile('lg'), 'Your own image', 'Any agent you packaged')}
    </div>${extra}`;
}
function liveAllowedHosts(d) {
  const A = LIVE_AGENTS[d.agent];
  const hosts = [];
  const add = (h) => { if (h && !hosts.includes(h)) hosts.push(h); };
  if (A) add(A.host);
  add(liveRepoHost(d.repo));
  if (d.network === 'balanced') LIVE_BALANCED_HOSTS.forEach(add);
  return hosts;
}
function liveNewGateMapHTML(d) {
  if (typeof gateMap !== 'function') return '';
  if (d.gateway) return `<div class="live-title" style="margin-bottom:6px">Network guardrails</div><p class="xsmall muted">Reusing Gateway <span class="mono">${esc(d.gateway)}</span> from the last turn.</p>`;
  const hosts = liveAllowedHosts(d);
  if (!hosts.length) return `<div class="live-title" style="margin-bottom:6px">Network guardrails</div><p class="xsmall muted">No Gateway: outbound network is closed.</p>`;
  return `<div class="live-title" style="margin-bottom:6px">Network guardrails (${d.network === 'balanced' ? 'Balanced' : 'Locked down'})</div>${gateMap(hosts, [], 4)}`;
}
function liveGoalHelpHTML(d) {
  const g = (d.goal || '').trim();
  const sugs = typeof SUGGESTIONS !== 'undefined' ? SUGGESTIONS : ['Fix the failing tests', 'Validate the signup form', 'Document the public API', 'Fix accessibility issues'];
  const tips = typeof GOAL_TIPS !== 'undefined' ? GOAL_TIPS : [];
  if (!g) return `<span class="gh-label xsmall muted">Try:</span>${sugs.map((s) => `<button type="button" class="pill" data-action="live-new-suggest" data-text="${esc(s)}">${esc(s)}</button>`).join('')}`;
  const missing = tips.filter((t) => !t.test.test(g));
  if (!missing.length) return `<span class="gh-ok xsmall">${icon('checkCircle', 'xs')} Clear goal. The agent plans from this.</span>`;
  return `<span class="gh-label xsmall muted">Make it clearer:</span>${missing.map((t) => `<button type="button" class="pill gh-add" data-action="live-new-tip" data-tip="${t.id}">${icon('plus', 'xs')}${esc(t.label)}</button>`).join('')}`;
}
function liveNewStepStates(d) {
  const A = LIVE_AGENTS[d.agent];
  const agentOk = A ? true : (d.from ? (!d.image.trim() || LIVE_DIGEST_RE.test(d.image.trim())) : LIVE_DIGEST_RE.test(d.image.trim()));
  const wsOk = !d.repo.trim() || !!liveRepoHost(d.repo.trim());
  const goalOk = A ? !!d.goal.trim() : (!!d.goal.trim() || agentOk);
  return [agentOk, wsOk, goalOk];
}
function livePlanHeadHTML(d) {
  const issues = liveNewIssues(d);
  const ready = !issues.length;
  const sub = ready
    ? `Runs ${liveIsLocal(LIVE.context) ? 'on this computer' : `on ${esc(LIVE.context || 'your cluster')}`} in a gVisor sandbox.`
    : esc(issues[0]);
  return `${axo(ready ? 'wave' : 'thinking', { decorative: true }).replace('<svg ', '<svg data-follow ')}<div><div class="h-display-sm">${ready ? 'Ready to run' : 'Almost ready'}</div><div class="small muted">${sub}</div></div>`;
}
function liveReadyListHTML(d) {
  const A = LIVE_AGENTS[d.agent];
  const [agentOk, wsOk, goalOk] = liveNewStepStates(d);
  const whereOk = !!LIVE.context;
  const items = [
    { ok: agentOk, t: A ? A.name : 'Your own image', s: A ? `API key injected outside the sandbox` : (d.image.trim() ? esc(d.image.trim().split('@')[0]) : "Choose an image with @sha256:…") },
    { ok: whereOk, t: liveIsLocal(LIVE.context) ? 'On this computer' : (LIVE.context ? `On ${esc(LIVE.context)}` : 'Choose a cluster'), s: whereOk ? `Context ${esc(LIVE.context)}` : 'Select a cluster in Where agents run' },
    { ok: wsOk, t: d.workspace ? `Workspace ${esc(d.workspace)}` : d.repo.trim() ? 'Git repo' : 'Empty /workspace', s: d.workspace ? 'Reused from last turn' : d.repo.trim() ? esc(d.repo.trim()) : 'No repo cloned' },
    { ok: goalOk, t: 'Goal', s: d.goal.trim() ? esc(d.goal.trim().split('\n')[0].slice(0, 48)) : 'Describe what the agent should do' },
  ];
  return items.map((c) => `<li class="${c.ok ? 'ok' : 'todo'}"><span class="rb">${c.ok ? icon('check') : ''}</span><span><span class="rt">${c.t}</span><span class="rs">${c.s}</span></span></li>`).join('');
}
function liveViewNew() {
  const from = parseRoute().q.get('from') || '';
  if (!LIVE.draft || LIVE.draft.from !== from) LIVE.draft = liveNewDraft(from);
  const d = LIVE.draft;
  const issues = liveNewIssues(d);
  const busy = !!d.busy;
  const ok = liveNewStepStates(d);
  const stepN = (k) => `<span class="n${ok[k - 1] ? ' ok' : ''}" id="sn-${k}" aria-hidden="true">${ok[k - 1] ? icon('check') : k}</span>`;
  const follow = d.from ? `<div class="callout" style="margin-top:14px" id="live-new-follow">${icon('message')}<div><strong>Following up on <span class="mono">${esc(d.from)}</span>.</strong> This starts a new task in the same session. It starts from the workspace's snapshot and the Git refs that were pushed. Files the last turn left unpushed don't carry over.</div></div>` : '';
  const where = `<p class="small" style="margin-top:10px">It runs ${liveWhere(LIVE.context)} <a class="btn ghost sm" href="#/places">Change</a></p>`;
  let body;
  if (d.raw) {
    body = `<section class="step-block first" aria-labelledby="live-new-file"><div class="step-head"><h2 id="live-new-file">The task's files</h2><span class="muted">This is what <code>ax apply</code> gets.</span></div>
        <textarea class="textarea mono" id="live-new-yaml" data-live-new="yaml" rows="24" spellcheck="false" aria-label="The task's files, as YAML">${esc(d.yaml)}</textarea>
        <div class="btn-row" style="margin-top:10px"><button class="btn ghost sm" data-action="live-new-form">${icon('undo', 'sm')}Back to the form</button></div></section>`;
  } else {
    const A = LIVE_AGENTS[d.agent];
    const ws = d.workspace
      ? `<p class="small">It uses the workspace <span class="mono">${esc(d.workspace)}</span> from the last turn.</p>`
      : `<label class="small" style="display:grid;gap:4px" for="live-new-repo">Git repo
          <input class="input mono" type="url" id="live-new-repo" data-live-new="repo" value="${esc(d.repo)}" placeholder="https://github.com/you/project.git" autocomplete="off" spellcheck="false"></label>
         <label class="small" style="display:grid;gap:4px;margin-top:10px;max-width:260px" for="live-new-branch"><span>Branch or ref <span class="muted">(optional)</span></span>
          <input class="input mono" type="text" id="live-new-branch" data-live-new="branch" value="${esc(d.branch)}" placeholder="main" autocomplete="off" spellcheck="false"></label>
         <p class="xsmall muted" style="margin-top:6px">AX clones it into the sandbox. Starting from a folder on this computer isn't possible yet. Leave it empty for an empty workspace.</p>`;
    const net = d.gateway
      ? `<p class="small">It uses the network rules <span class="mono">${esc(d.gateway)}</span> from the last turn.</p>`
      : `<div class="seg" role="group" aria-label="Network">
          <button type="button" aria-pressed="${d.network === 'balanced'}" data-action="live-new-network" data-network="balanced">Balanced</button>
          <button type="button" aria-pressed="${d.network === 'locked'}" data-action="live-new-network" data-network="locked">Locked down</button></div>
         <p class="xsmall muted" style="margin-top:6px" id="live-new-net-note">${d.network === 'balanced'
          ? `It can reach ${A ? "its model, " : ''}your repo's host, GitHub, PyPI and npm. Nothing else.`
          : `It can reach ${A ? "its model and " : 'only '}your repo's host. Nothing else.`}</p>`;
    body = `
      <section class="step-block first" aria-labelledby="live-step-agent"><div class="step-head">${stepN(1)}<h2 id="live-step-agent">Pick a template</h2></div>${liveNewAgentHTML(d)}</section>
      <section class="step-block" aria-labelledby="live-step-ws"><div class="step-head">${stepN(2)}<h2 id="live-step-ws">Set up its workspace</h2></div>${ws}</section>
      <section class="step-block" aria-labelledby="live-step-goal"><div class="step-head">${stepN(3)}<h2 id="live-step-goal">Describe the goal</h2></div>
        <textarea class="textarea" id="live-new-goal" data-live-new="goal" rows="4" aria-labelledby="live-step-goal" placeholder="${d.from ? 'What should it do next?' : 'What should the agent do? For example: fix the flaky tests in tests/ and explain the cause.'}">${esc(d.goal)}</textarea>
        <div class="goal-help" id="live-goal-help" style="margin-top:8px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">${liveGoalHelpHTML(d)}</div></section>
      <section class="step-block" aria-labelledby="live-step-opts"><div class="step-head"><h2 id="live-step-opts">Options</h2></div>
        <div class="live-title">Network</div><div style="margin-top:8px">${net}</div>
        <label class="toggle-line" style="margin-top:16px"><span class="tl-text"><b>Debug access</b><span>Lets you open a shell in the sandbox and see changes it hasn't pushed. Off keeps the sandbox closed: you review the task's result and the branch or pull request it pushes.</span></span>
          <span class="switch"><input type="checkbox" role="switch" id="live-new-debug" data-action="live-new-debug" ${d.debug ? 'checked' : ''} aria-label="Debug access"><span class="track"></span><span class="thumb"></span></span></label>
        <label class="small" style="display:grid;gap:4px;margin-top:16px;max-width:360px" for="live-new-name">Name
          <input class="input mono" type="text" id="live-new-name" data-live-new="name" value="${esc(liveDraftName(d))}" autocomplete="off" spellcheck="false"></label>
      </section>`;
  }
  const foot = `
    <div class="step-block" id="live-new-foot">
      <div id="live-new-error">${d.error ? `<div class="callout warn" role="alert" style="margin-bottom:12px">${icon('alert')}<div style="overflow-wrap:anywhere">${esc(d.error)}</div></div>` : ''}</div>
      <div class="btn-row"><button class="btn primary lg" id="live-new-run" data-action="live-new-run" ${busy ? 'disabled' : ''}>${busy ? `${icon('loader', 'sm')}${esc(d.busy)}` : `${icon('play', 'sm')}${d.from ? 'Send follow-up' : 'Run task'}`}</button>
        ${d.raw ? '' : `<button class="btn ghost" data-action="live-new-raw" ${busy ? 'disabled' : ''}>${icon('code', 'sm')}Edit the task's files</button>`}</div>
      <p class="small" style="margin-top:8px" id="live-new-hint">${issues.length ? esc(issues[0]) : ''}</p>
      <p class="xsmall muted" style="margin-top:10px">${icon('terminal', 'xs')} The same from the command line: <code>${esc(liveCmd(['apply', '-f', 'task.yaml']))}</code>, then <code>${esc(liveCmd(['resume', 'task', '<name>']))}</code></p>
    </div>`;
  const side = `
    <aside class="new-side" aria-label="Task readiness">
      <section class="card card-pad plan-card" id="live-plan-card">
        <div class="plan-head" id="plan-head">${livePlanHeadHTML(d)}</div>
        <ul class="ready-list" id="live-ready-list" style="margin-top:12px">${liveReadyListHTML(d)}</ul>
        <div id="live-new-gatemap" style="margin-top:14px">${liveNewGateMapHTML(d)}</div>
      </section>
    </aside>`;
  const html = `
    <div class="page-head"><h1 tabindex="-1">${d.from ? 'Send a follow-up' : 'Start a task'}</h1>
      <p class="lede">${d.from ? 'The agent picks up the same session with a new goal.' : 'Pick a template, point it at a repo and describe the goal. The agent works in its own sandbox.'}</p></div>
    ${where}${follow}
    <div class="new-grid" style="margin-top:14px">
      <div style="min-width:0">${body}${foot}</div>
      ${side}
    </div>`;
  return { title: d.from ? 'Send a follow-up' : 'Start a task', crumbs: [{ label: 'Home', href: '#/' }, { label: d.from ? 'Follow-up' : 'New task' }], html, wide: true };
}
/** Typing updates the draft and the few places that depend on it, without redrawing the form under the cursor. */
function liveNewTyped(el) {
  const d = LIVE.draft;
  const k = el.dataset.liveNew;
  if (!d || !k) return;
  if (k === 'name') { d.name = el.value; d.nameEdited = true; } else d[k] = el.value;
  const nameBox = $('#live-new-name');
  if (nameBox && k !== 'name' && !d.nameEdited) nameBox.value = liveDraftName(d);
  const issues = liveNewIssues(d);
  const hint = $('#live-new-hint'); if (hint) hint.textContent = issues[0] || '';
  if (d.error) { d.error = ''; const err = $('#live-new-error'); if (err) err.innerHTML = ''; }
  liveNewStepStates(d).forEach((ok, idx) => {
    const n = $('#sn-' + (idx + 1));
    if (n) { n.innerHTML = ok ? icon('check') : String(idx + 1); if (n.classList) n.classList.toggle('ok', ok); }
  });
  const rl = $('#live-ready-list'); if (rl) rl.innerHTML = liveReadyListHTML(d);
  const gh = $('#live-goal-help'); if (gh && k === 'goal') gh.innerHTML = liveGoalHelpHTML(d);
  const gm = $('#live-new-gatemap'); if (gm && k === 'repo') gm.innerHTML = liveNewGateMapHTML(d);
  const ph = $('#plan-head');
  if (ph) {
    const oldAx = ph.querySelector ? ph.querySelector('svg.axo') : null;
    ph.innerHTML = livePlanHeadHTML(d);
    if (oldAx && typeof keepAxel === 'function') keepAxel(oldAx, ph);
  }
}

/* ---------- Running on another cluster ---------- */
function livePromoteArgs(p, preflight) {
  const ns = (STUDIO.info && STUDIO.info.axNamespace) || 'ax-system';
  const args = ['promote', 'task', p.name, '--to', p.to, '--to-namespace', ns];
  if (p.replace) args.push('--replace');
  if (p.suspend) args.push('--suspend-source');
  if (preflight) args.push('--preflight-only');
  return args;
}
/** One line of what `ax promote` prints ("task.ax.io/fix-tests created (preflight only)"), in the UI's words.
    A line this doesn't know stays as ax printed it. */
function livePromoteLine(line) {
  const m = /^(gateway|workspace|task)\.ax\.io\/(\S+) (created|reused|unchanged|replaced|resumed|suspended on the source)(?: \(preflight only\))?$/.exec(line.trim());
  if (!m) return esc(line);
  const n = `<span class="mono">${esc(m[2])}</span>`;
  const [what, there] = { gateway: ['network rules', 'that are already there'], workspace: ['workspace', 'that is already there'], task: ['task', 'that is already there'] }[m[1]];
  if (m[3] === 'created') return `Creates the ${what} ${n} there`;
  if (m[3] === 'reused' || m[3] === 'unchanged') return `Uses the ${what} ${n} ${there}`;
  if (m[3] === 'replaced') return `Deletes the ${what} ${n} ${there}, then creates it again`;
  if (m[3] === 'resumed') return `Starts ${n} there`;
  return `Pauses ${n} on this cluster`;
}
/** A note `ax promote` prints about keys the other cluster must hold, in the UI's words. */
function livePromoteNote(line) {
  const m = /^Note: the target must provide the credentials that gateway (\S+) injects: (.+)$/.exec(line.trim());
  if (!m) return esc(line.trim().replace(/^Note:\s*/i, ''));
  const secrets = m[2].split(',').map((u) => u.trim().split('/').slice(-2, -1)[0]).filter(Boolean);
  return `That cluster needs its own copy of ${secrets.length === 1 ? 'the key' : 'the keys'} ${secrets.map((x) => `<span class="mono">${esc(x)}</span>`).join(', ')}. Keys aren't copied.`;
}
function liveOpenPromote(name) {
  const targets = LIVE.contexts.filter((c) => c.name !== LIVE.context);
  const p = { name, to: targets.length ? targets[0].name : '', replace: false, suspend: false, check: null, checking: false, sending: false, error: '', seq: 0 };
  const scope = ['--context', LIVE.context, '-a', LIVE.atespace];
  const text = (r) => [String(r.stdout || '').trim(), String(r.stderr || '').trim()].filter(Boolean).join('\n');
  const dlg = openDialog(dialogShell('lp', `Run ${esc(name)} on another cluster`, '', '<div id="lp-body"></div>', `<span class="left"></span><button class="btn ghost" data-action="close-dialog">Cancel</button><button class="btn primary" id="lp-go">${icon('cloudUp', 'sm')}Send</button>`, true, 'cloudUp'));
  const paint = () => {
    const body = $('#lp-body', dlg);
    if (!body) return;
    const go = $('#lp-go', dlg);
    if (!targets.length) {
      body.innerHTML = `<p class="small">Your kubeconfig has no other cluster. Add one to <span class="mono">~/.kube/config</span> and it shows up here.</p>`;
      go.disabled = true;
      return;
    }
    const lines = String((p.check && p.check.text) || '').split('\n').map((l) => l.trim()).filter(Boolean);
    const notes = lines.filter((l) => /^Note:/i.test(l));
    const steps = lines.filter((l) => !/^Note:/i.test(l));
    const check = p.checking ? `<p class="small muted" id="lp-check" style="margin-top:14px">${icon('loader', 'xs')} Checking ${esc(p.to)}…</p>`
      : !p.check ? ''
      : p.check.ok ? `<div class="live-title" style="margin-top:14px">The check passed. This is what sending it does:</div>
          <ul class="live-steps" id="lp-check">${steps.map((l) => `<li>${livePromoteLine(l)}</li>`).join('') || '<li>Creates the task there</li>'}</ul>
          ${notes.map((l) => `<p class="small lp-note" style="margin-top:8px">${icon('key', 'xs')} ${livePromoteNote(l)}</p>`).join('')}`
      : `<div class="live-title" style="margin-top:14px">The check found a problem:</div>
          <pre class="manifest" id="lp-check" style="margin-top:8px;max-height:180px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere" tabindex="0" aria-label="Check result">${esc(p.check.text || 'The check failed without saying why.')}</pre>
          ${/--replace/.test(p.check.text) && !p.replace ? '<p class="small" style="margin-top:8px" id="lp-fix">To send it anyway, turn on <b>Replace the task that is there</b>.</p>' : ''}`;
    body.innerHTML = `
      <label class="small" style="display:grid;gap:4px" for="lp-to">Cluster
        <select class="input" id="lp-to" ${p.sending ? 'disabled' : ''}>${targets.map((c) => `<option value="${esc(c.name)}" ${c.name === p.to ? 'selected' : ''}>${esc(c.name)}${liveIsLocal(c.name) ? ' (this computer)' : ''}</option>`).join('')}</select></label>
      <div class="callout" style="margin-top:12px" id="lp-note">${icon('info')}<div>The run there starts fresh. It pulls from the Git branch that was pushed, and it uses that cluster's own Gateway credentials. Files in this sandbox and keys stored on this cluster aren't copied.</div></div>
      <label class="toggle-line" style="margin-top:12px"><span class="tl-text"><b>Pause it here</b><span>AX pauses it on this cluster before it starts there, so it doesn't run in both places.</span></span>
        <span class="switch"><input type="checkbox" role="switch" id="lp-suspend" ${p.suspend ? 'checked' : ''} ${p.sending ? 'disabled' : ''} aria-label="Pause it here"><span class="track"></span><span class="thumb"></span></span></label>
      <label class="toggle-line" style="margin-top:8px"><span class="tl-text"><b>Replace the task that is there</b><span>If that cluster already has a task with this name, AX deletes it first.</span></span>
        <span class="switch"><input type="checkbox" role="switch" id="lp-replace" ${p.replace ? 'checked' : ''} ${p.sending ? 'disabled' : ''} aria-label="Replace the task that is there"><span class="track"></span><span class="thumb"></span></span></label>
      ${check}
      ${p.error ? `<div class="callout warn" role="alert" style="margin-top:12px">${icon('alert')}<div style="overflow-wrap:anywhere;white-space:pre-wrap">${esc(p.error)}</div></div>` : ''}
      <div class="live-cli-wrap" style="margin-top:12px">${cliHint(['ax', '--context', LIVE.context].concat(livePromoteArgs(p, false)).join(' '))}</div>`;
    go.disabled = p.sending || p.checking || !(p.check && p.check.ok);
    go.innerHTML = p.sending ? `${icon('loader', 'sm')}Sending…` : `${icon('cloudUp', 'sm')}Send to ${esc(p.to)}`;
    $('#lp-to', body).addEventListener('change', (e) => { p.to = e.target.value; runCheck(); });
    $('#lp-suspend', body).addEventListener('change', (e) => { p.suspend = e.target.checked; runCheck(); });
    $('#lp-replace', body).addEventListener('change', (e) => { p.replace = e.target.checked; runCheck(); });
  };
  /* Check first: ax promote --preflight-only reads both clusters and changes nothing. */
  const runCheck = async () => {
    const seq = ++p.seq;
    p.checking = true; p.check = null; p.error = '';
    paint();
    let r;
    try { r = await studioApi.ax(scope.concat(livePromoteArgs(p, true))); } catch (e) { r = { status: 1, stdout: '', stderr: e.message }; }
    if (seq !== p.seq) return; // the options changed while this check ran
    p.checking = false;
    p.check = { ok: r.status === 0, text: text(r) };
    paint();
    announce(p.check.ok ? `The check passed. You can send it to ${p.to}.` : `The check found a problem with ${p.to}.`);
  };
  $('#lp-go', dlg).addEventListener('click', async () => {
    if (p.sending || !(p.check && p.check.ok)) return;
    p.sending = true; p.error = '';
    paint();
    let r;
    try { r = await studioApi.ax(scope.concat(livePromoteArgs(p, false))); } catch (e) { r = { status: 1, stdout: '', stderr: e.message }; }
    p.sending = false;
    if (r.status !== 0) { p.error = text(r) || 'ax promote failed.'; paint(); return; }
    closeDialog(true);
    toast(`<span class="mono">${esc(name)}</span> is running on ${esc(p.to)}`, { icon: 'cloudUp' });
    announce(`${name} is running on ${p.to}`);
    liveUseContext(p.to);
    render();
    liveRefresh(true);
  });
  paint();
  if (targets.length) runCheck();
}

const LIVE_NEW_ACTIONS = {
  'live-new-agent': (el) => { if (LIVE.draft && !LIVE.draft.busy) { LIVE.draft.agent = el.dataset.agent; LIVE.draft.error = ''; render({ keepScroll: true }); } },
  'live-new-network': (el) => { if (LIVE.draft) { LIVE.draft.network = el.dataset.network; render({ keepScroll: true }); } },
  'live-new-debug': (el) => { if (LIVE.draft) LIVE.draft.debug = !!el.checked; },
  'live-new-raw': () => { const d = LIVE.draft; if (d) { d.yaml = liveNewYAML(d, 'text', ''); d.raw = true; d.error = ''; render({ keepScroll: true }); } },
  'live-new-form': () => { if (LIVE.draft) { LIVE.draft.raw = false; LIVE.draft.error = ''; render({ keepScroll: true }); } },
  'live-new-run': () => liveNewRun(),
  'live-promote': (el) => liveOpenPromote(el.dataset.task),
  'live-new-suggest': (el) => {
    if (!LIVE.draft) return;
    LIVE.draft.goal = el.dataset.text || '';
    LIVE.draft.error = '';
    render({ keepScroll: true });
    const g = $('#live-new-goal'); if (g) g.focus({ preventScroll: true });
  },
  'live-new-tip': (el) => {
    if (!LIVE.draft || typeof GOAL_TIPS === 'undefined') return;
    const tip = GOAL_TIPS.find((t) => t.id === el.dataset.tip);
    if (!tip) return;
    const cur = LIVE.draft.goal.trim();
    LIVE.draft.goal = cur ? `${cur}\n${tip.add}` : tip.add;
    LIVE.draft.error = '';
    render({ keepScroll: true });
    const g = $('#live-new-goal'); if (g) g.focus({ preventScroll: true });
  },
};
if (LIVE.on) document.addEventListener('input', (e) => { if (e.target && e.target.dataset && e.target.dataset.liveNew) liveNewTyped(e.target); });
