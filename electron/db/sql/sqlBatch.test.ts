import { describe, expect, it, vi } from 'vitest'
import { runSqlBatch, wrapSqlBatchError } from './sqlBatch'

describe('runSqlBatch', () => {
  it('runs statements in order and sums affected rows', async () => {
    const sqls: string[] = []
    const { result, inTransaction } = await runSqlBatch({
      statements: ['START TRANSACTION', 'INSERT INTO t VALUES (1)', 'COMMIT'],
      dialect: 'mysql',
      startedInTransaction: false,
      executeOne: async (sql) => {
        sqls.push(sql)
        return {
          columns: [],
          rows: [],
          rowCount: 0,
          truncated: false,
          durationMs: 1,
          hasResultSet: false,
          affectedRows: sql.startsWith('INSERT') ? 3 : 0,
        }
      },
      rollback: async () => {},
    })
    expect(sqls).toEqual(['START TRANSACTION', 'INSERT INTO t VALUES (1)', 'COMMIT'])
    expect(inTransaction).toBe(false)
    expect(result.batch).toEqual({ statementCount: 3, successCount: 3 })
    expect(result.affectedRows).toBe(3)
    expect(result.hasResultSet).toBe(false)
  })

  it('keeps the last result set and does not treat DML as the grid', async () => {
    const { result } = await runSqlBatch({
      statements: ['SELECT 1 AS x', 'INSERT INTO t VALUES (1)'],
      dialect: 'mysql',
      startedInTransaction: false,
      executeOne: async (sql) => {
        if (sql.startsWith('SELECT')) {
          return {
            columns: ['x'],
            rows: [{ x: 1 }],
            rowCount: 1,
            truncated: false,
            durationMs: 1,
            hasResultSet: true,
          }
        }
        return {
          columns: [],
          rows: [],
          rowCount: 0,
          truncated: false,
          durationMs: 1,
          hasResultSet: false,
          affectedRows: 1,
        }
      },
      rollback: async () => {},
    })
    expect(result.hasResultSet).toBe(true)
    expect(result.columns).toEqual(['x'])
    expect(result.batch?.statementCount).toBe(2)
  })

  it('stops on first error and rolls back a script-opened transaction', async () => {
    const sqls: string[] = []
    const rollback = vi.fn(async () => {})
    await expect(
      runSqlBatch({
        statements: ['START TRANSACTION', 'INSERT INTO t VALUES (1)', 'COMMIT'],
        dialect: 'mysql',
        startedInTransaction: false,
        executeOne: async (sql) => {
          sqls.push(sql)
          if (sql.startsWith('INSERT')) {
            throw Object.assign(new Error('dup'), { errno: 1062, code: 'ER_DUP_ENTRY' })
          }
          return {
            columns: [],
            rows: [],
            rowCount: 0,
            truncated: false,
            durationMs: 1,
            hasResultSet: false,
          }
        },
        rollback,
      }),
    ).rejects.toMatchObject({
      name: 'SqlBatchExecuteError',
      statementIndex: 1,
      errno: 1062,
    })
    expect(sqls).toEqual(['START TRANSACTION', 'INSERT INTO t VALUES (1)'])
    expect(rollback).toHaveBeenCalledTimes(1)
  })

  it('does not auto-rollback when the UI already owned the transaction', async () => {
    const rollback = vi.fn(async () => {})
    await expect(
      runSqlBatch({
        statements: ['INSERT INTO t VALUES (1)'],
        dialect: 'mysql',
        startedInTransaction: true,
        executeOne: async () => {
          throw new Error('fail')
        },
        rollback,
      }),
    ).rejects.toThrow(/Statement 1 of 1/)
    expect(rollback).not.toHaveBeenCalled()
  })
})

describe('wrapSqlBatchError', () => {
  it('copies driver errno/code onto the wrapper', () => {
    const wrapped = wrapSqlBatchError(
      Object.assign(new Error('syntax'), { errno: 1064, code: 'ER_PARSE_ERROR' }),
      0,
      2,
      'INSERT INTO t VALUES (1)',
    )
    expect(wrapped.name).toBe('SqlBatchExecuteError')
    expect((wrapped as any).errno).toBe(1064)
    expect((wrapped as any).code).toBe('ER_PARSE_ERROR')
    expect(wrapped.message).toMatch(/Statement 1 of 2/)
  })
})
