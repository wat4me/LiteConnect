import { beforeEach, expect, it, vi } from 'vitest'
import { registerX11SettingsHandlers } from './x11'
import type { SettingsIpcCtx } from './ctx'

const mocks = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => any>(), ensure: vi.fn(), open: vi.fn() }))
vi.mock('electron', () => ({
  app: { isPackaged: false },
  ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => mocks.handlers.set(name, handler) },
  shell: { openExternal: mocks.open },
}))
vi.mock('../../ssh/x11/x11Server', () => ({ configureX11ServerOptions: vi.fn(), testX11ServerReady: vi.fn() }))
vi.mock('../../ssh/x11/automaticX11', () => ({ ensureAutomaticLocalX11: mocks.ensure }))

beforeEach(() => {
  mocks.handlers.clear(); vi.clearAllMocks()
  registerX11SettingsHandlers({
    ensureSettingsStoreReady: async () => {},
    settingsStore: { getX11AutoStartEnabled: () => false, getX11ServerPath: () => '' },
  } as unknown as SettingsIpcCtx)
})

it('returns Unix display diagnostics without exposing authority cookies or the process environment', async () => {
  const secret = Buffer.alloc(16, 42)
  mocks.ensure.mockResolvedValue({
    endpoint: { path: '/tmp/.X11-unix/X1' }, display: 1, screen: 0,
    displayAddress: ':1', localCookie: secret, started: false,
  })
  const result = await mocks.handlers.get('settings:testX11Server')!({}, { automatic: true })
  expect(result).toEqual({ ready: true, started: false, display: 1, displayAddress: ':1', host: '', port: 0, executablePath: undefined })
  expect(result).not.toHaveProperty('localCookie')
  expect(result).not.toHaveProperty('endpoint')
  expect(mocks.ensure).toHaveBeenCalledWith({ force: true, executablePath: '' })
})

it('keeps the authenticated TCP display diagnostics for Windows', async () => {
  mocks.ensure.mockResolvedValue({ endpoint: { host: '127.0.0.1', port: 6050 }, display: 50, displayAddress: '127.0.0.1:6050', localCookie: Buffer.alloc(16), started: false })
  expect(await mocks.handlers.get('settings:testX11Server')!({}, { automatic: true })).toMatchObject({ ready: true, host: '127.0.0.1', port: 6050, display: 50 })
})

it('reports missing display components without throwing an IPC error', async () => {
  mocks.ensure.mockRejectedValue(new Error('display component missing'))
  expect(await mocks.handlers.get('settings:testX11Server')!({}, { automatic: true })).toMatchObject({ ready: false, message: 'display component missing' })
})

it('opens only the fixed official setup page after an explicit settings action', async () => {
  await mocks.handlers.get('settings:openX11SetupGuide')!({}, 'https://untrusted.invalid')
  expect(mocks.open).toHaveBeenCalledWith('https://www.xquartz.org/')
})
