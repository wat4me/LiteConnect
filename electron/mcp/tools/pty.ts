import type { SshMcpToolResult } from '../../../shared/mcp/types'
import type { McpRuntimeHost } from '../runtimeHost'

export async function ptyOpen(host: McpRuntimeHost, input: Record<string, unknown>): Promise<SshMcpToolResult> {
  const session = host.requireSession(input.sessionId)
  const opened = await host.ptys.open({
    sessionId: session.sessionId,
    generation: session.generation,
    cols: typeof input.cols === 'number' ? input.cols : undefined,
    rows: typeof input.rows === 'number' ? input.rows : undefined,
  })
  host.touch(session.sessionId)
  return host.ok({
    ...opened,
    sessionId: session.sessionId,
    hint: 'Poll with pty_read(mode=screen, waitForIdleMs=300) after pty_write. Close with pty_close. This PTY is not the user-visible terminal.',
  })
}

export function ptyWrite(host: McpRuntimeHost, input: Record<string, unknown>): SshMcpToolResult {
  const ptyId = typeof input.ptyId === 'string' ? input.ptyId.trim() : ''
  if (!ptyId) return host.error('INVALID_ARGUMENTS', 'ptyId is required')
  if (typeof input.data !== 'string') return host.error('INVALID_ARGUMENTS', 'data is required')
  host.ptys.write(ptyId, input.data, input.raw === true)
  host.touch(host.ptys.list().find((p) => p.ptyId === ptyId)?.sessionId || '')
  return host.ok({ ptyId, bytes: input.data.length, raw: input.raw === true })
}

export async function ptyRead(host: McpRuntimeHost, input: Record<string, unknown>): Promise<SshMcpToolResult> {
  const ptyId = typeof input.ptyId === 'string' ? input.ptyId.trim() : ''
  if (!ptyId) return host.error('INVALID_ARGUMENTS', 'ptyId is required')
  const result = await host.ptys.read(ptyId, {
    mode: input.mode === 'snapshot' || input.mode === 'screen' ? input.mode : 'streaming',
    waitForIdleMs: typeof input.waitForIdleMs === 'number' ? input.waitForIdleMs : undefined,
    maxBytes: typeof input.maxBytes === 'number' ? input.maxBytes : undefined,
  })
  return host.ok(result)
}

export function ptyResize(host: McpRuntimeHost, input: Record<string, unknown>): SshMcpToolResult {
  const ptyId = typeof input.ptyId === 'string' ? input.ptyId.trim() : ''
  if (!ptyId) return host.error('INVALID_ARGUMENTS', 'ptyId is required')
  if (typeof input.cols !== 'number' || typeof input.rows !== 'number') {
    return host.error('INVALID_ARGUMENTS', 'cols and rows are required')
  }
  const size = host.ptys.resize(ptyId, input.cols, input.rows)
  return host.ok({ ptyId, ...size })
}

export function ptyClose(host: McpRuntimeHost, input: Record<string, unknown>): SshMcpToolResult {
  const ptyId = typeof input.ptyId === 'string' ? input.ptyId.trim() : ''
  if (!ptyId) return host.error('INVALID_ARGUMENTS', 'ptyId is required')
  const ok = host.ptys.close(ptyId)
  if (!ok) return host.error('PTY_NOT_FOUND', 'No agent PTY with that id')
  return host.ok({ ptyId, closed: true })
}
