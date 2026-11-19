import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Check, Copy, Plus, RotateCcw } from 'lucide-react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { studioClient } from '../api'
import { store, useStore, type TerminalTab } from '../model/store'

let sessions = 0

const LINE_MODE = 'AXS-LINE-MODE'

const REMOTE = `if command -v script >/dev/null 2>&1; then
  exec env TERM=xterm-256color script -qefc "stty rows $1 cols $2; if command -v bash >/dev/null 2>&1; then exec bash -i; else exec sh -i; fi" /dev/null
fi
echo ${LINE_MODE}
exec sh -i`

const lineOutput = (s: string) =>
  s.replace(/^.*can't access tty; job control turned off\r?\n?/m, '').replace(/\r?\n/g, '\r\n')

const shq = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`)

const externalCommand = (ssh: string) =>
  `stty raw -echo; ${ssh} -- sh -c 'command -v script >/dev/null || exec sh -i; exec env TERM=xterm-256color script -qefc "stty rows $0 cols $1; command -v bash >/dev/null && exec bash -i; exec sh -i" /dev/null' "$(tput lines)" "$(tput cols)"; stty sane`

let firstCommand = new URLSearchParams(location.search).get('terminal')

export function TerminalSession({ tab, active }: { tab: TerminalTab; active: boolean }) {
  const s = useStore()
  const t = tab.task
  const termRef = useRef<Terminal | null>(null)
  const host = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'connecting' | 'connected' | 'exited'>('connecting')
  const [mode, setMode] = useState<'pty' | 'line' | null>(null)
  const [size, setSize] = useState('')
  const [resized, setResized] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [copied, setCopied] = useState(false)

  const copyCommand = () => {
    const argv = ['ax', ...tab.scope, 'ssh', t.name]
    void navigator.clipboard.writeText(externalCommand(argv.map(shq).join(' ')))
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  useEffect(() => {
    const el = host.current
    if (!el) return
    const term = new Terminal({
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--mono').trim() || 'monospace',
      fontSize: 13,
      lineHeight: 1.15,
      cursorBlink: true,
      scrollback: 10000,
      theme: { background: '#16171a', foreground: '#d6d6d8', cursor: '#5fd35f', selectionBackground: '#3a3f4b' },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)
    termRef.current = term
    fit.fit()
    term.focus()
    const { cols, rows } = term
    setSize(`${cols}×${rows}`)
    setResized(false)
    setStatus('connecting')
    setMode(null)

    const sid = `terminal-${++sessions}`
    let decided: 'pty' | 'line' | null = null
    let pending = ''
    let line = ''

    const decide = (m: 'pty' | 'line') => {
      decided = m
      setMode(m)
      if (firstCommand) {
        if (m === 'pty') void studioClient.writeSession(sid, firstCommand + '\r')
        else {
          term.write(firstCommand + '\r\n')
          void studioClient.writeSession(sid, firstCommand + '\n')
        }
        firstCommand = null
      }
    }

    const offData = studioClient.onSessionData((d) => {
      if (d.id !== sid) return
      setStatus((st) => (st === 'connecting' ? 'connected' : st))
      if (d.stream === 'stderr' || decided === 'line') {
        term.write(lineOutput(d.data))
        return
      }
      if (decided === 'pty') {
        term.write(d.data)
        return
      }
      pending += d.data
      if (pending.startsWith(LINE_MODE)) {
        const nl = pending.indexOf('\n')
        if (nl < 0) return
        decide('line')
        term.write(lineOutput(pending.slice(nl + 1)))
      } else if (!LINE_MODE.startsWith(pending)) {
        decide('pty')
        term.write(pending)
      }
    })
    const offExit = studioClient.onSessionExit((e) => {
      if (e.id !== sid) return
      setStatus('exited')
      term.write(`\r\n\x1b[2m[session ended${e.status ? `, exit ${e.status}` : ''}]\x1b[0m\r\n`)
    })

    const input = term.onData((data) => {
      if (decided !== 'line') {
        void studioClient.writeSession(sid, data)
        return
      }
      if (data.startsWith('\x1b')) return
      for (const c of data) {
        if (c === '\r') {
          term.write('\r\n')
          void studioClient.writeSession(sid, line + '\n')
          line = ''
        } else if (c === '\x7f') {
          if (line) {
            line = line.slice(0, -1)
            term.write('\b \b')
          }
        } else if (c === '\x03') {
          term.write('^C\r\n')
          line = ''
          void studioClient.interruptSession(sid)
        } else if (c === '\x04') {
          if (!line) void studioClient.endSessionInput(sid)
        } else if (c >= ' ') {
          line += c
          term.write(c)
        }
      }
    })

    const onCopy = (e: ClipboardEvent) => {
      if (!term.hasSelection() || !el.contains(document.activeElement)) return
      e.clipboardData?.setData('text/plain', term.getSelection())
      e.preventDefault()
    }
    document.addEventListener('copy', onCopy)

    const observer = new ResizeObserver(() => {
      if (el.clientWidth === 0) return
      const next = fit.proposeDimensions()
      setResized(!!next && (next.cols !== cols || next.rows !== rows))
    })
    observer.observe(el)

    void studioClient
      .startSession({
        id: sid,
        args: [...tab.scope, 'ssh', t.name, '--', 'sh', '-c', REMOTE, 'sh', String(rows), String(cols)],
      })
      .catch((err) => {
        setStatus('exited')
        term.write(`\r\n\x1b[31mFailed to connect: ${err instanceof Error ? err.message : String(err)}\x1b[0m\r\n`)
      })

    return () => {
      offData()
      offExit()
      input.dispose()
      observer.disconnect()
      document.removeEventListener('copy', onCopy)
      void studioClient.closeSession(sid)
      termRef.current = null
      term.dispose()
    }
  }, [t.name, tab.scope, attempt])

  useEffect(() => {
    if (active) termRef.current?.focus()
  }, [active])

  return (
    <div className="term-pane" hidden={!active}>
      <div className="row term-title">
        <span
          className={`pulse ${status === 'connected' ? 'on' : ''}`}
          style={
            {
              '--c': status === 'connected' ? 'var(--green)' : status === 'exited' ? 'var(--text-3)' : 'var(--orange)',
            } as CSSProperties
          }
        />
        <strong>{t.name}</strong>
        <span className="spacer" />
        <button
          className="btn small ghost"
          title="Open another terminal to this task"
          onClick={() => store.duplicateTerminal(tab)}
        >
          <Plus size={12} /> New session
        </button>
        <button className="btn small ghost" title="Copy ax ssh command for external terminal" onClick={copyCommand}>
          {copied ? (
            <>
              <Check size={12} /> Copied
            </>
          ) : (
            <>
              <Copy size={12} /> Copy ax ssh
            </>
          )}
        </button>
      </div>
      {tab.context === s.context && s.details[t.id]?.debug === false && (
        <div className="term-banner caption">
          Debug is off for this task, so ax ssh cannot connect. Enable Debug in New Task to open interactive shells.
        </div>
      )}
      <div className="term-body">
        <div ref={host} className="term-host" />
      </div>
      <div className="row term-foot caption faint">
        <span>
          {status === 'connecting'
            ? `Connecting to ${t.name}…`
            : mode === 'line'
              ? 'Line mode · Ctrl-C interrupt · Ctrl-D end'
              : `${size} · bash`}
        </span>
        <span className="spacer" />
        {resized && status !== 'exited' && <span>Window resized</span>}
        {(status === 'exited' || resized) && (
          <button className="btn small ghost" onClick={() => setAttempt((a) => a + 1)}>
            <RotateCcw size={12} /> {status === 'exited' ? 'Reconnect' : 'Reconnect to fit'}
          </button>
        )}
      </div>
    </div>
  )
}
