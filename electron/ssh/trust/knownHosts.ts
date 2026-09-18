import { createHash } from 'crypto'
import { COLLECTIONS, getAppDatabase } from '../../store/appDatabase'

export interface HostKeyEntry {
  fingerprint: string
  firstSeen: number
}

export class KnownHostsStore {
  private hosts: Record<string, HostKeyEntry> = {}
  private initialized = false
  private initPromise: Promise<void> | null = null

  async init(): Promise<void> {
    if (this.initialized) return
    if (this.initPromise) return this.initPromise
    this.initPromise = this.load()
    return this.initPromise
  }

  private async load(): Promise<void> {
    const rows = getAppDatabase().getCollection<{
      key: string
      entry: HostKeyEntry
    }>(COLLECTIONS.knownHosts)
    this.hosts = {}
    for (const row of rows) {
      if (row && typeof row.key === 'string' && row.entry) this.hosts[row.key] = row.entry
    }
    this.initialized = true
  }

  private async save(): Promise<void> {
    const rows = Object.entries(this.hosts).map(([key, entry]) => ({ key, entry }))
    getAppDatabase().replaceCollection(COLLECTIONS.knownHosts, rows, (row) => row.key)
  }

  private getKey(host: string, port: number): string {
    return `[${host}]:${port}`
  }

  computeFingerprint(keyBuffer: Buffer): string {
    const hash = createHash('sha256').update(keyBuffer).digest('base64')
    return `SHA256:${hash.replace(/=+$/, '')}`
  }

  /**
   * Strict host-key policy (no TOFU auto-accept):
   * - known + match → accept
   * - unknown → reject (caller must confirm then updateHostKey)
   * - known + mismatch → reject (caller shows old/new fingerprints)
   */
  verifySync(
    host: string,
    port: number,
    keyBuffer: Buffer,
  ): {
    accepted: boolean
    fingerprint: string
    error?: string
    /** true when host was never stored (first contact) */
    unknown?: boolean
  } {
    const key = this.getKey(host, port)
    const fingerprint = this.computeFingerprint(keyBuffer)
    const existing = this.hosts[key]

    if (!existing) {
      return {
        accepted: false,
        fingerprint,
        unknown: true,
        error: `Unknown host key for ${host}:${port} (${fingerprint}). Confirm to trust this host.`,
      }
    }

    if (existing.fingerprint === fingerprint) {
      return { accepted: true, fingerprint }
    }

    return {
      accepted: false,
      fingerprint,
      error: `Host key mismatch for ${host}:${port}. Expected ${existing.fingerprint}, got ${fingerprint}. This may indicate a man-in-the-middle attack.`,
    }
  }

  async verify(host: string, port: number, keyBuffer: Buffer): Promise<{ accepted: boolean; fingerprint: string; error?: string }> {
    await this.init()
    return this.verifySync(host, port, keyBuffer)
  }

  async remove(host: string, port: number): Promise<void> {
    await this.init()
    const key = this.getKey(host, port)
    delete this.hosts[key]
    await this.save()
  }

  /** All trusted host keys for the settings manager UI. */
  async list(): Promise<Array<{ host: string; port: number; fingerprint: string; firstSeen: number }>> {
    await this.init()
    return Object.entries(this.hosts)
      .map(([key, entry]) => {
        const m = key.match(/^\[(.+)\]:(\d+)$/)
        return {
          host: m ? m[1] : key,
          port: m ? Number(m[2]) : 22,
          fingerprint: entry.fingerprint,
          firstSeen: entry.firstSeen,
        }
      })
      .sort((a, b) => a.host.localeCompare(b.host) || a.port - b.port)
  }

  async updateHostKey(host: string, port: number, keyBuffer: Buffer): Promise<string> {
    await this.init()
    const key = this.getKey(host, port)
    const fingerprint = this.computeFingerprint(keyBuffer)
    this.hosts[key] = { fingerprint, firstSeen: Date.now() }
    await this.save()
    return fingerprint
  }

  getFingerprint(host: string, port: number): string | undefined {
    const key = this.getKey(host, port)
    return this.hosts[key]?.fingerprint
  }
}
