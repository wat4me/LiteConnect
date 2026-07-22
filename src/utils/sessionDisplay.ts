import type { Connection } from '../env.d'
import type { Session } from '../composables/useSessionManager'
import type { BatchCommandTarget } from '../composables/useBatchCommand'

export function getTerminalLabel(session: Session | null | undefined): string {
  return session ? `终端 ${session.tabNumber}` : ''
}

export function getSshAddress(
  connections: Connection[],
  connectionId: string,
): string {
  const connection = connections.find((c) => c.id === connectionId)
  if (!connection) return ''
  return `${connection.username}@${connection.host}:${connection.port}`
}

export function getSessionSshAddress(
  connections: Connection[],
  session: Session | null | undefined,
): string {
  if (!session) return ''
  return getSshAddress(connections, session.connectionId)
}

export function getSessionDisplayName(session: Session | null | undefined): string {
  if (!session) return ''
  return `${session.connectionName} · ${getTerminalLabel(session)}`
}

export function buildBatchSessionTarget(
  connections: Connection[],
  session: Session,
): BatchCommandTarget {
  const connection = connections.find((c) => c.id === session.connectionId)
  return {
    id: session.id,
    connectionName: session.connectionName,
    sshAddress: getSshAddress(connections, session.connectionId),
    tabNumber: session.tabNumber,
    terminalLabel: getTerminalLabel(session),
    displayName: getSessionDisplayName(session),
    host: connection?.host,
    user: connection?.username,
    port: connection?.port,
    connectionId: session.connectionId,
  }
}

/** Connection context for command-snippet variable substitution */
export function getSnippetContext(
  connections: Connection[],
  connectionId: string | null | undefined,
): { host: string; user: string; port: number; name: string } | null {
  if (!connectionId) return null
  const connection = connections.find((c) => c.id === connectionId)
  if (!connection) return null
  return {
    host: connection.host,
    user: connection.username,
    port: connection.port,
    name: connection.name,
  }
}
