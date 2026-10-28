export type RendererTimingId = 'renderer-mounted' | 'bootstrap-ready' | 'settings-load' | 'database-load' | 'ai-load' | 'ssh-load' | 'view-layout'
export type RendererTiming = { id: RendererTimingId; durationMs: number }
const timings = new Map<RendererTimingId, number>()

export function recordRendererTiming(id: RendererTimingId, durationMs: number) {
  if (Number.isFinite(durationMs) && durationMs >= 0) timings.set(id, durationMs)
}

export function getRendererTimings(): RendererTiming[] {
  return [...timings].map(([id, durationMs]) => ({ id, durationMs }))
}

export async function measureRendererModule<T>(id: RendererTimingId, loader: () => Promise<T>): Promise<T> {
  const start = performance.now()
  try { return await loader() }
  finally { recordRendererTiming(id, performance.now() - start) }
}

/** Layout transition timing; lazy-module loading is recorded separately. */
export function measureRendererLayout(): () => void {
  const start = performance.now()
  let raf = requestAnimationFrame(() => {
    raf = requestAnimationFrame(() => {
      raf = 0
      recordRendererTiming('view-layout', performance.now() - start)
    })
  })
  return () => { if (raf) cancelAnimationFrame(raf) }
}

export function createFrameSamples(capacity = 180) {
  const samples: number[] = []
  let previous: number | null = null
  function sample(timestamp: number) {
    if (previous !== null && timestamp > previous) {
      samples.push(timestamp - previous)
      if (samples.length > capacity) samples.shift()
    }
    previous = timestamp
  }
  function resetClock() { previous = null }
  function snapshot() {
    if (samples.length === 0) return { fps: null, p95Ms: null, maxMs: null, sampleCount: 0 }
    const sorted = [...samples].sort((a, b) => a - b)
    const sum = samples.reduce((total, duration) => total + duration, 0)
    return {
      fps: 1000 * samples.length / sum,
      p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
      maxMs: sorted[sorted.length - 1],
      sampleCount: samples.length,
    }
  }
  return { sample, resetClock, snapshot }
}

/** Runs only while the user has expanded diagnostics, and pauses when hidden. */
export function startRendererPerformanceSampling() {
  const frames = createFrameSamples()
  let raf = 0
  let stopped = false
  let longTasks: { count: number; totalMs: number; maxMs: number } | null = null
  let observer: PerformanceObserver | null = null

  function tick(timestamp: number) {
    raf = 0
    if (stopped || document.hidden) return
    frames.sample(timestamp)
    raf = requestAnimationFrame(tick)
  }
  function visibilityChanged() {
    frames.resetClock()
    if (document.hidden) {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
    } else if (!raf && !stopped) raf = requestAnimationFrame(tick)
  }
  if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes.includes('longtask')) {
    longTasks = { count: 0, totalMs: 0, maxMs: 0 }
    observer = new PerformanceObserver(list => {
      if (document.hidden) return
      for (const entry of list.getEntries()) {
        if (!longTasks) continue
        longTasks.count++
        longTasks.totalMs += entry.duration
        longTasks.maxMs = Math.max(longTasks.maxMs, entry.duration)
      }
    })
    observer.observe({ type: 'longtask' })
  }
  document.addEventListener('visibilitychange', visibilityChanged)
  visibilityChanged()

  function snapshot() {
    const firstPaint = performance.getEntriesByName('first-contentful-paint', 'paint')[0]?.startTime ?? null
    return {
      ...frames.snapshot(), firstPaintMs: firstPaint,
      visible: !document.hidden,
      domNodes: document.getElementsByTagName('*').length,
      longTasks: longTasks ? { ...longTasks } : null,
      timings: getRendererTimings(),
    }
  }
  function stop() {
    stopped = true
    if (raf) cancelAnimationFrame(raf)
    raf = 0
    observer?.disconnect()
    document.removeEventListener('visibilitychange', visibilityChanged)
  }
  return { snapshot, stop }
}
