import { describe, expect, it } from 'vitest'
import {
  buildWhereClauseMysql,
  buildWhereClausePg,
  normalizeWhereExpression,
  sanitizeBrowseOptions,
} from './browseFilter'

describe('normalizeWhereExpression', () => {
  it('strips optional leading WHERE', () => {
    expect(normalizeWhereExpression('WHERE id = 1')).toBe('id = 1')
    expect(normalizeWhereExpression('where name LIKE \'%a%\'')).toBe("name LIKE '%a%'")
  })

  it('rejects semicolons and empty after strip', () => {
    expect(() => normalizeWhereExpression('id = 1; DROP TABLE t')).toThrow(/semicolon/i)
    expect(normalizeWhereExpression('WHERE   ')).toBe('')
  })
})

describe('sanitizeBrowseOptions where', () => {
  it('normalizes where field', () => {
    const out = sanitizeBrowseOptions({ where: '  WHERE status = 1  ' })
    expect(out?.where).toBe('status = 1')
  })
})

describe('buildWhereClause custom where', () => {
  it('mysql wraps user predicate and supports structured filters AND where', () => {
    const r = buildWhereClauseMysql({
      filters: [{ column: 'active', op: 'eq', value: '1' }],
      where: "name LIKE '%foo%'",
    })
    expect(r.clause).toBe(" WHERE `active` = ? AND (name LIKE '%foo%')")
    expect(r.params).toEqual(['1'])
  })

  it('postgres uses only custom where when no structured filters', () => {
    const r = buildWhereClausePg({ where: 'id > 10 AND id < 20' })
    expect(r.clause).toBe(' WHERE (id > 10 AND id < 20)')
    expect(r.params).toEqual([])
  })

  it('does not emit multi-column LIKE for free text', () => {
    const r = buildWhereClauseMysql({ where: "col1 = 'x'" })
    expect(r.clause).not.toMatch(/CAST\(/)
    expect(r.clause).toBe(" WHERE (col1 = 'x')")
  })
})
