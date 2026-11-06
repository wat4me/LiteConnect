import { describe, expect, it } from 'vitest'
import type { AiToolRun } from '@shared/types/ai'
import { chatProcessLayout, type ChatProcessItem } from './chatProcess'

const run = (patch: Partial<AiToolRun> & { id: string }): AiToolRun => ({
  name: 'exec', args: '{"command":"df -h"}', content: '{"exitCode":0,"stdout":"ok"}', isError: false, status: 'done', ...patch,
})
const tool = (item: AiToolRun): ChatProcessItem => ({ seg: { kind: 'tool', runId: item.id }, run: item })
const text = (value: string): ChatProcessItem => ({ seg: { kind: 'content', text: value } })
const think = (value: string): ChatProcessItem => ({ seg: { kind: 'reasoning', text: value } })

describe('chat process layout', () => {
  it('keeps the steps open while the turn is working and folds them once the conclusion starts', () => {
    const live = chatProcessLayout({ items: [think('plan'), tool(run({ id: 'a' })), tool(run({ id: 'b', content: '', status: 'running' }))], streaming: true })
    expect(live).toMatchObject({ hasProcess: true, live: true, conclusionIndex: -1 })
    expect([...live.processIndexes]).toEqual([0, 1, 2])
    const folded = chatProcessLayout({ items: [think('plan'), tool(run({ id: 'a' })), tool(run({ id: 'b' })), text('Disk is fine.')], streaming: true })
    expect(folded).toMatchObject({ hasProcess: true, live: false, conclusionIndex: 3 })
    expect([...folded.processIndexes]).toEqual([0, 1, 2])
    expect(folded.stats.steps).toBe(2)
  })

  it('treats text between tool calls as part of the process', () => {
    const layout = chatProcessLayout({
      items: [tool(run({ id: 'a' })), text('Let me check one more thing.'), tool(run({ id: 'b', content: '', status: 'running' }))], streaming: true,
    })
    expect(layout.live).toBe(true)
    expect([...layout.processIndexes]).toEqual([0, 1, 2])
  })

  it('pins failures, blocked calls and performed changes so they stay visible when folded', () => {
    const layout = chatProcessLayout({ items: [
      tool(run({ id: 'read' })),
      tool(run({ id: 'failed', content: '{"exitCode":2,"stderr":"missing"}' })),
      tool(run({ id: 'blocked', status: 'blocked', isError: true, content: 'blocked by policy' })),
      tool(run({ id: 'change', risk: 'write', args: '{"command":"systemctl restart nginx"}' })),
      tool(run({ id: 'denied-change', risk: 'write', status: 'denied', isError: true, content: 'denied' })),
      text('Restarted nginx.'),
    ], status: 'completed', createdAt: 1_000, completedAt: 63_000 })
    expect([...layout.pinnedRunIds]).toEqual(['failed', 'blocked', 'change', 'denied-change'])
    expect(layout.stats).toEqual({ steps: 5, changes: 1, failed: 1, blocked: 2, durationSeconds: 62 })
  })

  it('does not wrap turns that only think before answering', () => {
    expect(chatProcessLayout({ items: [think('hmm'), text('answer')] }).hasProcess).toBe(false)
  })

  it('marks a stopped turn without a conclusion as interrupted and no longer live', () => {
    const layout = chatProcessLayout({ items: [tool(run({ id: 'a' })), tool(run({ id: 'b', status: 'aborted', content: '' }))], status: 'aborted' })
    expect(layout).toMatchObject({ hasProcess: true, live: false, interrupted: true, conclusionIndex: -1 })
    expect([...layout.pinnedRunIds]).toEqual(['b'])
  })

  it('marks a failed turn with partial text as interrupted and keeps the text visible', () => {
    const layout = chatProcessLayout({ items: [tool(run({ id: 'a' })), text('partial finding')], status: 'error' })
    expect(layout).toMatchObject({ hasProcess: true, interrupted: true, conclusionIndex: 1 })
    expect([...layout.processIndexes]).toEqual([0])
  })
})
