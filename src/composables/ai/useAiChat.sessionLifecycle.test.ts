import { afterEach, expect, it, vi } from 'vitest'
import type { AiSessionStore } from '@shared/types/ai'
import { disposeAiSessionState, useAiChat } from './useAiChat'

vi.mock('../../i18n', () => ({ t: (key: string) => key }))
vi.mock('element-plus/es/components/message/index', () => ({ ElMessage: { warning: vi.fn(), error: vi.fn() } }))

const sessions = ['lifecycle-a', 'lifecycle-b', 'lifecycle-direct']
afterEach(() => {
  sessions.forEach(disposeAiSessionState)
  vi.unstubAllGlobals()
})

function setup() {
  let store: AiSessionStore = {
    version: 1, activeThreadId: 'old', defaultContextFiles: [],
    threads: [{ id: 'old', title: 'old conversation', createdAt: 1, updatedAt: 1, contextFiles: [],
      messages: [{ id: 'old-message', role: 'user', content: 'old question', createdAt: 1 }],
      compactionCount: 4 }],
  }
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
  let nextId = 0
  const create = vi.fn(async () => {
    const id = `fresh-${++nextId}`
    store.threads = store.threads.filter(thread => thread.messages.length > 0)
    store.threads.push({ id, title: '', createdAt: 2, updatedAt: 2, contextFiles: [], messages: [] })
    store.activeThreadId = id
    return clone(store)
  })
  const stream = vi.fn(async () => ({ content: 'new reply' }))
  const append = vi.fn(async () => {})
  vi.stubGlobal('window', { LiteConnect: {
    aiCreateConversation: create,
    getAiSessionStore: async () => clone(store),
    setAiSessionStore: async (_id: string, value: AiSessionStore) => { store = clone(value) },
    appendAiSessionHistory: append,
    onAiChatStream: () => () => {}, aiChatStream: stream,
  } })
  return { create, stream, append, store: () => store, chat: useAiChat() }
}

it('starts each SSH window blank, initializes once and retains shared host history', async () => {
  const { chat, create, store } = setup()
  const firstLoads = await Promise.all([chat.loadHistory('lifecycle-a'), chat.loadHistory('lifecycle-a')])
  expect(firstLoads).toEqual([[], []])
  expect(create).toHaveBeenCalledTimes(1)
  const a = chat.getSessionState('lifecycle-a')
  const aThread = a.activeThreadId
  expect(a.compactionCount).toBe(0)
  expect(a.threads.some(thread => thread.id === 'old')).toBe(true)
  a.input = 'unsent draft'
  await chat.loadHistory('lifecycle-b')
  expect(chat.getSessionState('lifecycle-b').activeThreadId).not.toBe(aThread)
  // B pruned A's empty draft from disk. Reopening A must preserve its identity.
  expect(store().threads.some(thread => thread.id === aThread)).toBe(false)
  expect(await chat.loadHistory('lifecycle-a')).toEqual([])
  expect(a.activeThreadId).toBe(aThread)
  expect(a.input).toBe('unsent draft')
  expect(create).toHaveBeenCalledTimes(2)
  expect(store().threads.find(thread => thread.id === 'old')!.messages[0].content).toBe('old question')
  expect(await chat.switchConversation('lifecycle-a', 'old', () => {})).toBe(true)
  expect(a.messages.map(message => message.content)).toEqual(['old question'])
  expect(a.compactionCount).toBe(4)
})

it('keeps an existing window on its selected conversation when host history points elsewhere', async () => {
  const { chat, store } = setup()
  await chat.loadHistory('lifecycle-a')
  await chat.switchConversation('lifecycle-a', 'old', () => {})
  await chat.loadHistory('lifecycle-b')
  expect(store().activeThreadId).not.toBe('old')
  expect((await chat.loadHistory('lifecycle-a')).map(message => message.content)).toEqual(['old question'])
  expect(chat.getSessionState('lifecycle-a').activeThreadId).toBe('old')
})

it('initializes a fresh thread before sending without a mounted sidebar', async () => {
  const { chat, create, stream, append } = setup()
  expect(await chat.sendText('lifecycle-direct', 'new question', () => {})).toBe(true)
  expect(create).toHaveBeenCalledOnce()
  expect(append.mock.calls[0]).toEqual([
    'lifecycle-direct', expect.objectContaining({ content: 'new question' }), 'fresh-1',
  ])
  expect(stream.mock.calls[0]).toEqual(expect.arrayContaining([
    [{ role: 'user', content: 'new question' }], expect.objectContaining({ threadId: 'fresh-1' }),
  ]))
})
