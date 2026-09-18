import { ref, computed, onBeforeUnmount } from 'vue'
import type { SplitMode, SplitSide } from '@/domain/terminal/types'

export type { SplitMode, SplitSide }

const RESIZE_MIN = 20
const RESIZE_MAX = 80
const DIVIDER_SIZE = 6

export function useSplitTerminal() {
  const splitMode = ref<SplitMode>('none')
  const splitRatio = ref(50)
  const isResizing = ref(false)
  const previewMode = ref<SplitMode>('none')
  /** Previewed drop side during drag; null when not previewing a side-aware drop */
  const previewSide = ref<SplitSide | null>(null)
  /** Explicit secondary pane session; null = auto-pick non-active session */
  const secondarySessionId = ref<string | null>(null)
  /** Which side the secondary pane occupies. Driven by drag-drop drop zone. */
  const secondarySide = ref<SplitSide>('right')

  const isSplit = computed(() => splitMode.value !== 'none')

  function defaultSideForMode(mode: SplitMode): SplitSide {
    return mode === 'horizontal' ? 'bottom' : 'right'
  }

  let resizing = false
  let containerEl: HTMLElement | null = null
  let maskEl: HTMLElement | null = null

  function toggleHorizontal() {
    if (splitMode.value === 'horizontal') {
      splitMode.value = 'none'
    } else {
      splitMode.value = 'horizontal'
      splitRatio.value = 50
      secondarySide.value = defaultSideForMode('horizontal')
    }
  }

  function toggleVertical() {
    if (splitMode.value === 'vertical') {
      splitMode.value = 'none'
    } else {
      splitMode.value = 'vertical'
      splitRatio.value = 50
      secondarySide.value = defaultSideForMode('vertical')
    }
  }

  function closeSplit() {
    splitMode.value = 'none'
    secondarySessionId.value = null
  }

  function setSplitMode(mode: SplitMode, side?: SplitSide) {
    if (splitMode.value === mode && side === undefined) return
    splitMode.value = mode
    if (mode === 'none') {
      secondarySessionId.value = null
    } else {
      secondarySide.value = side ?? defaultSideForMode(mode)
    }
  }

  function setSecondarySessionId(sessionId: string | null) {
    secondarySessionId.value = sessionId
  }

  function setSecondarySide(side: SplitSide) {
    secondarySide.value = side
  }

  function setPreviewMode(mode: SplitMode) {
    previewMode.value = mode
    if (mode === 'none') previewSide.value = null
  }

  function setPreviewSide(side: SplitSide | null) {
    previewSide.value = side
  }

  function syncSplitAvailability(sessionCount: number, sessionIds?: string[]) {
    if (sessionCount < 2 && splitMode.value !== 'none') {
      splitMode.value = 'none'
      secondarySessionId.value = null
      return
    }
    if (secondarySessionId.value && sessionIds && !sessionIds.includes(secondarySessionId.value)) {
      secondarySessionId.value = null
    }
  }

  function onMove(e: MouseEvent) {
    if (!resizing || !containerEl) return
    const rect = containerEl.getBoundingClientRect()
    // When secondary is on left/top, the divider position is (100-ratio)%,
    // so dragging right increases the secondary and decreases the primary.
    const inverted = secondarySide.value === 'left' || secondarySide.value === 'top'
    if (splitMode.value === 'vertical') {
      let ratio = ((e.clientX - rect.left) / rect.width) * 100
      if (inverted) ratio = 100 - ratio
      splitRatio.value = Math.max(RESIZE_MIN, Math.min(RESIZE_MAX, ratio))
    } else if (splitMode.value === 'horizontal') {
      let ratio = ((e.clientY - rect.top) / rect.height) * 100
      if (inverted) ratio = 100 - ratio
      splitRatio.value = Math.max(RESIZE_MIN, Math.min(RESIZE_MAX, ratio))
    }
  }

  function onUp() {
    resizing = false
    isResizing.value = false
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    if (maskEl) {
      maskEl.remove()
      maskEl = null
    }
  }

  function startSplitResize(e: MouseEvent, el: HTMLElement) {
    containerEl = el
    resizing = true
    isResizing.value = true

    maskEl = document.createElement('div')
    maskEl.style.cssText = 'position:fixed;inset:0;z-index:9999;cursor:' + (splitMode.value === 'horizontal' ? 'row-resize' : 'col-resize') + ';'
    document.body.appendChild(maskEl)

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.cursor = splitMode.value === 'horizontal' ? 'row-resize' : 'col-resize'
    document.body.style.userSelect = 'none'
    e.preventDefault()
  }

  function resetSplitRatio() {
    splitRatio.value = 50
  }

  onBeforeUnmount(() => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    if (maskEl) {
      maskEl.remove()
      maskEl = null
    }
  })

  return {
    splitMode,
    splitRatio,
    isSplit,
    isResizing,
    previewMode,
    previewSide,
    secondarySessionId,
    secondarySide,
    toggleHorizontal,
    toggleVertical,
    closeSplit,
    setSplitMode,
    setSecondarySessionId,
    setSecondarySide,
    setPreviewMode,
    setPreviewSide,
    syncSplitAvailability,
    startSplitResize,
    resetSplitRatio,
    DIVIDER_SIZE,
  }
}
