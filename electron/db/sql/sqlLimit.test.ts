import { describe, expect, it } from 'vitest'
import { isPostgresCursorSafe, planSqlRowLimit, stripSqlComments } from './sqlLimit'

describe('stripSqlComments (lexical)', () => {
  it('removes real block and line comments', () => {
    const s = stripSqlComments('SELECT /* x */ 1 -- y\nFROM t')
    expect(s).toContain('SELECT')
    expect(s).toContain('FROM t')
    expect(s).not.toContain('/*')
    expect(s).not.toContain('-- y')
  })

  it('does not strip comment markers inside single-quoted strings', () => {
    const s = stripSqlComments("SELECT '/* not comment */' AS a, '-- neither' AS b FROM t")
    expect(s).toContain('/* not comment */')
    expect(s).toContain('-- neither')
  })

  it('does not strip comment markers inside double-quoted identifiers', () => {
    const s = stripSqlComments('SELECT "col--x" FROM "t/*y*/"')
    expect(s).toContain('col--x')
    expect(s).toContain('t/*y*/')
  })

  it('does not strip comment markers inside backticks', () => {
    const s = stripSqlComments('SELECT `a--b` FROM `t/*c*/`')
    expect(s).toContain('a--b')
    expect(s).toContain('t/*c*/')
  })

  it('handles escaped quotes inside strings', () => {
    const s = stripSqlComments("SELECT 'it''s -- not comment' FROM t")
    expect(s).toContain("it''s -- not comment")
  })
})

describe('planSqlRowLimit', () => {
  it('rewrites simple SELECT with LIMIT maxRows+1', () => {
    const plan = planSqlRowLimit('SELECT * FROM t', 100)
    expect(plan.mode).toBe('rewrite')
    if (plan.mode === 'rewrite') {
      expect(plan.sql).toMatch(/LIMIT 101\s*$/i)
      expect(plan.sql).toContain('SELECT * FROM t')
    }
  })

  it('rewrites Oracle SELECT with FETCH FIRST maxRows+1', () => {
    const plan = planSqlRowLimit('SELECT * FROM t', 100, 'oracle')
    expect(plan.mode).toBe('rewrite')
    if (plan.mode === 'rewrite') {
      expect(plan.sql).toMatch(/FETCH FIRST 101 ROWS ONLY\s*$/i)
      expect(plan.sql).not.toMatch(/\bLIMIT\b/i)
    }
  })

  it('strips trailing semicolon before rewrite', () => {
    const plan = planSqlRowLimit('SELECT 1;', 10)
    expect(plan.mode).toBe('rewrite')
    if (plan.mode === 'rewrite') {
      expect(plan.sql).not.toMatch(/;.*LIMIT/i)
      expect(plan.sql).toMatch(/LIMIT 11/i)
    }
  })

  it('streams when LIMIT already present', () => {
    expect(planSqlRowLimit('SELECT * FROM t LIMIT 5', 100).mode).toBe('stream')
    expect(planSqlRowLimit('SELECT * FROM t LIMIT 5 OFFSET 10', 100).mode).toBe('stream')
  })

  it('streams SELECT ... OFFSET without LIMIT (cannot append LIMIT after OFFSET)', () => {
    expect(planSqlRowLimit('SELECT * FROM t OFFSET 10', 100).mode).toBe('stream')
    expect(planSqlRowLimit('SELECT * FROM t OFFSET 0', 50).mode).toBe('stream')
  })

  it('streams SELECT ... FETCH FIRST / NEXT', () => {
    expect(planSqlRowLimit('SELECT * FROM t FETCH FIRST 10 ROWS ONLY', 100).mode).toBe(
      'stream',
    )
    expect(planSqlRowLimit('SELECT * FROM t FETCH NEXT 5 ROWS ONLY', 100).mode).toBe('stream')
  })

  it('rejects multi-statement SELECT as unsupported (not silent stream)', () => {
    const plan = planSqlRowLimit('SELECT 1; SELECT 2', 10)
    expect(plan.mode).toBe('unsupported')
    if (plan.mode === 'unsupported') expect(plan.error).toMatch(/Multiple/i)
  })

  it('leaves DML/DDL alone (none)', () => {
    expect(planSqlRowLimit('UPDATE t SET a=1', 10).mode).toBe('none')
    expect(planSqlRowLimit('INSERT INTO t VALUES (1)', 10).mode).toBe('none')
    expect(planSqlRowLimit('CREATE TABLE t (id int)', 10).mode).toBe('none')
    expect(planSqlRowLimit('DELETE FROM t', 10).mode).toBe('none')
  })

  it('allows WITH (CTE) rewrite when no LIMIT', () => {
    const plan = planSqlRowLimit('WITH c AS (SELECT 1 AS x) SELECT * FROM c', 50)
    expect(plan.mode).toBe('rewrite')
    if (plan.mode === 'rewrite') expect(plan.sql).toMatch(/LIMIT 51/i)
  })

  it('rewrites multi-CTE WITH SELECT', () => {
    const plan = planSqlRowLimit(
      'WITH a AS (SELECT 1 AS x), b AS (SELECT 2 AS y) SELECT * FROM a JOIN b ON true',
      20,
    )
    expect(plan.mode).toBe('rewrite')
    if (plan.mode === 'rewrite') expect(plan.sql).toMatch(/LIMIT 21/i)
  })

  it('rewrites WITH RECURSIVE SELECT', () => {
    const plan = planSqlRowLimit(
      'WITH RECURSIVE t(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM t WHERE n < 3) SELECT * FROM t',
      10,
    )
    expect(plan.mode).toBe('rewrite')
    if (plan.mode === 'rewrite') expect(plan.sql).toMatch(/LIMIT 11/i)
  })

  it('WITH … UPDATE is none (never LIMIT / stream / cursor)', () => {
    expect(
      planSqlRowLimit(
        'WITH c AS (SELECT id FROM t WHERE active) UPDATE t SET x=1 FROM c WHERE t.id=c.id',
        50,
      ).mode,
    ).toBe('none')
  })

  it('WITH … DELETE is none', () => {
    expect(
      planSqlRowLimit(
        'WITH d AS (SELECT id FROM doomed) DELETE FROM t WHERE id IN (SELECT id FROM d)',
        50,
      ).mode,
    ).toBe('none')
  })

  it('WITH … INSERT is none', () => {
    expect(
      planSqlRowLimit(
        'WITH s AS (SELECT 1 AS id) INSERT INTO t (id) SELECT id FROM s',
        50,
      ).mode,
    ).toBe('none')
  })

  it('CTE strings/parens/comments do not break top-level SELECT detection', () => {
    const plan = planSqlRowLimit(
      `WITH c AS (
        SELECT '(' AS p, '/* not */' AS c, '-- no' AS d
      ) /* after cte */ SELECT * FROM c`,
      15,
    )
    expect(plan.mode).toBe('rewrite')
  })

  it('CTE content with nested parens still finds main SELECT', () => {
    const plan = planSqlRowLimit(
      'WITH c AS (SELECT * FROM (SELECT 1 AS x) AS sub) SELECT * FROM c',
      10,
    )
    expect(plan.mode).toBe('rewrite')
  })

  it('leading parens before SELECT stream (not none, not unsafe rewrite)', () => {
    expect(planSqlRowLimit('(((SELECT * FROM t)))', 10).mode).toBe('stream')
    expect(planSqlRowLimit('( SELECT 1 )', 10).mode).toBe('stream')
  })

  it('ignores real comments when detecting SELECT', () => {
    const plan = planSqlRowLimit('/* note */ SELECT id FROM users -- end', 20)
    expect(plan.mode).toBe('rewrite')
  })

  it('streams locking clauses', () => {
    expect(planSqlRowLimit('SELECT * FROM t FOR UPDATE', 100).mode).toBe('stream')
    expect(planSqlRowLimit('SELECT * FROM t FOR SHARE', 100).mode).toBe('stream')
    expect(planSqlRowLimit('SELECT * FROM t FOR NO KEY UPDATE', 100).mode).toBe('stream')
    expect(planSqlRowLimit('SELECT * FROM t FOR KEY SHARE', 100).mode).toBe('stream')
    expect(planSqlRowLimit('SELECT id FROM t LOCK IN SHARE MODE', 50).mode).toBe('stream')
  })

  it('streams INTO OUTFILE / DUMPFILE', () => {
    expect(planSqlRowLimit("SELECT * FROM t INTO OUTFILE '/tmp/x.csv'", 10).mode).toBe('stream')
    expect(planSqlRowLimit("SELECT * FROM t INTO DUMPFILE '/tmp/x.bin'", 10).mode).toBe('stream')
  })

  it('plain for SELECT INTO table (no cursor, no LIMIT rewrite)', () => {
    expect(planSqlRowLimit('SELECT * INTO new_table FROM t', 10).mode).toBe('plain')
  })

  it('does not treat LIMIT inside string as existing limit', () => {
    const plan = planSqlRowLimit("SELECT 'limit 5' AS s FROM t", 20)
    expect(plan.mode).toBe('rewrite')
    if (plan.mode === 'rewrite') expect(plan.sql).toMatch(/LIMIT 21/i)
  })

  it('does not treat FOR UPDATE inside string as lock clause', () => {
    const plan = planSqlRowLimit("SELECT 'FOR UPDATE' AS s FROM t", 20)
    expect(plan.mode).toBe('rewrite')
  })

  it('does not treat string-embedded -- as comment (LIMIT still rewriteable)', () => {
    const plan = planSqlRowLimit("SELECT 'a--b' AS s FROM t", 10)
    expect(plan.mode).toBe('rewrite')
  })

  it('does not treat LIMIT inside CTE block comment as existing limit', () => {
    const plan = planSqlRowLimit(
      'WITH c AS (SELECT 1 AS x /* LIMIT 1 */) SELECT * FROM c',
      10,
    )
    expect(plan.mode).toBe('rewrite')
  })

  it('still none for DML that contains SELECT-like words in strings', () => {
    expect(planSqlRowLimit("UPDATE t SET note='SELECT 1'", 10).mode).toBe('none')
  })
})

describe('isPostgresCursorSafe', () => {
  it('true for simple SELECT and locking SELECT', () => {
    expect(isPostgresCursorSafe('SELECT * FROM t')).toBe(true)
    expect(isPostgresCursorSafe('SELECT * FROM t FOR UPDATE')).toBe(true)
    expect(isPostgresCursorSafe('SELECT * FROM t LIMIT 5')).toBe(true)
  })

  it('false for multi-statement and SELECT INTO', () => {
    expect(isPostgresCursorSafe('SELECT 1; SELECT 2')).toBe(false)
    expect(isPostgresCursorSafe('SELECT * INTO x FROM t')).toBe(false)
  })

  it('false for DML and WITH DML', () => {
    expect(isPostgresCursorSafe('UPDATE t SET a=1')).toBe(false)
    expect(
      isPostgresCursorSafe('WITH c AS (SELECT 1) UPDATE t SET a=1 WHERE id IN (SELECT * FROM c)'),
    ).toBe(false)
  })

  it('true for WITH SELECT', () => {
    expect(isPostgresCursorSafe('WITH c AS (SELECT 1 AS x) SELECT * FROM c')).toBe(true)
  })
})
