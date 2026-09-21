export type CombinedTabItem<T> =
  | { kind: 'item'; item: T }
  | { kind: 'split'; primary: T; secondary: T }

/** Replace two list items with one persistent combined item at their earliest position. */
export function buildCombinedTabItems<T>(
  items: T[],
  primaryId: string | null | undefined,
  secondaryId: string | null | undefined,
  getId: (item: T) => string,
): CombinedTabItem<T>[] {
  const primaryIndex = items.findIndex((item) => getId(item) === primaryId)
  const secondaryIndex = items.findIndex((item) => getId(item) === secondaryId)
  if (primaryIndex < 0 || secondaryIndex < 0 || primaryIndex === secondaryIndex) {
    return items.map((item) => ({ kind: 'item', item }))
  }

  const primary = items[primaryIndex]
  const secondary = items[secondaryIndex]
  const insertAt = Math.min(primaryIndex, secondaryIndex)
  const result: CombinedTabItem<T>[] = []
  items.forEach((item, index) => {
    if (index === insertAt) result.push({ kind: 'split', primary, secondary })
    const id = getId(item)
    if (id !== getId(primary) && id !== getId(secondary)) result.push({ kind: 'item', item })
  })
  return result
}
