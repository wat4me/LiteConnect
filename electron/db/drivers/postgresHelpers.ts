import type { Pool, PoolClient } from 'pg'
import { assertIdent } from '../common'

export function parseTableRef(table: string): { schema: string; table: string } {
  assertIdent(table)
  const idx = table.indexOf('.')
  if (idx <= 0) return { schema: 'public', table }
  const schema = table.slice(0, idx)
  const name = table.slice(idx + 1)
  assertIdent(schema)
  assertIdent(name)
  return { schema, table: name }
}

export async function withStatementTimeout<T>(
  pool: Pool,
  timeoutMs: number,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query(`SET statement_timeout = ${Math.floor(timeoutMs)}`)
    try {
      return await fn(client)
    } finally {
      try {
        await client.query('SET statement_timeout = 0')
      } catch {}
    }
  } finally {
    client.release()
  }
}
