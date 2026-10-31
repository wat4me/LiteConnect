import { beforeEach, expect, it, vi } from 'vitest'
import { AiKnowledgeService, knowledgeStorageKey } from './knowledgeService'
import type { KnowledgeRequest, KnowledgeTarget } from '../../../shared/aiKnowledge'
import { clampToolResultForModel } from '../../../shared/mcp/toolResultClamp'

vi.mock('electron', () => ({ app: { getPath: () => 'C:/fixture-profile' } }))
vi.mock('../../store/appDatabase', () => ({ DB_FILE_NAME: 'liteconnect.sqlite', getAppDatabase: vi.fn() }))
const server = (id: string): KnowledgeTarget => ({ connectionId: id, name: id, host: `${id}.test`, port: 22, username: 'root' })
let targets: KnowledgeTarget[], records: Map<string, unknown>, service: AiKnowledgeService
beforeEach(() => {
  targets = [server('a'), server('b')]; records = new Map()
  service = new AiKnowledgeService((_session, owner) => owner === 1 ? targets : [], () => ({
    getSingleton: <T>(key: string) => structuredClone(records.get(key)) as T | undefined,
    setSingleton: (key: string, value: unknown) => { records.set(key, structuredClone(value)) },
    // Reads/writes already clone values, so a shallow map snapshot is enough for rollback.
    transaction: <T>(work: () => T) => { const before = new Map(records); try { return work() } catch (error) { records = before; throw error } },
  }), '/local/liteconnect.sqlite')
})
async function action(input: KnowledgeRequest) {
  const access = service.access('session', 1)
  const meta = await access.manage({ action: 'overview' })
  return access.manage({ binding: meta.targets.find(target => target.connectionId === input.connectionId)?.binding, ...input })
}
const signal = () => new AbortController().signal
const enable = () => action({ action: 'enable', connectionId: 'a', enabled: true })

it('maps legacy enabled flags to modes without rewriting existing knowledge on access', async () => {
  const key = knowledgeStorageKey(server('a'))
  records.set(key, { enabled: true, documents: [] })
  const access = service.access('session', 1)
  expect((await access.manage({ action: 'overview' })).targets[0]).toMatchObject({ enabled: true, mode: 'readwrite' })
  expect(await access.tools!()).toContain('knowledge_save')
  expect(records.get(key)).toEqual({ enabled: true, documents: [] })
  records.set(key, { enabled: false, documents: [] })
  expect((await access.manage({ action: 'overview' })).targets[0].mode).toBe('off')
  expect(await access.tools!()).toEqual([])
})

it('keeps knowledge readable and included while blocking stale AI writes and retaining manual management', async () => {
  await enable()
  const doc = (await action({ action: 'save', connectionId: 'a', title: 'Service paths', content: 'Confirmed path: /srv/app', alwaysInclude: true, expectedRevision: 0 })).document!
  // An already-running turn may have received the save schema before a mode change.
  const access = service.access('session', 1)
  await action({ action: 'setMode', connectionId: 'a', mode: 'readonly' })
  const before = structuredClone(records)
  expect(await access.tools!()).toEqual(['knowledge_search', 'knowledge_read'])
  expect(await access.prompt()).toContain('Confirmed path: /srv/app')
  expect(await access.prompt()).toContain('"mode":"readonly"')
  expect((await access.call('knowledge_search', { connectionId: 'a', query: 'Confirmed path' }, signal())).isError).toBe(false)
  expect((await access.call('knowledge_read', { connectionId: 'a', documentId: doc.id }, signal())).structuredContent).toMatchObject({ content: doc.content, revision: 1 })
  for (const documentId of [undefined, doc.id, 'memory']) {
    const result = await access.call('knowledge_save', { connectionId: 'a', documentId, title: 'Unexpected update', content: 'Do not save', expectedRevision: documentId ? 1 : 0 }, signal())
    expect(result.structuredContent).toMatchObject({ code: 'KNOWLEDGE_READ_ONLY' })
  }
  expect(records).toEqual(before)
  const edited = (await action({ action: 'save', connectionId: 'a', documentId: doc.id, title: doc.title, content: 'User path: /srv/manual', expectedRevision: 1 })).document!
  expect(edited).toMatchObject({ author: 'user', revision: 2 })
  expect((await action({ action: 'restore', connectionId: 'a', documentId: doc.id, revision: 1, expectedRevision: 2 })).document?.content).toBe(doc.content)
  await action({ action: 'delete', connectionId: 'a', documentId: doc.id, expectedRevision: 3 })
  expect((await service.access('session', 1).manage({ action: 'overview' })).targets[0].mode).toBe('readonly')
  await action({ action: 'setMode', connectionId: 'a', mode: 'off' })
  expect(await access.prompt()).toBe('')
  expect(await access.tools!()).toEqual([])
  expect((await access.call('knowledge_read', { connectionId: 'a', documentId: 'memory' }, signal())).structuredContent).toMatchObject({ code: 'KNOWLEDGE_DISABLED' })
})

it('enforces knowledge modes per server in a mixed workspace and restores writes only when enabled', async () => {
  await action({ action: 'setMode', connectionId: 'a', mode: 'readonly' })
  await action({ action: 'setMode', connectionId: 'b', mode: 'readwrite' })
  const access = service.access('session', 1)
  const save = (connectionId: string) => access.call('knowledge_save', { connectionId, title: 'Service', content: '/srv/app', expectedRevision: 0 }, signal())
  expect(await access.tools!()).toContain('knowledge_save')
  expect((await save('a')).structuredContent).toMatchObject({ code: 'KNOWLEDGE_READ_ONLY' })
  expect((await save('b')).isError).toBe(false)
  await action({ action: 'setMode', connectionId: 'b', mode: 'readonly' })
  expect(await access.tools!()).not.toContain('knowledge_save')
  expect((await save('b')).structuredContent).toMatchObject({ code: 'KNOWLEDGE_READ_ONLY' })
  await action({ action: 'setMode', connectionId: 'b', mode: 'readwrite' })
  expect((await save('b')).isError).toBe(false)
  await expect(action({ action: 'setMode', connectionId: 'a', mode: 'invalid' as never })).rejects.toThrow('INVALID_INPUT')
  expect((await access.manage({ action: 'overview' })).targets.map(target => target.mode)).toEqual(['readonly', 'readwrite'])
})

it('creates no records until explicit enablement and exposes no prompt or tool access while disabled', async () => {
  const access = service.access('session', 1)
  expect((await access.manage({ action: 'overview' })).targets).toHaveLength(2)
  expect(records.size).toBe(0)
  expect(await access.prompt()).toBe('')
  expect(await access.call('knowledge_save', { connectionId: 'a', title: 'secret', content: 'x', expectedRevision: 0 }, signal())).toMatchObject({ isError: true, structuredContent: { code: 'KNOWLEDGE_DISABLED' } })
  expect(records.size).toBe(0)
})

it('stores notes across conversations with revisions, search, restore and author attribution', async () => {
  await enable()
  const source = (await action({ action: 'save', connectionId: 'a', expectedRevision: 0, title: 'Tomcat details', content: 'Confirmed application configuration' })).document!
  const saved = await action({ action: 'save', connectionId: 'a', documentId: 'memory', expectedRevision: 1, title: 'MEMORY.md', content: 'Tomcat: /opt/tomcat' })
  expect(saved.document).toMatchObject({ revision: 2, author: 'user' })
  const access = service.access('new-conversation', 1)
  expect(await access.prompt()).toContain('/opt/tomcat')
  const result = await access.call('knowledge_save', { connectionId: 'a', documentId: 'memory', expectedRevision: 2, title: 'MEMORY.md', memoryEntries: [{ text: 'Tomcat: /srv/tomcat', documentIds: [source.id] }] }, signal())
  expect(result.structuredContent).toMatchObject({ revision: 3, author: 'ai', saved: true, connectionId: 'a', documentId: 'memory' })
  expect(await access.call('knowledge_search', { connectionId: 'a', query: '/srv' }, signal())).toMatchObject({ structuredContent: { documents: [expect.objectContaining({ id: 'memory' })] } })
  const restored = await action({ action: 'restore', connectionId: 'a', documentId: 'memory', expectedRevision: 3, revision: 2 })
  expect(restored.document).toMatchObject({ revision: 4, author: 'user', content: 'Tomcat: /opt/tomcat' })
})

it('rejects stale edits without overwriting either revision and checks the server binding', async () => {
  await enable()
  await action({ action: 'save', connectionId: 'a', documentId: 'memory', expectedRevision: 1, title: 'Current', content: 'new' })
  await expect(action({ action: 'save', connectionId: 'a', documentId: 'memory', expectedRevision: 1, title: 'Stale', content: 'old' })).rejects.toThrow('KNOWLEDGE_CONFLICT')
  await expect(service.access('session', 1).manage({ action: 'enable', connectionId: 'a', binding: 'wrong', enabled: false })).rejects.toThrow('KNOWLEDGE_CONFLICT')
  expect((await action({ action: 'read', connectionId: 'a', documentId: 'memory' })).document?.content).toBe('new')
})

it('isolates servers, scopes and changed server identities, including in-flight access', async () => {
  await enable()
  await action({ action: 'save', connectionId: 'a', documentId: 'memory', expectedRevision: 1, title: 'Host A', content: 'A only' })
  const access = service.access('session', 1)
  expect((await action({ action: 'list', connectionId: 'b' })).documents).toEqual([])
  expect((await service.access('session', 2).call('knowledge_read', { connectionId: 'a', documentId: 'memory' }, signal())).isError).toBe(true)
  expect((await access.call('knowledge_read', { connectionId: '../outside', documentId: 'memory' }, signal())).isError).toBe(true)
  const oldBinding = (await access.manage({ action: 'overview' })).targets[0].binding
  targets[0] = { ...targets[0], host: 'replacement.test' }
  expect(await access.prompt()).not.toContain('A only')
  expect((await access.call('knowledge_read', { connectionId: 'a', documentId: 'memory' }, signal())).isError).toBe(true)
  expect((await service.access('new', 1).manage({ action: 'overview' })).targets[0]).toMatchObject({ enabled: false, count: 0 })
  await expect(service.access('new', 1).manage({ action: 'enable', connectionId: 'a', binding: oldBinding, enabled: true })).rejects.toThrow('KNOWLEDGE_CONFLICT')
})

it('disablement stops AI access and summary injection while retaining user-readable documents', async () => {
  await enable()
  const access = service.access('session', 1)
  await action({ action: 'enable', connectionId: 'a', enabled: false })
  expect(await access.prompt()).toBe('')
  expect((await access.call('knowledge_read', { connectionId: 'a', documentId: 'memory' }, signal())).isError).toBe(true)
  expect((await action({ action: 'read', connectionId: 'a', documentId: 'memory' })).document?.id).toBe('memory')
  const edited = await action({ action: 'save', connectionId: 'a', documentId: 'memory', expectedRevision: 1, title: 'Memory', content: 'Manually maintained while AI use is disabled' })
  expect(edited.document?.revision).toBe(2)
  await action({ action: 'delete', connectionId: 'a', documentId: 'memory', expectedRevision: 2 })
  expect((await action({ action: 'list', connectionId: 'a' })).documents).toEqual([])
  expect(await access.prompt()).toBe('')
})

it('bounds the complete multi-server directory and summaries while retaining all authorized server IDs', async () => {
  targets = Array.from({ length: 20 }, (_, index) => server(`host-${index}`))
  for (const target of targets) {
    await action({ action: 'enable', connectionId: target.connectionId, enabled: true })
    await action({ action: 'save', connectionId: target.connectionId, documentId: 'memory', expectedRevision: 1, title: 'MEMORY.md', content: 'x'.repeat(1000) })
    for (let index = 0; index < 19; index++) await action({ action: 'save', connectionId: target.connectionId, expectedRevision: 0, title: 'Long title '.repeat(10), content: '' })
  }
  const prompt = await service.access('large-workspace', 1).prompt()
  expect(prompt.length).toBeLessThan(20000)
  for (const target of targets) expect(prompt).toContain(target.connectionId)
  expect(prompt).toContain('"documentsTruncated":true')
  expect(prompt).toContain('"summaryTruncated":true')
})

it('bounds text and revision history and reads long notes completely without result-clamp loss', async () => {
  await enable()
  const content = ('line 😀\n' + 'x'.repeat(400)).repeat(60)
  for (let revision = 1; revision <= 8; revision++) await action({ action: 'save', connectionId: 'a', documentId: 'memory', expectedRevision: revision, title: 'Memory', content })
  const document = (await action({ action: 'read', connectionId: 'a', documentId: 'memory' })).document!
  expect(document.history).toHaveLength(5)
  const access = service.access('session', 1)
  let offset = 0, read = ''
  while (offset < content.length) {
    const result = await access.call('knowledge_read', { connectionId: 'a', documentId: 'memory', offset, expectedRevision: 9 }, signal())
    const payload = JSON.parse(clampToolResultForModel(result).content)
    expect(payload.revision).toBe(9)
    expect(payload.nextOffset).toBeGreaterThan(offset)
    read += payload.content; offset = payload.nextOffset
  }
  expect(read).toBe(content)
  await expect(action({ action: 'save', connectionId: 'a', documentId: 'memory', expectedRevision: 9, title: 'Large', content: '界'.repeat(12000) })).rejects.toThrow('INVALID_INPUT')
  expect((await access.call('knowledge_read', { connectionId: 'a', documentId: 'memory', expectedRevision: 8 }, signal())).isError).toBe(true)
})

it('checks cancellation before writes and bounds document creation', async () => {
  await enable()
  const access = service.access('session', 1), controller = new AbortController()
  controller.abort()
  await expect(access.call('knowledge_save', { connectionId: 'a', title: 'Cancelled', content: 'x', expectedRevision: 0 }, controller.signal)).rejects.toThrow()
  for (let index = 0; index < 19; index++) await action({ action: 'save', connectionId: 'a', expectedRevision: 0, title: `Doc ${index}`, content: '' })
  await expect(action({ action: 'save', connectionId: 'a', expectedRevision: 0, title: 'Overflow', content: '' })).rejects.toThrow('LIMIT')
})

it('binds memory entries to stable same-server document IDs and resolves renamed sources at their current revision', async () => {
  await enable()
  const source = (await action({ action: 'save', connectionId: 'a', expectedRevision: 0, title: 'Deployment', content: 'DETAILS_ONLY: restart procedure' })).document!
  const access = service.access('session', 1)
  const entry = { text: 'Application deployment precautions', documentIds: [source.id] }
  expect((await access.call('knowledge_save', { connectionId: 'a', documentId: 'memory', expectedRevision: 1, title: 'MEMORY.md', memoryEntries: [entry] }, signal())).isError).toBe(false)
  await action({ action: 'save', connectionId: 'a', documentId: source.id, expectedRevision: 1, title: 'Renamed deployment guide', content: 'DETAILS_ONLY: updated procedure' })
  const prompt = await access.prompt()
  const directory = JSON.parse(prompt.slice(prompt.indexOf('\n') + 1))
  expect(directory[0].memoryEntries).toEqual([{ text: entry.text, sources: [{ documentId: source.id, title: 'Renamed deployment guide', revision: 2 }] }])
  expect(prompt).toContain('use sufficient self-contained notes directly')
  expect(prompt).not.toContain('DETAILS_ONLY')
  const read = await access.call('knowledge_read', { connectionId: 'a', documentId: 'memory' }, signal())
  expect(read.structuredContent).toMatchObject({ memoryEntries: [entry] })
  expect((await access.call('knowledge_read', { connectionId: 'a', documentId: source.id }, signal())).structuredContent).toMatchObject({ revision: 2, content: 'DETAILS_ONLY: updated procedure' })
})

it('rejects invented, cross-server, self-referential and oversized memory associations without changing the saved revision', async () => {
  await enable()
  await action({ action: 'enable', connectionId: 'b', enabled: true })
  const source = (await action({ action: 'save', connectionId: 'a', expectedRevision: 0, title: 'Source A', content: 'A' })).document!
  const foreign = (await action({ action: 'save', connectionId: 'b', expectedRevision: 0, title: 'Source B', content: 'B' })).document!
  const access = service.access('session', 1)
  const save = (memoryEntries: unknown) => access.call('knowledge_save', { connectionId: 'a', documentId: 'memory', expectedRevision: 1, title: 'MEMORY.md', memoryEntries }, signal())
  for (const id of ['missing', foreign.id, 'memory']) expect((await save([{ text: 'A fact', documentIds: [id] }])).structuredContent).toMatchObject({ code: 'KNOWLEDGE_SOURCE_NOT_FOUND' })
  for (const entries of [
    [{ text: 'x'.repeat(161), documentIds: [source.id] }],
    [{ text: 'Duplicate source', documentIds: [source.id, source.id] }],
    Array.from({ length: 7 }, () => ({ text: 'Entry', documentIds: [source.id] })),
    Array.from({ length: 4 }, () => ({ text: 'x'.repeat(151), documentIds: [source.id] })),
  ]) expect((await save(entries)).structuredContent).toMatchObject({ code: 'KNOWLEDGE_INVALID_INPUT' })
  expect((await access.call('knowledge_save', { connectionId: 'a', documentId: 'memory', expectedRevision: 1, title: 'MEMORY.md', content: 'A raw scan report' }, signal())).structuredContent).toMatchObject({ code: 'KNOWLEDGE_MEMORY_ENTRIES_REQUIRED' })
  expect((await action({ action: 'read', connectionId: 'a', documentId: 'memory' })).document).toMatchObject({ revision: 1, memoryEntries: [] })
})

it('saves self-contained memory without source documents, including omitted optional source arrays', async () => {
  await enable()
  const access = service.access('session', 1)
  const result = await access.call('knowledge_save', { connectionId: 'a', documentId: 'memory', expectedRevision: 1, title: 'MEMORY.md', memoryEntries: [{ text: 'This is a production server; confirm before restarting services.' }] }, signal())
  expect(result.isError).toBe(false)
  const memory = (await action({ action: 'read', connectionId: 'a', documentId: 'memory' })).document!
  expect(memory.memoryEntries).toEqual([{ text: 'This is a production server; confirm before restarting services.', documentIds: [] }])
  expect((await action({ action: 'list', connectionId: 'a' })).documents).toHaveLength(1)
  const prompt = await access.prompt()
  expect(prompt).toContain('This is a production server')
  expect(prompt).toContain('"sources":[]')
  expect(prompt).not.toContain('before answering details')
})

it('includes short notes directly by choice without duplicating them into memory, retaining flags across edits and history', async () => {
  await enable()
  const access = service.access('session', 1)
  const note = (await action({ action: 'save', connectionId: 'a', title: 'Operations rule', content: 'ALWAYS_NOTE: user confirmation before restart', alwaysInclude: true, expectedRevision: 0 })).document!
  const reference = (await action({ action: 'save', connectionId: 'a', title: 'Deployment guide', content: 'DETAILS_ONLY: multi-step procedure', expectedRevision: 0 })).document!
  expect(await access.prompt()).toContain('ALWAYS_NOTE')
  expect(await access.prompt()).not.toContain('DETAILS_ONLY')
  expect((await action({ action: 'read', connectionId: 'a', documentId: 'memory' })).document?.memoryEntries).toEqual([])
  expect((await action({ action: 'list', connectionId: 'a' })).documents).toHaveLength(3)
  await action({ action: 'save', connectionId: 'a', documentId: note.id, title: note.title, content: 'ALWAYS_NOTE: updated rule', expectedRevision: 1 })
  expect((await action({ action: 'read', connectionId: 'a', documentId: note.id })).document?.alwaysInclude).toBe(true)
  await action({ action: 'save', connectionId: 'a', documentId: note.id, title: note.title, content: 'ALWAYS_NOTE: updated rule', alwaysInclude: false, expectedRevision: 2 })
  expect(await access.prompt()).not.toContain('ALWAYS_NOTE:')
  await action({ action: 'restore', connectionId: 'a', documentId: note.id, expectedRevision: 3, revision: 2 })
  expect(await access.prompt()).toContain('ALWAYS_NOTE: updated rule')
  await action({ action: 'save', connectionId: 'a', documentId: reference.id, title: reference.title, content: reference.content, alwaysInclude: true, expectedRevision: 1 })
  expect(await access.prompt()).toContain('DETAILS_ONLY: multi-step procedure')
  await action({ action: 'restore', connectionId: 'a', documentId: reference.id, expectedRevision: 2, revision: 1 })
  expect(await access.prompt()).not.toContain('DETAILS_ONLY: multi-step procedure')
  await action({ action: 'enable', connectionId: 'a', enabled: false })
  expect(await access.prompt()).toBe('')
})

it('can keep memory itself on demand and marks included text that exceeds the context budget', async () => {
  await enable()
  const access = service.access('session', 1)
  await action({ action: 'save', connectionId: 'a', documentId: 'memory', expectedRevision: 1, title: 'MEMORY.md', alwaysInclude: false, memoryEntries: [{ text: 'ON_DEMAND_MEMORY', documentIds: [] }] })
  expect(await access.prompt()).not.toContain('ON_DEMAND_MEMORY')
  const large = 'PINNED_START ' + 'x'.repeat(10000) + ' END_ONLY'
  const doc = (await action({ action: 'save', connectionId: 'a', expectedRevision: 0, title: 'Large pinned note', content: large, alwaysInclude: true })).document!
  const prompt = await access.prompt()
  expect(prompt).toContain('PINNED_START')
  expect(prompt).toContain('"truncated":true')
  expect(prompt).not.toContain('END_ONLY')
  expect((await action({ action: 'read', connectionId: 'a', documentId: doc.id })).document?.content).toBe(large)
})

it('retains linked entries in history and marks deleted sources instead of guessing replacement documents', async () => {
  await enable()
  const first = (await action({ action: 'save', connectionId: 'a', expectedRevision: 0, title: 'Guide', content: 'First' })).document!
  const second = (await action({ action: 'save', connectionId: 'a', expectedRevision: 0, title: 'Guide', content: 'Second' })).document!
  const old = { text: 'Original navigation', documentIds: [first.id] }
  await action({ action: 'save', connectionId: 'a', documentId: 'memory', expectedRevision: 1, title: 'MEMORY.md', memoryEntries: [old] })
  await action({ action: 'save', connectionId: 'a', documentId: 'memory', expectedRevision: 2, title: 'MEMORY.md', memoryEntries: [{ text: 'New navigation', documentIds: [second.id] }] })
  await action({ action: 'delete', connectionId: 'a', documentId: first.id, expectedRevision: 1 })
  const restored = await action({ action: 'restore', connectionId: 'a', documentId: 'memory', expectedRevision: 3, revision: 2 })
  expect(restored.document).toMatchObject({ revision: 4, memoryEntries: [old] })
  const access = service.access('session', 1)
  const prompt = await access.prompt()
  expect(prompt).toContain(JSON.stringify({ documentId: first.id, missing: true }))
  expect((await action({ action: 'read', connectionId: 'a', documentId: 'memory' })).document?.memoryEntries).toEqual([old])
})

it('keeps legacy text intact until an explicit linked-entry save and can restore the legacy version', async () => {
  await enable()
  const original = 'Existing legacy notes.\n' + 'x'.repeat(900)
  await action({ action: 'save', connectionId: 'a', documentId: 'memory', expectedRevision: 1, title: 'MEMORY.md', content: original })
  const access = service.access('session', 1)
  expect(await access.prompt()).toContain('"legacySummary":true')
  expect((await action({ action: 'read', connectionId: 'a', documentId: 'memory' })).document?.content).toBe(original)
  const source = (await action({ action: 'save', connectionId: 'a', expectedRevision: 0, title: 'Details', content: original })).document!
  await action({ action: 'save', connectionId: 'a', documentId: 'memory', expectedRevision: 2, title: 'MEMORY.md', memoryEntries: [{ text: 'Legacy topic details', documentIds: [source.id] }] })
  const restored = await action({ action: 'restore', connectionId: 'a', documentId: 'memory', expectedRevision: 3, revision: 2 })
  expect(restored.document?.content).toBe(original)
  expect(restored.document?.memoryEntries).toBeUndefined()
})
