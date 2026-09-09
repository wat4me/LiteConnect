import { describe, expect, it } from 'vitest'
import {
  applyTxCommand,
  classifyTxStatement,
  splitExecutableSql,
  splitSqlStatements,
} from './sqlStatement'

describe('splitExecutableSql', () => {
  it('splits a MySQL script with TX + INSERT + COMMIT + ALTER', () => {
    const sql = `
START TRANSACTION;

INSERT INTO t (id) SELECT 1 FROM dual
WHERE x REGEXP '^-?[0-9]+$'
ORDER BY id
LIMIT 18446744073709551615;

COMMIT;

-- 注意：MySQL 5.7 的 DDL 会隐式提交，以下字段变更作为一个 ALTER TABLE 语句执行。
ALTER TABLE t
    ADD COLUMN access_type SMALLINT NOT NULL DEFAULT 0,
    MODIFY COLUMN provider_model_id BIGINT NULL;
`
    const statements = splitExecutableSql(sql, 'mysql')
    expect(statements).toHaveLength(4)
    expect(statements[0]).toMatch(/^START TRANSACTION$/i)
    expect(statements[1]).toMatch(/^INSERT INTO t/i)
    expect(statements[1]).toContain("REGEXP '^-?[0-9]+$'")
    expect(statements[2]).toMatch(/^COMMIT$/i)
    expect(statements[3]).toMatch(/ALTER TABLE t/i)
    expect(statements[3]).toContain('-- 注意')
  })

  it('does not split on semicolons inside strings or backticks', () => {
    const statements = splitExecutableSql(
      "INSERT INTO t (`a;b`) VALUES ('x;y'); SELECT 2",
      'mysql',
    )
    expect(statements).toHaveLength(2)
    expect(statements[0]).toContain('`a;b`')
    expect(statements[0]).toContain("'x;y'")
  })

  it('throws on unclosed string', () => {
    expect(() => splitExecutableSql("SELECT 'abc", 'mysql')).toThrow(/unclosed/i)
  })
})

describe('classifyTxStatement', () => {
  it('detects MySQL / Postgres begin and commit', () => {
    expect(classifyTxStatement('START TRANSACTION', 'mysql')).toBe('begin')
    expect(classifyTxStatement('BEGIN', 'mysql')).toBe('begin')
    expect(classifyTxStatement('-- note\nCOMMIT', 'mysql')).toBe('commit')
    expect(classifyTxStatement('ROLLBACK', 'postgres')).toBe('rollback')
    expect(classifyTxStatement('ABORT', 'postgres')).toBe('rollback')
    expect(classifyTxStatement('ROLLBACK TO SAVEPOINT s1', 'mysql')).toBe('other')
  })

  it('does not treat Oracle BEGIN as a transaction start', () => {
    expect(classifyTxStatement('BEGIN NULL; END', 'oracle')).toBe('other')
    expect(classifyTxStatement('SET TRANSACTION READ WRITE', 'oracle')).toBe('begin')
  })

  it('applyTxCommand tracks open TX', () => {
    expect(applyTxCommand(false, 'begin')).toBe(true)
    expect(applyTxCommand(true, 'commit')).toBe(false)
    expect(applyTxCommand(true, 'other')).toBe(true)
  })
})

describe('splitSqlStatements (shared)', () => {
  it('returns the same ranges as the editor splitter', () => {
    expect(splitSqlStatements('SELECT 1; SELECT 2').map((r) => r.text)).toEqual([
      'SELECT 1',
      'SELECT 2',
    ])
  })
})
