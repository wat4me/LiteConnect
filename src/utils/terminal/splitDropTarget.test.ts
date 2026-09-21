import { describe, expect, it } from 'vitest'
import { resolveSplitDropTarget } from './splitDropTarget'

const rect = {
  left: 100,
  right: 1100,
  top: 100,
  bottom: 700,
  width: 1000,
  height: 600,
}

describe('resolveSplitDropTarget', () => {
  it('maps terminal edges to the matching split side', () => {
    expect(resolveSplitDropTarget(110, 400, rect)).toEqual({ mode: 'vertical', side: 'left' })
    expect(resolveSplitDropTarget(1090, 400, rect)).toEqual({ mode: 'vertical', side: 'right' })
    expect(resolveSplitDropTarget(600, 110, rect)).toEqual({ mode: 'horizontal', side: 'top' })
    expect(resolveSplitDropTarget(600, 690, rect)).toEqual({ mode: 'horizontal', side: 'bottom' })
  })

  it('uses the center as an explicit cancel zone', () => {
    expect(resolveSplitDropTarget(600, 400, rect)).toEqual({ mode: 'none', side: null })
  })

  it('ignores points outside the terminal and zero-sized targets', () => {
    expect(resolveSplitDropTarget(50, 400, rect)).toBeNull()
    expect(resolveSplitDropTarget(100, 100, { ...rect, width: 0 })).toBeNull()
  })

  it('chooses the closest edge in a corner', () => {
    expect(resolveSplitDropTarget(120, 160, rect)).toEqual({ mode: 'vertical', side: 'left' })
  })
})
