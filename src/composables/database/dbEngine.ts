import type { DbEngine } from '../../env.d'
import { quoteIdent, type SqlDialect } from '../../utils/dbSql'

/**
 * Engine-facing helpers for the database UI.
 * When adding a new engine: extend labels/ports/snippets here + electron/db driver.
 */

export const DEFAULT_PORT: Record<DbEngine, number> = {
  mysql: 3306,
  postgres: 5432,
}

export function engineLabel(engine: DbEngine): string {
  switch (engine) {
    case 'postgres':
      return 'PostgreSQL'
    case 'mysql':
    default:
      return 'MySQL'
  }
}

export function defaultPort(engine: DbEngine): number {
  return DEFAULT_PORT[engine] ?? 3306
}

/** UI dialect tracks engine id today; keep as a single mapping point. */
export function dialectOfEngine(engine: DbEngine): SqlDialect {
  return engine
}

export function splitTableName(table: string): { schema: string; name: string } {
  const idx = table.indexOf('.')
  if (idx <= 0) return { schema: 'public', name: table }
  return { schema: table.slice(0, idx), name: table.slice(idx + 1) }
}

/** Unqualified table reference for SQL generation (FROM clause). */
export function tableRefSql(table: string, dialect: SqlDialect): string {
  if (dialect === 'postgres') {
    const { schema, name } = splitTableName(table)
    return `${quoteIdent(schema, dialect)}.${quoteIdent(name, dialect)}`
  }
  return quoteIdent(table, dialect)
}

/** Fully qualified name for copy/export (may include database). */
export function qualifiedTableSql(
  database: string,
  table: string,
  dialect: SqlDialect,
): string {
  if (dialect === 'postgres') {
    return tableRefSql(table, dialect)
  }
  return `${quoteIdent(database, dialect)}.${quoteIdent(table, dialect)}`
}

export function selectStarSql(
  database: string,
  table: string,
  dialect: SqlDialect,
  limit = 100,
): string {
  const from = qualifiedTableSql(database, table, dialect)
  return `SELECT *\nFROM ${from}\nLIMIT ${limit};\n`
}

export function countSql(database: string, table: string, dialect: SqlDialect): string {
  const from = tableRefSql(table, dialect)
  return `SELECT COUNT(*) AS cnt\nFROM ${from};\n`
}

export function describeTableSql(table: string, dialect: SqlDialect): string {
  if (dialect === 'postgres') {
    const { schema, name } = splitTableName(table)
    return (
      `SELECT column_name, data_type, is_nullable, column_default\n` +
      `FROM information_schema.columns\n` +
      `WHERE table_schema = '${schema.replace(/'/g, "''")}'\n` +
      `  AND table_name = '${name.replace(/'/g, "''")}'\n` +
      `ORDER BY ordinal_position;\n`
    )
  }
  return `SHOW FULL COLUMNS FROM ${quoteIdent(table, dialect)};\n`
}

export function treeDbKey(connectionId: string, database: string): string {
  return `${connectionId}::${database}`
}
