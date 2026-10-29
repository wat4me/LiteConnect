import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { readWindowLaunchParams, useAppWindowRouting } from './useAppWindowRouting'
import { useAppNavigation } from './useAppNavigation'

afterEach(() => vi.unstubAllGlobals())

describe('app window routing', () => {
  it('recognizes detached and database launch parameters', () => {
    expect(readWindowLaunchParams('?detached=1&connectionId=host-1&mode=db')).toEqual({
      detached: true, connectionId: 'host-1', mode: 'db',
    })
  })

  it.each(['ssh', 'ai', 'database'] as const)('switches the main-window DB menu in place from %s despite a saved new-window preference', async mode => {
    const openDatabaseWindow = vi.fn()
    const getAllSettings = vi.fn(async () => ({ dbOpenMode: 'newWindow' }))
    vi.stubGlobal('window', { LiteConnect: { openDatabaseWindow, getAllSettings } })
    const nav = useAppNavigation({ onSelectHome: vi.fn() })
    if (mode === 'ai') nav.enterAi()
    if (mode === 'database') nav.enterDatabase()
    const routing = useAppWindowRouting({ ...nav, search: '' })
    await routing.handleEnterDatabaseModule()
    expect(nav.appMode.value).toBe('database')
    expect(nav.databaseMounted.value).toBe(true)
    expect(getAllSettings).not.toHaveBeenCalled()
    expect(openDatabaseWindow).not.toHaveBeenCalled()
  })

  it.each(['ssh', 'database', 'ai'] as const)('honors cancellation of unsaved settings before switching the %s menu', async mode => {
    const nav = useAppNavigation({ onSelectHome: vi.fn() })
    nav.openSettingsPage()
    nav.settingsViewRef.value = { requestClose: vi.fn() }
    const routing = useAppWindowRouting({ ...nav, search: '' })
    const handlers = { ssh: routing.handleEnterSshModule, database: routing.handleEnterDatabaseModule, ai: routing.handleEnterAiModule }
    await handlers[mode]()
    expect(nav.showSettingsPage.value).toBe(true)
    expect(nav.appMode.value).toBe('ssh')
    expect(nav.databaseMounted.value).toBe(false)
    nav.settingsViewRef.value = { requestClose: () => nav.closeSettingsPage() }
    await handlers[mode]()
    expect(nav.showSettingsPage.value).toBe(false)
    expect(nav.appMode.value).toBe(mode)
  })

  it('preserves the active terminal when reselecting SSH through the title menu', async () => {
    const home = vi.fn(), nav = useAppNavigation({ onSelectHome: home })
    const routing = useAppWindowRouting({ ...nav, search: '' })
    await routing.handleEnterAiModule()
    await routing.handleEnterSshModule()
    await routing.handleEnterSshModule()
    expect(nav.appMode.value).toBe('ssh')
    expect(home).not.toHaveBeenCalled()
  })

  it('preserves detached-window preferences and redirects SSH entry from a dedicated DB window', async () => {
    const openDatabaseWindow = vi.fn()
    const focusMainWindow = vi.fn()
    const getAllSettings = vi.fn(async () => ({ dbOpenMode: 'currentWindow' }))
    vi.stubGlobal('window', { LiteConnect: { openDatabaseWindow, focusMainWindow, getAllSettings } })
    const enterDatabase = vi.fn()
    const selectModule = vi.fn(async () => {})

    const main = useAppWindowRouting({ appMode: ref('ssh'), enterDatabase, selectModule, search: '?detached=1&connectionId=host-1' })
    await main.handleEnterDatabaseModule()
    expect(selectModule).toHaveBeenCalledWith('database')
    expect(openDatabaseWindow).not.toHaveBeenCalled()

    getAllSettings.mockResolvedValueOnce({ dbOpenMode: 'newWindow' })
    await main.handleEnterDatabaseModule()
    expect(openDatabaseWindow).toHaveBeenCalledTimes(1)

    const db = useAppWindowRouting({ appMode: ref('database'), enterDatabase, selectModule, search: '?mode=db' })
    selectModule.mockClear()
    await db.handleEnterDatabaseModule()
    expect(selectModule).toHaveBeenCalledWith('database')
    expect(openDatabaseWindow).toHaveBeenCalledTimes(1)
    await db.handleEnterSshModule()
    expect(focusMainWindow).toHaveBeenCalledTimes(1)
  })
})
