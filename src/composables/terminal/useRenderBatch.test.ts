import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRenderBatch } from '../session/'
import type { Terminal } from '@xterm/xterm'

function mockTerminal() {
  const writes: string[] = []
  const terminal = {
    write(data: string, cb?: () => void) {
      writes.push(data)
      cb?.()
    },
  } as unknown as Terminal
  return { terminal, writes }
}

describe('useRenderBatch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('flushes on rAF when active', () => {
    const { terminal, writes } = mockTerminal()
    const batch = useRenderBatch(() => terminal)
    const g = globalThis as typeof globalThis & {
      requestAnimationFrame: (cb: FrameRequestCallback) => number
      cancelAnimationFrame: (id: number) => void
    }
    const prevRaf = g.requestAnimationFrame
    const prevCancel = g.cancelAnimationFrame
    g.requestAnimationFrame = (cb) => {
      cb(0)
      return 1
    }
    g.cancelAnimationFrame = () => {}

    try {
      batch.appendRenderBatch('hello')
      batch.scheduleRenderFlush()
      expect(writes).toEqual(['hello'])
    } finally {
      if (prevRaf) g.requestAnimationFrame = prevRaf
      else delete (g as { requestAnimationFrame?: unknown }).requestAnimationFrame
      if (prevCancel) g.cancelAnimationFrame = prevCancel
      else delete (g as { cancelAnimationFrame?: unknown }).cancelAnimationFrame
    }
  })

  it('throttles flush when frozen and never drops data', () => {
    const { terminal, writes } = mockTerminal()
    const batch = useRenderBatch(() => terminal)
    batch.setRenderFrozen(true)

    batch.appendRenderBatch('a')
    batch.scheduleRenderFlush()
    batch.appendRenderBatch('b')
    batch.scheduleRenderFlush()
    expect(writes).toEqual([])

    vi.advanceTimersByTime(200)
    expect(writes).toEqual(['ab'])
  })

  it('flushes pending data when unfrozen', () => {
    const { terminal, writes } = mockTerminal()
    const batch = useRenderBatch(() => terminal)
    batch.setRenderFrozen(true)
    batch.appendRenderBatch('pending')
    batch.scheduleRenderFlush()
    expect(writes).toEqual([])

    batch.setRenderFrozen(false)
    expect(writes).toEqual(['pending'])
  })

  it('force-flushes when batch exceeds cap', () => {
    const { terminal, writes } = mockTerminal()
    const batch = useRenderBatch(() => terminal)
    batch.setRenderFrozen(true)
    const chunk = 'x'.repeat(256 * 1024)
    batch.appendRenderBatch(chunk)
    expect(writes).toEqual([chunk])
  })

  it('docker-style freeze keeps accepting SSH data without drop', () => {
    const { terminal, writes } = mockTerminal()
    const batch = useRenderBatch(() => terminal)
    // Enter Docker: frozen (throttled writes into xterm buffer)
    batch.setRenderFrozen(true)
    batch.appendRenderBatch('line1\n')
    batch.scheduleRenderFlush()
    batch.appendRenderBatch('line2\n')
    batch.scheduleRenderFlush()
    expect(batch.getPendingBatchLength()).toBeGreaterThan(0)
    vi.advanceTimersByTime(200)
    expect(writes.join('')).toContain('line1')
    expect(writes.join('')).toContain('line2')
    // Leave Docker: unfreeze flushes remainder once
    batch.setRenderFrozen(true)
    batch.appendRenderBatch('tail')
    batch.setRenderFrozen(false)
    expect(writes.join('')).toContain('tail')
  })
})
