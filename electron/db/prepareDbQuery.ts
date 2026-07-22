/**
 * Shared request preparation for db:query IPC (single gate used by registerDbHandlers).
 * Pure enough to unit-test: validates session id, sanitizes options, enforces readOnly.
 */

import { isValidUUID } from '../utils/validation'
import { assertSqlAllowedInReadOnly, type SqlReadOnlyDialect } from '../../shared/sqlReadOnly'

export type DbQueryIpcOptions = {
  maxRows?: number
  timeoutMs?: number
  queryId?: string
  database?: string
  clientKey?: string
  readOnly?: boolean
}

export type PreparedDbQuery = {
  sessionId: string
  sql: string
  options: {
    maxRows?: number
    timeoutMs?: number
    queryId?: string
    database?: string
    clientKey?: string
  }
}

export type PrepareDbQueryDeps = {
  /** Resolve dialect for readOnly checks; may return null if session missing */
  getDialect: (sessionId: string) => SqlReadOnlyDialect | null
}

/**
 * Sanitize and gate a db:query invocation.
 * Throws on invalid input or read-only violation (before manager.query).
 */
export function prepareDbQueryRequest(
  sessionId: unknown,
  sql: unknown,
  options: DbQueryIpcOptions | undefined,
  deps: PrepareDbQueryDeps,
): PreparedDbQuery {
  if (typeof sessionId !== 'string' || !isValidUUID(sessionId)) {
    throw new Error('Invalid session id')
  }
  if (typeof sql !== 'string') {
    throw new Error('Invalid SQL')
  }
  const clientKey =
    typeof options?.clientKey === 'string' && options.clientKey.trim()
      ? options.clientKey.trim().slice(0, 128)
      : undefined

  if (options?.readOnly === true) {
    const dialect = deps.getDialect(sessionId) || 'mysql'
    assertSqlAllowedInReadOnly(sql, dialect)
  }

  return {
    sessionId,
    sql,
    options: {
      maxRows: options?.maxRows,
      timeoutMs: options?.timeoutMs,
      queryId: options?.queryId,
      database: options?.database,
      clientKey,
    },
  }
}
