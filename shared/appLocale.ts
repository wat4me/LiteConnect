export const APP_LOCALES = ['zh-CN', 'en-US'] as const

export type AppLocale = (typeof APP_LOCALES)[number]

export const DEFAULT_APP_LOCALE: AppLocale = 'zh-CN'

export function isAppLocale(value: unknown): value is AppLocale {
  return value === 'zh-CN' || value === 'en-US'
}

/** Unknown values fall back to Simplified Chinese. */
export function sanitizeAppLocale(value: unknown): AppLocale {
  return isAppLocale(value) ? value : DEFAULT_APP_LOCALE
}

/**
 * Main-process settings are the source of truth after the first save.
 * Until a locale has been stored, keep the legacy renderer preference.
 */
export function decideLocaleAdoption(input: {
  localeConfigured: boolean
  mainLocale: unknown
  legacyLocale: unknown
}): { locale: AppLocale; persist: boolean } {
  if (input.localeConfigured) {
    return { locale: sanitizeAppLocale(input.mainLocale), persist: false }
  }
  return { locale: sanitizeAppLocale(input.legacyLocale), persist: true }
}
