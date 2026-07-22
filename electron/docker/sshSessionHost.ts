import type { ClientChannel } from 'ssh2'
import type { SSHManager } from '../ssh/manager'
import { DOCKER_SOCKET_PATH, type DockerInstallationPresence, type DockerSessionHost } from './types'
import {
  classifyNcExecFailure,
  DOCKER_NC_EXEC_COMMAND,
  DOCKER_NC_EXEC_SETTLE_MS,
  DOCKER_NC_STDERR_CLASSIFY_MAX,
  DOCKER_STREAMLOCAL_OPEN_TIMEOUT_MS,
  shouldFallbackToNcExec,
  truncateNcStderr,
  type DockerSocketTransportMode,
} from './ncFallback'

function destroyChannel(channel: NodeJS.ReadWriteStream | null | undefined): void {
  try { channel?.destroy?.() } catch {}
  try { (channel as any)?.close?.() } catch {}
  try { (channel as any)?.end?.() } catch {}
}

const DOCKER_INSTALL_CHECK =
  'if command -v docker >/dev/null 2>&1 || command -v dockerd >/dev/null 2>&1 || ' +
  'test -x /usr/bin/docker || test -x /usr/bin/dockerd || test -x /usr/sbin/dockerd || ' +
  'test -x /usr/local/bin/docker || test -x /usr/local/bin/dockerd; then ' +
  'echo LITECONNECT_DOCKER_INSTALLED; else echo LITECONNECT_DOCKER_NOT_INSTALLED; fi'

/** Docker-owned implementation of the SSH capabilities consumed by DockerService. */
export class DockerSshSessionHost implements DockerSessionHost {
  private readonly lastSocketMode = new Map<string, DockerSocketTransportMode>()
  private readonly unsubscribeTeardown: () => void
  private disposed = false

  constructor(private readonly ssh: SSHManager) {
    this.unsubscribeTeardown = ssh.registerSessionTeardownHook((sessionId) => {
      this.lastSocketMode.delete(sessionId)
    })
  }

  hasSession(sessionId: string): boolean { return this.ssh.hasSession(sessionId) }
  getSessionGeneration(sessionId: string): number { return this.ssh.getSessionGeneration(sessionId) }
  registerSessionTeardownHook(hook: (sessionId: string) => void): () => void {
    return this.ssh.registerSessionTeardownHook(hook)
  }
  openStreamLocal(sessionId: string, path: string, generation: number): Promise<NodeJS.ReadWriteStream> {
    return this.ssh.openStreamLocal(sessionId, path, generation)
  }

  getLastDockerSocketMode(sessionId: string): DockerSocketTransportMode | null {
    return this.lastSocketMode.get(sessionId) ?? null
  }

  async openDockerSocketChannel(sessionId: string, generation: number): Promise<NodeJS.ReadWriteStream> {
    this.assertLive(sessionId, generation)
    try {
      const stream = await this.openStreamLocalWithTimeout(sessionId, generation)
      if (!this.isLive(sessionId, generation)) {
        destroyChannel(stream)
        throw new Error('SSH session generation changed')
      }
      this.lastSocketMode.set(sessionId, 'streamlocal')
      return stream
    } catch (err) {
      this.assertLive(sessionId, generation)
      if (!shouldFallbackToNcExec(err)) throw err
      const stream = await this.openNcExecChannel(sessionId, generation)
      this.lastSocketMode.set(sessionId, 'exec-nc')
      return stream
    }
  }

  async checkDockerInstallation(sessionId: string, generation: number): Promise<DockerInstallationPresence> {
    if (!this.isLive(sessionId, generation)) return 'unknown'
    try {
      const output = await this.ssh.executeSessionCommand(sessionId, DOCKER_INSTALL_CHECK, generation, 8000)
      if (!this.isLive(sessionId, generation)) return 'unknown'
      const token = output.trim()
      if (token.includes('LITECONNECT_DOCKER_INSTALLED') && !token.includes('LITECONNECT_DOCKER_NOT_INSTALLED')) return 'installed'
      return token.includes('LITECONNECT_DOCKER_NOT_INSTALLED') ? 'not-installed' : 'unknown'
    } catch {
      return 'unknown'
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.lastSocketMode.clear()
    this.unsubscribeTeardown()
  }

  private isLive(sessionId: string, generation: number): boolean {
    return this.ssh.hasSession(sessionId) && this.ssh.getSessionGeneration(sessionId) === generation
  }
  private assertLive(sessionId: string, generation: number): void {
    if (!this.isLive(sessionId, generation)) throw new Error('SSH session generation changed')
  }
  private openStreamLocalWithTimeout(sessionId: string, generation: number): Promise<NodeJS.ReadWriteStream> {
    return new Promise((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error('StreamLocal open timed out')) } }, DOCKER_STREAMLOCAL_OPEN_TIMEOUT_MS)
      this.ssh.openStreamLocal(sessionId, DOCKER_SOCKET_PATH, generation).then((stream) => {
        if (settled) { destroyChannel(stream); return }
        settled = true; clearTimeout(timer); resolve(stream)
      }, (err) => { if (!settled) { settled = true; clearTimeout(timer); reject(err) } })
    })
  }
  private async openNcExecChannel(sessionId: string, generation: number): Promise<NodeJS.ReadWriteStream> {
    let channel: ClientChannel | null = null
    let stderr = Buffer.alloc(0)
    let exitCode: number | null | undefined
    let signal: string | null | undefined
    let earlyClose = false
    try {
      return await new Promise<NodeJS.ReadWriteStream>((resolve, reject) => {
        let settled = false
        const fail = (error?: unknown) => {
          if (settled) return
          settled = true; destroyChannel(channel)
          reject(classifyNcExecFailure({ openError: error, exitCode, signal: signal ?? null, stderrSnippet: truncateNcStderr(stderr), earlyClose }, sessionId))
        }
        const succeed = () => {
          if (settled) return
          if (!this.isLive(sessionId, generation)) { fail(new Error('SSH session generation changed')); return }
          settled = true
          try { channel!.stderr?.removeAllListeners('data'); channel!.stderr?.on('data', () => {}); channel!.stderr?.resume?.() } catch {}
          resolve(channel!)
        }
        const onStderr = (chunk: Buffer | string) => {
          if (stderr.length < DOCKER_NC_STDERR_CLASSIFY_MAX) stderr = Buffer.concat([stderr, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]).subarray(0, DOCKER_NC_STDERR_CLASSIFY_MAX)
        }
        const attach = (opened: NodeJS.ReadWriteStream) => {
          channel = opened as ClientChannel
          try { channel.stderr?.on('data', onStderr) } catch {}
          channel.once('exit', (code, sig) => { exitCode = code; signal = sig ?? null; fail() })
          channel.once('close', () => { earlyClose = true; fail() })
          channel.once('error', (error) => fail(error))
          setTimeout(succeed, DOCKER_NC_EXEC_SETTLE_MS)
        }
        this.ssh.openExecChannel(sessionId, DOCKER_NC_EXEC_COMMAND, generation, attach).catch((error) => {
          if (error instanceof Error && /generation/i.test(error.message)) {
            if (!settled) { settled = true; reject(error) }
            return
          }
          fail(error)
        })
      })
    } catch (error) {
      destroyChannel(channel)
      if (error && typeof error === 'object' && (error as any).name === 'DockerTransportError') throw error
      if (error instanceof Error && /generation/i.test(error.message)) throw error
      throw classifyNcExecFailure({ openError: error }, sessionId)
    }
  }
}
