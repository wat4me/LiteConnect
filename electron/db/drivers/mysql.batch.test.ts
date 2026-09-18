import { describe, expect, it, vi } from 'vitest'
import { MySqlDriver } from './mysql'

describe('MySqlDriver multi-statement query', () => {
  function installSession(driver: MySqlDriver) {
    const released: string[] = []
    const queries: string[] = []
    let connections = 0
    const conn = {
      query: vi.fn(async (sql: any) => {
        const s = typeof sql === 'string' ? sql : sql?.sql || ''
        queries.push(s)
        if (/CONNECTION_ID/i.test(s)) {
          return [[{ id: 99 }], [{ name: 'id' }]]
        }
        if (/^\s*SELECT\b/i.test(s) && !/CONNECTION_ID/i.test(s)) {
          return [[{ ok: 1 }], [{ name: 'ok' }]]
        }
        return [{ affectedRows: s.startsWith('INSERT') ? 2 : 0, insertId: 0 }]
      }),
      release: () => {
        released.push('release')
      },
    }
    const pool = {
      getConnection: async () => {
        connections += 1
        return conn
      },
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
      serverVersion: '5.7',
      password: 'secret',
      ssl: false,
      pool,
    })
    return { conn, released, queries, connections: () => connections }
  }

  it('runs START TRANSACTION / INSERT / COMMIT on one connection', async () => {
    const driver = new MySqlDriver()
    const { queries, released, connections } = installSession(driver)
    const sql = `START TRANSACTION;
INSERT INTO t VALUES (1);
COMMIT;`
    const result = await driver.query('s1', sql, { clientKey: 'tab-1', maxRows: 100 })
    expect(connections()).toBe(1)
    expect(queries.filter((q) => !/CONNECTION_ID/i.test(q))).toEqual([
      'START TRANSACTION',
      'INSERT INTO t VALUES (1)',
      'COMMIT',
    ])
    expect(released).toContain('release')
    expect(result.batch?.statementCount).toBe(3)
    expect(result.affectedRows).toBe(2)
    expect(result.transaction?.inTransaction).toBe(false)
    expect(driver.getTransactionState('s1', 'tab-1').inTransaction).toBe(false)
  })

  it('does not send the whole script as one COM_QUERY', async () => {
    const driver = new MySqlDriver()
    const { queries } = installSession(driver)
    await driver.query('s1', 'SELECT 1; SELECT 2;', { maxRows: 10 })
    const userSql = queries.filter((q) => !/CONNECTION_ID/i.test(q))
    expect(userSql).toHaveLength(2)
    expect(userSql[0]).toMatch(/^SELECT 1\b/)
    expect(userSql[1]).toMatch(/^SELECT 2\b/)
    expect(userSql.some((q) => q.includes(';'))).toBe(false)
  })

  it('stops after the failing statement', async () => {
    const driver = new MySqlDriver()
    const { conn, queries } = installSession(driver)
    conn.query.mockImplementation(async (sql: any) => {
      const s = typeof sql === 'string' ? sql : sql?.sql || ''
      queries.push(s)
      if (/CONNECTION_ID/i.test(s)) return [[{ id: 1 }], [{ name: 'id' }]]
      if (s.includes('boom')) {
        throw Object.assign(new Error('syntax'), { errno: 1064, code: 'ER_PARSE_ERROR' })
      }
      return [{ affectedRows: 0, insertId: 0 }]
    })
    await expect(
      driver.query('s1', 'INSERT INTO t VALUES (1); INSERT INTO boom VALUES (2); COMMIT;', {
        clientKey: 'tab-x',
        maxRows: 10,
      }),
    ).rejects.toMatchObject({
      name: 'SqlBatchExecuteError',
      statementIndex: 1,
      errno: 1064,
    })
    expect(queries.some((q) => q === 'COMMIT')).toBe(false)
    expect(queries.some((q) => q === 'ROLLBACK')).toBe(true)
  })

  it('pins leftover SQL transaction so the next query stays on the same connection', async () => {
    const driver = new MySqlDriver()
    const { released, connections } = installSession(driver)
    await driver.query('s1', 'START TRANSACTION; INSERT INTO t VALUES (1);', {
      clientKey: 'tab-keep',
      maxRows: 10,
    })
    expect(released).toEqual([])
    expect(driver.getTransactionState('s1', 'tab-keep').inTransaction).toBe(true)

    await driver.query('s1', 'INSERT INTO t VALUES (2)', { clientKey: 'tab-keep', maxRows: 10 })
    expect(connections()).toBe(1)
    expect(released).toEqual([])

    await driver.commitTransaction('s1', 'tab-keep')
    expect(released).toContain('release')
  })
})
