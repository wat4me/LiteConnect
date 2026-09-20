import { onBeforeUnmount, watch, type WatchSource } from 'vue'

/**
 * Dismiss a floating UI (context menu, dropdown) when the user interacts outside
 * or presses Escape.
 *
 * pointerdown on document is not enough in this app:
 * - xterm / CodeMirror may swallow bubbling click, so we also listen on window
 *   (capture) for pointerdown + mousedown, and for focusin when those surfaces
 *   steal keyboard focus.
 * - composedPath() catches SVG / retargeted events that `event.target` misses.
 */
export function eventIsInsideRoots(
  event: Event,
  roots: Array<HTMLElement | null | undefined>,
): boolean {
  const valid = roots.filter((root): root is HTMLElement => !!root)
  if (valid.length === 0) return false
  const path = typeof event.composedPath === 'function' ? event.composedPath() : []
  const nodes: EventTarget[] = path.length > 0
    ? path
    : (event.target ? [event.target] : [])
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue
    for (const root of valid) {
      if (node === root) return true
      if (typeof (root as HTMLElement).contains === 'function'
        && node instanceof Node
        && root.contains(node)) {
        return true
      }
    }
  }
  return false
}

export function useOutsideDismiss(
  open: WatchSource<boolean>,
  onDismiss: () => void,
  getIgnoreRoots: () => Array<HTMLElement | null | undefined>,
): void {
  let attached = false
  let attachRaf = 0

  function onPointer(e: Event) {
    if (eventIsInsideRoots(e, getIgnoreRoots())) return
    onDismiss()
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    onDismiss()
  }

  function detach() {
    if (attachRaf) {
      cancelAnimationFrame(attachRaf)
      attachRaf = 0
    }
    if (!attached) return
    attached = false
    window.removeEventListener('pointerdown', onPointer, true)
    window.removeEventListener('mousedown', onPointer, true)
    document.removeEventListener('focusin', onPointer, true)
    document.removeEventListener('keydown', onKeydown, true)
  }

  function attach() {
    detach()
    // Defer so the opening gesture (contextmenu / click) cannot immediately dismiss.
    attachRaf = requestAnimationFrame(() => {
      attachRaf = 0
      attached = true
      window.addEventListener('pointerdown', onPointer, true)
      window.addEventListener('mousedown', onPointer, true)
      document.addEventListener('focusin', onPointer, true)
      document.addEventListener('keydown', onKeydown, true)
    })
  }

  watch(
    open,
    (isOpen) => {
      if (isOpen) attach()
      else detach()
    },
    { immediate: true },
  )

  onBeforeUnmount(detach)
}
