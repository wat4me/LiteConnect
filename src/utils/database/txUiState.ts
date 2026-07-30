/** Pure helpers for transaction UI state transitions. */

export type TxUiFlags = {
  inTransaction: boolean
  autocommit: boolean
  transactionStartedAt: number | null
}

export type TxServerState = {
  inTransaction: boolean
  autocommit: boolean
}

/**
 * Apply server transaction state after a successful begin/commit/rollback.
 * On failure, caller must pass null and previous flags are returned unchanged.
 */
export function applyTxServerState(
  prev: TxUiFlags,
  server: TxServerState | null,
  nowMs: number,
): TxUiFlags {
  if (!server) return { ...prev }
  const inTx = !!server.inTransaction
  let started = prev.transactionStartedAt
  if (inTx) {
    if (started == null) started = nowMs
  } else {
    started = null
  }
  return {
    inTransaction: inTx,
    autocommit: !!server.autocommit,
    transactionStartedAt: started,
  }
}

/** Whether database switch should be blocked silently (UI must disable or confirm). */
export function isDbSwitchBlockedByTx(inTransaction: boolean | undefined): boolean {
  return !!inTransaction
}
