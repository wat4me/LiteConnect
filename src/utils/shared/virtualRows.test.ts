import { describe, expect, it } from 'vitest'
import { buildRowOffsets, visibleRowIndices } from './virtualRows'

describe('virtual connection row geometry', () => {
  it('renders a bounded viewport for a large connection collection', () => {
    const keys = Array.from({ length: 2000 }, (_, index) => String(index))
    const offsets = buildRowOffsets(keys, new Map(), 40)
    expect(offsets.at(-1)).toBe(80_000)
    const indices = visibleRowIndices(offsets, 20_000, 600)
    expect(indices).toContain(500)
    expect(indices.length).toBeLessThan(30)
    expect(indices[0]).toBeGreaterThan(480)
  })

  it('accounts for measured multiline errors and changed density', () => {
    const offsets = buildRowOffsets(['a', 'b', 'c', 'd'], new Map([['b', 180]]), 40)
    expect(offsets).toEqual([0, 40, 220, 260, 300])
    expect(visibleRowIndices(offsets, 80, 100, 0)).toEqual([1])
    expect(visibleRowIndices(offsets, 220, 40, 0)).toEqual([2, 3])
  })

  it('does not render offscreen groups and handles empty lists', () => {
    expect(visibleRowIndices([0], 0, 600)).toEqual([])
    expect(visibleRowIndices([0, 40, 80], -700, 600)).toEqual([])
    expect(visibleRowIndices([0, 40, 80], 80, 600)).toEqual([])
    expect(visibleRowIndices([0, 40, 80], -20, 40, 0)).toEqual([0])
  })
})
