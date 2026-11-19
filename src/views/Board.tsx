import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  Bolt,
  Check,
  ChevronRight,
  CircleCheck,
  CircleX,
  Copy,
  FileDiff,
  FolderGit2,
  Pause,
  Play,
  Plus,
  Rocket,
  Rows3,
  Shield,
  Terminal,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react'
import { Empty, PhaseBadge, PhaseIcon, Segmented, since } from '../components'
import { designer } from '../model/designer'
import {
  phaseColor,
  phaseLabel,
  repoName,
  shortImage,
  type AXTask,
  type AXWorkspace,
  type Condition,
  type Phase,
} from '../model/resources'
import { store, useStore } from '../model/store'
import '../styles/board.css'
import { PromoteModal } from './PromoteModal'
import { TaskChangesPane } from './TaskChangesPane'
import { TaskLogs } from './TaskLogs'

const STATE_ORDER: Phase[] = ['running', 'pending', 'suspended', 'failed', 'terminating', 'completed']
const stateRank = (p: Phase) => {
  const i = STATE_ORDER.indexOf(p)
  return i < 0 ? STATE_ORDER.length : i
}

type SortKey = 'name' | 'state' | 'workspace' | 'image' | 'worker' | 'age'
type Sort = { key: SortKey; dir: 1 | -1 }

const COLUMNS: { key: SortKey; title: string }[] = [
  { key: 'name', title: 'Name' },
  { key: 'state', title: 'State' },
  { key: 'workspace', title: 'Workspace' },
  { key: 'image', title: 'Image' },
  { key: 'worker', title: 'Actor' },
  { key: 'age', title: 'Age' },
]

type MenuState = { task: AXTask; x: number; y: number } | null

export function TaskBoard({ before }: { before?: ReactNode }) {
  const s = useStore()
  const [sort, setSort] = useState<Sort>({ key: 'state', dir: 1 })
  const [menu, setMenu] = useState<MenuState>(null)
  const [confirm, setConfirm] = useState<AXTask | null>(null)
  const [promotingTask, setPromotingTask] = useState<AXTask | null>(null)

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  const tasks = useMemo(() => {
    const created = (t: AXTask) => Date.parse(s.details[t.id]?.createTime ?? '') || 0
    const value = (t: AXTask): string | number => {
      const d = s.details[t.id]
      switch (sort.key) {
        case 'name':
          return t.name
        case 'state':
          return stateRank(t.phase)
        case 'workspace':
          return d?.workspace ?? ''
        case 'image':
          return d?.image ? shortImage(d.image) : ''
        case 'worker':
          return t.actor ?? ''
        case 'age':
          return -created(t)
      }
    }
    const cmp = (a: string | number, b: string | number) =>
      typeof a === 'number' && typeof b === 'number'
        ? a - b
        : String(a).localeCompare(String(b), undefined, { numeric: true })
    return [...s.tasks].sort(
      (a, b) => cmp(value(a), value(b)) * sort.dir || stateRank(a.phase) - stateRank(b.phase) || a.name.localeCompare(b.name)
    )
  }, [s.tasks, s.details, sort])

  const onSort = (key: SortKey) => setSort((o) => ({ key, dir: o.key === key ? (-o.dir as 1 | -1) : 1 }))

  return (
    <div className="board-page">
      <div className="board-main">
        {before}
        <div className="row board-head" id="task-board">
          <h2>Tasks</h2>
          {s.tasks.length > 0 && (
            <span className="caption faint">Select a task to review Git changes, open a terminal, or promote to a team cluster.</span>
          )}
        </div>
        {s.tasks.length === 0 ? (
          <div className="card board-empty">
            <Empty icon={Rows3} title="No tasks in this atespace">
              <button className="btn small primary" style={{ marginTop: 8 }} onClick={() => store.setSection('designer')}>
                <Plus size={12} /> Start a Task
              </button>
            </Empty>
          </div>
        ) : (
          <div className="card task-table-wrap">
            <table className="task-table">
              <thead>
                <tr>
                  {COLUMNS.map((c) => (
                    <th
                      key={c.key}
                      className={`col-${c.key} ${sort.key === c.key ? 'sorted' : ''}`}
                      aria-sort={sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
                    >
                      <button className="th-sort" onClick={() => onSort(c.key)}>
                        {c.title}
                        {sort.key === c.key ? (
                          sort.dir === 1 ? (
                            <ArrowUp size={11} />
                          ) : (
                            <ArrowDown size={11} />
                          )
                        ) : (
                          <ArrowUpDown size={11} className="th-idle" />
                        )}
                      </button>
                    </th>
                  ))}
                  <th className="col-actions" />
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    selected={t.id === s.selectedTaskID}
                    onMenu={(x, y) => setMenu({ task: t, x, y })}
                    onDelete={() => setConfirm(t)}
                    onPromote={() => setPromotingTask(t)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <WorkspaceTable />
      </div>

      <TaskInspectorPane onPromote={(t) => setPromotingTask(t)} />

      {menu && (
        <div
          className="menu card fade-in board-menu"
          style={{ left: Math.min(menu.x, window.innerWidth - 220), top: Math.min(menu.y, window.innerHeight - 180) }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {actionsFor(menu.task, () => setConfirm(menu.task), () => setPromotingTask(menu.task)).map((a) => (
            <button
              key={a.label}
              className="menu-item"
              onClick={() => {
                a.run()
                setMenu(null)
              }}
              style={a.danger ? { color: 'var(--red)' } : undefined}
            >
              <span className="menu-check">
                <a.icon size={13} />
              </span>
              {a.label}
            </button>
          ))}
        </div>
      )}

      {confirm && <DeleteTaskModal task={confirm} onClose={() => setConfirm(null)} />}
      {promotingTask && <PromoteModal task={promotingTask} onClose={() => setPromotingTask(null)} />}
    </div>
  )
}

function WorkspaceTable() {
  const s = useStore()
  const [confirm, setConfirm] = useState<AXWorkspace | null>(null)
  const users = (w: AXWorkspace) => s.tasks.filter((t) => s.details[t.id]?.workspace === w.name)
  const workspaces = [...s.workspaces].sort((a, b) => a.name.localeCompare(b.name))
  return (
    <>
      <div className="row board-head" id="workspace-board">
        <h2>Workspaces</h2>
        <span className="caption faint">Immutable environment recipes mounted at /workspace.</span>
      </div>
      {workspaces.length === 0 ? (
        <div className="card board-empty">
          <Empty icon={FolderGit2} title="No workspaces in this atespace" />
        </div>
      ) : (
        <div className="card task-table-wrap">
          <table className="task-table">
            <thead>
              <tr>
                <th className="col-name">
                  <span className="th-label">Name</span>
                </th>
                <th className="col-repos">
                  <span className="th-label">Repos</span>
                </th>
                <th className="col-mcp">
                  <span className="th-label">MCP servers</span>
                </th>
                <th className="col-files">
                  <span className="th-label">Files</span>
                </th>
                <th className="col-used">
                  <span className="th-label">Tasks</span>
                </th>
                <th className="col-actions" />
              </tr>
            </thead>
            <tbody>
              {workspaces.map((w) => {
                const n = users(w).length
                return (
                  <tr key={w.id} className="task-row" style={{ '--c': 'var(--purple)' } as CSSProperties}>
                    <td className="col-name">
                      <span className="row task-row-ws">
                        <FolderGit2 size={13} color="var(--purple)" />
                        <span className="task-row-name ellipsis" title={w.name}>
                          {w.name}
                        </span>
                      </span>
                    </td>
                    <td className="col-repos ellipsis" title={w.repos.map((r) => `${r.repo} (${r.branch})`).join('\n')}>
                      {w.repos.length ? w.repos.map((r) => repoName(r.repo)).join(', ') : <span className="faint">–</span>}
                    </td>
                    <td className="col-mcp ellipsis" title={w.mcpServers.map((m) => `${m.name} · ${m.endpoint}`).join('\n')}>
                      {w.mcpServers.length ? w.mcpServers.map((m) => m.name).join(', ') : <span className="faint">–</span>}
                    </td>
                    <td className="col-files ellipsis" title={w.files.join('\n')}>
                      {w.files.length ? w.files.join(', ') : <span className="faint">–</span>}
                    </td>
                    <td className="col-used num">{n || <span className="faint">0</span>}</td>
                    <td className="col-actions">
                      <div className="task-row-actions">
                        <button className="btn ghost small icon danger" title="Delete" onClick={() => setConfirm(w)}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {confirm && <DeleteWorkspaceModal ws={confirm} users={users(confirm)} onClose={() => setConfirm(null)} />}
    </>
  )
}

function DeleteWorkspaceModal({ ws, users, onClose }: { ws: AXWorkspace; users: AXTask[]; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal card fade-in" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Delete workspace “{ws.name}”?</h3>
        <p className="muted" style={{ margin: '0 0 18px', lineHeight: 1.5 }}>
          It is removed from <strong>{ws.atespace}</strong>. This cannot be undone.
          {users.length > 0 && (
            <>
              {' '}
              {users.length === 1 ? 'Task' : 'Tasks'} <strong>{users.map((t) => t.name).join(', ')}</strong>{' '}
              {users.length === 1 ? 'uses' : 'use'} it.
            </>
          )}
        </p>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose} autoFocus>
            Cancel
          </button>
          <button
            className="btn primary"
            style={{ background: 'var(--red)' }}
            onClick={() => {
              onClose()
              void store.remove('workspace', ws.name)
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

export function TaskInspectorPane({ onPromote }: { onPromote?: (t: AXTask) => void } = {}) {
  const s = useStore()
  const [confirm, setConfirm] = useState<AXTask | null>(null)
  const [localPromote, setLocalPromote] = useState<AXTask | null>(null)
  const selected = s.tasks.find((t) => t.id === s.selectedTaskID) ?? null
  const triggerPromote = onPromote ?? ((t: AXTask) => setLocalPromote(t))
  return (
    <>
      <aside className={`inspector ${selected ? 'open' : ''}`}>
        {selected && (
          <TaskInspector
            key={selected.id}
            task={selected}
            onDelete={() => setConfirm(selected)}
            onPromote={() => triggerPromote(selected)}
          />
        )}
      </aside>
      {confirm && <DeleteTaskModal task={confirm} onClose={() => setConfirm(null)} />}
      {localPromote && <PromoteModal task={localPromote} onClose={() => setLocalPromote(null)} />}
    </>
  )
}

function DeleteTaskModal({ task, onClose }: { task: AXTask; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal card fade-in" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Delete task “{task.name}”?</h3>
        <p className="muted" style={{ margin: '0 0 18px', lineHeight: 1.5 }}>
          Its sandbox is torn down and the task is removed from <strong>{task.atespace}</strong>. This cannot be undone.
        </p>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose} autoFocus>
            Cancel
          </button>
          <button
            className="btn primary"
            style={{ background: 'var(--red)' }}
            onClick={() => {
              onClose()
              if (store.state.selectedTaskID === task.id) store.set({ selectedTaskID: null })
              void store.remove('task', task.name)
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

interface Action {
  label: string
  icon: LucideIcon
  run: () => void
  danger?: boolean
}

function actionsFor(t: AXTask, onDelete: () => void, onPromote: () => void): Action[] {
  const a: Action[] = []
  if (t.phase === 'suspended' || t.phase === 'failed' || t.phase === 'completed') {
    a.push({ label: 'Resume', icon: Play, run: () => void store.resume(t) })
  }
  if (t.phase === 'running' || t.phase === 'pending') {
    a.push({ label: 'Suspend', icon: Pause, run: () => void store.suspend(t) })
  }
  if (t.phase === 'running') {
    a.push({ label: 'Terminal', icon: Terminal, run: () => store.openTerminal(t) })
  }
  a.push({ label: 'Run on Team Cluster…', icon: Rocket, run: onPromote })
  a.push({ label: 'Delete…', icon: Trash2, run: onDelete, danger: true })
  return a
}

function TaskRow({
  task: t,
  selected,
  onMenu,
  onDelete,
  onPromote,
}: {
  task: AXTask
  selected: boolean
  onMenu: (x: number, y: number) => void
  onDelete: () => void
  onPromote: () => void
}) {
  const detail = useStore().details[t.id]
  return (
    <tr
      className={`task-row ${selected ? 'selected' : ''}`}
      style={{ '--c': phaseColor(t.phase) } as CSSProperties}
      onClick={() => store.set({ selectedTaskID: selected ? null : t.id })}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(e.clientX, e.clientY)
      }}
    >
      <td className="col-name">
        <span className="task-row-name ellipsis" title={t.name}>
          {t.name}
        </span>
      </td>
      <td className="col-state">
        <PhaseBadge phase={t.phase} />
      </td>
      <td className="col-workspace">
        {detail?.workspace ? (
          <span className="row task-row-ws">
            <FolderGit2 size={12} color="var(--purple)" />
            <span className="ellipsis">{detail.workspace}</span>
          </span>
        ) : (
          <span className="faint">empty /workspace</span>
        )}
      </td>
      <td className="col-image mono ellipsis" title={detail?.image}>
        {detail?.image ? shortImage(detail.image) : <span className="faint">default</span>}
      </td>
      <td className="col-worker mono">{t.actor ? t.actor : <span className="faint">–</span>}</td>
      <td className="col-age num" title={detail?.createTime}>
        {t.age}
      </td>
      <td className="col-actions">
        <div className="task-row-actions" onClick={(e) => e.stopPropagation()}>
          {actionsFor(t, onDelete, onPromote).map((a) => (
            <button
              key={a.label}
              className={`btn ghost small icon ${a.danger ? 'danger' : ''}`}
              title={a.label.replace('…', '')}
              onClick={a.run}
            >
              <a.icon size={12} />
            </button>
          ))}
        </div>
      </td>
    </tr>
  )
}

function TaskInspector({ task: t, onDelete, onPromote }: { task: AXTask; onDelete: () => void; onPromote: () => void }) {
  const detail = useStore().details[t.id]
  const [tab, setTab] = useState<'overview' | 'changes'>('overview')
  const [showManifest, setShowManifest] = useState(false)
  const [copied, setCopied] = useState(false)

  const copyManifest = async () => {
    if (!detail?.manifest) return
    await navigator.clipboard.writeText(detail.manifest)
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  const handleContinueWithAgent = () => {
    designer.continueFromTask(t, detail)
    store.setSection('designer')
  }

  const fields: [string, string | undefined][] = [
    ['Goal', detail?.goal],
    ['Session ID', detail?.sessionId],
    ['Gateway', detail?.gateway ? `${detail.gateway} (egress enforced)` : 'None (air-gapped)'],
    ['Workspace', detail?.workspace ? `${detail.workspace} → /workspace` : 'empty /workspace'],
    ['Image', detail?.image],
    ['Commands', detail?.command.length ? detail.command.join(' ') : undefined],
    ['Resources', detail?.cpu || detail?.memory ? `${detail?.cpu ?? '–'} CPU · ${detail?.memory ?? '–'}` : undefined],
    ['Actor', t.actor],
    ['Debug', detail ? (detail.debug ? 'on (Changes & Terminal enabled)' : 'off') : undefined],
  ]

  return (
    <div className="inspector-inner fade-in">
      <header className="inspector-head">
        <div className="col" style={{ gap: 6, minWidth: 0 }}>
          <strong className="inspector-title ellipsis selectable" title={t.name}>
            {t.name}
          </strong>
          <div className="row">
            <PhaseBadge phase={t.phase} />
            <span className="caption faint">
              {t.atespace} · {t.age}
            </span>
          </div>
        </div>
        <span className="spacer" />
        <button className="btn ghost icon" title="Close" onClick={() => store.set({ selectedTaskID: null })}>
          <X size={15} />
        </button>
      </header>

      <div className="inspector-body">
        <LifecycleTrack phase={t.phase} conditions={detail?.conditions ?? []} />

        {/* Lifecycle actions for the selected task */}
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {(t.phase === 'suspended' || t.phase === 'failed' || t.phase === 'completed') && (
            <button className="btn small primary" onClick={() => void store.resume(t)}>
              <Play size={12} /> Resume
            </button>
          )}
          {(t.phase === 'running' || t.phase === 'pending') && (
            <button className="btn small" onClick={() => void store.suspend(t)}>
              <Pause size={12} /> Suspend
            </button>
          )}
          {t.phase === 'running' && (
            <button className="btn small" onClick={() => store.openTerminal(t)}>
              <Terminal size={12} /> Terminal
            </button>
          )}
          <button className="btn small" onClick={handleContinueWithAgent} title="Start a child task sharing this sessionId">
            <ArrowRight size={12} /> Continue
          </button>
          <button className="btn small primary" onClick={onPromote} title="Promote to a remote team cluster">
            <Rocket size={12} /> Promote
          </button>
          <button className="btn small danger" onClick={onDelete}>
            <Trash2 size={12} />
          </button>
        </div>

        <Segmented<'overview' | 'changes'>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'overview', label: 'Details & Logs' },
            {
              value: 'changes',
              label: (
                <span className="row" style={{ gap: 5 }}>
                  <FileDiff size={12} /> Changes
                </span>
              ),
            },
          ]}
        />

        {tab === 'changes' ? (
          <TaskChangesPane task={t} />
        ) : (
          <>
            <InspectorSection title="Task & Guardrails">
              <dl className="fields">
                {fields
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <div key={k} className="field">
                      <dt>{k}</dt>
                      <dd
                        className={
                          k === 'Image' || k === 'Commands' || k === 'Session ID' ? 'mono selectable' : 'selectable'
                        }
                      >
                        {k === 'Gateway' && <Shield size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />}
                        {v}
                      </dd>
                    </div>
                  ))}
              </dl>
            </InspectorSection>

            {detail?.output && (
              <InspectorSection title="Task Output">
                <pre className="manifest selectable" style={{ maxHeight: 200, overflow: 'auto' }}>
                  {detail.output}
                </pre>
              </InspectorSection>
            )}

            {!!detail?.conditions.length && (
              <InspectorSection title="Conditions">
                <div className="conditions">
                  {detail.conditions.map((c) => {
                    const ok = c.status.toLowerCase() === 'true'
                    return (
                      <div key={c.type} className="condition">
                        {ok ? <CircleCheck size={15} color="var(--green)" /> : <CircleX size={15} color="#EC835A" />}
                        <div className="col" style={{ gap: 2, minWidth: 0, flex: 1 }}>
                          <div className="row">
                            <strong>{c.type}</strong>
                            <span className="caption faint">{ok ? 'True' : c.status}</span>
                            <span className="spacer" />
                            {c.updateTime && (
                              <span className="caption faint" title={c.updateTime}>
                                {since(c.updateTime)} ago
                              </span>
                            )}
                          </div>
                          {c.reason && <span className="caption">{c.reason}</span>}
                          {c.message && <span className="caption muted selectable">{c.message}</span>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </InspectorSection>
            )}

            <InspectorSection title="Live Logs">
              <TaskLogs task={t} />
            </InspectorSection>

            <section className="inspector-section">
              <div className="row">
                <button className="section-toggle" onClick={() => setShowManifest(!showManifest)}>
                  <ChevronRight size={13} className={showManifest ? 'rot' : ''} />
                  Manifest YAML
                </button>
                <span className="spacer" />
                <button
                  className="btn small ghost"
                  disabled={!detail?.manifest}
                  title="Copy the manifest as YAML"
                  onClick={() => void copyManifest()}
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              {showManifest && <pre className="manifest selectable">{detail?.manifest || 'loading…'}</pre>}
            </section>
          </>
        )}
      </div>
    </div>
  )
}

function InspectorSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="inspector-section">
      <h4>{title}</h4>
      {children}
    </section>
  )
}

function LifecycleTrack({ phase, conditions }: { phase: Phase; conditions: Condition[] }) {
  const find = (type: string) => conditions.find((c) => c.type === type)
  const isTrue = (c?: Condition) => c?.status.toLowerCase() === 'true'
  const ready = find('Ready')
  const ws = find('WorkspaceReady')
  const green = 'var(--green)'
  const stages: { id: string; icon: LucideIcon | null; done: boolean; tint: string; hint?: string }[] = [
    { id: 'Created', icon: Plus, done: true, tint: green },
    {
      id: 'Workspace',
      icon: FolderGit2,
      done: isTrue(ws) || isTrue(ready),
      tint: green,
      hint: ws?.reason || ws?.message,
    },
    { id: 'Ready', icon: Bolt, done: isTrue(ready), tint: green, hint: ready?.reason || ready?.message },
  ]
  if (phase !== 'running' && phase !== 'pending') {
    stages.push({ id: phaseLabel(phase), icon: null, done: true, tint: phaseColor(phase) })
  }

  return (
    <div className="lifecycle">
      {stages.map((st, i) => (
        <div
          key={st.id}
          className={`stage ${st.done ? 'done' : ''}`}
          style={{ '--c': st.tint } as CSSProperties}
          title={st.hint}
        >
          {i > 0 && <span className={`stage-line ${st.done ? 'done' : ''}`} />}
          <span className="stage-dot">
            {st.icon ? <st.icon size={13} /> : <PhaseIcon phase={phase} size={14} />}
          </span>
          <span className="stage-label">{st.id}</span>
        </div>
      ))}
    </div>
  )
}
