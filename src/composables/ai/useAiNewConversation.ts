import { onScopeDispose, ref, watch } from 'vue'
import { ElMessage } from 'element-plus/es/components/message/index'
import { appConfirm } from '@/composables/app/useAppDialog'
import type { ChatItem } from '@/domain/ai/chat'

/** Confirmation and background-job cleanup belong to the conversation that opened them. */
export function useAiNewConversation(deps: {
  sessionId: () => string
  threadId: () => string
  blocked: () => boolean
  sessionLoading: (id: string) => boolean
  targetSessionIds: () => string[]
  jobIds: () => string[] | undefined
  start: (id: string, sync: (messages: ChatItem[]) => void) => Promise<unknown>
  syncMessages: (messages: ChatItem[]) => void
  syncFromState: () => void
  t: (key: string, params?: Record<string, unknown>) => string
}) {
  const newConversationBusy = ref(false)
  let disposed = false
  let revision = 0
  onScopeDispose(() => { disposed = true })
  watch(deps.sessionId, () => { revision++; newConversationBusy.value = false }, { flush: 'sync' })
  async function handleNewConversation() {
    if (disposed || deps.blocked() || newConversationBusy.value) return
    const sessionId = deps.sessionId()
    const threadId = deps.threadId()
    const version = revision
    const visible = () => !disposed && version === revision && deps.sessionId() === sessionId
    const current = () => visible() && deps.threadId() === threadId && !deps.sessionLoading(sessionId)
    const targets = new Set(deps.targetSessionIds())
    const jobIds = deps.jobIds()
    const allowedJobs = jobIds ? new Set(jobIds) : undefined
    newConversationBusy.value = true
    try {
      const jobs = (await window.LiteConnect.mcpListJobs()).filter(job =>
        targets.has(job.sessionId) && (!allowedJobs || allowedJobs.has(job.jobId)) && job.status === 'running')
      if (!current()) return
      if (jobs.length) {
        try {
          await appConfirm({ title: deps.t('ai.newConversationRunningTitle'),
            message: deps.t('ai.newConversationRunningMessage', { count: jobs.length }),
            detail: deps.t('ai.newConversationRunningDetail'), confirmText: deps.t('ai.newConversationStopAndCreate'),
            cancelText: deps.t('common.cancel'), danger: true, tone: 'warning' })
        } catch { return }
      }
      if (!current()) return
      await window.LiteConnect.aiSuppressBackgroundReplies(sessionId, threadId)
      for (const job of jobs) {
        if (!current()) return
        const result = await window.LiteConnect.mcpCallTool('cancel_job', { jobId: job.jobId })
        if (result.isError) throw new Error(result.content)
      }
      if (!current()) return
      await deps.start(sessionId, messages => { if (visible()) deps.syncMessages(messages) })
      if (visible()) deps.syncFromState()
    } catch (error: any) {
      if (current()) ElMessage.warning(error?.message || deps.t('ai.newConversationFailed'))
    } finally {
      if (visible()) newConversationBusy.value = false
    }
  }
  return { newConversationBusy, handleNewConversation }
}
