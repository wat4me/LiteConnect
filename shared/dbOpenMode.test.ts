import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DB_OPEN_MODE,
  resolveSshToDbNavigation,
  sanitizeDbOpenMode,
} from './dbOpenMode'

describe('sanitizeDbOpenMode', () => {
  it.each(['currentWindow', 'newWindow'] as const)('retains %s', (mode) => {
    expect(sanitizeDbOpenMode(mode)).toBe(mode)
  })

  it('falls back to newWindow for invalid persisted data', () => {
    expect(sanitizeDbOpenMode('same')).toBe(DEFAULT_DB_OPEN_MODE)
    expect(sanitizeDbOpenMode('')).toBe('newWindow')
    expect(sanitizeDbOpenMode(null)).toBe('newWindow')
    expect(sanitizeDbOpenMode(undefined)).toBe('newWindow')
    expect(sanitizeDbOpenMode(1)).toBe('newWindow')
  })
})

describe('resolveSshToDbNavigation', () => {
  it('is a no-op inside the dedicated DB window', () => {
    expect(resolveSshToDbNavigation({
      isDedicatedDbWindow: true,
      alreadyInDatabaseMode: true,
      openMode: 'currentWindow',
    })).toBe('noop')
  })

  it('stays in-place when this window is already showing DB', () => {
    expect(resolveSshToDbNavigation({
      isDedicatedDbWindow: false,
      alreadyInDatabaseMode: true,
      openMode: 'newWindow',
    })).toBe('currentWindow')
  })

  it('honors currentWindow vs newWindow from SSH', () => {
    expect(resolveSshToDbNavigation({
      isDedicatedDbWindow: false,
      alreadyInDatabaseMode: false,
      openMode: 'currentWindow',
    })).toBe('currentWindow')
    expect(resolveSshToDbNavigation({
      isDedicatedDbWindow: false,
      alreadyInDatabaseMode: false,
      openMode: 'newWindow',
    })).toBe('newWindow')
  })
})
