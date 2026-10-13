import { describe, expect, it } from 'vitest'
import { formatToolRunDisplay, serializeToolRunForHistory } from '@shared/aiToolRunDisplay'
import type { AiToolRun } from '@shared/types/ai'
import { SSH_MCP_TOOL_NAMES } from '@shared/mcp/types'
import locale from '@/i18n/locales/zh-CN/ai'
import { backgroundJobState, toolRunPresentation, toolStateKeys } from './toolRunPresentation'

const run = (patch: Partial<AiToolRun> = {}): AiToolRun => ({
  id: 'call', name: 'read_file', args: '{}', content: '', isError: false, status: 'done', ...patch,
})

describe('tool outcome presentation', () => {
  it('uses the same completion state for command and file tools', () => {
    expect(toolRunPresentation(run(), { kind: 'ok' }).state).toBe('completed')
    expect(toolRunPresentation(run({ name: 'exec' }), { kind: 'exit', code: 0 }).state).toBe('completed')
    expect(backgroundJobState('completed', 0)).toBe('completed')
  })

  it('keeps result counts, exit codes and truncation separate from state', () => {
    expect(toolRunPresentation(run({ name: 'grep' }), { kind: 'entries', count: 0 })).toEqual({
      state: 'completed', detailKey: 'ai.toolSummaryMatches', detailParams: { n: 0 },
    })
    expect(toolRunPresentation(run({ name: 'list_dir' }), { kind: 'entries', count: 8 })).toMatchObject({
      state: 'completed', detailKey: 'ai.toolSummaryEntries', detailParams: { n: 8 },
    })
    expect(toolRunPresentation(run(), { kind: 'exit', code: 1, truncated: true })).toEqual({
      state: 'failed', detailKey: 'ai.toolSummaryExitHint', detailParams: { code: 1 }, truncated: true,
    })
  })

  it.each([
    ['ask', 'waiting'], ['running', 'running'], ['denied', 'denied'], ['blocked', 'blocked'],
    ['reclassify', 'invalid'], ['aborted', 'stopped'],
  ] as const)('preserves %s even without output during streaming', (status, state) => {
    expect(toolRunPresentation(run({ status, isError: true }), { kind: 'ok' }, true).state).toBe(state)
  })

  it('does not call an empty completed result running', () => {
    expect(toolRunPresentation(run(), { kind: 'ok' }, true).state).toBe('completed')
  })

  it('distinguishes launching a background command from finishing it after history serialization', () => {
    const stored = serializeToolRunForHistory({ name: 'exec', args: '{}', isError: false,
      content: JSON.stringify({ jobId: 'job', status: 'running', command: 'deploy' }) })
    const launched = run({ name: 'exec', ...stored })
    expect(toolRunPresentation(launched, formatToolRunDisplay(launched).summary).state).toBe('started')
    expect(backgroundJobState('running')).toBe('running')
    expect(backgroundJobState('completed', 2)).toBe('failed')
    expect(backgroundJobState('cancelled')).toBe('stopped')
    expect(backgroundJobState('timeout')).toBe('timeout')
  })

  it('recognizes explicit timeout errors without treating arbitrary output as status', () => {
    expect(toolRunPresentation(run({ isError: true, content: 'EXEC_TIMEOUT: command timed out' }), { kind: 'ok' }).state).toBe('timeout')
    expect(toolRunPresentation(run({ isError: true, content: 'a file named timeout was missing' }), { kind: 'ok' }).state).toBe('failed')
  })

  it.each(['grep', 'glob'])('retains %s counts through live output and saved history, including empty results', name => {
    for (const count of [0, 2]) {
      const content = JSON.stringify(name === 'grep'
        ? { matches: Array.from({ length: count }, (_, i) => ({ path: '/log', line: i + 1, text: 'hit' })) }
        : { files: Array.from({ length: count }, (_, i) => `/file-${i}`) })
      const stored = serializeToolRunForHistory({ name, args: '{}', content, isError: false })
      expect(formatToolRunDisplay({ name, ...stored }).summary).toEqual({ kind: 'entries', count })
      expect(JSON.parse(stored.content)).toBeTruthy()
    }
  })

  it('provides Chinese action names for every registered tool and labels for every state', () => {
    for (const name of SSH_MCP_TOOL_NAMES) expect(locale.ai.toolName).toHaveProperty(name)
    for (const key of Object.values(toolStateKeys)) expect(locale.ai).toHaveProperty(key.slice(3))
  })
})
