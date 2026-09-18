import { describe, expect, it } from 'vitest'
import {
  canGoNextPage,
  cancelResultUi,
  isLiveRequest,
  maxPageFromBrowse,
  nextRequestGen,
  shouldClearLoading,
  shouldContinueExportPage,
} from './dbAsyncGuard'

describe('request generation', () => {
  it('only live gen is accepted; old finally does not clear new loading', () => {
    const map = new Map<string, number>()
    const g1 = nextRequestGen(map, 'tab-a')
    const g2 = nextRequestGen(map, 'tab-a')
    expect(isLiveRequest(map, 'tab-a', g1)).toBe(false)
    expect(isLiveRequest(map, 'tab-a', g2)).toBe(true)
    expect(shouldClearLoading(map, 'tab-a', g1)).toBe(false)
    expect(shouldClearLoading(map, 'tab-a', g2)).toBe(true)
  })

  it('late response after disconnect gen bump is discarded', () => {
    const map = new Map<string, number>()
    const g = nextRequestGen(map, 'tab-b')
    nextRequestGen(map, 'tab-b') // disconnect / close
    expect(isLiveRequest(map, 'tab-b', g)).toBe(false)
  })
})

describe('cancelResultUi', () => {
  it('already_finished does not toast success', () => {
    expect(cancelResultUi({ status: 'already_finished' }).kind).toBe('none')
  })
  it('failed surfaces sanitized error', () => {
    const ui = cancelResultUi({ status: 'failed', error: 'permission denied' })
    expect(ui.kind).toBe('error')
    expect(ui.error).toBe('permission denied')
  })
  it('cancelled/requested show info', () => {
    expect(cancelResultUi({ status: 'cancelled' }).kind).toBe('info')
    expect(cancelResultUi({ status: 'requested' }).kind).toBe('info')
  })
})

describe('pagination helpers', () => {
  it('canGoNextPage: hasNext is authoritative over totals', () => {
    expect(
      canGoNextPage({ page: 1, pageSize: 10, total: 10, hasNext: true, totalMode: 'unknown' }),
    ).toBe(true)
    expect(
      canGoNextPage({ page: 1, pageSize: 10, total: 10, hasNext: false, totalMode: 'unknown' }),
    ).toBe(false)
    // stale exact total must not reopen next when pageSize+1 said no
    expect(
      canGoNextPage({ page: 1, pageSize: 10, total: 25, hasNext: false, totalMode: 'exact' }),
    ).toBe(false)
    expect(
      canGoNextPage({ page: 1, pageSize: 10, total: 1_000_000, hasNext: false, totalMode: 'estimated' }),
    ).toBe(false)
  })

  it('bestEffortCancelQuery swallows errors', async () => {
    const { bestEffortCancelQuery } = await import('./dbAsyncGuard')
    await bestEffortCancelQuery('s', 'q', async () => {
      throw new Error('network')
    })
    let called = false
    await bestEffortCancelQuery('s', 'q', async () => {
      called = true
      return { status: 'cancelled' }
    })
    expect(called).toBe(true)
  })

  it('maxPageFromBrowse for unknown uses hasNext', () => {
    expect(
      maxPageFromBrowse({ page: 2, pageSize: 10, total: 20, hasNext: true, totalMode: 'unknown' }),
    ).toBeGreaterThanOrEqual(3)
  })

  it('export loop stops on hasNext false', () => {
    expect(
      shouldContinueExportPage({
        hasNext: false,
        rowsLength: 10,
        allRowsLength: 10,
        total: 999,
        totalMode: 'unknown',
        maxRows: 50_000,
      }),
    ).toBe(false)
    expect(
      shouldContinueExportPage({
        hasNext: true,
        rowsLength: 10,
        allRowsLength: 10,
        total: 10,
        totalMode: 'unknown',
        maxRows: 50_000,
      }),
    ).toBe(true)
  })
})
