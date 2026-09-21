import { describe, expect, it } from 'vitest'
import { buildCombinedTabItems } from './combinedTabs'

const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

describe('buildCombinedTabItems', () => {
  it('combines the selected pair at the earliest original position', () => {
    expect(buildCombinedTabItems(items, 'c', 'a', (item) => item.id)).toEqual([
      { kind: 'split', primary: items[2], secondary: items[0] },
      { kind: 'item', item: items[1] },
    ])
  })

  it('keeps the original list when the pair is incomplete or identical', () => {
    expect(buildCombinedTabItems(items, 'a', 'missing', (item) => item.id)).toEqual(
      items.map((item) => ({ kind: 'item', item })),
    )
    expect(buildCombinedTabItems(items, 'a', 'a', (item) => item.id)).toEqual(
      items.map((item) => ({ kind: 'item', item })),
    )
  })
})
