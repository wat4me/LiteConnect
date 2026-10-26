import { describe, expect, it } from 'vitest'
import type { AiToolRun } from '@shared/types/ai'
import { AI_BACKGROUND_RESULT_PREFIX } from '@shared/aiBackgroundResults'
import { commandExecutionDetail, commandExecutionRecords } from './commandExecutionHistory'
import { createToolRunDisplayCache } from './toolRunDisplayCache'
import { toolRunPresentation } from './toolRunPresentation'
import { serializeToolRunForHistory } from '@shared/aiToolRunDisplay'
import { clampToolResultForModel } from '@shared/mcp/toolResultClamp'

const exec = (overrides: Partial<AiToolRun> = {}): AiToolRun => ({
  id: 'call', name: 'exec', args: JSON.stringify({ command: 'printf hello', connectionId: 'one' }),
  content: JSON.stringify({ stdout: 'hello\n', stderr: '', exitCode: 0 }), isError: false, status: 'done', target: 'web-01', ...overrides,
})
const message = (id: string, toolRuns: AiToolRun[]) => ({ id, role: 'assistant' as const, toolRuns })
const saved = (payload: Record<string, unknown>, overrides: Partial<AiToolRun> = {}) => {
  const result = clampToolResultForModel({ isError: false, content: JSON.stringify(payload), structuredContent: payload })
  return exec({ ...serializeToolRunForHistory({ name: overrides.name || 'exec', args: overrides.args || exec().args,
    ...result, structured: result.structuredContent }), ...overrides })
}
const outcome = (run: AiToolRun) => toolRunPresentation(run, createToolRunDisplayCache().toolView(run).summary).state

describe('command execution history', () => {
  it('round-trips stderr-only output and literal stderr markers without mixing streams', () => {
    const stderr = 'permission denied\n'
    expect(commandExecutionDetail(saved({ stdout: '', stderr, exitCode: 2 }))).toMatchObject({ stdout: '', stderr, exitCode: 2 })
    const stdout = 'start\n\n[stderr]\nthis is ordinary output\n'
    expect(commandExecutionDetail(saved({ stdout, stderr, exitCode: 0 }))).toMatchObject({ stdout, stderr })
  })

  it('keeps failure metadata and valid JSON after clamping and saving heavily escaped output', () => {
    const run = saved({ stdout: '"\\\n'.repeat(7000), stderr: 'last error'.repeat(250), exitCode: 7 })
    expect(run.content.length).toBeLessThanOrEqual(20_000)
    expect(JSON.parse(run.content)).toMatchObject({ exitCode: 7, truncated: true })
    expect(commandExecutionDetail(run)).toMatchObject({ exitCode: 7, truncated: true })
    expect(outcome(run)).toBe('failed')
  })

  it('recovers the leading exit code from legacy cut JSON without declaring success', () => {
    const run = exec({ content: '{"exitCode":7,"stdout":"' + 'x'.repeat(20_000) })
    expect(commandExecutionDetail(run)).toMatchObject({ exitCode: 7, truncated: true })
    expect(outcome(run)).toBe('failed')
  })

  it('preserves termination signals and structured error messages through saving', () => {
    const run = saved({ stdout: 'partial', stderr: '', exitCode: null, signal: 'TERM' })
    expect(commandExecutionDetail(run)).toMatchObject({ stdout: 'partial', signal: 'TERM', exitCode: null })
    expect(outcome(run)).toBe('stopped')
    const stored = serializeToolRunForHistory({ name: 'exec', args: exec().args, content: 'EXEC_TIMEOUT: timed out',
      structured: { code: 'EXEC_TIMEOUT', message: 'timed out' }, isError: true })
    const error = exec({ ...stored, isError: true })
    expect(commandExecutionDetail(error).error).toBe('timed out')
    expect(outcome(error)).toBe('timeout')
  })

  it.each(['completed', 'timeout', 'cancelled'])('associates saved get_job and cancel_job results for %s jobs', status => {
    const pending = saved({ jobId: 'job-one', status: 'running' }, { jobIds: ['job-one'] })
    const result = saved({ jobId: 'job-one', status, stdout: 'final output', exitCode: status === 'completed' ? 0 : null },
      { id: 'query', name: status === 'cancelled' ? 'cancel_job' : 'get_job', args: '{"jobId":"job-one"}' })
    const [record] = commandExecutionRecords([message('reply', [pending, result])])
    expect(commandExecutionDetail(record.run).stdout).toBe('final output')
    expect(outcome(record.run)).toBe(status === 'completed' ? 'completed' : status === 'timeout' ? 'timeout' : 'stopped')
  })

  it('links legacy saved get_job output using its arguments', () => {
    const pending = saved({ jobId: 'job-one', status: 'running' }, { jobIds: ['job-one'] })
    const result = exec({ id: 'query', name: 'get_job', args: '{"jobId":"job-one"}', content: '{"exitCode":0,"stdout":"done"}' })
    expect(commandExecutionDetail(commandExecutionRecords([message('reply', [pending, result])])[0].run).stdout).toBe('done')
  })

  it('updates owned live cancellations and keeps saved output when snapshots omit it', () => {
    const pending = saved({ jobId: 'job-one', status: 'running' }, { jobIds: ['job-one'] })
    const snapshot = { jobId: 'job-one', sessionId: 'ssh-one', command: 'printf hello', status: 'cancelled' as const, startedAt: 1 }
    const messages = [message('reply', [pending])]
    expect(outcome(commandExecutionRecords(messages, [snapshot])[0].run)).toBe('stopped')
    expect(outcome(commandExecutionRecords(messages, [{ ...snapshot, jobId: 'another-job' }])[0].run)).toBe('started')
    const final = exec({ id: 'query', name: 'get_job', args: '{"jobId":"job-one"}',
      content: '{"jobId":"job-one","status":"completed","exitCode":0,"stdout":"saved output"}' })
    const records = [message('reply', [pending, final])]
    for (const status of ['completed', 'running'] as const) {
      const projected = commandExecutionRecords(records, [{ ...snapshot, status, exitCode: 0 }])[0].run
      expect(commandExecutionDetail(projected).stdout).toBe('saved output')
      expect(outcome(projected)).toBe('completed')
    }
  })

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
