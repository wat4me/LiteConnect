import { describe, expect, it } from 'vitest'
import { applyTxServerState, isDbSwitchBlockedByTx } from './txUiState'

describe('applyTxServerState', () => {
  const idle: Parameters<typeof applyTxServerState>[0] = {
    inTransaction: false,
    autocommit: true,
    transactionStartedAt: null,
  }

  it('does not change UI when server result is null (failure path)', () => {
    const prev = {
      inTransaction: true,
      autocommit: false,
      transactionStartedAt: 1000,
    }
    const next = applyTxServerState(prev, null, 5000)
    expect(next).toEqual(prev)
    expect(next).not.toBe(prev)
  })

  it('sets startedAt on begin success', () => {
    const next = applyTxServerState(idle, { inTransaction: true, autocommit: false }, 2000)
    expect(next.inTransaction).toBe(true)
    expect(next.autocommit).toBe(false)
    expect(next.transactionStartedAt).toBe(2000)
  })

  it('keeps startedAt while still in transaction', () => {
    const prev = {
      inTransaction: true,
      autocommit: false,
      transactionStartedAt: 1000,
    }
    const next = applyTxServerState(prev, { inTransaction: true, autocommit: false }, 9000)
    expect(next.transactionStartedAt).toBe(1000)
  })

  it('clears startedAt on commit/rollback success', () => {
    const prev = {
      inTransaction: true,
      autocommit: false,
      transactionStartedAt: 1000,
    }
    const next = applyTxServerState(prev, { inTransaction: false, autocommit: true }, 9000)
    expect(next.inTransaction).toBe(false)
    expect(next.autocommit).toBe(true)
    expect(next.transactionStartedAt).toBeNull()
  })
})

describe('isDbSwitchBlockedByTx', () => {
  it('blocks only while in transaction', () => {
    expect(isDbSwitchBlockedByTx(true)).toBe(true)
    expect(isDbSwitchBlockedByTx(false)).toBe(false)
    expect(isDbSwitchBlockedByTx(undefined)).toBe(false)
  })
})
