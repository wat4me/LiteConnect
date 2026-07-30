import { t } from '@/i18n'
import type { DbErrorCategory } from '@/env.d'

export type DbUiError = {
  category: DbErrorCategory
  summary: string
  detail?: string
  retryable: boolean
  code?: string
}

function categoryOf(err: any): DbErrorCategory {
  const c = err?.category
  const allowed: DbErrorCategory[] = [
    'auth',
    'refused',
    'timeout',
    'tunnel',
    'session',
    'permission',
    'syntax',
    'query_timeout',
    'cancel',
    'deadlock',
    'serialization',
    'unknown',
  ]
  if (typeof c === 'string' && (allowed as string[]).includes(c)) return c as DbErrorCategory
  if (err?.code === 'QUERY_CANCELLED' || /cancel/i.test(String(err?.message || ''))) return 'cancel'
  return 'unknown'
}

export function parseDbError(err: unknown): DbUiError {
  const e = err as any
  const category = categoryOf(e)
  const detail =
    typeof e?.detail === 'string' && e.detail.trim()
      ? e.detail
      : typeof e?.message === 'string'
        ? e.message
        : String(e || '')
  const summaryKey = `database.errors.${category}`
  let summary = t(summaryKey)
  // vue-i18n returns key when missing
  if (!summary || summary === summaryKey) {
    summary =
      typeof e?.message === 'string' && e.message.trim()
        ? e.message
        : t('database.msg.execFailed')
  }
  const retryable =
    typeof e?.retryable === 'boolean'
      ? e.retryable
      : category === 'timeout'
        || category === 'refused'
        || category === 'tunnel'
        || category === 'session'
        || category === 'deadlock'
        || category === 'serialization'
        || category === 'query_timeout'
  return {
    category,
    summary,
    detail: detail && detail !== summary ? detail : e?.detail,
    retryable,
    code: typeof e?.dbCode === 'string' ? e.dbCode : typeof e?.code === 'string' ? e.code : undefined,
  }
}
