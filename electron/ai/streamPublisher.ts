import type { AiChatStreamPayload } from '../../shared/types/ai'

/** Coalesce adjacent text deltas while preserving content/reasoning/tool order. */
export function createStreamPublisher(send: (payload: AiChatStreamPayload) => void, delayMs = 50) {
  let pending: Extract<AiChatStreamPayload, { type: 'content' | 'reasoning' }> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const deliver = (payload: AiChatStreamPayload) => {
    try { send(payload) } catch { /* Publishing is independent of execution and storage. */ }
  }
  const flush = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    if (!pending) return
    const payload = pending
    pending = undefined
    deliver(payload)
  }
  const publish = (payload: AiChatStreamPayload) => {
    if (payload.type !== 'content' && payload.type !== 'reasoning') {
      flush()
      deliver(payload)
      return
    }
    if (pending && pending.type !== payload.type) flush()
    if (pending) pending.value += payload.value
    else pending = { ...payload }
    if (pending.value.length >= 16_384) flush()
    else if (timer === undefined) timer = setTimeout(flush, delayMs)
  }
  return { publish, flush }
}
