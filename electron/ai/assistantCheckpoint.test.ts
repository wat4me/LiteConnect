import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAssistantCheckpoint } from './assistantCheckpoint'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('main-process assistant checkpoints', () => {
  it('saves during continuous tokens and stays idle without changes', async () => {
    let text = ''
    const saved: string[] = []
    const checkpoint = createAssistantCheckpoint(async () => { saved.push(text) })
    for (let i = 0; i < 36; i++) {
      text += 'x'
      checkpoint.schedule()
      await vi.advanceTimersByTimeAsync(100)
    }
    expect(saved.map(s => s.length)).toEqual([12, 24, 36])
    await vi.advanceTimersByTimeAsync(5000)
    expect(saved).toHaveLength(3)
    await checkpoint.stop()
  })

  it('saves tool-only state promptly, ahead of a pending text timer', async () => {
    const save = vi.fn(async () => {})
    const checkpoint = createAssistantCheckpoint(save)
    checkpoint.schedule()
    await vi.advanceTimersByTimeAsync(100)
    checkpoint.schedule(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(save).toHaveBeenCalledTimes(1)
    await checkpoint.stop()
  })

  it('coalesces changes during a slow write and drains before final save', async () => {
    let release!: () => void
    const writes: string[] = []
    let current = 'first'
    const checkpoint = createAssistantCheckpoint(async () => {
      writes.push(current)
      await new Promise<void>(resolve => { release = resolve })
    })
    checkpoint.schedule(true)
    await vi.advanceTimersByTimeAsync(0)
    current = 'latest'
    for (let i = 0; i < 20; i++) checkpoint.schedule(true)
    await vi.advanceTimersByTimeAsync(5000)
    expect(writes).toEqual(['first'])
    let stopped = false
    const end = checkpoint.stop().then(() => { stopped = true; writes.push('final') })
    await Promise.resolve()
    expect(stopped).toBe(false)
    release()
    await end
    checkpoint.schedule(true)
    await vi.advanceTimersByTimeAsync(5000)
    expect(writes).toEqual(['first', 'final'])
  })

  it('saves changes received while a previous write was in flight', async () => {
    let release!: () => void
    const save = vi.fn().mockImplementationOnce(() => new Promise<void>(r => { release = r }))
      .mockResolvedValue(undefined)
    const checkpoint = createAssistantCheckpoint(save)
    checkpoint.schedule(true)
    await vi.advanceTimersByTimeAsync(0)
    checkpoint.schedule()
    release()
    await vi.advanceTimersByTimeAsync(1200)
    expect(save).toHaveBeenCalledTimes(2)
    await checkpoint.stop()
  })
})
