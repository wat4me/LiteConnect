import { AiKnowledgeService, knowledgeStorageKey } from '../ai/knowledge/knowledgeService'
import { workspaceScopes, workspaceHistoryId } from '../ai/workspace/workspaceScopes'
import type { SSHManager } from '../ssh/manager'
import type { CredentialStore } from '../store/credentialStore'
import { aiSessionKey, getAppDatabase } from '../store/appDatabase'
import { aiHistoryIdForHost } from '../ai/history/historyScope'
import { migrateLegacyKnowledge } from '../ai/knowledge/legacyMigration'

export function createAiKnowledgeService(ssh: Pick<SSHManager, 'getSessionSnapshot'>, credentials: Pick<CredentialStore, 'getConnection' | 'getConnections'>) {
  // Import before AI history can be pruned or rewritten. Scope association comes
  // from saved profiles/workspaces, never from an arbitrary renderer file path.
  const database = getAppDatabase()
  const migrated = new Set<string>()
  const migrateProfile = (profile: NonNullable<ReturnType<CredentialStore['getConnection']>>) => {
    const target = { connectionId: profile.id, name: profile.name, host: profile.host, port: profile.port || 22, username: profile.username }
    const key = knowledgeStorageKey(target)
    if (migrated.has(key)) return
    const claimKey = `ai-knowledge-import-profile-v1:${profile.id}`
    const previous = database.getSingleton<{ targetKey: string }>(claimKey)
    // Old workspace snapshots contain connection IDs, not endpoint identities.
    // Once associated, never reassign them when that profile changes host/user.
    if (previous && previous.targetKey !== key) { migrated.add(key); return }
    const ids = [aiHistoryIdForHost(target.host, target.port), ...workspaceScopes.list().filter(scope => scope.connectionIds.includes(profile.id)).map(scope => workspaceHistoryId(scope.id))]
    database.transaction(() => {
      migrateLegacyKnowledge(database, target, ids.map(id => ({ id, read: () => database.getSingleton(aiSessionKey(id)) })))
      database.setSingleton(claimKey, { targetKey: key })
    })
    migrated.add(key)
  }
  for (const profile of credentials.getConnections()) migrateProfile(profile)
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
      const profile = credentials.getConnection(id)
      if (profile) migrateProfile(profile)
      return profile ? [{ connectionId: profile.id, name: profile.name, host: profile.host, port: profile.port || 22, username: profile.username }] : []
    })
  })
}
