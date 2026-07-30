/** Re-export shared SQL risk assessment for renderer. */
export {
  assessSqlRisk,
  shouldConfirmSqlRisk,
  stripSqlLiteralsAndComments,
  type SqlRiskLevel,
  type SqlRiskKind,
  type SqlRiskAssessment,
} from '../../../shared/sqlRisk'
