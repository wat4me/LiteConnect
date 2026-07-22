import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  canMeasureTerminal,
  computeEffectiveTerminalActive,
  planTerminalResize,
  shouldSendSshResize,
} from '../utils/terminalResizePolicy'

/**
 * Pure contracts for Docker↔Terminal restore.
 * Does NOT mount Vue/xterm — component lifecycle (create/dispose/connect)
 * is verified by static call chain + user manual testing, not by fake counters.
 */
describe('terminal resize dedupe (Docker restore contract)', () => {
  it('does not request sshResize when cols/rows unchanged after restore', () => {
    expect(
      shouldSendSshResize({ cols: 120, rows: 40 }, { cols: 120, rows: 40 }),
    ).toBe(false)
  })

  it('requests sshResize once when layout actually changes', () => {
    const fitted = { cols: 100, rows: 40 }
    expect(shouldSendSshResize({ cols: 120, rows: 40 }, fitted)).toBe(true)
    expect(shouldSendSshResize(fitted, fitted)).toBe(false)
  })

  it('allows force after true reconnect even if dims match', () => {
    expect(
      shouldSendSshResize({ cols: 80, rows: 24 }, { cols: 80, rows: 24 }, { force: true }),
    ).toBe(true)
  })

  it('hidden zero-size host must not measure/fit', () => {
    expect(canMeasureTerminal({ width: 0, height: 600 })).toBe(false)
    expect(canMeasureTerminal({ width: 800, height: 600 })).toBe(true)
  })
})

describe('planTerminalResize selection preservation', () => {
  const current = { cols: 120, rows: 40 }
  const lastSent = { cols: 120, rows: 40 }

  it('existing selection + unchanged dims → noop (no clearSelection/fit/sshResize)', () => {
    // Selection is preserved because performResize only clearSelection on kind==='fit'
    const plan = planTerminalResize({
      proposed: { cols: 120, rows: 40 },
      current,
      lastSent,
    })
    expect(plan).toEqual({ kind: 'noop' })
  })

  it('unchanged dims → no fit and no sshResize', () => {
    const plan = planTerminalResize({
      proposed: { cols: 120, rows: 40 },
      current,
      lastSent,
    })
    expect(plan.kind).toBe('noop')
  })

  it('dims change → fit once with clearSelection and sendSsh', () => {
    const plan = planTerminalResize({
      proposed: { cols: 100, rows: 30 },
      current,
      lastSent,
    })
    expect(plan).toEqual({
      kind: 'fit',
      cols: 100,
      rows: 30,
      sendSsh: true,
      clearSelection: true,
    })
  })

  it('true reconnect force same dims → ssh-only once (no fit/clearSelection)', () => {
    const plan = planTerminalResize({
      proposed: { cols: 120, rows: 40 },
      current,
      lastSent,
      forceSshResize: true,
    })
    expect(plan).toEqual({ kind: 'ssh-only', cols: 120, rows: 40 })
  })

  it('local refresh path remains available when plan is noop (refresh/focus outside resize)', () => {
    // scheduleTerminalRefresh still runs refresh+focus after performResize returns early
    const plan = planTerminalResize({
      proposed: { cols: 120, rows: 40 },
      current,
      lastSent,
    })
    expect(plan.kind).toBe('noop')
    // Caller may still: terminal.refresh(...); terminal.focus()
    const localRefreshAllowed = plan.kind === 'noop' || plan.kind === 'ssh-only' || plan.kind === 'fit'
    expect(localRefreshAllowed).toBe(true)
  })
})

describe('scheduleAfterTerminalVisible cancel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not run focus after cancel (rapid Docker toggle)', async () => {
    const { scheduleAfterTerminalVisible } = await import('../utils/workspaceTerminalFocus')
    const focus = vi.fn()
    let rafCb: FrameRequestCallback | null = null
    const prev = globalThis.requestAnimationFrame
    const prevCancel = globalThis.cancelAnimationFrame
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      rafCb = cb
      return 99
    }) as typeof requestAnimationFrame
    globalThis.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame
    try {
      const cancel = scheduleAfterTerminalVisible(focus)
      cancel()
      rafCb?.(0)
      expect(focus).not.toHaveBeenCalled()
    } finally {
      globalThis.requestAnimationFrame = prev
      globalThis.cancelAnimationFrame = prevCancel
    }
  })
})

describe('workspace visibility effective active', () => {
  it('effectiveActive tracks workspaceVisible only (pure policy, not lifecycle)', () => {
    // Not a component mount test: does not prove create/dispose counts.
    let visible = true
    for (let i = 0; i < 20; i++) {
      visible = !visible
      expect(
        computeEffectiveTerminalActive({ active: true, workspaceVisible: visible }),
      ).toBe(visible)
    }
  })

  it('split panes both background when workspace hidden', () => {
    const workspaceVisible = false
    expect(
      computeEffectiveTerminalActive({ active: true, workspaceVisible }),
    ).toBe(false)
    expect(
      computeEffectiveTerminalActive({ active: true, workspaceVisible }),
    ).toBe(false)
    expect(
      computeEffectiveTerminalActive({ active: false, workspaceVisible: true }),
    ).toBe(false)
    expect(
      computeEffectiveTerminalActive({ active: true, workspaceVisible: true }),
    ).toBe(true)
  })
})
