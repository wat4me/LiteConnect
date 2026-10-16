import type { AiChatMessage } from './types/ai'

export const AI_BACKGROUND_RESULT_PREFIX = 'Application background-task completion.'

/** Both idle wakeups and results received during a live turn use the same cards. */
export function aiBackgroundResultNotices(record: { backgroundNotice?: string; apiMessages?: AiChatMessage[] }): string[] {
  return [...new Set([
    ...(record.backgroundNotice ? [record.backgroundNotice] : []),
    ...(record.apiMessages || []).filter(message => message.role === 'user' && message.content.startsWith(AI_BACKGROUND_RESULT_PREFIX)).map(message => message.content),
  ])]
}
