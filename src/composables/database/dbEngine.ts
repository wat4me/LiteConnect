import type { DbEngine } from '../../env.d'
import { quoteIdent, type SqlDialect } from '@/utils/database/dbSql'

/**
 * Engine-facing helpers for the database UI.
 * When adding a new engine: extend labels/ports/snippets here + electron/db driver.
 */

export const DEFAULT_PORT: Record<DbEngine, number> = {
  mysql: 3306,
  postgres: 5432,
  oracle: 1521,
}

export function engineLabel(engine: DbEngine): string {
  switch (engine) {
    case 'postgres':
      return 'PostgreSQL'
    case 'oracle':
      return 'Oracle'
    case 'mysql':
    default:
      return 'MySQL'
  }
}

export function defaultPort(engine: DbEngine): number {
  return DEFAULT_PORT[engine] ?? 3306
}

/** UI dialect tracks engine id. */
export function dialectOfEngine(engine: DbEngine): SqlDialect {
  if (engine === 'postgres') return 'postgres'
  if (engine === 'oracle') return 'oracle'
  return 'mysql'
}

export function splitTableName(
  table: string,
  defaultSchema = 'public',
): { schema: string; name: string } {
  const idx = table.indexOf('.')
  if (idx <= 0) return { schema: defaultSchema, name: table }
  return { schema: table.slice(0, idx), name: table.slice(idx + 1) }
}

/** Unqualified table reference for SQL generation (FROM clause). */
export function tableRefSql(
  table: string,
  dialect: SqlDialect,
  schemaHint?: string,
): string {
  if (dialect === 'postgres') {
    const { schema, name } = splitTableName(table, 'public')
    return `${quoteIdent(schema, dialect)}.${quoteIdent(name, dialect)}`
  }
  if (dialect === 'oracle') {
    if (table.includes('.')) {
      const { schema, name } = splitTableName(table)
      return `${quoteIdent(schema, dialect)}.${quoteIdent(name, dialect)}`
    }
    if (schemaHint) {
      return `${quoteIdent(schemaHint, dialect)}.${quoteIdent(table, dialect)}`
    }
    return quoteIdent(table, dialect)
  }
  return quoteIdent(table, dialect)
}

/** Fully qualified name for copy/export (may include database/schema). */
export function qualifiedTableSql(
  database: string,
  table: string,
  dialect: SqlDialect,
): string {
  if (dialect === 'postgres') {
    return tableRefSql(table, dialect)
  }
  if (dialect === 'oracle') {
    return tableRefSql(table, dialect, database)
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
  if (dialect === 'oracle') {
    return `SELECT *\nFROM ${from}\nFETCH FIRST ${limit} ROWS ONLY;\n`
  }
  return `SELECT *\nFROM ${from}\nLIMIT ${limit};\n`
}

export function countSql(database: string, table: string, dialect: SqlDialect): string {
  const from =
    dialect === 'oracle' ? tableRefSql(table, dialect, database) : tableRefSql(table, dialect)
  return `SELECT COUNT(*) AS cnt\nFROM ${from};\n`
}

export function describeTableSql(
  table: string,
  dialect: SqlDialect,
  schemaHint?: string,
): string {
  if (dialect === 'postgres') {
    const { schema, name } = splitTableName(table, 'public')
    return (
      `SELECT column_name, data_type, is_nullable, column_default\n` +
      `FROM information_schema.columns\n` +
      `WHERE table_schema = '${schema.replace(/'/g, "''")}'\n` +
      `  AND table_name = '${name.replace(/'/g, "''")}'\n` +
      `ORDER BY ordinal_position;\n`
    )
  }
  if (dialect === 'oracle') {
    const { schema, name } = splitTableName(table, schemaHint || '')
    const owner = (schema || schemaHint || '').replace(/'/g, "''")
    const tname = name.replace(/'/g, "''")
    if (owner) {
      return (
        `SELECT column_name, data_type, nullable, data_default\n` +
        `FROM all_tab_columns\n` +
        `WHERE owner = '${owner.toUpperCase()}'\n` +
        `  AND table_name = '${tname.toUpperCase()}'\n` +
        `ORDER BY column_id;\n`
      )
    }
    return (
      `SELECT column_name, data_type, nullable, data_default\n` +
      `FROM user_tab_columns\n` +
      `WHERE table_name = '${tname.toUpperCase()}'\n` +
      `ORDER BY column_id;\n`
    )
  }
  return `SHOW FULL COLUMNS FROM ${quoteIdent(table, dialect)};\n`
}

export function treeDbKey(connectionId: string, database: string): string {
  return `${connectionId}::${database}`
}
