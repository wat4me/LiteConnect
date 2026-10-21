export type SqlDialect = 'mysql' | 'postgres' | 'oracle'

export function quoteIdent(name: string, dialect: SqlDialect = 'mysql'): string {
  if (dialect === 'postgres' || dialect === 'oracle') {
    return '"' + String(name).replace(/"/g, '""') + '"'
  }
  return '`' + String(name).replace(/`/g, '``') + '`'
}

export const quoteIdentMysql = (name: string) => quoteIdent(name, 'mysql')
export const quoteIdentPostgres = (name: string) => quoteIdent(name, 'postgres')
export const quoteIdentOracle = (name: string) => quoteIdent(name, 'oracle')
