import { describe, expect, it } from 'vitest'
import { applySettingsPatch } from './settingsPatch'

function current(settings: Record<string, any>) {
  return {
    connectionUsageStatsEnabled: () => settings.connectionUsageStatsEnabled !== false,
    appBackground: () => ({ fileName: 'existing.png', fit: 'cover' as const, overlay: 55 }),
  }
}

describe('applySettingsPatch', () => {
  it('normalizes a bulk patch while preserving fields not in the patch', () => {
    const settings = { theme: 'dark', terminalScrollback: 5000, appBackground: { fileName: 'existing.png' } }
    applySettingsPatch(settings, {
      terminalScrollback: 99999,
      appBackground: { overlay: 200 },
    }, current(settings))

    expect(settings.theme).toBe('dark')
    expect(settings.terminalScrollback).toBe(20000)
    expect(settings.appBackground).toEqual({ fileName: 'existing.png', fit: 'cover', overlay: 90 })
  })

  it('drops stale workspace tabs and manualizes sorting when the related features are disabled', () => {
    const settings: Record<string, any> = {
      workspaceRestoreEnabled: true,
      workspaceTabs: { stale: true },
      connectionUsageStatsEnabled: true,
      connectionSortMode: 'recent',
    }
    applySettingsPatch(settings, {
      workspaceRestoreEnabled: false,
      connectionUsageStatsEnabled: false,
    }, current(settings))

    expect(settings.workspaceTabs).toBeUndefined()
    expect(settings.connectionSortMode).toBe('manual')
  })
})
