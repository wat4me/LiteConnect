import { describe, expect, it } from 'vitest'
import {
  activeTimelineTurnId,
  clampTimelineFlyoutTop,
  collectChatTimelineTurns,
  nearbyTimelineIndices,
  nearestTimelineIndex,
  previewChatTurn,
  timelineFlyoutTop,
  timelineTickRatio,
} from './chatTimeline'

describe('previewChatTurn', () => {
  it('collapses whitespace and truncates with an ellipsis', () => {
    expect(previewChatTurn('  hello\nworld  ')).toBe('hello world')
    expect(previewChatTurn('abcdefghij', 8)).toBe('abcdefg…')
    expect(previewChatTurn('   ')).toBe('')
  })
})

describe('collectChatTimelineTurns', () => {
  it('keeps user prompts in order and skips empty or non-user rows', () => {
    expect(
      collectChatTimelineTurns([
        { id: 'a', role: 'user', content: 'disk check' },
        { id: 'b', role: 'assistant', content: 'ok' },
        { id: 'c', role: 'user', content: '  ' },
        { id: 'd', role: 'user', content: 'next' },
      ]),
    ).toEqual([
      { id: 'a', preview: 'disk check', index: 0 },
      { id: 'd', preview: 'next', index: 1 },
    ])
  })
})

describe('timelineTickRatio / nearestTimelineIndex', () => {
  it('pins a single turn to the middle', () => {
    expect(timelineTickRatio(0, 1)).toBe(0.5)
    expect(nearestTimelineIndex(1, 10, 100)).toBe(0)
  })

  it('maps the first and last turns to the track ends', () => {
    expect(timelineTickRatio(0, 5)).toBe(0)
    expect(timelineTickRatio(4, 5)).toBe(1)
    expect(nearestTimelineIndex(5, 0, 100)).toBe(0)
    expect(nearestTimelineIndex(5, 100, 100)).toBe(4)
  })

  it('picks the closest turn for a hover Y', () => {
    expect(nearestTimelineIndex(5, 50, 100)).toBe(2)
    expect(nearestTimelineIndex(5, -8, 100)).toBe(0)
    expect(nearestTimelineIndex(0, 10, 100)).toBe(0)
  })
})

describe('nearbyTimelineIndices', () => {
  it('clamps the window to the turn list', () => {
    expect(nearbyTimelineIndices(0, 5, 2)).toEqual([0, 1, 2])
    expect(nearbyTimelineIndices(4, 5, 2)).toEqual([2, 3, 4])
    expect(nearbyTimelineIndices(2, 5, 2)).toEqual([0, 1, 2, 3, 4])
    expect(nearbyTimelineIndices(0, 0)).toEqual([])
  })
})

describe('timeline flyout placement', () => {
  it('clamps the flyout inside the track', () => {
    expect(clampTimelineFlyoutTop(-20, 80, 200)).toBe(0)
    expect(clampTimelineFlyoutTop(180, 80, 200)).toBe(120)
  })

  it('aligns the hovered row with the tick', () => {
    const top = timelineFlyoutTop({
      tickRatio: 0.5,
      trackHeight: 200,
      flyoutHeight: 96,
      hoveredLocalIndex: 1,
      rowHeight: 48,
    })
    expect(top).toBe(100 - 48 - 24)
  })
})

describe('activeTimelineTurnId', () => {
  const turns = [
    { id: 'u1', top: 0 },
    { id: 'u2', top: 400 },
    { id: 'u3', top: 900 },
  ]

  it('returns the last turn that has reached the viewport lead', () => {
    expect(activeTimelineTurnId(turns, 0)).toBe('u1')
    expect(activeTimelineTurnId(turns, 380)).toBe('u2')
    expect(activeTimelineTurnId(turns, 880)).toBe('u3')
  })

  it('returns empty when there are no turns', () => {
    expect(activeTimelineTurnId([], 0)).toBe('')
  })
})
