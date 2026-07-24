import { describe, expect, it, vi } from 'vitest'
import { OracleDriver } from './oracle'

function installSession(driver: OracleDriver, sessionId = 's1') {
  ;(driver as any).sessions.set(sessionId, {
    id: sessionId,
    connectionId: 'c1',
    connectionName: 't',
    host: '127.0.0.1',
    port: 1521,
    username: 'u',
    database: 'HR',
    serverVersion: 'Oracle',
    password: 'pw',
    connectString: '127.0.0.1:1521/ORCL',
    pool: {
      getConnection: async () => ({
        execute: async () => ({ rows: [], metaData: [] }),
        close: async () => {},
      }),
      close: async () => {},
    },
  })
}

describe('OracleDriver.cancelQuery', () => {
  it('break success -> cancelled', async () => {
    const driver = new OracleDriver()
    installSession(driver)
    const breakFn = vi.fn(async () => {})
    ;(driver as any).activeQueries.set('q1', {
      sessionId: 's1',
      connection: { break: breakFn },
      cancelled: false,
    })

    const r = await driver.cancelQuery('s1', 'q1')
    expect(r.status).toBe('cancelled')
    expect((driver as any).activeQueries.get('q1').cancelled).toBe(true)
    expect(breakFn).toHaveBeenCalledTimes(1)
  })

  it('no active query -> already_finished', async () => {
    const driver = new OracleDriver()
    installSession(driver)
    const r = await driver.cancelQuery('s1', 'missing')
    expect(r.status).toBe('already_finished')
  })

  it('session missing -> already_finished; does not set cancelled', async () => {
    const driver = new OracleDriver()
    ;(driver as any).activeQueries.set('q1', {
      sessionId: 's1',
      connection: { break: vi.fn() },
      cancelled: false,
    })
    const r = await driver.cancelQuery('s1', 'q1')
    expect(r.status).toBe('already_finished')
    expect((driver as any).activeQueries.get('q1').cancelled).toBe(false)
  })

  it('break failure sanitized; not cancelled', async () => {
    const driver = new OracleDriver()
    installSession(driver)
    ;(driver as any).activeQueries.set('q1', {
      sessionId: 's1',
      connection: {
        break: async () => {
          throw new Error('break failed password=secret')
        },
      },
      cancelled: false,
    })
    const r = await driver.cancelQuery('s1', 'q1')
    expect(r.status).toBe('failed')
    expect(r.error).not.toContain('secret')
    expect((driver as any).activeQueries.get('q1').cancelled).toBe(false)
  })

  it('race: query finishes during break -> already_finished', async () => {
    const driver = new OracleDriver()
    installSession(driver)
    ;(driver as any).activeQueries.set('q1', {
      sessionId: 's1',
      connection: {
        break: async () => {
          ;(driver as any).activeQueries.delete('q1')
        },
      },
      cancelled: false,
    })
    const r = await driver.cancelQuery('s1', 'q1')
    expect(r.status).toBe('already_finished')
  })
})
