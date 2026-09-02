export type DockerTransportErrorCode =
  | 'ssh-disconnected'
  | 'transport-unsupported'
  | 'socket-forward-failed'
  | 'socket-not-found'
  | 'permission-denied'
  | 'daemon-unavailable'
  | 'proxy-closed'
  | 'request-failed'
  | 'request-timeout'
  | 'generation-stale'
  | 'container-not-found'
  | 'action-conflict'
  | 'container-not-running'
  | 'attach-protocol-error'
  | 'output-overflow'

export type DockerAvailability =
  | { status: 'available'; engineVersion: string; apiVersion: string }
  | {
      status: 'api-version-incompatible'
      engineVersion: string
      apiVersion: string
      requiredApiVersion: string
    }
  | { status: 'not-installed' }
  | { status: 'daemon-unavailable'; message: string }
  | { status: 'permission-denied'; message: string }
  | { status: 'transport-unsupported'; message: string }
  | { status: 'socket-forward-failed'; message: string }
  | { status: 'ssh-disconnected' }

export type DockerContainerAction = 'start' | 'stop' | 'restart'

export type DockerContainerActionResult = {
  action: DockerContainerAction
  containerId: string
  outcome: 'completed' | 'already-in-state'
}

export type DockerContainerActionIpcResponse =
  | { ok: true; result: DockerContainerActionResult }
  | { ok: false; code: DockerTransportErrorCode }

export type DockerContainerListFilters = {
  state?: 'all' | 'running' | 'stopped'
  search?: string
}

export type DockerContainerPort = {
  ip: string
  privatePort: number
  publicPort: number | null
  type: string
}

export type DockerContainerMount = {
  type: string
  name: string
  source: string
  destination: string
  mode: string
  rw: boolean
}

export type DockerContainerSummary = {
  id: string
  names: string[]
  displayName: string
  image: string
  imageId: string
  command: string
  created: number
  state: string
  status: string
  ports: DockerContainerPort[]
  mounts: DockerContainerMount[]
}

export type DockerContainerOverview = {
  id: string
  name: string
  displayName: string
  image: string
  imageId: string
  created: string
  path: string
  args: string[]
  state: {
    status: string
    running: boolean
    paused: boolean
    restarting: boolean
    startedAt: string
    finishedAt: string
    exitCode: number | null
    error: string
  }
  ports: DockerContainerPort[]
  mounts: DockerContainerMount[]
  networks: string[]
  restartPolicy: string
}

export type DockerContainerInspectResult = {
  overview: DockerContainerOverview
  inspectJson: string
}

export type DockerLogTail = 100 | 200 | 500 | 1000

export type DockerLogStreamKind = 'stdout' | 'stderr'

export type DockerLogEntry = {
  sequence: number
  stream: DockerLogStreamKind
  timestamp: string | null
  text: string
}

export type DockerLogStreamState =
  | 'connecting'
  | 'streaming'
  | 'ended'
  | 'disconnected'
  | 'error'

export type DockerLogStreamOptions = {
  tail: DockerLogTail
  follow: boolean
}

export type DockerLogStreamOptionsWithRequest = DockerLogStreamOptions & {
  requestId: string
}

export type DockerStartContainerLogsResult =
  | { ok: true; streamId: string; requestId: string }
  | { ok: false; code: DockerTransportErrorCode; requestId?: string }

export type DockerStopContainerLogsResult = { ok: true }

export type DockerContainerLogDataEvent = {
  streamId: string
  requestId: string
  entries: DockerLogEntry[]
  droppedFromMain: number
}

export type DockerContainerLogStateEvent = {
  streamId: string
  requestId: string
  state: DockerLogStreamState
  code?: DockerTransportErrorCode
}

export type DockerExecShell = 'bash' | 'sh'

export type DockerExecState =
  | 'connecting'
  | 'attached'
  | 'ended'
  | 'disconnected'
  | 'error'

export type DockerExecStartOptions = {
  shell: DockerExecShell
  requestId: string
  cols: number
  rows: number
}

export type DockerStartContainerExecResult =
  | { ok: true; terminalId: string; requestId: string }
  | { ok: false; code: DockerTransportErrorCode; requestId?: string }

export type DockerStopContainerExecResult = { ok: true }

export type DockerExecDataEvent = {
  requestId: string
  terminalId: string
  sequence: number
  data: ArrayBuffer
}

export type DockerExecStateEvent = {
  requestId: string
  terminalId: string | null
  state: DockerExecState
  code?: DockerTransportErrorCode
  exitCode?: number | null
}
