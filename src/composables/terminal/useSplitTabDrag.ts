import { onBeforeUnmount, ref } from 'vue'
import type { SplitDropPayload, SplitPreviewPayload } from '@/domain/session/types'
import type { SplitDropTarget } from '@/utils/terminal/splitDropTarget'

type DragSource = {
  dragId: string
  sessionId: string
}

/** Shared pointer lifecycle for terminal-tab and SSH-host split dragging. */
export function useSplitTabDrag(options: {
  resolveTarget: (
    clientX: number,
    clientY: number,
    startX: number,
    startY: number,
  ) => SplitDropTarget | null
  onPreview: (payload: SplitPreviewPayload | null) => void
  onCommit: (payload: SplitDropPayload) => void
  threshold?: number
}) {
  const draggingId = ref<string | null>(null)
  const threshold = options.threshold ?? 18
  let startX = 0
  let startY = 0
  let source: DragSource | null = null
  let started = false
  let suppressClick = false

  function cleanup(clearPreview = false) {
    if (clearPreview && started) options.onPreview(null)
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    draggingId.value = null
    source = null
    started = false
  }

  function onMove(event: MouseEvent) {
    if (!source) return
    if (!started && Math.hypot(event.clientX - startX, event.clientY - startY) > threshold) {
      started = true
      suppressClick = true
    }
    if (!started) return
    const target = options.resolveTarget(event.clientX, event.clientY, startX, startY)
    options.onPreview(target ? { ...target, sessionId: source.sessionId } : null)
  }

  function onUp(event: MouseEvent) {
    const completedSource = source
    const completedDrag = started
    const target = completedDrag
      ? options.resolveTarget(event.clientX, event.clientY, startX, startY)
      : null
    cleanup()
    if (!completedDrag || !completedSource) return
    options.onPreview(null)
    if (target && target.mode !== 'none' && target.side) {
      options.onCommit({
        ...target,
        mode: target.mode,
        side: target.side,
        sessionId: completedSource.sessionId,
      })
    }
  }

  function startDrag(event: MouseEvent, nextSource: DragSource) {
    if (event.button !== 0) return
    cleanup(true)
    startX = event.clientX
    startY = event.clientY
    source = nextSource
    draggingId.value = nextSource.dragId
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  function consumeSuppressedClick(): boolean {
    if (!suppressClick) return false
    suppressClick = false
    return true
  }

  onBeforeUnmount(() => cleanup(true))

  return { draggingId, startDrag, consumeSuppressedClick }
}
