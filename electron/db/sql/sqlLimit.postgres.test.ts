import { describe, expect, it } from 'vitest'
import { isPostgresCursorSafe, planSqlRowLimit } from './sqlLimit'

/**
 * Planner + cursor-safety contract for PostgreSQL driver path.
 * Driver must not DECLARE CURSOR for multi-statement / SELECT INTO;
 * DML/DDL stay mode=none (no cursor, no LIMIT rewrite).
 */
describe('PostgreSQL row-limit plan contract', () => {
  it('DML/DDL never rewrite or stream', () => {
    for (const sql of [
      'UPDATE t SET a = 1',
      'INSERT INTO t VALUES (1)',
      'DELETE FROM t WHERE id = 1',
      'CREATE TABLE t (id int)',
      'DROP TABLE t',
      'ALTER TABLE t ADD COLUMN x int',
    ]) {
      expect(planSqlRowLimit(sql, 100).mode).toBe('none')
      expect(isPostgresCursorSafe(sql)).toBe(false)
    }
  })

  it('multi-statement is unsupported (driver must throw, not DECLARE CURSOR)', () => {
    const plan = planSqlRowLimit('SELECT 1; DELETE FROM t', 10)
    expect(plan.mode).toBe('unsupported')
    expect(isPostgresCursorSafe('SELECT 1; DELETE FROM t')).toBe(false)
  })

  it('SELECT INTO is plain (no cursor, no rewrite)', () => {
    const plan = planSqlRowLimit('SELECT id, name INTO archive FROM users', 50)
    expect(plan.mode).toBe('plain')
    expect(isPostgresCursorSafe('SELECT id, name INTO archive FROM users')).toBe(false)
  })

  it('OFFSET / FETCH stream and remain cursor-safe for simple SELECT', () => {
    expect(planSqlRowLimit('SELECT * FROM t OFFSET 5', 10).mode).toBe('stream')
    expect(isPostgresCursorSafe('SELECT * FROM t OFFSET 5')).toBe(true)
    expect(planSqlRowLimit('SELECT * FROM t FETCH FIRST 3 ROWS ONLY', 10).mode).toBe('stream')
    expect(isPostgresCursorSafe('SELECT * FROM t FETCH FIRST 3 ROWS ONLY')).toBe(true)
  })

  it('FOR UPDATE streams and is cursor-safe', () => {
    expect(planSqlRowLimit('SELECT * FROM t FOR UPDATE', 10).mode).toBe('stream')
    expect(isPostgresCursorSafe('SELECT * FROM t FOR UPDATE')).toBe(true)
  })

  it('WITH … DML is none and never cursor-safe', () => {
    const dml = [
      'WITH c AS (SELECT id FROM t) UPDATE t SET x = 1 WHERE id IN (SELECT id FROM c)',
      'WITH c AS (SELECT id FROM t) DELETE FROM t WHERE id IN (SELECT id FROM c)',
      'WITH c AS (SELECT 1 AS id) INSERT INTO t SELECT * FROM c',
    ]
    for (const sql of dml) {
      expect(planSqlRowLimit(sql, 100).mode).toBe('none')
      expect(isPostgresCursorSafe(sql)).toBe(false)
    }
  })

  it('WITH SELECT remains rewrite/cursor-safe', () => {
    const sql = 'WITH c AS (SELECT 1 AS x) SELECT * FROM c'
    expect(planSqlRowLimit(sql, 10).mode).toBe('rewrite')
    expect(isPostgresCursorSafe(sql)).toBe(true)
  })
})
