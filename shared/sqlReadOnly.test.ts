import { describe, expect, it } from 'vitest'
import {
  assessSqlReadOnly,
  assertSqlAllowedInReadOnly,
  stripSqlForReadOnlyScan,
} from './sqlReadOnly'

describe('assessSqlReadOnly (shared)', () => {
  it('allows plain reads', () => {
    expect(assessSqlReadOnly('SELECT 1').allowed).toBe(true)
    expect(assessSqlReadOnly('SHOW TABLES').allowed).toBe(true)
    expect(assessSqlReadOnly('DESCRIBE users').allowed).toBe(true)
    expect(assessSqlReadOnly('EXPLAIN SELECT 1').allowed).toBe(true)
    expect(assessSqlReadOnly('WITH a AS (SELECT 1) SELECT * FROM a').allowed).toBe(true)
  })

  it('rejects DML/DDL/tx/procedure', () => {
    expect(assessSqlReadOnly('INSERT INTO t VALUES (1)').reason).toBe('write')
    expect(assessSqlReadOnly('DELETE FROM t').reason).toBe('write')
    expect(assessSqlReadOnly('CREATE TABLE t (id int)').reason).toBe('ddl')
    expect(assessSqlReadOnly('BEGIN').reason).toBe('transaction')
    expect(assessSqlReadOnly('CALL p()').reason).toBe('procedure')
  })

  it('MySQL --2 is subtraction so DELETE after is visible write', () => {
    const v = assessSqlReadOnly('SELECT 1--2; DELETE FROM t', 'mysql')
    expect(v.allowed).toBe(false)
    expect(v.reason).toBe('write')
  })

  it('MySQL -- comment with space hides rest of line (DELETE not executed as stmt)', () => {
    const v = assessSqlReadOnly('SELECT 1-- DELETE FROM t\n', 'mysql')
    expect(v.allowed).toBe(true)
  })

  it('PostgreSQL any -- starts comment (even without space after dashes)', () => {
    expect(assessSqlReadOnly('SELECT 1--2; DELETE FROM t', 'postgres').allowed).toBe(true)
    expect(assessSqlReadOnly('SELECT 1--2\n; DELETE FROM t', 'postgres').allowed).toBe(false)
    expect(assessSqlReadOnly('SELECT 1;\nDELETE FROM t', 'postgres').reason).toBe('write')
  })

  it('MySQL block comments do not nest — first */ ends comment, DELETE remains', () => {
    // Nested-looking: outer /* starts, first */ after "inner" closes; DELETE is code
    const sql = 'SELECT 1; /* outer /* inner */ DELETE FROM t; /* tail */'
    const { code } = stripSqlForReadOnlyScan(sql, 'mysql')
    expect(code.toLowerCase()).toContain('delete')
    const v = assessSqlReadOnly(sql, 'mysql')
    expect(v.allowed).toBe(false)
    expect(v.reason).toBe('write')
  })

  it('PostgreSQL nested block comments hide inner */ until outer closes', () => {
    const sql = 'SELECT 1; /* outer /* inner */ still comment */ SELECT 2'
    const v = assessSqlReadOnly(sql, 'postgres')
    expect(v.allowed).toBe(true)
  })

  it('MySQL executable comments /*! ... */ fail closed and expose DELETE', () => {
    const sql = 'SELECT 1; /*!50000 DELETE FROM t */'
    const v = assessSqlReadOnly(sql, 'mysql')
    expect(v.allowed).toBe(false)
    // body is visible → write preferred; else executable_comment/uncertain
    expect(['write', 'executable_comment', 'uncertain']).toContain(v.reason)
    const { code, sawExecutableComment } = stripSqlForReadOnlyScan(sql, 'mysql')
    expect(sawExecutableComment).toBe(true)
    expect(code.toLowerCase()).toContain('delete')
  })

  it('MariaDB /*M! ... */ executable comments fail closed', () => {
    const v = assessSqlReadOnly('SELECT 1; /*M!50000 UPDATE t SET a=1 */', 'mysql')
    expect(v.allowed).toBe(false)
  })

  it('optimizer hint /*+ ... */ is stripped and does not hide following write', () => {
    // hint only on SELECT — allowed
    expect(
      assessSqlReadOnly('SELECT /*+ INDEX(t i) */ * FROM t', 'mysql').allowed,
    ).toBe(true)
    // write after closed hint
    expect(
      assessSqlReadOnly('SELECT 1; /*+ INDEX(t i) */ DELETE FROM t', 'mysql').reason,
    ).toBe('write')
  })

  it('backslash-before-quote is fail-closed (does not hide DELETE) for mysql and postgres', () => {
    // If \\ were treated as escape, DELETE would sit inside the string
    const crafted = "SELECT 'x\\'; DELETE FROM t"
    for (const d of ['mysql', 'postgres'] as const) {
      const v = assessSqlReadOnly(crafted, d)
      expect(v.allowed).toBe(false)
      // either write (DELETE visible) or uncertain — never ok
      expect(v.reason === 'write' || v.reason === 'uncertain').toBe(true)
    }
  })

  it('doubled quotes remain normal and do not force uncertain alone', () => {
    expect(assessSqlReadOnly("SELECT 'it''s fine'", 'mysql').allowed).toBe(true)
    expect(assessSqlReadOnly("SELECT 'it''s fine'", 'postgres').allowed).toBe(true)
  })

  it('rejects SELECT INTO OUTFILE / DUMPFILE', () => {
    expect(assessSqlReadOnly("SELECT * FROM t INTO OUTFILE '/tmp/x'").reason).toBe(
      'side_effect_read',
    )
    expect(assessSqlReadOnly("SELECT 1 INTO DUMPFILE '/tmp/y'").reason).toBe('side_effect_read')
  })

  it('rejects FOR UPDATE / FOR SHARE / LOCK IN SHARE MODE', () => {
    expect(assessSqlReadOnly('SELECT * FROM t FOR UPDATE').reason).toBe('side_effect_read')
    expect(assessSqlReadOnly('SELECT * FROM t FOR SHARE', 'postgres').reason).toBe(
      'side_effect_read',
    )
    expect(assessSqlReadOnly('SELECT * FROM t LOCK IN SHARE MODE').reason).toBe('side_effect_read')
  })

  it('rejects EXPLAIN ANALYZE of DML', () => {
    expect(assessSqlReadOnly('EXPLAIN ANALYZE DELETE FROM t', 'postgres').allowed).toBe(false)
    expect(assessSqlReadOnly('EXPLAIN ANALYZE UPDATE t SET a=1', 'postgres').reason).toBe(
      'side_effect_read',
    )
  })

  it('allows plain EXPLAIN SELECT and plain SELECT', () => {
    expect(assessSqlReadOnly('EXPLAIN SELECT 1 FROM t').allowed).toBe(true)
    expect(assessSqlReadOnly('EXPLAIN (FORMAT TEXT) SELECT 1', 'postgres').allowed).toBe(true)
    expect(assessSqlReadOnly('SELECT id FROM users WHERE id = 1').allowed).toBe(true)
  })

  it('rejects modifying CTE', () => {
    const v = assessSqlReadOnly(
      'WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d',
      'postgres',
    )
    expect(v.allowed).toBe(false)
  })

  it('uncertain unclosed string fails closed', () => {
    expect(assessSqlReadOnly("SELECT 'oops").reason).toBe('uncertain')
  })

  it('assert throws DB_READONLY', () => {
    try {
      assertSqlAllowedInReadOnly('INSERT INTO t VALUES (1)')
      expect.unreachable()
    } catch (e: any) {
      expect(e.code).toBe('DB_READONLY')
    }
  })

  it('strip dialect: MySQL keeps --2 as code', () => {
    const { code } = stripSqlForReadOnlyScan('SELECT 1--2; DELETE FROM t', 'mysql')
    expect(code.toLowerCase()).toContain('delete')
  })
})
