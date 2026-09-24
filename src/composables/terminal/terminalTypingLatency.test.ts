import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Terminal } from '@xterm/xterm'
import { createDelayedTerminalOutput, createTypingResponseTracker } from './terminalTypingLatency'
import { useRenderBatch } from './useRenderBatch'
import { createLocalEchoModel, type LocalEchoScreen } from '@/utils/terminal/localEchoModel'

function screen(lineText: string): LocalEchoScreen {
  return {
    row: 4,
    col: lineText.length,
    cols: 80,
    normal: true,
    readCells: (start, end) => lineText.slice(start, end).padEnd(end - start),
  }
}

describe('development SSH latency simulation', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
  })

  afterEach(() => vi.useRealTimers())

  it('replays a 1500 ms echo through the interactive render path', () => {
    const writes: string[] = []
    const terminal = { write: (data: string, done?: () => void) => {
      writes.push(data)
      done?.()
    } } as Terminal
    const batch = useRenderBatch(() => terminal)
    const tracker = createTypingResponseTracker(() => Date.now())
    const samples: number[] = []
    const delayed = createDelayedTerminalOutput((data) => {
      const sample = tracker.takeResponse()
      expect(sample).not.toBeNull()
      samples.push(sample!.responseMs)
      batch.appendRenderBatch(data)
      expect(batch.flushInteractiveResponse()).toBe(true)
    }, 1500)

    tracker.noteInput('a', true)
    tracker.finishInputHandler()
    delayed.push('a')
    vi.advanceTimersByTime(1499)
    expect(writes).toEqual([])
    vi.advanceTimersByTime(1)
    expect(writes).toEqual(['a'])
    expect(samples).toEqual([1500])
  })

  it('preserves chunk order and drops pending output when a session closes', () => {
    const output: string[] = []
    const delayed = createDelayedTerminalOutput((data) => output.push(data), 1200)
    delayed.push('one')
    vi.advanceTimersByTime(100)
    delayed.push('two')
    vi.advanceTimersByTime(1100)
    expect(output).toEqual(['one'])
    delayed.dispose()
    vi.advanceTimersByTime(5000)
    expect(output).toEqual(['one'])
  })

  it('keeps successive typed characters in order under delay', () => {
    const output: string[] = []
    const delayed = createDelayedTerminalOutput((data) => output.push(data), 1500)
    delayed.push('a')
    vi.advanceTimersByTime(80)
    delayed.push('b')
    vi.advanceTimersByTime(80)
    delayed.push('c')
    vi.advanceTimersByTime(1500)
    expect(output).toEqual(['a', 'b', 'c'])
  })

  it('does not treat a late or non-printable input as a typing response', () => {
    const tracker = createTypingResponseTracker(() => Date.now())
    tracker.noteInput('a', true)
    vi.advanceTimersByTime(6000)
    expect(tracker.takeResponse()).toBeNull()
    tracker.noteInput('\r', true)
    expect(tracker.takeResponse()).toBeNull()
  })

  it('keeps predicted text visible while 1500 ms echoes arrive one at a time', () => {
    const model = createLocalEchoModel()
    const prompt = 'user@host:~$ '
    let actual = prompt
    let preview = ''
    const delayed = createDelayedTerminalOutput((char) => {
      actual += char
      preview = model.reconcile(screen(actual))
    }, 1500)

    preview = model.input('a', screen(actual), true)
    delayed.push('a')
    vi.advanceTimersByTime(80)
    preview = model.input('b', screen(actual), true)
    delayed.push('b')
    expect(preview).toBe('ab')

    vi.advanceTimersByTime(1420)
    expect(actual).toBe(`${prompt}a`)
    expect(preview).toBe('b')
    vi.advanceTimersByTime(80)
    expect(actual).toBe(`${prompt}ab`)
    expect(preview).toBe('')
  })
})
