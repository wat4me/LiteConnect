import { describe, expect, it } from 'vitest'
import { appendTextSegment, ensureToolSegments } from './chatSegments'

describe('appendTextSegment', () => {
  it('starts a new block when the tail is a different kind', () => {
    const afterReasoning = appendTextSegment([{ kind: 'reasoning', text: 'plan' }], 'content', 'hi')
    expect(afterReasoning).toEqual([
      { kind: 'reasoning', text: 'plan' },
      { kind: 'content', text: 'hi' },
    ])
  })

  it('concatenates into the tail when the kind matches', () => {
    const segs = [{ kind: 'content' as const, text: '先看' }]
    const next = appendTextSegment(segs, 'content', '磁盘')
    expect(next).toBe(segs)
    expect(next).toEqual([{ kind: 'content', text: '先看磁盘' }])
  })

  it('starts a new content block after a tool instead of merging with the preface', () => {
    const segs = [
      { kind: 'content' as const, text: '先看磁盘。' },
      { kind: 'tool' as const, runId: 'c1' },
    ]
    expect(appendTextSegment(segs, 'content', '占用如下')).toEqual([
      { kind: 'content', text: '先看磁盘。' },
      { kind: 'tool', runId: 'c1' },
      { kind: 'content', text: '占用如下' },
    ])
  })
})

describe('ensureToolSegments', () => {
  it('appends a new tool after already-streamed content', () => {
    const segs = [
      { kind: 'reasoning' as const, text: 'plan' },
      { kind: 'content' as const, text: '先看磁盘。' },
    ]
    expect(ensureToolSegments(segs, [{ id: 'c1' }])).toEqual([
      { kind: 'reasoning', text: 'plan' },
      { kind: 'content', text: '先看磁盘。' },
      { kind: 'tool', runId: 'c1' },
    ])
  })

  it('does not duplicate a tool that is already on the timeline', () => {
    const segs = [
      { kind: 'content' as const, text: '先看' },
      { kind: 'tool' as const, runId: 'c1' },
    ]
    expect(ensureToolSegments(segs, [{ id: 'c1' }])).toBe(segs)
  })

  it('appends only the missing runs, in arrival order', () => {
    const segs = [{ kind: 'tool' as const, runId: 'c1' }]
    expect(ensureToolSegments(segs, [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }])).toEqual([
      { kind: 'tool', runId: 'c1' },
      { kind: 'tool', runId: 'c2' },
      { kind: 'tool', runId: 'c3' },
    ])
  })
})
