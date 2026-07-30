import { describe, expect, it } from 'vitest'
import {
  isRunMenuItemEnabled,
  mapCancel,
  mapChangeDatabase,
  mapExplainResolved,
  mapExport,
  mapRetry,
  mapRunResolved,
  mapTxAction,
  nextOutputPanel,
  outputPanelDomIds,
} from './queryUiController'

describe('queryUiController action mapping', () => {
  it('maps run/explain only with non-empty sql', () => {
    expect(mapRunResolved({ sql: '', reason: 'empty' })).toEqual({
      type: 'none',
      reason: 'empty',
    })
    expect(mapRunResolved({ sql: 'SELECT 1' })).toEqual({ type: 'run', sql: 'SELECT 1' })
    expect(mapExplainResolved({ sql: 'SELECT 1' })).toEqual({
      type: 'explain',
      sql: 'SELECT 1',
    })
  })

  it('maps cancel only while loading with queryId', () => {
    expect(mapCancel({ loading: false, queryId: 'q' }).type).toBe('none')
    expect(mapCancel({ loading: true, queryId: null }).type).toBe('none')
    expect(mapCancel({ loading: true, queryId: 'q1' })).toEqual({ type: 'cancel' })
  })

  it('maps tx actions with session/tx guards', () => {
    expect(mapTxAction('begin', { sessionAlive: false, inTransaction: false }).type).toBe('none')
    expect(mapTxAction('begin', { sessionAlive: true, inTransaction: false })).toEqual({
      type: 'beginTx',
    })
    expect(mapTxAction('commit', { sessionAlive: true, inTransaction: false }).type).toBe('none')
    expect(mapTxAction('commit', { sessionAlive: true, inTransaction: true })).toEqual({
      type: 'commitTx',
    })
    expect(mapTxAction('rollback', { sessionAlive: true, inTransaction: true })).toEqual({
      type: 'rollbackTx',
    })
  })

  it('maps retry / export / changeDatabase', () => {
    expect(mapRetry({ errorRetryable: true, sql: 'SELECT 1' })).toEqual({
      type: 'retry',
      sql: 'SELECT 1',
    })
    expect(mapRetry({ errorRetryable: false, sql: 'SELECT 1' }).type).toBe('none')
    expect(mapExport('csv', { hasResultSet: true })).toEqual({ type: 'exportCsv' })
    expect(mapExport('json', { hasResultSet: false }).type).toBe('none')
    expect(mapExport('copy', { hasResultSet: true })).toEqual({ type: 'copyResult' })
    expect(mapChangeDatabase({ database: 'db', inTransaction: true }).type).toBe('none')
    expect(mapChangeDatabase({ database: 'db', inTransaction: false })).toEqual({
      type: 'changeDatabase',
      database: 'db',
    })
  })

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

  it('maps full event chain for UI-007 wiring smoke', () => {
    // Simulate: run ok → cancel while loading → explain → begin/commit → retry → export
    const run = mapRunResolved({ sql: 'SELECT 1' })
    expect(run).toEqual({ type: 'run', sql: 'SELECT 1' })
    expect(mapCancel({ loading: true, queryId: 'q' })).toEqual({ type: 'cancel' })
    expect(mapExplainResolved({ sql: 'SELECT 1' })).toEqual({ type: 'explain', sql: 'SELECT 1' })
    expect(mapTxAction('begin', { sessionAlive: true, inTransaction: false }).type).toBe('beginTx')
    expect(mapTxAction('commit', { sessionAlive: true, inTransaction: true }).type).toBe('commitTx')
    expect(mapTxAction('rollback', { sessionAlive: true, inTransaction: true }).type).toBe(
      'rollbackTx',
    )
    expect(mapRetry({ errorRetryable: true, sql: 'SELECT 1' }).type).toBe('retry')
    expect(mapExport('csv', { hasResultSet: true }).type).toBe('exportCsv')
    expect(mapExport('json', { hasResultSet: true }).type).toBe('exportJson')
    expect(mapExport('copy', { hasResultSet: true }).type).toBe('copyResult')
  })

  it('builds unique aria ids per tab', () => {
    const a = outputPanelDomIds('tab-1')
    const b = outputPanelDomIds('tab-2')
    expect(a.tabs.result).not.toBe(b.tabs.result)
    expect(a.panels.messages).toContain('tab-1')
  })
})
