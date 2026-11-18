export const APP_LOCALES = ['zh-CN', 'en-US'] as const

export type AppLocale = (typeof APP_LOCALES)[number]

export const LOCALE_PREFERENCES = ['system', 'zh-CN', 'en-US'] as const

export type LocalePreference = (typeof LOCALE_PREFERENCES)[number]

export const DEFAULT_APP_LOCALE: AppLocale = 'zh-CN'

export const DEFAULT_LOCALE_PREFERENCE: LocalePreference = 'system'

export function isAppLocale(value: unknown): value is AppLocale {
  return value === 'zh-CN' || value === 'en-US'
}

export function isLocalePreference(value: unknown): value is LocalePreference {
  return value === 'system' || isAppLocale(value)
}

/** Unknown values fall back to Simplified Chinese. */
export function sanitizeAppLocale(value: unknown): AppLocale {
  return isAppLocale(value) ? value : DEFAULT_APP_LOCALE
}

export function sanitizeLocalePreference(
  value: unknown,
  fallback: LocalePreference = DEFAULT_LOCALE_PREFERENCE,
): LocalePreference {
  return isLocalePreference(value) ? value : fallback
}

/**
 * Resolve OS / Chromium language tags (e.g. `zh-Hans-CN`, `en-GB`, `ja`) to a supported UI locale.
 * Chinese tags map to `zh-CN`; other valid tags map to `en-US`; missing/POSIX tags fall back to `zh-CN`.
 */
export function resolveSystemAppLocale(
  candidates?: readonly string[] | string | null,
): AppLocale {
  const rawList = Array.isArray(candidates)
    ? candidates
    : typeof candidates === 'string'
      ? [candidates]
      : typeof navigator !== 'undefined'
        ? [...(navigator.languages || []), navigator.language].filter(Boolean)
        : []
  const first = rawList
    .find((tag) => {
      if (typeof tag !== 'string') return false
      const normalized = tag.trim().toLowerCase()
      return Boolean(normalized) && normalized !== 'c' && normalized !== 'posix'
    })
    ?.trim()
    .toLowerCase()
  if (!first) return DEFAULT_APP_LOCALE
  return first === 'zh' || first.startsWith('zh-') || first.startsWith('zh_')
    ? 'zh-CN'
    : 'en-US'
}

export function resolveAppLocale(
  preference: unknown,
  systemCandidates?: readonly string[] | string | null,
): AppLocale {
  if (isAppLocale(preference)) return preference
  const normalized = sanitizeLocalePreference(preference)
  if (normalized === 'system') return resolveSystemAppLocale(systemCandidates)
  return normalized
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
