import type { FieldPacket, RowDataPacket } from 'mysql2/promise'
import {
  assertIdent,
  DEFAULT_QUERY_TIMEOUT_MS,
  quoteIdentMysql,
  serializeCell,
} from '../common'
import { buildWhereClauseMysql } from '../browse/browseFilter'
import {
  browseCountCacheKey,
  browseHasFilter,
  finalizeBrowsePage,
} from '../browse/browsePagination'
import type {
  DbBrowseOptions,
  DbColumnInfo,
  DbIndexInfo,
  DbTableBrowseResult,
  DbTableInfo,
} from '../types'
import type { LiveSession, MysqlBrowseHost } from './mysqlTypes'

export async function listDatabases(host: MysqlBrowseHost, sessionId: string): Promise<string[]> {
  const session = host.requireSession(sessionId)
  const [rows] = await session.pool.query<RowDataPacket[]>('SHOW DATABASES')
  return rows.map((r) => String(r.Database ?? Object.values(r)[0] ?? '')).filter(Boolean)
}

export async function listTableInfos(
  host: MysqlBrowseHost,
  sessionId: string,
  database?: string,
): Promise<DbTableInfo[]> {
  const session = host.requireSession(sessionId)
  const schema = database || session.database
  if (!schema) {
    const [rows] = await session.pool.query<RowDataPacket[]>('SHOW FULL TABLES')
    return rows
      .map((r) => {
        const vals = Object.values(r)
        const name = String(vals[0] ?? '')
        const typeRaw = String(vals[1] ?? 'BASE TABLE').toUpperCase()
        return {
          name,
          type: typeRaw.includes('VIEW') ? ('view' as const) : ('table' as const),
          engine: null,
          rows: null,
          comment: '',
        }
      })
      .filter((t) => t.name)
  }

  const [rows] = await session.pool.query<RowDataPacket[]>(
    `SELECT TABLE_NAME AS name, TABLE_TYPE AS tableType, ENGINE AS engine,
            TABLE_ROWS AS rowEstimate, TABLE_COMMENT AS comment
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ?
     ORDER BY TABLE_TYPE, TABLE_NAME`,
    [schema],
  )
  return rows
    .map((r) => ({
      name: String(r.name || ''),
      type: String(r.tableType || '').toUpperCase().includes('VIEW')
        ? ('view' as const)
        : ('table' as const),
      engine: r.engine != null ? String(r.engine) : null,
      rows: r.rowEstimate != null && r.rowEstimate !== '' ? Number(r.rowEstimate) : null,
      comment: r.comment != null ? String(r.comment) : '',
    }))
    .filter((t) => t.name)
}

export async function getTableColumns(
  host: MysqlBrowseHost,
  sessionId: string,
  database: string,
  table: string,
): Promise<DbColumnInfo[]> {
  const session = host.requireSession(sessionId)
  assertIdent(database)
  assertIdent(table)
  const [rows] = await session.pool.query<RowDataPacket[]>(
    `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable,
            COLUMN_KEY AS colKey, COLUMN_DEFAULT AS defaultValue, EXTRA AS extra,
            COLUMN_COMMENT AS comment
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
     ORDER BY ORDINAL_POSITION`,
    [database, table],
  )
  return rows.map((r) => ({
    name: String(r.name || ''),
    type: String(r.type || ''),
    nullable: String(r.nullable || '').toUpperCase() === 'YES',
    key: String(r.colKey || ''),
    defaultValue: r.defaultValue === undefined ? null : (r.defaultValue as string | null),
    extra: String(r.extra || ''),
    comment: String(r.comment || ''),
  }))
}

export async function getTableIndexes(
  host: MysqlBrowseHost,
  sessionId: string,
  database: string,
  table: string,
): Promise<DbIndexInfo[]> {
  const session = host.requireSession(sessionId)
  assertIdent(database)
  assertIdent(table)
  const [rows] = await session.pool.query<RowDataPacket[]>(
    `SELECT INDEX_NAME AS name, COLUMN_NAME AS colName, NON_UNIQUE AS nonUnique,
            SEQ_IN_INDEX AS seq, INDEX_TYPE AS indexType, INDEX_COMMENT AS comment
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
     ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
    [database, table],
  )
  const map = new Map<string, DbIndexInfo>()
  for (const r of rows) {
    const name = String(r.name || '')
    if (!name) continue
    let idx = map.get(name)
    if (!idx) {
      idx = {
        name,
        columns: [],
        unique: Number(r.nonUnique) === 0,
        primary: name === 'PRIMARY',
        type: String(r.indexType || ''),
        comment: r.comment != null ? String(r.comment) : '',
      }
      map.set(name, idx)
    }
    const col = String(r.colName || '')
    if (col) idx.columns.push(col)
  }
  return [...map.values()]
}

export async function getCreateTable(
  host: MysqlBrowseHost,
  sessionId: string,
  database: string,
  table: string,
): Promise<string> {
  const session = host.requireSession(sessionId)
  assertIdent(database)
  assertIdent(table)
  const fq = `${quoteIdentMysql(database)}.${quoteIdentMysql(table)}`
  const [rows] = await session.pool.query<RowDataPacket[]>(`SHOW CREATE TABLE ${fq}`)
  const row = rows[0] || {}
  return String(row['Create Table'] ?? row['Create View'] ?? Object.values(row)[1] ?? '')
}

export async function browseTable(
  host: MysqlBrowseHost,
  sessionId: string,
  database: string,
  table: string,
  page = 1,
  pageSize = 100,
  options?: DbBrowseOptions,
): Promise<DbTableBrowseResult> {
  const session = host.requireSession(sessionId)
  assertIdent(database)
  assertIdent(table)
  const safePage = Math.max(1, Math.floor(page) || 1)
  const safeSize = Math.min(Math.max(Math.floor(pageSize) || 100, 1), 500)
  const offset = (safePage - 1) * safeSize
  const fq = `${quoteIdentMysql(database)}.${quoteIdentMysql(table)}`

  const where = buildWhereClauseMysql(options)

  let orderClause = ''
  if (options?.orderBy) {
    assertIdent(options.orderBy)
    const dir = options.orderDir === 'desc' ? 'DESC' : 'ASC'
    orderClause = ` ORDER BY ${quoteIdentMysql(options.orderBy)} ${dir}`
  }

  const start = Date.now()
  const hasFilter = browseHasFilter(options)
  const cacheKey = browseCountCacheKey(sessionId, database, table, options)
  const exactTotal = host.countCache.get(cacheKey)

  const [result, fields] = await session.pool.query({
    sql: `SELECT * FROM ${fq}${where.clause}${orderClause} LIMIT ${safeSize + 1} OFFSET ${offset}`,
    timeout: DEFAULT_QUERY_TIMEOUT_MS,
    values: where.params,
  })
  const durationMs = Date.now() - start
  const rows = result as RowDataPacket[]
  const fieldList = (fields || []) as FieldPacket[]
  const columns = fieldList.map((f) => f.name)
  const mapped = rows.map((row) => {
    const out: Record<string, unknown> = {}
    for (const col of columns) out[col] = serializeCell((row as any)[col], { column: col })
    return out
  })

  if (exactTotal == null && !hasFilter) {
    let estimatedTotal: number | null = null
    try {
      const [estRows] = await session.pool.query<RowDataPacket[]>(
        `SELECT TABLE_ROWS AS c FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? LIMIT 1`,
        [database, table],
      )
      if (estRows[0]?.c != null && estRows[0].c !== '') {
        estimatedTotal = Number(estRows[0].c)
      }
    } catch {
      estimatedTotal = null
    }
    void warmExactCount(host, session, cacheKey, fq, where.clause, where.params)
    return finalizeBrowsePage({
      rows: mapped,
      columns,
      page: safePage,
      pageSize: safeSize,
      durationMs,
      exactTotal: null,
      estimatedTotal,
      hasFilter: false,
    })
  }

  if (exactTotal == null && hasFilter) {
    void warmExactCount(host, session, cacheKey, fq, where.clause, where.params)
    return finalizeBrowsePage({
      rows: mapped,
      columns,
      page: safePage,
      pageSize: safeSize,
      durationMs,
      exactTotal: null,
      estimatedTotal: null,
      hasFilter: true,
    })
  }

  return finalizeBrowsePage({
    rows: mapped,
    columns,
    page: safePage,
    pageSize: safeSize,
    durationMs,
    exactTotal,
    estimatedTotal: null,
    hasFilter,
  })
}

export async function warmExactCount(
  host: MysqlBrowseHost,
  session: LiveSession,
  cacheKey: string,
  fq: string,
  whereClause: string,
  whereParams: unknown[],
): Promise<void> {
  if (host.countCache.get(cacheKey) != null) return
  if (host.countWarmInflight.has(cacheKey)) return
  host.countWarmInflight.add(cacheKey)
  try {
    if (!host.sessions.has(session.id) || host.sessions.get(session.id) !== session) return
    const [countRows] = await session.pool.query<RowDataPacket[]>({
      sql: `SELECT COUNT(*) AS c FROM ${fq}${whereClause}`,
      timeout: DEFAULT_QUERY_TIMEOUT_MS,
      values: whereParams,
    })
    if (!host.sessions.has(session.id) || host.sessions.get(session.id) !== session) return
    const total = Number(countRows[0]?.c ?? 0)
    if (Number.isFinite(total) && total >= 0) {
      host.countCache.set(cacheKey, total)
    }
  } catch {
    // background count is best-effort; never throw to caller
  } finally {
    host.countWarmInflight.delete(cacheKey)
  }
}
