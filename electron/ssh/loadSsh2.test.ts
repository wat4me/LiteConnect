import { describe, expect, it, vi } from 'vitest'

vi.mock('ssh2', () => ({
  Client: class MockClient {},
}))

describe('loadSsh2', () => {
  it('caches the module promise', async () => {
    const { loadSsh2 } = await import('./loadSsh2')
    const first = loadSsh2()
    const second = loadSsh2()
    expect(first).toBe(second)
    const mod = await first
    expect(mod.Client).toBeTypeOf('function')
  })
})
