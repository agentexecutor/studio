import { useMemo, type CSSProperties } from 'react'
import { CircleCheck, Cpu, FolderGit2, Laptop, Server, Shield, TriangleAlert, Unplug } from 'lucide-react'
import { PageHeader, PhaseIcon, since } from '../components'
import { comparePhase, isLocal, phaseColor, phaseLabel, PHASES, shortName, type Phase } from '../model/resources'
import { store, useStore } from '../model/store'
import '../styles/overview.css'
import { TaskBoard } from './Board'

export function Overview() {
  const s = useStore()
  const ctx = store.currentContext
  const subtitle = `${ctx ? (isLocal(ctx) ? 'local sandbox' : shortName(ctx.name)) : s.context || 'not connected'} · atespace ${s.atespace}`
  return (
    <TaskBoard
      before={
        <>
          <PageHeader title="Activity" subtitle={subtitle} />
          {!s.context && <WelcomeSetupBanner />}
          {s.context && s.connectionError && s.tasks.length === 0 && <ConnectionProblem message={s.connectionError} />}
          <Digest />
        </>
      }
    />
  )
}

const toTasks = () => document.getElementById('task-board')?.scrollIntoView({ behavior: 'smooth' })
const toWorkspaces = () => document.getElementById('workspace-board')?.scrollIntoView({ behavior: 'smooth' })

function WelcomeSetupBanner() {
  return (
    <div className="card highlight pad row" style={{ '--tint': 'var(--accent)', gap: 14 } as CSSProperties}>
      <Laptop size={26} color="var(--accent)" />
      <div className="col" style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <strong>Welcome to AX Studio</strong>
        <span className="muted">
          Provision a local gVisor sandbox on this machine or connect directly to a remote team cluster to run your first
          task.
        </span>
      </div>
      <button className="btn primary" onClick={() => store.setSection('clusters')}>
        <Server size={13} /> Set Up Environment
      </button>
    </div>
  )
}

function Digest() {
  const s = useStore()
  const counts = new Map<Phase, number>()
  for (const t of s.tasks) counts.set(t.phase, (counts.get(t.phase) ?? 0) + 1)
  const phases = [...counts.keys()].sort(comparePhase)
  const latest = s.activity[0]

  return (
    <section className="card digest">
      <div className="digest-tasks">
        <button className="digest-total" onClick={toTasks} title="Jump to the tasks">
          <span className="digest-value num" key={s.tasks.length}>
            {s.tasks.length}
          </span>
          <span className="muted">{s.tasks.length === 1 ? 'task' : 'tasks'}</span>
        </button>
        <div className="digest-phases">
          <div className="row digest-chips">
            {phases.length === 0 && <span className="muted">No tasks in this atespace yet.</span>}
            {phases.map((p) => (
              <span key={p} className="row digest-chip" title={`${phaseLabel(p)}: ${counts.get(p)}`}>
                <PhaseIcon phase={p} size={13} />
                <span className="muted">{phaseLabel(p)}</span>
                <span className="num">{counts.get(p)}</span>
              </span>
            ))}
          </div>
          {phases.length > 0 && (
            <div className="digest-bar">
              {phases.map((p) => (
                <div
                  key={p}
                  title={`${phaseLabel(p)}: ${counts.get(p)}`}
                  style={{ flexGrow: counts.get(p), background: phaseColor(p) }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="digest-divider" />
      <Sparkline />
      <div className="digest-divider" />

      <div className="digest-side">
        <button className="row digest-link" onClick={toWorkspaces} title="Jump to the workspaces">
          <FolderGit2 size={14} color="var(--purple)" />
          <span className="num">{s.workspaces.length}</span>
          <span className="muted">workspaces</span>
          <Shield size={14} color="var(--accent)" style={{ marginLeft: 8 }} />
          <span className="num">{s.gateways.length}</span>
          <span className="muted">gateways</span>
          <Cpu size={14} color="var(--teal)" style={{ marginLeft: 8 }} />
          <span className="num">{s.models.length}</span>
          <span className="muted">models</span>
        </button>
        <div className="row digest-activity" title={latest?.detail}>
          {latest ? (
            <>
              {latest.ok ? <CircleCheck size={13} color="var(--green)" /> : <TriangleAlert size={13} color="var(--red)" />}
              <span className="ellipsis">{latest.title}</span>
              <span className="faint">{since(latest.date)}</span>
            </>
          ) : (
            <span className="faint">No activity yet this session</span>
          )}
        </div>
      </div>
    </section>
  )
}

function Sparkline() {
  const s = useStore()
  const history = s.history
  const W = 180
  const H = 40
  const chart = useMemo(() => {
    if (history.length < 2) return null
    const seen = PHASES.filter((p) => history.some((h) => (h.counts[p] ?? 0) > 0))
    const t0 = history[0].date
    const t1 = history[history.length - 1].date
    const max = Math.max(1, ...history.map((h) => seen.reduce((a, p) => a + (h.counts[p] ?? 0), 0)))
    const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * W
    const y = (v: number) => H - 1 - (v / max) * (H - 2)
    return seen.map((p, i) => {
      const lower = history.map((h) => seen.slice(0, i).reduce((a, q) => a + (h.counts[q] ?? 0), 0))
      const upper = history.map((h, j) => lower[j] + (h.counts[p] ?? 0))
      const top = history.map((h, j) => `${x(h.date)},${y(upper[j])}`)
      const bottom = history
        .map((h, j) => `${x(h.date)},${y(lower[j])}`)
        .reverse()
      return { phase: p, d: `M${top.join('L')}L${bottom.join('L')}Z`, line: `M${top.join('L')}` }
    })
  }, [history])
  const last = history[history.length - 1]
  const summary = last ? PHASES.filter((p) => last.counts[p]).map((p) => `${phaseLabel(p)} ${last.counts[p]}`).join(' · ') : ''

  return (
    <div className="digest-spark" title={summary}>
      <span className="caption faint">This session</span>
      {chart ? (
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width={W} height={H}>
          {chart.map((b) => (
            <g key={b.phase}>
              <path d={b.d} fill={phaseColor(b.phase)} opacity={0.75} />
              <path
                d={b.line}
                fill="none"
                stroke={phaseColor(b.phase)}
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          ))}
        </svg>
      ) : (
        <div className="digest-spark-empty faint">collecting…</div>
      )}
    </div>
  )
}

function ConnectionProblem({ message }: { message: string }) {
  return (
    <div className="card highlight pad row problem" style={{ '--tint': 'var(--red)' } as CSSProperties}>
      <Unplug size={26} color="var(--red)" />
      <div className="col" style={{ flex: 1, minWidth: 0 }}>
        <strong>Cannot reach the AX control plane</strong>
        <span className="muted selectable">{message}</span>
      </div>
      <button className="btn primary" onClick={() => store.setSection('clusters')}>
        Open Environments
      </button>
    </div>
  )
}
