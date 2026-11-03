import { randomUUID } from 'node:crypto'
import { KNOWLEDGE_MAX_BYTES, type KnowledgeTarget } from '../../../shared/aiKnowledge'
import { knowledgeGroupConnectionId, type KnowledgeGroup, type KnowledgeGroupRequest, type KnowledgeGroupResponse } from '../../../shared/aiKnowledgeGroups'
import { KnowledgeRepository, type KnowledgeDatabase } from './knowledgeRepository'
import { knowledgeStorageKey } from './knowledgeIdentity'
import { emptyKnowledgeSystem, formatKnowledgeSystem } from '../../../shared/aiKnowledgeSystem'

export type KnowledgeProfileLookup = { get(id: string): KnowledgeTarget | undefined; revision(): unknown }
const GROUPS_KEY = 'ai-knowledge-groups-v1'
function fail(code: string): never { throw new Error(`KNOWLEDGE_${code}`) }
export class KnowledgeGroups {
  private readonly bindings = new WeakMap<KnowledgeTarget, string>()
  private availabilityRevision: unknown
  private readonly availability = new Map<string, boolean>()
  private cached?: { database: KnowledgeDatabase; revision: string; groups: KnowledgeGroup[]; byId: Map<string, KnowledgeGroup>; byMember: Map<string, KnowledgeGroup[]> }
  constructor(private readonly database: () => KnowledgeDatabase, private readonly profiles: () => KnowledgeTarget[], private readonly lookup?: KnowledgeProfileLookup) {}
  private catalog() {
    const database = this.database(), revision = database.getSingletonRevision?.(GROUPS_KEY)
    if (revision !== undefined && this.cached?.database === database && this.cached.revision === revision) return this.cached
    this.availability.clear()
    const groups = database.getSingleton<KnowledgeGroup[]>(GROUPS_KEY) || []
    const byId = new Map(groups.map(group => [group.id, group])), byMember = new Map<string, KnowledgeGroup[]>()
    for (const group of groups) for (const member of group.members) {
      const key = knowledgeStorageKey(member), entries = byMember.get(key) || []
      this.bindings.set(member, key)
      entries.push(group); byMember.set(key, entries)
    }
    const result = { database, revision: revision || '', groups, byId, byMember }
    if (revision !== undefined) this.cached = result
    return result
  }
  list(): KnowledgeGroup[] { return structuredClone(this.catalog().groups) }
  get(id: string): KnowledgeGroup | undefined { return structuredClone(this.catalog().byId.get(id)) }
  visible(targets: KnowledgeTarget[]): KnowledgeTarget[] {
    const keys = new Set(targets.map(knowledgeStorageKey))
    const catalog = this.catalog(), affected = new Set<KnowledgeGroup>()
    for (const key of keys) for (const group of catalog.byMember.get(key) || []) affected.add(group)
    if (!affected.size) return []
    const revision = this.lookup?.revision()
    if (!this.lookup || revision !== this.availabilityRevision) { this.availability.clear(); this.availabilityRevision = revision }
    const profiles = this.lookup ? undefined : new Map(this.profiles().map(profile => [profile.connectionId, profile]))
    const available = (member: KnowledgeTarget) => {
      const key = this.bindings.get(member) || knowledgeStorageKey(member)
      if (this.lookup && this.availability.has(key)) return this.availability.get(key)!
      const profile = this.lookup ? this.lookup.get(member.connectionId) : profiles?.get(member.connectionId)
      const result = !!profile && knowledgeStorageKey(profile) === key
      if (this.lookup) this.availability.set(key, result)
      return result
    }
    return [...affected].sort((a, b) => catalog.groups.indexOf(a) - catalog.groups.indexOf(b)).flatMap(group => {
      const members = group.members.filter(member => keys.has(this.bindings.get(member)!))
      return members.length ? [{ connectionId: knowledgeGroupConnectionId(group.id), groupId: group.id, groupRevision: group.revision,
        name: group.name, host: '', port: 0, username: '', memberConnectionIds: members.map(member => member.connectionId), memberCount: group.members.length,
        systemMembers: group.members.map(member => ({ connectionId: member.connectionId, name: member.name, binding: this.bindings.get(member)!, available: available(member) })) }] : []
    })
  }
  manage(input: KnowledgeGroupRequest): KnowledgeGroupResponse {
    if (!input || typeof input !== 'object') fail('INVALID_INPUT')
    return this.database().transaction(() => {
      let groups = this.list()
      if (input.action === 'overview') return { groups, targets: this.profiles() }
      const previous = groups.find(group => group.id === input.groupId)
      if (input.action !== 'create' && (!previous || previous.revision !== input.expectedRevision)) fail('CONFLICT')
      if (input.action === 'delete') {
        groups = groups.filter(group => group !== previous)
      } else {
        if (!['create', 'update'].includes(input.action) || (input.action === 'create' && (input.groupId !== undefined || (input.expectedRevision ?? 0) !== 0))) fail('INVALID_INPUT')
        const { name, connectionIds, initialContent } = input
        if (input.businessSystem && (initialContent?.length || 0) > 2000) fail('INVALID_SYSTEM')
        if (input.businessSystem !== undefined && (input.action !== 'create' || typeof input.businessSystem !== 'boolean')) fail('INVALID_INPUT')
        if (typeof name !== 'string' || !name.trim() || name.length > 120 || /[\0\r\n]/.test(name) || !Array.isArray(connectionIds) || !connectionIds.length || connectionIds.length > 100 || new Set(connectionIds).size !== connectionIds.length) fail('INVALID_INPUT')
        if (initialContent !== undefined && (input.action !== 'create' || typeof initialContent !== 'string' || initialContent.includes('\0') || Buffer.byteLength(initialContent) > KNOWLEDGE_MAX_BYTES)) fail('INVALID_INPUT')
        const profiles = new Map(this.profiles().map(profile => [profile.connectionId, profile]))
        const members = connectionIds.map(id => {
          const profile = profiles.get(id)
          if (!profile) return fail('OUT_OF_SCOPE')
          // Persist endpoint identities, so editing a saved profile never silently shares old group knowledge.
          return { connectionId: profile.connectionId, name: profile.name, host: profile.host, port: profile.port, username: profile.username }
        })
        if (input.memberTargets !== undefined && (!Array.isArray(input.memberTargets) || input.memberTargets.length !== members.length || members.some((member, i) => {
          const expected = input.memberTargets![i]
          return !expected || typeof expected.host !== 'string' || typeof expected.username !== 'string' || expected.groupId !== undefined || knowledgeStorageKey(expected) !== knowledgeStorageKey(member)
        }))) fail('CONFLICT')
        const keys = new Set(members.map(knowledgeStorageKey))
        if (groups.some(group => group !== previous && group.members.some(member => keys.has(knowledgeStorageKey(member))))) fail('GROUP_MEMBER_EXISTS')
        if (!previous && groups.length >= 100) fail('LIMIT')
        const group: KnowledgeGroup = { id: previous?.id || randomUUID(), name: name.trim(), members, revision: (previous?.revision || 0) + 1 }
        groups = [...groups.filter(item => item !== previous), group]
        if (!previous) {
          const key = knowledgeStorageKey({ ...members[0], groupId: group.id })
          const system = input.businessSystem ? emptyKnowledgeSystem(initialContent || '') : undefined
          new KnowledgeRepository(this.database).initialize(key, { enabled: true, mode: 'readonly', documents: system || initialContent?.trim() ? [{ id: system ? 'system' : randomUUID(), title: system ? 'SYSTEM.md' : group.name, content: system ? formatKnowledgeSystem(system) : initialContent!, ...(system ? { system } : {}), alwaysInclude: true, revision: 1, updatedAt: Date.now(), author: 'user', history: [] }] : [] })
        }
        this.database().setSingleton(GROUPS_KEY, groups)
        return { groups, group }
      }
      // Invalidate deleted group documents without touching any member's own knowledge.
      const key = knowledgeStorageKey({ ...previous!.members[0], groupId: previous!.id })
      new KnowledgeRepository(this.database).initialize(key, { enabled: false, mode: 'off', documents: [] })
      this.database().setSingleton(GROUPS_KEY, groups)
      return { groups }
    })
  }
}
