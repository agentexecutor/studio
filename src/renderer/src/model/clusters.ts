import { useSyncExternalStore } from 'react'
import type { ContainerRuntime } from '../../../shared/api'
import type { ConsoleLine } from '../components'
import { store } from './store'

/** Ready/total replicas, or null when the component isn't installed. */
export type Replicas = { ready: number; total: number } | null

export interface Cluster {
  name: string
  context: string
  reachable: boolean
  nodes: Replicas
  version: string
  substrate: Replicas
  substrateCommit: string
  ax: Replicas
  workers: Replicas
  /** Whether the cluster's context is in your kubeconfig, which ax needs to reach it. */
  inKubeconfig: boolean
}

export type StageID = 'kind' | 'substrate' | 'workers' | 'ax'
export const STAGES: { id: StageID; title: string }[] = [
  { id: 'kind', title: 'Kind cluster' },
  { id: 'substrate', title: 'Agent Substrate' },
  { id: 'workers', title: 'Worker pool' },
  { id: 'ax', title: 'AX control plane' },
]

export interface Operation {
  kind: 'create' | 'start' | 'install' | 'delete' | 'kubeconfig'
  cluster: string
  stage: StageID | null
  status: 'running' | 'ok' | 'failed'
  exit?: number
  started: number
  finished?: number
}

export interface NewCluster {
  name: string
  workers: number
  /** The ax-server image. ax has no default for it yet, so it's required. */
  serverImage: string
  /** Optional; empty leaves the choice to ax. */
  defaultTaskImage: string
  /** Optional; empty leaves the choice to ax. */
  runnerVolumeImage: string
}

export interface ClustersState {
  clusters: Cluster[]
  loading: boolean
  loaded: boolean
  runtime: ContainerRuntime | null
  /** Memory of the podman machine in MiB, on macOS and Windows. */
  machineMemory: number | null
  /** Whether `ax` was found. It downloads kind and kubectl itself when they're missing. */
  axFound: boolean
  op: Operation | null
  log: ConsoleLine[]
  form: NewCluster
}

/** The name `ax local` uses by default. Its context is `ax-local`; any other cluster's is `kind-<name>`. */
const DEFAULT_NAME = 'ax-local'
export const contextFor = (name: string) => (name === DEFAULT_NAME ? DEFAULT_NAME : `kind-${name}`)
/** Below this (MiB) the podman machine is too small for the local cluster. */
const MIN_MACHINE_MEMORY = 6144
/** The images last used, so they don't have to be typed again. */
const IMAGES_KEY = 'ax-studio.images'
type Images = Pick<NewCluster, 'serverImage' | 'defaultTaskImage' | 'runnerVolumeImage'>

function loadImages(): Images {
  const empty: Images = { serverImage: '', defaultTaskImage: '', runnerVolumeImage: '' }
  try {
    return { ...empty, ...JSON.parse(localStorage.getItem(IMAGES_KEY) ?? '{}') }
  } catch {
    return empty
  }
}
const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
export const NAME_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/

/** Prints key=value lines describing kind cluster $1; kubectl reads a throwaway kubeconfig from kind. */
const PROBE = `
kc=$(mktemp)
if ! kind get kubeconfig --name "$1" > "$kc" 2>/dev/null; then echo reachable=0; rm -f "$kc"; exit 0; fi
k() { kubectl --kubeconfig "$kc" --request-timeout=5s "$@" 2>/dev/null; }
if ! n=$(k get nodes --no-headers); then echo reachable=0; rm -f "$kc"; exit 0; fi
echo reachable=1
echo "nodes=$(printf '%s\\n' "$n" | awk '$2 ~ /^Ready/ { r++ } END { print r+0 "/" NR }')"
echo "version=$(k get nodes -o jsonpath='{.items[0].status.nodeInfo.kubeletVersion}')"
echo "substrate=$(k -n ate-system get deploy ate-api-server -o jsonpath='{.status.readyReplicas}/{.spec.replicas}')"
echo "commit=$(k get ns ate-system -o jsonpath='{.metadata.annotations.substrate-commit}')"
echo "ax=$(k -n ax-system get deploy ax-server -o jsonpath='{.status.readyReplicas}/{.spec.replicas}')"
echo "workers=$(k -n ax-system get workerpool ax-workers -o jsonpath='{.status.readyReplicas}/{.spec.replicas}')"
rm -f "$kc"
`

function replicas(v: string | undefined): Replicas {
  if (!v || !v.includes('/')) return null
  const [r, t] = v.split('/')
  if (t === '') return null
  return { ready: Number(r) || 0, total: Number(t) || 0 }
}

/** Which of ax's "==> " progress lines starts which stage. */
function stageFor(line: string): StageID | null {
  if (!line.startsWith('==> ')) return null
  if (/Kind cluster/.test(line)) return 'kind'
  if (/WorkerPool/.test(line)) return 'workers'
  if (/Substrate permissions|ax-postgres|ax-server|AX is ready/.test(line)) return 'ax'
  if (/Substrate/.test(line)) return 'substrate'
  return null
}

class ClustersStore {
  state: ClustersState = {
    clusters: [],
    loading: false,
    loaded: false,
    runtime: null,
    machineMemory: null,
    axFound: true,
    op: null,
    log: [],
    form: { name: '', workers: 1, ...loadImages() },
  }
  private listeners = new Set<() => void>()
  private lineID = 1
  private streamID = 0
  private pending: ConsoleLine[] = []
  private flushScheduled = false

  subscribe = (l: () => void) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  set(patch: Partial<ClustersState>) {
    this.state = { ...this.state, ...patch }
    for (const l of this.listeners) l()
  }

  setForm(patch: Partial<NewCluster>) {
    const form = { ...this.state.form, ...patch }
    const { serverImage, defaultTaskImage, runnerVolumeImage } = form
    localStorage.setItem(IMAGES_KEY, JSON.stringify({ serverImage, defaultTaskImage, runnerVolumeImage }))
    this.set({ form })
  }

  get running() {
    return this.state.op?.status === 'running'
  }

  /** For the kind commands this page runs itself. ax works out the container runtime on its own. */
  private env(): Record<string, string> {
    return this.state.runtime?.env ?? {}
  }

  async init() {
    const runtime = await window.studio.containerRuntime()
    this.set({ runtime })
    if (runtime.runtime === 'podman') {
      const r = await window.studio.run({ program: 'podman', args: ['machine', 'inspect', '--format', '{{.Resources.Memory}}'] })
      const mib = parseInt(r.stdout, 10)
      this.set({ machineMemory: r.status === 0 && mib > 0 ? mib : null })
    }
    await this.refresh()
  }

  async refresh() {
    // Looked up every time: ax puts kind in ~/.ax/bin the first time it creates a cluster.
    const [ax, kind] = await Promise.all([window.studio.which(store.state.settings.axPath), window.studio.which('kind')])
    this.set({ axFound: !!ax })
    if (!kind || !this.state.runtime?.runtime) {
      this.set({ clusters: [], loaded: true })
      return
    }
    this.set({ loading: true })
    try {
      const env = this.env()
      const [list, ctxs] = await Promise.all([
        window.studio.run({ program: 'kind', args: ['get', 'clusters'], env }),
        window.studio.run({ program: 'kubectl', args: ['config', 'get-contexts', '-o', 'name'] }),
      ])
      const names = list.status === 0 ? list.stdout.split('\n').map((l) => l.trim()).filter((l) => l && !l.includes(' ')) : []
      const contexts = new Set(ctxs.stdout.split('\n').map((l) => l.trim()))
      const clusters = await Promise.all(names.map(async (name): Promise<Cluster> => {
        const r = await window.studio.run({ program: '/bin/sh', args: ['-c', PROBE, 'probe', name], env })
        const kv = Object.fromEntries(r.stdout.split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
        // ax renames kind-ax-local to ax-local; a cluster made by kind alone keeps the kind- name.
        const context = [contextFor(name), `kind-${name}`].find((x) => contexts.has(x)) ?? contextFor(name)
        return {
          name,
          context,
          reachable: kv.reachable === '1',
          nodes: replicas(kv.nodes),
          version: kv.version ?? '',
          substrate: replicas(kv.substrate),
          substrateCommit: kv.commit ?? '',
          ax: replicas(kv.ax),
          workers: replicas(kv.workers),
          inKubeconfig: contexts.has(context),
        }
      }))
      const form = this.state.form.name ? this.state.form : { ...this.state.form, name: freeName(names) }
      this.set({ clusters, form })
    } finally {
      this.set({ loading: false, loaded: true })
    }
  }

  /** What stops this page from doing anything with ax. */
  get problems(): string[] {
    const p: string[] = []
    const { axFound, runtime } = this.state
    if (!axFound) p.push(`ax was not found (${store.state.settings.axPath}). Set its path in Settings.`)
    if (runtime && !runtime.runtime) p.push('Neither docker nor podman is installed; a local cluster needs one.')
    return p
  }

  /** What's wrong with the images in the form. They apply to creating a cluster and to installing AX. */
  get imageProblems(): string[] {
    const { serverImage, defaultTaskImage, runnerVolumeImage } = this.state.form
    const p: string[] = []
    if (!serverImage.trim()) p.push('Set the ax-server image; ax has no default for it yet.')
    for (const [label, value] of [['The server image', serverImage], ['The task image', defaultTaskImage], ['The runner volume image', runnerVolumeImage]]) {
      const v = value.trim()
      if (v && (v.startsWith('-') || /\s/.test(v))) p.push(`${label} is not an image reference.`)
    }
    return p
  }

  /** Likely failures that don't block creating a cluster. */
  get warnings(): string[] {
    const mib = this.state.machineMemory
    if (mib === null || mib >= MIN_MACHINE_MEMORY) return []
    return [`The podman machine has ${Math.round(mib / 1024)} GiB of memory; the local cluster needs about ${MIN_MACHINE_MEMORY / 1024} GiB. Run: podman machine stop && podman machine set --memory 8192 && podman machine start`]
  }

  nameProblem(name: string): string | null {
    if (!name) return 'Name the cluster.'
    if (!NAME_RE.test(name)) return 'Use lowercase letters, digits and dashes.'
    if (this.state.clusters.some((c) => c.name === name)) return `A kind cluster named ${name} already exists.`
    return null
  }

  /** An `ax` command line for the shell that runs cluster steps. */
  private ax(args: string[]): string {
    return [store.state.settings.axPath, ...args].map(shq).join(' ')
  }

  private imageArgs(): string[] {
    const { serverImage, defaultTaskImage, runnerVolumeImage } = this.state.form
    const args: string[] = []
    if (serverImage.trim()) args.push('--server-image', serverImage.trim())
    if (defaultTaskImage.trim()) args.push('--default-task-image', defaultTaskImage.trim())
    if (runnerVolumeImage.trim()) args.push('--runner-volume-image', runnerVolumeImage.trim())
    return args
  }

  /**
   * `ax local start` creates the kind cluster or starts a stopped one, installs
   * Agent Substrate and AX, and makes the cluster's context the current one
   * in your kubeconfig. It's safe to run again on a cluster that's already up.
   */
  private localStart(name: string): string {
    return this.ax(['local', 'start', '--name', name, '--workers', String(this.state.form.workers), ...this.imageArgs()])
  }

  /** `ax install` installs or upgrades AX on a cluster that already runs Agent Substrate. */
  private installOnContext(context: string): string {
    return this.ax(['--context', context, 'install', ...this.imageArgs()])
  }

  async create() {
    const { name } = this.state.form
    await this.exec({ kind: 'create', cluster: name, stage: 'kind' }, `Create ${name}`, this.localStart(name))
  }

  /** Brings a stopped cluster back up. */
  async start(name: string) {
    await this.exec({ kind: 'start', cluster: name, stage: 'kind' }, `Start ${name}`, this.localStart(name))
  }

  /**
   * Installs AX on a kind cluster. A running cluster with Substrate only needs
   * `ax install`; one without it, or one ax can't reach through your
   * kubeconfig yet, gets the whole of `ax local start`.
   */
  async install(c: Cluster) {
    const direct = !!c.substrate && c.inKubeconfig
    await this.exec({ kind: 'install', cluster: c.name, stage: direct ? 'ax' : 'kind' }, `Install AX on ${c.name}`,
      direct ? this.installOnContext(c.context) : this.localStart(c.name))
  }

  /** Installs AX on any cluster in your kubeconfig that already runs Agent Substrate. */
  async installOn(context: string) {
    await this.exec({ kind: 'install', cluster: context, stage: 'ax' }, `Install AX on ${context}`, this.installOnContext(context))
  }

  async remove(name: string) {
    await this.exec({ kind: 'delete', cluster: name, stage: null }, `Delete ${name}`, this.ax(['local', 'delete', '--name', name]))
  }

  /** Adds kind-<name> to your kubeconfig (keeping its current context) so ax can use it. */
  async addToKubeconfig(name: string): Promise<boolean> {
    const tmp = `$TMPDIR/ax-studio-kind-${name}.yaml`
    const ok = await this.exec({ kind: 'kubeconfig', cluster: name, stage: null }, `Add kind-${name} to kubeconfig`, [
      'set -e',
      'ORIG=${KUBECONFIG:-$HOME/.kube/config}; ORIG=${ORIG%%:*}',
      `TMPDIR=\${TMPDIR:-/tmp}; kind get kubeconfig --name ${shq(name)} > "${tmp}"`,
      mergeScript(tmp),
      `rm -f "${tmp}"`,
      `echo "kind-${name} added to $ORIG"`,
    ].join('\n'), this.env())
    return ok
  }

  async open(c: Cluster) {
    let context = c.context
    if (!c.inKubeconfig) {
      if (!(await this.addToKubeconfig(c.name))) return
      context = `kind-${c.name}`
    }
    await store.loadContexts()
    store.setScope({ context })
    store.setSection('overview')
  }

  cancel() {
    void window.studio.cancelStream(`clusters-${this.streamID}`)
  }

  private append(text: string, header?: ConsoleLine['header']) {
    this.pending.push({ id: this.lineID++, text, header })
    if (this.flushScheduled) return
    this.flushScheduled = true
    requestAnimationFrame(() => {
      this.flushScheduled = false
      const log = [...this.state.log, ...this.pending].slice(-5000)
      this.pending = []
      this.set({ log })
    })
  }

  private patchOp(patch: Partial<Operation>) {
    if (this.state.op) this.set({ op: { ...this.state.op, ...patch } })
  }

  private async exec(op: Pick<Operation, 'kind' | 'cluster' | 'stage'>, title: string, command: string, env: Record<string, string> = {}): Promise<boolean> {
    if (this.running) return false
    const staged = op.stage !== null
    this.set({ op: { ...op, status: 'running', started: Date.now() }, log: [] })
    this.append(`▶ ${title}`, 'start')
    const streamID = `clusters-${++this.streamID}`
    const cwd = (await window.studio.platform()).home
    const status = await new Promise<number>((resolve) => {
      const offLine = window.studio.onStreamLine((l) => {
        if (l.id !== streamID) return
        this.append(l.line)
        const stage = staged ? stageFor(l.line) : null
        if (stage) this.patchOp({ stage })
      })
      const offExit = window.studio.onStreamExit((e) => {
        if (e.id !== streamID) return
        offLine()
        offExit()
        resolve(e.status)
      })
      void window.studio.stream({ id: streamID, commandLine: command, cwd, env })
    })
    const ok = status === 0
    this.patchOp({ status: ok ? 'ok' : 'failed', exit: status, finished: Date.now() })
    this.append(ok ? `✓ ${title} done` : `✗ ${title} failed (exit ${status})`, ok ? 'ok' : 'fail')
    if (ok && op.kind === 'create') this.setForm({ name: '' })
    void this.refresh()
    // ax adds, renames and removes contexts; let the rest of the app see them.
    if (op.kind !== 'kubeconfig') void store.loadContexts()
    return ok
  }
}

/**
 * Merges the kubeconfig at $1 into $ORIG. kubectl keeps the first file's
 * current-context, so yours is unchanged; the old file is kept as a backup.
 */
function mergeScript(src: string): string {
  return [
    'mkdir -p "$(dirname "$ORIG")"',
    '[ -f "$ORIG" ] && cp "$ORIG" "$ORIG.ax-studio.bak"',
    `KUBECONFIG="$ORIG:${src}" kubectl config view --flatten > "$ORIG.ax-studio.tmp"`,
    'mv "$ORIG.ax-studio.tmp" "$ORIG"',
  ].join('\n')
}

function freeName(taken: string[]): string {
  if (!taken.includes(DEFAULT_NAME)) return DEFAULT_NAME
  for (let i = 2; ; i++) if (!taken.includes(`${DEFAULT_NAME}-${i}`)) return `${DEFAULT_NAME}-${i}`
}

export const clusters = new ClustersStore()
export const useClusters = () => useSyncExternalStore(clusters.subscribe, () => clusters.state)
