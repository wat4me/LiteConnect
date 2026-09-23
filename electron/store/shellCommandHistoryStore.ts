import { COLLECTIONS, getAppDatabase } from './appDatabase'
import {
  normalizeShellHistoryExcludePatterns,
  shouldStoreShellCommand,
} from '../../shared/shellHistoryPrivacy'

export type ShellCommandHistoryItem = {
  command: string
  at: number
}

const MAX_PER_CONNECTION = 200
const MAX_COMMAND_CHARS = 2000
const MAX_CONNECTIONS = 80

export class ShellCommandHistoryStore {
  private byConnection: Record<string, ShellCommandHistoryItem[]> = {}
  private initialized = false
  private initPromise: Promise<void> | null = null
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private excludePatterns: string[] = []

  async init(): Promise<void> {
    if (this.initialized) return
    if (!this.initPromise) {
      this.initPromise = this.load().then(() => {
        this.initialized = true
      })
    }
    await this.initPromise
  }

  private async load(): Promise<void> {
    const records = getAppDatabase().getCollection<{
      connectionId: string
      items: ShellCommandHistoryItem[]
    }>(COLLECTIONS.shellCommandHistory)
    const next: Record<string, ShellCommandHistoryItem[]> = {}
    let removedUnsafeItem = false
    for (const record of records) {
      if (!record || typeof record.connectionId !== 'string' || !Array.isArray(record.items)) continue
      next[record.connectionId] = record.items
        .filter((item) => item && typeof item.command === 'string' && item.command.trim())
        .filter((item) => {
          const keep = shouldStoreShellCommand(item.command)
          if (!keep) removedUnsafeItem = true
          return keep
        })
        .map((item) => ({
          command: String(item.command).trim().slice(0, MAX_COMMAND_CHARS),
          at: typeof item.at === 'number' ? item.at : Date.now(),
        }))
        .slice(0, MAX_PER_CONNECTION)
    }
    this.byConnection = next
    if (removedUnsafeItem) this.scheduleSave()
  }

  setExcludePatterns(patterns: unknown): void {
    const nextPatterns = normalizeShellHistoryExcludePatterns(patterns)
    if (
      nextPatterns.length === this.excludePatterns.length
      && nextPatterns.every((pattern, index) => pattern === this.excludePatterns[index])
    ) return
    this.excludePatterns = nextPatterns

    let changed = false
    for (const [connectionId, items] of Object.entries(this.byConnection)) {
      const safeItems = items.filter((item) => shouldStoreShellCommand(item.command, this.excludePatterns))
      if (safeItems.length !== items.length) {
        changed = true
        if (safeItems.length) this.byConnection[connectionId] = safeItems
        else delete this.byConnection[connectionId]
      }
    }
    if (changed) this.scheduleSave()
  }

  private scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.save()
    }, 400)
  }

  private async save(): Promise<void> {
    try {
      const records = Object.entries(this.byConnection).map(([connectionId, items]) => ({
        connectionId,
        items,
      }))
      getAppDatabase().replaceCollection(
        COLLECTIONS.shellCommandHistory,
        records,
        (record) => record.connectionId,
      )
    } catch (err) {
      console.error('[ShellCommandHistory] save failed:', err)
    }
  }

  list(connectionId: string): ShellCommandHistoryItem[] {
    if (!connectionId) return []
    return [...(this.byConnection[connectionId] || [])]
  }

  async push(connectionId: string, command: string): Promise<ShellCommandHistoryItem[]> {
    await this.init()
    if (!connectionId || typeof connectionId !== 'string') return []
    const raw = String(command || '').replace(/\r?\n/g, ' ')
    if (!shouldStoreShellCommand(raw, this.excludePatterns)) return this.list(connectionId)
    const cmd = raw
      .trim()
      .slice(0, MAX_COMMAND_CHARS)
    if (!cmd) return this.list(connectionId)

    const prev = this.byConnection[connectionId] || []
    const item: ShellCommandHistoryItem = { command: cmd, at: Date.now() }
    const next = [item, ...prev.filter((h) => h.command !== cmd)].slice(0, MAX_PER_CONNECTION)
    this.byConnection[connectionId] = next

    // Bound total connections stored
    const keys = Object.keys(this.byConnection)
    if (keys.length > MAX_CONNECTIONS) {
      const scored = keys.map((k) => {
        const latest = this.byConnection[k]?.[0]?.at || 0
        return { k, latest }
      })
      scored.sort((a, b) => a.latest - b.latest)
      const drop = scored.slice(0, keys.length - MAX_CONNECTIONS)
      for (const d of drop) delete this.byConnection[d.k]
    }

    this.scheduleSave()
    return [...next]
  }

  async clear(connectionId?: string): Promise<void> {
    await this.init()
    if (connectionId) {
      delete this.byConnection[connectionId]
    } else {
      this.byConnection = {}
    }
    this.scheduleSave()
  }
}
