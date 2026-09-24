import type { Terminal } from '@xterm/xterm'

/** Background tabs: coalesce writes so xterm does not paint every frame. */
const BACKGROUND_FLUSH_MS = 200
/** Force a write when pending data is huge (still keeps full stream, bounds string growth). */
const MAX_BATCH_CHARS = 256 * 1024
const PAUSE_AT_CHARS = 512 * 1024
const RESUME_AT_CHARS = 128 * 1024
/** Small replies after a key press should not wait for the next animation frame. */
const INTERACTIVE_REPLY_CHARS = 4 * 1024

export function useRenderBatch(
  getTerminal: () => Terminal | null,
  onFlowControlChange?: (paused: boolean) => void,
) {
  type QueuedWrite = { data: string; callbacks: Array<() => void> }

  let renderBatch = ''
  let activeWrite: QueuedWrite | null = null
  const writeQueue: QueuedWrite[] = []
  let pendingChars = 0
  let outputPaused = false
  let generation = 0
  let renderBatchRafId: number | null = null
  let throttleTimer: ReturnType<typeof setTimeout> | null = null
  /** When true, flush on a timer instead of every animation frame. Data is never dropped. */
  let frozen = false

  function updateFlowControl() {
    if (!outputPaused && pendingChars >= PAUSE_AT_CHARS) {
      outputPaused = true
      onFlowControlChange?.(true)
    } else if (outputPaused && pendingChars <= RESUME_AT_CHARS) {
      outputPaused = false
      onFlowControlChange?.(false)
    }
  }

  function clearSchedule() {
    if (renderBatchRafId != null) {
      cancelAnimationFrame(renderBatchRafId)
      renderBatchRafId = null
    }
    if (throttleTimer) {
      clearTimeout(throttleTimer)
      throttleTimer = null
    }
  }

  function runCallbacks(callbacks: Array<() => void>) {
    for (const callback of callbacks) {
      try {
        callback()
      } catch (error) {
        console.error('[TerminalRenderBatch] flush callback failed:', error)
      }
    }
  }

  /** Keep at most one xterm parser write in flight; xterm.write itself is async. */
  function pumpWriteQueue() {
    if (activeWrite) return
    const terminal = getTerminal()
    if (!terminal) {
      const callbacks = writeQueue.flatMap((item) => item.callbacks)
      pendingChars -= writeQueue.reduce((total, item) => total + item.data.length, 0)
      writeQueue.length = 0
      updateFlowControl()
      runCallbacks(callbacks)
      return
    }
    const next = writeQueue.shift()
    if (!next) return
    activeWrite = next
    const writeGeneration = generation
    try {
      terminal.write(next.data, () => {
        if (writeGeneration !== generation) return
        // A callback is a write barrier (resize / PWD query): run it before
        // submitting bytes that arrived after that barrier.
        const completed = activeWrite
        activeWrite = null
        pendingChars -= next.data.length
        updateFlowControl()
        if (completed) runCallbacks(completed.callbacks)
        pumpWriteQueue()
      })
    } catch (error) {
      activeWrite = null
      pendingChars -= next.data.length
      updateFlowControl()
      runCallbacks(next.callbacks)
      console.error('[TerminalRenderBatch] xterm write failed:', error)
      pumpWriteQueue()
    }
  }

  function enqueueWrite(data: string, callback?: () => void) {
    let remaining = data
    // Coalesce future output while the parser is busy, but keep bounded chunks
    // so a large burst does not monopolize one parse turn.
    const tail = writeQueue[writeQueue.length - 1]
    if (tail && tail.callbacks.length === 0 && tail.data.length < MAX_BATCH_CHARS) {
      const take = Math.min(MAX_BATCH_CHARS - tail.data.length, remaining.length)
      tail.data += remaining.slice(0, take)
      remaining = remaining.slice(take)
    }
    while (remaining.length > 0) {
      writeQueue.push({ data: remaining.slice(0, MAX_BATCH_CHARS), callbacks: [] })
      remaining = remaining.slice(MAX_BATCH_CHARS)
    }

    if (callback) {
      const barrier = writeQueue[writeQueue.length - 1] || activeWrite
      if (barrier) barrier.callbacks.push(callback)
      else callback()
    }
    pumpWriteQueue()
  }

  function flushRenderBatch(callback?: () => void) {
    const data = renderBatch
    renderBatch = ''
    clearSchedule()
    if (data.length > 0) {
      enqueueWrite(data, callback)
      return
    }
    if (callback) {
      const barrier = writeQueue[writeQueue.length - 1] || activeWrite
      if (barrier) barrier.callbacks.push(callback)
      else callback()
    }
  }

  function scheduleRenderFlush() {
    if (frozen) {
      if (throttleTimer || renderBatchRafId) return
      throttleTimer = setTimeout(() => {
        throttleTimer = null
        flushRenderBatch()
      }, BACKGROUND_FLUSH_MS)
      return
    }
    if (renderBatchRafId || throttleTimer) return
    renderBatchRafId = requestAnimationFrame(() => {
      renderBatchRafId = null
      flushRenderBatch()
    })
  }

  function flushInteractiveResponse(callback?: () => void): boolean {
    if (frozen || activeWrite || writeQueue.length > 0) return false
    if (renderBatch.length === 0 || renderBatch.length > INTERACTIVE_REPLY_CHARS) return false
    flushRenderBatch(callback)
    return true
  }

  function appendRenderBatch(data: string) {
    if (!data) return
    renderBatch += data
    pendingChars += data.length
    updateFlowControl()
    if (renderBatch.length >= MAX_BATCH_CHARS) {
      flushRenderBatch()
    }
  }

  function resetRenderBatch() {
    generation++
    renderBatch = ''
    writeQueue.length = 0
    if (activeWrite) activeWrite.callbacks.length = 0
    activeWrite = null
    pendingChars = 0
    updateFlowControl()
    clearSchedule()
  }

  /**
   * Freeze: keep consuming SSH into the batch/buffer with throttled writes.
   * Unfreeze: flush pending data immediately so the visible pane is up to date.
   */
  function setRenderFrozen(next: boolean) {
    if (frozen === next) return
    frozen = next
    if (!next) {
      clearSchedule()
      if (renderBatch.length > 0) {
        flushRenderBatch()
      }
    }
  }

  function isRenderFrozen() {
    return frozen
  }

  function getPendingBatchLength() {
    return pendingChars
  }

  function isOutputPaused() {
    return outputPaused
  }

  return {
    flushRenderBatch,
    scheduleRenderFlush,
    flushInteractiveResponse,
    appendRenderBatch,
    resetRenderBatch,
    setRenderFrozen,
    isRenderFrozen,
    getPendingBatchLength,
    isOutputPaused,
  }
}
