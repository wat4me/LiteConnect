import { describe, expect, it } from 'vitest'
import { assessSqlRisk, shouldConfirmSqlRisk, stripSqlLiteralsAndComments } from './sqlRisk'

describe('stripSqlLiteralsAndComments', () => {
  it('strips single-quoted strings so WHERE inside is ignored', () => {
    const { code } = stripSqlLiteralsAndComments("UPDATE t SET a='WHERE x' /* WHERE y */")
    expect(code.toUpperCase()).not.toMatch(/WHERE\s+X/)
    expect(code).toContain("''")
  })

  it('strips line and block comments', () => {
    const { code } = stripSqlLiteralsAndComments('SELECT 1 -- WHERE\n/* WHERE */ FROM t')
    expect(code.toUpperCase()).not.toContain('WHERE')
  })

  it('handles dollar quotes', () => {
    const { code, uncertain } = stripSqlLiteralsAndComments("SELECT $tag$ WHERE $tag$")
    expect(uncertain).toBe(false)
    expect(code).toContain('$$')
  })
})

describe('assessSqlRisk', () => {
  it('flags DROP / TRUNCATE', () => {
    expect(assessSqlRisk('DROP TABLE users').kinds).toContain('drop')
    expect(assessSqlRisk('TRUNCATE TABLE logs').kinds).toContain('truncate')
    expect(shouldConfirmSqlRisk(assessSqlRisk('DROP DATABASE x'))).toBe(true)
  })

  it('flags UPDATE/DELETE without WHERE', () => {
    const u = assessSqlRisk('UPDATE users SET active = 0')
    expect(u.kinds).toContain('update_no_where')
    expect(u.level).toBe('high')

    const d = assessSqlRisk('DELETE FROM users')
    expect(d.kinds).toContain('delete_no_where')
  })

  it('does not flag UPDATE/DELETE with WHERE', () => {
    expect(assessSqlRisk("UPDATE users SET a=1 WHERE id=1").level).toBe('none')
    expect(assessSqlRisk('DELETE FROM users WHERE id = 2').level).toBe('none')
  })

  it('does not treat WHERE inside string as safety', () => {
    const a = assessSqlRisk("UPDATE users SET note = 'has WHERE clause'")
    expect(a.kinds).toContain('update_no_where')
  })

  it('does not treat WHERE inside comment as safety', () => {
    const a = assessSqlRisk('DELETE FROM users -- WHERE id=1')
    expect(a.kinds).toContain('delete_no_where')
  })

  it('SELECT is none', () => {
    expect(assessSqlRisk('SELECT * FROM t WHERE id=1').level).toBe('none')
  })

  it('uncertain when unclosed string', () => {
    const a = assessSqlRisk("UPDATE t SET a = 'oops")
    expect(a.uncertain).toBe(true)
    expect(a.level).toBe('high') // still has update_no_where + uncertain
    expect(shouldConfirmSqlRisk(a)).toBe(true)
  })

  it('WITH CTE then DELETE without WHERE is high', () => {
    const a = assessSqlRisk('WITH x AS (SELECT 1) DELETE FROM users')
    expect(a.kinds).toContain('delete_no_where')
  })
})
