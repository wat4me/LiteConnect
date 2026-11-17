import { computed, nextTick, onScopeDispose, ref, shallowRef, watch, type CSSProperties } from 'vue'
import { useAiTaskMorph } from './useAiTaskMorph'

const SIZE = 40
const TUCKED_SIZE = 28
/** A manual drop tucks when it ends this close to an edge. */
const SNAP = 20
const IDLE_TUCK_DELAY = 10_000
const clamp = (value: number, max: number) => Math.max(0, Math.min(value, max))
type Edge = 'left' | 'right' | 'top' | 'bottom'

/** Coordinates stay inside the measured floating surface. */
export function useAiTaskFloat(active: () => boolean, layout: () => string, hasPendingWork: () => boolean) {
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
  const tuckedBy = ref<'drag' | 'idle' | null>(null)
  const hovered = ref(false)
  const focusCount = ref(0)
  const workFinished = ref(false)
  const dragPosition = ref({ x: 0, y: 0 })
  const fits = computed(() => bounds.value.width >= SIZE && bounds.value.height >= SIZE)
  const gesture = shallowRef<{ id: number; x: number; y: number; left: number; top: number }>()
  let ignoreClick = false
  const storageKey = () => `liteconnect-ai-task-position-${layout()}`
  const visuallyTucked = computed(() => !!tuckedBy.value && !dragging.value)
  const iconSize = computed(() => visuallyTucked.value ? TUCKED_SIZE : SIZE)
  const position = computed(() => {
    if (dragging.value) return dragPosition.value
    const maxX = Math.max(0, bounds.value.width - iconSize.value)
    const maxY = Math.max(0, bounds.value.height - iconSize.value)
    if (!tuckedBy.value) return { x: maxX * xRatio.value, y: maxY * yRatio.value }
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
    tuckedBy.value = null
    workFinished.value = false
    // SSH keeps one position in each live session's cached sidebar.
    if (layout() === 'ssh') return
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey()) || 'null')
      if (!saved || typeof saved !== 'object') return
      if (saved.tucked === true && ['left', 'right', 'top', 'bottom'].includes(saved.edge) && Number.isFinite(saved.ratio)) {
        edge.value = saved.edge
        edgeRatio.value = clamp(saved.ratio, 1)
        tuckedBy.value = 'drag'
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
    if (!element) { hovered.value = false; close(); endGesture(false); return }
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
    if (layout() === 'ssh') return
    try {
      const payload = tuckedBy.value === 'drag'
        ? { edge: edge.value, ratio: edgeRatio.value, tucked: true }
        : { x: xRatio.value, y: yRatio.value, tucked: false }
      localStorage.setItem(storageKey(), JSON.stringify(payload))
    } catch { /* Position is still retained for this view. */ }
  }
  /** Something needs a human: bring a tucked icon back inside as a full circle. */
  function untuck() {
    if (!tuckedBy.value) return
    placeInsideEdge()
    tuckedBy.value = null
    persist()
  }
  function tuckNearest(x: number, y: number, source: 'drag' | 'idle') {
    const { width, height } = bounds.value
    const maxX = Math.max(0, width - SIZE), maxY = Math.max(0, height - SIZE)
    const distances: [Edge, number][] = [['left', x], ['right', maxX - x], ['top', y], ['bottom', maxY - y]]
    const [nearest, distance] = distances.reduce((best, candidate) => candidate[1] < best[1] ? candidate : best)
    if (source === 'drag' && distance > SNAP) return false
    edge.value = nearest
    const vertical = nearest === 'left' || nearest === 'right'
    const available = (vertical ? height : width) - TUCKED_SIZE
    const offset = (vertical ? y : x) + (SIZE - TUCKED_SIZE) / 2
    edgeRatio.value = available > 0 ? clamp(offset / available, 1) : 0
    tuckedBy.value = source
    return true
  }
  watch(hasPendingWork, (pending, wasPending) => {
    if (pending) {
      workFinished.value = false
      if (tuckedBy.value === 'idle') tuckedBy.value = null
    } else if (wasPending) {
      workFinished.value = true
    }
  })
  const canTuck = computed(() => active() && workFinished.value && surface.value && fits.value &&
    !tuckedBy.value && !expanded.value && !rendered.value && !hovered.value && !gesture.value)
  watch([canTuck, focusCount], ([eligible], _previous, onCleanup) => {
    if (!eligible) return
    const timeout = setTimeout(() => {
      const { x, y } = position.value
      tuckNearest(x, y, 'idle')
    }, IDLE_TUCK_DELAY)
    onCleanup(() => clearTimeout(timeout))
  }, { flush: 'post' })

  function endGesture(save: boolean) {
    const current = gesture.value
    gesture.value = undefined
    if (dragging.value) ignoreClick = true
    if (dragging.value && save) {
      const { width, height } = bounds.value
      const maxX = Math.max(0, width - SIZE), maxY = Math.max(0, height - SIZE)
      const x = clamp(dragPosition.value.x, maxX), y = clamp(dragPosition.value.y, maxY)
      if (!tuckNearest(x, y, 'drag')) {
        xRatio.value = maxX > 0 ? clamp(x / maxX, 1) : 0
        yRatio.value = maxY > 0 ? clamp(y / maxY, 1) : 0
        tuckedBy.value = null
      }
      persist()
    }
    dragging.value = false
    if (current && trigger.value?.hasPointerCapture(current.id)) trigger.value.releasePointerCapture(current.id)
  }
  function pointerDown(event: PointerEvent) {
    if (!event.isPrimary || event.button !== 0) return
    ignoreClick = false
    let { x: left, y: top } = position.value
    if (visuallyTucked.value && trigger.value && surface.value) {
      const button = trigger.value.getBoundingClientRect()
      const area = surface.value.getBoundingClientRect()
      // Use the drawn center, including the edge transform, when regrowing the circle.
      left = button.left - area.left + (button.width - SIZE) / 2
      top = button.top - area.top + (button.height - SIZE) / 2
    }
    gesture.value = { id: event.pointerId, x: event.clientX, y: event.clientY, left, top }
    trigger.value?.setPointerCapture(event.pointerId)
  }
  function pointerMove(event: PointerEvent) {
    const current = gesture.value
    if (!current || current.id !== event.pointerId) return
    const dx = event.clientX - current.x, dy = event.clientY - current.y
    if (!dragging.value && Math.hypot(dx, dy) < 5) return
    if (!dragging.value) {
      close()
      dragging.value = true
    }
    dragPosition.value = { x: clamp(current.left + dx, bounds.value.width - SIZE), y: clamp(current.top + dy, bounds.value.height - SIZE) }
  }
  function pointerUp(event: PointerEvent) {
    if (gesture.value?.id === event.pointerId) endGesture(true)
  }
  async function toggle(event: MouseEvent) {
    if (ignoreClick && event.detail !== 0) { ignoreClick = false; return }
    ignoreClick = false
    if (tuckedBy.value) untuck()
    expanded.value = !expanded.value
    if (expanded.value) {
      await nextTick()
      panel.value?.focus({ preventScroll: true })
    }
  }
  watch(active, visible => {
    if (!visible) { hovered.value = false; close(); endGesture(false) }
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
  return {
    surface, trigger, panel, expanded, rendered, dragging, fits, edge, tucked: visuallyTucked, triggerStyle, panelStyle,
    close, toggle, untuck, pointerDown, pointerMove, pointerUp, cancelDrag: () => endGesture(false),
    setHovered: (value: boolean) => { hovered.value = value },
    onTriggerFocus: () => { focusCount.value++ },
  }
}
