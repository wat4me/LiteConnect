import { describe, expect, it } from 'vitest'
import {
  displayRowsForOutput,
  outputPanelBadges,
  resolveOutputPanel,
} from './queryOutputPanel'

function identitySort(
  rows: Array<Record<string, unknown>>,
  _col: string,
  _dir: 'asc' | 'desc',
) {
  return rows
}

function filterByName(
  rows: Array<Record<string, unknown>>,
  _columns: string[],
  filter: string,
) {
  const q = filter.trim().toLowerCase()
  if (!q) return rows
  return rows.filter((r) => String(r.name ?? '').toLowerCase().includes(q))
}

describe('resolveOutputPanel', () => {
  it('switches to messages on query error', () => {
    expect(
      resolveOutputPanel({
        outputKind: 'result',
        hasError: true,
        hasResultSet: true,
        hasExecMessage: false,
        current: 'result',
        event: 'query-error',
      }),
    ).toBe('messages')
  })

  it('switches to plan on explain success', () => {
    expect(
      resolveOutputPanel({
        outputKind: 'plan',
        hasError: false,
        hasResultSet: true,
        hasExecMessage: false,
        event: 'explain-success',
      }),
    ).toBe('plan')
  })

  it('switches to result on query success with result set', () => {
    expect(
      resolveOutputPanel({
        outputKind: 'result',
        hasError: false,
        hasResultSet: true,
        hasExecMessage: false,
        event: 'query-success',
      }),
    ).toBe('result')
  })

  it('switches to messages on DML success without result set', () => {
    expect(
      resolveOutputPanel({
        outputKind: 'result',
        hasError: false,
        hasResultSet: false,
        hasExecMessage: true,
        event: 'query-success',
      }),
    ).toBe('messages')
  })

  it('keeps history when idle and user is on history', () => {
    expect(
      resolveOutputPanel({
        outputKind: 'result',
        hasError: false,
        hasResultSet: true,
        hasExecMessage: false,
        current: 'history',
        event: 'idle',
      }),
    ).toBe('history')
  })

  it('prefers messages when idle with error', () => {
    expect(
      resolveOutputPanel({
        outputKind: 'result',
        hasError: true,
        hasResultSet: true,
        hasExecMessage: false,
        current: 'result',
        event: 'idle',
      }),
    ).toBe('messages')
  })
})

describe('outputPanelBadges', () => {
  it('marks truncated on result for normal query', () => {
    const badges = outputPanelBadges({
      hasError: false,
      truncated: true,
      outputKind: 'result',
    })
    expect(badges.find((b) => b.panel === 'result')?.showTruncated).toBe(true)
    expect(badges.find((b) => b.panel === 'plan')?.showTruncated).toBe(false)
  })

  it('marks error dot on messages', () => {
    const badges = outputPanelBadges({
      hasError: true,
      truncated: false,
      outputKind: 'result',
    })
    expect(badges.find((b) => b.panel === 'messages')?.showErrorDot).toBe(true)
  })
})

describe('displayRowsForOutput', () => {
  const rows = [
    { name: 'Seq Scan', id: 1 },
    { name: 'Index Scan', id: 2 },
  ]

  it('applies local filter for normal result output', () => {
    const out = displayRowsForOutput({
      outputKind: 'result',
      hasResultSet: true,
      rows,
      columns: ['name', 'id'],
      filter: 'index',
      sort: null,
      sortRows: identitySort,
      filterRows: filterByName,
    })
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('Index Scan')
  })

  it('ignores stale local filter for plan output', () => {
    const out = displayRowsForOutput({
      outputKind: 'plan',
      hasResultSet: true,
      rows,
      columns: ['name', 'id'],
      filter: 'index',
      sort: null,
      sortRows: identitySort,
      filterRows: filterByName,
    })
    expect(out).toHaveLength(2)
  })
})
