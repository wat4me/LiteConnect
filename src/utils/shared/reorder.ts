/**
 * Partial list reorder: `orderedIds` are reordered relative to each other
 * while preserving their slots among items not in the subset.
 * (Matches credentialStore.reorderConnections semantics.)
 */
export function partialReorderByIds<T extends { id: string }>(
  items: T[],
  orderedIds: string[],
): T[] {
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) return [...items]
  const idSet = new Set(orderedIds)
  const subset = orderedIds
    .map((id) => items.find((c) => c.id === id))
    .filter((c): c is T => !!c)
  if (subset.length === 0) return [...items]

  let subsetIdx = 0
  const result: T[] = []
  for (const item of items) {
    if (idSet.has(item.id)) {
      const next = subset[subsetIdx++]
      if (next) result.push(next)
    } else {
      result.push(item)
    }
  }
  while (subsetIdx < subset.length) {
    result.push(subset[subsetIdx++])
  }
  return result
}
