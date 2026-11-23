export interface SelectionUpdateResult {
  ids: string[]
  lastSelectedId: string | null
  limitExceeded: boolean
}

/**
 * Toggle a single connection in the checked set.
 * Respects `maxCount` when adding a new id.
 */
export function toggleConnectionSelection(
  currentIds: readonly string[],
  connectionId: string,
  maxCount: number,
): SelectionUpdateResult {
  if (currentIds.includes(connectionId)) {
    const nextIds = currentIds.filter((id) => id !== connectionId)
    return {
      ids: nextIds,
      lastSelectedId: nextIds.length > 0 ? connectionId : null,
      limitExceeded: false,
    }
  }
  if (currentIds.length >= maxCount) {
    return {
      ids: [...currentIds],
      lastSelectedId: connectionId,
      limitExceeded: true,
    }
  }
  return {
    ids: [...currentIds, connectionId],
    lastSelectedId: connectionId,
    limitExceeded: false,
  }
}

/**
 * Extend the checked set with an inclusive range in `visibleIds` between `anchorId` and `targetId`.
 * Falls back to toggling `targetId` when the anchor is missing or not in the current visible list.
 */
export function selectConnectionRange(
  currentIds: readonly string[],
  visibleIds: readonly string[],
  anchorId: string | null,
  targetId: string,
  maxCount: number,
): SelectionUpdateResult {
  if (!anchorId) {
    return toggleConnectionSelection(currentIds, targetId, maxCount)
  }
  const start = visibleIds.indexOf(anchorId)
  const end = visibleIds.indexOf(targetId)
  if (start < 0 || end < 0) {
    return toggleConnectionSelection(currentIds, targetId, maxCount)
  }
  const [from, to] = start < end ? [start, end] : [end, start]
  const rangeIds = visibleIds.slice(from, to + 1)
  const merged = [...new Set([...currentIds, ...rangeIds])]
  if (merged.length > maxCount) {
    return {
      ids: merged.slice(0, maxCount),
      lastSelectedId: targetId,
      limitExceeded: true,
    }
  }
  return {
    ids: merged,
    lastSelectedId: targetId,
    limitExceeded: false,
  }
}
