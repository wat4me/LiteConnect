import { describe, expect, it } from 'vitest'
import { selectConnectionRange, toggleConnectionSelection } from './connectionSelection'

describe('connectionSelection', () => {
  it('adds and removes a single connection and clears anchor when empty', () => {
    const first = toggleConnectionSelection([], 'a', 5)
    expect(first).toEqual({ ids: ['a'], lastSelectedId: 'a', limitExceeded: false })

    const second = toggleConnectionSelection(first.ids, 'b', 5)
    expect(second).toEqual({ ids: ['a', 'b'], lastSelectedId: 'b', limitExceeded: false })

    const removed = toggleConnectionSelection(second.ids, 'a', 5)
    expect(removed).toEqual({ ids: ['b'], lastSelectedId: 'a', limitExceeded: false })

    const emptied = toggleConnectionSelection(removed.ids, 'b', 5)
    expect(emptied).toEqual({ ids: [], lastSelectedId: null, limitExceeded: false })
  })

  it('enforces maxCount when toggling a new item', () => {
    const result = toggleConnectionSelection(['a', 'b'], 'c', 2)
    expect(result).toEqual({ ids: ['a', 'b'], lastSelectedId: 'c', limitExceeded: true })
  })

  it('selects an inclusive range in either direction without duplicates', () => {
    const visible = ['a', 'b', 'c', 'd', 'e']
    const forward = selectConnectionRange(['b'], visible, 'b', 'd', 10)
    expect(forward).toEqual({ ids: ['b', 'c', 'd'], lastSelectedId: 'd', limitExceeded: false })

    const backward = selectConnectionRange(['d'], visible, 'd', 'b', 10)
    expect(backward).toEqual({ ids: ['d', 'b', 'c'], lastSelectedId: 'b', limitExceeded: false })
  })

  it('caps range selection to maxCount and reports limitExceeded', () => {
    const visible = ['a', 'b', 'c', 'd']
    const result = selectConnectionRange(['a'], visible, 'a', 'd', 2)
    expect(result).toEqual({ ids: ['a', 'b'], lastSelectedId: 'd', limitExceeded: true })
  })

  it('falls back to single toggle when anchor is absent or outside visible list', () => {
    const visible = ['a', 'b', 'c']
    expect(selectConnectionRange([], visible, null, 'b', 5)).toEqual({
      ids: ['b'],
      lastSelectedId: 'b',
      limitExceeded: false,
    })
    expect(selectConnectionRange(['x'], visible, 'x', 'b', 5)).toEqual({
      ids: ['x', 'b'],
      lastSelectedId: 'b',
      limitExceeded: false,
    })
  })
})
