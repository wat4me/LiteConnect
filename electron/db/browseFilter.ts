import type { DbBrowseOptions, DbColumnFilter, DbFilterOp } from './types'
import { assertIdent, quoteIdentMysql, quoteIdentOracle, quoteIdentPostgres } from './common'

const FILTER_OPS: readonly DbFilterOp[] = [
  'eq',
  'ne',
  'like',
  'gt',
  'lt',
  'gte',
  'lte',
  'is_null',
  'is_not_null',
]

export function isFilterOp(value: unknown): value is DbFilterOp {
  return typeof value === 'string' && (FILTER_OPS as readonly string[]).includes(value)
}

export function sanitizeBrowseOptions(options?: DbBrowseOptions): DbBrowseOptions | undefined {
  if (!options) return undefined
  const out: DbBrowseOptions = {}
  if (options.orderBy && typeof options.orderBy === 'string' && options.orderBy.trim()) {
    out.orderBy = options.orderBy.trim()
    out.orderDir = options.orderDir === 'desc' ? 'desc' : 'asc'
  }
  if (typeof options.search === 'string' && options.search.trim()) {
    const s = options.search.trim()
    if (s.length > 500) throw new Error('Search text too long')
    if (s.includes('\0')) throw new Error('Invalid search')
    out.search = s
  }
  if (Array.isArray(options.searchColumns)) {
    out.searchColumns = options.searchColumns
      .filter((c) => typeof c === 'string' && c.trim())
      .map((c) => c.trim())
      .slice(0, 64)
  }
  if (Array.isArray(options.filters)) {
    out.filters = options.filters
      .filter((f): f is DbColumnFilter => !!f && typeof f === 'object')
      .map((f) => {
        if (typeof f.column !== 'string' || !f.column.trim()) {
          throw new Error('Invalid filter column')
        }
        if (!isFilterOp(f.op)) throw new Error('Invalid filter operator')
        const value =
          typeof f.value === 'string' ? f.value : f.value == null ? undefined : String(f.value)
        if (value != null && value.length > 2000) throw new Error('Filter value too long')
        if (value != null && value.includes('\0')) throw new Error('Invalid filter value')
        return { column: f.column.trim(), op: f.op, value }
      })
      .slice(0, 32)
  }
  return out
}

type QuoteFn = (name: string) => string

function bindPlaceholder(style: 'mysql' | 'postgres' | 'oracle', paramIndex: number): string {
  if (style === 'postgres') return `$${paramIndex}`
  if (style === 'oracle') return `:${paramIndex}`
  return '?'
}

function opSql(
  quote: QuoteFn,
  filter: DbColumnFilter,
  paramIndex: number,
  style: 'mysql' | 'postgres' | 'oracle',
): { sql: string; params: unknown[]; next: number } {
  assertIdent(filter.column)
  const col = quote(filter.column)
  const ph = bindPlaceholder(style, paramIndex)
  switch (filter.op) {
    case 'is_null':
      return { sql: `${col} IS NULL`, params: [], next: paramIndex }
    case 'is_not_null':
      return { sql: `${col} IS NOT NULL`, params: [], next: paramIndex }
    case 'eq':
      return { sql: `${col} = ${ph}`, params: [filter.value ?? ''], next: paramIndex + 1 }
    case 'ne':
      return { sql: `${col} <> ${ph}`, params: [filter.value ?? ''], next: paramIndex + 1 }
    case 'gt':
      return { sql: `${col} > ${ph}`, params: [filter.value ?? ''], next: paramIndex + 1 }
    case 'lt':
      return { sql: `${col} < ${ph}`, params: [filter.value ?? ''], next: paramIndex + 1 }
    case 'gte':
      return { sql: `${col} >= ${ph}`, params: [filter.value ?? ''], next: paramIndex + 1 }
    case 'lte':
      return { sql: `${col} <= ${ph}`, params: [filter.value ?? ''], next: paramIndex + 1 }
    case 'like': {
      const raw = filter.value ?? ''
      const pattern = raw.includes('%') || raw.includes('_') ? raw : `%${raw}%`
      return { sql: `${col} LIKE ${ph}`, params: [pattern], next: paramIndex + 1 }
    }
    default:
      throw new Error('Invalid filter operator')
  }
}

export function buildWhereClausePg(
  options: DbBrowseOptions | undefined,
  fallbackSearchColumns: string[] = [],
): { clause: string; params: unknown[] } {
  if (!options) return { clause: '', params: [] }
  const quote = quoteIdentPostgres
  const parts: string[] = []
  const params: unknown[] = []
  let p = 1

  if (options.filters?.length) {
    for (const f of options.filters) {
      const built = opSql(quote, f, p, 'postgres')
      parts.push(built.sql)
      params.push(...built.params)
      p = built.next
    }
  }

  const search = options.search?.trim()
  if (search) {
    const cols =
      options.searchColumns && options.searchColumns.length > 0
        ? options.searchColumns
        : fallbackSearchColumns
    const useCols = cols.slice(0, 32)
    if (useCols.length > 0) {
      const likes: string[] = []
      for (const col of useCols) {
        assertIdent(col)
        likes.push(`CAST(${quote(col)} AS TEXT) LIKE $${p}`)
        params.push(`%${search}%`)
        p += 1
      }
      parts.push(`(${likes.join(' OR ')})`)
    }
  }

  if (parts.length === 0) return { clause: '', params: [] }
  return { clause: ` WHERE ${parts.join(' AND ')}`, params }
}

/** Oracle 12c+ binds as :1, :2, … (node-oracledb positional). */
export function buildWhereClauseOracle(
  options: DbBrowseOptions | undefined,
  fallbackSearchColumns: string[] = [],
): { clause: string; params: unknown[] } {
  if (!options) return { clause: '', params: [] }
  const quote = quoteIdentOracle
  const parts: string[] = []
  const params: unknown[] = []
  let p = 1

  if (options.filters?.length) {
    for (const f of options.filters) {
      const built = opSql(quote, f, p, 'oracle')
      parts.push(built.sql)
      params.push(...built.params)
      p = built.next
    }
  }

  const search = options.search?.trim()
  if (search) {
    const cols =
      options.searchColumns && options.searchColumns.length > 0
        ? options.searchColumns
        : fallbackSearchColumns
    const useCols = cols.slice(0, 32)
    if (useCols.length > 0) {
      const likes: string[] = []
      for (const col of useCols) {
        assertIdent(col)
        likes.push(`TO_CHAR(${quote(col)}) LIKE :${p}`)
        params.push(`%${search}%`)
        p += 1
      }
      parts.push(`(${likes.join(' OR ')})`)
    }
  }

  if (parts.length === 0) return { clause: '', params: [] }
  return { clause: ` WHERE ${parts.join(' AND ')}`, params }
}

export function buildWhereClauseMysql(
  options: DbBrowseOptions | undefined,
  fallbackSearchColumns: string[] = [],
): { clause: string; params: unknown[] } {
  if (!options) return { clause: '', params: [] }
  const quote = quoteIdentMysql
  const parts: string[] = []
  const params: unknown[] = []

  if (options.filters?.length) {
    for (const f of options.filters) {
      const built = opSql(quote, f, 1, 'mysql')
      parts.push(built.sql)
      params.push(...built.params)
    }
  }

  const search = options.search?.trim()
  if (search) {
    const cols =
      options.searchColumns && options.searchColumns.length > 0
        ? options.searchColumns
        : fallbackSearchColumns
    const useCols = cols.slice(0, 32)
    if (useCols.length > 0) {
      const likes: string[] = []
      for (const col of useCols) {
        assertIdent(col)
        likes.push(`CAST(${quote(col)} AS CHAR) LIKE ?`)
        params.push(`%${search}%`)
      }
      parts.push(`(${likes.join(' OR ')})`)
    }
  }

  if (parts.length === 0) return { clause: '', params: [] }
  return { clause: ` WHERE ${parts.join(' AND ')}`, params }
}
