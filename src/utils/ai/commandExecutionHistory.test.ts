import { describe, expect, it } from 'vitest'
import type { AiToolRun } from '@shared/types/ai'
import { AI_BACKGROUND_RESULT_PREFIX } from '@shared/aiBackgroundResults'
import { commandExecutionDetail, commandExecutionRecords } from './commandExecutionHistory'
import { createToolRunDisplayCache } from './toolRunDisplayCache'
import { toolRunPresentation } from './toolRunPresentation'

const exec = (overrides: Partial<AiToolRun> = {}): AiToolRun => ({
  id: 'call', name: 'exec', args: JSON.stringify({ command: 'printf hello', connectionId: 'one' }),
  content: JSON.stringify({ stdout: 'hello\n', stderr: '', exitCode: 0 }), isError: false, status: 'done', target: 'web-01', ...overrides,
})
const message = (id: string, toolRuns: AiToolRun[]) => ({ id, role: 'assistant' as const, toolRuns })

describe('command execution history', () => {
  it('lists only command calls and gives reused tool ids distinct message keys', () => {
    const first = exec()
    const records = commandExecutionRecords([
      message('first', [first, exec({ name: 'read_file' })]),
      message('second', [exec({ status: 'blocked', content: 'Not executed', isError: true })]),
    ])
    expect(records.map(record => record.key)).toEqual(['first:call', 'second:call'])
    expect(records[0].run).toBe(first)
    expect(records[1].run.status).toBe('blocked')
  })

  it('preserves literal output and reports nonzero exits without treating them as success', () => {
    const run = exec({ content: JSON.stringify({ stdout: '<script>literal</script>\n', stderr: 'permission denied\n', exitCode: 2 }) })
    const detail = commandExecutionDetail(run)
    expect(detail).toMatchObject({ command: 'printf hello', stdout: '<script>literal</script>\n', stderr: 'permission denied\n', exitCode: 2, target: 'web-01' })
    const { toolView } = createToolRunDisplayCache()
    expect(toolRunPresentation(run, toolView(run).summary).state).toBe('failed')
  })

  it('updates only the matching background command and leaves source history untouched', () => {
    const pending = exec({ jobIds: ['job-one'], content: JSON.stringify({ jobId: 'job-one', status: 'running' }) })
    const notices = `${AI_BACKGROUND_RESULT_PREFIX}\n${JSON.stringify([{ jobId: 'job-other', status: 'completed', stdout: 'wrong host' }, { jobId: 'job-one', status: 'completed', stdout: 'finished', exitCode: 0 }])}`
    const records = commandExecutionRecords([message('start', [pending]), { ...message('finish', []), backgroundNotice: notices }])
    expect(records).toHaveLength(1)
    expect(commandExecutionDetail(records[0].run)).toMatchObject({ stdout: 'finished', exitCode: 0 })
    expect(pending.content).toContain('running')
    expect(pending.status).toBe('done')
  })

  it('uses saved get_job results for a timed out background command', () => {
    const records = commandExecutionRecords([message('reply', [
      exec({ content: JSON.stringify({ jobId: 'job-one', status: 'running' }) }),
      exec({ id: 'poll', name: 'get_job', content: JSON.stringify({ jobId: 'job-one', status: 'timeout', stdout: 'partial', error: 'Exec timeout' }) }),
    ])])
    expect(commandExecutionDetail(records[0].run)).toMatchObject({ stdout: 'partial', error: 'Exec timeout', exitCode: null })
    const { toolView } = createToolRunDisplayCache()
    expect(toolRunPresentation(records[0].run, toolView(records[0].run).summary).state).toBe('timeout')
  })

  it('recovers bounded truncated output without inventing an exit code', () => {
    const detail = commandExecutionDetail(exec({ args: '{"command":"' + 'x'.repeat(4_100), content: '{"stdout":"' + 'y'.repeat(20_100) }))
    expect(detail.command.length).toBeLessThanOrEqual(4_000)
    expect(detail.stdout.length).toBeLessThanOrEqual(20_000)
    expect(detail).toMatchObject({ exitCode: null, structured: true, truncated: true, commandTruncated: true })
  })
})
