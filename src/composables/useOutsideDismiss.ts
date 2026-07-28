import { onBeforeUnmount, watch, type WatchSource } from 'vue'

/**
 * Dismiss a floating UI (context menu, dropdown) when the user interacts outside
 * or presses Escape. Uses capture-phase pointerdown so it still works when the
 * underlying surface (e.g. xterm) does not emit a bubbling `click`.
 */
export function useOutsideDismiss(
  open: WatchSource<boolean>,
  onDismiss: () => void,
  getIgnoreRoots: () => Array<HTMLElement | null | undefined>,
): void {
  let attached = false
  let attachRaf = 0

  function isInside(target: EventTarget | null): boolean {
    if (!(target instanceof Node)) return false
    for (const root of getIgnoreRoots()) {
      if (root?.contains(target)) return true
    }
    return false
  }

  function onPointerDown(e: Event) {
    if (isInside(e.target)) return
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
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('keydown', onKeydown, true)
  }

  function attach() {
    detach()
    // Defer so the opening gesture (contextmenu / click) cannot immediately dismiss.
    attachRaf = requestAnimationFrame(() => {
      attachRaf = 0
      attached = true
      document.addEventListener('pointerdown', onPointerDown, true)
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
