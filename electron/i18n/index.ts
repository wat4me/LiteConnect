import zhCN from './zh-CN'
import enUS from './en-US'
import { sanitizeAppLocale, type AppLocale } from '../../shared/appLocale'

type Dict = Record<string, unknown>

const catalogs: Record<string, Dict> = {
  'zh-CN': zhCN as unknown as Dict,
  'en-US': enUS as unknown as Dict,
}

let currentLocale: AppLocale = 'zh-CN'

export function getMainLocale(): AppLocale {
  return currentLocale
}

export function setMainLocale(locale: string) {
  const next = sanitizeAppLocale(locale)
  if (catalogs[next]) currentLocale = next
}

function lookup(dict: Dict, path: string): string | undefined {
  const parts = path.split('.')
  let cur: unknown = dict
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Dict)[p]
  }
  return typeof cur === 'string' ? cur : undefined
}

function format(template: string, params?: Record<string, string | number>): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    params[key] !== undefined ? String(params[key]) : `{${key}}`,
  )
}

/** Main-process translate. Keys like `x11.autoStarted`. */
export function t(key: string, params?: Record<string, string | number>): string {
  const dict = catalogs[currentLocale] || catalogs['zh-CN']
  const raw = lookup(dict, key) ?? lookup(catalogs['zh-CN'], key) ?? key
  return format(raw, params)
}
