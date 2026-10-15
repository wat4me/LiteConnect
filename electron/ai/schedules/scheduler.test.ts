import { afterEach, expect, it, vi } from 'vitest'
import { AiScheduler } from './scheduler'
import { orchestrateInspection } from './orchestrator'
import type { AiRunNotification, AiSchedule, AiScheduleHostRun, AiScheduleInput, AiScheduleSnapshot } from '../../../shared/aiSchedules'

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })
const input: AiScheduleInput = { name: '巡检', connectionId: 'host', prompt: '检查磁盘', intervalMinutes: 5, enabled: true }
function setup(initial: AiScheduleSnapshot = { plans: [], runs: [] }, notify?: ConstructorParameters<typeof AiScheduler>[0]['notify']) {
  vi.useFakeTimers()
  vi.setSystemTime(1000)
  const save = vi.fn()
  const execute = vi.fn(async (_plan: AiSchedule, _id: string, _signal: AbortSignal, _progress: (hosts: AiScheduleHostRun[]) => void) => ({ content: 'healthy' }))
  const service = new AiScheduler({ read: () => initial, save, execute, notify, changed: vi.fn(), timeoutMs: 10000 })
  return { service, save, execute }
}

it('validates schedules and does not run before their due time', async () => {
  const { service, execute } = setup()
  expect(() => service.save({ ...input, intervalMinutes: 0 })).toThrow()
  expect(() => service.save({ ...input, prompt: '' })).toThrow()
  service.save(input)
  service.start()
  await vi.advanceTimersByTimeAsync(299999)
  expect(execute).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(execute).toHaveBeenCalledOnce()
  expect(service.snapshot().runs[0]).toMatchObject({ status: 'completed', content: 'healthy' })
  service.dispose()
})

it.each(['running', 'cancelled'] as const)('recovers %s records interrupted by shutdown and runs overdue plans without catch-up bursts', async status => {
  const { service, execute } = setup({ plans: [{ ...input, id: 'p', createdAt: 1, updatedAt: 1, nextRunAt: -99999999 }],
    runs: [{ id: 'old', scheduleId: 'p', connectionId: 'host', name: '巡检', status, startedAt: 1 }] })
  expect(service.snapshot().runs[0].status).toBe('cancelled')
  expect(service.snapshot().runs[0].finishedAt).toBe(1000)
  service.start()
  await vi.advanceTimersByTimeAsync(90000)
  expect(execute).toHaveBeenCalledOnce()
  expect(service.snapshot().plans[0].nextRunAt).toBe(301000)
  service.dispose()
})

it('serializes execution and prevents changing records while a run is active', async () => {
  const { service, execute } = setup()
  let finish!: () => void
  execute.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ content: 'done' }) }))
  const plan = service.save(input)
  const running = service.runNow(plan.id)
  await expect(service.runNow(plan.id)).rejects.toThrow('已有巡检')
  expect(() => service.save({ ...input, name: 'another' })).toThrow('先中断')
  expect(() => service.remove(plan.id)).toThrow('先中断')
  service.tick()
  expect(execute).toHaveBeenCalledOnce()
  finish(); await running
  expect(service.snapshot().runs[0].status).toBe('completed')
})

it('pauses future runs and resets the due time on re-enable', async () => {
  const { service, execute } = setup()
  const plan = service.save(input)
  service.save({ ...plan, enabled: false })
  service.start()
  await vi.advanceTimersByTimeAsync(600000)
  expect(execute).not.toHaveBeenCalled()
  const resumed = service.save({ ...plan, enabled: true })
  expect(resumed.nextRunAt).toBe(Date.now() + 300000)
  service.dispose()
})

it('keeps daily execution anchored after immediate runs and recalculates when the time is edited', async () => {
  const { service } = setup()
  vi.setSystemTime(new Date(2026, 9, 13, 8))
  const plan = service.save({ ...input, timing: { kind: 'daily', time: '09:00' } })
  expect(plan.nextRunAt).toBe(new Date(2026, 9, 13, 9).getTime())
  await service.runNow(plan.id)
  expect(service.snapshot().plans[0].nextRunAt).toBe(plan.nextRunAt)
  const edited = service.save({ ...plan, timing: { kind: 'daily', time: '07:00' } })
  expect(edited.nextRunAt).toBe(new Date(2026, 9, 14, 7).getTime())
})

it('runs an overdue weekly plan once and advances to the next future calendar slot', async () => {
  const { service, execute } = setup()
  vi.setSystemTime(new Date(2026, 9, 13, 8))
  service.save({ ...input, timing: { kind: 'weekly', weekday: 2, time: '09:00' } })
  vi.setSystemTime(new Date(2026, 9, 27, 10))
  service.tick()
  await vi.advanceTimersByTimeAsync(0)
  expect(execute).toHaveBeenCalledOnce()
  expect(service.snapshot().plans[0].nextRunAt).toBe(new Date(2026, 10, 3, 9).getTime())
  service.tick()
  expect(execute).toHaveBeenCalledOnce()
})

it('recalculates calendar plans after a local timezone change without altering interval plans', () => {
  vi.stubEnv('TZ', 'UTC')
  const { service } = setup()
  vi.setSystemTime(new Date('2026-10-13T08:00:00Z'))
  const daily = service.save({ ...input, timing: { kind: 'daily', time: '09:00' } })
  const interval = service.save(input)
  vi.stubEnv('TZ', 'Asia/Shanghai')
  service.tick()
  expect(service.snapshot().plans.find(plan => plan.id === daily.id)?.nextRunAt).toBe(new Date(2026, 9, 14, 9).getTime())
  expect(service.snapshot().plans.find(plan => plan.id === interval.id)?.nextRunAt).toBe(interval.nextRunAt)
})

it('records provider failures and nonzero tool outcomes as failed while preserving the report', async () => {
  const { service, execute } = setup()
  const plan = service.save(input)
  execute.mockRejectedValueOnce(new Error('provider unavailable'))
  expect(await service.runNow(plan.id)).toMatchObject({ status: 'failed', error: 'provider unavailable' })
  execute.mockResolvedValueOnce({ content: 'inspect output', toolRuns: [{ id: 't', name: 'exec', args: '{}', content: '{"exitCode":2,"stdout":""}', status: 'done', isError: false }] } as any)
  expect(await service.runNow(plan.id)).toMatchObject({ status: 'failed', content: 'inspect output' })
})

it('cancels only the requested run and leaves its plan available', async () => {
  const { service, execute } = setup()
  execute.mockImplementationOnce((_plan, _id, signal) => new Promise((_resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }) }))
  const plan = service.save(input)
  const running = service.runNow(plan.id)
  service.stop('wrong-run')
  expect(service.snapshot().runs[0].status).toBe('running')
  service.stop(service.snapshot().runs[0].id)
  expect((await running).status).toBe('cancelled')
  expect(service.snapshot().plans).toHaveLength(1)
  expect((await service.runNow(plan.id)).status).toBe('completed')
})

it('bounds stalled execution with a timeout and records failure', async () => {
  const { service, execute } = setup()
  execute.mockImplementationOnce((_plan, _id, signal) => new Promise((_resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }) }))
  const plan = service.save(input)
  const running = service.runNow(plan.id)
  await vi.advanceTimersByTimeAsync(10000)
  expect(await running).toMatchObject({ status: 'failed', error: expect.stringContaining('超过') })
})

it('does not execute when claiming a run cannot be persisted', async () => {
  const { service, save, execute } = setup()
  const plan = service.save(input)
  save.mockImplementationOnce(() => { throw new Error('disk full') })
  await expect(service.runNow(plan.id)).rejects.toThrow('disk full')
  expect(execute).not.toHaveBeenCalled()
  expect(service.snapshot().runs).toHaveLength(0)
  expect(service.snapshot().plans[0].nextRunAt).toBe(plan.nextRunAt)
})

it('keeps inspection status independent of delivery failures and releases the execution slot', async () => {
  const notify = vi.fn(async () => ({ status: 'failed' as const, error: 'webhook offline' }))
  const { service } = setup(undefined, notify)
  const plan = service.save(input)
  expect((await service.runNow(plan.id)).status).toBe('completed')
  await vi.advanceTimersByTimeAsync(0)
  expect(service.snapshot().runs[0]).toMatchObject({ status: 'completed', notification: { status: 'failed', error: 'webhook offline' } })
  expect((await service.runNow(plan.id)).status).toBe('completed')
  expect(notify).toHaveBeenCalledTimes(2)
})

it('notifies timed-out failures with a fresh signal and never sends user cancellation', async () => {
  const notify = vi.fn(async (_plan, _run, signal) => { expect(signal.aborted).toBe(false); return { status: 'sent' as const } })
  const { service, execute } = setup(undefined, notify)
  const plan = service.save(input)
  const stalled = (_plan: unknown, _id: string, signal: AbortSignal) => new Promise<{content: string}>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  execute.mockImplementationOnce(stalled)
  const running = service.runNow(plan.id)
  await vi.advanceTimersByTimeAsync(10000)
  expect((await running).status).toBe('failed')
  expect(service.snapshot().runs[0].notification).toMatchObject({ status: 'sent' })
  execute.mockImplementationOnce(stalled)
  const cancelled = service.runNow(plan.id)
  service.stop(service.snapshot().runs[0].id)
  await cancelled
  expect(notify).toHaveBeenCalledOnce()
})

it('disposes timers and aborts in-flight work without writing after storage closes', async () => {
  const { service, save, execute } = setup()
  execute.mockImplementationOnce((_plan, _id, signal) => new Promise((_resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }) }))
  const plan = service.save(input)
  const running = service.runNow(plan.id)
  service.dispose()
  const count = save.mock.calls.length
  await running
  expect(save).toHaveBeenCalledTimes(count)
  expect(service.snapshot().runs[0].status).toBe('cancelled')
  await expect(service.runNow(plan.id)).rejects.toThrow('unavailable')
})

it('preserves the original interval slot after manual execution', async () => {
  const { service, execute } = setup()
  const plan = service.save(input)
  vi.setSystemTime(121000)
  await service.runNow(plan.id)
  expect(service.snapshot().plans[0].nextRunAt).toBe(301000)
  vi.setSystemTime(301000)
  service.tick()
  await vi.advanceTimersByTimeAsync(0)
  expect(execute).toHaveBeenCalledTimes(2)
  expect(service.snapshot().plans[0].nextRunAt).toBe(601000)
})

it('starts the next overdue plan as soon as the previous inspection finishes', async () => {
  const { service, execute } = setup()
  let finish!: () => void
  execute.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ content: 'done' }) }))
  const first = service.save(input)
  const second = service.save({ ...input, name: 'second' })
  vi.setSystemTime(301000)
  service.tick()
  expect(execute).toHaveBeenCalledOnce()
  finish()
  await vi.advanceTimersByTimeAsync(0)
  expect(execute.mock.calls.map(call => call[0].id)).toEqual([first.id, second.id])
  expect(service.snapshot().runs.every(run => run.status === 'completed')).toBe(true)
})

it('records progress storage errors at run level without blaming a host or starting SSH', async () => {
  const { service, save, execute } = setup()
  const hostExecute = vi.fn(async () => ({ content: 'done' }))
  execute.mockImplementationOnce((plan, id, signal, progress) => orchestrateInspection(plan, id, signal, {
    name: id => id, execute: hostExecute, summarize: async () => '', progress,
  }) as Promise<{content: string}>)
  const plan = service.save(input)
  // Claim and initial queued progress succeed; persisting running progress fails.
  save.mockImplementationOnce(() => {}).mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw new Error('disk full') })
  expect(await service.runNow(plan.id)).toMatchObject({ status: 'failed', error: 'disk full', hosts: [{ status: 'cancelled' }] })
  expect(hostExecute).not.toHaveBeenCalled()
})

it('drains inspections while notifications are pending and updates current records after editing', async () => {
  const deliveries: { id: string; finish: (value: AiRunNotification) => void }[] = []
  const notify = vi.fn((_plan, run, _signal) => new Promise<AiRunNotification>(resolve => { deliveries.push({ id: run.id, finish: resolve }) }))
  const { service, execute } = setup(undefined, notify)
  const first = service.save(input)
  service.save({ ...input, name: 'second' })
  vi.setSystemTime(301000)
  service.tick()
  await vi.advanceTimersByTimeAsync(0)
  expect(execute).toHaveBeenCalledTimes(2)
  expect(deliveries).toHaveLength(2)
  expect(service.snapshot().runs.every(run => run.notification?.status === 'sending')).toBe(true)
  service.save({ ...first, name: 'edited' })
  deliveries[0].finish({ status: 'sent' })
  await vi.advanceTimersByTimeAsync(0)
  expect(service.snapshot().runs.find(run => run.id === deliveries[0].id)?.notification?.status).toBe('sent')
  expect(service.snapshot().runs.find(run => run.id === deliveries[1].id)?.notification?.status).toBe('sending')
  service.remove(first.id)
  expect(service.snapshot().runs).toHaveLength(1)
  service.dispose()
})

it('does not resurrect deleted records when their notification finishes', async () => {
  let finish!: (value: AiRunNotification) => void
  const { service } = setup(undefined, () => new Promise(resolve => { finish = resolve }))
  const plan = service.save(input)
  expect(await service.runNow(plan.id)).toMatchObject({ status: 'completed', notification: { status: 'sending' } })
  service.remove(plan.id)
  finish({ status: 'sent' })
  await vi.advanceTimersByTimeAsync(0)
  expect(service.snapshot()).toEqual({ plans: [], runs: [] })
})

it('aborts independent notification delivery on shutdown without late storage writes', async () => {
  let finish!: (value: AiRunNotification) => void
  let signal!: AbortSignal
  const { service, save } = setup(undefined, (_plan, _run, pendingSignal) => new Promise(resolve => { signal = pendingSignal; finish = resolve }))
  const plan = service.save(input)
  await service.runNow(plan.id)
  service.dispose()
  const writes = save.mock.calls.length
  expect(signal.aborted).toBe(true)
  expect(service.snapshot().runs[0].notification?.status).toBe('failed')
  finish({ status: 'sent' })
  await vi.advanceTimersByTimeAsync(0)
  expect(save).toHaveBeenCalledTimes(writes)
  expect(service.snapshot().runs[0].notification?.status).toBe('failed')
})
