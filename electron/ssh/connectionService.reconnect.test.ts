import { describe, expect, it, vi } from 'vitest'
import { ConnectionService } from './connectionService'
import type { Connection, SSHCallbacks } from './types'

vi.mock('electron', () => ({
  app: { getPath: () => 'D:\\tmp\\LiteConnect-test-userdata' },
}))

vi.mock('../i18n', () => ({ t: (key: string) => key }))

describe('ConnectionService reconnect', () => {
  it('shares one in-flight attempt for duplicate requests on the same session', async () => {
    let finish!: (sessionId: string) => void
    const attempt = new Promise<string>((resolve) => { finish = resolve })
    const bumpSessionEpoch = vi.fn(() => 1)
    const cleanupSession = vi.fn()
    const service = new ConnectionService({
      sessions: new Map(),
      decoders: new Map(),
      knownHosts: {} as any,
      pendingHostKeys: new Map(),
      cleanupSession,
      bumpSessionEpoch,
      getSessionEpoch: () => 1,
    })
    const open = vi.fn(() => attempt)
    ;(service as any).connectWithSessionId = open
    const connection = { id: 'connection-1' } as Connection
    const callbacks = {} as SSHCallbacks

    const first = service.reconnect('session-1', connection, callbacks)
    const second = service.reconnect('session-1', connection, callbacks)
    expect(bumpSessionEpoch).toHaveBeenCalledTimes(1)
    expect(cleanupSession).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledTimes(1)

    finish('session-1')
    expect(await first).toBe('session-1')
    expect(await second).toBe('session-1')

    await service.reconnect('session-1', connection, callbacks)
    expect(bumpSessionEpoch).toHaveBeenCalledTimes(2)
  })
})
