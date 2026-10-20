import { afterEach, expect, it, vi } from 'vitest'
import { disposeAiSessionState, useAiChat } from './useAiChat'
import type { AiContextCheckpoint, AiSessionStore } from '@shared/types/ai'

vi.mock('../../i18n', () => ({ t: (key: string) => key }))
vi.mock('element-plus/es/components/message/index', () => ({ ElMessage: { warning: vi.fn() } }))
afterEach(() => { disposeAiSessionState('clear-current'); vi.unstubAllGlobals() })

it('persists an empty current conversation with fresh model context while preserving other history and the draft', async () => {
  const other = { id: 'other', title: 'keep this', createdAt: 1, updatedAt: 1, contextFiles: [],
    messages: [{ id: 'other-message', role: 'user' as const, content: 'other conversation', createdAt: 1 }] }
  const contextFiles = [{ source: 'local' as const, path: 'D:/notes.md', content: 'keep reference', updatedAt: 1 }]
  let stored: AiSessionStore = { version: 1, activeThreadId: 'current', defaultContextFiles: contextFiles,
    threads: [other, { id: 'current', title: 'old conversation', createdAt: 1, updatedAt: 1,
      contextFiles, compactionCount: 4, toolGroups: ['file_transfer'],
      messages: [{ id: 'old', role: 'user', content: 'forget this', createdAt: 1 }],
      contextCheckpoint: { version: 1, summary: 'old summary', throughMessageId: 'old', createdAt: 1, compactionCount: 4 } as AiContextCheckpoint,
    }] }
  vi.stubGlobal('window', { LiteConnect: {
    getAiSessionStore: async () => structuredClone(stored),
    setAiSessionStore: async (_id: string, store: AiSessionStore) => { stored = structuredClone(store) },
  } })
  const chat = useAiChat()
  const state = chat.getSessionState('clear-current')
  state.activeThreadId = 'current'
  state.messages.push({ id: 'old', role: 'user', content: 'forget this', createdAt: 1 })
  state.input = 'unsent draft'
  state.contextFiles = contextFiles
  state.compactionCount = 4
  state.toolGroups = ['file_transfer']
  state.contextCheckpoint = stored.threads[1].contextCheckpoint
  expect(await chat.clearMessages('clear-current', () => {})).toBe(true)
  const current = stored.threads.find(thread => thread.id === 'current')!
  expect(current.messages).toEqual([])
  expect(current.contextCheckpoint).toBeUndefined()
  expect(current.compactionCount).toBe(0)
  expect(current.toolGroups).toEqual([])
  expect(current.contextFiles).toEqual(contextFiles)
  expect(stored.threads.find(thread => thread.id === 'other')).toEqual(other)
  expect(state.messages).toEqual([])
  expect(state.input).toBe('unsent draft')
  expect(state.contextCheckpoint).toBeUndefined()
  expect(state.compactionCount).toBe(0)
  expect(state.toolGroups).toEqual([])
})

it.each(['read', 'write'] as const)('does not replace a newly selected thread while the %s is pending', async phase => {
  let finish!: () => void
  const waiting = new Promise<void>(resolve => { finish = resolve })
  const store: AiSessionStore = { version: 1, activeThreadId: 'current', defaultContextFiles: [], threads:
    ['current', 'other'].map(id => ({ id, title: id, createdAt: 1, updatedAt: 1, contextFiles: [],
      messages: [{ id, role: 'user', content: id, createdAt: 1 }] })) }
  let saved: AiSessionStore | undefined
  const write = vi.fn(async (_id: string, value: AiSessionStore) => {
    if (phase === 'write') await waiting
    saved = structuredClone(value)
  })
  vi.stubGlobal('window', { LiteConnect: {
    getAiSessionStore: async () => { if (phase === 'read') await waiting; return structuredClone(store) },
    setAiSessionStore: write,
  } })
  const chat = useAiChat()
  const state = chat.getSessionState('clear-current')
  state.activeThreadId = 'current'
  state.messages.push({ id: 'current', role: 'user', content: 'current', createdAt: 1 })
  const update = vi.fn()
  const clearing = chat.clearMessages('clear-current', update)
  if (phase === 'write') await vi.waitFor(() => expect(write).toHaveBeenCalledOnce())
  state.activeThreadId = 'other'
  state.messages.splice(0, state.messages.length, { id: 'other', role: 'user', content: 'other', createdAt: 1 })
  finish()
  expect(await clearing).toBe(phase === 'write')
  expect(state.activeThreadId).toBe('other')
  expect(state.messages.map(message => message.content)).toEqual(['other'])
  expect(update).not.toHaveBeenCalled()
  if (phase === 'read') expect(write).not.toHaveBeenCalled()
  else {
    expect(saved!.threads.find(thread => thread.id === 'current')!.messages).toEqual([])
    expect(saved!.threads.find(thread => thread.id === 'other')!.messages).toEqual(store.threads[1].messages)
  }
})
