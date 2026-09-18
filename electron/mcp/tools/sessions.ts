import { MCP_MIN_IDLE_DISCONNECT_MS } from '../../../shared/mcp/limits'
import type { SshMcpGroup, SshMcpPublicConnection, SshMcpSessionSnapshot, SshMcpToolResult } from '../../../shared/mcp/types'
import { isValidUUID } from '../../utils/validation'
import { parseSaveConnectionInput } from '../saveConnectionInput'
import type { McpRuntimeHost } from '../runtimeHost'

export function listConnections(host: McpRuntimeHost): { connections: SshMcpPublicConnection[] } {
  const open = new Set(host.ssh.listSessionSnapshots().map((s) => s.connectionId))
  const connections = host.connections.listPublicConnections().map((c) => ({
    ...c,
    hasOpenSession: open.has(c.id),
  }))
  return { connections }
}

export function listGroups(host: McpRuntimeHost): { groups: SshMcpGroup[] } {
  const conns = host.connections.listPublicConnections()
  const open = new Set(host.ssh.listSessionSnapshots().map((s) => s.connectionId))
  const groups = host.connections.listGroups().map((g) => {
    const members = conns.filter((c) => c.group === g.id)
    return {
      id: g.id,
      name: g.name,
      connectionCount: members.length,
      openSessionCount: members.filter((c) => open.has(c.id)).length,
      connectionIds: members.map((c) => c.id),
    }
  })
  return { groups }
}

export function listSessions(host: McpRuntimeHost): { sessions: SshMcpSessionSnapshot[] } {
  const byId = new Map(host.connections.listPublicConnections().map((c) => [c.id, c]))
  const now = Date.now()
  const live = new Set<string>()
  const sessions = host.ssh.listSessionSnapshots().map((snap) => {
    live.add(snap.sessionId)
    const conn = byId.get(snap.connectionId)
    const lastToolAt = host.lastToolAt.get(snap.sessionId) ?? null
    return {
      sessionId: snap.sessionId,
      connectionId: snap.connectionId,
      connectionName: snap.connectionName,
      host: conn?.host,
      port: conn?.port,
      username: conn?.username,
      group: conn?.group,
      generation: snap.generation,
      hasSftp: snap.hasSftp,
      healthy: true,
      lastToolAt,
      idleMs: lastToolAt ? Math.max(0, now - lastToolAt) : 0,
    }
  })
  for (const id of [...host.lastToolAt.keys()]) {
    if (!live.has(id)) host.lastToolAt.delete(id)
  }
  return { sessions }
}

export function resolveConnectionId(host: McpRuntimeHost, input: Record<string, unknown>): string | null {
  const rawId = typeof input.connectionId === 'string' ? input.connectionId.trim() : ''
  if (rawId) {
    if (!isValidUUID(rawId)) return ''
    const found = host.connections.listPublicConnections().some((c) => c.id === rawId)
    return found ? rawId : ''
  }
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name) return ''
  const lowered = name.toLowerCase()
  const matches = host.connections.listPublicConnections().filter((c) => {
    if (c.name === name || c.host === name) return true
    if (`${c.username}@${c.host}` === name) return true
    if (c.name.toLowerCase() === lowered) return true
    return false
  })
  if (matches.length === 1) return matches[0].id
  if (matches.length > 1) return null
  return ''
}

export async function connectSaved(host: McpRuntimeHost, input: Record<string, unknown>): Promise<SshMcpToolResult> {
  const connectionId = resolveConnectionId(host, input)
  if (connectionId === null) {
    return host.error(
      'CONNECTION_AMBIGUOUS',
      'name matched more than one saved connection; pass connectionId from list_connections',
    )
  }
  if (!connectionId) {
    return host.error('CONNECTION_NOT_FOUND', 'Pass connectionId from list_connections, or an exact saved name')
  }
  try {
    const opened = await host.ssh.connectSaved(connectionId)
    host.touch(opened.sessionId)
    const snap = host.ssh.getSessionSnapshot(opened.sessionId)
    const conn = host.connections.listPublicConnections().find((c) => c.id === connectionId)
    return host.ok({
      sessionId: opened.sessionId,
      connectionId,
      reused: opened.reused,
      host: conn?.host,
      port: conn?.port,
      username: conn?.username,
      connectionName: snap?.connectionName || conn?.name,
      generation: snap?.generation,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message === 'CONNECT_TIMEOUT') return host.error('CONNECT_TIMEOUT', 'Connect timed out waiting for the app window (host key confirmation may be pending)')
    if (message === 'CONNECT_UNAVAILABLE') return host.error('CONNECT_UNAVAILABLE', 'LiteConnect has no open window to complete the connection')
    if (message === 'CONNECT_FAILED') return host.error('CONNECT_FAILED', 'SSH connect failed')
    return host.error('CONNECT_FAILED', message)
  }
}

export async function saveConnection(host: McpRuntimeHost, input: Record<string, unknown>): Promise<SshMcpToolResult> {
  const parsed = parseSaveConnectionInput(input)
  if (!parsed.ok) return host.error(parsed.code, parsed.message)
  const draft = parsed.value
  try {
    const saved = await host.connections.saveConnection({
      name: draft.name,
      host: draft.host,
      port: draft.port,
      username: draft.username,
      password: draft.password,
      privateKey: draft.privateKey,
      useAgent: draft.useAgent,
      group: draft.group,
      note: draft.note,
    })
    if (!draft.connect) return host.ok(saved)
    const opened = await connectSaved(host, { connectionId: saved.id })
    if (opened.isError) {
      return host.ok({
        ...saved,
        connectError: opened.structuredContent,
      })
    }
    const session = opened.structuredContent as { sessionId?: string; reused?: boolean; generation?: number }
    return host.ok({
      ...saved,
      sessionId: session.sessionId,
      reused: session.reused,
      generation: session.generation,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message === 'CONNECTION_NAME_TAKEN') {
      return host.error(
        'CONNECTION_NAME_TAKEN',
        'A different host is already saved under this name; pick another name',
      )
    }
    return host.error('TOOL_FAILED', message)
  }
}

export function disconnectSessions(host: McpRuntimeHost, input: Record<string, unknown>): SshMcpToolResult {
  const ids = new Set<string>()
  if (typeof input.sessionId === 'string' && input.sessionId.trim()) {
    if (!isValidUUID(input.sessionId)) {
      return host.error('INVALID_SESSION_ID', 'sessionId must be a UUID of an open SSH session')
    }
    ids.add(input.sessionId)
  }
  if (Array.isArray(input.sessionIds)) {
    for (const raw of input.sessionIds) {
      if (typeof raw !== 'string' || !isValidUUID(raw)) {
        return host.error('INVALID_SESSION_ID', 'sessionIds must be UUIDs of open SSH sessions')
      }
      ids.add(raw)
    }
  }
  if (ids.size === 0 && typeof input.idleMs === 'number' && Number.isFinite(input.idleMs)) {
    const minIdle = Math.max(MCP_MIN_IDLE_DISCONNECT_MS, Math.floor(input.idleMs))
    const now = Date.now()
    for (const snap of host.ssh.listSessionSnapshots()) {
      const last = host.lastToolAt.get(snap.sessionId)
      const idle = last != null ? now - last : 0
      if (idle >= minIdle) ids.add(snap.sessionId)
    }
  }
  if (ids.size === 0) {
    return host.error(
      'INVALID_ARGUMENTS',
      'Pass sessionId, sessionIds, or idleMs (>= 60000) to select sessions to close',
    )
  }
  const closed: string[] = []
  const missing: string[] = []
  for (const id of ids) {
    if (!host.ssh.getSessionSnapshot(id)) {
      missing.push(id)
      continue
    }
    host.jobs.cancelForSession(id)
    host.ptys.closeForSession(id)
    host.ssh.disconnectSession(id)
    host.lastToolAt.delete(id)
    closed.push(id)
  }
  return host.ok({ closed, missing, count: closed.length })
}

export function getMetrics(host: McpRuntimeHost, input: Record<string, unknown>): SshMcpToolResult {
  const session = host.requireSession(input.sessionId)
  host.touch(session.sessionId)
  const cached = host.metrics?.getCached(session.sessionId)
  if (!cached) {
    return host.error(
      'MONITOR_NOT_STARTED',
      'No cached metrics for this session. Start the in-app monitor, or use exec with df/free/uptime.',
    )
  }
  return host.ok({ sessionId: session.sessionId, metrics: cached })
}
