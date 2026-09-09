import { describe, expect, it } from 'vitest'
import { isLiveReasoningSegment, reasoningLiveSnippet } from './chatReasoning'

describe('reasoningLiveSnippet', () => {
  it('returns empty for blank input', () => {
    expect(reasoningLiveSnippet('')).toBe('')
    expect(reasoningLiveSnippet('  \n  ')).toBe('')
  })

  it('uses the last non-empty line so new thoughts replace the placeholder', () => {
    expect(reasoningLiveSnippet('先看负载\n再看磁盘占用')).toBe('再看磁盘占用')
    expect(reasoningLiveSnippet('先看负载\n\n  ')).toBe('先看负载')
  })

  it('collapses inner whitespace onto one line', () => {
    expect(reasoningLiveSnippet('检查  磁盘\t占用')).toBe('检查 磁盘 占用')
  })

  it('keeps the newest tail when the line is longer than the slot', () => {
    const text = '甲'.repeat(12)
    expect(reasoningLiveSnippet(text, 8)).toBe(`…${'甲'.repeat(8)}`)
  })
})


describe('isLiveReasoningSegment', () => {
  it('is false when the reply is not streaming', () => {
    expect(
      isLiveReasoningSegment(
        {
          streaming: false,
          reasoningContent: 'plan',
          segments: [{ kind: 'reasoning' }],
        },
        0,
      ),
    ).toBe(false)
  })

  it('treats trailing reasoning as live while streaming', () => {
    expect(
      isLiveReasoningSegment(
        {
          streaming: true,
          segments: [{ kind: 'reasoning' }],
        },
        0,
      ),
    ).toBe(true)
  })

  it('is false once a later content or tool segment exists', () => {
    const message = {
      streaming: true,
      segments: [{ kind: 'reasoning' }, { kind: 'content' }],
    }
    expect(isLiveReasoningSegment(message, 0)).toBe(false)
    expect(isLiveReasoningSegment(message, 1)).toBe(false)
  })

  it('falls back to reasoningContent when segments are missing', () => {
    expect(
      isLiveReasoningSegment({ streaming: true, reasoningContent: '…', content: '' }, 0),
    ).toBe(true)
    expect(
      isLiveReasoningSegment({ streaming: true, reasoningContent: '…', content: 'hi' }, 0),
    ).toBe(false)
    expect(isLiveReasoningSegment({ streaming: true, content: '' }, 0)).toBe(false)
  })
})
