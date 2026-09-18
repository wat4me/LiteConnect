import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  quit: vi.fn(),
  handlers: new Map<string, (...args: any[]) => any>(),
  downloads: null as { version: string; progress: number } | null,
  dialog: vi.fn(async () => ({ response: 0 })),
  windows: [] as any[],
}))

vi.mock('electron', () => ({
  app: {
    on: (name: string, fn: (...args: any[]) => any) => mocks.handlers.set(name, fn),
    quit: mocks.quit,
  },
  BrowserWindow: {
    getAllWindows: () => mocks.windows,
  },
  dialog: { showMessageBox: mocks.dialog },
}))
vi.mock('../i18n', () => ({ t: (key: string) => key }))
vi.mock('../ipc/registerUpdaterHandlers', () => ({
  getActiveUpdateDownload: () => mocks.downloads,
}))

/** 触发 before-quit 并等待确认框的 promise 链跑完。 */
async function quit() {
  let prevented = false
  mocks.handlers.get('before-quit')!({ preventDefault: () => { prevented = true } })
  await new Promise((resolve) => setTimeout(resolve, 0))
  return prevented
}

/** showMessageBox 有带窗口/不带窗口两种重载，取实际生效的那份 options。 */
function lastOptions() {
  const args = mocks.dialog.mock.calls.at(-1)!
  return (args.length > 1 ? args[1] : args[0]) as any
}

beforeEach(async () => {
  // 模块内的 quitConfirmed 是进程级一次性状态，各用例必须拿到全新模块。
  vi.resetModules()
  mocks.handlers.clear()
  mocks.quit.mockClear()
  mocks.dialog.mockClear()
  mocks.dialog.mockResolvedValue({ response: 0 })
  mocks.downloads = null
  mocks.windows = []
  const { installUpdateGuard } = await import('./updateGuard')
  installUpdateGuard()
})

it('quits without asking when no update is downloading', async () => {
  expect(await quit()).toBe(false)
  expect(mocks.dialog).not.toHaveBeenCalled()
})

it('asks before quitting mid-download and stays on the default choice', async () => {
  // 有窗口时走带窗口重载，确认框挂到窗口上（模态）。
  mocks.windows = [{ isDestroyed: () => false }]
  mocks.downloads = { version: '1.0.15', progress: 42.6 }
  expect(await quit()).toBe(true)
  expect(mocks.dialog).toHaveBeenCalledOnce()
  expect(mocks.dialog.mock.calls[0][0]).toBe(mocks.windows[0])
  const options = lastOptions()
  expect(options.message).toBe('updateGuard.message')
  // 默认按钮是「继续下载」，用户不操作就中止退出。
  expect(options.defaultId).toBe(0)
  expect(options.cancelId).toBe(0)
  expect(mocks.quit).not.toHaveBeenCalled()
})

it('still asks when every window is already closed', async () => {
  mocks.downloads = { version: '1.0.15', progress: 8 }
  expect(await quit()).toBe(true)
  expect(mocks.dialog).toHaveBeenCalledOnce()
  expect(lastOptions().title).toBe('updateGuard.title')
})

it('quits on the second pass so the confirmation is not shown twice', async () => {
  mocks.downloads = { version: '1.0.15', progress: 10 }
  mocks.dialog.mockResolvedValueOnce({ response: 1 })
  await quit()
  expect(mocks.quit).toHaveBeenCalledOnce()
  // 用户确认后仍在下载中的状态不该再被拦一次。
  mocks.quit.mockClear()
  expect(await quit()).toBe(false)
  expect(mocks.quit).not.toHaveBeenCalled()
})

it('re-arms the guard when the user chooses to stay', async () => {
  mocks.downloads = { version: '1.0.15', progress: 10 }
  expect(await quit()).toBe(true)
  // 选择「继续下载」后，下次退出仍应弹框。
  mocks.downloads = { version: '1.0.15', progress: 55 }
  expect(await quit()).toBe(true)
  expect(mocks.dialog).toHaveBeenCalledTimes(2)
})
