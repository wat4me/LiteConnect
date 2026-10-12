import { Writable } from 'stream'
import { beforeEach, expect, it, vi } from 'vitest'
const io = vi.hoisted(() => ({ mkdir: vi.fn(), create: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: () => '/test' } }))
vi.mock('fs', () => ({ createWriteStream: io.create }))
vi.mock('fs/promises', () => ({ mkdir: io.mkdir }))
import { SessionLogManager } from './sessionLog'
const meta = { host: 'server', port: 22 }
beforeEach(() => { vi.resetAllMocks(); io.mkdir.mockResolvedValue(undefined) })

it('handles asynchronous write errors and stops logging this session', async () => {
  const stream = new Writable({ write(_chunk, _encoding, callback) { callback() } })
  io.create.mockReturnValue(stream)
  const log = new SessionLogManager('/test')
  log.append('s1', meta, 'hello')
  await vi.waitFor(() => expect(io.create).toHaveBeenCalled())
  expect(() => stream.emit('error', new Error('Disk full'))).not.toThrow()
  log.append('s1', meta, 'ignored')
  expect(stream.destroyed).toBe(true)
  expect(io.create).toHaveBeenCalledTimes(1)
})

it('does not open a log after the session ends during directory creation', async () => {
  let ready!: () => void
  io.mkdir.mockReturnValue(new Promise<void>((resolve) => { ready = resolve }))
  const log = new SessionLogManager('/test')
  log.append('s1', meta, 'hello')
  log.endSession('s1')
  ready()
  await Promise.resolve()
  expect(io.create).not.toHaveBeenCalled()
})

it('waits for drain and preserves queued output before closing', async () => {
  const writes: string[] = []
  const callbacks: Array<() => void> = []
  const stream = new Writable({ highWaterMark: 1, write(chunk, _encoding, callback) {
    writes.push(String(chunk)); callbacks.push(callback)
  } })
  io.create.mockReturnValue(stream)
  const log = new SessionLogManager('/test')
  log.append('s1', meta, 'first')
  await vi.waitFor(() => expect(writes).toEqual(['first']))
  log.append('s1', meta, 'second')
  log.endSession('s1')
  expect(writes).toEqual(['first'])
  callbacks.shift()!()
  await vi.waitFor(() => expect(writes).toEqual(['first', 'second']))
  callbacks.shift()!()
  await vi.waitFor(() => expect(stream.writableFinished).toBe(true))
})

it('bounds memory when the disk stops draining', async () => {
  const stream = new Writable({ highWaterMark: 1, write() {} })
  io.create.mockReturnValue(stream)
  const log = new SessionLogManager('/test')
  log.append('s1', meta, 'first')
  await vi.waitFor(() => expect(io.create).toHaveBeenCalled())
  for (let i = 0; i < 20; i++) log.append('s1', meta, 'x'.repeat(128 * 1024))
  expect(stream.destroyed).toBe(true)
  log.endAll()
})
