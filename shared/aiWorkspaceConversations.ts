export interface AiWorkspaceConversationItem {
  workspaceId?: string
  connectionIds?: string[]
  connectionId: string
  hostLabel: string
  threadId: string
  title: string
  updatedAt: number
  messageCount: number
  pinned?: boolean
  /** True when this thread is the host store's active conversation. */
  active?: boolean
}

export const AI_WORKSPACE_HISTORY_LIMIT = 8
