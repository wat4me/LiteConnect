import { beforeEach, expect, it, vi } from 'vitest'
const db = vi.hoisted(() => ({ getCollection: vi.fn(() => []), replaceCollection: vi.fn() }))
vi.mock('../../store/appDatabase', () => ({ COLLECTIONS: { knownHosts: 'hosts' }, getAppDatabase: () => db }))
import { KnownHostsStore } from './knownHosts'
beforeEach(() => vi.clearAllMocks())

it('does not trust a new key when persistence fails', async () => {
  const store = new KnownHostsStore()
  db.replaceCollection.mockImplementationOnce(() => { throw new Error('Disk full') })
  await expect(store.updateHostKey('server', 22, Buffer.from('key'))).rejects.toThrow('Disk full')
  expect(store.verifySync('server', 22, Buffer.from('key')).accepted).toBe(false)
})

it('preserves the previous key if replacing or removing trust fails', async () => {
  const store = new KnownHostsStore()
  const original = await store.updateHostKey('server', 22, Buffer.from('old'))
  db.replaceCollection.mockImplementationOnce(() => { throw new Error('Disk full') })
  await expect(store.updateHostKey('server', 22, Buffer.from('new'))).rejects.toThrow()
  expect(store.getFingerprint('server', 22)).toBe(original)
  db.replaceCollection.mockImplementationOnce(() => { throw new Error('Disk full') })
  await expect(store.remove('server', 22)).rejects.toThrow()
  expect(store.verifySync('server', 22, Buffer.from('old')).accepted).toBe(true)
})

it('keeps concurrent updates to different hosts', async () => {
  const store = new KnownHostsStore()
  await Promise.all([store.updateHostKey('a', 22, Buffer.from('a')), store.updateHostKey('b', 22, Buffer.from('b'))])
  expect((await store.list()).map((row) => row.host)).toEqual(['a', 'b'])
  expect(db.replaceCollection.mock.calls.at(-1)?.[1]).toHaveLength(2)
})
