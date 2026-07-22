import { createI18n } from 'vue-i18n'
import zhCN from './locales/zh-CN'

export const SUPPORT_LOCALES = ['zh-CN'] as const
export type AppLocale = (typeof SUPPORT_LOCALES)[number]

export const DEFAULT_LOCALE: AppLocale = 'zh-CN'

const messages = {
  'zh-CN': zhCN,
  // en: () => import('./locales/en')  — add when ready
}

export const i18n = createI18n({
  legacy: false,
  locale: DEFAULT_LOCALE,
  fallbackLocale: DEFAULT_LOCALE,
  messages,
  missingWarn: false,
  fallbackWarn: false,
})

export function setAppLocale(locale: AppLocale) {
  i18n.global.locale.value = locale
  try {
    localStorage.setItem('LiteConnect.locale', locale)
  } catch {
    // ignore
  }
}

export function getStoredLocale(): AppLocale {
  try {
    const v = localStorage.getItem('LiteConnect.locale')
    if (v && (SUPPORT_LOCALES as readonly string[]).includes(v)) {
      return v as AppLocale
    }
  } catch {
    // ignore
  }
  return DEFAULT_LOCALE
}

export function initLocaleFromStorage() {
  setAppLocale(getStoredLocale())
}

/** Non-setup / plain TS helpers (composables outside component setup). */
export function t(key: string, params?: Record<string, unknown>): string {
  return i18n.global.t(key, params as any) as string
}

export default i18n
