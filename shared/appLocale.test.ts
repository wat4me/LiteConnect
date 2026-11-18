import { describe, expect, it } from 'vitest'
import {
  decideLocaleAdoption,
  resolveAppLocale,
  resolveSystemAppLocale,
  sanitizeAppLocale,
  sanitizeLocalePreference,
} from './appLocale'

describe('app locale', () => {
  it('falls back when the stored locale is not supported', () => {
    expect(sanitizeAppLocale('en-US')).toBe('en-US')
    expect(sanitizeAppLocale('zh-CN')).toBe('zh-CN')
    expect(sanitizeAppLocale('fr-FR')).toBe('zh-CN')
    expect(sanitizeAppLocale(null)).toBe('zh-CN')
    expect(sanitizeLocalePreference('system')).toBe('system')
    expect(sanitizeLocalePreference('fr-FR')).toBe('system')
    expect(sanitizeLocalePreference('zh-CN')).toBe('zh-CN')
  })

  it('resolves OS language tags for follow-system mode and defaults unknown/empty to Simplified Chinese', () => {
    expect(resolveSystemAppLocale(['zh-Hans-CN', 'en-US'])).toBe('zh-CN')
    expect(resolveSystemAppLocale(['zh-TW'])).toBe('zh-CN')
    expect(resolveSystemAppLocale('zh_HK')).toBe('zh-CN')
    expect(resolveSystemAppLocale(['en-US', 'zh-CN'])).toBe('en-US')
    expect(resolveSystemAppLocale(['en-GB'])).toBe('en-US')
    expect(resolveSystemAppLocale(['ja-JP'])).toBe('en-US')
    expect(resolveSystemAppLocale(['C', 'POSIX'])).toBe('zh-CN')
    expect(resolveSystemAppLocale([])).toBe('zh-CN')

    expect(resolveAppLocale('system', ['en-US'])).toBe('en-US')
    expect(resolveAppLocale('system', ['zh-CN'])).toBe('zh-CN')
    expect(resolveAppLocale('zh-CN', ['en-US'])).toBe('zh-CN')
    expect(resolveAppLocale('en-US', ['zh-CN'])).toBe('en-US')
    expect(resolveAppLocale(undefined, ['en-US'])).toBe('en-US')
    expect(resolveAppLocale(undefined, [])).toBe('zh-CN')
  })

  it('adopts the legacy renderer preference only before a locale is stored', () => {
    expect(decideLocaleAdoption({
      localeConfigured: false,
      mainLocale: 'zh-CN',
      legacyLocale: 'en-US',
    })).toEqual({ locale: 'en-US', persist: true })
  })

  it('keeps the main-process locale once it has been stored', () => {
    expect(decideLocaleAdoption({
      localeConfigured: true,
      mainLocale: 'en-US',
      legacyLocale: 'zh-CN',
    })).toEqual({ locale: 'en-US', persist: false })
    expect(decideLocaleAdoption({
      localeConfigured: true,
      mainLocale: 'nope',
      legacyLocale: 'en-US',
    })).toEqual({ locale: 'zh-CN', persist: false })
  })
})
