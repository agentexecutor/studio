import { useEffect, useRef, useState } from 'react'
import {
  Boxes,
  Check,
  ChevronDown,
  Gauge,
  Laptop,
  RefreshCw,
  Server,
  Settings as SettingsIcon,
  SquarePen,
  SquareTerminal,
  type LucideIcon,
} from 'lucide-react'
import logo from './assets/axel.svg'
import { PulseDot } from './components'
import { isLocal, shortName, type AXContext } from './model/resources'
import { store, useStore, type Section } from './model/store'
import './styles/app.css'
import { Clusters } from './views/Clusters'
import { Designer } from './views/Designer'
import { Overview } from './views/Overview'
import { TerminalPage } from './views/Terminal'

const SECTIONS: { id: Section; title: string; icon: LucideIcon; group: 'Overview' | 'Build' }[] = [
  { id: 'overview', title: 'Activity', icon: Gauge, group: 'Overview' },
  { id: 'designer', title: 'New Task', icon: SquarePen, group: 'Build' },
  { id: 'terminal', title: 'Terminal', icon: SquareTerminal, group: 'Build' },
  { id: 'clusters', title: 'Environments', icon: Boxes, group: 'Build' },
]

export function App() {
  const s = useStore()

  useEffect(() => {
    void store.start()
  }, [])

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-top" style={{ height: 14 }} />
        <nav>
          {(['Overview', 'Build'] as const).map((g) => (
            <div key={g} className="nav-group">
              <div className="nav-heading">{g}</div>
              {SECTIONS.filter((x) => x.group === g).map((x) => (
                <button
                  key={x.id}
                  className={`nav-item ${s.section === x.id ? 'on' : ''}`}
                  onClick={() => store.setSection(x.id)}
                >
                  <x.icon size={15} />
                  <span>{x.title}</span>
                  {x.id === 'overview' && s.tasks.length > 0 && <span className="nav-count">{s.tasks.length}</span>}
                  {x.id === 'terminal' && s.terminalTabs.length > 0 && (
                    <span className="nav-count">{s.terminalTabs.length}</span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="spacer" />
        <ConnectionBadge />
      </aside>
      <main className="main">
        <Toolbar />
        {s.section !== 'terminal' && (
          <div className="content" key={s.section}>
            {s.section === 'overview' && <Overview />}
            {s.section === 'designer' && <Designer />}
            {s.section === 'clusters' && <Clusters />}
          </div>
        )}
        {(s.section === 'terminal' || s.terminalTabs.length > 0) && (
          <div className="content" hidden={s.section !== 'terminal'}>
            <TerminalPage />
          </div>
        )}
      </main>
      {s.settingsOpen && <SettingsModal />}
    </div>
  )
}

const contextIcon = (c?: AXContext) => (isLocal(c) ? Laptop : Server)

function Toolbar() {
  const s = useStore()
  const current = store.currentContext
  const Icon = contextIcon(current)
  const [atespace, setAtespace] = useState(s.atespace)
  useEffect(() => setAtespace(s.atespace), [s.atespace])

  return (
    <header className="toolbar">
      <div className="toolbar-title">
        <img src={logo} alt="AX" className="toolbar-logo" />
        AX Studio
      </div>
      <div className="spacer" />
      <div className="row">
        <Dropdown
          label={
            <>
              <Icon size={14} />
              {current ? shortName(current.name) : s.context ? shortName(s.context) : 'Select Environment'}
            </>
          }
          title="Active cluster environment (Local sandbox or Team Kubernetes cluster)"
        >
          {(close) => (
            <>
              {s.contexts.length === 0 && (
                <div className="caption muted" style={{ padding: '8px 12px' }}>
                  No cluster contexts yet. Set up Local or connect a cluster.
                </div>
              )}
              {s.contexts.map((c) => {
                const CI = contextIcon(c)
                return (
                  <button
                    key={c.name}
                    className="menu-item"
                    onClick={() => {
                      store.setScope({ context: c.name })
                      close()
                    }}
                  >
                    <span className="menu-check">{c.name === s.context && <Check size={13} />}</span>
                    <CI size={13} />
                    <span className="col">
                      <span>
                        {shortName(c.name)}
                        {c.isCurrent && <span className="faint"> · default</span>}
                      </span>
                      {c.description && <span className="caption faint">{c.description}</span>}
                    </span>
                  </button>
                )
              })}
              <div className="menu-sep" />
              <button
                className="menu-item"
                onClick={() => {
                  store.setSection('clusters')
                  close()
                }}
              >
                <span className="menu-check">
                  <Boxes size={13} />
                </span>
                Manage Local & Team Clusters…
              </button>
              {s.context && (
                <button
                  className="menu-item"
                  disabled={current?.isCurrent ?? false}
                  onClick={() => {
                    void store.makeDefault(s.context)
                    close()
                  }}
                >
                  <span className="menu-check" />
                  Set as Default for ax CLI
                </button>
              )}
            </>
          )}
        </Dropdown>
        <input
          className="input"
          style={{ width: 110 }}
          value={atespace}
          title="Atespace scope"
          placeholder="atespace"
          onChange={(e) => setAtespace(e.target.value)}
          onBlur={() => atespace !== s.atespace && store.setScope({ atespace: atespace || 'default' })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <button className="btn icon" title="Refresh" onClick={() => void store.refresh(true)}>
          <RefreshCw size={14} className={s.isRefreshing ? 'spin' : ''} />
        </button>
        <button className="btn icon" title="Settings" onClick={() => store.set({ settingsOpen: true })}>
          <SettingsIcon size={14} />
        </button>
      </div>
    </header>
  )
}

export function Dropdown({
  label,
  title,
  children,
}: {
  label: React.ReactNode
  title?: string
  children: (close: () => void) => React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div className="dropdown" ref={ref}>
      <button className="btn" title={title} onClick={() => setOpen(!open)}>
        {label}
        <ChevronDown size={12} className="faint" />
      </button>
      {open && <div className="menu card fade-in">{children(() => setOpen(false))}</div>}
    </div>
  )
}

function ConnectionBadge() {
  const s = useStore()
  const color = !s.context
    ? 'var(--orange)'
    : s.connectionError
      ? 'var(--red)'
      : s.lastRefresh
        ? 'var(--green)'
        : 'var(--orange)'
  const status = !s.context
    ? 'choose local or remote cluster'
    : (s.connectionError ?? (s.lastRefresh ? `updated ${new Date(s.lastRefresh).toLocaleTimeString()}` : 'connecting…'))
  return (
    <div
      className="conn"
      style={{ cursor: 'pointer' }}
      onClick={() => store.setSection('clusters')}
      title={s.connectionError ?? s.axVersion ?? 'Manage environment'}
    >
      <PulseDot color={color} on={!!s.context && !s.connectionError && !!s.lastRefresh} />
      <div className="col" style={{ minWidth: 0 }}>
        <strong className="ellipsis">{s.context ? shortName(s.context) : 'No Environment'}</strong>
        <span className="caption muted clamp2">{status}</span>
      </div>
    </div>
  )
}

function SettingsModal() {
  const s = useStore()
  const [localRepoPath, setLocalRepoPath] = useState(s.settings.localRepoPath)
  const [interval, setIntervalValue] = useState(s.settings.refreshInterval)
  const close = () => store.set({ settingsOpen: false })
  const save = () => {
    store.updateSettings({ localRepoPath: localRepoPath.trim(), refreshInterval: interval })
    close()
  }
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal card fade-in" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Studio Settings</h3>
        <div className="form-grid">
          <label>Local Git Repo</label>
          <div className="col" style={{ gap: 4 }}>
            <input
              className="input mono"
              placeholder={s.home ? `${s.home}/Projects/my-repo` : '/path/to/local/git/repo'}
              value={localRepoPath}
              onChange={(e) => setLocalRepoPath(e.target.value)}
            />
            <span className="caption faint">Default local Git checkout used when clicking "Apply to Local Repo" in Changes.</span>
          </div>
          <label>Auto-refresh</label>
          <div className="row">
            <input
              type="range"
              min={2}
              max={30}
              step={1}
              value={interval}
              onChange={(e) => setIntervalValue(+e.target.value)}
              style={{ flex: 1 }}
            />
            <span className="mono" style={{ width: 32, textAlign: 'right' }}>
              {interval}s
            </span>
          </div>
        </div>
        <div className="row" style={{ marginTop: 18, justifyContent: 'flex-end' }}>
          <span className="caption faint" style={{ marginRight: 'auto' }}>
            {s.axVersion?.split('\n')[0]} · {s.os}
          </span>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
