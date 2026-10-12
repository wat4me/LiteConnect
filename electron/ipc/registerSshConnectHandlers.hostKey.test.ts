import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SSHManager } from '../ssh/manager'
import type { SettingsStore } from '../store/settingsStore'
import type { CredentialStore } from '../store/credentialStore'
import type { KnownHostsStore } from '../ssh/trust/knownHosts'
import { SSH_HOST_KEY_CONFIRMATION_REQUIRED } from '../../shared/sshHostKeyConfirmation'
import { SSH_CONNECTION_CANCELLED } from '../../shared/sshConnectionProgress'

const handlers = new Map<string, (...args: any[]) => any>()
vi.mock('electron', () => ({ ipcMain: { handle: (key: string, fn: (...args: any[]) => any) => handlers.set(key, fn), on: vi.fn() } }))
vi.mock('../window/windowRegistry', () => ({ broadcast: vi.fn(), clearSessionOwner: vi.fn(), getSessionsOwnedBy: vi.fn(), setSessionOwner: vi.fn() }))
import { registerSshConnectHandlers } from './registerSshConnectHandlers'
import { setSessionOwner } from '../window/windowRegistry'

const cid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
const sid = 'b1b2c3d4-e5f6-7890-abcd-ef1234567890'
const pending = { host: 'target.test', port: 22, fingerprint: 'SHA256:new', existingFingerprint: '', role: 'target', connection: { id: cid, name: 'Server' }, callbacks: {} }

function setup() {
  const sender = { id: 1, isDestroyed: () => false, send: vi.fn() }
  const manager = {
    connect: vi.fn().mockRejectedValue(new Error('Host denied')),
    reconnect: vi.fn().mockRejectedValue(new Error('Host denied')),
    confirmHostKey: vi.fn().mockRejectedValue(new Error('Host denied')),
    getPendingHostKey: vi.fn().mockReturnValue(pending),
    getPendingHostKeyResumeSessionId: vi.fn().mockReturnValue(sid),
    hasSession: vi.fn().mockReturnValue(false),
    getSessionSnapshot: vi.fn(),
    rejectHostKey: vi.fn(),
    disconnect: vi.fn(),
  }
  const connected = vi.fn()
  registerSshConnectHandlers(() => null, manager as unknown as SSHManager, {} as SettingsStore,
    { init: vi.fn(), getConnectionForAuth: () => ({ id: cid, host: pending.host }) } as unknown as CredentialStore,
    { init: vi.fn() } as unknown as KnownHostsStore, undefined, connected)
  return { manager, sender, connected }
}

describe('SSH host-key confirmation IPC', () => {
  beforeEach(() => { handlers.clear(); vi.clearAllMocks() })

  it.each(['ssh:connect', 'ssh:reconnect', 'ssh:confirmHostKey'])('signals pending trust for %s without claiming a connected session', async (channel) => {
    const { sender, connected, manager } = setup()
    if (channel === 'ssh:confirmHostKey') {
      manager.getPendingHostKey.mockReturnValueOnce({ ...pending, host: 'jump.test', role: 'jump' })
    }
    const args = channel === 'ssh:reconnect' ? [sid, cid] : [cid]
    await expect(handlers.get(channel)!({ sender }, ...args)).rejects.toThrow(SSH_HOST_KEY_CONFIRMATION_REQUIRED)
    expect(sender.send).toHaveBeenCalledWith('ssh:hostKeyMismatch', {
      connectionId: cid, host: pending.host, port: 22, existingFingerprint: '', newFingerprint: pending.fingerprint, role: 'target',
    })
    expect(connected).not.toHaveBeenCalled()
    expect(setSessionOwner).not.toHaveBeenCalled()
  })

  it('preserves genuine failures when no trust confirmation is pending', async () => {
    const { manager, sender } = setup()
    manager.getPendingHostKey.mockReturnValue(undefined)
    manager.connect.mockRejectedValueOnce(new Error('Authentication failed'))
    await expect(handlers.get('ssh:connect')!({ sender }, cid)).rejects.toThrow('Authentication failed')
    expect(sender.send).not.toHaveBeenCalledWith('ssh:hostKeyMismatch', expect.anything())
  })

  it('returns and registers the session after successful trust confirmation', async () => {
    const { manager, sender, connected } = setup()
    manager.confirmHostKey.mockResolvedValueOnce(sid)
    await expect(handlers.get('ssh:confirmHostKey')!({ sender }, cid)).resolves.toBe(sid)
    expect(connected).toHaveBeenCalledWith(cid, sid)
    expect(setSessionOwner).toHaveBeenCalledWith(sid, sender.id)
    expect(sender.send).not.toHaveBeenCalledWith('ssh:hostKeyMismatch', expect.anything())
  })

  it('reports failure to save trust instead of repeatedly asking to trust the same key', async () => {
    const { manager, sender } = setup()
    manager.confirmHostKey.mockRejectedValueOnce(new Error('Unable to save known hosts'))
    await expect(handlers.get('ssh:confirmHostKey')!({ sender }, cid)).rejects.toThrow('Unable to save known hosts')
    expect(sender.send).not.toHaveBeenCalledWith('ssh:hostKeyMismatch', expect.anything())
  })

  it('cancels before initialization finishes without opening SSH', async () => {
    const { manager, sender } = setup()
    manager.getPendingHostKey.mockReturnValue(undefined)
    const connecting = handlers.get('ssh:connect')!({ sender }, cid)
    const result = expect(connecting).rejects.toThrow(SSH_CONNECTION_CANCELLED)
    await handlers.get('ssh:cancelConnect')!({ sender }, cid)
    await result
    expect(manager.connect).not.toHaveBeenCalled()
  })

  it('aborts a running connection and refuses a late successful result', async () => {
    const { manager, sender, connected } = setup()
    manager.getPendingHostKey.mockReturnValue(undefined)
    let resolve!: (id: string) => void
    manager.connect.mockImplementationOnce(() => new Promise<string>((accept) => { resolve = accept }))
    const connecting = handlers.get('ssh:connect')!({ sender }, cid)
    const result = expect(connecting).rejects.toThrow(SSH_CONNECTION_CANCELLED)
    await vi.waitFor(() => expect(manager.connect).toHaveBeenCalled())
    const callbacks = manager.connect.mock.calls[0][1]
    await handlers.get('ssh:cancelConnect')!({ sender }, cid)
    expect(callbacks.signal.aborted).toBe(true)
    resolve(sid)
    await result
    expect(manager.disconnect).toHaveBeenCalledWith(sid)
    expect(connected).not.toHaveBeenCalled()
  })

  it('closing a terminal cancels its pending reconnect', async () => {
    const { manager, sender } = setup()
    manager.getPendingHostKey.mockReturnValue(undefined)
    manager.reconnect.mockImplementationOnce((_id, _connection, callbacks) => new Promise((_resolve, reject) => {
      callbacks.signal.addEventListener('abort', () => reject(new Error(SSH_CONNECTION_CANCELLED)))
    }))
    const result = handlers.get('ssh:reconnect')!({ sender }, sid, cid)
    const rejection = expect(result).rejects.toThrow(SSH_CONNECTION_CANCELLED)
    await vi.waitFor(() => expect(manager.reconnect).toHaveBeenCalled())
    handlers.get('ssh:disconnect')!({ sender }, sid)
    await rejection
    expect(manager.disconnect).toHaveBeenCalledWith(sid)
  })
})
