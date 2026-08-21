import { PassThrough } from 'stream'
import { describe, expect, it, vi } from 'vitest'
import { collectExecChannel } from './sessionExec'

function makeChannel() {
  const channel = new PassThrough() as PassThrough & {
    stderr: PassThrough
    close: () => void
  }
  channel.stderr = new PassThrough()
  channel.close = () => {
    channel.end()
    channel.stderr.end()
  }
  return channel
}

describe('collectExecChannel', () => {
  it('captures stdout, stderr, and exit code', async () => {
    const channel = makeChannel()
    const pending = collectExecChannel(channel, 1000)
    channel.write('hello')
    channel.stderr.write('warn')
    channel.emit('exit', 3, undefined)
    channel.end()
    channel.emit('close', 3)
    const result = await pending
    expect(result.stdout).toBe('hello')
    expect(result.stderr).toBe('warn')
    expect(result.exitCode).toBe(3)
    expect(result.truncated).toBe(false)
  })

  it('writes stdin then EOF before collecting output', async () => {
    const channel = makeChannel()
    const written: string[] = []
    let ended = false
    channel.write = ((chunk: unknown) => {
      written.push(String(chunk))
      return true
    }) as typeof channel.write
    channel.end = (() => {
      ended = true
      return channel
    }) as typeof channel.end
    const pending = collectExecChannel(channel, 1000, { stdin: 'yes\n' })
    await Promise.resolve()
    expect(written).toEqual(['yes\n'])
    expect(ended).toBe(true)
    channel.emit('exit', 0)
    channel.emit('close', 0)
    const result = await pending
    expect(result.exitCode).toBe(0)
  })

  it('times out and rejects', async () => {
    vi.useFakeTimers()
    const channel = makeChannel()
    const pending = collectExecChannel(channel, 50)
    const assertion = expect(pending).rejects.toThrow(/Exec timeout after 50ms/)
    await vi.advanceTimersByTimeAsync(50)
    await assertion
    vi.useRealTimers()
  })
})
