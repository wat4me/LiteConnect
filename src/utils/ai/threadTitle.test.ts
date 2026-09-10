import { describe, expect, it } from 'vitest'
import { AI_THREAD_TITLE_MAX, threadTitleFromMessages, threadTitleTooltip } from './threadTitle'

describe('threadTitleFromMessages', () => {
  it('returns empty when there is no user message', () => {
    expect(threadTitleFromMessages([])).toBe('')
    expect(threadTitleFromMessages([{ role: 'assistant', content: 'hi' }])).toBe('')
    expect(threadTitleFromMessages([{ role: 'user', content: '   ' }])).toBe('')
  })

  it('uses the first user message verbatim, flattened to one line', () => {
    const messages = [
      { role: 'user', content: '帮我看看  这台机器的\n磁盘占用' },
      { role: 'assistant', content: '好的' },
      { role: 'user', content: '再看看内存' },
    ]
    expect(threadTitleFromMessages(messages)).toBe('帮我看看 这台机器的 磁盘占用')
  })

  it('caps runaway input instead of storing an unbounded title', () => {
    const long = '啊'.repeat(AI_THREAD_TITLE_MAX + 50)
    expect(threadTitleFromMessages([{ role: 'user', content: long }])).toHaveLength(
      AI_THREAD_TITLE_MAX,
    )
  })
})

describe('threadTitleTooltip', () => {
  it('returns empty for missing titles', () => {
    expect(threadTitleTooltip('')).toBe('')
    expect(threadTitleTooltip(undefined)).toBe('')
  })

  it('shows short titles as-is', () => {
    expect(threadTitleTooltip('检查磁盘')).toBe('检查磁盘')
  })

  it('marks titles that were clipped by the storage cap', () => {
    const clipped = '啊'.repeat(AI_THREAD_TITLE_MAX)
    expect(threadTitleTooltip(clipped)).toBe(`${clipped}…`)
  })
})
