import { parse as parseYAML } from 'yaml'

export type Phase = 'pending' | 'running' | 'suspended' | 'completed' | 'failed' | 'terminating' | (string & {})

export const PHASES: Phase[] = ['pending', 'running', 'suspended', 'completed', 'failed', 'terminating']

export function toPhase(raw: string | undefined): Phase {
  const s = (raw ?? '').toLowerCase()
  if (s === '' || s === '<none>' || s === 'queued' || s === 'idle' || s === 'resuming' || s === 'unknown') return 'pending'
  if (s === 'working' || s === 'running' || s === 'requiresaction') return 'running'
  if (s === 'suspended' || s === 'suspending') return 'suspended'
  if (s === 'succeeded' || s === 'completed') return 'completed'
  if (s === 'cancelled' || s === 'terminating') return 'terminating'
  return s
}

export const phaseLabel = (p: Phase) => (p === 'running' ? 'Working' : p.charAt(0).toUpperCase() + p.slice(1))

export const PHASE_COLOR: Record<string, string> = {
  pending: '#FAB219',
  running: '#0CA30C',
  suspended: '#2A78D6',
  completed: '#8A8984',
  failed: '#D03B3B',
  terminating: '#EC835A',
}
export const phaseColor = (p: Phase) => PHASE_COLOR[p] ?? '#8A8984'

const order = (p: Phase) => {
  const i = PHASES.indexOf(p)
  return i < 0 ? PHASES.length : i
}
export const comparePhase = (a: Phase, b: Phase) => order(a) - order(b)

export interface AXTask {
  id: string
  name: string
  atespace: string
  phase: Phase
  rawState?: string
  actor?: string
  workerIP?: string
  age: string
}

export interface Condition {
  type: string
  status: string
  reason: string
  message: string
  updateTime?: string
}

export interface TaskDetail {
  uid?: string
  sessionId?: string
  goal?: string
  gateway?: string
  workspace?: string
  image?: string
  command: string[]
  env: { name: string; value: string }[]
  cpu?: string
  memory?: string
  debug: boolean
  createTime?: string
  output?: string
  exitCode?: number
  conditions: Condition[]
  manifest: string
}

export interface GitRepo {
  name: string
  repo: string
  branch: string
  dir?: string
}

export interface AXWorkspace {
  id: string
  name: string
  atespace: string
  gitCount: number
  mcpCount: number
  repos: GitRepo[]
  mcpServers: { name: string; endpoint: string }[]
  files: string[]
  commands: string[]
}

export interface AXGateway {
  id: string
  name: string
  atespace: string
  ruleCount: number
}

export interface AXModel {
  id: string
  name: string
  atespace: string
  provider: string
  model: string
}

export interface AXContext {
  name: string
  description: string
  isCurrent: boolean
}

export const isLocal = (c?: AXContext) =>
  c?.name === 'ax-local' || c?.name === 'local' || (c?.name ?? '').startsWith('kind-')

export function shortName(name: string): string {
  const parts = name.split('_')
  return name.startsWith('gke_') && parts.length >= 4 ? parts.slice(3).join('_') : name
}

const none = (s?: string) => (s && s !== '<none>' && s !== '-' ? s : undefined)

export function parseTable(text: string): Record<string, string>[] {
  const lines = text.split('\n').filter((l) => l.trim())
  if (!lines.length) return []
  const keys = lines[0].trim().split(/\s+/)
  return lines.slice(1).map((line) => {
    const values = line.trim().split(/\s+/)
    return Object.fromEntries(keys.map((k, i) => [k, values[i] ?? '']))
  })
}

export const parseTasks = (text: string): AXTask[] =>
  parseTable(text)
    .filter((r) => r.NAME)
    .map((r) => {
      const atespace = r.ATESPACE || 'default'
      const rawState = r.STATE || r.PHASE || ''
      return {
        id: `${atespace}/${r.NAME}`,
        name: r.NAME,
        atespace,
        phase: toPhase(rawState),
        rawState,
        actor: none(r.ACTOR),
        workerIP: none(r['WORKER-IP']),
        age: r.AGE ?? '',
      }
    })

export const parseWorkspaces = (text: string): AXWorkspace[] =>
  parseTable(text)
    .filter((r) => r.NAME)
    .map((r) => {
      const atespace = r.ATESPACE || 'default'
      return {
        id: `${atespace}/${r.NAME}`,
        name: r.NAME,
        atespace,
        gitCount: Number(r['GIT-REPOS']) || 0,
        mcpCount: Number(r['MCP-SERVERS']) || 0,
        repos: [],
        mcpServers: [],
        files: [],
        commands: [],
      }
    })

export const parseGateways = (text: string): AXGateway[] =>
  parseTable(text)
    .filter((r) => r.NAME)
    .map((r) => {
      const atespace = r.ATESPACE || 'default'
      return {
        id: `${atespace}/${r.NAME}`,
        name: r.NAME,
        atespace,
        ruleCount: Number(r['EGRESS-RULES']) || 0,
      }
    })

export const parseModels = (text: string): AXModel[] =>
  parseTable(text)
    .filter((r) => r.NAME)
    .map((r) => {
      const atespace = r.ATESPACE || 'default'
      return { id: `${atespace}/${r.NAME}`, name: r.NAME, atespace, provider: r.PROVIDER ?? '', model: r.MODEL ?? '' }
    })

export function parseContexts(text: string): AXContext[] {
  const lines = text.split('\n').filter((l) => l.trim())
  if (lines.length === 0) return []
  if (!lines[0].includes('NAME')) return []
  return lines
    .slice(1)
    .map((raw) => {
      const isCurrent = raw.trim().startsWith('*')
      const line = raw.replace(/^\s*\*\s*/, '').trim()
      if (!line) return null
      const cols = line.split(/\s{2,}/)
      const name = cols[0]?.trim() ?? ''
      if (!name) return null
      const cluster = cols[1]?.trim() ?? ''
      const tunnel = cols[2]?.trim() ?? ''
      const desc = [cluster && cluster !== name ? cluster : '', tunnel && tunnel !== '-' ? tunnel : '']
        .filter(Boolean)
        .join(' · ')
      return {
        name,
        description: desc || (name === 'ax-local' || name === 'local' ? 'Local Kind sandbox' : 'Kubernetes context'),
        isCurrent,
      }
    })
    .filter((c): c is AXContext => c !== null)
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function parseTaskYAML(text: string): TaskDetail {
  const doc: any = parseYAML(text) ?? {}
  const meta = doc.metadata ?? {}
  const spec = doc.spec ?? {}
  const status = doc.status ?? {}
  const profile = spec.profile ?? {}
  const cmds = spec.commands ?? spec.command
  const resLimits = profile.resources?.limits ?? spec.resources?.limits ?? {}
  return {
    uid: meta.uid,
    sessionId: spec.sessionId ?? spec.session_id,
    goal: spec.goal?.text,
    gateway: spec.gateway?.name,
    workspace: spec.workspace?.name,
    image: profile.image ?? spec.image,
    command: Array.isArray(cmds) ? cmds.map(String) : [],
    env: Array.isArray(spec.env) ? spec.env.map((e: any) => ({ name: String(e.name ?? ''), value: String(e.value ?? '') })) : [],
    cpu: resLimits.cpu,
    memory: resLimits.memory,
    debug: !!spec.debug,
    createTime: meta.createTime ?? meta.create_time,
    output: status.outcome?.output,
    exitCode: typeof status.outcome?.exitCode === 'number' ? status.outcome.exitCode : undefined,
    conditions: Array.isArray(status.conditions)
      ? status.conditions.map((c: any) => ({
          type: String(c.type ?? ''),
          status: String(c.status ?? ''),
          reason: String(c.reason ?? ''),
          message: String(c.message ?? ''),
          updateTime: c.updateTime ?? c.update_time,
        }))
      : [],
    manifest: text,
  }
}

export function parseWorkspaceYAML(text: string, ws: AXWorkspace): AXWorkspace {
  const spec: any = (parseYAML(text) ?? {}).spec ?? {}
  const setup = spec.setup ?? spec
  return {
    ...ws,
    repos: (setup.git ?? []).map((g: any) => ({
      name: String(g.name ?? 'origin'),
      repo: String(g.repo ?? ''),
      branch: String(g.ref ?? g.branch ?? 'main'),
      dir: g.dir ? String(g.dir) : undefined,
    })),
    mcpServers: (spec.mcp?.servers ?? []).map((s: any) => ({
      name: String(s.name ?? ''),
      endpoint: String(s.endpoint ?? s.command ?? ''),
    })),
    files: (setup.files ?? []).map((f: any) => String(f.path ?? '')),
    commands: (setup.commands ?? []).map((c: any) => String(c)),
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function errorSummary(stdout: string, stderr: string): string {
  const lines = (stderr || stdout)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const last = lines[lines.length - 1] ?? 'command failed'
  return last.replace(/^Error:\s*/, '')
}

export function validateLabel(s: string): string | null {
  if (!s) return 'required'
  if (s.length > 63) return 'at most 63 characters'
  return /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(s)
    ? null
    : "lowercase letters, digits and '-', starting and ending alphanumeric"
}

export function validateImage(s: string): string | null {
  if (!s) return null
  return s.includes('@sha256:') ? null : 'pin by digest (image@sha256:…) or Substrate will reject it'
}

export function shortImage(s?: string): string {
  if (!s) return ''
  const [ref, digest] = s.split('@')
  const name = ref.split('/').pop() ?? ref
  return digest ? `${name}@${digest.replace('sha256:', '').slice(0, 7)}` : name
}

export const repoName = (url: string) => url.replace(/\.git$/, '').split('/').pop() || url
