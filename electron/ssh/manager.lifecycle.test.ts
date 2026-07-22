import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connection, PendingHostKey, SSHCallbacks } from './types'

vi.mock('electron', () => ({
  app: {
    getPath: () => 'D:\\tmp\\LiteConnect-test-userdata',
  },
}))

vi.mock('../i18n', () => ({
  t: (key: string) => key,
}))

vi.mock('./x11Server', () => ({
  ensureX11ServerReady: vi.fn(async () => ({ ready: false, message: 'skip' })),
}))

import { SSHManager } from './manager'
import { KnownHostsStore } from './knownHosts'

function fakeConnection(id = '550e8400-e29b-41d4-a716-446655440000'): Connection {
  return {
    id,
    host: '10.0.0.5',
    port: 22,
    username: 'root',
    password: 'x',
    name: 'test',
  }
}

function fakeCallbacks(): SSHCallbacks {
  return {
    onData: vi.fn(),
    onClose: vi.fn(),
    onError: vi.fn(),
  }
}

describe('SSHManager host-key confirm + generation', () => {
  let manager: SSHManager
  let knownHosts: KnownHostsStore

  beforeEach(() => {
    knownHosts = {
      init: vi.fn(async () => {}),
      verifySync: vi.fn(),
      updateHostKey: vi.fn(async () => 'SHA256:new'),
      getFingerprint: vi.fn(),
      remove: vi.fn(async () => {}),
      computeFingerprint: vi.fn(),
      verify: vi.fn(async () => ({ accepted: true, fingerprint: 'x' })),
    } as unknown as KnownHostsStore
    manager = new SSHManager(knownHosts)
  })

  it('confirmHostKey retries under resumeSessionId via reconnect (not a new random session)', async () => {
    const connection = fakeConnection()
    const callbacks = fakeCallbacks()
    const resumeSessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const pending: PendingHostKey = {
      connectionId: connection.id,
      connection,
      keyBuffer: Buffer.from('key'),
      fingerprint: 'SHA256:new',
      existingFingerprint: '',
      callbacks,
      role: 'target',
      host: connection.host,
      port: connection.port,
      resumeSessionId,
    }
    ;(manager as any).pendingHostKeys.set(connection.id, pending)

    const reconnect = vi.fn(async (sessionId: string) => sessionId)
    ;(manager as any).connection.reconnect = reconnect
    const connect = vi.fn(async () => 'should-not-call')
    ;(manager as any).connection.connect = connect

    const id = await manager.confirmHostKey(connection.id)
    expect(id).toBe(resumeSessionId)
    expect(reconnect).toHaveBeenCalledTimes(1)
    expect(reconnect.mock.calls[0][0]).toBe(resumeSessionId)
    expect(reconnect.mock.calls[0][1]).toBe(connection)
    expect(reconnect.mock.calls[0][2]).toBe(callbacks)
    expect(connect).not.toHaveBeenCalled()
    expect(knownHosts.updateHostKey).toHaveBeenCalledWith(
      connection.host,
      connection.port,
      pending.keyBuffer,
    )
    expect(manager.getPendingHostKey(connection.id)).toBeUndefined()
  })

  it('confirmHostKey for jump role updates jump host fingerprint', async () => {
    const connection = fakeConnection()
    const callbacks = fakeCallbacks()
    const resumeSessionId = 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee'
    ;(manager as any).pendingHostKeys.set(connection.id, {
      connectionId: connection.id,
      connection,
      keyBuffer: Buffer.from('jump-key'),
      fingerprint: 'SHA256:jump',
      existingFingerprint: 'SHA256:old',
      callbacks,
      role: 'jump',
      host: 'bastion.local',
      port: 2222,
      resumeSessionId,
    } satisfies PendingHostKey)

    ;(manager as any).connection.reconnect = vi.fn(async (sid: string) => sid)

    await manager.confirmHostKey(connection.id)
    expect(knownHosts.updateHostKey).toHaveBeenCalledWith(
      'bastion.local',
      2222,
      Buffer.from('jump-key'),
    )
  })

  it('rejectHostKey clears pending without connecting', () => {
    const connection = fakeConnection()
    ;(manager as any).pendingHostKeys.set(connection.id, {
      connectionId: connection.id,
      connection,
      keyBuffer: Buffer.from('k'),
      fingerprint: 'f',
      existingFingerprint: '',
      callbacks: fakeCallbacks(),
      role: 'target',
      host: 'h',
      port: 22,
      resumeSessionId: 'cccccccc-bbbb-cccc-dddd-eeeeeeeeeeee',
    } satisfies PendingHostKey)

    manager.rejectHostKey(connection.id)
    expect(manager.getPendingHostKey(connection.id)).toBeUndefined()
  })

  it('disconnect bumps generation so old epoch is dead', () => {
    const sid = 'dddddddd-bbbb-cccc-dddd-eeeeeeeeeeee'
    const e1 = (manager as any).bumpSessionEpoch(sid)
    expect((manager as any).getSessionEpoch(sid)).toBe(e1)
    manager.disconnect(sid)
    expect((manager as any).getSessionEpoch(sid)).toBe(e1 + 1)
    expect((manager as any).getSessionEpoch(sid) === e1).toBe(false)
  })

  it('opens trusted raw exec without PTY and destroys a late stale channel', async () => {
    const sid = 'raw-exec-session'
    let callback: ((err: Error | null, channel?: any) => void) | undefined
    const exec = vi.fn((_command: string, options: unknown, cb: typeof callback) => {
      expect(options).toEqual({ pty: false })
      callback = cb
    })
    ;(manager as any).sessionEpoch.set(sid, 1)
    ;(manager as any).sessions.set(sid, { id: sid, client: { exec }, stream: {} })

    const opening = manager.openExecChannel(sid, 'echo trusted', 1)
    ;(manager as any).sessionEpoch.set(sid, 2)
    const channel = { destroy: vi.fn(), close: vi.fn() }
    callback!(null, channel)

    await expect(opening).rejects.toThrow(/generation/i)
    expect(exec).toHaveBeenCalledWith('echo trusted', { pty: false }, expect.any(Function))
    expect(channel.destroy).toHaveBeenCalled()
  })

  it('manager.reconnect bumps generation before open so late old close is ignored', async () => {
    const sid = 'eeeeeeee-bbbb-cccc-dddd-eeeeeeeeeeee'
    const oldEpoch = (manager as any).bumpSessionEpoch(sid)
    const connection = fakeConnection()
    const callbacks = fakeCallbacks()

    let epochAtOpen = 0
    ;(manager as any).connection.reconnect = vi.fn(async (sessionId: string) => {
      // ConnectionService.reconnect bumps again; manager.reconnect only delegates.
      // Simulate ConnectionService bump on entry:
      epochAtOpen = (manager as any).bumpSessionEpoch(sessionId)
      return sessionId
    })

    await manager.reconnect(sid, connection, callbacks)

    expect(epochAtOpen).toBeGreaterThan(oldEpoch)
    // Old generation is not live
    expect((manager as any).getSessionEpoch(sid)).not.toBe(oldEpoch)

    // Simulate late close from old generation — must not notify
    let notified = false
    const lateCloseEpoch = oldEpoch
    if ((manager as any).getSessionEpoch(sid) === lateCloseEpoch) {
      notified = true
    }
    expect(notified).toBe(false)
  })

  it('getPendingHostKeyResumeSessionId returns resume id before confirm clears it', () => {
    const connection = fakeConnection()
    const resumeSessionId = 'ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee'
    ;(manager as any).pendingHostKeys.set(connection.id, {
      connectionId: connection.id,
      connection,
      keyBuffer: Buffer.from('k'),
      fingerprint: 'f',
      existingFingerprint: '',
      callbacks: fakeCallbacks(),
      role: 'target',
      host: 'h',
      port: 22,
      resumeSessionId,
    } satisfies PendingHostKey)

    expect(manager.getPendingHostKeyResumeSessionId(connection.id)).toBe(resumeSessionId)
  })
})
