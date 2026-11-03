import { describe, expect, it } from 'vitest'
import { emptyKnowledgeSystem, formatKnowledgeSystem, validateKnowledgeSystem, type KnowledgeSystem } from './aiKnowledgeSystem'
import { layoutKnowledgeSystem } from './aiKnowledgeSystemLayout'

const members = ['a', 'b', 'c', 'd'].map(id => ({ connectionId: id, name: `Server ${id}`, binding: `binding-${id}`, available: true }))
const system = (): KnowledgeSystem => ({ description: 'Orders: gateway → API → database/cache', nodes: members.map(member => ({ id: member.connectionId, connectionId: member.connectionId, binding: member.binding, role: member.name, note: '', status: 'confirmed' })), dependencies: [{ from: 'a', to: 'b', label: 'HTTP', status: 'confirmed' }, { from: 'b', to: 'c', label: 'SQL', status: 'confirmed' }, { from: 'b', to: 'd', label: 'Cache', status: 'unconfirmed' }] })
describe('system knowledge data', () => {
  it('keeps explicit verification status and endpoint bindings in readable exports', () => {
    const value = validateKnowledgeSystem(system(), members)
    expect(value.dependencies[2].status).toBe('unconfirmed')
    expect(formatKnowledgeSystem(value)).toContain('binding-d')
    expect(formatKnowledgeSystem(value)).toContain('| b | d | Cache | unconfirmed |')
    expect(validateKnowledgeSystem(emptyKnowledgeSystem(), members).nodes).toEqual([])
  })
  it('supports more than one service on a server without merging their roles', () => {
    const value = system(); value.nodes[1].connectionId = 'a'; value.nodes[1].binding = 'binding-a'
    expect(validateKnowledgeSystem(value, members).nodes).toHaveLength(4)
  })
  it.each(['unknown-member', 'changed-binding', 'unavailable-member', 'duplicate-id', 'dangling-edge', 'self-edge', 'duplicate-edge', 'bad-status', 'too-many-nodes', 'invalid-id'])('rejects %s without repairing or guessing references', invalid => {
    const value = system(), available = structuredClone(members)
    if (invalid === 'unknown-member') value.nodes[0].connectionId = 'outside'
    if (invalid === 'changed-binding') value.nodes[0].binding = 'other'
    if (invalid === 'unavailable-member') available[0].available = false
    if (invalid === 'duplicate-id') value.nodes[0].id = 'b'
    if (invalid === 'dangling-edge') value.dependencies[0].to = 'outside'
    if (invalid === 'self-edge') value.dependencies[0].to = 'a'
    if (invalid === 'duplicate-edge') value.dependencies.push(value.dependencies[0])
    if (invalid === 'bad-status') value.nodes[0].status = 'guess' as 'confirmed'
    if (invalid === 'too-many-nodes') value.nodes = Array(41).fill(value.nodes[0])
    if (invalid === 'invalid-id') value.nodes[0].id = '<script>'
    expect(() => validateKnowledgeSystem(value, available)).toThrow('KNOWLEDGE_')
  })
})
describe('system diagram layout', () => {
  it('lays out caller and downstream dependencies in separate columns without overlap', () => {
    const layout = layoutKnowledgeSystem(system()), nodes = new Map(layout.nodes.map(node => [node.id, node]))
    expect(nodes.get('a')!.x).toBeLessThan(nodes.get('b')!.x)
    expect(nodes.get('b')!.x).toBeLessThan(nodes.get('c')!.x)
    expect(nodes.get('c')!.x).toBe(nodes.get('d')!.x)
    expect(nodes.get('c')!.y).not.toBe(nodes.get('d')!.y)
    expect(new Set(layout.nodes.map(node => `${node.x},${node.y}`)).size).toBe(4)
  })
  it('handles dependency cycles, disconnected roles and an empty system', () => {
    const value = system(); value.dependencies.push({ from: 'c', to: 'b', label: 'Callback', status: 'unconfirmed' }); value.nodes.push({ id: 'isolated', connectionId: 'd', binding: 'binding-d', role: 'Worker', note: '', status: 'unconfirmed' })
    const layout = layoutKnowledgeSystem(value)
    expect(layout.nodes.every(node => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(true)
    expect(new Set(layout.nodes.map(node => `${node.x},${node.y}`)).size).toBe(5)
    expect(layoutKnowledgeSystem(emptyKnowledgeSystem()).nodes).toEqual([])
  })
})
