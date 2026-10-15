import type { AiWorkspaceConnectionEvent } from '../../../shared/aiWorkspace'
import { isSshHostKeyConfirmationRequired } from '../../../shared/sshHostKeyConfirmation'
import { SSH_CONNECTION_CANCELLED } from '../../../shared/sshConnectionProgress'

type Entry = { ownerId: number; connectionId: string; sessionId?: string; promise?: Promise<string> }
const key = (owner: number, connection: string) => `${owner}:${connection}`

/** Dedicated AI sessions reuse saved profiles, independently of terminal tabs. */
export class AiWorkspaceConnections {
  private readonly entries = new Map<string, Entry>()
  constructor(private readonly ports: {
    hasSession: (sessionId: string) => boolean
    disconnect: (sessionId: string) => void
    cancel: (ownerId: number, connectionId: string) => void
    notify: (ownerId: number, event: AiWorkspaceConnectionEvent) => void
  }) {}

  open(ownerId: number, connectionId: string, connect: () => Promise<string>): Promise<string> {
    const id = key(ownerId, connectionId)
    const existing = this.entries.get(id)
    if (existing?.sessionId && this.ports.hasSession(existing.sessionId)) return Promise.resolve(existing.sessionId)
    if (existing?.promise) return existing.promise
    if (existing && !existing.sessionId) return Promise.reject(new Error('Connection is waiting for host verification'))
    const entry: Entry = { ownerId, connectionId }
    this.entries.set(id, entry)
    const promise = (async () => {
      try {
        const sessionId = await connect()
        if (this.entries.get(id) !== entry) { this.ports.disconnect(sessionId); throw new Error(SSH_CONNECTION_CANCELLED) }
        if (!this.complete(ownerId, connectionId, sessionId)) throw new Error('AI SSH connection closed during startup')
        return sessionId
      } catch (error) {
        if (!isSshHostKeyConfirmationRequired(error) && this.entries.get(id) === entry) this.entries.delete(id)
        throw error
      } finally { entry.promise = undefined }
    })()
    entry.promise = promise
    return promise
  }

  isPending(ownerId: number, connectionId: string) {
    const entry = this.entries.get(key(ownerId, connectionId))
    return !!entry && !entry.sessionId
  }

  sessionFor(ownerId: number, connectionId: string) {
    const id = this.entries.get(key(ownerId, connectionId))?.sessionId
    return id && this.ports.hasSession(id) ? id : undefined
  }

  complete(ownerId: number, connectionId: string, sessionId: string) {
    const entry = this.entries.get(key(ownerId, connectionId))
    if (!entry || !this.ports.hasSession(sessionId)) return false
    entry.sessionId = sessionId
    this.ports.notify(ownerId, { connectionId, sessionId, status: 'connected' })
    return true
  }

  cancel(ownerId: number, connectionId: string) {
    const id = key(ownerId, connectionId)
    const entry = this.entries.get(id)
    if (!entry || entry.sessionId) return
    this.entries.delete(id)
    this.ports.cancel(ownerId, connectionId)
    this.ports.notify(ownerId, { connectionId, status: 'cancelled' })
  }

  close(ownerId: number, sessionId: string) {
    const found = [...this.entries].find(([, entry]) => entry.ownerId === ownerId && entry.sessionId === sessionId)
    if (!found) throw new Error('AI workspace does not own this SSH session')
    this.entries.delete(found[0])
    this.ports.disconnect(sessionId)
    this.ports.notify(ownerId, { connectionId: found[1].connectionId, sessionId, status: 'closed' })
  }

  closed(sessionId: string) {
    for (const [id, entry] of this.entries) {
      if (entry.sessionId !== sessionId) continue
      this.entries.delete(id)
      this.ports.notify(entry.ownerId, { connectionId: entry.connectionId, sessionId, status: 'closed' })
    }
  }

  disposeOwner(ownerId: number) {
    for (const entry of [...this.entries.values()]) {
      if (entry.ownerId !== ownerId) continue
      if (entry.sessionId) this.close(ownerId, entry.sessionId)
      else this.cancel(ownerId, entry.connectionId)
    }
  }
}
