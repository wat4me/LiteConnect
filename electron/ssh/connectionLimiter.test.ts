import { expect, it } from 'vitest'
import { ConnectionLimiter } from './connectionLimiter'

it('limits handshakes per endpoint while allowing another endpoint to proceed', async () => {
  const limiter = new ConnectionLimiter(2)
  const releases: Array<() => void> = []
  const start = () => new Promise<void>((resolve) => { releases.push(resolve) })
  const jobs = [limiter.run('a', undefined, start), limiter.run('a', undefined, start), limiter.run('a', undefined, start)]
  expect(releases).toHaveLength(2)
  await expect(limiter.run('b', undefined, async () => 'ready')).resolves.toBe('ready')
  releases[0]()
  await jobs[0]
  await Promise.resolve()
  expect(releases).toHaveLength(3)
  releases[1](); releases[2]()
  await Promise.all(jobs)
})

it('cancels a queued handshake without opening a connection or leaking a slot', async () => {
  const limiter = new ConnectionLimiter(1)
  let release!: () => void
  const active = limiter.run('a', undefined, () => new Promise<void>((resolve) => { release = resolve }))
  const abort = new AbortController()
  let started = false
  const queued = limiter.run('a', abort.signal, async () => { started = true })
  const result = expect(queued).rejects.toThrow('SSH_CONNECTION_CANCELLED')
  abort.abort()
  await result
  expect(started).toBe(false)
  release(); await active
  await expect(limiter.run('a', undefined, async () => 1)).resolves.toBe(1)
})
