import { app } from 'electron'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join, dirname } from 'path'
import { createHash } from 'crypto'

export interface HostKeyEntry {
  fingerprint: string
  firstSeen: number
}

export class KnownHostsStore {
  private hostsPath: string
  private hosts: Record<string, HostKeyEntry> = {}
  private initialized = false
  private initPromise: Promise<void> | null = null

  constructor() {
    const userData = app.getPath('userData')
    this.hostsPath = join(userData, 'known_hosts.json')
  }

  async init(): Promise<void> {
    if (this.initialized) return
    if (this.initPromise) return this.initPromise
    this.initPromise = this.load()
    return this.initPromise
  }

  private async load(): Promise<void> {
    try {
      const data = await readFile(this.hostsPath, 'utf-8')
      const parsed = JSON.parse(data)
      if (parsed && typeof parsed === 'object') {
        this.hosts = parsed
      }
    } catch {
      this.hosts = {}
    }
    this.initialized = true
  }

  private async save(): Promise<void> {
    try {
      await mkdir(dirname(this.hostsPath), { recursive: true })
      await writeFile(this.hostsPath, JSON.stringify(this.hosts, null, 2), 'utf-8')
    } catch (err) {
      console.error('Failed to save known hosts:', err)
    }
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
