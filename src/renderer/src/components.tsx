import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, CircleCheck, CirclePause, CirclePlay, CircleHelp, Hourglass, OctagonX, Terminal, Trash2, type LucideIcon } from 'lucide-react'
import { type Phase, phaseColor, phaseLabel } from './model/resources'

const PHASE_ICON: Record<string, LucideIcon> = {
  pending: Hourglass,
  running: CirclePlay,
  suspended: CirclePause,
  completed: CircleCheck,
  failed: OctagonX,
  terminating: Trash2,
}

export function PhaseIcon({ phase, size = 14 }: { phase: Phase; size?: number }) {
  const Icon = PHASE_ICON[phase] ?? CircleHelp
  return <Icon size={size} color={phaseColor(phase)} strokeWidth={2.2} style={{ flex: 'none' }} />
}

/** State is always icon + label, never color alone. */
export function PhaseBadge({ phase }: { phase: Phase }) {
  return (
    <span className="badge" style={{ '--c': phaseColor(phase) } as CSSProperties}>
      <PhaseIcon phase={phase} size={12} />
      {phaseLabel(phase)}
    </span>
  )
}

export function PulseDot({ color, on = true }: { color: string; on?: boolean }) {
  return <span className={`pulse ${on ? 'on' : ''}`} style={{ '--c': color } as CSSProperties} />
}

export function Chip({ icon: Icon, children, title }: { icon?: LucideIcon; children: ReactNode; title?: string }) {
  return (
    <span className="chip" title={title}>
      {Icon && <Icon size={11} />}
      {children}
    </span>
  )
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="spacer" />
      {children}
    </div>
  )
}

export function Empty({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon size={28} />
      <div style={{ fontWeight: 600, color: 'var(--text-2)' }}>{title}</div>
      {children && <div className="caption">{children}</div>}
    </div>
  )
}

export function Toggle({ checked, onChange, title }: { checked: boolean; onChange: (v: boolean) => void; title?: string }) {
  return (
    <label className="toggle" title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </label>
  )
}

export function Segmented<T extends string>({ value, options, onChange }: {
  value: T
  options: { value: T; label: ReactNode }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export interface ConsoleLine {
  id: number
  text: string
  header?: 'start' | 'ok' | 'fail'
}

/** A dark, auto-scrolling log pane for streamed command output. */
export function LogConsole({ lines, chip, onClear, clearDisabled, empty, open = true, onToggle }: {
  lines: ConsoleLine[]
  chip?: ReactNode
  onClear: () => void
  clearDisabled?: boolean
  empty: ReactNode
  open?: boolean
  onToggle?: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useEffect(() => {
    if (stick.current && ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [lines.length, open])

  const Chevron = open ? ChevronDown : ChevronUp
  return (
    <div className={`console ${open ? '' : 'collapsed'}`}>
      <div className={`row console-bar ${onToggle ? 'collapsible' : ''}`} onClick={onToggle}
        data-tip={onToggle ? (open ? 'Collapse output' : 'Expand output') : undefined}>
        <Terminal size={13} />
        <span>Output</span>
        {chip}
        <div className="spacer" />
        <span className="faint">{lines.length} lines</span>
        <button className="btn small ghost" onClick={(e) => { e.stopPropagation(); onClear() }} disabled={clearDisabled}
          data-tip="Empties this output. Nothing else changes.">Clear</button>
        {onToggle && <Chevron size={14} />}
      </div>
      {open && <div
        className="console-body selectable"
        ref={ref}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
      >
        {lines.length === 0 ? (
          <div className="console-empty">{empty}</div>
        ) : (
          lines.map((l) => (
            <div key={l.id} className={`console-line ${l.header ?? ''}`}>{l.text || ' '}</div>
          ))
        )}
      </div>}
    </div>
  )
}

/** "3m", "2h" from an ISO timestamp. */
export function since(iso?: string | number): string {
  if (!iso) return ''
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${Math.floor(s)}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

/**
 * Shows the `data-tip` of whatever the pointer rests on, drawn by the app:
 * the system's own tooltip for `title` is a black box on some platforms and
 * can't be styled. Mounted once; any element can then carry a `data-tip`.
 */
export function Tips() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; above: boolean } | null>(null)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let current: Element | null = null
    const hide = () => {
      clearTimeout(timer)
      current = null
      setTip(null)
    }
    const over = (e: MouseEvent) => {
      const el = e.target instanceof Element ? e.target.closest('[data-tip]') : null
      if (el === current) return
      hide()
      if (!el) return
      current = el
      timer = setTimeout(() => {
        // Read when it shows: the text may have changed while the pointer rested.
        const text = el.getAttribute('data-tip')
        if (!text || !el.isConnected) return
        const r = el.getBoundingClientRect()
        // Below the element, or above it near the bottom of the window; kept clear of the sides.
        const above = r.bottom + 120 > window.innerHeight
        const x = Math.min(Math.max(r.left + r.width / 2, TIP_WIDTH / 2 + 8), window.innerWidth - TIP_WIDTH / 2 - 8)
        setTip({ text, x, y: above ? r.top - 6 : r.bottom + 6, above })
      }, 350)
    }
    document.addEventListener('mouseover', over)
    document.addEventListener('mousedown', hide)
    document.addEventListener('scroll', hide, true)
    document.documentElement.addEventListener('mouseleave', hide)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mouseover', over)
      document.removeEventListener('mousedown', hide)
      document.removeEventListener('scroll', hide, true)
      document.documentElement.removeEventListener('mouseleave', hide)
    }
  }, [])
  if (!tip) return null
  return <div className={`tip ${tip.above ? 'above' : ''}`} style={{ left: tip.x, top: tip.y, maxWidth: TIP_WIDTH }}>{tip.text}</div>
}

const TIP_WIDTH = 320

