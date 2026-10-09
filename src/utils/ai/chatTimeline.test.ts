import { describe, expect, it } from 'vitest'
import { activeTimelineTurnId, collectChatTimelineTurns, previewChatTurn, overviewChatTimelineTurns } from './chatTimeline'

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

describe('overviewChatTimelineTurns', () => {
  it('bounds thousands of turns and keeps the start, end and active turn in order', () => {
    const turns = Array.from({ length: 1000 }, (_, index) => ({ id: `u${index}`, index, preview: `${index}` }))
    for (const capacity of [3, 4, 12, 100]) {
      const overview = overviewChatTimelineTurns(turns, 'u478', capacity)
      expect(overview.length).toBeLessThanOrEqual(Math.min(capacity, 12))
      expect(overview[0].id).toBe('u0')
      expect(overview.at(-1)?.id).toBe('u999')
      expect(overview.some(turn => turn.id === 'u478')).toBe(true)
      expect(overview.map(turn => turn.index)).toEqual(overview.map(turn => turn.index).sort((a, b) => a - b))
      expect(new Set(overview.map(turn => turn.id)).size).toBe(overview.length)
    }
  })
  it('preserves short histories and works without an active turn', () => {
    const turns = collectChatTimelineTurns([{ id: 'u', role: 'user', content: '', images: [{ name: '截图.png' }] }])
    expect(overviewChatTimelineTurns(turns, '')).toEqual(turns)
    expect(turns[0].preview).toBe('截图.png')
    expect(overviewChatTimelineTurns([], '')).toEqual([])
  })
})
