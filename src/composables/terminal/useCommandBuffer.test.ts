import { describe, expect, it, vi } from 'vitest'
import type { Terminal } from '@xterm/xterm'
import { useCommandBuffer } from './useCommandBuffer'

function terminalShowing(text: string): Terminal {
  return {
    buffer: {
      active: {
        baseY: 0,
        cursorY: 0,
        getLine: () => ({ translateToString: () => text }),
      },
    },
  } as unknown as Terminal
}

describe('useCommandBuffer', () => {
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
    expect(onSubmitted).toHaveBeenCalledWith(null)
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
