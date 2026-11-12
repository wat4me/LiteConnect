export interface TabScrollRect {
  left: number
  right: number
}

export interface TabScrollView {
  scrollLeft: number
  scrollWidth: number
  clientWidth: number
}

/**
 * Horizontal delta that brings the active tab fully inside the strip.
 * Negative scrolls left, positive scrolls right, zero means already visible.
 */
export function tabScrollDelta(strip: TabScrollRect, tab: TabScrollRect, padding = 8): number {
  const visibleLeft = strip.left + padding
  const visibleRight = strip.right - padding
  if (tab.left < visibleLeft) return tab.left - visibleLeft
  if (tab.right > visibleRight) return tab.right - visibleRight
  return 0
}

/** Which directions still have hidden tabs. */
export function tabOverflow(view: TabScrollView): { left: boolean; right: boolean } {
  const max = Math.max(0, view.scrollWidth - view.clientWidth)
  return {
    left: max > 1 && view.scrollLeft > 1,
    right: max > 1 && view.scrollLeft < max - 1,
  }
}
