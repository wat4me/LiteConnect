import { ref, computed, onBeforeUnmount } from 'vue'
import type { SplitMode, SplitSide } from '@/domain/terminal/types'
import type { SplitPreviewPayload } from '@/domain/session/types'

export type { SplitMode, SplitSide }

const RESIZE_MIN = 20
const RESIZE_MAX = 80
const DIVIDER_SIZE = 6

export function useSplitTerminal() {
  const splitMode = ref<SplitMode>('none')
  const splitVisible = ref(false)
  const splitRatio = ref(50)
  /** The two session ids belonging to the persistent combined split tab. */
  const splitPrimarySessionId = ref<string | null>(null)
  const isResizing = ref(false)
  const previewMode = ref<SplitMode>('none')
  const previewActive = ref(false)
  const previewSessionId = ref<string | null>(null)
  /** Previewed drop side during drag; null when not previewing a side-aware drop */
  const previewSide = ref<SplitSide | null>(null)
  /** Explicit secondary pane session; null = auto-pick non-active session */
  const secondarySessionId = ref<string | null>(null)
  /** Which side the secondary pane occupies. Driven by drag-drop drop zone. */
  const secondarySide = ref<SplitSide>('right')

  const hasSplitGroup = computed(
    () =>
      splitMode.value !== 'none' &&
      !!splitPrimarySessionId.value &&
      !!secondarySessionId.value &&
      splitPrimarySessionId.value !== secondarySessionId.value,
  )
  const isSplit = computed(() => splitVisible.value && hasSplitGroup.value)

  function defaultSideForMode(mode: SplitMode): SplitSide {
    return mode === 'horizontal' ? 'bottom' : 'right'
  }

  let resizing = false
  let containerEl: HTMLElement | null = null
  let maskEl: HTMLElement | null = null

  function openSplit(mode: Exclude<SplitMode, 'none'>, primaryId?: string, secondaryId?: string) {
    if (primaryId) splitPrimarySessionId.value = primaryId
    if (secondaryId) secondarySessionId.value = secondaryId
    splitMode.value = mode
    splitVisible.value = true
    splitRatio.value = 50
    secondarySide.value = defaultSideForMode(mode)
  }

  function toggleHorizontal(primaryId?: string, secondaryId?: string) {
    if (isSplit.value && splitMode.value === 'horizontal') return closeSplit()
    openSplit('horizontal', primaryId, secondaryId)
  }

  function toggleVertical(primaryId?: string, secondaryId?: string) {
    if (isSplit.value && splitMode.value === 'vertical') return closeSplit()
    openSplit('vertical', primaryId, secondaryId)
  }

  function closeSplit() {
    splitMode.value = 'none'
    splitVisible.value = false
    splitPrimarySessionId.value = null
    secondarySessionId.value = null
  }

  function suspendSplit() {
    splitVisible.value = false
  }

  function restoreSplit() {
    if (hasSplitGroup.value) splitVisible.value = true
  }

  function setSplitMode(mode: SplitMode, side?: SplitSide, primaryId?: string) {
    if (mode === 'none') {
      closeSplit()
      return
    }
    if (primaryId) splitPrimarySessionId.value = primaryId
    splitMode.value = mode
    splitVisible.value = true
    secondarySide.value = side ?? defaultSideForMode(mode)
  }

  function setSplitPrimarySessionId(sessionId: string | null) {
    splitPrimarySessionId.value = sessionId
  }

  function setSecondarySessionId(sessionId: string | null) {
    secondarySessionId.value = sessionId
  }

  function setSplitPreview(payload: SplitPreviewPayload | null) {
    previewActive.value = payload !== null
    previewMode.value = payload?.mode ?? 'none'
    previewSide.value = payload?.side ?? null
    previewSessionId.value = payload?.sessionId ?? null
  }

  function syncSplitAvailability(sessionCount: number, sessionIds?: string[]) {
    if (sessionCount < 2 || !sessionIds) return closeSplit()
    const primaryMissing = splitPrimarySessionId.value && !sessionIds.includes(splitPrimarySessionId.value)
    const secondaryMissing = secondarySessionId.value && !sessionIds.includes(secondarySessionId.value)
    if (primaryMissing || secondaryMissing) closeSplit()
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
    splitVisible,
    splitRatio,
    isSplit,
    hasSplitGroup,
    isResizing,
    previewMode,
    previewActive,
    previewSide,
    previewSessionId,
    splitPrimarySessionId,
    secondarySessionId,
    secondarySide,
    toggleHorizontal,
    toggleVertical,
    closeSplit,
    suspendSplit,
    restoreSplit,
    setSplitMode,
    setSplitPrimarySessionId,
    setSecondarySessionId,
    setSplitPreview,
    syncSplitAvailability,
    startSplitResize,
    resetSplitRatio,
    DIVIDER_SIZE,
  }
}
