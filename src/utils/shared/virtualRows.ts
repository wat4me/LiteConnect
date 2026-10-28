export function buildRowOffsets(keys: readonly string[], sizes: ReadonlyMap<string, number>, estimate: number): number[] {
  const offsets = [0]
  for (const key of keys) offsets.push(offsets[offsets.length - 1] + Math.max(1, sizes.get(key) ?? estimate))
  return offsets
}

/** First row whose bottom is after the requested position. */
function rowAt(offsets: readonly number[], position: number): number {
  let low = 0
  let high = offsets.length - 1
  while (low < high) {
    const mid = (low + high) >>> 1
    if (offsets[mid + 1] <= position) low = mid + 1
    else high = mid
  }
  return low
}

export function visibleRowIndices(offsets: readonly number[], top: number, height: number, overscan = 6): number[] {
  const count = offsets.length - 1
  if (count <= 0 || top + height <= 0 || top >= offsets[count]) return []
  const start = Math.max(0, rowAt(offsets, Math.max(0, top)) - overscan)
  const end = Math.min(count, rowAt(offsets, top + height) + overscan + 1)
  return Array.from({ length: end - start }, (_, index) => start + index)
}
