import { computed, reactive, watch } from 'vue'
import type { ChatItem } from '@/domain/ai/chat'

export const toolDisclosureKey = (messageId: string, runId: string) => JSON.stringify([messageId, 'tool', runId])
export const reasoningDisclosureKey = (messageId: string, index: number) => JSON.stringify([messageId, 'reasoning', index])

function reasoningIndices(message: ChatItem): number[] {
  return message.segments?.length
    ? message.segments.flatMap((segment, index) => segment.kind === 'reasoning' ? [index] : [])
    : message.reasoningContent ? [0] : []
}

/** Retain disclosure preferences across paging, but not deleted messages or threads. */
export function useAiDisclosureState(deps: { messages: () => ChatItem[]; conversationKey: () => string | undefined }) {
  const toolOpenState = reactive(new Map<string, boolean>())
  const reasoningOpenState = reactive(new Map<string, boolean>())
  const signature = computed(() => JSON.stringify(deps.messages().map(message => [
    message.id, (message.toolRuns || []).map(run => run.id), reasoningIndices(message),
  ])))
  watch([deps.conversationKey, signature], ([key], [previousKey]) => {
    if (key !== previousKey) {
      toolOpenState.clear()
      reasoningOpenState.clear()
      return
    }
    const tools = new Set<string>()
    const reasoning = new Set<string>()
    for (const message of deps.messages()) {
      for (const run of message.toolRuns || []) tools.add(toolDisclosureKey(message.id, run.id))
      for (const index of reasoningIndices(message)) reasoning.add(reasoningDisclosureKey(message.id, index))
    }
    for (const key of toolOpenState.keys()) if (!tools.has(key)) toolOpenState.delete(key)
    for (const key of reasoningOpenState.keys()) if (!reasoning.has(key)) reasoningOpenState.delete(key)
  }, { immediate: true })
  return { toolOpenState, reasoningOpenState }
}
