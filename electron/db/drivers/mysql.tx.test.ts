import { describe, expect, it, vi } from 'vitest'
import { MySqlDriver } from './mysql'

/**
 * Transaction pin lifecycle (DB-009) — uses mock pool connections.
 * Verifies sticky client is not released mid-TX and rollback on release.
 */
describe('MySqlDriver transaction pin', () => {
  function installSession(driver: MySqlDriver) {
    const released: string[] = []
    const queries: string[] = []
    const conn = {
      query: vi.fn(async (sql: any) => {
        const s = typeof sql === 'string' ? sql : sql?.sql || ''
        queries.push(s)
        if (/CONNECTION_ID/i.test(s)) {
          return [[{ id: 99 }], []]
        }
        if (/SELECT/i.test(s) && !/VERSION|DATABASE|CONNECTION/i.test(s)) {
          return [[{ ok: 1 }], [{ name: 'ok' }]]
        }
        return [[{}], []]
      }),
      release: () => {
        released.push('release')
      },
    }
    const pool = {
      getConnection: async () => conn,
      end: async () => {},
      query: async () => [[{}], []],
    }
    ;(driver as any).sessions.set('s1', {
      id: 's1',
      connectionId: 'c1',
      connectionName: 't',
      host: '127.0.0.1',
      port: 3306,
      username: 'u',
      database: 'db',
      serverVersion: '8',
      password: 'secret',
      ssl: false,
      pool,
    })
    return { conn, released, queries }
  }

  it('begin holds connection until commit', async () => {
    const driver = new MySqlDriver()
    const { released, queries } = installSession(driver)
    const st = await driver.beginTransaction('s1', 'tab-a', 'db')
    expect(st.inTransaction).toBe(true)
    expect(released).toEqual([])
    expect(queries.some((q) => /START TRANSACTION|BEGIN/i.test(q))).toBe(true)

    await driver.query('s1', 'SELECT 1', { clientKey: 'tab-a', maxRows: 10 })
    expect(released).toEqual([])

    const after = await driver.commitTransaction('s1', 'tab-a')
    expect(after.inTransaction).toBe(false)
    expect(released).toContain('release')
  })

  it('releaseClient rolls back open TX', async () => {
    const driver = new MySqlDriver()
    const { released, queries } = installSession(driver)
    await driver.beginTransaction('s1', 'tab-b')
    await driver.releaseClient('s1', 'tab-b')
    expect(queries.some((q) => /ROLLBACK/i.test(q))).toBe(true)
    expect(released).toContain('release')
    expect(driver.getTransactionState('s1', 'tab-b').inTransaction).toBe(false)
  })

  it('two tabs use independent pins', async () => {
    const driver = new MySqlDriver()
    installSession(driver)
    await driver.beginTransaction('s1', 'tab-1')
    await driver.beginTransaction('s1', 'tab-2')
    expect(driver.getTransactionState('s1', 'tab-1').inTransaction).toBe(true)
    expect(driver.getTransactionState('s1', 'tab-2').inTransaction).toBe(true)
    await driver.commitTransaction('s1', 'tab-1')
    expect(driver.getTransactionState('s1', 'tab-1').inTransaction).toBe(false)
    expect(driver.getTransactionState('s1', 'tab-2').inTransaction).toBe(true)
  })

  it('COMMIT failure destroys connection (not release)', async () => {
    const driver = new MySqlDriver()
    const { conn, released } = installSession(driver)
    const destroyed: string[] = []
    ;(conn as any).destroy = () => {
      destroyed.push('destroy')
    }
    await driver.beginTransaction('s1', 'tab-fail')
    ;(conn.query as any).mockImplementation(async (sql: any) => {
      const s = typeof sql === 'string' ? sql : sql?.sql || ''
      if (/^COMMIT/i.test(s.trim()) || s === 'COMMIT') {
        throw new Error('COMMIT failed')
      }
      return [[{}], []]
    })
    await expect(driver.commitTransaction('s1', 'tab-fail')).rejects.toThrow(/COMMIT failed/)
    expect(destroyed).toContain('destroy')
    expect(released).not.toContain('release')
    expect(driver.getTransactionState('s1', 'tab-fail').inTransaction).toBe(false)
  })

  it('ROLLBACK failure destroys connection', async () => {
    const driver = new MySqlDriver()
    const { conn, released } = installSession(driver)
    const destroyed: string[] = []
    ;(conn as any).destroy = () => {
      destroyed.push('destroy')
    }
    await driver.beginTransaction('s1', 'tab-rb')
    ;(conn.query as any).mockImplementation(async (sql: any) => {
      const s = typeof sql === 'string' ? sql : sql?.sql || ''
      if (/ROLLBACK/i.test(s)) throw new Error('ROLLBACK failed')
      return [[{}], []]
    })
    await expect(driver.rollbackTransaction('s1', 'tab-rb')).rejects.toThrow(/ROLLBACK failed/)
    expect(destroyed).toContain('destroy')
    expect(released).not.toContain('release')
  })
})
