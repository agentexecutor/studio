import type { ReactNode } from 'react'
import { Box, Cpu, FileCode2, FileText, FolderGit2, GitBranch, Shield } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cpuString, memoryString, type Draft } from '../../model/designer'
import { repoName, shortImage } from '../../model/resources'

function Node({
  icon: Icon,
  tint,
  title,
  subtitle,
  children,
  kind,
}: {
  icon: LucideIcon
  tint: string
  title: string
  subtitle: string
  kind: string
  children?: ReactNode
}) {
  return (
    <div className="cd-node card fade-in" style={{ '--tint': tint } as React.CSSProperties}>
      <div className="cd-kind">{kind}</div>
      <div className="row" style={{ gap: 10 }}>
        <div className="cd-tile">
          <Icon size={17} />
        </div>
        <div className="col" style={{ minWidth: 0 }}>
          <strong className="ellipsis">{title || '—'}</strong>
          <span className="caption muted ellipsis">{subtitle}</span>
        </div>
      </div>
      {children}
    </div>
  )
}

function Connector({ color, dashed, label }: { color: string; dashed?: boolean; label: string }) {
  return (
    <div className="cd-connector fade-in">
      <svg viewBox="0 0 100 40" preserveAspectRatio="none">
        <path
          d="M0 20 C 35 4, 65 36, 100 20"
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeDasharray={dashed ? '5 5' : undefined}
          vectorEffect="non-scaling-stroke"
          opacity={0.7}
        />
        {!dashed && (
          <circle r={3} fill={color}>
            <animateMotion dur="1.8s" repeatCount="indefinite" path="M0 20 C 35 4, 65 36, 100 20" />
          </circle>
        )}
      </svg>
      <span className="caption faint">{label}</span>
    </div>
  )
}

export function CompositionDiagram({ d }: { d: Draft }) {
  if (d.rawMode) {
    return (
      <div className="cd-raw muted">
        <FileCode2 size={22} />
        <strong>Raw YAML mode — applied as written.</strong>
      </div>
    )
  }
  const sources = d.repos.length + d.files.length
  const gwTitle = d.gatewayMode === 'existing' ? d.existingGateway || 'select gateway' : d.gwName
  return (
    <div className="cd">
      {d.workspaceMode !== 'none' && (
        <>
          <Node
            icon={FolderGit2}
            tint="var(--purple)"
            kind="Workspace"
            title={d.workspaceMode === 'existing' ? d.existingWorkspace || 'pick a workspace' : d.wsName}
            subtitle={d.workspaceMode === 'existing' ? 'existing workspace' : `${sources} source${sources === 1 ? '' : 's'}`}
          >
            {d.workspaceMode === 'new' && sources > 0 && (
              <div className="cd-chips">
                {d.repos.map((r) => (
                  <span key={r.id} className="chip">
                    <GitBranch size={10} />
                    {r.repo ? repoName(r.repo) : r.name || 'repo'}
                  </span>
                ))}
                {d.files.map((f) => (
                  <span key={f.id} className="chip">
                    <FileText size={10} />
                    {f.path || 'file'}
                  </span>
                ))}
              </div>
            )}
          </Node>
          <Connector color="var(--purple)" label="/workspace" />
        </>
      )}
      <Node
        icon={Box}
        tint="var(--accent)"
        kind="Task"
        title={d.name}
        subtitle={d.image ? shortImage(d.image) : 'default runner image'}
      >
        <div className="cd-chips">
          <span className="chip">
            <Cpu size={10} />
            {cpuString(d.cpu)} CPU
          </span>
          <span className="chip">{memoryString(d.memoryMi)}</span>
          {d.debug && <span className="chip">debug</span>}
          {d.sessionId && <span className="chip">session</span>}
        </div>
      </Node>
      {d.gatewayMode !== 'none' && (
        <>
          <Connector color="var(--teal)" label="egress" />
          <Node
            icon={Shield}
            tint="var(--teal)"
            kind="Gateway"
            title={gwTitle}
            subtitle={d.gatewayMode === 'existing' ? 'existing policy' : `${d.gatewayMode} guardrails`}
          />
        </>
      )}
    </div>
  )
}
