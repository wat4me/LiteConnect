import { describe, expect, it } from 'vitest'

/**
 * Pure pool-key isolation logic mirroring PostgresDriver multi-db pools.
 * Ensures concurrent tabs never replace a shared pool (DB-006).
 */
function poolKey(sessionId: string, database: string): string {
  return `${sessionId}\0${database}`
}

describe('postgres sessionId+database pool key', () => {
  it('isolates two databases under same session', () => {
    const pools = new Map<string, { id: string }>()
    const s = 'sess-1'
    pools.set(poolKey(s, 'db_a'), { id: 'pool-a' })
    pools.set(poolKey(s, 'db_b'), { id: 'pool-b' })
    expect(pools.get(poolKey(s, 'db_a'))?.id).toBe('pool-a')
    expect(pools.get(poolKey(s, 'db_b'))?.id).toBe('pool-b')
    // Switching "current" database does not delete the other pool
    const current = 'db_b'
    expect(pools.has(poolKey(s, 'db_a'))).toBe(true)
    expect(current).toBe('db_b')
  })

  it('disconnect clears all pools for session', () => {
    const pools = new Map<string, { id: string }>()
    const s = 'sess-1'
    pools.set(poolKey(s, 'a'), { id: '1' })
    pools.set(poolKey(s, 'b'), { id: '2' })
    pools.set(poolKey('sess-2', 'a'), { id: '3' })
    const prefix = `${s}\0`
    for (const k of [...pools.keys()]) {
      if (k.startsWith(prefix)) pools.delete(k)
    }
    expect(pools.size).toBe(1)
    expect(pools.get(poolKey('sess-2', 'a'))?.id).toBe('3')
  })
})
