import { describe, expect, it, vi } from 'vitest'
import { PostgresDriver } from './postgres'

function installSession(
  driver: PostgresDriver,
  sessionId: string,
  poolQuery: ReturnType<typeof vi.fn>,
  database = 'app',
) {
  const pool = { query: poolQuery, end: async () => {}, connect: async () => ({}) }
  const pools = new Map([[database, pool]])
  ;(driver as any).sessions.set(sessionId, {
    id: sessionId,
    connectionId: 'c1',
    connectionName: 't',
    host: '127.0.0.1',
    port: 5433,
    username: 'u',
    database,
    serverVersion: '16',
    password: 'pw',
    ssl: false,
    pools,
    poolLastUsed: new Map([[database, Date.now()]]),
  })
}

function mockControl(
  driver: PostgresDriver,
  queryImpl: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>,
) {
  const end = vi.fn(async () => {})
  const query = vi.fn(queryImpl)
  const open = vi.fn(async () => ({ query, end }))
  ;(driver as any).openControlClient = open
  return { open, query, end }
}

describe('PostgresDriver.cancelQuery control connection', () => {
  it('uses control factory, not business pool.query', async () => {
    const driver = new PostgresDriver()
    const poolQuery = vi.fn(async () => {
      throw new Error('business pool should not be used')
    })
    installSession(driver, 's1', poolQuery)
    const { open, query, end } = mockControl(driver, async () => ({ rows: [{ ok: true }] }))
    ;(driver as any).activeQueries.set('q1', {
      sessionId: 's1',
      database: 'app',
      pid: 99,
      cancelled: false,
      client: null,
    })

    const r = await driver.cancelQuery('s1', 'q1')
    expect(r.status).toBe('cancelled')
    expect((driver as any).activeQueries.get('q1').cancelled).toBe(true)
    expect(poolQuery).not.toHaveBeenCalled()
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's1' }),
      'app',
    )
    expect(query).toHaveBeenCalledWith('SELECT pg_cancel_backend($1) AS ok', [99])
    expect(end).toHaveBeenCalledTimes(1)
  })

  it('closes control on failed cancel; does not set cancelled', async () => {
    const driver = new PostgresDriver()
    const poolQuery = vi.fn()
    installSession(driver, 's1', poolQuery)
    const { end } = mockControl(driver, async () => {
      throw new Error('permission denied password=secret')
    })
    ;(driver as any).activeQueries.set('q1', {
      sessionId: 's1',
      database: 'app',
      pid: 1,
      cancelled: false,
      client: null,
    })

    const r = await driver.cancelQuery('s1', 'q1')
    expect(r.status).toBe('failed')
    expect(r.error).not.toContain('secret')
    expect((driver as any).activeQueries.get('q1').cancelled).toBe(false)
    expect(poolQuery).not.toHaveBeenCalled()
    expect(end).toHaveBeenCalledTimes(1)
  })

  it('control connect failure -> failed sanitized, no cancelled', async () => {
    const driver = new PostgresDriver()
    const poolQuery = vi.fn()
    installSession(driver, 's1', poolQuery)
    ;(driver as any).openControlClient = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED password=secret')
    })
    ;(driver as any).activeQueries.set('q1', {
      sessionId: 's1',
      database: 'app',
      pid: 1,
      cancelled: false,
      client: null,
    })

    const r = await driver.cancelQuery('s1', 'q1')
    expect(r.status).toBe('failed')
    expect(r.error).not.toContain('secret')
    expect((driver as any).activeQueries.get('q1').cancelled).toBe(false)
    expect(poolQuery).not.toHaveBeenCalled()
  })

  it('session gone with residual active is already_finished not requested', async () => {
    const driver = new PostgresDriver()
    ;(driver as any).activeQueries.set('q1', {
      sessionId: 's1',
      database: 'app',
      pid: 1,
      cancelled: false,
      client: null,
    })
    const r = await driver.cancelQuery('s1', 'q1')
    expect(r.status).toBe('already_finished')
    expect((driver as any).activeQueries.get('q1').cancelled).toBe(false)
  })

  it('pg_cancel_backend false does not set cancelled; closes control', async () => {
    const driver = new PostgresDriver()
    installSession(driver, 's1', vi.fn())
    const { end } = mockControl(driver, async () => ({ rows: [{ ok: false }] }))
    ;(driver as any).activeQueries.set('q1', {
      sessionId: 's1',
      database: 'app',
      pid: 5,
      cancelled: false,
      client: null,
    })
    const r = await driver.cancelQuery('s1', 'q1')
    expect(r.status).toBe('already_finished')
    expect((driver as any).activeQueries.get('q1').cancelled).toBe(false)
    expect(end).toHaveBeenCalledTimes(1)
  })

  it('cross-database: opens control with active query database', async () => {
    const driver = new PostgresDriver()
    // business pool only for otherdb; cancel must not touch it
    const poolQuery = vi.fn()
    installSession(driver, 's1', poolQuery, 'otherdb')
    const { open, end } = mockControl(driver, async () => ({ rows: [{ ok: true }] }))
    ;(driver as any).activeQueries.set('q1', {
      sessionId: 's1',
      database: 'workdb',
      pid: 77,
      cancelled: false,
      client: null,
    })
    const r = await driver.cancelQuery('s1', 'q1')
    expect(r.status).toBe('cancelled')
    expect(open).toHaveBeenCalledWith(expect.anything(), 'workdb')
    expect(poolQuery).not.toHaveBeenCalled()
    expect(end).toHaveBeenCalled()
  })

  it('cancelAllQueries reuses one control client and closes it', async () => {
    const driver = new PostgresDriver()
    const poolQuery = vi.fn()
    installSession(driver, 's1', poolQuery)
    const { open, query, end } = mockControl(driver, async () => ({ rows: [{ ok: true }] }))
    ;(driver as any).activeQueries.set('q1', {
      sessionId: 's1',
      database: 'app',
      pid: 1,
      cancelled: false,
      client: null,
    })
    ;(driver as any).activeQueries.set('q2', {
      sessionId: 's1',
      database: 'app',
      pid: 2,
      cancelled: false,
      client: null,
    })
    await driver.cancelAllQueries('s1')
    expect(open).toHaveBeenCalledTimes(1)
    expect(query).toHaveBeenCalledTimes(2)
    expect(end).toHaveBeenCalledTimes(1)
    expect(poolQuery).not.toHaveBeenCalled()
  })
})
