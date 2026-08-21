import { randomUUID } from 'crypto'
import type { MonitorCollector } from '../ssh/monitor/monitor'
import type { SSHManager } from '../ssh/manager'
import type { CredentialStore } from '../store/credentialStore'
import { requestRendererConnect } from './connectBridge'
import { createSshMcpRuntime, type SshMcpRuntime } from './runtime'
import type { SshMcpApprovalFn } from './ports'
import type { ApprovalMode } from '../../shared/mcp/types'
import { broadcast, clearSessionOwner } from '../window/windowRegistry'

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
        credentialStore.getConnections().map((c) => ({
          id: c.id,
          name: c.name,
          host: c.host,
          port: c.port,
          username: c.username,
          group: c.group,
        })),
      listGroups: () =>
        credentialStore.getGroups().map((g) => ({
          id: g.id,
          name: g.name,
        })),
    },
    metrics: {
      getCached: (sessionId) => monitorCollector.getCached(sessionId),
    },
    approvalMode: extras?.approvalMode,
    requestApproval: extras?.requestApproval,
  })
}
