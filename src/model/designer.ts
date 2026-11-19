import { useSyncExternalStore } from 'react'
import { studioClient } from '../api'
import { type AXTask, type TaskDetail, validateImage, validateLabel } from './resources'
import { store } from './store'

export type WorkspaceMode = 'none' | 'existing' | 'new'
export type ConfigMode = 'none' | 'custom'
export type GatewayPreset = 'none' | 'existing' | 'balanced' | 'locked'
export type Preset = 'blank' | 'simple' | 'antigravity' | 'claude-managed-agents' | 'github-actions'

export interface KeyValue {
  id: number
  key: string
  value: string
}
export interface RepoDraft {
  id: number
  name: string
  repo: string
  branch: string
}
export interface FileDraft {
  id: number
  path: string
  content: string
}

export interface Draft {
  // Task
  name: string
  atespace: string
  goal: string
  sessionId: string
  image: string
  command: string
  env: KeyValue[]
  cpu: number
  memoryMi: number
  debug: boolean
  autoStart: boolean
  // Runner config
  configMode: ConfigMode
  customConfig: string
  // Workspace
  workspaceMode: WorkspaceMode
  existingWorkspace: string
  wsName: string
  repos: RepoDraft[]
  files: FileDraft[]
  setupCommands: string
  // Gateway & credentials (network guardrails)
  gatewayMode: GatewayPreset
  existingGateway: string
  gwName: string
  extraDomains: string
  credentialProvider: 'none' | 'anthropic' | 'gemini'
  credentialSecretName: string
  credentialSecretKey: string
  credentialUri: string
  // Raw editing
  rawMode: boolean
  rawYAML: string
  filePath: string | null
}

let nextID = 1
export const uid = () => nextID++

export const hexID = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, '0')).join('')

export const withID = (name: string) => `${name.replace(/-[0-9a-f]{8}$/, '')}-${hexID()}`

export const PRESETS: { id: Preset; title: string; group?: string }[] = [
  { id: 'blank', title: 'Blank' },
  { id: 'simple', title: 'Shell / Python Runner' },
  { id: 'antigravity', title: 'Antigravity Agent', group: 'Agent Templates' },
  { id: 'claude-managed-agents', title: 'Claude Code Agent', group: 'Agent Templates' },
  { id: 'github-actions', title: 'GitHub Actions Runner', group: 'Agent Templates' },
]

/**
 * No image by default: a template brings its own, and a custom task names
 * one. AX has no default task image.
 */
export const DEFAULT_RUNNER_IMAGE = ''

// TODO(release): Switch from staging ghcr.io/rakyll/ax-images to official ghcr.io/agentexecutor (or GCP Artifact Registry) once published.
const AX_IMAGES = 'ghcr.io/rakyll/ax-images'
const IMAGE_DIGESTS = {
  antigravity: 'sha256:8025a987861673718564e0e648a3c7785d23c2514be8c7a3d3b133413d9bc81e',
  'claude-managed-agents': 'sha256:1a532d86c58a5fea3005e9c525683cf8f354e2c403be6460a308ad2f8f0510c0',
  'github-actions': 'sha256:63d02f8ff154efd5ee269414bc793bde90afb5aadedbe756e1c2f8389207c7bd',
}
const image = (name: keyof typeof IMAGE_DIGESTS) => `${AX_IMAGES}/${name}@${IMAGE_DIGESTS[name]}`

function blank(): Draft {
  return {
    name: 'my-task',
    atespace: '',
    goal: '',
    sessionId: '',
    image: DEFAULT_RUNNER_IMAGE,
    command: '',
    env: [],
    cpu: 1,
    memoryMi: 1024,
    debug: true,
    autoStart: true,
    configMode: 'none',
    customConfig: 'key: value\n',
    workspaceMode: 'none',
    existingWorkspace: '',
    wsName: 'my-workspace',
    repos: [],
    files: [],
    setupCommands: '',
    gatewayMode: 'none',
    existingGateway: '',
    gwName: 'agent-egress-gw',
    extraDomains: '',
    credentialProvider: 'none',
    credentialSecretName: 'agent-api-creds',
    credentialSecretKey: 'api-key',
    credentialUri: '',
    rawMode: false,
    rawYAML: '',
    filePath: null,
  }
}

const AGENT_GOAL =
  'Read the repository, run its test suite, fix any failing or flaky tests, and summarize what changed in /workspace/agent-output.md.'

function agentTask(
  d: Draft,
  name: 'antigravity' | 'claude-managed-agents',
  config: string,
  credProvider: 'gemini' | 'anthropic',
  secretName: string,
  envKey: string
): Draft {
  return {
    ...d,
    name,
    goal: AGENT_GOAL,
    image: image(name),
    cpu: 2,
    memoryMi: 4096,
    configMode: 'custom',
    customConfig: config,
    env: [{ id: uid(), key: envKey, value: 'placeholder' }],
    workspaceMode: 'new',
    wsName: withID(`ws-${name === 'antigravity' ? 'agy' : 'claude'}`),
    repos: [{ id: uid(), name: 'origin', repo: 'https://github.com/pallets/itsdangerous.git', branch: 'main' }],
    files: [
      {
        id: uid(),
        path: 'AGENTS.md',
        content: `# Working in this repo
- Pure-Python library. Run tests with pytest.
- Leave clean changes in the working tree for review in AX Studio.
`,
      },
    ],
    gatewayMode: 'balanced',
    gwName: withID(`${name === 'antigravity' ? 'agy' : 'claude'}-gw`),
    credentialProvider: credProvider,
    credentialSecretName: secretName,
    credentialSecretKey: envKey,
  }
}

export function preset(p: Preset): Draft {
  const d = presetDraft(p)
  return { ...d, name: withID(d.name) }
}

function presetDraft(p: Preset): Draft {
  const d = blank()
  switch (p) {
    case 'blank':
      return d
    case 'simple':
      return {
        ...d,
        name: 'shell-task',
        goal: 'Clone the repository and verify the environment.',
        command: "sh -c 'echo \"AX sandbox ready in $(pwd)\"'",
        env: [{ id: uid(), key: 'ENVIRONMENT', value: 'local' }],
      }
    case 'antigravity':
      return agentTask(
        d,
        'antigravity',
        `prompt: |\n  ${AGENT_GOAL}\nmodel: gemini-3.8-flash\nmaxTurns: 100\n`,
        'gemini',
        'gemini-api-creds',
        'GEMINI_API_KEY'
      )
    case 'claude-managed-agents':
      return agentTask(
        d,
        'claude-managed-agents',
        `agent:\n  model: "claude-opus-5-5"\n  system: "You are a careful software engineer working in /workspace."\nprompt: |\n  ${AGENT_GOAL}\n`,
        'anthropic',
        'anthropic-api-creds',
        'ANTHROPIC_API_KEY'
      )
    case 'github-actions':
      return {
        ...d,
        name: 'github-actions',
        image: image('github-actions'),
        cpu: 2,
        memoryMi: 4096,
        debug: false,
        configMode: 'custom',
        customConfig: `repository: "<owner>/<repo>"\nlabels: ["self-hosted", "ax"]\njobs: 1\n`,
        gatewayMode: 'balanced',
        gwName: withID('gha-gw'),
      }
  }
}

export interface Issue {
  severity: 'error' | 'warning'
  text: string
}

export const isSecret = (key: string) => /KEY|TOKEN|SECRET|PASSWORD/i.test(key)

export function validateEnvName(key: string, all: KeyValue[]): string | null {
  if (!key) return null
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return 'letters, digits and _, not starting with a digit'
  if (all.filter((kv) => kv.key === key).length > 1) return 'set more than once'
  return null
}

export function parseEnv(text: string): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim().replace(/^export\s+/, '')
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    const key = (eq < 0 ? line : line.slice(0, eq)).trim()
    let value = eq < 0 ? '' : line.slice(eq + 1).trim()
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.endsWith(value[0])) {
      value = value.slice(1, -1)
    }
    out.push({ key, value })
  }
  return out
}

export const formatEnv = (env: KeyValue[]) => env.map((kv) => `${kv.key}=${kv.value}`).join('\n')

export function issues(d: Draft): Issue[] {
  if (d.rawMode) return []
  const out: Issue[] = []
  const err = (text: string) => out.push({ severity: 'error', text })
  const warn = (text: string) => out.push({ severity: 'warning', text })
  let e: string | null
  if ((e = validateLabel(d.name))) err(`Task name: ${e}`)
  if (d.atespace && (e = validateLabel(d.atespace))) err(`Atespace: ${e}`)
  if ((e = validateImage(d.image))) err(`Image: ${e}`)
  if (d.workspaceMode === 'new' && (e = validateLabel(d.wsName))) err(`Workspace name: ${e}`)
  if (d.workspaceMode === 'existing' && !d.existingWorkspace) err('Pick a workspace to bind')
  if (d.workspaceMode === 'new' && d.repos.some((r) => !r.repo)) err('A git repo has no URL')
  if ((d.gatewayMode === 'balanced' || d.gatewayMode === 'locked') && (e = validateLabel(d.gwName))) {
    err(`Gateway name: ${e}`)
  }
  if (d.gatewayMode === 'existing' && !d.existingGateway) err('Pick a gateway to bind')
  if (d.workspaceMode === 'new' && d.repos.length > 0 && d.gatewayMode === 'none') {
    warn('Workspace clones a Git repo, but Gateway is None (no outbound network). Select Balanced or Locked down.')
  }
  if (d.env.some((kv) => validateEnvName(kv.key, d.env))) err('Environment: fix the highlighted names')
  return out
}

export const canApply = (d: Draft) => !issues(d).some((i) => i.severity === 'error')

export const memoryString = (mi: number) => (mi >= 1024 && mi % 1024 === 0 ? `${mi / 1024}Gi` : `${Math.round(mi)}Mi`)
export const cpuString = (c: number) => (c < 1 ? `${Math.round(c * 1000)}m` : `${+c.toFixed(2)}`)

export const q = (s: string) =>
  '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t') + '"'

function block(s: string, indent: number) {
  if (!s.includes('\n')) return q(s)
  const pad = ' '.repeat(indent)
  return (
    '|\n' +
    s
      .trimEnd()
      .split('\n')
      .map((l) => (l ? pad + l : ''))
      .join('\n')
  )
}

export function tokenize(s: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: string | null = null
  let any = false
  let escape = false
  for (const ch of s) {
    if (escape) {
      cur += ch
      escape = false
      continue
    }
    if (ch === '\\' && quote !== "'") {
      escape = true
      any = true
      continue
    }
    if (quote) {
      if (ch === quote) quote = null
      else cur += ch
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      any = true
      continue
    }
    if (/\s/.test(ch)) {
      if (any || cur) {
        out.push(cur)
        cur = ''
        any = false
      }
      continue
    }
    cur += ch
  }
  if (any || cur) out.push(cur)
  return out
}

function buildGatewayYAML(d: Draft, ates: string): string {
  let y = `apiVersion: ax.io/v1alpha1\nkind: Gateway\nmetadata:\n  name: ${q(d.gwName)}${ates}\nspec:\n  egress:`
  const secretNS = store.state.axNamespace || 'ax-system'
  const credURI =
    d.credentialUri ||
    (d.credentialProvider !== 'none' && d.credentialSecretName && d.credentialSecretKey
      ? `ate-secret://k8s.io/default/${secretNS}/${d.credentialSecretName}/${d.credentialSecretKey}`
      : '')

  if (d.credentialProvider === 'anthropic') {
    y += `\n    - https:\n        hostnames: ["api.anthropic.com"]`
    if (credURI) {
      y += `\n        effects:\n          replaceHeaders:\n            - header: "x-api-key"\n              credentialUri: ${q(credURI)}`
    }
  } else if (d.credentialProvider === 'gemini') {
    y += `\n    - https:\n        hostnames: ["generativelanguage.googleapis.com"]`
    if (credURI) {
      y += `\n        effects:\n          replaceHeaders:\n            - header: "x-goog-api-key"\n              credentialUri: ${q(credURI)}`
    }
  }

  const hosts = new Set<string>()
  for (const r of d.repos) {
    try {
      const u = new URL(r.repo)
      if (u.hostname) hosts.add(u.hostname.toLowerCase())
    } catch {
      // Ignore unparseable URL while typing.
    }
  }
  if (d.gatewayMode === 'balanced') {
    for (const h of [
      'github.com',
      'api.github.com',
      '*.githubusercontent.com',
      'pypi.org',
      'files.pythonhosted.org',
      'registry.npmjs.org',
    ]) {
      hosts.add(h)
    }
  }
  for (const raw of d.extraDomains.split(/[\s,]+/)) {
    const clean = raw.trim().toLowerCase()
    if (clean) hosts.add(clean)
  }
  if (d.credentialProvider === 'anthropic') hosts.delete('api.anthropic.com')
  if (d.credentialProvider === 'gemini') hosts.delete('generativelanguage.googleapis.com')

  if (hosts.size > 0) {
    y += `\n    - https:\n        hostnames: [${[...hosts].map(q).join(', ')}]`
  } else if (d.credentialProvider === 'none') {
    y += `\n    - https:\n        hostnames: ["github.com"]`
  }
  return y
}

export function generate(d: Draft, redact = false): string {
  if (d.rawMode) return d.rawYAML
  const docs: string[] = []
  const ates = d.atespace ? `\n  atespace: ${q(d.atespace)}` : ''

  if (d.gatewayMode === 'balanced' || d.gatewayMode === 'locked') {
    docs.push(buildGatewayYAML(d, ates))
  }

  if (d.workspaceMode === 'new') {
    let y = `apiVersion: ax.io/v1alpha1\nkind: Workspace\nmetadata:\n  name: ${q(d.wsName)}${ates}\nspec:`
    let hasSetup = false
    let setupYAML = '\n  setup:'
    if (d.repos.length) {
      hasSetup = true
      setupYAML += '\n    git:'
      for (const r of d.repos) {
        setupYAML += `\n      - name: ${q(r.name || 'origin')}\n        repo: ${q(r.repo)}\n        dir: "."`
        if (r.branch) setupYAML += `\n        ref: ${q(r.branch)}`
      }
    }
    if (d.files.length) {
      hasSetup = true
      setupYAML += '\n    files:'
      for (const f of d.files) setupYAML += `\n      - path: ${q(f.path)}\n        content: ${block(f.content, 10)}`
    }
    const setupCmds = d.setupCommands
      .split('\n')
      .map((c) => c.trim())
      .filter(Boolean)
    if (setupCmds.length) {
      hasSetup = true
      setupYAML += '\n    commands:'
      for (const c of setupCmds) setupYAML += `\n      - ${q(c)}`
    }
    if (hasSetup) y += setupYAML
    else y += ' {}'
    docs.push(y)
  }

  let t = `apiVersion: ax.io/v1alpha1\nkind: Task\nmetadata:\n  name: ${q(d.name)}${ates}\nspec:`
  t += '\n  profile:'
  if (d.image) t += `\n    image: ${q(d.image)}`
  t += `\n    resources:\n      limits:\n        cpu: ${q(cpuString(d.cpu))}\n        memory: ${q(memoryString(d.memoryMi))}`

  const argv = tokenize(d.command)
  if (argv.length) t += `\n  commands: [${argv.map(q).join(', ')}]`
  if (d.goal.trim()) t += `\n  goal:\n    text: ${block(d.goal.trim(), 6)}`
  if (d.sessionId.trim()) t += `\n  sessionId: ${q(d.sessionId.trim())}`
  if (d.configMode === 'custom' && d.customConfig.trim()) {
    t +=
      '\n  config:\n' +
      d.customConfig
        .split('\n')
        .map((l) => '    ' + l)
        .join('\n')
        .trimEnd()
  }
  const env = d.env.filter((kv) => kv.key)
  if (env.length) {
    t += '\n  env:'
    for (const kv of env) {
      const v = redact && isSecret(kv.key) && kv.value && kv.value !== 'placeholder' ? '••••••••' : kv.value
      t += `\n    - name: ${q(kv.key)}\n      value: ${q(v)}`
    }
  }
  if (d.workspaceMode === 'existing' && d.existingWorkspace) t += `\n  workspace:\n    name: ${q(d.existingWorkspace)}`
  if (d.workspaceMode === 'new') t += `\n  workspace:\n    name: ${q(d.wsName)}`
  if (d.gatewayMode === 'existing' && d.existingGateway) t += `\n  gateway:\n    name: ${q(d.existingGateway)}`
  if (d.gatewayMode === 'balanced' || d.gatewayMode === 'locked') t += `\n  gateway:\n    name: ${q(d.gwName)}`
  if (d.debug) t += '\n  debug: true'
  docs.push(t)

  return docs.join('\n---\n') + '\n'
}

class DesignerStore {
  draft: Draft = preset('simple')
  private listeners = new Set<() => void>()

  subscribe = (l: () => void) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  set(patch: Partial<Draft>) {
    this.draft = { ...this.draft, ...patch }
    for (const l of this.listeners) l()
  }

  load(p: Preset) {
    this.draft = preset(p)
    for (const l of this.listeners) l()
  }

  /** Pre-fills the form to continue work from an existing task in the same session. */
  continueFromTask(task: AXTask, detail?: TaskDetail) {
    const base = blank()
    const sharedSession = detail?.sessionId || detail?.uid || ''
    this.draft = {
      ...base,
      name: withID(`${task.name.replace(/-[0-9a-f]{6,8}$/, '')}-next`),
      atespace: task.atespace === 'default' ? '' : task.atespace,
      sessionId: sharedSession,
      goal: detail?.goal ? `Continue from ${task.name}:\n${detail.goal}` : `Review and continue work from ${task.name}.`,
      image: detail?.image || DEFAULT_RUNNER_IMAGE,
      command: detail?.command?.join(' ') ?? '',
      workspaceMode: detail?.workspace ? 'existing' : 'none',
      existingWorkspace: detail?.workspace ?? '',
      gatewayMode: detail?.gateway ? 'existing' : 'none',
      existingGateway: detail?.gateway ?? '',
      debug: true,
      autoStart: true,
    }
    for (const l of this.listeners) l()
  }

  enterRawMode() {
    this.set({ rawYAML: generate(this.draft), rawMode: true })
  }

  async open() {
    const f = await studioClient.openYAMLFile()
    if (f) this.set({ rawYAML: f.text, rawMode: true, filePath: f.path })
  }

  save() {
    const name = this.draft.filePath?.split(/[\\/]/).pop() ?? `${this.draft.name}.yaml`
    const saved = studioClient.saveYAMLFile(name, generate(this.draft))
    this.set({ filePath: saved })
  }
}

export const designer = new DesignerStore()

export function useDraft(): Draft {
  return useSyncExternalStore(designer.subscribe, () => designer.draft)
}
