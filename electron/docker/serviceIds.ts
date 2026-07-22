import {
  DOCKER_EXEC_REQUEST_ID_RE,
  DOCKER_EXEC_TERMINAL_ID_RE,
  DOCKER_LOG_REQUEST_ID_RE,
  DOCKER_LOG_STREAM_ID_RE,
} from './types'

export function isValidDockerLogStreamId(id: unknown): id is string {
  return typeof id === 'string' && DOCKER_LOG_STREAM_ID_RE.test(id)
}

export function isValidDockerLogRequestId(id: unknown): id is string {
  return typeof id === 'string' && DOCKER_LOG_REQUEST_ID_RE.test(id)
}

export function isValidDockerExecTerminalId(id: unknown): id is string {
  return typeof id === 'string' && DOCKER_EXEC_TERMINAL_ID_RE.test(id)
}

export function isValidDockerExecRequestId(id: unknown): id is string {
  return typeof id === 'string' && DOCKER_EXEC_REQUEST_ID_RE.test(id)
}
