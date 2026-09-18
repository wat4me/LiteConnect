import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TERMINAL_PASTE_CONFIRM_MAX_CHARS,
  sanitizeTerminalPasteConfirmMaxChars,
  TERMINAL_PASTE_CONFIRM_MAX_CHARS_OPTIONS,
} from './pasteConfirmMaxChars'

describe('sanitizeTerminalPasteConfirmMaxChars', () => {
  it('accepts allowed options only', () => {
    for (const n of TERMINAL_PASTE_CONFIRM_MAX_CHARS_OPTIONS) {
      expect(sanitizeTerminalPasteConfirmMaxChars(n)).toBe(n)
    }
  })

  it('defaults missing/legacy/corrupt to 400', () => {
    expect(sanitizeTerminalPasteConfirmMaxChars(undefined)).toBe(
      DEFAULT_TERMINAL_PASTE_CONFIRM_MAX_CHARS,
    )
    expect(sanitizeTerminalPasteConfirmMaxChars(null)).toBe(
      DEFAULT_TERMINAL_PASTE_CONFIRM_MAX_CHARS,
    )
    expect(sanitizeTerminalPasteConfirmMaxChars('400')).toBe(
      DEFAULT_TERMINAL_PASTE_CONFIRM_MAX_CHARS,
    )
    expect(sanitizeTerminalPasteConfirmMaxChars(50)).toBe(
      DEFAULT_TERMINAL_PASTE_CONFIRM_MAX_CHARS,
    )
    expect(sanitizeTerminalPasteConfirmMaxChars(999)).toBe(
      DEFAULT_TERMINAL_PASTE_CONFIRM_MAX_CHARS,
    )
    expect(sanitizeTerminalPasteConfirmMaxChars(NaN)).toBe(
      DEFAULT_TERMINAL_PASTE_CONFIRM_MAX_CHARS,
    )
    expect(sanitizeTerminalPasteConfirmMaxChars(400.5)).toBe(
      DEFAULT_TERMINAL_PASTE_CONFIRM_MAX_CHARS,
    )
  })
})
