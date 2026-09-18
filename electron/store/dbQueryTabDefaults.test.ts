import { describe, expect, it } from 'vitest'
import {
  DB_DEFAULT_MAX_ROWS,
  DB_DEFAULT_QUERY_TIMEOUT_SEC,
  sanitizeDbDefaultMaxRows,
  sanitizeDbDefaultQueryTimeoutSec,
  sanitizeDbDefaultRunScope,
} from './dbQueryTabDefaults'

describe('sanitizeDbDefaultMaxRows', () => {
  it('accepts in-range integers', () => {
    expect(sanitizeDbDefaultMaxRows(1)).toBe(1)
    expect(sanitizeDbDefaultMaxRows(1000)).toBe(1000)
    expect(sanitizeDbDefaultMaxRows(100_000)).toBe(100_000)
    expect(sanitizeDbDefaultMaxRows(50.4)).toBe(50)
  })

  it('clamps out-of-range and defaults corrupt/legacy', () => {
    expect(sanitizeDbDefaultMaxRows(0)).toBe(1)
    expect(sanitizeDbDefaultMaxRows(200_000)).toBe(100_000)
    expect(sanitizeDbDefaultMaxRows(undefined)).toBe(DB_DEFAULT_MAX_ROWS)
    expect(sanitizeDbDefaultMaxRows(null)).toBe(DB_DEFAULT_MAX_ROWS)
    expect(sanitizeDbDefaultMaxRows('1000')).toBe(DB_DEFAULT_MAX_ROWS)
    expect(sanitizeDbDefaultMaxRows(NaN)).toBe(DB_DEFAULT_MAX_ROWS)
  })
})

describe('sanitizeDbDefaultQueryTimeoutSec', () => {
  it('accepts in-range seconds', () => {
    expect(sanitizeDbDefaultQueryTimeoutSec(1)).toBe(1)
    expect(sanitizeDbDefaultQueryTimeoutSec(120)).toBe(120)
    expect(sanitizeDbDefaultQueryTimeoutSec(600)).toBe(600)
  })

  it('clamps and defaults corrupt/legacy', () => {
    expect(sanitizeDbDefaultQueryTimeoutSec(0)).toBe(1)
    expect(sanitizeDbDefaultQueryTimeoutSec(900)).toBe(600)
    expect(sanitizeDbDefaultQueryTimeoutSec(undefined)).toBe(DB_DEFAULT_QUERY_TIMEOUT_SEC)
    expect(sanitizeDbDefaultQueryTimeoutSec(null)).toBe(DB_DEFAULT_QUERY_TIMEOUT_SEC)
    expect(sanitizeDbDefaultQueryTimeoutSec('120')).toBe(DB_DEFAULT_QUERY_TIMEOUT_SEC)
    expect(sanitizeDbDefaultQueryTimeoutSec(NaN)).toBe(DB_DEFAULT_QUERY_TIMEOUT_SEC)
  })
})

describe('sanitizeDbDefaultRunScope', () => {
  it('accepts known scopes and defaults others', () => {
    expect(sanitizeDbDefaultRunScope('smart')).toBe('smart')
    expect(sanitizeDbDefaultRunScope('selection')).toBe('selection')
    expect(sanitizeDbDefaultRunScope('statement')).toBe('statement')
    expect(sanitizeDbDefaultRunScope('all')).toBe('all')
    expect(sanitizeDbDefaultRunScope(undefined)).toBe('smart')
    expect(sanitizeDbDefaultRunScope('other')).toBe('smart')
    expect(sanitizeDbDefaultRunScope(1)).toBe('smart')
  })
})
