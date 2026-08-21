export interface Session {
  id: string
  connectionId: string
  connectionName: string
  tabNumber: number
  /** Restored tab: no SSH yet; reconnect() will connect in-place */
  pending?: boolean
}

export interface ConnectionGroup {
  connectionId: string
  connectionName: string
  sessions: Session[]
  activeSessionId: string | null
  nextTabNumber: number
}
