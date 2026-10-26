import zhCN from './zh-CN'
import enUS from './en-US'
import { sanitizeAppLocale } from '../appLocale'

export type SharedTextKey = `sharedText.${keyof typeof zhCN.sharedText}`
export type SharedTranslate = (key: SharedTextKey, params?: Record<string, string | number>) => string

/** Pure helpers receive a translator; they never depend on Vue or Electron state. */
export function createSharedTranslator(locale: string = 'zh-CN'): SharedTranslate {
  const messages = sanitizeAppLocale(locale) === 'en-US' ? enUS.sharedText : zhCN.sharedText
  return (key, params) => {
    const template = messages[key.slice('sharedText.'.length) as keyof typeof messages]
    return template.replace(/\{(\w+)\}/g, (match, name: string) => params?.[name] !== undefined ? String(params[name]) : match)
  }
}

/** Compatibility default for pure callers without an application locale. */
export const sharedT = createSharedTranslator()
