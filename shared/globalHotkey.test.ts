import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GLOBAL_HOTKEY,
  keyEventToAccelerator,
  normalizeGlobalHotkey,
} from './globalHotkey'

describe('normalizeGlobalHotkey', () => {
  it('keeps a valid accelerator canonical', () => {
    expect(normalizeGlobalHotkey('Alt+Shift+L')).toBe('Alt+Shift+L')
    expect(normalizeGlobalHotkey(' Ctrl+Alt+Shift+L ')).toBe('Ctrl+Alt+Shift+L')
  })

  it('sorts modifiers into canonical order', () => {
    expect(normalizeGlobalHotkey('Shift+Alt+L')).toBe('Alt+Shift+L')
    expect(normalizeGlobalHotkey('Shift+Ctrl+F5')).toBe('Ctrl+Shift+F5')
  })

  it('accepts aliases, named keys and punctuation', () => {
    expect(normalizeGlobalHotkey('Control+Option+K')).toBe('Ctrl+Alt+K')
    expect(normalizeGlobalHotkey('cmd+space')).toBe('Cmd+Space')
    expect(normalizeGlobalHotkey('Super+F12')).toBe('Super+F12')
    expect(normalizeGlobalHotkey('Ctrl+Alt+=')).toBe('Ctrl+Alt+=')
    expect(normalizeGlobalHotkey('Alt+Enter')).toBe('Alt+Return')
    expect(normalizeGlobalHotkey('Alt+Plus')).toBe('Alt+Plus')
  })

  it('rejects missing modifier, stray keys and unknown tokens', () => {
    expect(normalizeGlobalHotkey('L')).toBeNull()
    expect(normalizeGlobalHotkey('Alt')).toBeNull()
    expect(normalizeGlobalHotkey('Ctrl+Alt')).toBeNull()
    expect(normalizeGlobalHotkey('Ctrl+A+B')).toBeNull()
    expect(normalizeGlobalHotkey('Ctrl+😀')).toBeNull()
    expect(normalizeGlobalHotkey('Alt+F99')).toBeNull()
    expect(normalizeGlobalHotkey('')).toBeNull()
    expect(normalizeGlobalHotkey(undefined)).toBeNull()
    expect(normalizeGlobalHotkey(42)).toBeNull()
  })
})

describe('keyEventToAccelerator', () => {
  const base = {
    key: 'l',
    code: 'KeyL',
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
  }

  it('returns null while only modifiers are held', () => {
    expect(keyEventToAccelerator({ ...base, key: 'Shift', code: 'ShiftLeft', shiftKey: true })).toBeNull()
    expect(keyEventToAccelerator({ ...base, key: 'Control', code: 'ControlLeft', ctrlKey: true })).toBeNull()
  })

  it('builds the accelerator from modifier flags plus the main key', () => {
    expect(keyEventToAccelerator({ ...base, altKey: true, shiftKey: true })).toBe('Alt+Shift+L')
    expect(keyEventToAccelerator({ ...base, key: '5', code: 'Digit5', ctrlKey: true })).toBe('Ctrl+5')
  })

  it('uses the physical key so layout does not matter', () => {
    // ';' printed on a QWERTZ 'Ö' key still registers the physical KeyL… here Digit1 → '1'
    expect(keyEventToAccelerator({ ...base, key: '!', code: 'Digit1', shiftKey: true })).toBe('Shift+1')
    expect(keyEventToAccelerator({ ...base, key: 'Shift', code: 'Semicolon', ctrlKey: true, shiftKey: true })).toBe('Ctrl+Shift+;')
  })

  it('maps named keys and function keys', () => {
    expect(keyEventToAccelerator({ ...base, key: ' ', code: 'Space', ctrlKey: true })).toBe('Ctrl+Space')
    expect(keyEventToAccelerator({ ...base, key: 'F7', code: 'F7', ctrlKey: true })).toBe('Ctrl+F7')
    expect(keyEventToAccelerator({ ...base, key: 'ArrowUp', code: 'ArrowUp', ctrlKey: true })).toBe('Ctrl+Up')
    expect(keyEventToAccelerator({ ...base, key: '-', code: 'Minus', ctrlKey: true })).toBe('Ctrl+-')
  })

  it('names the meta modifier per platform', () => {
    const ev = { ...base, metaKey: true }
    expect(keyEventToAccelerator(ev, 'darwin-arm64')).toBe('Cmd+L')
    expect(keyEventToAccelerator(ev, 'win32-x64')).toBe('Super+L')
  })

  it('falls back to the default when nothing valid was pressed', () => {
    expect(normalizeGlobalHotkey(DEFAULT_GLOBAL_HOTKEY)).toBe(DEFAULT_GLOBAL_HOTKEY)
  })
})
