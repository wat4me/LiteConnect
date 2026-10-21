import { describe, expect, it, vi } from 'vitest'
import { warmExactCount } from './mysqlBrowse'
import { BrowseCountCache } from '../browse/browsePagination'
import { DEFAULT_QUERY_TIMEOUT_MS } from '../common'
import type { LiveSession, MysqlBrowseHost } from './mysqlTypes'

function fixture(query: unknown) {
  const session: LiveSession = {
    id: 's1', connectionId: 'c1', connectionName: 't', host: 'h', port: 3306,
    username: 'u', database: 'db', serverVersion: '8', password: '', ssl: undefined,
    pool: { query } as LiveSession['pool'],
  }
  const host: MysqlBrowseHost = {
    sessions: new Map([[session.id, session]]), countCache: new BrowseCountCache(),
    countWarmInflight: new Set(), requireSession: () => session,
  }
  return { host, session }
}

const key = 's1\0db\0t\0\0\0'

describe('MySQL background COUNT', () => {
  it('uses the production Browse implementation with a query timeout', async () => {
    const query = vi.fn(async (_options: { sql: string; timeout?: number }) => [[{ c: 3 }], []])
    const { host, session } = fixture(query)
    await warmExactCount(host, session, key, '`db`.`t`', '', [])
    expect(query).toHaveBeenCalledWith(expect.objectContaining({
      sql: expect.stringMatching(/COUNT\(\*\)/i), timeout: DEFAULT_QUERY_TIMEOUT_MS,
    }))
    expect(host.countCache.get(key)).toBe(3)
    expect(host.countWarmInflight.size).toBe(0)
  })

  it('does not cache a late count after disconnect', async () => {
    let resolve!: () => void
    const gate = new Promise<void>(done => { resolve = done })
    const query = vi.fn(async () => { await gate; return [[{ c: 9 }], []] })
    const { host, session } = fixture(query)
    const pending = warmExactCount(host, session, key, '`db`.`t`', '', [])
    host.sessions.delete(session.id)
    resolve()
    await pending
    expect(host.countCache.get(key)).toBeNull()
    expect(host.countWarmInflight.size).toBe(0)
  })
})
