/** Lexical SQL statement ranges (string/comment/dollar-quote aware, dialect-aware). */

export type SqlStatementDialect = 'mysql' | 'postgres' | 'oracle'

export type SqlStatementRange = {
  /** Inclusive start of statement including leading comments/hints belonging to it */
  start: number
  /** Exclusive end (includes trailing semicolon if present) */
  end: number
  /**
   * Executable statement text without trailing semicolon.
   * Includes leading comments/hints that belong to this statement
   * (optimizer hints, MySQL executable comments, ordinary -- notes).
   */
  text: string
  /** Index of first non-trivia token (keyword/ident); for caret mapping only */
  coreStart: number
}

export type SplitSqlResult = {
  ranges: SqlStatementRange[]
  /** True if lexer finished inside an unclosed string/comment/dollar quote */
  ambiguous: boolean
}

export type SqlTxCommand = 'begin' | 'commit' | 'rollback' | 'other'

function normalizeDialect(d?: SqlStatementDialect): SqlStatementDialect {
  if (d === 'postgres' || d === 'oracle') return d
  return 'mysql'
}

/**
 * Detect PostgreSQL dollar-quote tag at position i.
 * Returns tag including surrounding $ (e.g. "$$", "$body$") or null.
 */
export function readDollarTag(sql: string, i: number): string | null {
  if (sql[i] !== '$') return null
  let j = i + 1
  while (j < sql.length) {
    const c = sql[j]
    if (c === '$') {
      return sql.slice(i, j + 1)
    }
    // tag: empty or [A-Za-z_][A-Za-z0-9_]*
    if (j === i + 1) {
      if (!(c === '_' || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z'))) {
        return null
      }
    } else if (
      !(c === '_' || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'))
    ) {
      return null
    }
    j += 1
  }
  return null
}

/**
 * Whether `--` at index i starts a line comment for the dialect.
 * - postgres: any `--` starts a comment
 * - mysql: second `-` must be followed by whitespace, control char, or EOF
 *   (so `SELECT 1--2` is subtraction, not a comment)
 */
export function isLineCommentStart(
  sql: string,
  i: number,
  dialect: SqlStatementDialect = 'mysql',
): boolean {
  if (sql[i] !== '-' || sql[i + 1] !== '-') return false
  // Postgres / Oracle: -- always starts a line comment
  if (dialect === 'postgres' || dialect === 'oracle') return true
  // MySQL: require space/control/EOF after `--`
  const after = sql[i + 2]
  if (after === undefined) return true
  // whitespace or ASCII control (incl. \n \r \t)
  const code = after.charCodeAt(0)
  return code <= 0x20
}

/**
 * Skip leading whitespace and pure comment trivia only.
 * Does NOT skip optimizer hints or MySQL executable comments — those remain part of the statement.
 */
function skipLeadingPureTrivia(
  sql: string,
  from: number,
  to: number,
  dialect: SqlStatementDialect,
): number {
  let s = from
  while (s < to) {
    while (s < to && /\s/.test(sql[s])) s += 1
    if (s >= to) break

    if (isLineCommentStart(sql, s, dialect)) {
      s += 2
      while (s < to && sql[s] !== '\n' && sql[s] !== '\r') s += 1
      continue
    }
    // MySQL # comments only
    if (dialect === 'mysql' && sql[s] === '#') {
      s += 1
      while (s < to && sql[s] !== '\n' && sql[s] !== '\r') s += 1
      continue
    }

    // block comments: keep /*+ hints and /*! executable comments
    if (sql[s] === '/' && sql[s + 1] === '*') {
      const after = sql[s + 2]
      if (after === '+' || after === '!') {
        break
      }
      s += 2
      if (dialect === 'postgres') {
        let depth = 1
        while (s < to && depth > 0) {
          if (sql[s] === '/' && sql[s + 1] === '*') {
            depth += 1
            s += 2
            continue
          }
          if (sql[s] === '*' && sql[s + 1] === '/') {
            depth -= 1
            s += 2
            continue
          }
          s += 1
        }
      } else {
        while (s < to) {
          if (sql[s] === '*' && sql[s + 1] === '/') {
            s += 2
            break
          }
          s += 1
        }
      }
      continue
    }
    break
  }
  return s
}

/**
 * Split SQL into statements by top-level semicolons.
 * Dialect affects `--` / `#` / nested `/* *​/` / dollar-quote handling.
 */
export function splitSqlStatementsDetailed(
  sql: string,
  dialect: SqlStatementDialect = 'mysql',
): SplitSqlResult {
  const d = normalizeDialect(dialect)
  if (!sql) return { ranges: [], ambiguous: false }

  const ranges: SqlStatementRange[] = []
  let i = 0
  const n = sql.length
  let stmtStart = 0
  let inSingle = false
  let inDouble = false
  let inBacktick = false
  let inLineComment: false | '--' | '#' = false
  let blockDepth = 0
  let dollarTag: string | null = null

  const pushRange = (from: number, to: number) => {
    let s = from
    while (s < to && /\s/.test(sql[s])) s += 1
    if (s >= to) return

    let e = to
    while (e > s && /\s/.test(sql[e - 1])) e -= 1
    if (e > s && sql[e - 1] === ';') {
      e -= 1
      while (e > s && /\s/.test(sql[e - 1])) e -= 1
    }
    const text = sql.slice(s, e).trim()
    if (!text) return

    const coreStart = skipLeadingPureTrivia(sql, s, e, d)
    // Pure comment-only chunk: not an executable statement
    if (coreStart >= e) return

    let rangeEnd = to
    while (rangeEnd > s && /\s/.test(sql[rangeEnd - 1])) rangeEnd -= 1
    ranges.push({ start: s, end: rangeEnd, text, coreStart })
  }

  while (i < n) {
    const c = sql[i]
    const next = sql[i + 1]

    if (dollarTag) {
      if (c === '$') {
        const maybe = sql.slice(i, i + dollarTag.length)
        if (maybe === dollarTag) {
          i += dollarTag.length
          dollarTag = null
          continue
        }
      }
      i += 1
      continue
    }

    if (inLineComment) {
      if (c === '\n' || c === '\r') {
        inLineComment = false
      }
      i += 1
      continue
    }

    if (blockDepth > 0) {
      if (d === 'postgres' && c === '/' && next === '*') {
        blockDepth += 1
        i += 2
        continue
      }
      if (c === '*' && next === '/') {
        blockDepth -= 1
        i += 2
        continue
      }
      i += 1
      continue
    }

    if (inSingle) {
      if (c === '\\' && i + 1 < n) {
        i += 2
        continue
      }
      if (c === "'") {
        if (next === "'") {
          i += 2
          continue
        }
        inSingle = false
      }
      i += 1
      continue
    }

    if (inDouble) {
      if (c === '\\' && i + 1 < n) {
        i += 2
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

    // Not in string/comment
    if (isLineCommentStart(sql, i, d)) {
      inLineComment = '--'
      i += 2
      continue
    }
    if (d === 'mysql' && c === '#') {
      inLineComment = '#'
      i += 1
      continue
    }
    if (c === '/' && next === '*') {
      blockDepth = 1
      i += 2
      continue
    }
    if (c === "'") {
      inSingle = true
      i += 1
      continue
    }
    if (c === '"') {
      inDouble = true
      i += 1
      continue
    }
    if (c === '`') {
      inBacktick = true
      i += 1
      continue
    }
    // Dollar quotes are a PostgreSQL feature; still scan for both dialects so
    // accidental $tag$ content does not false-split when mixed SQL is present.
    if (c === '$' && (d === 'postgres' || d === 'mysql')) {
      const tag = readDollarTag(sql, i)
      if (tag) {
        // Only treat as dollar-quote under postgres; under mysql `$` is not special
        if (d === 'postgres') {
          dollarTag = tag
          i += tag.length
          continue
        }
      }
    }

    if (c === ';') {
      pushRange(stmtStart, i + 1)
      stmtStart = i + 1
      i += 1
      continue
    }

    i += 1
  }

  const ambiguous = !!(inSingle || inDouble || inBacktick || blockDepth > 0 || dollarTag)
  if (!ambiguous && stmtStart < n) {
    pushRange(stmtStart, n)
  }

  return { ranges, ambiguous }
}

export function splitSqlStatements(
  sql: string,
  dialect: SqlStatementDialect = 'mysql',
): SqlStatementRange[] {
  return splitSqlStatementsDetailed(sql, dialect).ranges
}

/** True when SQL cannot be safely split into statements. */
export function isSqlLexicallyAmbiguous(
  sql: string,
  dialect: SqlStatementDialect = 'mysql',
): boolean {
  return splitSqlStatementsDetailed(sql, dialect).ambiguous
}

/**
 * Executable statement texts for a driver batch.
 * Throws when the lexer cannot safely split (unclosed string/comment).
 * Comment-only input falls back to the trimmed original so the server reports the error.
 */
export function splitExecutableSql(
  sql: string,
  dialect: SqlStatementDialect = 'mysql',
): string[] {
  const trimmed = sql.trim()
  if (!trimmed) return []
  const { ranges, ambiguous } = splitSqlStatementsDetailed(sql, dialect)
  if (ambiguous) {
    throw new Error('SQL contains an unclosed string or comment and cannot be split safely')
  }
  const statements = ranges.map((r) => r.text).filter((t) => t.length > 0)
  return statements.length > 0 ? statements : [trimmed]
}

/** Classify explicit transaction control statements (not DDL implicit commits). */
export function classifyTxStatement(
  sql: string,
  dialect: SqlStatementDialect = 'mysql',
): SqlTxCommand {
  const d = normalizeDialect(dialect)
  const core = sql.slice(skipLeadingPureTrivia(sql, 0, sql.length, d)).trim()
  if (!core) return 'other'

  if (/^commit\b/i.test(core)) return 'commit'

  if (/^rollback\b/i.test(core)) {
    if (/^rollback\s+to\b/i.test(core)) return 'other'
    return 'rollback'
  }
  if (d === 'postgres' && /^abort\b/i.test(core)) {
    if (/^abort\s+to\b/i.test(core)) return 'other'
    return 'rollback'
  }

  // Oracle BEGIN … END is PL/SQL, not a transaction start.
  if (d === 'oracle') {
    if (/^set\s+transaction\b/i.test(core)) return 'begin'
    return 'other'
  }

  if (/^start\s+transaction\b/i.test(core)) return 'begin'
  if (/^begin\b/i.test(core)) return 'begin'
  return 'other'
}

export function applyTxCommand(inTransaction: boolean, cmd: SqlTxCommand): boolean {
  if (cmd === 'begin') return true
  if (cmd === 'commit' || cmd === 'rollback') return false
  return inTransaction
}

export function previewSql(sql: string, max = 96): string {
  const one = sql.replace(/\s+/g, ' ').trim()
  if (one.length <= max) return one
  return `${one.slice(0, Math.max(1, max - 1))}…`
}
