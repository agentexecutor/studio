import { useSyncExternalStore } from 'react'
import type { ConsoleLine } from '../components'
import { store } from './store'

/** Ready/total replicas, or null when the component isn't installed. */
export type Replicas = { ready: number; total: number } | null

/** One check of this machine before a local sandbox is set up. */
export interface PreflightItem {
  id: string
  label: string
  status: 'ok' | 'warn' | 'fail'
  detail: string
  /** A command that fixes a failed check. */
  command?: string
}

/** The kind cluster `ax local` manages, with Agent Substrate and AX on it. */
export interface LocalSandbox {
  state: 'NotFound' | 'Stopped' | 'Running'
  name: string
  context: string
  substrate: Replicas
  ax: Replicas
}

export type StageID = 'kind' | 'substrate' | 'workers' | 'ax'
export const STAGES: { id: StageID; title: string }[] = [
  { id: 'kind', title: 'Kind cluster' },
  { id: 'substrate', title: 'Agent Substrate' },
  { id: 'workers', title: 'gVisor WorkerPool' },
  { id: 'ax', title: 'AX control plane' },
]

export interface Operation {
  kind: 'setup' | 'stop' | 'delete' | 'install'
  /** The local cluster's name, or the context AX is installed on. */
  target: string
  stage: StageID | null
  status: 'running' | 'ok' | 'failed'
  exit?: number
  started: number
  finished?: number
}

/** The images `ax local start` and `ax install` deploy. */
export interface Images {
  /** ax has no default for the ax-server image yet, so it's required. */
  serverImage: string
  /** Optional; empty leaves the choice to ax. */
  defaultTaskImage: string
  /** Optional; empty leaves the choice to ax. */
  runnerVolumeImage: string
}

export interface ClustersState {
  preflight: PreflightItem[]
  local: LocalSandbox
  loading: boolean
  loaded: boolean
  /** Whether `ax` was found. It downloads kind and kubectl itself when they're missing. */
  axFound: boolean
  images: Images
  op: Operation | null
  log: ConsoleLine[]
}

/** The name `ax local` gives its cluster; the cluster's context has the same name. */
const LOCAL_NAME = 'ax-local'
/** Contexts that belong to the local sandbox, under its current and earlier names. */
const LOCAL_CONTEXTS = new Set([LOCAL_NAME, `kind-${LOCAL_NAME}`, 'local', 'kind-local'])
export const isLocalContext = (name: string) => LOCAL_CONTEXTS.has(name)

const NO_SANDBOX: LocalSandbox = { state: 'NotFound', name: LOCAL_NAME, context: LOCAL_NAME, substrate: null, ax: null }

const GIB = 1024 ** 3
// The limits `ax local start` enforces on the container host (see ax's executil.ValidateContainerHost).
const MIN_KERNEL: [number, number] = [6, 8]
const MIN_MEMORY = 4 * GIB
const RECOMMENDED_MEMORY = 6 * GIB
const MIN_DISK = 8 * GIB
const RECOMMENDED_DISK = 15 * GIB

/** The images last used, so they don't have to be typed again. */
const IMAGES_KEY = 'ax-studio.images'

function loadImages(): Images {
  const empty: Images = { serverImage: '', defaultTaskImage: '', runnerVolumeImage: '' }
  try {
    return { ...empty, ...JSON.parse(localStorage.getItem(IMAGES_KEY) ?? '{}') }
  } catch {
    return empty
  }
}

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

/**
 * Prints key=value lines describing the local sandbox. $1 is the container
 * engine and $2 the AX namespace. It only reads: it asks the engine for the
 * kind node containers, so it works before kind is installed.
 */
const PROBE = `
rt=$1; ns=$2
for name in ${LOCAL_NAME} local; do
  nodes=$("$rt" ps -a --filter "label=io.x-k8s.kind.cluster=$name" --format '{{.Names}}' 2>/dev/null)
  [ -n "$nodes" ] && break
done
if [ -z "$nodes" ]; then echo state=NotFound; exit 0; fi
echo "name=$name"
for n in $nodes; do
  if [ "$("$rt" inspect -f '{{.State.Running}}' "$n" 2>/dev/null)" != true ]; then echo state=Stopped; exit 0; fi
done
echo state=Running
k() { kubectl --context "$name" --request-timeout=4s "$@" 2>/dev/null; }
echo "substrate=$(k -n ate-system get deployment ate-api-server -o jsonpath='{.status.availableReplicas}/{.spec.replicas}')"
echo "ax=$(k -n "$ns" get deployment ax-server -o jsonpath='{.status.availableReplicas}/{.spec.replicas}')"
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

const gib = (bytes: number) => (bytes / GIB).toFixed(1)

/** Checks the container engine's host, or VM on macOS, the way `ax local start` will. */
async function checkEngine(os: string): Promise<PreflightItem> {
  const item = { id: 'container_engine', label: 'Container runtime & VM' }
  const mac = os === 'darwin'
  const { runtime } = await window.studio.containerRuntime()
  const start = mac
    ? { detail: 'Start OrbStack, Docker Desktop or Colima (6 GiB of RAM or more) to run sandboxes locally, or connect to a team cluster.',
        command: 'colima start --cpu 4 --memory 8 --disk 60 --vm-type vz --mount-type virtiofs' }
    : { detail: 'No running rootful Docker or Podman engine was found.', command: 'sudo systemctl start docker' }
  if (!runtime) return { ...item, status: 'fail', ...start }

  // Docker and Podman name these fields differently.
  const format = runtime === 'podman'
    ? '{{.Host.Kernel}}|{{.Host.MemTotal}}|{{.Host.Security.Rootless}}'
    : '{{.KernelVersion}}|{{.MemTotal}}|{{.SecurityOptions}}'
  const r = await window.studio.run({ program: runtime, args: ['info', '--format', format] })
  const parts = r.stdout.trim().split('|')
  if (r.status !== 0 || parts.length < 3) return { ...item, status: 'fail', ...start }

  const kernel = parts[0].trim()
  const memory = Number(parts[1].trim()) || 0
  const security = parts.slice(2).join('|').trim().toLowerCase()
  if (security === 'true' || security.includes('name=rootless')) {
    return {
      ...item, status: 'fail',
      detail: `Rootless ${runtime} can't run the local sandbox; kind's node settings and Agent Substrate need a rootful engine.`,
      command: runtime === 'podman' ? 'podman machine stop && podman machine set --rootful && podman machine start' : undefined,
    }
  }
  const version = /^(\d+)\.(\d+)/.exec(kernel)
  if (version && (Number(version[1]) < MIN_KERNEL[0] || (Number(version[1]) === MIN_KERNEL[0] && Number(version[2]) < MIN_KERNEL[1]))) {
    return {
      ...item, status: 'fail',
      detail: `The container host's Linux kernel ${kernel} is older than ${MIN_KERNEL.join('.')}, which Agent Substrate needs. ${mac ? 'Upgrade your container VM.' : 'Upgrade the kernel.'}`,
    }
  }
  if (memory > 0 && memory < MIN_MEMORY) {
    return {
      ...item, status: 'fail',
      detail: `The container host has only ${gib(memory)} GiB of RAM; Kubernetes, Agent Substrate and AX need at least ${gib(MIN_MEMORY)}.`,
      command: mac ? 'colima stop && colima start --cpu 4 --memory 8 --disk 60 --vm-type vz --mount-type virtiofs' : undefined,
    }
  }
  if (memory > 0 && memory < RECOMMENDED_MEMORY) {
    return { ...item, status: 'warn', detail: `The container host has ${gib(memory)} GiB of RAM; with less than ${gib(RECOMMENDED_MEMORY)}, pods may stay Pending under load.` }
  }
  return { ...item, status: 'ok', detail: kernel && memory > 0 ? `${runtime} ready · kernel ${kernel} · ${gib(memory)} GiB RAM` : `${runtime} ready` }
}

/** Free space in the home directory, or null where `df` can't say. */
async function checkDisk(home: string): Promise<PreflightItem | null> {
  const r = await window.studio.run({ program: 'df', args: ['-Pk', home] })
  const free = Number(r.stdout.trim().split('\n')[1]?.trim().split(/\s+/)[3]) * 1024
  if (r.status !== 0 || !(free > 0)) return null
  const item = { id: 'disk_space', label: 'Available disk space' }
  if (free < MIN_DISK) return { ...item, status: 'fail', detail: `${gib(free)} GiB free; the kind and Substrate images need at least ${gib(MIN_DISK)}.` }
  if (free < RECOMMENDED_DISK) return { ...item, status: 'warn', detail: `${gib(free)} GiB free; ${gib(RECOMMENDED_DISK)} or more is recommended.` }
  return { ...item, status: 'ok', detail: `${gib(free)} GiB free` }
}

class ClustersStore {
  state: ClustersState = {
    preflight: [],
    local: NO_SANDBOX,
    loading: false,
    loaded: false,
    axFound: true,
    images: loadImages(),
    op: null,
    log: [],
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

  setImages(patch: Partial<Images>) {
    const images = { ...this.state.images, ...patch }
    localStorage.setItem(IMAGES_KEY, JSON.stringify(images))
    this.set({ images })
  }

  get running() {
    return this.state.op?.status === 'running'
  }

  async init() {
    await this.refresh()
  }

  /** Re-runs the checks, looks at the local sandbox again and re-reads the contexts. */
  async refresh() {
    this.set({ loading: true })
    try {
      const { os, home } = await window.studio.platform()
      const [ax, arch, engine, disk] = await Promise.all([
        window.studio.which(store.state.settings.axPath),
        window.studio.run({ program: 'uname', args: ['-m'] }),
        checkEngine(os),
        checkDisk(home),
        store.loadContexts(),
      ])
      const cpu = arch.stdout.trim().replace('x86_64', 'amd64').replace('aarch64', 'arm64')
      const preflight: PreflightItem[] = [
        { id: 'os_arch', label: 'Operating system & CPU', status: 'ok', detail: cpu ? `${os}/${cpu}` : os },
        engine,
        ...(disk ? [disk] : []),
      ]
      this.set({ axFound: !!ax, preflight, local: engine.status === 'fail' ? NO_SANDBOX : await this.probeLocal() })
    } finally {
      this.set({ loading: false, loaded: true })
    }
  }

  private async probeLocal(): Promise<LocalSandbox> {
    const { runtime } = await window.studio.containerRuntime()
    if (!runtime) return NO_SANDBOX
    const r = await window.studio.run({ program: '/bin/sh', args: ['-c', PROBE, 'probe', runtime, 'ax-system'] })
    const kv = Object.fromEntries(r.stdout.split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
    const state = kv.state === 'Running' || kv.state === 'Stopped' ? kv.state : 'NotFound'
    const name: string = kv.name || LOCAL_NAME
    return { state, name, context: name, substrate: replicas(kv.substrate), ax: replicas(kv.ax) }
  }

  /** What stops a local sandbox from being set up. */
  get localBlockers(): string[] {
    const p = this.state.preflight.filter((x) => x.status === 'fail').map((x) => x.detail)
    return [...this.axProblems, ...p, ...this.imageProblems]
  }

  /** What stops AX from being installed on a cluster. */
  get installBlockers(): string[] {
    return [...this.axProblems, ...this.imageProblems]
  }

  private get axProblems(): string[] {
    return this.state.axFound ? [] : [`ax was not found (${store.state.settings.axPath}). Set its path in Settings.`]
  }

  /** What's wrong with the images. They apply to the local sandbox and to installing AX on a cluster. */
  get imageProblems(): string[] {
    const { serverImage, defaultTaskImage, runnerVolumeImage } = this.state.images
    const p: string[] = []
    if (!serverImage.trim()) p.push('Set the ax-server image; ax has no default for it yet.')
    for (const [label, value] of [['The server image', serverImage], ['The task image', defaultTaskImage], ['The runner volume image', runnerVolumeImage]]) {
      const v = value.trim()
      if (v && (v.startsWith('-') || /\s/.test(v))) p.push(`${label} is not an image reference.`)
    }
    return p
  }

  /** An `ax` command line for the shell that runs these steps. */
  private ax(args: string[]): string {
    return [store.state.settings.axPath, ...args].map(shq).join(' ')
  }

  private imageArgs(): string[] {
    const { serverImage, defaultTaskImage, runnerVolumeImage } = this.state.images
    const args: string[] = []
    if (serverImage.trim()) args.push('--server-image', serverImage.trim())
    if (defaultTaskImage.trim()) args.push('--default-task-image', defaultTaskImage.trim())
    if (runnerVolumeImage.trim()) args.push('--runner-volume-image', runnerVolumeImage.trim())
    return args
  }

  /**
   * `ax local start` creates the kind cluster or starts a stopped one, installs
   * Agent Substrate and AX, and makes the cluster's context the current one in
   * your kubeconfig. It's safe to run again on a sandbox that's already up.
   */
  async setUpLocal() {
    const { name } = this.state.local
    await this.exec({ kind: 'setup', target: name, stage: 'kind' }, 'Set up the local sandbox (ax local start)',
      this.ax(['local', 'start', '--name', name, ...this.imageArgs()]))
  }

  /** Stops the cluster's containers; its state is kept. */
  async stopLocal() {
    const { name } = this.state.local
    await this.exec({ kind: 'stop', target: name, stage: null }, 'Stop the local sandbox (ax local stop)', this.ax(['local', 'stop', '--name', name]))
  }

  async deleteLocal() {
    const { name } = this.state.local
    await this.exec({ kind: 'delete', target: name, stage: null }, 'Delete the local sandbox (ax local delete)', this.ax(['local', 'delete', '--name', name]))
  }

  /** `ax install` installs or upgrades AX on a cluster that already runs Agent Substrate. */
  async installOn(context: string) {
    await this.exec({ kind: 'install', target: context, stage: null }, `Install AX on ${context} (ax install)`,
      this.ax(['--context', context, 'install', ...this.imageArgs()]))
  }

  /** Points the rest of the app at a context. Your kubectl context stays as it is. */
  connect(context: string) {
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

  private async exec(op: Pick<Operation, 'kind' | 'target' | 'stage'>, title: string, command: string): Promise<boolean> {
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
      void window.studio.stream({ id: streamID, commandLine: command, cwd })
    })
    const ok = status === 0
    this.patchOp({ status: ok ? 'ok' : 'failed', exit: status, finished: Date.now() })
    this.append(ok ? `✓ ${title} done` : `✗ ${title} failed (exit ${status})`, ok ? 'ok' : 'fail')
    // ax adds and removes contexts and tasks; refresh re-reads the contexts too.
    void this.refresh().then(() => store.refresh(true))
    return ok
  }
}

export const clusters = new ClustersStore()
export const useClusters = () => useSyncExternalStore(clusters.subscribe, () => clusters.state)
