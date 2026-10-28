import { describe, expect, it } from 'vitest'
import { createFrameSamples, getRendererTimings, measureRendererModule, recordRendererTiming } from './rendererPerformance'

describe('renderer performance sampling', () => {
  it('measures frame intervals without assuming a 60 Hz display', () => {
    const frames = createFrameSamples()
    for (let index = 0; index <= 120; index++) frames.sample(index * (1000 / 120))
    expect(frames.snapshot().fps).toBeCloseTo(120)
    expect(frames.snapshot().p95Ms).toBeCloseTo(1000 / 120)
  })

  it('bounds sample memory and excludes the time spent hidden', () => {
    const frames = createFrameSamples(3)
    frames.sample(0)
    frames.sample(10)
    frames.sample(20)
    frames.resetClock()
    frames.sample(10_000)
    frames.sample(10_010)
    frames.sample(10_020)
    expect(frames.snapshot()).toEqual({ fps: 100, p95Ms: 10, maxMs: 10, sampleCount: 3 })
  })

  it('keeps stalls visible in percentiles rather than reporting only average FPS', () => {
    const frames = createFrameSamples()
    frames.sample(0)
    frames.sample(16)
    frames.sample(116)
    frames.sample(132)
    expect(frames.snapshot().p95Ms).toBe(100)
    expect(frames.snapshot().maxMs).toBe(100)
  })

  it('records bounded latest timings and preserves module results', async () => {
    recordRendererTiming('renderer-mounted', 100)
    recordRendererTiming('renderer-mounted', 120)
    recordRendererTiming('view-layout', Number.NaN)
    const result = await measureRendererModule('settings-load', async () => 'loaded')
    expect(result).toBe('loaded')
    expect(getRendererTimings().filter(row => row.id === 'renderer-mounted')).toEqual([{ id: 'renderer-mounted', durationMs: 120 }])
    expect(getRendererTimings().find(row => row.id === 'settings-load')?.durationMs).toBeGreaterThanOrEqual(0)
  })
})
