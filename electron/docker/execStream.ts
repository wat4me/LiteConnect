/**
 * Docker exec attach hijack stream over loopback proxy.
 * Tty=true raw byte stream — never uses log multiplex parser.
 * Does not use dockerHttpRequest (full-body wait).
 */

import * as net from 'net'
import { isAllowedDockerApiRequest } from './containers'
import { classifyStreamLocalError } from './errorClassify'
import { DOCKER_PROXY_ERROR_HEADER } from './transport'
import {
  DOCKER_EXEC_START_TIMEOUT_MS,
  DockerTransportError,
  type DockerProxyEndpoint,
  type DockerTransportErrorCode,
} from './types'

export type ExecAttachFinalReason =
  | 'ended'
  | 'stopped'
  | 'disconnected'
  | 'error'

export type ActiveExecAttachCallbacks = {
  onData: (chunk: Buffer) => void
  onState: (
    state: 'connecting' | 'attached' | 'ended' | 'disconnected' | 'error',
    code?: DockerTransportErrorCode,
  ) => void
}

export type StartExecAttachParams = {
  endpoint: DockerProxyEndpoint
  /** POST /exec/{id}/start */
  apiPath: string
  body: string
  isLive: () => boolean
  callbacks: ActiveExecAttachCallbacks
  startTimeoutMs?: number
}

export type ActiveExecAttachHandle = {
  write: (data: Buffer | string) => boolean
  destroy: (reason: ExecAttachFinalReason, code?: DockerTransportErrorCode) => void
  pendingWriteBytes: () => number
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
  if (status === 409) return 'container-not-running'
  return 'request-failed'
}

/**
 * Map attach response headers: proxy stable code wins.
 * Accept 101 Switching Protocols and 200 OK streaming responses.
 * Never includes response body text.
 */
export function mapExecAttachResponseHeaders(
  statusCode: number,
  headers: Record<string, string>,
): DockerTransportErrorCode | null {
  const proxyErr = headers[DOCKER_PROXY_ERROR_HEADER.toLowerCase()]
  if (proxyErr && isDockerErrorCode(proxyErr)) {
    return proxyErr
  }
  if (statusCode === 101 || (statusCode >= 200 && statusCode < 300)) {
    return null
  }
  return mapHttpStatus(statusCode)
}

export function isSuccessfulExecAttachStatus(statusCode: number): boolean {
  return statusCode === 101 || (statusCode >= 200 && statusCode < 300)
}

export type HijackHeaderParseResult =
  | { complete: false }
  | {
      complete: true
      statusCode: number
      headers: Record<string, string>
      /** Terminal bytes that arrived in the same chunk after header terminator. */
      remainder: Buffer
    }

/**
 * Incremental HTTP response header parser for Docker hijack/attach.
 * Unlike IncrementalHttpResponseParser (logs), 101 is not treated as bodyless complete:
 * everything after `\r\n\r\n` is raw TTY (or error body discarded by caller).
 * Handles headers split across arbitrary chunk boundaries.
 */
export class HijackHttpHeaderParser {
  private buf = Buffer.alloc(0)
  private done = false

  push(chunk: Buffer): HijackHeaderParseResult {
    if (this.done) {
      return {
        complete: true,
        statusCode: 0,
        headers: {},
        remainder: chunk.length ? Buffer.from(chunk) : Buffer.alloc(0),
      }
    }
    if (chunk.length) {
      this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : Buffer.from(chunk)
    }
    const sep = this.buf.indexOf('\r\n\r\n')
    if (sep < 0) {
      if (this.buf.length > 64_000) {
        throw new Error('HTTP headers too large')
      }
      return { complete: false }
    }
    const head = this.buf.subarray(0, sep).toString('utf8')
    const remainder = this.buf.subarray(sep + 4)
    this.buf = Buffer.alloc(0)
    this.done = true
    const lines = head.split('\r\n')
    const statusLine = lines[0] || ''
    const m = /^HTTP\/\d\.\d\s+(\d+)/i.exec(statusLine)
    if (!m) {
      throw new Error('Invalid HTTP status line')
    }
    const statusCode = Number(m[1])
    const headers: Record<string, string> = {}
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]
      const idx = line.indexOf(':')
      if (idx < 0) continue
      const key = line.slice(0, idx).trim().toLowerCase()
      const val = line.slice(idx + 1).trim()
      headers[key] = val
    }
    return {
      complete: true,
      statusCode,
      headers,
      remainder: remainder.length ? Buffer.from(remainder) : Buffer.alloc(0),
    }
  }
}

/**
 * Open POST /exec/{id}/start with Upgrade: tcp and stream raw TTY bytes.
 * Header may split across chunks; body bytes after headers in the same chunk are preserved.
 */
export function startDockerExecAttachStream(
  params: StartExecAttachParams,
): ActiveExecAttachHandle {
  const {
    endpoint,
    apiPath,
    body,
    isLive,
    callbacks,
    startTimeoutMs = DOCKER_EXEC_START_TIMEOUT_MS,
  } = params

  if (!isAllowedDockerApiRequest('POST', apiPath)) {
    throw new DockerTransportError(
      'request-failed',
      'Docker API method/path not allowed',
      endpoint.sessionId,
    )
  }

  let settled = false
  let headersReady = false
  let socket: net.Socket | null = null
  const headerParser = new HijackHttpHeaderParser()

  const finish = (reason: ExecAttachFinalReason, code?: DockerTransportErrorCode) => {
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
      const bodyBuf = Buffer.from(body, 'utf8')
      const head =
        `POST ${apiPath} HTTP/1.1\r\n` +
        `Host: localhost\r\n` +
        `Content-Type: application/json\r\n` +
        `Content-Length: ${bodyBuf.length}\r\n` +
        `Connection: Upgrade\r\n` +
        `Upgrade: tcp\r\n` +
        `Accept: application/vnd.docker.raw-stream, application/octet-stream, */*\r\n` +
        `\r\n`
      try {
        socket!.write(head)
        socket!.write(bodyBuf)
      } catch {
        finish('error', 'request-failed')
      }
    })
  } catch (err) {
    const c = classifyStreamLocalError(err, endpoint.sessionId)
    finish('error', c.code)
    return {
      write: () => false,
      destroy: (reason, code) => finish(reason, code),
      pendingWriteBytes: () => 0,
    }
  }

  socket.on('data', (raw: Buffer) => {
    if (settled) return
    if (!isLive()) {
      finish('disconnected', 'generation-stale')
      return
    }
    try {
      if (!headersReady) {
        const result = headerParser.push(raw)
        if (!result.complete) return
        headersReady = true
        clearTimeout(startTimer)
        // Never emit error response body to callbacks/logs.
        if (!isSuccessfulExecAttachStatus(result.statusCode)) {
          const code = mapExecAttachResponseHeaders(result.statusCode, result.headers)
          finish('error', code || mapHttpStatus(result.statusCode))
          return
        }
        callbacks.onState('attached')
        if (result.remainder.length) {
          callbacks.onData(result.remainder)
        }
        return
      }
      // Post-headers: raw TTY bytes — no multiplex framing.
      if (raw.length) callbacks.onData(raw)
    } catch {
      finish('error', 'attach-protocol-error')
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
    if (!headersReady) {
      finish('error', 'attach-protocol-error')
      return
    }
    finish('ended')
  })

  socket.on('close', () => {
    if (settled) return
    if (!headersReady) {
      finish('error', 'proxy-closed')
    } else {
      finish('ended')
    }
  })

  return {
    write: (data: Buffer | string) => {
      if (settled || !socket || !headersReady) return false
      try {
        const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data
        return socket.write(buf)
      } catch {
        return false
      }
    },
    destroy: (reason, code) => finish(reason, code),
    pendingWriteBytes: () => {
      if (!socket) return 0
      return socket.writableLength || 0
    },
  }
}
