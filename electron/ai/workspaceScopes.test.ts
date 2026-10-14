import { expect, it } from 'vitest'
import { randomUUID } from 'crypto'
import { AiWorkspaceScopes, workspaceHistoryId } from './workspaceScopes'
import type { AiWorkspaceScope, AiWorkspaceTarget } from '../../shared/aiWorkspace'

it('persists an immutable manual scope, restores it after reconnect, and isolates window ownership', () => {
  let saved: AiWorkspaceScope[] = []
  const a = randomUUID(), b = randomUUID(), c = randomUUID()
  const targets = new Map<string, AiWorkspaceTarget>([a, b, c].map(id => [id, {
    connectionId: id, sessionId: randomUUID(), name: id, host: 'example.test', port: 22, username: 'root',
  }]))
  const manager = new AiWorkspaceScopes({ read: () => saved, write: scopes => { saved = scopes }, resolve: (owner, id) => owner === 1 ? targets.get(id) : undefined })
  const input = { connectionIds: [a, b] }
  const scope = manager.open(1, input)
  input.connectionIds.push(c)
  expect(manager.targets(scope.id, 1)?.map(target => target.connectionId)).toEqual([a, b])
  expect(workspaceHistoryId(scope.id)).toMatch(/^workspace-v1:/)
  expect(() => manager.targets(scope.id, 2)).toThrow('not open')
  expect(() => manager.open(2, { id: scope.id })).toThrow('Connect every selected')
  manager.disposeOwner(1)
  expect(() => manager.targets(scope.id, 1)).toThrow('not open')
  const newSession = randomUUID()
  targets.get(a)!.sessionId = newSession
  const restored = manager.open(1, { id: scope.id, connectionIds: [c] })
  expect(restored).toEqual(scope)
  expect(manager.targets(scope.id, 1)?.[0].sessionId).toBe(newSession)
  targets.delete(b)
  expect(() => manager.targets(scope.id, 1)).toThrow('disconnected')
  expect(manager.targets(randomUUID(), 1)).toBeUndefined()
})

it('rejects empty, duplicate, excessive, invalid and partially connected scopes', () => {
  const id = randomUUID()
  const manager = new AiWorkspaceScopes({ read: () => [], write: () => {}, resolve: () => undefined })
  for (const ids of [[], [id, id], ['not-a-connection'], Array.from({ length: 21 }, () => randomUUID())]) {
    expect(() => manager.open(1, { connectionIds: ids })).toThrow('Invalid AI workspace scope')
  }
  expect(() => manager.open(1, { connectionIds: [id] })).toThrow('Connect every selected')
  expect(() => manager.open(1, { id: 'workspace:missing' })).toThrow('no longer exists')
})
