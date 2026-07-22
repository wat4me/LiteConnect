import { describe, expect, it } from 'vitest'
import {
  canRunCurrentStatement,
  defaultRunScope,
  findStatementAtCursor,
  isLineCommentStart,
  isSqlLexicallyAmbiguous,
  readDollarTag,
  resolveRunSql,
  splitSqlStatements,
  splitSqlStatementsDetailed,
} from './sqlStatement'

describe('splitSqlStatements', () => {
  it('splits on top-level semicolons', () => {
    const ranges = splitSqlStatements('SELECT 1; SELECT 2;')
    expect(ranges.map((r) => r.text)).toEqual(['SELECT 1', 'SELECT 2'])
  })

  it('ignores semicolons inside single-quoted strings', () => {
    const ranges = splitSqlStatements("SELECT 'a;b'; SELECT 2")
    expect(ranges).toHaveLength(2)
    expect(ranges[0].text).toBe("SELECT 'a;b'")
    expect(ranges[1].text).toBe('SELECT 2')
  })

  it('handles doubled single quotes inside strings', () => {
    const ranges = splitSqlStatements("SELECT 'it''s;ok'; SELECT 2")
    expect(ranges).toHaveLength(2)
    expect(ranges[0].text).toContain("it''s;ok")
  })

  it('ignores semicolons in double-quoted strings', () => {
    const ranges = splitSqlStatements('SELECT "x;y"; SELECT 2')
    expect(ranges.map((r) => r.text)).toEqual(['SELECT "x;y"', 'SELECT 2'])
  })

  it('ignores semicolons in backticks', () => {
    const ranges = splitSqlStatements('SELECT `a;b` FROM t; SELECT 2')
    expect(ranges).toHaveLength(2)
    expect(ranges[0].text).toContain('`a;b`')
  })

  it('ignores semicolons inside line comments; comment attaches to next statement text', () => {
    const ranges = splitSqlStatements('SELECT 1; -- note; still\nSELECT 2')
    expect(ranges).toHaveLength(2)
    expect(ranges[0].text).toBe('SELECT 1')
    expect(ranges[1].text).toContain('-- note; still')
    expect(ranges[1].text).toContain('SELECT 2')
  })

  it('ignores semicolons inside # comments; comment attaches to next statement text', () => {
    const ranges = splitSqlStatements('SELECT 1; # a;b\nSELECT 2')
    expect(ranges).toHaveLength(2)
    expect(ranges[0].text).toBe('SELECT 1')
    expect(ranges[1].text).toContain('# a;b')
    expect(ranges[1].text).toContain('SELECT 2')
  })

  it('ignores semicolons inside block comments; comment attaches to next statement text', () => {
    const ranges = splitSqlStatements('SELECT 1; /* a; b */ SELECT 2')
    expect(ranges).toHaveLength(2)
    expect(ranges[0].text).toBe('SELECT 1')
    expect(ranges[1].text).toContain('/* a; b */')
    expect(ranges[1].text).toContain('SELECT 2')
  })

  it('returns single range when no semicolon', () => {
    const ranges = splitSqlStatements('SELECT * FROM t')
    expect(ranges).toHaveLength(1)
    expect(ranges[0].text).toBe('SELECT * FROM t')
  })

  it('skips empty statements from consecutive semicolons', () => {
    const ranges = splitSqlStatements('SELECT 1;;;SELECT 2')
    expect(ranges.map((r) => r.text)).toEqual(['SELECT 1', 'SELECT 2'])
  })

  it('keeps ordinary leading comments in statement text', () => {
    const sql = '-- prepare\nSELECT 1; SELECT 2'
    const ranges = splitSqlStatements(sql)
    expect(ranges).toHaveLength(2)
    expect(ranges[0].text).toContain('-- prepare')
    expect(ranges[0].text).toContain('SELECT 1')
    expect(ranges[0].coreStart).toBeGreaterThan(ranges[0].start)
    expect(sql.slice(ranges[0].coreStart).startsWith('SELECT')).toBe(true)
  })

  it('keeps optimizer hint /*+ ... */ in executable SQL', () => {
    const sql = '/*+ INDEX(t idx) */ SELECT * FROM t; SELECT 2'
    const ranges = splitSqlStatements(sql)
    expect(ranges[0].text).toContain('/*+ INDEX(t idx) */')
    expect(ranges[0].text).toContain('SELECT * FROM t')
    expect(ranges[0].coreStart).toBe(ranges[0].start)
  })

  it('keeps MySQL executable comment /*!...*/ in executable SQL', () => {
    const sql = '/*!40101 SET @a=1 */; SELECT 2'
    const ranges = splitSqlStatements(sql)
    expect(ranges[0].text).toContain('/*!40101 SET @a=1 */')
  })

  it('does not split inside $$ dollar-quoted strings (postgres)', () => {
    const sql = "DO $$ BEGIN PERFORM 1; PERFORM 2; END $$; SELECT 1"
    const ranges = splitSqlStatements(sql, 'postgres')
    expect(ranges).toHaveLength(2)
    expect(ranges[0].text).toContain('PERFORM 1; PERFORM 2;')
    expect(ranges[0].text).toContain('$$')
    expect(ranges[1].text).toBe('SELECT 1')
  })

  it('does not split inside $tag$ dollar-quoted strings (postgres)', () => {
    const sql = 'CREATE FUNCTION f() RETURNS void AS $body$\nBEGIN\n  SELECT 1;\nEND;\n$body$ LANGUAGE plpgsql; SELECT 9'
    const ranges = splitSqlStatements(sql, 'postgres')
    expect(ranges).toHaveLength(2)
    expect(ranges[0].text).toContain('$body$')
    expect(ranges[0].text).toContain('SELECT 1;')
    expect(ranges[1].text).toBe('SELECT 9')
  })
})

describe('readDollarTag', () => {
  it('parses $$ and $tag$', () => {
    expect(readDollarTag('$$hi$$', 0)).toBe('$$')
    expect(readDollarTag('$body$x$body$', 0)).toBe('$body$')
    expect(readDollarTag('$1bad$', 0)).toBeNull()
  })
})

describe('ambiguous / unclosed constructs', () => {
  it('flags unclosed single quote', () => {
    expect(isSqlLexicallyAmbiguous("SELECT 'abc")).toBe(true)
    expect(splitSqlStatementsDetailed("SELECT 'abc").ranges).toEqual([])
  })

  it('flags unclosed double quote', () => {
    expect(isSqlLexicallyAmbiguous('SELECT "abc')).toBe(true)
  })

  it('flags unclosed backtick', () => {
    expect(isSqlLexicallyAmbiguous('SELECT `abc')).toBe(true)
  })

  it('flags unclosed block comment', () => {
    expect(isSqlLexicallyAmbiguous('SELECT 1 /* open')).toBe(true)
  })

  it('flags unclosed dollar quote under postgres', () => {
    expect(isSqlLexicallyAmbiguous('DO $$ BEGIN SELECT 1;', 'postgres')).toBe(true)
    expect(isSqlLexicallyAmbiguous('DO $body$ BEGIN SELECT 1;', 'postgres')).toBe(true)
  })

  it('closed constructs are not ambiguous', () => {
    expect(isSqlLexicallyAmbiguous("SELECT 'a;b'; SELECT 2")).toBe(false)
    expect(isSqlLexicallyAmbiguous('DO $$ BEGIN PERFORM 1; END $$', 'postgres')).toBe(false)
  })
})

describe('findStatementAtCursor', () => {
  const sql = 'SELECT 1; SELECT 2; SELECT 3'

  it('finds first statement', () => {
    const s = findStatementAtCursor(sql, 0)
    expect(s?.text).toBe('SELECT 1')
  })

  it('finds second statement by cursor inside it', () => {
    const idx = sql.indexOf('SELECT 2')
    const s = findStatementAtCursor(sql, idx + 3)
    expect(s?.text).toBe('SELECT 2')
  })

  it('finds third statement at end', () => {
    const s = findStatementAtCursor(sql, sql.length)
    expect(s?.text).toBe('SELECT 3')
  })

  it('returns null for empty/whitespace sql', () => {
    expect(findStatementAtCursor('   ', 0)).toBeNull()
    expect(findStatementAtCursor('', 0)).toBeNull()
  })

  it('returns null when lexically ambiguous', () => {
    expect(findStatementAtCursor("SELECT 'oops", 5)).toBeNull()
  })
})

describe('resolveRunSql', () => {
  const multi = 'SELECT 1; SELECT 2 FROM t; SELECT 3'

  it('uses selection when present and scope defaults', () => {
    const start = multi.indexOf('SELECT 2')
    const end = start + 'SELECT 2 FROM t'.length
    const r = resolveRunSql({
      sql: multi,
      selectionStart: start,
      selectionEnd: end,
    })
    expect(r.scope).toBe('selection')
    expect(r.sql).toBe('SELECT 2 FROM t')
    expect(r.fallback).toBe(false)
  })

  it('uses current statement when no selection', () => {
    const cursor = multi.indexOf('SELECT 2') + 2
    const r = resolveRunSql({
      sql: multi,
      selectionStart: cursor,
      selectionEnd: cursor,
    })
    expect(r.scope).toBe('statement')
    expect(r.sql).toBe('SELECT 2 FROM t')
  })

  it('runs all when scope is all', () => {
    const r = resolveRunSql({
      sql: multi,
      selectionStart: 0,
      selectionEnd: 0,
      scope: 'all',
    })
    expect(r.scope).toBe('all')
    expect(r.sql).toBe(multi)
  })

  it('forces selection scope when selection is non-empty', () => {
    const r = resolveRunSql({
      sql: 'SELECT 1; SELECT 2',
      selectionStart: 0,
      selectionEnd: 8,
      scope: 'selection',
    })
    expect(r.sql).toBe('SELECT 1')
    expect(r.scope).toBe('selection')
  })

  it('explicit selection without selection returns empty no-selection (no silent downgrade)', () => {
    const r = resolveRunSql({
      sql: multi,
      selectionStart: 5,
      selectionEnd: 5,
      scope: 'selection',
    })
    expect(r.sql).toBe('')
    expect(r.scope).toBe('selection')
    expect(r.reason).toBe('no-selection')
    expect(r.fallback).toBe(false)
  })

  it('does not treat semicolon inside string as statement break', () => {
    const sql = "INSERT INTO t VALUES ('a;b'); SELECT 1"
    const cursor = 5
    const r = resolveRunSql({
      sql,
      selectionStart: cursor,
      selectionEnd: cursor,
      scope: 'statement',
    })
    expect(r.sql).toBe("INSERT INTO t VALUES ('a;b')")
  })

  it('returns empty for blank sql', () => {
    const r = resolveRunSql({ sql: '  \n  ', selectionStart: 0, selectionEnd: 0 })
    expect(r.sql).toBe('')
    expect(r.reason).toBe('empty')
  })

  it('statement scope refuses ambiguous unclosed quote', () => {
    const r = resolveRunSql({
      sql: "SELECT 'oops; SELECT 2",
      selectionStart: 0,
      selectionEnd: 0,
      scope: 'statement',
    })
    expect(r.sql).toBe('')
    expect(r.reason).toBe('ambiguous')
  })

  it('statement scope refuses unclosed dollar quote (postgres)', () => {
    const r = resolveRunSql({
      sql: 'DO $$ BEGIN PERFORM 1;',
      selectionStart: 0,
      selectionEnd: 0,
      scope: 'statement',
      dialect: 'postgres',
    })
    expect(r.sql).toBe('')
    expect(r.reason).toBe('ambiguous')
  })

  it('all scope still returns full text even if ambiguous', () => {
    const sql = "SELECT 'oops"
    const r = resolveRunSql({
      sql,
      selectionStart: 0,
      selectionEnd: 0,
      scope: 'all',
    })
    expect(r.sql).toBe(sql)
    expect(r.scope).toBe('all')
  })

  it('includes leading hint in current statement SQL', () => {
    const sql = '/*+ INDEX(t i) */ SELECT 1 FROM t; SELECT 2'
    const r = resolveRunSql({
      sql,
      selectionStart: 0,
      selectionEnd: 0,
      scope: 'statement',
    })
    expect(r.sql).toContain('/*+ INDEX(t i) */')
    expect(r.sql).toContain('SELECT 1 FROM t')
    expect(r.sql).not.toContain('SELECT 2')
  })

  it('includes ordinary leading comment in current statement SQL', () => {
    const sql = '-- note\nSELECT 1; SELECT 2'
    const r = resolveRunSql({
      sql,
      selectionStart: 0,
      selectionEnd: 0,
      scope: 'statement',
    })
    expect(r.sql).toContain('-- note')
    expect(r.sql).toContain('SELECT 1')
  })

  it('dollar body stays one statement under statement scope (postgres)', () => {
    const sql = 'DO $$ BEGIN PERFORM 1; PERFORM 2; END $$; SELECT 9'
    const r = resolveRunSql({
      sql,
      selectionStart: 3,
      selectionEnd: 3,
      scope: 'statement',
      dialect: 'postgres',
    })
    expect(r.sql).toContain('PERFORM 1; PERFORM 2;')
    expect(r.sql).not.toContain('SELECT 9')
  })
})

describe('defaultRunScope / canRunCurrentStatement', () => {
  it('prefers selection, then statement, then all', () => {
    expect(defaultRunScope(true, true)).toBe('selection')
    expect(defaultRunScope(false, true)).toBe('statement')
    expect(defaultRunScope(false, false)).toBe('all')
  })

  it('canRunCurrentStatement is false when ambiguous', () => {
    expect(canRunCurrentStatement("SELECT 'x", 0)).toBe(false)
    expect(canRunCurrentStatement('SELECT 1; SELECT 2', 0)).toBe(true)
  })
})

describe('dialect-aware line comments', () => {
  it('isLineCommentStart: MySQL requires space/control after --', () => {
    expect(isLineCommentStart('SELECT 1-- comment', 8, 'mysql')).toBe(true)
    expect(isLineCommentStart('SELECT 1--2', 8, 'mysql')).toBe(false)
    expect(isLineCommentStart('SELECT 1--', 8, 'mysql')).toBe(true)
  })

  it('isLineCommentStart: Postgres any -- is comment', () => {
    expect(isLineCommentStart('SELECT 1--2', 8, 'postgres')).toBe(true)
    expect(isLineCommentStart('SELECT 1-- comment', 8, 'postgres')).toBe(true)
  })

  it('MySQL: SELECT 1--2 is subtraction, not a comment (does not eat following ;)', () => {
    const sql = 'SELECT 1--2; SELECT 9'
    const ranges = splitSqlStatements(sql, 'mysql')
    expect(ranges).toHaveLength(2)
    expect(ranges[0].text).toBe('SELECT 1--2')
    expect(ranges[1].text).toBe('SELECT 9')
  })

  it('MySQL: SELECT 1-- comment starts comment even without leading space before --', () => {
    // `-- ` (space after) is a comment; `;` on same line is inside the comment
    const sql = 'SELECT 1-- trailing; SELECT 9\nSELECT 2'
    const ranges = splitSqlStatements(sql, 'mysql')
    // Only one semicolon and it is commented → single range until EOF
    expect(ranges).toHaveLength(1)
    expect(ranges[0].text).toContain('SELECT 1-- trailing')
    expect(ranges[0].text).toContain('SELECT 2')
    // Core still points at SELECT
    expect(sql.slice(ranges[0].coreStart).startsWith('SELECT')).toBe(true)
  })

  it('MySQL: inline -- with space does not treat following-line SQL as split by commented semicolon', () => {
    const sql = 'SELECT 1-- note; ignored\n; SELECT 9'
    const ranges = splitSqlStatements(sql, 'mysql')
    // First `;` commented; second `;` after newline is real → two chunks, first may be comment-only after empty
    expect(ranges.map((r) => r.text.replace(/\s+/g, ' ').trim())).toEqual(['SELECT 1-- note; ignored', 'SELECT 9'])
  })

  it('Postgres: SELECT 1--2 treats -- as comment; semicolon on same line is ignored', () => {
    const sql = 'SELECT 1--2; SELECT 9\nSELECT 3'
    const ranges = splitSqlStatements(sql, 'postgres')
    // `; SELECT 9` is commented; only newline then SELECT 3 remains one statement with SELECT 1
    expect(ranges).toHaveLength(1)
    expect(ranges[0].text).toContain('SELECT 1--2')
    expect(ranges[0].text).toContain('SELECT 3')
  })

  it('Postgres: SELECT 1--2 with newline then second statement after real semicolon', () => {
    const sql = 'SELECT 1--2\n; SELECT 9'
    const ranges = splitSqlStatements(sql, 'postgres')
    expect(ranges.map((r) => r.text.replace(/\s+/g, ' ').trim())).toEqual([
      'SELECT 1--2',
      'SELECT 9',
    ])
  })

  it('Postgres nested block comments hide inner semicolons', () => {
    const sql = 'SELECT 1 /* outer /* inner ; */ still; outer */ ; SELECT 2'
    // After nested close, " still; outer */" continues in outer comment until outer */
    const ranges = splitSqlStatements(sql, 'postgres')
    expect(ranges.map((r) => r.text.replace(/\s+/g, ' ').trim())).toEqual([
      'SELECT 1 /* outer /* inner ; */ still; outer */',
      'SELECT 2',
    ])
  })

  it('MySQL non-nested block: first */ closes even with nested-looking content', () => {
    // MySQL: /* outer /* inner ; */  closes at first */, then " still" is code...
    const sql = 'SELECT 1 /* a /* b ; */ SELECT 2'
    const ranges = splitSqlStatements(sql, 'mysql')
    expect(ranges).toHaveLength(1)
    expect(ranges[0].text).toContain('SELECT 2')
  })

  it('pure comment-only chunk is not an executable statement', () => {
    expect(splitSqlStatements('-- only\n; SELECT 1', 'mysql').map((r) => r.text)).toEqual([
      'SELECT 1',
    ])
    expect(splitSqlStatements('/* only */; SELECT 1', 'mysql').map((r) => r.text)).toEqual([
      'SELECT 1',
    ])
    expect(
      resolveRunSql({
        sql: '-- only comment',
        selectionStart: 0,
        selectionEnd: 0,
        scope: 'statement',
        dialect: 'mysql',
      }).reason,
    ).toBe('no-statement')
  })

  it('leading ordinary comment still kept with real statement', () => {
    const r = resolveRunSql({
      sql: '-- note\nSELECT 1; SELECT 2',
      selectionStart: 0,
      selectionEnd: 0,
      scope: 'statement',
      dialect: 'mysql',
    })
    expect(r.sql).toContain('-- note')
    expect(r.sql).toContain('SELECT 1')
  })

  it('resolveRunSql uses dialect for dollar-quote only under postgres', () => {
    const sql = 'DO $$ BEGIN PERFORM 1; END $$; SELECT 9'
    const pg = resolveRunSql({
      sql,
      selectionStart: 0,
      selectionEnd: 0,
      scope: 'statement',
      dialect: 'postgres',
    })
    expect(pg.sql).toContain('PERFORM 1;')
    expect(pg.sql).not.toContain('SELECT 9')
  })
})
