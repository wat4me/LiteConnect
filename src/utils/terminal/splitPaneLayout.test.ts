import { describe, expect, it } from 'vitest'
import { getDividerStyle, getSessionPaneStyle, type SplitPaneLayoutState } from './splitPaneLayout'

const vertical: SplitPaneLayoutState = {
  dividerSize: 8,
  splitRatio: 60,
  splitMode: 'vertical',
  secondarySide: 'right',
  splitHasSecondary: true,
  maximizedSessionId: null,
  primarySessionId: 'a',
  secondarySessionId: 'b',
}

describe('split pane layout', () => {
  it('keeps retained sessions hidden and assigns each pane its side', () => {
    expect(getSessionPaneStyle('a', vertical)).toMatchObject({ left: '0', width: 'calc(60% - 4px)' })
    expect(getSessionPaneStyle('b', vertical)).toMatchObject({ right: '0', width: 'calc(40% - 4px)' })
    expect(getSessionPaneStyle('old', vertical)).toEqual({ display: 'none' })
    expect(getDividerStyle(vertical)).toMatchObject({ left: 'calc(60% - 4px)', width: '8px' })
  })

  it('shows only the primary pane without a split and only the maximized pane with one', () => {
    const single = { ...vertical, splitHasSecondary: false }
    expect(getSessionPaneStyle('a', single)).toMatchObject({ top: '0', bottom: '0' })
    expect(getSessionPaneStyle('b', single)).toEqual({ display: 'none' })
    const maximized = { ...vertical, maximizedSessionId: 'b' }
    expect(getSessionPaneStyle('a', maximized)).toEqual({ display: 'none' })
    expect(getSessionPaneStyle('b', maximized)).toMatchObject({ top: '0', bottom: '0' })
  })
})
