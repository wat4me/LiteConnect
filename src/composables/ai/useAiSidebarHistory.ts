import { computed, nextTick, ref, type Ref } from 'vue'
import { ElMessage } from 'element-plus/es/components/message/index'
import { appConfirm } from '@/composables/app/useAppDialog'
import { threadTitleTooltip } from '@/utils/ai/threadTitle'
import type { AiThreadSummary } from '@/env.d'
import type { ChatItem } from './useAiChat'

type HistoryOperation = (sessionId: string, sync: (messages: ChatItem[]) => void) => Promise<unknown>
type ThreadOperation = (sessionId: string, threadId: string, sync: (messages: ChatItem[]) => void) => Promise<unknown>

export function useAiSidebarHistory(deps: {
  sessionId: () => string
  threadSummaries: Ref<AiThreadSummary[]>
  activeThreadId: () => string | null
  loading: Ref<boolean>
  contextFileBusy: Ref<boolean>
  syncMessages: (messages: ChatItem[]) => void
  syncFromState: () => void
  switchConversation: ThreadOperation
  deleteConversation: ThreadOperation
  clearAllConversations: HistoryOperation
  t: (key: string, params?: Record<string, unknown>) => string
  closeModelSwitcher: () => void
  closeSettings: () => void
}) {
  const showHistory = ref(false)
  const historyQuery = ref('')
  const historyItems = computed(() => deps.threadSummaries.value
    .filter(thread => (thread.messageCount || 0) > 0)
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(thread => ({
      id: thread.id,
      title: thread.title || deps.t('ai.newConversationTitle'),
      tip: threadTitleTooltip(thread.title),
      createdAt: thread.updatedAt || thread.createdAt,
      messageCount: thread.messageCount,
      active: thread.active || thread.id === deps.activeThreadId(),
    })))
  const filteredHistoryItems = computed(() => {
    const query = historyQuery.value.trim().toLocaleLowerCase()
    return historyItems.value.filter(item => item.title.toLocaleLowerCase().includes(query))
  })

  async function openHistoryPanel() {
    historyQuery.value = ''
    deps.closeModelSwitcher()
    showHistory.value = true
    deps.closeSettings()
    await nextTick()
  }

  function closeHistoryPanel() { showHistory.value = false }

  async function handleSwitchConversation(threadId: string) {
    if (deps.loading.value || deps.contextFileBusy.value) return
    await deps.switchConversation(deps.sessionId(), threadId, deps.syncMessages)
    deps.syncFromState()
    closeHistoryPanel()
  }

  async function handleDeleteConversation(threadId: string, event?: Event) {
    event?.stopPropagation()
    try {
      await appConfirm({
        title: deps.t('ai.deleteHistoryTitle'),
        message: deps.t('ai.deleteHistoryMessage'),
        detail: deps.t('ai.deleteHistoryDetail'),
        confirmText: deps.t('ai.clear'),
        cancelText: deps.t('common.cancel'),
        danger: true,
        tone: 'danger',
      })
    } catch { return }
    const ok = await deps.deleteConversation(deps.sessionId(), threadId, deps.syncMessages)
    if (ok) ElMessage.success(deps.t('ai.historyDeleted'))
  }

  async function handleClearAllHistory() {
    const count = historyItems.value.length
    if (count === 0) return
    try {
      await appConfirm({
        title: deps.t('ai.clearAllHistoryTitle'),
        message: deps.t('ai.clearAllHistoryMessage', { count }),
        confirmText: deps.t('ai.clear'),
        cancelText: deps.t('common.cancel'),
        danger: true,
        tone: 'danger',
      })
    } catch { return }
    const ok = await deps.clearAllConversations(deps.sessionId(), deps.syncMessages)
    if (ok) ElMessage.success(deps.t('ai.allHistoryCleared'))
  }

  function formatHistoryTime(timestamp: number) {
    return new Date(timestamp).toLocaleString(undefined, {
      month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  }

  return { showHistory, historyQuery, historyItems, filteredHistoryItems,
    openHistoryPanel, closeHistoryPanel, handleSwitchConversation,
    handleDeleteConversation, handleClearAllHistory, formatHistoryTime }
}
