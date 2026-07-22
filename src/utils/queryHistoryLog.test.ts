import { describe, expect, it } from 'vitest'
import {
  buildExplainHistoryMeta,
  filterHistoryItems,
  historyLogMeta,
  sqlFromHistoryItem,
  truncateHistoryError,
  truncateHistorySql,
} from './queryHistoryLog'
import type { QueryHistoryItem } from '../components/database/types'

function item(partial: Partial<QueryHistoryItem> & { sql: string }): QueryHistoryItem {
  return {
    id: partial.id || '1',
    sql: partial.sql,
    database: partial.database ?? '',
    at: partial.at ?? 1,
    connectionId: partial.connectionId,
    status: partial.status,
    durationMs: partial.durationMs,
    rowCount: partial.rowCount,
    affectedRows: partial.affectedRows,
    errorSummary: partial.errorSummary,
    slow: partial.slow,
    runScope: partial.runScope,
    truncated: partial.truncated,
  }
}

describe('truncateHistorySql / error', () => {
  it('truncates long sql with ellipsis', () => {
    const long = 'SELECT ' + 'x'.repeat(300)
    const out = truncateHistorySql(long, 20)
    expect(out.length).toBeLessThanOrEqual(20)
    expect(out.endsWith('…')).toBe(true)
  })

  it('returns empty for missing error', () => {
    expect(truncateHistoryError(undefined)).toBe('')
  })
})

describe('filterHistoryItems', () => {
  const list = [
    item({ id: 'a', sql: 'A', connectionId: 'c1', status: 'success', durationMs: 100 }),
    item({ id: 'b', sql: 'B', connectionId: 'c2', status: 'failed', durationMs: 50 }),
    item({ id: 'c', sql: 'C', connectionId: 'c1', status: 'cancelled', durationMs: 3000 }),
    item({ id: 'd', sql: 'D', durationMs: 5000, slow: true }),
  ]

  it('filters by connection including orphans', () => {
    const out = filterHistoryItems(list, {
      onlyConnectionId: 'c1',
      status: 'all',
    })
    expect(out.map((x) => x.id).sort()).toEqual(['a', 'c', 'd'])
  })

  it('filters failed and slow', () => {
    expect(filterHistoryItems(list, { status: 'failed' }).map((x) => x.id)).toEqual(['b'])
    expect(filterHistoryItems(list, { status: 'slow' }).map((x) => x.id).sort()).toEqual(['c', 'd'])
  })
})

describe('historyLogMeta', () => {
  it('prefers rowCount over affectedRows', () => {
    const meta = historyLogMeta(
      item({ sql: 'S', rowCount: 10, affectedRows: 3, status: 'success', durationMs: 12 }),
    )
    expect(meta.rowsLabel).toBe('10 rows')
    expect(meta.status).toBe('success')
    expect(meta.durationMs).toBe(12)
  })

  it('shows affected when no rowCount', () => {
    expect(historyLogMeta(item({ sql: 'U', affectedRows: 2 })).rowsLabel).toBe('2 affected')
  })

  it('marks truncated and error preview', () => {
    const meta = historyLogMeta(
      item({
        sql: 'X',
        status: 'failed',
        truncated: true,
        errorSummary: 'boom ' + 'z'.repeat(200),
        runScope: 'selection',
      }),
    )
    expect(meta.truncated).toBe(true)
    expect(meta.scope).toBe('selection')
    expect(meta.errorPreview.length).toBeLessThanOrEqual(120)
    expect(meta.errorPreview.length).toBeGreaterThan(0)
  })
})

describe('sqlFromHistoryItem', () => {
  it('restores sql without implying execution', () => {
    expect(sqlFromHistoryItem(item({ sql: 'SELECT 1' }))).toBe('SELECT 1')
    expect(sqlFromHistoryItem(null)).toBe('')
  })
})

describe('buildExplainHistoryMeta', () => {
  it('shapes success with runScope explain and optional row/trunc', () => {
    const meta = buildExplainHistoryMeta({
      startedAtMs: 1000,
      nowMs: 1500,
      connectionId: 'c1',
      outcome: {
        kind: 'success',
        rowCount: 3,
        durationMs: 42,
        truncated: true,
      },
    })
    expect(meta).toEqual({
      status: 'success',
      durationMs: 42,
      rowCount: 3,
      truncated: true,
      runScope: 'explain',
      connectionId: 'c1',
    })
  })

  it('shapes failed/cancelled with sanitized error and wall duration', () => {
    const failed = buildExplainHistoryMeta({
      startedAtMs: 0,
      nowMs: 250,
      connectionId: 'c1',
      outcome: { kind: 'failed', errorSummary: 'boom' },
    })
    expect(failed.status).toBe('failed')
    expect(failed.runScope).toBe('explain')
    expect(failed.durationMs).toBe(250)
    expect(failed.errorSummary).toBe('boom')

    const cancelled = buildExplainHistoryMeta({
      startedAtMs: 0,
      nowMs: 10,
      outcome: { kind: 'cancelled', errorSummary: 'cancelled' },
    })
    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.runScope).toBe('explain')
  })
})
