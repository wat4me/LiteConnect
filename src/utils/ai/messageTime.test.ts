import { describe, expect, it } from 'vitest'
import { formatMessageTime, formatMessageTimeDetail, messageDisplayTimestamp } from './messageTime'

describe('AI message timestamps', () => {
  it('uses the send time for user messages', () => {
    expect(messageDisplayTimestamp({ role: 'user', createdAt: 100, completedAt: 200 })).toBe(100)
  })

  it('hides assistant time while streaming and uses completion time afterward', () => {
    expect(messageDisplayTimestamp({ role: 'assistant', createdAt: 100, completedAt: 200, streaming: true })).toBeUndefined()
    expect(messageDisplayTimestamp({ role: 'assistant', createdAt: 100, completedAt: 200 })).toBe(200)
  })

  it('falls back to createdAt for legacy assistant history', () => {
    expect(messageDisplayTimestamp({ role: 'assistant', createdAt: 100 })).toBe(100)
  })

  it('formats compact and detailed local time', () => {
    const timestamp = new Date(2026, 8, 17, 9, 5, 7).getTime()
    expect(formatMessageTime(timestamp)).toBe('09:05')
    expect(formatMessageTimeDetail(timestamp)).toBe('2026-09-17 09:05:07')
  })
})
