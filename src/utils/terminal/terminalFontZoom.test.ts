import { describe, expect, it } from 'vitest'
import {
  isBrowserPageZoomKey,
  isTerminalFontZoomInKey,
  isTerminalFontZoomOutKey,
  stepTerminalFontSize,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
} from './terminalFontZoom'

function key(partial: {
  key: string
  code?: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
}) {
  return {
    key: partial.key,
    code: partial.code ?? '',
    ctrlKey: partial.ctrlKey ?? false,
    metaKey: partial.metaKey ?? false,
    altKey: partial.altKey ?? false,
    shiftKey: partial.shiftKey ?? false,
  }
}

describe('stepTerminalFontSize', () => {
  it('clamps to 10–24', () => {
    expect(stepTerminalFontSize(14, 1)).toBe(15)
    expect(stepTerminalFontSize(TERMINAL_FONT_SIZE_MAX, 1)).toBe(TERMINAL_FONT_SIZE_MAX)
    expect(stepTerminalFontSize(TERMINAL_FONT_SIZE_MIN, -1)).toBe(TERMINAL_FONT_SIZE_MIN)
  })
})

describe('terminal font zoom keys', () => {
  it('treats Ctrl+= and Ctrl++ / numpad+ as zoom in', () => {
    expect(isTerminalFontZoomInKey(key({ key: '=', code: 'Equal', ctrlKey: true }))).toBe(true)
    expect(isTerminalFontZoomInKey(key({ key: '+', code: 'Equal', ctrlKey: true, shiftKey: true }))).toBe(true)
    expect(isTerminalFontZoomInKey(key({ key: '+', code: 'NumpadAdd', ctrlKey: true }))).toBe(true)
    expect(isTerminalFontZoomInKey(key({ key: 'a', ctrlKey: true }))).toBe(false)
    expect(isTerminalFontZoomInKey(key({ key: '=', altKey: true, ctrlKey: true }))).toBe(false)
  })

  it('treats Ctrl+- / Ctrl+_ / numpad- as zoom out', () => {
    expect(isTerminalFontZoomOutKey(key({ key: '-', code: 'Minus', ctrlKey: true }))).toBe(true)
    expect(isTerminalFontZoomOutKey(key({ key: '_', code: 'Minus', ctrlKey: true, shiftKey: true }))).toBe(true)
    expect(isTerminalFontZoomOutKey(key({ key: '-', code: 'NumpadSubtract', ctrlKey: true }))).toBe(true)
  })

  it('includes Chromium page-zoom reset Ctrl+0', () => {
    expect(isBrowserPageZoomKey(key({ key: '0', code: 'Digit0', ctrlKey: true }))).toBe(true)
    expect(isBrowserPageZoomKey(key({ key: '=', code: 'Equal', ctrlKey: true }))).toBe(true)
    expect(isBrowserPageZoomKey(key({ key: 'k', ctrlKey: true }))).toBe(false)
  })
})
