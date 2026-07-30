import { Client, type ConnectConfig, type ClientChannel } from 'ssh2'
import { Socket } from 'net'
import { AuthConnectionParams } from '../../utils/validation'
import { buildAuthFields } from '../auth'
import { classifyAuthError } from './testConnection'
import { createHostVerifier, type HostKeyRejectInfo } from '../trust/hostKeyVerify'
import type { KnownHostsStore } from '../trust/knownHosts'

const SSH_DIAG_TIMEOUT_MS = 10000

export type SshDiagnosisResult = {
  ok: boolean
  tcpLatency?: number
  sshReadyLatency?: number
  shellOpenLatency?: number
  shellFirstByteLatency?: number
  totalLatency?: number
  stage?: 'tcp' | 'ssh_handshake' | 'host_key' | 'auth' | 'jump' | 'shell'
  error?: string
}

export function classifyDiagnosisClientError(
  message: string,
  fallback: SshDiagnosisResult['stage'],
): SshDiagnosisResult['stage'] {
  if (fallback === 'jump') return 'jump'
  return classifyAuthError(message) === 'auth' ? 'auth' : fallback
}

function testTcpLatency(host: string, port: number, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    let settled = false
    const socket = new Socket()

    const finish = (handler: () => void) => {
      if (settled) return
      settled = true
      socket.removeAllListeners()
      socket.destroy()
      handler()
    }

    socket.setTimeout(timeoutMs)
    socket.once('connect', () => {
      finish(() => resolve(Date.now() - start))
    })
    socket.once('timeout', () => {
      finish(() => reject(new Error(`TCP connection timeout (${timeoutMs}ms)`)))
    })
    socket.once('error', (err) => {
      finish(() => reject(err))
    })

    socket.connect(port, host)
  })
}

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

/**
 * Diagnose connectivity with the same security path as formal connect when knownHosts is provided.
 */
export async function diagnoseSshConnection(
  params: AuthConnectionParams & {
    jumpHost?: string
    jumpPort?: number
    jumpUsername?: string
    jumpPassword?: string
    jumpPrivateKey?: string
    useAgent?: boolean
  },
  knownHosts?: KnownHostsStore,
): Promise<SshDiagnosisResult> {
  const totalStart = Date.now()
  let tcpLatency: number | undefined
  let sshReadyLatency: number | undefined
  let shellOpenLatency: number | undefined

  const hasJump = !!(params.jumpHost && params.jumpHost.trim())
  const tcpHost = hasJump ? params.jumpHost!.trim() : params.host
  const tcpPort = hasJump ? params.jumpPort || 22 : params.port

  try {
    tcpLatency = await testTcpLatency(tcpHost, tcpPort, SSH_DIAG_TIMEOUT_MS)
  } catch (err: any) {
    return {
      ok: false,
      tcpLatency,
      stage: 'tcp',
      error: err?.message || 'TCP connection failed',
    }
  }

  if (knownHosts) {
    await knownHosts.init()
  }

  return new Promise((resolve) => {
    const sshStart = Date.now()
    let client: Client | undefined
    let jumpClient: Client | undefined
    let stream: ClientChannel | undefined
    let done = false
    let shellTimeout: ReturnType<typeof setTimeout> | null = null
    let hostKeyReject: HostKeyRejectInfo | null = null

    const finish = (result: SshDiagnosisResult) => {
      if (done) return
      done = true
      if (shellTimeout) {
        clearTimeout(shellTimeout)
        shellTimeout = null
      }
      try {
        stream?.removeAllListeners()
        stream?.close()
      } catch {}
      destroyClient(client)
      destroyClient(jumpClient)
      resolve({
        tcpLatency,
        sshReadyLatency,
        shellOpenLatency,
        ...result,
      })
    }

    shellTimeout = setTimeout(() => {
      finish({
        ok: false,
        totalLatency: Date.now() - totalStart,
        stage: 'ssh_handshake',
        error: `SSH diagnosis timeout (${SSH_DIAG_TIMEOUT_MS}ms)`,
      })
    }, SSH_DIAG_TIMEOUT_MS)

    const onHostKeyReject = (info: HostKeyRejectInfo) => {
      hostKeyReject = info
    }

    const targetConfig = (sock?: import('stream').Duplex): ConnectConfig => {
      const base: ConnectConfig = {
        ...(sock ? { sock } : { host: params.host, port: params.port || 22 }),
        ...buildAuthFields({
          username: params.username,
          password: params.password,
          privateKey: params.privateKey,
          useAgent: params.useAgent,
        }),
        readyTimeout: SSH_DIAG_TIMEOUT_MS,
      }
      if (knownHosts) {
        base.hostVerifier = createHostVerifier(
          knownHosts,
          params.host,
          params.port || 22,
          'target',
          onHostKeyReject,
        )
      }
      return base
    }

    const openShell = (c: Client) => {
      sshReadyLatency = Date.now() - sshStart
      const shellStart = Date.now()
      c.shell(
        {
          term: 'xterm-256color',
          cols: 80,
          rows: 24,
        },
        (err, sh) => {
          if (err) {
            finish({
              ok: false,
              totalLatency: Date.now() - totalStart,
              stage: 'shell',
              error: `Shell open error: ${err.message}`,
            })
            return
          }

          stream = sh
          shellOpenLatency = Date.now() - shellStart
          const firstByteStart = Date.now()
          let gotFirstByte = false

          const handleFirstByte = () => {
            if (gotFirstByte) return
            gotFirstByte = true
            finish({
              ok: true,
              shellFirstByteLatency: Date.now() - firstByteStart,
              totalLatency: Date.now() - totalStart,
            })
          }

          sh.on('data', (data: Buffer) => {
            if (data.length > 0) handleFirstByte()
          })
          sh.stderr.on('data', (data: Buffer) => {
            if (data.length > 0) handleFirstByte()
          })
          sh.on('close', () => {
            if (!gotFirstByte) {
              finish({
                ok: false,
                totalLatency: Date.now() - totalStart,
                stage: 'shell',
                error: 'Shell closed before first byte',
              })
            }
          })

          sh.write('\r')
        },
      )
    }

    const onClientError = (err: Error, stageFallback: SshDiagnosisResult['stage']) => {
      if (hostKeyReject) {
        finish({
          ok: false,
          totalLatency: Date.now() - totalStart,
          stage: 'host_key',
          error: hostKeyReject.error,
        })
        return
      }
      finish({
        ok: false,
        totalLatency: Date.now() - totalStart,
        stage: classifyDiagnosisClientError(err.message, stageFallback),
        error: err.message,
      })
    }

    if (!hasJump) {
      client = new Client()
      client.on('ready', () => openShell(client!))
      client.on('error', (err) => onClientError(err, 'ssh_handshake'))
      client.connect(targetConfig())
      return
    }

    jumpClient = new Client()
    const jumpHost = params.jumpHost!.trim()
    const jumpPort = params.jumpPort || 22
    const jumpCfg: ConnectConfig = {
      host: jumpHost,
      port: jumpPort,
      ...buildAuthFields({
        username: params.jumpUsername || params.username,
        password: params.jumpPassword ?? params.password,
        privateKey: params.jumpPrivateKey ?? params.privateKey,
        useAgent: params.useAgent,
      }),
      readyTimeout: SSH_DIAG_TIMEOUT_MS,
    }
    if (knownHosts) {
      jumpCfg.hostVerifier = createHostVerifier(
        knownHosts,
        jumpHost,
        jumpPort,
        'jump',
        onHostKeyReject,
      )
    }

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
                totalLatency: Date.now() - totalStart,
                stage: 'jump',
                error: `Jump host forward failed: ${err.message}`,
              })
              return
            }
            client = new Client()
            client.on('ready', () => openShell(client!))
            client.on('error', (e) => onClientError(e, 'ssh_handshake'))
            client.connect(targetConfig(fwd))
          },
        )
      })
      .on('error', (err) => onClientError(err, 'jump'))
      .connect(jumpCfg)
  })
}
