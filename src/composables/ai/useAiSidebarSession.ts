import { computed, onMounted, onScopeDispose, ref, shallowRef, watch } from 'vue'
import { ElMessage } from 'element-plus/es/components/message/index'
import type { ChatItem } from '@/domain/ai/chat'
import type { AiImageAttachment, AiSettings } from '@shared/types/ai'
import type { useAiChat } from './useAiChat'

/** Projects the public chat state and binds asynchronous composer work to its origin. */
export function useAiSidebarSession(deps: {
  chat: Pick<ReturnType<typeof useAiChat>, 'getSessionState' | 'saveSessionInput' | 'refreshSettings' | 'loadHistory' | 'sendText' | 'stopGeneration' | 'replaceSettings'>
  sessionId: () => string
  active: () => boolean
  openGeneration: () => number
  selectionRequest: () => { id: number; sessionId: string; text: string; mode: 'send' | 'insert' } | null | undefined
  selectionConsumed: (id: number) => void
  canSend: () => boolean
  sendBlocked: () => boolean
  canCompact: () => boolean
  compact: () => Promise<void>
  applySettings: () => void
  t: (key: string) => string
}) {
  const { chat } = deps
  const state = () => chat.getSessionState(deps.sessionId())
  const messages = shallowRef<ChatItem[]>(state().messages)
  const input = computed({ get: () => state().input, set: value => chat.saveSessionInput(deps.sessionId(), value) })
  const loading = ref(state().loading)
  const threadSummaries = computed(() => state().threads)
  const loads = new Map<string, Promise<void>>()
  const consumedSelectionIds = new Set<number>()
  let disposed = false
  let revision = 0
  onScopeDispose(() => { disposed = true; loads.clear() })

  function capture() {
    const sessionId = deps.sessionId()
    const original = chat.getSessionState(sessionId)
    const threadId = original.activeThreadId
    const version = revision
    const visible = () => !disposed && revision === version && deps.sessionId() === sessionId
    const current = () => visible() && original.activeThreadId === threadId
    return { sessionId, original, threadId, visible, current }
  }
  function syncMessages(items: ChatItem[]) { if (!disposed) messages.value = items }
  function syncFromState() {
    if (disposed) return
    messages.value = state().messages
    loading.value = state().loading
  }
  watch(() => state().loading, value => { loading.value = value })

  async function ensureInitialLoad(syncUi = true) {
    if (disposed) return
    const target = capture()
    let pending = loads.get(target.sessionId)
    if (!pending) {
      pending = (async () => {
        try {
          await chat.refreshSettings()
          if (target.visible()) deps.applySettings()
        } catch (error: any) {
          if (target.visible()) ElMessage.warning(error?.message || deps.t('ai.loadSettingsFailed'))
        }
        if (disposed || target.original.loaded) return
        const history = await chat.loadHistory(target.sessionId)
        if (!disposed && !target.original.messages.length && history.length) target.original.messages.push(...history)
      })()
      loads.set(target.sessionId, pending)
      // A failed load must be retryable; a successful load remains deduplicated.
      void pending.catch(() => { if (loads.get(target.sessionId) === pending) loads.delete(target.sessionId) })
    }
    await pending
    if (!target.original.loaded && loads.get(target.sessionId) === pending) loads.delete(target.sessionId)
    if (syncUi && target.visible()) syncFromState()
  }
  async function ensureOpenPrepared() {
    const target = capture()
    await ensureInitialLoad(false)
    if (target.visible()) syncFromState()
  }
  onMounted(() => { void ensureOpenPrepared().catch(() => {}) })
  watch(deps.sessionId, () => {
    revision++
    syncFromState()
    void ensureOpenPrepared().catch(() => {})
  }, { flush: 'sync' })
  watch(deps.openGeneration, () => {
    if (deps.active()) void ensureOpenPrepared().catch(() => {})
  })

  async function handleSendText(text: string, images?: AiImageAttachment[]): Promise<boolean> {
    const content = text.trim()
    if (disposed || (!content && !images?.length) || deps.sendBlocked()) return false
    let target = capture()
    if (!target.threadId) {
      await ensureInitialLoad(false)
      if (!target.visible() || !target.original.activeThreadId) return false
      target = capture()
    }
    loading.value = true
    try {
      return await chat.sendText(target.sessionId, content, items => {
        if (target.current()) syncMessages(items)
      }, images)
    } finally {
      if (target.visible()) loading.value = state().loading
    }
  }
  async function sendMessage() {
    if (disposed) return
    if (input.value.trim() === '/compact' && !state().draftImages.length && deps.canCompact()) {
      input.value = ''
      await deps.compact()
      return
    }
    if (!deps.canSend()) return
    const opening = capture()
    if (!opening.threadId) {
      await ensureInitialLoad(false)
      if (!opening.visible() || !opening.original.activeThreadId || !deps.canSend()) return
    }
    const target = capture()
    const content = input.value.trim()
    const images = target.original.draftImages.splice(0)
    input.value = ''
    const restore = () => {
      // Preserve a failed submission in its own draft, including when hidden.
      if (target.original.activeThreadId !== target.threadId) return
      if (!target.original.input) target.original.input = content
      target.original.draftImages.unshift(...images)
    }
    try {
      if (!await handleSendText(content, images)) restore()
    } catch (error: any) {
      restore()
      if (target.current()) ElMessage.warning(error?.message || deps.t('ai.requestFailed'))
    }
  }
  async function handleStop() {
    const target = capture()
    await chat.stopGeneration(target.sessionId)
    if (target.current()) loading.value = target.original.loading
  }
  async function onSettingsSaved(next: AiSettings) {
    chat.replaceSettings(next)
    if (loading.value || disposed) return
    const target = capture()
    await chat.loadHistory(target.sessionId)
    if (target.current()) syncFromState()
  }
  watch(deps.selectionRequest, async request => {
    if (!request?.text || request.sessionId !== deps.sessionId() || consumedSelectionIds.has(request.id)) return
    const target = capture()
    await ensureOpenPrepared()
    if (!target.visible() || (target.threadId && !target.current()) || consumedSelectionIds.has(request.id)) return
    consumedSelectionIds.add(request.id)
    deps.selectionConsumed(request.id)
    if (request.mode === 'insert') { input.value = request.text; return }
    const origin = capture()
    if (!await handleSendText(request.text) && origin.current()) input.value = request.text
  }, { immediate: true })

  return { messages, input, loading, threadSummaries, syncMessages, syncFromState,
    ensureInitialLoad, ensureOpenPrepared, handleSendText, sendMessage, handleStop, onSettingsSaved }
}
