/**
 * Single-source SQL read-only classification (renderer + main).
 * Fail closed on ambiguous / multi-statement / side-effect cases.
 *
 * Comment / string rules (documented):
 * - MySQL -- only when 2nd dash is followed by whitespace/control/EOF.
 * - PostgreSQL: any -- starts a line comment.
 * - MySQL block comments end at the first star-slash; they do NOT nest.
 * - PostgreSQL block comments nest.
 * - MySQL/MariaDB executable comments (! and M!) are NOT stripped
 *   (body remains visible / fail-closed).
 * - Optimizer hints (+ after slash-star) are stripped as ordinary comments.
 * - Backslash-before-quote is dialect-ambiguous (MySQL escapes, PG standard
 *   strings, E-strings / NO_BACKSLASH_ESCAPES). We never silently treat
 *   backslash as an escape that would hide later SQL: the quote ends the
 *   string and uncertain is set when backslash immediately precedes a closing quote.
 */

export type SqlReadOnlyDialect = 'mysql' | 'postgres'

export type SqlReadOnlyVerdict = {
  allowed: boolean
  reason:
    | 'ok'
    | 'empty'
    | 'uncertain'
    | 'write'
    | 'ddl'
    | 'transaction'
    | 'procedure'
    | 'modifying_cte'
    | 'side_effect_read'
    | 'executable_comment'
    | 'unknown'
  summary: string
}

const WRITE_HEAD = new Set([
  'insert',
  'update',
  'delete',
  'replace',
  'merge',
  'upsert',
  'load',
  'import',
  'export',
  'copy',
  'truncate',
  'call',
  'do',
  'execute',
  'exec',
  'handler',
  'lock',
  'unlock',
  'grant',
  'revoke',
  'analyze',
  'vacuum',
  'reindex',
  'cluster',
  'refresh',
  'set',
  'reset',
  'use',
  'start',
  'begin',
  'commit',
  'rollback',
  'savepoint',
  'release',
  'prepare',
  'deallocate',
  'declare',
  'fetch',
  'open',
  'close',
  'listen',
  'notify',
  'unlisten',
  'discard',
  'checkpoint',
])

const DDL_HEAD = new Set([
  'create',
  'alter',
  'drop',
  'rename',
  'comment',
  'attach',
  'detach',
])

const READ_HEAD = new Set([
  'select',
  'show',
  'describe',
  'desc',
  'explain',
  'with',
  'values',
  'table',
])

/** MySQL: -- comment only if second dash followed by whitespace/control/EOF */
function isMySqlLineCommentStart(sql: string, i: number): boolean {
  if (sql[i] !== '-' || sql[i + 1] !== '-') return false
  const after = sql[i + 2]
  if (after === undefined) return true
  return after.charCodeAt(0) <= 0x20
}

function isPgLineCommentStart(sql: string, i: number): boolean {
  return sql[i] === '-' && sql[i + 1] === '-'
}

function readDollarTag(sql: string, at: number): string | null {
  if (sql[at] !== '$') return null
  let j = at + 1
  const n = sql.length
  while (j < n) {
    if (sql[j] === '$') return sql.slice(at, j + 1)
    const c = sql[j]
    if (j === at + 1) {
      if (!(c === '_' || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z'))) return null
    } else if (
      !(c === '_' || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'))
    ) {
      return null
    }
    j += 1
  }
  return null
}

// MySQL/MariaDB executable comment openers after slash-star
function isExecutableCommentOpener(sql: string, afterStar: number): boolean {
  // bang after slash-star, or M-bang (optional version digits)
  if (sql[afterStar] === '!') return true
  if (
    (sql[afterStar] === 'M' || sql[afterStar] === 'm') &&
    sql[afterStar + 1] === '!'
  ) {
    return true
  }
  return false
}

function isOptimizerHintOpener(sql: string, afterStar: number): boolean {
  return sql[afterStar] === '+'
}

/**
 * Strip strings/comments with dialect-aware rules.
 * Returns skeleton code for keyword scan + uncertain flag.
 */
export function stripSqlForReadOnlyScan(
  sql: string,
  dialect: SqlReadOnlyDialect = 'mysql',
): { code: string; uncertain: boolean; sawExecutableComment: boolean } {
  let out = ''
  let i = 0
  const n = sql.length
  let uncertain = false
  let sawExecutableComment = false
  let inSingle = false
  let inDouble = false
  let inBacktick = false
  let inLine = false
  /** PG: nesting depth. MySQL: 0 or 1 only (non-nested). */
  let blockDepth = 0
  let dollarTag: string | null = null
  const isLineComment =
    dialect === 'postgres' ? isPgLineCommentStart : isMySqlLineCommentStart

  while (i < n) {
    const c = sql[i]
    const next = sql[i + 1]

    if (dollarTag) {
      if (c === '$' && sql.slice(i, i + dollarTag.length) === dollarTag) {
        out += ' '
        i += dollarTag.length
        dollarTag = null
        continue
      }
      i += 1
      continue
    }

    if (inLine) {
      if (c === '\n' || c === '\r') {
        inLine = false
        out += c
      }
      i += 1
      continue
    }

    if (blockDepth > 0) {
      if (dialect === 'postgres' && c === '/' && next === '*') {
        blockDepth += 1
        i += 2
        continue
      }
      // MySQL: ignore nested slash-star; first star-slash closes (do not increment depth)
      if (c === '*' && next === '/') {
        blockDepth -= 1
        i += 2
        continue
      }
      i += 1
      continue
    }

    if (inSingle) {
      // Conservative: never silently treat \ as escape that hides later SQL.
      // If \ precedes a quote, mark uncertain; still let the quote end the string.
      if (c === '\\' && (next === "'" || next === '"' || next === '\\')) {
        uncertain = true
        out += ' '
        // Do not skip next char — if next is quote, fall through to close string
        i += 1
        continue
      }
      if (c === "'") {
        if (next === "'") {
          // doubled quote escape (unambiguous)
          i += 2
          continue
        }
        inSingle = false
      }
      i += 1
      continue
    }

    if (inDouble) {
      if (c === '\\' && (next === '"' || next === "'" || next === '\\')) {
        uncertain = true
        out += ' '
        i += 1
        continue
      }
      if (c === '"') {
        if (next === '"') {
          i += 2
          continue
        }
        inDouble = false
      }
      i += 1
      continue
    }

    if (inBacktick) {
      if (c === '`') {
        if (next === '`') {
          i += 2
          continue
        }
        inBacktick = false
      }
      i += 1
      continue
    }

    // --- not in string/comment ---
    if (isLineComment(sql, i)) {
      inLine = true
      i += 2
      continue
    }
    if (dialect === 'mysql' && c === '#') {
      inLine = true
      i += 1
      continue
    }

    if (c === '/' && next === '*') {
      const after = i + 2
      if (isExecutableCommentOpener(sql, after)) {
        // Fail closed: do not strip body — leave SQL visible for classification
        sawExecutableComment = true
        uncertain = true
        out += ' '
        i += 2 // skip /*
        // skip ! or M!
        if (sql[i] === '!' || sql[i] === 'M' || sql[i] === 'm') {
          if (sql[i] === '!') i += 1
          else i += 2 // M!
          // optional version digits
          while (i < n && sql[i] >= '0' && sql[i] <= '9') i += 1
        }
        // copy body until star-slash closer
        while (i < n) {
          if (sql[i] === '*' && sql[i + 1] === '/') {
            i += 2
            out += ' '
            break
          }
          out += sql[i]
          i += 1
        }
        continue
      }
      if (isOptimizerHintOpener(sql, after)) {
        // plus-hint after slash-star: pure optimizer hint, strip as comment (MySQL non-nested)
        i += 2
        while (i < n) {
          if (sql[i] === '*' && sql[i + 1] === '/') {
            i += 2
            break
          }
          i += 1
        }
        out += ' '
        continue
      }
      // Ordinary block comment
      if (dialect === 'postgres') {
        blockDepth = 1
        i += 2
        continue
      }
      // MySQL: non-nested — scan to first star-slash
      i += 2
      while (i < n) {
        if (sql[i] === '*' && sql[i + 1] === '/') {
          i += 2
          break
        }
        i += 1
      }
      out += ' '
      continue
    }

    if (c === "'") {
      inSingle = true
      out += ' '
      i += 1
      continue
    }
    if (c === '"') {
      inDouble = true
      out += ' '
      i += 1
      continue
    }
    if (c === '`') {
      inBacktick = true
      out += ' '
      i += 1
      continue
    }
    if (dialect === 'postgres' && c === '$') {
      const tag = readDollarTag(sql, i)
      if (tag) {
        dollarTag = tag
        out += ' '
        i += tag.length
        continue
      }
    }
    out += c
    i += 1
  }

  if (inSingle || inDouble || inBacktick || blockDepth > 0 || dollarTag) {
    uncertain = true
  }
  return { code: out, uncertain, sawExecutableComment }
}

function splitStatements(code: string): string[] {
  return code
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function firstWord(stmt: string): string {
  const m = stmt.match(/[A-Za-z_]+/)
  return m ? m[0].toLowerCase() : ''
}

function hasModifyingCte(stmt: string): boolean {
  const lower = stmt.toLowerCase()
  if (!lower.startsWith('with')) return false
  return /\b(insert|update|delete|replace)\b/.test(lower.slice(4))
}

/** Side-effect "reads" that must fail closed in readonly mode. */
function hasSideEffectReadClause(stmt: string, _dialect: SqlReadOnlyDialect): boolean {
  void _dialect
  const s = stmt.toLowerCase().replace(/\s+/g, ' ')

  if (/\binto\s+(outfile|dumpfile)\b/.test(s)) return true
  if (/\bselect\b[\s\S]*\binto\b/.test(s)) return true

  if (/\bfor\s+update\b/.test(s)) return true
  if (/\bfor\s+share\b/.test(s)) return true
  if (/\block\s+in\s+share\s+mode\b/.test(s)) return true
  if (/\bfor\s+no\s+key\s+update\b/.test(s)) return true
  if (/\bfor\s+key\s+share\b/.test(s)) return true

  if (/^explain\b/.test(s)) {
    let body = s.replace(/^explain\b/, '').trim()
    let analyze = false
    if (body.startsWith('(')) {
      const close = body.indexOf(')')
      if (close >= 0) {
        const opts = body.slice(1, close)
        if (/\banalyze\b/.test(opts)) analyze = true
        body = body.slice(close + 1).trim()
      }
    } else if (/^analyze\b/.test(body)) {
      analyze = true
      body = body.replace(/^analyze\b/, '').trim()
      if (/^(true|false|on|off)\b/.test(body)) {
        body = body.replace(/^(true|false|on|off)\b/, '').trim()
      }
    }
    if (analyze) {
      const h = firstWord(body)
      if (!h) return true
      if (WRITE_HEAD.has(h) || DDL_HEAD.has(h)) return true
      if (h === 'with' && hasModifyingCte(body)) return true
    }
  }

  return false
}

function classifyOneStatement(stmt: string, dialect: SqlReadOnlyDialect): SqlReadOnlyVerdict {
  if (hasSideEffectReadClause(stmt, dialect)) {
    return {
      allowed: false,
      reason: 'side_effect_read',
      summary:
        'Statement has side effects (locks, file export, EXPLAIN ANALYZE write, etc.) and is not allowed in read-only mode',
    }
  }

  const head = firstWord(stmt)
  if (!head) {
    return { allowed: false, reason: 'empty', summary: 'Empty statement' }
  }
  if (WRITE_HEAD.has(head)) {
    if (
      head === 'begin' ||
      head === 'commit' ||
      head === 'rollback' ||
      head === 'start' ||
      head === 'savepoint' ||
      head === 'release'
    ) {
      return {
        allowed: false,
        reason: 'transaction',
        summary: 'Transaction control is not allowed in read-only mode',
      }
    }
    if (head === 'call' || head === 'do' || head === 'execute' || head === 'exec') {
      return {
        allowed: false,
        reason: 'procedure',
        summary: 'Procedure/DO execution is not allowed in read-only mode',
      }
    }
    return {
      allowed: false,
      reason: 'write',
      summary: `Write or side-effect statement (${head.toUpperCase()}) is not allowed in read-only mode`,
    }
  }
  if (DDL_HEAD.has(head)) {
    return {
      allowed: false,
      reason: 'ddl',
      summary: `DDL (${head.toUpperCase()}) is not allowed in read-only mode`,
    }
  }
  if (head === 'with') {
    if (hasModifyingCte(stmt)) {
      return {
        allowed: false,
        reason: 'modifying_cte',
        summary: 'Modifying CTE is not allowed in read-only mode',
      }
    }
    if (!/\bselect\b/i.test(stmt)) {
      return {
        allowed: false,
        reason: 'unknown',
        summary: 'CTE without SELECT is not allowed in read-only mode',
      }
    }
    return { allowed: true, reason: 'ok', summary: 'OK' }
  }
  if (head === 'explain') {
    return { allowed: true, reason: 'ok', summary: 'OK' }
  }
  if (READ_HEAD.has(head)) {
    return { allowed: true, reason: 'ok', summary: 'OK' }
  }
  return {
    allowed: false,
    reason: 'unknown',
    summary: `Statement type (${head.toUpperCase()}) is not allowed in read-only mode`,
  }
}

export function assessSqlReadOnly(
  sql: string,
  dialect: SqlReadOnlyDialect = 'mysql',
): SqlReadOnlyVerdict {
  if (!sql || !sql.trim()) {
    return { allowed: false, reason: 'empty', summary: 'Empty SQL' }
  }
  const { code, uncertain, sawExecutableComment } = stripSqlForReadOnlyScan(sql, dialect)

  // Executable comments always fail closed even if body looked like SELECT-only
  if (sawExecutableComment) {
    // Still classify body — if write visible, report write; else executable_comment/uncertain
    if (!uncertain) {
      const stmts = splitStatements(code)
      for (const stmt of stmts) {
        const v = classifyOneStatement(stmt, dialect)
        if (!v.allowed && v.reason !== 'empty') return v
      }
    }
    return {
      allowed: false,
      reason: uncertain ? 'uncertain' : 'executable_comment',
      summary:
        'MySQL/MariaDB executable version comments are not allowed in read-only mode',
    }
  }

  if (uncertain) {
    return {
      allowed: false,
      reason: 'uncertain',
      summary: 'SQL structure is ambiguous; not allowed in read-only mode',
    }
  }
  const stmts = splitStatements(code)
  if (stmts.length === 0) {
    return { allowed: false, reason: 'empty', summary: 'Empty SQL' }
  }
  for (const stmt of stmts) {
    const v = classifyOneStatement(stmt, dialect)
    if (!v.allowed) return v
  }
  return { allowed: true, reason: 'ok', summary: 'OK' }
}

export function assertSqlAllowedInReadOnly(
  sql: string,
  dialect: SqlReadOnlyDialect = 'mysql',
): void {
  const v = assessSqlReadOnly(sql, dialect)
  if (!v.allowed) {
    const err = new Error(v.summary)
    ;(err as Error & { code?: string }).code = 'DB_READONLY'
    throw err
  }
}
