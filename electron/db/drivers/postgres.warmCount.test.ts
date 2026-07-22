import { describe, expect, it, vi } from 'vitest'
import { PostgresDriver } from './postgres'

describe('PostgresDriver.warmExactCount statement_timeout', () => {
  it('uses dedicated client with timeout and releases it', async () => {
    const driver = new PostgresDriver()
    const clientQuery = vi.fn(async (sql: string) => {
      if (/COUNT/i.test(sql)) return { rows: [{ c: '4' }], fields: [] }
      return { rows: [], fields: [] }
    })
    const release = vi.fn()
    const connect = vi.fn(async () => ({
      query: clientQuery,
      release,
    }))
    const pool = { connect, query: vi.fn(), end: async () => {} }
    const session = {
      id: 's1',
      connectionId: 'c1',
      connectionName: 't',
      host: 'h',
      port: 5432,
      username: 'u',
      database: 'db',
      serverVersion: '16',
      password: '',
      ssl: false,
      pools: new Map([['db', pool]]),
      poolLastUsed: new Map([['db', Date.now()]]),
    }
    ;(driver as any).sessions.set('s1', session)
    const key = 's1\0db\0t\0\0\0'
    await (driver as any).warmExactCount(session, pool, key, '"public"."t"', '', [])
    expect(connect).toHaveBeenCalled()
    expect(clientQuery.mock.calls.some((c) => /statement_timeout/i.test(String(c[0])))).toBe(true)
    expect(clientQuery.mock.calls.some((c) => /COUNT/i.test(String(c[0])))).toBe(true)
    expect(release).toHaveBeenCalled()
    expect((driver as any).countCache.get(key)).toBe(4)
  })

  it('does not write cache after disconnect', async () => {
    const driver = new PostgresDriver()
    let resolveQ!: () => void
    const gate = new Promise<void>((r) => {
      resolveQ = r
    })
    const clientQuery = vi.fn(async (sql: string) => {
      if (/COUNT/i.test(sql)) {
        await gate
        return { rows: [{ c: '12' }], fields: [] }
      }
      return { rows: [], fields: [] }
    })
    const pool = {
      connect: vi.fn(async () => ({
        query: clientQuery,
        release: vi.fn(),
      })),
      query: vi.fn(),
      end: async () => {},
    }
    const session = {
      id: 's1',
      connectionId: 'c1',
      connectionName: 't',
      host: 'h',
      port: 5432,
      username: 'u',
      database: 'db',
      serverVersion: '16',
      password: '',
      ssl: false,
      pools: new Map([['db', pool]]),
      poolLastUsed: new Map([['db', Date.now()]]),
    }
    ;(driver as any).sessions.set('s1', session)
    const key = 's1\0db\0t\0\0\0'
    const warm = (driver as any).warmExactCount(session, pool, key, '"public"."t"', '', [])
    ;(driver as any).sessions.delete('s1')
    resolveQ()
    await warm
    expect((driver as any).countCache.get(key)).toBeNull()
  })
})
