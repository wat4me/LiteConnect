import { describe, expect, it } from 'vitest'
import {
  clampQueryMaxRows,
  clampQueryTimeoutMs,
  clampQueryTimeoutSec,
  editorStatusFromSelection,
  resolveBottomPaneVisibility,
  resolvePreferredRunScope,
  resolveQueryTabExecOptionsFromDefaults,
  sanitizeDefaultRunScopePref,
  sanitizeQueryTabExecOptions,
  QUERY_MAX_ROWS_DEFAULT,
  QUERY_TIMEOUT_MS_DEFAULT,
  QUERY_TIMEOUT_SEC_DEFAULT,
} from './queryTabOptions'

describe('queryTabOptions sanitizers', () => {
  it('clamps maxRows and timeout', () => {
    expect(clampQueryMaxRows(0)).toBe(1)
    expect(clampQueryMaxRows(1e9)).toBe(100_000)
    expect(clampQueryMaxRows('nope')).toBe(QUERY_MAX_ROWS_DEFAULT)
    expect(clampQueryTimeoutMs(100)).toBe(1_000)
    expect(clampQueryTimeoutMs(999_999_999)).toBe(600_000)
    expect(clampQueryTimeoutMs(undefined)).toBe(QUERY_TIMEOUT_MS_DEFAULT)
  })

  it('sanitizes default run scope pref', () => {
    expect(sanitizeDefaultRunScopePref('all')).toBe('all')
    expect(sanitizeDefaultRunScopePref('nope')).toBe('smart')
  })

  it('sanitizeQueryTabExecOptions fills defaults', () => {
    expect(sanitizeQueryTabExecOptions(null)).toEqual({
      maxRows: QUERY_MAX_ROWS_DEFAULT,
      timeoutMs: QUERY_TIMEOUT_MS_DEFAULT,
      defaultRunScope: 'smart',
    })
    expect(sanitizeQueryTabExecOptions({ maxRows: 50, timeoutMs: 5000, defaultRunScope: 'all' })).toEqual({
      maxRows: 50,
      timeoutMs: 5000,
      defaultRunScope: 'all',
    })
  })

  it('clamps timeout seconds for settings UI', () => {
    expect(clampQueryTimeoutSec(0)).toBe(1)
    expect(clampQueryTimeoutSec(900)).toBe(600)
    expect(clampQueryTimeoutSec(undefined)).toBe(QUERY_TIMEOUT_SEC_DEFAULT)
  })
})

describe('resolveQueryTabExecOptionsFromDefaults', () => {
  const globals = {
    maxRows: 500,
    timeoutMs: 30_000,
    defaultRunScope: 'all' as const,
  }

  it('new tab inherits global defaults only', () => {
    expect(resolveQueryTabExecOptionsFromDefaults(globals, null)).toEqual(globals)
    expect(resolveQueryTabExecOptionsFromDefaults(globals, {})).toEqual(globals)
  })

  it('legacy draft missing fields fills from globals per-field', () => {
    expect(
      resolveQueryTabExecOptionsFromDefaults(globals, { maxRows: 50 }),
    ).toEqual({
      maxRows: 50,
      timeoutMs: 30_000,
      defaultRunScope: 'all',
    })
    expect(
      resolveQueryTabExecOptionsFromDefaults(globals, {
        timeoutMs: 5000,
        defaultRunScope: 'selection',
      }),
    ).toEqual({
      maxRows: 500,
      timeoutMs: 5000,
      defaultRunScope: 'selection',
    })
  })

  it('explicit per-tab values are preserved and not overwritten by globals', () => {
    expect(
      resolveQueryTabExecOptionsFromDefaults(globals, {
        maxRows: 2000,
        timeoutMs: 60_000,
        defaultRunScope: 'statement',
      }),
    ).toEqual({
      maxRows: 2000,
      timeoutMs: 60_000,
      defaultRunScope: 'statement',
    })
  })

  it('falls back to product constants when globals absent', () => {
    expect(resolveQueryTabExecOptionsFromDefaults(null, null)).toEqual({
      maxRows: QUERY_MAX_ROWS_DEFAULT,
      timeoutMs: QUERY_TIMEOUT_MS_DEFAULT,
      defaultRunScope: 'smart',
    })
  })
})

describe('resolvePreferredRunScope', () => {
  const smart = (hasSel: boolean, canStmt: boolean) => {
    if (hasSel) return 'selection' as const
    if (canStmt) return 'statement' as const
    return 'all' as const
  }

  it('honors all preference', () => {
    expect(
      resolvePreferredRunScope({
        pref: 'all',
        hasSelection: true,
        canRunStatement: true,
        smart,
      }),
    ).toBe('all')
  })

  it('falls back when preferred selection unavailable', () => {
    expect(
      resolvePreferredRunScope({
        pref: 'selection',
        hasSelection: false,
        canRunStatement: true,
        smart,
      }),
    ).toBe('statement')
  })

  it('uses selection when preferred and available', () => {
    expect(
      resolvePreferredRunScope({
        pref: 'selection',
        hasSelection: true,
        canRunStatement: false,
        smart,
      }),
    ).toBe('selection')
  })
})

describe('editorStatusFromSelection', () => {
  it('computes 1-based line/column and selection length', () => {
    const doc = 'ab\ncde'
    // head at end of "cde" (index 6)
    expect(editorStatusFromSelection({ doc, head: 6, selectionStart: 3, selectionEnd: 6 })).toEqual({
      line: 2,
      column: 4,
      selectionChars: 3,
    })
    expect(editorStatusFromSelection({ doc, head: 0, selectionStart: 0, selectionEnd: 0 })).toEqual({
      line: 1,
      column: 1,
      selectionChars: 0,
    })
  })
})

describe('resolveBottomPaneVisibility', () => {
  it('open-log expands and forces history', () => {
    expect(resolveBottomPaneVisibility({ collapsed: true, event: 'open-log' })).toEqual({
      collapsed: false,
      forceHistory: true,
    })
  })

  it('query success expands collapsed pane', () => {
    expect(resolveBottomPaneVisibility({ collapsed: true, event: 'query-success' })).toEqual({
      collapsed: false,
    })
  })

  it('toggle flips collapse', () => {
    expect(resolveBottomPaneVisibility({ collapsed: false, event: 'toggle-collapse' })).toEqual({
      collapsed: true,
    })
  })
})
