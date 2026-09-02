import type { Connection, Pool } from 'oracledb'
import type { BrowseCountCache } from '../browse/browsePagination'

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
  connectString: string
  pool: Pool
}

export interface ActiveQuery {
  sessionId: string
  connection: Connection
  cancelled: boolean
}

export interface PinnedClient {
  sessionId: string
  clientKey: string
  connection: Connection
  inTransaction: boolean
  database: string | null
}

export type OracleBrowseHost = {
  sessions: Map<string, LiveSession>
  countCache: BrowseCountCache
  countWarmInflight: Set<string>
  requireSession: (sessionId: string) => LiveSession
  withConn: <T>(session: LiveSession, fn: (c: Connection) => Promise<T>) => Promise<T>
}
