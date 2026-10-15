import { randomUUID } from 'crypto'
import type { AiWorkspaceScope, AiWorkspaceTarget } from '../../../shared/aiWorkspace'
import { AI_WORKSPACE_MAX_HOSTS } from '../../../shared/aiWorkspace'
import { getAppDatabase } from '../../store/appDatabase'
import { isValidUUID } from '../../utils/validation'

export const WORKSPACE_SCOPE_KEY = 'ai-workspace-scopes-v1'
export const workspaceHistoryId = (id: string) => `workspace-v1:${id}`

/** Only the main process resolves saved connection ids to window-owned AI SSH sessions. */
export class AiWorkspaceScopes {
  private readonly owners = new Map<string, Set<number | string>>()
  constructor(private readonly ports: {
    read: () => AiWorkspaceScope[]
    write: (scopes: AiWorkspaceScope[]) => void
    resolve: (ownerId: number | string, connectionId: string) => AiWorkspaceTarget | undefined
  }) {}

  list() { return this.ports.read() }
  open(ownerId: number | string, input: { connectionIds?: string[]; id?: string }) {
    const existing = input?.id ? this.list().find(scope => scope.id === input.id) : undefined
    if (input?.id && !existing) throw new Error('AI workspace conversation no longer exists')
    const ids = existing?.connectionIds || input?.connectionIds
    if (!Array.isArray(ids) || !ids.length || ids.length > AI_WORKSPACE_MAX_HOSTS ||
      ids.some(id => !isValidUUID(id)) || new Set(ids).size !== ids.length) throw new Error('Invalid AI workspace scope')
    // Never accept runtime session ids or a partial/fallback scope from the renderer.
    for (const id of ids) if (!this.ports.resolve(ownerId, id)) throw new Error('Connect every selected server before opening this conversation')
    const scope = existing || { id: `workspace:${randomUUID()}`, connectionIds: [...ids], createdAt: Date.now() }
    if (!existing) this.ports.write([...this.list(), scope])
    const owners = this.owners.get(scope.id) || new Set<number | string>()
    owners.add(ownerId)
    this.owners.set(scope.id, owners)
    return { ...scope, connectionIds: [...scope.connectionIds] }
  }
  owned(id: string, ownerId: number | string) {
    const scope = this.list().find(item => item.id === id)
    if (!scope || !this.owners.get(id)?.has(ownerId)) throw new Error('AI workspace conversation is not open in this window')
    return scope
  }
  targets(id: string, ownerId: number | string): AiWorkspaceTarget[] | undefined {
    if (!id.startsWith('workspace:')) return undefined
    return this.owned(id, ownerId).connectionIds.map(connectionId => {
      const target = this.ports.resolve(ownerId, connectionId)
      if (!target) throw new Error('A selected server is disconnected. Reconnect the conversation before continuing.')
      return target
    })
  }
  disposeOwner(ownerId: number | string) {
    for (const owners of this.owners.values()) owners.delete(ownerId)
  }
}

let resolveTarget: (ownerId: number | string, connectionId: string) => AiWorkspaceTarget | undefined = () => undefined
export function configureWorkspaceTargets(resolve: typeof resolveTarget) { resolveTarget = resolve }
export const workspaceScopes = new AiWorkspaceScopes({
  read: () => getAppDatabase().getSingleton<AiWorkspaceScope[]>(WORKSPACE_SCOPE_KEY) || [],
  write: scopes => getAppDatabase().setSingleton(WORKSPACE_SCOPE_KEY, scopes),
  resolve: (ownerId, connectionId) => resolveTarget(ownerId, connectionId),
})
