import { homedir } from 'os'
import { readFile } from 'fs/promises'
import { resolve } from 'path'
import { parseProxyJumpSpec, parseSshConfig, type ParsedSshHost } from './parseSshConfig'
import type { CredentialStore } from '../../store/credentialStore'

function expandHome(p: string): string {
  const t = p.trim()
  if (t.startsWith('~/') || t.startsWith('~\\')) return resolve(homedir(), t.slice(2))
  if (t === '~') return homedir()
  return t
}

async function readIdentity(filePath: string): Promise<string | undefined> {
  try {
    const buf = await readFile(expandHome(filePath))
    if (buf.length === 0 || buf.length > 256 * 1024) return undefined
    const text = buf.toString('utf8')
    if (!text.includes('BEGIN') || !text.includes('PRIVATE KEY')) return undefined
    return text
  } catch {
    return undefined
  }
}

export async function importParsedHosts(
  hosts: ParsedSshHost[],
  credentialStore: CredentialStore,
): Promise<{ imported: number; skipped: number; total: number }> {
  const existing = credentialStore.getConnections()
  let imported = 0
  let skipped = 0

  for (const host of hosts) {
    const hostname = (host.hostName || host.alias || '').trim()
    const username = (host.user || '').trim()
    if (!hostname || !username) {
      skipped++
      continue
    }
    const port = host.port || 22
    const dup = existing.find(
      (c) => c.host === hostname && c.username === username && (c.port || 22) === port,
    )
    if (dup) {
      skipped++
      continue
    }

    let privateKey: string | undefined
    for (const idFile of host.identityFiles) {
      privateKey = await readIdentity(idFile)
      if (privateKey) break
    }

    let jumpHost: string | undefined
    let jumpPort: number | undefined
    let jumpUsername: string | undefined
    if (host.proxyJump) {
      const spec = parseProxyJumpSpec(host.proxyJump)
      if (spec) {
        jumpHost = spec.host
        jumpPort = spec.port
        jumpUsername = spec.user
      } else {
        jumpHost = host.proxyJump
      }
    }

    try {
      const saved = await credentialStore.saveConnection({
        name: host.alias || hostname,
        host: hostname,
        port,
        username,
        password: '',
        privateKey,
        jumpHost,
        jumpPort,
        jumpUsername,
        x11Forwarding: host.forwardX11 === true,
        localForwards: host.localForwards,
        remoteForwards: host.remoteForwards,
        dynamicForwards: host.dynamicForwards,
      })
      existing.push(saved)
      imported++
    } catch {
      skipped++
    }
  }

  return { imported, skipped, total: hosts.length }
}

export async function readSshConfigFile(filePath: string) {
  const text = await readFile(filePath, 'utf-8')
  return parseSshConfig(text)
}
