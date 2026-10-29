import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AppDatabase, aiSessionKey } from '../store/appDatabase'
import { migrateLegacyKnowledge } from '../ai/knowledge/legacyMigration'
import { AiKnowledgeService, knowledgeStorageKey, type KnowledgeState } from '../ai/knowledge/knowledgeService'
import { createAiKnowledgeService } from './aiKnowledge'
import { aiHistoryIdForHost } from '../ai/history/historyScope'
import { createNewConversationAtomic } from '../ai/history/historyStore'
import { WORKSPACE_SCOPE_KEY, workspaceHistoryId } from '../ai/workspace/workspaceScopes'
import type { KnowledgeTarget } from '../../shared/aiKnowledge'

const runtime = vi.hoisted(() => ({ database: undefined as AppDatabase | undefined }))
vi.mock('electron', () => ({ app: { getPath: () => 'C:/fixture-profile' } }))
vi.mock('../store/appDatabase', async original => ({ ...await original<typeof import('../store/appDatabase')>(), getAppDatabase: () => runtime.database! }))
let directory: string, database: AppDatabase
const server: KnowledgeTarget = { connectionId: 'a', name: 'A', host: 'a.test', port: 22, username: 'root' }
const file = (content: string, name = 'runbook.md') => ({ source: 'local', path: `C:/notes/${name}`, content })
const snapshot = (...files: ReturnType<typeof file>[]) => ({ version: 1, activeThreadId: 'old', defaultContextFiles: files,
  threads: [{ id: 'old', title: 'Old', createdAt: 1, updatedAt: 2, contextFiles: files, messages: [{ id: 'u', role: 'user', content: 'old question', createdAt: 1 }] }] })
const state = (target = server) => database.getSingleton<KnowledgeState>(knowledgeStorageKey(target))!
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'liteconnect-knowledge-migration-'))
  database = new AppDatabase(path.join(directory, 'test.sqlite'))
  runtime.database = database
})
afterEach(() => {
  database.close()
  expect(path.dirname(path.resolve(directory))).toBe(path.resolve(os.tmpdir()))
  expect(path.basename(directory)).toMatch(/^liteconnect-knowledge-migration-/)
  fs.rmSync(directory, { recursive: true, force: true })
})

it('imports every distinct snapshot once, preserving exact text and defaulting to disabled on-demand knowledge', async () => {
  const raw = snapshot(file('# Guide\r\n\r\nOriginal body  '))
  raw.threads.push({ ...raw.threads[0], id: 'another', contextFiles: [file('# Older version'), file('# Guide\r\n\r\nOriginal body  ', 'copy.md')] })
  migrateLegacyKnowledge(database, server, [{ id: 'host', raw: JSON.stringify(raw) }])
  expect(state().enabled).toBe(false)
  expect(state().documents.map(doc => doc.content)).toEqual(['# Guide\r\n\r\nOriginal body  ', '# Older version'])
  expect(new Set(state().documents.map(doc => doc.title)).size).toBe(2)
  expect(state().documents.every(doc => doc.author === 'user' && doc.alwaysInclude === false)).toBe(true)
  const knowledge = new AiKnowledgeService(() => [server], () => database, '/fixture/test.sqlite').access('s', 1)
  expect(await knowledge.prompt()).toBe('')
  const binding = (await knowledge.manage({ action: 'overview' })).targets[0].binding
  await knowledge.manage({ action: 'enable', connectionId: server.connectionId, binding, enabled: true })
  expect(await knowledge.prompt()).toContain('runbook.md')
  expect(await knowledge.prompt()).not.toContain('Original body')
  expect((await knowledge.call('knowledge_read', { documentId: state().documents[0].id }, new AbortController().signal)).structuredContent).toMatchObject({ content: '# Guide\r\n\r\nOriginal body  ' })
  await knowledge.manage({ action: 'enable', binding, enabled: false })
  expect(await knowledge.prompt()).toBe('')
  expect((await knowledge.call('knowledge_read', { documentId: state().documents[0].id }, new AbortController().signal)).isError).toBe(true)
})

it('does not resurrect deleted imports or re-read the history after its migration marker is committed', () => {
  const read = vi.fn(() => snapshot(file('Original')))
  migrateLegacyKnowledge(database, server, [{ id: 'host', read }])
  const saved = state(); saved.documents = []; database.setSingleton(knowledgeStorageKey(server), saved)
  migrateLegacyKnowledge(database, server, [{ id: 'host', read }])
  expect(read).toHaveBeenCalledOnce()
  expect(state().documents).toEqual([])
})

it('retains the existing switch and documents and does not drop imports at the normal creation cap', () => {
  database.setSingleton(knowledgeStorageKey(server), { enabled: true, documents: Array.from({ length: 20 }, (_, index) => ({ id: `d${index}`, title: `Existing ${index}`, content: `Body ${index}`, revision: 3, author: 'user', history: [], updatedAt: 1, alwaysInclude: true })) })
  migrateLegacyKnowledge(database, server, [{ id: 'host', raw: snapshot(file('Body 0'), file('Extra content')) }])
  expect(state().enabled).toBe(true)
  expect(state().documents).toHaveLength(21)
  expect(state().documents[0]).toMatchObject({ revision: 3, content: 'Body 0', alwaysInclude: true })
  expect(state().documents.at(-1)).toMatchObject({ content: 'Extra content', alwaysInclude: false })
})

it('rolls back documents, index and marker together on a failed database write and can retry', () => {
  const broken = { getSingleton: database.getSingleton.bind(database), transaction: database.transaction.bind(database),
    setSingleton: (key: string, value: unknown) => { if (key.startsWith('index:')) throw new Error('test disk failure'); database.setSingleton(key, value) } }
  expect(() => migrateLegacyKnowledge(broken, server, [{ id: 'host', raw: snapshot(file('Important')) }])).toThrow('test disk failure')
  expect(state()).toBeUndefined()
  expect(database.listSingletonKeys('ai-knowledge-import-v1:')).toEqual([])
  migrateLegacyKnowledge(database, server, [{ id: 'host', raw: snapshot(file('Important')) }])
  expect(state().documents).toHaveLength(1)
})

it('maps host and workspace legacy scopes only to their saved server profiles, including profiles added later', async () => {
  const profiles = [{ id: 'a', name: 'A', host: 'EXAMPLE.com.', port: 22, username: 'root' },
    { id: 'b', name: 'B', host: 'example.com', port: 22, username: 'ops' },
    { id: 'c', name: 'C', host: 'other.test', port: 22, username: 'root' }]
  database.setSingleton(aiSessionKey(aiHistoryIdForHost('example.com', 22)), snapshot(file('HOST_SHARED')))
  database.setSingleton(WORKSPACE_SCOPE_KEY, [{ id: 'workspace:old', connectionIds: ['a', 'c'], createdAt: 1 }])
  database.setSingleton(aiSessionKey(workspaceHistoryId('workspace:old')), snapshot(file('WORKSPACE_SHARED')))
  const ssh = { getSessionSnapshot: (id: string) => ({ connectionId: id }) } as unknown as Parameters<typeof createAiKnowledgeService>[0]
  const credentials = { getConnections: () => profiles, getConnection: (id: string) => profiles.find(profile => profile.id === id) } as unknown as Parameters<typeof createAiKnowledgeService>[1]
  const service = createAiKnowledgeService(ssh, credentials)
  for (const [id, bodies] of [['a', ['HOST_SHARED', 'WORKSPACE_SHARED']], ['b', ['HOST_SHARED']], ['c', ['WORKSPACE_SHARED']]] as const) {
    const access = service.access(id, 1), target = (await access.manage({ action: 'overview' })).targets[0]
    expect(state(target).documents.map(doc => doc.content)).toEqual(bodies)
  }
  profiles.push({ id: 'd', name: 'D', host: 'new.test', port: 2222, username: 'root' })
  database.setSingleton(aiSessionKey(aiHistoryIdForHost('new.test', 2222)), snapshot(file('NEW_PROFILE_LEGACY')))
  expect((await service.access('d', 1).manage({ action: 'overview' })).targets[0].count).toBe(1)
  profiles[0].host = 'replacement.test'
  expect((await service.access('a', 1).manage({ action: 'overview' })).targets[0].count).toBe(0)
  const restarted = createAiKnowledgeService(ssh, credentials)
  expect((await restarted.access('a', 1).manage({ action: 'overview' })).targets[0].count).toBe(0)
})

it('does not inherit old attachments into a new conversation and retains raw snapshots for recovery', async () => {
  const raw = snapshot(file('Archived legacy content'))
  database.setSingleton(aiSessionKey('host'), raw)
  const result = await createNewConversationAtomic('host', { threadId: 'old' })
  expect(result.threads.find(thread => thread.id === result.activeThreadId)?.contextFiles).toEqual([])
  expect(result.defaultContextFiles).toEqual(raw.defaultContextFiles)
})
