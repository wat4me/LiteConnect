import { Client, ClientChannel, ConnectConfig } from 'ssh2'
import * as net from 'net'
import { v4 as uuidv4 } from 'uuid'
import { KnownHostsStore } from './trust/knownHosts'
import { buildAuthFields } from './auth'
import { createHostVerifier, type HostKeyRejectInfo } from './trust/hostKeyVerify'
import { closeLocalForwardServers, setupLocalForwards } from './localForwards'
import {
  attachX11Forwarding,
  destroyX11Sockets,
  getX11Display,
  getX11Host,
  isX11ShellRequestError,
  probeX11Port,
} from './x11/x11'
import { ensureX11ServerReady } from './x11/x11Server'
import { t } from '../i18n'
import type { Connection, PendingHostKey, Session, SSHCallbacks } from './types'

export type ConnectionServiceDeps = {
  sessions: Map<string, Session>
  decoders: Map<string, TextDecoder>
  knownHosts: KnownHostsStore
  pendingHostKeys: Map<string, PendingHostKey>
  cleanupSession: (sessionId: string) => void
  /** Bump and return the next connection generation for this sessionId */
  bumpSessionEpoch: (sessionId: string) => number
  getSessionEpoch: (sessionId: string) => number
}

export class ConnectionService {
  constructor(private deps: ConnectionServiceDeps) {}

  async connect(connection: Connection, callbacks: SSHCallbacks): Promise<string> {
    const { useX11, x11Notice } = await this.resolveX11(connection)
    const sessionId = uuidv4()
    const epoch = this.deps.bumpSessionEpoch(sessionId)
    return this.openConnection(sessionId, connection, callbacks, useX11, x11Notice, epoch)
  }

  async reconnect(
    sessionId: string,
    connection: Connection,
    callbacks: SSHCallbacks,
  ): Promise<string> {
    if (!sessionId || typeof sessionId !== 'string') {
      throw new Error('Invalid session id')
    }
    // Invalidate the previous client/stream so late close/error never notifies
    const epoch = this.deps.bumpSessionEpoch(sessionId)
    try {
      const existing = this.deps.sessions.get(sessionId)
      if (existing) {
        try {
          existing.stream.removeAllListeners()
        } catch {}
        try {
          existing.client.removeAllListeners()
        } catch {}
        try {
          existing.stream.close()
        } catch {}
        try {
          existing.client.end()
        } catch {}
        try {
          existing.client.destroy()
        } catch {}
        this.deps.cleanupSession(sessionId)
      } else {
        this.deps.cleanupSession(sessionId)
      }
    } catch {
      this.deps.cleanupSession(sessionId)
    }

    return this.connectWithSessionId(sessionId, connection, callbacks, epoch)
  }

  private connectWithSessionId(
    sessionId: string,
    connection: Connection,
    callbacks: SSHCallbacks,
    epoch: number,
  ): Promise<string> {
    return this.resolveX11(connection).then(({ useX11, x11Notice }) =>
      this.openConnection(sessionId, connection, callbacks, useX11, x11Notice, epoch),
    )
  }

  private async resolveX11(connection: Connection): Promise<{
    useX11: boolean
    x11Notice?: string
  }> {
    if (connection.x11Forwarding !== true) {
      return { useX11: false }
    }
    const host = getX11Host(connection)
    const display = getX11Display(connection)
    const result = await ensureX11ServerReady(host, display)
    if (result.ready) {
      const note = result.started
        ? `\r\n\x1b[32m[LiteConnect] ${t('x11.autoStarted', { host, port: result.port })}\x1b[0m\r\n`
        : undefined
      return { useX11: true, x11Notice: note }
    }
    const detail = result.message || t('x11.notReady')
    return {
      useX11: false,
      x11Notice: `\r\n\x1b[33m[LiteConnect] ${t('x11.skipped', { detail })}\x1b[0m\r\n`,
    }
  }

  /** True if this openConnection attempt is still the live generation for the session. */
  private isLiveEpoch(sessionId: string, epoch: number): boolean {
    return this.deps.getSessionEpoch(sessionId) === epoch
  }

  private openConnection(
    sessionId: string,
    connection: Connection,
    callbacks: SSHCallbacks,
    useX11: boolean,
    x11Notice: string | undefined,
    epoch: number,
  ): Promise<string> {
    const hasJump = !!(connection.jumpHost && connection.jumpHost.trim())
    const { sessions, decoders, knownHosts, pendingHostKeys, cleanupSession } = this.deps

    return new Promise((resolve, reject) => {
      const client = new Client()
      let settled = false
      let jumpClient: Client | undefined
      const x11Sockets = new Set<net.Socket>()

      const safeResolve = (value: string) => {
        if (settled) return
        settled = true
        resolve(value)
      }
      // Local forwards set up after client ready; cleaned on all abort paths
      let localForwardServers: ReturnType<typeof setupLocalForwards> | undefined

      const abortPendingResources = () => {
        destroyX11Sockets(x11Sockets)
        closeLocalForwardServers(localForwardServers)
        localForwardServers = undefined
        try {
          jumpClient?.end()
        } catch {}
      }

      const safeReject = (err: Error) => {
        if (settled) return
        settled = true
        abortPendingResources()
        try {
          client.end()
        } catch {}
        reject(err)
      }

      let hostKeyError: string | null = null

      const rememberHostKeyReject = (info: HostKeyRejectInfo) => {
        hostKeyError = info.error
        pendingHostKeys.set(connection.id, {
          connectionId: connection.id,
          connection,
          keyBuffer: info.keyBuffer,
          fingerprint: info.fingerprint,
          existingFingerprint: info.existingFingerprint,
          callbacks,
          role: info.role,
          host: info.host,
          port: info.port,
          // Preserve sessionId so confirm can reconnect in-place (or adopt on first connect)
          resumeSessionId: sessionId,
        })
      }

      const targetConfig = (sock?: import('stream').Duplex): ConnectConfig => ({
        ...(sock
          ? { sock }
          : { host: connection.host, port: connection.port || 22 }),
        ...buildAuthFields({
          username: connection.username,
          password: connection.password,
          privateKey: connection.privateKey,
          useAgent: connection.useAgent,
        }),
        readyTimeout: 20000,
        keepaliveInterval: connection.keepaliveInterval ?? 30000,
        hostVerifier: createHostVerifier(
          knownHosts,
          connection.host,
          connection.port || 22,
          'target',
          rememberHostKeyReject,
        ),
      })

      // Mutable: may drop X11 after SSH auth if local display dies during handshake
      let activeUseX11 = useX11
      if (activeUseX11) {
        attachX11Forwarding(client, sessionId, connection, callbacks, x11Sockets)
      }

      client.on('ready', () => {
        if (!this.isLiveEpoch(sessionId, epoch)) {
          try {
            client.end()
          } catch {}
          return
        }
        try {
          client.setNoDelay(true)
        } catch {}
        localForwardServers = setupLocalForwards(client, connection, sessionId, callbacks)

        const ptyOptions = {
          term: 'xterm-256color',
          cols: 80,
          rows: 24,
        }
        let shellOpenTimeout: ReturnType<typeof setTimeout> | null = setTimeout(() => {
          shellOpenTimeout = null
          if (!this.isLiveEpoch(sessionId, epoch)) {
            abortPendingResources()
            try {
              client.destroy()
            } catch {}
            return
          }
          // closeLocalForwardServers destroys accepted sockets (not bare server.close)
          const message =
            'Shell open timeout: SSH authentication succeeded, but the server did not respond to the interactive shell request'
          callbacks.onError(sessionId, message)
          try {
            client.destroy()
          } catch {}
          // safeReject → abortPendingResources (forwards + jump + x11)
          safeReject(new Error(message))
        }, 15000)
        let shellX11FallbackTried = false
        let activeX11Notice = x11Notice
        let shellOpenStarted = false

        const openShell = (withX11: boolean) => {
          try {
            if (withX11) client.shell(ptyOptions, { x11: true }, handleShell)
            else client.shell(ptyOptions, handleShell)
          } catch (e: any) {
            if (shellOpenTimeout) {
              clearTimeout(shellOpenTimeout)
              shellOpenTimeout = null
            }
            try {
              client.end()
            } catch {}
            safeReject(new Error(`Shell error: ${e?.message || String(e)}`))
          }
        }

        /**
         * SSH auth can take several seconds. Re-check (and re-try auto-start) local X
         * right before requesting X11 so we never ask the remote when VcXsrv already died —
         * that used to surface only as "Unable to request X11" with no start-failure hint.
         */
        const ensureLocalXBeforeShell = async () => {
          if (!activeUseX11) {
            openShell(false)
            return
          }
          const x11Host = getX11Host(connection)
          const x11Display = getX11Display(connection)
          const x11Port = 6000 + x11Display
          if (await probeX11Port(x11Host, x11Port)) {
            openShell(true)
            return
          }
          const again = await ensureX11ServerReady(x11Host, x11Display)
          if (again.ready) {
            const note = again.started
              ? `\r\n\x1b[32m[LiteConnect] ${t('x11.autoStarted', { host: x11Host, port: x11Port })}\x1b[0m\r\n`
              : undefined
            if (note) activeX11Notice = note
            openShell(true)
            return
          }
          // Local X still unavailable — open plain shell with a clear start-failure notice
          activeUseX11 = false
          destroyX11Sockets(x11Sockets)
          const detail = again.message || t('x11.notReady')
          activeX11Notice = `\r\n\x1b[33m[LiteConnect] ${t('x11.skipped', {
            detail: t('x11.recheckFailed', { host: x11Host, port: x11Port, detail }),
          })}\x1b[0m\r\n`
          openShell(false)
        }

        const handleShell = async (err: Error | undefined | null, stream: ClientChannel) => {
          if (shellOpenTimeout) {
            clearTimeout(shellOpenTimeout)
            shellOpenTimeout = null
          }
          if (!this.isLiveEpoch(sessionId, epoch)) {
            try {
              stream?.close()
            } catch {}
            abortPendingResources()
            try {
              client.end()
            } catch {}
            return
          }
          if (err) {
            const msg = err.message || String(err)
            // Local X may be up, but remote sshd refused X11 on shell open → plain shell
            if (activeUseX11 && !shellX11FallbackTried && isX11ShellRequestError(msg)) {
              shellX11FallbackTried = true
              activeUseX11 = false
              destroyX11Sockets(x11Sockets)
              const x11Host = getX11Host(connection)
              const x11Port = 6000 + getX11Display(connection)
              const localXReady = await probeX11Port(x11Host, x11Port)
              const notice = localXReady
                ? t('x11.shellRejected', { detail: msg })
                : t('x11.shellRejectedLocalUnavailable', {
                    detail: msg,
                    host: x11Host,
                    port: x11Port,
                  })
              activeX11Notice = `\r\n\x1b[33m[LiteConnect] ${notice}\x1b[0m\r\n`
              shellOpenTimeout = setTimeout(() => {
                shellOpenTimeout = null
                if (!this.isLiveEpoch(sessionId, epoch)) {
                  abortPendingResources()
                  try {
                    client.destroy()
                  } catch {}
                  return
                }
                const message =
                  'Shell open timeout: SSH authentication succeeded, but the server did not respond to the interactive shell request'
                callbacks.onError(sessionId, message)
                try {
                  client.destroy()
                } catch {}
                safeReject(new Error(message))
              }, 15000)
              openShell(false)
              return
            }
            try {
              client.end()
            } catch {}
            // safeReject → abortPendingResources (forwards + jump + x11)
            safeReject(new Error(`Shell error: ${msg}`))
            return
          }

          sessions.set(sessionId, {
            id: sessionId,
            client,
            stream,
            connectionId: connection.id,
            connectionName: connection.name,
            x11Sockets,
            jumpClient,
            localForwardServers,
          })

          const decoder = new TextDecoder('utf-8', { fatal: false })
          decoders.set(sessionId, decoder)
          stream.on('data', (data: Buffer) => {
            if (!this.isLiveEpoch(sessionId, epoch)) return
            const decoded = decoder.decode(data, { stream: true })
            callbacks.onData(sessionId, decoded)
          })

          stream.on('close', () => {
            if (!this.isLiveEpoch(sessionId, epoch)) return
            const current = sessions.get(sessionId)
            if (current && current.stream !== stream) return
            cleanupSession(sessionId)
            try {
              client.end()
            } catch {}
            try {
              jumpClient?.end()
            } catch {}
            callbacks.onClose(sessionId)
          })

          stream.stderr.on('data', (data: Buffer) => {
            if (!this.isLiveEpoch(sessionId, epoch)) return
            const decoded = decoder.decode(data, { stream: true })
            callbacks.onData(sessionId, decoded)
          })

          if (activeX11Notice) {
            if (callbacks.onNotice) callbacks.onNotice(sessionId, activeX11Notice)
            else callbacks.onData(sessionId, activeX11Notice)
          }
          if (hasJump) {
            callbacks.onData(
              sessionId,
              `\r\n\x1b[32m[LiteConnect] ${t('ssh.jumpConnected', {
                jumpHost: connection.jumpHost!,
                jumpPort: connection.jumpPort || 22,
                host: connection.host,
              })}\x1b[0m\r\n`,
            )
          }

          safeResolve(sessionId)
        }

        if (shellOpenStarted) return
        shellOpenStarted = true
        // Defer shell open until local X is re-verified (async)
        void ensureLocalXBeforeShell().catch((e: any) => {
          if (shellOpenTimeout) {
            clearTimeout(shellOpenTimeout)
            shellOpenTimeout = null
          }
          try {
            client.end()
          } catch {}
          safeReject(new Error(`Shell error: ${e?.message || String(e)}`))
        })
      })

      client.on('error', (err) => {
        if (!this.isLiveEpoch(sessionId, epoch)) {
          abortPendingResources()
          return
        }
        const current = sessions.get(sessionId)
        if (current && current.client !== client) {
          abortPendingResources()
          return
        }
        // Session registered → cleanupSession owns local forwards / jump / x11 / sftp
        if (sessions.has(sessionId)) {
          cleanupSession(sessionId)
        } else {
          abortPendingResources()
        }
        const errorMsg = hostKeyError || err.message
        callbacks.onError(sessionId, errorMsg)
        safeReject(new Error(`Connection error: ${errorMsg}`))
      })

      client.on('close', () => {
        if (!this.isLiveEpoch(sessionId, epoch)) {
          abortPendingResources()
          return
        }
        const current = sessions.get(sessionId)
        if (current && current.client !== client) {
          abortPendingResources()
          return
        }
        if (sessions.has(sessionId)) {
          cleanupSession(sessionId)
          callbacks.onClose(sessionId)
        } else {
          abortPendingResources()
        }
      })

      if (!hasJump) {
        client.connect(targetConfig())
        return
      }

      jumpClient = new Client()
      const jumpHost = connection.jumpHost!.trim()
      const jumpPort = connection.jumpPort || 22
      const jumpUser = connection.jumpUsername || connection.username
      jumpClient
        .on('ready', () => {
          if (!this.isLiveEpoch(sessionId, epoch)) {
            try {
              jumpClient?.end()
            } catch {}
            return
          }
          try {
            jumpClient!.setNoDelay(true)
          } catch {}
          jumpClient!.forwardOut(
            '127.0.0.1',
            0,
            connection.host,
            connection.port || 22,
            (err, stream) => {
              if (err) {
                try {
                  jumpClient?.end()
                } catch {}
                try {
                  client.end()
                } catch {}
                if (this.isLiveEpoch(sessionId, epoch)) {
                  cleanupSession(sessionId)
                }
                safeReject(new Error(`Jump host forward failed: ${err.message}`))
                return
              }
              if (!this.isLiveEpoch(sessionId, epoch)) {
                try {
                  stream.close()
                } catch {}
                try {
                  jumpClient?.end()
                } catch {}
                return
              }
              client.connect(targetConfig(stream))
            },
          )
        })
        .on('error', (err) => {
          if (!this.isLiveEpoch(sessionId, epoch)) return
          try {
            client.end()
          } catch {}
          cleanupSession(sessionId)
          const errorMsg = hostKeyError || err.message
          safeReject(new Error(`Jump host error: ${errorMsg}`))
        })
        .connect({
          host: jumpHost,
          port: jumpPort,
          ...buildAuthFields({
            username: jumpUser,
            password: connection.jumpPassword ?? connection.password,
            privateKey: connection.jumpPrivateKey ?? connection.privateKey,
            useAgent: connection.useAgent,
          }),
          readyTimeout: 20000,
          keepaliveInterval: connection.keepaliveInterval ?? 30000,
          hostVerifier: createHostVerifier(
            knownHosts,
            jumpHost,
            jumpPort,
            'jump',
            rememberHostKeyReject,
          ),
        })
    })
  }
}
