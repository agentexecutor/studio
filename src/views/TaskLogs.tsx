import { Terminal } from 'lucide-react'
import type { AXTask } from '../model/resources'
import { store, useStore } from '../model/store'

export function TaskLogs({ task: t }: { task: AXTask }) {
  const s = useStore()
  const detail = s.details[t.id]

  if (detail?.output) {
    return (
      <pre className="sandbox-output task-logs selectable">
        {detail.output}
      </pre>
    )
  }

  return (
    <div className="card row" style={{ padding: '10px 12px', background: 'var(--bg-2)', gap: 10 }}>
      <span className="caption muted" style={{ flex: 1 }}>
        {t.phase === 'running'
          ? detail?.debug
            ? 'Sandbox is active. Open an interactive Terminal session to inspect live processes and files.'
            : 'Task is running (enable Debug on creation to inspect inside the sandbox).'
          : 'No captured output summary recorded yet.'}
      </span>
      {t.phase === 'running' && detail?.debug && (
        <button className="btn small" onClick={() => store.openTerminal(t)}>
          <Terminal size={12} /> Open Terminal
        </button>
      )}
    </div>
  )
}
