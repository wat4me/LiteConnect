import { afterEach, expect, it, vi } from 'vitest'
import { dispatchDbSettingsChange, getCachedDbSettings, loadDbSettings } from './useDbSettings'
afterEach(() => vi.unstubAllGlobals())

it('does not replace a remote settings notification with an older in-flight read', async () => {
  let finish!: (value: number) => void
  vi.stubGlobal('window', { dispatchEvent: vi.fn(), LiteConnect: {
    getDbFontSize: () => new Promise<number>(resolve => { finish = resolve }),
    getDbFontFamily: async () => 'monospace', getDbPageSize: async () => 100, getDbConfirmDangerousSql: async () => true,
    getDbDefaultMaxRows: async () => 1000, getDbDefaultQueryTimeoutSec: async () => 120, getDbDefaultRunScope: async () => 'smart',
  } })
  const pending = loadDbSettings()
  dispatchDbSettingsChange({ ...getCachedDbSettings(), fontSize: 18 })
  finish(13)
  expect((await pending).fontSize).toBe(18)
})
