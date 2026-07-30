import { describe, expect, it } from 'vitest'
import {
  canMeasureTerminal,
  computeEffectiveTerminalActive,
  planTerminalResize,
  shouldSendSshResize,
} from './terminalResizePolicy'

describe('canMeasureTerminal', () => {
  it('rejects zero or non-finite sizes', () => {
    expect(canMeasureTerminal({ width: 0, height: 100 })).toBe(false)
    expect(canMeasureTerminal({ width: 100, height: 0 })).toBe(false)
    expect(canMeasureTerminal({ width: NaN, height: 10 })).toBe(false)
    expect(canMeasureTerminal({ width: 80, height: 24 })).toBe(true)
  })
})

describe('shouldSendSshResize', () => {
  it('skips when cols/rows unchanged', () => {
    expect(
      shouldSendSshResize({ cols: 80, rows: 24 }, { cols: 80, rows: 24 }),
    ).toBe(false)
  })

  it('sends on first fit or dimension change', () => {
    expect(shouldSendSshResize(null, { cols: 80, rows: 24 })).toBe(true)
    expect(
      shouldSendSshResize({ cols: 80, rows: 24 }, { cols: 100, rows: 24 }),
    ).toBe(true)
    expect(
      shouldSendSshResize({ cols: 80, rows: 24 }, { cols: 80, rows: 30 }),
    ).toBe(true)
  })

  it('force sends even when unchanged', () => {
    expect(
      shouldSendSshResize({ cols: 80, rows: 24 }, { cols: 80, rows: 24 }, { force: true }),
    ).toBe(true)
  })

  it('rejects invalid next dims', () => {
    expect(shouldSendSshResize(null, { cols: 0, rows: 24 })).toBe(false)
    expect(shouldSendSshResize(null, { cols: 80, rows: 0 })).toBe(false)
  })
})

describe('computeEffectiveTerminalActive', () => {
  it('requires both active and workspace visible', () => {
    expect(computeEffectiveTerminalActive({ active: true, workspaceVisible: true })).toBe(true)
    expect(computeEffectiveTerminalActive({ active: true, workspaceVisible: false })).toBe(false)
    expect(computeEffectiveTerminalActive({ active: false, workspaceVisible: true })).toBe(false)
  })
})

describe('planTerminalResize (selection-preserving Docker restore)', () => {
  const current = { cols: 120, rows: 40 }
  const lastSent = { cols: 120, rows: 40 }

  it('unchanged dims: noop — no fit, no clearSelection, no sshResize', () => {
    expect(
      planTerminalResize({
        proposed: { cols: 120, rows: 40 },
        current,
        lastSent,
      }),
    ).toEqual({ kind: 'noop' })
  })

  it('unchanged dims with selection context still plans noop (caller must not clearSelection)', () => {
    // Policy does not know about selection; noop means performResize must skip clearSelection/fit.
    const plan = planTerminalResize({
      proposed: { cols: 120, rows: 40 },
      current,
      lastSent,
    })
    expect(plan.kind).toBe('noop')
    expect(plan).not.toMatchObject({ clearSelection: true })
    expect(plan).not.toMatchObject({ kind: 'fit' })
  })

  it('dims change: fit + clearSelection + sshResize once', () => {
    expect(
      planTerminalResize({
        proposed: { cols: 100, rows: 40 },
        current,
        lastSent,
      }),
    ).toEqual({
      kind: 'fit',
      cols: 100,
      rows: 40,
      sendSsh: true,
      clearSelection: true,
    })
  })

  it('true reconnect force with same dims: ssh-only (no fit/clearSelection)', () => {
    expect(
      planTerminalResize({
        proposed: { cols: 120, rows: 40 },
        current,
        lastSent,
        forceSshResize: true,
      }),
    ).toEqual({ kind: 'ssh-only', cols: 120, rows: 40 })
  })

  it('force with changed dims: fit + sendSsh', () => {
    expect(
      planTerminalResize({
        proposed: { cols: 80, rows: 24 },
        current,
        lastSent,
        forceSshResize: true,
      }),
    ).toEqual({
      kind: 'fit',
      cols: 80,
      rows: 24,
      sendSsh: true,
      clearSelection: true,
    })
  })

  it('skipSshResize with changed dims still fits but does not send', () => {
    expect(
      planTerminalResize({
        proposed: { cols: 100, rows: 30 },
        current,
        lastSent,
        skipSshResize: true,
      }),
    ).toEqual({
      kind: 'fit',
      cols: 100,
      rows: 30,
      sendSsh: false,
      clearSelection: true,
    })
  })

  it('invalid proposed → noop', () => {
    expect(
      planTerminalResize({
        proposed: null,
        current,
        lastSent,
      }),
    ).toEqual({ kind: 'noop' })
    expect(
      planTerminalResize({
        proposed: { cols: 0, rows: 24 },
        current,
        lastSent,
      }),
    ).toEqual({ kind: 'noop' })
  })

  it('first open (no lastSent) with matching current still may ssh-only if lastSent null and dims match', () => {
    // current already equals proposed (e.g. after prior fit); lastSent never recorded
    expect(
      planTerminalResize({
        proposed: { cols: 80, rows: 24 },
        current: { cols: 80, rows: 24 },
        lastSent: null,
      }),
    ).toEqual({ kind: 'ssh-only', cols: 80, rows: 24 })
  })
})
