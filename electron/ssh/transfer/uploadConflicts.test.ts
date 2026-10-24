import { TransferCancelledError } from '../../../shared/transferCancellation'
import { describe, expect, it, vi } from 'vitest'
import { UploadConflicts } from './uploadConflicts'

const owner = (id = 1) => ({ id, isDestroyed: () => false, send: vi.fn() })
const prompt = (o: ReturnType<typeof owner>) => o.send.mock.calls.filter(call => call[1]).at(-1)![1] as { requestId: string }

describe('upload conflicts', () => {
  it('serializes prompts, applies a decision to queued and later conflicts in the same batch only', async () => {
    const coordinator = new UploadConflicts(vi.fn())
    const window = owner()
    const first = coordinator.register(window, 'ssh', 'one', 'drop', 2)
    const second = coordinator.register(window, 'ssh', 'two', 'drop', 2)
    const a = first.ask('a', '/a')
    const b = second.ask('b', '/b')
    expect(window.send).toHaveBeenCalledTimes(1)
    // Other windows cannot answer or forge a decision for this one.
    coordinator.respond(99, prompt(window).requestId, { action: 'overwrite', applyToAll: true })
    expect(window.send).toHaveBeenCalledTimes(1)
    coordinator.respond(1, prompt(window).requestId, { action: 'rename', applyToAll: true })
    expect(await a).toBe('rename')
    expect(await b).toBe('rename')
    expect(await first.ask('c', '/c')).toBe('rename')
    first.dispose(); second.dispose()
    const next = coordinator.register(window, 'ssh', 'three', 'next-drop')
    const c = next.ask('d', '/d')
    coordinator.respond(1, prompt(window).requestId, { action: 'skip', applyToAll: false })
    expect(await c).toBe('skip')
    next.dispose()
  })

  it('prompts again when apply-to-all is unchecked; isolates windows and sessions with the same batch id', async () => {
    const coordinator = new UploadConflicts(vi.fn())
    const one = owner(), two = owner(2)
    const a = coordinator.register(one, 'ssh', 'a', 'batch')
    const b = coordinator.register(two, 'ssh', 'b', 'batch')
    const c = coordinator.register(one, 'other-ssh', 'c', 'batch')
    const pa = a.ask('a', '/a'), pb = b.ask('b', '/b'), pc = c.ask('c', '/c')
    expect(two.send).toHaveBeenCalledTimes(1)
    coordinator.respond(1, prompt(one).requestId, { action: 'overwrite', applyToAll: false })
    expect(await pa).toBe('overwrite')
    coordinator.respond(1, prompt(one).requestId, { action: 'skip', applyToAll: true })
    expect(await pc).toBe('skip')
    coordinator.respond(2, prompt(two).requestId, { action: 'rename', applyToAll: true })
    expect(await pb).toBe('rename')
    const again = a.ask('again', '/again')
    coordinator.respond(1, prompt(one).requestId, { action: 'skip', applyToAll: false })
    expect(await again).toBe('skip')
    a.dispose(); b.dispose(); c.dispose()
  })

  it('cancels the whole batch, wakes displayed/queued requests and cancels underlying runs', async () => {
    const cancel = vi.fn()
    const coordinator = new UploadConflicts(cancel)
    const window = owner()
    const a = coordinator.register(window, 'ssh', 'a', 'batch', 2)
    const b = coordinator.register(window, 'ssh', 'b', 'batch', 2)
    const results = Promise.allSettled([a.ask('a', '/a'), b.ask('b', '/b')])
    coordinator.respond(1, prompt(window).requestId, { action: 'cancel', applyToAll: false })
    expect((await results).every(result => result.status === 'rejected' && result.reason instanceof TransferCancelledError)).toBe(true)
    expect(cancel.mock.calls).toEqual([['a'], ['b']])
    expect(a.isCancelled()).toBe(true)
    expect(window.send.mock.calls.at(-1)).toEqual(['sftp:uploadConflict', null])
    a.dispose(); b.dispose()
  })

  it('clears pending dialogs on abort, transfer/session cancel and window destruction', async () => {
    for (const mode of ['abort', 'transfer', 'session', 'owner']) {
      const cancel = vi.fn()
      const coordinator = new UploadConflicts(cancel)
      const window = owner()
      const context = coordinator.register(window, 'ssh', 'a')
      const abort = new AbortController()
      const result = context.ask('a', '/a', undefined, abort.signal).catch(error => error)
      if (mode === 'abort') abort.abort()
      if (mode === 'transfer') coordinator.cancelTransfer('a')
      if (mode === 'session') coordinator.cancelSession('ssh')
      if (mode === 'owner') coordinator.cancelOwner(1)
      expect(await result).toBeInstanceOf(TransferCancelledError)
      expect(window.send.mock.calls.at(-1)).toEqual(['sftp:uploadConflict', null])
      context.dispose()
    }
  })
})
