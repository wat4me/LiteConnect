import { mkdtemp, rm } from 'fs/promises'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isPackaged: false,
  normalPath: 'C:\\Users\\test\\AppData\\Roaming\\lite-connect',
  setPath: vi.fn(),
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() { return mocks.isPackaged },
    getPath: () => mocks.normalPath,
    setPath: mocks.setPath,
  },
}))

const originalValue = process.env.LITECONNECT_DEV_USER_DATA_DIR
const temporaryPaths: string[] = []

beforeEach(() => {
  mocks.isPackaged = false
  mocks.setPath.mockClear()
  delete process.env.LITECONNECT_DEV_USER_DATA_DIR
})

afterEach(async () => {
  if (originalValue === undefined) delete process.env.LITECONNECT_DEV_USER_DATA_DIR
  else process.env.LITECONNECT_DEV_USER_DATA_DIR = originalValue
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

it('uses and creates the configured isolated directory in development', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'liteconnect-dev-data-'))
  temporaryPaths.push(parent)
  const target = join(parent, 'profile')
  process.env.LITECONNECT_DEV_USER_DATA_DIR = target

  const { configureDevelopmentUserDataPath } = await import('./developmentUserData')
  expect(configureDevelopmentUserDataPath()).toBe(resolve(target))
  expect(mocks.setPath).toHaveBeenCalledWith('userData', resolve(target))
})

it('does nothing when the switch is unset', async () => {
  const { configureDevelopmentUserDataPath } = await import('./developmentUserData')
  expect(configureDevelopmentUserDataPath()).toBeNull()
  expect(mocks.setPath).not.toHaveBeenCalled()
})

it('ignores the switch in packaged builds', async () => {
  mocks.isPackaged = true
  process.env.LITECONNECT_DEV_USER_DATA_DIR = join(tmpdir(), 'must-not-be-used')
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})

  const { configureDevelopmentUserDataPath } = await import('./developmentUserData')
  expect(configureDevelopmentUserDataPath()).toBeNull()
  expect(mocks.setPath).not.toHaveBeenCalled()
  warning.mockRestore()
})

it('rejects the normal application data directory', async () => {
  process.env.LITECONNECT_DEV_USER_DATA_DIR = mocks.normalPath
  const { configureDevelopmentUserDataPath } = await import('./developmentUserData')
  expect(() => configureDevelopmentUserDataPath()).toThrow('must not point to the normal LiteConnect data directory')
  expect(mocks.setPath).not.toHaveBeenCalled()
})
