import { expect, it, vi } from 'vitest'
import { AiWorkspaceConnections } from './workspaceConnections'
import { SSH_HOST_KEY_CONFIRMATION_REQUIRED } from '../../shared/sshHostKeyConfirmation'

function setup() {
  const notify = vi.fn()
  const disconnect = vi.fn()
  const cancel = vi.fn()
  const manager = new AiWorkspaceConnections({ hasSession: () => true, notify, disconnect, cancel })
  return { manager, notify, disconnect, cancel }
}

it('deduplicates opens and reuses only the same caller own AI session', async () => {
  const { manager } = setup()
  const start = vi.fn(async () => 'ai-session')
  expect(await Promise.all([manager.open(1, 'host', start), manager.open(1, 'host', start)])).toEqual(['ai-session', 'ai-session'])
  expect(await manager.open(1, 'host', start)).toBe('ai-session')
  expect(start).toHaveBeenCalledOnce()
  expect(await manager.open(2, 'host', async () => 'other-owner-session')).toBe('other-owner-session')
})

it('keeps host verification pending and routes its completion back to the AI caller', async () => {
  const { manager, notify } = setup()
  await expect(manager.open(1, 'host', async () => { throw new Error(SSH_HOST_KEY_CONFIRMATION_REQUIRED) })).rejects.toThrow(SSH_HOST_KEY_CONFIRMATION_REQUIRED)
  expect(manager.isPending(1, 'host')).toBe(true)
  expect(manager.complete(2, 'host', 'foreign-session')).toBe(false)
  expect(manager.complete(1, 'host', 'verified-session')).toBe(true)
  expect(notify).toHaveBeenCalledWith(1, { connectionId: 'host', sessionId: 'verified-session', status: 'connected' })
})

it('disconnects a late successful connection after cancellation instead of leaking a session', async () => {
  const { manager, disconnect, cancel } = setup()
  let finish!: (id: string) => void
  const promise = manager.open(1, 'host', () => new Promise<string>(resolve => { finish = resolve }))
  manager.cancel(1, 'host')
  finish('late-session')
  await expect(promise).rejects.toThrow('SSH_CONNECTION_CANCELLED')
  expect(cancel).toHaveBeenCalledWith(1, 'host')
  expect(disconnect).toHaveBeenCalledWith('late-session')
})

it('cannot close another caller session or a regular SSH terminal', async () => {
  const { manager, disconnect } = setup()
  await manager.open(1, 'host', async () => 'ai-session')
  expect(() => manager.close(2, 'ai-session')).toThrow('does not own')
  expect(() => manager.close(1, 'regular-terminal')).toThrow('does not own')
  expect(disconnect).not.toHaveBeenCalled()
  manager.close(1, 'ai-session')
  expect(disconnect).toHaveBeenCalledWith('ai-session')
})

it('releases sessions and connection attempts when the owner closes', async () => {
  const { manager, disconnect, cancel } = setup()
  await manager.open(1, 'connected', async () => 'ai-session')
  await expect(manager.open(1, 'pending', async () => { throw new Error(SSH_HOST_KEY_CONFIRMATION_REQUIRED) })).rejects.toThrow()
  manager.disposeOwner(1)
  expect(disconnect).toHaveBeenCalledWith('ai-session')
  expect(cancel).toHaveBeenCalledWith(1, 'pending')
})
