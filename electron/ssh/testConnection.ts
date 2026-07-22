import { Client, type ConnectConfig, type ClientChannel } from 'ssh2'
import { Socket } from 'net'
import { buildAuthFields } from './auth'
import { createHostVerifier, type HostKeyRejectInfo } from './hostKeyVerify'
import type { KnownHostsStore } from './knownHosts'

export type SshTestStage =
  | 'tcp'
  | 'ssh_handshake'
  | 'host_key'
  | 'auth'
  | 'jump'
  | 'shell'

export type SshTestConnectionResult = {
  ok: boolean
  latency?: number
  stage?: SshTestStage
  error?: string
  /** Host that failed host-key check (jump or target) */
  hostKeyHost?: string
  hostKeyPort?: number
  hostKeyRole?: 'target' | 'jump'
  existingFingerprint?: string
  newFingerprint?: string
}

export type SshTestConnectionParams = {
  host: string
  port: number
  username: string
  password?: string
  privateKey?: string
  useAgent?: boolean
  jumpHost?: string
  jumpPort?: number
  jumpUsername?: string
  jumpPassword?: string
  jumpPrivateKey?: string
  /** When true, open interactive shell like a real session */
  checkShell?: boolean
}

const DEFAULT_TIMEOUT_MS = 15_000

function destroyClient(client: Client | undefined) {
  if (!client) return
  try {
    client.removeAllListeners()
  } catch {}
  try {
    client.end()
  } catch {}
  try {
    client.destroy()
  } catch {}
}

function testTcp(host: string, port: number, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    let settled = false
    const socket = new Socket()
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      socket.removeAllListeners()
      socket.destroy()
      fn()
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(() => resolve(Date.now() - start)))
    socket.once('timeout', () =>
      finish(() => reject(new Error(`TCP connection timeout (${timeoutMs}ms)`))),
    )
    socket.once('error', (err) => finish(() => reject(err)))
    socket.connect(port, host)
  })
}

export function classifyAuthError(message: string): SshTestStage {
  const m = message.toLowerCase()
  if (
    m.includes('authentication') ||
    m.includes('all configured authentication methods failed') ||
    m.includes('permission denied') ||
    m.includes('no more auth methods')
  ) {
    return 'auth'
  }
  if (m.includes('host key') || m.includes('hostkey')) {
    return 'host_key'
  }
  return 'ssh_handshake'
}

/**
 * Full-path connection test aligned with formal SSH connect:
 * Host Key policy, optional jump host, optional shell open.
 * Always tears down clients/streams/timers.
 */
export async function testSshConnection(
  params: SshTestConnectionParams,
  knownHosts: KnownHostsStore,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<SshTestConnectionResult> {
  await knownHosts.init()
  const totalStart = Date.now()
  const hasJump = !!(params.jumpHost && params.jumpHost.trim())
  const checkShell = params.checkShell !== false

  const tcpHost = hasJump ? params.jumpHost!.trim() : params.host
  const tcpPort = hasJump ? params.jumpPort || 22 : params.port || 22

  try {
    await testTcp(tcpHost, tcpPort, timeoutMs)
  } catch (err: any) {
    return {
      ok: false,
      stage: 'tcp',
      latency: Date.now() - totalStart,
      error: err?.message || 'TCP connection failed',
    }
  }

  return new Promise((resolve) => {
    let settled = false
    let client: Client | undefined
    let jumpClient: Client | undefined
    let stream: ClientChannel | undefined
    let timer: ReturnType<typeof setTimeout> | null = null
    let hostKeyReject: HostKeyRejectInfo | null = null

    const finish = (result: SshTestConnectionResult) => {
      if (settled) return
      settled = true
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      try {
        stream?.removeAllListeners()
        stream?.close()
      } catch {}
      destroyClient(client)
      destroyClient(jumpClient)
      resolve({
        ...result,
        latency: result.latency ?? Date.now() - totalStart,
      })
    }

    timer = setTimeout(() => {
      finish({
        ok: false,
        stage: 'ssh_handshake',
        error: `SSH test timeout (${timeoutMs}ms)`,
      })
    }, timeoutMs)

    const onHostKeyReject = (info: HostKeyRejectInfo) => {
      hostKeyReject = info
    }

    const targetConfig = (sock?: import('stream').Duplex): ConnectConfig => ({
      ...(sock ? { sock } : { host: params.host, port: params.port || 22 }),
      ...buildAuthFields({
        username: params.username,
        password: params.password,
        privateKey: params.privateKey,
        useAgent: params.useAgent,
      }),
      readyTimeout: timeoutMs,
      hostVerifier: createHostVerifier(
        knownHosts,
        params.host,
        params.port || 22,
        'target',
        onHostKeyReject,
      ),
    })

    const openShellOrSucceed = (c: Client) => {
      if (!checkShell) {
        finish({ ok: true })
        return
      }
      c.shell(
        { term: 'xterm-256color', cols: 80, rows: 24 },
        (err, sh) => {
          if (err) {
            finish({
              ok: false,
              stage: 'shell',
              error: `Shell open error: ${err.message}`,
            })
            return
          }
          stream = sh
          finish({ ok: true })
        },
      )
    }

    const attachTarget = (c: Client) => {
      client = c
      c.once('ready', () => openShellOrSucceed(c))
      c.once('error', (err) => {
        if (hostKeyReject) {
          finish({
            ok: false,
            stage: 'host_key',
            error: hostKeyReject.error,
            hostKeyHost: hostKeyReject.host,
            hostKeyPort: hostKeyReject.port,
            hostKeyRole: hostKeyReject.role,
            existingFingerprint: hostKeyReject.existingFingerprint,
            newFingerprint: hostKeyReject.fingerprint,
          })
          return
        }
        finish({
          ok: false,
          stage: classifyAuthError(err.message),
          error: err.message,
        })
      })
    }

    if (!hasJump) {
      const c = new Client()
      attachTarget(c)
      c.connect(targetConfig())
      return
    }

    jumpClient = new Client()
    const jumpHost = params.jumpHost!.trim()
    const jumpPort = params.jumpPort || 22
    jumpClient
      .on('ready', () => {
        jumpClient!.forwardOut(
          '127.0.0.1',
          0,
          params.host,
          params.port || 22,
          (err, fwd) => {
            if (err) {
              finish({
                ok: false,
                stage: 'jump',
                error: `Jump host forward failed: ${err.message}`,
              })
              return
            }
            const c = new Client()
            attachTarget(c)
            c.connect(targetConfig(fwd))
          },
        )
      })
      .on('error', (err) => {
        if (hostKeyReject) {
          finish({
            ok: false,
            stage: 'host_key',
            error: hostKeyReject.error,
            hostKeyHost: hostKeyReject.host,
            hostKeyPort: hostKeyReject.port,
            hostKeyRole: hostKeyReject.role,
            existingFingerprint: hostKeyReject.existingFingerprint,
            newFingerprint: hostKeyReject.fingerprint,
          })
          return
        }
        finish({
          ok: false,
          stage: classifyAuthError(err.message) === 'auth' ? 'auth' : 'jump',
          error: `Jump host error: ${err.message}`,
        })
      })
      .connect({
        host: jumpHost,
        port: jumpPort,
        ...buildAuthFields({
          username: params.jumpUsername || params.username,
          password: params.jumpPassword ?? params.password,
          privateKey: params.jumpPrivateKey ?? params.privateKey,
          useAgent: params.useAgent,
        }),
        readyTimeout: timeoutMs,
        hostVerifier: createHostVerifier(
          knownHosts,
          jumpHost,
          jumpPort,
          'jump',
          onHostKeyReject,
        ),
      })
  })
}
