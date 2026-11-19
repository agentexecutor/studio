import { useSyncExternalStore } from 'react'
import { studioClient, type EnvOpSnapshot, type EnvStatusResponse, type ImageOverrides } from '../api'
import type { ConsoleLine } from '../components'
import { store } from './store'

export type StageID = 'kind' | 'substrate' | 'workers' | 'ax'
export const STAGES: { id: StageID; title: string }[] = [
  { id: 'kind', title: 'Kind cluster' },
  { id: 'substrate', title: 'Agent Substrate' },
  { id: 'workers', title: 'gVisor WorkerPool' },
  { id: 'ax', title: 'AX control plane' },
]

function validClusterName(name?: string): string {
  return name && name !== 'N/A' ? name : 'ax-local'
}

export interface ClustersState {
  env: EnvStatusResponse | null
  loading: boolean
  loaded: boolean
  workers: number
  serverImage: string
  runnerVolumeImage: string
  op: EnvOpSnapshot | null
  log: ConsoleLine[]
  diagnosticsText: string | null
}

class ClustersStore {
  state: ClustersState = {
    env: null,
    loading: false,
    loaded: false,
    workers: 1,
    serverImage: '',
    runnerVolumeImage: '',
    op: null,
    log: [],
    diagnosticsText: null,
  }

  private listeners = new Set<() => void>()
  private lineID = 1
  private subscribedEvents = false

  subscribe = (l: () => void) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  set(patch: Partial<ClustersState>) {
    this.state = { ...this.state, ...patch }
    for (const l of this.listeners) l()
  }

  async init() {
    if (!this.subscribedEvents) {
      this.subscribedEvents = true
      studioClient.onStreamLine((l) => {
        const nextLog = [...this.state.log, { id: this.lineID++, text: l.line }].slice(-3000)
        const op = this.state.op && l.stage ? { ...this.state.op, stage: l.stage } : this.state.op
        this.set({ log: nextLog, op })
      })
      studioClient.onEnvOp((op) => {
        const wasRunning = this.state.op?.status === 'running'
        this.set({ op })
        if (wasRunning && op.status !== 'running') {
          const doneMsg =
            op.status === 'ok' ? `✓ ${op.action} (${op.target}) completed` : `✗ ${op.action} failed: ${op.error ?? ''}`
          const header: ConsoleLine['header'] = op.status === 'ok' ? 'ok' : 'fail'
          this.set({
            log: [
              ...this.state.log,
              { id: this.lineID++, text: doneMsg, header },
            ].slice(-3000),
          })
          void this.refresh()
          void store.loadContexts().then(() => store.refresh(true))
        }
      })
    }
    await this.refresh()
  }

  async refresh() {
    this.set({ loading: true })
    try {
      const env = await studioClient.getEnvStatus()
      const op = env.operation ?? this.state.op
      let log = this.state.log
      if (env.operation?.logs?.length && log.length === 0) {
        log = env.operation.logs.map((text) => ({ id: this.lineID++, text }))
      }
      const serverImage = this.state.serverImage || env.serverImageEnv || ''
      this.set({ env, op, log, serverImage, loaded: true })
    } finally {
      this.set({ loading: false })
    }
  }

  /** The image references the user filled in; an empty one is left to ax. */
  private get images(): ImageOverrides {
    const { serverImage, runnerVolumeImage } = this.state
    return {
      serverImage: serverImage.trim() || undefined,
      runnerVolumeImage: runnerVolumeImage.trim() || undefined,
    }
  }

  async startLocal() {
    const targetName =
      this.state.env?.local.state !== 'NotFound' ? validClusterName(this.state.env?.local.name) : 'ax-local'
    this.set({ log: [{ id: this.lineID++, text: '▶ Starting local sandbox environment (ax local start)…', header: 'start' }] })
    const op = await studioClient.localUp(targetName, this.state.workers, this.images)
    this.set({ op })
  }

  async stopLocal() {
    const targetName = validClusterName(this.state.env?.local.name)
    this.set({ log: [{ id: this.lineID++, text: '▶ Stopping local cluster containers (ax local stop)…', header: 'start' }] })
    const op = await studioClient.localStop(targetName)
    this.set({ op })
  }

  async deleteLocal() {
    const targetName = validClusterName(this.state.env?.local.name)
    this.set({ log: [{ id: this.lineID++, text: '▶ Deleting local cluster (ax local delete)…', header: 'start' }] })
    const op = await studioClient.localDelete(targetName)
    this.set({ op })
  }

  async installRemote(contextName: string) {
    this.set({
      log: [{ id: this.lineID++, text: `▶ Installing AX on cluster ${contextName}…`, header: 'start' }],
    })
    const op = await studioClient.remoteInstall(contextName, this.images)
    this.set({ op })
  }

  async openContext(contextName: string) {
    await studioClient.selectContext(contextName)
    await store.loadContexts()
    store.setScope({ context: contextName })
    store.setSection('overview')
  }

  async copyDiagnostics(contextName?: string): Promise<string> {
    const res = await studioClient.getDiagnostics(contextName)
    this.set({ diagnosticsText: res.diagnostics })
    await navigator.clipboard.writeText(res.diagnostics)
    return res.diagnostics
  }
}

export const clusters = new ClustersStore()

export function useClusters(): ClustersState {
  return useSyncExternalStore(clusters.subscribe, () => clusters.state)
}
