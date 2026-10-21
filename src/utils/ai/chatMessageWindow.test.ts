import { expect, it } from 'vitest'
import { chatTurnStarts } from './chatMessageWindow'

it('keeps consecutive assistant replies and tool messages in the same user turn', () => {
  expect(chatTurnStarts([
    { id: 'u1', role: 'user' }, { id: 'a1', role: 'assistant' }, { id: 'a2', role: 'assistant' },
    { id: 'u2', role: 'user' }, { id: 'a3', role: 'assistant' },
  ])).toEqual([{ id: 'u1', index: 0 }, { id: 'u2', index: 3 }])
})

it('keeps a leading background reply accessible and handles empty history', () => {
  expect(chatTurnStarts([{ id: 'background', role: 'assistant' }, { id: 'u1', role: 'user' }])).toEqual([{ id: 'background', index: 0 }, { id: 'u1', index: 1 }])
  expect(chatTurnStarts([])).toEqual([])
})
