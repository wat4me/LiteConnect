import { describe, expect, it, vi } from 'vitest'
import {
  focusLiveTerminal,
  focusPrimaryTerminalTab,
  resolvePrimaryTerminalFocusSessionId,
  scheduleAfterTerminalVisible,
  type FocusableTerminalTab,
} from './workspaceTerminalFocus'

describe('focusLiveTerminal', () => {
  it('focuses only when active and terminal exists', () => {
    const focus = vi.fn()
    expect(
      focusLiveTerminal({
        active: true,
        getTerminal: () => ({ focus }),
      }),
    ).toBe(true)
    expect(focus).toHaveBeenCalledTimes(1)
  })

  it('does not focus inactive or missing terminal', () => {
    const focus = vi.fn()
    expect(
      focusLiveTerminal({
        active: false,
        getTerminal: () => ({ focus }),
      }),
    ).toBe(false)
    expect(focus).not.toHaveBeenCalled()
    expect(
      focusLiveTerminal({
        active: true,
        getTerminal: () => null,
      }),
    ).toBe(false)
  })

  it('returns false when focus throws', () => {
    expect(
      focusLiveTerminal({
        active: true,
        getTerminal: () => ({
          focus: () => {
            throw new Error('gone')
          },
        }),
      }),
    ).toBe(false)
  })
})

describe('resolvePrimaryTerminalFocusSessionId', () => {
  it('returns active session when live list omitted or includes it', () => {
    expect(resolvePrimaryTerminalFocusSessionId('s1')).toBe('s1')
    expect(resolvePrimaryTerminalFocusSessionId('s1', ['s1', 's2'])).toBe('s1')
  })

  it('returns null without active session or when not live', () => {
    expect(resolvePrimaryTerminalFocusSessionId(null)).toBe(null)
    expect(resolvePrimaryTerminalFocusSessionId(undefined)).toBe(null)
    expect(resolvePrimaryTerminalFocusSessionId('gone', ['s1'])).toBe(null)
  })
})

describe('focusPrimaryTerminalTab', () => {
  it('focuses only the primary active session tab', () => {
    const focused: string[] = []
    const tabs = new Map<string, FocusableTerminalTab>([
      {
        sessionId: 'primary',
        tab: {
          focusTerminal: () => {
            focused.push('primary')
            return true
          },
        },
      },
      {
        sessionId: 'secondary',
        tab: {
          focusTerminal: () => {
            focused.push('secondary')
            return true
          },
        },
      },
      {
        sessionId: 'background',
        tab: {
          focusTerminal: () => {
            focused.push('background')
            return true
          },
        },
      },
    ].map(({ sessionId, tab }) => [sessionId, tab] as const))

    const ok = focusPrimaryTerminalTab(tabs, 'primary', ['primary', 'secondary', 'background'])
    expect(ok).toBe(true)
    expect(focused).toEqual(['primary'])
  })

  it('does not focus secondary or background when primary is active', () => {
    const focused: string[] = []
    const tabs = new Map<string, FocusableTerminalTab>([
      ['s-active', { focusTerminal: () => { focused.push('s-active'); return true } }],
      ['s-other', { focusTerminal: () => { focused.push('s-other'); return true } }],
    ])
    focusPrimaryTerminalTab(tabs, 's-active', ['s-active', 's-other'])
    expect(focused).toEqual(['s-active'])
    expect(focused).not.toContain('s-other')
  })

  it('returns false when primary tab is missing or not live', () => {
    const tabs = new Map<string, FocusableTerminalTab>([
      ['only', { focusTerminal: () => true }],
    ])
    expect(focusPrimaryTerminalTab(tabs, 'missing', ['only'])).toBe(false)
    expect(focusPrimaryTerminalTab(tabs, 'only', ['other'])).toBe(false)
    expect(focusPrimaryTerminalTab(tabs, null)).toBe(false)
  })

  it('propagates false when focusTerminal fails', () => {
    const tabs = new Map<string, FocusableTerminalTab>([
      ['s1', { focusTerminal: () => false }],
    ])
    expect(focusPrimaryTerminalTab(tabs, 's1')).toBe(false)
  })
})

describe('scheduleAfterTerminalVisible', () => {
  it('defers focus via requestAnimationFrame when available', () => {
    const focus = vi.fn()
    const raf = vi.fn((cb: FrameRequestCallback) => {
      cb(0)
      return 1
    })
    const prev = globalThis.requestAnimationFrame
    globalThis.requestAnimationFrame = raf as typeof requestAnimationFrame
    try {
      scheduleAfterTerminalVisible(focus)
      expect(raf).toHaveBeenCalledTimes(1)
      expect(focus).toHaveBeenCalledTimes(1)
    } finally {
      globalThis.requestAnimationFrame = prev
    }
  })

  it('cancel prevents late focus after rapid Docker toggle', () => {
    const focus = vi.fn()
    let stored: FrameRequestCallback | null = null
    const prev = globalThis.requestAnimationFrame
    const prevCancel = globalThis.cancelAnimationFrame
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      stored = cb
      return 7
    }) as typeof requestAnimationFrame
    globalThis.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame
    try {
      const cancel = scheduleAfterTerminalVisible(focus)
      cancel()
      stored?.(0)
      expect(focus).not.toHaveBeenCalled()
    } finally {
      globalThis.requestAnimationFrame = prev
      globalThis.cancelAnimationFrame = prevCancel
    }
  })
})
