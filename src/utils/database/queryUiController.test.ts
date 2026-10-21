import { describe, expect, it } from 'vitest'
import {
  isRunMenuItemEnabled,
  nextOutputPanel,
  outputPanelDomIds,
} from './queryUiController'

describe('queryUiController', () => {
  it('run menu item enablement: selection/statement/all rules', () => {
    const alive = { sessionAlive: true as const }
    // selection only when non-empty selection
    expect(
      isRunMenuItemEnabled('selection', {
        hasSelection: false,
        canRunStatement: true,
        ...alive,
      }),
    ).toBe(false)
    expect(
      isRunMenuItemEnabled('selection', {
        hasSelection: true,
        canRunStatement: false,
        ...alive,
      }),
    ).toBe(true)
    // statement only when safely resolvable
    expect(
      isRunMenuItemEnabled('statement', {
        hasSelection: false,
        canRunStatement: false,
        ...alive,
      }),
    ).toBe(false)
    expect(
      isRunMenuItemEnabled('statement', {
        hasSelection: false,
        canRunStatement: true,
        ...alive,
      }),
    ).toBe(true)
    // all always when session alive, even if selection/statement unavailable
    expect(
      isRunMenuItemEnabled('all', {
        hasSelection: false,
        canRunStatement: false,
        ...alive,
      }),
    ).toBe(true)
    // none when disconnected
    expect(
      isRunMenuItemEnabled('all', {
        hasSelection: true,
        canRunStatement: true,
        sessionAlive: false,
      }),
    ).toBe(false)
    expect(
      isRunMenuItemEnabled('selection', {
        hasSelection: true,
        canRunStatement: true,
        sessionAlive: false,
      }),
    ).toBe(false)
  })

  it('cycles output panels with keyboard dirs', () => {
    expect(nextOutputPanel('result', 1)).toBe('messages')
    expect(nextOutputPanel('history', 1)).toBe('saved')
    expect(nextOutputPanel('saved', 1)).toBe('result')
    expect(nextOutputPanel('result', -1)).toBe('saved')
    expect(nextOutputPanel('messages', -1)).toBe('result')
    expect(nextOutputPanel('plan', 1)).toBe('history')
  })

  it('builds unique aria ids per tab', () => {
    const a = outputPanelDomIds('tab-1')
    const b = outputPanelDomIds('tab-2')
    expect(a.tabs.result).not.toBe(b.tabs.result)
    expect(a.panels.messages).toContain('tab-1')
  })
})
