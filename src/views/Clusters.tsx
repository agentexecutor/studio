import { useEffect, useState, type CSSProperties } from 'react'
import {
  Check,
  Circle,
  CircleCheck,
  CircleDashed,
  CircleX,
  ClipboardCopy,
  Copy,
  Cpu,
  ExternalLink,
  Laptop,
  Layers3,
  Loader,
  Play,
  RefreshCw,
  Server,
  Square,
  Trash2,
  TriangleAlert,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import type { EnvOpSnapshot, PreflightItem } from '../api'
import { LogConsole, PageHeader } from '../components'
import { clusters, STAGES, useClusters } from '../model/clusters'
import { shortName } from '../model/resources'
import { useStore } from '../model/store'
import '../styles/clusters.css'
import '../styles/console.css'

type Health = 'ok' | 'warn' | 'fail' | 'none'

const HEALTH: Record<Health, { icon: LucideIcon; color: string }> = {
  ok: { icon: CircleCheck, color: 'var(--green)' },
  warn: { icon: CircleDashed, color: 'var(--warn)' },
  fail: { icon: CircleX, color: 'var(--red)' },
  none: { icon: Circle, color: 'var(--text-3)' },
}

export function Clusters() {
  const c = useClusters()
  const s = useStore()
  useEffect(() => void clusters.init(), [])

  const running = c.op?.status === 'running'
  const [outputOpen, setOutputOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [diagCopied, setDiagCopied] = useState(false)
  const [diagError, setDiagError] = useState('')

  useEffect(() => {
    if (running) setOutputOpen(true)
  }, [running])

  const env = c.env
  const localState = env?.local.state ?? 'NotFound'
  const rawLocalCtx = env?.local.kubeContext
  const localCtx = rawLocalCtx && rawLocalCtx !== 'N/A' ? rawLocalCtx : 'ax-local'
  const displayLocalCtx = localState === 'NotFound' ? 'N/A' : localCtx
  const isLocalActive = localState !== 'NotFound' && s.context === localCtx
  const isLocalReady = localState === 'Running' && isLayerHealthy(env?.local.axStatus ?? '')

  const remoteContexts = (env?.contexts ?? []).filter((ctx) => !ctx.isLocal)

  const handleCopyDiag = async () => {
    setDiagError('')
    try {
      await clusters.copyDiagnostics(s.context || undefined)
      setDiagCopied(true)
      setTimeout(() => setDiagCopied(false), 1800)
    } catch (e) {
      setDiagError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="clusters">
      <div className={`clusters-top ${outputOpen ? '' : 'full'}`}>
        <PageHeader
          title="Where Agents Run"
          subtitle="Start a self-contained local sandbox on this machine, or connect directly to a remote team Kubernetes cluster."
        >
          <button className="btn" onClick={() => void handleCopyDiag()} title="Copy secret-redacted diagnostics">
            {diagCopied ? <Check size={13} color="var(--green)" /> : <ClipboardCopy size={13} />}
            {diagCopied ? 'Diagnostics Copied' : 'Copy Diagnostics'}
          </button>
          <button className="btn" onClick={() => void clusters.refresh()} disabled={c.loading} title="Re-run checks">
            <RefreshCw size={13} className={c.loading ? 'spin' : ''} />
            Check Again
          </button>
        </PageHeader>

        {diagError && (
          <div className="row problem-line">
            <TriangleAlert size={14} />
            {diagError}
          </div>
        )}

        <div className="clusters-layout" style={{ gridTemplateColumns: '1.15fr 1fr' }}>
          {/* Path A: Local Sandbox Environment */}
          <div className={`card cluster-card ${isLocalActive ? 'highlight' : ''}`}>
            <div className="row cluster-head">
              <div className="cluster-icon">
                <Laptop size={16} />
              </div>
              <div className="cluster-name">
                <div className="cluster-title">Local Sandbox</div>
                <div className="faint mono cluster-ctx">
                  context: {displayLocalCtx} {isLocalActive ? '· active' : ''}
                </div>
              </div>
              <div className="spacer" />
              <LocalBadge state={localState} ready={isLocalReady} />
            </div>

            {env && (
              <div className="layer-stack" style={{ marginBottom: 12 }}>
                {env.preflight.map((p) => (
                  <PreflightRow key={p.id} item={p} />
                ))}
              </div>
            )}

            <div className="caption muted" style={{ marginBottom: 8, fontWeight: 600 }}>
              Local Stack Layers
            </div>
            <div className="layer-stack">
              {localLayers(env).map((r) => {
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

            <div className="row cluster-actions" style={{ marginTop: 14, flexWrap: 'wrap', gap: 8 }}>
              <button
                className="btn primary"
                disabled={running || (env ? !env.canStartLocal : false)}
                onClick={() => void clusters.startLocal()}
              >
                <Play size={13} fill="currentColor" />
                {localState === 'NotFound'
                  ? 'Set Up Local Sandbox'
                  : localState === 'Stopped'
                    ? 'Resume Local Sandbox'
                    : isLocalReady
                      ? 'Reconcile Local Sandbox'
                      : 'Repair Local Sandbox'}
              </button>

              {isLocalReady && s.context !== localCtx && (
                <button className="btn" disabled={running} onClick={() => void clusters.openContext(localCtx)}>
                  <ExternalLink size={12} />
                  Use Local in Studio
                </button>
              )}

              {localState === 'Running' && (
                <button className="btn" disabled={running} onClick={() => void clusters.stopLocal()}>
                  <Square size={12} />
                  Stop
                </button>
              )}

              <div className="spacer" />
              {localState !== 'NotFound' && (
                <button
                  className="btn small ghost danger"
                  disabled={running}
                  onClick={() => setConfirmDelete(true)}
                  title="Delete local Kind cluster"
                >
                  <Trash2 size={12} />
                  Delete
                </button>
              )}
            </div>
          </div>

          {/* Path B: Connect to a Team Cluster (Zero local footprint) */}
          <div className="card new-cluster" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="row new-cluster-head">
              <Server size={15} />
              <span>Connect to a Team Cluster</span>
            </div>
            <p className="caption muted" style={{ margin: 0, lineHeight: 1.5 }}>
              Skip local setup and run tasks directly on a shared GKE or Kubernetes cluster from your{' '}
              <code>~/.kube/config</code>. No local container VM required.
            </p>

            {remoteContexts.length === 0 ? (
              <div className="card" style={{ padding: 14, background: 'var(--bg-2)' }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>No remote contexts found in kubeconfig</div>
                <div className="caption muted" style={{ marginBottom: 8 }}>
                  Authenticate with your team cluster first, then click Check Again:
                </div>
                <CopyableCommand cmd="gcloud container clusters get-credentials <cluster> --region <region>" />
              </div>
            ) : (
              <div className="col" style={{ gap: 8, maxHeight: 360, overflowY: 'auto' }}>
                {remoteContexts.map((rc) => {
                  const active = s.context === rc.name
                  return (
                    <div
                      key={rc.name}
                      className={`card ${active ? 'highlight' : ''}`}
                      style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}
                    >
                      <div className="row" style={{ gap: 8 }}>
                        <Server size={14} className="faint" />
                        <strong className="ellipsis" title={rc.name} style={{ flex: 1 }}>
                          {shortName(rc.name)}
                        </strong>
                        {active && <span className="chip">Active</span>}
                      </div>
                      <div className="caption faint mono ellipsis" title={rc.name}>
                        {rc.name}
                      </div>
                      <div className="row" style={{ gap: 8, marginTop: 2 }}>
                        <button
                          className={`btn small ${active ? '' : 'primary'}`}
                          disabled={running || active}
                          onClick={() => void clusters.openContext(rc.name)}
                        >
                          <ExternalLink size={12} />
                          {active ? 'Connected' : 'Connect'}
                        </button>
                        <button
                          className="btn small ghost"
                          disabled={running}
                          onClick={() => void clusters.installRemote(rc.name)}
                          title="Deploy or upgrade AX (ax-postgres + ax-server) on this Substrate cluster"
                        >
                          <Wrench size={12} />
                          Install / Upgrade AX
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        <details className="card" style={{ padding: '10px 14px', marginTop: 12 }}>
          <summary className="caption muted" style={{ cursor: 'pointer', fontWeight: 600 }}>
            Installer Image Overrides (optional · --server-image / --runner-volume-image)
          </summary>
          <div className="form-grid" style={{ marginTop: 10 }}>
            <label className="caption">Server image</label>
            <input
              className="input mono"
              value={c.serverImage}
              disabled={running}
              placeholder="Defaults to $AX_SERVER_IMAGE or built-in release image"
              onChange={(e) => clusters.set({ serverImage: e.target.value })}
            />
            <label className="caption">Runner volume image</label>
            <input
              className="input mono"
              value={c.runnerVolumeImage}
              disabled={running}
              placeholder="Optional ($AX_RUNNER_VOLUME_IMAGE); empty runs the runner baked into each task image"
              onChange={(e) => clusters.set({ runnerVolumeImage: e.target.value })}
            />
          </div>
        </details>

        {c.op && <OperationBar op={c.op} />}
      </div>

      <LogConsole
        lines={c.log}
        onClear={() => clusters.set({ log: [] })}
        clearDisabled={running}
        empty="Click 'Set Up Local Sandbox' or 'Install / Upgrade AX' to view live provisioning logs."
        open={outputOpen}
        onToggle={() => setOutputOpen(!outputOpen)}
      />

      {confirmDelete && (
        <div className="modal-backdrop" onMouseDown={() => setConfirmDelete(false)}>
          <div className="modal card fade-in" onMouseDown={(e) => e.stopPropagation()}>
            <h3>Delete local sandbox cluster?</h3>
            <p className="muted" style={{ margin: '0 0 18px', lineHeight: 1.5 }}>
              This destroys the local Kind cluster and all local tasks/workspaces inside it. Remote clusters are not
              affected.
            </p>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
              <button
                className="btn primary"
                style={{ background: 'var(--red)' }}
                onClick={() => {
                  setConfirmDelete(false)
                  void clusters.deleteLocal()
                }}
              >
                Delete Local Cluster
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PreflightRow({ item }: { item: PreflightItem }) {
  const h: Health = item.status === 'ok' ? 'ok' : item.status === 'warn' ? 'warn' : 'fail'
  const meta = HEALTH[h]
  return (
    <div className={`layer ${h}`} style={{ '--c': meta.color, flexDirection: 'column', alignItems: 'stretch' } as CSSProperties}>
      <div className="row" style={{ gap: 8 }}>
        <meta.icon size={14} color={meta.color} />
        <div className="layer-text" style={{ flex: 1 }}>
          <div className="layer-title">{item.label}</div>
          <div className="layer-detail">{item.detail}</div>
        </div>
      </div>
      {item.command && (
        <div style={{ marginTop: 6 }}>
          <CopyableCommand cmd={item.command} />
        </div>
      )}
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
      <code className="selectable" style={{ flex: 1, overflowX: 'auto' }}>
        {cmd}
      </code>
      <button className="btn small icon ghost" onClick={copy} title="Copy command">
        {copied ? <Check size={12} color="var(--green)" /> : <Copy size={12} />}
      </button>
    </div>
  )
}

function LocalBadge({ state, ready }: { state: string; ready: boolean }) {
  const v =
    ready
      ? { h: 'ok' as Health, label: 'Ready' }
      : state === 'Running'
        ? { h: 'warn' as Health, label: 'Starting / Degraded' }
        : state === 'Stopped'
          ? { h: 'warn' as Health, label: 'Stopped' }
          : { h: 'none' as Health, label: 'Not Set Up' }
  const h = HEALTH[v.h]
  return (
    <span className="badge" style={{ '--c': h.color } as CSSProperties}>
      <h.icon size={12} />
      {v.label}
    </span>
  )
}

function isLayerHealthy(statusText: string): boolean {
  const lower = statusText.toLowerCase()
  if (!lower || lower.includes('degraded') || lower.includes('notinstalled') || lower.startsWith('0/') || lower.includes('(0/')) {
    return false
  }
  return lower.includes('available') || lower.includes('ready')
}

function localLayers(env: ReturnType<typeof useClusters>['env']): {
  id: string
  icon: LucideIcon
  title: string
  detail: string
  health: Health
}[] {
  const st = env?.local.state ?? 'NotFound'
  const sub = env?.local.substrateStatus ?? ''
  const ax = env?.local.axStatus ?? ''
  const kindHealth: Health = st === 'Running' ? 'ok' : st === 'Stopped' ? 'warn' : 'none'
  const subHealth: Health = st !== 'Running' ? 'none' : isLayerHealthy(sub) ? 'ok' : 'warn'
  const axHealth: Health = st !== 'Running' ? 'none' : isLayerHealthy(ax) ? 'ok' : 'warn'

  return [
    {
      id: 'kind',
      icon: Cpu,
      title: 'Kubernetes (Kind)',
      health: kindHealth,
      detail: st === 'Running' ? 'Running locally' : st === 'Stopped' ? 'Stopped (state preserved)' : 'Not created yet',
    },
    {
      id: 'substrate',
      icon: Layers3,
      title: 'Agent Substrate v1.0.0 + gVisor WorkerPool',
      health: subHealth,
      detail:
        !sub || sub === 'N/A'
          ? st === 'Stopped'
            ? 'Stopped'
            : 'Installed automatically during Set Up Local Sandbox'
          : sub,
    },
    {
      id: 'ax',
      icon: Server,
      title: 'AX Control Plane (ax-server + Postgres)',
      health: axHealth,
      detail:
        !ax || ax === 'N/A'
          ? st === 'Stopped'
            ? 'Stopped'
            : 'Installed automatically during Set Up Local Sandbox'
          : ax,
    },
  ]
}

function OperationBar({ op }: { op: EnvOpSnapshot }) {
  const [, tick] = useState(0)
  useEffect(() => {
    if (op.status !== 'running') return
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [op.status])

  const secs = Math.max(0, Math.round(((op.finished || Date.now()) - op.started) / 1000))
  const elapsed = secs >= 60 ? `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, '0')}s` : `${secs}s`
  const currentIndex = STAGES.findIndex((s) => s.id === op.stage)
  const StatusIcon = op.status === 'running' ? Loader : op.status === 'ok' ? CircleCheck : CircleX
  const statusColor = op.status === 'running' ? 'var(--accent)' : op.status === 'ok' ? 'var(--green)' : 'var(--red)'

  return (
    <div className="card op-bar">
      <div className="row op-head">
        <StatusIcon size={15} color={statusColor} className={op.status === 'running' ? 'spin' : ''} />
        <span className="op-title">
          {op.action} ({op.target})
        </span>
        <span className="faint num">{elapsed}</span>
        {op.error && <span className="caption" style={{ color: 'var(--red)' }}>{op.error}</span>}
        <div className="spacer" />
        {op.status !== 'running' && (
          <button className="btn small ghost" onClick={() => clusters.set({ op: null })}>
            Dismiss
          </button>
        )}
      </div>
      {op.stage && op.action === 'local-up' && (
        <div className="op-stages">
          {STAGES.map((s, i) => {
            const state = op.status === 'ok' || i < currentIndex ? 'done' : i === currentIndex ? op.status : 'todo'
            return (
              <div key={s.id} className={`op-stage ${state}`}>
                <span className="op-dot">
                  {state === 'done' && <Check size={10} strokeWidth={3} />}
                  {state === 'failed' && '×'}
                </span>
                <span>{s.title}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
