import { describe, expect, it } from 'vitest'
import { handleMcpJsonRpc } from './httpProtocol'
import { createSshMcpRuntime } from './runtime'
import type { SshMcpSessionPort } from './ports'
import type { SessionSnapshot } from '../ssh/types'

const SESSION_ID = '550e8400-e29b-41d4-a716-446655440000'

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
    executeSessionExec: async () => ({ stdout: 'Linux', stderr: '', exitCode: 0, truncated: false }),
    initSftp: async () => {},
    sftpReaddir: async () => [],
    sftpReadFile: async () => '',
    sftpStat: async () => ({ mode: '644', size: 0, uid: 0, gid: 0, atime: 0, mtime: 0 }),
  }
  return createSshMcpRuntime({
    ssh,
    connections: { listPublicConnections: () => [], listGroups: () => [] },
  })
}

const serverInfo = { name: 'liteconnect-ssh', version: '1.0.7' }

describe('handleMcpJsonRpc', () => {
  it('handles initialize, ping, and tools/list', async () => {
    const ctx = { runtime: runtime(), serverInfo }
    const init = await handleMcpJsonRpc(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test' } },
      },
      ctx,
    )
    expect(init.kind).toBe('initialize')
    if (init.kind !== 'initialize') return
    expect(init.body.result).toMatchObject({
      protocolVersion: '2025-11-25',
      serverInfo,
      capabilities: { tools: { listChanged: false } },
    })

    const ping = await handleMcpJsonRpc({ jsonrpc: '2.0', id: 2, method: 'ping' }, ctx)
    expect(ping.kind).toBe('response')

    const list = await handleMcpJsonRpc({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, ctx)
    expect(list.kind).toBe('response')
    if (list.kind !== 'response') return
    const tools = (list.body.result as { tools: Array<{ name: string }> }).tools
    expect(tools.map((t) => t.name)).toContain('exec')
    expect(tools.map((t) => t.name)).toContain('list_sessions')
  })

  it('treats initialized as a notification', async () => {
    const out = await handleMcpJsonRpc(
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { runtime: runtime(), serverInfo },
    )
    expect(out.kind).toBe('notification')
  })

  it('calls exec through the runtime and keeps non-zero exit as a tool result', async () => {
    const ctx = { runtime: runtime(), serverInfo }
    const out = await handleMcpJsonRpc(
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'exec', arguments: { sessionId: SESSION_ID, command: 'uname -a' } },
      },
      ctx,
    )
    expect(out.kind).toBe('response')
    if (out.kind !== 'response') return
    const result = out.body.result as { isError: boolean; structuredContent: { exitCode: number } }
    expect(result.isError).toBe(false)
    expect(result.structuredContent.exitCode).toBe(0)
  })

  it('maps unknown tools to JSON-RPC invalid params', async () => {
    const out = await handleMcpJsonRpc(
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'not_a_tool', arguments: {} } },
      { runtime: runtime(), serverInfo },
    )
    expect(out.kind).toBe('rpc-error')
    if (out.kind !== 'rpc-error') return
    expect(out.body.error).toMatchObject({ code: -32602 })
  })

  it('rejects unknown methods', async () => {
    const out = await handleMcpJsonRpc(
      { jsonrpc: '2.0', id: 6, method: 'resources/list' },
      { runtime: runtime(), serverInfo },
    )
    expect(out.kind).toBe('rpc-error')
    if (out.kind !== 'rpc-error') return
    expect(out.body.error).toMatchObject({ code: -32601 })
  })
})
