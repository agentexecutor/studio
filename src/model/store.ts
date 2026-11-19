import { useSyncExternalStore } from 'react'
import { studioClient, type CommandResult } from '../api'
import {
  type AXContext,
  type AXGateway,
  type AXModel,
  type AXTask,
  type AXWorkspace,
  type Phase,
  type TaskDetail,
  comparePhase,
  errorSummary,
  parseContexts,
  parseGateways,
  parseModels,
  parseTaskYAML,
  parseTasks,
  parseWorkspaceYAML,
  parseWorkspaces,
} from './resources'

export type Section = 'overview' | 'terminal' | 'designer' | 'clusters'
const SECTIONS: Section[] = ['overview', 'designer', 'terminal', 'clusters']

export interface ActivityEntry {
  id: number
  date: number
  title: string
  detail: string
  ok: boolean
}

export interface PhaseSample {
  date: number
  counts: Record<string, number>
}

export interface Settings {
  localRepoPath: string
  refreshInterval: number
}

export interface TerminalTab {
  key: string
  task: AXTask
  context: string
  scope: string[]
}

export interface State {
  section: Section
  contexts: AXContext[]
  context: string
  atespace: string
  tasks: AXTask[]
  workspaces: AXWorkspace[]
  gateways: AXGateway[]
  models: AXModel[]
  details: Record<string, TaskDetail>
  selectedTaskID: string | null
  isRefreshing: boolean
  lastRefresh: number | null
  connectionError: string | null
  activity: ActivityEntry[]
  history: PhaseSample[]
  axVersion: string | null
  terminalTabs: TerminalTab[]
  terminalActive: string | null
  settings: Settings
  settingsOpen: boolean
  os: string
  home: string
  axNamespace: string
}

let tabCount = 0

const SETTINGS_KEY = 'ax-studio.settings'
const SECTION_KEY = 'ax-studio.section'

function loadSettings(): Settings {
  const defaults: Settings = { localRepoPath: '', refreshInterval: 4 }
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') }
  } catch {
    return defaults
  }
}

const result = (r: CommandResult) => ({ ...r, ok: r.status === 0, error: errorSummary(r.stdout, r.stderr) })
export type Result = ReturnType<typeof result>

class Store {
  state: State = {
    section:
      [new URLSearchParams(location.search).get('section'), localStorage.getItem(SECTION_KEY)].find((x): x is Section =>
        SECTIONS.includes(x as Section)
      ) ?? 'overview',
    contexts: [],
    context: '',
    atespace: new URLSearchParams(location.search).get('atespace') || 'default',
    tasks: [],
    workspaces: [],
    gateways: [],
    models: [],
    details: {},
    selectedTaskID: null,
    isRefreshing: false,
    lastRefresh: null,
    connectionError: null,
    activity: [],
    history: [],
    axVersion: null,
    terminalTabs: [],
    terminalActive: null,
    settings: loadSettings(),
    settingsOpen: false,
    os: 'linux',
    home: '',
    axNamespace: 'ax-system',
  }

  private listeners = new Set<() => void>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private started = false
  private nextID = 1
  private askedTask = new URLSearchParams(location.search).get('task')
  private askedTerminal = new URLSearchParams(location.search).has('terminal')

  private takeAskedTask(tasks: AXTask[]): Partial<State> {
    const t = this.askedTask ? tasks.find((x) => x.name === this.askedTask) : undefined
    if (!t) return {}
    this.askedTask = null
    if (!this.askedTerminal) return { selectedTaskID: t.id }
    const tab = this.newTab(t)
    return {
      selectedTaskID: t.id,
      section: 'terminal',
      terminalTabs: [...this.state.terminalTabs, tab],
      terminalActive: tab.key,
    }
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  set(patch: Partial<State>) {
    this.state = { ...this.state, ...patch }
    for (const l of this.listeners) l()
  }

  get currentContext() {
    return this.state.contexts.find((c) => c.name === this.state.context)
  }
  tasksIn = (p: Phase) => this.state.tasks.filter((t) => t.phase === p)
  tasksUsing = (ws: string) => this.state.tasks.filter((t) => this.state.details[t.id]?.workspace === ws)

  async start() {
    if (this.started) return
    this.started = true
    const info = await studioClient.platform()
    this.set({ os: info.os, home: info.home, axNamespace: info.axNamespace || 'ax-system' })
    await this.loadContexts()
    // First-run guidance: if no context is configured yet, land directly on Environments.
    if (!this.state.context && !new URLSearchParams(location.search).get('section')) {
      this.setSection('clusters')
    }
    this.loop()
  }

  private loop = async () => {
    await this.refresh()
    this.timer = setTimeout(this.loop, Math.max(2, this.state.settings.refreshInterval) * 1000)
  }

  setSection(section: Section) {
    localStorage.setItem(SECTION_KEY, section)
    this.set({ section })
  }

  updateSettings(patch: Partial<Settings>) {
    const settings = { ...this.state.settings, ...patch }
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    this.set({ settings })
  }

  setScope(patch: { context?: string; atespace?: string }) {
    this.set({
      ...patch,
      tasks: [],
      workspaces: [],
      gateways: [],
      models: [],
      details: {},
      history: [],
      selectedTaskID: null,
      connectionError: null,
    })
    void this.refresh(true)
  }

  async loadContexts() {
    const [v, r] = await Promise.all([
      studioClient.run({ program: 'ax', args: ['version'] }),
      studioClient.run({ program: 'ax', args: ['ctx'] }),
    ])
    const vr = result(v)
    const cr = result(r)
    this.set({ axVersion: vr.ok ? vr.stdout.trim() : null })

    let contexts: AXContext[] = []
    if (cr.ok) {
      contexts = parseContexts(cr.stdout)
    }
    if (contexts.length === 0) {
      try {
        const env = await studioClient.getEnvStatus()
        contexts = env.contexts.map((c) => ({
          name: c.name,
          description: c.isLocal ? 'Local Kind sandbox' : c.cluster || 'Kubernetes context',
          isCurrent: c.current,
        }))
      } catch {
        // Keep empty list when kubeconfig is absent.
      }
    }

    const asked = new URLSearchParams(location.search).get('context')
    const chosen =
      this.state.context ||
      asked ||
      contexts.find((c) => c.isCurrent)?.name ||
      contexts.find((c) => c.name === 'ax-local')?.name ||
      contexts.find((c) => c.name === 'local')?.name ||
      contexts[0]?.name ||
      ''
    this.set({ contexts, context: chosen })
  }

  get scope() {
    const a: string[] = []
    if (this.state.context) a.push('--context', this.state.context)
    a.push('-a', this.state.atespace || 'default')
    return a
  }

  async ax(args: string[], stdin?: string): Promise<Result> {
    return result(await studioClient.run({ program: 'ax', args: [...this.scope, ...args], stdin }))
  }

  async perform(title: string, args: string[], stdin?: string): Promise<Result> {
    const r = await this.ax(args, stdin)
    this.log(title, r.ok ? r.stdout.trim() : r.error, r.ok)
    await this.refresh(true)
    return r
  }

  log(title: string, detail: string, ok: boolean) {
    const entry: ActivityEntry = { id: this.nextID++, date: Date.now(), title, detail, ok }
    this.set({ activity: [entry, ...this.state.activity].slice(0, 200) })
  }

  async refresh(force = false) {
    if ((this.state.isRefreshing && !force) || !this.state.context) return
    this.set({ isRefreshing: true })
    try {
      const [tr, wr, gr, mr] = await Promise.all([
        this.ax(['get', 'tasks']),
        this.ax(['get', 'workspaces']),
        this.ax(['get', 'gateways']),
        this.ax(['get', 'models']),
      ])
      if (!tr.ok) {
        this.set({ connectionError: tr.error })
        return
      }
      const tasks = parseTasks(tr.stdout).sort((a, b) => comparePhase(a.phase, b.phase) || a.name.localeCompare(b.name))
      const workspaces = wr.ok
        ? parseWorkspaces(wr.stdout).map((w) => {
            const old = this.state.workspaces.find((o) => o.id === w.id)
            return old ? { ...w, repos: old.repos, mcpServers: old.mcpServers, files: old.files, commands: old.commands } : w
          })
        : this.state.workspaces
      const counts: Record<string, number> = {}
      for (const t of tasks) counts[t.phase] = (counts[t.phase] ?? 0) + 1
      this.set({
        connectionError: null,
        tasks: same(tasks, this.state.tasks) ? this.state.tasks : tasks,
        ...this.takeAskedTask(tasks),
        workspaces,
        gateways: gr.ok ? parseGateways(gr.stdout) : this.state.gateways,
        models: mr.ok ? parseModels(mr.stdout) : this.state.models,
        lastRefresh: Date.now(),
        history: [...this.state.history, { date: Date.now(), counts }].slice(-360),
      })
      await this.loadDetails()
    } finally {
      this.set({ isRefreshing: false })
    }
  }

  private async loadDetails() {
    const tasks = this.state.tasks
    const results = await Promise.all(tasks.map((t) => this.ax(['get', 'task', t.name])))
    const details: Record<string, TaskDetail> = {}
    tasks.forEach((t, i) => {
      const r = results[i]
      if (r.ok) details[t.id] = parseTaskYAML(r.stdout)
      else if (this.state.details[t.id]) details[t.id] = this.state.details[t.id]
    })
    const wsResults = await Promise.all(this.state.workspaces.map((w) => this.ax(['get', 'workspace', w.name])))
    const workspaces = this.state.workspaces.map((w, i) => (wsResults[i]?.ok ? parseWorkspaceYAML(wsResults[i].stdout, w) : w))
    this.set({ details, workspaces })
  }

  suspend = (t: AXTask) => this.perform(`Suspend ${t.name}`, ['suspend', 'task', t.name])
  resume = (t: AXTask) => this.perform(`Resume ${t.name}`, ['resume', 'task', t.name])
  remove = (kind: string, name: string) => this.perform(`Delete ${kind} ${name}`, ['delete', kind, name])
  apply = (yaml: string) => this.perform('Apply manifest', ['apply', '-f', '-'], yaml)

  async applyAndRun(yaml: string, taskName: string, autoStart: boolean): Promise<Result> {
    const applied = await this.ax(['apply', '-f', '-'], yaml)
    if (!applied.ok) {
      this.log('Apply manifest', applied.error, false)
      return applied
    }
    if (autoStart && taskName) {
      const resumed = await this.ax(['resume', 'task', taskName])
      this.log(`Create & run ${taskName}`, resumed.ok ? resumed.stdout.trim() : resumed.error, resumed.ok)
      await this.refresh(true)
      const created = this.state.tasks.find((t) => t.name === taskName)
      if (created) {
        this.set({ selectedTaskID: created.id })
        this.setSection('overview')
      }
      return resumed
    }
    this.log('Apply manifest', applied.stdout.trim(), true)
    await this.refresh(true)
    return applied
  }

  async makeDefault(ctx: string) {
    try {
      await studioClient.selectContext(ctx)
      this.log(`Use context ${ctx}`, 'now the default Kubernetes context for ax', true)
      await this.loadContexts()
    } catch (e) {
      this.log(`Use context ${ctx}`, e instanceof Error ? e.message : String(e), false)
    }
  }

  private newTab(t: AXTask): TerminalTab {
    return { key: `tab-${++tabCount}`, task: t, context: this.state.context, scope: this.scope }
  }

  openTerminal(t: AXTask) {
    const open = this.state.terminalTabs.find((x) => x.task.id === t.id && x.context === this.state.context)
    if (open) {
      this.set({ terminalActive: open.key })
    } else {
      const tab = this.newTab(t)
      this.set({ terminalTabs: [...this.state.terminalTabs, tab], terminalActive: tab.key })
    }
    this.setSection('terminal')
  }

  duplicateTerminal(tab: TerminalTab) {
    const copy = { ...tab, key: `tab-${++tabCount}` }
    const tabs = [...this.state.terminalTabs]
    tabs.splice(tabs.indexOf(tab) + 1, 0, copy)
    this.set({ terminalTabs: tabs, terminalActive: copy.key })
  }

  closeTerminal(key: string) {
    const tabs = this.state.terminalTabs
    const i = tabs.findIndex((x) => x.key === key)
    if (i < 0) return
    const rest = tabs.filter((x) => x.key !== key)
    const active =
      this.state.terminalActive === key ? (rest[Math.min(i, rest.length - 1)]?.key ?? null) : this.state.terminalActive
    this.set({ terminalTabs: rest, terminalActive: active })
  }

  stop() {
    if (this.timer) clearTimeout(this.timer)
  }
}

function same(a: AXTask[], b: AXTask[]) {
  return a.length === b.length && a.every((t, i) => JSON.stringify(t) === JSON.stringify(b[i]))
}

export const store = new Store()

export function useStore(): State {
  return useSyncExternalStore(store.subscribe, () => store.state)
}
