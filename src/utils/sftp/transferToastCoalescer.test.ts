import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createTransferToastCoalescer,
  type TransferToastSummary,
} from './transferToastCoalescer'

function completed(direction: 'upload' | 'download', fileName: string): TransferToastSummary {
  return {
    direction,
    success: 1,
    error: 0,
    skipped: 0,
    partial: 0,
    cancelled: 0,
    total: 1,
    single: { fileName, status: 'completed' },
  }
}

describe('createTransferToastCoalescer', () => {
  afterEach(() => vi.useRealTimers())

  it('turns many upload completions into one summary', () => {
    vi.useFakeTimers()
    const flushed = vi.fn()
    const coalescer = createTransferToastCoalescer(flushed, 900)

    for (let i = 0; i < 100; i++) coalescer.push(completed('upload', `${i}.log`))
    vi.advanceTimersByTime(899)
    expect(flushed).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)

    expect(flushed).toHaveBeenCalledTimes(1)
    expect(flushed).toHaveBeenCalledWith(expect.objectContaining({
      direction: 'upload',
      success: 100,
      total: 100,
      single: undefined,
    }))
  })

  it('keeps upload and download summaries independent', () => {
    vi.useFakeTimers()
    const flushed = vi.fn()
    const coalescer = createTransferToastCoalescer(flushed, 100)
    coalescer.push(completed('upload', 'up.txt'))
    coalescer.push(completed('download', 'down.txt'))
    vi.runAllTimers()
    expect(flushed).toHaveBeenCalledTimes(2)
  })

  it('flushes pending summaries during teardown', () => {
    vi.useFakeTimers()
    const flushed = vi.fn()
    const coalescer = createTransferToastCoalescer(flushed)
    coalescer.push(completed('upload', 'one.txt'))
    coalescer.flushAll()
    expect(flushed).toHaveBeenCalledTimes(1)
    vi.runAllTimers()
    expect(flushed).toHaveBeenCalledTimes(1)
  })
})
