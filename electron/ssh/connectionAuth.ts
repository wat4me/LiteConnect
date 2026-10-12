import type { Client, ConnectConfig } from 'ssh2'
import type { Duplex } from 'stream'
import { v4 as uuidv4 } from 'uuid'
import { buildAuthFields } from './auth'
import { createHostVerifier, type HostKeyRejectInfo } from './trust/hostKeyVerify'
import type { KnownHostsStore } from './trust/knownHosts'
import type { Connection, SSHCallbacks } from './types'
import type { resolveSshKeepalive } from './keepalive'
import { autoAnswerKeyboardPrompts } from './keyboardInteractive'
import { SSH_AUTH_PROMPT_TIMEOUT_MS, SSH_HANDSHAKE_TIMEOUT_MS } from '../../shared/sshConnectionProgress'

type Keepalive = ReturnType<typeof resolveSshKeepalive>
type RejectHostKey = (info: HostKeyRejectInfo) => void

export function attachKeyboardInteractive(
  sshClient: Client,
  role: 'target' | 'jump',
  password: string,
  sessionId: string,
  callbacks: SSHCallbacks,
) {
  let closed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const clear = () => { clearTimeout(timer); timer = undefined }
  const expire = (message: string) => {
    if (closed) return
    closed = true
    clear()
    sshClient.emit('error', new Error(message))
    sshClient.destroy()
  }
  const arm = (ms = SSH_HANDSHAKE_TIMEOUT_MS) => {
    clear()
    timer = setTimeout(() => expire(ms === SSH_AUTH_PROMPT_TIMEOUT_MS
      ? 'Authentication prompt timed out' : 'Timed out while waiting for handshake'), ms)
  }
  const done = () => { closed = true; clear(); callbacks.signal?.removeEventListener('abort', done) }
  callbacks.signal?.addEventListener('abort', done, { once: true })
  sshClient.once('ready', done)
  sshClient.once('close', done)
  sshClient.once('error', done)
  sshClient.on('handshake', () => { if (!closed) callbacks.onProgress?.('authenticating') })
  sshClient.on('keyboard-interactive', (
    name: string,
    instructions: string,
    _lang: string,
    prompts: Array<{ prompt: string; echo: boolean }>,
    finish: (responses: string[]) => void,
  ) => {
    const list = (prompts || []).map((p) => ({
      prompt: String(p?.prompt || ''),
      echo: p?.echo !== false,
    }))
    const auto = autoAnswerKeyboardPrompts(list, password)
    if (auto.complete) {
      finish(auto.answers)
      return
    }
    if (!callbacks.onKeyboardInteractive) {
      finish(list.map(() => ''))
      return
    }
    if (closed) return
    callbacks.onProgress?.('keyboard')
    arm(SSH_AUTH_PROMPT_TIMEOUT_MS)
    void callbacks.onKeyboardInteractive({
      requestId: uuidv4(), sessionId,
      name: String(name || ''),
      instructions: String(instructions || ''),
      prompts: list, role,
    }).then((answers) => {
      if (closed) return
      if (!answers || answers.length === 0) {
        expire('Authentication cancelled')
        return
      }
      arm()
      callbacks.onProgress?.('authenticating')
      finish(list.map((_, i) => String(answers[i] ?? '')))
    }).catch(() => { if (!closed) expire('Authentication cancelled') })
  })
  return { start: () => { if (!closed) arm() } }
}

export function targetConnectConfig(
  connection: Connection,
  knownHosts: KnownHostsStore,
  keepalive: Keepalive,
  onHostKeyReject: RejectHostKey,
  sock?: Duplex,
): ConnectConfig {
  return {
    ...(sock ? { sock } : { host: connection.host, port: connection.port || 22 }),
    ...buildAuthFields({
      username: connection.username,
      password: connection.password,
      privateKey: connection.privateKey,
      useAgent: connection.useAgent,
    }),
    // The explicit deadline pauses for user input; ssh2's readyTimeout does not.
    readyTimeout: 0,
    ...keepalive,
    hostVerifier: createHostVerifier(
      knownHosts, connection.host, connection.port || 22, 'target', onHostKeyReject,
    ),
  }
}

export function jumpConnectConfig(
  connection: Connection,
  knownHosts: KnownHostsStore,
  keepalive: Keepalive,
  onHostKeyReject: RejectHostKey,
): ConnectConfig {
  const jumpHost = connection.jumpHost!.trim()
  const jumpPort = connection.jumpPort || 22
  return {
    host: jumpHost,
    port: jumpPort,
    ...buildAuthFields({
      username: connection.jumpUsername || connection.username,
      password: connection.jumpPassword ?? connection.password,
      privateKey: connection.jumpPrivateKey ?? connection.privateKey,
      useAgent: connection.useAgent,
    }),
    readyTimeout: 0,
    ...keepalive,
    hostVerifier: createHostVerifier(knownHosts, jumpHost, jumpPort, 'jump', onHostKeyReject),
  }
}
