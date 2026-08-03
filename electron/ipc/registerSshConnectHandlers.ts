import { ipcMain, BrowserWindow } from 'electron'
import {
  isValidUUID,
  isValidSshWriteData,
  AuthConnectionParams,
  validateConnectionParams,
  DecryptionError,
  safeWebContentsSend,
} from '../utils/validation'
import { diagnoseSshConnection } from '../ssh/diagnosis/diagnosis'
import { testSshConnection } from '../ssh/diagnosis/testConnection'
import { KnownHostsStore } from '../ssh/trust/knownHosts'
import { SSHManager } from '../ssh/manager'
import { SettingsStore } from '../store/settingsStore'
import { CredentialStore } from '../store/credentialStore'
import {
  broadcast,
  clearSessionOwner,
  setSessionOwner,
} from '../window/windowRegistry'

/** Batch SSH output as string chunks to reduce GC vs repeated string concat. */
const dataBatches: Map<string, string[]> = new Map()
let dataBatchScheduled = false
const startupNotices = new Map<string, string[]>()

type MainWindowGetter = () => BrowserWindow | null

function scheduleDataBatch() {
  if (dataBatchScheduled) return
  dataBatchScheduled = true
  setImmediate(() => {
    dataBatchScheduled = false
    for (const [sessionId, chunks] of dataBatches) {
      dataBatches.delete(sessionId)
      broadcast(`ssh:data:${sessionId}`, chunks.join(''))
    }
  })
}

function emitSshData(sessionId: string, data: string) {
  let chunks = dataBatches.get(sessionId)
  if (!chunks) {
    chunks = []
    dataBatches.set(sessionId, chunks)
  }
  chunks.push(data)
  scheduleDataBatch()
}

function queueStartupNotice(sessionId: string, message: string) {
  const notices = startupNotices.get(sessionId) || []
  notices.push(message)
  startupNotices.set(sessionId, notices)
}

/** Resolve secrets in main process only — never send them to the renderer. */
function resolveAuthParams(
  params: AuthConnectionParams,
  credentialStore: CredentialStore,
): AuthConnectionParams {
  let password = typeof params.password === 'string' ? params.password : ''
  let privateKey = params.privateKey

  if (!password && params.savedCredentialId && isValidUUID(params.savedCredentialId)) {
    password = credentialStore.getSavedCredentialPassword(params.savedCredentialId) || ''
  }

  if (params.connectionId && isValidUUID(params.connectionId)) {
    const stored = credentialStore.getConnectionForAuth(params.connectionId)
    if (stored) {
      if (!password) password = stored.password || ''
      if (!privateKey && stored.privateKey) privateKey = stored.privateKey
    }
  }

  return {
    host: params.host,
    port: params.port,
    username: params.username,
    password,
    privateKey,
    useAgent: params.useAgent,
    connectionId: params.connectionId,
    savedCredentialId: params.savedCredentialId,
  }
}

const latencyTimers = new Map<string, ReturnType<typeof setInterval>>()

export function clearLatencyTimers(): void {
  for (const [, timer] of latencyTimers) clearInterval(timer)
  latencyTimers.clear()
}

export function registerSshConnectHandlers(
  _getMainWindow: MainWindowGetter,
  sshManager: SSHManager,
  settingsStore: SettingsStore,
  credentialStore: CredentialStore,
  knownHosts: KnownHostsStore,
): void {
  const ensureCredentialStoreReady = () => credentialStore.init()
  const ensureSettingsStoreReady = () => settingsStore.init()
  const ensureKnownHostsReady = () => knownHosts.init()

  ipcMain.handle('ssh:takeStartupNotices', async (_event, sessionId: string) => {
    if (!isValidUUID(sessionId)) return []
    const notices = startupNotices.get(sessionId) || []
    startupNotices.delete(sessionId)
    return notices
  })

  // Host key management
  ipcMain.handle('ssh:removeHostKey', async (_event, host: string, port: number) => {
    if (typeof host !== 'string' || !host.trim()) {
      throw new Error('Invalid host')
    }
    if (typeof port !== 'number' || port <= 0 || port > 65535 || !Number.isInteger(port)) {
      throw new Error('Invalid port')
    }
    await ensureKnownHostsReady()
    await knownHosts.remove(host, port)
  })

  ipcMain.handle('ssh:updateHostKey', async (_event, host: string, port: number, keyBuffer: Buffer) => {
    if (typeof host !== 'string' || !host.trim()) {
      throw new Error('Invalid host')
    }
    if (typeof port !== 'number' || port <= 0 || port > 65535 || !Number.isInteger(port)) {
      throw new Error('Invalid port')
    }
    if (!keyBuffer || !Buffer.isBuffer(keyBuffer)) {
      throw new Error('Invalid key buffer')
    }
    await ensureKnownHostsReady()
    const fingerprint = await knownHosts.updateHostKey(host, port, keyBuffer)
    return fingerprint
  })

  /**
   * Trust a host key returned by test/diagnose (public key as base64).
   * Used when the form tests a draft connection before formal connect has a session.
   */
  ipcMain.handle(
    'ssh:trustHostKey',
    async (_event, host: string, port: number, keyBase64: string) => {
      if (typeof host !== 'string' || !host.trim()) {
        throw new Error('Invalid host')
      }
      if (typeof port !== 'number' || port <= 0 || port > 65535 || !Number.isInteger(port)) {
        throw new Error('Invalid port')
      }
      if (typeof keyBase64 !== 'string' || !keyBase64.trim()) {
        throw new Error('Invalid host key')
      }
      let keyBuffer: Buffer
      try {
        keyBuffer = Buffer.from(keyBase64, 'base64')
      } catch {
        throw new Error('Invalid host key encoding')
      }
      if (!keyBuffer.length) {
        throw new Error('Invalid host key')
      }
      await ensureKnownHostsReady()
      return knownHosts.updateHostKey(host.trim(), port, keyBuffer)
    },
  )

  ipcMain.handle('ssh:getHostKeyFingerprint', async (_event, host: string, port: number) => {
    if (typeof host !== 'string' || !host.trim()) {
      throw new Error('Invalid host')
    }
    if (typeof port !== 'number' || port <= 0 || port > 65535 || !Number.isInteger(port)) {
      throw new Error('Invalid port')
    }
    await ensureKnownHostsReady()
    return knownHosts.getFingerprint(host, port) || null
  })

  // SSH test and connection — same Host Key / jump / shell policy as formal connect
  ipcMain.handle('ssh:testConnection', async (_event, connectionId: string) => {
    await Promise.all([ensureCredentialStoreReady(), ensureKnownHostsReady()])
    if (!isValidUUID(connectionId)) {
      throw new Error('Invalid connection id')
    }
    const connection = credentialStore.getConnectionForAuth(connectionId)
    if (!connection) throw new Error('Connection not found')

    return testSshConnection(
      {
        host: connection.host,
        port: connection.port || 22,
        username: connection.username,
        password: connection.password,
        privateKey: connection.privateKey,
        useAgent: connection.useAgent,
        jumpHost: connection.jumpHost,
        jumpPort: connection.jumpPort,
        jumpUsername: connection.jumpUsername,
        jumpPassword: connection.jumpPassword,
        jumpPrivateKey: connection.jumpPrivateKey,
        checkShell: true,
      },
      knownHosts,
    )
  })

  ipcMain.handle('ssh:testConnectionParams', async (_event, params: AuthConnectionParams) => {
    await Promise.all([ensureCredentialStoreReady(), ensureKnownHostsReady()])
    const validation = validateConnectionParams(params)
    if (!validation.valid) {
      throw new Error(validation.error)
    }
    const resolved = resolveAuthParams(params, credentialStore)

    // Optional jump fields when form/list tests a draft connection
    const jumpHost =
      typeof (params as any).jumpHost === 'string' ? (params as any).jumpHost : undefined
    const jumpPort =
      typeof (params as any).jumpPort === 'number' ? (params as any).jumpPort : undefined
    const jumpUsername =
      typeof (params as any).jumpUsername === 'string' ? (params as any).jumpUsername : undefined
    const jumpPassword =
      typeof (params as any).jumpPassword === 'string' ? (params as any).jumpPassword : undefined
    const jumpPrivateKey =
      typeof (params as any).jumpPrivateKey === 'string' ? (params as any).jumpPrivateKey : undefined

    let storedJump:
      | {
          jumpHost?: string
          jumpPort?: number
          jumpUsername?: string
          jumpPassword?: string
          jumpPrivateKey?: string
          useAgent?: boolean
        }
      | undefined
    if (resolved.connectionId && isValidUUID(resolved.connectionId)) {
      const stored = credentialStore.getConnectionForAuth(resolved.connectionId)
      if (stored) {
        storedJump = {
          jumpHost: stored.jumpHost,
          jumpPort: stored.jumpPort,
          jumpUsername: stored.jumpUsername,
          jumpPassword: stored.jumpPassword,
          jumpPrivateKey: stored.jumpPrivateKey,
          useAgent: stored.useAgent,
        }
      }
    }

    return testSshConnection(
      {
        host: resolved.host,
        port: resolved.port,
        username: resolved.username,
        password: resolved.password,
        privateKey: resolved.privateKey,
        useAgent: storedJump?.useAgent,
        jumpHost: jumpHost ?? storedJump?.jumpHost,
        jumpPort: jumpPort ?? storedJump?.jumpPort,
        jumpUsername: jumpUsername ?? storedJump?.jumpUsername,
        jumpPassword: jumpPassword ?? storedJump?.jumpPassword,
        jumpPrivateKey: jumpPrivateKey ?? storedJump?.jumpPrivateKey,
        checkShell: true,
      },
      knownHosts,
    )
  })

  ipcMain.handle('ssh:diagnoseConnectionParams', async (_event, params: AuthConnectionParams) => {
    await Promise.all([ensureCredentialStoreReady(), ensureKnownHostsReady()])
    const validation = validateConnectionParams(params)
    if (!validation.valid) {
      throw new Error(validation.error)
    }
    const resolved = resolveAuthParams(params, credentialStore)
    const jumpHost =
      typeof (params as any).jumpHost === 'string' ? (params as any).jumpHost : undefined
    const jumpPort =
      typeof (params as any).jumpPort === 'number' ? (params as any).jumpPort : undefined
    const jumpUsername =
      typeof (params as any).jumpUsername === 'string' ? (params as any).jumpUsername : undefined
    const jumpPassword =
      typeof (params as any).jumpPassword === 'string' ? (params as any).jumpPassword : undefined
    const jumpPrivateKey =
      typeof (params as any).jumpPrivateKey === 'string' ? (params as any).jumpPrivateKey : undefined
    return await diagnoseSshConnection(
      {
        ...resolved,
        jumpHost,
        jumpPort,
        jumpUsername,
        jumpPassword,
        jumpPrivateKey,
      },
      knownHosts,
    )
  })

  ipcMain.handle('ssh:connect', async (event, connectionId: string) => {
    await Promise.all([ensureCredentialStoreReady(), ensureKnownHostsReady()])
    if (!isValidUUID(connectionId)) {
      throw new Error('Invalid connection id')
    }

    let connection
    try {
      connection = credentialStore.getConnectionForAuth(connectionId)
    } catch (err) {
      if (DecryptionError.is(err)) {
        safeWebContentsSend(event.sender, 'ssh:decryptionFailed', {
          connectionId,
          field: err.field || 'password',
          message: err.message,
        })
      }
      throw err
    }
    if (!connection) {
      throw new Error(`Connection ${connectionId} not found`)
    }

    // Always open a fresh SSH session. Renderer serializes multi-tab reconnects;
    // sharing one in-flight promise would hand the same sessionId to two tabs.
    try {
      const sessionId = await sshManager.connect(connection, {
        onData: (sid, data) => {
          emitSshData(sid, data)
        },
        onNotice: queueStartupNotice,
        onClose: (sid) => {
          clearSessionOwner(sid)
          broadcast(`ssh:closed:${sid}`)
        },
        onError: (sid, err) => {
          broadcast(`ssh:error:${sid}`, err)
        },
      })
      setSessionOwner(sessionId, event.sender.id)
      return sessionId
    } catch (err: any) {
      const pending = sshManager.getPendingHostKey(connectionId)
      if (pending) {
        safeWebContentsSend(event.sender, 'ssh:hostKeyMismatch', {
          connectionId,
          host: pending.host,
          port: pending.port,
          existingFingerprint: pending.existingFingerprint,
          newFingerprint: pending.fingerprint,
          role: pending.role,
        })
      }
      throw err
    }
  })

  ipcMain.handle('ssh:confirmHostKey', async (event, connectionId: string) => {
    if (!isValidUUID(connectionId)) {
      throw new Error('Invalid connection id')
    }
    // Capture resume id before confirm clears pending
    const resumeSessionId = sshManager.getPendingHostKeyResumeSessionId(connectionId)
    const hadLiveSession = !!(resumeSessionId && sshManager.hasSession(resumeSessionId))
    // After host-key failure the live map is usually empty; still treat a known
    // resumeSessionId as in-place when the renderer already owns that tab.
    const sessionId = await sshManager.confirmHostKey(connectionId)
    if (sessionId) setSessionOwner(sessionId, event.sender.id)
    // Notify TerminalTab when this was a reconnect-style resume (session id reused)
    if (resumeSessionId && resumeSessionId === sessionId) {
      // Always emit reconnected so an existing tab can clear disconnected state.
      // For first-connect confirm, no listener is bound yet — emit is harmless.
      broadcast(`ssh:reconnected:${sessionId}`)
    } else if (hadLiveSession) {
      broadcast(`ssh:reconnected:${sessionId}`)
    }
    return sessionId
  })

  ipcMain.handle('ssh:rejectHostKey', async (_event, connectionId: string) => {
    sshManager.rejectHostKey(connectionId)
  })

  ipcMain.handle('ssh:disconnect', (_event, sessionId: string) => {
    if (!isValidUUID(sessionId)) {
      throw new Error('Invalid session id')
    }
    const timer = latencyTimers.get(sessionId)
    if (timer) {
      clearInterval(timer)
      latencyTimers.delete(sessionId)
    }
    startupNotices.delete(sessionId)
    clearSessionOwner(sessionId)
    sshManager.disconnect(sessionId)
  })

  /** In-place reconnect: same sessionId, new SSH+shell (keeps TerminalTab mounted). */
  ipcMain.handle('ssh:reconnect', async (event, sessionId: string, connectionId: string) => {
    await Promise.all([ensureCredentialStoreReady(), ensureKnownHostsReady()])
    if (!isValidUUID(sessionId)) throw new Error('Invalid session id')
    if (!isValidUUID(connectionId)) throw new Error('Invalid connection id')

    let connection
    try {
      connection = credentialStore.getConnectionForAuth(connectionId)
    } catch (err) {
      if (DecryptionError.is(err)) {
        safeWebContentsSend(event.sender, 'ssh:decryptionFailed', {
          connectionId,
          field: err.field || 'password',
          message: err.message,
        })
      }
      throw err
    }
    if (!connection) throw new Error(`Connection ${connectionId} not found`)

    const timer = latencyTimers.get(sessionId)
    if (timer) {
      clearInterval(timer)
      latencyTimers.delete(sessionId)
    }

    try {
      const id = await sshManager.reconnect(sessionId, connection, {
        onData: (sid, data) => {
          emitSshData(sid, data)
        },
        onNotice: queueStartupNotice,
        onClose: (sid) => {
          clearSessionOwner(sid)
          broadcast(`ssh:closed:${sid}`)
        },
        onError: (sid, err) => {
          broadcast(`ssh:error:${sid}`, err)
        },
      })
      setSessionOwner(id, event.sender.id)
      broadcast(`ssh:reconnected:${id}`)
      return id
    } catch (err: any) {
      const pending = sshManager.getPendingHostKey(connectionId)
      if (pending) {
        safeWebContentsSend(event.sender, 'ssh:hostKeyMismatch', {
          connectionId,
          host: pending.host,
          port: pending.port,
          existingFingerprint: pending.existingFingerprint,
          newFingerprint: pending.fingerprint,
          role: pending.role,
        })
      }
      throw err
    }
  })

  ipcMain.on('ssh:write', (_event, sessionId: string, data: string) => {
    if (!isValidUUID(sessionId)) return
    if (!isValidSshWriteData(data)) return
    const ok = sshManager.write(sessionId, data)
    if (!ok) {
      console.warn('[ssh:write] Session not writable, possible disconnect:', sessionId)
    }
  })

  ipcMain.on('ssh:resize', (_event, sessionId: string, cols: number, rows: number) => {
    if (!isValidUUID(sessionId)) return
    if (typeof cols !== 'number' || cols <= 0 || cols > 1000 || !Number.isInteger(cols)) return
    if (typeof rows !== 'number' || rows <= 0 || rows > 1000 || !Number.isInteger(rows)) return
    sshManager.resize(sessionId, cols, rows)
  })

  // Latency monitors
  ipcMain.handle('ssh:startLatencyMonitor', async (_event, sessionId: string) => {
    if (!isValidUUID(sessionId)) {
      throw new Error('Invalid session id')
    }
    if (latencyTimers.has(sessionId)) return

    await ensureSettingsStoreReady()
    const interval = settingsStore.getLatencyIntervalMs()

    const measure = async () => {
      if (!sshManager.hasSession(sessionId)) {
        clearInterval(latencyTimers.get(sessionId))
        latencyTimers.delete(sessionId)
        return
      }
      try {
        const latency = await sshManager.measureLatency(sessionId)
        broadcast(`ssh:latency:${sessionId}`, latency)
      } catch {
        broadcast(`ssh:latency:${sessionId}`, -1)
      }
    }

    const timer = setInterval(measure, interval)
    latencyTimers.set(sessionId, timer)

    measure()
  })

  ipcMain.handle('ssh:stopLatencyMonitor', (_event, sessionId: string) => {
    if (!isValidUUID(sessionId)) return
    const timer = latencyTimers.get(sessionId)
    if (timer) {
      clearInterval(timer)
      latencyTimers.delete(sessionId)
    }
  })

  ipcMain.handle('ssh:measureLatency', async (_event, sessionId: string) => {
    if (!isValidUUID(sessionId)) {
      throw new Error('Invalid session id')
    }
    return await sshManager.measureLatency(sessionId)
  })
}
