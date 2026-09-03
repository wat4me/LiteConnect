import { describe, expect, it } from 'vitest'
import { isLiveReasoningSegment } from './chatReasoning'

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
