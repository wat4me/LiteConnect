import { EventEmitter } from 'events'
import { describe, expect, it, vi } from 'vitest'
import { attachX11Forwarding } from './x11'
import type { SSHCallbacks } from '../types'

vi.mock('../../i18n', () => ({ t: (key: string) => key }))

describe('X11 forwarding errors', () => {
  it('reports an X11 channel failure without marking the SSH session as failed', () => {
    const client = new EventEmitter()
    const callbacks = {
      onData: vi.fn(),
      onError: vi.fn(),
    } as unknown as SSHCallbacks
    const reject = vi.fn()
    attachX11Forwarding(
      client as any,
      'session-1',
      { x11Forwarding: true } as any,
      callbacks,
      new Set(),
    )

    client.emit('x11', {}, () => { throw new Error('channel rejected') }, reject)

    expect(reject).toHaveBeenCalledOnce()
    expect(callbacks.onData).toHaveBeenCalledWith('session-1', expect.stringContaining('x11.channelFailed'))
    expect(callbacks.onError).not.toHaveBeenCalled()
  })
})
