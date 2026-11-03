import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { AppDatabase } from '../../store/appDatabase'
import { KnowledgeRepository } from './knowledgeRepository'
import { knowledgeIndex, type KnowledgeState } from './knowledgeIndex'
import { KnowledgeGroups } from './knowledgeGroups'
import { knowledgeStorageKey } from './knowledgeIdentity'
import { migrateLegacyKnowledge } from './legacyMigration'
import type { KnowledgeDocument, KnowledgeTarget } from '../../../shared/aiKnowledge'

vi.mock('electron', () => ({ app: { getPath: () => 'fixture', getLocale: () => 'en-US' } }))
let directory: string, database: AppDatabase, repository: KnowledgeRepository
const scope = 'ai-knowledge:fixture'
const doc = (id: string, revision = 6): KnowledgeDocument => ({ id, title: `${id}.md`, content: `Exact\r\n${id}  `, revision, author: 'user', updatedAt: revision, alwaysInclude: true,
  history: Array.from({ length: 5 }, (_, index) => ({ id, title: `${id}-${index}.md`, content: `Version ${index}\r\n  `, revision: index + 1, updatedAt: index + 1, author: 'user', alwaysInclude: false })) })
const legacy = (): KnowledgeState => ({ enabled: true, documents: [doc('guide'), { ...doc('memory'), memoryEntries: [{ text: 'Use /srv/app', documentIds: ['guide'] }] },
  { ...doc('system'), system: { description: 'Unconfirmed architecture', nodes: [], dependencies: [] } }] })
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'liteconnect-knowledge-repository-'))
  database = new AppDatabase(join(directory, 'test.sqlite'))
  repository = new KnowledgeRepository(() => database)
})
afterEach(() => {
  database.close()
  expect(dirname(resolve(directory))).toBe(resolve(tmpdir()))
  expect(basename(directory)).toMatch(/^liteconnect-knowledge-repository-/)
  rmSync(directory, { recursive: true, force: true })
})

it('migrates only the accessed scope and preserves exact content, history, pinning and structured data', () => {
  const saved = legacy()
  database.setSingleton(scope, saved); database.setSingleton(`index:${scope}`, knowledgeIndex(saved))
  database.setSingleton('untouched', saved)
  expect(repository.index(scope)).toEqual(knowledgeIndex(saved))
  expect(database.getSingleton(scope)).toEqual(saved)
  expect(repository.read(scope, 'guide', true)).toEqual(saved.documents[0])
  expect(repository.snapshot(scope)).toEqual({ ...saved, mode: 'readwrite' })
  expect(database.getSingleton(scope)).toEqual({ storageVersion: 2, enabled: true, mode: 'readwrite', documentIds: ['guide', 'memory', 'system'] })
  expect(database.getSingleton('untouched')).toEqual(saved)
  expect(database.countCollection('ai-knowledge-documents-v2')).toBe(3)
  expect(database.countCollection('ai-knowledge-history-v2')).toBe(15)
})

it('rolls back a partial migration, retains the original JSON and retries without duplicates', () => {
  const saved = legacy(); database.setSingleton(scope, saved)
  const write = database.setDocument.bind(database)
  const broken = vi.spyOn(database, 'setDocument').mockImplementation((collection, id, value, order) => {
    write(collection, id, value, order)
    if (collection === 'ai-knowledge-documents-v2') throw new Error('disk failure')
  })
  expect(() => repository.read(scope, 'guide')).toThrow('disk failure')
  expect(database.getSingleton(scope)).toEqual(saved)
  expect(database.getSingleton(`index:${scope}`)).toBeUndefined()
  expect(database.countCollection('ai-knowledge-history-v2')).toBe(0)
  broken.mockRestore()
  expect(repository.snapshot(scope)?.documents).toEqual(saved.documents)
  expect(database.countCollection('ai-knowledge-history-v2')).toBe(15)
})

it('reads a current document without decoding other documents or any historical body', () => {
  repository.initialize(scope, legacy())
  const read = vi.spyOn(database, 'getDocument')
  expect(repository.read(scope, 'guide')?.history).toEqual([])
  expect(read.mock.calls).toEqual([['ai-knowledge-documents-v2', JSON.stringify([scope, 'guide'])]])
  read.mockClear(); repository.read(scope, 'guide', true)
  expect(read.mock.calls.filter(call => call[0] === 'ai-knowledge-history-v2')).toHaveLength(5)
  expect(read.mock.calls.every(call => JSON.parse(call[1])[1] === 'guide')).toBe(true)
})

it('archives only the changed document, retains five versions, restores one and removes its rows on deletion', () => {
  repository.initialize(scope, legacy())
  const unchanged = repository.read(scope, 'memory', true)
  const original = repository.read(scope, 'guide')!
  repository.save(scope, { ...original, revision: 7, content: 'New body' })
  expect(repository.read(scope, 'guide', true)?.history.map(version => version.revision)).toEqual([2, 3, 4, 5, 6])
  expect(repository.version(scope, 'guide', 1)).toBeUndefined()
  const restored = repository.version(scope, 'guide', 2)!
  repository.save(scope, { ...restored, id: 'guide', revision: 8, history: [] })
  expect(repository.read(scope, 'guide')?.content).toBe(restored.content)
  expect(repository.read(scope, 'memory', true)).toEqual(unchanged)
  expect(repository.index(scope).includedDocuments?.map(doc => doc.id)).toEqual(['system'])
  repository.delete(scope, 'guide')
  expect(database.countCollection('ai-knowledge-history-v2')).toBe(10)
  expect(database.countCollection('ai-knowledge-documents-v2')).toBe(2)
  expect(repository.read(scope, 'guide')).toBeUndefined()
})

it('recovers missing metadata from current records without losing histories or mode', () => {
  repository.initialize(scope, { ...legacy(), enabled: true, mode: 'readonly' })
  database.deleteSingleton(`index:${scope}`)
  expect(repository.index(scope)).toMatchObject({ mode: 'readonly', documents: [{ id: 'guide' }, { id: 'memory' }, { id: 'system' }] })
  expect(repository.read(scope, 'guide', true)).toEqual(legacy().documents[0])
})

it('imports old context files into migrated records without replacing existing histories', () => {
  const target: KnowledgeTarget = { connectionId: 'a', host: 'a.test', port: 22, username: 'root', name: 'A' }
  const key = knowledgeStorageKey(target)
  repository.initialize(key, { ...legacy(), mode: 'readonly' })
  migrateLegacyKnowledge(database, target, [{ id: 'old', raw: { defaultContextFiles: [{ source: 'local', path: 'guide.md', content: 'Imported deployment guide' }] } }])
  expect(repository.snapshot(key)?.documents.slice(0, 3)).toEqual(legacy().documents)
  expect(repository.snapshot(key)?.documents.at(-1)?.content).toBe('Imported deployment guide')
  expect(repository.index(key).mode).toBe('readonly')
})

it('invalidates group authorization on local writes, transaction rollback and external SQLite commits', () => {
  const targets: KnowledgeTarget[] = ['a', 'b'].map(id => ({ connectionId: id, name: id, host: `${id}.test`, port: 22, username: 'root' }))
  const groups = new KnowledgeGroups(() => database, () => targets)
  expect(groups.visible([targets[0]])).toEqual([])
  const group = groups.manage({ action: 'create', connectionIds: ['a'], name: 'Production' }).group!
  expect(groups.visible([targets[0]])).toHaveLength(1)
  expect(() => database.transaction(() => {
    groups.manage({ action: 'delete', groupId: group.id, expectedRevision: 1 })
    expect(groups.visible([targets[0]])).toEqual([])
    throw new Error('rollback')
  })).toThrow('rollback')
  expect(groups.visible([targets[0]])).toHaveLength(1)
  const external = new AppDatabase(join(directory, 'test.sqlite'))
  try { external.setSingleton('ai-knowledge-groups-v1', []) } finally { external.close() }
  expect(groups.visible([targets[0]])).toEqual([])
})

it('never enumerates thousands of profiles during scoped group reads and notices identity changes', () => {
  const profiles: KnowledgeTarget[] = Array.from({ length: 5000 }, (_, i) => ({ connectionId: String(i), name: String(i), host: `${i}.test`, port: 22, username: 'root' }))
  const all = vi.fn(() => profiles), lookup = new Map(profiles.map(profile => [profile.connectionId, profile]))
  let revision = 1
  const groups = new KnowledgeGroups(() => database, all, { get: id => lookup.get(id), revision: () => revision })
  const group = groups.manage({ action: 'create', connectionIds: ['0', '1'], name: 'Shared' }).group!
  all.mockClear()
  const visible = groups.visible([profiles[0]])[0]
  expect(visible.systemMembers?.every(member => member.available)).toBe(true)
  lookup.set('1', { ...profiles[1], host: 'replacement.test' }); revision++
  expect(groups.visible([profiles[0]])[0].systemMembers?.find(member => member.connectionId === '1')?.available).toBe(false)
  const copy = groups.get(group.id)!; copy.members.length = 0
  expect(groups.get(group.id)?.members).toHaveLength(2)
  expect(all).not.toHaveBeenCalled()
})

it('rebuilds the group cache when the database connection is replaced', () => {
  const other = new AppDatabase(join(directory, 'other.sqlite'))
  try {
    database.setSingleton('ai-knowledge-groups-v1', [{ id: 'old', name: 'Old', revision: 1, members: [] }])
    other.setSingleton('ai-knowledge-groups-v1', [])
    let active = database
    const groups = new KnowledgeGroups(() => active, () => [])
    expect(groups.list()).toHaveLength(1)
    active = other
    expect(groups.list()).toEqual([])
  } finally { other.close() }
})
