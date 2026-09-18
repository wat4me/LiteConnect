/**
 * Incremental Docker container log HTTP stream over loopback proxy.
 * Does not use dockerHttpRequest (full-body); destroys socket on stop.
 */

import * as net from 'net'
import { classifyStreamLocalError } from './errorClassify'
import { isAllowedDockerApiRequest } from './containers'
import {
  IncrementalHttpResponseParser,
  HttpStreamParseError,
} from './logHttpParser'
import {
  DockerMultiplexDemux,
  DockerMuxParseError,
  DockerRawLogStream,
  type DockerStreamDemux,
} from './logMultiplex'
import { DualStreamLogAssembler } from './logText'
import { DOCKER_PROXY_ERROR_HEADER } from './transport'
import {
  DOCKER_LOG_START_TIMEOUT_MS,
  DockerTransportError,
  type DockerLogEntry,
  type DockerLogStreamState,
  type DockerProxyEndpoint,
  type DockerTransportErrorCode,
} from './types'

export type LogStreamFinalReason =
  | 'ended'
  | 'stopped'
  | 'disconnected'
  | 'error'

export type ActiveLogStreamCallbacks = {
  onEntries: (entries: DockerLogEntry[]) => void
  onState: (state: DockerLogStreamState, code?: DockerTransportErrorCode) => void
}

export type StartLogStreamParams = {
  endpoint: DockerProxyEndpoint
  apiPath: string
  /** When true, demux multiplex headers; when false, treat body as raw TTY stream. */
  tty: boolean
  isLive: () => boolean
  callbacks: ActiveLogStreamCallbacks
  startTimeoutMs?: number
}

export type ActiveLogStreamHandle = {
  destroy: (reason: LogStreamFinalReason, code?: DockerTransportErrorCode) => void
}

function isDockerErrorCode(value: string): value is DockerTransportErrorCode {
  return (
    value === 'ssh-disconnected' ||
    value === 'transport-unsupported' ||
    value === 'socket-forward-failed' ||
    value === 'socket-not-found' ||
    value === 'permission-denied' ||
    value === 'daemon-unavailable' ||
    value === 'proxy-closed' ||
    value === 'request-failed' ||
    value === 'request-timeout' ||
    value === 'generation-stale' ||
    value === 'container-not-found' ||
    value === 'action-conflict' ||
    value === 'container-not-running' ||
    value === 'attach-protocol-error' ||
    value === 'output-overflow'
  )
}

function mapHttpStatus(status: number): DockerTransportErrorCode {
  if (status === 404) return 'container-not-found'
  if (status === 401 || status === 403) return 'permission-denied'
  if (status === 409) return 'action-conflict'
  return 'request-failed'
}

/**
 * Map headers after parse: proxy stable code wins over HTTP status.
 * Never includes response body text.
 */
export function mapLogResponseHeaders(
  statusCode: number,
  headers: Record<string, string>,
): DockerTransportErrorCode | null {
  if (statusCode < 400) return null
  const proxyErr = headers[DOCKER_PROXY_ERROR_HEADER.toLowerCase()]
  if (proxyErr && isDockerErrorCode(proxyErr)) {
    return proxyErr
  }
  return mapHttpStatus(statusCode)
}

/**
 * Open a streaming GET for container logs. Emits entries incrementally.
 * Start timeout covers connect + headers only; follow is not killed by idle timer.
 */
export function startDockerLogHttpStream(params: StartLogStreamParams): ActiveLogStreamHandle {
  const {
    endpoint,
    apiPath,
    tty,
    isLive,
    callbacks,
    startTimeoutMs = DOCKER_LOG_START_TIMEOUT_MS,
  } = params

  if (!isAllowedDockerApiRequest('GET', apiPath)) {
    throw new DockerTransportError(
      'request-failed',
      'Docker API method/path not allowed',
      endpoint.sessionId,
    )
  }

  let settled = false
  let headersReady = false
  let socket: net.Socket | null = null
  const httpParser = new IncrementalHttpResponseParser()
  const demux: DockerStreamDemux = tty ? new DockerRawLogStream() : new DockerMultiplexDemux()
  const lines = new DualStreamLogAssembler()

  const finish = (reason: LogStreamFinalReason, code?: DockerTransportErrorCode) => {
    if (settled) return
    settled = true
    clearTimeout(startTimer)
    try {
      socket?.destroy()
    } catch {}
    socket = null
    if (reason === 'ended') {
      callbacks.onState('ended')
    } else if (reason === 'stopped') {
      callbacks.onState('disconnected')
    } else if (reason === 'disconnected') {
      callbacks.onState('disconnected', code)
    } else {
      callbacks.onState('error', code || 'request-failed')
    }
  }

  const emitFrames = (chunk: Buffer): boolean => {
    let frames
    try {
      frames = demux.push(chunk)
    } catch (err) {
      if (err instanceof DockerMuxParseError) {
        finish('error', 'request-failed')
        return false
      }
      finish('error', 'request-failed')
      return false
    }
    const entries: DockerLogEntry[] = []
    for (const f of frames) {
      entries.push(...lines.push(f.stream, f.payload))
    }
    if (entries.length) callbacks.onEntries(entries)
    return true
  }

  /** Clean EOF only: demux complete then flush partial text lines. */
  const finishCleanEnded = (): void => {
    try {
      demux.end()
    } catch {
      finish('error', 'request-failed')
      return
    }
    const rest = lines.flush()
    if (rest.length) callbacks.onEntries(rest)
    finish('ended')
  }

  const startTimer = setTimeout(() => {
    if (!headersReady && !settled) {
      finish('error', 'request-timeout')
    }
  }, startTimeoutMs)

  callbacks.onState('connecting')

  try {
    socket = net.connect({ host: endpoint.localHost, port: endpoint.localPort }, () => {
      if (settled || !isLive()) {
        finish('disconnected', 'generation-stale')
        return
      }
      const head =
        `GET ${apiPath} HTTP/1.1\r\n` +
        `Host: localhost\r\n` +
        `Connection: close\r\n` +
        `Accept: application/vnd.docker.raw-stream, application/octet-stream, */*\r\n` +
        `\r\n`
      try {
        socket!.write(head)
      } catch {
        finish('error', 'request-failed')
      }
    })
  } catch (err) {
    const c = classifyStreamLocalError(err, endpoint.sessionId)
    finish('error', c.code)
    return {
      destroy: (reason, code) => finish(reason, code),
    }
  }

  socket.on('data', (raw: Buffer) => {
    if (settled) return
    if (!isLive()) {
      finish('disconnected', 'generation-stale')
      return
    }
    try {
      const result = httpParser.push(raw)
      if (result.headers && !headersReady) {
        headersReady = true
        clearTimeout(startTimer)
        if (result.httpError || result.headers.statusCode >= 400) {
          const code = mapLogResponseHeaders(
            result.headers.statusCode,
            result.headers.headers,
          )
          finish('error', code || 'request-failed')
          return
        }
        callbacks.onState('streaming')
      }
      if (result.httpError) return
      for (const part of result.bodyChunks) {
        if (!emitFrames(part)) return
      }
      if (result.complete && !settled) {
        finishCleanEnded()
      }
    } catch (err) {
      if (err instanceof HttpStreamParseError) {
        finish('error', 'request-failed')
        return
      }
      finish('error', 'request-failed')
    }
  })

  socket.on('error', (err) => {
    if (settled) return
    const c = classifyStreamLocalError(err, endpoint.sessionId)
    if (!headersReady) {
      finish('error', c.code)
    } else {
      finish('disconnected', c.code)
    }
  })

  socket.on('end', () => {
    if (settled) return
    try {
      const result = httpParser.end()
      if (result.httpError && result.headers) {
        const code = mapLogResponseHeaders(
          result.headers.statusCode,
          result.headers.headers,
        )
        finish('error', code || 'request-failed')
        return
      }
      for (const part of result.bodyChunks) {
        if (!emitFrames(part)) return
      }
      finishCleanEnded()
    } catch (err) {
      // Truncated/malformed HTTP → error, never fake ended
      if (err instanceof HttpStreamParseError) {
        finish('error', 'request-failed')
        return
      }
      finish('error', 'request-failed')
    }
  })

  socket.on('close', () => {
    if (settled) return
    if (!headersReady) {
      finish('error', 'proxy-closed')
    } else {
      // Unexpected close without clean HTTP end → disconnected (not fake ended)
      finish('disconnected')
    }
  })

  return {
    destroy: (reason, code) => finish(reason, code),
  }
}
