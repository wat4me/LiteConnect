import { QUERY_MAX_ROWS_DEFAULT, QUERY_TIMEOUT_SEC_DEFAULT } from './queryTabOptions'

export const DB_PAGE_SIZE_OPTIONS = [50, 100, 200, 500] as const
export type DbPageSize = (typeof DB_PAGE_SIZE_OPTIONS)[number]

/** Matches the first `terminalFontFamilyPresets` value (Cascadia). */
export const DEFAULT_DB_FONT_FAMILY = '"Cascadia Code", monospace'
export const DEFAULT_DB_FONT_SIZE = 13
export const DEFAULT_DB_PAGE_SIZE: DbPageSize = 100
export const DEFAULT_DB_DEFAULT_MAX_ROWS = QUERY_MAX_ROWS_DEFAULT
export const DEFAULT_DB_DEFAULT_QUERY_TIMEOUT_SEC = QUERY_TIMEOUT_SEC_DEFAULT
export const DEFAULT_DB_DEFAULT_RUN_SCOPE = 'smart' as const
