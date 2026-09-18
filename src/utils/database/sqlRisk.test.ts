import { describe, expect, it } from 'vitest'
import { assessSqlRisk, shouldConfirmSqlRisk } from '@/utils/database/sqlRisk'

describe('assessSqlRisk (renderer)', () => {
  it('flags DROP and no-WHERE DML', () => {
    expect(assessSqlRisk('DROP TABLE t').level).toBe('high')
    expect(assessSqlRisk('UPDATE t SET a=1').kinds).toContain('update_no_where')
    expect(assessSqlRisk("UPDATE t SET a='WHERE'").kinds).toContain('update_no_where')
  })

  it('safe SELECT and WHERE present', () => {
    expect(assessSqlRisk('SELECT 1').level).toBe('none')
    expect(assessSqlRisk('DELETE FROM t WHERE id=1').level).toBe('none')
  })

  it('shouldConfirm', () => {
    expect(shouldConfirmSqlRisk(assessSqlRisk('TRUNCATE x'))).toBe(true)
  })
})
