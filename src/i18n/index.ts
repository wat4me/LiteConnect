import { createI18n } from 'vue-i18n'
import zhCN from './locales/zh-CN'
import enUS from './locales/en-US'
import {
  APP_LOCALES,
  decideLocaleAdoption,
  DEFAULT_APP_LOCALE,
  sanitizeAppLocale,
  type AppLocale,
} from '@shared/appLocale'

export const SUPPORT_LOCALES = APP_LOCALES
export type { AppLocale }
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

function mirrorLocale(locale: AppLocale) {
  if (typeof document !== 'undefined') document.documentElement.lang = locale
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    // ignore
  }
}

/** Apply a locale in this window. Persistence lives in the main-process settings. */
export function setAppLocale(locale: AppLocale) {
  const next = sanitizeAppLocale(locale)
  i18n.global.locale.value = next
  mirrorLocale(next)
}

export function getStoredLocale(): AppLocale {
  try {
    return sanitizeAppLocale(localStorage.getItem(LOCALE_STORAGE_KEY))
  } catch {
    return DEFAULT_LOCALE
  }
}

export function initLocaleFromStorage() {
  setAppLocale(getStoredLocale())
}

/**
 * Main-process settings win after a locale has been saved.
 * The first launch adopts LiteConnect.locale, then stores that choice.
 */
export async function reconcileStoredLocale(): Promise<void> {
  const api = window.LiteConnect
  if (!api?.getAllSettings || !api.setManySettings) return
  try {
    const all = await api.getAllSettings()
    const decision = decideLocaleAdoption({
      localeConfigured: all.localeConfigured === true,
      mainLocale: all.locale,
      legacyLocale: getStoredLocale(),
    })
    if (decision.persist) await api.setManySettings({ locale: decision.locale })
    setAppLocale(decision.locale)
  } catch {
    // Keep the startup cache when settings are not available yet.
  }
}

export function listenForLocaleChanges(): () => void {
  const api = window.LiteConnect
  if (!api?.onLocaleChanged) return () => {}
  return api.onLocaleChanged((locale) => setAppLocale(sanitizeAppLocale(locale)))
}

/** Non-setup / plain TS helpers (composables outside component setup). */
export function t(key: string, params?: Record<string, unknown>): string {
  return i18n.global.t(key, params as any) as string
}

export default i18n
