import { afterEach, expect, it, vi } from 'vitest'
import { AiBackgroundJobs, backgroundJobNotice, type AiJobOwner } from './backgroundJobs'
import type { SshMcpJobResult } from '../../shared/mcp/types'

afterEach(() => vi.useRealTimers())
const owner: AiJobOwner = { historyId: 'host', sessionId: 'ssh-a', threadId: 'thread-a', ownerId: 1 }
const job = (id: string, status: SshMcpJobResult['status'] = 'running'): SshMcpJobResult => ({ jobId: id, sessionId: 'ssh-a', command: 'sleep 5', status, startedAt: 1, stdout: status === 'running' ? undefined : 'done', exitCode: status === 'running' ? undefined : 0 })
function setup() {
  vi.useFakeTimers()
  const jobs = new Map<string, SshMcpJobResult>()
  const deliver = vi.fn<(_owner: AiJobOwner, _jobs: SshMcpJobResult[]) => Promise<void | boolean>>(async () => {})
  const busy = vi.fn(() => false)
  const available = vi.fn(() => true)
  const onError = vi.fn()
  const queue = new AiBackgroundJobs({ getJob: id => jobs.get(id), deliver, busy, available, onError })
  const start = (id: string) => { jobs.set(id, job(id)); queue.bind(owner, [id]) }
  return { jobs, deliver, busy, available, onError, queue, start }
}

it('coalesces completions, skips duplicates and never needs polling', async () => {
  const { start, queue, deliver } = setup()
  start('one'); start('two')
  queue.settled(job('one', 'completed')); queue.settled(job('two', 'failed')); queue.settled(job('one', 'completed'))
  await vi.advanceTimersByTimeAsync(100)
  expect(deliver).toHaveBeenCalledOnce()
  expect(deliver.mock.calls[0]).toEqual([owner, [job('one', 'completed'), job('two', 'failed')]])
})

it('queues while busy, then wakes on the reply-finished event', async () => {
  const { start, queue, deliver, busy } = setup()
  busy.mockReturnValue(true)
  start('one'); queue.settled(job('one', 'completed'))
  await vi.advanceTimersByTimeAsync(1000)
  expect(deliver).not.toHaveBeenCalled()
  busy.mockReturnValue(false); queue.flush()
  await vi.advanceTimersByTimeAsync(100)
  expect(deliver).toHaveBeenCalledOnce()
})

it('delivers a command that finished before its tool acknowledgement', async () => {
  const { jobs, queue, deliver } = setup()
  jobs.set('fast', job('fast', 'completed'))
  queue.bind(owner, ['fast'])
  await vi.advanceTimersByTimeAsync(100)
  expect(deliver).toHaveBeenCalledOnce()
})

it('suppresses both queued completions and late results before new-conversation cancellation', async () => {
  const { start, queue, deliver } = setup()
  start('queued'); start('late'); start('cancelled')
  queue.settled(job('queued', 'completed'))
  queue.suppress(owner.sessionId, owner.threadId, owner.ownerId)
  queue.settled(job('late', 'completed')); queue.settled(job('cancelled', 'cancelled'))
  await vi.advanceTimersByTimeAsync(100)
  expect(deliver).not.toHaveBeenCalled()
  expect(queue.canDeliver(owner)).toBe(false)
})

it('does not notify again when the model already collected the final result', async () => {
  const { start, queue, deliver } = setup()
  start('one'); queue.settled(job('one', 'completed')); queue.collected('one', owner)
  await vi.advanceTimersByTimeAsync(100)
  expect(deliver).not.toHaveBeenCalled()
})

it('does not consume another caller or conversation completion when collecting output', async () => {
  const { start, queue, deliver } = setup()
  start('one'); queue.settled(job('one', 'completed'))
  queue.collected('one', { ...owner, ownerId: 'automation:other' })
  queue.collected('one', { ...owner, threadId: 'other-thread' })
  await vi.advanceTimersByTimeAsync(100)
  expect(deliver).toHaveBeenCalledOnce()
})

it('keeps a non-current conversation queued until it becomes available', async () => {
  const { start, queue, deliver, available } = setup()
  available.mockReturnValue(false)
  start('one'); queue.settled(job('one', 'completed'))
  await vi.advanceTimersByTimeAsync(100)
  expect(deliver).not.toHaveBeenCalled()
  available.mockReturnValue(true); queue.flush()
  await vi.advanceTimersByTimeAsync(100)
  expect(deliver).toHaveBeenCalledOnce()
})

it('retains results when the user switches conversations during delivery preparation', async () => {
  const { start, queue, deliver } = setup()
  deliver.mockResolvedValueOnce(false)
  start('one'); queue.settled(job('one', 'completed'))
  await vi.advanceTimersByTimeAsync(1000)
  expect(deliver).toHaveBeenCalledOnce()
  queue.flush(); await vi.advanceTimersByTimeAsync(100)
  expect(deliver).toHaveBeenCalledTimes(2)
})

it('does not bind another SSH session or wake after renderer disposal', async () => {
  const { jobs, queue, deliver, start } = setup()
  jobs.set('other', { ...job('other', 'completed'), sessionId: 'ssh-b' })
  queue.bind(owner, ['other'])
  start('one'); queue.settled(job('one', 'completed'))
  queue.disposeOwner(owner.ownerId)
  await vi.advanceTimersByTimeAsync(100)
  expect(deliver).not.toHaveBeenCalled()
})

it('limits automatic chains and resets the budget on human input', async () => {
  const { start, queue, deliver } = setup()
  for (let i = 0; i < 4; i++) {
    start(String(i)); queue.settled(job(String(i), 'completed'))
    await vi.advanceTimersByTimeAsync(100)
  }
  expect(deliver).toHaveBeenCalledTimes(3)
  queue.resume(owner); queue.flush()
  await vi.advanceTimersByTimeAsync(100)
  expect(deliver).toHaveBeenCalledTimes(4)
})

it('keeps a failed delivery queued without an infinite retry loop', async () => {
  const { start, queue, deliver, onError } = setup()
  deliver.mockRejectedValueOnce(new Error('storage unavailable'))
  start('one'); queue.settled(job('one', 'completed'))
  await vi.advanceTimersByTimeAsync(10000)
  expect(deliver).toHaveBeenCalledOnce()
  expect(onError).toHaveBeenCalledOnce()
  queue.flush(); await vi.advanceTimersByTimeAsync(100)
  expect(deliver).toHaveBeenCalledTimes(2)
})

it('bounds escaped output while preserving valid structured results', () => {
  const notice = backgroundJobNotice(Array.from({ length: 32 }, (_, i) => ({ ...job(String(i), 'completed'), stdout: '\u0000'.repeat(50000), stderr: '\u0000'.repeat(5000) })))
  expect(notice.length).toBeLessThan(32000)
  const data = JSON.parse(notice.slice(notice.indexOf('\n') + 1))
  expect(data).toHaveLength(32)
  expect(data.every((row: { truncated: boolean }) => row.truncated)).toBe(true)
})
