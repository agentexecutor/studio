import { useSyncExternalStore } from 'react'
import type { ConsoleLine } from '../components'
import { errorSummary } from './resources'
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

/** A command-line tool the local sandbox depends on. */
export interface Tool {
  name: string
  /** Empty when the tool isn't installed or doesn't say. */
  version: string
  /** `none` is a tool that's missing but that ax downloads when it's needed. */
  status: 'ok' | 'warn' | 'fail' | 'none'
  /** Where it is, or what happens without it. */
  detail: string
}

/** The kind cluster `ax local` manages, with Agent Substrate and AX on it. */
export interface LocalSandbox {
  state: 'NotFound' | 'Stopped' | 'Running'
  name: string
  context: string
  /**
   * Whether kubectl can look inside a running cluster. Without the cluster's
   * context in the kubeconfig, or an API server that answers, what's installed
   * on it is unknown rather than missing.
   */
  access: 'ok' | 'no-context' | 'unreachable'
  substrate: Replicas
  ax: Replicas
}

/** What a look at a cluster in the kubeconfig found: whether it can run AX, and how far along it is. */
export interface ClusterCheck {
  checking: boolean
  /** Why the cluster couldn't be reached. The rest is empty then. */
  error?: string
  /** What the cluster itself has to offer before Agent Substrate and AX can run on it. */
  requirements: PreflightItem[]
  /** Substrate's API server and router. */
  substrate: Replicas
  router: Replicas
  /** Worker pools with every replica ready, out of all the pools. */
  workerPools: { ready: number; total: number }
  ax: Replicas
  axImage: string
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
  /** What a setup amounts to for the sandbox as it was: setting it up, resuming, repairing or updating it. */
  wording?: { doing: string; done: string }
  stage: StageID | null
  /** When each stage began, for the ones that have. */
  stageStarted: Partial<Record<StageID, number>>
  /** The step ax last announced, e.g. "Deploying ax-server (…)...". */
  step?: string
  status: 'running' | 'ok' | 'failed'
  exit?: number
  started: number
  finished?: number
}

export interface StageProgress {
  state: 'idle' | 'running' | 'ok' | 'failed'
  /** How long the stage has taken; 0 for one that hasn't run or had nothing to do. */
  ms: number
}

/** Where each stage of a staged operation stands, and how long it has taken. */
export function stageProgress(op: Operation, now = Date.now()): Record<StageID, StageProgress> {
  const current = STAGES.findIndex((x) => x.id === op.stage)
  const end = op.finished ?? now
  const out = {} as Record<StageID, StageProgress>
  STAGES.forEach((stage, i) => {
    const started = op.stageStarted[stage.id]
    // A stage ends when the next one that ran begins.
    const next = STAGES.slice(i + 1).map((x) => op.stageStarted[x.id]).find((t) => t !== undefined)
    const state = op.status === 'ok' || i < current ? 'ok' : i > current ? 'idle' : op.status === 'failed' ? 'failed' : 'running'
    out[stage.id] = { state, ms: started === undefined ? 0 : Math.max(0, (next ?? end) - started) }
  })
  return out
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
  tools: Tool[]
  local: LocalSandbox
  /** The clusters that have been checked, by context. */
  checks: Record<string, ClusterCheck>
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

const NO_SANDBOX: LocalSandbox = { state: 'NotFound', name: LOCAL_NAME, context: LOCAL_NAME, access: 'ok', substrate: null, ax: null }

const NO_CHECK: ClusterCheck = { checking: false, requirements: [], substrate: null, router: null, workerPools: { ready: 0, total: 0 }, ax: null, axImage: '' }

/** The oldest Kubernetes that Agent Substrate and AX support. */
const MIN_KUBERNETES: [number, number] = [1, 36]

const GIB = 1024 ** 3
// The limits `ax local start` enforces on the container host (see ax's executil.ValidateContainerHost).
const MIN_KERNEL: [number, number] = [6, 8]
const MIN_MEMORY = 4 * GIB
const RECOMMENDED_MEMORY = 6 * GIB
const MIN_DISK = 8 * GIB
const RECOMMENDED_DISK = 15 * GIB
/** ax uses the kind on PATH only from v0.<this>; otherwise it keeps its own in ~/.ax/bin (ax's executil.EnsureKind). */
const MIN_KIND_MINOR = 32

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
if ! kubectl config get-contexts "$name" >/dev/null 2>&1; then echo access=no-context; exit 0; fi
k() { kubectl --context "$name" --request-timeout=4s "$@" 2>/dev/null; }
if ! k get --raw=/version >/dev/null; then echo access=unreachable; exit 0; fi
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

const COLIMA_START = 'colima start --cpu 4 --memory 8 --disk 60 --vm-type vz --mount-type virtiofs'

/**
 * macOS has no Linux kernel, so containers run in a Linux VM that one of a
 * few apps provides. With no engine answering, this says which of them are
 * installed and how to start one, or that there's none to start.
 */
async function macVMAdvice(): Promise<{ detail: string; command: string }> {
  const [orb, orbApp, dockerApp, colima, podman] = await Promise.all([
    window.studio.which('orbctl'),
    window.studio.fileExists('/Applications/OrbStack.app'),
    window.studio.fileExists('/Applications/Docker.app'),
    window.studio.which('colima'),
    window.studio.which('podman'),
  ])
  const found: { name: string; command: string }[] = []
  if (orb || orbApp) found.push({ name: 'OrbStack', command: 'open -a OrbStack' })
  if (dockerApp) found.push({ name: 'Docker Desktop', command: 'open -a Docker' })
  if (colima) found.push({ name: 'Colima', command: COLIMA_START })
  if (podman) found.push({ name: 'Podman', command: 'podman machine start' })
  if (!found.length) {
    return {
      detail: 'No Linux VM for containers is installed. macOS needs one to run the sandbox locally: install OrbStack, Docker Desktop or Colima, or connect to a team cluster instead.',
      command: `brew install docker colima && ${COLIMA_START}`,
    }
  }
  const names = found.map((x) => x.name).join(', ')
  return {
    detail: `${names} ${found.length > 1 ? 'are' : 'is'} installed, but no Linux VM is running. Start ${found.length > 1 ? 'one' : 'it'} with at least 6 GiB of RAM, or connect to a team cluster instead.`,
    command: found[0].command,
  }
}

/** Which app's Linux VM a macOS Docker engine runs in, from what `docker info` says about its host. */
function macVMName(runtime: string, hostOS: string, hostName: string): string {
  if (runtime === 'podman') return 'Podman machine'
  if (/orbstack/i.test(hostOS)) return 'OrbStack'
  if (/docker desktop/i.test(hostOS)) return 'Docker Desktop'
  if (/rancher/i.test(hostOS + hostName)) return 'Rancher Desktop'
  if (/colima/i.test(hostName)) return 'Colima'
  return hostOS
}

/** Checks the container engine's host, or VM on macOS, the way `ax local start` will. */
async function checkEngine(os: string): Promise<PreflightItem> {
  const mac = os === 'darwin'
  // Only macOS puts a Linux VM under the engine; on Linux it runs on the host's own kernel.
  const item = { id: 'container_engine', label: mac ? 'Container runtime & VM' : 'Container runtime' }
  const { runtime } = await window.studio.containerRuntime()
  const notRunning = async (): Promise<PreflightItem> => ({
    ...item, status: 'fail',
    ...(mac ? await macVMAdvice() : { detail: 'No running rootful Docker or Podman engine was found.', command: 'sudo systemctl start docker' }),
  })
  if (!runtime) return notRunning()

  // Kernel, memory, the host's OS and name, then the security options. Docker
  // and Podman name the fields differently; Podman's host is always its machine.
  const format = runtime === 'podman'
    ? '{{.Host.Kernel}}|{{.Host.MemTotal}}|||{{.Host.Security.Rootless}}'
    : '{{.KernelVersion}}|{{.MemTotal}}|{{.OperatingSystem}}|{{.Name}}|{{.SecurityOptions}}'
  const r = await window.studio.run({ program: runtime, args: ['info', '--format', format] })
  const parts = r.stdout.trim().split('|')
  if (r.status !== 0 || parts.length < 5) return notRunning()

  const kernel = parts[0].trim()
  const memory = Number(parts[1].trim()) || 0
  const security = parts.slice(4).join('|').trim().toLowerCase()
  const vm = mac ? macVMName(runtime, parts[2].trim(), parts[3].trim()) : ''
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
      detail: `The ${vm ? `${vm} Linux VM` : 'container host'} has only ${gib(memory)} GiB of RAM; Kubernetes, Agent Substrate and AX need at least ${gib(MIN_MEMORY)}.`,
      command: mac && vm === 'Colima' ? `colima stop && ${COLIMA_START}` : undefined,
    }
  }
  if (memory > 0 && memory < RECOMMENDED_MEMORY) {
    return { ...item, status: 'warn', detail: `The ${vm ? `${vm} Linux VM` : 'container host'} has ${gib(memory)} GiB of RAM; with less than ${gib(RECOMMENDED_MEMORY)}, pods may stay Pending under load.` }
  }
  const ready = vm ? `${runtime} ready · Linux VM: ${vm}` : `${runtime} ready`
  return { ...item, status: 'ok', detail: kernel && memory > 0 ? `${ready} · kernel ${kernel} · ${gib(memory)} GiB RAM` : ready }
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

/** What `program args` reports as its version, or '' if it can't be run. */
async function versionOf(program: string, args: string[], pattern: RegExp): Promise<string> {
  const r = await window.studio.run({ program, args })
  return r.status === 0 ? (pattern.exec(r.stdout)?.[1] ?? '') : ''
}

const kindVersion = (program: string) => versionOf(program, ['version'], /kind (v[\w.-]+)/)

function kindIsRecent(version: string): boolean {
  const m = /^v(\d+)\.(\d+)/.exec(version)
  return !!m && (Number(m[1]) > 0 || Number(m[2]) >= MIN_KIND_MINOR)
}

/**
 * The command-line tools the local sandbox needs, as ax will find them: ax
 * itself, and the kubectl and kind it uses or downloads into ~/.ax/bin.
 */
async function checkTools(home: string): Promise<Tool[]> {
  const short = (path: string) => (path.startsWith(home) ? `~${path.slice(home.length)}` : path)
  const downloaded = 'Not installed. ax downloads it into ~/.ax/bin when you set up the local sandbox.'
  const axPath = store.state.settings.axPath
  const [ax, kubectl, kind] = await Promise.all([window.studio.which(axPath), window.studio.which('kubectl'), window.studio.which('kind')])

  const axTool: Tool = ax
    ? { name: 'ax', version: await versionOf(ax, ['version'], /ax version (.+)/), status: 'ok', detail: short(ax) }
    : { name: 'ax', version: '', status: 'fail', detail: `Not found (${axPath}). Set its path in Settings.` }

  const kubectlTool: Tool = kubectl
    ? { name: 'kubectl', version: await versionOf(kubectl, ['version', '--client'], /Client Version:\s*(\S+)/), status: 'ok', detail: short(kubectl) }
    : { name: 'kubectl', version: '', status: 'none', detail: downloaded }

  const onPath = kind ? await kindVersion(kind) : ''
  let kindTool: Tool
  if (kind && kindIsRecent(onPath)) {
    kindTool = { name: 'kind', version: onPath, status: 'ok', detail: short(kind) }
  } else {
    // ax passes over a kind that's too old for one of its own.
    const tooOld = kind ? `The kind ${onPath} at ${short(kind)} is older than v0.${MIN_KIND_MINOR}.0` : ''
    const own = `${home}/.ax/bin/kind`
    const ownVersion = own !== kind && (await window.studio.fileExists(own)) ? await kindVersion(own) : ''
    if (kindIsRecent(ownVersion)) {
      kindTool = { name: 'kind', version: ownVersion, status: 'ok', detail: tooOld ? `${short(own)}. ${tooOld}, so ax uses its own.` : short(own) }
    } else if (kind) {
      kindTool = { name: 'kind', version: onPath, status: 'warn', detail: `${tooOld}. ax downloads a newer one into ~/.ax/bin when you set up the local sandbox.` }
    } else {
      kindTool = { name: 'kind', version: '', status: 'none', detail: downloaded }
    }
  }
  return [axTool, kubectlTool, kindTool]
}

class ClustersStore {
  state: ClustersState = {
    preflight: [],
    tools: [],
    local: NO_SANDBOX,
    checks: {},
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

  /**
   * Re-runs the checks, looks at the local sandbox again and re-reads the
   * contexts. Each part shows up when it's ready; the contexts aren't waited
   * for, since ax can take a minute to give up on an unreachable cluster.
   */
  async refresh() {
    this.set({ loading: true })
    void store.loadContexts()
    try {
      const { os, home } = await window.studio.platform()
      await Promise.all([
        this.checkMachine(os, home),
        checkTools(home).then((tools) => this.set({ tools, axFound: tools[0].status !== 'fail' })),
      ])
    } catch (e) {
      // Say so on the page rather than leaving it empty.
      this.set({ preflight: [{ id: 'checks', label: 'Checking this machine', status: 'fail', detail: e instanceof Error ? e.message : String(e) }] })
    } finally {
      this.set({ loading: false, loaded: true })
    }
  }

  private async checkMachine(os: string, home: string) {
    const [arch, engine, disk] = await Promise.all([
      window.studio.run({ program: 'uname', args: ['-m'] }),
      checkEngine(os),
      checkDisk(home),
    ])
    const cpu = arch.stdout.trim().replace('x86_64', 'amd64').replace('aarch64', 'arm64')
    this.set({
      preflight: [
        { id: 'os_arch', label: 'Operating system & CPU', status: 'ok', detail: cpu ? `${os}/${cpu}` : os },
        engine,
        ...(disk ? [disk] : []),
      ],
    })
    this.set({ local: engine.status === 'fail' ? NO_SANDBOX : await this.probeLocal() })
  }

  /** Looks at the local sandbox again, and nothing else. */
  async refreshLocal() {
    this.set({ local: await this.probeLocal() })
  }

  private async probeLocal(): Promise<LocalSandbox> {
    const { runtime } = await window.studio.containerRuntime()
    if (!runtime) return NO_SANDBOX
    const r = await window.studio.run({ program: '/bin/sh', args: ['-c', PROBE, 'probe', runtime, 'ax-system'] })
    const kv = Object.fromEntries(r.stdout.split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
    const state = kv.state === 'Running' || kv.state === 'Stopped' ? kv.state : 'NotFound'
    const name: string = kv.name || LOCAL_NAME
    const access = kv.access === 'no-context' || kv.access === 'unreachable' ? kv.access : 'ok'
    return { state, name, context: name, access, substrate: replicas(kv.substrate), ax: replicas(kv.ax) }
  }

  private setCheck(context: string, check: ClusterCheck) {
    this.set({ checks: { ...this.state.checks, [context]: check } })
  }

  /** Forgets what a check found, which folds its cluster's row back up. */
  clearCheck(context: string) {
    const { [context]: _, ...checks } = this.state.checks
    this.set({ checks })
  }

  /**
   * Looks at a cluster in the kubeconfig: whether it answers, whether it meets
   * what Agent Substrate and AX need, and whether each is installed. It only
   * reads, with kubectl.
   */
  async checkCluster(context: string) {
    this.setCheck(context, { ...(this.state.checks[context] ?? NO_CHECK), checking: true, error: undefined })
    const k = (args: string[]) => window.studio.run({ program: 'kubectl', args: ['--context', context, '--request-timeout=10s', ...args] })
    const lines = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean)

    // kubectl prints its own version even when the cluster doesn't answer.
    const version = await k(['version', '-o', 'json'])
    let server = ''
    try {
      server = JSON.parse(version.stdout).serverVersion?.gitVersion ?? ''
    } catch {
      // No JSON at all: kubectl itself failed.
    }
    if (version.status !== 0 || !server) {
      this.setCheck(context, { ...NO_CHECK, error: errorSummary('', version.stderr) })
      return
    }

    const [nodes, apis, storage, substrate, pools, ax] = await Promise.all([
      k(['get', 'nodes', '-o', 'jsonpath={range .items[*]}{.status.nodeInfo.kernelVersion}|{.status.nodeInfo.architecture}|{.status.conditions[?(@.type=="Ready")].status}{"\\n"}{end}']),
      k(['api-resources', '--api-group=certificates.k8s.io', '-o', 'name']),
      k(['get', 'storageclass', '-o', 'jsonpath={range .items[*]}{.metadata.name}|{.metadata.annotations.storageclass\\.kubernetes\\.io/is-default-class}{"\\n"}{end}']),
      k(['-n', 'ate-system', 'get', 'deployment', 'ate-api-server', 'atenet-router', '-o', 'jsonpath={range .items[*]}{.metadata.name}|{.status.availableReplicas}/{.spec.replicas}{"\\n"}{end}']),
      k(['get', 'workerpools', '-A', '-o', 'jsonpath={range .items[*]}{.status.readyReplicas}/{.spec.replicas}{"\\n"}{end}']),
      k(['-n', 'ax-system', 'get', 'deployment', 'ax-server', '-o', 'jsonpath={.status.availableReplicas}/{.spec.replicas}|{.spec.template.spec.containers[0].image}']),
    ])

    const requirements: PreflightItem[] = []
    const v = /^v(\d+)\.(\d+)/.exec(server)
    const tooOld = !!v && (Number(v[1]) < MIN_KUBERNETES[0] || (Number(v[1]) === MIN_KUBERNETES[0] && Number(v[2]) < MIN_KUBERNETES[1]))
    requirements.push({
      id: 'version', label: 'Kubernetes version', status: tooOld ? 'fail' : 'ok',
      detail: tooOld ? `${server}; Agent Substrate and AX need ${MIN_KUBERNETES.join('.')} or newer.` : server,
    })

    const nodeRows = lines(nodes.stdout).map((l) => l.split('|'))
    const readyNodes = nodeRows.filter((n) => n[2] === 'True').length
    const kernels = [...new Set(nodeRows.map((n) => n[0]))]
    const oldKernel = kernels.find((kernel) => {
      const m = /^(\d+)\.(\d+)/.exec(kernel)
      return !!m && (Number(m[1]) < MIN_KERNEL[0] || (Number(m[1]) === MIN_KERNEL[0] && Number(m[2]) < MIN_KERNEL[1]))
    })
    const arch = [...new Set(nodeRows.map((n) => n[1]))].join(', ')
    requirements.push(nodeRows.length === 0
      ? { id: 'nodes', label: 'Nodes', status: 'warn', detail: errorSummary(nodes.stdout, nodes.stderr) }
      : oldKernel
        // Not a failure: a vendor kernel can carry the feature without the version.
        ? { id: 'nodes', label: 'Nodes', status: 'warn', detail: `${readyNodes}/${nodeRows.length} Ready · kernel ${oldKernel} is older than ${MIN_KERNEL.join('.')}, which Substrate's image cache needs unless the vendor backported it.` }
        : { id: 'nodes', label: 'Nodes', status: readyNodes === nodeRows.length ? 'ok' : 'warn', detail: `${readyNodes}/${nodeRows.length} Ready · kernel ${kernels[0]} · ${arch}` })

    const missing = ['clustertrustbundles', 'podcertificaterequests'].filter((name) => !lines(apis.stdout).some((l) => l.startsWith(`${name}.`)))
    requirements.push({
      id: 'apis', label: 'Certificate APIs', status: missing.length ? 'fail' : 'ok',
      detail: missing.length ? `The cluster doesn't serve ${missing.join(' or ')}. Enable ClusterTrustBundle and PodCertificateRequest.` : 'ClusterTrustBundle and PodCertificateRequest are served',
    })

    const defaults = lines(storage.stdout).map((l) => l.split('|')).filter((x) => x[1] === 'true').map((x) => x[0])
    requirements.push({
      id: 'storage', label: 'Default StorageClass', status: defaults.length ? 'ok' : 'warn',
      detail: defaults.length ? defaults.join(', ') : "None. ax-postgres needs one for its 10Gi volume, or a volume you provision yourself.",
    })

    const deployments = Object.fromEntries(lines(substrate.stdout).map((l) => l.split('|')))
    const poolRows = lines(pools.stdout).map(replicas)
    const [axReplicas = '', axImage = ''] = ax.stdout.trim().split('|')
    this.setCheck(context, {
      checking: false,
      requirements,
      substrate: replicas(deployments['ate-api-server']),
      router: replicas(deployments['atenet-router']),
      workerPools: { ready: poolRows.filter((r) => !!r && r.total > 0 && r.ready >= r.total).length, total: poolRows.length },
      ax: replicas(axReplicas),
      axImage,
    })
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
      // ax only finds this out at its last step, after the cluster and Substrate are up.
      else if (v.includes('sha256:') && !/@sha256:[0-9a-f]{64}$/.test(v)) p.push(`${label} must give its digest as name@sha256:<64 hex digits>.`)
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
    const { name, state, ax } = this.state.local
    // The same command under the name its button has.
    const [verb, doing, done] = state === 'NotFound' ? ['Set up', 'Setting up', 'Set up']
      : state === 'Stopped' ? ['Resume', 'Resuming', 'Resumed']
      : ax && ax.total > 0 && ax.ready >= ax.total ? ['Update', 'Updating', 'Updated']
      : ['Repair', 'Repairing', 'Repaired']
    await this.exec({ kind: 'setup', target: name, stage: 'kind', wording: { doing, done } }, `${verb} the local sandbox (ax local start)`,
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

  private async exec(op: Pick<Operation, 'kind' | 'target' | 'stage' | 'wording'>, title: string, command: string): Promise<boolean> {
    if (this.running) return false
    const staged = op.stage !== null
    const started = Date.now()
    this.set({ op: { ...op, stageStarted: op.stage ? { [op.stage]: started } : {}, status: 'running', started }, log: [] })
    this.append(`▶ ${title}`, 'start')
    const streamID = `clusters-${++this.streamID}`
    const cwd = (await window.studio.platform()).home
    const status = await new Promise<number>((resolve) => {
      const offLine = window.studio.onStreamLine((l) => {
        if (l.id !== streamID) return
        this.append(l.line)
        if (l.line.startsWith('==> ')) this.patchOp({ step: l.line.slice(4) })
        const stage = staged ? stageFor(l.line) : null
        const now = this.state.op
        // Stages only move forward; a later line that names an earlier layer doesn't go back.
        if (stage && now && STAGES.findIndex((x) => x.id === stage) > STAGES.findIndex((x) => x.id === now.stage)) {
          this.patchOp({ stage, stageStarted: { ...now.stageStarted, [stage]: Date.now() } })
        }
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
