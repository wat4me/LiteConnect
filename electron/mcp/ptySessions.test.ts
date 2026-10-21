import { PassThrough } from 'stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PtySessionStore } from './ptySessions'
import type { McpShellChannel } from '../ssh/types'

const SESSION_ID = '550e8400-e29b-41d4-a716-446655440000'

function fakeChannel(): McpShellChannel {
  const ch = new PassThrough() as PassThrough & McpShellChannel
  ch.setWindow = vi.fn()
  return ch
}

describe('PtySessionStore', () => {
  const stores: PtySessionStore[] = []
  afterEach(() => {
    for (const s of stores) s.dispose()
    stores.length = 0
  })

  function makeStore(channel = fakeChannel()) {
    const store = new PtySessionStore(async () => channel)
    stores.push(store)
    return { store, channel }
  }

  it('closes owned PTYs and rejects new opens after idempotent disposal', async () => {
    const { store, channel } = makeStore()
    const destroy = vi.spyOn(channel, 'destroy')
    await store.open({ sessionId: SESSION_ID, generation: 1 })
    store.dispose()
    store.dispose()
    expect(destroy).toHaveBeenCalledOnce()
    expect(store.list()).toEqual([])
    await expect(store.open({ sessionId: SESSION_ID, generation: 1 })).rejects.toMatchObject({ code: 'PTY_CLOSED' })
  })

  it('destroys a late channel without creating a PTY or idle timer', async () => {
    let resolve!: (value: McpShellChannel) => void
    const store = new PtySessionStore(() => new Promise(done => { resolve = done }))
    stores.push(store)
    const pending = store.open({ sessionId: SESSION_ID, generation: 1 })
    store.dispose()
    const channel = fakeChannel()
    const destroy = vi.spyOn(channel, 'destroy')
    resolve(channel)
    await expect(pending).rejects.toMatchObject({ code: 'PTY_CLOSED' })
    expect(destroy).toHaveBeenCalledOnce()
    expect(store.list()).toEqual([])
  })

  it('opens a PTY, writes CR, and streams output', async () => {
    const { store, channel } = makeStore()
    const opened = await store.open({ sessionId: SESSION_ID, generation: 1, cols: 80, rows: 24 })
    expect(opened.ptyId).toBeTruthy()

    channel.write('welcome\r\n$ ')
    await new Promise((r) => setImmediate(r))

    const first = await store.read(opened.ptyId, { mode: 'streaming' })
    expect(first.output).toContain('welcome')

    store.write(opened.ptyId, 'ls', false)
    const second = await store.read(opened.ptyId, { mode: 'streaming' })
    expect(second.output).toContain('ls')
  })

  it('renders a screen snapshot for the agent', async () => {
    const { store, channel } = makeStore()
    const opened = await store.open({ sessionId: SESSION_ID, generation: 1, cols: 40, rows: 8 })
    channel.write('Install nginx?\r\n  [Y]es  [N]o\r\n')
    await new Promise((r) => setTimeout(r, 30))
    const screen = await store.read(opened.ptyId, { mode: 'screen' })
    expect(screen.mode).toBe('screen')
    expect(screen.output).toMatch(/Install nginx/i)
    expect(screen.cursor).toBeTruthy()
  })

  it('enforces per-session PTY limit', async () => {
    const { store } = makeStore()
    await store.open({ sessionId: SESSION_ID, generation: 1 })
    await store.open({ sessionId: SESSION_ID, generation: 1 })
    await expect(store.open({ sessionId: SESSION_ID, generation: 1 })).rejects.toMatchObject({
      code: 'PTY_LIMIT',
    })
  })

  it('closes by id and by SSH session', async () => {
    const { store } = makeStore()
    const opened = await store.open({ sessionId: SESSION_ID, generation: 1 })
    expect(store.close(opened.ptyId)).toBe(true)
    expect(store.list()).toEqual([])
    const again = await store.open({ sessionId: SESSION_ID, generation: 1 })
    store.closeForSession(SESSION_ID)
    expect(store.list().some((p) => p.ptyId === again.ptyId)).toBe(false)
  })
})
