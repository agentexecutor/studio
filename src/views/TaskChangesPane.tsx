import { useCallback, useEffect, useState } from 'react'
import {
  Check,
  Download,
  FileDiff,
  GitBranch,
  Loader,
  RefreshCw,
  RotateCcw,
  TriangleAlert,
} from 'lucide-react'
import { studioClient, type TaskChangesResponse } from '../api'
import type { AXTask } from '../model/resources'
import { store, useStore } from '../model/store'

export function TaskChangesPane({ task }: { task: AXTask }) {
  const s = useStore()
  const [data, setData] = useState<TaskChangesResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [selectedPath, setSelectedPath] = useState<string>('')
  const [localRepo, setLocalRepo] = useState(s.settings.localRepoPath)
  const [applying, setApplying] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [discarding, setDiscarding] = useState<string | null>(null)
  const [banner, setBanner] = useState<{ kind: 'ok' | 'warn' | 'err'; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setBanner(null)
    try {
      const res = await studioClient.getTaskChanges(s.context, s.atespace, task.name)
      setData(res)
      if (res.files.length > 0 && !res.files.some((f) => f.path === selectedPath)) {
        setSelectedPath(res.files[0].path)
      }
    } catch (e) {
      setBanner({ kind: 'err', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setLoading(false)
    }
  }, [s.context, s.atespace, task.name, selectedPath])

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id, s.context])

  const handleDiscard = async (filePath: string) => {
    setDiscarding(filePath)
    setBanner(null)
    try {
      await studioClient.discardTaskFile(s.context, s.atespace, task.name, filePath)
      setBanner({ kind: 'ok', text: `Reverted ${filePath} inside sandbox.` })
      await load()
    } catch (e) {
      setBanner({ kind: 'err', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setDiscarding(null)
    }
  }

  const handleApplyLocal = async () => {
    const target = localRepo.trim()
    if (!target) {
      setBanner({ kind: 'err', text: 'Enter the absolute path to your local Git checkout first.' })
      return
    }
    setApplying(true)
    setBanner(null)
    try {
      store.updateSettings({ localRepoPath: target })
      const res = await studioClient.applyTaskChangesLocal(s.context, s.atespace, task.name, target)
      if (res.conflict) {
        setBanner({
          kind: 'warn',
          text: `Patch conflicts with local working tree (${res.detail || 'git apply --check failed'}). Push a branch instead so nothing is overwritten.`,
        })
      } else {
        setBanner({
          kind: 'ok',
          text: `Applied ${res.filesApplied ?? 0} changed file(s) cleanly to ${res.localRepoPath}!`,
        })
      }
    } catch (e) {
      setBanner({ kind: 'err', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setApplying(false)
    }
  }

  const handlePushBranch = async () => {
    setPushing(true)
    setBanner(null)
    try {
      const res = await studioClient.pushTaskBranch(s.context, s.atespace, task.name)
      setBanner({
        kind: 'ok',
        text: `Pushed sandbox changes to origin/${res.branch} (${res.commitSha})!`,
      })
      await load()
    } catch (e) {
      setBanner({ kind: 'err', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setPushing(false)
    }
  }

  if (loading && !data) {
    return (
      <div className="row muted" style={{ padding: 14, gap: 8 }}>
        <Loader size={14} className="spin" /> Inspecting sandbox working tree…
      </div>
    )
  }

  if (data && !data.available) {
    return (
      <div className="card" style={{ padding: 12, background: 'var(--bg-2)' }}>
        <div className="row" style={{ gap: 8 }}>
          <FileDiff size={15} className="faint" />
          <span className="caption muted">{data.reason || 'Sandbox diff unavailable.'}</span>
          <span className="spacer" />
          <button className="btn small ghost" onClick={() => void load()}>
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      </div>
    )
  }

  const files = data?.files ?? []
  const activeFile = files.find((f) => f.path === selectedPath) ?? files[0]

  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 6 }}>
        <GitBranch size={13} className="faint" />
        <span className="caption mono muted">{data?.branch || 'HEAD'}</span>
        <span className="chip">{files.length} changed</span>
        <span className="spacer" />
        <button className="btn small ghost" disabled={loading} onClick={() => void load()} title="Refresh sandbox diff">
          <RefreshCw size={12} className={loading ? 'spin' : ''} /> Refresh
        </button>
      </div>

      {banner && (
        <div
          className="card caption selectable"
          style={{
            padding: '8px 10px',
            borderLeft: `3px solid ${banner.kind === 'ok' ? 'var(--green)' : banner.kind === 'warn' ? 'var(--warn)' : 'var(--red)'}`,
            display: 'flex',
            gap: 8,
            alignItems: 'center',
          }}
        >
          {banner.kind === 'ok' ? (
            <Check size={14} color="var(--green)" />
          ) : (
            <TriangleAlert size={14} color={banner.kind === 'warn' ? 'var(--warn)' : 'var(--red)'} />
          )}
          <span>{banner.text}</span>
        </div>
      )}

      {files.length === 0 ? (
        <div className="card caption muted" style={{ padding: 14, textAlign: 'center', background: 'var(--bg-2)' }}>
          Working tree inside <code>{data?.repoDir || '/workspace'}</code> is clean.
        </div>
      ) : (
        <>
          <div className="col" style={{ gap: 4 }}>
            {files.map((f) => {
              const selected = activeFile?.path === f.path
              return (
                <div
                  key={f.path}
                  className={`card row ${selected ? 'highlight' : ''}`}
                  style={{ padding: '6px 8px', cursor: 'pointer', gap: 8 }}
                  onClick={() => setSelectedPath(f.path)}
                >
                  <span className="mono caption" style={{ fontWeight: 700, width: 16 }}>
                    {f.status}
                  </span>
                  <span className="mono caption ellipsis" style={{ flex: 1 }} title={f.path}>
                    {f.path}
                  </span>
                  <span className="mono caption" style={{ color: 'var(--green)' }}>
                    +{f.additions}
                  </span>
                  <span className="mono caption" style={{ color: 'var(--red)' }}>
                    -{f.deletions}
                  </span>
                  <button
                    className="btn small ghost icon"
                    title={`Discard changes in ${f.path}`}
                    disabled={discarding === f.path}
                    onClick={(e) => {
                      e.stopPropagation()
                      void handleDiscard(f.path)
                    }}
                  >
                    <RotateCcw size={11} />
                  </button>
                </div>
              )
            })}
          </div>

          {activeFile && (
            <pre
              className="manifest selectable"
              style={{ maxHeight: 280, overflow: 'auto', fontSize: 11.5, lineHeight: 1.45, margin: 0 }}
            >
              {(activeFile.patch || '(binary or empty diff)').split('\n').map((line, idx) => {
                const color =
                  line.startsWith('+') && !line.startsWith('+++')
                    ? 'var(--green)'
                    : line.startsWith('-') && !line.startsWith('---')
                      ? 'var(--red)'
                      : line.startsWith('@@')
                        ? 'var(--accent)'
                        : undefined
                return (
                  <div key={idx} style={color ? { color } : undefined}>
                    {line || ' '}
                  </div>
                )
              })}
            </pre>
          )}

          {/* Pre-Apply Actions: Apply to Local Host Repo OR Push Branch */}
          <div className="card col" style={{ padding: 10, gap: 8, background: 'var(--bg-2)' }}>
            <span className="caption" style={{ fontWeight: 600 }}>
              Bring Sandbox Changes Out Safely
            </span>
            <div className="row" style={{ gap: 6 }}>
              <input
                className="input mono"
                style={{ flex: 1, fontSize: 12 }}
                placeholder={s.home ? `${s.home}/Projects/repo` : '/absolute/path/to/local/git/repo'}
                value={localRepo}
                onChange={(e) => setLocalRepo(e.target.value)}
              />
              <button className="btn small primary" disabled={applying} onClick={() => void handleApplyLocal()}>
                {applying ? <Loader size={12} className="spin" /> : <Download size={12} />}
                {applying ? 'Applying…' : 'Apply to Local'}
              </button>
            </div>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="caption faint">Runs git apply --check first; never overwrites on conflict.</span>
              <button className="btn small" disabled={pushing} onClick={() => void handlePushBranch()}>
                {pushing ? <Loader size={12} className="spin" /> : <GitBranch size={12} />}
                {pushing ? 'Pushing…' : 'Push Branch'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
