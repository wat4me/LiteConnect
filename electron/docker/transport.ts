import * as net from 'net'
import type { ClientChannel } from 'ssh2'
import { isAllowedDockerApiRequest } from './containers'
import { classifyStreamLocalError } from './errorClassify'
import { IncrementalHttpResponseParser } from './logHttpParser'
import {
  DOCKER_SOCKET_PATH,
  DockerTransportError,
  type DockerProxyEndpoint,
  type DockerTransportErrorCode,
  type StreamLocalChannelOpener,
} from './types'

/** Internal header: main-process only; never exposed via IPC to renderer. */
export const DOCKER_PROXY_ERROR_HEADER = 'x-liteconnect-docker-error'

type ActiveProxy = {
  sessionId: string
  generation: number
  server: net.Server
  localPort: number
  sockets: Set<net.Socket>
  streams: Set<NodeJS.ReadWriteStream>
  closed: boolean
}

/**
 * Per-session loopback Docker socket proxy.
 * - Listens only on 127.0.0.1 ephemeral port
 * - Each accepted connection opens StreamLocal to fixed /var/run/docker.sock
 * - Bound to sessionId + generation; stale generation cannot resurrect closed transport
 * - StreamLocal open failures surface as structured DockerTransportError via internal HTTP header
 * - Local socket close/abort always destroys the paired remote StreamLocal stream
 */
export class DockerSocketTransport {
  private readonly proxies = new Map<string, ActiveProxy>()
  private readonly ensureInflight = new Map<string, Promise<DockerProxyEndpoint>>()
  private unsubTeardown: (() => void) | null = null
  private disposed = false

  constructor(private readonly opener: StreamLocalChannelOpener) {
    this.unsubTeardown = this.opener.registerSessionTeardownHook((sessionId) => {
      this.closeSession(sessionId)
    })
  }

  /** Concurrent ensure for the same session is deduped. Ready only after listen succeeds. */
  async ensureProxy(sessionId: string): Promise<DockerProxyEndpoint> {
    if (this.disposed) {
      throw new DockerTransportError('proxy-closed', 'Docker transport disposed', sessionId)
    }
    if (!this.opener.hasSession(sessionId)) {
      throw new DockerTransportError('ssh-disconnected', 'SSH session not connected', sessionId)
    }

    const generation = this.opener.getSessionGeneration(sessionId)
    const existing = this.proxies.get(sessionId)
    if (existing && !existing.closed && existing.generation === generation) {
      return {
        sessionId,
        generation: existing.generation,
        localHost: '127.0.0.1',
        localPort: existing.localPort,
      }
    }

    // Stale proxy from previous generation — tear down before recreate
    if (existing) {
      this.closeProxy(existing)
      this.proxies.delete(sessionId)
    }

    const inflight = this.ensureInflight.get(sessionId)
    if (inflight) return inflight

    const promise = this.createProxy(sessionId, generation).finally(() => {
      if (this.ensureInflight.get(sessionId) === promise) {
        this.ensureInflight.delete(sessionId)
      }
    })
    this.ensureInflight.set(sessionId, promise)
    return promise
  }

  private async createProxy(
    sessionId: string,
    generation: number,
  ): Promise<DockerProxyEndpoint> {
    if (!this.isLive(sessionId, generation)) {
      throw new DockerTransportError('generation-stale', 'SSH session generation changed', sessionId)
    }

    const sockets = new Set<net.Socket>()
    const streams = new Set<NodeJS.ReadWriteStream>()

    const proxy: ActiveProxy = {
      sessionId,
      generation,
      server: null as unknown as net.Server,
      localPort: 0,
      sockets,
      streams,
      closed: false,
    }

    const server = net.createServer((socket) => {
      if (proxy.closed || !this.isLive(sessionId, generation)) {
        socket.destroy()
        return
      }
      sockets.add(socket)

      let remote: NodeJS.ReadWriteStream | null = null
      let openFinished = false
      let localGone = false

      const destroyRemote = () => {
        const s = remote
        remote = null
        if (!s) return
        streams.delete(s)
        destroyStream(s)
      }

      const onLocalGone = () => {
        if (localGone) return
        localGone = true
        sockets.delete(socket)
        // Paired cleanup: local abort/close always tears down remote StreamLocal
        destroyRemote()
      }

      socket.on('close', onLocalGone)
      socket.on('error', () => {
        try {
          socket.destroy()
        } catch {}
        onLocalGone()
      })

      void this.openRemoteDockerChannel(sessionId, generation)
        .then((stream) => {
          openFinished = true
          if (proxy.closed || localGone || !this.isLive(sessionId, generation)) {
            destroyStream(stream)
            if (!localGone) {
              try {
                socket.destroy()
              } catch {}
            }
            return
          }
          remote = stream
          streams.add(stream)

          let remoteReadableEnded = false
          const onRemoteEnd = () => {
            // Do not destroy the local socket here. stream.pipe(socket) must be
            // allowed to flush all response bytes and end socket's write side.
            remoteReadableEnded = true
          }
          const onRemoteClose = () => {
            streams.delete(stream)
            if (remote === stream) remote = null
            if (!remoteReadableEnded && !localGone) {
              try {
                socket.destroy()
              } catch {}
            }
          }
          stream.on('end', onRemoteEnd)
          stream.on('close', onRemoteClose)
          stream.on('error', () => {
            destroyStream(stream)
            if (!localGone) {
              try {
                socket.destroy()
              } catch {}
            }
          })

          socket.pipe(stream as NodeJS.WritableStream)
          ;(stream as NodeJS.ReadableStream).pipe(socket)
        })
        .catch((err) => {
          openFinished = true
          if (localGone || proxy.closed) return
          const classified = classifyStreamLocalError(err, sessionId)
          writeProxyOpenError(socket, classified)
        })

      // If open never settles before session close, streams set may still be empty —
      // late resolve path above destroys the stream.
      void openFinished
    })
    proxy.server = server

    try {
      const port = await listenLoopback(server)
      if (proxy.closed || !this.isLive(sessionId, generation) || this.disposed) {
        destroyServer(server, sockets, streams)
        throw new DockerTransportError(
          'generation-stale',
          'SSH session changed before Docker proxy was ready',
          sessionId,
        )
      }
      proxy.localPort = port
      this.proxies.set(sessionId, proxy)
      return {
        sessionId,
        generation,
        localHost: '127.0.0.1',
        localPort: port,
      }
    } catch (err) {
      proxy.closed = true
      destroyServer(server, sockets, streams)
      if (err instanceof DockerTransportError) throw err
      throw new DockerTransportError(
        'request-failed',
        err instanceof Error ? err.message : String(err),
        sessionId,
      )
    }
  }

  /**
   * Open remote Docker socket channel for one accepted local connection.
   * Uses openDockerSocketChannel when present (StreamLocal + fixed nc fallback);
   * otherwise openStreamLocal only (unit fakes).
   */
  private openRemoteDockerChannel(
    sessionId: string,
    generation: number,
  ): Promise<NodeJS.ReadWriteStream> {
    if (typeof this.opener.openDockerSocketChannel === 'function') {
      return this.opener.openDockerSocketChannel(sessionId, generation)
    }
    return this.opener.openStreamLocal(sessionId, DOCKER_SOCKET_PATH, generation)
  }

  private isLive(sessionId: string, generation: number): boolean {
    if (this.disposed) return false
    if (!this.opener.hasSession(sessionId)) return false
    return this.opener.getSessionGeneration(sessionId) === generation
  }

  /** Idempotent per-session close (SSH disconnect / reconnect teardown). */
  closeSession(sessionId: string): void {
    this.ensureInflight.delete(sessionId)
    const proxy = this.proxies.get(sessionId)
    if (!proxy) return
    this.closeProxy(proxy)
    this.proxies.delete(sessionId)
  }

  private closeProxy(proxy: ActiveProxy): void {
    if (proxy.closed) return
    proxy.closed = true
    destroyServer(proxy.server, proxy.sockets, proxy.streams)
  }

  /** Application quit / full dispose — closes all proxies. Idempotent. */
  closeAll(): void {
    if (this.disposed) {
      for (const sid of [...this.proxies.keys()]) {
        this.closeSession(sid)
      }
      return
    }
    this.disposed = true
    for (const sid of [...this.proxies.keys()]) {
      this.closeSession(sid)
    }
    this.ensureInflight.clear()
    try {
      this.unsubTeardown?.()
    } catch {}
    this.unsubTeardown = null
  }

  /** Test / diagnostics: whether a ready proxy exists for session+generation. */
  getActiveEndpoint(sessionId: string): DockerProxyEndpoint | null {
    const p = this.proxies.get(sessionId)
    if (!p || p.closed) return null
    if (!this.isLive(sessionId, p.generation)) return null
    return {
      sessionId,
      generation: p.generation,
      localHost: '127.0.0.1',
      localPort: p.localPort,
    }
  }

  /** Active remote StreamLocal streams for a session (tests / diagnostics). */
  getActiveStreamCount(sessionId: string): number {
    const p = this.proxies.get(sessionId)
    if (!p || p.closed) return 0
    return p.streams.size
  }

  isProxyListening(sessionId: string): boolean {
    const p = this.proxies.get(sessionId)
    if (!p || p.closed) return false
    return Boolean((p.server as any).listening)
  }
}

/**
 * Write a synthetic HTTP error so dockerHttpRequest (full proxy path) receives a
 * stable DockerTransportError.code without relying on bare TCP close.
 */
function writeProxyOpenError(socket: net.Socket, err: DockerTransportError): void {
  const body = err.message || err.code
  const payload =
    `HTTP/1.1 502 Bad Gateway\r\n` +
    `${DOCKER_PROXY_ERROR_HEADER}: ${err.code}\r\n` +
    `Content-Type: text/plain; charset=utf-8\r\n` +
    `Content-Length: ${Buffer.byteLength(body)}\r\n` +
    `Connection: close\r\n` +
    `\r\n` +
    body
  try {
    socket.write(payload)
  } catch {}
  try {
    socket.end()
  } catch {
    try {
      socket.destroy()
    } catch {}
  }
}

function destroyStream(stream: NodeJS.ReadWriteStream): void {
  try {
    stream.destroy?.()
  } catch {}
  try {
    ;(stream as ClientChannel).close?.()
  } catch {}
}

function listenLoopback(server: net.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    let settled = false
    const onError = (err: Error) => {
      if (settled) return
      settled = true
      reject(err)
    }
    server.once('error', onError)
    try {
      server.listen(0, '127.0.0.1', () => {
        if (settled) return
        const addr = server.address()
        if (!addr || typeof addr === 'string') {
          settled = true
          server.off('error', onError)
          try {
            server.close()
          } catch {}
          reject(new Error('Failed to bind Docker loopback proxy'))
          return
        }
        settled = true
        server.off('error', onError)
        resolve(addr.port)
      })
    } catch (err) {
      if (settled) return
      settled = true
      server.off('error', onError)
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })
}

function destroyServer(
  server: net.Server,
  sockets: Set<net.Socket>,
  streams: Set<NodeJS.ReadWriteStream>,
): void {
  for (const stream of streams) {
    destroyStream(stream)
  }
  streams.clear()
  for (const s of sockets) {
    try {
      s.destroy()
    } catch {}
  }
  sockets.clear()
  try {
    server.close()
  } catch {}
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

/** Raw HTTP over the loopback proxy (no external dockerode dependency for MVP-001). */
export async function dockerHttpRequest(
  endpoint: DockerProxyEndpoint,
  method: string,
  apiPath: string,
  options?: {
    body?: string | Buffer
    headers?: Record<string, string>
    timeoutMs?: number
    /** Abort if generation no longer live */
    isLive?: () => boolean
  },
): Promise<{ statusCode: number; headers: Record<string, string | string[] | undefined>; body: Buffer }> {
  // Main process only: method+path whitelist. No renderer-supplied paths/methods/query/timeout.
  if (!isAllowedDockerApiRequest(method, apiPath)) {
    throw new DockerTransportError(
      'request-failed',
      'Docker API method/path not allowed',
      endpoint.sessionId,
    )
  }

  const timeoutMs = options?.timeoutMs ?? 15_000
  const body = options?.body
  const httpMethod = method.toUpperCase()

  return new Promise((resolve, reject) => {
    if (options?.isLive && !options.isLive()) {
      reject(
        new DockerTransportError(
          'generation-stale',
          'SSH session generation changed',
          endpoint.sessionId,
        ),
      )
      return
    }

    const req = net.connect(
      { host: endpoint.localHost, port: endpoint.localPort },
      () => {
        const headerLines = [
          `${httpMethod} ${apiPath} HTTP/1.1`,
          `Host: localhost`,
          'Connection: close',
          'Accept: application/json',
        ]
        if (options?.headers) {
          for (const [k, v] of Object.entries(options.headers)) {
            headerLines.push(`${k}: ${v}`)
          }
        }
        if (body) {
          headerLines.push(`Content-Length: ${Buffer.byteLength(body)}`)
        }
        const head = headerLines.join('\r\n') + '\r\n\r\n'
        req.write(head)
        if (body) req.write(body)
      },
    )

    const chunks: Buffer[] = []
    const responseParser = new IncrementalHttpResponseParser()
    let settled = false
    const timer = setTimeout(() => {
      finish(
        new DockerTransportError('request-timeout', 'Docker request timed out', endpoint.sessionId),
      )
    }, timeoutMs)

    const finish = (err?: Error, result?: {
      statusCode: number
      headers: Record<string, string | string[] | undefined>
      body: Buffer
    }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        req.destroy()
      } catch {}
      if (err) reject(err)
      else if (result) resolve(result)
    }

    const finishParsedResponse = () => {
      try {
        const raw = Buffer.concat(chunks)
        if (raw.length === 0) {
          finish(
            new DockerTransportError(
              'proxy-closed',
              'Docker proxy connection closed',
              endpoint.sessionId,
            ),
          )
          return
        }
        const parsed = parseHttpResponse(raw)
        const proxyErr = headerValue(parsed.headers, DOCKER_PROXY_ERROR_HEADER)
        if (proxyErr && isDockerErrorCode(proxyErr)) {
          const msg = parsed.body.toString('utf8') || proxyErr
          finish(new DockerTransportError(proxyErr, msg, endpoint.sessionId))
          return
        }
        resolveHttpStatus(parsed, endpoint.sessionId, httpMethod, apiPath)
        finish(undefined, parsed)
      } catch (err) {
        finish(
          err instanceof DockerTransportError
            ? err
            : new DockerTransportError(
                'request-failed',
                err instanceof Error ? err.message : String(err),
                endpoint.sessionId,
              ),
        )
      }
    }

    req.on('data', (c: Buffer) => {
      if (settled) return
      chunks.push(c)
      try {
        const result = responseParser.push(c)
        // nc may keep the SSH channel open after Docker has sent a complete
        // Content-Length/chunked/bodyless response. Finish from framing rather
        // than waiting forever for TCP end, then cleanup closes the nc channel.
        if (result.complete) finishParsedResponse()
      } catch (err) {
        finish(
          new DockerTransportError(
            'request-failed',
            err instanceof Error ? err.message : String(err),
            endpoint.sessionId,
          ),
        )
      }
    })
    req.on('error', (err) => {
      finish(classifyStreamLocalError(err, endpoint.sessionId))
    })
    req.on('end', () => {
      if (options?.isLive && !options.isLive()) {
        finish(
          new DockerTransportError(
            'generation-stale',
            'SSH session generation changed',
            endpoint.sessionId,
          ),
        )
        return
      }
      try {
        responseParser.end()
        finishParsedResponse()
      } catch (err) {
        finish(
          new DockerTransportError(
            'request-failed',
            err instanceof Error ? err.message : String(err),
            endpoint.sessionId,
          ),
        )
      }
    })
    req.on('close', () => {
      if (!settled) {
        finish(
          new DockerTransportError('proxy-closed', 'Docker proxy connection closed', endpoint.sessionId),
        )
      }
    })
  })
}

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const v = headers[name.toLowerCase()]
  if (v === undefined) return undefined
  return Array.isArray(v) ? v[0] : v
}

function parseHttpResponse(raw: Buffer): {
  statusCode: number
  headers: Record<string, string | string[] | undefined>
  body: Buffer
} {
  const sep = raw.indexOf('\r\n\r\n')
  if (sep < 0) {
    throw new Error('Invalid HTTP response from Docker')
  }
  const head = raw.subarray(0, sep).toString('utf8')
  const body = raw.subarray(sep + 4)
  const lines = head.split('\r\n')
  const statusLine = lines[0] || ''
  const m = /^HTTP\/\d\.\d\s+(\d+)/i.exec(statusLine)
  if (!m) throw new Error('Invalid HTTP status line from Docker')
  const statusCode = Number(m[1])
  const headers: Record<string, string | string[] | undefined> = {}
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    const idx = line.indexOf(':')
    if (idx < 0) continue
    const key = line.slice(0, idx).trim().toLowerCase()
    const val = line.slice(idx + 1).trim()
    const prev = headers[key]
    if (prev === undefined) headers[key] = val
    else if (Array.isArray(prev)) prev.push(val)
    else headers[key] = [prev, val]
  }
  if (String(headers['transfer-encoding'] || '').toLowerCase().includes('chunked')) {
    return { statusCode, headers, body: decodeChunked(body) }
  }
  return { statusCode, headers, body }
}

function decodeChunked(buf: Buffer): Buffer {
  const out: Buffer[] = []
  let i = 0
  while (i < buf.length) {
    const lineEnd = buf.indexOf('\r\n', i)
    if (lineEnd < 0) break
    const sizeHex = buf.subarray(i, lineEnd).toString('utf8').trim()
    const size = parseInt(sizeHex, 16)
    if (!Number.isFinite(size) || size < 0) break
    i = lineEnd + 2
    if (size === 0) break
    out.push(buf.subarray(i, i + size))
    i += size + 2
  }
  return Buffer.concat(out)
}

/**
 * Map HTTP status by method+path category (no response body in message/logs).
 * - 401/403 → permission-denied (all)
 * - POST container action 404 → container-not-found; 409 → action-conflict
 * - GET inspect 404 → container-not-found
 * - ping/version/list (and other non-single-container) 404/409 → request-failed
 */
function resolveHttpStatus(
  parsed: { statusCode: number; body: Buffer },
  sessionId: string | undefined,
  method: string,
  apiPath: string,
): void {
  if (parsed.statusCode < 400) return
  if (parsed.statusCode === 403 || parsed.statusCode === 401) {
    throw new DockerTransportError(
      'permission-denied',
      `Docker HTTP ${parsed.statusCode}`,
      sessionId,
    )
  }

  const m = method.toUpperCase()
  const isActionPost =
    m === 'POST' &&
    (/\/containers\/[^/]+\/start$/.test(apiPath) ||
      /\/containers\/[^/]+\/stop\?t=\d+$/.test(apiPath) ||
      /\/containers\/[^/]+\/restart\?t=\d+$/.test(apiPath))
  const isCreateExecPost = m === 'POST' && /\/containers\/[^/]+\/exec$/.test(apiPath)
  const isExecPath =
    m === 'POST' &&
    (/\/exec\/[^/]+\/start$/.test(apiPath) || /\/exec\/[^/]+\/resize\?/.test(apiPath))
  const isInspectGet = m === 'GET' && /\/containers\/[^/]+\/json$/.test(apiPath)
  const isExecInspectGet = m === 'GET' && /\/exec\/[^/]+\/json$/.test(apiPath)

  if (parsed.statusCode === 404) {
    if (isActionPost || isInspectGet || isCreateExecPost || isExecPath || isExecInspectGet) {
      throw new DockerTransportError(
        'container-not-found',
        `Docker HTTP ${parsed.statusCode}`,
        sessionId,
      )
    }
    throw new DockerTransportError(
      'request-failed',
      `Docker HTTP ${parsed.statusCode}`,
      sessionId,
    )
  }
  if (parsed.statusCode === 409) {
    if (isActionPost) {
      throw new DockerTransportError(
        'action-conflict',
        `Docker HTTP ${parsed.statusCode}`,
        sessionId,
      )
    }
    if (isCreateExecPost || isExecPath) {
      throw new DockerTransportError(
        'container-not-running',
        `Docker HTTP ${parsed.statusCode}`,
        sessionId,
      )
    }
    throw new DockerTransportError(
      'request-failed',
      `Docker HTTP ${parsed.statusCode}`,
      sessionId,
    )
  }
  throw new DockerTransportError(
    'request-failed',
    `Docker HTTP ${parsed.statusCode}`,
    sessionId,
  )
}

export { classifyStreamLocalError }
