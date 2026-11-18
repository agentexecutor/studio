import { useEffect, useState, type CSSProperties } from 'react'
import {
  Check, Circle, CircleCheck, CircleDashed, CircleX, Copy, Cpu, ExternalLink, Laptop, Layers3, Loader, Play, RefreshCw, Server,
  Square, SquareTerminal, Trash2, TriangleAlert, Wrench, type LucideIcon,
} from 'lucide-react'
import { clusters, isLocalContext, useClusters, STAGES, type LocalSandbox, type Operation, type PreflightItem, type Replicas } from '../model/clusters'
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

export function Clusters() {
  const c = useClusters()
  const s = useStore()
  useEffect(() => void clusters.init(), [])
  const running = c.op?.status === 'running'
  const [outputOpen, setOutputOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  useEffect(() => { if (running) setOutputOpen(true) }, [running])

  const local = c.local
  const exists = local.state !== 'NotFound'
  const ready = local.state === 'Running' && full(local.ax)
  const active = exists && s.context === local.context
  const localBlockers = clusters.localBlockers
  const installBlockers = clusters.installBlockers
  const remote = s.contexts.filter((x) => !isLocalContext(x.name))

  return (
    <div className="clusters">
      <div className={`clusters-top ${outputOpen ? '' : 'full'}`}>
        <PageHeader title="Environments" subtitle="Set up a local sandbox on this machine, or connect to a team Kubernetes cluster.">
          {running && <button className="btn" onClick={() => clusters.cancel()}><Square size={12} />Stop</button>}
          <button className="btn" onClick={() => void clusters.refresh()} disabled={c.loading} title="Run the checks again">
            <RefreshCw size={13} className={c.loading ? 'spin' : ''} />Check Again
          </button>
        </PageHeader>

        <div className="clusters-layout env-layout">
          <div className={`card cluster-card ${active ? 'highlight' : ''}`}>
            <div className="row cluster-head">
              <div className="cluster-icon"><Laptop size={16} /></div>
              <div className="cluster-name">
                <div className="cluster-title">Local Sandbox</div>
                <div className="faint mono cluster-ctx">context: {exists ? local.context : 'N/A'}{active && ' · active'}</div>
              </div>
              <div className="spacer" />
              <LocalBadge state={local.state} ready={ready} />
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
                      <div className="layer-detail wrap" title={t.detail}>{t.detail}</div>
                    </div>
                    <h.icon size={14} color={h.color} />
                  </div>
                )
              })}
              {c.tools.length === 0 && <div className="caption faint">Looking for ax, kubectl and kind…</div>}
            </div>

            <div className="caption muted env-subhead">Local Stack Layers</div>
            <div className="layer-stack">
              {localLayers(local).map((r) => {
                const h = HEALTH[r.health]
                return (
                  <div key={r.id} className={`layer ${r.health}`} style={{ '--c': h.color } as CSSProperties}>
                    <r.icon size={14} className="layer-icon" />
                    <div className="layer-text">
                      <div className="layer-title">{r.title}</div>
                      <div className="layer-detail">{r.detail}</div>
                    </div>
                    <h.icon size={14} color={h.color} />
                  </div>
                )
              })}
            </div>

            <div className="row cluster-actions env-actions">
              <button className="btn primary" disabled={running || localBlockers.length > 0} onClick={() => void clusters.setUpLocal()}
                title={localBlockers.length > 0 ? localBlockers.join(' ') : 'Runs ax local start; the sandbox becomes your current kubectl context'}>
                <Play size={13} fill="currentColor" />
                {!exists ? 'Set Up Local Sandbox' : local.state === 'Stopped' ? 'Resume Local Sandbox' : ready ? 'Reconcile Local Sandbox' : 'Repair Local Sandbox'}
              </button>
              {ready && !active && (
                <button className="btn" disabled={running} onClick={() => clusters.connect(local.context)}>
                  <ExternalLink size={12} />Use Local in Studio
                </button>
              )}
              {local.state === 'Running' && (
                <button className="btn" disabled={running} onClick={() => void clusters.stopLocal()}><Square size={12} />Stop</button>
              )}
              <div className="spacer" />
              {exists && (
                <button className="btn small ghost danger" disabled={running} onClick={() => setConfirmDelete(true)} title="Delete the local kind cluster">
                  <Trash2 size={12} />Delete
                </button>
              )}
            </div>
            {running && c.op?.kind !== 'install' && <div className="step-progress" />}
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
            {remote.length === 0 ? (
              <div className="env-none">
                <div className="env-none-title">No remote contexts in your kubeconfig</div>
                <div className="caption muted">Authenticate with your team cluster, then click Check Again:</div>
                <CopyableCommand cmd="gcloud container clusters get-credentials <cluster> --region <region>" />
              </div>
            ) : (
              <div className="col env-contexts">
                {remote.map((rc) => {
                  const current = s.context === rc.name
                  return (
                    <div key={rc.name} className={`card env-context ${current ? 'highlight' : ''}`}>
                      <div className="row env-context-head">
                        <Server size={14} className="faint" />
                        <strong className="ellipsis" title={rc.name}>{shortName(rc.name)}</strong>
                        {current && <span className="chip">Active</span>}
                      </div>
                      <div className="caption faint mono ellipsis" title={rc.name}>{rc.name}</div>
                      <div className="row env-context-actions">
                        <button className={`btn small ${current ? '' : 'primary'}`} disabled={running || current} onClick={() => clusters.connect(rc.name)}>
                          <ExternalLink size={12} />{current ? 'Connected' : 'Connect'}
                        </button>
                        <button className="btn small ghost" disabled={running || installBlockers.length > 0} onClick={() => void clusters.installOn(rc.name)}
                          title={installBlockers.length > 0 ? installBlockers.join(' ') : 'Runs ax install: deploys or upgrades AX on this cluster, which must already run Agent Substrate'}>
                          <Wrench size={12} />Install / Upgrade AX
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        <ImagesCard disabled={running} />

        {c.op && <OperationBar op={c.op} />}
      </div>
      <LogConsole
        lines={c.log}
        onClear={() => clusters.set({ log: [] })}
        clearDisabled={running}
        empty="Click 'Set Up Local Sandbox' or 'Install / Upgrade AX' to see what ax does."
        open={outputOpen}
        onToggle={() => setOutputOpen(!outputOpen)}
      />

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

function PreflightRow({ item }: { item: PreflightItem }) {
  const h = HEALTH[item.status]
  return (
    <div className={`layer preflight ${item.status}`} style={{ '--c': h.color } as CSSProperties}>
      <div className="row preflight-head">
        <h.icon size={14} color={h.color} />
        <div className="layer-text">
          <div className="layer-title">{item.label}</div>
          <div className={`layer-detail ${item.status === 'ok' ? '' : 'wrap'}`}>{item.detail}</div>
        </div>
      </div>
      {item.command && <CopyableCommand cmd={item.command} />}
    </div>
  )
}

function CopyableCommand({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard.writeText(cmd)
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }
  return (
    <div className="row connect-cmd">
      <code className="selectable">{cmd}</code>
      <button className="btn small icon ghost" onClick={copy} title="Copy command">
        {copied ? <Check size={12} color="var(--green)" /> : <Copy size={12} />}
      </button>
    </div>
  )
}

function LocalBadge({ state, ready }: { state: LocalSandbox['state']; ready: boolean }) {
  const v = ready ? { h: 'ok' as Health, label: 'Ready' }
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

function localLayers(local: LocalSandbox): { id: string; icon: LucideIcon; title: string; detail: string; health: Health }[] {
  const up = local.state === 'Running'
  // What a layer says when there's nothing of it to report on.
  const absent = local.state === 'Stopped' ? 'Stopped' : up ? 'Not installed' : 'Installed when you set up the local sandbox'
  return [
    {
      id: 'kind', icon: Cpu, title: 'Kubernetes (Kind)',
      health: up ? 'ok' : local.state === 'Stopped' ? 'warn' : 'none',
      detail: up ? 'Running locally' : local.state === 'Stopped' ? 'Stopped; its state is kept' : 'Not created yet',
    },
    {
      id: 'substrate', icon: Layers3, title: 'Agent Substrate + gVisor WorkerPool',
      health: !up ? 'none' : full(local.substrate) ? 'ok' : 'warn',
      detail: up && local.substrate ? `ate-api-server ${local.substrate.ready}/${local.substrate.total} available` : absent,
    },
    {
      id: 'ax', icon: Server, title: 'AX Control Plane (ax-server + Postgres)',
      health: !up ? 'none' : full(local.ax) ? 'ok' : 'warn',
      detail: up && local.ax ? `ax-server ${local.ax.ready}/${local.ax.total} available` : absent,
    },
  ]
}

function OperationBar({ op }: { op: Operation }) {
  const [, tick] = useState(0)
  useEffect(() => {
    if (op.status !== 'running') return
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [op.status])
  const secs = Math.round(((op.finished ?? Date.now()) - op.started) / 1000)
  const elapsed = secs >= 60 ? `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, '0')}s` : `${secs}s`
  const verb = { setup: 'Setting up', stop: 'Stopping', delete: 'Deleting', install: 'Installing AX on' }[op.kind]
  const done = { setup: 'Set up', stop: 'Stopped', delete: 'Deleted', install: 'Installed AX on' }[op.kind]
  const title = op.status === 'running' ? `${verb} ${op.target}` : op.status === 'ok' ? `${done} ${op.target}` : `${verb} ${op.target} failed`
  const currentIndex = STAGES.findIndex((s) => s.id === op.stage)
  const StatusIcon = op.status === 'running' ? Loader : op.status === 'ok' ? CircleCheck : CircleX
  const statusColor = op.status === 'running' ? 'var(--accent)' : op.status === 'ok' ? 'var(--green)' : 'var(--red)'

  return (
    <div className="card op-bar">
      <div className="row op-head">
        <StatusIcon size={15} color={statusColor} className={op.status === 'running' ? 'spin' : ''} />
        <span className="op-title">{title}</span>
        <span className="faint num">{elapsed}{op.status === 'failed' && op.exit !== undefined ? ` · exit ${op.exit}` : ''}</span>
        <div className="spacer" />
        {op.status !== 'running' && <button className="btn small ghost" onClick={() => clusters.set({ op: null })}>Dismiss</button>}
      </div>
      {op.stage && (
        <div className="op-stages">
          {STAGES.map((s, i) => {
            const state = op.status === 'ok' || i < currentIndex ? 'ok'
              : i > currentIndex ? 'idle'
              : op.status === 'failed' ? 'failed' : 'running'
            const Icon = state === 'ok' ? CircleCheck : state === 'failed' ? CircleX : state === 'running' ? Loader : Circle
            return (
              <div key={s.id} className={`op-stage ${state}`}>
                <Icon size={13} className={state === 'running' ? 'spin' : ''} />
                <span>{s.title}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
