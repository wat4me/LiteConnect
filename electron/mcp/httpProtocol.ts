import type { SshMcpToolResult } from '../../shared/mcp/types'
import type { SshMcpRuntime } from './runtime'

export const MCP_PROTOCOL_VERSIONS = [
  '2024-11-05',
  '2025-03-26',
  '2025-11-25',
  '2025-06-18',
  '2026-06-18',
  '2026-07-28',
] as const

export const MCP_DEFAULT_PROTOCOL_VERSION = '2025-11-25'

export const MCP_SERVER_INSTRUCTIONS =
  'LiteConnect SSH tools operate on hosts and sessions in the LiteConnect app. Call list_connections / list_sessions first. Use connect to open a saved host. To add a host, save_connection with host, username, and password or privateKey or useAgent=true; optionally connect=true. Then exec/read_file/write_file with sessionId. Interactive installers and TUIs: pty_open, pty_write, pty_read(mode=screen), pty_close — a dedicated PTY, not the user terminal. Always disconnect when finished. exec is a non-interactive channel; for long tasks use background=true and poll get_job. Destructive and privileged commands are denied by default. Never echo passwords or private keys in later messages.'

export type McpServerInfo = { name: string; version: string }

export type JsonRpcId = string | number | null

export type ProtocolOutcome =
  | { kind: 'response'; body: Record<string, unknown> }
  | { kind: 'notification' }
  | { kind: 'initialize'; body: Record<string, unknown> }
  | { kind: 'rpc-error'; status: number; body: Record<string, unknown> }

export type McpAuditHook = (event: {
  method: string
  tool?: string
  sessionId?: string
  ok: boolean
  code?: string
  class?: string
  commandPreview?: string
}) => void

type RuntimeLike = Pick<SshMcpRuntime, 'listTools' | 'call'>

export async function handleMcpJsonRpc(
  message: unknown,
  ctx: {
    runtime: RuntimeLike
    serverInfo: McpServerInfo
    audit?: McpAuditHook
  },
): Promise<ProtocolOutcome> {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return rpcError(null, -32600, 'Invalid Request')
  }
  const rec = message as Record<string, unknown>
  if (rec.jsonrpc !== '2.0') {
    return rpcError(asId(rec.id), -32600, 'Invalid Request')
  }
  if (typeof rec.method !== 'string' || !rec.method) {
    return rpcError(asId(rec.id), -32600, 'Invalid Request')
  }

  const id = asId(rec.id)
  const isNotification = !('id' in rec) || rec.id === undefined

  if (rec.method === 'notifications/initialized' || rec.method === 'notifications/cancelled') {
    return { kind: 'notification' }
  }

  if (isNotification) {
    return { kind: 'notification' }
  }

  if (rec.method === 'initialize') {
    const params = rec.params && typeof rec.params === 'object' ? (rec.params as Record<string, unknown>) : {}
    const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : ''
    const protocolVersion = (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
      ? requested
      : MCP_DEFAULT_PROTOCOL_VERSION
    return {
      kind: 'initialize',
      body: {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: ctx.serverInfo,
          instructions: MCP_SERVER_INSTRUCTIONS,
        },
      },
    }
  }

  if (rec.method === 'ping') {
    return { kind: 'response', body: { jsonrpc: '2.0', id, result: {} } }
  }

  if (rec.method === 'tools/list') {
    return {
      kind: 'response',
      body: {
        jsonrpc: '2.0',
        id,
        result: { tools: ctx.runtime.listTools() },
      },
    }
  }

  if (rec.method === 'tools/call') {
    const params = rec.params && typeof rec.params === 'object' ? (rec.params as Record<string, unknown>) : {}
    const name = params.name
    const args = params.arguments
    const result = await ctx.runtime.call(name, args)
    const code = (result.structuredContent as { code?: string } | undefined)?.code
    if (result.isError && code === 'UNKNOWN_TOOL') {
      return rpcError(id, -32602, typeof name === 'string' ? `Unknown tool: ${name}` : 'Unknown tool')
    }
    ctx.audit?.({
      method: 'tools/call',
      tool: typeof name === 'string' ? name : undefined,
      sessionId: argString(args, 'sessionId'),
      ok: !result.isError,
      code,
      class: (result.structuredContent as { class?: string } | undefined)?.class,
      commandPreview: previewCommand(argString(args, 'command')),
    })
    return {
      kind: 'response',
      body: {
        jsonrpc: '2.0',
        id,
        result: toCallToolResult(result),
      },
    }
  }

  return rpcError(id, -32601, `Method not found: ${rec.method}`)
}

export function toCallToolResult(result: SshMcpToolResult): {
  content: Array<{ type: 'text'; text: string }>
  structuredContent: unknown
  isError: boolean
} {
  return {
    content: [{ type: 'text', text: result.content }],
    structuredContent: result.structuredContent,
    isError: result.isError,
  }
}

function rpcError(id: JsonRpcId, code: number, message: string): ProtocolOutcome {
  return {
    kind: 'rpc-error',
    status: 200,
    body: {
      jsonrpc: '2.0',
      id,
      error: { code, message },
    },
  }
}

function asId(raw: unknown): JsonRpcId {
  if (typeof raw === 'string' || typeof raw === 'number') return raw
  return null
}

function argString(args: unknown, key: string): string | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined
  const v = (args as Record<string, unknown>)[key]
  return typeof v === 'string' ? v : undefined
}

function previewCommand(command?: string): string | undefined {
  if (!command) return undefined
  return command.replace(/\s+/g, ' ').trim().slice(0, 200)
}