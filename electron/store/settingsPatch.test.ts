import { describe, expect, it } from 'vitest'
import { applySettingsPatch } from './settingsPatch'
import { defaultWorkspaceLayout } from '../../shared/workspaceLayout'

function current(settings: Record<string, any>) {
  return {
    connectionUsageStatsEnabled: () => settings.connectionUsageStatsEnabled !== false,
    appBackground: () => ({ fileName: 'existing.png', fit: 'cover' as const, overlay: 55 }),
  }
}

describe('applySettingsPatch', () => {
  it('normalizes layout settings at the persistence boundary and leaves them untouched by unrelated saves', () => {
    const settings: Record<string, unknown> = {}
    applySettingsPatch(settings, { sshWorkspaceLayout: { version: 1, tools: [{ id: 'ai', edge: 'right', panelEdge: 'right' }], sizes: { left: NaN }, locked: true } as unknown as ReturnType<typeof defaultWorkspaceLayout> }, current(settings))
    expect(settings.sshWorkspaceLayout).toMatchObject({ version: 1, locked: true, sizes: { left: 360 } })
    const saved = structuredClone(settings.sshWorkspaceLayout)
    applySettingsPatch(settings, { theme: 'light' }, current(settings))
    expect(settings.sshWorkspaceLayout).toEqual(saved)
  })
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

  it('accepts only supported interface locales', () => {
    const settings: Record<string, any> = { locale: 'zh-CN' }
    applySettingsPatch(settings, { locale: 'en-US' }, current(settings))
    expect(settings.locale).toBe('en-US')
    applySettingsPatch(settings, { locale: 'fr-FR' as 'en-US' }, current(settings))
    expect(settings.locale).toBe('en-US')
  })

  it('persists the optional terminal local echo switch', () => {
    const settings: Record<string, any> = {}
    applySettingsPatch(settings, { terminalLocalEchoEnabled: true }, current(settings))
    expect(settings.terminalLocalEchoEnabled).toBe(true)
    applySettingsPatch(settings, { terminalLocalEchoEnabled: false }, current(settings))
    expect(settings.terminalLocalEchoEnabled).toBe(false)
  })

  it('keeps the SFTP font size within the supported range', () => {
    const settings: Record<string, any> = {}
    applySettingsPatch(settings, { sftpFontSize: 18.6 }, current(settings))
    expect(settings.sftpFontSize).toBe(19)
    applySettingsPatch(settings, { sftpFontSize: 99 }, current(settings))
    expect(settings.sftpFontSize).toBe(24)
    applySettingsPatch(settings, { sftpFontSize: 1 }, current(settings))
    expect(settings.sftpFontSize).toBe(10)
  })
})
