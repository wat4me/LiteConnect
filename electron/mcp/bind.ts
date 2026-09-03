import { randomUUID } from 'crypto'
import type { MonitorCollector } from '../ssh/monitor/monitor'
import type { SSHManager } from '../ssh/manager'
import type { CredentialStore } from '../store/credentialStore'
import { requestRendererConnect } from './connectBridge'
import { createSshMcpRuntime, type SshMcpRuntime } from './runtime'
import type { SshMcpApprovalFn, SshMcpSaveConnectionDraft } from './ports'
import type { ApprovalMode } from '../../shared/mcp/types'
import { broadcast, clearSessionOwner } from '../window/windowRegistry'
import { matchExistingSavedConnection } from './saveConnectionInput'

function publicConnectionFields(c: { id: string; name: string; host: string; port: number; username: string; group?: string }) {
  return {
    id: c.id,
    name: c.name,
    host: c.host,
    port: c.port,
    username: c.username,
    group: c.group,
  }
}

function resolveGroupId(credentialStore: CredentialStore, raw?: string): string | undefined {
  const token = raw?.trim()
  if (!token) return undefined
  const groups = credentialStore.getGroups()
  if (groups.some((g) => g.id === token)) return token
  const exact = groups.filter((g) => g.name === token)
  if (exact.length === 1) return exact[0].id
  const lowered = token.toLowerCase()
  const fuzzy = groups.filter((g) => g.name.toLowerCase() === lowered)
  if (fuzzy.length === 1) return fuzzy[0].id
  return undefined
}

async function saveDraftConnection(
  credentialStore: CredentialStore,
  draft: SshMcpSaveConnectionDraft,
) {
  const existing = credentialStore.getConnections().map((c) => publicConnectionFields(c))
  const match = matchExistingSavedConnection(existing, draft)
  if (match.kind === 'name-taken') {
    throw new Error('CONNECTION_NAME_TAKEN')
  }
  if (match.kind === 'reuse') {
    const row = existing.find((c) => c.id === match.id)!
    return { ...row, created: false as const }
  }
  const saved = await credentialStore.saveConnection({
    name: draft.name,
    host: draft.host,
    port: draft.port,
    username: draft.username,
    password: draft.password,
    privateKey: draft.privateKey,
    useAgent: draft.useAgent,
    group: resolveGroupId(credentialStore, draft.group),
    note: draft.note,
  })
  broadcast('mcp:connectionsChanged')
  return { ...publicConnectionFields(saved), created: true as const }
}

export function bindSshMcpRuntime(
  sshManager: SSHManager,
  credentialStore: CredentialStore,
  monitorCollector: MonitorCollector,
  extras?: { approvalMode?: ApprovalMode; requestApproval?: SshMcpApprovalFn },
): SshMcpRuntime {
  return createSshMcpRuntime({
    ssh: {
      listSessionSnapshots: () => sshManager.listSessionSnapshots(),
      getSessionSnapshot: (id) => sshManager.getSessionSnapshot(id),
      getSessionGeneration: (id) => sshManager.getSessionGeneration(id),
      executeSessionExec: (id, command, generation, timeoutMs, opts) =>
        sshManager.executeSessionExec(id, command, generation, timeoutMs, opts),
      beginSessionExec: (id, command, generation, timeoutMs, opts) =>
        sshManager.beginSessionExec(id, command, generation, timeoutMs, opts),
      initSftp: (id) => sshManager.initSftp(id),
      sftpReaddir: (id, path) => sshManager.sftpReaddir(id, path),
      sftpReadFile: (id, path, maxBytes) => sshManager.sftpReadFile(id, path, maxBytes),
      sftpReadFileRange: (id, path, offset, length) => sshManager.sftpReadFileRange(id, path, offset, length),
      sftpWriteFile: (id, path, content, maxBytes) => sshManager.sftpWriteFile(id, path, content, maxBytes),
      sftpWriteBuffer: (id, path, buffer) => sshManager.sftpWriteBuffer(id, path, buffer),
      sftpDownload: (id, remotePath, localPath) =>
        sshManager.sftpDownload(id, remotePath, localPath, `mcp-dl-${randomUUID()}`, () => {}, {
          keepPartial: false,
        }),
      sftpUpload: (id, localPath, remotePath) =>
        sshManager.sftpUpload(id, localPath, remotePath, `mcp-ul-${randomUUID()}`, () => {}, {
          keepPartial: false,
        }),
      sftpStat: (id, path) => sshManager.sftpStat(id, path),
      connectSaved: async (connectionId) => {
        const existing = sshManager.listSessionSnapshots().find((s) => s.connectionId === connectionId)
        if (existing) return { sessionId: existing.sessionId, reused: true }
        const sessionId = await requestRendererConnect(connectionId)
        return { sessionId, reused: false }
      },
      disconnectSession: (sessionId) => {
        sshManager.disconnect(sessionId)
        clearSessionOwner(sessionId)
        broadcast(`ssh:closed:${sessionId}`)
        broadcast('mcp:closeSession', sessionId)
      },
      openShellChannel: (id, generation, opts) => sshManager.openShellChannel(id, generation, opts),
      onSessionTeardown: (cb) => sshManager.registerSessionTeardownHook(cb),
    },
    connections: {
      listPublicConnections: () =>
        credentialStore.getConnections().map((c) => publicConnectionFields(c)),
      listGroups: () =>
        credentialStore.getGroups().map((g) => ({
          id: g.id,
          name: g.name,
        })),
      saveConnection: (draft) => saveDraftConnection(credentialStore, draft),
    },
    metrics: {
      getCached: (sessionId) => monitorCollector.getCached(sessionId),
    },
    approvalMode: extras?.approvalMode,
    requestApproval: extras?.requestApproval,
  })
}
