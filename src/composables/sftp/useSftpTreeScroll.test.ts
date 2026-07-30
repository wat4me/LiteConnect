import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { nextTick, ref } from 'vue'
import { useSftpTreeScroll } from './useSftpTreeScroll'

beforeAll(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    return setTimeout(() => cb(Date.now()), 0) as unknown as number
  })
})
afterAll(() => {
  vi.unstubAllGlobals()
})

/** Minimal DOM-ish stubs (vitest runs in node environment). */
function makeRow(top: number, height = 24) {
  return {
    getBoundingClientRect: () => ({
      top,
      bottom: top + height,
      left: 0,
      right: 100,
      width: 100,
      height,
      x: 0,
      y: top,
      toJSON: () => ({}),
    }),
    scrollIntoView: vi.fn(),
  } as unknown as HTMLElement
}

function makeScroller(top = 0, bottom = 200) {
  return {
    scrollTop: 0,
    getBoundingClientRect: () => ({
      top,
      bottom,
      left: 0,
      right: 100,
      width: 100,
      height: bottom - top,
      x: 0,
      y: top,
      toJSON: () => ({}),
    }),
  } as unknown as HTMLElement
}

describe('useSftpTreeScroll forceRevealPath', () => {
  it('scrolls an off-screen row into view even when path is "already current"', async () => {
    const scroller = makeScroller(0, 200)
    scroller.scrollTop = 400
    const treeScrollRef = ref<HTMLElement | null>(scroller)
    const rowElements = new Map<string, HTMLElement>()
    const row = makeRow(800)
    rowElements.set('/home/u/project', row)
    const setFocusedPath = vi.fn()

    const scroll = useSftpTreeScroll({
      treeScrollRef,
      rowElements,
      cleanPath: (p) => p.replace(/\/+$/, '') || '/',
      setFocusedPath,
      focusExplorer: () => {},
    })

    // Click reflow lock would previously fight locate; ensure reveal clears it.
    scroll.captureTreeScroll(900)
    scroll.forceRevealPath('/home/u/project')
    await nextTick()

    expect(row.scrollIntoView).toHaveBeenCalled()
    expect(setFocusedPath).toHaveBeenCalledWith('/home/u/project')
  })

  it('retries until the row is mounted (tree still expanding)', async () => {
    const treeScrollRef = ref<HTMLElement | null>(makeScroller(0, 200))
    const rowElements = new Map<string, HTMLElement>()
    const setFocusedPath = vi.fn()

    const scroll = useSftpTreeScroll({
      treeScrollRef,
      rowElements,
      cleanPath: (p) => p.replace(/\/+$/, '') || '/',
      setFocusedPath,
      focusExplorer: () => {},
    })

    scroll.forceRevealPath('/home/u/new')
    await nextTick()
    expect(setFocusedPath).not.toHaveBeenCalled()

    const row = makeRow(900)
    rowElements.set('/home/u/new', row)
    scroll.tryRevealPendingPath()
    await nextTick()

    expect(row.scrollIntoView).toHaveBeenCalled()
  })

  it('no-ops for root path (no tree row for /)', () => {
    const treeScrollRef = ref<HTMLElement | null>(makeScroller())
    const rowElements = new Map<string, HTMLElement>()
    const scroll = useSftpTreeScroll({
      treeScrollRef,
      rowElements,
      cleanPath: (p) => p.replace(/\/+$/, '') || '/',
      setFocusedPath: () => {},
      focusExplorer: () => {},
    })
    scroll.forceRevealPath('/')
    expect(scroll.hasPendingReveal()).toBe(false)
  })
})
