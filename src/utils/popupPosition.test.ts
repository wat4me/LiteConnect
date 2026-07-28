import { describe, expect, it } from 'vitest'
import { clampPopupToViewport, placePopupNearAnchor } from './popupPosition'

describe('clampPopupToViewport', () => {
  const vp = { width: 1000, height: 800 }

  it('keeps position when fully inside', () => {
    expect(
      clampPopupToViewport({ x: 100, y: 100 }, { width: 160, height: 200 }, { viewport: vp }),
    ).toEqual({ left: 100, top: 100 })
  })

  it('clamps right and bottom edges', () => {
    expect(
      clampPopupToViewport({ x: 950, y: 750 }, { width: 160, height: 200 }, { viewport: vp, flip: false }),
    ).toEqual({ left: 1000 - 8 - 160, top: 800 - 8 - 200 })
  })

  it('flips above when overflowing bottom and room above exists', () => {
    const preferred = { x: 100, y: 780 }
    const size = { width: 160, height: 200 }
    const pos = clampPopupToViewport(preferred, size, { viewport: vp, flip: true })
    expect(pos.top).toBe(780 - 200)
    expect(pos.left).toBe(100)
  })

  it('pins to left padding when wider than viewport', () => {
    expect(
      clampPopupToViewport({ x: 50, y: 50 }, { width: 2000, height: 40 }, { viewport: vp }),
    ).toEqual({ left: 8, top: 50 })
  })

  it('never goes negative', () => {
    const pos = clampPopupToViewport({ x: -20, y: -10 }, { width: 100, height: 50 }, { viewport: vp })
    expect(pos.left).toBe(8)
    expect(pos.top).toBe(8)
  })
})

describe('placePopupNearAnchor', () => {
  const vp = { width: 1000, height: 600 }
  const anchor = { left: 800, top: 500, right: 880, bottom: 528, width: 80, height: 28 }

  it('opens above when not enough space below', () => {
    const pos = placePopupNearAnchor(anchor, { width: 160, height: 200 }, { viewport: vp, align: 'end' })
    expect(pos.openAbove).toBe(true)
    expect(pos.top + 200).toBeLessThanOrEqual(anchor.top)
    expect(pos.left + 160).toBeLessThanOrEqual(1000 - 8)
  })

  it('opens below when space is available', () => {
    const topAnchor = { left: 20, top: 40, right: 100, bottom: 68, width: 80, height: 28 }
    const pos = placePopupNearAnchor(topAnchor, { width: 160, height: 120 }, { viewport: vp })
    expect(pos.openAbove).toBe(false)
    expect(pos.top).toBeGreaterThanOrEqual(topAnchor.bottom)
  })
})
