import { beforeEach, expect, it, vi } from 'vitest'
import type { SettingsStore } from '../../store/settingsStore'
import type { CredentialStore } from '../../store/credentialStore'

const mocks = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => any>(), send: vi.fn(), otherSend: vi.fn(), destroyedSend: vi.fn() }))
vi.mock('electron', () => ({
  app: {}, shell: {},
  ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => mocks.handlers.set(name, handler) },
  BrowserWindow: { getAllWindows: () => [
    { isDestroyed: () => false, webContents: { id: 1, send: mocks.send } },
    { isDestroyed: () => false, webContents: { id: 2, send: mocks.otherSend } },
    { isDestroyed: () => true, webContents: { send: mocks.destroyedSend } },
  ] },
}))
vi.mock('./appearance', () => ({ registerAppearanceSettingsHandlers: vi.fn() }))
vi.mock('./database', () => ({ registerDatabaseSettingsHandlers: vi.fn() }))
vi.mock('./terminal', () => ({ registerTerminalSettingsHandlers: vi.fn() }))
vi.mock('./x11', () => ({ registerX11SettingsHandlers: vi.fn() }))
import { registerSettingsHandlers } from '../registerSettingsHandlers'

const refresh = vi.fn()
let values: Record<string, any>
let applyMany: ReturnType<typeof vi.fn>
beforeEach(() => {
  mocks.handlers.clear(); vi.clearAllMocks()
  values = { locale: 'zh-CN', monitorEnabled: true, monitorIntervalMs: 5000, autoReconnectEnabled: true, autoReconnectMaxRetries: 5 }
  applyMany = vi.fn(async patch => { Object.assign(values, patch); return values })
  const store = {
    initMigrations: async () => {}, applyMany, getAll: () => values,
    getLocale: () => values.locale, getMonitorEnabled: () => values.monitorEnabled,
    getMonitorIntervalMs: () => values.monitorIntervalMs,
    getAutoReconnectEnabled: () => values.autoReconnectEnabled,
    getAutoReconnectMaxRetries: () => values.autoReconnectMaxRetries,
    setMonitorIntervalMs: async (value: number) => { values.monitorIntervalMs = value },
    setAutoReconnectEnabled: async (value: boolean) => { values.autoReconnectEnabled = value },
    setAutoReconnectMaxRetries: async (value: number) => { values.autoReconnectMaxRetries = value },
  } as unknown as SettingsStore
  registerSettingsHandlers({} as CredentialStore, store, async () => {}, async () => {}, async () => [], refresh)
})

it('sends committed display settings to another window and leaves the originating window to apply its save response', async () => {
  await mocks.handlers.get('settings:setMany')!({ sender: { id: 1 } }, { terminalFontSize: 18, dbFontSize: 16, sftpFontSize: 15 })
  expect(mocks.send).not.toHaveBeenCalled()
  expect(mocks.otherSend).toHaveBeenCalledWith('settings:changed', expect.objectContaining({
    settings: expect.objectContaining({ terminalFontSize: 18, dbFontSize: 16, sftpFontSize: 15 }),
    changed: ['terminalFontSize', 'dbFontSize', 'sftpFontSize'],
  }))
})

it('applies live changes only after persistence, and broadcasts no unrelated settings', async () => {
  await mocks.handlers.get('settings:setMany')!({}, { monitorEnabled: false, monitorIntervalMs: 2000, autoReconnectEnabled: false, secret: 'not-broadcast' })
  expect(refresh).toHaveBeenCalledExactlyOnceWith(2000)
  expect(mocks.send).toHaveBeenCalledWith('settings:runtimeChanged', { monitorEnabled: false, autoReconnectEnabled: false, autoReconnectMaxRetries: 5 })
  expect(mocks.destroyedSend).not.toHaveBeenCalled()
  expect(mocks.send).toHaveBeenCalledWith('settings:changed', expect.objectContaining({ changed: expect.arrayContaining(['monitorEnabled', 'monitorIntervalMs']) }))
  await mocks.handlers.get('settings:setMany')!({}, { monitorEnabled: false })
  expect(refresh).toHaveBeenCalledOnce()
})

it('updates running tasks for the individual settings endpoints too', async () => {
  await mocks.handlers.get('settings:setMonitorIntervalMs')!({}, 3000)
  expect(refresh).toHaveBeenCalledExactlyOnceWith(3000)
  await mocks.handlers.get('settings:setAutoReconnectEnabled')!({}, false)
  await mocks.handlers.get('settings:setAutoReconnectMaxRetries')!({}, 2)
  expect(mocks.send).toHaveBeenCalledWith('settings:runtimeChanged', { monitorEnabled: true, autoReconnectEnabled: false, autoReconnectMaxRetries: 2 })
})

it('does not change runtime behavior when saving fails, and removes obsolete autofill endpoints', async () => {
  applyMany.mockRejectedValueOnce(new Error('storage failed'))
  await expect(mocks.handlers.get('settings:setMany')!({}, { monitorEnabled: false, monitorIntervalMs: 2000 })).rejects.toThrow('storage failed')
  expect(refresh).not.toHaveBeenCalled()
  expect(mocks.send).not.toHaveBeenCalled()
  expect(mocks.handlers.has('settings:getCredentialAutoFillEnabled')).toBe(false)
  expect(mocks.handlers.has('settings:setCredentialAutoFillEnabled')).toBe(false)
})
