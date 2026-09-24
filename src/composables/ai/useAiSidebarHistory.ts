import { computed, nextTick, ref, shallowRef, type Ref } from 'vue'
import { ElMessage } from 'element-plus/es/components/message/index'
import { appConfirm, appPrompt } from '@/composables/app/useAppDialog'
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
  updateConversation: (sessionId: string, threadId: string, patch: { customTitle?: string | null; pinned?: boolean }) => Promise<boolean>
  t: (key: string, params?: Record<string, unknown>) => string
  closeModelSwitcher: () => void
  closeSettings: () => void
}) {
  const showHistory = ref(false)
  const historyQuery = ref('')
  const historyBody = shallowRef<Record<string, string[]>>({})
  const historyItems = computed(() => deps.threadSummaries.value
    .filter(thread => (thread.messageCount || 0) > 0)
    .slice()
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt - a.updatedAt)
    .map(thread => ({
      id: thread.id,
      title: thread.title || deps.t('ai.newConversationTitle'),
      customTitle: thread.customTitle,
      pinned: thread.pinned === true,
      tip: threadTitleTooltip(thread.title),
      createdAt: thread.updatedAt || thread.createdAt,
      messageCount: thread.messageCount,
      active: thread.active || thread.id === deps.activeThreadId(),
    })))
  const filteredHistoryItems = computed(() => {
    const query = historyQuery.value.trim().toLocaleLowerCase()
    if (!query) return historyItems.value.map(item => ({ ...item, match: '' }))
    return historyItems.value.flatMap(item => {
      if (item.title.toLocaleLowerCase().includes(query)) return [{ ...item, match: '' }]
      const match = historyBody.value[item.id]?.find(content => content.toLocaleLowerCase().includes(query))
      if (!match) return []
      const normalized = match.replace(/\s+/g, ' ').trim()
      const at = normalized.toLocaleLowerCase().indexOf(query)
      const start = Math.max(0, at - 35)
      return [{ ...item, match: `${start ? '…' : ''}${normalized.slice(start, start + 110)}${start + 110 < normalized.length ? '…' : ''}` }]
    })
  })

  async function openHistoryPanel() {
    historyQuery.value = ''
    deps.closeModelSwitcher()
    showHistory.value = true
    deps.closeSettings()
    await nextTick()
    const sessionId = deps.sessionId()
    try {
      const store = await window.LiteConnect.getAiSessionStore(sessionId)
      if (!showHistory.value || deps.sessionId() !== sessionId) return
      historyBody.value = Object.fromEntries(store.threads.map(thread => [
        thread.id,
        thread.messages.map(message => message.content).filter(Boolean),
      ]))
    } catch {
      if (deps.sessionId() === sessionId) historyBody.value = {}
    }
  }

  function closeHistoryPanel() {
    showHistory.value = false
    historyBody.value = {}
  }

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

  async function handleRenameConversation(threadId: string, title: string, event?: Event) {
    event?.stopPropagation()
    let next: string
    try {
      next = await appPrompt({
        title: deps.t('ai.renameConversation'),
        message: deps.t('ai.renameConversationHint'),
        inputValue: title,
        maxLength: 200,
        required: false,
      })
    } catch { return }
    await deps.updateConversation(deps.sessionId(), threadId, { customTitle: next.trim() || null })
  }

  async function handleTogglePin(threadId: string, pinned: boolean, event?: Event) {
    event?.stopPropagation()
    await deps.updateConversation(deps.sessionId(), threadId, { pinned: !pinned })
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
    handleDeleteConversation, handleRenameConversation, handleTogglePin,
    handleClearAllHistory, formatHistoryTime }
}
