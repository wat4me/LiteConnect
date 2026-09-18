import type { WebContents } from 'electron'
import type { ActiveExecAttachHandle } from './execStream'
import type { ActiveLogStreamHandle } from './logStream'
import type { DockerSocketTransport } from './transport'
import type {
  DockerAvailability,
  DockerContainerAction,
  DockerContainerActionResult,
  DockerExecShell,
  DockerInstallationChecker,
  DockerLogEntry,
  DockerProxyEndpoint,
  DockerTransportError,
  StreamLocalChannelOpener,
} from './types'

export const CHANNEL_LOG_DATA = 'docker:container-log-data'
export const CHANNEL_LOG_STATE = 'docker:container-log-state'
export const CHANNEL_EXEC_DATA = 'docker:container-exec-data'
export const CHANNEL_EXEC_STATE = 'docker:container-exec-state'

export type OwnedLogStream = {
  streamId: string
  requestId: string
  sessionId: string
  generation: number
  containerId: string
  owner: WebContents
  handle: ActiveLogStreamHandle | null
  closed: boolean
  finalStateSent: boolean
  queue: DockerLogEntry[]
  queueChars: number
  /** Main queue drops not yet reported to renderer. */
  pendingDroppedFromMain: number
  batchTimer: ReturnType<typeof setTimeout> | null
  destroyedListener: (() => void) | null
}

export type OwnedExecTerminal = {
  terminalId: string
  requestId: string
  sessionId: string
  generation: number
  containerId: string
  daemonExecId: string
  shell: DockerExecShell
  owner: WebContents
  handle: ActiveExecAttachHandle | null
  closed: boolean
  finalStateSent: boolean
  sequence: number
  /** Pending output chunks (raw bytes) before IPC flush. */
  outQueue: Buffer[]
  outQueueBytes: number
  batchTimer: ReturnType<typeof setTimeout> | null
  /** Last resize dims sent (dedupe). */
  lastCols: number
  lastRows: number
  /** Pending input bytes waiting on socket backpressure. */
  inQueueBytes: number
  destroyedListener: (() => void) | null
}

/**
 * Shared surface domain helpers use against DockerService state.
 * Maps and host/transport refs plus generation/transport helpers.
 */
export type DockerServiceContext = {
  readonly opener: StreamLocalChannelOpener
  readonly installChecker: DockerInstallationChecker | null
  readonly transport: DockerSocketTransport
  readonly probeInflight: Map<string, Promise<DockerAvailability>>
  readonly actionInflight: Map<
    string,
    { action: DockerContainerAction; promise: Promise<DockerContainerActionResult> }
  >
  readonly logStreams: Map<string, OwnedLogStream>
  readonly logOwnerIndex: Map<string, string>
  readonly execTerminals: Map<string, OwnedExecTerminal>
  readonly execOwnerIndex: Map<number, string>
  ensureTransport(sessionId: string): Promise<DockerProxyEndpoint>
  isGenerationLive(sessionId: string, generation: number): boolean
  isEndpointLive(sessionId: string, generation: number): boolean
  wrap(err: unknown, sessionId: string): DockerTransportError
}

export function probeKey(sessionId: string, generation: number): string {
  return `${sessionId}:${generation}`
}

export function actionKey(sessionId: string, generation: number, containerId: string): string {
  return `${sessionId}:${generation}:${containerId}`
}

export function logOwnerKey(owner: WebContents, sessionId: string, containerId: string): string {
  return `${owner.id}:${sessionId}:${containerId}`
}
