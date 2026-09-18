import { describe, expect, it } from 'vitest'
import { activeTimelineTurnId, collectChatTimelineTurns, previewChatTurn } from './chatTimeline'

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
