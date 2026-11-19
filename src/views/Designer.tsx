import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  Box,
  Check,
  CircleCheck,
  CircleX,
  Copy,
  Cpu,
  Eye,
  EyeOff,
  FileCode2,
  FolderGit2,
  FolderOpen,
  KeyRound,
  LayoutGrid,
  Lock,
  MemoryStick,
  Play,
  Plus,
  Save,
  Shield,
  Sparkles,
  TriangleAlert,
  Variable,
  X,
  type LucideIcon,
} from 'lucide-react'
import { Dropdown } from '../App'
import { studioClient } from '../api'
import { PageHeader, Segmented, Toggle } from '../components'
import {
  canApply,
  cpuString,
  designer,
  formatEnv,
  generate,
  isSecret,
  issues,
  memoryString,
  parseEnv,
  PRESETS,
  uid,
  useDraft,
  validateEnvName,
  withID,
  type ConfigMode,
  type Draft,
  type GatewayPreset,
  type KeyValue,
  type WorkspaceMode,
} from '../model/designer'
import { validateImage, validateLabel } from '../model/resources'
import { store, useStore } from '../model/store'
import '../styles/designer.css'
import { CompositionDiagram } from './designer/CompositionDiagram'
import { YamlView } from './designer/YamlView'

type ApplyResult = { ok: boolean; text: string } | null

export function Designer() {
  const d = useDraft()
  const [result, setResult] = useState<ApplyResult>(null)
  const [applying, setApplying] = useState(false)
  const [split, setSplit] = useState(() => Number(localStorage.getItem('ax-studio.designer.split')) || 0.52)

  const apply = useCallback(async () => {
    const draft = designer.draft
    if (!canApply(draft) || applying) return
    setApplying(true)
    setResult(null)
    const r = await store.applyAndRun(generate(draft), draft.rawMode ? '' : draft.name, draft.autoStart && !draft.rawMode)
    setResult({ ok: r.ok, text: r.ok ? r.stdout.trim() : r.error })
    if (r.ok && !draft.rawMode) {
      designer.set({
        name: withID(draft.name),
        wsName: draft.workspaceMode === 'new' ? withID(draft.wsName) : draft.wsName,
        gwName: draft.gatewayMode === 'balanced' || draft.gatewayMode === 'locked' ? withID(draft.gwName) : draft.gwName,
      })
    }
    setApplying(false)
  }, [applying])

  useEffect(() => setResult(null), [d])

  return (
    <div className="designer">
      <div className="designer-head">
        <PageHeader title="Start a Task" subtitle="Choose an agent template, attach a Git workspace and guardrails, then launch.">
          <div className="row">
            <Dropdown
              label={
                <>
                  <LayoutGrid size={14} />
                  Templates
                </>
              }
            >
              {(close) =>
                PRESETS.map((t, i) => (
                  <Fragment key={t.id}>
                    {t.group && t.group !== PRESETS[i - 1]?.group && (
                      <>
                        <div className="menu-sep" />
                        <div className="menu-heading caption faint">{t.group}</div>
                      </>
                    )}
                    <button
                      className="menu-item"
                      onClick={() => {
                        designer.load(t.id)
                        close()
                      }}
                    >
                      <span className="menu-check" />
                      {t.title}
                    </button>
                  </Fragment>
                ))
              }
            </Dropdown>
            <button className="btn" title="Open YAML manifest" onClick={() => void designer.open()}>
              <FolderOpen size={14} />
              Open YAML
            </button>
            <button className="btn" title="Download YAML manifest" onClick={() => designer.save()}>
              <Save size={14} />
              Download
            </button>
            <button className="btn primary" disabled={!canApply(d) || applying} onClick={() => void apply()}>
              <Play size={13} fill="currentColor" />
              {applying ? 'Launching…' : d.autoStart && !d.rawMode ? 'Create & Run' : 'Create (Suspended)'}
            </button>
          </div>
        </PageHeader>
      </div>
      <SplitPane
        fraction={split}
        onChange={(f) => {
          setSplit(f)
          localStorage.setItem('ax-studio.designer.split', String(f))
        }}
        left={<DesignerForm d={d} />}
        right={
          <div className="designer-right">
            <div className="designer-diagram dotgrid">
              <CompositionDiagram d={d} />
            </div>
            <YamlPane d={d} />
          </div>
        }
      />
      <Footer d={d} result={result} />
    </div>
  )
}

function SplitPane({
  left,
  right,
  fraction,
  onChange,
}: {
  left: ReactNode
  right: ReactNode
  fraction: number
  onChange: (f: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault()
    const move = (ev: MouseEvent) => {
      const r = ref.current?.getBoundingClientRect()
      if (!r) return
      onChange(Math.min(0.72, Math.max(0.3, (ev.clientX - r.left) / r.width)))
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.style.cursor = ''
    }
    document.body.style.cursor = 'col-resize'
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  return (
    <div className="split" ref={ref}>
      <div className="split-pane" style={{ flexBasis: `${fraction * 100}%` }}>
        {left}
      </div>
      <div className="split-handle" onMouseDown={startDrag}>
        <span />
      </div>
      <div className="split-pane split-right">{right}</div>
    </div>
  )
}

function Section({
  icon: Icon,
  tint,
  title,
  trailing,
  children,
}: {
  icon: LucideIcon
  tint: string
  title: string
  trailing?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="ds-card card">
      <header className="ds-header">
        <span className="ds-icon" style={{ '--tint': tint } as CSSProperties}>
          <Icon size={13} />
        </span>
        <h2>{title}</h2>
        <span className="spacer" />
        {trailing}
      </header>
      <div className="ds-body">{children}</div>
    </section>
  )
}

function Field({
  label,
  error,
  warn,
  children,
}: {
  label: string
  error?: string | null
  warn?: boolean
  children: ReactNode
}) {
  return (
    <div className="ds-field">
      <label>{label}</label>
      <div className="col" style={{ gap: 3, minWidth: 0 }}>
        {children}
        {error && <span className={`ds-error caption ${warn ? 'warn' : ''}`}>{error}</span>}
      </div>
    </div>
  )
}

const set = (patch: Partial<Draft>) => designer.set(patch)

function update<T extends { id: number }>(list: T[], id: number, patch: Partial<T>): T[] {
  return list.map((x) => (x.id === id ? { ...x, ...patch } : x))
}

function RowRemove({ onClick }: { onClick: () => void }) {
  return (
    <button className="btn small icon ghost" title="Remove" onClick={onClick}>
      <X size={13} />
    </button>
  )
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="btn small ghost ds-add" onClick={onClick}>
      <Plus size={13} />
      {label}
    </button>
  )
}

function Meter({
  icon: Icon,
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
  ticks,
}: {
  icon: LucideIcon
  label: string
  value: number
  min: number
  max: number
  step: number
  display: string
  ticks: string[]
  onChange: (v: number) => void
}) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className="meter">
      <div className="row meter-top">
        <Icon size={14} className="faint" />
        <span className="muted">{label}</span>
        <span className="spacer" />
        <strong className="mono meter-value">{display}</strong>
      </div>
      <div className="meter-track" style={{ '--pct': `${pct}%` } as CSSProperties}>
        <div className="meter-fill" />
        <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
      </div>
      <div className="meter-ticks caption faint">
        {ticks.map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
    </div>
  )
}

function DesignerForm({ d }: { d: Draft }) {
  const s = useStore()
  if (d.rawMode) {
    return (
      <div className="ds-form">
        <div className="ds-card card ds-raw">
          <FileCode2 size={22} className="faint" />
          <div className="col" style={{ gap: 2 }}>
            <strong>Editing YAML directly</strong>
            <span className="muted">The visual form is paused while you edit the manifest on the right.</span>
          </div>
          <span className="spacer" />
          <button className="btn" onClick={() => set({ rawMode: false })}>
            Back to Visual Editor
          </button>
        </div>
      </div>
    )
  }
  const nameErr = validateLabel(d.name)
  const atesErr = d.atespace ? validateLabel(d.atespace) : null
  const imgErr = validateImage(d.image)

  return (
    <div className="ds-form">
      <Section icon={Box} tint="var(--accent)" title="Task & Goal">
        <Field label="Name" error={nameErr}>
          <input className={`input ${nameErr ? 'invalid' : ''}`} value={d.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="Goal">
          <textarea
            className="textarea"
            rows={3}
            placeholder="Describe what the agent should accomplish in /workspace…"
            value={d.goal}
            onChange={(e) => set({ goal: e.target.value })}
          />
        </Field>
        <Field label="Session ID">
          <input
            className="input mono"
            value={d.sessionId}
            placeholder="auto-generated (or shared across multi-agent turns)"
            onChange={(e) => set({ sessionId: e.target.value })}
          />
        </Field>
        <Field label="Image" error={imgErr}>
          <input
            className={`input mono ${imgErr ? 'invalid' : ''}`}
            value={d.image}
            placeholder="ghcr.io/.../image@sha256:..."
            spellCheck={false}
            onChange={(e) => set({ image: e.target.value })}
          />
        </Field>
        <Field label="Commands">
          <input
            className="input mono"
            value={d.command}
            placeholder="optional command argv (image entrypoint decides when empty)"
            spellCheck={false}
            onChange={(e) => set({ command: e.target.value })}
          />
        </Field>
        <Field label="Atespace" error={atesErr}>
          <input
            className={`input ${atesErr ? 'invalid' : ''}`}
            value={d.atespace}
            placeholder={s.atespace}
            onChange={(e) => set({ atespace: e.target.value })}
          />
        </Field>
        <div className="ds-toggle-row">
          <div className="col">
            <span>Start immediately</span>
            <span className="caption faint">Automatically calls ax resume after creating the task</span>
          </div>
          <Toggle checked={d.autoStart} onChange={(autoStart) => set({ autoStart })} />
        </div>
      </Section>

      <GuardrailsSection d={d} />

      <Section
        icon={FolderGit2}
        tint="var(--purple)"
        title="Workspace"
        trailing={
          <Segmented<WorkspaceMode>
            value={d.workspaceMode}
            onChange={(workspaceMode) => set({ workspaceMode })}
            options={[
              { value: 'none', label: 'Empty' },
              { value: 'existing', label: 'Existing' },
              { value: 'new', label: 'New Git Repo' },
            ]}
          />
        }
      >
        {d.workspaceMode === 'none' && <p className="muted ds-hint">The task gets an empty <code>/workspace</code>.</p>}
        {d.workspaceMode === 'existing' && (
          <Field label="Workspace">
            <select className="select" value={d.existingWorkspace} onChange={(e) => set({ existingWorkspace: e.target.value })}>
              <option value="">Choose…</option>
              {s.workspaces.map((w) => (
                <option key={w.id} value={w.name}>
                  {w.name} ({w.gitCount} repo{w.gitCount === 1 ? '' : 's'}, {w.mcpCount} MCP)
                </option>
              ))}
            </select>
          </Field>
        )}
        {d.workspaceMode === 'new' && <NewWorkspace d={d} />}
      </Section>

      <Section icon={Cpu} tint="var(--orange)" title="Sandbox Compute">
        <Meter
          icon={Cpu}
          label="CPU"
          value={d.cpu}
          min={0.25}
          max={8}
          step={0.25}
          display={cpuString(d.cpu)}
          ticks={['250m', '2', '4', '6', '8']}
          onChange={(cpu) => set({ cpu })}
        />
        <Meter
          icon={MemoryStick}
          label="Memory"
          value={d.memoryMi}
          min={256}
          max={16384}
          step={256}
          display={memoryString(d.memoryMi)}
          ticks={['256Mi', '4Gi', '8Gi', '12Gi', '16Gi']}
          onChange={(memoryMi) => set({ memoryMi })}
        />
        <div className="ds-toggle-row">
          <div className="col">
            <span>Debug & Diff Inspection</span>
            <span className="caption faint">Enables in-sandbox Changes viewer, Terminal, and branch push</span>
          </div>
          <Toggle checked={d.debug} onChange={(debug) => set({ debug })} />
        </div>
      </Section>

      <Environment env={d.env} />

      <Section
        icon={Sparkles}
        tint="#d4721f"
        title="Runner Config"
        trailing={
          <Segmented<ConfigMode>
            value={d.configMode}
            onChange={(configMode) => set({ configMode })}
            options={[
              { value: 'none', label: 'None' },
              { value: 'custom', label: 'Custom YAML' },
            ]}
          />
        }
      >
        {d.configMode === 'none' && <p className="muted ds-hint">No extra runner configuration object.</p>}
        {d.configMode === 'custom' && (
          <textarea
            className="textarea mono"
            rows={5}
            spellCheck={false}
            value={d.customConfig}
            onChange={(e) => set({ customConfig: e.target.value })}
          />
        )}
      </Section>
    </div>
  )
}

function GuardrailsSection({ d }: { d: Draft }) {
  const s = useStore()
  const [apiKeyValue, setApiKeyValue] = useState('')
  const [savingSecret, setSavingSecret] = useState(false)
  const [secretMsg, setSecretMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const saveK8sSecret = async () => {
    if (!apiKeyValue.trim()) return
    setSavingSecret(true)
    setSecretMsg(null)
    try {
      const res = await studioClient.createCredentialSecret({
        context: s.context,
        name: d.credentialSecretName,
        key: d.credentialSecretKey,
        value: apiKeyValue.trim(),
      })
      setApiKeyValue('')
      const envKey = d.credentialProvider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'GEMINI_API_KEY'
      const hasEnv = d.env.some((kv) => kv.key === envKey)
      set({
        credentialUri: res.credentialUri,
        env: hasEnv ? d.env : [...d.env, { id: uid(), key: envKey, value: 'placeholder' }],
      })
      setSecretMsg({
        ok: true,
        text: `Saved Secret ${res.namespace}/${res.name} (ax.io/credential=true). Key is injected outside the sandbox via Gateway!`,
      })
    } catch (e) {
      setSecretMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setSavingSecret(false)
    }
  }

  return (
    <Section
      icon={Shield}
      tint="var(--teal)"
      title="Network Guardrails & Credentials"
      trailing={
        <Segmented<GatewayPreset>
          value={d.gatewayMode}
          onChange={(gatewayMode) => set({ gatewayMode })}
          options={[
            { value: 'none', label: 'Air-gapped' },
            { value: 'balanced', label: 'Balanced' },
            { value: 'locked', label: 'Locked Down' },
            { value: 'existing', label: 'Existing' },
          ]}
        />
      }
    >
      {d.gatewayMode === 'none' && (
        <p className="muted ds-hint">
          No external network access. Choose <strong>Balanced</strong> to allow GitHub, PyPI/npm, and model APIs.
        </p>
      )}
      {d.gatewayMode === 'existing' && (
        <Field label="Gateway">
          <select className="select" value={d.existingGateway} onChange={(e) => set({ existingGateway: e.target.value })}>
            <option value="">Choose…</option>
            {s.gateways.map((g) => (
              <option key={g.id} value={g.name}>
                {g.name} ({g.ruleCount} rule{g.ruleCount === 1 ? '' : 's'})
              </option>
            ))}
          </select>
        </Field>
      )}
      {(d.gatewayMode === 'balanced' || d.gatewayMode === 'locked') && (
        <>
          <Field label="Gateway Name" error={validateLabel(d.gwName)}>
            <input className="input mono" value={d.gwName} onChange={(e) => set({ gwName: e.target.value })} />
          </Field>
          <Field label="Extra Hosts">
            <input
              className="input mono"
              placeholder="comma-separated hostnames (e.g. crates.io, proxy.golang.org)"
              value={d.extraDomains}
              onChange={(e) => set({ extraDomains: e.target.value })}
            />
          </Field>
          <Field label="API Credential">
            <div className="col" style={{ gap: 6 }}>
              <Segmented<'none' | 'anthropic' | 'gemini'>
                value={d.credentialProvider}
                onChange={(credentialProvider) => {
                  const defaultSecret =
                    credentialProvider === 'anthropic'
                      ? { credentialSecretName: 'anthropic-api-creds', credentialSecretKey: 'ANTHROPIC_API_KEY' }
                      : credentialProvider === 'gemini'
                        ? { credentialSecretName: 'gemini-api-creds', credentialSecretKey: 'GEMINI_API_KEY' }
                        : {}
                  set({ credentialProvider, credentialUri: '', ...defaultSecret })
                }}
                options={[
                  { value: 'none', label: 'None' },
                  { value: 'anthropic', label: 'Anthropic Key' },
                  { value: 'gemini', label: 'Gemini Key' },
                ]}
              />
              {d.credentialProvider !== 'none' && (
                <div className="card col" style={{ padding: 8, gap: 6, background: 'var(--bg-2)' }}>
                  <div className="ds-row">
                    <input
                      className="input mono"
                      value={d.credentialSecretName}
                      placeholder="k8s secret name"
                      onChange={(e) => set({ credentialSecretName: e.target.value })}
                    />
                    <input
                      className="input mono"
                      value={d.credentialSecretKey}
                      placeholder="key"
                      onChange={(e) => set({ credentialSecretKey: e.target.value })}
                    />
                  </div>
                  <div className="ds-row">
                    <input
                      className="input mono"
                      type="password"
                      placeholder="Paste API key once to store in K8s Secret (never stored in Task YAML)"
                      value={apiKeyValue}
                      onChange={(e) => setApiKeyValue(e.target.value)}
                    />
                    <button
                      className="btn small primary"
                      disabled={savingSecret || !apiKeyValue.trim()}
                      onClick={() => void saveK8sSecret()}
                    >
                      <KeyRound size={12} />
                      {savingSecret ? 'Saving…' : 'Save Secret'}
                    </button>
                  </div>
                  {secretMsg && (
                    <span className="caption" style={{ color: secretMsg.ok ? 'var(--green)' : 'var(--red)' }}>
                      {secretMsg.text}
                    </span>
                  )}
                </div>
              )}
            </div>
          </Field>
        </>
      )}
    </Section>
  )
}

const envRows = (text: string, prev: KeyValue[]): KeyValue[] =>
  parseEnv(text).map((kv, i) => ({ id: prev[i]?.id ?? uid(), ...kv }))

function Environment({ env }: { env: KeyValue[] }) {
  const [mode, setMode] = useState<'form' | 'text'>('form')
  const [text, setText] = useState('')
  const [shown, setShown] = useState<Set<number>>(new Set())
  const toggleShown = (id: number) =>
    setShown((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })
  const onPaste = (kv: KeyValue) => (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text')
    if (!/^\s*(export\s+)?[A-Za-z_]\w*=/m.test(pasted)) return
    const rows = envRows(pasted, [])
    if (rows.length === 0) return
    e.preventDefault()
    const i = env.findIndex((x) => x.id === kv.id)
    const keep = kv.key || kv.value ? [env[i]] : []
    set({ env: [...env.slice(0, i), ...keep, ...rows, ...env.slice(i + 1)] })
  }
  return (
    <Section
      icon={Variable}
      tint="var(--green)"
      title="Environment Variables"
      trailing={
        <Segmented<'form' | 'text'>
          value={mode}
          onChange={(m) => {
            if (m === 'text') setText(formatEnv(env.filter((kv) => kv.key || kv.value)))
            setMode(m)
          }}
          options={[
            { value: 'form', label: 'Form' },
            { value: 'text', label: '.env' },
          ]}
        />
      }
    >
      {mode === 'text' ? (
        <textarea
          className="textarea mono"
          rows={Math.max(4, Math.min(12, text.split('\n').length + 1))}
          spellCheck={false}
          value={text}
          placeholder={'NAME=value'}
          onChange={(e) => {
            setText(e.target.value)
            set({ env: envRows(e.target.value, env) })
          }}
        />
      ) : (
        <>
          {env.length === 0 && (
            <p className="muted ds-hint">Non-secret environment variables passed to the task command.</p>
          )}
          {env.length > 0 && (
            <div className="env-grid">
              <span className="caption faint">Name</span>
              <span />
              <span className="caption faint">Value</span>
              <span />
              {env.map((kv) => {
                const err = validateEnvName(kv.key, env)
                const secret = isSecret(kv.key) && kv.value !== 'placeholder'
                const visible = !secret || shown.has(kv.id)
                return (
                  <Fragment key={kv.id}>
                    <div className="col" style={{ gap: 2, minWidth: 0 }}>
                      <input
                        className={`input mono ${err ? 'invalid' : ''}`}
                        value={kv.key}
                        placeholder="NAME"
                        spellCheck={false}
                        onPaste={onPaste(kv)}
                        onChange={(e) => set({ env: update(env, kv.id, { key: e.target.value }) })}
                      />
                      {err && <span className="ds-error caption">{err}</span>}
                    </div>
                    <span className="env-eq mono faint">=</span>
                    <div className={`env-value ${secret ? 'secret' : ''}`}>
                      {secret && <Lock size={12} className="env-lock" />}
                      <input
                        className="input mono"
                        type={visible ? 'text' : 'password'}
                        value={kv.value}
                        placeholder="value"
                        spellCheck={false}
                        onChange={(e) => set({ env: update(env, kv.id, { value: e.target.value }) })}
                      />
                      {secret && (
                        <button
                          className="btn small icon ghost env-eye"
                          title={visible ? 'Hide' : 'Show'}
                          onClick={() => toggleShown(kv.id)}
                        >
                          {visible ? <EyeOff size={13} /> : <Eye size={13} />}
                        </button>
                      )}
                    </div>
                    <RowRemove onClick={() => set({ env: env.filter((x) => x.id !== kv.id) })} />
                  </Fragment>
                )
              })}
            </div>
          )}
          <AddButton label="Add variable" onClick={() => set({ env: [...env, { id: uid(), key: '', value: '' }] })} />
        </>
      )}
    </Section>
  )
}

function NewWorkspace({ d }: { d: Draft }) {
  return (
    <>
      <Field label="Name" error={validateLabel(d.wsName)}>
        <input className="input" value={d.wsName} onChange={(e) => set({ wsName: e.target.value })} />
      </Field>
      <Field label="Git repos">
        <div className="col" style={{ gap: 6 }}>
          {d.repos.map((r) => (
            <div key={r.id} className="ds-row">
              <input
                className="input"
                style={{ flex: '0 0 22%' }}
                value={r.name}
                placeholder="origin"
                onChange={(e) => set({ repos: update(d.repos, r.id, { name: e.target.value }) })}
              />
              <input
                className={`input mono ${r.repo ? '' : 'invalid'}`}
                value={r.repo}
                placeholder="https://github.com/org/repo.git"
                spellCheck={false}
                onChange={(e) => set({ repos: update(d.repos, r.id, { repo: e.target.value }) })}
              />
              <input
                className="input mono"
                style={{ flex: '0 0 18%' }}
                value={r.branch}
                placeholder="ref / branch"
                onChange={(e) => set({ repos: update(d.repos, r.id, { branch: e.target.value }) })}
              />
              <RowRemove onClick={() => set({ repos: d.repos.filter((x) => x.id !== r.id) })} />
            </div>
          ))}
          <AddButton
            label="Add repo"
            onClick={() =>
              set({
                repos: [
                  ...d.repos,
                  { id: uid(), name: d.repos.length ? `repo${d.repos.length + 1}` : 'origin', repo: '', branch: 'main' },
                ],
              })
            }
          />
        </div>
      </Field>
      <Field label="Setup cmds">
        <textarea
          className="textarea mono"
          rows={2}
          placeholder="Optional setup commands, one per line (e.g. pip install -e . pytest)"
          value={d.setupCommands}
          onChange={(e) => set({ setupCommands: e.target.value })}
        />
      </Field>
      <Field label="Inline files">
        <div className="col" style={{ gap: 8 }}>
          {d.files.map((f) => (
            <div key={f.id} className="ds-file">
              <div className="ds-row">
                <input
                  className="input mono"
                  value={f.path}
                  placeholder="AGENTS.md"
                  onChange={(e) => set({ files: update(d.files, f.id, { path: e.target.value }) })}
                />
                <RowRemove onClick={() => set({ files: d.files.filter((x) => x.id !== f.id) })} />
              </div>
              <textarea
                className="textarea mono"
                rows={3}
                value={f.content}
                placeholder="file contents"
                spellCheck={false}
                onChange={(e) => set({ files: update(d.files, f.id, { content: e.target.value }) })}
              />
            </div>
          ))}
          <AddButton
            label="Add file"
            onClick={() => set({ files: [...d.files, { id: uid(), path: d.files.length ? '' : 'AGENTS.md', content: '' }] })}
          />
        </div>
      </Field>
    </>
  )
}

function YamlPane({ d }: { d: Draft }) {
  const [copied, setCopied] = useState(false)
  const text = generate(d, true)
  const docs = text.split(/^---\s*$/m).filter((x) => x.trim()).length
  const copy = async () => {
    await navigator.clipboard.writeText(generate(d))
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }
  return (
    <div className="yaml-pane">
      <div className="yaml-head">
        <FileCode2 size={14} className="faint" />
        <strong>{d.rawMode ? 'Manifest' : 'Generated YAML'}</strong>
        <span className="chip">
          {docs} object{docs === 1 ? '' : 's'}
        </span>
        <span className="spacer" />
        <label className="row caption muted" style={{ gap: 6 }}>
          Edit raw
          <Toggle checked={d.rawMode} onChange={(on) => (on ? designer.enterRawMode() : set({ rawMode: false }))} />
        </label>
        <button className="btn small" onClick={() => void copy()} title="Copy YAML">
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {d.rawMode ? (
        <textarea
          className="yaml-raw mono"
          spellCheck={false}
          value={d.rawYAML}
          onChange={(e) => set({ rawYAML: e.target.value })}
        />
      ) : (
        <YamlView text={text} />
      )}
    </div>
  )
}

function Footer({ d, result }: { d: Draft; result: ApplyResult }) {
  const list = issues(d)
  return (
    <footer className="designer-foot">
      <div className="foot-issues">
        {list.length === 0 ? (
          <span className="row foot-ok">
            <CircleCheck size={14} />
            {d.rawMode ? 'Raw manifest — validated by ax-server on apply' : 'Ready to launch'}
          </span>
        ) : (
          list.map((i, n) => (
            <span key={n} className={`row foot-issue ${i.severity}`}>
              {i.severity === 'error' ? <CircleX size={13} /> : <TriangleAlert size={13} />}
              {i.text}
            </span>
          ))
        )}
      </div>
      {result && (
        <div className={`foot-result fade-in ${result.ok ? 'ok' : 'err'}`} title={result.text}>
          {result.ok ? <CircleCheck size={14} /> : <CircleX size={14} />}
          <span className="ellipsis selectable">{result.text || (result.ok ? 'Launched' : 'Failed')}</span>
        </div>
      )}
    </footer>
  )
}
