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

   - New task follows the prototype's four steps (style guide §15): pick a template, choose where it runs, set up the
     workspace, and describe the goal. Each step is its main choice and one panel of labelled rows. The run plan beside
     it says what is left, shows what the task can reach, and holds Run. More options holds the network rules,
     resources, the name, the task's files and the command line.
   - Defaults are the ones most tasks want: Antigravity, the cluster in use, the repo you used last, the repo's default
     branch, Balanced network rules, and debug access on this computer (off on a shared cluster). Pills fill in common
     answers: recent repos, branch names, goal ideas and goal tips.
   - Run writes the task's files (a Gateway, a Workspace and a Task, as ax.io/v1alpha1 YAML), has the Studio server run
     `ax apply` on them, then `ax resume task`. You can read and edit the files before they are applied.
   - A follow-up is a new task in the same session as an earlier one. It reuses that task's workspace and network
     rules. It starts from the workspace's snapshot and the Git refs that were pushed, not from the earlier sandbox.
   - Running on another cluster is `ax promote` (check first with --preflight-only, then send), or, when this ax has no
     promote, Studio's own move through the AX API. */

/* The templates. The images and settings are the ones the Studio pages used before this UI, so a task looks the same
   to AX whichever page started it. They are staging images until the templates are published. */
const LIVE_AGENTS = {
  antigravity: {
    id: 'antigravity', name: 'Antigravity', desc: "Google's coding agent, on Gemini", keyFrom: 'Gemini', model: 'gemini-3.8-flash',
    image: 'ghcr.io/rakyll/ax-images/antigravity@sha256:8025a987861673718564e0e648a3c7785d23c2514be8c7a3d3b133413d9bc81e',
    secret: 'gemini-api-creds', keyName: 'GEMINI_API_KEY', host: 'generativelanguage.googleapis.com', header: 'x-goog-api-key',
    config: (goal) => `prompt: ${liveYBlock(goal, 2)}\nmodel: gemini-3.8-flash\nmaxTurns: 100`,
  },
  claude: {
    id: 'claude', name: 'Claude Code', desc: "Anthropic's coding agent", keyFrom: 'Anthropic', model: 'claude-opus-5-5',
    image: 'ghcr.io/rakyll/ax-images/claude-managed-agents@sha256:1a532d86c58a5fea3005e9c525683cf8f354e2c403be6460a308ad2f8f0510c0',
    secret: 'anthropic-api-creds', keyName: 'ANTHROPIC_API_KEY', host: 'api.anthropic.com', header: 'x-api-key',
    config: (goal) => `agent:\n  model: "claude-opus-5-5"\n  system: "You are a careful software engineer working in /workspace."\nprompt: ${liveYBlock(goal, 2)}`,
  },
};
/* What "Balanced" lets a task reach besides its model and its repo: GitHub, PyPI and npm. */
const LIVE_BALANCED_HOSTS = ['github.com', 'api.github.com', '*.githubusercontent.com', 'pypi.org', 'files.pythonhosted.org', 'registry.npmjs.org'];
/* The sandbox's size. A template starts at Medium and your own image at Small. */
const LIVE_SIZES = {
  small: { label: 'Small', cpu: '1', memory: '1Gi', hint: '1 CPU · 1 GiB memory' },
  medium: { label: 'Medium', cpu: '2', memory: '4Gi', hint: '2 CPU · 4 GiB memory' },
  large: { label: 'Large', cpu: '4', memory: '8Gi', hint: '4 CPU · 8 GiB memory' },
};
/* Branch names to fill in with one click. Empty means the repo's default branch. */
const LIVE_BRANCH_PICKS = ['main', 'master', 'develop'];
const LIVE_RECENT_KEY = 'ax.live.recentRepos';
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
/** "https://github.com/acme/api.git" -> "github.com/acme/api". */
function liveRepoShort(url) {
  try { const u = new URL(url); return (u.hostname.replace(/^www\./, '') + u.pathname).replace(/\.git$/, '').replace(/\/+$/, ''); } catch (e) { return String(url || ''); }
}
/** "ghcr.io/acme/agent@sha256:5382…" -> "agent@538252…". */
function liveImageShort(ref) {
  const [path, digest] = String(ref || '').split('@');
  const name = path.split('/').pop() || path;
  return digest ? `${name}@${digest.replace(/^sha256:/, '').slice(0, 12)}` : name;
}
/** The ax command that does the same on a given cluster. */
function liveCmdAt(context, args) { return ['ax'].concat(context ? ['--context', context] : [], args).join(' '); }

/* ---------- Repos you used before (in this browser) ---------- */
function liveRecentRepos() {
  try {
    const a = JSON.parse(localStorage.getItem(LIVE_RECENT_KEY) || '[]');
    return Array.isArray(a) ? a.filter((x) => typeof x === 'string' && liveRepoHost(x)).slice(0, 5) : [];
  } catch (e) { return []; }
}
function liveRememberRepo(url) {
  if (!liveRepoHost(url)) return;
  try { localStorage.setItem(LIVE_RECENT_KEY, JSON.stringify([url].concat(liveRecentRepos().filter((x) => x !== url)).slice(0, 5))); } catch (e) { /* ignore */ }
}

/* ---------- Where it runs ---------- */
/** AX on this computer is running, and its cluster is in the kubeconfig. */
function liveLocalReady() {
  const L = LIVE.local;
  return !!(L && L.state === 'Running' && L.context && LIVE.contexts.some((c) => c.name === L.context));
}
/** The cluster in use, if a task can run there; else this computer; else the first remote cluster. */
function liveNewDefaultWhere() {
  if (LIVE.context && LIVE.contexts.some((c) => c.name === LIVE.context) && (!liveIsLocal(LIVE.context) || liveLocalReady())) return LIVE.context;
  if (liveLocalReady()) return LIVE.local.context;
  const r = LIVE.contexts.find((c) => !liveIsLocal(c.name));
  return r ? r.name : '';
}
/** Until you choose where it runs, the form follows the best place. It also picks again if your choice is gone. */
function liveNewRepick(d) {
  if (d.from) return;
  const gone = !d.where || !LIVE.contexts.some((c) => c.name === d.where);
  if (d.whereTouched && !gone) return;
  if (gone) d.whereTouched = false;
  d.where = liveNewDefaultWhere();
  if (!d.debugTouched) d.debug = liveIsLocal(d.where);
}
/** What the form shows that comes from the cluster, not from you. When it changes, the form is drawn again. */
function liveNewEnvSig() {
  const L = LIVE.local || {};
  return [LIVE.context, LIVE.contexts.map((c) => c.name).join(','), L.state || '', L.context || ''].join('|');
}

/* ---------- The draft ---------- */
function liveHex(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(''); }
function liveSlug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').split('-').slice(0, 4).join('-').slice(0, 28).replace(/-+$/, '');
}
function liveSizeOf(limits) {
  return Object.keys(LIVE_SIZES).find((k) => limits && String(limits.cpu) === LIVE_SIZES[k].cpu && String(limits.memory) === LIVE_SIZES[k].memory) || '';
}
/** A new draft. `from` names the task to follow up on; `again` starts from that task's goal (trying a failed task again). */
function liveNewDraft(from, again) {
  const where = liveNewDefaultWhere();
  const d = { agent: 'antigravity', image: '', source: 'git', repo: liveRecentRepos()[0] || '', branch: '', goal: '', key: '', network: 'balanced',
    where, whereTouched: false, debug: liveIsLocal(where), debugTouched: false, size: '', wsOpen: null, moreOpen: false, envSig: '',
    name: '', nameEdited: false, suffix: liveHex(2), from: '', base: '', session: '', workspace: '', gateway: '', raw: false, yaml: '', busy: '', error: '',
    /* Workspace setup (more repos, setup commands, files, MCP servers) and More options (custom size, command, env). */
    existing: '', cpu: '', memory: '', command: '', envText: '', repos: '', setup: '', files: [], mcp: [] };
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
    /* The last turn had no workspace (an empty /workspace): the follow-up starts the same way unless you add a repo. */
    if (!d.workspace) d.source = 'empty';
    d.gateway = (spec.gateway && spec.gateway.name) || '';
    d.debug = !!spec.debug;
    d.debugTouched = true;
    d.size = liveSizeOf(spec.profile && spec.profile.resources && spec.profile.resources.limits);
    /* A follow-up runs where its session is: the workspace and the network rules are there. */
    d.where = LIVE.context;
    if (again) { d.again = true; d.goal = liveTask(prev).goal || ''; }
  }
  return d;
}
function liveDraftSize(d) { return d.size === 'custom' || LIVE_SIZES[d.size] ? d.size : LIVE_AGENTS[d.agent] ? 'medium' : 'small'; }
/** The CPU and memory the task asks for: a size's, or the ones you typed. */
function liveDraftLimits(d) {
  const k = liveDraftSize(d);
  return k === 'custom' ? { cpu: String(d.cpu || '').trim(), memory: String(d.memory || '').trim() } : { cpu: LIVE_SIZES[k].cpu, memory: LIVE_SIZES[k].memory };
}
const LIVE_CPU_RE = /^(\d+(\.\d+)?|\d+m)$/;
const LIVE_MEM_RE = /^\d+(\.\d+)?(Ki|Mi|Gi|Ti|K|M|G|T)$/;
const LIVE_ENV_RE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;
/** A command line as its words: quotes keep spaces, a backslash keeps the next character. */
function liveSplitArgs(line) {
  const out = [];
  let cur = '', quote = '', any = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = '';
      else if (ch === '\\' && quote === '"' && i + 1 < line.length) cur += line[++i];
      else cur += ch;
    } else if (ch === '"' || ch === "'") { quote = ch; any = true; }
    else if (ch === '\\' && i + 1 < line.length) { cur += line[++i]; any = true; }
    else if (/\s/.test(ch)) { if (cur || any) out.push(cur); cur = ''; any = false; }
    else { cur += ch; any = true; }
  }
  if (cur || any) out.push(cur);
  return { args: out, error: quote ? 'The command has a quote that isn\'t closed.' : '' };
}
function liveLines(text) { return String(text || '').split('\n').map((l) => l.trim()).filter(Boolean); }
/** The workspace setup you added under More options. */
function liveSetupExtras(d) {
  const repos = liveLines(d.repos);
  const setup = liveLines(d.setup);
  const files = (d.files || []).filter((f) => String(f.path || '').trim() || String(f.content || '').trim());
  const mcp = (d.mcp || []).filter((m) => String(m.name || '').trim() || String(m.endpoint || '').trim());
  return { repos, setup, files, mcp, any: !!(repos.length || setup.length || files.length || mcp.length) };
}
/** A repo's folder in /workspace: its name ("https://github.com/acme/api.git" is "api"), kept unique. */
function liveRepoDir(url, taken) {
  let base = 'repo';
  try { base = new URL(url).pathname.split('/').filter(Boolean).pop().replace(/\.git$/, '') || 'repo'; } catch (e) { /* keep repo */ }
  base = base.replace(/[^A-Za-z0-9._-]/g, '-');
  let n = base, i = 2;
  while (taken.includes(n)) n = `${base}-${i++}`;
  taken.push(n);
  return n;
}
/** Whether the draft makes a workspace of its own: a repo to clone, or setup you added. */
function liveMakesWorkspace(d) {
  if (d.workspace || d.source === 'existing') return false;
  return (d.source === 'git' && !!d.repo.trim()) || liveSetupExtras(d).any;
}
function liveDraftName(d) {
  if (d.nameEdited) return d.name.trim();
  return `${d.from ? d.base : liveSlug(d.goal) || 'task'}-${d.suffix}`;
}
/** What stops this draft from running, in page order. */
function liveNewIssues(d) {
  const out = [];
  if (!d.where) out.push('Choose where it runs. Set up AX on this computer, or add a cluster to your kubeconfig.');
  else if (liveIsLocal(d.where) && !liveLocalReady()) out.push('Start AX on this computer first, in Where agents run.');
  if (d.raw) { if (!/^kind:\s*Task\s*$/m.test(d.yaml)) out.push('The file needs a Task.'); return out; }
  const A = LIVE_AGENTS[d.agent];
  if (!A && d.image.trim() && !LIVE_DIGEST_RE.test(d.image.trim())) out.push('The image address must end in its digest: @sha256: and 64 characters.');
  if (!A && !d.image.trim() && !d.from) out.push('Give the address of your image.');
  if (!d.workspace && d.source === 'git') {
    if (!d.repo.trim()) out.push('Add a Git repo, or choose Empty workspace.');
    else if (!liveRepoHost(d.repo.trim())) out.push('The repo must be an https:// Git address.');
  }
  if (!d.workspace && d.source === 'existing') {
    const w = liveNewWsDoc(d, d.existing);
    if (!d.existing) out.push('Pick a workspace, or choose another way to start.');
    else if (w && w.status && w.status.phase === 'Failed') out.push(`The workspace ${d.existing} failed its setup. Pick another one.`);
  }
  if (liveDraftSize(d) === 'custom') {
    const l = liveDraftLimits(d);
    if (!LIVE_CPU_RE.test(l.cpu)) out.push('Give the CPU as a number, like 2 or 500m.');
    if (!LIVE_MEM_RE.test(l.memory)) out.push('Give the memory with its unit, like 4Gi or 512Mi.');
  }
  if (d.command.trim() && liveSplitArgs(d.command.trim()).error) out.push(liveSplitArgs(d.command.trim()).error);
  if (liveLines(d.envText).some((l) => !LIVE_ENV_RE.test(l))) out.push('Write each environment variable as NAME=value, one per line.');
  const x = liveSetupExtras(d);
  if (!d.workspace && d.source !== 'existing') {
    if (x.repos.some((r) => !liveRepoHost(r))) out.push('Each extra repo must be an https:// Git address.');
    if (x.files.some((f) => { const pth = String(f.path || '').trim(); return !pth || pth.startsWith('/') || pth.split('/').includes('..'); })) out.push('Give each file a path inside /workspace, like AGENTS.md.');
    if (x.mcp.some((m) => !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(String(m.name || '').trim()) || !liveRepoHost(String(m.endpoint || '').trim()))) out.push('Give each MCP server a name and an https:// address.');
  }
  if (A && !d.goal.trim()) out.push('Describe the goal.');
  if (!LIVE_NAME_RE.test(liveDraftName(d))) out.push('The name can use lowercase letters, digits and hyphens, up to 63 characters.');
  return out;
}
/** The task's files. goalField is "text" in current AX. It was "spec" until mid-November 2026. */
function liveNewYAML(d, goalField, credentialUri) {
  const A = LIVE_AGENTS[d.agent];
  const name = liveDraftName(d);
  const goal = d.goal.trim();
  const repo = !d.workspace && d.source === 'git' ? d.repo.trim() : '';
  const x = d.workspace || d.source === 'existing' ? { repos: [], setup: [], files: [], mcp: [], any: false } : liveSetupExtras(d);
  const docs = [];
  const head = (kind, n) => `apiVersion: ax.io/v1alpha1\nkind: ${kind}\nmetadata:\n  name: ${liveYQ(n)}`;

  /* Network: an existing Gateway (a follow-up), or a new one with what this task may reach. No hosts, no Gateway. */
  let gateway = d.gateway;
  if (!gateway) {
    const hosts = [];
    const add = (h) => { if (h && !hosts.includes(h) && !(A && h === A.host)) hosts.push(h); };
    add(liveRepoHost(repo));
    x.repos.forEach((r) => add(liveRepoHost(r)));
    x.mcp.forEach((m) => add(liveRepoHost(String(m.endpoint || '').trim())));
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

  /* Workspace: the last turn's (a follow-up), one already on the cluster, or a new one that clones the repo and runs
     the setup you added. */
  let workspace = d.workspace || (d.source === 'existing' ? d.existing : '');
  if (!workspace && (repo || x.any)) {
    workspace = `ws-${name}`.slice(0, 63);
    const taken = [];
    let setup = '';
    const git = (repo ? [`      - name: "origin"\n        repo: ${liveYQ(repo)}\n        dir: "."${d.branch.trim() ? `\n        ref: ${liveYQ(d.branch.trim())}` : ''}`] : [])
      .concat(x.repos.map((r) => { const dir = liveRepoDir(r, taken); return `      - name: ${liveYQ(dir)}\n        repo: ${liveYQ(r)}\n        dir: ${liveYQ(dir)}`; }));
    if (git.length) setup += `\n    git:\n${git.join('\n')}`;
    if (x.files.length) setup += `\n    files:\n${x.files.map((f) => `      - path: ${liveYQ(String(f.path).trim())}\n        content: ${liveYBlock(String(f.content || ''), 10)}`).join('\n')}`;
    if (x.setup.length) setup += `\n    commands:\n${x.setup.map((c) => `      - ${liveYQ(c)}`).join('\n')}`;
    let y = `${head('Workspace', workspace)}\nspec:`;
    if (setup) y += `\n  setup:${setup}`;
    if (x.mcp.length) y += `\n  mcp:\n    servers:\n${x.mcp.map((m) => `      - name: ${liveYQ(String(m.name).trim())}\n        endpoint: ${liveYQ(String(m.endpoint).trim())}`).join('\n')}`;
    docs.push(y);
  }

  const image = A ? A.image : d.image.trim();
  const S = liveDraftLimits(d);
  let t = `${head('Task', name)}\nspec:\n  profile:${image ? `\n    image: ${liveYQ(image)}` : ''}\n    resources:\n      limits:\n        cpu: ${liveYQ(S.cpu)}\n        memory: ${liveYQ(S.memory)}`;
  if (goal) t += `\n  goal:\n    ${goalField || 'text'}: ${liveYBlock(goal, 6)}`;
  if (d.session) t += `\n  sessionId: ${liveYQ(d.session)}`;
  const cmd = d.command.trim() ? liveSplitArgs(d.command.trim()).args : [];
  if (cmd.length) t += `\n  commands: [${cmd.map(liveYQ).join(', ')}]`;
  if (A) t += `\n  config:\n${liveIndent(A.config(goal), 4)}`;
  const env = (A ? [[A.keyName, 'placeholder']] : []).concat(liveLines(d.envText).map((l) => LIVE_ENV_RE.exec(l)).filter(Boolean).map((m) => [m[1], m[2]]));
  if (env.length) t += `\n  env:\n${env.map(([k, v]) => `    - name: ${liveYQ(k)}\n      value: ${liveYQ(v)}`).join('\n')}`;
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
  const ctx = d.where || LIVE.context;
  const scope = ['--context', ctx, '-a', LIVE.atespace];
  const A = LIVE_AGENTS[d.agent];
  const step = (text) => { d.busy = text; d.error = ''; render({ keepScroll: true }); };
  let created = '';
  try {
    let uri = '';
    if (!d.raw && A && d.key.trim()) {
      step('Storing the key…');
      uri = (await studioPost('/api/secrets/credential', { context: ctx, name: A.secret, key: A.keyName, value: d.key.trim() })).credentialUri || '';
      d.key = '';
    }
    step('Creating the task…');
    let r = await studioApi.ax(scope.concat(['apply', '-f', '-']), d.raw ? d.yaml : liveNewYAML(d, 'text', uri));
    if (r.status !== 0 && !d.raw && /unknown field "text"/.test(`${r.stderr}${r.stdout}`)) r = await studioApi.ax(scope.concat(['apply', '-f', '-']), liveNewYAML(d, 'spec', uri));
    if (r.status !== 0) throw new Error(liveLastLine(r.stderr || r.stdout) || 'ax apply failed.');
    created = d.raw ? liveYAMLTaskName(d.yaml) : liveDraftName(d);
    if (!d.raw && !d.workspace && d.source === 'git') liveRememberRepo(d.repo.trim());
    step('Starting it…');
    const s = created ? await studioApi.ax(scope.concat(['resume', 'task', created])) : { status: 0 };
    LIVE.draft = null;
    /* The task is on the cluster you chose, so that is the one Studio shows from now on. */
    if (ctx !== LIVE.context) liveUseContext(ctx);
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

/* ---------- The page: 1 · Pick a template ---------- */
function liveNewAgentHTML(d) {
  const card = (id, tile, title, desc, foot) => `<button type="button" class="choice" role="radio" aria-checked="${d.agent === id}" data-action="live-new-agent" data-agent="${id}" id="live-agent-${id}">
      <span class="c-check">${icon('check')}</span>${tile}<span><span class="c-title">${title}</span><span class="c-desc">${desc}</span></span><span class="c-foot">${foot}</span></button>`;
  const picker = `<div class="choice-grid" role="radiogroup" aria-labelledby="live-step-agent">
      ${Object.keys(LIVE_AGENTS).map((k) => card(k, agentTile(k, 'lg'), LIVE_AGENTS[k].name, LIVE_AGENTS[k].desc, `${icon('sparkle', 'xs')}<span class="mono">${esc(LIVE_AGENTS[k].model)}</span>`)).join('')}
      ${card('image', byoTile('lg'), 'Your own image', 'Any agent you packaged as a container image', `${icon('box', 'xs')}Pinned by its digest`)}
    </div>`;
  const A = LIVE_AGENTS[d.agent];
  const env = LIVE.env || {};
  const where = !d.where ? 'the cluster' : liveIsLocal(d.where) ? 'this computer' : d.where;
  const rows = A ? [
    prow(`${esc(A.keyFrom)} API key`, `<input class="input mono" type="password" id="live-new-key" data-live-new="key" value="${esc(d.key)}" placeholder="Leave empty if it's already stored on ${esc(where)}" autocomplete="off" aria-labelledby="live-key-label" aria-describedby="live-new-key-hint">
        <span class="prow-hint" id="live-new-key-hint">${icon('lock', 'xs')} Stored on the cluster as a secret and added to the agent's requests outside the sandbox, so the agent never holds it.</span>`, { labelId: 'live-key-label', sub: 'Only the first time' }),
  ] : [
    prow('Image', `<input class="input mono" type="text" id="live-new-image" data-live-new="image" value="${esc(d.image)}" placeholder="registry.example.com/team/agent@sha256:…" autocomplete="off" spellcheck="false" aria-labelledby="live-image-label" aria-describedby="live-new-image-hint">
        <span class="prow-hint" id="live-new-image-hint">It must end in its digest (<span class="mono">@sha256:…</span>). AX runs the image as it is, with your goal.</span>`, { labelId: 'live-image-label', sub: 'Its address and digest' }),
  ];
  return `${picker}<div class="panel tpl-panel">${rows.join('')}</div>`;
}

/* ---------- 2 · Where should it run? ---------- */
function liveNewWhereHTML(d) {
  const L = LIVE.local || {};
  const localOk = liveLocalReady();
  const remotes = LIVE.contexts.filter((c) => !liveIsLocal(c.name));
  const onLocal = !!d.where && liveIsLocal(d.where);
  if (d.from) {
    return `<div class="radio-list"><div class="radio-card info is-on" id="live-where-fixed"><span class="rc-icon" aria-hidden="true">${icon(onLocal ? 'laptop' : 'cloud')}</span>
      <span class="rc-main"><span class="rc-title">${onLocal ? 'On this computer' : esc(d.where)}</span><span class="rc-desc">A follow-up runs where its session is, so it can reuse the workspace and network rules.</span></span></div></div>`;
  }
  const localDesc = localOk ? `In a gVisor sandbox on <span class="mono">${esc(L.context)}</span>. Starts in seconds, and costs nothing in the cloud.`
    : L.state === 'Stopped' ? 'AX on this computer is stopped.' : "AX isn't set up on this computer yet.";
  const remoteRight = !onLocal && d.where ? esc(d.where) : remotes.length ? plural(remotes.length, 'cluster') : 'None in your kubeconfig';
  const hint = !localOk && !remotes.length ? `<p class="hint" style="margin-top:8px"><a href="#/places">Set up AX on this computer</a>, or add a cluster to your kubeconfig.</p>`
    : !localOk ? `<p class="hint" style="margin-top:8px"><a href="#/places">${L.state === 'Stopped' ? 'Start' : 'Set up'} AX on this computer</a> to run here.</p>`
      : !remotes.length ? '<p class="hint" style="margin-top:8px">Add a remote cluster to your kubeconfig and it shows up here.</p>' : '';
  return `<div class="radio-list" role="radiogroup" aria-labelledby="live-step-where">
      <button type="button" class="radio-card" role="radio" aria-checked="${onLocal}" ${localOk ? '' : 'aria-disabled="true"'} data-action="live-new-where" data-where="local" id="live-where-local">
        <span class="rc-dot"></span><span class="rc-main"><span class="rc-title">On this computer</span><span class="rc-desc">${localDesc}</span></span><span class="rc-right">${localOk ? 'Best to start' : L.state === 'Stopped' ? 'Stopped' : 'Not set up'}</span></button>
      <button type="button" class="radio-card" role="radio" aria-checked="${!onLocal && !!d.where}" ${remotes.length ? '' : 'aria-disabled="true"'} data-action="live-new-where" data-where="remote" id="live-where-remote">
        <span class="rc-dot"></span><span class="rc-main"><span class="rc-title">On a remote cluster</span><span class="rc-desc">On a shared GKE or Kubernetes cluster from your kubeconfig. It keeps running when your laptop closes.</span></span><span class="rc-right">${remoteRight}</span></button>
    </div>
    ${!onLocal && d.where && remotes.length > 1 ? `<div class="pills where-pills" role="group" aria-label="Which remote cluster">${remotes.map((c) => `<button type="button" class="pill mono" aria-pressed="${d.where === c.name}" data-action="live-new-cluster" data-context="${esc(c.name)}">${esc(c.name)}</button>`).join('')}</div>` : ''}
    ${hint}`;
}

/* ---------- 3 · Set up the workspace ---------- */
/* The workspaces on the cluster a new task runs on. The cluster in use shares Home's list; another is read here. */
LIVE.newWs = {};
function liveNewWorkspaces(ctx) {
  if (!ctx) return null;
  if (ctx === LIVE.context && typeof liveResWanted === 'function') {
    liveResWanted();
    return { at: liveResFresh() ? LIVE.res.at : 0, list: LIVE.res.workspaces || [], error: LIVE.res.ctx === ctx ? LIVE.res.error : '', loading: LIVE.res.loading };
  }
  const c = (LIVE.newWs[ctx] = LIVE.newWs[ctx] || { at: 0, list: [], error: '', loading: false });
  if (!c.loading && Date.now() - c.at > 20000) {
    c.loading = true;
    studioGet('/api/workspaces' + studioQuery({ context: ctx, atespace: LIVE.atespace }))
      .then((r) => { c.list = r.workspaces || []; c.error = ''; })
      .catch((e) => { c.error = e.message; })
      .finally(() => { c.loading = false; c.at = Date.now(); const box = $('#live-ws-existing'); if (box && LIVE.draft) box.innerHTML = liveNewExistingHTML(LIVE.draft); });
  }
  return c;
}
function liveNewWsDoc(d, name) {
  const c = name && liveNewWorkspaces(d.where);
  return c ? (c.list || []).find((w) => w.metadata && w.metadata.name === name) || null : null;
}
const LIVE_WS_LOOK = { Ready: ['checkCircle', ''], Preparing: ['loader', 'Setting up'], Failed: ['xCircle', 'Setup failed'] };
/** The workspaces you can start from, as pills, with what the one you picked says. */
function liveNewExistingHTML(d) {
  const c = liveNewWorkspaces(d.where);
  const where = !d.where ? 'the cluster' : liveIsLocal(d.where) ? 'this computer' : liveShortCtx(d.where);
  if (!c || (!c.at && (c.loading || !c.error))) return `<span class="prow-hint">${icon('loader', 'xs')} Reading the workspaces on ${esc(where)}…</span>`;
  if (c.error && !(c.list || []).length) return `<span class="prow-hint" style="color:var(--wait)">Couldn't read the workspaces on ${esc(where)}: ${esc(c.error)}</span>`;
  const list = (c.list || []).slice().sort((a, b) => a.metadata.name.localeCompare(b.metadata.name));
  if (!list.length) return `<span class="prow-hint">There are no workspaces on ${esc(where)} yet. Clone from Git to make one.</span>`;
  const pick = liveNewWsDoc(d, d.existing);
  const st = (pick && pick.status) || {};
  const note = !pick ? 'A task that uses a workspace starts from its snapshot: the repos, files and setup it already has.'
    : st.phase === 'Failed' ? `Its setup failed${st.lastSetupError ? `: ${esc(st.lastSetupError)}` : ''}. A task that uses it fails too.`
      : st.phase === 'Preparing' ? 'Its setup is still running. The task starts once it is ready.'
        : 'The task starts from its snapshot: the repos, files and setup it already has.';
  return `<div class="pills" role="group" aria-label="Workspaces on ${esc(where)}">${list.map((w) => {
    const ph = LIVE_WS_LOOK[(w.status || {}).phase] || ['folder', ''];
    return `<button type="button" class="pill mono" aria-pressed="${d.existing === w.metadata.name}" data-action="live-new-ws-pick" data-ws="${esc(w.metadata.name)}" ${ph[1] ? `title="${esc(ph[1])}"` : ''}>${icon(ph[0], 'xs')}${esc(w.metadata.name)}</button>`;
  }).join('')}</div><span class="prow-hint" ${st.phase === 'Failed' ? 'style="color:var(--fail)"' : ''}>${note}</span>`;
}
function liveRecentPillsHTML(d, recent) {
  return recent.length ? `<span class="gh-label">Recent</span>${recent.map((r) => `<button type="button" class="pill mono" aria-pressed="${d.repo.trim() === r}" data-action="live-new-repo-pick" data-repo="${esc(r)}" title="${esc(r)}">${esc(liveRepoShort(r))}</button>`).join('')}` : '';
}
function liveBranchPillsHTML(d) {
  return LIVE_BRANCH_PICKS.map((b) => `<button type="button" class="pill mono" aria-pressed="${d.branch.trim() === b}" data-action="live-new-branch-pick" data-branch="${b}">${b}</button>`).join('');
}
function liveNewDebugRow(d) {
  return prow('Debug access', `<label class="toggle-line"><span class="tl-text"><b>Let Studio look inside the sandbox</b><span>Shows the files it changed and hasn't pushed, and opens a shell with <span class="mono">ax ssh</span>. Off keeps the sandbox closed: you review its result and what it pushes.</span></span>
      <span class="switch"><input type="checkbox" role="switch" id="live-new-debug" data-action="live-new-debug" ${d.debug ? 'checked' : ''} aria-label="Debug access"><span class="track"></span><span class="thumb"></span></span></label>
      ${!d.from && !d.debugTouched && d.where ? `<span class="prow-hint">${liveIsLocal(d.where) ? 'On by default on this computer.' : 'Off by default on a shared cluster.'}</span>` : ''}`);
}
const LIVE_SETUP_PICKS = ['npm ci', 'pip install -r requirements.txt', 'go mod download', 'uv sync'];
function liveWsMoreSum(d) {
  const x = liveSetupExtras(d);
  if (!x.any) return 'More repos, setup commands, files and MCP servers';
  return [
    x.repos.length && plural(x.repos.length, 'extra repo'),
    x.setup.length && plural(x.setup.length, 'setup command'),
    x.files.length && plural(x.files.length, 'file'),
    x.mcp.length && `${x.mcp.length} MCP ${x.mcp.length === 1 ? 'server' : 'servers'}`,
  ].filter(Boolean).join(' · ');
}
/** The workspace's own setup: more repos, setup commands, files and MCP servers. Only for a workspace this task makes. */
function liveNewSetupMoreHTML(d) {
  const open = d.wsOpen === null ? liveSetupExtras(d).any : !!d.wsOpen;
  const files = (d.files || []).map((f, i) => `<div class="file-row" data-row="file">
      <div class="fr-head"><input class="input mono" type="text" data-live-new-file="${i}" data-k="path" value="${esc(f.path)}" placeholder="AGENTS.md" aria-label="File ${i + 1}: path in /workspace" autocomplete="off" spellcheck="false">
        <button type="button" class="btn ghost sm icon" data-action="live-new-file-del" data-i="${i}" aria-label="Remove file ${i + 1}">${icon('x', 'sm')}</button></div>
      <textarea class="textarea mono" rows="3" data-live-new-file="${i}" data-k="content" placeholder="What the file says" aria-label="File ${i + 1}: content" spellcheck="false">${esc(f.content)}</textarea></div>`).join('');
  const mcp = (d.mcp || []).map((m, i) => `<div class="kv-row kv-2" data-row="mcp">
      <input class="input mono" type="text" data-live-new-mcp="${i}" data-k="name" value="${esc(m.name)}" placeholder="github" aria-label="MCP server ${i + 1}: name" autocomplete="off" spellcheck="false">
      <input class="input mono" type="url" data-live-new-mcp="${i}" data-k="endpoint" value="${esc(m.endpoint)}" placeholder="https://mcp.example.com/sse" aria-label="MCP server ${i + 1}: address" autocomplete="off" spellcheck="false">
      <button type="button" class="btn ghost sm icon" data-action="live-new-mcp-del" data-i="${i}" aria-label="Remove MCP server ${i + 1}">${icon('x', 'sm')}</button></div>`).join('');
  const rows = [
    prow('More repos', `<textarea class="textarea mono" id="live-new-repos" data-live-new="repos" rows="2" placeholder="https://github.com/you/shared-lib.git" aria-labelledby="live-repos-label" spellcheck="false">${esc(d.repos)}</textarea>
      <span class="prow-hint">One <span class="mono">https://</span> Git address per line, cloned into its own folder.</span>`, { labelId: 'live-repos-label', sub: 'Extra code for context' }),
    prow('Setup commands', `<textarea class="textarea mono" id="live-new-setup" data-live-new="setup" rows="2" placeholder="npm ci" aria-labelledby="live-setup-label" spellcheck="false">${esc(d.setup)}</textarea>
      <div class="pills" role="group" aria-label="Common setup commands">${LIVE_SETUP_PICKS.map((c) => `<button type="button" class="pill mono" data-action="live-new-setup-pick" data-cmd="${esc(c)}" aria-pressed="${liveLines(d.setup).includes(c)}">${icon('plus', 'xs')}${esc(c)}</button>`).join('')}</div>
      <span class="prow-hint">Run once before the task starts, and kept in the snapshot.</span>`, { labelId: 'live-setup-label', sub: 'Dependencies and build' }),
    prow('Files', `<div class="files" id="live-new-files">${files}
      <div class="btn-row"><button type="button" class="btn ghost sm" data-action="live-new-file-add">${icon('plus', 'sm')}Add a file</button>${(d.files || []).some((f) => f.path === 'AGENTS.md') ? '' : '<button type="button" class="pill mono" data-action="live-new-file-add" data-path="AGENTS.md">AGENTS.md</button>'}</div></div>`, { sub: 'Written into /workspace' }),
    prow('MCP servers', `<div class="mcp-rows" id="live-new-mcp">${mcp}
      <div class="btn-row"><button type="button" class="btn ghost sm" data-action="live-new-mcp-add">${icon('plus', 'sm')}Add an MCP server</button></div></div>
      <span class="prow-hint">Each server's host is added to what the task can reach.</span>`, { sub: 'Tools the agent can call' }),
  ].join('');
  return `<details class="panel-more" id="live-ws-more" ${open ? 'open' : ''}>
    <summary>${icon('chevRight', 'sm chev')}<b>Customize workspace</b><span id="live-ws-more-sum">${esc(liveWsMoreSum(d))}</span></summary>
    <div class="panel-more-body">${rows}</div>
  </details>`;
}
function liveNewWorkspaceHTML(d) {
  if (d.workspace) {
    return `<div class="panel ws-panel">
      ${prow('Workspace', `<div class="prow-text"><b>It uses the workspace <span class="mono">${esc(d.workspace)}</span> from the last turn.</b><span>It starts from that workspace's snapshot and the Git refs the last turn pushed.</span></div>`)}
      ${liveNewDebugRow(d)}</div>`;
  }
  const recent = liveRecentRepos();
  const code = `<div class="seg" role="radiogroup" aria-labelledby="live-code-label">
      <button type="button" role="radio" aria-checked="${d.source === 'git'}" data-action="live-new-source" data-source="git">Clone from Git</button>
      <button type="button" role="radio" aria-checked="${d.source === 'existing'}" data-action="live-new-source" data-source="existing">An existing workspace</button>
      <button type="button" role="radio" aria-checked="${d.source === 'empty'}" data-action="live-new-source" data-source="empty">Empty workspace</button></div>
    ${d.source === 'existing' ? `<div id="live-ws-existing" class="stretch">${liveNewExistingHTML(d)}</div>` : d.source === 'git'
      ? `<input class="input mono" type="url" id="live-new-repo" data-live-new="repo" value="${esc(d.repo)}" placeholder="https://github.com/you/project.git" aria-label="Git repo" autocomplete="off" spellcheck="false">
        <div class="pills" id="live-recent" role="group" aria-label="Recent repos" ${recent.length ? '' : 'hidden'}>${liveRecentPillsHTML(d, recent)}</div>
        <span class="prow-hint">AX clones it into <span class="mono">/workspace</span> when the task starts. Starting from a folder on this computer isn't possible yet.</span>`
      : `<span class="prow-hint">The agent starts in an empty <span class="mono">/workspace</span>. Good for tasks that don't need code.</span>`}`;
  const branch = d.source === 'git' ? prow('Branch', `<div class="prow-inline"><input class="input mono branch-input" type="text" id="live-new-branch" data-live-new="branch" value="${esc(d.branch)}" placeholder="Default branch" aria-labelledby="live-branch-label" autocomplete="off" spellcheck="false">
      <div class="pills" id="live-branch-picks" role="group" aria-label="Common branches">${liveBranchPillsHTML(d)}</div></div>
      <span class="prow-hint">Leave it empty for the repo's default branch.</span>`, { labelId: 'live-branch-label', sub: 'Where the agent starts' }) : '';
  return `<div class="panel ws-panel">
      ${prow('Code', code, { labelId: 'live-code-label' })}
      ${branch}
      ${liveNewDebugRow(d)}
      ${d.source !== 'existing' ? liveNewSetupMoreHTML(d) : ''}
    </div>`;
}

/* ---------- 4 · Describe the goal ---------- */
function liveGoalHelpHTML(d) {
  const g = (d.goal || '').trim();
  const sugs = typeof SUGGESTIONS !== 'undefined' ? SUGGESTIONS : ['Fix the failing tests', 'Validate the signup form', 'Document the public API', 'Fix accessibility issues'];
  const tips = typeof GOAL_TIPS !== 'undefined' ? GOAL_TIPS : [];
  if (!g) return `<span class="gh-label">Try</span>${sugs.map((s) => `<button type="button" class="pill" data-action="live-new-suggest" data-text="${esc(s)}">${esc(s)}</button>`).join('')}`;
  const missing = tips.filter((t) => !t.test.test(g));
  if (!missing.length) return `<span class="gh-ok">${icon('checkCircle', 'sm')}Clear goal. The agent plans from this.</span>`;
  return `<span class="gh-label">Make it clearer</span>${missing.map((t) => `<button type="button" class="pill gh-add" data-action="live-new-tip" data-tip="${t.id}">${icon('plus', 'xs')}${esc(t.label)}</button>`).join('')}`;
}
function liveNewGoalHTML(d) {
  return `<div class="goal"><textarea id="live-new-goal" data-live-new="goal" aria-labelledby="live-step-goal" aria-describedby="live-new-goal-keys" placeholder="${d.from ? 'What should it do next?' : 'e.g. Fix the flaky tests in tests/ and explain the cause. Done when: they pass 10 runs in a row.'}">${esc(d.goal)}</textarea>
      <div class="goal-foot"><span class="xsmall muted" id="live-new-goal-keys"><kbd>${MOD}</kbd> <kbd>↵</kbd> to run</span></div></div>
    <div class="pills goal-help" id="live-goal-help" role="group" aria-label="Help with your goal">${liveGoalHelpHTML(d)}</div>`;
}

/* ---------- More options ---------- */
function liveNewSizeHint(d) {
  const k = liveDraftSize(d);
  if (k !== 'custom') return LIVE_SIZES[k].hint;
  const l = liveDraftLimits(d);
  return `${l.cpu || '?'} CPU · ${l.memory || '?'} memory`;
}
function liveNewMoreHTML(d) {
  const A = LIVE_AGENTS[d.agent];
  const size = liveDraftSize(d);
  const net = d.gateway
    ? `<div class="prow-text"><b>It uses the network rules <span class="mono">${esc(d.gateway)}</span> from the last turn.</b><span>A follow-up keeps what its session could reach.</span></div>`
    : `<div class="prow-inline"><div class="seg" role="radiogroup" aria-labelledby="live-net-label">
        <button type="button" role="radio" aria-checked="${d.network === 'balanced'}" data-action="live-new-network" data-network="balanced">Balanced</button>
        <button type="button" role="radio" aria-checked="${d.network === 'locked'}" data-action="live-new-network" data-network="locked">Locked down</button></div></div>
      <span class="prow-hint" id="live-new-net-note">${d.network === 'balanced'
        ? `It can reach ${A ? 'its model, ' : ''}your repos' hosts, GitHub, PyPI and npm. Nothing else.`
        : `It can reach ${A ? 'its model and ' : 'only '}your repos' hosts. Nothing else.`}</span>`;
  const sizes = Object.keys(LIVE_SIZES).map((k) => `<button type="button" role="radio" aria-checked="${size === k}" data-action="live-new-size" data-size="${k}">${LIVE_SIZES[k].label}</button>`).join('')
    + `<button type="button" role="radio" aria-checked="${size === 'custom'}" data-action="live-new-size" data-size="custom">Custom</button>`;
  const custom = size === 'custom' ? `<div class="prow-inline size-custom">
      <label class="small">CPU <input class="input mono" type="text" id="live-new-cpu" data-live-new="cpu" value="${esc(d.cpu)}" placeholder="2" autocomplete="off" spellcheck="false"></label>
      <label class="small">Memory <input class="input mono" type="text" id="live-new-memory" data-live-new="memory" value="${esc(d.memory)}" placeholder="4Gi" autocomplete="off" spellcheck="false"></label></div>` : '';
  const file = `<pre class="manifest" id="live-new-manifest" tabindex="0" aria-label="The task's files">${esc(liveNewYAML(d, 'text', ''))}</pre>
      <div class="btn-row"><button type="button" class="btn ghost sm" data-action="live-new-raw">${icon('code', 'sm')}Edit the task's files</button>
        <button type="button" class="btn ghost sm" data-action="live-new-download">${icon('download', 'sm')}Download</button>
        <button type="button" class="btn ghost sm" data-action="live-new-load">${icon('upload', 'sm')}Load a task file…</button></div>`;
  return `<details class="step-block more-block" id="live-new-more" ${d.moreOpen ? 'open' : ''}>
      <summary>${icon('chevRight', 'sm chev')}<span>More options: network, resources, command, environment, task file</span></summary>
      <div class="panel more-panel">
        ${prow('Network', net, { labelId: 'live-net-label', sub: 'What it can reach' })}
        ${prow('Resources', `<div class="seg" role="radiogroup" aria-labelledby="live-size-label">${sizes}</div>${custom}`, { labelId: 'live-size-label', sub: liveNewSizeHint(d), subId: 'live-size-hint' })}
        ${prow('Command', `<input class="input mono" type="text" id="live-new-command" data-live-new="command" value="${esc(d.command)}" placeholder="${A ? "The template's agent" : "The image's own command"}" aria-labelledby="live-command-label" autocomplete="off" spellcheck="false">
          <span class="prow-hint">${A ? "Leave it empty to run the template's agent." : "Leave it empty to run the image's own command."} Quotes keep spaces, as in a shell.</span>`, { labelId: 'live-command-label', sub: 'What runs in the sandbox' })}
        ${prow('Environment', `<textarea class="textarea mono" id="live-new-env" data-live-new="envText" rows="2" placeholder="NAME=value, one per line" aria-labelledby="live-env-label" spellcheck="false">${esc(d.envText)}</textarea>
          <span class="prow-hint">${icon('lock', 'xs')} Not for keys or passwords: they're stored in plain text. Keys go through the Gateway.</span>`, { labelId: 'live-env-label', sub: 'Variables the command sees' })}
        ${prow('Name', `<input class="input mono" type="text" id="live-new-name" data-live-new="name" value="${esc(liveDraftName(d))}" aria-labelledby="live-name-label" autocomplete="off" spellcheck="false"><span class="prow-hint">Lowercase letters, digits and hyphens. It's made from the goal until you change it.</span>`, { labelId: 'live-name-label', sub: 'How AX names it' })}
        ${prow('Task file', file, { sub: 'What ax apply gets' })}
        ${prow('Command line', `<div class="stretch live-cli-wrap live-cli-stack" id="live-new-cli">${liveNewCliHTML(d)}</div>`, { sub: 'The same from a terminal' })}
      </div>
    </details>`;
}
function liveNewCliHTML(d) { return `${cliHint(liveCmdAt(d.where, ['apply', '-f', 'task.yaml']))}${cliHint(liveCmdAt(d.where, ['resume', 'task', liveDraftName(d)]))}`; }

/* ---------- The run plan ---------- */
function liveAllowedHosts(d) {
  const A = LIVE_AGENTS[d.agent];
  const hosts = [];
  const add = (h) => { if (h && !hosts.includes(h)) hosts.push(h); };
  if (A) add(A.host);
  if (!d.workspace && d.source === 'git') add(liveRepoHost(d.repo));
  if (!d.workspace && d.source !== 'existing') {
    const x = liveSetupExtras(d);
    x.repos.forEach((r) => add(liveRepoHost(r)));
    x.mcp.forEach((m) => add(liveRepoHost(String(m.endpoint || '').trim())));
  }
  if (d.network === 'balanced') LIVE_BALANCED_HOSTS.forEach(add);
  return hosts;
}
function liveNewGateMapHTML(d) {
  if (typeof gateMap !== 'function') return '';
  const kicker = (t) => `<div class="pc-kicker">${t}</div>`;
  if (d.gateway) return `${kicker('What it can reach')}<p class="xsmall muted">The network rules <span class="mono">${esc(d.gateway)}</span> from the last turn.</p>`;
  const hosts = liveAllowedHosts(d);
  if (!hosts.length) return `${kicker('What it can reach')}<p class="xsmall muted">No Gateway, so no network access.</p>`;
  return `${kicker(`What it can reach · ${d.network === 'balanced' ? 'Balanced' : 'Locked down'}`)}${gateMap(hosts, [], 4)}`;
}
/** Which of the four steps are done: template, where, workspace, goal. */
function liveNewStepStates(d) {
  const A = LIVE_AGENTS[d.agent];
  const agentOk = A ? true : (d.from ? (!d.image.trim() || LIVE_DIGEST_RE.test(d.image.trim())) : LIVE_DIGEST_RE.test(d.image.trim()));
  const whereOk = !!d.where && (!liveIsLocal(d.where) || liveLocalReady());
  const wsOk = !!d.workspace || d.source === 'empty' || (d.source === 'existing' ? !!d.existing : !!liveRepoHost(d.repo.trim()));
  const goalOk = A ? !!d.goal.trim() : (!!d.goal.trim() || agentOk);
  return [agentOk, whereOk, wsOk, goalOk];
}
function liveReadyItems(d) {
  const A = LIVE_AGENTS[d.agent];
  const [agentOk, whereOk, wsOk, goalOk] = liveNewStepStates(d);
  const L = LIVE.local || {};
  const repo = d.repo.trim();
  const line = (s) => { const first = s.split('\n')[0]; return esc(first.slice(0, 48)) + (first.length > 48 ? '…' : ''); };
  return [
    { ok: agentOk, todo: 'give the image address', t: A ? `${A.name} · <span class="mono">${esc(A.model)}</span>` : 'Your own image',
      s: A ? (d.key.trim() ? 'The key is stored on the cluster when you run' : 'Its key is added outside the sandbox') : (d.image.trim() ? esc(liveImageShort(d.image.trim())) : 'An image address with @sha256:…') },
    { ok: whereOk, todo: liveIsLocal(d.where) ? 'start AX on this computer' : 'choose where it runs',
      t: !d.where ? 'Where it runs' : liveIsLocal(d.where) ? 'On this computer' : `On ${esc(d.where)}`,
      s: !d.where ? 'Set up AX, or add a cluster' : liveIsLocal(d.where) ? (whereOk ? 'gVisor sandbox · starts in seconds' : L.state === 'Stopped' ? 'AX is stopped here' : "AX isn't set up here") : 'A remote cluster from your kubeconfig' },
    { ok: wsOk, todo: d.source === 'existing' ? 'pick a workspace' : 'add a Git repo, or choose Empty workspace', t: d.workspace ? 'Workspace from the last turn' : d.source === 'existing' ? 'An existing workspace' : d.source === 'git' ? 'Git repo' : 'Empty workspace',
      s: d.workspace ? esc(d.workspace) : d.source === 'existing' ? (d.existing ? `<span class="mono">${esc(d.existing)}</span>` : 'One already on the cluster')
        : d.source === 'git' ? (liveRepoHost(repo) ? `${esc(liveRepoShort(repo))}${d.branch.trim() ? ` · ${esc(d.branch.trim())}` : ''}` : 'An https:// Git address') : 'An empty /workspace' },
    { ok: goalOk, todo: 'describe the goal', t: 'Goal', s: d.goal.trim() ? line(d.goal.trim()) : 'The outcome you want' },
  ];
}
function liveReadyListHTML(d) {
  return liveReadyItems(d).map((c) => `<li class="${c.ok ? 'ok' : 'todo'}"><span class="rb">${c.ok ? icon('check') : ''}</span><span><span class="rt">${c.t}</span><span class="rs">${c.s}</span></span></li>`).join('');
}
function livePlanHeadHTML(d) {
  const items = liveReadyItems(d);
  const n = items.filter((c) => c.ok).length;
  const issues = liveNewIssues(d);
  const ready = !issues.length;
  const sub = ready ? (liveIsLocal(d.where) ? 'Runs on this computer, in a gVisor sandbox.' : `Runs on ${esc(d.where)}.`)
    : n < items.length ? `${n} of ${items.length} done · next: ${esc(items.find((c) => !c.ok).todo)}` : esc(issues[0]);
  return `${axo(ready ? 'wave' : 'thinking', { decorative: true }).replace('<svg ', '<svg data-follow ')}<div><div class="h-display-sm">${ready ? (d.from ? 'Ready to send' : 'Ready to run') : 'Almost ready'}</div><div class="small muted">${sub}</div></div>`;
}

/* ---------- The page ---------- */
function liveViewNew() {
  const from = parseRoute().q.get('from') || '';
  const again = !!from && parseRoute().q.get('again') === '1';
  if (!LIVE.draft || LIVE.draft.from !== from || (again && !LIVE.draft.again)) LIVE.draft = liveNewDraft(from, again);
  const d = LIVE.draft;
  /* The clusters arrived after the draft was made, or the one it picked is gone: pick again. */
  liveNewRepick(d);
  d.envSig = liveNewEnvSig();
  const busy = !!d.busy;
  const ok = liveNewStepStates(d);
  const stepN = (k) => `<span class="n${ok[k - 1] ? ' ok' : ''}" id="sn-${k}" aria-hidden="true">${ok[k - 1] ? icon('check') : k}</span>`;
  const follow = d.from ? `<div class="callout" style="margin-top:14px" id="live-new-follow">${icon('message')}<div><strong>Following up on <span class="mono">${esc(d.from)}</span>.</strong> This starts a new task in the same session. It starts from the workspace's snapshot and the Git refs that were pushed. Files the last turn left unpushed don't carry over.</div></div>` : '';
  let body;
  if (d.raw) {
    body = `<section class="step-block first" aria-labelledby="live-new-file"><div class="step-head"><h2 id="live-new-file">The task's files</h2><span class="muted">This is what <code>ax apply</code> gets.</span></div>
        <textarea class="textarea mono" id="live-new-yaml" data-live-new="yaml" rows="24" spellcheck="false" aria-label="The task's files, as YAML">${esc(d.yaml)}</textarea>
        <div class="btn-row" style="margin-top:10px"><button class="btn ghost sm" data-action="live-new-form">${icon('undo', 'sm')}Back to the form</button>
          <button type="button" class="btn ghost sm" data-action="live-new-download">${icon('download', 'sm')}Download</button>
          <button type="button" class="btn ghost sm" data-action="live-new-load">${icon('upload', 'sm')}Load a task file…</button></div></section>`;
  } else {
    body = `
      <section class="step-block first" aria-labelledby="live-step-agent">
        <div class="step-head">${stepN(1)}<h2 id="live-step-agent">Pick a template</h2><span class="muted">${d.from ? 'The last turn used this one.' : 'Each brings its agent and model.'}</span></div>
        ${liveNewAgentHTML(d)}</section>
      <section class="step-block" aria-labelledby="live-step-where">
        <div class="step-head">${stepN(2)}<h2 id="live-step-where">${d.from ? 'Where it runs' : 'Where should it run?'}</h2><span class="muted">${d.from ? 'Where its session is.' : 'Same task file and network rules either way.'}</span></div>
        <div id="live-where-body">${liveNewWhereHTML(d)}</div></section>
      <section class="step-block" aria-labelledby="live-step-ws" id="live-ws-step">
        <div class="step-head">${stepN(3)}<h2 id="live-step-ws">Set up the workspace</h2><span class="muted">What the agent starts with in <span class="mono">/workspace</span>.</span></div>
        ${liveNewWorkspaceHTML(d)}</section>
      <section class="step-block" aria-labelledby="live-step-goal">
        <div class="step-head">${stepN(4)}<h2 id="live-step-goal">Describe the goal</h2><span class="muted">The agent plans from this.</span></div>
        ${liveNewGoalHTML(d)}</section>
      ${liveNewMoreHTML(d)}`;
  }
  const side = `
    <aside class="card plan-card" aria-label="Run plan" id="live-plan-card">
      <div class="pc-head" id="plan-head">${livePlanHeadHTML(d)}</div>
      <ul class="ready-list" id="live-ready-list" aria-label="Checklist">${liveReadyListHTML(d)}</ul>
      <div id="live-new-error">${d.error ? `<div class="callout warn" role="alert" style="margin-top:12px">${icon('alert')}<div style="overflow-wrap:anywhere">${esc(d.error)}</div></div>` : ''}</div>
      <button class="btn primary lg" id="live-new-run" data-action="live-new-run" ${busy ? 'disabled' : ''}>${busy ? `${icon('loader', 'sm')}${esc(d.busy)}` : `${d.again ? 'Try again' : d.from ? 'Send follow-up' : 'Run task'}<span class="kbd-hint">${MOD}↵</span>`}</button>
      <div class="pc-reach" id="live-new-gatemap">${liveNewGateMapHTML(d)}</div>
    </aside>`;
  const title = d.again ? 'Try again' : d.from ? 'Send a follow-up' : 'Start a task';
  const html = `
    <div class="new-head"><div><h1 tabindex="-1">${title}</h1>
      <p class="lede">${d.again ? 'A new turn in the same session, starting from the same goal. Change what made it fail first, like its size under More options.'
        : d.from ? 'The agent picks up the same session with a new goal, on the same workspace and network rules.' : 'The agent works in its own gVisor sandbox, and you review what it changed before it reaches your code.'}</p></div></div>
    ${follow}
    <div class="new-grid">
      <div style="min-width:0">${body}</div>
      ${side}
    </div>`;
  return { title, crumbs: [{ label: 'Home', href: '#/' }, ...(d.from ? [{ label: d.from, href: `#/task/${encodeURIComponent(d.from)}` }] : []), { label: d.again ? 'Try again' : d.from ? 'Follow-up' : 'New task' }], html, wide: true };
}
/** Redraws the parts that depend on what you typed, without redrawing the form under the cursor. */
function liveNewRefreshParts(d, k) {
  const nameBox = $('#live-new-name');
  if (nameBox && k !== 'name' && !d.nameEdited) nameBox.value = liveDraftName(d);
  if (d.error) { d.error = ''; const err = $('#live-new-error'); if (err) err.innerHTML = ''; }
  liveNewStepStates(d).forEach((ok, idx) => {
    const n = $('#sn-' + (idx + 1));
    if (n) { n.innerHTML = ok ? icon('check') : String(idx + 1); if (n.classList) n.classList.toggle('ok', ok); }
  });
  const rl = $('#live-ready-list'); if (rl) rl.innerHTML = liveReadyListHTML(d);
  if (k === 'goal') { const gh = $('#live-goal-help'); if (gh) gh.innerHTML = liveGoalHelpHTML(d); }
  if (k === 'repo' || k === 'repos' || k === 'mcp') {
    const gm = $('#live-new-gatemap'); if (gm) gm.innerHTML = liveNewGateMapHTML(d);
    const rp = $('#live-recent'); if (rp) rp.innerHTML = liveRecentPillsHTML(d, liveRecentRepos());
  }
  if (k === 'repos' || k === 'setup' || k === 'files' || k === 'mcp') {
    const ws = $('#live-ws-more-sum'); if (ws) ws.textContent = liveWsMoreSum(d);
  }
  if (k === 'branch') { const bp = $('#live-branch-picks'); if (bp) bp.innerHTML = liveBranchPillsHTML(d); }
  if (k === 'cpu' || k === 'memory') { const sh = $('#live-size-hint'); if (sh) sh.textContent = liveNewSizeHint(d); }
  const mf = $('#live-new-manifest'); if (mf) mf.innerHTML = esc(liveNewYAML(d, 'text', ''));
  const cli = $('#live-new-cli'); if (cli) cli.innerHTML = liveNewCliHTML(d);
  const ph = $('#plan-head');
  if (ph) {
    const oldAx = ph.querySelector ? ph.querySelector('svg.axo') : null;
    ph.innerHTML = livePlanHeadHTML(d);
    if (oldAx && typeof keepAxel === 'function') keepAxel(oldAx, ph);
  }
}
function liveNewTyped(el) {
  const d = LIVE.draft;
  const k = el.dataset.liveNew;
  if (!d || !k) return;
  if (k === 'name') { d.name = el.value; d.nameEdited = true; } else d[k] = el.value;
  liveNewRefreshParts(d, k);
}
/** The cluster side changed while you were typing: redraw where it runs and the plan, and leave the field you are in. */
function liveNewEnvRefresh(d) {
  liveNewRepick(d);
  d.envSig = liveNewEnvSig();
  const w = $('#live-where-body'); if (w) w.innerHTML = liveNewWhereHTML(d);
  const dbg = $('#live-new-debug'); if (dbg) dbg.checked = !!d.debug;
  const gm = $('#live-new-gatemap'); if (gm) gm.innerHTML = liveNewGateMapHTML(d);
  liveNewRefreshParts(d, '');
}

/* ---------- Running on another cluster ----------
   `ax promote` when this ax has it: check first (--preflight-only), then send. Not every ax has it yet, so when it's
   missing Studio sends the task itself (POST /api/tasks/move): it copies the task, and the workspace and Gateway it
   binds when that cluster lacks them, through the AX API, and can copy the sandbox's /workspace across too. Either
   way you choose the cluster and atespace, whether it starts there, and what happens to the original. */
LIVE.promoteMissing = false;  // this ax answered "unknown command: promote"
function livePromoteArgs(p, preflight) {
  const ns = (STUDIO.info && STUDIO.info.axNamespace) || 'ax-system';
  const args = ['promote', 'task', p.name, '--to', p.to, '--to-namespace', ns];
  if (p.toAtespace && p.toAtespace !== LIVE.atespace) args.push('--to-atespace', p.toAtespace);
  if (p.replace) args.push('--replace');
  if (p.original === 'suspend') args.push('--suspend-source');
  if (!p.start) args.push('--no-resume');
  if (preflight) args.push('--preflight-only');
  return args;
}
/** One line of what `ax promote` prints ("task.ax.io/fix-tests created (preflight only)"), in the UI's words.
    A line this doesn't know stays as ax printed it. */
function livePromoteLine(line) {
  const m = /^(gateway|workspace|task)\.ax\.io\/(\S+) (created|reused|unchanged|replaced|resumed|suspended on the source)(?: \(preflight only\))?$/.exec(line.trim());
  if (!m) return esc(line);
  const n = `<span class="mono">${esc(m[2])}</span>`;
  const [what, there] = { gateway: ['Gateway', 'that is already there'], workspace: ['workspace', 'that is already there'], task: ['task', 'that is already there'] }[m[1]];
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
  return liveKeysNote(secrets);
}
function liveKeysNote(secrets) {
  return `That cluster needs its own copy of ${secrets.length === 1 ? 'the key' : 'the keys'} ${secrets.map((x) => `<span class="mono">${esc(x)}</span>`).join(', ')}. Keys aren't copied.`;
}
/** What Studio's own move will do, from its dry run, in the same words as ax promote's check. */
function liveMovePlanLines(p, plan) {
  const out = (plan.items || []).map((it) => {
    const what = it.kind === 'gateway' ? 'Gateway' : it.kind;
    const n = `<span class="mono">${esc(it.name)}</span>`;
    return it.action === 'reuse' ? `Uses the ${what} ${n} that is already there` : it.action === 'replace' ? `Deletes the ${what} ${n} that is already there, then creates it again` : `Creates the ${what} ${n} there`;
  });
  if (p.copyFiles) out.push(`Starts both copies, copies <span class="mono">${esc(plan.path || '/workspace')}</span> across, and restarts the copy on those files`);
  else if (p.start) out.push(`Starts <span class="mono">${esc(p.name)}</span> there`);
  if (p.original === 'suspend') out.push(`Pauses <span class="mono">${esc(p.name)}</span> on this cluster`);
  if (p.original === 'delete') out.push(`Deletes <span class="mono">${esc(p.name)}</span> on this cluster once the copy is there`);
  return out;
}
function liveOpenPromote(name) {
  const targets = LIVE.contexts;
  const row = LIVE.tasks.find((t) => t.name === name);
  const debug = !!(row ? row.debug : (LIVE.detail[name] && LIVE.detail[name].doc && LIVE.detail[name].doc.spec && LIVE.detail[name].doc.spec.debug));
  const others = targets.filter((c) => c.name !== LIVE.context);
  /* Start on a cluster a check found AX on, else one that didn't fail its check, else the first other one. */
  const chk = (c) => LIVE.clusterChecks[c.name];
  const best = others.find((c) => chk(c) && !chk(c).error && chk(c).ax) || others.find((c) => !(chk(c) && chk(c).error)) || others[0];
  const p = { name, to: best ? best.name : LIVE.context, toAtespace: LIVE.atespace, start: true, original: 'keep', replace: false, copyFiles: false,
    mode: LIVE.promoteMissing ? 'move' : 'promote', check: null, checking: false, sending: false, progress: null, error: '', seq: 0 };
  const scope = ['--context', LIVE.context, '-a', LIVE.atespace];
  const text = (r) => [String(r.stdout || '').trim(), String(r.stderr || '').trim()].filter(Boolean).join('\n');
  const same = () => p.to === LIVE.context && (p.toAtespace || 'default') === LIVE.atespace;
  const atesBad = () => !LIVE_NAME_RE.test(p.toAtespace || 'default');
  const dlg = openDialog(dialogShell('lp', `Run ${esc(name)} on another cluster`, '', '<div id="lp-body"></div>', `<span class="left"></span><button class="btn ghost" data-action="close-dialog" id="lp-cancel">Cancel</button><button class="btn primary" id="lp-go">${icon('cloudUp', 'sm')}Send</button>`, true, 'cloudUp'));
  const radio = (k, v, label) => `<button type="button" role="radio" aria-checked="${p[k] === v}" data-lp-pick="${k}" data-value="${v}" ${p.sending ? 'disabled' : ''}>${label}</button>`;
  const toggle = (id, k, title, desc, disabled) => `<label class="toggle-line" style="margin-top:8px"><span class="tl-text"><b>${title}</b><span>${desc}</span></span>
      <span class="switch"><input type="checkbox" role="switch" id="${id}" data-lp-toggle="${k}" ${p[k] ? 'checked' : ''} ${p.sending || disabled ? 'disabled' : ''} aria-label="${esc(title)}"><span class="track"></span><span class="thumb"></span></span></label>`;
  const paint = () => {
    const body = $('#lp-body', dlg);
    if (!body) return;
    const go = $('#lp-go', dlg);
    if (!targets.length) {
      body.innerHTML = `<p class="small">Your kubeconfig has no cluster yet. Add one to <span class="mono">~/.kube/config</span> and it shows up here.</p>`;
      go.disabled = true;
      return;
    }
    /* What sending it does: ax promote's check, or Studio's own dry run. */
    let check = '';
    if (p.progress) {
      const lines = p.progress.logs.filter((l) => /^==> /.test(l)).map((l) => l.slice(4));
      const failed = p.progress.status === 'failed';
      check = `<div class="live-title" style="margin-top:14px">${failed ? "It stopped:" : p.progress.status === 'ok' ? 'Done:' : 'Sending…'}</div>
        <ol class="move-steps" id="lp-progress">${lines.map((l, i) => `<li class="${i < lines.length - 1 || p.progress.status === 'ok' ? 'done' : failed ? 'failed' : 'now'}">${icon(i < lines.length - 1 || p.progress.status === 'ok' ? 'checkCircle' : failed ? 'xCircle' : 'loader', 'xs')}<span>${esc(l)}</span></li>`).join('')}</ol>`;
    } else if (same()) {
      check = '<p class="small" style="margin-top:14px" id="lp-check">That\'s where it is now. Pick another cluster or atespace.</p>';
    } else if (atesBad()) {
      check = '<p class="small" style="margin-top:14px;color:var(--wait)" id="lp-check">An atespace name is lowercase letters, digits and dashes.</p>';
    } else if (p.checking) {
      check = `<p class="small muted" id="lp-check" style="margin-top:14px">${icon('loader', 'xs')} Checking ${esc(liveShortCtx(p.to))}…</p>`;
    } else if (p.check && p.mode === 'promote') {
      const lines = String(p.check.text || '').split('\n').map((l) => l.trim()).filter(Boolean);
      const notes = lines.filter((l) => /^Note:/i.test(l));
      const steps = lines.filter((l) => !/^Note:/i.test(l));
      check = p.check.ok ? `<div class="live-title" style="margin-top:14px">The check passed. This is what sending it does:</div>
          <ul class="live-steps" id="lp-check">${steps.map((l) => `<li>${livePromoteLine(l)}</li>`).join('') || '<li>Creates the task there</li>'}${p.original === 'delete' ? `<li>Deletes <span class="mono">${esc(name)}</span> on this cluster once it's there</li>` : ''}</ul>
          ${notes.map((l) => `<p class="small lp-note" style="margin-top:8px">${icon('key', 'xs')} ${livePromoteNote(l)}</p>`).join('')}`
        : `<div class="live-title" style="margin-top:14px">The check found a problem:</div>
          <pre class="manifest" id="lp-check" style="margin-top:8px;max-height:180px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere" tabindex="0" aria-label="Check result">${esc(p.check.text || 'The check failed without saying why.')}</pre>
          ${/--replace/.test(p.check.text) && !p.replace ? '<p class="small" style="margin-top:8px" id="lp-fix">To send it anyway, turn on <b>Replace the task that is there</b>.</p>' : ''}`;
    } else if (p.check && p.mode === 'move') {
      const plan = p.check.plan || {};
      check = p.check.error ? `<div class="callout warn" role="alert" style="margin-top:14px" id="lp-check">${icon('alert')}<div style="overflow-wrap:anywhere">${esc(p.check.error)}</div></div>`
        : (plan.problems || []).length ? `<div class="live-title" style="margin-top:14px">It can't go yet:</div><ul class="live-steps" id="lp-check">${plan.problems.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
          : `<div class="live-title" style="margin-top:14px">This is what sending it does:</div><ul class="live-steps" id="lp-check">${liveMovePlanLines(p, plan).map((l) => `<li>${l}</li>`).join('')}</ul>
            ${(plan.keys || []).length ? `<p class="small lp-note" style="margin-top:8px">${icon('key', 'xs')} ${liveKeysNote(plan.keys)}</p>` : ''}`;
    }
    const fresh = p.copyFiles
      ? "The copy starts from this sandbox's files: Studio copies its /workspace across. Running programs start again there, and keys stored on this cluster aren't copied."
      : "The run there starts fresh. It pulls from the Git branch that was pushed, and it uses that cluster's own Gateway credentials. Files in this sandbox and keys stored on this cluster aren't copied.";
    const cli = p.mode === 'promote' ? cliHint(['ax', '--context', LIVE.context].concat(LIVE.atespace !== 'default' ? ['-a', LIVE.atespace] : [], livePromoteArgs(p, false)).join(' '))
      : [liveCmd(['get', 'task', name]), liveCmdAt(p.to, (p.toAtespace !== 'default' ? ['-a', p.toAtespace] : []).concat(['apply', '-f', 'task.yaml'])), liveCmdAt(p.to, (p.toAtespace !== 'default' ? ['-a', p.toAtespace] : []).concat(['resume', 'task', name]))].map(cliHint).join('');
    body.innerHTML = `
      <div class="lp-grid">
        <label class="small" style="display:grid;gap:4px" for="lp-to">Cluster
          <select class="input" id="lp-to" ${p.sending ? 'disabled' : ''}>${targets.map((c) => `<option value="${esc(c.name)}" ${c.name === p.to ? 'selected' : ''}>${esc(liveShortCtx(c.name))}${liveIsLocal(c.name) ? ' (this computer)' : ''}${c.name === LIVE.context ? ' (where it is now)' : ''}</option>`).join('')}</select></label>
        <label class="small" style="display:grid;gap:4px" for="lp-ates">Atespace there
          <input class="input mono" id="lp-ates" value="${esc(p.toAtespace)}" autocomplete="off" spellcheck="false" ${p.sending ? 'disabled' : ''} ${atesBad() ? 'aria-invalid="true"' : ''}></label>
      </div>
      <div class="callout" style="margin-top:12px" id="lp-note">${icon('info')}<div>${fresh}</div></div>
      <div class="lp-row"><span class="small lp-label" id="lp-orig-label">The original</span>
        <div class="seg" role="radiogroup" aria-labelledby="lp-orig-label">${radio('original', 'keep', 'Keep it running')}${radio('original', 'suspend', 'Pause it')}${radio('original', 'delete', 'Delete it')}</div></div>
      <p class="xsmall muted" style="margin-top:4px">${p.original === 'delete' ? 'Deleted once the copy is there. It can\'t be undone.' : p.original === 'suspend' ? 'Paused, so it doesn\'t run in both places. Resume it here anytime.' : 'It keeps running here too.'}</p>
      ${toggle('lp-start', 'start', 'Start it there', 'Off creates it there paused, so you can start it when you choose.', p.copyFiles)}
      ${toggle('lp-replace', 'replace', 'Replace the task that is there', 'If that cluster already has a task with this name, it is deleted first.')}
      ${p.mode === 'move' ? toggle('lp-copy', 'copyFiles', 'Copy its files', debug ? 'Copies this sandbox\'s /workspace across over ax ssh. Both copies run while it copies.' : 'Needs debug access, and this task was started without it.', !debug) : ''}
      ${check}
      ${p.mode === 'move' && !p.progress ? '<p class="xsmall muted" style="margin-top:8px" id="lp-mode">This <span class="mono">ax</span> has no <span class="mono">ax promote</span>, so Studio sends the task itself through the AX API.</p>' : ''}
      ${p.error ? `<div class="callout warn" role="alert" style="margin-top:12px">${icon('alert')}<div style="overflow-wrap:anywhere;white-space:pre-wrap">${esc(p.error)}</div></div>` : ''}
      <div class="live-cli-wrap" style="margin-top:12px;display:grid;gap:6px">${cli}</div>`;
    const ready = !same() && !atesBad() && !p.checking && p.check && (p.mode === 'promote' ? p.check.ok : !p.check.error && !((p.check.plan || {}).problems || []).length);
    go.disabled = p.sending || !ready;
    go.innerHTML = p.sending ? `${icon('loader', 'sm')}Sending…` : `${icon('cloudUp', 'sm')}Send to ${esc(liveShortCtx(p.to))}`;
    /* While Studio sends it, Cancel stops the move (what it already did stays done); ax promote can't be stopped. */
    const cancel = $('#lp-cancel', dlg);
    if (cancel) {
      const stoppable = p.sending && p.mode === 'move' && p.progress && p.progress.status === 'running';
      cancel.disabled = p.sending && !stoppable;
      cancel.dataset.action = stoppable ? 'live-op-cancel' : 'close-dialog';
      cancel.textContent = stoppable ? 'Stop' : 'Cancel';
    }
  };
  /* Check first. ax promote --preflight-only reads both clusters and changes nothing; so does Studio's dry run. */
  const runCheck = async () => {
    const seq = ++p.seq;
    p.check = null; p.error = '';
    if (same() || atesBad()) { p.checking = false; paint(); return; }
    p.checking = true;
    paint();
    if (p.mode === 'promote') {
      let r;
      try { r = await studioApi.ax(scope.concat(livePromoteArgs(p, true))); } catch (e) { r = { status: 1, stdout: '', stderr: e.message }; }
      if (seq !== p.seq) return; // the options changed while this check ran
      /* This ax has no promote: Studio sends the task itself from now on. */
      if (r.status !== 0 && /unknown command:? "?promote/i.test(text(r))) { LIVE.promoteMissing = true; p.mode = 'move'; runCheck(); return; }
      p.check = { ok: r.status === 0, text: text(r) };
    } else {
      try {
        p.check = { plan: await studioPost('/api/tasks/move', liveMoveBody(p, true)) };
      } catch (e) {
        p.check = { error: e.message };
      }
      if (seq !== p.seq) return;
    }
    p.checking = false;
    paint();
    const ok = p.mode === 'promote' ? p.check.ok : !p.check.error && !((p.check.plan || {}).problems || []).length;
    announce(ok ? `The check passed. You can send it to ${p.to}.` : `The check found a problem with ${p.to}.`);
  };
  const finish = () => {
    LIVE.opWatch = null;
    closeDialog(true);
    toast(`<span class="mono">${esc(name)}</span> is on ${esc(liveShortCtx(p.to))}${p.toAtespace !== 'default' ? ` (atespace ${esc(p.toAtespace)})` : ''}`, { icon: 'cloudUp' });
    announce(`${name} is on ${p.to}`);
    if (p.to !== LIVE.context) liveUseContext(p.to);
    liveUseAtespace(p.toAtespace);
    location.hash = `#/task/${encodeURIComponent(name)}`;
    render();
    liveRefresh(true);
  };
  dlg.addEventListener('change', (e) => {
    const t = e.target;
    if (!t) return;
    if (t.id === 'lp-to') { p.to = t.value; runCheck(); }
    if (t.dataset && t.dataset.lpToggle) { p[t.dataset.lpToggle] = t.checked; if (t.dataset.lpToggle === 'copyFiles' && t.checked) p.start = true; runCheck(); }
  });
  dlg.addEventListener('input', (e) => { if (e.target && e.target.id === 'lp-ates') { p.toAtespace = e.target.value.trim() || 'default'; clearTimeout(p.timer); p.timer = setTimeout(runCheck, 400); } });
  dlg.addEventListener('click', (e) => {
    const b = e.target && e.target.closest && e.target.closest('[data-lp-pick]');
    if (!b || p.sending) return;
    p[b.dataset.lpPick] = b.dataset.value;
    runCheck();
  });
  $('#lp-go', dlg).addEventListener('click', async () => {
    if (p.sending || $('#lp-go', dlg).disabled) return;
    p.sending = true; p.error = '';
    paint();
    if (p.mode === 'promote') {
      let r;
      try { r = await studioApi.ax(scope.concat(livePromoteArgs(p, false))); } catch (e) { r = { status: 1, stdout: '', stderr: e.message }; }
      if (r.status !== 0) { p.sending = false; p.error = text(r) || 'ax promote failed.'; paint(); return; }
      /* ax promote can pause the original, not delete it: Studio does that once it's there. */
      if (p.original === 'delete') {
        try { await studioApi.taskAction('delete', LIVE.context, LIVE.atespace, name); } catch (e) { toast(`It's on ${esc(p.to)}, but Studio couldn't delete it here: ${esc(e.message)}`, { icon: 'alert', timeout: 9000 }); }
      }
      p.sending = false;
      finish();
      return;
    }
    try {
      const op = await studioPost('/api/tasks/move', liveMoveBody(p, false));
      liveSetOp(op);
      p.progress = LIVE.op;
      LIVE.opWatch = (o) => {
        if (!o || o.id !== op.id) return;
        p.progress = o;
        if (o.status !== 'running') LIVE.opHandled = o.id;
        if (o.status === 'ok') { p.sending = false; finish(); return; }
        if (o.status === 'failed') { p.sending = false; p.error = o.canceled ? 'Canceled. What it already did stays done.' : o.error || 'It stopped without saying why.'; LIVE.opWatch = null; }
        paint();
      };
      paint();
    } catch (e) {
      p.sending = false; p.error = e.message;
      paint();
    }
  });
  paint();
  if (targets.length) runCheck();
}
/** The body of POST /api/tasks/move for what the dialog says. */
function liveMoveBody(p, dryRun) {
  return { context: LIVE.context, atespace: LIVE.atespace, name: p.name, toContext: p.to, toAtespace: p.toAtespace || 'default', original: p.original, noResume: !p.start && !p.copyFiles, copyFiles: p.copyFiles, replace: p.replace, dryRun };
}

const LIVE_NEW_ACTIONS = {
  'live-new-agent': (el) => { if (LIVE.draft && !LIVE.draft.busy) { LIVE.draft.agent = el.dataset.agent; LIVE.draft.error = ''; render({ keepScroll: true }); } },
  'live-new-network': (el) => { if (LIVE.draft) { LIVE.draft.network = el.dataset.network; render({ keepScroll: true }); } },
  'live-new-debug': (el) => { const d = LIVE.draft; if (d) { d.debug = !!el.checked; d.debugTouched = true; liveNewRefreshParts(d, 'debug'); } },
  /* Where it runs: this computer, or a remote cluster (the one in use, else the first). A follow-up stays put. */
  'live-new-where': (el) => {
    const d = LIVE.draft;
    if (!d || d.from || d.busy) return;
    const remotes = LIVE.contexts.filter((c) => !liveIsLocal(c.name));
    if (el.dataset.where === 'local') {
      if (!liveLocalReady()) return;
      d.where = LIVE.local.context;
    } else {
      if (!remotes.length) return;
      if (!d.where || liveIsLocal(d.where)) d.where = (remotes.find((c) => c.name === LIVE.context) || remotes[0]).name;
    }
    d.whereTouched = true;
    if (!d.debugTouched) d.debug = liveIsLocal(d.where);
    d.error = '';
    render({ keepScroll: true });
  },
  'live-new-cluster': (el) => {
    const d = LIVE.draft;
    if (!d || d.from || d.busy || !LIVE.contexts.some((c) => c.name === el.dataset.context)) return;
    d.where = el.dataset.context;
    d.whereTouched = true;
    if (!d.debugTouched) d.debug = liveIsLocal(d.where);
    render({ keepScroll: true });
  },
  'live-new-source': (el) => { const d = LIVE.draft; if (d) { d.source = ['empty', 'existing'].includes(el.dataset.source) ? el.dataset.source : 'git'; d.error = ''; render({ keepScroll: true }); } },
  /* An existing workspace: pressing the one picked again unpicks it. */
  'live-new-ws-pick': (el) => { const d = LIVE.draft; if (d) { d.existing = d.existing === el.dataset.ws ? '' : el.dataset.ws || ''; d.source = 'existing'; d.error = ''; render({ keepScroll: true }); } },
  'live-new-setup-pick': (el) => {
    const d = LIVE.draft;
    if (!d) return;
    const lines = liveLines(d.setup);
    d.setup = (lines.includes(el.dataset.cmd) ? lines.filter((l) => l !== el.dataset.cmd) : lines.concat(el.dataset.cmd)).join('\n');
    render({ keepScroll: true });
  },
  'live-new-file-add': (el) => {
    const d = LIVE.draft;
    if (!d) return;
    d.files = (d.files || []).concat({ path: (el && el.dataset.path) || '', content: '' });
    d.wsOpen = true;
    render({ keepScroll: true });
    const box = $(`[data-live-new-file="${d.files.length - 1}"][data-k="${el && el.dataset.path ? 'content' : 'path'}"]`); if (box) box.focus({ preventScroll: true });
  },
  'live-new-file-del': (el) => { const d = LIVE.draft; if (d) { d.files.splice(+el.dataset.i, 1); render({ keepScroll: true }); } },
  'live-new-mcp-add': () => {
    const d = LIVE.draft;
    if (!d) return;
    d.mcp = (d.mcp || []).concat({ name: '', endpoint: '' });
    d.wsOpen = true;
    render({ keepScroll: true });
    const box = $(`[data-live-new-mcp="${d.mcp.length - 1}"][data-k="name"]`); if (box) box.focus({ preventScroll: true });
  },
  'live-new-mcp-del': (el) => { const d = LIVE.draft; if (d) { d.mcp.splice(+el.dataset.i, 1); render({ keepScroll: true }); } },
  /* The task's files as a file on this computer, and back. A file you load opens in the editor, as written. */
  'live-new-download': () => {
    const d = LIVE.draft;
    if (!d) return;
    const text = d.raw ? d.yaml : liveNewYAML(d, 'text', '');
    const name = (d.raw ? liveYAMLTaskName(d.yaml) : liveDraftName(d)) || 'task';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/yaml' }));
    a.download = `${name}.yaml`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    announce(`Downloaded ${name}.yaml`);
  },
  'live-new-load': () => {
    let inp = $('#live-new-file-in');
    if (!inp || !inp.isConnected) {
      inp = document.createElement('input');
      inp.type = 'file'; inp.id = 'live-new-file-in'; inp.accept = '.yaml,.yml,text/yaml,application/yaml'; inp.hidden = true;
      inp.addEventListener('change', () => { const f = inp.files && inp.files[0]; if (f) liveNewLoadFile(f); inp.value = ''; });
      document.body.appendChild(inp);
    }
    inp.click();
  },
  'live-new-repo-pick': (el) => { const d = LIVE.draft; if (d) { d.repo = el.dataset.repo || ''; d.source = 'git'; d.error = ''; render({ keepScroll: true }); } },
  /* A branch pill fills the field; pressing the one already there clears it (back to the repo's default branch). */
  'live-new-branch-pick': (el) => { const d = LIVE.draft; if (d) { d.branch = d.branch.trim() === el.dataset.branch ? '' : el.dataset.branch; render({ keepScroll: true }); } },
  'live-new-size': (el) => {
    const d = LIVE.draft;
    if (!d || !(LIVE_SIZES[el.dataset.size] || el.dataset.size === 'custom')) return;
    /* Custom starts from the size it was. */
    if (el.dataset.size === 'custom' && d.size !== 'custom') { const l = liveDraftLimits(d); d.cpu = d.cpu || l.cpu; d.memory = d.memory || l.memory; }
    d.size = el.dataset.size;
    render({ keepScroll: true });
  },
  'live-new-raw': () => { const d = LIVE.draft; if (d) { d.yaml = liveNewYAML(d, 'text', ''); d.raw = true; d.error = ''; render({ keepScroll: true }); } },
  'live-new-form': () => { if (LIVE.draft) { LIVE.draft.raw = false; LIVE.draft.error = ''; render({ keepScroll: true }); } },
  'live-new-run': () => liveNewRun(),
  'live-promote': (el) => liveOpenPromote(el.dataset.task),
  /* After a task move finished in the background: show it where it went. */
  'live-show-moved': (el) => {
    const ctx = el.dataset.context;
    if (ctx && ctx !== LIVE.context && LIVE.contexts.some((c) => c.name === ctx)) liveUseContext(ctx);
    liveUseAtespace(el.dataset.atespace || 'default');
    location.hash = `#/task/${encodeURIComponent(el.dataset.task || '')}`;
    render();
    liveRefresh(true);
  },
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
/** Reads a task file from this computer into the editor. */
function liveNewLoadFile(file) {
  const d = LIVE.draft;
  if (!d) return;
  if (file.size > 256 * 1024) { toast('That file is too big for a task file.', { icon: 'alert' }); return; }
  const r = new FileReader();
  r.onload = () => {
    d.yaml = String(r.result || '');
    d.raw = true;
    d.error = /^kind:\s*Task\s*$/m.test(d.yaml) ? '' : 'The file needs a Task.';
    render({ keepScroll: true });
    toast(`Loaded <span class="mono">${esc(file.name)}</span>`, { icon: 'upload' });
  };
  r.onerror = () => toast(`Couldn't read ${esc(file.name)}`, { icon: 'alert' });
  r.readAsText(file);
}
if (LIVE.on) {
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (!t || !t.dataset) return;
    if (t.dataset.liveNew) { liveNewTyped(t); return; }
    /* A file or an MCP server you're typing in. */
    const d = LIVE.draft;
    if (!d) return;
    if (t.dataset.liveNewFile !== undefined && d.files[+t.dataset.liveNewFile]) { d.files[+t.dataset.liveNewFile][t.dataset.k] = t.value; liveNewRefreshParts(d, 'files'); }
    if (t.dataset.liveNewMcp !== undefined && d.mcp[+t.dataset.liveNewMcp]) { d.mcp[+t.dataset.liveNewMcp][t.dataset.k] = t.value; liveNewRefreshParts(d, 'mcp'); }
  });
  /* Customize workspace and More options stay open (or closed) while the page redraws. */
  document.addEventListener('toggle', (e) => {
    if (!e.target || !LIVE.draft) return;
    if (e.target.id === 'live-new-more') LIVE.draft.moreOpen = e.target.open;
    if (e.target.id === 'live-ws-more') LIVE.draft.wsOpen = e.target.open;
  }, true);
}
