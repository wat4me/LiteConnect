import { beforeEach, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { registerUpdaterHandlers } from './registerUpdaterHandlers'
import type { SettingsStore } from '../store/settingsStore'
const mocks = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => any>(), updater: null as any }))
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, fn: (...args: any[]) => any) => mocks.handlers.set(name, fn) } }))
vi.mock('electron-updater', () => ({ get autoUpdater() { return mocks.updater } }))
vi.mock('../utils/validation', () => ({ safeSend: vi.fn() }))
const invoke = (name: string) => mocks.handlers.get(`updater:${name}`)!()
beforeEach(() => {
  mocks.handlers.clear()
  mocks.updater = Object.assign(new EventEmitter(), {
    downloadUpdate: vi.fn(), quitAndInstall: vi.fn(),
    checkForUpdates: vi.fn(async () => {
      mocks.updater.emit('checking-for-update')
      mocks.updater.emit('update-available', { version: '9.0.0' })
      return { updateInfo: { version: '9.0.0' } }
    }),
  })
  registerUpdaterHandlers(() => null, { init: async () => {}, getAutoUpdateEnabled: () => false, getSkippedUpdateVersion: () => '' } as unknown as SettingsStore)
})
it('starts downloading before progress and restores completion for a reopened page', async () => {
  let complete!: () => void
  mocks.updater.downloadUpdate.mockImplementation(() => new Promise<void>(resolve => { complete = resolve }))
  await invoke('check')
  expect(invoke('status')).toMatchObject({ status: 'downloading', progress: 0, version: '9.0.0' })
  expect(mocks.updater.downloadUpdate).toHaveBeenCalledTimes(1)
  await invoke('check')
  expect(mocks.updater.checkForUpdates).toHaveBeenCalledTimes(1)
  const retry = invoke('download')
  mocks.updater.emit('update-downloaded', { version: '9.0.0' })
  complete()
  await retry
  expect(invoke('status')).toMatchObject({ status: 'downloaded', version: '9.0.0' })
  expect(mocks.updater.downloadUpdate).toHaveBeenCalledTimes(1)
  await invoke('install')
  expect(mocks.updater.quitAndInstall).toHaveBeenCalledOnce()
})
it('retains download errors and lets the user retry', async () => {
  mocks.updater.downloadUpdate.mockRejectedValueOnce(new Error('network failed'))
  await invoke('check')
  await vi.waitFor(() => expect(invoke('status')).toMatchObject({ status: 'error', message: 'network failed', version: '9.0.0' }))
  await expect(invoke('install')).rejects.toThrow('not downloaded')
  mocks.updater.downloadUpdate.mockImplementationOnce(async () => { mocks.updater.emit('update-downloaded', { version: '9.0.0' }) })
  expect(await invoke('download')).toEqual({ ok: true })
  expect(invoke('status').status).toBe('downloaded')
})
