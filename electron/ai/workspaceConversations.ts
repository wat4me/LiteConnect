import { aiHistoryIdForHost } from './historyScope'
import { aiSessionKey, getAppDatabase } from '../store/appDatabase'
import { AI_WORKSPACE_HISTORY_LIMIT, type AiWorkspaceConversationItem } from '../../shared/aiWorkspaceConversations'

type HostRef = { id: string; name: string; host: string; port?: number }

/** Lightweight recent-thread index for LiteAI; skips schedule temps and empty drafts. */
export function listAiWorkspaceConversations(hosts: HostRef[], limit = AI_WORKSPACE_HISTORY_LIMIT): AiWorkspaceConversationItem[] {
  const db = getAppDatabase()
  const items: AiWorkspaceConversationItem[] = []
  for (const host of hosts) {
    if (!host?.id || !host.host) continue
    let historyId: string
    try { historyId = aiHistoryIdForHost(host.host, host.port || 22) }
    catch { continue }
    const raw = db.getSingleton<any>(aiSessionKey(historyId))
    if (!raw || !Array.isArray(raw.threads)) continue
    const activeThreadId = typeof raw.activeThreadId === 'string' ? raw.activeThreadId : ''
    const label = host.name || `${host.host}:${host.port || 22}`
    for (const thread of raw.threads) {
      if (!thread || typeof thread.id !== 'string' || !thread.id) continue
      const messageCount = Array.isArray(thread.messages) ? thread.messages.length : 0
      if (messageCount < 1) continue
      const title = (typeof thread.customTitle === 'string' && thread.customTitle.trim())
        || (typeof thread.title === 'string' && thread.title.trim())
        || ''
      items.push({
        connectionId: host.id,
        hostLabel: label,
        threadId: thread.id,
        title: title.slice(0, 80) || label,
        updatedAt: Number(thread.updatedAt) || Number(thread.createdAt) || 0,
        messageCount,
        pinned: thread.pinned === true,
        active: thread.id === activeThreadId,
      })
    }
  }
  return items
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt - a.updatedAt)
    .slice(0, Math.max(1, limit))
}
