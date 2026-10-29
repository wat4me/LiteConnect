import { expect, it, vi } from 'vitest'
import { useAppNavigation } from './useAppNavigation'

it('switches in place, mounts each workspace once and restores SSH without selecting home', async () => {
  const home = vi.fn(), nav = useAppNavigation({ onSelectHome: home })
  nav.ensureSshWorkspaceMounted()
  await nav.selectModule('database')
  expect(nav.appMode.value).toBe('database')
  expect(nav.databaseMounted.value).toBe(true)
  await nav.selectModule('ai')
  expect(nav.aiWorkspaceMounted.value).toBe(true)
  expect(nav.databaseMounted.value).toBe(true)
  await nav.selectModule('ssh')
  await nav.selectModule('ssh')
  expect(nav.sshWorkspaceMounted.value).toBe(true)
  expect(home).not.toHaveBeenCalled()
})

it('keeps unsaved settings open when closing was cancelled', async () => {
  const nav = useAppNavigation({ onSelectHome: vi.fn() })
  nav.openSettingsPage()
  const requestClose = vi.fn()
  nav.settingsViewRef.value = { requestClose }
  await nav.selectModule('database')
  expect(requestClose).toHaveBeenCalledOnce()
  expect(nav.showSettingsPage.value).toBe(true)
  expect(nav.appMode.value).toBe('ssh')
  expect(nav.databaseMounted.value).toBe(false)
  expect(nav.moduleSwitching.value).toBe(false)
})

it('returns from settings to the current SSH view without resetting its active session', async () => {
  const home = vi.fn(), nav = useAppNavigation({ onSelectHome: home })
  nav.openSettingsPage()
  nav.settingsViewRef.value = { requestClose: () => nav.closeSettingsPage() }
  await nav.selectModule('ssh')
  expect(nav.showSettingsPage.value).toBe(false)
  expect(home).not.toHaveBeenCalled()
})

it('ignores repeated navigation while a settings close decision is pending', async () => {
  const nav = useAppNavigation({ onSelectHome: vi.fn() })
  nav.openSettingsPage()
  let close!: () => void
  nav.settingsViewRef.value = { requestClose: () => new Promise<void>(resolve => { close = () => { nav.closeSettingsPage(); resolve() } }) }
  const pending = nav.selectModule('ai')
  await nav.selectModule('database')
  expect(nav.moduleSwitching.value).toBe(true)
  close(); await pending
  expect(nav.appMode.value).toBe('ai')
  expect(nav.databaseMounted.value).toBe(false)
  expect(nav.moduleSwitching.value).toBe(false)
})

it('clears the busy state if the settings close handler fails', async () => {
  const nav = useAppNavigation({ onSelectHome: vi.fn() })
  nav.openSettingsPage()
  nav.settingsViewRef.value = { requestClose: () => Promise.reject(new Error('close failed')) }
  await expect(nav.selectModule('ai')).rejects.toThrow('close failed')
  expect(nav.moduleSwitching.value).toBe(false)
  expect(nav.appMode.value).toBe('ssh')
})

it.each(['ssh', 'ai', 'database'] as const)('blocks global jump/notification side effects when leaving settings for %s is cancelled', async mode => {
  const nav = useAppNavigation({ onSelectHome: vi.fn() }), action = vi.fn()
  nav.openSettingsPage()
  nav.settingsViewRef.value = { requestClose: () => {} }
  expect(await nav.requestModuleAction(mode, action)).toBe(false)
  expect(action).not.toHaveBeenCalled()
  nav.settingsViewRef.value = { requestClose: () => nav.closeSettingsPage() }
  expect(await nav.requestModuleAction(mode, action)).toBe(true)
  expect(action).toHaveBeenCalledOnce()
})

it('does not start a second global navigation action while a leave decision is pending', async () => {
  const nav = useAppNavigation({ onSelectHome: vi.fn() }), action = vi.fn()
  nav.openSettingsPage()
  let finish!: () => void
  nav.settingsViewRef.value = { requestClose: () => new Promise<void>(resolve => { finish = () => { nav.closeSettingsPage(); resolve() } }) }
  const pending = nav.requestModuleAction('ai', action)
  expect(await nav.requestModuleAction('ssh', action)).toBe(false)
  finish(); await pending
  expect(action).toHaveBeenCalledOnce()
})
