import { useEffect, useState } from 'react'
import { ArrowRight, Loader, Rocket, Server, TriangleAlert, X } from 'lucide-react'
import { studioClient } from '../api'
import { Toggle } from '../components'
import { shortName, validateLabel, type AXTask } from '../model/resources'
import { store, useStore } from '../model/store'

/**
 * Promotes a task to another cluster with `ax promote`. The modal only chooses
 * the command's options and shows its output; `ax promote` decides what is
 * created, reused or refused.
 */
export function PromoteModal({ task, onClose }: { task: AXTask; onClose: () => void }) {
  const s = useStore()
  const candidates = s.contexts.filter((c) => c.name !== s.context)
  const [targetCtx, setTargetCtx] = useState(candidates[0]?.name ?? '')
  const [toAtespace, setToAtespace] = useState('')
  const [replace, setReplace] = useState(false)
  const [suspendSource, setSuspendSource] = useState(false)
  const [noResume, setNoResume] = useState(false)
  const [preview, setPreview] = useState<{ ok: boolean; text: string } | null>(null)
  const [checking, setChecking] = useState(false)
  const [promoting, setPromoting] = useState(false)
  const [error, setError] = useState('')
  const [dirtyCount, setDirtyCount] = useState(0)

  const atespaceError = toAtespace ? validateLabel(toAtespace) : null

  /** The `ax promote` arguments for the chosen options. */
  const promoteArgs = (preflightOnly: boolean) => {
    const args = ['promote', 'task', task.name, '--to', targetCtx, '--to-namespace', s.axNamespace]
    if (toAtespace) args.push('--to-atespace', toAtespace)
    if (replace) args.push('--replace')
    if (suspendSource) args.push('--suspend-source')
    if (noResume) args.push('--no-resume')
    if (preflightOnly) args.push('--preflight-only')
    return args
  }

  // Preview what `ax promote` would do whenever the options change.
  useEffect(() => {
    if (!targetCtx || atespaceError) {
      setPreview(null)
      return
    }
    let stale = false
    setChecking(true)
    void store.ax(promoteArgs(true)).then((r) => {
      if (stale) return
      setPreview({ ok: r.ok, text: [r.stdout.trim(), r.stderr.trim()].filter(Boolean).join('\n') })
      setChecking(false)
    })
    return () => {
      stale = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetCtx, toAtespace, replace, suspendSource, noResume])

  // `ax promote` does not copy the sandbox's files, so say when there are uncommitted ones.
  useEffect(() => {
    studioClient
      .getTaskChanges(s.context, s.atespace, task.name)
      .then((c) => setDirtyCount(c.available ? c.files.length : 0))
      .catch(() => setDirtyCount(0))
  }, [s.context, s.atespace, task.name])

  const handlePromote = async () => {
    setPromoting(true)
    setError('')
    const r = await store.ax(promoteArgs(false))
    setPromoting(false)
    store.log(`Promote ${task.name} → ${shortName(targetCtx)}`, r.ok ? r.stdout.trim() : r.error, r.ok)
    if (!r.ok) {
      setError([r.stdout.trim(), r.stderr.trim()].filter(Boolean).join('\n') || r.error)
      return
    }
    onClose()
    store.setScope({ context: targetCtx, atespace: toAtespace || s.atespace })
  }

  return (
    <div className="modal-backdrop" onMouseDown={() => !promoting && onClose()}>
      <div
        className="modal card fade-in"
        style={{ width: 'min(640px, 94vw)', maxHeight: '88vh', overflowY: 'auto' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="row" style={{ marginBottom: 12 }}>
          <Rocket size={17} color="var(--accent)" />
          <h3 style={{ margin: 0 }}>Run on a Team Cluster</h3>
          <span className="spacer" />
          <button className="btn ghost icon" disabled={promoting} onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <p className="muted" style={{ margin: '0 0 14px', lineHeight: 1.45 }}>
          Runs <code>ax promote</code> to copy <strong>{task.name}</strong>, with the Workspace and Gateway it binds, from{' '}
          <code>{shortName(s.context || 'local')}</code> to another cluster. The sandbox's files and the Secrets a Gateway
          names are not copied.
        </p>

        {candidates.length === 0 ? (
          <div className="card" style={{ padding: 10, background: 'var(--bg-2)', marginBottom: 14 }}>
            <span className="caption muted">
              No other cluster contexts found in <code>~/.kube/config</code>. Add a GKE or remote cluster context first.
            </span>
          </div>
        ) : (
          <div className="form-grid" style={{ marginBottom: 14 }}>
            <label>Target cluster</label>
            <div className="row" style={{ gap: 8 }}>
              <Server size={14} className="faint" />
              <select className="select" style={{ flex: 1 }} value={targetCtx} onChange={(e) => setTargetCtx(e.target.value)}>
                {candidates.map((c) => (
                  <option key={c.name} value={c.name}>
                    {shortName(c.name)} ({c.name})
                  </option>
                ))}
              </select>
            </div>
            <label>Target atespace</label>
            <div className="col" style={{ gap: 3 }}>
              <input
                className={`input ${atespaceError ? 'invalid' : ''}`}
                value={toAtespace}
                placeholder={`${s.atespace} (same as the task)`}
                onChange={(e) => setToAtespace(e.target.value.trim())}
              />
              {atespaceError && <span className="ds-error caption">{atespaceError}</span>}
            </div>
            <label>Replace</label>
            <Option checked={replace} onChange={setReplace} flag="--replace">
              Delete a task of the same name on the target first
            </Option>
            <label>Suspend source</label>
            <Option checked={suspendSource} onChange={setSuspendSource} flag="--suspend-source">
              Suspend the task here before the target resumes it
            </Option>
            <label>Do not start</label>
            <Option checked={noResume} onChange={setNoResume} flag="--no-resume">
              Create the task on the target without resuming it
            </Option>
          </div>
        )}

        {dirtyCount > 0 && (
          <div className="row problem-line" style={{ marginBottom: 12 }}>
            <TriangleAlert size={14} />
            <span>
              {dirtyCount} uncommitted file{dirtyCount === 1 ? '' : 's'} in this sandbox will not be on the target. Push them
              from the Changes tab and use a Workspace that checks out that branch.
            </span>
          </div>
        )}

        {targetCtx && (
          <div style={{ marginBottom: 14 }}>
            <div className="row caption muted" style={{ marginBottom: 6, fontWeight: 600, gap: 6 }}>
              Preflight (<code>ax promote --preflight-only</code>)
              {checking && <Loader size={12} className="spin" />}
            </div>
            <pre
              className="manifest selectable"
              style={{ margin: 0, maxHeight: 200, color: preview && !preview.ok ? 'var(--red)' : undefined }}
            >
              {preview ? preview.text || '(no output)' : checking ? 'Checking…' : ''}
            </pre>
          </div>
        )}

        {error && (
          <div className="row problem-line" style={{ marginBottom: 12, alignItems: 'flex-start' }}>
            <TriangleAlert size={14} />
            <span className="selectable" style={{ whiteSpace: 'pre-wrap' }}>
              {error}
            </span>
          </div>
        )}

        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn" disabled={promoting} onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!preview?.ok || promoting || checking} onClick={() => void handlePromote()}>
            {promoting ? <Loader size={13} className="spin" /> : <ArrowRight size={13} />}
            {promoting ? 'Promoting…' : `Run on ${targetCtx ? shortName(targetCtx) : 'Cluster'}`}
          </button>
        </div>
      </div>
    </div>
  )
}

function Option({
  checked,
  onChange,
  flag,
  children,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  flag: string
  children: React.ReactNode
}) {
  return (
    <div className="row" style={{ gap: 8 }}>
      <Toggle checked={checked} onChange={onChange} />
      <span className="caption muted">
        {children} (<code>{flag}</code>)
      </span>
    </div>
  )
}
