import { expect, it, vi } from 'vitest'
import { executeAiToolCall } from './toolExecution'
import type { AiToolExecutionContext } from './toolExecutionContext'

vi.mock('electron', () => ({ app: { getPath: () => 'C:/fixture' } }))

const SESSION = '550e8400-e29b-41d4-a716-446655440000'
const call = (args: Record<string, unknown>) => ({
  id: 'exec-1', type: 'function' as const,
  function: { name: 'exec', arguments: JSON.stringify({ risk: 'read', explanation: 'Re-check disk usage after the cleanup.', command: 'df -h', background: true, startAfterMs: 300_000, ...args }) },
})

function setup(overrides: Partial<AiToolExecutionContext> = {}) {
  const remote = vi.fn(async () => ({ isError: false, content: '{}', structuredContent: {} }))
  const schedule = vi.fn(async () => ({ jobId: 'job-scheduled', dueAt: 42 }))
  const started: string[][] = []
  const context = {
    requestId: 'schedule-test', boundSessionId: SESSION, sshMcpRuntime: { call: remote }, signal: new AbortController().signal, send: vi.fn(),
    getToolPermission: () => 'auto', scheduleBackgroundJob: schedule, onBackgroundJobsStarted: (ids: string[]) => { started.push(ids) }, ...overrides,
  } as unknown as AiToolExecutionContext
  return { context, remote, schedule, started }
}

it('registers a delayed exec instead of running it and links the job id to the tool run', async () => {
  const { context, remote, schedule, started } = setup()
  const result = await executeAiToolCall(call({ note: 'Cleanup should have freed space by then.' }), context)
  expect(remote).not.toHaveBeenCalled()
  expect(schedule).toHaveBeenCalledWith(expect.objectContaining({
    sessionId: SESSION, command: 'df -h', jobTimeoutMs: 1_800_000, startAfterMs: 300_000, note: 'Cleanup should have freed space by then.', risk: 'read',
  }))
  expect(result?.run).toMatchObject({ status: 'done', isError: false, jobIds: ['job-scheduled'] })
  expect(JSON.parse(result!.run.content)).toMatchObject({ jobId: 'job-scheduled', status: 'scheduled', dueAt: 42, dueAtLocal: expect.stringMatching(/^1970-01-01 \d{2}:\d{2}:\d{2} UTC[+-]\d{2}:\d{2}$/) })
  expect(started).toEqual([['job-scheduled']])
})

it('refuses delays outside the allowed window and foreground scheduling without touching SSH', async () => {
  const { context, remote, schedule } = setup()
  const tooSoon = await executeAiToolCall(call({ startAfterMs: 1000 }), context)
  expect(tooSoon?.run.isError).toBe(true)
  expect(tooSoon?.run.content).toContain('INVALID_SCHEDULE_DELAY')
  const foreground = await executeAiToolCall(call({ background: false }), context)
  expect(foreground?.run.isError).toBe(true)
  expect(foreground?.run.content).toContain('INVALID_ARGUMENTS')
  expect(remote).not.toHaveBeenCalled()
  expect(schedule).not.toHaveBeenCalled()
})

it('reports when scheduling is unavailable and maps service limits to actionable errors', async () => {
  const unavailable = setup({ scheduleBackgroundJob: undefined })
  const missing = await executeAiToolCall(call({}), unavailable.context)
  expect(missing?.run.isError).toBe(true)
  expect(missing?.run.content).toContain('SCHEDULE_UNAVAILABLE')
  expect(unavailable.remote).not.toHaveBeenCalled()
  const limited = setup({ scheduleBackgroundJob: vi.fn(async () => { throw new Error('SCHEDULE_LIMIT') }) })
  const result = await executeAiToolCall(call({}), limited.context)
  expect(result?.run.isError).toBe(true)
  expect(result?.run.content).toContain('SCHEDULE_LIMIT')
  expect(result?.run.content).toContain('cancel_job')
  expect(limited.remote).not.toHaveBeenCalled()
})

it('keeps a scheduled exec behind the same approval gate as an immediate one', async () => {
  const { context, remote, schedule } = setup({ getToolPermission: () => 'readonly' })
  const denied = await executeAiToolCall(call({ risk: 'write', command: 'systemctl restart nginx' }), context)
  expect(denied?.run.status).toBe('blocked')
  expect(schedule).not.toHaveBeenCalled()
  expect(remote).not.toHaveBeenCalled()
})

it('accepts a local wall-clock startAt, converts it to a delay and explains unreadable or past times', async () => {
  const { context, schedule } = setup()
  const target = new Date(Date.now() + 10 * 60_000)
  const pad = (value: number) => String(value).padStart(2, '0')
  const startAt = `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())} ${pad(target.getHours())}:${pad(target.getMinutes())}`
  const result = await executeAiToolCall(call({ startAfterMs: undefined, startAt }), context)
  expect(result?.run.isError).toBe(false)
  const delay = (schedule.mock.calls[0] as unknown as [{ startAfterMs: number }])[0].startAfterMs
  expect(delay).toBeGreaterThan(8 * 60_000)
  expect(delay).toBeLessThanOrEqual(10 * 60_000)
  const past = await executeAiToolCall(call({ startAfterMs: undefined, startAt: '2001-01-01 08:00' }), context)
  expect(past?.run.content).toContain('INVALID_SCHEDULE_DELAY')
  expect(past?.run.content).toContain('Now: ')
  const unreadable = await executeAiToolCall(call({ startAfterMs: undefined, startAt: 'tomorrow morning' }), context)
  expect(unreadable?.run.content).toContain('INVALID_SCHEDULE_TIME')
  const both = await executeAiToolCall(call({ startAt }), context)
  expect(both?.run.content).toContain('INVALID_ARGUMENTS')
  expect(schedule).toHaveBeenCalledTimes(1)
})

it('schedules inside a LiteAI workspace on the session of the named connection', async () => {
  const target = { connectionId: 'conn-1', sessionId: SESSION, name: 'Prod', host: '10.0.0.8', port: 22, username: 'ops' }
  const runtimeCall = vi.fn(async () => ({ isError: false, content: '{}', structuredContent: {} }))
  const { context, schedule } = setup({ workspaceTargets: [target], sshMcpRuntime: { call: runtimeCall, hasSession: () => true } } as unknown as Partial<AiToolExecutionContext>)
  const result = await executeAiToolCall(call({ connectionId: 'conn-1' }), context)
  expect(result?.run).toMatchObject({ status: 'done', isError: false, jobIds: ['job-scheduled'], target: 'Prod (ops@10.0.0.8:22)' })
  expect(schedule).toHaveBeenCalledWith(expect.objectContaining({ sessionId: SESSION, command: 'df -h' }))
  expect(runtimeCall).not.toHaveBeenCalled()
  const outside = await executeAiToolCall(call({ connectionId: 'other' }), context)
  expect(outside?.run.status).toBe('blocked')
  expect(outside?.run.content).toContain('SCOPE_DENIED')
  expect(schedule).toHaveBeenCalledTimes(1)
})
