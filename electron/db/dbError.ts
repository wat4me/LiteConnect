import { sanitizeCancelError } from './common'
import type { DbEngine } from './types'

/**
 * Structured DB errors (DB-010).
 * Sensitive material is stripped from summary/detail before IPC/renderer.
 */

export type DbErrorCategory =
  | 'auth'
  | 'refused'
  | 'timeout'
  | 'tunnel'
  | 'session'
  | 'permission'
  | 'syntax'
  | 'query_timeout'
  | 'cancel'
  | 'deadlock'
  | 'serialization'
  | 'unknown'

export type DbStructuredError = {
  /** Stable category for UI / i18n */
  category: DbErrorCategory
  /** Short safe summary (no secrets) */
  summary: string
  /** Optional longer technical detail (sanitized) */
  detail?: string
  /** Driver errno / SQLSTATE if known */
  code?: string
  /** Whether a user retry may help */
  retryable: boolean
  /** Marker for Electron serialize / renderer detection */
  name: 'DbStructuredError'
}

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/(password|pwd|passwd|passphrase)\s*[:=]\s*([^\s;,'"]+)/gi, '$1=***'],
  [/(password|pwd|passwd)\s*=\s*[^;\s]+/gi, '$1=***'],
  [/(:\/\/)([^/@\s:]+):([^@/\s]+)@/g, '$1***:***@'],
  [/:\/\/[^@\s]+@/g, '://***@'],
  [/(-----BEGIN[^-]+PRIVATE KEY-----)[\s\S]*?(-----END[^-]+PRIVATE KEY-----)/gi, '$1***$2'],
  [/\b(ssh-rsa|ssh-ed25519|ecdsa-sha2-nistp\d+)\s+[A-Za-z0-9+/=]{20,}/g, '$1 ***'],
  // mysql connection string fragments
  [/\buser\s*=\s*[^;\s]+/gi, 'user=***'],
]

/** Aggressive sanitize for any string that may leave main process. */
export function sanitizeDbErrorText(raw: unknown, maxLen = 500): string {
  let s = String(raw ?? 'Unknown error')
  for (const [re, rep] of SECRET_PATTERNS) {
    s = s.replace(re, rep)
  }
  // Redact host:port@user style leftovers carefully — keep host if no credentials
  if (s.length > maxLen) s = s.slice(0, maxLen) + '…'
  return s
}

function pickCode(err: any): string | undefined {
  if (!err || typeof err !== 'object') return undefined
  if (typeof err.code === 'string' && err.code) return err.code
  if (typeof err.errno === 'number') return String(err.errno)
  if (typeof err.sqlState === 'string' && err.sqlState) return err.sqlState
  return undefined
}

function msgOf(err: any): string {
  if (!err) return ''
  if (typeof err === 'string') return err
  return String(err.message || err.detail || err || '')
}

export function isDbStructuredError(err: unknown): err is DbStructuredError {
  return (
    !!err
    && typeof err === 'object'
    && (err as any).name === 'DbStructuredError'
    && typeof (err as any).category === 'string'
  )
}

export function classifyDbError(
  err: unknown,
  engine?: DbEngine | string,
  hints?: { viaTunnel?: boolean },
): DbStructuredError {
  if (isDbStructuredError(err)) {
    return {
      ...err,
      summary: sanitizeDbErrorText(err.summary, 200),
      detail: err.detail ? sanitizeDbErrorText(err.detail) : undefined,
    }
  }

  const e = err as any
  const code = pickCode(e)
  const rawMsg = msgOf(e)
  const lower = rawMsg.toLowerCase()
  const errno = typeof e?.errno === 'number' ? e.errno : undefined
  const sqlState = typeof e?.sqlState === 'string' ? e.sqlState : typeof e?.code === 'string' && /^\d{5}$/.test(e.code) ? e.code : undefined

  // Cancel (explicit marker or interrupt; PG 57014 alone may be statement_timeout)
  if (
    code === 'QUERY_CANCELLED'
    || errno === 1317
    || code === 'ER_QUERY_INTERRUPTED'
    || /query.?cancel|cancelled by user|query was canceled|canceling statement due to user request/i.test(rawMsg)
  ) {
    return {
      name: 'DbStructuredError',
      category: 'cancel',
      summary: 'Query cancelled',
      detail: sanitizeDbErrorText(rawMsg),
      code: code || 'QUERY_CANCELLED',
      retryable: false,
    }
  }

  // Auth
  if (
    errno === 1045
    || code === 'ER_ACCESS_DENIED_ERROR'
    || code === '28P01'
    || code === '28000'
    || /access denied|authentication failed|password authentication failed|invalid password|auth.?fail/i.test(rawMsg)
  ) {
    return {
      name: 'DbStructuredError',
      category: 'auth',
      summary: 'Authentication failed',
      detail: sanitizeDbErrorText(rawMsg),
      code: code || String(errno ?? ''),
      retryable: false,
    }
  }

  // Permission
  if (
    errno === 1142
    || errno === 1227
    || code === 'ER_TABLEACCESS_DENIED_ERROR'
    || code === 'ER_SPECIFIC_ACCESS_DENIED_ERROR'
    || code === '42501'
    || /permission denied|access denied for|insufficient privilege|must be owner/i.test(rawMsg)
  ) {
    return {
      name: 'DbStructuredError',
      category: 'permission',
      summary: 'Permission denied',
      detail: sanitizeDbErrorText(rawMsg),
      code: code || String(errno ?? ''),
      retryable: false,
    }
  }

  // Syntax
  if (
    errno === 1064
    || code === 'ER_PARSE_ERROR'
    || code === 'ER_SYNTAX_ERROR'
    || code === '42601'
    || code === '42000'
    || /syntax error|parse error near|you have an error in your sql/i.test(rawMsg)
  ) {
    return {
      name: 'DbStructuredError',
      category: 'syntax',
      summary: 'SQL syntax error',
      detail: sanitizeDbErrorText(rawMsg),
      code: code || String(errno ?? ''),
      retryable: false,
    }
  }

  // Deadlock
  if (
    errno === 1213
    || code === 'ER_LOCK_DEADLOCK'
    || code === '40P01'
    || /deadlock/i.test(rawMsg)
  ) {
    return {
      name: 'DbStructuredError',
      category: 'deadlock',
      summary: 'Deadlock detected',
      detail: sanitizeDbErrorText(rawMsg),
      code: code || String(errno ?? ''),
      retryable: true,
    }
  }

  // Serialization failure
  if (code === '40001' || /could not serialize|serialization failure|concurrent update/i.test(rawMsg)) {
    return {
      name: 'DbStructuredError',
      category: 'serialization',
      summary: 'Serialization conflict',
      detail: sanitizeDbErrorText(rawMsg),
      code: code || '40001',
      retryable: true,
    }
  }

  // Query timeout (statement_timeout / max_execution_time)
  if (
    errno === 3024
    || code === 'ER_QUERY_TIMEOUT'
    || code === 'HYT00'
    || code === '57014'
    || /statement timeout|query execution was interrupted|canceling statement due to statement timeout|max_execution_time/i.test(rawMsg)
  ) {
    return {
      name: 'DbStructuredError',
      category: 'query_timeout',
      summary: 'Query timed out',
      detail: sanitizeDbErrorText(rawMsg),
      code: code || String(errno ?? ''),
      retryable: true,
    }
  }

  // Connection refused / unreachable
  if (
    code === 'ECONNREFUSED'
    || code === 'ENOTFOUND'
    || code === 'EHOSTUNREACH'
    || code === 'ENETUNREACH'
    || errno === 'ECONNREFUSED'
    || /econnrefused|connection refused|getaddrinfo|no route to host|could not connect to server/i.test(rawMsg)
  ) {
    return {
      name: 'DbStructuredError',
      category: 'refused',
      summary: 'Connection refused',
      detail: sanitizeDbErrorText(rawMsg),
      code: code || 'ECONNREFUSED',
      retryable: true,
    }
  }

  // Connect / socket timeout
  if (
    code === 'ETIMEDOUT'
    || code === 'ESOCKETTIMEDOUT'
    || code === 'PROTOCOL_CONNECTION_LOST'
    || /connect etimedout|connection timed out|timeout expired|handshake timeout/i.test(rawMsg)
  ) {
    return {
      name: 'DbStructuredError',
      category: 'timeout',
      summary: 'Connection timed out',
      detail: sanitizeDbErrorText(rawMsg),
      code: code || 'ETIMEDOUT',
      retryable: true,
    }
  }

  // Session lost / server gone
  if (
    errno === 2006
    || errno === 2013
    || code === 'PROTOCOL_CONNECTION_LOST'
    || code === '57P01'
    || code === '57P02'
    || code === '57P03'
    || code === '08006'
    || code === '08003'
    || /server has gone away|connection lost|connection terminated|not connected|session not found|database session not found/i.test(rawMsg)
  ) {
    return {
      name: 'DbStructuredError',
      category: 'session',
      summary: 'Database session lost',
      detail: sanitizeDbErrorText(rawMsg),
      code: code || String(errno ?? ''),
      retryable: true,
    }
  }

  // Tunnel
  if (
    hints?.viaTunnel
    || /ssh tunnel|tunnel closed|tunnel error|jump host|forwarded port/i.test(rawMsg)
  ) {
    if (
      /tunnel|ssh|jump/i.test(rawMsg)
      || hints?.viaTunnel && /closed|econnreset|broken pipe|socket hang up/i.test(rawMsg)
    ) {
      return {
        name: 'DbStructuredError',
        category: 'tunnel',
        summary: 'SSH tunnel disconnected',
        detail: sanitizeDbErrorText(rawMsg),
        code: code,
        retryable: true,
      }
    }
  }

  if (/econnreset|broken pipe|socket hang up/i.test(rawMsg)) {
    return {
      name: 'DbStructuredError',
      category: hints?.viaTunnel ? 'tunnel' : 'session',
      summary: hints?.viaTunnel ? 'SSH tunnel disconnected' : 'Connection reset',
      detail: sanitizeDbErrorText(rawMsg),
      code: code,
      retryable: true,
    }
  }

  void engine
  void lower
  void sqlState

  return {
    name: 'DbStructuredError',
    category: 'unknown',
    summary: sanitizeDbErrorText(rawMsg, 160) || 'Database error',
    detail: sanitizeDbErrorText(rawMsg),
    code: code,
    retryable: false,
  }
}

/** Throw-friendly Error that serializes category via message + custom props for IPC. */
export function toIpcDbError(err: unknown, engine?: DbEngine | string, hints?: { viaTunnel?: boolean }): Error {
  const structured = classifyDbError(err, engine, hints)
  const e = new Error(structured.summary) as Error & {
    category: DbErrorCategory
    detail?: string
    retryable: boolean
    dbCode?: string
    name: string
  }
  e.name = 'DbStructuredError'
  e.category = structured.category
  e.detail = structured.detail
  e.retryable = structured.retryable
  e.dbCode = structured.code
  // Also attach for electron structured clone if supported
  ;(e as any).code = structured.code
  return e
}

/** Keep cancel path using shared sanitizer. */
export function sanitizeForLog(raw: unknown): string {
  return sanitizeDbErrorText(raw, 300) || sanitizeCancelError(String(raw || ''))
}
