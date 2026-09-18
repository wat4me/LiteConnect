import { describe, expect, it } from 'vitest'
import { partialReorderByIds } from '@/utils/shared/reorder'

describe('partialReorderByIds', () => {
  const items = [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
    { id: 'c', name: 'C' },
    { id: 'd', name: 'D' },
  ]

  it('reorders only the subset while keeping slots', () => {
    // Swap b and d within full list → a,d,c,b
    const result = partialReorderByIds(items, ['d', 'b'])
    // subset [d,b] fills the slots that had b and d (indices 1 and 3)
    // walk: a keep, slot→d, c keep, slot→b
    expect(result.map((x) => x.id)).toEqual(['a', 'd', 'c', 'b'])
  })

  it('reorders contiguous subset', () => {
    const result = partialReorderByIds(items, ['c', 'b'])
    // slots of b,c become c,b → a,c,b,d
    expect(result.map((x) => x.id)).toEqual(['a', 'c', 'b', 'd'])
  })

  it('returns copy on empty ordered ids', () => {
    const result = partialReorderByIds(items, [])
    expect(result).toEqual(items)
    expect(result).not.toBe(items)
  })

  it('ignores unknown ids', () => {
    const result = partialReorderByIds(items, ['x', 'b'])
    // only b is in subset, single element → no effective change of relative order
    expect(result.map((x) => x.id)).toEqual(['a', 'b', 'c', 'd'])
  })
})
