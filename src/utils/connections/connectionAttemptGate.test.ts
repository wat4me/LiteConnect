import { describe, expect, it, vi } from 'vitest'
import { createConnectionAttemptGate } from './connectionAttemptGate'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('createConnectionAttemptGate', () => {
  it('deduplicates repeated attempts for the same connection', async () => {
    const gate = createConnectionAttemptGate<string | null>()
    const pending = deferred<string | null>()
    const start = vi.fn(() => pending.promise)
    const onPendingChange = vi.fn()

    const first = gate.run('conn-1', start, onPendingChange)
    const second = gate.run('conn-1', start, onPendingChange)

    expect(second).toBe(first)
    expect(gate.isPending('conn-1')).toBe(true)
    expect(onPendingChange).toHaveBeenCalledTimes(1)
    expect(onPendingChange).toHaveBeenLastCalledWith('conn-1', true)
    await Promise.resolve()
    expect(start).toHaveBeenCalledTimes(1)

    pending.resolve('session-1')
    await expect(first).resolves.toBe('session-1')
    expect(gate.isPending('conn-1')).toBe(false)
    expect(onPendingChange).toHaveBeenLastCalledWith('conn-1', false)
  })

  it('allows different connections to start in parallel', async () => {
    const gate = createConnectionAttemptGate<string>()
    const first = deferred<string>()
    const second = deferred<string>()

    const firstAttempt = gate.run('conn-1', () => first.promise)
    const secondAttempt = gate.run('conn-2', () => second.promise)

    expect(gate.isPending('conn-1')).toBe(true)
    expect(gate.isPending('conn-2')).toBe(true)
    first.resolve('session-1')
    second.resolve('session-2')
    await expect(Promise.all([firstAttempt, secondAttempt])).resolves.toEqual([
      'session-1',
      'session-2',
    ])
  })

  it('allows retry after a failed attempt', async () => {
    const gate = createConnectionAttemptGate<string>()
    await expect(gate.run('conn-1', () => Promise.reject(new Error('offline')))).rejects.toThrow(
      'offline',
    )
    expect(gate.isPending('conn-1')).toBe(false)
    await expect(gate.run('conn-1', () => Promise.resolve('session-2'))).resolves.toBe('session-2')
  })
})
