/** Re-export shared SQL risk assessment (main process). */
export {
  assessSqlRisk,
  shouldConfirmSqlRisk,
  stripSqlLiteralsAndComments,
  type SqlRiskLevel,
  type SqlRiskKind,
  type SqlRiskAssessment,
} from '../../../shared/sqlRisk'
