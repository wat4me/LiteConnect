import { describe, expect, it } from 'vitest'
import { CLIPBOARD_MAX_CHARS, CLIPBOARD_TOO_LARGE_ERROR, validateClipboardRead } from './clipboard'

describe('clipboard read size boundary', () => {
  it('preserves text exactly up to the limit', () => {
    const text = 'x'.repeat(CLIPBOARD_MAX_CHARS - 4) + '\nend'
    expect(validateClipboardRead(text)).toBe(text)
  })

  it('rejects oversize clipboard text instead of returning an incomplete script', () => {
    const text = 'x'.repeat(CLIPBOARD_MAX_CHARS) + '\necho required-last-line'
    expect(() => validateClipboardRead(text)).toThrow(CLIPBOARD_TOO_LARGE_ERROR)
  })
})
