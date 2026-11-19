// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Browser Backend-for-Frontend (BFF) client for `ax studio`.
// Session authentication uses an HttpOnly SameSite=Strict cookie; the CSRF
// token is held strictly in memory (never persisted to localStorage).

export interface CommandResult {
  status: number
  stdout: string
  stderr: string
}

export interface RunRequest {
  program: string
  args: string[]
  stdin?: string
}

export interface SessionRequest {
  id: string
  args: string[]
}

export interface SessionData {
  id: string
  data: string
  stream: 'stdout' | 'stderr'
}

export interface StreamLine {
  id: string
  line: string
  stage?: string
}

export interface StreamExit {
  id: string
  status: number
}

export interface PlatformInfo {
  os: string
  home: string
  pathSeparator: string
  axNamespace: string
  version: string
}

export interface PreflightItem {
  id: string
  label: string
  status: 'ok' | 'warn' | 'fail'
  detail: string
  command?: string
}

export interface ContextSummary {
  name: string
  cluster: string
  current: boolean
  isLocal: boolean
}

export interface LocalClusterInfo {
  name: string
  state: 'NotFound' | 'Stopped' | 'Running' | string
  kubeContext: string
  substrateStatus: string
  axStatus: string
}

export interface EnvOpSnapshot {
  id: string
  action: 'local-up' | 'local-stop' | 'local-delete' | 'remote-install' | string
  target: string
  stage?: 'kind' | 'substrate' | 'workers' | 'ax' | string
  status: 'running' | 'ok' | 'failed'
  error?: string
  logs?: string[]
  started: number
  finished?: number
}

export interface EnvStatusResponse {
  os: string
  arch: string
  freeDiskBytes: number
  containerRuntime: string
  containerKernel: string
  containerMemBytes: number
  containerRootless: boolean
  canStartLocal: boolean
  serverImageEnv?: string
  preflight: PreflightItem[]
  local: LocalClusterInfo
  contexts: ContextSummary[]
  currentContext: string
  operation?: EnvOpSnapshot
}

/** Image references passed to `ax local start` and `ax install`; an unset one keeps ax's default. */
export interface ImageOverrides {
  serverImage?: string
  runnerVolumeImage?: string
}

export interface ChangedFile {
  path: string
  status: 'M' | 'A' | 'D' | '?' | string
  additions: number
  deletions: number
  patch: string
}

export interface TaskChangesResponse {
  taskName: string
  available: boolean
  reason?: string
  repoDir?: string
  branch?: string
  files: ChangedFile[]
  fullPatch: string
}

export interface ApplyLocalResponse {
  applied: boolean
  conflict: boolean
  detail?: string
  filesApplied?: number
  localRepoPath?: string
}

export interface PushBranchResponse {
  branch: string
  commitSha: string
  repoDir: string
}

let csrfToken = ''
let platformCache: PlatformInfo | null = null
let bootstrapPromise: Promise<PlatformInfo> | null = null
let eventSource: EventSource | null = null

const streamLineListeners = new Set<(l: StreamLine) => void>()
const sessionDataListeners = new Set<(d: SessionData) => void>()
const sessionExitListeners = new Set<(e: StreamExit) => void>()
const envOpListeners = new Set<(op: EnvOpSnapshot) => void>()

function ensureEventStream() {
  if (eventSource) return
  eventSource = new EventSource('/api/events')
  eventSource.onmessage = (ev) => {
    try {
      const parsed = JSON.parse(ev.data) as { type: string; payload: unknown }
      switch (parsed.type) {
        case 'streamLine':
          for (const cb of streamLineListeners) cb(parsed.payload as StreamLine)
          break
        case 'sessionData':
          for (const cb of sessionDataListeners) cb(parsed.payload as SessionData)
          break
        case 'sessionExit':
          for (const cb of sessionExitListeners) cb(parsed.payload as StreamExit)
          break
        case 'envOp':
          for (const cb of envOpListeners) cb(parsed.payload as EnvOpSnapshot)
          break
      }
    } catch {
      // Ignore malformed SSE frames.
    }
  }
}

export async function ensureBootstrap(): Promise<PlatformInfo> {
  if (platformCache && csrfToken) return platformCache
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      const res = await fetch('/api/bootstrap', { credentials: 'same-origin' })
      if (!res.ok) throw new Error(`Studio bootstrap failed (${res.status})`)
      const data = (await res.json()) as PlatformInfo & { csrfToken: string }
      csrfToken = data.csrfToken
      platformCache = {
        os: data.os,
        home: data.home,
        pathSeparator: data.pathSeparator,
        axNamespace: data.axNamespace || 'ax-system',
        version: data.version,
      }
      ensureEventStream()
      return platformCache
    })().finally(() => {
      bootstrapPromise = null
    })
  }
  return bootstrapPromise
}

async function apiGet<T>(path: string): Promise<T> {
  await ensureBootstrap()
  const res = await fetch(path, { credentials: 'same-origin' })
  if (res.status === 401) {
    csrfToken = ''
    platformCache = null
    await ensureBootstrap()
    const retry = await fetch(path, { credentials: 'same-origin' })
    if (!retry.ok) throw new Error(await extractError(retry))
    return (await retry.json()) as T
  }
  if (!res.ok) throw new Error(await extractError(res))
  return (await res.json()) as T
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  await ensureBootstrap()
  const send = () =>
    fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-AX-CSRF-Token': csrfToken,
      },
      body: JSON.stringify(body ?? {}),
    })
  let res = await send()
  if (res.status === 401 || res.status === 403) {
    csrfToken = ''
    platformCache = null
    await ensureBootstrap()
    res = await send()
  }
  if (!res.ok) throw new Error(await extractError(res))
  return (await res.json()) as T
}

async function extractError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string }
    if (body?.error) return body.error
  } catch {
    // Fallback to status text.
  }
  return `HTTP ${res.status} ${res.statusText}`
}

export const studioClient = {
  platform: () => ensureBootstrap(),

  run: async (req: RunRequest): Promise<CommandResult> => {
    try {
      return await apiPost<CommandResult>('/api/ax/exec', req)
    } catch (e) {
      return { status: 1, stdout: '', stderr: e instanceof Error ? e.message : String(e) }
    }
  },

  getEnvStatus: () => apiGet<EnvStatusResponse>('/api/env/status'),
  getDiagnostics: (context?: string) =>
    apiGet<{ diagnostics: string }>(`/api/env/diagnostics${context ? `?context=${encodeURIComponent(context)}` : ''}`),
  localUp: (name = 'ax-local', workers = 1, images: ImageOverrides = {}) =>
    apiPost<EnvOpSnapshot>('/api/env/local/up', { name, workers, ...images }),
  localStop: (name = 'ax-local') => apiPost<EnvOpSnapshot>('/api/env/local/stop', { name }),
  localDelete: (name = 'ax-local') => apiPost<EnvOpSnapshot>('/api/env/local/delete', { name }),
  remoteInstall: (context: string, images: ImageOverrides = {}) =>
    apiPost<EnvOpSnapshot>('/api/env/install', { context, ...images }),
  selectContext: (context: string) => apiPost<{ context: string }>('/api/env/context', { context }),

  createCredentialSecret: (req: { context: string; namespace?: string; name: string; key: string; value: string }) =>
    apiPost<{ namespace: string; name: string; key: string; credentialUri: string }>('/api/secrets/credential', req),

  getTaskChanges: (context: string, atespace: string, task: string) =>
    apiGet<TaskChangesResponse>(
      `/api/tasks/changes?context=${encodeURIComponent(context)}&atespace=${encodeURIComponent(atespace)}&task=${encodeURIComponent(task)}`
    ),
  discardTaskFile: (context: string, atespace: string, task: string, path: string) =>
    apiPost<{ discarded: string }>('/api/tasks/discard-file', { context, atespace, task, path }),
  applyTaskChangesLocal: (context: string, atespace: string, task: string, localRepoPath: string) =>
    apiPost<ApplyLocalResponse>('/api/tasks/apply-local', { context, atespace, task, localRepoPath }),
  pushTaskBranch: (context: string, atespace: string, task: string, branch?: string, commitMessage?: string) =>
    apiPost<PushBranchResponse>('/api/tasks/push-branch', { context, atespace, task, branch, commitMessage }),

  startSession: async (req: SessionRequest): Promise<void> => {
    await apiPost('/api/sessions/start', { id: req.id, args: req.args })
  },
  writeSession: async (id: string, data: string): Promise<void> => {
    await apiPost('/api/sessions/write', { id, data })
  },
  interruptSession: async (id: string): Promise<void> => {
    await apiPost('/api/sessions/interrupt', { id })
  },
  endSessionInput: async (id: string): Promise<void> => {
    await apiPost('/api/sessions/eof', { id })
  },
  closeSession: async (id: string): Promise<void> => {
    await apiPost('/api/sessions/close', { id })
  },

  onStreamLine: (cb: (l: StreamLine) => void) => {
    streamLineListeners.add(cb)
    return () => {
      streamLineListeners.delete(cb)
    }
  },
  onSessionData: (cb: (d: SessionData) => void) => {
    sessionDataListeners.add(cb)
    return () => {
      sessionDataListeners.delete(cb)
    }
  },
  onSessionExit: (cb: (e: StreamExit) => void) => {
    sessionExitListeners.add(cb)
    return () => {
      sessionExitListeners.delete(cb)
    }
  },
  onEnvOp: (cb: (op: EnvOpSnapshot) => void) => {
    envOpListeners.add(cb)
    return () => {
      envOpListeners.delete(cb)
    }
  },

  openYAMLFile: (): Promise<{ path: string; text: string } | null> =>
    new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.yaml,.yml'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file) {
          resolve(null)
          return
        }
        const text = await file.text()
        resolve({ path: file.name, text })
      }
      input.oncancel = () => resolve(null)
      input.click()
    }),

  saveYAMLFile: (name: string, text: string): string => {
    const blob = new Blob([text], { type: 'application/x-yaml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name.endsWith('.yaml') || name.endsWith('.yml') ? name : `${name}.yaml`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    return a.download
  },
}
