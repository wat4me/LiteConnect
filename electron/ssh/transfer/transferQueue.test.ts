import { describe, expect, it, vi } from 'vitest'
import { TransferQueue, type QueuedTransfer } from './transferQueue'

const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

function harness() {
  const started: string[] = []
  const resolvers = new Map<string, () => void>()
  const make = (sessionId: string, transferId: string): QueuedTransfer => ({
    sessionId,
    transferId,
    onDropped: vi.fn(),
    run: () =>
      new Promise<void>((resolve) => {
        started.push(transferId)
        resolvers.set(transferId, resolve)
      }),
  })
  const finish = async (transferId: string) => {
    resolvers.get(transferId)?.()
    await flush()
  }
  return { started, make, finish }
}

describe('TransferQueue', () => {
  it('runs at most `limit` transfers per session and keeps sessions independent', async () => {
    const { started, make, finish } = harness()
    const queue = new TransferQueue(() => 2)

    queue.enqueue(make('s1', 'a'))
    queue.enqueue(make('s1', 'b'))
    queue.enqueue(make('s1', 'c'))
    queue.enqueue(make('s2', 'd'))
    await flush()

    expect(started).toEqual(['a', 'b', 'd'])
    expect(queue.waitingCount('s1')).toBe(1)

    await finish('a')
    expect(started).toEqual(['a', 'b', 'd', 'c'])
    expect(queue.waitingCount('s1')).toBe(0)
    expect(queue.runningCount('s1')).toBe(2)

    await finish('b')
    await finish('c')
    await finish('d')
    expect(queue.runningCount('s1')).toBe(0)
    expect(queue.runningCount('s2')).toBe(0)
  })

  it('drops a waiting transfer on cancel and reports it, but leaves running ones to the runner', async () => {
    const { make, finish } = harness()
    const queue = new TransferQueue(() => 1)
    const a = make('s1', 'a')
    const b = make('s1', 'b')
    queue.enqueue(a)
    queue.enqueue(b)
    await flush()

    expect(queue.cancel('b')).toBe(true)
    expect(b.onDropped).toHaveBeenCalledTimes(1)
    expect(queue.cancel('a')).toBe(false)
    expect(a.onDropped).not.toHaveBeenCalled()
    expect(queue.cancel('missing')).toBe(false)

    await finish('a')
  })

  it('drops every waiting transfer of a torn-down session', async () => {
    const { started, make, finish } = harness()
    const queue = new TransferQueue(() => 1)
    const entries = ['a', 'b', 'c'].map((id) => make('s1', id))
    const other = make('s2', 'z')
    for (const entry of entries) queue.enqueue(entry)
    queue.enqueue(other)
    await flush()

    queue.cancelSession('s1')
    expect(entries[0].onDropped).not.toHaveBeenCalled()
    expect(entries[1].onDropped).toHaveBeenCalledTimes(1)
    expect(entries[2].onDropped).toHaveBeenCalledTimes(1)
    expect(other.onDropped).not.toHaveBeenCalled()
    expect(started).toEqual(['a', 'z'])

    await finish('a')
    await finish('z')
  })

  it('keeps pumping after a run rejects', async () => {
    const { started, make, finish } = harness()
    const queue = new TransferQueue(() => 1)
    queue.enqueue({
      sessionId: 's1',
      transferId: 'boom',
      onDropped: vi.fn(),
      run: () => Promise.reject(new Error('boom')),
    })
    queue.enqueue(make('s1', 'b'))
    await flush()

    expect(started).toEqual(['b'])
    await finish('b')
    expect(queue.runningCount('s1')).toBe(0)
  })
})
