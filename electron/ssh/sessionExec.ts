import { MCP_EXEC_HARD_CAP_CHARS } from '../../shared/mcp/limits'
import { capCollectedStream } from '../../shared/mcp/truncate'

export type SessionExecResult = {
  stdout: string
  stderr: string
  exitCode: number | null
  signal?: string
  truncated: boolean
}

type ExecChannel = NodeJS.ReadWriteStream & {
  stderr?: NodeJS.ReadableStream
  close?: () => void
  destroy?: () => void
  end?: () => void
}

export type CollectExecOptions = {
  /** Written once to stdin, then the writable side is ended (EOF). Not a PTY. */
  stdin?: string
}

/**
 * Drain a non-PTY exec channel. Caps each stream so a flood cannot grow without bound.
 * Exit code comes from ssh2 `exit` when present, otherwise from `close`.
 */

export function collectExecChannel(
  channel: ExecChannel,
  timeoutMs: number,
  opts?: CollectExecOptions,
): Promise<SessionExecResult> {
  return new Promise((resolve, reject) => {
    let settled = false
    let stdout = ''
    let stderr = ''
    let truncated = false
    let exitCode: number | null = null
    let signal: string | undefined

    const finish = (err?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      detach()
      if (err) {
        try {
          channel.destroy?.()
        } catch {}
        reject(err)
        return
      }
      resolve({ stdout, stderr, exitCode, signal, truncated })
    }

    const onStdout = (chunk: Buffer | string) => {
      const next = capCollectedStream(stdout, chunk.toString('utf-8'), MCP_EXEC_HARD_CAP_CHARS)
      stdout = next.text
      if (next.truncated) truncated = true
    }
    const onStderr = (chunk: Buffer | string) => {
      const next = capCollectedStream(stderr, chunk.toString('utf-8'), MCP_EXEC_HARD_CAP_CHARS)
      stderr = next.text
      if (next.truncated) truncated = true
    }
    const onExit = (code?: number | null, sig?: string) => {
      if (typeof code === 'number' && Number.isFinite(code)) exitCode = code
      else if (code === null) exitCode = null
      if (typeof sig === 'string' && sig) signal = sig
    }
    const onClose = (code?: number | null, sig?: string) => {
      onExit(code, sig)
      finish()
    }
    const onError = (err: Error) => finish(err)

    const detach = () => {
      channel.removeListener('data', onStdout)
      channel.removeListener('exit', onExit)
      channel.removeListener('close', onClose)
      channel.removeListener('error', onError)
      channel.stderr?.removeListener('data', onStderr)
    }

    const timer = setTimeout(() => {
      try {
        channel.close?.()
      } catch {}
      try {
        channel.destroy?.()
      } catch {}
      finish(new Error(`Exec timeout after ${timeoutMs}ms`))
    }, timeoutMs)

    channel.on('data', onStdout)
    channel.on('exit', onExit)
    channel.on('close', onClose)
    channel.on('error', onError)
    channel.stderr?.on('data', onStderr)

    const stdin = typeof opts?.stdin === 'string' ? opts.stdin : ''
    if (stdin) {
      try {
        channel.write(stdin)
        channel.end?.()
      } catch (err) {
        finish(err instanceof Error ? err : new Error(String(err)))
      }
    }
  })
}
