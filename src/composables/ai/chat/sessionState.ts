import { reactive } from 'vue'
import type { AiSessionState, ChatItem } from '@/domain/ai/chat'
import type { AiThreadSummary } from '@shared/types/ai'
import { syncAiApprovalPending } from '../useAiApprovalHint'
import { AI_SESSION_OVERHEAD_BYTES, estimateAiTextBytes } from '@shared/appResourceStats'
import { registerAiResourceProbe } from '@/composables/app/rendererResourceRegistry'

const aiSessionStates = new Map<string, AiSessionState>()

const contextCompressionNotices = new Map<string, { close: () => void }>()

export function closeContextCompressionNotice(sessionId: string): void {
  contextCompressionNotices.get(sessionId)?.close()
  contextCompressionNotices.delete(sessionId)
}

export function getAiSessionState(sessionId: string): AiSessionState {
  let state = aiSessionStates.get(sessionId)
  if (!state) {
    state = reactive({
      draftImages: [],
      compactionCount: 0,
      messages: reactive([]) as ChatItem[],
      input: '',
      loading: false,
      persisting: false,
      activeThreadId: '',
      threads: reactive([]) as AiThreadSummary[],
      activeRequestId: null,
      loaded: false,
      disposeAfterReply: false,
      contextCheckpoint: undefined,
      contextFiles: [],
      defaultContextFiles: [],
    })
    aiSessionStates.set(sessionId, state)
  }
  return state
}

export function listAiResourceUsage(): { sessionCount: number; estimatedBytes: number } {
  let estimatedBytes = 0
  for (const state of aiSessionStates.values()) {
    estimatedBytes += AI_SESSION_OVERHEAD_BYTES
    estimatedBytes += estimateAiTextBytes(state.input?.length || 0)
    estimatedBytes += state.draftImages.reduce((sum, image) => sum + estimateAiTextBytes(image.dataUrl?.length || 0), 0)
    estimatedBytes += estimateAiTextBytes(state.contextFiles.reduce((total, file) => total + file.content.length, 0))
    for (const message of state.messages) {
      estimatedBytes += (message.images || []).reduce((sum, image) => sum + estimateAiTextBytes(image.dataUrl?.length || 0), 0)
      estimatedBytes += estimateAiTextBytes(
        (message.content?.length || 0) + (message.reasoningContent?.length || 0) + (message.backgroundNotice?.length || 0),
      )
    }
  }
  return { sessionCount: aiSessionStates.size, estimatedBytes }
}

/** Stop background work and release renderer-only state when its terminal closes. */
export function disposeAiSessionState(sessionId: string): void {
  const state = aiSessionStates.get(sessionId)
  if (!state) return
  syncAiApprovalPending(sessionId, false)
  closeContextCompressionNotice(sessionId)
  state.input = ''
  state.draftImages = []
  if (state.loading) {
    state.disposeAfterReply = true
    if (state.activeRequestId) {
      void window.LiteConnect.aiAbortChatStream(state.activeRequestId).catch(() => { })
    }
    return
  }
  aiSessionStates.delete(sessionId)
}

export const findAiSessionState = (id: string) => aiSessionStates.get(id)
export const releaseAiSessionState = (id: string) => aiSessionStates.delete(id)
export function setContextCompressionNotice(id: string, notice: { close: () => void }) { contextCompressionNotices.set(id, notice) }

registerAiResourceProbe(listAiResourceUsage)
