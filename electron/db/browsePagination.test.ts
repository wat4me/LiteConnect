import { describe, expect, it } from 'vitest'
import {
  BrowseCountCache,
  browseCountCacheKey,
  browseHasFilter,
  finalizeBrowsePage,
} from './browsePagination'

describe('browseCountCacheKey', () => {
  it('includes session/database/table/search/filters', () => {
    const a = browseCountCacheKey('s1', 'db', 't', { search: 'x' })
    const b = browseCountCacheKey('s1', 'db', 't', { search: 'y' })
    const c = browseCountCacheKey('s1', 'db', 't2', { search: 'x' })
    expect(a).not.toBe(b)
    expect(a).not.toBe(c)
  })
})

describe('BrowseCountCache', () => {
  it('stores and invalidates by session', () => {
    const cache = new BrowseCountCache(60_000)
    const k1 = browseCountCacheKey('s1', 'db', 't')
    const k2 = browseCountCacheKey('s2', 'db', 't')
    cache.set(k1, 10)
    cache.set(k2, 20)
    expect(cache.get(k1)).toBe(10)
    cache.invalidateSession('s1')
    expect(cache.get(k1)).toBeNull()
    expect(cache.get(k2)).toBe(20)
  })

  it('dedupe key identity for concurrent warmers', () => {
    const cache = new BrowseCountCache()
    const key = browseCountCacheKey('s', 'd', 't', { search: 'a' })
    expect(cache.get(key)).toBeNull()
    cache.set(key, 5)
    expect(cache.get(key)).toBe(5)
  })
})

describe('finalizeBrowsePage', () => {
  const base = {
    columns: ['id'],
    page: 1,
    pageSize: 2,
    durationMs: 1,
  }

  it('pageSize+1 yields hasNext without exact count', () => {
    const r = finalizeBrowsePage({
      ...base,
      rows: [{ id: 1 }, { id: 2 }, { id: 3 }],
      exactTotal: null,
      estimatedTotal: null,
      hasFilter: true,
    })
    expect(r.rows).toHaveLength(2)
    expect(r.hasNext).toBe(true)
    expect(r.totalMode).toBe('unknown')
    expect(r.total).toBe(2)
  })

  it('uses exact total when cached but hasNext only from pageSize+1', () => {
    const r = finalizeBrowsePage({
      ...base,
      rows: [{ id: 1 }, { id: 2 }],
      exactTotal: 100,
      estimatedTotal: 50,
      hasFilter: false,
    })
    expect(r.totalMode).toBe('exact')
    expect(r.total).toBe(100)
    // only 2 rows (= pageSize), no extra row → hasNext false even if total says more
    expect(r.hasNext).toBe(false)
  })

  it('uses estimated when unfiltered and no exact; hasNext only from extra row', () => {
    const r = finalizeBrowsePage({
      ...base,
      rows: [{ id: 1 }, { id: 2 }, { id: 3 }],
      exactTotal: null,
      estimatedTotal: 1000,
      hasFilter: false,
    })
    expect(r.totalMode).toBe('estimated')
    expect(r.total).toBe(1000)
    expect(r.hasNext).toBe(true)
  })

  it('stale/overestimated total does not force hasNext true', () => {
    const r = finalizeBrowsePage({
      ...base,
      page: 1,
      pageSize: 10,
      rows: Array.from({ length: 10 }, (_, i) => ({ id: i + 1 })),
      exactTotal: null,
      estimatedTotal: 1_000_000,
      hasFilter: false,
    })
    expect(r.totalMode).toBe('estimated')
    expect(r.total).toBe(1_000_000)
    expect(r.hasNext).toBe(false)
  })

  it('stale exact total overestimate does not force hasNext', () => {
    const r = finalizeBrowsePage({
      ...base,
      page: 5,
      pageSize: 10,
      rows: Array.from({ length: 3 }, (_, i) => ({ id: i + 1 })),
      exactTotal: 9999,
      estimatedTotal: null,
      hasFilter: false,
    })
    expect(r.totalMode).toBe('exact')
    expect(r.hasNext).toBe(false)
  })

  it('browseHasFilter detects search and filters', () => {
    expect(browseHasFilter(undefined)).toBe(false)
    expect(browseHasFilter({ search: '  ' })).toBe(false)
    expect(browseHasFilter({ search: 'a' })).toBe(true)
    expect(browseHasFilter({ filters: [{ column: 'c', op: 'eq', value: '1' }] })).toBe(true)
  })
})
