import { expect, it, vi } from 'vitest'
import { orchestrateInspection, scheduleHealth } from './orchestrator'
import type { AiSchedule, AiScheduleHostRun } from '../../../shared/aiSchedules'

const plan: AiSchedule = { id: 'p', name: 'inspect', connectionId: 'a', connectionIds: ['a','b','c'], prompt: 'compare', intervalMinutes: 60, enabled: true, createdAt: 1, updatedAt: 1, nextRunAt: 1 }
function setup() {
  const controller = new AbortController()
  const execute = vi.fn(async () => ({ content: 'healthy', health: 'healthy' as const }))
  const summarize = vi.fn(async () => 'combined report')
  const progress = vi.fn()
  return { controller, execute, summarize, progress, ports: { execute, summarize, progress, name: (id: string) => `host-${id}` } }
}

it('waits for every parallel host cleanup after cancellation before releasing the run', async () => {
  const { controller, ports, summarize } = setup()
  const finish: (() => void)[] = []
  const execute = vi.fn((_plan, _id, signal: AbortSignal) => new Promise<never>((_resolve, reject) => {
    signal.addEventListener('abort', () => { finish.push(() => reject(signal.reason)) }, { once: true })
  }))
  let finished = false
  const running = orchestrateInspection({ ...plan, concurrency: 3 }, 'run', controller.signal, { ...ports, execute })
  const stopped = expect(running).rejects.toThrow()
  void running.then(() => { finished = true }, () => { finished = true })
  expect(execute).toHaveBeenCalledTimes(3)
  controller.abort()
  finish[0](); finish[1]()
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(finished).toBe(false)
  finish[2](); await stopped
  expect(summarize).not.toHaveBeenCalled()
})
it('executes distinct hosts serially, continues after a host fails, and summarizes with provenance', async () => {
  const { controller, execute, summarize, progress, ports } = setup()
  execute.mockRejectedValueOnce(new Error('host offline'))
  const result = await orchestrateInspection(plan, 'run', controller.signal, ports)
  expect(execute.mock.calls.map(call => (call as any[])[0].connectionId)).toEqual(['a','b','c'])
  expect(result.hosts?.map(host => host.status)).toEqual(['failed','completed','completed'])
  expect(result.content).toBe('combined report')
  expect(result.health).toBe('unknown')
  expect(summarize).toHaveBeenCalledWith(plan, expect.arrayContaining([expect.objectContaining({ name: 'host-a', error: 'host offline' })]), controller.signal)
  expect(progress.mock.calls[0][0].map((host: AiScheduleHostRun) => host.status)).toEqual(['queued','queued','queued'])
})
it('inspects multiple hosts concurrently when concurrency is configured', async () => {
  const { controller, execute, ports } = setup()
  let running = 0
  let peak = 0
  execute.mockImplementation(async () => {
    running++
    peak = Math.max(peak, running)
    await Promise.resolve()
    running--
    return { content: 'ok', health: 'healthy' as const }
  })
  const result = await orchestrateInspection({ ...plan, concurrency: 3 }, 'run', controller.signal, ports)
  expect(peak).toBeGreaterThan(1)
  expect(result.hosts?.map(host => host.status)).toEqual(['completed','completed','completed'])
  expect(execute).toHaveBeenCalledTimes(3)
})
it('cancels the current host and queued hosts without starting the next one', async () => {
  const { controller, execute, progress, ports } = setup()
  execute.mockImplementationOnce(async () => { controller.abort(); return { content: '', health: 'healthy' } })
  await expect(orchestrateInspection(plan, 'run', controller.signal, ports)).rejects.toThrow()
  expect(execute).toHaveBeenCalledOnce()
  expect(progress.mock.calls.at(-1)![0].map((host: AiScheduleHostRun) => host.status)).toEqual(['cancelled','cancelled','cancelled'])
})
it('preserves per-host reports if synthesis fails and cannot downgrade host health', async () => {
  const { controller, execute, summarize, ports } = setup()
  execute.mockResolvedValueOnce({ content: 'disk full', health: 'critical' } as any)
  summarize.mockRejectedValueOnce(new Error('provider offline'))
  const result = await orchestrateInspection(plan, 'run', controller.signal, ports)
  expect(result.health).toBe('critical')
  expect(result.content).toContain('disk full')
  expect(result.error).toContain('汇总失败')
})
it('does not spend another model call on a single-host plan', async () => {
  const { controller, summarize, ports } = setup()
  const result = await orchestrateInspection({ ...plan, connectionIds: undefined }, 'run', controller.signal, ports)
  expect(result.content).toBe('healthy')
  expect(summarize).not.toHaveBeenCalled()
})

it('does not invoke synthesis when no host could be inspected', async () => {
  const { controller, execute, summarize, ports } = setup()
  execute.mockRejectedValue(new Error('unreachable'))
  const result = await orchestrateInspection(plan, 'run', controller.signal, ports)
  expect(result.hosts?.every(host => host.status === 'failed')).toBe(true)
  expect(result.content).toContain('unreachable')
  expect(summarize).not.toHaveBeenCalled()
})
it('parses only a final explicit health marker, keeping missing assessments unknown', () => {
  expect(scheduleHealth('report\n<liteconnect-health>warning</liteconnect-health>')).toEqual({ content: 'report', health: 'warning' })
  expect(scheduleHealth('report says healthy')).toEqual({ content: 'report says healthy', health: 'unknown' })
  expect(scheduleHealth('<liteconnect-health>healthy</liteconnect-health>\noutput continues').health).toBe('unknown')
})

it.each(['warning', 'critical', 'healthy'] as const)('separates failed execution from %s health', async health => {
  const { controller, execute, ports } = setup()
  execute.mockResolvedValueOnce({ content: 'report', health, error: 'tool failed' } as any)
  const expected = health === 'healthy' ? 'unknown' : health
  expect(await orchestrateInspection({ ...plan, connectionIds: undefined }, 'run', controller.signal, ports))
    .toMatchObject({ health: expected, hosts: [{ status: 'failed', health: expected }] })
})

it.each([2, 3])('does not classify progress persistence failure at update %s as host failure', async update => {
  const { controller, execute, progress, ports } = setup()
  let calls = 0
  progress.mockImplementation(() => { if (++calls === update) throw new Error('disk full') })
  await expect(orchestrateInspection(plan, 'run', controller.signal, ports)).rejects.toThrow('disk full')
  expect(execute).toHaveBeenCalledTimes(update === 2 ? 0 : 1)
  expect(progress.mock.calls.at(-1)![0][0].status).toBe(update === 2 ? 'running' : 'completed')
})
