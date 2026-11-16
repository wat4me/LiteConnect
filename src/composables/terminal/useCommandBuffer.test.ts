import { describe, expect, it, vi } from 'vitest'
import { Terminal as HeadlessTerminal } from '@xterm/headless'
import type { Terminal } from '@xterm/xterm'
import { useCommandBuffer } from './useCommandBuffer'

function terminalShowing(text: string): Terminal {
  return {
    buffer: {
      active: {
        length: 1,
        baseY: 0,
        cursorY: 0,
        getLine: () => ({ translateToString: () => text }),
      },
    },
  } as unknown as Terminal
}

type Row = { text: string; wrapped?: boolean }
function terminalRows(rows: Row[], cursor: { y: number; x: number }, type: 'normal' | 'alternate' = 'normal'): Terminal {
  return {
    buffer: {
      active: {
        length: rows.length,
        type,
        baseY: 0,
        cursorY: cursor.y,
        cursorX: cursor.x,
        getLine: (y: number) => rows[y] && {
          isWrapped: !!rows[y].wrapped,
          translateToString: (trim?: boolean, start = 0, end?: number) => {
            const text = rows[y].text.slice(start, end)
            return trim ? text.trimEnd() : text
          },
        },
      },
    },
  } as unknown as Terminal
}

/** Simulate typing `typed` after `prompt`, then Enter with the screen showing `screen`. */
function submit(prompt: string, typed: string, screen: Row[] = [{ text: prompt + typed }], type: 'normal' | 'alternate' = 'normal') {
  let terminal = terminalRows([{ text: prompt }], { y: 0, x: prompt.length }, type)
  const onSubmitted = vi.fn()
  const buffer = useCommandBuffer({ getTerminal: () => terminal, onCdCommand: vi.fn(), onSubmitted })
  buffer.notePromptBeforeInput()
  buffer.commandBuffer.value = typed
  terminal = terminalRows(screen, { y: screen.length - 1, x: 0 }, type)
  buffer.capturedSubmitLine.value = buffer.getVisibleCommandLine()
  const command = buffer.submitBufferedCommand()
  return { command, info: onSubmitted.mock.calls[0][1] as { historyEligible: boolean; promptTerminator: string } }
}

describe('history eligibility of submitted lines', () => {
  it('keeps redirections that contain a prompt-like "> "', () => {
    const { command, info } = submit('ops@edge:~$ ', 'echo hi > out.txt')
    expect(command).toBe('echo hi > out.txt')
    expect(info).toEqual({ historyEligible: true, promptTerminator: '$' })
  })

  it('reads a long command across wrapped rows', () => {
    const prompt = 'ops@edge:~$ '
    const { command, info } = submit(prompt, 'docker logs --tail 200 web', [
      { text: `${prompt}docker logs --ta` },
      { text: 'il 200 web', wrapped: true },
    ])
    expect(command).toBe('docker logs --tail 200 web')
    expect(info.historyEligible).toBe(true)
  })

  it('never learns input that the remote did not echo (passwords)', () => {
    const { info } = submit('[sudo] password for ops: ', 'hunter2', [{ text: '[sudo] password for ops: ' }])
    expect(info.historyEligible).toBe(false)
  })

  it.each([
    ['mysql> ', 'select 1;'],
    ['postgres=# ', 'select 1;'],
    ['>>> ', 'print(1)'],
    ['> ', 'done'],
    ['redis 127.0.0.1:6379> ', 'keys *'],
  ])('ignores lines typed at %j', (prompt, typed) => {
    expect(submit(prompt, typed).info.historyEligible).toBe(false)
  })

  it('ignores input to full-screen programs and private leading-space commands', () => {
    expect(submit('ops@edge:~$ ', ':wq', undefined, 'alternate').info.historyEligible).toBe(false)
    expect(submit('ops@edge:~$ ', ' export TOKEN=x').info.historyEligible).toBe(false)
  })

  it('accepts common prompt styles', () => {
    for (const prompt of ['[root@host ~]# ', 'user@mac ~ % ', '➜  repo git:(main) ', 'PS C:\\work> ']) {
      expect(submit(prompt, 'ls').info.historyEligible).toBe(true)
    }
  })
})

describe('useCommandBuffer', () => {
  it('stays within the xterm buffer when a single wrapped line fills scrollback', async () => {
    const terminal = new HeadlessTerminal({ cols: 8, rows: 2, scrollback: 4, allowProposedApi: true })
    try {
      await new Promise<void>(resolve => terminal.write('x'.repeat(80), resolve))
      const active = terminal.buffer.active
      expect(active.getLine(0)?.isWrapped).toBe(true)
      // The underlying ring returns a wrapped row even at the end-exclusive index.
      expect(active.getLine(active.length)?.isWrapped).toBe(true)
      const getLine = active.getLine.bind(active)
      const read = vi.spyOn(active, 'getLine').mockImplementation(index => index < active.length ? getLine(index) : undefined)
      const commands = useCommandBuffer({ getTerminal: () => terminal, onCdCommand: vi.fn() })

      commands.notePromptBeforeInput()
      expect(commands.getVisibleCommandLine()).toBe('')
      expect(read).not.toHaveBeenCalledWith(active.length)
    } finally {
      terminal.dispose()
    }
  })

  it('resyncs the command after a remote Tab completion so suggestions can return', () => {
    let visibleLine = 'root@host:~# cd /'
    const buffer = useCommandBuffer({
      getTerminal: () => terminalShowing(visibleLine),
      onCdCommand: vi.fn(),
    })
    buffer.commandBuffer.value = 'cd /'
    buffer.commandBufferDirty.value = true

    expect(buffer.syncAfterTabCompletion('cd /', true)).toBe(false)
    visibleLine = 'root@host:~# cd /home'
    expect(buffer.syncAfterTabCompletion('cd /', true)).toBe(true)
    expect(buffer.commandBuffer.value).toBe('cd /home')
    expect(buffer.commandBufferDirty.value).toBe(false)

    visibleLine = 'root@host:~# cd /home/user'
    expect(buffer.syncAfterTabCompletion('cd /', true)).toBe(true)
    expect(buffer.commandBuffer.value).toBe('cd /home/user')
  })

  it('does not trust unrelated terminal output as a Tab completion', () => {
    const buffer = useCommandBuffer({
      getTerminal: () => terminalShowing('root@host:~# unrelated'),
      onCdCommand: vi.fn(),
    })
    buffer.commandBuffer.value = 'cd /'
    buffer.commandBufferDirty.value = true

    expect(buffer.syncAfterTabCompletion('cd /')).toBe(false)
    expect(buffer.commandBuffer.value).toBe('cd /')
    expect(buffer.commandBufferDirty.value).toBe(true)
  })

  it('does not capture a connection notice when Enter was pressed without a command', () => {
    const onSubmitted = vi.fn()
    const buffer = useCommandBuffer({
      getTerminal: () => terminalShowing('Connecting to 10.2.178.163...'),
      onCdCommand: vi.fn(),
      onSubmitted,
    })

    buffer.capturedSubmitLine.value = 'Connecting to 10.2.178.163...'
    expect(buffer.submitBufferedCommand()).toBeNull()
    expect(onSubmitted).toHaveBeenCalledWith(null, expect.objectContaining({ historyEligible: false }))
  })

  it('still captures a command recalled from shell history', () => {
    const buffer = useCommandBuffer({
      getTerminal: () => terminalShowing('user@host:~$ ls -la'),
      onCdCommand: vi.fn(),
    })

    buffer.commandBufferDirty.value = true
    buffer.capturedSubmitLine.value = 'user@host:~$ ls -la'
    expect(buffer.submitBufferedCommand()).toBe('ls -la')
  })
})
