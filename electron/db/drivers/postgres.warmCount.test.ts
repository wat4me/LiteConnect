import { describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { warmExactCount } from './postgresBrowse'
import { BrowseCountCache } from '../browse/browsePagination'
import type { LiveSession, PostgresBrowseHost } from './postgresTypes'

function fixture(query: unknown) {
  const release = vi.fn()
  const connect = vi.fn(async () => ({ query, release }))
  const pool = { connect } as unknown as Pool
  const session: LiveSession = {
    id: 's1', connectionId: 'c1', connectionName: 't', host: 'h', port: 5432,
    username: 'u', database: 'db', serverVersion: '16', password: '', ssl: false,
    pools: new Map([['db', pool]]), poolLastUsed: new Map([['db', Date.now()]]),
  }
  const host: PostgresBrowseHost = {
    sessions: new Map([[session.id, session]]), countCache: new BrowseCountCache(),
    countWarmInflight: new Set(), getPool: async () => ({ session, pool, database: 'db' }),
  }
  return { host, session, pool, connect, release }
}

const key = 's1\0db\0t\0\0\0'

describe('PostgreSQL background COUNT', () => {
  it('uses the production Browse implementation with timeout and client release', async () => {
    const query = vi.fn(async (sql: string) => ({ rows: /COUNT/i.test(sql) ? [{ c: '4' }] : [], fields: [] }))
    const { host, session, pool, connect, release } = fixture(query)
    await warmExactCount(host, session, pool, key, '"public"."t"', '', [])
    expect(connect).toHaveBeenCalledOnce()
    expect(query.mock.calls.some(([sql]) => /statement_timeout/i.test(sql))).toBe(true)
    expect(query.mock.calls.some(([sql]) => /COUNT/i.test(sql))).toBe(true)
    expect(release).toHaveBeenCalledOnce()
    expect(host.countCache.get(key)).toBe(4)
    expect(host.countWarmInflight.size).toBe(0)
  })

  it('does not cache a late count after disconnect', async () => {
    let resolve!: () => void
    const gate = new Promise<void>(done => { resolve = done })
    const query = vi.fn(async (sql: string) => {
      if (/COUNT/i.test(sql)) { await gate; return { rows: [{ c: '12' }], fields: [] } }
      return { rows: [], fields: [] }
    })
    const { host, session, pool, release } = fixture(query)
    const pending = warmExactCount(host, session, pool, key, '"public"."t"', '', [])
    await vi.waitFor(() => expect(query.mock.calls.some(([sql]) => /COUNT/i.test(sql))).toBe(true))
    host.sessions.delete(session.id)
    resolve()
    await pending
    expect(host.countCache.get(key)).toBeNull()
    expect(host.countWarmInflight.size).toBe(0)
    expect(release).toHaveBeenCalledOnce()
  })
})
