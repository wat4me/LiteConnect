import { onScopeDispose, type Ref } from 'vue'
import { ElMessage } from 'element-plus/es/components/message/index'
import { appConfirm } from '@/composables/app/useAppDialog'
import type { ChatItem } from '@/domain/ai/chat'

type SyncMessages = (messages: ChatItem[]) => void
type MessageAction = (sessionId: string, messageId: string, sync: SyncMessages) => Promise<unknown>

export function useAiMessageActions(deps: {
  sessionId: () => string
  threadId: () => string
  blocked: () => boolean
  loading: Ref<boolean>
  sessionLoading: (sessionId: string) => boolean
  syncMessages: SyncMessages
  regenerate: MessageAction
  retry: MessageAction
  remove: MessageAction
  edit: (sessionId: string, messageId: string, text: string, sync: SyncMessages, persisted: () => void) => Promise<boolean>
  t: (key: string) => string
}) {
  let disposed = false
  onScopeDispose(() => { disposed = true })

  function captureTarget() {
    const sessionId = deps.sessionId()
    const threadId = deps.threadId()
    const current = () => !disposed && deps.sessionId() === sessionId && deps.threadId() === threadId
    const sync: SyncMessages = messages => { if (current()) deps.syncMessages(messages) }
    return { sessionId, current, sync }
  }

  async function run(action: MessageAction, messageId: string) {
    if (disposed || deps.blocked()) return
    const target = captureTarget()
    deps.loading.value = true
    try {
      await action(target.sessionId, messageId, target.sync)
    } finally {
      if (target.current()) deps.loading.value = deps.sessionLoading(target.sessionId)
    }
  }

  async function handleEditResend(messageId: string, text: string, done: (success: boolean) => void) {
    if (disposed || deps.blocked()) { done(false); return }
    const target = captureTarget()
    let started = false
    try {
      const ok = await deps.edit(target.sessionId, messageId, text, target.sync, () => {
        started = true
        done(true)
      })
      if (!ok && !started) {
        done(false)
        if (target.current()) ElMessage.warning(deps.t('ai.editResendFailed'))
      }
    } catch (error: any) {
      if (!started) done(false)
      if (target.current()) ElMessage.warning(error?.message || deps.t('ai.editResendFailed'))
    }
  }

  async function handleDeleteMessage(messageId: string) {
    if (disposed) return
    const target = captureTarget()
    try {
      await appConfirm({
        title: deps.t('ai.deleteMessageTitle'), message: deps.t('ai.deleteMessageConfirm'),
        confirmText: deps.t('common.delete'), cancelText: deps.t('common.cancel'),
        danger: true, tone: 'danger',
      })
    } catch { return }
    if (target.current()) await deps.remove(target.sessionId, messageId, target.sync)
  }

  return {
    handleRegenerate: (id: string) => run(deps.regenerate, id),
    handleRetry: (id: string) => run(deps.retry, id),
    handleEditResend,
    handleDeleteMessage,
  }
}
