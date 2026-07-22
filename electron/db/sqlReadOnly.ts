/** Re-export shared single-source read-only SQL classification for main process. */
export {
  assessSqlReadOnly,
  assertSqlAllowedInReadOnly,
  stripSqlForReadOnlyScan,
  type SqlReadOnlyDialect,
  type SqlReadOnlyVerdict,
} from '../../shared/sqlReadOnly'
