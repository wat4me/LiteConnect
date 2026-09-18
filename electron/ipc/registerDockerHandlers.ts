import { ipcMain } from 'electron'
import {
  isValidDockerContainerAction,
  isValidDockerContainerId,
  isValidDockerExecShell,
  isValidDockerExecSize,
  isValidDockerLogFollow,
  isValidDockerLogTail,
} from '../docker/containers'
import {
  isValidDockerExecRequestId,
  isValidDockerExecTerminalId,
  isValidDockerLogRequestId,
  isValidDockerLogStreamId,
  type DockerService,
} from '../docker/service'
import {
  DockerTransportError,
  DOCKER_EXEC_WRITE_MAX_BYTES,
  type DockerAvailability,
  type DockerContainerActionIpcResponse,
  type DockerContainerInspectResult,
  type DockerContainerSummary,
  type DockerExecShell,
  type DockerLogTail,
  type DockerStartContainerExecResult,
  type DockerStartContainerLogsResult,
  type DockerStopContainerExecResult,
  type DockerStopContainerLogsResult,
  type DockerTransportErrorCode,
} from '../docker/types'
import { isValidUUID } from '../utils/validation'

const CHANNEL_PROBE = 'docker:probe'
const CHANNEL_LIST = 'docker:list-containers'
const CHANNEL_INSPECT = 'docker:inspect-container'
const CHANNEL_ACTION = 'docker:container-action'
const CHANNEL_START_LOGS = 'docker:start-container-logs'
const CHANNEL_STOP_LOGS = 'docker:stop-container-logs'
const CHANNEL_START_EXEC = 'docker:start-container-exec'
const CHANNEL_WRITE_EXEC = 'docker:write-container-exec'
const CHANNEL_RESIZE_EXEC = 'docker:resize-container-exec'
const CHANNEL_STOP_EXEC = 'docker:stop-container-exec'

const CHANNELS = [
  CHANNEL_PROBE,
  CHANNEL_LIST,
  CHANNEL_INSPECT,
  CHANNEL_ACTION,
  CHANNEL_START_LOGS,
  CHANNEL_STOP_LOGS,
  CHANNEL_START_EXEC,
  CHANNEL_WRITE_EXEC,
  CHANNEL_RESIZE_EXEC,
  CHANNEL_STOP_EXEC,
] as const

function toStableErrorCode(err: unknown): DockerTransportErrorCode {
  if (err instanceof DockerTransportError) return err.code
  return 'request-failed'
}

/**
 * Docker IPC (DKR-MVP-002/004/005/006).
 * Renderer may only pass validated sessionId / containerId / action / log options — no socket path, API path, method, or timeout.
 */
export function registerDockerHandlers(dockerService: DockerService): void {
  for (const ch of CHANNELS) {
    try {
      ipcMain.removeHandler(ch)
    } catch {}
  }

  ipcMain.handle(CHANNEL_PROBE, async (_event, sessionId: unknown): Promise<DockerAvailability> => {
    if (!isValidUUID(sessionId as string)) {
      throw new Error('Invalid session id')
    }
    return dockerService.probe(sessionId as string)
  })

  ipcMain.handle(
    CHANNEL_LIST,
    async (_event, sessionId: unknown): Promise<DockerContainerSummary[]> => {
      if (!isValidUUID(sessionId as string)) {
        throw new Error('Invalid session id')
      }
      return dockerService.listContainers(sessionId as string)
    },
  )

  ipcMain.handle(
    CHANNEL_INSPECT,
    async (
      _event,
      sessionId: unknown,
      containerId: unknown,
    ): Promise<DockerContainerInspectResult> => {
      if (!isValidUUID(sessionId as string)) {
        throw new Error('Invalid session id')
      }
      if (!isValidDockerContainerId(containerId)) {
        throw new Error('Invalid container id')
      }
      return dockerService.inspectContainer(sessionId as string, containerId)
    },
  )

  ipcMain.handle(
    CHANNEL_ACTION,
    async (
      _event,
      sessionId: unknown,
      containerId: unknown,
      action: unknown,
    ): Promise<DockerContainerActionIpcResponse> => {
      if (!isValidUUID(sessionId as string)) {
        throw new Error('Invalid session id')
      }
      if (!isValidDockerContainerId(containerId)) {
        throw new Error('Invalid container id')
      }
      if (!isValidDockerContainerAction(action)) {
        throw new Error('Invalid container action')
      }
      try {
        const result = await dockerService.containerAction(
          sessionId as string,
          containerId,
          action,
        )
        return { ok: true, result }
      } catch (err) {
        return { ok: false, code: toStableErrorCode(err) }
      }
    },
  )

  /**
   * Start container logs. Only sessionId + containerId + {tail, follow, requestId}.
   * requestId correlates early events; streamId generated in main.
   */
  ipcMain.handle(
    CHANNEL_START_LOGS,
    async (
      event,
      sessionId: unknown,
      containerId: unknown,
      options: unknown,
    ): Promise<DockerStartContainerLogsResult> => {
      if (!isValidUUID(sessionId as string)) {
        throw new Error('Invalid session id')
      }
      if (!isValidDockerContainerId(containerId)) {
        throw new Error('Invalid container id')
      }
      const opts = options && typeof options === 'object' ? (options as Record<string, unknown>) : null
      if (
        !opts ||
        !isValidDockerLogTail(opts.tail) ||
        !isValidDockerLogFollow(opts.follow) ||
        !isValidDockerLogRequestId(opts.requestId)
      ) {
        throw new Error('Invalid log options')
      }
      const requestId = opts.requestId as string
      try {
        const streamId = await dockerService.startContainerLogs(
          event.sender,
          sessionId as string,
          containerId,
          {
            tail: opts.tail as DockerLogTail,
            follow: opts.follow as boolean,
            requestId,
          },
        )
        return { ok: true, streamId, requestId }
      } catch (err) {
        return { ok: false, code: toStableErrorCode(err), requestId }
      }
    },
  )

  ipcMain.handle(
    CHANNEL_STOP_LOGS,
    async (event, streamId: unknown): Promise<DockerStopContainerLogsResult> => {
      if (!isValidDockerLogStreamId(streamId)) {
        throw new Error('Invalid stream id')
      }
      const ok = dockerService.stopContainerLogs(event.sender, streamId)
      if (!ok) {
        throw new Error('Invalid stream owner')
      }
      return { ok: true }
    },
  )

  /**
   * Start container exec. sessionId + containerId + {shell, requestId, cols, rows} only.
   * No Cmd array, User, Env, path, or method from renderer.
   */
  ipcMain.handle(
    CHANNEL_START_EXEC,
    async (
      event,
      sessionId: unknown,
      containerId: unknown,
      options: unknown,
    ): Promise<DockerStartContainerExecResult> => {
      if (!isValidUUID(sessionId as string)) {
        throw new Error('Invalid session id')
      }
      if (!isValidDockerContainerId(containerId)) {
        throw new Error('Invalid container id')
      }
      const opts = options && typeof options === 'object' ? (options as Record<string, unknown>) : null
      if (
        !opts ||
        !isValidDockerExecShell(opts.shell) ||
        !isValidDockerExecRequestId(opts.requestId) ||
        !isValidDockerExecSize(opts.cols) ||
        !isValidDockerExecSize(opts.rows)
      ) {
        throw new Error('Invalid exec options')
      }
      const requestId = opts.requestId as string
      try {
        const terminalId = await dockerService.startContainerExec(
          event.sender,
          sessionId as string,
          containerId,
          {
            shell: opts.shell as DockerExecShell,
            requestId,
            cols: opts.cols as number,
            rows: opts.rows as number,
          },
        )
        return { ok: true, terminalId, requestId }
      } catch (err) {
        return { ok: false, code: toStableErrorCode(err), requestId }
      }
    },
  )

  ipcMain.handle(
    CHANNEL_WRITE_EXEC,
    async (event, terminalId: unknown, data: unknown): Promise<{ ok: boolean }> => {
      if (!isValidDockerExecTerminalId(terminalId)) {
        throw new Error('Invalid terminal id')
      }
      if (typeof data !== 'string') {
        throw new Error('Invalid write payload')
      }
      if (Buffer.byteLength(data, 'utf8') > DOCKER_EXEC_WRITE_MAX_BYTES) {
        throw new Error('Write payload too large')
      }
      const ok = dockerService.writeContainerExec(event.sender, terminalId, data)
      return { ok }
    },
  )

  ipcMain.handle(
    CHANNEL_RESIZE_EXEC,
    async (
      event,
      terminalId: unknown,
      cols: unknown,
      rows: unknown,
    ): Promise<{ ok: boolean }> => {
      if (!isValidDockerExecTerminalId(terminalId)) {
        throw new Error('Invalid terminal id')
      }
      if (!isValidDockerExecSize(cols) || !isValidDockerExecSize(rows)) {
        throw new Error('Invalid exec size')
      }
      const ok = await dockerService.resizeContainerExec(
        event.sender,
        terminalId,
        cols as number,
        rows as number,
      )
      return { ok }
    },
  )

  ipcMain.handle(
    CHANNEL_STOP_EXEC,
    async (event, terminalId: unknown): Promise<DockerStopContainerExecResult> => {
      if (!isValidDockerExecTerminalId(terminalId)) {
        throw new Error('Invalid terminal id')
      }
      const ok = dockerService.stopContainerExec(event.sender, terminalId)
      if (!ok) {
        throw new Error('Invalid terminal owner')
      }
      return { ok: true }
    },
  )
}

export function unregisterDockerHandlers(): void {
  for (const ch of CHANNELS) {
    try {
      ipcMain.removeHandler(ch)
    } catch {}
  }
}
