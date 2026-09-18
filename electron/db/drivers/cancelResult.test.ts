import { describe, expect, it } from 'vitest'
import type { DbCancelResult } from '../types'
import { sanitizeCancelError } from '../common'

/**
 * Structured cancel status contract (DB-007) shared by MySQL/Postgres/Oracle drivers.
 */
function mapMysqlKillError(err: { message?: string; errno?: number; code?: string }): DbCancelResult {
  const msg = String(err?.message || 'KILL QUERY failed')
  if (/Unknown thread id/i.test(msg) || err?.errno === 1094 || err?.code === 'ER_NO_SUCH_THREAD') {
    return { status: 'already_finished' }
  }
  return { status: 'failed', error: sanitizeCancelError(msg) }
}

function mapPgCancel(
  activeExists: boolean,
  sessionExists: boolean,
  pgOk: boolean | null,
  errMsg?: string,
): DbCancelResult {
  if (!activeExists) return { status: 'already_finished' }
  // No session/pool: cannot claim requested; residual active must not get cancelled flag
  if (!sessionExists) return { status: 'already_finished' }
  if (errMsg) {
    if (/does not exist|not exist|is not a backend/i.test(errMsg)) {
      return { status: 'already_finished' }
    }
    return { status: 'failed', error: sanitizeCancelError(errMsg) }
  }
  if (pgOk === false) return { status: 'already_finished' }
  return { status: 'cancelled' }
}

describe('cancel structured results', () => {
  it('mysql unknown thread -> already_finished', () => {
    expect(mapMysqlKillError({ errno: 1094 })).toEqual({ status: 'already_finished' })
  })

  it('mysql permission error -> failed sanitized', () => {
    const r = mapMysqlKillError({ message: 'Access denied password=secret' })
    expect(r.status).toBe('failed')
    expect(r.error).not.toContain('secret')
  })

  it('pg cancel backend false -> already_finished', () => {
    expect(mapPgCancel(true, true, false)).toEqual({ status: 'already_finished' })
  })

  it('pg cancel success -> cancelled', () => {
    expect(mapPgCancel(true, true, true)).toEqual({ status: 'cancelled' })
  })

  it('no active query -> already_finished', () => {
    expect(mapPgCancel(false, true, true)).toEqual({ status: 'already_finished' })
  })

  it('oracle break success -> cancelled; missing session -> already_finished', () => {
    const mapOracle = (
      activeExists: boolean,
      sessionExists: boolean,
      breakOk: boolean,
      errMsg?: string,
    ): DbCancelResult => {
      if (!activeExists) return { status: 'already_finished' }
      if (!sessionExists) return { status: 'already_finished' }
      if (errMsg) {
        if (/not connected|invalid|closed|NJS-003|DPI-1010/i.test(errMsg)) {
          return { status: 'already_finished' }
        }
        return { status: 'failed', error: sanitizeCancelError(errMsg) }
      }
      if (!breakOk) return { status: 'already_finished' }
      return { status: 'cancelled' }
    }
    expect(mapOracle(true, true, true)).toEqual({ status: 'cancelled' })
    expect(mapOracle(true, false, true)).toEqual({ status: 'already_finished' })
    expect(mapOracle(false, true, true)).toEqual({ status: 'already_finished' })
  })
})
