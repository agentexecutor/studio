import { Fragment, useEffect, useState, type CSSProperties } from 'react'
import {
  BookOpen, Check, ChevronDown, Circle, CircleCheck, CircleDashed, CircleX, Container, Copy, Cpu, Database, ExternalLink, HardDrive, Laptop, Layers3,
  Loader, Monitor, Network, Play, RefreshCw, Server, ShieldCheck, Square, SquareTerminal, Tag, Trash2, TriangleAlert, Wrench, type LucideIcon,
} from 'lucide-react'
import {
  clusters, isLocalContext, stageProgress, useClusters, STAGES,
  type ClusterCheck, type LocalSandbox, type Operation, type PreflightItem, type Replicas, type StageProgress,
} from '../model/clusters'
import { shortName } from '../model/resources'
import { useStore } from '../model/store'
import { LogConsole, PageHeader } from '../components'
import '../styles/console.css'
import '../styles/clusters.css'

type Health = 'ok' | 'warn' | 'fail' | 'none'

const HEALTH: Record<Health, { icon: LucideIcon; color: string }> = {
  ok: { icon: CircleCheck, color: 'var(--green)' },
  warn: { icon: CircleDashed, color: 'var(--warn)' },
  fail: { icon: CircleX, color: 'var(--red)' },
  none: { icon: Circle, color: 'var(--text-3)' },
}

const full = (r: Replicas) => !!r && r.total > 0 && r.ready >= r.total

// Where AX's and Agent Substrate's documentation covers a cluster that isn't the local sandbox.
const DOCS = {
  prerequisites: 'https://github.com/google/ax/blob/main/docs/local_installer.md#remote-cluster-prerequisites-for-step-5',
  substrateSetup: 'https://github.com/google/ax/blob/main/docs/installation.md#substrate-setup',
  substrateInstall: 'https://github.com/agent-substrate/substrate/blob/f86fde9dfb5424c8d16f613de80469bdbef06541/docs/guides/operator-install.md',
  workerPool: 'https://github.com/agent-substrate/substrate/blob/f86fde9dfb5424c8d16f613de80469bdbef06541/docs/reference/api-guide.md#1-workerpool-the-physical-capacity',
}

/** Why the buttons that run a command are greyed out while one is running: the page runs one at a time. */
const BUSY = 'Another command is running. Wait for it to finish, or Cancel it at the top of the page.'

/** A link that opens in the browser. */
function Doc({ to, children }: { to: keyof typeof DOCS; children: string }) {
  return <a href={DOCS[to]} target="_blank" rel="noreferrer">{children}</a>
}

/** "42s" or "3m 07s". */
function duration(ms: number): string {
  const secs = Math.round(ms / 1000)
  return secs >= 60 ? `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, '0')}s` : `${secs}s`
}

/** Re-renders every second while `on`, so elapsed times keep counting. */
function useTick(on: boolean) {
  const [, tick] = useState(0)
  useEffect(() => {
    if (!on) return
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [on])
}

export function Clusters() {
  const c = useClusters()
  const s = useStore()
  useEffect(() => void clusters.init(), [])
  const running = c.op?.status === 'running'
  const [outputOpen, setOutputOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmCluster, setConfirmCluster] = useState<{ context: string; action: 'install' | 'uninstall' } | null>(null)
  useEffect(() => { if (running) setOutputOpen(true) }, [running])
  useTick(running)

  const local = c.local
  // While the sandbox is being set up, and until its result is dismissed, the layers show the setup itself.
  const setup = c.op?.kind === 'setup' ? c.op : null
  const layers = setup ? setupLayers(setup) : localLayers(local)
  const exists = local.state !== 'NotFound'
  const ready = local.state === 'Running' && full(local.ax)
  const active = exists && s.context === local.context
  // A sandbox that's still coming up gets ready on its own; keep looking until it has.
  const settling = !running && local.state === 'Running' && !ready
  useEffect(() => {
    if (!settling) return
    const t = setInterval(() => void clusters.refreshLocal(), 5000)
    return () => clearInterval(t)
  }, [settling])
  // The cluster the app is using is worth a look without being asked; the others wait for Check.
  useEffect(() => {
    if (s.context && !isLocalContext(s.context) && !clusters.state.checks[s.context]) void clusters.checkCluster(s.context)
  }, [s.context])
  const localBlockers = clusters.localBlockers
  const installBlockers = clusters.installBlockers
  const remote = s.contexts.filter((x) => !isLocalContext(x.name))

  return (
    <div className="clusters">
      <div className={`clusters-top ${outputOpen ? '' : 'full'}`}>
        <PageHeader title="Environments" subtitle="Set up a local sandbox on this machine, or connect to a team Kubernetes cluster.">
          {running && (
            <button className="btn" onClick={() => clusters.cancel()}
              data-tip="Interrupts the command that's running. What it has already done stays done, so a setup may be left half finished; running it again picks up from there.">
              <CircleX size={13} />Cancel
            </button>
          )}
          <button className="btn" onClick={() => void clusters.refresh()} disabled={c.loading}
            data-tip="Checks this machine and the local sandbox again and re-reads your kubeconfig. It only looks; nothing is changed.">
            <RefreshCw size={13} className={c.loading ? 'spin' : ''} />Check Again
          </button>
        </PageHeader>

        {c.op && <OperationBar op={c.op} />}

        <div className="clusters-layout env-layout">
          <div className={`card cluster-card ${active ? 'highlight' : ''}`}>
            <div className="row cluster-head">
              <div className="cluster-icon"><Laptop size={16} /></div>
              <div className="cluster-name">
                <div className="cluster-title">Local Sandbox</div>
                <div className="faint mono cluster-ctx">context: {exists ? local.context : 'N/A'}{active && ' · active'}</div>
              </div>
              <div className="spacer" />
              <LocalBadge local={local} ready={ready} setup={setup} />
            </div>

            <div className="layer-stack">
              {c.preflight.map((p) => <PreflightRow key={p.id} item={p} />)}
              {c.preflight.length === 0 && <div className="caption faint">Checking this machine…</div>}
            </div>

            <div className="caption muted env-subhead">Local Dependencies</div>
            <div className="layer-stack">
              {c.tools.map((t) => {
                const h = HEALTH[t.status]
                return (
                  <div key={t.name} className={`layer ${t.status}`} style={{ '--c': h.color } as CSSProperties}>
                    <SquareTerminal size={14} className="layer-icon" />
                    <div className="layer-text">
                      <div className="layer-title">{t.name}{t.version && <span className="mono tool-version">{t.version}</span>}</div>
                      <div className="layer-detail wrap">{t.detail}</div>
                    </div>
                    <h.icon size={14} color={h.color} />
                  </div>
                )
              })}
              {c.tools.length === 0 && <div className="caption faint">Looking for ax, kubectl and kind…</div>}
            </div>

            <div className="caption muted env-subhead">Local Stack Layers</div>
            <div className="layer-stack">
              {layers.map((r) => {
                const h = r.busy ? { icon: Loader, color: 'var(--accent)' } : HEALTH[r.health]
                return (
                  <div key={r.id} className={`layer ${r.busy ? 'busy' : r.health}`} style={{ '--c': h.color } as CSSProperties}>
                    <r.icon size={14} className="layer-icon" />
                    <div className="layer-text">
                      <div className="layer-title">{r.title}</div>
                      {/* A step being run stays on one line, so its tip carries the rest of it. */}
                      <div className={`layer-detail ${r.busy ? '' : 'wrap'}`} data-tip={r.busy ? r.detail : undefined}>{r.detail}</div>
                    </div>
                    {r.time && <span className="num layer-time">{r.time}</span>}
                    <h.icon size={14} color={h.color} className={r.busy ? 'spin' : ''} />
                  </div>
                )
              })}
            </div>

            <div className="row cluster-actions env-actions">
              <button className="btn primary" disabled={running || localBlockers.length > 0} onClick={() => void clusters.setUpLocal()}
                data-tip={running ? BUSY
                  : localBlockers.length > 0 ? localBlockers.join(' ')
                  : !exists ? 'Runs ax local start: creates a kind cluster named ax-local, installs Agent Substrate and AX on it, and makes it your current kubectl context. Downloads kind and kubectl if you lack them. Takes a few minutes.'
                  : local.state === 'Stopped' ? "Runs ax local start: starts the cluster's containers again, brings Agent Substrate and AX back up, and makes ax-local your current kubectl context."
                  : ready ? 'Runs ax local start again: checks every layer and redeploys AX with the images below. Makes ax-local your current kubectl context.'
                  : "Runs ax local start: puts the cluster's context back in your kubeconfig, checks every layer and installs what's missing. Makes ax-local your current kubectl context."}>
                <Play size={13} fill="currentColor" />
                {!exists ? 'Set Up Local Sandbox' : local.state === 'Stopped' ? 'Resume Local Sandbox' : ready ? 'Update Local Sandbox' : 'Repair Local Sandbox'}
              </button>
              {ready && (
                <button className="btn" disabled={running || active} onClick={() => clusters.connect(local.context)}
                  data-tip={running ? BUSY
                    : active ? 'Activity, Deploy and Terminal are already using the local sandbox.'
                    : 'Points Activity, Deploy and Terminal at the local sandbox and opens Activity. Nothing on the cluster changes.'}>
                  <ExternalLink size={12} />{active ? 'In Use' : 'Use Local in Studio'}
                </button>
              )}
              {local.state === 'Running' && (
                <button className="btn" disabled={running} onClick={() => void clusters.stopLocal()}
                  data-tip={running ? BUSY : "Runs ax local stop: stops the cluster's containers. Its tasks stop running and the app can't reach it until you resume, but nothing is deleted."}>
                  <Square size={12} />Stop
                </button>
              )}
              <div className="spacer" />
              {exists && (
                <button className="btn small ghost danger" disabled={running} onClick={() => setConfirmDelete(true)}
                  data-tip={running ? BUSY : "Runs ax local delete: destroys the cluster with every task, workspace and snapshot in it, and removes its context from your kubeconfig. This can't be undone. Asks first."}>
                  <Trash2 size={12} />Delete
                </button>
              )}
            </div>
            {running && c.op && c.op.kind !== 'install' && c.op.kind !== 'uninstall' && <div className="step-progress" />}
          </div>

          <div className="card new-cluster">
            <div className="row new-cluster-head">
              <Server size={15} />
              <span>Connect to a Team Cluster</span>
            </div>
            <div className="caption muted new-cluster-note">
              Skip local setup and run tasks on a shared GKE or Kubernetes cluster from your <span className="mono">~/.kube/config</span>.
              No local container VM is needed.
            </div>
            <NewClusterGuide open={remote.length === 0} />
            {remote.length === 0 ? (
              <div className="env-none">
                <div className="env-none-title">No remote contexts in your kubeconfig</div>
                <div className="caption muted">Authenticate with your team cluster, then click Check Again:</div>
                <CopyableCommand cmd="gcloud container clusters get-credentials <cluster> --region <region>" />
              </div>
            ) : (
              <div className="col env-contexts">
                {remote.map((rc) => (
                  <TeamCluster key={rc.name} name={rc.name} current={s.context === rc.name} check={c.checks[rc.name]}
                    busy={running} installBlockers={installBlockers}
                    onInstall={() => setConfirmCluster({ context: rc.name, action: 'install' })}
                    onUninstall={() => setConfirmCluster({ context: rc.name, action: 'uninstall' })} />
                ))}
              </div>
            )}
          </div>
        </div>

        <ImagesCard disabled={running} />
      </div>
      <LogConsole
        lines={c.log}
        onClear={() => clusters.set({ log: [] })}
        clearDisabled={running}
        empty="Click 'Set Up Local Sandbox' or 'Install / Upgrade AX' to see what ax does."
        open={outputOpen}
        onToggle={() => setOutputOpen(!outputOpen)}
      />

      {confirmCluster?.action === 'install' && (
        <div className="modal-backdrop" onMouseDown={() => setConfirmCluster(null)}>
          <div className="modal card fade-in" onMouseDown={(e) => e.stopPropagation()}>
            <h3>{c.checks[confirmCluster.context]?.ax ? 'Upgrade' : 'Install'} AX on {shortName(confirmCluster.context)}?</h3>
            <p className="muted env-confirm">
              This runs <span className="mono">ax install</span> with the images below. It creates
              the <span className="mono">ax-system</span> namespace, deploys ax-postgres and ax-server, and registers ax-server
              with Agent Substrate. The first time, registering restarts Substrate's API server and router, which everyone
              on the cluster shares.
            </p>
            <div className="row env-confirm-actions">
              <button className="btn" onClick={() => setConfirmCluster(null)}>Cancel</button>
              <button className="btn primary" onClick={() => { const { context } = confirmCluster; setConfirmCluster(null); void clusters.installOn(context) }}>
                {c.checks[confirmCluster.context]?.ax ? 'Upgrade AX' : 'Install AX'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmCluster?.action === 'uninstall' && (
        <div className="modal-backdrop" onMouseDown={() => setConfirmCluster(null)}>
          <div className="modal card fade-in" onMouseDown={(e) => e.stopPropagation()}>
            <h3>Uninstall AX from {shortName(confirmCluster.context)}?</h3>
            <p className="muted env-confirm">
              This runs <span className="mono">ax uninstall</span>. It removes ax-server and ax-postgres
              from <span className="mono">ax-system</span>, so nobody can use AX on this cluster until it's installed again,
              and takes ax-server off Agent Substrate's allowlists, which restarts Substrate's API server and router. The
              database's volume is kept, and Agent Substrate itself is left in place.
            </p>
            <div className="row env-confirm-actions">
              <button className="btn" onClick={() => setConfirmCluster(null)}>Cancel</button>
              <button className="btn primary danger-fill" onClick={() => { const { context } = confirmCluster; setConfirmCluster(null); void clusters.uninstallFrom(context) }}>
                Uninstall AX
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="modal-backdrop" onMouseDown={() => setConfirmDelete(false)}>
          <div className="modal card fade-in" onMouseDown={(e) => e.stopPropagation()}>
            <h3>Delete the local sandbox?</h3>
            <p className="muted env-confirm">
              This destroys the local kind cluster and every task and workspace in it. Remote clusters are not affected.
            </p>
            <div className="row env-confirm-actions">
              <button className="btn" onClick={() => setConfirmDelete(false)}>Cancel</button>
              <button className="btn primary danger-fill" onClick={() => { setConfirmDelete(false); void clusters.deleteLocal() }}>
                Delete Local Sandbox
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** What a cluster needs before AX can go on it, and the order to do it in, for someone starting without one. */
function NewClusterGuide({ open }: { open: boolean }) {
  return (
    <details className="env-guide" open={open}>
      <summary>
        <BookOpen size={14} />
        <span>No cluster yet? See what one needs and how to set it up</span>
        <ChevronDown size={14} className="env-guide-chevron" />
      </summary>
      <div className="env-guide-body caption">
        <div className="env-guide-head">A cluster for AX needs</div>
        <ul>
          <li>GKE 1.37+ or Kubernetes 1.36+, with <span className="mono">ClusterTrustBundle</span> and <span className="mono">PodCertificateRequest</span> enabled</li>
          <li>Agent Substrate v1.0.0 in <span className="mono">ate-system</span>, with a ready gVisor WorkerPool</li>
          <li>a snapshot location configured on Substrate for the whole cluster, such as a GCS bucket</li>
          <li>a default StorageClass for ax-postgres's 10Gi volume</li>
          <li>credentials in your kubeconfig that can manage <span className="mono">ax-system</span> and change Substrate's allowlists in <span className="mono">ate-system</span></li>
        </ul>
        <div>The full list is in AX's <Doc to="prerequisites">remote cluster prerequisites</Doc>.</div>

        <div className="env-guide-head">To set one up</div>
        <ol>
          <li>
            Create the cluster and get its credentials. It then shows up below after Check Again.
            <CopyableCommand cmd="gcloud container clusters get-credentials <cluster> --region <region>" />
          </li>
          <li>
            Install Agent Substrate and create a WorkerPool. ax doesn't do this on a remote cluster; follow
            Substrate's <Doc to="substrateInstall">operator install guide</Doc> and <Doc to="workerPool">WorkerPool guide</Doc>,
            with the settings AX needs from <Doc to="substrateSetup">Substrate setup</Doc>.
            <CopyableCommand cmd="kubectl get workerpools -A" />
          </li>
          <li>Click Check on the cluster below, then Install AX.</li>
        </ol>
      </div>
    </details>
  )
}

/** A cluster from the kubeconfig: connect to it, check what's on it, and install AX once Substrate is there. */
function TeamCluster({ name, current, check, busy, installBlockers, onInstall, onUninstall }: {
  name: string
  current: boolean
  check: ClusterCheck | undefined
  busy: boolean
  installBlockers: string[]
  onInstall: () => void
  onUninstall: () => void
}) {
  const checked = !!check && !check.checking && !check.error
  // ax install needs Substrate there already; everything else it can be tried without.
  const blockers = !checked ? ['Check the cluster first.']
    : !check.substrate ? ['Agent Substrate has to be installed on the cluster first.']
    : installBlockers
  return (
    <div className={`card env-context ${current ? 'highlight' : ''}`}>
      <div className="row env-context-head">
        <Server size={14} className="faint" />
        <strong className="ellipsis" data-tip={name}>{shortName(name)}</strong>
        {current && <span className="chip">Active</span>}
      </div>
      <div className="caption faint mono ellipsis" data-tip={name}>{name}</div>
      {check && <CheckResult check={check} />}
      <div className="row env-context-actions">
        <button className={`btn small ${current ? '' : 'primary'}`} disabled={busy || current} onClick={() => clusters.connect(name)}
          data-tip={busy ? BUSY
            : current ? 'Activity, Deploy and Terminal are already using this cluster.'
            : "Points Activity, Deploy and Terminal at this cluster and opens Activity. Nothing on the cluster changes, and neither does your kubectl context."}>
          <ExternalLink size={12} />{current ? 'Connected' : 'Connect'}
        </button>
        <button className="btn small" disabled={check?.checking} onClick={() => void clusters.checkCluster(name)}
          data-tip="Looks at the cluster with kubectl: what it offers, and whether Agent Substrate and AX are on it. It only reads; nothing is changed.">
          <RefreshCw size={12} className={check?.checking ? 'spin' : ''} />{check ? 'Check Again' : 'Check'}
        </button>
        <button className="btn small ghost" disabled={busy || blockers.length > 0} onClick={onInstall}
          data-tip={busy ? BUSY
            : blockers.length > 0 ? blockers.join(' ')
            : checked && check.ax ? "Runs ax install: redeploys ax-server and ax-postgres with the images below. Asks first."
            : "Runs ax install: deploys ax-postgres and ax-server and registers ax-server with Agent Substrate, which restarts Substrate's API server and router. Asks first."}>
          <Wrench size={12} />{checked && check.ax ? 'Upgrade AX' : 'Install AX'}
        </button>
        {checked && check.ax && (
          <button className="btn small ghost danger" disabled={busy || clusters.axProblems.length > 0} onClick={onUninstall}
            data-tip={busy ? BUSY
              : clusters.axProblems.length > 0 ? clusters.axProblems.join(' ')
              : "Runs ax uninstall: removes ax-server and ax-postgres from the cluster and restarts Substrate's API server and router. The database's volume is kept. Asks first."}>
            <Trash2 size={12} />Uninstall AX
          </button>
        )}
        <div className="spacer" />
        {check && !check.checking && (
          <button className="btn small ghost" onClick={() => clusters.clearCheck(name)} data-tip="Folds the check's result away. Nothing on the cluster changes.">Hide</button>
        )}
      </div>
    </div>
  )
}

/** What a check found, as the cluster's own requirements and then the two layers, with what to do next. */
function CheckResult({ check }: { check: ClusterCheck }) {
  if (check.error) {
    return (
      <div className="env-check">
        <div className="row problem-line"><TriangleAlert size={13} />Couldn't reach the cluster: {check.error}</div>
        <div className="caption muted">If your credentials have expired, get them again:</div>
        <CopyableCommand cmd="gcloud container clusters get-credentials <cluster> --region <region>" />
      </div>
    )
  }
  if (check.requirements.length === 0) return <div className="caption faint env-check">Checking the cluster…</div>

  const substrateUp = full(check.substrate) && full(check.router)
  const layers: Layer[] = [
    {
      id: 'substrate', icon: Layers3, title: 'Agent Substrate',
      health: !check.substrate ? 'none' : substrateUp && check.workerPools.ready > 0 ? 'ok' : 'warn',
      detail: !check.substrate ? 'Not installed'
        : `ate-api-server ${check.substrate.ready}/${check.substrate.total} · ${check.workerPools.ready}/${check.workerPools.total} WorkerPools ready`,
    },
    {
      id: 'ax', icon: Server, title: 'AX',
      health: !check.ax ? 'none' : full(check.ax) ? 'ok' : 'warn',
      detail: !check.ax ? 'Not installed' : `ax-server ${check.ax.ready}/${check.ax.total} · ${check.axImage}`,
    },
  ]
  const failed = check.requirements.some((r) => r.status === 'fail')
  return (
    <div className="env-check">
      <div className="layer-stack">
        {check.requirements.map((r) => <PreflightRow key={r.id} item={r} />)}
        {layers.map((r) => {
          const h = HEALTH[r.health]
          return (
            <div key={r.id} className={`layer ${r.health}`} style={{ '--c': h.color } as CSSProperties}>
              <r.icon size={14} className="layer-icon" />
              <div className="layer-text">
                <div className="layer-title">{r.title}</div>
                <div className="layer-detail" data-tip={r.detail}>{r.detail}</div>
              </div>
              <h.icon size={14} color={h.color} />
            </div>
          )
        })}
      </div>
      <div className="caption muted env-next">
        {failed ? <>This cluster doesn't meet what AX needs. See the <Doc to="prerequisites">prerequisites</Doc>.</>
          : !check.substrate ? <>Next: install Agent Substrate. ax can't do that on a remote cluster; follow the <Doc to="substrateInstall">operator install guide</Doc> and <Doc to="substrateSetup">the settings AX needs</Doc>, then check again.</>
          : !substrateUp ? 'Agent Substrate is installed but not all of it is ready yet.'
          : check.workerPools.ready === 0 ? <>Next: create a gVisor WorkerPool; tasks can't start without one. See the <Doc to="workerPool">WorkerPool guide</Doc>.</>
          : !check.ax ? 'Next: Install AX.'
          : full(check.ax) ? 'AX is installed and ready. Connect to use it.'
          : 'AX is installed but ax-server is not ready yet.'}
      </div>
    </div>
  )
}

/** The images ax deploys. The server image has no default yet, so nothing can be set up without it. */
function ImagesCard({ disabled }: { disabled: boolean }) {
  const c = useClusters()
  const problems = clusters.imageProblems
  return (
    <div className="card env-images">
      <div className="caption muted env-subhead">
        Installer images, passed to <span className="mono">ax local start</span> and <span className="mono">ax install</span>
      </div>
      <div className="form-grid">
        <label>Server image</label>
        <input className={`input mono ${c.images.serverImage.trim() ? '' : 'invalid'}`} value={c.images.serverImage} disabled={disabled}
          spellCheck={false} placeholder="Required: ax-server image, by tag or @sha256 (--server-image)"
          onChange={(e) => clusters.setImages({ serverImage: e.target.value })} />
        <label>Default task image</label>
        <input className="input mono" value={c.images.defaultTaskImage} disabled={disabled}
          spellCheck={false} placeholder="Optional (--default-task-image)"
          onChange={(e) => clusters.setImages({ defaultTaskImage: e.target.value })} />
        <label>Runner volume image</label>
        <input className="input mono" value={c.images.runnerVolumeImage} disabled={disabled}
          spellCheck={false} placeholder="Optional; empty runs the runner in each task image (--runner-volume-image)"
          onChange={(e) => clusters.setImages({ runnerVolumeImage: e.target.value })} />
      </div>
      {problems.map((p) => <div key={p} className="row problem-line"><TriangleAlert size={13} />{p}</div>)}
    </div>
  )
}

/** What each check is about, by its id. The row's status goes on the right, as on every other row. */
const CHECK_ICONS: Record<string, LucideIcon> = {
  os_arch: Monitor,
  container_engine: Container,
  disk_space: HardDrive,
  version: Tag,
  nodes: Network,
  apis: ShieldCheck,
  storage: Database,
}

function PreflightRow({ item }: { item: PreflightItem }) {
  const h = HEALTH[item.status]
  const Icon = CHECK_ICONS[item.id] ?? Server
  return (
    <div className={`layer preflight ${item.status}`} style={{ '--c': h.color } as CSSProperties}>
      <div className="row preflight-head">
        <Icon size={14} className="layer-icon" />
        <div className="layer-text">
          <div className="layer-title">{item.label}</div>
          <div className={`layer-detail ${item.status === 'ok' ? '' : 'wrap'}`}>{item.detail}</div>
        </div>
        <h.icon size={14} color={h.color} className="layer-status" />
      </div>
      {item.command && <CopyableCommand cmd={item.command} />}
    </div>
  )
}

/**
 * A shell command to copy, coloured by part: programs, flags, and the
 * <placeholders> to fill in. Programs are the first word and the one after
 * each `&&`.
 */
function CopyableCommand({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard.writeText(cmd)
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }
  const words = cmd.split(' ')
  return (
    <div className="row cmd-line">
      <code className="selectable">
        {words.map((word, i) => {
          const kind = word === '&&' ? 'op'
            : i === 0 || words[i - 1] === '&&' ? 'bin'
            : word.startsWith('-') ? 'flag'
            : /^<.*>$/.test(word) ? 'arg'
            : ''
          // The space sits between the words, so a line breaks there and not inside a flag.
          return <Fragment key={i}>{i > 0 && ' '}<span className={kind && `cmd-${kind}`}>{word}</span></Fragment>
        })}
      </code>
      <button className="btn small icon ghost" onClick={copy} data-tip="Copy command">
        {copied ? <Check size={12} color="var(--green)" /> : <Copy size={12} />}
      </button>
    </div>
  )
}

function LocalBadge({ local, ready, setup }: { local: LocalSandbox; ready: boolean; setup: Operation | null }) {
  const { state } = local
  const v = setup?.status === 'running' ? { h: 'warn' as Health, label: `${setup.wording?.doing ?? 'Setting up'} · ${duration(Date.now() - setup.started)}` }
    : ready ? { h: 'ok' as Health, label: 'Ready' }
    : state === 'Running' && local.access === 'no-context' ? { h: 'warn' as Health, label: 'Not in Kubeconfig' }
    : state === 'Running' && local.access === 'unreachable' ? { h: 'warn' as Health, label: 'Not Answering' }
    : state === 'Running' ? { h: 'warn' as Health, label: 'Starting / Degraded' }
    : state === 'Stopped' ? { h: 'warn' as Health, label: 'Stopped' }
    : { h: 'none' as Health, label: 'Not Set Up' }
  const h = HEALTH[v.h]
  return (
    <span className="badge" style={{ '--c': h.color } as CSSProperties}>
      <h.icon size={12} />{v.label}
    </span>
  )
}

interface Layer {
  id: string
  icon: LucideIcon
  title: string
  detail: string
  health: Health
  /** Being set up right now. */
  busy?: boolean
  /** How long setting it up took, or has taken so far. */
  time?: string
}

const LAYER_TITLES = {
  kind: 'Kubernetes (Kind)',
  substrate: 'Agent Substrate + gVisor WorkerPool',
  ax: 'AX Control Plane (ax-server + Postgres)',
}

/** The layers while `ax local start` runs: which are done, which one it's on, and how long each took. */
function setupLayers(op: Operation): Layer[] {
  const p = stageProgress(op)
  // Substrate and its worker pool are one layer here, two stages in ax's output.
  const substrate: StageProgress = {
    state: p.substrate.state === 'ok' ? p.workers.state === 'idle' ? 'running' : p.workers.state : p.substrate.state,
    ms: p.substrate.ms + p.workers.ms,
  }
  const layer = (id: keyof typeof LAYER_TITLES, icon: LucideIcon, s: StageProgress, doing: string): Layer => ({
    id, icon, title: LAYER_TITLES[id],
    health: s.state === 'ok' ? 'ok' : s.state === 'failed' ? 'fail' : 'none',
    busy: s.state === 'running',
    time: s.ms > 0 ? duration(s.ms) : undefined,
    detail: s.state === 'running' ? (op.step ?? doing)
      : s.state === 'failed' ? `Failed${op.step ? `: ${op.step.replace(/\.+$/, '')}` : ''}. See the output below.`
      : s.state === 'idle' ? (op.status === 'failed' ? 'Not reached' : 'Waiting')
      : s.ms > 0 ? 'Done' : 'Already in place',
  })
  return [
    layer('kind', Cpu, p.kind, 'Creating the kind cluster…'),
    layer('substrate', Layers3, substrate, 'Installing Agent Substrate…'),
    layer('ax', Server, p.ax, 'Installing AX…'),
  ]
}

function localLayers(local: LocalSandbox): Layer[] {
  const up = local.state === 'Running'
  // What a layer says when there's nothing of it to report on. A cluster kubectl can't look into isn't one with nothing installed.
  const absent = local.state === 'Stopped' ? 'Stopped'
    : !up ? 'Installed when you set up the local sandbox'
    : local.access === 'no-context' ? `Unknown: the ${local.context} context isn't in your kubeconfig. Repair Local Sandbox puts it back.`
    : local.access === 'unreachable' ? "Unknown: the cluster's API server isn't answering."
    : 'Not installed'
  return [
    {
      id: 'kind', icon: Cpu, title: LAYER_TITLES.kind,
      health: up ? 'ok' : local.state === 'Stopped' ? 'warn' : 'none',
      detail: !up ? (local.state === 'Stopped' ? 'Stopped; its state is kept' : 'Not created yet')
        : local.access === 'no-context' ? 'Its containers are running, but your kubeconfig has no context for it'
        : 'Running locally',
    },
    {
      id: 'substrate', icon: Layers3, title: LAYER_TITLES.substrate,
      health: !up ? 'none' : full(local.substrate) ? 'ok' : 'warn',
      detail: up && local.substrate ? `ate-api-server ${local.substrate.ready}/${local.substrate.total} available` : absent,
    },
    {
      id: 'ax', icon: Server, title: LAYER_TITLES.ax,
      health: !up ? 'none' : full(local.ax) ? 'ok' : 'warn',
      detail: up && local.ax ? `ax-server ${local.ax.ready}/${local.ax.total} available` : absent,
    },
  ]
}

function OperationBar({ op }: { op: Operation }) {
  useTick(op.status === 'running')
  const elapsed = duration((op.finished ?? Date.now()) - op.started)
  const verb = op.wording?.doing ?? { setup: 'Setting up', stop: 'Stopping', delete: 'Deleting', install: 'Installing AX on', uninstall: 'Uninstalling AX from' }[op.kind]
  const done = op.wording?.done ?? { setup: 'Set up', stop: 'Stopped', delete: 'Deleted', install: 'Installed AX on', uninstall: 'Uninstalled AX from' }[op.kind]
  const title = op.status === 'running' ? `${verb} ${op.target}` : op.status === 'ok' ? `${done} ${op.target}` : `${verb} ${op.target} failed`
  const progress = op.stage ? stageProgress(op) : null
  const StatusIcon = op.status === 'running' ? Loader : op.status === 'ok' ? CircleCheck : CircleX
  const statusColor = op.status === 'running' ? 'var(--accent)' : op.status === 'ok' ? 'var(--green)' : 'var(--red)'

  return (
    <div className="card op-bar env-op">
      <div className="row op-head">
        <StatusIcon size={15} color={statusColor} className={op.status === 'running' ? 'spin' : ''} />
        <span className="op-title">{title}</span>
        <span className="faint num">{elapsed}{op.status === 'failed' && op.exit !== undefined ? ` · exit ${op.exit}` : ''}</span>
        {op.status === 'running' && op.step && <span className="caption muted ellipsis op-step" data-tip={op.step}>{op.step}</span>}
        <div className="spacer" />
        {op.status !== 'running' && (
          <button className="btn small ghost" onClick={() => clusters.set({ op: null })} data-tip="Hides this result. The output below stays.">Dismiss</button>
        )}
      </div>
      {progress && (
        <div className="op-stages">
          {STAGES.map((s) => {
            const { state, ms } = progress[s.id]
            const Icon = state === 'ok' ? CircleCheck : state === 'failed' ? CircleX : state === 'running' ? Loader : Circle
            return (
              <div key={s.id} className={`op-stage ${state}`}>
                <Icon size={13} className={state === 'running' ? 'spin' : ''} />
                <span>{s.title}</span>
                <div className="spacer" />
                {ms > 0 && <span className="num">{duration(ms)}</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
