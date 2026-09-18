import { describe, expect, it, vi } from 'vitest'
import { OracleDriver } from './oracle'

describe('OracleDriver.exportTableStream cancel', () => {
  it('cancel mid-export throws EXPORT_CANCELLED and closes connection', async () => {
    const driver = new OracleDriver()
    const closed: string[] = []
    let call = 0

    const connection = {
      callTimeout: 0,
      execute: vi.fn(async () => {
        call += 1
        return {
          metaData: [{ name: 'ID' }],
          rows: Array.from({ length: 20 }, (_, i) => ({ ID: i + (call - 1) * 20 })),
        }
      }),
      close: vi.fn(async () => {
        closed.push('close')
      }),
    }

    ;(driver as any).sessions.set('s1', {
      id: 's1',
      connectionId: 'c1',
      connectionName: 't',
      host: '127.0.0.1',
      port: 1521,
      username: 'u',
      database: 'HR',
      serverVersion: 'Oracle',
      password: 'x',
      connectString: '127.0.0.1:1521/ORCL',
      pool: {
        getConnection: async () => connection,
        close: async () => {},
      },
    })

    let cancelled = false
    let rows = 0
    await expect(
      driver.exportTableStream('s1', 'HR', 'EMPLOYEES', {
        maxRows: 1000,
        format: 'csv',
        isCancelled: () => cancelled,
        onColumns: () => {},
        onRow: async () => {
          rows += 1
          if (rows >= 3) cancelled = true
        },
      }),
    ).rejects.toMatchObject({ code: 'EXPORT_CANCELLED' })

    expect(rows).toBeGreaterThanOrEqual(3)
    expect(closed).toContain('close')
  })

  it('completes when no cancel', async () => {
    const driver = new OracleDriver()
    let call = 0
    const connection = {
      callTimeout: 0,
      execute: vi.fn(async () => {
        call += 1
        if (call === 1) {
          return {
            metaData: [{ name: 'ID' }],
            rows: [{ ID: 1 }, { ID: 2 }],
          }
        }
        return { metaData: [{ name: 'ID' }], rows: [] }
      }),
      close: async () => {},
    }
    ;(driver as any).sessions.set('s1', {
      id: 's1',
      connectionId: 'c1',
      connectionName: 't',
      host: 'h',
      port: 1521,
      username: 'u',
      database: 'HR',
      serverVersion: 'v',
      password: 'x',
      connectString: 'h:1521/x',
      pool: {
        getConnection: async () => connection,
        close: async () => {},
      },
    })

    const out = await driver.exportTableStream('s1', 'HR', 'T', {
      maxRows: 100,
      format: 'csv',
      isCancelled: () => false,
      onRow: async () => {},
    })
    expect(out.rowsWritten).toBe(2)
    expect(out.columns).toEqual(['ID'])
    expect(out.truncated).toBe(false)
  })
})
