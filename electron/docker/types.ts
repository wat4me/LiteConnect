/** Fixed remote Docker Engine socket for MVP (not configurable from renderer). */
export const DOCKER_SOCKET_PATH = '/var/run/docker.sock' as const

export type DockerTransportErrorCode =
  | 'ssh-disconnected'
  | 'transport-unsupported'
  /** StreamLocal channel opened but remote connect to docker.sock failed (SELinux/sshd policy/path). */
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
  /** Container exists but is not running (or is paused) for interactive exec. */
  | 'container-not-running'
  /** Attach upgrade/streaming handshake failed or malformed. */
  | 'attach-protocol-error'
  /** Main output queue hard limit reached (TTY bytes cannot be silently dropped). */
  | 'output-overflow'

export class DockerTransportError extends Error {
  readonly code: DockerTransportErrorCode
  readonly sessionId?: string

  constructor(code: DockerTransportErrorCode, message: string, sessionId?: string) {
    super(message)
    this.name = 'DockerTransportError'
    this.code = code
    this.sessionId = sessionId
  }
}

/**
 * Stable Docker availability result for renderer (DKR-MVP-002).
 * UI must branch on `status`, never parse English OS/daemon text.
 */
export type DockerAvailability =
  | { status: 'available'; engineVersion: string; apiVersion: string }
  /** The daemon API is conclusively below the feature set used by this MVP. */
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
  /** SSH can forward, but cannot open /var/run/docker.sock (not the same as daemon down). */
  | { status: 'socket-forward-failed'; message: string }
  | { status: 'ssh-disconnected' }

/** Whitelist container lifecycle actions only (start | stop | restart). */
export type DockerContainerAction = 'start' | 'stop' | 'restart'

/** Stable action result for renderer (branch on outcome/code, never English body text). */
export type DockerContainerActionResult = {
  action: DockerContainerAction
  containerId: string
  outcome: 'completed' | 'already-in-state'
}

/**
 * IPC response for container actions — preserves stable error codes across process boundary.
 * Renderer maps `code` to i18n; never parses English messages for business state.
 */
export type DockerContainerActionIpcResponse =
  | { ok: true; result: DockerContainerActionResult }
  | { ok: false; code: DockerTransportErrorCode }

/** Fixed stop/restart grace period (seconds) for Docker Engine query `t=`. Main-process only. */
export const DOCKER_STOP_TIMEOUT_SEC = 10 as const

/** HTTP client upper bound for container actions (ms). Renderer cannot override. */
export const DOCKER_ACTION_HTTP_TIMEOUT_MS = 60_000 as const

/** Structured list filters only — no arbitrary Docker API filters from renderer. */
export type DockerContainerListFilters = {
  /** all | running | stopped (stopped maps to exited+created+dead on server side later) */
  state?: 'all' | 'running' | 'stopped'
  /** Match against container name or image (main-process applies). */
  search?: string
}

/** Published / exposed port summary for list + detail. */
export type DockerContainerPort = {
  ip: string
  privatePort: number
  publicPort: number | null
  type: string
}

/** Mount summary (source/destination only — no secrets). */
export type DockerContainerMount = {
  type: string
  name: string
  source: string
  destination: string
  mode: string
  rw: boolean
}

/**
 * Normalized container list row (DKR-MVP-004).
 * Built only in main process from Docker Engine API — never free-form renderer input.
 */
export type DockerContainerSummary = {
  id: string
  names: string[]
  /** Primary display name with leading `/` stripped. */
  displayName: string
  image: string
  imageId: string
  command: string
  /** Unix seconds (Docker list Created). */
  created: number
  state: string
  status: string
  ports: DockerContainerPort[]
  mounts: DockerContainerMount[]
}

/** Overview fields for detail panel (no lifecycle actions). */
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

/**
 * Inspect result for UI: structured overview + pretty JSON for readonly Inspect tab.
 * Never log overview secrets or inspectJson in application/error logs.
 */
export type DockerContainerInspectResult = {
  overview: DockerContainerOverview
  /** Pretty-printed JSON for readonly search/copy UI only. */
  inspectJson: string
}

/** Max search string length accepted via IPC (if filters ever applied server-side). */
export const DOCKER_SEARCH_MAX_CHARS = 200

/**
 * Docker container id or name for path construction.
 * Hex id (short/full) or name-like token; no slashes, spaces, or traversal.
 */
export const DOCKER_CONTAINER_ID_MAX_LEN = 128
export const DOCKER_CONTAINER_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/

/** Loopback-only proxy endpoint (never expose port to renderer). */
export type DockerProxyEndpoint = {
  sessionId: string
  generation: number
  localHost: '127.0.0.1'
  localPort: number
}

export type DockerVersionInfo = {
  Version?: string
  ApiVersion?: string
  MinAPIVersion?: string
  Os?: string
  Arch?: string
  [key: string]: unknown
}

/**
 * Controlled Docker socket channel opener (does not expose sessions Map).
 * Docker-owned hosts prefer StreamLocal and may use a fixed nc -U fallback.
 * DockerSocketTransport must not receive arbitrary shell commands.
 */
export type StreamLocalChannelOpener = {
  hasSession(sessionId: string): boolean
  getSessionGeneration(sessionId: string): number
  openStreamLocal(
    sessionId: string,
    remoteSocketPath: string,
    generation: number,
  ): Promise<NodeJS.ReadWriteStream>
  /**
   * Preferred entry for Docker proxy accepts: StreamLocal first, fixed nc fallback when eligible.
   * Optional for unit fakes that only implement openStreamLocal (transport falls back).
   */
  openDockerSocketChannel?(
    sessionId: string,
    generation: number,
  ): Promise<NodeJS.ReadWriteStream>
  registerSessionTeardownHook(hook: (sessionId: string) => void): () => void
}

/**
 * Presence of Docker Engine binaries on the remote host.
 * Used only when socket is missing to avoid mislabeling "daemon down" as "not installed".
 * - installed: fixed binary/path evidence found
 * - not-installed: fixed check confirmed binaries absent
 * - unknown: check failed, timed out, or generation stale mid-check
 */
export type DockerInstallationPresence = 'installed' | 'not-installed' | 'unknown'

/**
 * Minimal installation-check contract for DockerService.
 * Must use hard-coded main-process commands only; no renderer-supplied shell/path.
 */
export type DockerInstallationChecker = {
  checkDockerInstallation(
    sessionId: string,
    generation: number,
  ): Promise<DockerInstallationPresence>
}

/** Host surface DockerService needs: StreamLocal + optional install check. */
export type DockerSessionHost = StreamLocalChannelOpener & DockerInstallationChecker & {
  /** Releases Docker-owned session hook/state when its owning service is disposed. */
  dispose?: () => void
}

/** Fixed log tail sizes accepted from renderer (main constructs query). */
export const DOCKER_LOG_TAILS = [100, 200, 500, 1000] as const
export type DockerLogTail = (typeof DOCKER_LOG_TAILS)[number]

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

/**
 * Renderer-generated correlation id for start handshake (32 lowercase hex).
 * Events carry requestId so early data/state is accepted before streamId returns.
 */
export const DOCKER_LOG_REQUEST_ID_RE = /^[a-f0-9]{32}$/

export type DockerLogStreamOptionsWithRequest = DockerLogStreamOptions & {
  requestId: string
}

/** Start logs IPC result — streamId only after main owns a live stream. */
export type DockerStartContainerLogsResult =
  | { ok: true; streamId: string; requestId: string }
  | { ok: false; code: DockerTransportErrorCode; requestId?: string }

export type DockerStopContainerLogsResult = { ok: true }

/** Batched log lines for renderer (never log body in main/app logs). */
export type DockerContainerLogDataEvent = {
  streamId: string
  requestId: string
  entries: DockerLogEntry[]
  /** Main queue drops included in this batch (since last data event). */
  droppedFromMain: number
}

export type DockerContainerLogStateEvent = {
  streamId: string
  requestId: string
  state: DockerLogStreamState
  /** Present when state is error (stable code only; no HTTP body). */
  code?: DockerTransportErrorCode
}

/** Hard limits for log stream safety (main + parsers). */
export const DOCKER_LOG_MAX_FRAME_BYTES = 1_048_576 as const
export const DOCKER_LOG_MAIN_QUEUE_MAX_ENTRIES = 2_000 as const
export const DOCKER_LOG_MAIN_QUEUE_MAX_CHARS = 512_000 as const
export const DOCKER_LOG_BATCH_FLUSH_MS = 50 as const
/** Connect + headers only; follow streams are not killed by a fixed total timeout. */
export const DOCKER_LOG_START_TIMEOUT_MS = 15_000 as const

/** Unpredictable stream id: 32 lowercase hex chars. */
export const DOCKER_LOG_STREAM_ID_RE = /^[a-f0-9]{32}$/

// ─── Container interactive exec (DKR-MVP-007) ───────────────────────────────

/** Shell enum only — main maps to fixed absolute paths. */
export type DockerExecShell = 'bash' | 'sh'

export type DockerExecState =
  | 'connecting'
  | 'attached'
  | 'ended'
  | 'disconnected'
  | 'error'

/** Renderer-generated correlation id (32 lowercase hex). */
export const DOCKER_EXEC_REQUEST_ID_RE = /^[a-f0-9]{32}$/

/** Main-issued terminal id (32 lowercase hex); not the daemon exec id. */
export const DOCKER_EXEC_TERMINAL_ID_RE = /^[a-f0-9]{32}$/

/**
 * Daemon exec id from Docker create response (trusted main-only).
 * Hex short/full; no path/query characters.
 */
export const DOCKER_DAEMON_EXEC_ID_MAX_LEN = 64
export const DOCKER_DAEMON_EXEC_ID_RE = /^[a-f0-9]{8,64}$/

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
  /** Raw TTY bytes (UTF-8 / control sequences); not pre-decoded to JS string. */
  data: ArrayBuffer
}

export type DockerExecStateEvent = {
  requestId: string
  terminalId: string | null
  state: DockerExecState
  code?: DockerTransportErrorCode
  exitCode?: number | null
}

/** Resize bounds (renderer + main). */
export const DOCKER_EXEC_RESIZE_MIN = 1 as const
export const DOCKER_EXEC_RESIZE_MAX = 1000 as const

/** Single write payload hard limit (bytes). */
export const DOCKER_EXEC_WRITE_MAX_BYTES = 64 * 1024 as const

/** Main pending output queue hard limit (bytes) — overflow closes terminal. */
export const DOCKER_EXEC_OUTPUT_QUEUE_MAX_BYTES = 2 * 1024 * 1024 as const

/** Main pending input write queue hard limit (bytes). */
export const DOCKER_EXEC_INPUT_QUEUE_MAX_BYTES = 256 * 1024 as const

/** Batch flush interval for exec data IPC. */
export const DOCKER_EXEC_BATCH_FLUSH_MS = 16 as const

/** Create + attach handshake timeout (ms). */
export const DOCKER_EXEC_START_TIMEOUT_MS = 20_000 as const

/** Resize HTTP timeout (ms). */
export const DOCKER_EXEC_RESIZE_TIMEOUT_MS = 5_000 as const

/** Inspect exec HTTP timeout (ms). */
export const DOCKER_EXEC_INSPECT_TIMEOUT_MS = 5_000 as const
