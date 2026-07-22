import { describe, expect, it, vi } from 'vitest'
import { clampScrollTop, restoreListScrollAfterRefresh } from './listScrollPreserve'

describe('clampScrollTop', () => {
  it('clamps to range', () => {
    expect(clampScrollTop(50, 100)).toBe(50)
    expect(clampScrollTop(150, 100)).toBe(100)
    expect(clampScrollTop(-10, 100)).toBe(0)
    expect(clampScrollTop(10, -5)).toBe(0)
  })
})

describe('restoreListScrollAfterRefresh', () => {
  it('restores only after refresh resolves (not before)', async () => {
    const order: string[] = []
    let scrollTop = 120
    let maxScroll = 200

    let resolveRefresh!: () => void
    const refreshPromise = new Promise<void>((r) => {
      resolveRefresh = r
    })

    const done = restoreListScrollAfterRefresh({
      getScrollTop: () => {
        order.push('snapshot')
        return scrollTop
      },
      getMaxScrollTop: () => maxScroll,
      setScrollTop: (top) => {
        order.push(`restore:${top}`)
        scrollTop = top
      },
      refresh: async () => {
        order.push('refresh-start')
        await refreshPromise
        order.push('refresh-end')
        // list grew / shrank
        maxScroll = 80
      },
      nextTick: async () => {
        order.push('nextTick')
      },
    })

    // still waiting — restore must not have run
    expect(order).toEqual(['snapshot', 'refresh-start'])
    expect(scrollTop).toBe(120)

    resolveRefresh()
    const result = await done
    expect(order).toEqual(['snapshot', 'refresh-start', 'refresh-end', 'nextTick', 'restore:80'])
    expect(result.scrollTop).toBe(80)
    expect(scrollTop).toBe(80)
  })

  it('keeps position when max still allows it', async () => {
    const setScrollTop = vi.fn()
    await restoreListScrollAfterRefresh({
      getScrollTop: () => 40,
      getMaxScrollTop: () => 100,
      setScrollTop,
      refresh: async () => {},
      nextTick: async () => {},
    })
    expect(setScrollTop).toHaveBeenCalledWith(40)
  })
})
