const TYPING_RESPONSE_WINDOW_MS = 6000

type PendingInput = { at: number; handlerMs: number }

/** Approximate key-to-first-output timing; unsolicited output may be the first reply. */
export function createTypingResponseTracker(now: () => number = () => performance.now()) {
  let pending: PendingInput | null = null

  function noteInput(data: string, allowed: boolean) {
    const printable = data.length === 1 && data.charCodeAt(0) >= 0x20 && data.charCodeAt(0) !== 0x7f
    pending = allowed && printable ? { at: now(), handlerMs: 0 } : null
  }

  function finishInputHandler() {
    if (pending) pending.handlerMs = now() - pending.at
  }

  function takeResponse() {
    const input = pending
    pending = null
    if (!input) return null
    const responseMs = now() - input.at
    if (responseMs >= TYPING_RESPONSE_WINDOW_MS) return null
    return { inputHandlerMs: input.handlerMs, responseMs }
  }

  return { noteInput, finishInputHandler, takeResponse }
}

/** Dev-only incoming-output delay; preserves order and cancels pending output on disposal. */
export function createDelayedTerminalOutput(deliver: (data: string) => void, delayMs: number) {
  const queue: Array<{ data: string; dueAt: number }> = []
  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  function drain() {
    timer = null
    if (disposed) return
    const now = Date.now()
    while (queue.length > 0 && queue[0].dueAt <= now) {
      deliver(queue.shift()!.data)
    }
    if (queue.length > 0) timer = setTimeout(drain, Math.max(0, queue[0].dueAt - Date.now()))
  }

  function push(data: string) {
    if (disposed) return
    if (delayMs <= 0) {
      deliver(data)
      return
    }
    queue.push({ data, dueAt: Date.now() + delayMs })
    if (!timer) timer = setTimeout(drain, delayMs)
  }

  function dispose() {
    disposed = true
    queue.length = 0
    if (timer) clearTimeout(timer)
    timer = null
  }

  return { push, dispose }
}
