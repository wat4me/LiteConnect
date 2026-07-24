import { reactive } from 'vue'

const unreadSessions = reactive(new Set<string>())

function markUnread(sessionId: string) {
  unreadSessions.add(sessionId)
}

function clearUnread(sessionId: string) {
  unreadSessions.delete(sessionId)
}

function hasUnread(sessionId: string): boolean {
  return unreadSessions.has(sessionId)
}

export function useAiReplyBadge() {
  return {
    unreadSessions,
    markUnread,
    clearUnread,
    hasUnread,
  }
}
