export type {
  DbBrowseOptions,
  DbCancelResult,
  DbCancelStatus,
  DbColumnFilter,
  DbColumnInfo,
  DbConnection,
  DbEngine,
  DbErrorCategory,
  DbErrorPayload,
  DbExportFormat,
  DbExportProgress,
  DbExportResult,
  DbExportTableRequest,
  DbFilterOp,
  DbIndexInfo,
  DbQueryHistoryPushInput,
  DbQueryHistoryRunScope,
  DbQueryHistoryStatus,
  DbQueryOptions,
  DbQueryResult,
  DbSessionInfo,
  DbSslOptions,
  DbTableBrowseResult,
  DbTableInfo,
  DbTestParams,
  DbTestResult,
  DbTotalMode,
  DbTransactionState,
} from '../../shared/types/database'

import type { DbEngine, DbSslOptions } from '../../shared/types/database'

export const DB_ENGINES: readonly DbEngine[] = ['mysql', 'postgres', 'oracle'] as const

export const DEFAULT_DB_PORT: Record<DbEngine, number> = {
  mysql: 3306,
  postgres: 5432,
  oracle: 1521,
}

export function isDbEngine(value: unknown): value is DbEngine {
  return value === 'mysql' || value === 'postgres' || value === 'oracle'
}

export function normalizeDbEngine(value: unknown): DbEngine {
  return isDbEngine(value) ? value : 'mysql'
}

/** Build mysql2 / pg ssl config from connection fields */
export function resolveSslConfig(
  ssl?: boolean,
  sslOptions?: DbSslOptions,
): false | Record<string, unknown> {
  const enabled = sslOptions?.enabled ?? !!ssl
  if (!enabled) return false

  const rejectUnauthorized =
    typeof sslOptions?.rejectUnauthorized === 'boolean'
      ? sslOptions.rejectUnauthorized
      : !!(sslOptions?.ca && sslOptions.ca.trim())

  const cfg: Record<string, unknown> = { rejectUnauthorized }
  if (sslOptions?.ca?.trim()) cfg.ca = sslOptions.ca
  if (sslOptions?.cert?.trim()) cfg.cert = sslOptions.cert
  if (sslOptions?.key?.trim()) cfg.key = sslOptions.key
  return cfg
}
