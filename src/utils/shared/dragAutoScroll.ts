/**
 * Auto-scroll a container while HTML5 drag is near its top/bottom edge.
 * Listens on document dragover so scrolling continues even when the pointer
 * is over non-droppable chrome (padding, headers, gaps).
 */
export type DragAutoScrollHandle = {
  /** Begin watching; pass the scrollable element(s) or a getter. */
  start: (targets: DragAutoScrollTarget | DragAutoScrollTarget[]) => void
  stop: () => void
}

export type DragAutoScrollTarget =
  | HTMLElement
  | null
  | undefined
  | (() => HTMLElement | null | undefined)

export function createDragAutoScroll(options?: {
  /** Distance from edge that starts scrolling (px). Default 52. */
  edgePx?: number
  /** Max pixels per frame. Default 18. */
  maxSpeed?: number
  /** Extra horizontal hit-slop outside the scroller (px). Default 28. */
  outerPadPx?: number
}): DragAutoScrollHandle {
  const edgePx = options?.edgePx ?? 52
  const maxSpeed = options?.maxSpeed ?? 18
  const outerPadPx = options?.outerPadPx ?? 28

  let getters: Array<() => HTMLElement | null | undefined> = []
  let lastY = 0
  let lastX = 0
  let hasPointer = false
  let raf = 0
  let active = false

  function onDocDragOver(e: DragEvent) {
    lastY = e.clientY
    lastX = e.clientX
    hasPointer = true
  }

  function resolveTargets(): HTMLElement[] {
    const out: HTMLElement[] = []
    for (const get of getters) {
      const el = get()
      if (el && !out.includes(el)) out.push(el)
    }
    return out
  }

  function tick() {
    raf = 0
    if (!active) return

    if (hasPointer) {
      for (const el of resolveTargets()) {
        const rect = el.getBoundingClientRect()
        if (rect.height < 8) continue

        // Horizontal gate only: allow pointer above/below the scroller
        // (toolbar / footer) so dragging to the page top still scrolls up.
        if (lastX < rect.left - outerPadPx || lastX > rect.right + outerPadPx) {
          continue
        }

        const topZone = rect.top + edgePx
        const bottomZone = rect.bottom - edgePx
        let dy = 0

        if (lastY < topZone) {
          // Full speed when fully above the list; ramp inside the edge band
          const intensity =
            lastY <= rect.top ? 1 : Math.min(1, Math.max(0, (topZone - lastY) / edgePx))
          dy = -Math.max(1, Math.ceil(maxSpeed * intensity))
        } else if (lastY > bottomZone) {
          const intensity =
            lastY >= rect.bottom ? 1 : Math.min(1, Math.max(0, (lastY - bottomZone) / edgePx))
          dy = Math.max(1, Math.ceil(maxSpeed * intensity))
        }

        if (dy !== 0) {
          const prev = el.scrollTop
          const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight)
          const next = Math.max(0, Math.min(maxScroll, prev + dy))
          if (next !== prev) el.scrollTop = next
        }
      }
    }

    raf = requestAnimationFrame(tick)
  }

  function start(targets: DragAutoScrollTarget | DragAutoScrollTarget[]) {
    const list = Array.isArray(targets) ? targets : [targets]
    const nextGetters = list.map((t) => {
      if (typeof t === 'function') return t
      return () => t
    })

    // Re-entrant: update targets without resetting pointer / rAF mid-drag
    if (active) {
      getters = nextGetters
      return
    }

    getters = nextGetters
    if (resolveTargets().length === 0 && list.every((t) => typeof t !== 'function')) {
      getters = []
      return
    }
    active = true
    hasPointer = false
    document.addEventListener('dragover', onDocDragOver, true)
    document.addEventListener('dragend', stop, true)
    document.addEventListener('drop', stop, true)
    raf = requestAnimationFrame(tick)
  }

  function stop() {
    active = false
    hasPointer = false
    document.removeEventListener('dragover', onDocDragOver, true)
    document.removeEventListener('dragend', stop, true)
    document.removeEventListener('drop', stop, true)
    if (raf) {
      cancelAnimationFrame(raf)
      raf = 0
    }
    getters = []
  }

  return { start, stop }
}
