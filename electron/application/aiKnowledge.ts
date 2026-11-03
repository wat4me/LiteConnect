import { AiKnowledgeService, knowledgeStorageKey } from '../ai/knowledge/knowledgeService'
import { workspaceScopes, workspaceHistoryId, WORKSPACE_SCOPE_KEY } from '../ai/workspace/workspaceScopes'
import type { SSHManager } from '../ssh/manager'
import type { CredentialStore } from '../store/credentialStore'
import { aiSessionKey, getAppDatabase } from '../store/appDatabase'
import { aiHistoryIdForHost } from '../ai/history/historyScope'
import { migrateLegacyKnowledge } from '../ai/knowledge/legacyMigration'
import type { KnowledgeTarget } from '../../shared/aiKnowledge'

export function createAiKnowledgeService(ssh: Pick<SSHManager, 'getSessionSnapshot'>, credentials: Pick<CredentialStore, 'getConnection' | 'getConnections'> & Partial<Pick<CredentialStore, 'getKnowledgeProfiles' | 'getKnowledgeProfile' | 'getKnowledgeProfileRevision'>>) {
  // Import before AI history can be pruned or rewritten. Scope association comes
  // from saved profiles/workspaces, never from an arbitrary renderer file path.
  const database = getAppDatabase()
  const migrated = new Set<string>()
  type Profile = Pick<ReturnType<CredentialStore['getConnections']>[number], 'id' | 'name' | 'host' | 'port' | 'username'>
  const allProfiles = () => credentials.getKnowledgeProfiles?.() || credentials.getConnections()
  const getProfile = (id: string) => credentials.getKnowledgeProfile ? credentials.getKnowledgeProfile(id) : credentials.getConnection(id)
  const asTarget = (profile: Profile): KnowledgeTarget => ({ connectionId: profile.id, name: profile.name, host: profile.host, port: profile.port || 22, username: profile.username })
  let scopeRevision: string | undefined, sourceIndex = new Map<string, string[]>()
  const workspaceSources = () => {
    const revision = database.getSingletonRevision(WORKSPACE_SCOPE_KEY)
    if (scopeRevision !== revision) {
      sourceIndex = new Map()
      for (const scope of workspaceScopes.list()) for (const id of scope.connectionIds) {
        const sources = sourceIndex.get(id) || []
        sources.push(workspaceHistoryId(scope.id)); sourceIndex.set(id, sources)
      }
      scopeRevision = revision
    }
    return sourceIndex
  }
  const migrateProfile = (profile: Profile) => {
    const target = asTarget(profile)
    const key = knowledgeStorageKey(target)
    if (migrated.has(key)) return
    const claimKey = `ai-knowledge-import-profile-v1:${profile.id}`
    const previous = database.getSingleton<{ targetKey: string; sources?: string[] }>(claimKey)
    // Old workspace snapshots contain connection IDs, not endpoint identities.
    // Once associated, never reassign them when that profile changes host/user.
    if (previous && previous.targetKey !== key) { migrated.add(key); return }
    const ids = [aiHistoryIdForHost(target.host, target.port), ...(workspaceSources().get(profile.id) || [])]
    if (previous?.sources && JSON.stringify(previous.sources) === JSON.stringify(ids)) { migrated.add(key); return }
    database.transaction(() => {
      migrateLegacyKnowledge(database, target, ids.map(id => ({ id, read: () => database.getSingleton(aiSessionKey(id)) })))
      database.setSingleton(claimKey, { targetKey: key, sources: ids })
    })
    migrated.add(key)
  }
  database.transaction(() => { for (const profile of allProfiles()) migrateProfile(profile) })
  const remembered = new Map<string, string>()
  return new AiKnowledgeService((sessionId, owner) => {
    let ids: string[]
    if (sessionId.startsWith('workspace:')) ids = workspaceScopes.owned(sessionId, owner).connectionIds
    else {
      const id = ssh.getSessionSnapshot(sessionId)?.connectionId || remembered.get(sessionId)
      if (!id) return []
      remembered.set(sessionId, id)
      if (remembered.size > 500) remembered.delete(remembered.keys().next().value!)
      ids = [id]
    }
    return ids.flatMap(id => {
      const profile = getProfile(id)
      if (profile) migrateProfile(profile)
      return profile ? [asTarget(profile)] : []
    })
  }, undefined, undefined, () => allProfiles().map(asTarget), credentials.getKnowledgeProfileRevision ? {
    revision: () => credentials.getKnowledgeProfileRevision!(), get: id => { const profile = getProfile(id); return profile ? asTarget(profile) : undefined },
  } : undefined)
}
