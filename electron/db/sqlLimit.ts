/**
 * Safe SELECT row limiting for large result sets.
 * Only rewrites simple single-statement SELECT/WITH queries without an existing
 * LIMIT / OFFSET / FETCH, and without trailing clauses where LIMIT cannot be appended.
 */

export type SqlLimitPlan =
  | { mode: 'rewrite'; sql: string }
  | { mode: 'stream' }
  /** Execute as-is: no LIMIT rewrite, no cursor/stream (e.g. SELECT INTO). */
  | { mode: 'plain' }
  /** SELECT-like but not safe to run via rewrite/cursor/stream. */
  | { mode: 'unsupported'; error: string }
  | { mode: 'none' }

type LexState = 'code' | 'single' | 'double' | 'backtick' | 'lineComment' | 'blockComment'

/**
 * Single-pass lexer: strip -- and /* *\/ comments while preserving string/identifier contents.
 * Does not treat comment markers inside quotes as comments.
 */
export function stripSqlComments(sql: string): string {
  let out = ''
  let state: LexState = 'code'
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]
    const next = i + 1 < sql.length ? sql[i + 1] : ''

    if (state === 'lineComment') {
      if (ch === '\n' || ch === '\r') {
        state = 'code'
        out += ch
      }
      continue
    }

    if (state === 'blockComment') {
      if (ch === '*' && next === '/') {
        state = 'code'
        out += ' '
        i++
      }
      continue
    }

    if (state === 'single') {
      out += ch
      if (ch === "'" && next === "'") {
        out += next
        i++
        continue
      }
      if (ch === "'") state = 'code'
      continue
    }

    if (state === 'double') {
      out += ch
      if (ch === '"' && next === '"') {
        out += next
        i++
        continue
      }
      if (ch === '"') state = 'code'
      continue
    }

    if (state === 'backtick') {
      out += ch
      if (ch === '`' && next === '`') {
        out += next
        i++
        continue
      }
      if (ch === '`') state = 'code'
      continue
    }

    // code
    if (ch === "'" ) {
      state = 'single'
      out += ch
      continue
    }
    if (ch === '"') {
      state = 'double'
      out += ch
      continue
    }
    if (ch === '`') {
      state = 'backtick'
      out += ch
      continue
    }
    if (ch === '-' && next === '-') {
      // SQL line comment: -- must start a comment token (ANSI / common engines)
      state = 'lineComment'
      i++
      continue
    }
    if (ch === '/' && next === '*') {
      state = 'blockComment'
      i++
      continue
    }
    out += ch
  }
  return out
}

function stripTrailingSemicolons(sql: string): string {
  return sql.replace(/;+\s*$/g, '').trim()
}

/**
 * Walk SQL outside of strings (comments already stripped or handled by stripSqlComments).
 * Prefer calling on analysis text from stripSqlComments.
 */
function forEachOutsideString(
  sql: string,
  onOutside: (ch: string, index: number, sql: string) => void | boolean,
): void {
  let inSingle = false
  let inDouble = false
  let inBacktick = false
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]
    if (ch === "'" && !inDouble && !inBacktick) {
      if (inSingle && sql[i + 1] === "'") {
        i++
        continue
      }
      inSingle = !inSingle
      continue
    }
    if (ch === '"' && !inSingle && !inBacktick) {
      if (inDouble && sql[i + 1] === '"') {
        i++
        continue
      }
      inDouble = !inDouble
      continue
    }
    if (ch === '`' && !inSingle && !inDouble) {
      if (inBacktick && sql[i + 1] === '`') {
        i++
        continue
      }
      inBacktick = !inBacktick
      continue
    }
    if (inSingle || inDouble || inBacktick) continue
    if (onOutside(ch, i, sql) === false) return
  }
}

function hasMultipleStatements(sql: string): boolean {
  const body = stripTrailingSemicolons(sql)
  let found = false
  forEachOutsideString(body, (ch) => {
    if (ch === ';') {
      found = true
      return false
    }
  })
  return found
}

function matchKeywordAt(sql: string, index: number, keyword: string): boolean {
  const len = keyword.length
  if (index + len > sql.length) return false
  if (sql.slice(index, index + len).toLowerCase() !== keyword.toLowerCase()) return false
  const before = index === 0 ? '' : sql[index - 1]
  const after = index + len >= sql.length ? '' : sql[index + len]
  if (before && /[A-Za-z0-9_$]/.test(before)) return false
  if (after && /[A-Za-z0-9_$]/.test(after)) return false
  return true
}

function skipWs(sql: string, i: number): number {
  while (i < sql.length && /\s/.test(sql[i])) i++
  return i
}

/** Read an identifier at i (letters/digits/_/$ or quoted). Returns end index or -1. */
function readIdentEnd(sql: string, i: number): number {
  if (i >= sql.length) return -1
  const ch = sql[i]
  if (ch === '"' || ch === '`' || ch === '[') {
    const close = ch === '[' ? ']' : ch
    i++
    while (i < sql.length) {
      if (sql[i] === close) {
        if (close !== ']' && sql[i + 1] === close) {
          i += 2
          continue
        }
        return i + 1
      }
      i++
    }
    return -1
  }
  if (!/[A-Za-z_$@]/.test(ch)) return -1
  i++
  while (i < sql.length && /[A-Za-z0-9_$@]/.test(sql[i])) i++
  return i
}

/**
 * Skip a balanced (...) group starting at `i` (must be '(').
 * Respects strings; comments already stripped from analysis text.
 * Returns index after closing ')' or -1 if unbalanced.
 */
function skipBalancedParen(sql: string, i: number): number {
  if (sql[i] !== '(') return -1
  let depth = 0
  let inSingle = false
  let inDouble = false
  let inBacktick = false
  for (; i < sql.length; i++) {
    const ch = sql[i]
    if (ch === "'" && !inDouble && !inBacktick) {
      if (inSingle && sql[i + 1] === "'") {
        i++
        continue
      }
      inSingle = !inSingle
      continue
    }
    if (ch === '"' && !inSingle && !inBacktick) {
      if (inDouble && sql[i + 1] === '"') {
        i++
        continue
      }
      inDouble = !inDouble
      continue
    }
    if (ch === '`' && !inSingle && !inDouble) {
      if (inBacktick && sql[i + 1] === '`') {
        i++
        continue
      }
      inBacktick = !inBacktick
      continue
    }
    if (inSingle || inDouble || inBacktick) continue
    if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0) return i + 1
    }
  }
  return -1
}

type TopLevelKind = 'select' | 'dml' | 'other' | 'unknown'

const DML_HEAD =
  /^(insert|update|delete|merge|replace|call|do|truncate|create|drop|alter|grant|revoke|set|show|use|explain|describe|desc|analyze|vacuum|copy|begin|commit|rollback|start|savepoint|release|lock|unlock|prepare|execute|deallocate|values)\b/i

/**
 * Classify top-level statement after comments stripped.
 * WITH / WITH RECURSIVE: skip CTE list (parens/strings) and classify the main statement.
 * Leading parens before SELECT are peeled for classification (caller may still stream).
 */
export function classifyTopLevelStatement(sql: string): {
  kind: TopLevelKind
  /** True if analysis required peeling leading '(' before seeing SELECT/WITH */
  leadingParens: boolean
} {
  let s = sql.trim()
  let leadingParens = false
  while (s.startsWith('(')) {
    leadingParens = true
    s = s.slice(1).trim()
  }
  if (!s) return { kind: 'unknown', leadingParens }

  if (/^select\b/i.test(s)) return { kind: 'select', leadingParens }

  if (!/^with\b/i.test(s)) {
    if (DML_HEAD.test(s)) return { kind: 'dml', leadingParens }
    return { kind: 'other', leadingParens }
  }

  // Parse WITH [RECURSIVE] cte [, cte]* <main>
  let i = skipWs(s, 4) // after "with"
  if (matchKeywordAt(s, i, 'recursive')) {
    i = skipWs(s, i + 9)
  }

  // At least one CTE
  for (;;) {
    i = skipWs(s, i)
    const nameEnd = readIdentEnd(s, i)
    if (nameEnd < 0) return { kind: 'unknown', leadingParens }
    i = skipWs(s, nameEnd)

    // optional column list
    if (s[i] === '(') {
      i = skipBalancedParen(s, i)
      if (i < 0) return { kind: 'unknown', leadingParens }
      i = skipWs(s, i)
    }

    if (!matchKeywordAt(s, i, 'as')) return { kind: 'unknown', leadingParens }
    i = skipWs(s, i + 2)

    // optional MATERIALIZED / NOT MATERIALIZED (Postgres)
    if (matchKeywordAt(s, i, 'not')) {
      const j = skipWs(s, i + 3)
      if (matchKeywordAt(s, j, 'materialized')) {
        i = skipWs(s, j + 12)
      }
    } else if (matchKeywordAt(s, i, 'materialized')) {
      i = skipWs(s, i + 12)
    }

    if (s[i] !== '(') return { kind: 'unknown', leadingParens }
    i = skipBalancedParen(s, i)
    if (i < 0) return { kind: 'unknown', leadingParens }
    i = skipWs(s, i)

    if (s[i] === ',') {
      i++
      continue
    }
    break
  }

  i = skipWs(s, i)
  if (i >= s.length) return { kind: 'unknown', leadingParens }

  // Main statement keyword
  if (matchKeywordAt(s, i, 'select')) return { kind: 'select', leadingParens }
  if (
    matchKeywordAt(s, i, 'insert') ||
    matchKeywordAt(s, i, 'update') ||
    matchKeywordAt(s, i, 'delete') ||
    matchKeywordAt(s, i, 'merge') ||
    matchKeywordAt(s, i, 'replace')
  ) {
    return { kind: 'dml', leadingParens }
  }
  // Unrecognized main after WITH — do not treat as SELECT
  return { kind: 'unknown', leadingParens }
}

/** LIMIT / OFFSET / FETCH FIRST|NEXT already present → do not append LIMIT. */
function hasExistingRowLimiter(sql: string): boolean {
  let found = false
  forEachOutsideString(sql, (_ch, i, body) => {
    if (matchKeywordAt(body, i, 'limit')) {
      const rest = body.slice(i + 5).match(/^\s+(\d+|[@?:$])/i)
      if (rest) {
        found = true
        return false
      }
    }
    // Standalone OFFSET n (with or without LIMIT elsewhere)
    if (matchKeywordAt(body, i, 'offset')) {
      const rest = body.slice(i + 6).match(/^\s+(\d+|[@?:$])/i)
      if (rest) {
        found = true
        return false
      }
    }
    // FETCH FIRST / FETCH NEXT (SQL:2008 / Postgres)
    if (matchKeywordAt(body, i, 'fetch')) {
      const rest = body.slice(i + 5).match(/^\s+(first|next)\b/i)
      if (rest) {
        found = true
        return false
      }
    }
  })
  return found
}

/**
 * Clauses unsafe for trailing LIMIT rewrite.
 * - Locking: FOR UPDATE / SHARE / …, LOCK IN SHARE MODE
 * - INTO OUTFILE/DUMPFILE/@var / SELECT INTO table
 */
function classifySpecialSelect(sql: string): 'lock' | 'into_outfile' | 'into_table' | null {
  let kind: 'lock' | 'into_outfile' | 'into_table' | null = null
  forEachOutsideString(sql, (_ch, i, body) => {
    if (matchKeywordAt(body, i, 'for')) {
      const rest = body.slice(i + 3).match(
        /^\s+(update|share|no\s+key\s+update|key\s+share)\b/i,
      )
      if (rest) {
        kind = 'lock'
        return false
      }
    }
    if (matchKeywordAt(body, i, 'lock')) {
      const rest = body.slice(i + 4).match(/^\s+in\s+share\s+mode\b/i)
      if (rest) {
        kind = 'lock'
        return false
      }
    }
    if (matchKeywordAt(body, i, 'into')) {
      const rest = body.slice(i + 4).match(/^\s+(outfile|dumpfile|@)\b/i)
      if (rest) {
        kind = 'into_outfile'
        return false
      }
      const intoIdent = body.slice(i + 4).match(/^\s+([A-Za-z_"`][\w."`]*)/i)
      if (intoIdent && !/^(outfile|dumpfile)$/i.test(intoIdent[1])) {
        kind = 'into_table'
        return false
      }
    }
  })
  return kind
}

export type SqlLimitDialect = 'mysql' | 'postgres' | 'oracle'

/**
 * Decide how to cap rows for a query.
 * - rewrite: append LIMIT (mysql/pg) or FETCH FIRST (oracle) when safe
 * - stream: SELECT-like, cap via driver stream/cursor
 * - plain: run as-is (no rewrite/cursor) — e.g. SELECT INTO
 * - unsupported: refuse with explicit error (multi-statement SELECT)
 * - none: DML/DDL (including WITH … UPDATE/DELETE/INSERT)
 */
export function planSqlRowLimit(
  sql: string,
  maxRows: number,
  dialect: SqlLimitDialect = 'mysql',
): SqlLimitPlan {
  const trimmed = sql.trim()
  if (!trimmed) return { mode: 'none' }

  const forAnalysis = stripSqlComments(trimmed)
  const top = classifyTopLevelStatement(forAnalysis)

  // WITH … DML, plain DML/DDL, or unparseable WITH — never LIMIT/cursor
  if (top.kind === 'dml' || top.kind === 'other') return { mode: 'none' }
  if (top.kind === 'unknown') {
    // Cannot safely prove SELECT main clause (malformed WITH, etc.)
    return { mode: 'none' }
  }
  // top.kind === 'select'

  if (hasMultipleStatements(forAnalysis)) {
    return {
      mode: 'unsupported',
      error:
        'Multiple SQL statements in one query are not supported for result limiting/streaming',
    }
  }

  const special = classifySpecialSelect(forAnalysis)
  // SELECT INTO table: side-effecting, not a client result set; cannot cursor/LIMIT-append
  if (special === 'into_table') return { mode: 'plain' }
  // INTO OUTFILE/DUMPFILE: stream path on MySQL; PG will refuse cursor and run plain or error
  if (special === 'into_outfile') return { mode: 'stream' }
  if (special === 'lock') return { mode: 'stream' }

  if (hasExistingRowLimiter(forAnalysis)) return { mode: 'stream' }

  // Leading parens (((SELECT …))) — dialect-dependent for trailing LIMIT; conservatively stream
  if (top.leadingParens) return { mode: 'stream' }

  const core = stripTrailingSemicolons(trimmed)
  const limit = Math.max(1, Math.floor(maxRows) + 1)
  if (dialect === 'oracle') {
    // Oracle 12c+; LIMIT is not valid SQL
    return { mode: 'rewrite', sql: `${core}\nFETCH FIRST ${limit} ROWS ONLY` }
  }
  return { mode: 'rewrite', sql: `${core}\nLIMIT ${limit}` }
}

/** True when PostgreSQL DECLARE CURSOR FOR <sql> is expected to be valid. */
export function isPostgresCursorSafe(sql: string): boolean {
  const forAnalysis = stripSqlComments(sql.trim())
  const top = classifyTopLevelStatement(forAnalysis)
  if (top.kind !== 'select') return false
  if (hasMultipleStatements(forAnalysis)) return false
  const special = classifySpecialSelect(forAnalysis)
  if (special === 'into_table' || special === 'into_outfile') return false
  return true
}
