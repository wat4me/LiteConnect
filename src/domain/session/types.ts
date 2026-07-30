export interface Session {
  id: string
  connectionId: string
  connectionName: string
  tabNumber: number
}

export interface ConnectionGroup {
  connectionId: string
  connectionName: string
  sessions: Session[]
  activeSessionId: string | null
  nextTabNumber: number
}
