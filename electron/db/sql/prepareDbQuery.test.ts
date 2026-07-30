import { describe, expect, it, vi } from 'vitest'
import { prepareDbQueryRequest } from './prepareDbQuery'

const VALID_SESSION = '11111111-1111-4111-8111-111111111111'

describe('prepareDbQueryRequest (real IPC gate)', () => {
  it('rejects invalid session before query', () => {
    expect(() =>
      prepareDbQueryRequest('not-uuid', 'SELECT 1', undefined, {
        getDialect: () => 'mysql',
      }),
    ).toThrow(/session/i)
  })

  it('readOnly=true forged INSERT rejects and would not reach manager', () => {
    const getDialect = vi.fn(() => 'mysql' as const)
    expect(() =>
      prepareDbQueryRequest(VALID_SESSION, 'INSERT INTO t VALUES (1)', { readOnly: true }, {
        getDialect,
      }),
    ).toThrow(/not allowed/i)
    expect(getDialect).toHaveBeenCalledWith(VALID_SESSION)
  })

  it('readOnly=true allows SELECT', () => {
    const prepared = prepareDbQueryRequest(
      VALID_SESSION,
      'SELECT 1',
      { readOnly: true, maxRows: 10, clientKey: 'tab-1' },
      { getDialect: () => 'mysql' },
    )
    expect(prepared.sql).toBe('SELECT 1')
    expect(prepared.options.clientKey).toBe('tab-1')
    expect(prepared.options.maxRows).toBe(10)
    // readOnly flag is not forwarded into manager options bag
    expect((prepared.options as any).readOnly).toBeUndefined()
  })

  it('readOnly false/undefined allows write path (legacy)', () => {
    expect(() =>
      prepareDbQueryRequest(VALID_SESSION, 'INSERT INTO t VALUES (1)', undefined, {
        getDialect: () => 'mysql',
      }),
    ).not.toThrow()
    expect(() =>
      prepareDbQueryRequest(VALID_SESSION, 'DELETE FROM t', { readOnly: false }, {
        getDialect: () => 'mysql',
      }),
    ).not.toThrow()
  })

  it('sanitizes clientKey length', () => {
    const longKey = 'k'.repeat(200)
    const prepared = prepareDbQueryRequest(
      VALID_SESSION,
      'SELECT 1',
      { clientKey: longKey },
      { getDialect: () => 'mysql' },
    )
    expect(prepared.options.clientKey!.length).toBe(128)
  })

  it('handler wiring: on reject, manager.query must not be invoked', async () => {
    const managerQuery = vi.fn(async () => ({ rows: [] }))
    const deps = {
      getDialect: (sid: string) => (sid === VALID_SESSION ? ('mysql' as const) : null),
    }
    // Simulate registerDbHandlers body
    const handler = async (
      sessionId: string,
      sql: string,
      options?: { readOnly?: boolean; clientKey?: string },
    ) => {
      const prepared = prepareDbQueryRequest(sessionId, sql, options, deps)
      return managerQuery(prepared.sessionId, prepared.sql, prepared.options)
    }

    await expect(
      handler(VALID_SESSION, 'UPDATE t SET a=1', { readOnly: true }),
    ).rejects.toThrow()
    expect(managerQuery).not.toHaveBeenCalled()

    await handler(VALID_SESSION, 'SELECT 1', { readOnly: true })
    expect(managerQuery).toHaveBeenCalledTimes(1)
    expect(managerQuery.mock.calls[0][1]).toBe('SELECT 1')
  })
})
