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
  it('tracks live progress separately from the conclusion', () => {
    const live = chatProcessLayout({ items: [think('plan'), tool(run({ id: 'a' })), tool(run({ id: 'b', content: '', status: 'running' }))], streaming: true })
    expect(live.get(0)).toMatchObject({ start: 0, firstRunId: 'a', live: true })
    expect([...live.keys()]).toEqual([0, 1, 2])
    const folded = chatProcessLayout({ items: [think('plan'), tool(run({ id: 'a' })), tool(run({ id: 'b' })), text('Disk is fine.')], streaming: true })
    expect(folded.get(0)).toMatchObject({ live: false, stats: { steps: 2 } })
    expect([...folded.keys()]).toEqual([0, 1, 2])
  })

  it('keeps interim text between independent tool summaries', () => {
    const items = [tool(run({ id: 'a' })), text('Disk is fine.'), think('check memory'), tool(run({ id: 'b', content: '', status: 'running' }))]
    const layout = chatProcessLayout({
      items, streaming: true,
    })
    expect(layout.get(0)).toMatchObject({ start: 0, firstRunId: 'a', live: false, stats: { steps: 1 } })
    expect(layout.has(1)).toBe(false)
    expect(layout.get(2)).toMatchObject({ start: 2, firstRunId: 'b', live: true, stats: { steps: 1 } })
    expect(layout.get(3)).toBe(layout.get(2))
    const completed = chatProcessLayout({ items: [...items, text('Memory is fine.')] })
    expect(completed.get(2)).toMatchObject({ firstRunId: 'b', live: false, stats: { steps: 1 } })
    expect(completed.has(4)).toBe(false)
  })

  it('keeps tools together across blank text chunks', () => {
    const layout = chatProcessLayout({ items: [tool(run({ id: 'a' })), text('\n\n'), tool(run({ id: 'b' }))] })
    expect(layout.get(0)).toMatchObject({ firstRunId: 'a', stats: { steps: 2 } })
    expect(layout.get(2)).toBe(layout.get(0))
  })

  it('summarizes completed work and keeps only steps awaiting user input visible', () => {
    const layout = chatProcessLayout({ items: [
      tool(run({ id: 'read' })),
      tool(run({ id: 'failed', content: '{"exitCode":2,"stderr":"missing"}' })),
      tool(run({ id: 'blocked', status: 'blocked', isError: true, content: 'blocked by policy' })),
      tool(run({ id: 'change', risk: 'write', args: '{"command":"systemctl restart nginx"}' })),
      tool(run({ id: 'denied-change', risk: 'write', status: 'denied', isError: true, content: 'denied' })),
      tool(run({ id: 'approval', status: 'ask', content: '' })),
      tool(run({ id: 'question', name: 'ask_user', status: 'question', content: '' })),
      text('Restarted nginx.'),
    ], status: 'completed' }).get(0)!
    expect([...layout.pinnedRunIds]).toEqual(['approval', 'question'])
    expect(layout.stats).toEqual({ steps: 7, changes: 1, failed: 1, blocked: 2 })
  })

  it('does not wrap turns that only think before answering', () => {
    expect(chatProcessLayout({ items: [think('hmm'), text('answer')] }).size).toBe(0)
  })

  it('marks a stopped turn without a conclusion as interrupted and no longer live', () => {
    const layout = chatProcessLayout({ items: [tool(run({ id: 'a' })), tool(run({ id: 'b', status: 'aborted', content: '' }))], status: 'aborted' }).get(0)!
    expect(layout).toMatchObject({ live: false, interrupted: true })
    expect(layout.pinnedRunIds.size).toBe(0)
  })

  it('marks only the trailing group as interrupted after a partial finding', () => {
    const layout = chatProcessLayout({ items: [tool(run({ id: 'a' })), text('partial finding'), tool(run({ id: 'b' }))], status: 'error' })
    expect(layout.get(0)?.interrupted).toBe(false)
    expect(layout.has(1)).toBe(false)
    expect(layout.get(2)?.interrupted).toBe(true)
  })
})
