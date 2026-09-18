import type { DockerTransportErrorCode } from '../../shared/types/docker'

export type {
  DockerAvailability,
  DockerContainerAction,
  DockerContainerActionIpcResponse,
  DockerContainerActionResult,
  DockerContainerInspectResult,
  DockerContainerListFilters,
  DockerContainerLogDataEvent,
  DockerContainerLogStateEvent,
  DockerContainerMount,
  DockerContainerOverview,
  DockerContainerPort,
  DockerContainerSummary,
  DockerExecDataEvent,
  DockerExecShell,
  DockerExecStartOptions,
  DockerExecState,
  DockerExecStateEvent,
  DockerLogEntry,
  DockerLogStreamKind,
  DockerLogStreamOptions,
  DockerLogStreamOptionsWithRequest,
  DockerLogStreamState,
  DockerLogTail,
  DockerStartContainerExecResult,
  DockerStartContainerLogsResult,
  DockerStopContainerExecResult,
  DockerStopContainerLogsResult,
  DockerTransportErrorCode,
} from '../../shared/types/docker'

/** Fixed remote Docker Engine socket for MVP (not configurable from renderer). */
export const DOCKER_SOCKET_PATH = '/var/run/docker.sock' as const

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

/** Fixed stop/restart grace period (seconds) for Docker Engine query `t=`. Main-process only. */
export const DOCKER_STOP_TIMEOUT_SEC = 10 as const

/** HTTP client upper bound for container actions (ms). Renderer cannot override. */
export const DOCKER_ACTION_HTTP_TIMEOUT_MS = 60_000 as const

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

/**
 * SSH capabilities the Docker adapter may call. Docker must not import SSHManager.
 * `SSHManager` is structurally assignable (wired in `electron/main.ts`).
 */
export type DockerSshBackend = {
  hasSession(sessionId: string): boolean
  getSessionGeneration(sessionId: string): number
  registerSessionTeardownHook(hook: (sessionId: string) => void): () => void
  openStreamLocal(
    sessionId: string,
    path: string,
    generation: number,
  ): Promise<NodeJS.ReadWriteStream>
  executeSessionCommand(
    sessionId: string,
    command: string,
    generation: number,
    timeoutMs: number,
  ): Promise<string>
  openExecChannel(
    sessionId: string,
    command: string,
    generation: number,
    onOpened?: (channel: NodeJS.ReadWriteStream) => void,
  ): Promise<NodeJS.ReadWriteStream>
}

/** Fixed log tail sizes accepted from renderer (main constructs query). */
export const DOCKER_LOG_TAILS = [100, 200, 500, 1000] as const

export const DOCKER_LOG_REQUEST_ID_RE = /^[a-f0-9]{32}$/

export const DOCKER_LOG_MAX_FRAME_BYTES = 1_048_576 as const
export const DOCKER_LOG_MAIN_QUEUE_MAX_ENTRIES = 2_000 as const
export const DOCKER_LOG_MAIN_QUEUE_MAX_CHARS = 512_000 as const
export const DOCKER_LOG_BATCH_FLUSH_MS = 50 as const
export const DOCKER_LOG_START_TIMEOUT_MS = 15_000 as const
export const DOCKER_LOG_STREAM_ID_RE = /^[a-f0-9]{32}$/

export const DOCKER_EXEC_REQUEST_ID_RE = /^[a-f0-9]{32}$/
export const DOCKER_EXEC_TERMINAL_ID_RE = /^[a-f0-9]{32}$/

export const DOCKER_DAEMON_EXEC_ID_MAX_LEN = 64
export const DOCKER_DAEMON_EXEC_ID_RE = /^[a-f0-9]{8,64}$/

export const DOCKER_EXEC_RESIZE_MIN = 1 as const
export const DOCKER_EXEC_RESIZE_MAX = 1000 as const
export const DOCKER_EXEC_WRITE_MAX_BYTES = 64 * 1024 as const
export const DOCKER_EXEC_OUTPUT_QUEUE_MAX_BYTES = 2 * 1024 * 1024 as const
export const DOCKER_EXEC_INPUT_QUEUE_MAX_BYTES = 256 * 1024 as const
export const DOCKER_EXEC_BATCH_FLUSH_MS = 16 as const
export const DOCKER_EXEC_START_TIMEOUT_MS = 20_000 as const
export const DOCKER_EXEC_RESIZE_TIMEOUT_MS = 5_000 as const
export const DOCKER_EXEC_INSPECT_TIMEOUT_MS = 5_000 as const
