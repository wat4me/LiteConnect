import { computed, nextTick, onScopeDispose, ref, watch, type CSSProperties } from 'vue'
import { useAiTaskMorph } from './useAiTaskMorph'

const SIZE = 40
const clamp = (value: number, max: number) => Math.max(0, Math.min(value, max))

/** Coordinates stay inside the chat viewport, above its floating composer. */
export function useAiTaskFloat(active: () => boolean, layout: () => string) {
  const surface = ref<HTMLElement | null>(null)
  const trigger = ref<HTMLButtonElement | null>(null)
  const panel = ref<HTMLElement | null>(null)
  const expanded = ref(false)
  const { rendered } = useAiTaskMorph({ expanded, active, surface, trigger, panel })
  let returnFocus = false
  const dragging = ref(false)
  const bounds = ref({ width: 0, height: 0 })
  const edge = ref<'left' | 'right' | 'top' | 'bottom'>('right')
  const edgeRatio = ref(1)
  const dragPosition = ref({ x: 0, y: 0 })
  const fits = computed(() => bounds.value.width >= SIZE && bounds.value.height >= SIZE)
  let gesture: { id: number; x: number; y: number; left: number; top: number } | undefined
  let ignoreClick = false
  const storageKey = () => `liteconnect-ai-task-position-${layout()}`
  const position = computed(() => {
    if (dragging.value) return dragPosition.value
    const maxX = Math.max(0, bounds.value.width - SIZE)
    const maxY = Math.max(0, bounds.value.height - SIZE)
    return edge.value === 'left' || edge.value === 'right'
      ? { x: edge.value === 'right' ? maxX : 0, y: maxY * edgeRatio.value }
      : { x: maxX * edgeRatio.value, y: edge.value === 'bottom' ? maxY : 0 }
  })
  const triggerStyle = computed<CSSProperties>(() => ({ left: `${position.value.x}px`, top: `${position.value.y}px` }))
  const panelStyle = computed<CSSProperties>(() => {
    const { width, height } = bounds.value
    const { x, y } = position.value
    const above = y + SIZE
    const below = height - y
    const opensAbove = above >= below
    const panelWidth = Math.min(420, width)
    return {
      width: `${panelWidth}px`,
      '--task-panel-width': `${panelWidth}px`,
      left: `${clamp(edge.value === 'top' || edge.value === 'bottom' ? x + SIZE / 2 - panelWidth / 2 : edge.value === 'right' ? x + SIZE - panelWidth : x, width - panelWidth)}px`,
      ...(opensAbove ? { bottom: `${height - y - SIZE}px` } : { top: `${y}px` }),
      maxHeight: `${Math.min(420, Math.max(0, opensAbove ? above : below))}px`,
    }
  })

  watch(layout, () => {
    edge.value = 'right'
    edgeRatio.value = 1
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey()) || 'null')
      if (saved && ['left', 'right', 'top', 'bottom'].includes(saved.edge) && Number.isFinite(saved.ratio)) {
        edge.value = saved.edge
        edgeRatio.value = clamp(saved.ratio, 1)
      }
    } catch { /* An unavailable store falls back to the default corner. */ }
  }, { immediate: true })

  watch(surface, (element, _previous, onCleanup) => {
    if (!element) { close(); return }
    const observer = new ResizeObserver(() => {
      // Hidden tabs report zero width; retain their last visible geometry.
      if (element.clientWidth) bounds.value = { width: element.clientWidth, height: element.clientHeight }
    })
    observer.observe(element)
    onCleanup(() => observer.disconnect())
  }, { flush: 'post' })

  function close(restoreFocus = false) {
    returnFocus = restoreFocus
    expanded.value = false
  }
  watch([rendered, expanded], async ([visible, open]) => {
    if (visible || open || !returnFocus) return
    returnFocus = false
    await nextTick()
    if (active() && !expanded.value && !rendered.value) trigger.value?.focus({ preventScroll: true })
  })
  function endGesture(save: boolean) {
    const current = gesture
    gesture = undefined
    if (dragging.value) {
      const { x, y } = position.value
      const maxX = Math.max(0, bounds.value.width - SIZE), maxY = Math.max(0, bounds.value.height - SIZE)
      const distances = { left: x, right: maxX - x, top: y, bottom: maxY - y }
      const nearest = Math.min(...Object.values(distances))
      // Keep the current edge on exact corner ties so a tiny drag is stable.
      if (distances[edge.value] !== nearest) edge.value = (Object.keys(distances) as (typeof edge.value)[]).find(candidate => distances[candidate] === nearest)!
      const horizontal = edge.value === 'top' || edge.value === 'bottom'
      edgeRatio.value = (horizontal ? maxX : maxY) > 0 ? clamp((horizontal ? x / maxX : y / maxY), 1) : 1
      ignoreClick = true
      if (save) {
        try { localStorage.setItem(storageKey(), JSON.stringify({ edge: edge.value, ratio: edgeRatio.value })) } catch { /* Position is still retained for this view. */ }
      }
    }
    dragging.value = false
    if (current && trigger.value?.hasPointerCapture(current.id)) trigger.value.releasePointerCapture(current.id)
  }
  function pointerDown(event: PointerEvent) {
    if (!event.isPrimary || event.button !== 0) return
    ignoreClick = false
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, left: position.value.x, top: position.value.y }
    trigger.value?.setPointerCapture(event.pointerId)
  }
  function pointerMove(event: PointerEvent) {
    if (!gesture || gesture.id !== event.pointerId) return
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y
    if (!dragging.value && Math.hypot(dx, dy) < 5) return
    close()
    dragging.value = true
    dragPosition.value = { x: clamp(gesture.left + dx, bounds.value.width - SIZE), y: clamp(gesture.top + dy, bounds.value.height - SIZE) }
  }
  function pointerUp(event: PointerEvent) {
    if (gesture?.id === event.pointerId) endGesture(true)
  }
  async function toggle(event: MouseEvent) {
    if (ignoreClick && event.detail !== 0) { ignoreClick = false; return }
    ignoreClick = false
    expanded.value = !expanded.value
    if (expanded.value) {
      await nextTick()
      panel.value?.focus({ preventScroll: true })
    }
  }
  watch(active, visible => {
    if (!visible) { close(); endGesture(false) }
  })
  watch([expanded, active], ([open, visible], _previous, onCleanup) => {
    if (!open || !visible) return
    const outside = (event: PointerEvent) => {
      if (!panel.value?.contains(event.target as Node) && !trigger.value?.contains(event.target as Node)) close()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true) }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape, true)
    onCleanup(() => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape, true)
    })
  })
  onScopeDispose(() => endGesture(false))
  return { surface, trigger, panel, expanded, rendered, dragging, fits, edge, triggerStyle, panelStyle, close, toggle, pointerDown, pointerMove, pointerUp, cancelDrag: () => endGesture(false) }
}
