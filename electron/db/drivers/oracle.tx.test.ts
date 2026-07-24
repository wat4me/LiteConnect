import { describe, expect, it, vi } from 'vitest'
import { OracleDriver } from './oracle'

describe('OracleDriver transaction pin', () => {
  function installSession(driver: OracleDriver) {
    const closed: string[] = []
    const commits: string[] = []
    const rollbacks: string[] = []
    const executes: string[] = []

    const connection = {
      autoCommit: true,
      callTimeout: 0,
      execute: vi.fn(async (sql: string) => {
        executes.push(sql)
        if (/SELECT/i.test(sql) && !/DUAL|SYS_CONTEXT/i.test(sql)) {
          return {
            metaData: [{ name: 'OK' }],
            rows: [{ OK: 1 }],
          }
        }
        return { rows: [], metaData: [] }
      }),
      commit: vi.fn(async () => {
        commits.push('commit')
      }),
      rollback: vi.fn(async () => {
        rollbacks.push('rollback')
      }),
      close: vi.fn(async () => {
        closed.push('close')
      }),
      break: vi.fn(async () => {}),
    }

    const pool = {
      getConnection: async () => connection,
      close: async () => {},
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
      password: 'secret',
      connectString: '127.0.0.1:1521/ORCL',
      pool,
    })

    return { connection, closed, commits, rollbacks, executes }
  }

  it('begin holds connection until commit', async () => {
    const driver = new OracleDriver()
    const { connection, closed, commits } = installSession(driver)
    const st = await driver.beginTransaction('s1', 'tab-a', 'HR')
    expect(st.inTransaction).toBe(true)
    expect(connection.autoCommit).toBe(false)
    expect(closed).toEqual([])

    await driver.query('s1', 'SELECT 1 AS ok FROM dual', {
      clientKey: 'tab-a',
      maxRows: 10,
    })
    expect(closed).toEqual([])

    const after = await driver.commitTransaction('s1', 'tab-a')
    expect(after.inTransaction).toBe(false)
    expect(commits).toContain('commit')
    expect(closed).toContain('close')
    expect(connection.autoCommit).toBe(true)
  })

  it('releaseClient rolls back open TX', async () => {
    const driver = new OracleDriver()
    const { closed, rollbacks } = installSession(driver)
    await driver.beginTransaction('s1', 'tab-b')
    await driver.releaseClient('s1', 'tab-b')
    expect(rollbacks).toContain('rollback')
    expect(closed).toContain('close')
    expect(driver.getTransactionState('s1', 'tab-b').inTransaction).toBe(false)
  })

  it('two tabs use independent pins', async () => {
    const driver = new OracleDriver()
    // each begin needs its own connection object
    const conns: any[] = []
    const pool = {
      getConnection: async () => {
        const c = {
          autoCommit: true,
          callTimeout: 0,
          execute: async () => ({ rows: [], metaData: [] }),
          commit: async () => {},
          rollback: async () => {},
          close: async () => {},
        }
        conns.push(c)
        return c
      },
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
      pool,
    })
    await driver.beginTransaction('s1', 'tab-1')
    await driver.beginTransaction('s1', 'tab-2')
    expect(driver.getTransactionState('s1', 'tab-1').inTransaction).toBe(true)
    expect(driver.getTransactionState('s1', 'tab-2').inTransaction).toBe(true)
    expect(conns.length).toBe(2)
    await driver.commitTransaction('s1', 'tab-1')
    expect(driver.getTransactionState('s1', 'tab-1').inTransaction).toBe(false)
    expect(driver.getTransactionState('s1', 'tab-2').inTransaction).toBe(true)
  })

  it('query outside TX autoCommits and closes', async () => {
    const driver = new OracleDriver()
    const { closed, executes } = installSession(driver)
    const res = await driver.query('s1', 'SELECT * FROM employees', { maxRows: 50 })
    expect(res.hasResultSet).toBe(true)
    expect(executes.some((s) => /FETCH FIRST 51 ROWS ONLY/i.test(s))).toBe(true)
    expect(closed).toContain('close')
  })
})
