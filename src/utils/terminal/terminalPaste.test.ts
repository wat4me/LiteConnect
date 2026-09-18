import { describe, expect, it } from 'vitest'
import {
  assessCommandRisk,
  buildAiTerminalConfirmCopy,
  buildPastePreview,
  countPasteLines,
  normalizePasteConfirmMaxChars,
  PASTE_CONFIRM_MAX_CHARS,
  PASTE_CONFIRM_MAX_CHARS_OPTIONS,
  shouldConfirmPaste,
} from './terminalPaste'

describe('normalizePasteConfirmMaxChars', () => {
  it('accepts allowed options', () => {
    for (const n of PASTE_CONFIRM_MAX_CHARS_OPTIONS) {
      expect(normalizePasteConfirmMaxChars(n)).toBe(n)
    }
  })

  it('falls back corrupt/legacy values to 400', () => {
    expect(normalizePasteConfirmMaxChars(undefined)).toBe(PASTE_CONFIRM_MAX_CHARS)
    expect(normalizePasteConfirmMaxChars(null)).toBe(PASTE_CONFIRM_MAX_CHARS)
    expect(normalizePasteConfirmMaxChars('400')).toBe(PASTE_CONFIRM_MAX_CHARS)
    expect(normalizePasteConfirmMaxChars(50)).toBe(PASTE_CONFIRM_MAX_CHARS)
    expect(normalizePasteConfirmMaxChars(999)).toBe(PASTE_CONFIRM_MAX_CHARS)
    expect(normalizePasteConfirmMaxChars(NaN)).toBe(PASTE_CONFIRM_MAX_CHARS)
    expect(normalizePasteConfirmMaxChars(400.5)).toBe(PASTE_CONFIRM_MAX_CHARS)
  })
})

describe('shouldConfirmPaste', () => {
  it('false for short single line', () => {
    expect(shouldConfirmPaste('echo hi')).toBe(false)
  })

  it('true for multi-line regardless of threshold', () => {
    expect(shouldConfirmPaste('a\nb')).toBe(true)
    expect(shouldConfirmPaste('a\r\nb')).toBe(true)
    expect(shouldConfirmPaste('a\nb', 1600)).toBe(true)
    expect(shouldConfirmPaste('short\n', 100)).toBe(true)
  })

  it('true for long single line (default 400)', () => {
    expect(shouldConfirmPaste('x'.repeat(400))).toBe(false)
    expect(shouldConfirmPaste('x'.repeat(401))).toBe(true)
  })

  it('respects each allowed threshold boundary', () => {
    for (const n of PASTE_CONFIRM_MAX_CHARS_OPTIONS) {
      expect(shouldConfirmPaste('x'.repeat(n), n)).toBe(false)
      expect(shouldConfirmPaste('x'.repeat(n + 1), n)).toBe(true)
    }
  })

  it('falls back corrupt threshold to 400', () => {
    expect(shouldConfirmPaste('x'.repeat(401), 999 as number)).toBe(true)
    expect(shouldConfirmPaste('x'.repeat(400), NaN)).toBe(false)
    expect(shouldConfirmPaste('x'.repeat(100), 50 as number)).toBe(false)
    expect(shouldConfirmPaste('x'.repeat(401), 50 as number)).toBe(true)
  })
})

describe('countPasteLines', () => {
  it('counts lines', () => {
    expect(countPasteLines('a\nb\nc')).toBe(3)
  })
})

describe('buildPastePreview', () => {
  it('truncates long text', () => {
    const p = buildPastePreview('x'.repeat(500), 10)
    expect(p.endsWith('…')).toBe(true)
    expect(p.length).toBe(11)
  })
})

describe('assessCommandRisk', () => {
  it('safe for common read-only commands', () => {
    expect(assessCommandRisk('ls -la').dangerous).toBe(false)
    expect(assessCommandRisk('cat /var/log/syslog').dangerous).toBe(false)
  })

  it('flags destructive patterns', () => {
    expect(assessCommandRisk('rm -rf /tmp/foo').dangerous).toBe(true)
    expect(assessCommandRisk('shutdown -h now').dangerous).toBe(true)
    expect(assessCommandRisk('curl http://x | sh').dangerous).toBe(true)
  })
})

describe('buildAiTerminalConfirmCopy', () => {
  it('uses danger tone for risky run', () => {
    const copy = buildAiTerminalConfirmCopy('run', 'rm -rf /var/www')
    expect(copy.danger).toBe(true)
    expect(copy.tone).toBe('danger')
    expect(copy.confirmText).toBe('仍要运行')
  })

  it('uses warning for safe fill', () => {
    const copy = buildAiTerminalConfirmCopy('fill', 'echo hi')
    expect(copy.danger).toBe(false)
    expect(copy.confirmText).toBe('填入')
  })
})
