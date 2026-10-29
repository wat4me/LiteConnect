import { expect, it, vi } from 'vitest'
import type { CredentialStore } from '../store/credentialStore'
import type { SettingsStore } from '../store/settingsStore'

const mocks = vi.hoisted(() => ({ listener: undefined as undefined | ((...args: any[]) => Promise<void>), overlay: vi.fn(), background: vi.fn() }))
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: (_name: string, listener: typeof mocks.listener) => { mocks.listener = listener } },
  BrowserWindow: { fromWebContents: () => ({ isDestroyed: () => false, setTitleBarOverlay: mocks.overlay, setBackgroundColor: mocks.background }) },
}))
vi.mock('../window/createWindow', () => ({ createWindow: vi.fn(), titleBarThemes: { dark: { color: '#000000', symbolColor: '#ffffff' } } }))
import { registerWindowHandlers } from './registerWindowHandlers'

it('updates the window decoration without overwriting committed theme or custom text colors', async () => {
  const setTheme = vi.fn(), setCustomColors = vi.fn()
  registerWindowHandlers({} as CredentialStore, { setTheme, setCustomColors } as unknown as SettingsStore)
  await mocks.listener!({ sender: {} }, 'custom', { color: '#112233', symbolColor: '#8899aa' })
  expect(mocks.overlay).toHaveBeenCalledWith({ color: '#112233', symbolColor: '#8899aa' })
  expect(setTheme).not.toHaveBeenCalled()
  expect(setCustomColors).not.toHaveBeenCalled()
})
