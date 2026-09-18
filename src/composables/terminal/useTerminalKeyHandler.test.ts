import { describe, expect, it, vi } from 'vitest'
import { useTerminalKeyHandler } from './useTerminalKeyHandler'

function makeHandler() {
  const setFontSize = vi.fn()
  const toggleSearch = vi.fn()
  let fontSize = 14
  const { handleKey } = useTerminalKeyHandler({
    getTerminal: () => null,
    getFontSize: () => fontSize,
    setFontSize: (size) => {
      fontSize = size
      setFontSize(size)
    },
    toggleSearch,
  })
  return { handleKey, setFontSize, toggleSearch, getFontSize: () => fontSize }
}

function keydown(init: {
  key: string
  code?: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
}): KeyboardEvent {
  return {
    type: 'keydown',
    key: init.key,
    code: init.code ?? '',
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
    altKey: init.altKey ?? false,
    shiftKey: init.shiftKey ?? false,
    preventDefault() {},
  } as KeyboardEvent
}

describe('useTerminalKeyHandler font zoom', () => {
  it('Ctrl+= and Ctrl++ both enlarge font', () => {
    const h = makeHandler()
    expect(h.handleKey(keydown({ key: '=', code: 'Equal', ctrlKey: true }))).toBe(false)
    expect(h.setFontSize).toHaveBeenCalledWith(15)
    expect(h.handleKey(keydown({ key: '+', code: 'Equal', ctrlKey: true, shiftKey: true }))).toBe(false)
    expect(h.setFontSize).toHaveBeenLastCalledWith(16)
  })

  it('Ctrl+- shrinks font and stops at 10', () => {
    const h = makeHandler()
    h.handleKey(keydown({ key: '-', code: 'Minus', ctrlKey: true }))
    expect(h.setFontSize).toHaveBeenCalledWith(13)
    const tiny = makeHandler()
    tiny.handleKey(keydown({ key: '-', code: 'Minus', ctrlKey: true }))
    // drive down to min
    for (let i = 0; i < 20; i++) {
      tiny.handleKey(keydown({ key: '-', code: 'Minus', ctrlKey: true }))
    }
    expect(tiny.getFontSize()).toBe(10)
  })

  it('does not grow past 24', () => {
    const setFontSize = vi.fn()
    const { handleKey } = useTerminalKeyHandler({
      getTerminal: () => null,
      getFontSize: () => 24,
      setFontSize,
      toggleSearch: vi.fn(),
    })
    handleKey(keydown({ key: '=', code: 'Equal', ctrlKey: true }))
    expect(setFontSize).not.toHaveBeenCalled()
  })
})
