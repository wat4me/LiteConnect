import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useTerminalPwdQuery } from './useTerminalPwdQuery'

function createHarness(opts?: { pendingInput?: string }) {
  const writes: string[] = []
  const term = { write: vi.fn() }
  const onLineClearedForPwd = vi.fn()
  const onRestorePendingInput = vi.fn()
  const onPwdOutput = vi.fn()

  const api = useTerminalPwdQuery({
    getTerminal: () => term as any,
    flushRenderBatch: (cb) => cb?.(),
    writeToSsh: (data) => {
      writes.push(data)
    },
    onPwdOutput,
    getPendingInput: () => opts?.pendingInput ?? '',
    onLineClearedForPwd,
    onRestorePendingInput,
  })

  return { api, writes, term, onLineClearedForPwd, onRestorePendingInput, onPwdOutput }
}

function markersFromCommand(cmd: string) {
  const tokenMatch = cmd.match(/PWD_([a-z0-9]+_[a-z0-9]+)_/)
  if (!tokenMatch) throw new Error('token not found in probe command')
  const token = tokenMatch[1]
  return {
    start: `__LITECONNECT_PWD_${token}_START__`,
    end: `__LITECONNECT_PWD_${token}_END__`,
  }
}

describe('useTerminalPwdQuery', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('hides probe command echo before START (no _lssh_ leak to screen)', () => {
    const { api } = createHarness()
    void api.requestInteractivePwd()

    const leaked =
      "_lssh_a=__LITECONNECT_; _lssh_b=PWD_abc_def_; printf '\\n%s%sSTART__\\n' \"$_lssh_a\" \"$_lssh_b\"; pwd\r\n"
    expect(api.processPwdQueryData(leaked)).toBe('')
    expect(api.processPwdQueryData('\b \b')).toBe('')
  })

  it('locally erases draft text when probe starts', () => {
    const { api, term } = createHarness({ pendingInput: 'echo hi' })
    void api.requestInteractivePwd()
    expect(term.write).toHaveBeenCalled()
    const local = String(term.write.mock.calls[0][0])
    // One rubout sequence per code point of "echo hi" (7 chars)
    expect(local).toBe('\b \b'.repeat(7))
  })

  it('hides probe body and shows prompt after END; restores pending input', async () => {
    const { api, writes, onLineClearedForPwd, onRestorePendingInput, onPwdOutput } = createHarness({
      pendingInput: 'echo hello',
    })

    const promise = api.requestInteractivePwd()
    expect(onLineClearedForPwd).toHaveBeenCalled()
    expect(writes[0]).toMatch(/^\x15/)
    expect(writes[0]).toContain('pwd;')

    const { start, end } = markersFromCommand(writes[0])

    // Full probe echo must stay hidden; only post-END prompt is visible
    const out = api.processPwdQueryData(
      `_lssh_a=...; pwd\r\n${start}\n/home/u/project\n${end}\n[root@localhost ~]# `,
    )
    expect(out).toContain('[root@localhost ~]# ')
    expect(out).not.toContain('_lssh_')
    expect(out).not.toContain(start)
    expect(out).not.toContain(end)
    expect(out).not.toContain('/home/u/project\n')

    await expect(promise).resolves.toBe('/home/u/project')
    expect(onPwdOutput).toHaveBeenCalledWith('/home/u/project')

    vi.advanceTimersByTime(80)
    expect(writes.some((w) => w === 'echo hello')).toBe(true)
    expect(onRestorePendingInput).toHaveBeenCalledWith('echo hello')
  })

  it('does not paint buffered command echo on timeout', async () => {
    const { api, writes, onRestorePendingInput, term } = createHarness({ pendingInput: 'ls -la' })
    const promise = api.requestInteractivePwd()

    // Probe echo arrives but START never does
    expect(api.processPwdQueryData('_lssh_a=__LITECONNECT_; ...')).toBe('')

    vi.advanceTimersByTime(5000)
    await expect(promise).rejects.toThrow(/timeout/i)

    // Must not dump the leaked command into the terminal on timeout
    expect(term.write.mock.calls.length).toBe(1) // only local draft erase
    expect(String(term.write.mock.calls[0][0])).not.toContain('_lssh_')

    vi.advanceTimersByTime(50)
    expect(writes.some((w) => w === 'ls -la')).toBe(true)
    expect(onRestorePendingInput).toHaveBeenCalledWith('ls -la')
  })
})
