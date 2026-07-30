import { describe, expect, it } from 'vitest'
import { createHash } from 'crypto'

/** In-memory mirror of KnownHostsStore.verifySync strict policy */
function createInMemoryKnownHosts() {
  const hosts: Record<string, { fingerprint: string }> = {}
  const getKey = (host: string, port: number) => `[${host}]:${port}`
  const computeFingerprint = (keyBuffer: Buffer) => {
    const hash = createHash('sha256').update(keyBuffer).digest('base64')
    return `SHA256:${hash.replace(/=+$/, '')}`
  }
  return {
    computeFingerprint,
    verifySync(host: string, port: number, keyBuffer: Buffer) {
      const key = getKey(host, port)
      const fingerprint = computeFingerprint(keyBuffer)
      const existing = hosts[key]
      if (!existing) {
        return {
          accepted: false,
          fingerprint,
          unknown: true,
          error: `Unknown host key for ${host}:${port}`,
        }
      }
      if (existing.fingerprint === fingerprint) {
        return { accepted: true, fingerprint }
      }
      return {
        accepted: false,
        fingerprint,
        error: `Host key mismatch for ${host}:${port}`,
      }
    },
    updateHostKey(host: string, port: number, keyBuffer: Buffer) {
      const key = getKey(host, port)
      const fingerprint = computeFingerprint(keyBuffer)
      hosts[key] = { fingerprint }
      return fingerprint
    },
    getFingerprint(host: string, port: number) {
      return hosts[getKey(host, port)]?.fingerprint
    },
  }
}

describe('knownHosts strict policy', () => {
  it('rejects unknown key until updateHostKey', () => {
    const store = createInMemoryKnownHosts()
    const key = Buffer.from('server-a-key')
    const first = store.verifySync('host.a', 22, key)
    expect(first.accepted).toBe(false)
    expect(first.unknown).toBe(true)

    store.updateHostKey('host.a', 22, key)
    const second = store.verifySync('host.a', 22, key)
    expect(second.accepted).toBe(true)
  })

  it('rejects changed key and keeps old fingerprint for UI', () => {
    const store = createInMemoryKnownHosts()
    const oldKey = Buffer.from('old-key')
    const newKey = Buffer.from('new-key')
    store.updateHostKey('jump.b', 2222, oldKey)
    const oldFp = store.getFingerprint('jump.b', 2222)
    const result = store.verifySync('jump.b', 2222, newKey)
    expect(result.accepted).toBe(false)
    expect(result.unknown).toBeUndefined()
    expect(result.fingerprint).not.toBe(oldFp)
    expect(store.getFingerprint('jump.b', 2222)).toBe(oldFp)
  })

  it('jump and target keys are independent', () => {
    const store = createInMemoryKnownHosts()
    const jumpKey = Buffer.from('jump')
    const targetKey = Buffer.from('target')
    store.updateHostKey('bastion', 22, jumpKey)
    expect(store.verifySync('bastion', 22, jumpKey).accepted).toBe(true)
    expect(store.verifySync('target', 22, targetKey).accepted).toBe(false)
    store.updateHostKey('target', 22, targetKey)
    expect(store.verifySync('target', 22, targetKey).accepted).toBe(true)
  })
})
