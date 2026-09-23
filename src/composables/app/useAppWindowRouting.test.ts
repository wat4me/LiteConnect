import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { readWindowLaunchParams, useAppWindowRouting } from './useAppWindowRouting'

afterEach(() => vi.unstubAllGlobals())

describe('app window routing', () => {
  it('recognizes detached and database launch parameters', () => {
    expect(readWindowLaunchParams('?detached=1&connectionId=host-1&mode=db')).toEqual({
      detached: true, connectionId: 'host-1', mode: 'db',
    })
  })

  it('honors the database window setting and redirects SSH entry from a dedicated DB window', async () => {
    const openDatabaseWindow = vi.fn()
    const focusMainWindow = vi.fn()
    const getAllSettings = vi.fn(async () => ({ dbOpenMode: 'currentWindow' }))
    vi.stubGlobal('window', { LiteConnect: { openDatabaseWindow, focusMainWindow, getAllSettings } })
    const enterDatabase = vi.fn()
    const enterSsh = vi.fn()

    const main = useAppWindowRouting({ appMode: ref('ssh'), enterDatabase, enterSsh, search: '' })
    await main.handleEnterDatabaseModule()
    expect(enterDatabase).toHaveBeenCalledTimes(1)
    expect(openDatabaseWindow).not.toHaveBeenCalled()

    getAllSettings.mockResolvedValueOnce({ dbOpenMode: 'newWindow' })
    await main.handleEnterDatabaseModule()
    expect(openDatabaseWindow).toHaveBeenCalledTimes(1)

    const db = useAppWindowRouting({ appMode: ref('database'), enterDatabase, enterSsh, search: '?mode=db' })
    db.handleEnterSshModule(true)
    expect(focusMainWindow).toHaveBeenCalledTimes(1)
    expect(enterSsh).not.toHaveBeenCalled()
  })
})
