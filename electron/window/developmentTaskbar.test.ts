import { beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'path'

const mocks = vi.hoisted(() => ({ packaged: false, icon: 'icon.ico' as string | undefined, read: vi.fn(), write: vi.fn(), mkdir: vi.fn(), unlink: vi.fn() }))
vi.mock('electron', () => ({
  app: { get isPackaged() { return mocks.packaged }, getAppPath: () => 'D:/project', getPath: () => 'C:/profile' },
  shell: { readShortcutLink: mocks.read, writeShortcutLink: mocks.write },
}))
vi.mock('fs', () => ({ mkdirSync: mocks.mkdir, unlinkSync: mocks.unlink }))
vi.mock('./appIcon', () => ({ resolveAppIcon: () => mocks.icon, windowAppId: () => 'com.liteconnect.app.dev' }))
import { registerDevelopmentTaskbarShortcut } from './developmentTaskbar'

const legacyPath = join('C:/profile', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Electron.lnk')
const legacy = { target: join('D:/project', 'node_modules', 'electron', 'dist', 'electron.exe'), appUserModelId: 'com.liteconnect.app.dev' }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.packaged = false
  mocks.icon = 'icon.ico'
  mocks.read.mockImplementation(() => { throw new Error('missing') })
  mocks.write.mockReturnValue(true)
})

describe('development taskbar identity', () => {
  it('registers matching icon, AppID and project launch arguments', () => {
    const shortcut = registerDevelopmentTaskbarShortcut('win32')
    expect(mocks.write).toHaveBeenCalledWith(shortcut, 'create', expect.objectContaining({
      target: process.execPath, args: '"D:/project"', cwd: 'D:/project', icon: mocks.icon,
      iconIndex: 0, appUserModelId: 'com.liteconnect.app.dev',
    }))
  })
  it('removes our conflicting Electron shortcut only after the replacement succeeds', () => {
    mocks.read.mockImplementation(path => { if (path === legacyPath) return legacy; throw new Error('missing') })
    registerDevelopmentTaskbarShortcut('win32')
    expect(mocks.unlink).toHaveBeenCalledWith(legacyPath)
    expect(mocks.write.mock.invocationCallOrder[0]).toBeLessThan(mocks.unlink.mock.invocationCallOrder[0])
  })
  it.each([
    { ...legacy, appUserModelId: 'another.app' },
    { ...legacy, target: join('D:/another-project', 'node_modules', 'electron.exe') },
    { ...legacy, target: join('D:/project', 'node_modules-other', 'electron.exe') },
  ])('preserves unrelated Electron shortcuts: %s', shortcut => {
    mocks.read.mockImplementation(path => { if (path === legacyPath) return shortcut; throw new Error('missing') })
    registerDevelopmentTaskbarShortcut('win32')
    expect(mocks.unlink).not.toHaveBeenCalled()
  })
  it('does not rewrite a shortcut already registered correctly', () => {
    registerDevelopmentTaskbarShortcut('win32')
    const details = mocks.write.mock.calls[0][2]
    mocks.read.mockImplementation(path => { if (path !== legacyPath) return details; throw new Error('missing') })
    mocks.write.mockClear()
    registerDevelopmentTaskbarShortcut('win32')
    expect(mocks.write).not.toHaveBeenCalled()
  })
  it('updates a shortcut after the development runtime changes', () => {
    mocks.read.mockReturnValue({ target: 'old.exe' })
    registerDevelopmentTaskbarShortcut('win32')
    expect(mocks.write).toHaveBeenCalledOnce()
  })
  it('leaves installed builds and other platforms unchanged', () => {
    expect(registerDevelopmentTaskbarShortcut('linux')).toBeNull()
    mocks.packaged = true
    expect(registerDevelopmentTaskbarShortcut('win32')).toBeNull()
    expect(mocks.write).not.toHaveBeenCalled()
  })
  it('preserves the old shortcut if replacement fails', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.write.mockReturnValue(false)
    expect(registerDevelopmentTaskbarShortcut('win32')).toBeNull()
    expect(mocks.unlink).not.toHaveBeenCalled()
    warning.mockRestore()
  })
})
