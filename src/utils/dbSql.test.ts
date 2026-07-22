import { describe, expect, it } from 'vitest'
import {
  buildDeleteSql,
  buildInsertSql,
  buildUpdateSql,
  filterRows,
  quoteIdent,
  sortRows,
  sqlLiteral,
} from './dbSql'
import { highlightSql } from './sqlHighlight'

describe('dbSql', () => {
  it('quotes identifiers (mysql + postgres)', () => {
    expect(quoteIdent('user')).toBe('`user`')
    expect(quoteIdent('a`b')).toBe('`a``b`')
    expect(quoteIdent('user', 'postgres')).toBe('"user"')
    expect(quoteIdent('a"b', 'postgres')).toBe('"a""b"')
  })

  it('builds update with pk where', () => {
    const sql = buildUpdateSql(
      'app',
      'users',
      ['id'],
      { id: 1, name: 'a', age: 10 },
      { id: 1, name: 'b', age: 10 },
      ['id', 'name', 'age'],
    )
    expect(sql).toContain('UPDATE `app`.`users`')
    expect(sql).toContain("`name` = 'b'")
    expect(sql).toContain('WHERE `id` = 1')
    expect(sql).not.toContain('`age`')
  })

  it('builds postgres update without LIMIT', () => {
    const sql = buildUpdateSql(
      'app',
      'users',
      ['id'],
      { id: 1, name: 'a' },
      { id: 1, name: 'b' },
      ['id', 'name'],
      'postgres',
    )
    expect(sql).toContain('UPDATE "public"."users"')
    expect(sql).not.toContain('LIMIT')
  })

  it('builds delete and insert', () => {
    expect(buildDeleteSql('app', 'users', ['id'], { id: 3 })).toContain('DELETE FROM `app`.`users`')
    expect(buildInsertSql('app', 'users', ['id', 'name'], { id: null, name: "o'b" })).toContain(
      "VALUES (NULL, 'o''b')",
    )
  })

  it('sqlLiteral handles null and strings', () => {
    expect(sqlLiteral(null)).toBe('NULL')
    expect(sqlLiteral("a'b")).toBe("'a''b'")
    expect(sqlLiteral(true, 'postgres')).toBe('TRUE')
  })

  it('sorts and filters rows', () => {
    const rows = [
      { n: 'b', v: 2 },
      { n: 'a', v: 1 },
      { n: 'c', v: 3 },
    ]
    expect(sortRows(rows, 'n', 'asc').map((r) => r.n)).toEqual(['a', 'b', 'c'])
    expect(filterRows(rows, ['n', 'v'], '2')).toEqual([{ n: 'b', v: 2 }])
  })
})

describe('highlightSql', () => {
  it('highlights keywords and strings', () => {
    const html = highlightSql("SELECT * FROM t WHERE name = 'x' -- c")
    expect(html).toContain('sql-kw')
    expect(html).toContain('sql-str')
    expect(html).toContain('sql-cmt')
    expect(html).not.toContain('<script')
  })
})
