import { describe, expect, it } from 'vitest'
import { DEFAULT_TERMINAL_HIGHLIGHT_RULES, type TerminalHighlightRule } from '@shared/terminalHighlight'
import { createTerminalHighlighter, highlightTerminalText } from './terminalHighlighter'

describe('terminalHighlighter', () => {
  it('highlights built-in keywords and IPs in plain log lines', () => {
    const out = highlightTerminalText(
      '2026-11-23 ERROR failed to reach 10.2.178.163:22 (WARN retry)',
      DEFAULT_TERMINAL_HIGHLIGHT_RULES,
    )
    expect(out).toContain('\x1b[1;31mERROR\x1b[39;49;22m')
    expect(out).toContain('\x1b[1;31mfailed\x1b[39;49;22m')
    expect(out).toContain('\x1b[36m10.2.178.163:22\x1b[39;49;22m')
    expect(out).toContain('\x1b[1;33mWARN\x1b[39;49;22m')
  })

  it('does not override text that already carries an ANSI foreground or background color', () => {
    const colored = '\x1b[32mERROR already green\x1b[0m plain ERROR'
    const out = highlightTerminalText(colored, DEFAULT_TERMINAL_HIGHLIGHT_RULES)
    expect(out).toBe('\x1b[32mERROR already green\x1b[0m plain \x1b[1;31mERROR\x1b[39;49;22m')
  })

  it('tracks ANSI color state across multiple stream chunks', () => {
    const hl = createTerminalHighlighter(true, DEFAULT_TERMINAL_HIGHLIGHT_RULES)
    expect(hl.transform('\x1b[34mERROR inside blue')).toBe('\x1b[34mERROR inside blue')
    expect(hl.transform(' still blue ERROR\x1b[0m now ERROR')).toBe(
      ' still blue ERROR\x1b[0m now \x1b[1;31mERROR\x1b[39;49;22m',
    )
  })

  it('leaves output untouched when disabled or skipped (e.g. alternate buffer TUI)', () => {
    const hl = createTerminalHighlighter(true, DEFAULT_TERMINAL_HIGHLIGHT_RULES)
    expect(hl.transform('ERROR in vim', true)).toBe('ERROR in vim')
    hl.setEnabled(false)
    expect(hl.transform('ERROR when disabled')).toBe('ERROR when disabled')
  })

  it('supports plain literal rules, case sensitivity, background mode, and priority', () => {
    const rules: TerminalHighlightRule[] = [
      { id: 'r1', name: 'Exact', pattern: 'foo.bar', isRegex: false, caseSensitive: true, color: 'magenta', background: true, enabled: true },
      { id: 'r2', name: 'Word', pattern: 'bar', isRegex: false, caseSensitive: false, color: 'green', enabled: true },
    ]
    const out = highlightTerminalText('foo.bar FOO.BAR fooXbar', rules)
    // foo.bar matches r1 with background; FOO.BAR only matches r2 on BAR; fooXbar only matches r2 on bar
    expect(out).toBe('\x1b[45;97mfoo.bar\x1b[39;49;22m FOO.\x1b[32mBAR\x1b[39;49;22m fooX\x1b[32mbar\x1b[39;49;22m')
  })

  it('preserves incomplete trailing escape sequences without corrupting them', () => {
    const hl = createTerminalHighlighter(true, DEFAULT_TERMINAL_HIGHLIGHT_RULES)
    expect(hl.transform('ERROR \x1b[3')).toBe('ERROR \x1b[3')
  })

  it('overrides existing ANSI colors only when overrideColor is enabled and restores original color afterward', () => {
    const rules: TerminalHighlightRule[] = [
      { id: 'r1', name: 'Force Error', pattern: 'ERROR', isRegex: false, caseSensitive: true, color: 'red', bold: true, overrideColor: true, enabled: true },
      { id: 'r2', name: 'Soft Warn', pattern: 'WARN', isRegex: false, caseSensitive: true, color: 'yellow', overrideColor: false, enabled: true },
    ]
    const out = highlightTerminalText('\x1b[36mINFO ERROR WARN tail\x1b[0m', rules)
    expect(out).toBe('\x1b[36mINFO \x1b[1;31mERROR\x1b[36;49;22m WARN tail\x1b[0m')
  })
})
