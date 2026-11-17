import http from 'http'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
    beginSessionExec: async () => ({ promise: Promise.resolve({ stdout: 'ok', stderr: '', exitCode: 0, truncated: false }), cancel: () => {} }),
    initSftp: async () => {},
    sftpReaddir: async () => [],
    sftpReadFile: async () => '',
    sftpReadFileRange: async () => ({ buffer: Buffer.alloc(0), size: 0, eof: true }),
    sftpWriteFile: async () => {},
    sftpWriteBuffer: async () => {},
    sftpDownload: async () => {},
    sftpUpload: async () => {},
    connectSaved: async () => ({ sessionId: SESSION_ID, reused: true }),
    disconnectSession: () => {},
    openShellChannel: async () => { throw new Error('unused shell') },
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
  extra: { token?: string; host?: string; origin?: string; session?: string; version?: string; method?: string } = {},
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Host: extra.host ?? new URL(url).host,
  }
  if (extra.token !== null) headers.Authorization = `Bearer ${extra.token ?? TOKEN}`
  if (extra.origin) headers.Origin = extra.origin
  if (extra.session) headers['Mcp-Session-Id'] = extra.session
  if (extra.version !== undefined) headers['MCP-Protocol-Version'] = extra.version
  if (extra.token === '') delete headers.Authorization
  return fetch(`${url}/mcp`, { method: extra.method ?? 'POST', headers, body: JSON.stringify(body) })
}

function initialize(url: string, protocolVersion: string) {
  return rpc(url, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion, capabilities: {}, clientInfo: { name: 'vitest', version: '1' } },
  })
}

describe('MCP HTTP server', () => {
  let handle: McpHttpHandle | undefined

  afterEach(async () => {
    if (handle) await handle.close()
    handle = undefined
  })

  it('cancels accepted tool requests and waits for their cleanup when the listener closes', async () => {
    let signal!: AbortSignal
    let finish!: () => void
    const tools = runtime()
    vi.spyOn(tools, 'call').mockImplementationOnce(async (_name, _args, opts) => {
      signal = opts!.signal!
      await new Promise<void>(resolve => { finish = resolve })
      return { content: 'cancelled', structuredContent: {}, isError: true }
    })
    const audit = vi.fn()
    handle = createMcpHttpServer({ runtime: tools, getToken: () => TOKEN, serverInfo: { name: 'test', version: '1' }, audit })
    const port = await handle.listen(0)
    const request = rpc(`http://127.0.0.1:${port}`, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_sessions', arguments: {} } })
    await vi.waitFor(() => expect(signal).toBeDefined())
    let stopped = false
    const stopping = handle.close().then(() => { stopped = true })
    expect(signal.aborted).toBe(true)
    await Promise.resolve()
    expect(stopped).toBe(false)
    finish()
    const response = await request
    await response.text()
    await stopping
    expect(audit).toHaveBeenCalledOnce()
    expect(handle.address()).toBeNull()
    tools.dispose()
  })

  it('closes a listen started in the same turn without leaving a bound server', async () => {
    handle = createMcpHttpServer({ runtime: runtime(), getToken: () => TOKEN, serverInfo: { name: 'test', version: '1' } })
    const listening = handle.listen(0)
    const stopping = handle.close()
    await listening; await stopping
    expect(handle.address()).toBeNull()
    await expect(handle.listen(0)).rejects.toThrow('closing')
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
    const init = await initialize(started.url, '2025-11-25')
    expect(init.status).toBe(200)
    const session = init.headers.get('mcp-session-id')
    expect(session).toBeTruthy()
    const initBody = await init.json()
    expect(initBody.result.serverInfo.name).toBe('liteconnect-ssh')

    const headers = { session: session || undefined, version: initBody.result.protocolVersion }
    const ready = await rpc(started.url, { jsonrpc: '2.0', method: 'notifications/initialized' }, headers)
    expect(ready.status).toBe(202)
    expect(await ready.text()).toBe('')

    const list = await rpc(
      started.url,
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      headers,
    )
    const listed = await list.json()
    expect(listed.result.tools.some((t: { name: string }) => t.name === 'list_sessions')).toBe(true)

    const call = await rpc(
      started.url,
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_sessions', arguments: {} } },
      headers,
    )
    const called = await call.json()
    expect(called.result.isError).toBe(false)
    expect(called.result.structuredContent.sessions[0].sessionId).toBe(SESSION_ID)
  })

  it('responds to modern discovery with a legacy HTTP error and negotiates a supported revision', async () => {
    const started = await startServer()
    handle = started.handle
    const probe = await rpc(started.url, { jsonrpc: '2.0', id: 1, method: 'server/discover' }, { version: '2026-07-28' })
    expect(probe.status).toBe(400)
    expect(await probe.json()).toMatchObject({ error: { code: -32600 } })

    const init = await initialize(started.url, '2026-07-28')
    expect((await init.json()).result.protocolVersion).toBe('2025-11-25')
    expect(init.headers.get('mcp-session-id')).toBeTruthy()
  })

  it('returns 404 for a terminated or expired session and lets the client initialize again', async () => {
    const started = await startServer()
    handle = started.handle
    const version = '2025-11-25'
    const init = await initialize(started.url, version)
    const session = init.headers.get('mcp-session-id')!
    await init.json()
    const deleted = await rpc(started.url, undefined, { session, version, method: 'DELETE' })
    expect(deleted.status).toBe(200)
    const stale = await rpc(started.url, { jsonrpc: '2.0', id: 2, method: 'ping' }, { session, version })
    expect(stale.status).toBe(404)
    expect(await stale.json()).toMatchObject({ error: { code: -32001 } })

    const next = await initialize(started.url, version)
    const nextSession = next.headers.get('mcp-session-id')!
    expect(next.status).toBe(200)
    expect(nextSession).not.toBe(session)
    await next.json()

    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61 * 60 * 1000)
    try {
      const expired = await rpc(started.url, undefined, { session: nextSession, version, method: 'GET' })
      expect(expired.status).toBe(404)
      await expired.json()
    } finally {
      now.mockRestore()
    }
  })

  it('uses the negotiated revision to limit batches to the revision that supported them', async () => {
    const started = await startServer()
    handle = started.handle
    const requests = [{ jsonrpc: '2.0', id: 2, method: 'ping' }]
    const modern = await initialize(started.url, '2025-06-18')
    const modernSession = modern.headers.get('mcp-session-id')!
    await modern.json()
    const rejected = await rpc(started.url, requests, { session: modernSession })
    expect(rejected.status).toBe(400)
    await rejected.json()

    const legacy = await initialize(started.url, '2025-03-26')
    const legacySession = legacy.headers.get('mcp-session-id')!
    await legacy.json()
    const accepted = await rpc(started.url, requests, { session: legacySession })
    expect(accepted.status).toBe(200)
    expect(await accepted.json()).toEqual([{ jsonrpc: '2.0', id: 2, result: {} }])
  })
})
