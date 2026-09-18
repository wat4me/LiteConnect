import type { Pool } from 'mysql2/promise'
import type { BrowseCountCache } from '../browse/browsePagination'
import type { resolveSslConfig } from '../types'

export const CONTROL_CONNECT_TIMEOUT_MS = 5_000
export const CONTROL_QUERY_TIMEOUT_MS = 5_000

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
  ssl: ReturnType<typeof resolveSslConfig>
  pool: Pool
}

export interface ActiveQuery {
  sessionId: string
  threadId: number
  cancelled: boolean
}

export interface PinnedClient {
  sessionId: string
  clientKey: string
  conn: import('mysql2/promise').PoolConnection
  inTransaction: boolean
  database: string | null
}

export type MysqlControlConnection = {
  query: (sql: string | { sql: string; timeout?: number }) => Promise<unknown>
  end: () => Promise<void>
}

export type MysqlBrowseHost = {
  sessions: Map<string, LiveSession>
  countCache: BrowseCountCache
  countWarmInflight: Set<string>
  requireSession: (sessionId: string) => LiveSession
}
