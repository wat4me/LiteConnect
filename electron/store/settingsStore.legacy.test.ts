import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ values: { credentialAutoFillEnabled: true, theme: 'light', dbOpenMode: 'newWindow' }, save: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: () => '/unused' }, safeStorage: { isEncryptionAvailable: () => false } }))
vi.mock('./appDatabase', () => ({ SINGLETONS: { settings: 'settings' }, getAppDatabase: () => ({ getSingleton: () => structuredClone(mocks.values), setSingleton: mocks.save }) }))
import { SettingsStore } from './settingsStore'
beforeEach(() => vi.clearAllMocks())

it('removes only the obsolete autofill preference and migrates once', async () => {
  const store = new SettingsStore()
  await store.initMigrations()
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith('settings', { theme: 'light', dbOpenMode: 'newWindow' })
  expect(store.getTheme()).toBe('light')
  expect(store.getDbOpenMode()).toBe('newWindow')
  await store.initMigrations()
  expect(mocks.save).toHaveBeenCalledOnce()
})

it('keeps the previous in-memory settings when SQLite commit fails', async () => {
  const store = new SettingsStore()
  await store.init()
  mocks.save.mockImplementationOnce(() => { throw new Error('disk full') })
  await expect(store.applyMany({ theme: 'dark', appBackground: { fileName: 'wallpaper-0123456789abcdef0123456789abcdef.png' } })).rejects.toThrow('disk full')
  expect(store.getTheme()).toBe('light')
  expect(store.getAppBackground().fileName).toBe('')
  await store.applyMany({ theme: 'dark' })
  expect(store.getTheme()).toBe('dark')
})
