import { describe, expect, it, vi } from 'vitest'
import { PostgresDriver } from './postgres'

describe('PostgresDriver.exportTableStream cancel', () => {
  it('cancel rolls back and discards or releases cleanly', async () => {
    const driver = new PostgresDriver()
    const released: Array<Error | 'clean'> = []
    const queries: string[] = []
    let fetchCount = 0

    const client = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql)
        if (sql === 'BEGIN' || sql.startsWith('DECLARE') || sql === 'ROLLBACK' || sql.startsWith('CLOSE')) {
          return { rows: [], fields: [], rowCount: 0 }
        }
        if (sql.startsWith('FETCH')) {
          fetchCount++
          if (fetchCount === 1) {
            return {
              rows: [{ id: 1 }, { id: 2 }],
              fields: [{ name: 'id' }],
              rowCount: 2,
            }
          }
          return { rows: [], fields: [{ name: 'id' }], rowCount: 0 }
        }
        return { rows: [], fields: [], rowCount: 0 }
      }),
      release: (err?: Error) => {
        released.push(err ?? 'clean')
      },
    }

    const pool = {
      connect: async () => client,
      end: async () => {},
      query: async () => ({ rows: [] }),
    }

    ;(driver as any).sessions.set('s1', {
      id: 's1',
      connectionId: 'c1',
      connectionName: 't',
      host: '127.0.0.1',
      port: 5432,
      username: 'u',
      database: 'db',
      serverVersion: '16',
      password: 'x',
      ssl: false,
      pools: new Map([['db', pool]]),
      poolLastUsed: new Map([['db', Date.now()]]),
    })

    let cancelled = false
    await expect(
      driver.exportTableStream('s1', 'db', 'users', {
        maxRows: 1000,
        format: 'csv',
        isCancelled: () => cancelled,
        onRow: async () => {
          cancelled = true
        },
      }),
    ).rejects.toMatchObject({ code: 'EXPORT_CANCELLED' })

    expect(queries).toContain('ROLLBACK')
    // Cancel after ROLLBACK may release cleanly
    expect(released.length).toBeGreaterThanOrEqual(1)
  })

  it('hard error discards client via release(err)', async () => {
    const driver = new PostgresDriver()
    const released: Array<Error | 'clean'> = []

    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN') return { rows: [], fields: [], rowCount: 0 }
        if (sql.startsWith('DECLARE')) throw new Error('declare failed')
        if (sql === 'ROLLBACK') throw new Error('rollback also failed')
        return { rows: [], fields: [], rowCount: 0 }
      }),
      release: (err?: Error) => {
        released.push(err ?? 'clean')
      },
    }

    const pool = {
      connect: async () => client,
      end: async () => {},
      query: async () => ({ rows: [] }),
    }

    ;(driver as any).sessions.set('s1', {
      id: 's1',
      connectionId: 'c1',
      connectionName: 't',
      host: '127.0.0.1',
      port: 5432,
      username: 'u',
      database: 'db',
      serverVersion: '16',
      password: 'x',
      ssl: false,
      pools: new Map([['db', pool]]),
      poolLastUsed: new Map([['db', Date.now()]]),
    })

    await expect(
      driver.exportTableStream('s1', 'db', 'users', {
        maxRows: 10,
        format: 'csv',
        isCancelled: () => false,
        onRow: async () => {},
      }),
    ).rejects.toThrow(/declare failed/)

    expect(released.some((r) => r instanceof Error)).toBe(true)
  })
})
