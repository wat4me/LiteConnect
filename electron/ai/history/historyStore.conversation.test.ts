import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve, sep } from 'path'
import { readAiSessionStore, saveAiConversation, writeAiSessionStore } from './historyStore'
import { aiThreadCollection } from './historyRepository'
import { AI_TOOL_RUN_CONTENT_MAX } from './historyModel'
import { closeAppDatabase, getAppDatabase, initializeAppDatabase } from '../../store/appDatabase'
import type { AiHistoryRecord } from '../../../shared/types/ai'

const appPath = vi.hoisted(() => ({ value: '' }))
vi.mock('electron', () => ({ app: { getPath: () => appPath.value } }))
beforeAll(async () => {
  appPath.value = await mkdtemp(join(tmpdir(), 'lite-ai-conversation-test-'))
  await initializeAppDatabase(appPath.value)
})
afterAll(async () => {
  closeAppDatabase()
  const root = resolve(appPath.value)
  if (!root.startsWith(resolve(tmpdir()) + sep) || !root.includes('lite-ai-conversation-test-')) throw new Error('Invalid test directory')
  await rm(root, { recursive: true, force: true })
})

const thread = (id: string, messages: AiHistoryRecord[], extra: Record<string, unknown> = {}) =>
  ({ id, title: '', createdAt: 1, updatedAt: 2, contextFiles: [], messages, ...extra })
const user = (id: string, content: string, createdAt: number): AiHistoryRecord => ({ id, role: 'user', content, createdAt })
const rows = (session: string, threadId: string) => getAppDatabase().getCollection<any>(aiThreadCollection(session, threadId))

it('stores segment text and duplicated tool results once and reads them back expanded', async () => {
  const oversized = 'r'.repeat(AI_TOOL_RUN_CONTENT_MAX) + 'TAIL'
  const reply: AiHistoryRecord = {
    id: 'reply', role: 'assistant', createdAt: 2, status: 'completed',
    content: 'Checking.Done.', reasoningContent: 'think',
    segments: [
      { kind: 'reasoning', text: 'think' }, { kind: 'content', text: 'Checking.' },
      { kind: 'tool', runId: 'call-1' }, { kind: 'content', text: 'Done.' },
    ],
    toolRuns: [
      { id: 'call-1', name: 'ssh_exec', args: '{"cmd":"uptime"}', content: 'up 3 days', isError: false, status: 'done' },
      { id: 'call-2', name: 'ssh_exec', args: '{}', content: oversized, isError: false, status: 'done' },
    ],
    apiMessages: [
      { role: 'assistant', content: 'Checking.', reasoningContent: 'think', toolCalls: [
        { id: 'call-1', type: 'function', function: { name: 'ssh_exec', arguments: '{"cmd":"uptime"}' } },
        { id: 'call-2', type: 'function', function: { name: 'ssh_exec', arguments: '{}' } },
      ] },
      { role: 'tool', toolCallId: 'call-1', content: 'up 3 days' },
      { role: 'tool', toolCallId: 'call-2', content: oversized },
      { role: 'assistant', content: 'Done.' },
    ],
  }
  await writeAiSessionStore('compact', {
    version: 1, activeThreadId: 't', defaultContextFiles: [],
    threads: [thread('t', [user('q', 'status?', 1), reply])],
  })

  const stored = rows('compact', 't')[1]
  expect(stored.segments).toEqual([
    { kind: 'reasoning', length: 5 }, { kind: 'content', length: 9 }, { kind: 'tool', runId: 'call-1' }, { kind: 'content', length: 5 },
  ])
  expect(stored.apiMessages[0]).toEqual({ role: 'assistant', content: '', contentSpan: 9, reasoningSpan: 5, toolCalls: reply.apiMessages![0].toolCalls })
  expect(stored.apiMessages[1]).toEqual({ role: 'tool', toolCallId: 'call-1', content: '', contentRef: 'toolRun' })
  expect(stored.apiMessages[2]).toEqual({ role: 'tool', toolCallId: 'call-2', content: '', contentRef: 'toolRun' })
  expect(stored.apiMessages[3]).toEqual({ role: 'assistant', content: '', contentSpan: 5 })
  expect(JSON.stringify(rows('compact', 't'))).not.toContain('TAIL')

  const loaded = (await readAiSessionStore('compact')).threads[0].messages[1]
  expect(loaded.segments).toEqual(reply.segments)
  expect(loaded.apiMessages?.[0]).toEqual(reply.apiMessages![0])
  expect(loaded.apiMessages?.[1]).toEqual({ role: 'tool', toolCallId: 'call-1', content: 'up 3 days' })
  expect(loaded.apiMessages?.[2]).toEqual({ role: 'tool', toolCallId: 'call-2', content: 'r'.repeat(AI_TOOL_RUN_CONTENT_MAX) })
  expect(loaded.apiMessages?.[3]).toEqual({ role: 'assistant', content: 'Done.' })
  expect(loaded.toolRuns?.[1].content).toHaveLength(AI_TOOL_RUN_CONTENT_MAX)
})

it('keeps literal segment text when it no longer matches the reply body', async () => {
  const reply: AiHistoryRecord = {
    id: 'reply', role: 'assistant', createdAt: 2, content: 'final answer', reasoningContent: 'why',
    segments: [{ kind: 'reasoning', text: 'why' }, { kind: 'content', text: 'draft answer' }],
  }
  await writeAiSessionStore('literal', {
    version: 1, activeThreadId: 't', defaultContextFiles: [],
    threads: [thread('t', [user('q', 'question', 1), reply])],
  })
  expect(rows('literal', 't')[1].segments).toEqual([
    { kind: 'reasoning', length: 3 }, { kind: 'content', text: 'draft answer' },
  ])
  expect((await readAiSessionStore('literal')).threads[0].messages[1].segments).toEqual(reply.segments)
})

it('replaces one conversation, keeps its checkpoint unless invalidated, and activates it', async () => {
  const first = [user('u1', 'first question', 1), { id: 'a1', role: 'assistant', content: 'first answer', createdAt: 2 } as AiHistoryRecord]
  await writeAiSessionStore('save', {
    version: 1, activeThreadId: 'other', defaultContextFiles: [],
    threads: [
      thread('mine', first, { compactionCount: 2, contextCheckpoint: {
        version: 1, summary: 'earlier', throughMessageId: 'u1', compactionCount: 2, createdAt: 2, sourceTokens: 100, summaryTokens: 10,
      } }),
      thread('other', [user('u2', 'elsewhere', 3)]),
    ],
  })

  const result = await saveAiConversation('save', 'mine', {
    messages: [first[0], { ...first[1], content: 'edited answer' }], compactionCount: 1, toolGroups: ['file_transfer'],
  })
  expect(result.activeThreadId).toBe('mine')
  expect(result.thread).toBeUndefined()
  expect(result.threads.map(item => [item.id, item.messageCount, item.active])).toEqual([['mine', 2, true], ['other', 1, false]])
  const mine = (await readAiSessionStore('save')).threads.find(item => item.id === 'mine')!
  expect(mine.messages[1].content).toBe('edited answer')
  expect(mine.contextCheckpoint?.summary).toBe('earlier')
  expect(mine.compactionCount).toBe(2)
  expect(mine.toolGroups).toEqual(['file_transfer'])

  await saveAiConversation('save', 'mine', { messages: mine.messages, invalidateContextCheckpoint: true })
  expect((await readAiSessionStore('save')).threads.find(item => item.id === 'mine')?.contextCheckpoint).toBeUndefined()
})

it('selects another conversation in the same write, drops the empty draft, and writes nothing for a missing target', async () => {
  await writeAiSessionStore('select', {
    version: 1, activeThreadId: 'draft', defaultContextFiles: [],
    threads: [thread('old', [user('u', 'old question', 1)]), thread('draft', [])],
  })

  const missing = await saveAiConversation('select', 'draft', { messages: [user('d', 'unsaved', 3)], selectThreadId: 'gone' })
  expect(missing.thread).toBeUndefined()
  expect(missing.activeThreadId).toBe('draft')
  expect((await readAiSessionStore('select')).threads.find(item => item.id === 'draft')?.messages).toEqual([])

  const switched = await saveAiConversation('select', 'draft', { messages: [], selectThreadId: 'old' })
  expect(switched.activeThreadId).toBe('old')
  expect(switched.thread?.messages.map(message => message.content)).toEqual(['old question'])
  expect(switched.threads.map(item => item.id)).toEqual(['old'])
})

it('recreates a draft that another window pruned instead of writing into a different conversation', async () => {
  await writeAiSessionStore('recreate', {
    version: 1, activeThreadId: 'other', defaultContextFiles: [],
    threads: [thread('other', [user('u', 'elsewhere', 1)])],
  })
  const result = await saveAiConversation('recreate', 'mine', {
    messages: [user('m', 'my question', 2)],
    contextFiles: [{ source: 'local', path: 'C:/notes/README.md', content: '# notes' }],
  })
  expect(result.activeThreadId).toBe('mine')
  const stored = await readAiSessionStore('recreate')
  expect(stored.threads.map(item => [item.id, item.messages[0]?.content])).toEqual([['other', 'elsewhere'], ['mine', 'my question']])
  expect(stored.threads.find(item => item.id === 'mine')?.contextFiles).toEqual([{ source: 'local', path: 'C:/notes/README.md', content: '# notes' }])
})
