import { mkdtemp, mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { expect, it, vi } from 'vitest'
import { closeAppDatabase, getAppDatabase, initializeAppDatabase } from './appDatabase'

const mocks = vi.hoisted(() => ({ readdir: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: () => '' } }))
vi.mock('fs/promises', async original => ({ ...await original<typeof import('fs/promises')>(), readdir: mocks.readdir }))

it('cannot publish an initialized database after shutdown closed storage during migration', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'liteconnect-quit-migration-'))
  await mkdir(join(directory, 'ai-history'))
  let finish!: () => void
  mocks.readdir.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve([]) }))
  const initializing = initializeAppDatabase(directory)
  const rejected = expect(initializing).rejects.toThrow('closed during initialization')
  await vi.waitFor(() => expect(mocks.readdir).toHaveBeenCalledOnce())
  closeAppDatabase()
  finish(); await rejected
  expect(() => getAppDatabase()).toThrow('not been initialized')
  // The migration connection was closed, so reopening the same file is possible.
  const next = await initializeAppDatabase(directory)
  expect(next.isOpen).toBe(true)
  closeAppDatabase()
  expect(next.isOpen).toBe(false)
  next.close()
})
