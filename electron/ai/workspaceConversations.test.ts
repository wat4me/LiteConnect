import { beforeEach, expect, it, vi } from 'vitest'
import { listAiWorkspaceConversations } from './workspaceConversations'

const mocks = vi.hoisted(() => ({ getSingleton: vi.fn() }))
vi.mock('../store/appDatabase', () => ({
  aiSessionKey: (id: string) => `ai-session:${id}`,
  getAppDatabase: () => ({ getSingleton: mocks.getSingleton }),
}))

beforeEach(() => { mocks.getSingleton.mockReset() })

it('returns recent non-empty threads across hosts and prefers pinned updates', () => {
  mocks.getSingleton.mockImplementation((key: string) => {
    if (key.includes('a.example')) return {
      activeThreadId: 't1',
      threads: [
        { id: 't1', title: 'check disk', updatedAt: 10, messages: [{ id: 'm' }] },
        { id: 't0', title: 'old', updatedAt: 1, messages: [] },
      ],
    }
    if (key.includes('b.example')) return {
      activeThreadId: 'u1',
      threads: [{ id: 'u1', title: 'latency', customTitle: '网络延迟', pinned: true, updatedAt: 5, messages: [{}, {}] }],
    }
    return undefined
  })
  const items = listAiWorkspaceConversations([
    { id: 'a', name: 'A', host: 'a.example', port: 22 },
    { id: 'b', name: 'B', host: 'b.example', port: 22 },
  ], 8)
  expect(items.map(item => item.threadId)).toEqual(['u1', 't1'])
  expect(items[0]).toMatchObject({ connectionId: 'b', title: '网络延迟', pinned: true, messageCount: 2 })
  expect(items[1]).toMatchObject({ connectionId: 'a', title: 'check disk', active: true })
})
