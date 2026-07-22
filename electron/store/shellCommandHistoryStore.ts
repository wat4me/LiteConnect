import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join, dirname } from 'path'

export type ShellCommandHistoryItem = {
  command: string
  at: number
}

const MAX_PER_CONNECTION = 200
const MAX_COMMAND_CHARS = 2000
const MAX_CONNECTIONS = 80

type FileShape = {
  version: 1
  byConnection: Record<string, ShellCommandHistoryItem[]>
}

export class ShellCommandHistoryStore {
  private filePath: string
  private byConnection: Record<string, ShellCommandHistoryItem[]> = {}
  private initialized = false
  private initPromise: Promise<void> | null = null
  private saveTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    this.filePath = join(app.getPath('userData'), 'shell-command-history.json')
  }

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
    try {
      const raw = await readFile(this.filePath, 'utf-8')
      const data = JSON.parse(raw) as FileShape
      if (!data || data.version !== 1 || !data.byConnection || typeof data.byConnection !== 'object') {
        this.byConnection = {}
        return
      }
      const next: Record<string, ShellCommandHistoryItem[]> = {}
      for (const [cid, list] of Object.entries(data.byConnection)) {
        if (typeof cid !== 'string' || !Array.isArray(list)) continue
        next[cid] = list
          .filter((x) => x && typeof x.command === 'string' && x.command.trim())
          .map((x) => ({
            command: String(x.command).trim().slice(0, MAX_COMMAND_CHARS),
            at: typeof x.at === 'number' ? x.at : Date.now(),
          }))
          .slice(0, MAX_PER_CONNECTION)
      }
      this.byConnection = next
    } catch {
      this.byConnection = {}
    }
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
      await mkdir(dirname(this.filePath), { recursive: true })
      const payload: FileShape = { version: 1, byConnection: this.byConnection }
      await writeFile(this.filePath, JSON.stringify(payload), 'utf-8')
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
    const cmd = String(command || '')
      .replace(/\r?\n/g, ' ')
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
