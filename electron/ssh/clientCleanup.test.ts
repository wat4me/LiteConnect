import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { Client, ClientChannel } from 'ssh2'
import { disposeSshChannel, disposeSshClient } from './clientCleanup'

class FakeSshClient extends EventEmitter {
  end = vi.fn()
  destroy = vi.fn()
}

describe('disposeSshClient', () => {
  it('removes application callbacks but absorbs a late handshake error', () => {
    const client = new FakeSshClient()
    const ready = vi.fn()
    client.on('ready', ready)

    disposeSshClient(client as unknown as Client)

    expect(client.listenerCount('ready')).toBe(0)
    expect(client.listenerCount('error')).toBe(1)
    expect(() => client.emit('error', new Error('Timed out while waiting for handshake'))).not.toThrow()
    expect(client.end).toHaveBeenCalledOnce()
    expect(client.destroy).toHaveBeenCalledOnce()
  })

  it('accepts an absent client', () => {
    expect(() => disposeSshClient(undefined)).not.toThrow()
  })

  it('absorbs late channel errors while closing a shell', () => {
    const channel = new FakeSshClient()
    const close = vi.fn()
    ;(channel as FakeSshClient & { close: typeof close }).close = close

    disposeSshChannel(channel as unknown as ClientChannel)

    expect(channel.listenerCount('error')).toBe(1)
    expect(() => channel.emit('error', new Error('Channel closed'))).not.toThrow()
    expect(close).toHaveBeenCalledOnce()
  })
})
