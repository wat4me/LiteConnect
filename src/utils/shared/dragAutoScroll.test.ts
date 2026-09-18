import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createDragAutoScroll } from '@/utils/shared/dragAutoScroll'

describe('createDragAutoScroll', () => {
  let rafCbs: FrameRequestCallback[]
  let listeners: Map<string, EventListener>

  beforeEach(() => {
    rafCbs = []
    listeners = new Map()

    vi.stubGlobal(
      'requestAnimationFrame',
      (cb: FrameRequestCallback) => {
        rafCbs.push(cb)
        return rafCbs.length
      },
    )
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    vi.stubGlobal('document', {
      addEventListener: (type: string, cb: EventListener) => {
        listeners.set(type, cb)
      },
      removeEventListener: (type: string) => {
        listeners.delete(type)
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function makeScrollEl(opts: {
    top: number
    height: number
    left?: number
    width?: number
    scrollHeight?: number
    clientHeight?: number
    scrollTop?: number
  }) {
    let scrollTop = opts.scrollTop ?? 100
    const left = opts.left ?? 0
    const width = opts.width ?? 200
    return {
      get scrollTop() {
        return scrollTop
      },
      set scrollTop(v: number) {
        scrollTop = v
      },
      scrollHeight: opts.scrollHeight ?? 1000,
      clientHeight: opts.clientHeight ?? opts.height,
      getBoundingClientRect: () => ({
        top: opts.top,
        bottom: opts.top + opts.height,
        left,
        right: left + width,
        width,
        height: opts.height,
        x: left,
        y: opts.top,
        toJSON: () => ({}),
      }),
    } as unknown as HTMLElement
  }

  function flushFrames(n: number) {
    for (let i = 0; i < n; i++) {
      const cbs = rafCbs.splice(0, rafCbs.length)
      for (const cb of cbs) cb(i)
    }
  }

  function fireDragOver(clientX: number, clientY: number) {
    const cb = listeners.get('dragover')
    expect(cb).toBeTypeOf('function')
    cb?.(
      {
        clientX,
        clientY,
      } as DragEvent,
    )
  }

  it('scrolls up when pointer is near the top edge', () => {
    const el = makeScrollEl({ top: 100, height: 300, scrollTop: 200 })
    const auto = createDragAutoScroll({ edgePx: 50, maxSpeed: 10 })
    auto.start(el)

    fireDragOver(50, 110)
    flushFrames(5)

    expect(el.scrollTop).toBeLessThan(200)
    auto.stop()
  })

  it('scrolls down when pointer is near the bottom edge', () => {
    const el = makeScrollEl({ top: 100, height: 300, scrollTop: 50 })
    const auto = createDragAutoScroll({ edgePx: 50, maxSpeed: 10 })
    auto.start(el)

    fireDragOver(50, 380)
    flushFrames(5)

    expect(el.scrollTop).toBeGreaterThan(50)
    auto.stop()
  })

  it('does not scroll when pointer is outside the scroller horizontally', () => {
    const el = makeScrollEl({ top: 100, height: 300, left: 0, width: 200, scrollTop: 100 })
    const auto = createDragAutoScroll({ edgePx: 50, maxSpeed: 10, outerPadPx: 10 })
    auto.start(el)

    fireDragOver(500, 110)
    flushFrames(5)

    expect(el.scrollTop).toBe(100)
    auto.stop()
  })

  it('scrolls up when pointer is above the scroller (page top)', () => {
    const el = makeScrollEl({ top: 200, height: 300, scrollTop: 250 })
    const auto = createDragAutoScroll({ edgePx: 50, maxSpeed: 10 })
    auto.start(el)

    // Pointer over toolbar / page chrome above the list
    fireDragOver(50, 20)
    flushFrames(5)

    expect(el.scrollTop).toBeLessThan(250)
    auto.stop()
  })

  it('stops automatically on document dragend', () => {
    const el = makeScrollEl({ top: 100, height: 300, scrollTop: 200 })
    const auto = createDragAutoScroll({ edgePx: 50, maxSpeed: 10 })
    auto.start(el)
    fireDragOver(50, 110)
    flushFrames(1)
    const afterOne = el.scrollTop
    const dragend = listeners.get('dragend')
    expect(dragend).toBeTypeOf('function')
    dragend?.(new Event('dragend') as DragEvent)
    flushFrames(5)
    expect(el.scrollTop).toBe(afterOne)
    expect(listeners.has('dragover')).toBe(false)
  })

  it('stop() cancels further scrolling', () => {
    const el = makeScrollEl({ top: 100, height: 300, scrollTop: 200 })
    const auto = createDragAutoScroll({ edgePx: 50, maxSpeed: 10 })
    auto.start(el)
    fireDragOver(50, 110)
    flushFrames(1)
    const afterOne = el.scrollTop
    auto.stop()
    // leftover frames should not keep mutating after stop
    flushFrames(5)
    expect(el.scrollTop).toBe(afterOne)
  })
})
