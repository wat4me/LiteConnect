/** Editor run-scope helpers. Statement splitting lives in @shared/sqlStatement. */

export type {
  SqlStatementDialect,
  SqlStatementRange,
  SplitSqlResult,
} from '@shared/sqlStatement'
export {
  readDollarTag,
  isLineCommentStart,
  splitSqlStatementsDetailed,
  splitSqlStatements,
  isSqlLexicallyAmbiguous,
} from '@shared/sqlStatement'

import {
  isSqlLexicallyAmbiguous,
  splitSqlStatementsDetailed,
  type SqlStatementDialect,
  type SqlStatementRange,
} from '@shared/sqlStatement'

export type RunScope = 'selection' | 'statement' | 'all'

export type ResolveRunSqlInput = {
  sql: string
  selectionStart: number
  selectionEnd: number
  /** Preferred scope; omit for default (selection if non-empty, else statement) */
  scope?: RunScope
  /** SQL dialect for comment rules; default mysql */
  dialect?: SqlStatementDialect
}

export type ResolveRunSqlReason =
  | 'empty'
  | 'no-selection'
  | 'no-statement'
  | 'ambiguous'

export type ResolveRunSqlResult = {
  sql: string
  scope: RunScope
  /** True when resolution could not safely honor the requested scope */
  fallback: boolean
  reason?: ResolveRunSqlReason
}

function normalizeDialect(d?: SqlStatementDialect): SqlStatementDialect {
  if (d === 'postgres' || d === 'oracle') return d
  return 'mysql'
}

/**
 * Find the statement that contains cursor.
 * Returns null when SQL is empty, ambiguous, or no statement found.
 */
export function findStatementAtCursor(
  sql: string,
  cursor: number,
  dialect: SqlStatementDialect = 'mysql',
): SqlStatementRange | null {
  const { ranges, ambiguous } = splitSqlStatementsDetailed(sql, dialect)
  if (ambiguous || ranges.length === 0) return null
  const pos = Math.max(0, Math.min(cursor, sql.length))

  for (const r of ranges) {
    if (pos >= r.start && pos <= r.end) return r
  }
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i]
    const next = ranges[i + 1]
    if (pos > r.end && (!next || pos < next.start)) {
      return next || r
    }
  }
  if (pos < ranges[0].start) return ranges[0]
  return ranges[ranges.length - 1]
}

/**
 * Resolve SQL text for a run action.
 * - selection (explicit): requires non-empty selection; else empty + no-selection
 * - statement: lexical current statement; ambiguous → empty + ambiguous (no silent mis-exec)
 * - all: full editor text (even if ambiguous — user asked for all)
 * - default (scope omitted): selection if non-empty, else statement rules
 */
export function resolveRunSql(input: ResolveRunSqlInput): ResolveRunSqlResult {
  const dialect = normalizeDialect(input.dialect)
  const sql = input.sql ?? ''
  const selStart = Math.max(0, Math.min(input.selectionStart, sql.length))
  const selEnd = Math.max(0, Math.min(input.selectionEnd, sql.length))
  const hasSelection = selEnd > selStart && sql.slice(selStart, selEnd).trim().length > 0
  const explicit = input.scope !== undefined
  const scope: RunScope = input.scope ?? (hasSelection ? 'selection' : 'statement')

  if (scope === 'selection') {
    if (!hasSelection) {
      if (explicit) {
        return {
          sql: '',
          scope: 'selection',
          fallback: false,
          reason: 'no-selection',
        }
      }
      return {
        sql: '',
        scope: 'selection',
        fallback: false,
        reason: 'no-selection',
      }
    }
    return {
      sql: sql.slice(selStart, selEnd).trim(),
      scope: 'selection',
      fallback: false,
    }
  }

  if (scope === 'all') {
    const text = sql.trim()
    if (!text) return { sql: '', scope: 'all', fallback: false, reason: 'empty' }
    return { sql: text, scope: 'all', fallback: false }
  }

  // statement
  if (!sql.trim()) {
    return { sql: '', scope: 'statement', fallback: false, reason: 'empty' }
  }

  const { ambiguous } = splitSqlStatementsDetailed(sql, dialect)
  if (ambiguous) {
    return {
      sql: '',
      scope: 'statement',
      fallback: false,
      reason: 'ambiguous',
    }
  }

  const cursor = hasSelection ? selStart : selEnd
  const stmt = findStatementAtCursor(sql, cursor, dialect)
  if (!stmt || !stmt.text) {
    return {
      sql: '',
      scope: 'statement',
      fallback: false,
      reason: 'no-statement',
    }
  }
  return { sql: stmt.text, scope: 'statement', fallback: false }
}

/** Default primary run button: selection | statement | all */
export function defaultRunScope(
  hasSelection: boolean,
  canLocateStatement: boolean,
): RunScope {
  if (hasSelection) return 'selection'
  if (canLocateStatement) return 'statement'
  return 'all'
}

/** Whether current-statement run is safe for this SQL. */
export function canRunCurrentStatement(
  sql: string,
  cursor: number,
  dialect: SqlStatementDialect = 'mysql',
): boolean {
  if (!sql.trim()) return false
  if (isSqlLexicallyAmbiguous(sql, dialect)) return false
  return !!findStatementAtCursor(sql, cursor, dialect)
}
