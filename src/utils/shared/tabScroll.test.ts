import { describe, expect, it } from 'vitest'
import { tabOverflow, tabScrollDelta } from './tabScroll'

describe('tabScrollDelta', () => {
  const strip = { left: 100, right: 500 }

  it('leaves a fully visible tab alone', () => {
    expect(tabScrollDelta(strip, { left: 200, right: 300 })).toBe(0)
  })

  it('scrolls left when the active tab is clipped on the left', () => {
    expect(tabScrollDelta(strip, { left: 40, right: 160 })).toBe(-68)
  })

  it('scrolls right when the active tab is clipped on the right', () => {
    expect(tabScrollDelta(strip, { left: 440, right: 560 })).toBe(68)
  })

  it('aligns the left edge when a tab is wider than the strip', () => {
    expect(tabScrollDelta(strip, { left: 90, right: 900 })).toBe(-18)
  })

  it('respects custom padding', () => {
    expect(tabScrollDelta(strip, { left: 95, right: 200 }, 16)).toBe(-21)
  })
})

describe('tabOverflow', () => {
  it('reports no arrows for a strip that fits', () => {
    expect(tabOverflow({ scrollLeft: 0, scrollWidth: 400, clientWidth: 400 })).toEqual({ left: false, right: false })
  })

  it('reports both directions while scrolled into the middle', () => {
    expect(tabOverflow({ scrollLeft: 100, scrollWidth: 1000, clientWidth: 400 })).toEqual({ left: true, right: true })
  })

  it('reports only the remaining direction at each end', () => {
    expect(tabOverflow({ scrollLeft: 0, scrollWidth: 1000, clientWidth: 400 })).toEqual({ left: false, right: true })
    expect(tabOverflow({ scrollLeft: 600, scrollWidth: 1000, clientWidth: 400 })).toEqual({ left: true, right: false })
  })
})
