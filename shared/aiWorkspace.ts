export interface AiWorkspaceConnectionEvent {
  connectionId: string
  sessionId?: string
  status: 'connected' | 'closed' | 'cancelled'
}

/** Saved scope identity is independent of SSH sessions and terminal history. */
export interface AiWorkspaceScope {
  id: string
  connectionIds: string[]
  createdAt: number
}

export interface AiWorkspaceTarget {
  connectionId: string
  sessionId: string
  name: string
  host: string
  port: number
  username: string
  note?: string
  group?: string
}

export const AI_WORKSPACE_MAX_HOSTS = 20
