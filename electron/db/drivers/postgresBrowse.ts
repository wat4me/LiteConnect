import type { Pool } from 'pg'
import {
  assertIdent,
  DEFAULT_QUERY_TIMEOUT_MS,
  quoteIdentPostgres,
  serializeCell,
} from '../common'
import { buildWhereClausePg } from '../browse/browseFilter'
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
import { parseTableRef, withStatementTimeout } from './postgresHelpers'
import type { LiveSession, PostgresBrowseHost } from './postgresTypes'

export async function listDatabases(host: PostgresBrowseHost, sessionId: string): Promise<string[]> {
  const { pool } = await host.getPool(sessionId)
  const res = await pool.query<{ name: string }>(
    `SELECT datname AS name
     FROM pg_database
     WHERE datistemplate = false
     ORDER BY datname`,
  )
  return res.rows.map((r) => String(r.name || '')).filter(Boolean)
}

export async function listTableInfos(
  host: PostgresBrowseHost,
  sessionId: string,
  database?: string,
): Promise<DbTableInfo[]> {
  const { pool } = await host.getPool(sessionId, database)

  const res = await pool.query<{
    schema: string
    name: string
    tableType: string
    comment: string | null
  }>(
    `SELECT n.nspname AS schema,
            c.relname AS name,
            CASE c.relkind
              WHEN 'v' THEN 'VIEW'
              WHEN 'm' THEN 'VIEW'
              ELSE 'BASE TABLE'
            END AS "tableType",
            COALESCE(obj_description(c.oid, 'pg_class'), '') AS comment
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r', 'p', 'v', 'm')
       AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
       AND n.nspname NOT LIKE 'pg_temp_%'
       AND n.nspname NOT LIKE 'pg_toast_temp_%'
     ORDER BY CASE c.relkind WHEN 'v' THEN 1 WHEN 'm' THEN 1 ELSE 0 END, n.nspname, c.relname`,
  )

  return res.rows
    .map((r) => {
      const schema = String(r.schema || 'public')
      const name = String(r.name || '')
      if (!name) return null
      const display = schema === 'public' ? name : `${schema}.${name}`
      const typeRaw = String(r.tableType || '').toUpperCase()
      return {
        name: display,
        type: typeRaw.includes('VIEW') ? ('view' as const) : ('table' as const),
        engine: null,
        rows: null,
        comment: r.comment != null ? String(r.comment) : '',
      }
    })
    .filter((t): t is DbTableInfo => !!t)
}

export async function getTableColumns(
  host: PostgresBrowseHost,
  sessionId: string,
  database: string,
  table: string,
): Promise<DbColumnInfo[]> {
  const { pool } = await host.getPool(sessionId, database)
  const { schema, table: tableName } = parseTableRef(table)

  const res = await pool.query<{
    name: string
    type: string
    nullable: string
    colKey: string
    defaultValue: string | null
    extra: string
    comment: string
  }>(
    `SELECT
       a.attname AS name,
       pg_catalog.format_type(a.atttypid, a.atttypmod) AS type,
       CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS nullable,
       CASE
         WHEN EXISTS (
           SELECT 1
           FROM pg_index i
           WHERE i.indrelid = a.attrelid
             AND i.indisprimary
             AND a.attnum = ANY (i.indkey)
         ) THEN 'PRI'
         WHEN EXISTS (
           SELECT 1
           FROM pg_constraint c
           WHERE c.conrelid = a.attrelid
             AND c.contype = 'u'
             AND a.attnum = ANY (c.conkey)
         ) THEN 'UNI'
         ELSE ''
       END AS "colKey",
       pg_get_expr(ad.adbin, ad.adrelid) AS "defaultValue",
       CASE WHEN a.attidentity <> '' THEN 'identity' ELSE '' END AS extra,
       COALESCE(col_description(a.attrelid, a.attnum), '') AS comment
     FROM pg_attribute a
     JOIN pg_class c ON c.oid = a.attrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
     WHERE n.nspname = $1
       AND c.relname = $2
       AND a.attnum > 0
       AND NOT a.attisdropped
     ORDER BY a.attnum`,
    [schema, tableName],
  )

  return res.rows.map((r) => ({
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
  host: PostgresBrowseHost,
  sessionId: string,
  database: string,
  table: string,
): Promise<DbIndexInfo[]> {
  const { pool } = await host.getPool(sessionId, database)
  const { schema, table: tableName } = parseTableRef(table)
  const res = await pool.query<{
    name: string
    columns: string[] | null
    isUnique: boolean
    isPrimary: boolean
    amName: string
    comment: string | null
  }>(
    `SELECT
       i.relname AS name,
       ARRAY(
         SELECT a.attname
         FROM unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord)
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
         ORDER BY k.ord
       ) AS columns,
       ix.indisunique AS "isUnique",
       ix.indisprimary AS "isPrimary",
       am.amname AS "amName",
       COALESCE(obj_description(i.oid, 'pg_class'), '') AS comment
     FROM pg_index ix
     JOIN pg_class t ON t.oid = ix.indrelid
     JOIN pg_namespace n ON n.oid = t.relnamespace
     JOIN pg_class i ON i.oid = ix.indexrelid
     JOIN pg_am am ON am.oid = i.relam
     WHERE n.nspname = $1 AND t.relname = $2
     ORDER BY ix.indisprimary DESC, i.relname`,
    [schema, tableName],
  )
  return res.rows.map((r) => ({
    name: String(r.name || ''),
    columns: Array.isArray(r.columns) ? r.columns.map(String) : [],
    unique: !!r.isUnique,
    primary: !!r.isPrimary,
    type: String(r.amName || ''),
    comment: r.comment != null ? String(r.comment) : '',
  }))
}

export async function getCreateTable(
  host: PostgresBrowseHost,
  sessionId: string,
  database: string,
  table: string,
): Promise<string> {
  const cols = await getTableColumns(host, sessionId, database, table)
  const indexes = await getTableIndexes(host, sessionId, database, table)
  const { schema, table: tableName } = parseTableRef(table)
  const fq = `${quoteIdentPostgres(schema)}.${quoteIdentPostgres(tableName)}`
  if (cols.length === 0) return `-- No columns found for ${fq}`

  const lines = cols.map((c) => {
    const nullSql = c.nullable ? '' : ' NOT NULL'
    const defSql = c.defaultValue != null ? ` DEFAULT ${c.defaultValue}` : ''
    return `  ${quoteIdentPostgres(c.name)} ${c.type}${nullSql}${defSql}`
  })

  const pk = indexes.find((i) => i.primary)
  if (pk && pk.columns.length) {
    lines.push(
      `  PRIMARY KEY (${pk.columns.map((c) => quoteIdentPostgres(c)).join(', ')})`,
    )
  }
  for (const idx of indexes) {
    if (idx.primary) continue
    if (idx.unique) {
      lines.push(
        `  CONSTRAINT ${quoteIdentPostgres(idx.name)} UNIQUE (${idx.columns.map((c) => quoteIdentPostgres(c)).join(', ')})`,
      )
    }
  }

  const ddl = [`CREATE TABLE ${fq} (`, lines.join(',\n'), ');']
  for (const idx of indexes) {
    if (idx.primary || idx.unique) continue
    ddl.push(
      `CREATE INDEX ${quoteIdentPostgres(idx.name)} ON ${fq} USING ${idx.type || 'btree'} (${idx.columns.map((c) => quoteIdentPostgres(c)).join(', ')});`,
    )
  }
  return ddl.join('\n')
}

export async function browseTable(
  host: PostgresBrowseHost,
  sessionId: string,
  database: string,
  table: string,
  page = 1,
  pageSize = 100,
  options?: DbBrowseOptions,
): Promise<DbTableBrowseResult> {
  const { session, pool } = await host.getPool(sessionId, database)
  const { schema, table: tableName } = parseTableRef(table)
  assertIdent(schema)
  assertIdent(tableName)

  const safePage = Math.max(1, Math.floor(page) || 1)
  const safeSize = Math.min(Math.max(Math.floor(pageSize) || 100, 1), 500)
  const offset = (safePage - 1) * safeSize
  const fq = `${quoteIdentPostgres(schema)}.${quoteIdentPostgres(tableName)}`

  const where = buildWhereClausePg(options)

  let orderClause = ''
  if (options?.orderBy) {
    assertIdent(options.orderBy)
    const dir = options.orderDir === 'desc' ? 'DESC' : 'ASC'
    orderClause = ` ORDER BY ${quoteIdentPostgres(options.orderBy)} ${dir}`
  }

  const start = Date.now()
  const hasFilter = browseHasFilter(options)
  const cacheKey = browseCountCacheKey(sessionId, database, table, options)
  let exactTotal = host.countCache.get(cacheKey)

  const limitIdx = where.params.length + 1
  const offsetIdx = where.params.length + 2
  const dataRes = await withStatementTimeout(pool, DEFAULT_QUERY_TIMEOUT_MS, async (client) => {
    return client.query(
      `SELECT * FROM ${fq}${where.clause}${orderClause} LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      [...where.params, safeSize + 1, offset],
    )
  })
  const durationMs = Date.now() - start
  const columns = dataRes.fields.map((f) => f.name)
  const mapped = dataRes.rows.map((row) => {
    const out: Record<string, unknown> = {}
    for (const col of columns) out[col] = serializeCell((row as any)[col], { column: col })
    return out
  })

  if (exactTotal == null && !hasFilter) {
    let estimatedTotal: number | null = null
    try {
      const estRes = await pool.query<{ c: string | number }>(
        `SELECT GREATEST(c.reltuples, 0)::bigint AS c
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = $1 AND c.relname = $2
         LIMIT 1`,
        [schema, tableName],
      )
      if (estRes.rows[0]?.c != null && estRes.rows[0].c !== '') {
        estimatedTotal = Number(estRes.rows[0].c)
      }
    } catch {
      estimatedTotal = null
    }
    void warmExactCount(host, session, pool, cacheKey, fq, where.clause, where.params)
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
    void warmExactCount(host, session, pool, cacheKey, fq, where.clause, where.params)
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
  host: PostgresBrowseHost,
  session: LiveSession,
  pool: Pool,
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
    const countRes = await withStatementTimeout(pool, DEFAULT_QUERY_TIMEOUT_MS, async (client) => {
      return client.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM ${fq}${whereClause}`,
        whereParams,
      )
    })
    if (!host.sessions.has(session.id) || host.sessions.get(session.id) !== session) return
    const total = Number(countRes.rows[0]?.c ?? 0)
    if (Number.isFinite(total) && total >= 0) {
      host.countCache.set(cacheKey, total)
    }
  } catch {
    // background count is best-effort
  } finally {
    host.countWarmInflight.delete(cacheKey)
  }
}
