import { createI18n } from 'vue-i18n'
import zhCN from './locales/zh-CN'
import enUS from './locales/en-US'
import {
  APP_LOCALES,
  decideLocaleAdoption,
  DEFAULT_APP_LOCALE,
  DEFAULT_LOCALE_PREFERENCE,
  isAppLocale,
  isLocalePreference,
  resolveSystemAppLocale,
  sanitizeAppLocale,
  sanitizeLocalePreference,
  type AppLocale,
  type LocalePreference,
} from '@shared/appLocale'

export const SUPPORT_LOCALES = APP_LOCALES
export type { AppLocale, LocalePreference }
export const DEFAULT_LOCALE: AppLocale = DEFAULT_APP_LOCALE

const messages = {
  'zh-CN': zhCN,
  'en-US': enUS,
}

export const i18n = createI18n({
  legacy: false,
  locale: DEFAULT_LOCALE,
  fallbackLocale: DEFAULT_LOCALE,
  messages,
  missingWarn: false,
  fallbackWarn: false,
})

const LOCALE_STORAGE_KEY = 'LiteConnect.locale'
const LOCALE_PREF_STORAGE_KEY = 'LiteConnect.localePreference'

function mirrorLocale(locale: AppLocale, preference?: LocalePreference) {
  if (typeof document !== 'undefined') document.documentElement.lang = locale
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale)
    if (preference !== undefined) {
      localStorage.setItem(LOCALE_PREF_STORAGE_KEY, sanitizeLocalePreference(preference))
    }
  } catch {
    // ignore
  }
}

/** Apply a locale in this window. Persistence lives in the main-process settings. */
export function setAppLocale(locale: AppLocale, preference?: LocalePreference) {
  const next = sanitizeAppLocale(locale)
  i18n.global.locale.value = next
  mirrorLocale(next, preference)
}

function readRawStoredLocale(): AppLocale | null {
  try {
    const raw = localStorage.getItem(LOCALE_STORAGE_KEY)
    return isAppLocale(raw) ? raw : null
  } catch {
    return null
  }
}

export function getStoredLocalePreference(): LocalePreference {
  try {
    const pref = localStorage.getItem(LOCALE_PREF_STORAGE_KEY)
    if (isLocalePreference(pref)) return pref
    const legacy = localStorage.getItem(LOCALE_STORAGE_KEY)
    if (isAppLocale(legacy)) return legacy
  } catch {
    // ignore
  }
  return DEFAULT_LOCALE_PREFERENCE
}

export function getStoredLocale(): AppLocale {
  try {
    if (getStoredLocalePreference() === 'system') return resolveSystemAppLocale()
    return sanitizeAppLocale(localStorage.getItem(LOCALE_STORAGE_KEY))
  } catch {
    return DEFAULT_LOCALE
  }
}

export function initLocaleFromStorage() {
  // Apply frame-0 locale without writing localStorage back so fresh installs
  // keep `system` preference rather than being treated as an explicit override.
  const initial = getStoredLocale()
  i18n.global.locale.value = initial
  if (typeof document !== 'undefined') document.documentElement.lang = initial
}

/**
 * Main-process settings win after a locale has been saved.
 * The first launch adopts explicit legacy LiteConnect.locale if present;
 * fresh installs keep following the OS language by default.
 */
export async function reconcileStoredLocale(): Promise<void> {
  const api = window.LiteConnect
  if (!api?.getAllSettings || !api.setManySettings) return
  try {
    const all = await api.getAllSettings()
    const rawLegacy = readRawStoredLocale()
    if (all.localeConfigured !== true && rawLegacy !== null) {
      const decision = decideLocaleAdoption({
        localeConfigured: false,
        mainLocale: all.locale,
        legacyLocale: rawLegacy,
      })
      if (decision.persist) {
        await api.setManySettings({ locale: decision.locale, localePreference: decision.locale })
        setAppLocale(decision.locale, decision.locale)
        return
      }
    }
    const resolved = sanitizeAppLocale(all.locale)
    setAppLocale(resolved, sanitizeLocalePreference(all.localePreference))
  } catch {
    // Keep the startup cache when settings are not available yet.
  }
}

export function listenForLocaleChanges(): () => void {
  const api = window.LiteConnect
  const offIpc = api?.onLocaleChanged
    ? api.onLocaleChanged((locale) => setAppLocale(sanitizeAppLocale(locale)))
    : () => {}
  const onLanguageChange = () => {
    if (getStoredLocalePreference() !== 'system') return
    if (api?.syncSystemLocale) {
      void api.syncSystemLocale().then((resolved) => {
        setAppLocale(sanitizeAppLocale(resolved), 'system')
      }).catch(() => {})
    } else {
      setAppLocale(resolveSystemAppLocale(), 'system')
    }
  }
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('languagechange', onLanguageChange)
  }
  return () => {
    offIpc()
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('languagechange', onLanguageChange)
    }
  }
}

/** Non-setup / plain TS helpers (composables outside component setup). */
export function t(key: string, params?: Record<string, unknown>): string {
  return i18n.global.t(key, params as any) as string
}

export default i18n
