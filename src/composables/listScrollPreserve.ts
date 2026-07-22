/** Clamp saved scrollTop into [0, maxScrollTop]. */
export function clampScrollTop(scrollTop: number, maxScrollTop: number): number {
  if (!Number.isFinite(scrollTop) || scrollTop < 0) return 0
  if (!Number.isFinite(maxScrollTop) || maxScrollTop < 0) return 0
  return Math.min(scrollTop, maxScrollTop)
}

export type ListScrollSnapshot = {
  scrollTop: number
}

/**
 * Snapshot → await refresh → nextTick → restore clamped position.
 * Ensures restore runs only after the list result has been applied.
 */
export async function restoreListScrollAfterRefresh(opts: {
  getScrollTop: () => number
  getMaxScrollTop: () => number
  setScrollTop: (top: number) => void
  refresh: () => Promise<void>
  nextTick: () => Promise<void>
}): Promise<ListScrollSnapshot> {
  const saved = opts.getScrollTop()
  await opts.refresh()
  await opts.nextTick()
  const max = opts.getMaxScrollTop()
  const top = clampScrollTop(saved, max)
  opts.setScrollTop(top)
  return { scrollTop: top }
}
