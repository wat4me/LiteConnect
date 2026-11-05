import { computed, nextTick, onScopeDispose, ref, watch, type CSSProperties } from 'vue'
import { useAiTaskMorph } from './useAiTaskMorph'

const SIZE = 40
const TUCKED_SIZE = 28
/** The icon tucks only when a drag ends this close to an edge. */
const SNAP = 20
const clamp = (value: number, max: number) => Math.max(0, Math.min(value, max))
type Edge = 'left' | 'right' | 'top' | 'bottom'

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
  const edge = ref<Edge>('right')
  const edgeRatio = ref(1)
  /** Free position as a fraction of the area the full-size icon can occupy. */
  const xRatio = ref(1)
  const yRatio = ref(1)
  /** Parked halfway outside an edge, at a smaller size, after a drag ends there. */
  const tucked = ref(false)
  const dragPosition = ref({ x: 0, y: 0 })
  const fits = computed(() => bounds.value.width >= SIZE && bounds.value.height >= SIZE)
  let gesture: { id: number; x: number; y: number; left: number; top: number } | undefined
  let ignoreClick = false
  const storageKey = () => `liteconnect-ai-task-position-${layout()}`
  const iconSize = computed(() => tucked.value && !dragging.value ? TUCKED_SIZE : SIZE)
  const position = computed(() => {
    if (dragging.value) return dragPosition.value
    const maxX = Math.max(0, bounds.value.width - iconSize.value)
    const maxY = Math.max(0, bounds.value.height - iconSize.value)
    if (!tucked.value) return { x: maxX * xRatio.value, y: maxY * yRatio.value }
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
    const alignRight = x + SIZE / 2 > width / 2
    return {
      width: `${panelWidth}px`,
      '--task-panel-width': `${panelWidth}px`,
      left: `${clamp(alignRight ? x + SIZE - panelWidth : x, width - panelWidth)}px`,
      ...(opensAbove ? { bottom: `${height - y - SIZE}px` } : { top: `${y}px` }),
      maxHeight: `${Math.min(420, Math.max(0, opensAbove ? above : below))}px`,
    }
  })

  function placeInsideEdge() {
    const along = edgeRatio.value
    if (edge.value === 'left') { xRatio.value = 0; yRatio.value = along }
    else if (edge.value === 'right') { xRatio.value = 1; yRatio.value = along }
    else if (edge.value === 'top') { xRatio.value = along; yRatio.value = 0 }
    else { xRatio.value = along; yRatio.value = 1 }
  }
  watch(layout, () => {
    edge.value = 'right'
    edgeRatio.value = 1
    xRatio.value = 1
    yRatio.value = 1
    tucked.value = false
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey()) || 'null')
      if (!saved || typeof saved !== 'object') return
      if (saved.tucked === true && ['left', 'right', 'top', 'bottom'].includes(saved.edge) && Number.isFinite(saved.ratio)) {
        edge.value = saved.edge
        edgeRatio.value = clamp(saved.ratio, 1)
        tucked.value = true
        return
      }
      if (Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
        xRatio.value = clamp(saved.x, 1)
        yRatio.value = clamp(saved.y, 1)
        return
      }
      // Older builds stored only an edge. Keep that spot, as a full icon.
      if (['left', 'right', 'top', 'bottom'].includes(saved.edge) && Number.isFinite(saved.ratio)) {
        edge.value = saved.edge
        edgeRatio.value = clamp(saved.ratio, 1)
        placeInsideEdge()
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
  function persist() {
    try {
      const payload = tucked.value
        ? { edge: edge.value, ratio: edgeRatio.value, tucked: true }
        : { x: xRatio.value, y: yRatio.value, tucked: false }
      localStorage.setItem(storageKey(), JSON.stringify(payload))
    } catch { /* Position is still retained for this view. */ }
  }
  /** Something needs a human: bring a tucked icon back inside as a full circle. */
  function untuck() {
    if (!tucked.value) return
    placeInsideEdge()
    tucked.value = false
    persist()
  }
  function endGesture(save: boolean) {
    const current = gesture
    gesture = undefined
    if (dragging.value) {
      const { x, y } = dragPosition.value
      const { width, height } = bounds.value
      const maxX = Math.max(0, width - SIZE), maxY = Math.max(0, height - SIZE)
      const distances: Record<Edge, number> = { left: x, right: maxX - x, top: y, bottom: maxY - y }
      const nearest = Math.min(...Object.values(distances))
      ignoreClick = true
      if (nearest <= SNAP) {
        const next = (Object.keys(distances) as Edge[]).find(candidate => distances[candidate] === nearest)!
        edge.value = next
        const tuckedMaxX = Math.max(0, width - TUCKED_SIZE)
        const tuckedMaxY = Math.max(0, height - TUCKED_SIZE)
        if (next === 'left' || next === 'right') {
          const top = clamp(y + SIZE / 2 - TUCKED_SIZE / 2, tuckedMaxY)
          edgeRatio.value = tuckedMaxY > 0 ? top / tuckedMaxY : 0
        } else {
          const left = clamp(x + SIZE / 2 - TUCKED_SIZE / 2, tuckedMaxX)
          edgeRatio.value = tuckedMaxX > 0 ? left / tuckedMaxX : 0
        }
        tucked.value = true
      } else {
        xRatio.value = maxX > 0 ? clamp(x / maxX, 1) : 0
        yRatio.value = maxY > 0 ? clamp(y / maxY, 1) : 0
        tucked.value = false
      }
      if (save) persist()
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
    if (!dragging.value) {
      close()
      if (tucked.value) {
        const grow = (SIZE - TUCKED_SIZE) / 2
        gesture.left -= grow
        gesture.top -= grow
        tucked.value = false
      }
      dragging.value = true
    }
    dragPosition.value = { x: clamp(gesture.left + dx, bounds.value.width - SIZE), y: clamp(gesture.top + dy, bounds.value.height - SIZE) }
  }
  function pointerUp(event: PointerEvent) {
    if (gesture?.id === event.pointerId) endGesture(true)
  }
  async function toggle(event: MouseEvent) {
    if (ignoreClick && event.detail !== 0) { ignoreClick = false; return }
    ignoreClick = false
    if (tucked.value) untuck()
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
  return { surface, trigger, panel, expanded, rendered, dragging, fits, edge, tucked, triggerStyle, panelStyle, close, toggle, untuck, pointerDown, pointerMove, pointerUp, cancelDrag: () => endGesture(false) }
}
