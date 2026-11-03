export const SYSTEM_DOCUMENT_ID = 'system'
export const SYSTEM_MAX_NODES = 40
export const SYSTEM_MAX_DEPENDENCIES = 80
export type KnowledgeSystemStatus = 'confirmed' | 'unconfirmed'
export type KnowledgeSystemMember = { connectionId: string; name: string; binding: string; available: boolean }
export type KnowledgeSystemNode = { id: string; connectionId: string; binding: string; role: string; note: string; status: KnowledgeSystemStatus }
export type KnowledgeSystemDependency = { from: string; to: string; label: string; status: KnowledgeSystemStatus }
export type KnowledgeSystem = { description: string; nodes: KnowledgeSystemNode[]; dependencies: KnowledgeSystemDependency[] }
export const emptyKnowledgeSystem = (description = ''): KnowledgeSystem => ({ description, nodes: [], dependencies: [] })

function fail(code = 'INVALID_SYSTEM'): never { throw new Error(`KNOWLEDGE_${code}`) }
function text(value: unknown, limit: number, empty = false): string {
  if (typeof value !== 'string' || value.length > limit || value.includes('\0') || (!empty && !value.trim())) fail()
  return value.trim()
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail()
  return value as Record<string, unknown>
}
function status(value: unknown): KnowledgeSystemStatus {
  if (value !== 'confirmed' && value !== 'unconfirmed') fail()
  return value
}
export function validateKnowledgeSystem(value: unknown, members: KnowledgeSystemMember[]): KnowledgeSystem {
  const input = record(value)
  if (!Array.isArray(input.nodes) || input.nodes.length > SYSTEM_MAX_NODES || !Array.isArray(input.dependencies) || input.dependencies.length > SYSTEM_MAX_DEPENDENCIES) fail()
  const nodes = input.nodes.map(raw => {
    const node = record(raw), id = text(node.id, 64), connectionId = text(node.connectionId, 100), binding = text(node.binding, 240)
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) fail()
    const member = members.find(member => member.connectionId === connectionId)
    if (!member) fail('OUT_OF_SCOPE')
    if (member.binding !== binding || !member.available) fail('SYSTEM_MEMBER_CHANGED')
    return { id, connectionId, binding, role: text(node.role, 80), note: text(node.note ?? '', 300, true), status: status(node.status) }
  })
  const ids = new Set(nodes.map(node => node.id))
  if (ids.size !== nodes.length) fail()
  const seen = new Set<string>()
  const dependencies = input.dependencies.map(raw => {
    const edge = record(raw), from = text(edge.from, 64), to = text(edge.to, 64), key = JSON.stringify([from, to])
    if (!ids.has(from) || !ids.has(to) || from === to || seen.has(key)) fail()
    seen.add(key)
    return { from, to, label: text(edge.label ?? '', 120, true), status: status(edge.status) }
  })
  return { description: text(input.description ?? '', 2000, true), nodes, dependencies }
}

/** Stable Markdown also carries identity bindings so paged AI reads can reconstruct the exact data. */
export function formatKnowledgeSystem(system: KnowledgeSystem): string {
  const cell = (value: string) => value.replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ')
  return [system.description, '## Services / roles', '| ID | Role | Connection ID | Identity binding | Status | Notes |', '| --- | --- | --- | --- | --- | --- |',
    ...system.nodes.map(node => `| ${[node.id, node.role, node.connectionId, node.binding, node.status, node.note].map(cell).join(' | ')} |`),
    '## Dependencies', '| From | To | Purpose | Status |', '| --- | --- | --- | --- |',
    ...system.dependencies.map(edge => `| ${[edge.from, edge.to, edge.label, edge.status].map(cell).join(' | ')} |`)].join('\n')
}

export const knowledgeSystemSchema = {
  type: 'object', additionalProperties: false, required: ['description', 'nodes', 'dependencies'],
  properties: {
    description: { type: 'string', maxLength: 2000, description: 'System purpose, public entry point, release order and troubleshooting guidance. No secrets.' },
    nodes: { type: 'array', maxItems: SYSTEM_MAX_NODES, items: { type: 'object', additionalProperties: false, required: ['id', 'connectionId', 'binding', 'role', 'status'], properties: {
      id: { type: 'string', pattern: '^[a-zA-Z0-9_-]+$', maxLength: 64 }, connectionId: { type: 'string' },
      binding: { type: 'string', description: 'Exact member binding from knowledge_search on this group; never invent or reuse a changed endpoint binding.' },
      role: { type: 'string', maxLength: 80 }, note: { type: 'string', maxLength: 300 }, status: { type: 'string', enum: ['confirmed', 'unconfirmed'] },
    } } },
    dependencies: { type: 'array', maxItems: SYSTEM_MAX_DEPENDENCIES, items: { type: 'object', additionalProperties: false, required: ['from', 'to', 'status'], properties: {
      from: { type: 'string', description: 'Calling service node ID.' }, to: { type: 'string', description: 'Dependency node ID.' }, label: { type: 'string', maxLength: 120 }, status: { type: 'string', enum: ['confirmed', 'unconfirmed'] },
    } } },
  },
}
