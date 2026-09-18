import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg'
import type { DbConnection } from '../types'
import { BrowseCountCache } from '../browse/browsePagination'

export interface LiveSession {
  id: string
  connectionId: string
  connectionName: string
  host: string
  port: number
  username: string
  database: string | null
  serverVersion: string
  password: string
  ssl: boolean
  sslOptions?: DbConnection['sslOptions']
  extraOptions?: DbConnection['extraOptions']
  pools: Map<string, Pool>
  poolLastUsed: Map<string, number>
}

export interface ActiveQuery {
  sessionId: string
  database: string
  pid: number
  cancelled: boolean
  client: PoolClient | null
}

export interface PinnedClient {
  sessionId: string
  clientKey: string
  client: PoolClient
  inTransaction: boolean
  database: string
}

export const POOL_IDLE_EVICT_MS = 5 * 60_000
export const CONTROL_CONNECT_TIMEOUT_MS = 5_000
export const CONTROL_STATEMENT_TIMEOUT_MS = 5_000

export type PostgresControlClient = {
  query: <T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ) => Promise<QueryResult<T>>
  end: () => Promise<void>
}

export type PostgresBrowseHost = {
  sessions: Map<string, LiveSession>
  countCache: BrowseCountCache
  countWarmInflight: Set<string>
  getPool: (
    sessionId: string,
    database?: string | null,
  ) => Promise<{ session: LiveSession; pool: Pool; database: string }>
}
