import { describe, expect, it, vi } from 'vitest'
import { MySqlDriver } from './mysql'
import { DEFAULT_QUERY_TIMEOUT_MS } from '../common'

describe('MySqlDriver.warmExactCount timeout', () => {
  it('issues COUNT with query timeout option', async () => {
    const driver = new MySqlDriver()
    const poolQuery = vi.fn(async () => [[{ c: 3 }], []])
    const session = {
      id: 's1',
      connectionId: 'c1',
      connectionName: 't',
      host: 'h',
      port: 3306,
      username: 'u',
      database: 'db',
      serverVersion: '8',
      pool: { query: poolQuery, end: async () => {} },
    }
    ;(driver as any).sessions.set('s1', session)

    await (driver as any).warmExactCount(session, 's1\0db\0t\0\0\0', '`db`.`t`', '', [])
    expect(poolQuery).toHaveBeenCalled()
    const arg = poolQuery.mock.calls[0][0]
    expect(arg).toMatchObject({
      timeout: DEFAULT_QUERY_TIMEOUT_MS,
    })
    expect(String(arg.sql)).toMatch(/COUNT\(\*\)/i)
  })

  it('does not write cache after disconnect', async () => {
    const driver = new MySqlDriver()
    let resolveQ!: () => void
    const gate = new Promise<void>((r) => {
      resolveQ = r
    })
    const poolQuery = vi.fn(async () => {
      await gate
      return [[{ c: 9 }], []]
    })
    const session = {
      id: 's1',
      connectionId: 'c1',
      connectionName: 't',
      host: 'h',
      port: 3306,
      username: 'u',
      database: 'db',
      serverVersion: '8',
      pool: { query: poolQuery, end: async () => {} },
    }
    ;(driver as any).sessions.set('s1', session)
    const key = 's1\0db\0t\0\0\0'
    const warm = (driver as any).warmExactCount(session, key, '`db`.`t`', '', [])
    ;(driver as any).sessions.delete('s1')
    resolveQ()
    await warm
    expect((driver as any).countCache.get(key)).toBeNull()
  })
})
