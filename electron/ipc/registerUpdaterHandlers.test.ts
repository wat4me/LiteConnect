import { beforeEach, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { registerUpdaterHandlers, userFacingUpdaterError } from './registerUpdaterHandlers'
import type { SettingsStore } from '../store/settingsStore'
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  updater: null as any,
  tokens: [] as any[],
}))
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, fn: (...args: any[]) => any) => mocks.handlers.set(name, fn) } }))
vi.mock('electron-updater', () => ({ get autoUpdater() { return mocks.updater } }))
vi.mock('../utils/validation', () => ({ safeSend: vi.fn() }))
const invoke = (name: string) => mocks.handlers.get(`updater:${name}`)!()
/**
 * electron-updater 的取消令牌是一次性的：cancel() 之后 cancelled 永远为 true。
 * 主进程靠这个属性决定重试前要不要重新检查换新令牌。
 */
function createToken() {
  const token: any = { cancelled: false, cancel: vi.fn() }
  token.cancel.mockImplementation(() => { token.cancelled = true })
  return token
}
/** 让主进程里下载 promise 的 catch/finally 链跑完，内部 download 才会复位。 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
beforeEach(() => {
  mocks.handlers.clear()
  mocks.tokens = []
  mocks.updater = Object.assign(new EventEmitter(), {
    downloadUpdate: vi.fn(), quitAndInstall: vi.fn(),
    checkForUpdates: vi.fn(async () => {
      mocks.updater.emit('checking-for-update')
      mocks.updater.emit('update-available', { version: '9.0.0' })
      const cancellationToken = createToken()
      mocks.tokens.push(cancellationToken)
      return { isUpdateAvailable: true, updateInfo: { version: '9.0.0' }, cancellationToken }
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
  await vi.waitFor(() => expect(invoke('status')).toMatchObject({
    status: 'error',
    message: '无法连接 GitHub Releases，请检查网络后重试',
    version: '9.0.0',
  }))
  await expect(invoke('install')).rejects.toThrow('not downloaded')
  mocks.updater.downloadUpdate.mockImplementationOnce(async () => { mocks.updater.emit('update-downloaded', { version: '9.0.0' }) })
  expect(await invoke('download')).toEqual({ ok: true })
  expect(invoke('status').status).toBe('downloaded')
})
it('cancels an in-flight download without surfacing it as a failure', async () => {
  let rejectDownload!: (err: unknown) => void
  mocks.updater.downloadUpdate.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectDownload = reject }))
  await invoke('check')
  expect(invoke('status')).toMatchObject({ status: 'downloading', version: '9.0.0' })
  expect(await invoke('cancel-download')).toEqual({ ok: true })
  expect(invoke('status')).toMatchObject({ status: 'cancelled', version: '9.0.0' })
  expect(mocks.tokens[0].cancelled).toBe(true)
  // 取消触发的请求中断与在途进度都不能把「已取消」改写回失败或下载中。
  mocks.updater.emit('error', new Error('cancelled'))
  mocks.updater.emit('download-progress', { percent: 42 })
  expect(invoke('status').status).toBe('cancelled')
  rejectDownload(new Error('cancelled'))
  await settle()
  expect(invoke('status').status).toBe('cancelled')
})
it('refuses to cancel when nothing is downloading', async () => {
  expect(await invoke('cancel-download')).toEqual({ ok: false })
  await invoke('check')
  mocks.updater.emit('update-downloaded', { version: '9.0.0' })
  expect(await invoke('cancel-download')).toEqual({ ok: false })
})
it('exchanges the spent token for a fresh one before retrying after a cancel', async () => {
  let rejectDownload!: (err: unknown) => void
  mocks.updater.downloadUpdate.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectDownload = reject }))
  await invoke('check')
  await invoke('cancel-download')
  rejectDownload(new Error('cancelled'))
  await settle()
  expect(mocks.updater.checkForUpdates).toHaveBeenCalledTimes(1)
  expect(await invoke('download')).toEqual({ ok: true })
  // 旧令牌已作废，重试必须先重新检查换一枚新令牌。
  expect(mocks.updater.checkForUpdates).toHaveBeenCalledTimes(2)
  expect(mocks.tokens).toHaveLength(2)
  expect(mocks.updater.downloadUpdate).toHaveBeenLastCalledWith(mocks.tokens[1])
})

it('hides release URLs, response details and local paths from update errors', () => {
  const raw = new Error(
    'Cannot find latest.yml in the latest release artifacts '
      + '(https://github.com/wat4me/LiteConnect/releases/download/v1.0.0/latest.yml): '
      + 'HttpError: 404 at D:\\software\\LiteConnect\\resources\\app.asar\\main.js:1:1',
  )
  const message = userFacingUpdaterError(raw, 'check')
  expect(message).toBe('新版本仍在发布中，请稍后重试')
  expect(message).not.toContain('github.com')
  expect(message).not.toContain('D:\\software')
  expect(message).not.toContain('404')
})

it('returns a generic retry message instead of unknown updater internals', async () => {
  mocks.updater.checkForUpdates.mockRejectedValueOnce(
    new Error('unexpected failure at C:\\Users\\private-name\\AppData\\app.asar'),
  )
  expect(await invoke('check')).toEqual({ ok: false, error: '检查更新失败，请稍后重试' })
})
