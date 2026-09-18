import { describe, expect, it, vi } from 'vitest'
import { MySqlDriver } from './mysql'

function installSession(driver: MySqlDriver, sessionId: string, poolQuery: ReturnType<typeof vi.fn>) {
  ;(driver as any).sessions.set(sessionId, {
    id: sessionId,
    connectionId: 'c1',
    connectionName: 't',
    host: '127.0.0.1',
    port: 3307,
    username: 'u',
    database: 'db',
    serverVersion: '8',
    password: 'pw',
    ssl: undefined,
    pool: { query: poolQuery, end: async () => {} },
  })
}

function mockControl(
  driver: MySqlDriver,
  queryImpl: (sql: string | { sql: string; timeout?: number }) => Promise<unknown>,
) {
  const end = vi.fn(async () => {})
  const query = vi.fn(queryImpl)
  const open = vi.fn(async () => ({ query, end }))
  ;(driver as any).openControlConnection = open
  return { open, query, end }
}

describe('MySqlDriver.cancelQuery control connection', () => {
  it('uses control factory, not business pool.query', async () => {
    const driver = new MySqlDriver()
    const poolQuery = vi.fn(async () => {
      throw new Error('business pool should not be used')
    })
    installSession(driver, 's1', poolQuery)
    const { open, query, end } = mockControl(driver, async () => [[{}], []])
    ;(driver as any).activeQueries.set('q1', { sessionId: 's1', threadId: 42, cancelled: false })

    const r = await driver.cancelQuery('s1', 'q1')
    expect(r.status).toBe('cancelled')
    expect((driver as any).activeQueries.get('q1').cancelled).toBe(true)
    expect(poolQuery).not.toHaveBeenCalled()
    expect(open).toHaveBeenCalledTimes(1)
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({ sql: 'KILL QUERY 42', timeout: expect.any(Number) }),
    )
    expect(end).toHaveBeenCalledTimes(1)
  })

  it('closes control connection on failed KILL and does not set cancelled', async () => {
    const driver = new MySqlDriver()
    const poolQuery = vi.fn()
    installSession(driver, 's1', poolQuery)
    const { end } = mockControl(driver, async () => {
      throw Object.assign(new Error('Access denied password=secret'), { errno: 1142 })
    })
    ;(driver as any).activeQueries.set('q1', { sessionId: 's1', threadId: 7, cancelled: false })

    const r = await driver.cancelQuery('s1', 'q1')
    expect(r.status).toBe('failed')
    expect(r.error).not.toContain('secret')
    expect((driver as any).activeQueries.get('q1').cancelled).toBe(false)
    expect(poolQuery).not.toHaveBeenCalled()
    expect(end).toHaveBeenCalledTimes(1)
  })

  it('control connect failure -> failed sanitized, no cancelled, no pool', async () => {
    const driver = new MySqlDriver()
    const poolQuery = vi.fn()
    installSession(driver, 's1', poolQuery)
    ;(driver as any).openControlConnection = vi.fn(async () => {
      throw new Error('connect ETIMEDOUT password=secret')
    })
    ;(driver as any).activeQueries.set('q1', { sessionId: 's1', threadId: 1, cancelled: false })

    const r = await driver.cancelQuery('s1', 'q1')
    expect(r.status).toBe('failed')
    expect(r.error).not.toContain('secret')
    expect((driver as any).activeQueries.get('q1').cancelled).toBe(false)
    expect(poolQuery).not.toHaveBeenCalled()
  })

  it('unknown thread does not set cancelled; still closes control', async () => {
    const driver = new MySqlDriver()
    installSession(driver, 's1', vi.fn())
    const { end } = mockControl(driver, async () => {
      throw Object.assign(new Error('Unknown thread id: 9'), { errno: 1094 })
    })
    ;(driver as any).activeQueries.set('q1', { sessionId: 's1', threadId: 9, cancelled: false })

    const r = await driver.cancelQuery('s1', 'q1')
    expect(r.status).toBe('already_finished')
    expect((driver as any).activeQueries.get('q1').cancelled).toBe(false)
    expect(end).toHaveBeenCalledTimes(1)
  })

  it('session missing with active residual is already_finished not requested', async () => {
    const driver = new MySqlDriver()
    ;(driver as any).activeQueries.set('q1', { sessionId: 's1', threadId: 1, cancelled: false })
    const r = await driver.cancelQuery('s1', 'q1')
    expect(r.status).toBe('already_finished')
    expect((driver as any).activeQueries.get('q1').cancelled).toBe(false)
  })

  it('race: query finishes during KILL -> already_finished; control closed', async () => {
    const driver = new MySqlDriver()
    installSession(driver, 's1', vi.fn())
    const { end } = mockControl(driver, async () => {
      ;(driver as any).activeQueries.delete('q1')
      return [[{}], []]
    })
    ;(driver as any).activeQueries.set('q1', { sessionId: 's1', threadId: 3, cancelled: false })

    const r = await driver.cancelQuery('s1', 'q1')
    expect(r.status).toBe('already_finished')
    expect((driver as any).activeQueries.has('q1')).toBe(false)
    expect(end).toHaveBeenCalledTimes(1)
  })

  it('cancelAllQueries reuses one control connection and closes it', async () => {
    const driver = new MySqlDriver()
    const poolQuery = vi.fn()
    installSession(driver, 's1', poolQuery)
    const { open, query, end } = mockControl(driver, async () => [[{}], []])
    ;(driver as any).activeQueries.set('q1', { sessionId: 's1', threadId: 1, cancelled: false })
    ;(driver as any).activeQueries.set('q2', { sessionId: 's1', threadId: 2, cancelled: false })

    await driver.cancelAllQueries('s1')
    expect(open).toHaveBeenCalledTimes(1)
    expect(query).toHaveBeenCalledTimes(2)
    expect(end).toHaveBeenCalledTimes(1)
    expect(poolQuery).not.toHaveBeenCalled()
    expect((driver as any).activeQueries.get('q1').cancelled).toBe(true)
    expect((driver as any).activeQueries.get('q2').cancelled).toBe(true)
  })
})
