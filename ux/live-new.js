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

/* AX Studio, live mode: New task.

   New task is a form that follows AX's own specs. A task is a Task, the Workspace it starts from and the Gateway its
   network goes through, as ax.io/v1alpha1 resources. The form has a section for each, with their fields in the order AX
   defines them, and the YAML beside it is what Studio applies: it follows the form as you type, and Edit YAML lets you
   change it by hand.
   - Start from fills the form. Blank is a plain task: the cluster's default task image, a command that keeps the
     sandbox open, debug access on, no workspace and no network, so a first task works without any keys. Antigravity
     fills in an agent: its image, environment, resources and config, and the Gateway rules that add its API
     key outside the sandbox. Everything stays editable. Starting from another preset after you changed what the last
     one filled in asks first; the goal, the workspace and the hosts you allowed stay either way.
   - The workspace is none (an empty /workspace), one already on this computer, or a new one: Git repos, files, skills,
     setup commands and a setup network, in the order AX sets them up, then the MCP servers the task can call.
   - The network is none (no Gateway), a new Gateway (the hosts the task may reach, the credentials it adds to requests
     outside the sandbox, the hosts it passes through), or a Gateway already on this computer. A new Gateway also allows
     what the workspace needs, because AX on this computer sets a workspace up inside the task's sandbox, on the task's
     network.
   - Create task stores each key you typed as a secret on the cluster (POST /api/secrets/credential), has the Studio
     server run `ax apply -f -` on the YAML, then `ax resume task` (a task can start suspended), and opens the task.
     Load a task file opens a file from this computer in the YAML editor; Download saves the YAML. */

/* The agents Start from offers. The task page also reads them, to name a task's agent by its image and its key by
   its host. Antigravity is the agy-cli image from agentexecutor/images (v0.0.0-rc.4, multi-arch index): agy is built
   into the image, so its Gateway only needs the Gemini API, with the key added outside the sandbox. */
const LIVE_AGENTS = {
  antigravity: {
    id: 'antigravity', name: 'Antigravity', desc: "Google's coding agent, on Gemini", keyFrom: 'Gemini', model: '',
    image: 'ghcr.io/agentexecutor/agy-cli@sha256:0d459fee234a47ab9cc56996b65711097e4ac1b18641ec252fdd960aacb74ef6',
    secret: 'gemini-api-creds', keyName: 'GEMINI_API_KEY', host: 'generativelanguage.googleapis.com', header: 'x-goog-api-key',
  },
};
/* Start from: Antigravity or Blank. */
const LIVE_PRESETS = {
  antigravity: { name: 'Antigravity', desc: LIVE_AGENTS.antigravity.desc, agent: 'antigravity' },
  blank: { name: 'Blank', desc: "A plain task on the cluster's default task image" },
};
/* Hosts a task often needs, to allow with one click. The task page calls a Gateway that allows all of them Balanced. */
const LIVE_HOST_PICKS = [
  { id: 'github', label: 'GitHub', hosts: ['github.com', 'api.github.com', '*.githubusercontent.com'] },
  { id: 'pypi', label: 'PyPI', hosts: ['pypi.org', 'files.pythonhosted.org'] },
  { id: 'npm', label: 'npm', hosts: ['registry.npmjs.org'] },
];
const LIVE_BALANCED_HOSTS = [].concat(...LIVE_HOST_PICKS.map((p) => p.hosts));
/* Sizes that fill in the CPU and memory limits. Empty limits are AX's defaults: 1 CPU and 512 MiB. */
const LIVE_SIZES = {
  small: { label: 'Small', cpu: '1', memory: '1Gi' },
  medium: { label: 'Medium', cpu: '2', memory: '4Gi' },
  large: { label: 'Large', cpu: '4', memory: '8Gi' },
};
const LIVE_SETUP_PICKS = ['npm ci', 'pip install -r requirements.txt', 'go mod download', 'uv sync'];
/* Blank keeps the sandbox running, so there is something to open a shell in. */
const LIVE_BLANK_COMMAND = "sh -c 'sleep infinity'";
const LIVE_RECENT_KEY = 'ax.live.recentRepos';
const LIVE_NAME_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const LIVE_DIGEST_RE = /@sha256:[0-9a-f]{64}$/;
const LIVE_CPU_RE = /^(\d+(\.\d+)?|\d+m)$/;
const LIVE_MEM_RE = /^\d+(\.\d+)?(Ki|Mi|Gi|Ti|K|M|G|T)$/;
const LIVE_ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
/* A host pattern a Gateway takes: a lowercase DNS name, with * as its leftmost label or alone. */
const LIVE_HOST_RE = /^(\*|(\*\.)?[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*)$/;
const LIVE_HEADER_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;
const LIVE_SECRET_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;
const LIVE_SECRET_KEY_RE = /^[A-Za-z0-9._-]{1,128}$/;
const LIVE_MCP_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
LIVE.draft = null;

/* ---------- Small helpers ---------- */
function liveT(v) { return String(v == null ? '' : v).trim(); }
function liveHex(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(''); }
function liveSlug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').split('-').slice(0, 4).join('-').slice(0, 28).replace(/-+$/, '');
}
/** An https:// address's host, or '' for anything else. */
function liveRepoHost(url) { try { const u = new URL(url); return u.protocol === 'https:' ? u.hostname.toLowerCase() : ''; } catch (e) { return ''; } }
/** An http(s) address as the Gateway sees it: { scheme, host, port } (port '' for the scheme's own), or null. */
function liveUrlParts(url) {
  try {
    const u = new URL(liveT(url));
    if ((u.protocol !== 'https:' && u.protocol !== 'http:') || !u.hostname) return null;
    return { scheme: u.protocol.slice(0, -1), host: u.hostname.toLowerCase(), port: u.port };
  } catch (e) { return null; }
}
/** "https://github.com/acme/api.git" -> "github.com/acme/api". */
function liveRepoShort(url) {
  try { const u = new URL(url); return (u.hostname.replace(/^www\./, '') + u.pathname).replace(/\.git$/, '').replace(/\/+$/, ''); } catch (e) { return String(url || ''); }
}
/** "https://github.com/acme/api.git" -> "api": the folder AX names after a repo. */
function liveRepoBase(url) {
  let base = '';
  try { base = new URL(liveT(url)).pathname.split('/').filter(Boolean).pop() || ''; } catch (e) { /* none */ }
  return base.replace(/\.git$/, '').replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[.-]+/, '');
}
/** "ghcr.io/acme/agent@sha256:5382…" -> "agent@538252…". */
function liveImageShort(ref) {
  const [path, digest] = String(ref || '').split('@');
  const name = path.split('/').pop() || path;
  return digest ? `${name}@${digest.replace(/^sha256:/, '').slice(0, 12)}` : name;
}
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
/** A path inside the workspace: relative, and not climbing out of it. */
function liveInsidePath(p) { return !!p && !p.startsWith('/') && !p.split('/').includes('..'); }
/** Whether a Gateway host pattern covers a host: the same name, "*", or "*." and one more label. */
function liveHostCovered(host, patterns) {
  return patterns.some((p) => p === host || p === '*' || (p.startsWith('*.') && host.endsWith(p.slice(1)) && host.split('.').length === p.split('.').length));
}
/** The YAML field a row of the form writes, split so it wraps at the dots. It is left out of the field's label: the
    YAML panel says the same to everyone. */
function liveField(path) { return `<span class="mono nt-path" aria-hidden="true">${path.split('.').map(esc).join('.<wbr>')}</span>`; }

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

/* ---------- The workspaces and Gateways on this computer ----------
   Read for the pickers when the page opens, and again when they are older than 20 seconds. Home's copy fills them in
   while they load. */
LIVE.newRes = { key: '', at: 0, loading: false, workspaces: [], gateways: [], error: '' };
function liveNewLists() {
  const R = LIVE.newRes;
  const key = `${LIVE.context}|${LIVE.atespace}`;
  if (!LIVE.context) return R;
  if (R.key !== key) Object.assign(R, { key, at: 0, workspaces: [], gateways: [], error: '' });
  if (!R.at && !R.workspaces.length && !R.gateways.length && typeof liveResFresh === 'function' && liveResFresh()) {
    R.workspaces = LIVE.res.workspaces.slice(); R.gateways = LIVE.res.gateways.slice();
  }
  if (!R.loading && Date.now() - R.at > 20000) {
    R.loading = true;
    const q = studioQuery({ context: LIVE.context, atespace: LIVE.atespace });
    Promise.all([studioGet('/api/workspaces' + q), studioGet('/api/gateways' + q)])
      .then(([w, g]) => { if (R.key === key) Object.assign(R, { workspaces: w.workspaces || [], gateways: g.gateways || [], error: '' }); })
      .catch((e) => { if (R.key === key) R.error = e.message; })
      .finally(() => { R.loading = false; R.at = Date.now(); liveNewListsArrived(); });
  }
  return R;
}
/** The lists arrived: draw the pickers again, without redrawing a field you are typing in. */
function liveNewListsArrived() {
  const d = LIVE.draft;
  if (!d || d.raw || parseRoute().parts[0] !== 'new' || !$('#live-new-run')) return;
  if (!isTypingIn('#main')) { render({ keepScroll: true }); return; }
  [['#live-ws-existing', liveNewExistingHTML], ['#live-new-setup-gw', liveNewSetupGwHTML], ['#live-gw-existing', liveNewGwExistingHTML]].forEach(([sel, fn]) => {
    const box = $(sel); if (box) box.innerHTML = fn(d);
  });
  liveNewRefreshParts(d, 'lists');
}
const liveResNameOf = (doc) => (doc && doc.metadata && doc.metadata.name) || '';
function liveNewWsDoc(name) { return name ? liveNewLists().workspaces.find((w) => liveResNameOf(w) === name) || null : null; }
function liveNewGwDoc(name) { return name ? liveNewLists().gateways.find((g) => liveResNameOf(g) === name) || null : null; }
/** The hosts a Gateway's rules name. */
function liveNewGwHosts(doc) {
  if (typeof liveGatewayRules === 'function') return liveGatewayRules(doc).hosts;
  const out = [];
  ((doc && doc.spec && doc.spec.egress) || []).forEach((r) => ((r.https || r.http || r.tlsPassthrough || {}).hostnames || []).forEach((h) => { if (!out.includes(h)) out.push(h); }));
  return out;
}

/* ---------- The draft ---------- */
/** What a preset fills in: the fields an agent decides. Everything else in the form stays as it is. */
function livePresetFields(id) {
  const A = LIVE_AGENTS[(LIVE_PRESETS[id] || {}).agent];
  if (!A) return { image: '', command: LIVE_BLANK_COMMAND, env: [], cpu: '', memory: '', config: '', goalAsPrompt: false, tls: [], creds: [] };
  return {
    image: A.image, command: '',
    /* The agent sends its key header with a placeholder; the Gateway puts the real key in, outside the sandbox. */
    env: [{ name: A.keyName, value: 'placeholder' }].concat((A.extraEnv || []).map(([name, value]) => ({ name, value }))),
    cpu: LIVE_SIZES.medium.cpu, memory: LIVE_SIZES.medium.memory,
    config: A.config || '', goalAsPrompt: !!A.goalAsPrompt,
    tls: (A.tlsPassthrough || []).slice(),
    creds: [{ host: A.host, header: A.header, prefix: '', secret: A.secret, key: A.keyName, value: '', label: `${A.keyFrom} API key` }],
  };
}
/** A new draft: Antigravity by default. (Callers may pass a value: it is ignored. Follow-ups are gone.) */
function liveNewDraft() {
  const d = {
    preset: 'antigravity', name: '', nameEdited: false, suffix: liveHex(2), goal: '', debug: true,
    image: '', command: '', env: [], cpu: '', memory: '', config: '', goalAsPrompt: false,
    ws: 'none', existing: '', git: [], files: [], skills: [], skillsPath: '', setup: [], setupGateway: '', mcp: [],
    net: 'none', hosts: [], hostIn: '', tls: [], tlsIn: '', creds: [], gateway: '',
    advTaskOpen: false, advWsOpen: false, advNetOpen: false,
    raw: false, yaml: '', busy: '', error: '', envSig: '',
  };
  liveNewApplyPreset(d, 'antigravity');
  return d;
}
/** Fills in a preset: replaces what the last one filled in, and keeps the rest of the form. */
function liveNewApplyPreset(d, id) {
  if (!LIVE_PRESETS[id]) return;
  const old = livePresetFields(d.preset), f = livePresetFields(id);
  d.preset = id;
  Object.assign(d, { image: f.image, command: f.command, env: f.env.map((e) => Object.assign({}, e)), cpu: f.cpu, memory: f.memory, config: f.config, goalAsPrompt: f.goalAsPrompt });
  /* The Gateway rules the last preset added go; the hosts you allowed and the credentials you added stay. */
  d.tls = d.tls.filter((h) => !old.tls.includes(h));
  f.tls.forEach((h) => { if (!d.tls.includes(h)) d.tls.push(h); });
  d.creds = d.creds.filter((c) => !c.preset).concat(f.creds.map((c) => Object.assign({ preset: true }, c)));
  /* An agent comes with the network its image needs (agy-cli: the Gemini API, its key added outside the sandbox).
     Blank has none, and goes back to No network unless you allowed something yourself. */
  if (f.creds.length || f.tls.length) d.net = 'allow';
  else if (d.net === 'allow' && !d.hosts.length && !d.tls.length && !d.creds.length) d.net = 'none';
  d.error = '';
}
/** What you changed in the fields the current preset filled in, in words. */
function liveNewPresetChanges(d) {
  const f = livePresetFields(d.preset);
  const out = [];
  const env = liveRowsUsed(d.env, ['name', 'value']).map(({ r }) => ({ name: liveT(r.name), value: String(r.value || '') }));
  const core = (c) => [liveT(c.host), liveT(c.header), liveT(c.prefix), liveT(c.secret), liveT(c.key)].join('|');
  const mine = d.creds.filter((c) => c.preset);
  if (liveT(d.image) !== f.image) out.push('the image');
  if (liveT(d.command) !== f.command) out.push('the command');
  if (JSON.stringify(env) !== JSON.stringify(f.env)) out.push('the environment');
  if (liveT(d.cpu) !== f.cpu || liveT(d.memory) !== f.memory) out.push('the resources');
  if (liveT(d.config) !== liveT(f.config) || d.goalAsPrompt !== f.goalAsPrompt) out.push('the config');
  if (mine.some((c) => liveT(c.value))) out.push('the API key you typed');
  else if (mine.map(core).join() !== f.creds.map(core).join()) out.push('its credential');
  return out;
}
/** Start from another preset. When you changed what the last one filled in, it asks first. */
function liveNewPickPreset(id) {
  const d = LIVE.draft;
  if (!d || d.busy || !LIVE_PRESETS[id] || id === d.preset) return;
  const changed = liveNewPresetChanges(d);
  if (!changed.length) { liveNewApplyPreset(d, id); render({ keepScroll: true }); announce(`Started from ${LIVE_PRESETS[id].name}`); return; }
  const P = LIVE_PRESETS[id];
  const words = changed.length > 1 ? `${changed.slice(0, -1).join(', ')} and ${changed[changed.length - 1]}` : changed[0];
  const dlg = openDialog(dialogShell('np', `Start from ${esc(P.name)}?`, '', `
    <p class="small">${esc(P.name)} fills in its own image, command, environment, resources, config and credential. That replaces ${esc(words)}.</p>
    <p class="small" style="margin-top:8px">The name, goal, workspace and the hosts you allowed stay as they are.</p>`,
  `<span class="left"></span><button class="btn ghost" data-action="close-dialog">Keep what I typed</button><button class="btn primary" id="np-go">Use ${esc(P.name)}</button>`, false, 'sparkle'));
  $('#np-go', dlg).addEventListener('click', () => {
    closeDialog(true);
    if (!LIVE.draft) return;
    liveNewApplyPreset(LIVE.draft, id);
    render({ keepScroll: true });
    announce(`Started from ${P.name}`);
  });
}
function liveDraftName(d) {
  if (d.nameEdited) return d.name.trim();
  return `${liveSlug(d.goal) || 'task'}-${d.suffix}`;
}
/** A resource Studio makes for this task: ws-<task> or gw-<task>, as a name AX takes. */
function liveOwnName(prefix, d) { return `${prefix}-${liveDraftName(d)}`.slice(0, 63).replace(/-+$/, ''); }

/* ---------- Rows: the lists in the form ---------- */
const LIVE_ROW_KEYS = {
  env: ['name', 'value'], git: ['repo', 'ref', 'dir', 'depth'], files: ['path', 'content'], skills: ['provider', 'project', 'query'],
  setup: ['cmd'], mcp: ['name', 'endpoint', 'command'], creds: ['host', 'header', 'prefix', 'secret', 'key', 'value'],
};
function liveNewBlankRow(kind, data) {
  data = data || {};
  switch (kind) {
    case 'env': return { name: '', value: '' };
    case 'git': return { repo: data.repo || '', ref: '', dir: '', depth: '' };
    case 'files': return { path: data.path || '', content: '' };
    case 'skills': return { provider: '', project: '', query: '' };
    case 'setup': return { cmd: data.cmd || '' };
    case 'mcp': return { name: '', kind: 'remote', endpoint: '', command: '' };
    case 'creds': return { host: '', header: '', prefix: '', secret: '', key: '', value: '' };
    default: return null;
  }
}
/** The rows you wrote something in, with where they are in the list. Empty rows are left out. */
function liveRowsUsed(rows, keys) { return (rows || []).map((r, i) => ({ r, i })).filter(({ r }) => keys.some((k) => liveT(r[k]))); }
/** The repos to clone: the first goes in /workspace itself unless you name its folder. */
function liveNewGit(d) {
  const names = [];
  return liveRowsUsed(d.git, LIVE_ROW_KEYS.git).map(({ r, i }, n) => {
    const repo = liveT(r.repo);
    const base = liveRepoBase(repo) || 'repo';
    let name = base, k = 2;
    while (names.includes(name)) name = `${base}-${k++}`;
    names.push(name);
    return { i, repo, ref: liveT(r.ref), dir: liveT(r.dir) || (n === 0 ? '.' : ''), depth: liveT(r.depth), name };
  });
}
function liveNewMcp(d) {
  return liveRowsUsed(d.mcp, LIVE_ROW_KEYS.mcp).map(({ r, i }) => {
    const local = r.kind === 'local';
    const words = local ? liveSplitArgs(liveT(r.command)) : { args: [], error: '' };
    return { i, name: liveT(r.name), local, endpoint: local ? '' : liveT(r.endpoint), command: words.args[0] || '', args: words.args.slice(1), error: words.error };
  });
}
function liveNewCreds(d) {
  return d.net !== 'allow' ? [] : liveRowsUsed(d.creds, LIVE_ROW_KEYS.creds).map(({ r, i }) => ({ i, host: liveT(r.host).toLowerCase(), header: liveT(r.header), prefix: String(r.prefix || ''), secret: liveT(r.secret), key: liveT(r.key), value: liveT(r.value) }));
}
function liveCredUri(c) { return `ate-secret://k8s.io/default/${(STUDIO.info && STUDIO.info.axNamespace) || 'ax-system'}/${c.secret}/${c.key}`; }
/** Passthrough entries: "host" or "host:port" (443 when there is none). */
function liveNewTls(d) {
  return d.net !== 'allow' ? [] : d.tls.map((x) => { const m = /^(.*?)(?::(\d{1,5}))?$/.exec(x); return { host: m[1], port: m[2] || '443' }; });
}
/** What the workspace needs to reach while it sets up and runs: its repos and its remote MCP servers. */
function liveNewWsNeeds(d) {
  let repos = [], endpoints = [];
  if (d.ws === 'new') {
    repos = liveNewGit(d).map((g) => g.repo);
    endpoints = liveNewMcp(d).filter((m) => m.endpoint).map((m) => m.endpoint);
  } else if (d.ws === 'existing') {
    const sp = (liveNewWsDoc(d.existing) || {}).spec || {};
    repos = ((sp.setup && sp.setup.git) || []).map((g) => g.repo || '');
    endpoints = ((sp.mcp && sp.mcp.servers) || []).map((s) => s.endpoint || '').filter(Boolean);
  }
  const out = [];
  const add = (url, why) => {
    const p = liveUrlParts(url);
    if (p && LIVE_HOST_RE.test(p.host) && !out.some((o) => o.host === p.host && o.scheme === p.scheme && o.port === p.port)) out.push(Object.assign(p, { why }));
  };
  repos.forEach((u) => add(u, 'repo'));
  endpoints.forEach((u) => add(u, 'mcp'));
  return out;
}

/* ---------- What stops it from being created ---------- */
/** The config you typed, checked enough to say when it isn't a YAML mapping. */
function liveConfigProblem(d) {
  const text = String(d.config || '');
  if (!text.trim()) return '';
  if (text.length > 16384) return 'The config can be up to 16 KiB.';
  const lines = text.split('\n').filter((l) => l.trim() && !/^\s*#/.test(l));
  if (lines.some((l) => /^\s*\t/.test(l))) return 'Indent the config with spaces, not tabs.';
  if (lines.some((l) => /^---/.test(l)) || lines.filter((l) => !/^\s/.test(l)).some((l) => !/^("[^"]+"|'[^']+'|[A-Za-z0-9_.$-]+)\s*:(\s|$)/.test(l))) return 'Write the config as YAML keys and values, like model: "gemini-2.5-pro".';
  if (d.goalAsPrompt && lines.some((l) => /^prompt\s*:/.test(l))) return 'The config has a prompt already. Remove it, or stop passing the goal as the prompt.';
  return '';
}
/** What stops this draft from being created, in page order. */
function liveNewIssues(d) {
  const out = [];
  const say = (m) => { if (!out.includes(m)) out.push(m); };
  if (d.raw) { if (!/^kind:\s*["']?Task["']?\s*$/m.test(d.yaml)) say('The YAML needs a Task.'); return out; }
  /* Task */
  if (!LIVE_NAME_RE.test(liveDraftName(d))) say('The name can use lowercase letters, digits and hyphens, up to 63 characters.');
  const image = liveT(d.image);
  if (image && !LIVE_DIGEST_RE.test(image)) say('The image address must end in its digest: @sha256: and 64 characters.');
  if (liveT(d.command) && liveSplitArgs(liveT(d.command)).error) say(liveSplitArgs(liveT(d.command)).error);
  const env = liveRowsUsed(d.env, LIVE_ROW_KEYS.env).map(({ r }) => liveT(r.name));
  if (env.some((n) => !LIVE_ENV_NAME_RE.test(n))) say('Give each environment variable a name: letters, digits and underscores, not starting with a digit.');
  else if (new Set(env).size < env.length) say('Each environment variable needs its own name.');
  if (liveT(d.cpu) && !LIVE_CPU_RE.test(liveT(d.cpu))) say('Give the CPU as a number, like 2 or 500m.');
  if (liveT(d.memory) && !LIVE_MEM_RE.test(liveT(d.memory))) say('Give the memory with its unit, like 4Gi or 512Mi.');
  const cfg = liveConfigProblem(d);
  if (cfg) say(cfg);
  /* Workspace */
  const R = liveNewLists();
  if (d.ws === 'existing') {
    const w = liveNewWsDoc(d.existing);
    if (!d.existing) say('Pick a workspace, or choose None or New.');
    else if (w && w.status && w.status.phase === 'Failed') say(`The workspace ${d.existing} failed its setup. Pick another one.`);
    else if (!w && R.at && !R.error) say(`The workspace ${d.existing} isn't on this computer anymore. Pick another one.`);
  }
  if (d.ws === 'new') {
    const git = liveNewGit(d), mcp = liveNewMcp(d);
    const files = liveRowsUsed(d.files, LIVE_ROW_KEYS.files), skills = liveRowsUsed(d.skills, LIVE_ROW_KEYS.skills), setup = liveRowsUsed(d.setup, LIVE_ROW_KEYS.setup);
    if (!git.length && !files.length && !skills.length && !liveT(d.skillsPath) && !setup.length && !mcp.length && !d.setupGateway) say('Add something to the new workspace (a repo, a file, skills, a setup command or an MCP server), or choose None.');
    if (git.some((g) => !liveRepoHost(g.repo))) say('Each repo must be an https:// Git address.');
    if (git.some((g) => g.ref && (/\s/.test(g.ref) || g.ref.startsWith('-')))) say('Give each ref as a branch, tag or commit, without spaces.');
    if (git.some((g) => g.dir !== '.' && g.dir && !liveInsidePath(g.dir))) say('Give each repo folder as a path inside /workspace, like lib, or . for /workspace itself.');
    else if (new Set(git.map((g) => g.dir || g.name)).size < git.length) say('Each repo needs a folder of its own.');
    if (git.some((g) => g.depth && !/^\d{1,6}$/.test(g.depth))) say('Give the depth as a whole number, like 1 for the latest commit only.');
    if (files.some(({ r }) => { const p = liveT(r.path); return !liveInsidePath(p) || p.endsWith('/') || p === '.'; })) say('Give each file a path inside /workspace, like AGENTS.md.');
    if (skills.some(({ r }) => !liveT(r.provider))) say('Give each skills registry its provider.');
    if (liveT(d.skillsPath) && !d.skillsPath.trim().startsWith('/') && !liveInsidePath(liveT(d.skillsPath))) say('Give the skills folder as a path inside /workspace, like .ax/skills.');
    if (mcp.some((m) => !LIVE_MCP_NAME_RE.test(m.name))) say('Give each MCP server a name: letters, digits, dots, dashes and underscores.');
    else if (new Set(mcp.map((m) => m.name)).size < mcp.length) say('Each MCP server needs its own name.');
    if (mcp.some((m) => !m.local && !liveUrlParts(m.endpoint))) say('Give each remote MCP server its http:// or https:// address.');
    if (mcp.some((m) => m.local && (m.error || !m.command))) say('Give each local MCP server the command that starts it.');
  }
  /* Network */
  const needs = liveNewWsNeeds(d);
  if (d.net === 'allow') {
    const creds = liveNewCreds(d), tls = liveNewTls(d);
    if (!d.hosts.length && !tls.length && !creds.length && !needs.length) say('Add a host to allow, or choose No network.');
    if (creds.some((c) => !LIVE_HOST_RE.test(c.host))) say('Give each credential the host it is for, like api.github.com.');
    if (creds.some((c) => !LIVE_HEADER_RE.test(c.header))) say('Give each credential the header it sets, like Authorization.');
    if (creds.some((c) => !LIVE_SECRET_RE.test(c.secret) || c.secret.length > 253)) say('Give each credential its secret: lowercase letters, digits, dots and hyphens.');
    if (creds.some((c) => !LIVE_SECRET_KEY_RE.test(c.key))) say('Give each credential the key in its secret: letters, digits, dots, dashes and underscores.');
    if (creds.some((c, k) => creds.some((o, j) => j < k && o.host === c.host && o.header.toLowerCase() === c.header.toLowerCase()))) say('A host can get each header from one credential only.');
    const pc = d.creds.find((c) => c.preset);
    if (pc && !liveT(pc.value) && liveNewCredState(pc) === 'missing') say(`Add your ${pc.label || 'API key'}: it isn't stored on this computer yet.`);
    const both = creds.find((c) => tls.some((t) => t.host === c.host));
    if (both) say(`${both.host} can't both pass through and get a credential. Remove it from one of them.`);
  }
  if (d.net === 'existing') {
    if (!d.gateway) say('Pick a Gateway, or choose No network or Allow hosts.');
    else if (!liveNewGwDoc(d.gateway) && R.at && !R.error) say(`The Gateway ${d.gateway} isn't on this computer anymore. Pick another one.`);
  }
  if (d.net === 'none' && needs.length && !d.setupGateway) {
    say(`The workspace needs ${needs[0].host} to set up, and the task has no network. Choose Allow hosts under Network.`);
  }
  return out;
}

/* ---------- Writing YAML ---------- */
/** A string as YAML reads it back exactly: double-quoted, with escapes. */
function liveYQ(s) {
  return '"' + String(s).replace(/[\\"\x00-\x1f\x7f]/g, (c) => ({ '\\': '\\\\', '"': '\\"', '\n': '\\n', '\t': '\\t', '\r': '\\r' }[c] || `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`)) + '"';
}
/** One line as a quoted string; several lines as a block, indented `indent` spaces past the key. */
function liveYBlock(s, indent) {
  s = String(s);
  if (!s.includes('\n')) return liveYQ(s);
  const lines = s.replace(/\s+$/, '').split('\n');
  /* A block's first line sets its indentation, so one that starts with a space (or holds control characters) is quoted. */
  if (/^[ \t]/.test(lines.find((l) => l.trim()) || '') || /[\r\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(s)) return liveYQ(s);
  const pad = ' '.repeat(indent);
  return '|\n' + lines.map((l) => (l.trim() ? pad + l : '')).join('\n');
}
function liveIndent(text, n) { const pad = ' '.repeat(n); return text.split('\n').map((l) => (l ? pad + l : l)).join('\n'); }
const liveYList = (items) => `[${items.map(liveYQ).join(', ')}]`;
/** The new Gateway's rules, as items of spec.egress. uris are the secrets Studio just stored, by credential row. */
function liveNewEgress(d, uris) {
  if (d.net !== 'allow') return [];
  uris = uris || {};
  const out = [];
  const tls = liveNewTls(d), creds = liveNewCreds(d);
  const tlsHosts = tls.map((t) => t.host);
  const credHosts = [];
  creds.forEach((c) => { if (c.host && !credHosts.includes(c.host)) credHosts.push(c.host); });
  /* Passed through: TLS the Gateway forwards without reading. */
  [...new Set(tls.map((t) => t.port))].forEach((port) => {
    out.push(`- tlsPassthrough:\n    hostnames: ${liveYList(tls.filter((t) => t.port === port).map((t) => t.host))}\n    ports:\n      numbers: [${+port}]`);
  });
  /* A credential: HTTPS to its host, with the header replaced outside the sandbox. */
  credHosts.forEach((h) => {
    const heads = creds.filter((c) => c.host === h).map((c) => `    - header: ${liveYQ(c.header)}${c.prefix ? `\n      prefix: ${liveYQ(c.prefix)}` : ''}\n      credentialUri: ${liveYQ(uris[c.i] || liveCredUri(c))}`);
    out.push(`- https:\n    hostnames: [${liveYQ(h)}]\n    effects:\n      replaceHeaders:\n${liveIndent(heads.join('\n'), 4)}`);
  });
  /* The hosts you allowed, and what the workspace needs: HTTPS on 443, or the scheme and port of its address. */
  const plain = [];
  const add = (h) => { if (h && !plain.includes(h) && !credHosts.includes(h) && !tlsHosts.includes(h)) plain.push(h); };
  d.hosts.forEach(add);
  const needs = liveNewWsNeeds(d);
  needs.filter((n) => n.scheme === 'https' && !n.port).forEach((n) => add(n.host));
  if (plain.length) out.push(`- https:\n    hostnames: ${liveYList(plain)}`);
  const other = needs.filter((n) => !(n.scheme === 'https' && !n.port) && !credHosts.includes(n.host) && !tlsHosts.includes(n.host));
  [...new Set(other.map((n) => `${n.scheme}:${n.port}`))].forEach((k) => {
    const [scheme, port] = k.split(':');
    const hosts = other.filter((n) => `${n.scheme}:${n.port}` === k).map((n) => n.host);
    out.push(`- ${scheme}:\n    hostnames: ${liveYList(hosts)}${port ? `\n    ports:\n      numbers: [${+port}]` : ''}`);
  });
  return out;
}
/** The task's files: a Gateway and a Workspace when the form makes them, then the Task. goalField is "text" in
    current AX; it was "spec" until mid-November 2026. */
function liveNewYAML(d, goalField, uris) {
  const name = liveDraftName(d);
  const head = (kind, n) => `apiVersion: ax.io/v1alpha1\nkind: ${kind}\nmetadata:\n  name: ${liveYQ(n)}`;
  const docs = [];
  const goal = liveT(d.goal);

  /* Network: a new Gateway, one on this computer, or none (and then no network at all). */
  let gateway = d.net === 'existing' ? d.gateway : '';
  const egress = liveNewEgress(d, uris);
  if (egress.length) {
    gateway = liveOwnName('gw', d);
    docs.push(`${head('Gateway', gateway)}\nspec:\n  egress:\n${liveIndent(egress.join('\n'), 4)}`);
  }

  /* Workspace: a new one, one on this computer, or none (an empty /workspace). The fields are in AX's order. */
  let workspace = d.ws === 'existing' ? d.existing : '';
  if (d.ws === 'new') {
    workspace = liveOwnName('ws', d);
    const git = liveNewGit(d), mcp = liveNewMcp(d);
    const files = liveRowsUsed(d.files, LIVE_ROW_KEYS.files).map(({ r }) => r);
    const skills = liveRowsUsed(d.skills, LIVE_ROW_KEYS.skills).map(({ r }) => r);
    const setup = liveRowsUsed(d.setup, LIVE_ROW_KEYS.setup).map(({ r }) => liveT(r.cmd));
    let s = '';
    if (git.length) {
      s += `\n    git:\n${git.map((g) => `      - name: ${liveYQ(g.name)}\n        repo: ${liveYQ(g.repo)}${g.dir ? `\n        dir: ${liveYQ(g.dir)}` : ''}${g.depth ? `\n        depth: ${+g.depth}` : ''}${g.ref ? `\n        ref: ${liveYQ(g.ref)}` : ''}`).join('\n')}`;
    }
    if (files.length) s += `\n    files:\n${files.map((f) => `      - path: ${liveYQ(liveT(f.path))}\n        content: ${liveYBlock(String(f.content || ''), 10)}`).join('\n')}`;
    if (skills.length || liveT(d.skillsPath)) {
      s += '\n    skills:';
      if (skills.length) s += `\n      registries:\n${skills.map((k) => `        - provider: ${liveYQ(liveT(k.provider))}${liveT(k.project) ? `\n          project: ${liveYQ(liveT(k.project))}` : ''}${liveT(k.query) ? `\n          query: ${liveYQ(liveT(k.query))}` : ''}`).join('\n')}`;
      if (liveT(d.skillsPath)) s += `\n      path: ${liveYQ(liveT(d.skillsPath))}`;
    }
    if (setup.length) s += `\n    commands:\n${setup.map((c) => `      - ${liveYQ(c)}`).join('\n')}`;
    if (d.setupGateway) s += `\n    gateway:\n      name: ${liveYQ(d.setupGateway)}`;
    let y = `${head('Workspace', workspace)}\nspec:`;
    if (s) y += `\n  setup:${s}`;
    if (mcp.length) {
      y += `\n  mcp:\n    servers:\n${mcp.map((m) => `      - name: ${liveYQ(m.name)}${m.local
        ? `\n        command: ${liveYQ(m.command)}${m.args.length ? `\n        args: ${liveYList(m.args)}` : ''}`
        : `\n        endpoint: ${liveYQ(m.endpoint)}`}`).join('\n')}`;
    }
    if (!s && !mcp.length) y += ' {}';
    docs.push(y);
  }

  /* The Task, with its fields in AX's order. */
  const image = liveT(d.image), cpu = liveT(d.cpu), memory = liveT(d.memory);
  let t = `${head('Task', name)}\nspec:`;
  if (image || cpu || memory) {
    t += '\n  profile:';
    if (image) t += `\n    image: ${liveYQ(image)}`;
    if (cpu || memory) t += `\n    resources:\n      limits:${cpu ? `\n        cpu: ${liveYQ(cpu)}` : ''}${memory ? `\n        memory: ${liveYQ(memory)}` : ''}`;
  }
  const cmd = liveT(d.command) ? liveSplitArgs(liveT(d.command)).args : [];
  if (cmd.length) t += `\n  commands: ${liveYList(cmd)}`;
  const env = liveRowsUsed(d.env, LIVE_ROW_KEYS.env).map(({ r }) => [liveT(r.name), String(r.value || '')]);
  if (env.length) t += `\n  env:\n${env.map(([k, v]) => `    - name: ${liveYQ(k)}\n      value: ${liveYQ(v)}`).join('\n')}`;
  if (workspace) t += `\n  workspace:\n    name: ${liveYQ(workspace)}`;
  if (d.debug) t += '\n  debug: true';
  const config = String(d.config || '').replace(/\s+$/, '');
  const prompt = d.goalAsPrompt && goal ? `prompt: ${liveYBlock(goal, 2)}` : '';
  if (config.trim() || prompt) t += `\n  config:\n${liveIndent([config, prompt].filter((x) => x.trim()).join('\n'), 4)}`;
  if (goal) t += `\n  goal:\n    ${goalField || 'text'}: ${liveYBlock(goal, 6)}`;
  if (gateway) t += `\n  gateway:\n    name: ${liveYQ(gateway)}`;
  if (t.endsWith('\nspec:')) t += ' {}';
  docs.push(t);
  return docs.join('\n---\n') + '\n';
}
/** The Task's name in a file someone edited by hand. */
function liveYAMLTaskName(yaml) {
  const doc = String(yaml).split(/^---\s*$/m).find((x) => /^kind:\s*["']?Task["']?\s*$/m.test(x)) || '';
  const m = /^metadata:\s*\n(?:[ \t]+[^\n]*\n)*?[ \t]+name:\s*["']?([a-z0-9-]+)/m.exec(doc);
  return m ? m[1] : '';
}
/** The YAML for the panel: keys, strings and document breaks marked, a block's text left as it is. Each line is its own
    block indented by its own indentation, so a long line wraps under itself instead of off the side. */
function liveYAMLHTML(text) {
  let block = -1;
  return String(text).replace(/\n$/, '').split('\n').map((line) => {
    const ind = line.length - line.trimStart().length;
    const body = line.slice(ind);
    let html;
    if (block >= 0 && (!body || ind > block)) html = esc(body);
    else {
      block = -1;
      const m = /^((?:- )?)([A-Za-z_][\w.-]*)(:)(.*)$/.exec(body);
      if (/^---\s*$/.test(line)) html = `<span class="c">${esc(body)}</span>`;
      else if (!m) html = esc(body);
      else {
        if (/^\s*\|[-+]?\s*$/.test(m[4])) block = ind + m[1].length;
        html = `${esc(m[1])}<span class="k">${esc(m[2])}</span>${m[3]}${/^\s*["[]/.test(m[4]) ? `<span class="s">${esc(m[4])}</span>` : esc(m[4])}`;
      }
    }
    return `<span class="yl" style="--yi:${ind}">${html}</span>`;
  }).join('');
}

/* ---------- Creating it ---------- */
/** What ax apply said, or what to do about it when AX on this computer can't take part of the files yet. */
function liveNewApplyError(r) {
  const all = `${r.stderr || ''}\n${r.stdout || ''}`;
  if (/spec\.setup\.gateway is not supported yet/.test(all)) return "AX on this computer doesn't support a setup network yet. Set Setup network to None: setup then uses the task's own network.";
  if (/spec\.profile is not supported yet/.test(all)) return "AX on this computer doesn't support a profile on a workspace yet. Put the image and resources on the Task.";
  return liveLastLine(r.stderr || r.stdout) || 'ax apply failed.';
}
async function liveNewRun() {
  const d = LIVE.draft;
  if (!d || d.busy) return;
  const issues = liveNewIssues(d);
  if (issues.length) { d.error = issues[0]; render({ keepScroll: true }); announce(issues[0]); return; }
  const ctx = LIVE.context;
  const scope = ['--context', ctx, '-a', LIVE.atespace];
  const step = (text) => { d.busy = text; d.error = ''; render({ keepScroll: true }); };
  try {
    /* Keys you typed are stored on the cluster first: the Gateway reads them from there, so they never go in the files. */
    const uris = {};
    const keys = liveNewCreds(d).filter((c) => c.value);
    for (const c of keys) {
      step(keys.length > 1 ? 'Storing the keys…' : 'Storing the key…');
      uris[c.i] = (await studioPost('/api/secrets/credential', { context: ctx, name: c.secret, key: c.key, value: c.value })).credentialUri || '';
      d.creds[c.i].value = '';
      (LIVE.credStatus = LIVE.credStatus || {})[`${c.secret}/${c.key}`] = { state: 'stored', at: Date.now() };
    }
    step('Creating the task…');
    const made = [];
    const apply = async (field) => {
      const res = await studioApi.ax(scope.concat(['apply', '-f', '-']), d.raw ? d.yaml : liveNewYAML(d, field, uris));
      for (const m of String(res.stdout || '').matchAll(/^(gateway|workspace)\.ax\.io\/(\S+) created$/gm)) made.push([m[1], m[2]]);
      return res;
    };
    let r = await apply('text');
    if (r.status !== 0 && !d.raw && /unknown field "text"/.test(`${r.stderr}${r.stdout}`)) r = await apply('spec');
    if (r.status !== 0) {
      /* ax apply stops at the first file AX refuses. What it made before that goes again, so trying again starts clean. */
      for (const [kind, name] of made.reverse()) {
        try { await studioPost(`/api/${kind}s/delete`, { context: ctx, atespace: LIVE.atespace, name }); } catch (e) { /* Home lists it as unused */ }
      }
      throw new Error(liveNewApplyError(r));
    }
    const created = d.raw ? liveYAMLTaskName(d.yaml) : liveDraftName(d);
    if (!d.raw && d.ws === 'new') liveNewGit(d).reverse().forEach((g) => liveRememberRepo(g.repo));
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

/* ---------- The page: pieces shared by the sections ---------- */
/** One field in a list row. Its id keeps focus on it when the page is drawn again. */
function liveNewCell(kind, i, k, value, o) {
  o = o || {};
  return `<input class="input${o.mono === false ? '' : ' mono'}" type="${o.type || 'text'}" id="nt-${kind}-${i}-${k}" data-live-new-row="${kind}" data-i="${i}" data-k="${k}" value="${esc(value || '')}" placeholder="${esc(o.ph || '')}"${o.label ? ` aria-label="${esc(o.label)}"` : ''} autocomplete="off" spellcheck="false"${o.attrs || ''}>`;
}
/** A field with its label beside it, in a list row. */
function liveNewLabeled(label, cell, cls) { return `<label class="nt-f${cls ? ' ' + cls : ''}"><span>${label}</span>${cell}</label>`; }
function liveNewDel(kind, i, label) {
  return `<button type="button" class="btn ghost sm icon" data-action="live-new-row-del" data-kind="${kind}" data-i="${i}" aria-label="${esc(label)}">${icon('x', 'sm')}</button>`;
}
function liveNewAdd(kind, label) {
  return `<button type="button" class="btn ghost sm nt-add-row" data-action="live-new-row-add" data-kind="${kind}">${icon('plus', 'sm')}${label}</button>`;
}
function liveNewSeg(group, labelledby, value, options) {
  return `<div class="seg" role="radiogroup" aria-labelledby="${labelledby}">${options.map(([v, label]) => `<button type="button" role="radio" aria-checked="${value === v}" data-action="live-new-${group}" data-${group}="${v}">${label}</button>`).join('')}</div>`;
}

/* ---------- Task ---------- */
function liveNewSizesHTML(d) {
  return Object.keys(LIVE_SIZES).map((k) => {
    const S = LIVE_SIZES[k];
    return `<button type="button" class="pill" aria-pressed="${liveT(d.cpu) === S.cpu && liveT(d.memory) === S.memory}" data-action="live-new-size" data-size="${k}" title="${S.cpu} CPU, ${S.memory} memory">${S.label}</button>`;
  }).join('');
}
function liveNewEnvHTML(d) {
  const rows = d.env.map((e, i) => `<div class="nt-row nt-env" data-row="env">
      ${liveNewCell('env', i, 'name', e.name, { ph: 'NAME', label: `Variable ${i + 1}: name` })}<span class="nt-eq" aria-hidden="true">=</span>
      ${liveNewCell('env', i, 'value', e.value, { ph: 'value', label: `Variable ${i + 1}: value` })}${liveNewDel('env', i, `Remove variable ${i + 1}`)}</div>`).join('');
  return `<div class="nt-rows" role="group" aria-labelledby="nt-env-l">${rows}${liveNewAdd('env', 'Add a variable')}</div>
    <span class="prow-hint">${icon('lock', 'xs')} Stored in plain text, so no keys or passwords: add those as credentials under Network.</span>`;
}
function liveNewAdvTaskSummary(d) {
  const A = LIVE_AGENTS[(LIVE_PRESETS[d.preset] || {}).agent];
  const img = !liveT(d.image) ? 'Default image' : (A && liveT(d.image) === A.image ? A.name : liveImageShort(liveT(d.image)));
  const res = `${liveT(d.cpu) || '1'} CPU · ${liveT(d.memory) || '512Mi'}`;
  const envN = d.env.filter((e) => liveT(e.name) || liveT(e.value)).length;
  const parts = [res, d.debug ? 'Debug on' : 'Debug off'];
  if (envN) parts.push(`${envN} env`);
  if (liveT(d.config) || d.goalAsPrompt) parts.push('Config');
  return `<span class="acc-pill">${esc(img)}</span><span class="acc-meta">${esc(parts.join(' · '))}</span>`;
}
function liveNewTaskHTML(d) {
  const isAgent = !!(LIVE_PRESETS[d.preset] || {}).agent;
  const essential = [
    prow('Goal', `<textarea class="textarea" id="live-new-goal" data-live-new="goal" rows="3" placeholder="e.g. Fix the flaky tests in tests/ and explain the cause. Done when: they pass 10 runs in a row." aria-labelledby="nt-goal-l" aria-describedby="nt-goal-h">${esc(d.goal)}</textarea>
      <span class="prow-hint" id="nt-goal-h">${isAgent ? 'Optional. What the agent should work on.' : 'Optional. What the task should do, in your words.'}</span>`, { labelId: 'nt-goal-l', sub: liveField('spec.goal.text') }),
    prow('Name', `<input class="input mono" type="text" id="live-new-name" data-live-new="name" value="${esc(liveDraftName(d))}" aria-labelledby="nt-name-l" aria-describedby="nt-name-h" autocomplete="off" spellcheck="false">
      <span class="prow-hint" id="nt-name-h">Lowercase letters, digits and hyphens. Made from the goal above until you edit it.</span>`, { labelId: 'nt-name-l', sub: liveField('metadata.name') }),
  ];
  const advanced = [
    prow('Image', `<input class="input mono" type="text" id="live-new-image" data-live-new="image" value="${esc(d.image)}" placeholder="The cluster's default task image" aria-labelledby="nt-image-l" aria-describedby="nt-image-h" autocomplete="off" spellcheck="false">
      <span class="prow-hint" id="nt-image-h">Pinned by its digest (<span class="mono">name@sha256:…</span>). Empty uses the cluster's default task image.</span>`, { labelId: 'nt-image-l', sub: liveField('spec.profile.image') }),
    prow('Command', `<input class="input mono" type="text" id="live-new-command" data-live-new="command" value="${esc(d.command)}" placeholder="The image's own command" aria-labelledby="nt-command-l" aria-describedby="nt-command-h" autocomplete="off" spellcheck="false">
      <span class="prow-hint" id="nt-command-h">As in a shell, quotes keep spaces. Empty runs the image's own command; <span class="mono">sleep infinity</span> keeps the sandbox open for a shell.</span>`, { labelId: 'nt-command-l', sub: liveField('spec.commands') }),
    prow('Resources', `<div class="nt-res">
        <label class="nt-f"><span>CPU</span><input class="input mono" type="text" id="live-new-cpu" data-live-new="cpu" value="${esc(d.cpu)}" placeholder="1" autocomplete="off" spellcheck="false"></label>
        <label class="nt-f"><span>Memory</span><input class="input mono" type="text" id="live-new-memory" data-live-new="memory" value="${esc(d.memory)}" placeholder="512Mi" autocomplete="off" spellcheck="false"></label>
        <div class="pills" id="live-new-sizes" role="group" aria-label="Sizes">${liveNewSizesHTML(d)}</div></div>
      <span class="prow-hint">The sandbox's limits. Empty uses AX's defaults: 1 CPU and 512 MiB.</span>`, { labelId: 'nt-res-l', sub: liveField('spec.profile.resources') }),
    prow('Environment', liveNewEnvHTML(d), { labelId: 'nt-env-l', sub: liveField('spec.env') }),
    prow('Config', `<textarea class="textarea mono" id="live-new-config" data-live-new="config" rows="${d.config ? 3 : 2}" placeholder="key: value" aria-labelledby="nt-config-l" aria-describedby="nt-config-h" spellcheck="false">${esc(d.config)}</textarea>
      <label class="nt-check"><input type="checkbox" id="live-new-goal-prompt" data-action="live-new-goal-prompt" ${d.goalAsPrompt ? 'checked' : ''}> Pass the goal as <span class="mono">prompt</span> too</label>
      <span class="prow-hint" id="nt-config-h">Optional. Settings for the runner in the image, as YAML. Stored in plain text, so no secrets.</span>`, { labelId: 'nt-config-l', sub: liveField('spec.config') }),
    prow('Debug access', `<label class="toggle-line"><span class="tl-text"><b>Let Studio open a shell in the sandbox</b><span>A shell with <span class="mono">ax ssh</span>, in Terminal. Off keeps the sandbox closed.</span></span>
        <span class="switch"><input type="checkbox" role="switch" id="live-new-debug" data-action="live-new-debug" ${d.debug ? 'checked' : ''} aria-label="Debug access"><span class="track"></span><span class="thumb"></span></span></label>`, { labelId: 'nt-debug-l', sub: liveField('spec.debug') }),
  ];
  return `<div class="panel nt-panel">${essential.join('')}</div>
    <details class="setup-acc nt-adv" id="live-new-adv-task" ${d.advTaskOpen ? 'open' : ''}>
      <summary class="setup-acc-head">
        <span class="acc-ic" aria-hidden="true">${icon('sliders', 'sm')}</span>
        <span class="acc-copy"><span class="acc-title">Advanced task options</span><span class="acc-sub" id="live-new-adv-task-sum">${liveNewAdvTaskSummary(d)}</span></span>
        ${icon('chevRight', 'sm acc-chev')}
      </summary>
      <div class="nt-adv-body">${advanced.join('')}</div>
    </details>`;
}

/* ---------- Workspace ---------- */
const LIVE_WS_LOOK = { Ready: ['checkCircle', 'Ready'], Preparing: ['loader', 'Setting up'], Failed: ['xCircle', 'Setup failed'] };
/** The workspaces on this computer to start from, in a picker, with what the one you picked says. */
function liveNewExistingHTML(d) {
  const R = liveNewLists();
  if (!R.at && !R.workspaces.length) return R.error ? `<span class="prow-hint nt-warn">Couldn't read the workspaces on this computer: ${esc(R.error)}</span>` : `<span class="prow-hint">${icon('loader', 'xs')} Reading the workspaces on this computer…</span>`;
  if (R.error && !R.workspaces.length) return `<span class="prow-hint nt-warn">Couldn't read the workspaces on this computer: ${esc(R.error)}</span>`;
  const list = R.workspaces.slice().sort((a, b) => liveResNameOf(a).localeCompare(liveResNameOf(b)));
  if (!list.length) return '<span class="prow-hint">There are no workspaces on this computer yet. Choose New to make one.</span>';
  const opts = [{ value: '', name: 'Pick a workspace', lead: icon('folder', 'sm') }].concat(list.map((w) => {
    const look = LIVE_WS_LOOK[(w.status || {}).phase] || ['folder', ''];
    const repos = ((w.spec && w.spec.setup && w.spec.setup.git) || []).map((g) => liveRepoShort(g.repo || ''));
    return { value: liveResNameOf(w), name: liveResNameOf(w), lead: icon(look[0], 'sm'), sub: esc([look[1], repos.slice(0, 2).join(', ')].filter(Boolean).join(' · ')) };
  }));
  const pick = liveNewWsDoc(d.existing);
  const st = (pick && pick.status) || {};
  const note = !pick ? 'The task starts with what the workspace sets up: its repos, files, skills and setup commands, and its MCP servers.'
    : st.phase === 'Failed' ? `Its setup failed${st.lastSetupError ? `: ${esc(st.lastSetupError)}` : ''}. A task that uses it fails too.`
      : st.phase === 'Preparing' ? 'Its setup is still running. The task starts once it is ready.'
        : 'The task starts with what it sets up: its repos, files, skills and setup commands, and its MCP servers.';
  return `${selectHTML({ key: 'live-new-ws-pick', label: 'Workspace', value: d.existing, options: opts, btnClass: 'btn' })}
    <span class="prow-hint"${st.phase === 'Failed' ? ' style="color:var(--fail)"' : ''}>${note}</span>`;
}
function liveNewGwOptions(empty) {
  return [{ value: '', name: empty, lead: icon('shield', 'sm') }].concat(liveNewLists().gateways.slice().sort((a, b) => liveResNameOf(a).localeCompare(liveResNameOf(b))).map((g) => {
    const hosts = liveNewGwHosts(g);
    return { value: liveResNameOf(g), name: liveResNameOf(g), lead: icon('shield', 'sm'), sub: esc(hosts.length ? `${hosts.slice(0, 2).join(', ')}${hosts.length > 2 ? ` and ${hosts.length - 2} more` : ''}` : 'No hosts') };
  }));
}
function liveNewSetupGwHTML(d) {
  const R = liveNewLists();
  return `${selectHTML({ key: 'live-new-setup-gw', label: 'Setup network', value: d.setupGateway, options: liveNewGwOptions("None: the task's network"), btnClass: 'btn' })}
    ${R.loading && !R.at ? `<span class="prow-hint">${icon('loader', 'xs')} Reading the Gateways on this computer…</span>` : ''}
    <span class="prow-hint${d.setupGateway ? ' nt-warn' : ''}">A Gateway only setup uses, for private repos or package registries. AX on this computer doesn't support one yet: it sets the workspace up inside the task's sandbox, on the task's network.</span>`;
}
function liveRecentPillsHTML(d) {
  const recent = liveRecentRepos();
  const used = d.git.map((g) => liveT(g.repo));
  return recent.length ? `<span class="gh-label">Recent</span>${recent.map((r) => `<button type="button" class="pill mono" aria-pressed="${used.includes(r)}" data-action="live-new-repo-pick" data-repo="${esc(r)}" title="${esc(r)}">${esc(liveRepoShort(r))}</button>`).join('')}` : '';
}
/** What an empty Folder means for a repo row: "." for the first repo, else the repo's name. */
function liveNewDirHint(d, i) {
  return d.git.slice(0, i).some((g) => LIVE_ROW_KEYS.git.some((k) => liveT(g[k]))) ? liveRepoBase(d.git[i].repo) || 'repo' : '.';
}
function liveNewAdvWsSummary(d) {
  const parts = [];
  const fn = d.files.filter((f) => liveT(f.path) || liveT(f.content)).length;
  const sn = d.skills.filter((s) => liveT(s.provider) || liveT(s.project) || liveT(s.query)).length;
  const mn = d.mcp.filter((m) => liveT(m.name) || liveT(m.endpoint) || liveT(m.command)).length;
  if (fn) parts.push(plural(fn, 'file'));
  if (sn) parts.push(plural(sn, 'skills registry', 'skills registries'));
  if (d.setupGateway) parts.push('setup network');
  if (mn) parts.push(plural(mn, 'MCP server'));
  return parts.length ? `<span class="acc-pill custom">${esc(parts.join(' · '))}</span>`
    : '<span class="acc-meta">Files, skills, setup network, MCP servers</span>';
}
function liveNewWsNewHTML(d) {
  const git = d.git.map((g, i) => `<div class="nt-item" data-row="git">
      <div class="nt-line">${liveNewCell('git', i, 'repo', g.repo, { type: 'url', ph: 'https://github.com/you/project.git', label: `Repo ${i + 1}: address` })}${liveNewDel('git', i, `Remove repo ${i + 1}`)}</div>
      <div class="nt-line nt-small">${liveNewLabeled('Ref', liveNewCell('git', i, 'ref', g.ref, { ph: 'main' }))}${liveNewLabeled('Folder', liveNewCell('git', i, 'dir', g.dir, { ph: liveNewDirHint(d, i) }))}${liveNewLabeled('Depth', liveNewCell('git', i, 'depth', g.depth, { type: 'number', ph: 'All', attrs: ' min="0"' }), 'nt-depth')}</div></div>`).join('');
  const files = d.files.map((f, i) => `<div class="nt-item" data-row="file">
      <div class="nt-line">${liveNewCell('files', i, 'path', f.path, { ph: 'AGENTS.md', label: `File ${i + 1}: path in /workspace` })}${liveNewDel('files', i, `Remove file ${i + 1}`)}</div>
      <textarea class="textarea mono" rows="3" id="nt-files-${i}-content" data-live-new-row="files" data-i="${i}" data-k="content" placeholder="What the file says" aria-label="File ${i + 1}: content" spellcheck="false">${esc(f.content)}</textarea></div>`).join('');
  const skills = d.skills.map((k, i) => `<div class="nt-item" data-row="skill">
      <div class="nt-line nt-small">${liveNewLabeled('Provider', liveNewCell('skills', i, 'provider', k.provider, { ph: 'github' }))}${liveNewLabeled('Project', liveNewCell('skills', i, 'project', k.project, { ph: 'acme/skills' }))}${liveNewDel('skills', i, `Remove skills registry ${i + 1}`)}</div>
      ${liveNewLabeled('Query', liveNewCell('skills', i, 'query', k.query, { ph: 'Which skills, like review' }), 'nt-wide')}</div>`).join('');
  const setup = d.setup.map((c, i) => `<div class="nt-row nt-cmd" data-row="setup">${liveNewCell('setup', i, 'cmd', c.cmd, { ph: 'npm ci', label: `Setup command ${i + 1}` })}${liveNewDel('setup', i, `Remove setup command ${i + 1}`)}</div>`).join('');
  const cmds = d.setup.map((c) => liveT(c.cmd));
  const mcp = d.mcp.map((m, i) => `<div class="nt-item" data-row="mcp">
      <div class="nt-line">${liveNewCell('mcp', i, 'name', m.name, { ph: 'github', label: `MCP server ${i + 1}: name` })}
        <div class="seg sm" role="radiogroup" aria-label="MCP server ${i + 1}: where it runs">
          <button type="button" role="radio" aria-checked="${m.kind !== 'local'}" data-action="live-new-mcp-kind" data-i="${i}" data-kind="remote">Remote</button>
          <button type="button" role="radio" aria-checked="${m.kind === 'local'}" data-action="live-new-mcp-kind" data-i="${i}" data-kind="local">Local</button></div>
        ${liveNewDel('mcp', i, `Remove MCP server ${i + 1}`)}</div>
      ${m.kind === 'local' ? liveNewCell('mcp', i, 'command', m.command, { ph: 'npx -y @modelcontextprotocol/server-filesystem /workspace', label: `MCP server ${i + 1}: command and arguments` })
    : liveNewCell('mcp', i, 'endpoint', m.endpoint, { type: 'url', ph: 'https://mcp.example.com/mcp', label: `MCP server ${i + 1}: address` })}</div>`).join('');
  const recent = liveRecentPillsHTML(d);
  const hasAdvWs = d.files.length > 0 || d.skills.length > 0 || !!d.setupGateway || d.mcp.length > 0;
  return `<div class="panel nt-panel">
    ${prow('Git repos', `<div class="nt-rows" role="group" aria-labelledby="nt-git-l">${git}${liveNewAdd('git', 'Add a repo')}</div>
      <div class="pills" id="live-recent" role="group" aria-label="Recent repos"${recent ? '' : ' hidden'}>${recent}</div>
      <span class="prow-hint">Cloned over https. Ref is a branch, tag or commit (empty means main). The first repo goes in <span class="mono">/workspace</span> itself unless you give it a folder.</span>`, { labelId: 'nt-git-l', sub: liveField('spec.setup.git') })}
    ${prow('Setup commands', `<div class="nt-rows" role="group" aria-labelledby="nt-setup-l">${setup}${liveNewAdd('setup', 'Add a command')}</div>
      <div class="pills" role="group" aria-label="Common setup commands">${LIVE_SETUP_PICKS.map((c) => `<button type="button" class="pill mono" data-action="live-new-setup-pick" data-cmd="${esc(c)}" aria-pressed="${cmds.includes(c)}">${icon('plus', 'xs')}${esc(c)}</button>`).join('')}</div>
      <span class="prow-hint">Run in order, in <span class="mono">/workspace</span>. They download over the task's network, so allow what they need under Network.</span>`, { labelId: 'nt-setup-l', sub: liveField('spec.setup.commands') })}
  </div>
  <details class="setup-acc nt-adv" id="live-new-adv-ws" ${d.advWsOpen || hasAdvWs ? 'open' : ''}>
    <summary class="setup-acc-head">
      <span class="acc-ic" aria-hidden="true">${icon('folder', 'sm')}</span>
      <span class="acc-copy"><span class="acc-title">More workspace options</span><span class="acc-sub" id="live-new-adv-ws-sum">${liveNewAdvWsSummary(d)}</span></span>
      ${icon('chevRight', 'sm acc-chev')}
    </summary>
    <div class="nt-adv-body">
      ${prow('Files', `<div class="nt-rows" role="group" aria-labelledby="nt-files-l">${files}
          <div class="btn-row">${liveNewAdd('files', 'Add a file')}${d.files.some((f) => liveT(f.path) === 'AGENTS.md') ? '' : '<button type="button" class="pill mono" data-action="live-new-row-add" data-kind="files" data-path="AGENTS.md">AGENTS.md</button>'}</div></div>
        <span class="prow-hint">Written into <span class="mono">/workspace</span>, after the repos are cloned.</span>`, { labelId: 'nt-files-l', sub: liveField('spec.setup.files') })}
      ${prow('Skills', `<div class="nt-rows" role="group" aria-labelledby="nt-skills-l">${skills}${liveNewAdd('skills', 'Add a registry')}</div>
        <label class="nt-f nt-wide"><span>Folder</span><input class="input mono" type="text" id="live-new-skills-path" data-live-new="skillsPath" value="${esc(d.skillsPath)}" placeholder=".ax/skills" autocomplete="off" spellcheck="false"></label>
        <span class="prow-hint">Skills from registries, fetched into the folder (empty means <span class="mono">.ax/skills</span> in the workspace).</span>`, { labelId: 'nt-skills-l', sub: liveField('spec.setup.skills') })}
      ${prow('Setup network', `<div id="live-new-setup-gw" class="nt-pick">${liveNewSetupGwHTML(d)}</div>`, { labelId: 'nt-setup-gw-l', sub: liveField('spec.setup.gateway') })}
      ${prow('MCP servers', `<div class="nt-rows" role="group" aria-labelledby="nt-mcp-l">${mcp}${liveNewAdd('mcp', 'Add an MCP server')}</div>
        <span class="prow-hint">Tools an agent can call: a remote server by its address, or a local one by the command that starts it in the sandbox.</span>`, { labelId: 'nt-mcp-l', sub: liveField('spec.mcp.servers') })}
    </div>
  </details>`;
}
function liveNewWorkspaceHTML(d) {
  const seg = liveNewSeg('ws', 'nt-ws-h', d.ws, [['none', 'None'], ['existing', 'Use existing'], ['new', 'New']]);
  let body;
  if (d.ws === 'existing') body = `<div class="panel nt-panel">${prow('Workspace', `<div id="live-ws-existing" class="stretch nt-pick">${liveNewExistingHTML(d)}</div>`, { labelId: 'nt-wsx-l', sub: liveField('spec.workspace.name') })}</div>`;
  else if (d.ws === 'new') body = liveNewWsNewHTML(d);
  else body = '<p class="prow-hint nt-none">The task starts in an empty <span class="mono">/workspace</span>.</p>';
  return `<div class="nt-choice">${seg}</div>${body}`;
}

/* ---------- Network ---------- */
function liveNewChip(list, h, removable) {
  return removable ? `<span class="nt-chip"><span class="mono">${esc(h)}</span><button type="button" class="nt-chip-x" data-action="live-new-${list}-del" data-host="${esc(h)}" aria-label="Remove ${esc(h)}">${icon('x', 'xs')}</button></span>`
    : `<span class="nt-chip auto" title="The workspace needs it to set up"><span class="mono">${esc(h)}</span><span class="nt-chip-why">for the workspace</span></span>`;
}
/** The hosts the new Gateway allows: yours, and what the workspace needs. */
function liveNewHostsHTML(d) {
  const creds = liveNewCreds(d).map((c) => c.host), tls = liveNewTls(d).map((t) => t.host);
  const auto = liveNewWsNeeds(d).filter((n) => !d.hosts.includes(n.host) && !creds.includes(n.host) && !tls.includes(n.host)).map((n) => n.host + (n.port ? `:${n.port}` : ''));
  const chips = d.hosts.map((h) => liveNewChip('host', h, true)).concat([...new Set(auto)].map((h) => liveNewChip('host', h, false)));
  return chips.length ? chips.join('') : '<span class="prow-hint">No hosts yet.</span>';
}
function liveNewCredsHTML(d) {
  return d.creds.map((c, i) => {
    const uri = liveCredUri({ secret: liveT(c.secret) || '<secret>', key: liveT(c.key) || '<key>' });
    return `<div class="nt-item nt-cred" data-row="cred">
      <div class="nt-line nt-small">${liveNewLabeled('Host', liveNewCell('creds', i, 'host', c.host, { ph: 'api.github.com' }), 'nt-grow')}${liveNewDel('creds', i, `Remove credential ${i + 1}`)}</div>
      <div class="nt-line nt-small">${liveNewLabeled('Header', liveNewCell('creds', i, 'header', c.header, { ph: 'Authorization' }))}${liveNewLabeled('Prefix', liveNewCell('creds', i, 'prefix', c.prefix, { ph: 'Bearer ' }))}</div>
      <div class="nt-line nt-small">${liveNewLabeled('Secret', liveNewCell('creds', i, 'secret', c.secret, { ph: 'github-token' }))}${liveNewLabeled('Key', liveNewCell('creds', i, 'key', c.key, { ph: 'token' }))}</div>
      ${liveNewLabeled(esc(c.label || 'Value'), liveNewCell('creds', i, 'value', c.value, { type: 'password', ph: "Leave empty if it's already stored" }), 'nt-wide')}
      <span class="prow-hint nt-uri" id="nt-creds-${i}-uri">${icon('lock', 'xs')} A value you type is stored as that secret on the cluster. <span class="mono">${esc(uri)}</span></span></div>`;
  }).join('');
}
function liveNewGwExistingHTML(d) {
  const R = liveNewLists();
  if (!R.at && !R.gateways.length) return R.error ? `<span class="prow-hint nt-warn">Couldn't read the Gateways on this computer: ${esc(R.error)}</span>` : `<span class="prow-hint">${icon('loader', 'xs')} Reading the Gateways on this computer…</span>`;
  if (!R.gateways.length) return '<span class="prow-hint">There are no Gateways on this computer yet. Choose Allow hosts to make one.</span>';
  const doc = liveNewGwDoc(d.gateway);
  let note = 'The task gets a copy of its rules when it starts. Later changes to the Gateway don\'t reach it.';
  if (doc) {
    const hosts = liveNewGwHosts(doc);
    const miss = liveNewWsNeeds(d).filter((n) => !liveHostCovered(n.host, hosts));
    note = `${hosts.length ? `It allows ${esc(hosts.slice(0, 4).join(', '))}${hosts.length > 4 ? ` and ${hosts.length - 4} more` : ''}.` : 'It allows no hosts.'} ${note}`;
    if (miss.length) note += ` <span class="nt-warn">It doesn't allow ${esc(miss.map((n) => n.host).join(', '))}, which the workspace needs to set up.</span>`;
  }
  return `${selectHTML({ key: 'live-new-gw-pick', label: 'Gateway', value: d.gateway, options: liveNewGwOptions('Pick a Gateway'), btnClass: 'btn' })}<span class="prow-hint">${note}</span>`;
}
/* ---------- Is the agent's key already stored? ----------
   A preset's Gateway rule reads its key from a secret on the cluster. Studio asks the server whether that secret and key
   exist (key names only, never values), so a first task says up front when the key is still missing. */
function liveNewCredState(c) {
  const k = `${c.secret}/${c.key}`;
  return ((LIVE.credStatus = LIVE.credStatus || {})[k] || {}).state || 'unknown';
}
async function liveNewCredCheck(d) {
  if (!d || d.raw || d.net !== 'allow' || !LIVE.context) return;
  const c = d.creds.find((x) => x.preset);
  if (!c || !c.secret || !c.key) return;
  const all = (LIVE.credStatus = LIVE.credStatus || {});
  const k = `${c.secret}/${c.key}`;
  const cur = all[k];
  if (cur && (cur.state === 'loading' || Date.now() - cur.at < 30000)) return;
  all[k] = { state: 'loading', at: Date.now() };
  let state = 'unknown';
  try { const r = await studioApi.credentialStatus(LIVE.context, c.secret, c.key); state = r && r.hasKey ? 'stored' : 'missing'; } catch (e) { state = 'unknown'; }
  all[k] = { state, at: Date.now() };
  if (LIVE.draft === d && liveRouteIs('new')) liveNewRefreshParts(d, 'creds');
}
function liveRouteIs(top) { return typeof parseRoute === 'function' && parseRoute().parts[0] === top; }
function liveNewKeyPlaceholder(c) {
  const st = liveNewCredState(c);
  return st === 'stored' ? 'Already stored: leave empty to use it' : st === 'missing' ? `Paste your ${c.label || 'API key'}` : "Leave empty if it's already stored";
}
function liveNewKeyHintHTML(c) {
  const where = `<span class="mono">${esc(c.secret)}/${esc(c.key)}</span>`;
  const st = liveNewCredState(c);
  if (c.value) return `${icon('lock', 'xs')} Create task stores it on the cluster as ${where}. The Gateway adds it outside the sandbox.`;
  if (st === 'stored') return `${icon('checkCircle', 'xs')} Already stored on the cluster as ${where}. Leave this empty to use it, or type a new key to replace it.`;
  if (st === 'missing') return `${icon('alert', 'xs')} Not stored on this computer yet. Paste it here: Studio stores it as ${where}, and the Gateway adds it outside the sandbox.`;
  return `${icon('lock', 'xs')} Stored on the cluster as ${where} and injected outside the sandbox by the Gateway.`;
}
function liveNewAdvNetSummary(d) {
  const parts = [];
  if (d.creds.length) parts.push(plural(d.creds.length, 'credential rule'));
  if (d.tls.length) parts.push(`${d.tls.length} TLS pass-through`);
  return parts.length ? `<span class="acc-pill">${esc(parts.join(' · '))}</span>`
    : '<span class="acc-meta">Credential headers &amp; TLS pass-through</span>';
}
function liveNewNetworkHTML(d) {
  const seg = liveNewSeg('net', 'nt-net-h', d.net, [['none', 'No network'], ['allow', 'Allow hosts'], ['existing', 'Use existing']]);
  let body;
  if (d.net === 'allow') {
    const picks = LIVE_HOST_PICKS.map((p) => `<button type="button" class="pill" data-action="live-new-host-pick" data-pick="${p.id}" aria-pressed="${p.hosts.every((h) => d.hosts.includes(h))}" title="${esc(p.hosts.join(', '))}">${icon('plus', 'xs')}${p.label}</button>`).join('');
    const pIdx = d.creds.findIndex((c) => c.preset);
    const pCred = pIdx >= 0 ? d.creds[pIdx] : null;
    const presetKeyRow = pCred ? prow(esc(pCred.label || 'API key'), `<input class="input mono" type="password" id="live-new-preset-key" data-live-new-row="creds" data-i="${pIdx}" data-k="value" value="${esc(pCred.value)}" placeholder="${esc(liveNewKeyPlaceholder(pCred))}" aria-labelledby="nt-pkey-l" aria-describedby="live-new-preset-key-hint" autocomplete="off" spellcheck="false">
      <span class="prow-hint" id="live-new-preset-key-hint">${liveNewKeyHintHTML(pCred)}</span>`, { labelId: 'nt-pkey-l', sub: liveField('effects.replaceHeaders') }) : '';
    const hasCustomCreds = d.creds.some((c) => !c.preset);
    body = `<div class="panel nt-panel">
      ${presetKeyRow}
      ${prow('Hosts', `<div class="nt-chips" id="live-new-hosts">${liveNewHostsHTML(d)}</div>
        <div class="nt-add"><input class="input mono" type="text" id="live-new-host" data-live-new="hostIn" value="${esc(d.hostIn)}" placeholder="docs.example.com" aria-labelledby="nt-hosts-l" autocomplete="off" spellcheck="false"><button type="button" class="btn sm" data-action="live-new-host-add">Allow</button></div>
        <div class="pills" role="group" aria-label="Common hosts">${picks}</div>
        <span class="prow-hint">HTTPS to these hosts only. <span class="mono">*.example.com</span> covers one level of subdomains.</span>`, { labelId: 'nt-hosts-l', sub: liveField('egress[].https') })}
    </div>
    <details class="setup-acc nt-adv" id="live-new-adv-net" ${d.advNetOpen || hasCustomCreds ? 'open' : ''}>
      <summary class="setup-acc-head">
        <span class="acc-ic" aria-hidden="true">${icon('shield', 'sm')}</span>
        <span class="acc-copy"><span class="acc-title">Advanced network options</span><span class="acc-sub" id="live-new-adv-net-sum">${liveNewAdvNetSummary(d)}</span></span>
        ${icon('chevRight', 'sm acc-chev')}
      </summary>
      <div class="nt-adv-body">
        ${prow('Credentials', `<div class="nt-rows" role="group" aria-labelledby="nt-creds-l">${liveNewCredsHTML(d)}${liveNewAdd('creds', 'Add a header from a secret')}</div>
          <span class="prow-hint">The task sends the header with any placeholder value. The Gateway puts the secret in outside the sandbox, so the task never holds it.</span>`, { labelId: 'nt-creds-l', sub: liveField('effects.replaceHeaders') })}
        ${prow('Pass through', `<div class="nt-chips" id="live-new-tls-list">${d.tls.length ? d.tls.map((h) => liveNewChip('tls', h, true)).join('') : '<span class="prow-hint">None.</span>'}</div>
          <div class="nt-add"><input class="input mono" type="text" id="live-new-tls" data-live-new="tlsIn" value="${esc(d.tlsIn)}" placeholder="pinned.example.com" aria-labelledby="nt-tls-l" autocomplete="off" spellcheck="false"><button type="button" class="btn sm" data-action="live-new-tls-add">Add</button></div>
          <span class="prow-hint">TLS the Gateway forwards without reading it, for clients that check the server's certificate themselves. Add <span class="mono">:port</span> for a port other than 443.</span>`, { labelId: 'nt-tls-l', sub: liveField('egress[].tlsPassthrough') })}
      </div>
    </details>`;
  } else if (d.net === 'existing') {
    body = `<div class="panel nt-panel">${prow('Gateway', `<div id="live-gw-existing" class="stretch nt-pick">${liveNewGwExistingHTML(d)}</div>`, { labelId: 'nt-gwx-l', sub: liveField('spec.gateway.name') })}</div>`;
  } else {
    body = "<p class=\"prow-hint nt-none\">No Gateway: the task can't reach anything outside its sandbox.</p>";
  }
  return `<div class="nt-choice">${seg}</div>${body}`;
}

/* ---------- The YAML panel ---------- */
function liveNewStatusHTML(d) {
  const issues = liveNewIssues(d);
  if (!issues.length) return `<p class="nt-ok">${icon('checkCircle', 'sm')}Ready to create</p>`;
  const shown = issues.slice(0, 4);
  return `<p class="nt-todo">${icon('alert', 'sm')}${issues.length === 1 ? 'One thing to fix first' : `${issues.length} things to fix first`}</p>
    <ul class="nt-issues">${shown.map((x) => `<li>${esc(x)}</li>`).join('')}${issues.length > shown.length ? `<li>And ${issues.length - shown.length} more.</li>` : ''}</ul>`;
}
function liveNewCliHTML(d) {
  const name = d.raw ? liveYAMLTaskName(d.yaml) || '<name>' : liveDraftName(d);
  return `${cliHint(liveCmd(['apply', '-f', 'task.yaml']))}${cliHint(liveCmd(['resume', 'task', name]))}`;
}
function liveNewYamlCardHTML(d) {
  const docs = (liveNewYAML(d, 'text', {}).match(/^kind: (\w+)$/gm) || []).map((x) => x.slice(6));
  return `<aside class="card nt-yaml" aria-labelledby="nt-yaml-h" id="live-new-yaml-card">
      <div class="nt-yaml-head"><h2 id="nt-yaml-h">YAML preview</h2><span class="muted small" id="live-new-docs">${esc(docs.join(', '))}</span></div>
      <div class="nt-status" id="live-new-status">${liveNewStatusHTML(d)}</div>
      <pre class="manifest" id="live-new-manifest" tabindex="0" aria-label="The YAML Studio applies">${liveYAMLHTML(liveNewYAML(d, 'text', {}))}</pre>
      <div class="btn-row nt-yaml-acts"><button type="button" class="btn sm" data-action="live-new-raw">${icon('pencil', 'sm')}Edit YAML</button>
        <button type="button" class="btn sm" data-action="live-new-download">${icon('download', 'sm')}Download</button></div>
      <div class="nt-cli" id="live-new-cli">${liveNewCliHTML(d)}</div>
    </aside>`;
}
function liveNewCommitStatusHTML(d) {
  if (d.raw) return `<span class="nt-ok">${icon('checkCircle', 'sm')}Applies YAML as written</span>`;
  const issues = liveNewIssues(d);
  if (!issues.length) return `<span class="nt-ok">${icon('checkCircle', 'sm')}Ready to create</span>`;
  return `<span class="nt-todo">${icon('alert', 'sm')}${issues.length === 1 ? '1 thing to fix first' : `${issues.length} things to fix first`}</span>`;
}
function liveNewCommitBarHTML(d) {
  const busy = !!d.busy;
  return `<div class="nt-commit-bar" id="live-new-commit-bar">
    <div class="nt-commit-status" id="live-new-commit-status">${liveNewCommitStatusHTML(d)}</div>
    <div class="btn-row">
      <a class="btn" href="#/tasks" data-action="live-new-cancel">Cancel</a>
      <button type="button" class="btn primary" id="live-new-run" data-action="live-new-run" ${busy ? 'disabled' : ''}>${busy ? `${icon('loader', 'sm')}${esc(d.busy)}` : `Create task<span class="kbd-hint">${MOD}↵</span>`}</button>
    </div>
  </div>`;
}
function liveNewPresetsHTML(d) {
  const keys = Object.keys(LIVE_PRESETS);
  return `<div class="nt-presets" role="radiogroup" aria-labelledby="nt-start-h">${keys.map((k) => {
    const p = LIVE_PRESETS[k];
    const on = d.preset === k;
    const tile = LIVE_AGENTS[k] ? agentTile(k, 'sm') : `<span class="agent-tile sm nt-blank" aria-hidden="true">${icon('box', 'xs')}</span>`;
    return `<button type="button" class="nt-preset-card${on ? ' on' : ''}" role="radio" aria-checked="${on}" data-action="live-new-preset-card" data-preset="${k}">
      <span class="npc-top">${tile}<span class="npc-name">${esc(p.name)}</span>${on ? `<span class="npc-check" aria-hidden="true">${icon('checkCircle', 'sm')}</span>` : ''}</span>
      <span class="npc-desc">${esc(p.desc)}</span>
    </button>`;
  }).join('')}</div>`;
}

/* ---------- The page ---------- */
/** What the form shows that comes from the cluster, not from you. When it changes, the form is drawn again. */
function liveNewEnvSig() {
  const L = LIVE.local || {};
  return [LIVE.context, L.state || '', L.context || '', LIVE.atespace].join('|');
}
function liveViewNew() {
  if (!LIVE.draft) LIVE.draft = liveNewDraft();
  if (typeof SELECT_PICK !== 'undefined') Object.assign(SELECT_PICK, LIVE_NEW_PICKS);
  const d = LIVE.draft;
  d.envSig = liveNewEnvSig();
  liveNewLists();
  liveNewCredCheck(d);
  const ready = !liveNewIssues(d).length;
  const head = `<div class="new-head nt-head">
      <div class="nt-title">${axo(ready ? 'wave' : 'idle', { decorative: true }).replace('<svg ', '<svg data-follow ')}<div><h1 tabindex="-1">New task</h1>
        <p class="lede">${d.raw ? 'AX runs it on this computer, in its own sandbox. Create task applies the YAML below as written.' : "Configure a Task, its Workspace, and its Gateway on this computer. The YAML preview updates as you go."}</p></div></div>
    </div>
    <div id="live-new-error">${d.error ? `<div class="setup-alert warn" role="alert" style="margin-top:14px">${icon('alert')}<div class="sa-body"><strong>Couldn't create task</strong><p class="small" style="overflow-wrap:anywhere">${esc(d.error)}</p></div></div>` : ''}</div>`;
  let body;
  if (d.raw) {
    body = `<section class="nt-raw" aria-labelledby="nt-raw-h">
        <div class="step-head"><h2 id="nt-raw-h">Task YAML</h2><span class="muted">Create task applies it as written, with <code>ax apply</code>.</span>
          <div class="btn-row" style="margin-left:auto"><button type="button" class="btn sm" data-action="live-new-load">${icon('upload', 'sm')}Load a task file…</button><button type="button" class="btn sm" data-action="live-new-form">${icon('undo', 'sm')}Back to the form</button><button type="button" class="btn sm" data-action="live-new-download">${icon('download', 'sm')}Download</button></div></div>
        <textarea class="textarea mono" id="live-new-yaml" data-live-new="yaml" rows="26" spellcheck="false" aria-labelledby="nt-raw-h" aria-describedby="nt-raw-note">${esc(d.yaml)}</textarea>
        <p class="prow-hint" id="nt-raw-note">The form doesn't follow edits made here. Back to the form leaves them behind.</p>
        <div class="nt-cli" id="live-new-cli" style="margin-top:12px">${liveNewCliHTML(d)}</div>
        ${liveNewCommitBarHTML(d)}
      </section>`;
  } else {
    body = `<div class="nt-grid">
      <div class="nt-form" id="live-new-form">
        <section class="step-block first nt-sec" aria-labelledby="nt-start-h" id="live-start-step">
          <div class="step-head"><span class="nt-step-num" aria-hidden="true">1</span><h2 id="nt-start-h">Start from</h2><span class="muted">Pick a starting point or load a YAML file.</span>
            <button type="button" class="btn sm nt-load-btn" data-action="live-new-load">${icon('upload', 'sm')}Load a task file…</button></div>
          ${liveNewPresetsHTML(d)}</section>
        <section class="step-block nt-sec" aria-labelledby="nt-task-h" id="live-task-step">
          <div class="step-head"><span class="nt-step-num" aria-hidden="true">2</span><h2 id="nt-task-h">Task</h2><span class="muted">What runs in the sandbox, and how.</span><span class="nt-kind mono">kind: Task</span></div>
          ${liveNewTaskHTML(d)}</section>
        <section class="step-block nt-sec" aria-labelledby="nt-ws-h" id="live-ws-step">
          <div class="step-head"><span class="nt-step-num" aria-hidden="true">3</span><h2 id="nt-ws-h">Workspace</h2><span class="muted">What the task starts with in <span class="mono">/workspace</span>.</span><span class="nt-kind mono">kind: Workspace</span></div>
          ${liveNewWorkspaceHTML(d)}</section>
        <section class="step-block nt-sec" aria-labelledby="nt-net-h" id="live-net-step">
          <div class="step-head"><span class="nt-step-num" aria-hidden="true">4</span><h2 id="nt-net-h">Network</h2><span class="muted">What the task can reach outside its sandbox.</span><span class="nt-kind mono">kind: Gateway</span></div>
          ${liveNewNetworkHTML(d)}</section>
        ${liveNewCommitBarHTML(d)}
      </div>
      ${liveNewYamlCardHTML(d)}
    </div>`;
  }
  const html = `<div id="live-new-page">${head}${body}</div>`;
  return { title: 'New task', crumbs: [{ label: 'Home', href: '#/' }, { label: 'New task' }], html, wide: true };
}
/** Redraws what depends on what you typed, without redrawing the form under the cursor. */
function liveNewRefreshParts(d, k) {
  if (d.error) { d.error = ''; const err = $('#live-new-error'); if (err) err.innerHTML = ''; }
  if (d.raw) { const cli = $('#live-new-cli'); if (cli) cli.innerHTML = liveNewCliHTML(d); return; }
  const nameBox = $('#live-new-name');
  if (nameBox && k !== 'name' && !d.nameEdited) nameBox.value = liveDraftName(d);
  const yaml = liveNewYAML(d, 'text', {});
  const mf = $('#live-new-manifest'); if (mf) mf.innerHTML = liveYAMLHTML(yaml);
  const docs = $('#live-new-docs'); if (docs) docs.textContent = (yaml.match(/^kind: (\w+)$/gm) || []).map((x) => x.slice(6)).join(', ');
  const st = $('#live-new-status'); if (st) st.innerHTML = liveNewStatusHTML(d);
  const cst = $('#live-new-commit-status'); if (cst) cst.innerHTML = liveNewCommitStatusHTML(d);
  const cli = $('#live-new-cli'); if (cli) cli.innerHTML = liveNewCliHTML(d);
  const ts = $('#live-new-adv-task-sum'); if (ts) ts.innerHTML = liveNewAdvTaskSummary(d);
  const ws = $('#live-new-adv-ws-sum'); if (ws) ws.innerHTML = liveNewAdvWsSummary(d);
  const ns = $('#live-new-adv-net-sum'); if (ns) ns.innerHTML = liveNewAdvNetSummary(d);
  if (k === 'cpu' || k === 'memory') { const sz = $('#live-new-sizes'); if (sz) sz.innerHTML = liveNewSizesHTML(d); }
  if (k === 'git' || k === 'mcp' || k === 'lists' || k === 'creds') { const hs = $('#live-new-hosts'); if (hs) hs.innerHTML = liveNewHostsHTML(d); }
  if (k === 'git') {
    const rp = $('#live-recent'); if (rp) rp.innerHTML = liveRecentPillsHTML(d);
    d.git.forEach((g, i) => { const box = $(`#nt-git-${i}-dir`); if (box) box.placeholder = liveNewDirHint(d, i); });
  }
  if (k === 'creds') {
    d.creds.forEach((c, i) => {
      const u = $(`#nt-creds-${i}-uri`);
      if (u) u.innerHTML = `${icon('lock', 'xs')} A value you type is stored as that secret on the cluster. <span class="mono">${esc(liveCredUri({ secret: liveT(c.secret) || '<secret>', key: liveT(c.key) || '<key>' }))}</span>`;
      if (c.preset) {
        const pk = $('#live-new-preset-key'); if (pk && pk !== document.activeElement) pk.value = c.value;
        if (pk) pk.placeholder = liveNewKeyPlaceholder(c);
        const ph = $('#live-new-preset-key-hint'); if (ph) ph.innerHTML = liveNewKeyHintHTML(c);
        const ak = $(`#nt-creds-${i}-value`); if (ak && ak !== document.activeElement) ak.value = c.value;
      }
    });
  }
}
/** The cluster side changed while you were typing: redraw what depends on it, and leave the field you are in. */
function liveNewEnvRefresh(d) {
  d.envSig = liveNewEnvSig();
  liveNewRefreshParts(d, 'lists');
}
/** Adds what you typed to the hosts the Gateway allows, or to the ones it passes through. */
function liveNewAddHost(d, list) {
  const field = list === 'tls' ? 'tlsIn' : 'hostIn';
  const raw = liveT(d[field]).toLowerCase().replace(/^[a-z]+:\/\//, '').split('/')[0];
  const m = /^(.*?)(?::(\d{1,5}))?$/.exec(raw);
  const host = m[1], port = m[2];
  const ok = LIVE_HOST_RE.test(host) && (!port || (list === 'tls' && +port > 0 && +port < 65536));
  if (!ok) { toast(raw ? `<span class="mono">${esc(raw)}</span> isn't a host name${list === 'tls' ? '' : ' (no ports here)'}. Try one like docs.example.com.` : 'Type a host name first, like docs.example.com.', { icon: 'alert' }); return; }
  const value = port && port !== '443' ? `${host}:${port}` : host;
  const arr = list === 'tls' ? d.tls : d.hosts;
  if (!arr.includes(value)) arr.push(value);
  d[field] = '';
  render({ keepScroll: true });
  const box = $(list === 'tls' ? '#live-new-tls' : '#live-new-host'); if (box) box.focus({ preventScroll: true });
}

const LIVE_NEW_PICKS = {
  'live-new-preset': (v) => liveNewPickPreset(v),
  'live-new-ws-pick': (v) => { const d = LIVE.draft; if (d) { d.existing = v; d.ws = 'existing'; d.error = ''; } },
  'live-new-setup-gw': (v) => { const d = LIVE.draft; if (d) { d.setupGateway = v; d.error = ''; } },
  'live-new-gw-pick': (v) => { const d = LIVE.draft; if (d) { d.gateway = v; d.net = 'existing'; d.error = ''; } },
};
const LIVE_NEW_ACTIONS = {
  'live-new-run': () => liveNewRun(),
  'live-new-cancel': () => { LIVE.draft = null; },
  'live-new-preset-card': (el) => { if (el && el.dataset.preset) liveNewPickPreset(el.dataset.preset); },
  'live-new-ws': (el) => {
    const d = LIVE.draft;
    if (!d || !['none', 'existing', 'new'].includes(el.dataset.ws)) return;
    d.ws = el.dataset.ws;
    /* A new workspace starts with a row for a repo, the most common thing to set up. */
    if (d.ws === 'new' && !d.git.length && !d.files.length && !d.skills.length && !d.setup.length && !d.mcp.length) d.git.push(liveNewBlankRow('git'));
    d.error = '';
    render({ keepScroll: true });
  },
  'live-new-net': (el) => { const d = LIVE.draft; if (d && ['none', 'allow', 'existing'].includes(el.dataset.net)) { d.net = el.dataset.net; d.error = ''; render({ keepScroll: true }); } },
  'live-new-row-add': (el) => {
    const d = LIVE.draft;
    const kind = el && el.dataset.kind;
    const row = d && liveNewBlankRow(kind, el.dataset);
    if (!row) return;
    d[kind].push(row);
    render({ keepScroll: true });
    const first = { env: 'name', git: 'repo', files: el.dataset.path ? 'content' : 'path', skills: 'provider', setup: 'cmd', mcp: 'name', creds: 'host' }[kind];
    const box = $(`#nt-${kind}-${d[kind].length - 1}-${first}`); if (box) box.focus({ preventScroll: false });
  },
  'live-new-row-del': (el) => {
    const d = LIVE.draft;
    const list = d && d[el.dataset.kind];
    if (!Array.isArray(list) || !list[+el.dataset.i]) return;
    list.splice(+el.dataset.i, 1);
    render({ keepScroll: true });
    const add = $(`[data-action="live-new-row-add"][data-kind="${el.dataset.kind}"]`); if (add) add.focus({ preventScroll: true });
  },
  'live-new-size': (el) => {
    const d = LIVE.draft, S = LIVE_SIZES[el.dataset.size];
    if (!d || !S) return;
    /* Pressing the size you have goes back to AX's defaults. */
    const same = liveT(d.cpu) === S.cpu && liveT(d.memory) === S.memory;
    d.cpu = same ? '' : S.cpu; d.memory = same ? '' : S.memory;
    render({ keepScroll: true });
  },
  'live-new-debug': (el) => { const d = LIVE.draft; if (d) { d.debug = !!el.checked; liveNewRefreshParts(d, 'debug'); } },
  'live-new-goal-prompt': (el) => { const d = LIVE.draft; if (d) { d.goalAsPrompt = !!el.checked; liveNewRefreshParts(d, 'config'); } },
  'live-new-mcp-kind': (el) => { const d = LIVE.draft; const m = d && d.mcp[+el.dataset.i]; if (m) { m.kind = el.dataset.kind === 'local' ? 'local' : 'remote'; render({ keepScroll: true }); } },
  /* A recent repo fills the first empty repo row, or adds one. */
  'live-new-repo-pick': (el) => {
    const d = LIVE.draft;
    if (!d || !el.dataset.repo) return;
    if (d.git.some((g) => liveT(g.repo) === el.dataset.repo)) return;
    const empty = d.git.find((g) => !liveT(g.repo));
    if (empty) empty.repo = el.dataset.repo; else d.git.push(liveNewBlankRow('git', { repo: el.dataset.repo }));
    d.ws = 'new';
    render({ keepScroll: true });
  },
  /* A common setup command is added, or taken out when it's there. */
  'live-new-setup-pick': (el) => {
    const d = LIVE.draft;
    if (!d || !el.dataset.cmd) return;
    const at = d.setup.findIndex((c) => liveT(c.cmd) === el.dataset.cmd);
    if (at >= 0) d.setup.splice(at, 1);
    else { const empty = d.setup.find((c) => !liveT(c.cmd)); if (empty) empty.cmd = el.dataset.cmd; else d.setup.push({ cmd: el.dataset.cmd }); }
    render({ keepScroll: true });
  },
  'live-new-host-add': () => { if (LIVE.draft) liveNewAddHost(LIVE.draft, 'host'); },
  'live-new-tls-add': () => { if (LIVE.draft) liveNewAddHost(LIVE.draft, 'tls'); },
  'live-new-host-del': (el) => { const d = LIVE.draft; if (d) { d.hosts = d.hosts.filter((h) => h !== el.dataset.host); render({ keepScroll: true }); } },
  'live-new-tls-del': (el) => { const d = LIVE.draft; if (d) { d.tls = d.tls.filter((h) => h !== el.dataset.host); render({ keepScroll: true }); } },
  /* GitHub, PyPI or npm: all their hosts at once, or none of them when they are all there. */
  'live-new-host-pick': (el) => {
    const d = LIVE.draft, P = LIVE_HOST_PICKS.find((p) => p.id === el.dataset.pick);
    if (!d || !P) return;
    if (P.hosts.every((h) => d.hosts.includes(h))) d.hosts = d.hosts.filter((h) => !P.hosts.includes(h));
    else P.hosts.forEach((h) => { if (!d.hosts.includes(h)) d.hosts.push(h); });
    render({ keepScroll: true });
  },
  /* The YAML as a file on this computer, and back. A file you load opens in the editor, as written. */
  'live-new-raw': () => { const d = LIVE.draft; if (d) { d.yaml = liveNewYAML(d, 'text', {}); d.raw = true; d.error = ''; render({ keepScroll: true }); const t = $('#live-new-yaml'); if (t) t.focus({ preventScroll: true }); } },
  'live-new-form': () => { if (LIVE.draft) { LIVE.draft.raw = false; LIVE.draft.error = ''; render({ keepScroll: true }); } },
  'live-new-download': () => {
    const d = LIVE.draft;
    if (!d) return;
    const text = d.raw ? d.yaml : liveNewYAML(d, 'text', {});
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
};
/** Reads a task file from this computer into the YAML editor. */
function liveNewLoadFile(file) {
  const d = LIVE.draft;
  if (!d) return;
  if (file.size > 256 * 1024) { toast('That file is too big for a task file.', { icon: 'alert' }); return; }
  const r = new FileReader();
  r.onload = () => {
    d.yaml = String(r.result || '');
    d.raw = true;
    d.error = /^kind:\s*["']?Task["']?\s*$/m.test(d.yaml) ? '' : 'The YAML needs a Task.';
    render({ keepScroll: true });
    toast(`Loaded <span class="mono">${esc(file.name)}</span>`, { icon: 'upload' });
  };
  r.onerror = () => toast(`Couldn't read ${esc(file.name)}`, { icon: 'alert' });
  r.readAsText(file);
}
if (LIVE.on) {
  document.addEventListener('input', (e) => {
    const t = e.target;
    const d = LIVE.draft;
    if (!t || !t.dataset || !d) return;
    const k = t.dataset.liveNew;
    if (k) {
      if (k === 'name') { d.name = t.value; d.nameEdited = true; } else d[k] = t.value;
      if (k !== 'hostIn' && k !== 'tlsIn') liveNewRefreshParts(d, k);
      return;
    }
    /* A field in one of the lists. */
    const kind = t.dataset.liveNewRow;
    const row = kind && Array.isArray(d[kind]) && d[kind][+t.dataset.i];
    if (row && t.dataset.k) { row[t.dataset.k] = t.value; liveNewRefreshParts(d, kind); }
  });
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (!t || !LIVE.draft || e.key !== 'Enter') return;
    /* Enter in a host field adds the host. */
    if (!e.metaKey && !e.ctrlKey && !e.shiftKey && (t.id === 'live-new-host' || t.id === 'live-new-tls')) { e.preventDefault(); liveNewAddHost(LIVE.draft, t.id === 'live-new-tls' ? 'tls' : 'host'); return; }
    /* Ctrl/⌘ Enter anywhere in the form creates the task. (live.js does it for the goal.) */
    if ((e.metaKey || e.ctrlKey) && t.id !== 'live-new-goal' && t.closest && t.closest('#live-new-page')) { e.preventDefault(); liveNewRun(); }
  });
  document.addEventListener('toggle', (e) => {
    const t = e.target, d = LIVE.draft;
    if (!t || !t.id || !d) return;
    if (t.id === 'live-new-adv-task') d.advTaskOpen = t.open;
    else if (t.id === 'live-new-adv-ws') d.advWsOpen = t.open;
    else if (t.id === 'live-new-adv-net') d.advNetOpen = t.open;
  }, true);
}
