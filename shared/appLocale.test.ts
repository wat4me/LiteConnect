import { describe, expect, it } from 'vitest'
import { decideLocaleAdoption, sanitizeAppLocale } from './appLocale'

describe('app locale', () => {
  it('falls back when the stored locale is not supported', () => {
    expect(sanitizeAppLocale('en-US')).toBe('en-US')
    expect(sanitizeAppLocale('zh-CN')).toBe('zh-CN')
    expect(sanitizeAppLocale('fr-FR')).toBe('zh-CN')
    expect(sanitizeAppLocale(null)).toBe('zh-CN')
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
