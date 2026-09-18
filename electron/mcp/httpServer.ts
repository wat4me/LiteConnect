/**
 * Tools-only MCP Streamable HTTP (JSON-RPC over POST /mcp).
 * Loopback bind, Bearer auth, Host/Origin checks, and a request rate limit.
 * Intentionally not the full SDK: Electron-friendly and the security envelope is testable.
 */
import { randomUUID } from 'crypto'
import http from 'http'
import {
  MCP_HTTP_MAX_BODY_BYTES,
  MCP_HTTP_RATE_LIMIT,
  MCP_HTTP_RATE_WINDOW_MS,
} from '../../shared/mcp/limits'
import {
  bearerMatches,
  isAllowedHostHeader,
  isAllowedOrigin,
  SlidingWindowLimiter,
} from './httpAuth'
import { handleMcpJsonRpc, type McpAuditHook, type McpServerInfo } from './httpProtocol'
import type { SshMcpRuntime } from './runtime'

export type McpHttpServerOptions = {
  runtime: SshMcpRuntime
  getToken: () => string
  serverInfo: McpServerInfo
  audit?: McpAuditHook
  maxBodyBytes?: number
}

export type McpHttpHandle = {
  listen: (port: number, host?: string) => Promise<number>
  close: () => Promise<void>
  address: () => { host: string; port: number } | null
}

const SESSION_TTL_MS = 60 * 60 * 1000
const MAX_SESSIONS = 16

export function createMcpHttpServer(opts: McpHttpServerOptions): McpHttpHandle {
  const limiter = new SlidingWindowLimiter(MCP_HTTP_RATE_LIMIT, MCP_HTTP_RATE_WINDOW_MS)
  const sessions = new Map<string, number>()
  const maxBody = opts.maxBodyBytes ?? MCP_HTTP_MAX_BODY_BYTES

  const server = http.createServer((req, res) => {
    void handleRequest(req, res)
  })

  async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      const origin = header(req, 'origin')
      if (!isAllowedOrigin(origin || undefined)) {
        writeJson(res, 403, { error: 'forbidden origin' })
        return
      }
      if (origin) applyCors(res, origin)

      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }

      if (req.method === 'GET' && url.pathname === '/health') {
        writeJson(res, 200, { ok: true, ...opts.serverInfo })
        return
      }

      if (!isAllowedHostHeader(header(req, 'host'))) {
        writeJson(res, 403, { error: 'invalid host' })
        return
      }

      if (url.pathname !== '/mcp') {
        writeJson(res, 404, { error: 'not found' })
        return
      }

      if (req.method === 'GET') {
        res.writeHead(405, { Allow: 'POST, DELETE, OPTIONS' })
        res.end()
        return
      }

      if (!limiter.allow()) {
        res.writeHead(429, { 'Retry-After': '60', 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Rate limit exceeded' }, id: null }))
        return
      }

      const token = opts.getToken()
      if (!token || !bearerMatches(header(req, 'authorization'), token)) {
        res.writeHead(401, { 'WWW-Authenticate': 'Bearer', 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: 'unauthorized' }))
        return
      }

      if (req.method === 'DELETE') {
        const sid = header(req, 'mcp-session-id')
        if (sid) sessions.delete(sid)
        res.writeHead(200)
        res.end()
        return
      }

      if (req.method !== 'POST') {
        res.writeHead(405, { Allow: 'POST, DELETE, OPTIONS' })
        res.end()
        return
      }

      const raw = await readBody(req, maxBody)
      let parsed: unknown
      try {
        parsed = JSON.parse(raw.toString('utf8') || 'null')
      } catch {
        writeJson(res, 400, { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null })
        return
      }

      const sessionHeader = header(req, 'mcp-session-id')
      pruneSessions()
      if (sessionHeader && !sessions.has(sessionHeader) && !isInitialize(parsed)) {
        writeJson(res, 400, {
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Bad Request: invalid session' },
          id: null,
        })
        return
      }

      if (Array.isArray(parsed)) {
        const bodies: unknown[] = []
        let sessionId = sessionHeader
        for (const item of parsed) {
          const out = await handleMcpJsonRpc(item, opts)
          if (out.kind === 'initialize') {
            sessionId = randomUUID()
            sessions.set(sessionId, Date.now())
            bodies.push(out.body)
          } else if (out.kind === 'notification') {
            continue
          } else {
            bodies.push(out.body)
          }
        }
        const headers: http.OutgoingHttpHeaders = {}
        if (sessionId) headers['Mcp-Session-Id'] = sessionId
        writeJson(res, 200, bodies, headers)
        return
      }

      const out = await handleMcpJsonRpc(parsed, opts)
      if (out.kind === 'notification') {
        res.writeHead(202)
        res.end()
        return
      }
      if (out.kind === 'initialize') {
        const sessionId = randomUUID()
        sessions.set(sessionId, Date.now())
        writeJson(res, 200, out.body, { 'Mcp-Session-Id': sessionId })
        return
      }
      const headers: http.OutgoingHttpHeaders = {}
      if (sessionHeader) {
        sessions.set(sessionHeader, Date.now())
        headers['Mcp-Session-Id'] = sessionHeader
      }
      writeJson(res, out.kind === 'rpc-error' ? out.status : 200, out.body, headers)
    } catch (err) {
      if (res.headersSent) return
      const message = err instanceof Error ? err.message : String(err)
      if (message === 'PAYLOAD_TOO_LARGE') {
        writeJson(res, 413, { error: 'payload too large' })
        return
      }
      writeJson(res, 500, { jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null })
    }
  }

  function pruneSessions() {
    const now = Date.now()
    for (const [id, ts] of sessions) {
      if (now - ts > SESSION_TTL_MS) sessions.delete(id)
    }
    while (sessions.size > MAX_SESSIONS) {
      const oldest = sessions.keys().next().value
      if (!oldest) break
      sessions.delete(oldest)
    }
  }

  return {
    listen(port: number, host = '127.0.0.1') {
      return new Promise((resolve, reject) => {
        const onError = (err: Error) => reject(err)
        server.once('error', onError)
        server.listen(port, host, () => {
          server.off('error', onError)
          const addr = server.address()
          if (addr && typeof addr === 'object') resolve(addr.port)
          else reject(new Error('MCP HTTP listen failed'))
        })
      })
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      })
    },
    address() {
      const addr = server.address()
      if (!addr || typeof addr === 'string') return null
      return { host: String(addr.address), port: addr.port }
    },
  }
}

function header(req: http.IncomingMessage, name: string): string {
  const raw = req.headers[name]
  if (Array.isArray(raw)) return raw[0] || ''
  return raw || ''
}

function isInitialize(message: unknown): boolean {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return false
  return (message as { method?: unknown }).method === 'initialize'
}

function applyCors(res: http.ServerResponse, origin: string) {
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version')
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS')
  res.setHeader('Vary', 'Origin')
}

function writeJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  extra: http.OutgoingHttpHeaders = {},
) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    ...extra,
  })
  res.end(payload)
}

function readBody(req: http.IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    req.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > maxBytes) {
        req.destroy()
        reject(new Error('PAYLOAD_TOO_LARGE'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}
