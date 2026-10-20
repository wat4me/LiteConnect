import { computed, onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue'
import { ElMessage } from 'element-plus/es/components/message/index'
import { appConfirm, appPrompt } from '@/composables/app/useAppDialog'
import { threadTitleTooltip } from '@/utils/ai/threadTitle'
import type { AiThreadSummary } from '@/env.d'
import type { ChatItem } from '@/domain/ai/chat'

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
  const historyBusy = ref(false)
  let disposed = false
  let revision = 0
  let indexRequest = 0
  function capture() {
    const sessionId = deps.sessionId()
    const threadId = deps.activeThreadId()
    const version = revision
    const visible = () => !disposed && revision === version && deps.sessionId() === sessionId
    const current = () => visible() && deps.activeThreadId() === threadId
    const sync = (messages: ChatItem[]) => { if (visible()) deps.syncMessages(messages) }
    return { sessionId, visible, current, sync }
  }
  onScopeDispose(() => { disposed = true; indexRequest++ })
  watch(deps.sessionId, () => { revision++; historyBusy.value = false; closeHistoryPanel() }, { flush: 'sync' })
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
    if (disposed) return
    const target = capture()
    const request = ++indexRequest
    historyQuery.value = ''
    historyBody.value = {}
    deps.closeModelSwitcher()
    showHistory.value = true
    deps.closeSettings()
    try {
      const store = await window.LiteConnect.getAiSessionStore(target.sessionId)
      if (!showHistory.value || !target.visible() || request !== indexRequest) return
      historyBody.value = Object.fromEntries(store.threads.map(thread => [
        thread.id,
        thread.messages.map(message => message.content).filter(Boolean),
      ]))
    } catch {
      if (target.visible() && request === indexRequest) historyBody.value = {}
    }
  }

  function closeHistoryPanel() {
    indexRequest++
    showHistory.value = false
    historyBody.value = {}
  }

  async function handleSwitchConversation(threadId: string) {
    if (disposed || historyBusy.value || deps.loading.value || deps.contextFileBusy.value) return
    const target = capture()
    historyBusy.value = true
    try {
      const ok = await deps.switchConversation(target.sessionId, threadId, target.sync)
      if (target.visible() && ok !== false) { deps.syncFromState(); closeHistoryPanel() }
    } finally { if (target.visible()) historyBusy.value = false }
  }

  async function handleDeleteConversation(threadId: string, event?: Event) {
    event?.stopPropagation()
    if (disposed || historyBusy.value || deps.loading.value || deps.contextFileBusy.value) return
    const target = capture()
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
    if (!target.current() || deps.loading.value || historyBusy.value) return
    historyBusy.value = true
    try {
      const ok = await deps.deleteConversation(target.sessionId, threadId, target.sync)
      if (ok && target.visible()) ElMessage.success(deps.t('ai.historyDeleted'))
    } finally { if (target.visible()) historyBusy.value = false }
  }

  async function handleRenameConversation(threadId: string, title: string, event?: Event) {
    event?.stopPropagation()
    if (disposed) return
    const target = capture()
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
    if (target.current()) await deps.updateConversation(target.sessionId, threadId, { customTitle: next.trim() || null })
  }

  async function handleTogglePin(threadId: string, pinned: boolean, event?: Event) {
    event?.stopPropagation()
    if (disposed) return
    await deps.updateConversation(deps.sessionId(), threadId, { pinned: !pinned })
  }

  async function handleClearAllHistory() {
    if (disposed || historyBusy.value || deps.loading.value || deps.contextFileBusy.value) return
    const target = capture()
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
    if (!target.current() || deps.loading.value || historyBusy.value) return
    historyBusy.value = true
    try {
      const ok = await deps.clearAllConversations(target.sessionId, target.sync)
      if (ok && target.visible()) ElMessage.success(deps.t('ai.allHistoryCleared'))
    } finally { if (target.visible()) historyBusy.value = false }
  }

  function formatHistoryTime(timestamp: number) {
    return new Date(timestamp).toLocaleString(undefined, {
      month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  }

  return { showHistory, historyQuery, historyItems, filteredHistoryItems, historyBusy,
    openHistoryPanel, closeHistoryPanel, handleSwitchConversation,
    handleDeleteConversation, handleRenameConversation, handleTogglePin,
    handleClearAllHistory, formatHistoryTime }
}
