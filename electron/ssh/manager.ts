import { KnownHostsStore } from './trust/knownHosts'
import { ConnectionService } from './connectionService'
import { SftpSession } from './sftp/sftpSession'
import { TransferRunner } from './transfer/transferRunner'
import { closeLocalForwardServers } from './localForwards'
import { destroyX11Sockets } from './x11/x11'
import { t } from '../i18n'
import type {
  Connection,
  FileEntry,
  PendingHostKey,
  Session,
  DirTransferOptions,
  DirTransferProgressStats,
  DirTransferResult,
  SftpTransferOptions,
  SSHCallbacks,
  TransferConflictStrategy,
} from './types'

export type {
  FileEntry,
  TransferConflictStrategy,
  SftpTransferOptions,
  DirTransferOptions,
  DirTransferProgressStats,
  DirTransferResult,
  HostKeyVerifyResult,
  HostKeyVerifier,
  PendingHostKey,
} from './types'

export class SSHManager {
  private sessions: Map<string, Session> = new Map()
  private decoders: Map<string, TextDecoder> = new Map()
  private knownHosts: KnownHostsStore
  /**
   * Per-session connection generation. Bumped on connect/reconnect/disconnect so
   * late close/error from a torn-down client never notifies the renderer.
   */
  private sessionEpoch = new Map<string, number>()
  private pendingHostKeys: Map<string, PendingHostKey> = new Map()
  /** Session teardown listeners for main-process integrations. Not exposed to renderer. */
  private sessionTeardownHooks = new Set<(sessionId: string) => void>()

  private connection: ConnectionService
  private sftp: SftpSession
  private transfers: TransferRunner

  private bumpSessionEpoch(sessionId: string): number {
    const next = (this.sessionEpoch.get(sessionId) || 0) + 1
    this.sessionEpoch.set(sessionId, next)
    return next
  }

  private getSessionEpoch(sessionId: string): number {
    return this.sessionEpoch.get(sessionId) || 0
  }

  /** Public read of session generation for main-process integration guards. */
  getSessionGeneration(sessionId: string): number {
    return this.getSessionEpoch(sessionId)
  }

  /**
   * Register a hook invoked when a session is cleaned up (disconnect / reconnect / quit).
   * Returns unsubscribe. Hooks must be idempotent and must not throw.
   */
  registerSessionTeardownHook(hook: (sessionId: string) => void): () => void {
    this.sessionTeardownHooks.add(hook)
    return () => {
      this.sessionTeardownHooks.delete(hook)
    }
  }

  private notifySessionTeardown(sessionId: string): void {
    for (const hook of this.sessionTeardownHooks) {
      try {
        hook(sessionId)
      } catch {}
    }
  }

  /**
   * Open a controlled OpenSSH StreamLocal channel on the session's client.
   * Does not expose the sessions Map. Rejects when session is gone or generation is stale.
    * Socket path is supplied only by trusted main-process integrations.
   */
  openStreamLocal(
    sessionId: string,
    remoteSocketPath: string,
    generation: number,
  ): Promise<NodeJS.ReadWriteStream> {
    if (!remoteSocketPath || typeof remoteSocketPath !== 'string') {
      return Promise.reject(new Error('Invalid remote socket path'))
    }
    if (this.getSessionEpoch(sessionId) !== generation) {
      return Promise.reject(new Error('SSH session generation changed'))
    }
    const session = this.sessions.get(sessionId)
    if (!session?.client) {
      return Promise.reject(new Error('SSH session not connected'))
    }
    const client = session.client
    return new Promise((resolve, reject) => {
      // Re-check generation before channel open callback can race reconnect
      if (this.getSessionEpoch(sessionId) !== generation || this.sessions.get(sessionId) !== session) {
        reject(new Error('SSH session generation changed'))
        return
      }
      try {
        client.openssh_forwardOutStreamLocal(remoteSocketPath, (err, stream) => {
          if (this.getSessionEpoch(sessionId) !== generation || this.sessions.get(sessionId) !== session) {
            try {
              stream?.destroy?.()
            } catch {}
            try {
              stream?.close?.()
            } catch {}
            reject(new Error('SSH session generation changed'))
            return
          }
          if (err || !stream) {
            reject(err instanceof Error ? err : new Error(err ? String(err) : 'StreamLocal open failed'))
            return
          }
          resolve(stream)
        })
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  /**
   * Open a non-PTY exec channel for a command selected by trusted main-process code.
   * This primitive is not exposed through renderer IPC. It verifies session generation
   * before and after channel creation and destroys a late stale channel.
   */
  openExecChannel(
    sessionId: string,
    command: string,
    generation: number,
    onOpened?: (channel: NodeJS.ReadWriteStream) => void,
  ): Promise<NodeJS.ReadWriteStream> {
    if (!command || typeof command !== 'string') return Promise.reject(new Error('Invalid exec command'))
    if (this.getSessionEpoch(sessionId) !== generation) return Promise.reject(new Error('SSH session generation changed'))
    const session = this.sessions.get(sessionId)
    if (!session?.client) return Promise.reject(new Error('SSH session not connected'))
    return new Promise((resolve, reject) => {
      if (this.getSessionEpoch(sessionId) !== generation || this.sessions.get(sessionId) !== session) {
        reject(new Error('SSH session generation changed'))
        return
      }
      try {
        session.client.exec(command, { pty: false }, (err, channel) => {
          if (this.getSessionEpoch(sessionId) !== generation || this.sessions.get(sessionId) !== session) {
            try { channel?.destroy?.() } catch {}
            try { channel?.close?.() } catch {}
            reject(new Error('SSH session generation changed'))
            return
          }
          if (err || !channel) {
            reject(err instanceof Error ? err : new Error(err ? String(err) : 'Exec channel open failed'))
            return
          }
          try {
            onOpened?.(channel)
          } catch (setupError) {
            try { channel.destroy?.() } catch {}
            try { channel.close?.() } catch {}
            reject(setupError instanceof Error ? setupError : new Error(String(setupError)))
            return
          }
          resolve(channel)
        })
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  /** Execute a trusted main-process command and reject if its session goes stale. */
  async executeSessionCommand(sessionId: string, command: string, generation: number, timeoutMs = 10000): Promise<string> {
    if (this.getSessionEpoch(sessionId) !== generation || !this.sessions.has(sessionId)) {
      throw new Error('SSH session generation changed')
    }
    const output = await this.sftpExec(sessionId, command, timeoutMs)
    if (this.getSessionEpoch(sessionId) !== generation || !this.sessions.has(sessionId)) {
      throw new Error('SSH session generation changed')
    }
    return output
  }
  constructor(knownHosts?: KnownHostsStore) {
    this.knownHosts = knownHosts ?? new KnownHostsStore()
    this.connection = new ConnectionService({
      sessions: this.sessions,
      decoders: this.decoders,
      knownHosts: this.knownHosts,
      pendingHostKeys: this.pendingHostKeys,
      cleanupSession: (id) => this.cleanupSession(id),
      bumpSessionEpoch: (id) => this.bumpSessionEpoch(id),
      getSessionEpoch: (id) => this.getSessionEpoch(id),
    })
    this.sftp = new SftpSession((id) => this.sessions.get(id))
    this.transfers = new TransferRunner(
      (id) => this.sessions.get(id),
      {
        initSftp: (id) => this.sftp.initSftp(id),
        sftpReaddir: (id, p) => this.sftp.sftpReaddir(id, p),
        sftpExists: (id, p) => this.sftp.sftpExists(id, p),
        sftpMkdir: (id, p) => this.sftp.sftpMkdir(id, p),
      },
    )
  }

  private cleanupSession(sessionId: string) {
    // Main-process session integrations must drop resources before client is gone.
    this.notifySessionTeardown(sessionId)
    this.transfers.cancelTransfersForSession(sessionId)
    const decoder = this.decoders.get(sessionId)
    if (decoder) {
      decoder.decode(new Uint8Array(), { stream: false })
      this.decoders.delete(sessionId)
    }
    const session = this.sessions.get(sessionId)
    if (session?.sftp) {
      try {
        session.sftp.end()
      } catch {}
    }
    if (session?.localForwardServers) {
      closeLocalForwardServers(session.localForwardServers as any)
    }
    if (session?.jumpClient) {
      try {
        session.jumpClient.end()
      } catch {}
    }
    destroyX11Sockets(session?.x11Sockets)
    this.sessions.delete(sessionId)
    this.sftp.clearInitPromise(sessionId)
  }

  async connect(connection: Connection, callbacks: SSHCallbacks): Promise<string> {
    return this.connection.connect(connection, callbacks)
  }

  disconnect(sessionId: string) {
    // Invalidate any in-flight client so late close/error is ignored
    this.bumpSessionEpoch(sessionId)
    const session = this.sessions.get(sessionId)
    if (session) {
      this.cleanupSession(sessionId)
      try {
        session.client.end()
      } catch {}
    }
  }

  /**
   * Re-open SSH + shell under the same sessionId so the renderer keeps its
   * TerminalTab / SFTP state (in-place reconnect).
   */
  async reconnect(
    sessionId: string,
    connection: Connection,
    callbacks: SSHCallbacks,
  ): Promise<string> {
    return this.connection.reconnect(sessionId, connection, callbacks)
  }

  forceDisconnectAll() {
    this.transfers.cancelAll()

    for (const [sessionId, session] of [...this.sessions.entries()]) {
      // Bump first so late close/error never notifies renderer
      this.bumpSessionEpoch(sessionId)
      // Unified path: local forwards (with sockets), jump, sftp, x11, decoder
      this.cleanupSession(sessionId)
      try {
        session.stream.close()
      } catch {}
      try {
        session.client.destroy()
      } catch {}
    }
  }

  write(sessionId: string, data: string): boolean {
    const session = this.sessions.get(sessionId)
    if (session?.stream.writable) {
      session.stream.write(data)
      return true
    }
    return false
  }

  resize(sessionId: string, cols: number, rows: number): boolean {
    const session = this.sessions.get(sessionId)
    if (session?.stream.writable) {
      session.stream.setWindow(rows, cols, 0, 0)
      return true
    }
    return false
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  measureLatency(sessionId: string): Promise<number> {
    return this.sftp.measureLatency(sessionId)
  }

  async initSftp(sessionId: string): Promise<void> {
    return this.sftp.initSftp(sessionId)
  }

  async sftpReaddir(sessionId: string, remotePath: string): Promise<FileEntry[]> {
    return this.sftp.sftpReaddir(sessionId, remotePath)
  }

  async sftpRealpath(sessionId: string, remotePath: string): Promise<string> {
    return this.sftp.sftpRealpath(sessionId, remotePath)
  }

  sftpExists(sessionId: string, remotePath: string): Promise<boolean> {
    return this.sftp.sftpExists(sessionId, remotePath)
  }

  sftpDownload(
    sessionId: string,
    remotePath: string,
    localPath: string,
    transferId: string,
    onProgress: (transferred: number, total: number) => void,
    options?: SftpTransferOptions,
  ): Promise<void> {
    return this.transfers.sftpDownload(
      sessionId,
      remotePath,
      localPath,
      transferId,
      onProgress,
      options,
    )
  }

  sftpUpload(
    sessionId: string,
    localPath: string,
    remotePath: string,
    transferId: string,
    onProgress: (transferred: number, total: number) => void,
    options?: SftpTransferOptions,
  ): Promise<void> {
    return this.transfers.sftpUpload(
      sessionId,
      localPath,
      remotePath,
      transferId,
      onProgress,
      options,
    )
  }

  cancelTransfer(transferId: string) {
    this.transfers.cancelTransfer(transferId)
  }

  async sftpExtractArchive(
    sessionId: string,
    remotePath: string,
    timeoutMs = 120000,
  ): Promise<string> {
    return this.sftp.sftpExtractArchive(sessionId, remotePath, timeoutMs)
  }

  async sftpReadFile(
    sessionId: string,
    remotePath: string,
    maxBytes = 5 * 1024 * 1024,
  ): Promise<string> {
    return this.sftp.sftpReadFile(sessionId, remotePath, maxBytes)
  }

  async sftpWriteFile(
    sessionId: string,
    remotePath: string,
    content: string,
    maxBytes = 5 * 1024 * 1024,
  ): Promise<void> {
    return this.sftp.sftpWriteFile(sessionId, remotePath, content, maxBytes)
  }

  async sftpRename(sessionId: string, oldPath: string, newPath: string): Promise<void> {
    return this.sftp.sftpRename(sessionId, oldPath, newPath)
  }

  async sftpMkdir(sessionId: string, remotePath: string): Promise<void> {
    return this.sftp.sftpMkdir(sessionId, remotePath)
  }

  async sftpUnlink(sessionId: string, remotePath: string): Promise<void> {
    return this.sftp.sftpUnlink(sessionId, remotePath)
  }

  async sftpRmdir(sessionId: string, remotePath: string): Promise<void> {
    return this.sftp.sftpRmdir(sessionId, remotePath)
  }

  async sftpDelete(sessionId: string, remotePath: string, isDirectory: boolean): Promise<void> {
    return this.sftp.sftpDelete(sessionId, remotePath, isDirectory)
  }

  async sftpDownloadDirectory(
    sessionId: string,
    remotePath: string,
    localPath: string,
    transferId: string,
    onProgress: (
      transferred: number,
      total: number,
      stats?: DirTransferProgressStats,
    ) => void,
    options?: DirTransferOptions,
  ): Promise<DirTransferResult> {
    return this.transfers.sftpDownloadDirectory(
      sessionId,
      remotePath,
      localPath,
      transferId,
      onProgress,
      options,
    )
  }

  async sftpUploadDirectory(
    sessionId: string,
    localPath: string,
    remotePath: string,
    transferId: string,
    onProgress: (
      transferred: number,
      total: number,
      stats?: DirTransferProgressStats,
    ) => void,
    options?: DirTransferOptions,
  ): Promise<DirTransferResult> {
    return this.transfers.sftpUploadDirectory(
      sessionId,
      localPath,
      remotePath,
      transferId,
      onProgress,
      options,
    )
  }

  async sftpChmod(
    sessionId: string,
    remotePath: string,
    mode: string,
    recursive = false,
  ): Promise<void> {
    return this.sftp.sftpChmod(sessionId, remotePath, mode, recursive)
  }

  async sftpChown(
    sessionId: string,
    remotePath: string,
    owner: string,
    group?: string,
    recursive = false,
  ): Promise<void> {
    return this.sftp.sftpChown(sessionId, remotePath, owner, group, recursive)
  }

  async sftpStat(sessionId: string, remotePath: string): Promise<{
    mode: string
    size: number
    uid: number
    gid: number
    atime: number
    mtime: number
    owner: string
    group: string
  }> {
    return this.sftp.sftpStat(sessionId, remotePath)
  }

  async sftpExec(sessionId: string, command: string, timeoutMs = 10000): Promise<string> {
    return this.sftp.sftpExec(sessionId, command, timeoutMs)
  }

  getPendingHostKey(connectionId: string): PendingHostKey | undefined {
    return this.pendingHostKeys.get(connectionId)
  }

  async confirmHostKey(connectionId: string): Promise<string> {
    const pending = this.pendingHostKeys.get(connectionId)
    if (!pending) throw new Error(t('ssh.noPendingHostKey'))

    // Trust the endpoint that failed (jump or target), then retry under the same sessionId
    await this.knownHosts.updateHostKey(pending.host, pending.port, pending.keyBuffer)
    const { connection, callbacks, resumeSessionId } = pending
    this.pendingHostKeys.delete(connectionId)

    // Always resume with the failed attempt's sessionId:
    // - reconnect path: keeps TerminalTab / SFTP bound to the same id
    // - first connect: renderer adopts this id into a new tab (no orphan uuid)
    return this.reconnect(resumeSessionId, connection, callbacks)
  }

  rejectHostKey(connectionId: string): void {
    this.pendingHostKeys.delete(connectionId)
  }

  /** Expose for IPC: whether confirm is resuming an existing tab session */
  getPendingHostKeyResumeSessionId(connectionId: string): string | undefined {
    return this.pendingHostKeys.get(connectionId)?.resumeSessionId
  }
}
