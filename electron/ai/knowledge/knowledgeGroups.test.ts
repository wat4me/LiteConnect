import { beforeEach, expect, it, vi } from 'vitest'
import { AiKnowledgeService, knowledgeStorageKey } from './knowledgeService'
import type { KnowledgeRequest, KnowledgeTarget } from '../../../shared/aiKnowledge'
import { buildAiRequestEnvironment } from '../execution/requestContext'
import type { SshMcpRuntime } from '../../mcp/runtime'
import { createAiStreamControl, resolveToolApproval } from '../tools/streamControl'
import type { KnowledgeSystem } from '../../../shared/aiKnowledgeSystem'
import { executeAiToolCall } from '../tools/toolExecution'
import type { AiToolExecutionContext } from '../tools/toolExecutionContext'

vi.mock('electron', () => ({ app: { getPath: () => '/fixture' } }))
vi.mock('../../store/appDatabase', () => ({ DB_FILE_NAME: 'app.sqlite', getAppDatabase: vi.fn() }))
let profiles: KnowledgeTarget[], selected: KnowledgeTarget[], records: Map<string, unknown>, service: AiKnowledgeService
const signal = () => new AbortController().signal
beforeEach(() => {
  profiles = Array.from({ length: 10 }, (_, i) => ({ connectionId: `server-${i}`, name: `Server ${i}`, host: `${i}.test`, port: 22, username: 'ops' }))
  selected = [...profiles]; records = new Map()
  service = new AiKnowledgeService(() => selected, () => ({
    getSingleton: <T>(key: string) => structuredClone(records.get(key)) as T | undefined,
    setSingleton: (key: string, value: unknown) => { records.set(key, structuredClone(value)) },
    transaction: <T>(work: () => T) => { const before = new Map(records); try { return work() } catch (error) { records = before; throw error } },
  }), '/fixture/app.sqlite', () => profiles)
})
const create = (connectionIds = profiles.map(server => server.connectionId), initialContent = 'SHARED_PATH: /opt/orders') => service.groups.manage({ action: 'create', name: 'Orders production', connectionIds, initialContent }).group!
async function systemInput(groupId: string): Promise<KnowledgeSystem> {
  const scope = (await service.access('fixture', 1).manage({ action: 'overview' })).groups!.find(group => group.groupId === groupId)!
  return { description: 'Public entry is Gateway; release Database before API and Gateway.', nodes: scope.systemMembers!.slice(0, 4).map((member, i) => ({ id: `role-${i}`, connectionId: member.connectionId, binding: member.binding, role: ['Gateway', 'API', 'Database', 'Cache'][i], note: '', status: 'confirmed' })), dependencies: [{ from: 'role-0', to: 'role-1', label: 'HTTP', status: 'confirmed' }, { from: 'role-1', to: 'role-2', label: 'SQL', status: 'confirmed' }, { from: 'role-1', to: 'role-3', label: 'Redis', status: 'unconfirmed' }] }
}
async function manage(input: KnowledgeRequest) {
  const access = service.access('fixture', 1), overview = await access.manage({ action: 'overview' })
  const scope = [...overview.targets, ...(overview.groups || [])].find(target => input.groupId ? target.groupId === input.groupId : target.connectionId === input.connectionId)
  return access.manage({ binding: scope?.binding, ...input })
}
it('includes shared knowledge exactly once for ten members, alongside their own exceptions', async () => {
  const group = create()
  await manage({ action: 'setMode', connectionId: profiles[0].connectionId, mode: 'readwrite' })
  await manage({ action: 'save', connectionId: profiles[0].connectionId, title: 'Exception', content: 'SERVER_ONLY: /data/orders', alwaysInclude: true, expectedRevision: 0 })
  const access = service.access('fixture', 1), prompt = await access.prompt()
  expect(prompt.match(/SHARED_PATH/g)).toHaveLength(1)
  expect(prompt).toContain('SERVER_ONLY')
  expect(prompt).toContain('"groupId"')
  expect(prompt).toContain('Prefer explicit server-specific exceptions')
  const directory = JSON.parse(prompt.split('\n').at(-1)!)
  expect(directory.find((entry: { groupId: string }) => entry.groupId === group.id).memberConnectionIds).toHaveLength(10)
  expect((await access.manage({ action: 'overview' })).targets.filter(target => target.enabled)).toHaveLength(1)
})
it('provides a group to a single selected member without exposing other member identities or enabling remote targets', async () => {
  const group = create()
  selected = [profiles[0]]
  const access = service.access('single', 1), prompt = await access.prompt()
  expect(prompt).toContain('SHARED_PATH')
  expect(prompt).not.toContain(profiles[1].connectionId)
  expect((await access.manage({ action: 'overview' })).targets).toHaveLength(1)
  expect((await access.manage({ action: 'overview' })).groups?.[0].memberConnectionIds).toEqual([profiles[0].connectionId])
  const listed = await access.call('knowledge_search', { groupId: group.id }, signal())
  expect(listed.isError).toBe(false)
  expect(listed.structuredContent).toMatchObject({ groupId: group.id, documents: [expect.objectContaining({ title: 'Orders production' })] })
  expect((listed.structuredContent as { documents: unknown[] }).documents[0]).not.toHaveProperty('content')
  expect((await access.call('knowledge_search', { connectionId: profiles[1].connectionId }, signal())).structuredContent).toMatchObject({ code: 'KNOWLEDGE_OUT_OF_SCOPE' })
  const environment = await buildAiRequestEnvironment({ workspaceTargets: [{ ...profiles[0], sessionId: 'ssh-one' }], knowledge: access, sshMcpRuntime: {} as SshMcpRuntime })
  expect(environment.localTools.map(tool => tool.function.name)).toEqual(['knowledge_search', 'knowledge_read'])
})
it('never uses a group as the implicit single-server target and rejects ambiguous arguments', async () => {
  const group = create()
  selected = [profiles[0]]
  const access = service.access('single', 1)
  expect((await access.call('knowledge_search', {}, signal())).structuredContent).toMatchObject({ code: 'KNOWLEDGE_DISABLED' })
  expect((await access.call('knowledge_search', { groupId: group.id, connectionId: profiles[0].connectionId }, signal())).structuredContent).toMatchObject({ code: 'KNOWLEDGE_INVALID_INPUT' })
})
it('rejects out-of-group and newly created groups on an existing in-flight access', async () => {
  const group = create([profiles[1].connectionId])
  selected = [profiles[0]]
  const access = service.access('single', 1)
  expect(await access.prompt()).toBe('')
  expect((await access.call('knowledge_search', { groupId: group.id }, signal())).isError).toBe(true)
  const added = create([profiles[0].connectionId])
  expect((await access.call('knowledge_search', { groupId: added.id }, signal())).isError).toBe(true)
  expect(await service.access('next', 1).prompt()).toContain('SHARED_PATH')
})
it('keeps readonly group writes blocked while allowing human edits and revision recovery', async () => {
  const group = create()
  const access = service.access('fixture', 1)
  const doc = (await access.call('knowledge_search', { groupId: group.id }, signal())).structuredContent as { documents: Array<{ id: string }> }
  const id = doc.documents[0].id
  await manage({ action: 'save', groupId: group.id, documentId: id, title: 'Paths', content: 'CHANGED_PATH', expectedRevision: 1 })
  expect((await access.call('knowledge_read', { groupId: group.id, documentId: id }, signal())).structuredContent).toMatchObject({ groupId: group.id, content: 'CHANGED_PATH', revision: 2 })
  expect((await access.call('knowledge_save', { groupId: group.id, documentId: id, title: 'Wrong', content: 'wrong', expectedRevision: 2 }, signal())).structuredContent).toMatchObject({ code: 'KNOWLEDGE_READ_ONLY' })
  await expect(manage({ action: 'save', groupId: group.id, documentId: id, title: 'Stale', content: 'stale', expectedRevision: 1 })).rejects.toThrow('CONFLICT')
  await manage({ action: 'restore', groupId: group.id, documentId: id, revision: 1, expectedRevision: 2 })
  expect((await access.call('knowledge_read', { groupId: group.id, documentId: id }, signal())).structuredContent).toMatchObject({ content: 'SHARED_PATH: /opt/orders', revision: 3 })
})
it('turns group use off independently while retaining manual access and individual knowledge', async () => {
  const group = create()
  await manage({ action: 'setMode', connectionId: profiles[0].connectionId, mode: 'readonly' })
  await manage({ action: 'save', connectionId: profiles[0].connectionId, title: 'Individual', content: 'INDIVIDUAL', alwaysInclude: true, expectedRevision: 0 })
  const access = service.access('fixture', 1)
  await manage({ action: 'setMode', groupId: group.id, mode: 'off' })
  expect(await access.prompt()).not.toContain('SHARED_PATH')
  expect(await access.prompt()).toContain('INDIVIDUAL')
  expect((await access.call('knowledge_search', { groupId: group.id }, signal())).structuredContent).toMatchObject({ code: 'KNOWLEDGE_DISABLED' })
  expect((await manage({ action: 'list', groupId: group.id })).documents).toHaveLength(1)
})

it('enables group saves only in readwrite mode and rechecks mode and revisions on every call', async () => {
  const group = create()
  const access = service.access('fixture', 1)
  const documentId = (await access.manage({ action: 'list', groupId: group.id })).documents![0].id
  await manage({ action: 'setMode', groupId: group.id, mode: 'readwrite' })
  expect(await access.tools!()).toContain('knowledge_save')
  expect(await access.prompt()).toContain('"mode":"readwrite"')
  const args = { groupId: group.id, documentId, expectedRevision: 1, title: 'Shared paths', content: 'Confirmed common path: /srv/orders' }
  expect((await access.call('knowledge_save', args, signal())).structuredContent).toMatchObject({ groupId: group.id, groupName: group.name, memberCount: 10, documentId, revision: 2, saved: true, author: 'ai' })
  expect((await access.call('knowledge_save', args, signal())).structuredContent).toMatchObject({ code: 'KNOWLEDGE_CONFLICT' })
  await manage({ action: 'setMode', groupId: group.id, mode: 'readonly' })
  expect(await access.tools!()).not.toContain('knowledge_save')
  expect((await access.call('knowledge_save', { ...args, expectedRevision: 2 }, signal())).structuredContent).toMatchObject({ code: 'KNOWLEDGE_READ_ONLY' })
  await manage({ action: 'setMode', groupId: group.id, mode: 'off' })
  expect((await access.call('knowledge_save', { ...args, expectedRevision: 2 }, signal())).structuredContent).toMatchObject({ code: 'KNOWLEDGE_DISABLED' })
})

it.each(['readonly', 'ask', 'auto'] as const)('applies global %s execution permissions to group writes without remote operations', async permission => {
  const group = create()
  await manage({ action: 'setMode', groupId: group.id, mode: 'readwrite' })
  const knowledge = service.access('fixture', 1), remote = vi.fn(), send = vi.fn()
  const control = createAiStreamControl(`group-${permission}`, 7)
  const context = { requestId: `group-${permission}`, boundSessionId: 'ssh-one', sshMcpRuntime: { call: remote }, signal: control.controller.signal,
    send, getToolPermission: () => permission, knowledge, availableTools: new Set(['knowledge_save']) } as unknown as AiToolExecutionContext
  const call = { id: 'group-write', type: 'function' as const, function: { name: 'knowledge_save', arguments: JSON.stringify({ groupId: group.id, title: 'Common deployment', content: 'All members use /opt/orders', expectedRevision: 0, risk: 'read', explanation: 'Save the user-confirmed common path for the whole group.' }) } }
  try {
    const waiting = executeAiToolCall(call, context)
    if (permission === 'ask') {
      await vi.waitFor(() => expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'tool', value: expect.objectContaining({ phase: 'ask', risk: 'write', target: expect.stringContaining(group.name) }) })))
      expect((await knowledge.manage({ action: 'list', groupId: group.id })).documents).toHaveLength(1)
      expect(resolveToolApproval(context.requestId, call.id, true, 7)).toBe(true)
    }
    const result = await waiting
    expect(result?.run).toMatchObject({ status: permission === 'readonly' ? 'blocked' : 'done', risk: 'write', target: expect.stringContaining('10') })
    expect((await knowledge.manage({ action: 'list', groupId: group.id })).documents).toHaveLength(permission === 'readonly' ? 1 : 2)
    expect(remote).not.toHaveBeenCalled()
  } finally { control.cleanup() }
})

it.each(['denied', 'membership', 'readonly'] as const)('does not save when a pending group approval becomes %s', async change => {
  const group = create()
  await manage({ action: 'setMode', groupId: group.id, mode: 'readwrite' })
  const knowledge = service.access('fixture', 1), send = vi.fn()
  const control = createAiStreamControl(`group-stale-${change}`, 7)
  const context = { requestId: `group-stale-${change}`, boundSessionId: 'ssh-one', sshMcpRuntime: { call: vi.fn() }, signal: control.controller.signal,
    send, getToolPermission: () => 'ask', knowledge, availableTools: new Set(['knowledge_save']) } as unknown as AiToolExecutionContext
  const call = { id: 'pending-group-write', type: 'function' as const, function: { name: 'knowledge_save', arguments: JSON.stringify({ groupId: group.id, title: 'Pending', content: 'Uncommitted', expectedRevision: 0, risk: 'write', explanation: 'Save shared deployment guidance.' }) } }
  try {
    const waiting = executeAiToolCall(call, context)
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'tool', value: expect.objectContaining({ phase: 'ask' }) })))
    if (change === 'membership') service.groups.manage({ action: 'update', groupId: group.id, expectedRevision: 1, name: group.name, connectionIds: [profiles[0].connectionId] })
    if (change === 'readonly') await manage({ action: 'setMode', groupId: group.id, mode: 'readonly' })
    expect(resolveToolApproval(context.requestId, call.id, change !== 'denied', 7)).toBe(true)
    expect((await waiting)?.run).toMatchObject({ isError: true, status: change === 'denied' ? 'denied' : 'done' })
    expect((await service.groupAccess(group.id).manage({ action: 'list' })).documents).toHaveLength(1)
  } finally { control.cleanup() }
})
it('invalidates in-flight group access and stale document bindings after membership changes', async () => {
  const group = create([profiles[0].connectionId, profiles[1].connectionId])
  const access = service.access('fixture', 1)
  const binding = (await access.manage({ action: 'overview' })).groups![0].binding
  service.groups.manage({ action: 'update', groupId: group.id, expectedRevision: 1, name: 'Renamed', connectionIds: [profiles[0].connectionId] })
  expect(await access.prompt()).not.toContain('SHARED_PATH')
  expect((await access.call('knowledge_search', { groupId: group.id }, signal())).isError).toBe(true)
  await expect(manage({ action: 'save', groupId: group.id, binding, title: 'Stale', content: 'stale', expectedRevision: 0 })).rejects.toThrow('CONFLICT')
  selected = [profiles[1]]
  expect(await service.access('removed-member', 1).prompt()).toBe('')
  selected = [profiles[0]]
  expect(await service.access('retained-member', 1).prompt()).toContain('SHARED_PATH')
})
it('does not inherit group knowledge after endpoint or account changes, and restores it on the original identity', async () => {
  create([profiles[0].connectionId])
  const original = profiles[0]
  for (const patch of [{ host: 'replacement.test' }, { username: 'other' }, { port: 2222 }]) {
    profiles[0] = { ...original, ...patch }; selected = [profiles[0]]
    expect(await service.access('changed', 1).prompt()).toBe('')
  }
  selected = [original]
  expect(await service.access('original', 1).prompt()).toContain('SHARED_PATH')
})
it('rejects duplicate memberships and invalid inputs atomically', () => {
  create([profiles[0].connectionId])
  const before = structuredClone(records)
  expect(() => create([profiles[0].connectionId, profiles[1].connectionId])).toThrow('GROUP_MEMBER_EXISTS')
  expect(() => create(['missing'])).toThrow('OUT_OF_SCOPE')
  expect(() => create([])).toThrow('INVALID_INPUT')
  expect(() => create([profiles[1].connectionId, profiles[1].connectionId])).toThrow('INVALID_INPUT')
  expect(() => create([profiles[1].connectionId], '界'.repeat(12000))).toThrow('INVALID_INPUT')
  expect(records).toEqual(before)
  expect(records.has(knowledgeStorageKey(profiles[0]))).toBe(false)
})
it('deletes shared documents and frees membership while leaving server records intact', async () => {
  const group = create()
  await manage({ action: 'setMode', connectionId: profiles[0].connectionId, mode: 'readonly' })
  const before = records.get(knowledgeStorageKey(profiles[0]))
  expect(() => service.groups.manage({ action: 'delete', groupId: group.id, expectedRevision: 0 })).toThrow('CONFLICT')
  const access = service.access('fixture', 1)
  service.groups.manage({ action: 'delete', groupId: group.id, expectedRevision: 1 })
  expect((await access.call('knowledge_search', { groupId: group.id }, signal())).isError).toBe(true)
  expect(records.get(knowledgeStorageKey(profiles[0]))).toEqual(before)
  expect(service.groups.manage({ action: 'overview' }).groups).toEqual([])
  expect(create().id).not.toBe(group.id)
})

it('retains a stale group edit rather than rebinding a changed profile from an open dialog', () => {
  const expected = structuredClone(profiles[0])
  profiles[0] = { ...profiles[0], host: 'replacement.test' }
  expect(() => service.groups.manage({ action: 'create', name: 'Orders', connectionIds: [expected.connectionId], memberTargets: [expected] })).toThrow('CONFLICT')
  expect(service.groups.list()).toEqual([])
})

it('keeps search and paged reads within the selected group and revision', async () => {
  const group = create([profiles[0].connectionId], 'BEGIN\n' + 'procedure '.repeat(700) + '\nEND')
  const other = create([profiles[1].connectionId], 'OTHER_GROUP')
  selected = [profiles[0]]
  const access = service.access('single', 1)
  const search = (await access.call('knowledge_search', { groupId: group.id, query: 'procedure' }, signal())).structuredContent as { documents: Array<{ id: string }> }
  const documentId = search.documents[0].id
  const first = await access.call('knowledge_read', { groupId: group.id, documentId, length: 100 }, signal())
  expect(first.structuredContent).toMatchObject({ groupId: group.id, revision: 1, nextOffset: 100, complete: false })
  expect((await access.call('knowledge_read', { groupId: other.id, documentId }, signal())).structuredContent).toMatchObject({ code: 'KNOWLEDGE_OUT_OF_SCOPE' })
  await manage({ action: 'save', groupId: group.id, documentId, title: 'Changed', content: 'LATEST', expectedRevision: 1 })
  expect((await access.call('knowledge_read', { groupId: group.id, documentId, offset: 100, expectedRevision: 1 }, signal())).structuredContent).toMatchObject({ code: 'KNOWLEDGE_CONFLICT' })
})

it('routes a shared read through the real tool executor with the group label and no SSH operation', async () => {
  const group = create()
  selected = [profiles[0]]
  const remote = vi.fn()
  const knowledge = service.access('single', 1)
  const documentId = (await knowledge.manage({ action: 'list', groupId: group.id })).documents![0].id
  const context = { requestId: 'group-read', boundSessionId: 'ssh-one', workspaceTargets: [{ ...profiles[0], sessionId: 'ssh-one' }],
    sshMcpRuntime: { call: remote }, signal: signal(), send: vi.fn(), getToolPermission: () => 'auto', knowledge,
    availableTools: new Set(['knowledge_read', 'knowledge_save']) } as unknown as AiToolExecutionContext
  const call = (name: string) => ({ id: 'group-tool', type: 'function' as const, function: { name, arguments: JSON.stringify({ groupId: group.id, documentId, risk: 'read', explanation: 'Read common paths', title: 'Wrong', content: 'wrong', expectedRevision: 1 }) } })
  const result = await executeAiToolCall(call('knowledge_read'), context)
  expect(result?.run).toMatchObject({ target: expect.stringContaining(group.name), status: 'done', isError: false })
  expect(JSON.parse(result!.message.content)).toMatchObject({ groupId: group.id, content: 'SHARED_PATH: /opt/orders' })
  expect((await executeAiToolCall(call('knowledge_save'), context))?.run.isError).toBe(true)
  expect(remote).not.toHaveBeenCalled()
})

it('lets a user maintain group documents offline without exposing any server knowledge or AI access', async () => {
  const group = create([profiles[0].connectionId], '')
  selected = []
  const access = service.groupAccess(group.id)
  expect(Object.keys(access)).toEqual(['manage'])
  const overview = await access.manage({ action: 'overview' })
  expect(overview.targets).toEqual([])
  expect(overview.groups?.map(scope => scope.groupId)).toEqual([group.id])
  const binding = overview.groups![0].binding
  const document = (await access.manage({ action: 'save', binding, title: 'Release procedure', content: 'OFFLINE_SHARED_PROCEDURE', alwaysInclude: true, expectedRevision: 0 })).document!
  expect((await access.manage({ action: 'read', documentId: document.id })).document?.content).toBe('OFFLINE_SHARED_PROCEDURE')
  expect(records.has(knowledgeStorageKey(profiles[0]))).toBe(false)
  selected = [profiles[0]]
  expect(await service.access('next-chat', 1).prompt()).toContain('OFFLINE_SHARED_PROCEDURE')
})

it('constrains offline management to its chosen group and rejects stale membership bindings', async () => {
  const group = create([profiles[0].connectionId])
  const other = create([profiles[1].connectionId])
  const access = service.groupAccess(group.id)
  await expect(access.manage({ action: 'overview', groupId: other.id })).rejects.toThrow('OUT_OF_SCOPE')
  await expect(access.manage({ action: 'list', connectionId: profiles[0].connectionId })).rejects.toThrow('OUT_OF_SCOPE')
  const binding = (await access.manage({ action: 'overview' })).groups![0].binding
  service.groups.manage({ action: 'update', groupId: group.id, expectedRevision: 1, name: group.name, connectionIds: [profiles[2].connectionId] })
  await expect(service.groupAccess(group.id).manage({ action: 'save', binding, title: 'Stale', content: 'wrong scope', expectedRevision: 0 })).rejects.toThrow('CONFLICT')
  expect(() => service.groupAccess('missing')).toThrow('OUT_OF_SCOPE')
})

it('creates an editable business overview and retains old plain knowledge groups unchanged', async () => {
  const group = service.groups.manage({ action: 'create', name: 'Order system', connectionIds: profiles.slice(0, 4).map(profile => profile.connectionId), businessSystem: true, initialContent: 'SYSTEM_PURPOSE: Orders platform' }).group!
  const document = (await service.groupAccess(group.id).manage({ action: 'read', documentId: 'system' })).document!
  expect(document).toMatchObject({ id: 'system', title: 'SYSTEM.md', alwaysInclude: true, revision: 1, system: { description: 'SYSTEM_PURPOSE: Orders platform', nodes: [], dependencies: [] } })
  expect((await service.access('fixture', 1).prompt()).match(/SYSTEM_PURPOSE/g)).toHaveLength(1)
  expect(() => service.groups.manage({ action: 'create', name: 'Too large', connectionIds: [profiles[4].connectionId], businessSystem: true, initialContent: 'x'.repeat(2001) })).toThrow('INVALID_SYSTEM')
})

it('lets AI map a composite system with exact member bindings under normal knowledge modes', async () => {
  const group = create(profiles.slice(0, 4).map(profile => profile.connectionId), '')
  const system = await systemInput(group.id), access = service.access('fixture', 1)
  const args = { groupId: group.id, documentId: 'system', title: 'SYSTEM.md', system, alwaysInclude: true, expectedRevision: 0 }
  expect((await access.call('knowledge_save', args, signal())).structuredContent).toMatchObject({ code: 'KNOWLEDGE_READ_ONLY' })
  await manage({ action: 'setMode', groupId: group.id, mode: 'readwrite' })
  expect((await access.call('knowledge_save', args, signal())).isError).toBe(false)
  const document = (await access.manage({ action: 'read', groupId: group.id, documentId: 'system' })).document!
  expect(document.system).toEqual(system)
  expect(document.author).toBe('ai')
  expect(document.content).toContain('unconfirmed')
  expect((await access.call('knowledge_save', args, signal())).structuredContent).toMatchObject({ code: 'KNOWLEDGE_CONFLICT' })
  const updated = { ...system, description: 'Updated release order' }
  expect((await access.call('knowledge_save', { ...args, system: updated, expectedRevision: 1 }, signal())).isError).toBe(false)
  const restored = await manage({ action: 'restore', groupId: group.id, documentId: 'system', expectedRevision: 2, revision: 1 })
  expect(restored.document?.system).toEqual(system)
  expect(restored.document?.revision).toBe(3)
})

it('rejects system data in ordinary server documents and refuses raw replacement of a system record', async () => {
  const group = create(profiles.slice(0, 4).map(profile => profile.connectionId), '')
  const system = await systemInput(group.id)
  await manage({ action: 'setMode', groupId: group.id, mode: 'readwrite' })
  await manage({ action: 'setMode', connectionId: profiles[0].connectionId, mode: 'readwrite' })
  const access = service.access('fixture', 1)
  for (const args of [{ connectionId: profiles[0].connectionId, documentId: 'system', system }, { groupId: group.id, documentId: 'other', system }, { groupId: group.id, documentId: 'system', content: 'Drop structured roles' }]) {
    const result = await access.call('knowledge_save', { ...args, title: 'SYSTEM.md', expectedRevision: 0 }, signal())
    expect(result.isError).toBe(true)
  }
  expect((await access.manage({ action: 'list', groupId: group.id })).documents).toHaveLength(1) // only the initial empty memory from enablement
})

it('marks changed member bindings stale and never silently reassigns a saved role', async () => {
  const group = create(profiles.slice(0, 4).map(profile => profile.connectionId))
  const system = await systemInput(group.id)
  await manage({ action: 'save', groupId: group.id, documentId: 'system', title: 'SYSTEM.md', system, expectedRevision: 0 })
  profiles[0] = { ...profiles[0], host: 'replacement.test' }; selected = [...profiles]
  const access = service.access('fixture', 1)
  expect((await access.call('knowledge_read', { groupId: group.id, documentId: 'system' }, signal())).structuredContent).toMatchObject({ staleSystemNodes: ['role-0'] })
  await expect(manage({ action: 'save', groupId: group.id, documentId: 'system', title: 'SYSTEM.md', system, expectedRevision: 1 })).rejects.toThrow('SYSTEM_MEMBER_CHANGED')
  service.groups.manage({ action: 'update', groupId: group.id, name: group.name, expectedRevision: 1, connectionIds: profiles.slice(0, 4).map(profile => profile.connectionId) })
  const corrected = await systemInput(group.id)
  expect(corrected.nodes[0].binding).not.toBe(system.nodes[0].binding)
  await manage({ action: 'save', groupId: group.id, documentId: 'system', title: 'SYSTEM.md', system: corrected, expectedRevision: 1 })
  const current = service.access('fixture', 1)
  expect((await current.call('knowledge_read', { groupId: group.id, documentId: 'system' }, signal())).structuredContent).toMatchObject({ staleSystemNodes: [] })
  await manage({ action: 'restore', groupId: group.id, documentId: 'system', revision: 1, expectedRevision: 2 })
  expect((await current.call('knowledge_read', { groupId: group.id, documentId: 'system' }, signal())).structuredContent).toMatchObject({ staleSystemNodes: ['role-0'] })
})

it('pages reference members without expanding the remote operation scope', async () => {
  profiles = Array.from({ length: 50 }, (_, i) => ({ ...profiles[0], connectionId: `member-${i}`, host: `${i}.test` }))
  const group = create()
  selected = [profiles[0]]
  const access = service.access('fixture', 1)
  const first = (await access.call('knowledge_search', { groupId: group.id }, signal())).structuredContent as { members: unknown[]; nextMemberOffset: number; operableConnectionIds: string[] }
  expect(first.members).toHaveLength(20)
  expect(first.operableConnectionIds).toEqual([profiles[0].connectionId])
  expect((await access.call('knowledge_search', { groupId: group.id, memberOffset: 40 }, signal())).structuredContent).toMatchObject({ membersComplete: true, nextMemberOffset: 50 })
  const remote = vi.fn()
  const result = await executeAiToolCall({ id: 'outside-operation', type: 'function', function: { name: 'exec', arguments: JSON.stringify({ connectionId: profiles[49].connectionId, command: 'hostname', risk: 'read', explanation: 'Inspect a reference member' }) } }, {
    requestId: 'outside-operation', boundSessionId: 'ssh-one', workspaceTargets: [{ ...profiles[0], sessionId: 'ssh-one' }], sshMcpRuntime: { call: remote }, signal: signal(), send: vi.fn(), getToolPermission: () => 'auto', availableTools: new Set(['exec']), knowledge: access,
  } as unknown as AiToolExecutionContext)
  expect(result?.run).toMatchObject({ status: 'blocked', isError: true })
  expect(remote).not.toHaveBeenCalled()
})
