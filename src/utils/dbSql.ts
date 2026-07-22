/** SQL helpers for LiteConnect database UI (MySQL / PostgreSQL dialects). */

export type SqlDialect = 'mysql' | 'postgres'

export function quoteIdent(name: string, dialect: SqlDialect = 'mysql'): string {
  if (dialect === 'postgres') {
    return '"' + String(name).replace(/"/g, '""') + '"'
  }
  return '`' + String(name).replace(/`/g, '``') + '`'
}

export function sqlLiteral(value: unknown, dialect: SqlDialect = 'mysql'): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'boolean') {
    // MySQL often uses 0/1; Postgres prefers TRUE/FALSE
    if (dialect === 'postgres') return value ? 'TRUE' : 'FALSE'
    return value ? '1' : '0'
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'NULL'
    return String(value)
  }
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return `'${value.toISOString().slice(0, 19).replace('T', ' ')}'`
  if (typeof value === 'object') {
    try {
      return quoteString(JSON.stringify(value), dialect)
    } catch {
      return quoteString(String(value), dialect)
    }
  }
  return quoteString(String(value), dialect)
}

function quoteString(s: string, dialect: SqlDialect): string {
  if (dialect === 'postgres') {
    // Standard SQL: double single-quotes; backslash is not special unless standard_conforming_strings=off
    return "'" + s.replace(/'/g, "''") + "'"
  }
  return "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "''") + "'"
}

/** Parse cell edit text → SQL-friendly value (string or null). */
export function parseCellInput(raw: string, asNull: boolean): unknown {
  if (asNull || raw === 'NULL' || raw === 'null') return null
  return raw
}

function qualifiedTable(database: string, table: string, dialect: SqlDialect): string {
  if (dialect === 'postgres') {
    // table may be "schema.table"; database is the connected DB (not part of table FQN)
    if (table.includes('.')) {
      const [schema, name] = table.split('.', 2)
      return `${quoteIdent(schema, dialect)}.${quoteIdent(name, dialect)}`
    }
    return `${quoteIdent('public', dialect)}.${quoteIdent(table, dialect)}`
  }
  return `${quoteIdent(database, dialect)}.${quoteIdent(table, dialect)}`
}

export function buildUpdateSql(
  database: string,
  table: string,
  pkColumns: string[],
  original: Record<string, unknown>,
  modified: Record<string, unknown>,
  columns: string[],
  dialect: SqlDialect = 'mysql',
): string | null {
  if (pkColumns.length === 0) return null
  const sets: string[] = []
  for (const col of columns) {
    if (pkColumns.includes(col)) continue
    const a = original[col]
    const b = modified[col]
    if (!valuesEqual(a, b)) {
      sets.push(`${quoteIdent(col, dialect)} = ${sqlLiteral(b, dialect)}`)
    }
  }
  if (sets.length === 0) return null
  const where = pkColumns
    .map((col) => {
      const v = original[col]
      if (v === null || v === undefined) return `${quoteIdent(col, dialect)} IS NULL`
      return `${quoteIdent(col, dialect)} = ${sqlLiteral(v, dialect)}`
    })
    .join(' AND ')
  const fq = qualifiedTable(database, table, dialect)
  // MySQL supports LIMIT on UPDATE; Postgres does not — PK WHERE is enough for both
  if (dialect === 'postgres') {
    return `UPDATE ${fq}\nSET ${sets.join(', ')}\nWHERE ${where};`
  }
  return `UPDATE ${fq}\nSET ${sets.join(', ')}\nWHERE ${where}\nLIMIT 1;`
}

export function buildDeleteSql(
  database: string,
  table: string,
  pkColumns: string[],
  row: Record<string, unknown>,
  dialect: SqlDialect = 'mysql',
): string | null {
  if (pkColumns.length === 0) return null
  const where = pkColumns
    .map((col) => {
      const v = row[col]
      if (v === null || v === undefined) return `${quoteIdent(col, dialect)} IS NULL`
      return `${quoteIdent(col, dialect)} = ${sqlLiteral(v, dialect)}`
    })
    .join(' AND ')
  const fq = qualifiedTable(database, table, dialect)
  if (dialect === 'postgres') {
    return `DELETE FROM ${fq}\nWHERE ${where};`
  }
  return `DELETE FROM ${fq}\nWHERE ${where}\nLIMIT 1;`
}

export function buildInsertSql(
  database: string,
  table: string,
  columns: string[],
  row: Record<string, unknown>,
  dialect: SqlDialect = 'mysql',
): string {
  const cols = columns.map((c) => quoteIdent(c, dialect)).join(', ')
  const vals = columns.map((c) => sqlLiteral(row[c] ?? null, dialect)).join(', ')
  const fq = qualifiedTable(database, table, dialect)
  return `INSERT INTO ${fq} (${cols})\nVALUES (${vals});`
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  return String(a) === String(b)
}

/** Client-side sort rows by column. */
export function sortRows(
  rows: Array<Record<string, unknown>>,
  col: string,
  dir: 'asc' | 'desc',
): Array<Record<string, unknown>> {
  const mul = dir === 'asc' ? 1 : -1
  return [...rows].sort((ra, rb) => {
    const a = ra[col]
    const b = rb[col]
    if (a == null && b == null) return 0
    if (a == null) return 1
    if (b == null) return -1
    if (typeof a === 'number' && typeof b === 'number') return (a - b) * mul
    const sa = String(a)
    const sb = String(b)
    const na = Number(sa)
    const nb = Number(sb)
    if (sa !== '' && sb !== '' && Number.isFinite(na) && Number.isFinite(nb) && /^-?\d+(\.\d+)?$/.test(sa) && /^-?\d+(\.\d+)?$/.test(sb)) {
      return (na - nb) * mul
    }
    return sa.localeCompare(sb, undefined, { numeric: true, sensitivity: 'base' }) * mul
  })
}

/** Filter rows where any cell contains query (case-insensitive). */
export function filterRows(
  rows: Array<Record<string, unknown>>,
  columns: string[],
  query: string,
): Array<Record<string, unknown>> {
  const q = query.trim().toLowerCase()
  if (!q) return rows
  return rows.filter((row) =>
    columns.some((col) => {
      const v = row[col]
      if (v == null) return q === 'null'
      return String(v).toLowerCase().includes(q)
    }),
  )
}
