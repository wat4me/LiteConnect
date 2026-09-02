import oracledb, { type Result } from 'oracledb'
import {
  assertIdent,
  DEFAULT_QUERY_TIMEOUT_MS,
  quoteIdentOracle,
} from '../common'
import { buildWhereClauseOracle } from '../browse/browseFilter'
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
import { mapRows, parseOracleTableName, rowVal, schemaOf } from './oracleHelpers'
import type { LiveSession, OracleBrowseHost } from './oracleTypes'

export async function listDatabases(host: OracleBrowseHost, sessionId: string): Promise<string[]> {
  const session = host.requireSession(sessionId)
  return host.withConn(session, async (conn) => {
    try {
      const res = await conn.execute(
        `SELECT owner AS name FROM (
           SELECT DISTINCT owner FROM all_tables
           UNION
           SELECT DISTINCT owner FROM all_views
         )
         WHERE owner NOT IN (
           'SYS','SYSTEM','OUTLN','XDB','WMSYS','DBSNMP','APPQOSSYS','GSMADMIN_INTERNAL',
           'ANONYMOUS','CTXSYS','DVSYS','LBACSYS','MDSYS','OLAPSYS','ORDDATA','ORDSYS',
           'SI_INFORMTN_SCHEMA','AUDSYS','OJVMSYS','REMOTE_SCHEDULER_AGENT'
         )
         AND owner NOT LIKE 'APEX\\_%' ESCAPE '\\'
         AND owner NOT LIKE 'FLOWS\\_%' ESCAPE '\\'
         ORDER BY owner`,
        [],
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      )
      const names = (res.rows || [])
        .map((r) => String(rowVal(r as Record<string, unknown>, 'name') || '').trim())
        .filter(Boolean)
      if (names.length) return names
    } catch {
      // privilege / view issues
    }
    const cur = await conn.execute(
      `SELECT SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') AS s FROM dual`,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    )
    const s = String(
      rowVal(cur.rows?.[0] as Record<string, unknown>, 's') || session.username || '',
    ).trim()
    return s ? [s] : []
  })
}

export async function listTableInfos(
  host: OracleBrowseHost,
  sessionId: string,
  database?: string,
): Promise<DbTableInfo[]> {
  const session = host.requireSession(sessionId)
  const owner = schemaOf(session, database)
  return host.withConn(session, async (conn) => {
    const res = await conn.execute(
      `SELECT object_name AS name, object_type AS otype
       FROM all_objects
       WHERE owner = :1
         AND object_type IN ('TABLE', 'VIEW', 'MATERIALIZED VIEW')
       ORDER BY CASE object_type WHEN 'TABLE' THEN 0 ELSE 1 END, object_name`,
      [owner],
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    )
    return (res.rows || [])
      .map((raw) => {
        const r = raw as Record<string, unknown>
        const name = String(rowVal(r, 'name') || '').trim()
        if (!name) return null
        const typeRaw = String(rowVal(r, 'otype') || '').toUpperCase()
        return {
          name,
          type: typeRaw.includes('VIEW') ? ('view' as const) : ('table' as const),
          engine: null,
          rows: null,
          comment: '',
        }
      })
      .filter((t): t is DbTableInfo => !!t)
  })
}

export async function getTableColumns(
  host: OracleBrowseHost,
  sessionId: string,
  database: string,
  table: string,
): Promise<DbColumnInfo[]> {
  const session = host.requireSession(sessionId)
  const owner = schemaOf(session, database)
  const tableName = parseOracleTableName(table)
  assertIdent(tableName)
  return host.withConn(session, async (conn) => {
    const res = await conn.execute(
      `SELECT
         c.column_name AS name,
         c.data_type
           || CASE
                WHEN c.data_type IN ('VARCHAR2','NVARCHAR2','CHAR','NCHAR')
                  THEN '(' || c.char_length || ')'
                WHEN c.data_type = 'NUMBER' AND c.data_precision IS NOT NULL
                  THEN '(' || c.data_precision
                       || CASE WHEN c.data_scale IS NOT NULL THEN ',' || c.data_scale ELSE '' END
                       || ')'
                WHEN c.data_type LIKE 'TIMESTAMP%' AND c.data_scale IS NOT NULL
                  THEN '(' || c.data_scale || ')'
                ELSE ''
              END AS col_type,
         c.nullable AS nullable,
         c.data_default AS default_value,
         NVL(cc.comments, '') AS comments,
         CASE
           WHEN EXISTS (
             SELECT 1
             FROM all_cons_columns acc
             JOIN all_constraints ac
               ON ac.owner = acc.owner
              AND ac.constraint_name = acc.constraint_name
             WHERE ac.owner = c.owner
               AND ac.table_name = c.table_name
               AND ac.constraint_type = 'P'
               AND acc.column_name = c.column_name
           ) THEN 'PRI'
           WHEN EXISTS (
             SELECT 1
             FROM all_cons_columns acc
             JOIN all_constraints ac
               ON ac.owner = acc.owner
              AND ac.constraint_name = acc.constraint_name
             WHERE ac.owner = c.owner
               AND ac.table_name = c.table_name
               AND ac.constraint_type = 'U'
               AND acc.column_name = c.column_name
           ) THEN 'UNI'
           ELSE ''
         END AS col_key
       FROM all_tab_columns c
       LEFT JOIN all_col_comments cc
         ON cc.owner = c.owner
        AND cc.table_name = c.table_name
        AND cc.column_name = c.column_name
       WHERE c.owner = :1 AND c.table_name = :2
       ORDER BY c.column_id`,
      [owner, tableName],
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    )
    return (res.rows || []).map((raw) => {
      const r = raw as Record<string, unknown>
      const nullable = String(rowVal(r, 'nullable') || 'Y').toUpperCase() === 'Y'
      let defaultValue = rowVal(r, 'default_value')
      if (defaultValue != null) defaultValue = String(defaultValue).replace(/\s+$/, '')
      return {
        name: String(rowVal(r, 'name') || ''),
        type: String(rowVal(r, 'col_type') || ''),
        nullable,
        key: String(rowVal(r, 'col_key') || ''),
        defaultValue: defaultValue == null || defaultValue === '' ? null : String(defaultValue),
        extra: '',
        comment: String(rowVal(r, 'comments') || ''),
      }
    })
  })
}

export async function getTableIndexes(
  host: OracleBrowseHost,
  sessionId: string,
  database: string,
  table: string,
): Promise<DbIndexInfo[]> {
  const session = host.requireSession(sessionId)
  const owner = schemaOf(session, database)
  const tableName = parseOracleTableName(table)
  assertIdent(tableName)
  return host.withConn(session, async (conn) => {
    const res = await conn.execute(
      `SELECT
         i.index_name AS name,
         i.uniqueness AS uniqueness,
         i.index_type AS index_type,
         ic.column_name AS col_name,
         ic.column_position AS col_pos,
         CASE WHEN EXISTS (
           SELECT 1 FROM all_constraints c
           WHERE c.owner = i.table_owner
             AND c.table_name = i.table_name
             AND c.index_name = i.index_name
             AND c.constraint_type = 'P'
         ) THEN 1 ELSE 0 END AS is_pk
       FROM all_indexes i
       JOIN all_ind_columns ic
         ON ic.index_owner = i.owner
        AND ic.index_name = i.index_name
       WHERE i.table_owner = :1 AND i.table_name = :2
       ORDER BY i.index_name, ic.column_position`,
      [owner, tableName],
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    )
    const map = new Map<string, DbIndexInfo>()
    for (const raw of res.rows || []) {
      const r = raw as Record<string, unknown>
      const name = String(rowVal(r, 'name') || '')
      if (!name) continue
      let idx = map.get(name)
      if (!idx) {
        const uniq = String(rowVal(r, 'uniqueness') || '').toUpperCase() === 'UNIQUE'
        const isPk = Number(rowVal(r, 'is_pk') || 0) === 1
        idx = {
          name,
          columns: [],
          unique: uniq || isPk,
          primary: isPk,
          type: String(rowVal(r, 'index_type') || ''),
          comment: '',
        }
        map.set(name, idx)
      }
      const col = String(rowVal(r, 'col_name') || '')
      if (col) idx.columns.push(col)
    }
    return [...map.values()]
  })
}

export async function getCreateTable(
  host: OracleBrowseHost,
  sessionId: string,
  database: string,
  table: string,
): Promise<string> {
  const session = host.requireSession(sessionId)
  const owner = schemaOf(session, database)
  const tableName = parseOracleTableName(table)
  assertIdent(tableName)
  return host.withConn(session, async (conn) => {
    try {
      const res = await conn.execute(
        `SELECT DBMS_METADATA.GET_DDL('TABLE', :1, :2) AS ddl FROM dual`,
        [tableName, owner],
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      )
      const ddl = rowVal(res.rows?.[0] as Record<string, unknown>, 'ddl')
      if (ddl != null && String(ddl).trim()) return String(ddl).trim()
    } catch {
      // fall through to simplified DDL
    }
    const cols = await getTableColumns(host, sessionId, database, table)
    const indexes = await getTableIndexes(host, sessionId, database, table)
    const fq = `${quoteIdentOracle(owner)}.${quoteIdentOracle(tableName)}`
    if (!cols.length) return `-- No columns found for ${fq}`
    const lines = cols.map((c) => {
      const nullSql = c.nullable ? '' : ' NOT NULL'
      const defSql = c.defaultValue != null ? ` DEFAULT ${c.defaultValue}` : ''
      return `  ${quoteIdentOracle(c.name)} ${c.type}${nullSql}${defSql}`
    })
    const pk = indexes.find((i) => i.primary)
    if (pk?.columns.length) {
      lines.push(`  PRIMARY KEY (${pk.columns.map((c) => quoteIdentOracle(c)).join(', ')})`)
    }
    return [`CREATE TABLE ${fq} (`, lines.join(',\n'), ');'].join('\n')
  })
}

export async function browseTable(
  host: OracleBrowseHost,
  sessionId: string,
  database: string,
  table: string,
  page = 1,
  pageSize = 100,
  options?: DbBrowseOptions,
): Promise<DbTableBrowseResult> {
  const session = host.requireSession(sessionId)
  const owner = schemaOf(session, database)
  const tableName = parseOracleTableName(table)
  assertIdent(tableName)

  const safePage = Math.max(1, Math.floor(page) || 1)
  const safeSize = Math.min(Math.max(Math.floor(pageSize) || 100, 1), 500)
  const offset = (safePage - 1) * safeSize
  const fq = `${quoteIdentOracle(owner)}.${quoteIdentOracle(tableName)}`

  const where = buildWhereClauseOracle(options)

  let orderClause = ''
  if (options?.orderBy) {
    assertIdent(options.orderBy)
    const dir = options.orderDir === 'desc' ? 'DESC' : 'ASC'
    orderClause = ` ORDER BY ${quoteIdentOracle(options.orderBy)} ${dir}`
  }

  const start = Date.now()
  const hasFilter = browseHasFilter(options)
  const cacheKey = browseCountCacheKey(sessionId, database, table, options)
  const exactTotal = host.countCache.get(cacheKey)

  // Oracle 12c+: OFFSET n ROWS FETCH NEXT m ROWS ONLY; binds :1.. for WHERE then offset/fetch
  const binds = [...where.params, offset, safeSize + 1]
  const offsetPh = `:${where.params.length + 1}`
  const fetchPh = `:${where.params.length + 2}`
  const sql =
    `SELECT * FROM ${fq}${where.clause}${orderClause}` +
    ` OFFSET ${offsetPh} ROWS FETCH NEXT ${fetchPh} ROWS ONLY`

  const data = await host.withConn(session, async (conn) => {
    conn.callTimeout = DEFAULT_QUERY_TIMEOUT_MS
    return conn.execute(sql, binds, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
      maxRows: safeSize + 1,
    })
  })
  const durationMs = Date.now() - start
  const { columns, rows: mapped } = mapRows(data as Result<Record<string, unknown>>)

  if (exactTotal == null) {
    void warmExactCount(host, session, cacheKey, fq, where.clause, where.params)
    let estimatedTotal: number | null = null
    if (!hasFilter) {
      try {
        estimatedTotal = await host.withConn(session, async (conn) => {
          const est = await conn.execute(
            `SELECT num_rows AS c FROM all_tables WHERE owner = :1 AND table_name = :2`,
            [owner, tableName],
            { outFormat: oracledb.OUT_FORMAT_OBJECT },
          )
          const v = rowVal(est.rows?.[0] as Record<string, unknown>, 'c')
          return v != null && v !== '' ? Number(v) : null
        })
      } catch {
        estimatedTotal = null
      }
    }
    return finalizeBrowsePage({
      rows: mapped,
      columns,
      page: safePage,
      pageSize: safeSize,
      durationMs,
      exactTotal: null,
      estimatedTotal,
      hasFilter,
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
  host: OracleBrowseHost,
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
    const total = await host.withConn(session, async (conn) => {
      conn.callTimeout = DEFAULT_QUERY_TIMEOUT_MS
      const res = await conn.execute(
        `SELECT COUNT(*) AS c FROM ${fq}${whereClause}`,
        whereParams,
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      )
      return Number(rowVal(res.rows?.[0] as Record<string, unknown>, 'c') ?? 0)
    })
    if (!host.sessions.has(session.id) || host.sessions.get(session.id) !== session) return
    if (Number.isFinite(total) && total >= 0) host.countCache.set(cacheKey, total)
  } catch {
    // best-effort
  } finally {
    host.countWarmInflight.delete(cacheKey)
  }
}
