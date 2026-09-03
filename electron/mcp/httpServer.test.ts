import http from 'http'
import { afterEach, describe, expect, it } from 'vitest'
import { createMcpHttpServer, type McpHttpHandle } from './httpServer'
import { createSshMcpRuntime } from './runtime'
import type { SshMcpSessionPort } from './ports'
import type { SessionSnapshot } from '../ssh/types'

const SESSION_ID = '550e8400-e29b-41d4-a716-446655440000'
const TOKEN = 'a'.repeat(64)

function runtime() {
  const snap: SessionSnapshot = {
    sessionId: SESSION_ID,
    connectionId: '660e8400-e29b-41d4-a716-446655440000',
    connectionName: 'web-1',
    generation: 1,
    hasSftp: false,
  }
  const ssh: SshMcpSessionPort = {
    listSessionSnapshots: () => [snap],
    getSessionSnapshot: (id) => (id === SESSION_ID ? snap : undefined),
    getSessionGeneration: () => snap.generation,
    executeSessionExec: async () => ({ stdout: 'ok', stderr: '', exitCode: 0, truncated: false }),
    initSftp: async () => {},
    sftpReaddir: async () => [],
    sftpReadFile: async () => '',
    sftpStat: async () => ({ mode: '644', size: 0, uid: 0, gid: 0, atime: 0, mtime: 0 }),
  }
  return createSshMcpRuntime({
    ssh,
    connections: {
      listPublicConnections: () => [],
      listGroups: () => [],
      saveConnection: async () => {
        throw new Error('unused')
      },
    },
  })
}

async function startServer() {
  const handle = createMcpHttpServer({
    runtime: runtime(),
    getToken: () => TOKEN,
    serverInfo: { name: 'liteconnect-ssh', version: 'test' },
  })
  const port = await handle.listen(0, '127.0.0.1')
  return { handle, port, url: `http://127.0.0.1:${port}` }
}

async function rpc(
  url: string,
  body: unknown,
  extra: { token?: string; host?: string; origin?: string; session?: string } = {},
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Host: extra.host ?? new URL(url).host,
  }
  if (extra.token !== null) headers.Authorization = `Bearer ${extra.token ?? TOKEN}`
  if (extra.origin) headers.Origin = extra.origin
  if (extra.session) headers['Mcp-Session-Id'] = extra.session
  if (extra.token === '') delete headers.Authorization
  return fetch(`${url}/mcp`, { method: 'POST', headers, body: JSON.stringify(body) })
}

describe('MCP HTTP server', () => {
  let handle: McpHttpHandle | undefined

  afterEach(async () => {
    if (handle) await handle.close()
    handle = undefined
  })

  it('serves health without a token and MCP with a token', async () => {
    const started = await startServer()
    handle = started.handle
    const health = await fetch(`${started.url}/health`)
    expect(health.status).toBe(200)
    expect(await health.json()).toMatchObject({ ok: true, name: 'liteconnect-ssh' })

    const unauth = await rpc(started.url, { jsonrpc: '2.0', id: 1, method: 'ping' }, { token: '' })
    expect(unauth.status).toBe(401)

    const ping = await rpc(started.url, { jsonrpc: '2.0', id: 1, method: 'ping' })
    expect(ping.status).toBe(200)
    expect(await ping.json()).toMatchObject({ jsonrpc: '2.0', id: 1, result: {} })
  })

  it('rejects non-loopback Host headers', async () => {
    const started = await startServer()
    handle = started.handle
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })
    const res = await new Promise<{ status: number }>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: started.port,
          path: '/mcp',
          method: 'POST',
          headers: {
            Host: 'evil.example:17420',
            Authorization: `Bearer ${TOKEN}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (response) => {
          response.resume()
          response.on('end', () => resolve({ status: response.statusCode || 0 }))
        },
      )
      req.on('error', reject)
      req.write(body)
      req.end()
    })
    expect(res.status).toBe(403)
  })

  it('initializes, lists tools, and calls list_sessions', async () => {
    const started = await startServer()
    handle = started.handle
    const init = await rpc(started.url, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'vitest' } },
    })
    expect(init.status).toBe(200)
    const session = init.headers.get('mcp-session-id')
    expect(session).toBeTruthy()
    const initBody = await init.json()
    expect(initBody.result.serverInfo.name).toBe('liteconnect-ssh')

    const list = await rpc(
      started.url,
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { session: session || undefined },
    )
    const listed = await list.json()
    expect(listed.result.tools.some((t: { name: string }) => t.name === 'list_sessions')).toBe(true)

    const call = await rpc(
      started.url,
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_sessions', arguments: {} } },
      { session: session || undefined },
    )
    const called = await call.json()
    expect(called.result.isError).toBe(false)
    expect(called.result.structuredContent.sessions[0].sessionId).toBe(SESSION_ID)
  })
})
