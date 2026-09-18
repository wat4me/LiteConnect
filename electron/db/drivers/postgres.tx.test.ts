import { describe, expect, it, vi } from 'vitest'
import { PostgresDriver } from './postgres'

describe('PostgresDriver transaction pin', () => {
  function installSession(driver: PostgresDriver) {
    const released: string[] = []
    const queries: string[] = []
    const client = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql)
        if (/pg_backend_pid/i.test(sql)) {
          return { rows: [{ pid: 42 }], fields: [{ name: 'pid' }], rowCount: 1 }
        }
        if (/^SELECT/i.test(sql.trim()) && !/statement_timeout/i.test(sql)) {
          return {
            rows: [{ ok: 1 }],
            fields: [{ name: 'ok' }],
            rowCount: 1,
          }
        }
        return { rows: [], fields: [], rowCount: 0 }
      }),
      release: () => {
        released.push('release')
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
      password: 'secret',
      ssl: false,
      pools: new Map([['db', pool]]),
      poolLastUsed: new Map([['db', Date.now()]]),
    })
    return { client, released, queries }
  }

  it('begin/commit pins client', async () => {
    const driver = new PostgresDriver()
    const { released, queries } = installSession(driver)
    await driver.beginTransaction('s1', 'tab-a', 'db')
    expect(released).toEqual([])
    expect(queries).toContain('BEGIN')

    await driver.query('s1', 'SELECT 1', { clientKey: 'tab-a', database: 'db', maxRows: 10 })
    expect(released).toEqual([])

    await driver.commitTransaction('s1', 'tab-a')
    expect(queries).toContain('COMMIT')
    expect(released).toContain('release')
  })

  it('release rolls back', async () => {
    const driver = new PostgresDriver()
    const { queries, released } = installSession(driver)
    await driver.beginTransaction('s1', 'tab-b', 'db')
    await driver.releaseClient('s1', 'tab-b')
    expect(queries).toContain('ROLLBACK')
    expect(released).toContain('release')
  })

  it('COMMIT failure release(err) discards client', async () => {
    const driver = new PostgresDriver()
    const { client, released } = installSession(driver)
    const releaseArgs: unknown[] = []
    client.release = ((err?: Error) => {
      releaseArgs.push(err ?? 'clean')
      released.push(err ? 'release-err' : 'release')
    }) as any
    await driver.beginTransaction('s1', 'tab-fail', 'db')
    ;(client.query as any).mockImplementation(async (sql: string) => {
      if (sql === 'COMMIT') throw new Error('COMMIT failed')
      return { rows: [], fields: [], rowCount: 0 }
    })
    await expect(driver.commitTransaction('s1', 'tab-fail')).rejects.toThrow(/COMMIT failed/)
    expect(releaseArgs.some((a) => a instanceof Error)).toBe(true)
    expect(released).toContain('release-err')
    expect(released).not.toContain('release')
  })

  it('ROLLBACK failure discards client', async () => {
    const driver = new PostgresDriver()
    const { client, released } = installSession(driver)
    client.release = ((err?: Error) => {
      released.push(err ? 'release-err' : 'release')
    }) as any
    await driver.beginTransaction('s1', 'tab-rb', 'db')
    ;(client.query as any).mockImplementation(async (sql: string) => {
      if (sql === 'ROLLBACK') throw new Error('ROLLBACK failed')
      return { rows: [], fields: [], rowCount: 0 }
    })
    await expect(driver.rollbackTransaction('s1', 'tab-rb')).rejects.toThrow(/ROLLBACK failed/)
    expect(released).toContain('release-err')
  })
})
