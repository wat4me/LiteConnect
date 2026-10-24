import { computed } from 'vue'
import type { AiFileTransferPort } from '@/domain/ai/fileTransfers'

/** AI conversations may share SSH; filter by the trusted originating conversation and thread. */
export function useAiFileTransfers(conversationId: () => string, threadId: () => string, store: AiFileTransferPort) {
  const items = computed(() => [...store.transfers].filter(([, item]) =>
    item.origin?.source === 'ai' && item.origin.conversationId === conversationId() && item.origin.threadId === threadId(),
  ))
  const active = computed(() => items.value.filter(([, item]) => item.status === 'downloading' || item.status === 'uploading'))
  const progress = computed(() => {
    const total = active.value.reduce((sum, [, item]) => sum + item.total, 0)
    return total > 0 ? Math.min(100, Math.round(active.value.reduce((sum, [, item]) => sum + item.transferred, 0) / total * 100)) : null
  })
  function clearFinished() {
    for (const [id, item] of items.value) {
      if (item.status !== 'downloading' && item.status !== 'uploading') store.removeTransfer(id)
    }
  }
  return { items, active, progress, clearFinished, cancel: store.cancelTransfer, remove: store.removeTransfer, getSpeed: store.getSpeed }
}
