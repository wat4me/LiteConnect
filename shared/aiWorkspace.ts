export interface AiWorkspaceConnectionEvent {
  connectionId: string
  sessionId?: string
  status: 'connected' | 'closed' | 'cancelled'
}
