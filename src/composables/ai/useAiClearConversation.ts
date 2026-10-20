import { onScopeDispose, ref, watch } from 'vue'
import { ElMessage } from 'element-plus/es/components/message/index'
import { appConfirm } from '@/composables/app/useAppDialog'
import type { ChatItem } from '@/domain/ai/chat'

export function useAiClearConversation(deps: {
  sessionId: () => string
  threadId: () => string
  blocked: () => boolean
  hasMessages: () => boolean
  targetSessionIds: () => string[]
  jobIds: () => string[] | undefined
  clear: (sessionId: string, sync: (messages: ChatItem[]) => void) => Promise<boolean>
  syncMessages: (messages: ChatItem[]) => void
  cleared: () => void
  t: (key: string) => string
}) {
  const clearingConversation = ref(false)
  let disposed = false
  let revision = 0
  onScopeDispose(() => { disposed = true })
  watch(deps.sessionId, () => { revision++; clearingConversation.value = false }, { flush: 'sync' })

  async function handleClearConversation() {
    if (disposed || deps.blocked() || clearingConversation.value || !deps.hasMessages()) return
    const sessionId = deps.sessionId()
    const threadId = deps.threadId()
    const version = revision
    const visible = () => !disposed && version === revision && deps.sessionId() === sessionId
    const current = () => visible() && deps.threadId() === threadId && !deps.blocked()
    const targets = new Set(deps.targetSessionIds())
    const jobIds = deps.jobIds()
    const allowedJobs = jobIds ? new Set(jobIds) : undefined
    clearingConversation.value = true
    try {
      const jobs = await window.LiteConnect.mcpListJobs()
      if (!current()) return
      if (jobs.some(job => targets.has(job.sessionId) && (!allowedJobs || allowedJobs.has(job.jobId)) && job.status === 'running')) {
        ElMessage.warning(deps.t('ai.clearConversationJobsRunning'))
        return
      }
      try {
        await appConfirm({ title: deps.t('ai.clearConversationTitle'),
          message: deps.t('ai.clearConversationMessage'), detail: deps.t('ai.clearConversationDetail'),
          confirmText: deps.t('ai.clear'), cancelText: deps.t('common.cancel'), danger: true, tone: 'warning' })
      } catch { return }
      if (!current()) return
      await window.LiteConnect.aiSuppressBackgroundReplies(sessionId, threadId)
      if (!current()) return
      const cleared = await deps.clear(sessionId, messages => { if (current()) deps.syncMessages(messages) })
      if (cleared && current()) {
        deps.cleared()
        ElMessage.success(deps.t('ai.conversationCleared'))
      }
    } catch (error: any) {
      if (current()) ElMessage.warning(error?.message || deps.t('ai.clearConversationFailed'))
    } finally {
      if (visible()) clearingConversation.value = false
    }
  }
  return { clearingConversation, handleClearConversation }
}
