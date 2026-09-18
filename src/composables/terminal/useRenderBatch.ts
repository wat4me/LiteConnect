import type { Terminal } from '@xterm/xterm'

/** Background tabs: coalesce writes so xterm does not paint every frame. */
const BACKGROUND_FLUSH_MS = 200
/** Force a write when pending data is huge (still keeps full stream, bounds string growth). */
const MAX_BATCH_CHARS = 256 * 1024

export function useRenderBatch(getTerminal: () => Terminal | null) {
  let renderBatch = ''
  let renderBatchRafId: number | null = null
  let throttleTimer: ReturnType<typeof setTimeout> | null = null
  /** When true, flush on a timer instead of every animation frame. Data is never dropped. */
  let frozen = false

  function clearSchedule() {
    if (renderBatchRafId) {
      cancelAnimationFrame(renderBatchRafId)
      renderBatchRafId = null
    }
    if (throttleTimer) {
      clearTimeout(throttleTimer)
      throttleTimer = null
    }
  }

  function flushRenderBatch(callback?: () => void) {
    const terminal = getTerminal()
    if (!terminal || renderBatch.length === 0) {
      renderBatch = ''
      clearSchedule()
      callback?.()
      return
    }
    const data = renderBatch
    renderBatch = ''
    clearSchedule()
    terminal.write(data, callback)
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

  function appendRenderBatch(data: string) {
    if (!data) return
    renderBatch += data
    if (renderBatch.length >= MAX_BATCH_CHARS) {
      flushRenderBatch()
    }
  }

  function resetRenderBatch() {
    renderBatch = ''
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
    return renderBatch.length
  }

  return {
    flushRenderBatch,
    scheduleRenderFlush,
    appendRenderBatch,
    resetRenderBatch,
    setRenderFrozen,
    isRenderFrozen,
    getPendingBatchLength,
  }
}
