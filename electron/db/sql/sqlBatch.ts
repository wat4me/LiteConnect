import {
  applyTxCommand,
  classifyTxStatement,
  previewSql,
  type SqlStatementDialect,
} from '../../../shared/sqlStatement'
import type { DbQueryResult } from '../types'

export type SqlBatchRun = {
  result: DbQueryResult
  inTransaction: boolean
}

/**
 * Run already-split statements sequentially on one physical connection.
 * On failure, rolls back only when this batch opened the transaction (not a UI pin).
 */
export async function runSqlBatch(opts: {
  statements: string[]
  dialect: SqlStatementDialect
  startedInTransaction: boolean
  executeOne: (sql: string) => Promise<DbQueryResult>
  rollback: () => Promise<void>
}): Promise<SqlBatchRun> {
  const { statements, dialect, startedInTransaction, executeOne, rollback } = opts
  let inTransaction = startedInTransaction
  const batchStart = Date.now()
  let last: DbQueryResult | null = null
  let lastResultSet: DbQueryResult | null = null
  let affectedSum = 0
  let successCount = 0

  for (let i = 0; i < statements.length; i++) {
    const sql = statements[i]
    const cmd = classifyTxStatement(sql, dialect)
    try {
      const r = await executeOne(sql)
      successCount += 1
      last = r
      if (r.hasResultSet) lastResultSet = r
      if (typeof r.affectedRows === 'number') affectedSum += r.affectedRows
      inTransaction = applyTxCommand(inTransaction, cmd)
    } catch (err) {
      if (inTransaction && !startedInTransaction) {
        try {
          await rollback()
        } catch {}
        inTransaction = false
      }
      throw wrapSqlBatchError(err, i, statements.length, sql)
    }
  }

  const display = lastResultSet ?? last ?? emptyResult(Date.now() - batchStart)
  return {
    inTransaction,
    result: {
      ...display,
      durationMs: Date.now() - batchStart,
      affectedRows: display.hasResultSet ? display.affectedRows : affectedSum,
      truncated: !!lastResultSet?.truncated,
      batch: {
        statementCount: statements.length,
        successCount,
      },
    },
  }
}

function emptyResult(durationMs: number): DbQueryResult {
  return {
    columns: [],
    rows: [],
    rowCount: 0,
    truncated: false,
    durationMs,
    hasResultSet: false,
  }
}

export function wrapSqlBatchError(
  err: unknown,
  index: number,
  count: number,
  sql: string,
): Error {
  const preview = previewSql(sql)
  const causeMsg = err instanceof Error ? err.message : String(err)
  const wrapped = new Error(
    `Statement ${index + 1} of ${count} failed (${preview}): ${causeMsg}`,
  ) as Error & Record<string, unknown>
  wrapped.name = 'SqlBatchExecuteError'
  wrapped.statementIndex = index
  wrapped.statementCount = count
  wrapped.statementPreview = preview
  wrapped.cause = err
  const src = err as Record<string, unknown> | null
  if (src && typeof src === 'object') {
    if (src.errno != null) wrapped.errno = src.errno
    if (src.code != null) wrapped.code = src.code
    if (src.sqlState != null) wrapped.sqlState = src.sqlState
    if (src.sqlMessage != null) wrapped.sqlMessage = src.sqlMessage
  }
  return wrapped
}

export function isSqlBatchExecuteError(err: unknown): err is Error & {
  statementIndex: number
  statementCount: number
  statementPreview: string
} {
  return (
    !!err
    && typeof err === 'object'
    && (err as { name?: string }).name === 'SqlBatchExecuteError'
  )
}
