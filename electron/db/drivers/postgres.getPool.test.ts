import { describe, expect, it, vi, afterEach } from 'vitest'
import { PostgresDriver } from './postgres'

type FakePool = {
  id: number
  query: ReturnType<typeof vi.fn>
  end: ReturnType<typeof vi.fn>
  connect: ReturnType<typeof vi.fn>
}

function makeFakePool(id: number, delayMs = 20): FakePool {
  return {
    id,
    query: vi.fn(async () => {
      await new Promise((r) => setTimeout(r, delayMs))
      return { rows: [{ ok: 1 }], fields: [] }
    }),
    end: vi.fn(async () => {}),
    connect: vi.fn(async () => ({
      query: vi.fn(async () => ({ rows: [], fields: [] })),
      release: vi.fn(),
    })),
  }
}

function seedSession(driver: PostgresDriver, sessionId: string) {
  ;(driver as any).sessions.set(sessionId, {
    id: sessionId,
    connectionId: 'c1',
    connectionName: 't',
    host: 'h',
    port: 5432,
    username: 'u',
    database: 'postgres',
    serverVersion: '16',
    password: 'p',
    ssl: false,
    pools: new Map(),
    poolLastUsed: new Map(),
  })
}

describe('PostgresDriver.getPool single-flight', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('concurrent miss for same session+db creates one pool', async () => {
    const driver = new PostgresDriver()
    seedSession(driver, 's1')
    let n = 0
    const created: FakePool[] = []
    ;(driver as any).createPool = () => {
      n += 1
      const p = makeFakePool(n, 30)
      created.push(p)
      return p
    }

    const [a, b] = await Promise.all([
      (driver as any).getPool('s1', 'db_a'),
      (driver as any).getPool('s1', 'db_a'),
    ])
    expect(n).toBe(1)
    expect(a.pool).toBe(b.pool)
    expect(a.pool).toBe(created[0])
    const session = (driver as any).sessions.get('s1')
    expect(session.pools.get('db_a')).toBe(created[0])
    expect(created[0].end).not.toHaveBeenCalled()
  })

  it('create failure clears inflight so retry can create again', async () => {
    const driver = new PostgresDriver()
    seedSession(driver, 's1')
    let n = 0
    ;(driver as any).createPool = () => {
      n += 1
      const p = makeFakePool(n, 5)
      if (n === 1) {
        p.query = vi.fn(async () => {
          throw new Error('connect refused')
        })
      }
      return p
    }

    await expect((driver as any).getPool('s1', 'db_x')).rejects.toThrow(/connect refused/)
    expect((driver as any).poolCreateInflight.size).toBe(0)

    const ok = await (driver as any).getPool('s1', 'db_x')
    expect(n).toBe(2)
    expect(ok.pool.id).toBe(2)
  })

  it('disconnect during create does not re-write pools', async () => {
    const driver = new PostgresDriver()
    seedSession(driver, 's1')
    let resolveQuery!: () => void
    const queryGate = new Promise<void>((r) => {
      resolveQuery = r
    })
    const fake = makeFakePool(1, 0)
    fake.query = vi.fn(async () => {
      await queryGate
      return { rows: [{ ok: 1 }], fields: [] }
    })
    ;(driver as any).createPool = () => fake

    const pending = (driver as any).getPool('s1', 'db_y')
    await new Promise((r) => setTimeout(r, 5))
    ;(driver as any).sessions.delete('s1')
    resolveQuery()
    await expect(pending).rejects.toThrow(/session not found/i)
    expect(fake.end).toHaveBeenCalled()
    expect((driver as any).poolCreateInflight.size).toBe(0)
  })
})
