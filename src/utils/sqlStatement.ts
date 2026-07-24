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

export type RunScope = 'selection' | 'statement' | 'all'

export type ResolveRunSqlInput = {
  sql: string
  selectionStart: number
  selectionEnd: number
  /** Preferred scope; omit for default (selection if non-empty, else statement) */
  scope?: RunScope
  /** SQL dialect for comment rules; default mysql */
  dialect?: SqlStatementDialect
}

export type ResolveRunSqlReason =
  | 'empty'
  | 'no-selection'
  | 'no-statement'
  | 'ambiguous'

export type ResolveRunSqlResult = {
  sql: string
  scope: RunScope
  /** True when resolution could not safely honor the requested scope */
  fallback: boolean
  reason?: ResolveRunSqlReason
}

export type SplitSqlResult = {
  ranges: SqlStatementRange[]
  /** True if lexer finished inside an unclosed string/comment/dollar quote */
  ambiguous: boolean
}

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
    } else if (!(c === '_' || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'))) {
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
 * Find the statement that contains cursor.
 * Returns null when SQL is empty, ambiguous, or no statement found.
 */
export function findStatementAtCursor(
  sql: string,
  cursor: number,
  dialect: SqlStatementDialect = 'mysql',
): SqlStatementRange | null {
  const { ranges, ambiguous } = splitSqlStatementsDetailed(sql, dialect)
  if (ambiguous || ranges.length === 0) return null
  const pos = Math.max(0, Math.min(cursor, sql.length))

  for (const r of ranges) {
    if (pos >= r.start && pos <= r.end) return r
  }
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i]
    const next = ranges[i + 1]
    if (pos > r.end && (!next || pos < next.start)) {
      return next || r
    }
  }
  if (pos < ranges[0].start) return ranges[0]
  return ranges[ranges.length - 1]
}

/**
 * Resolve SQL text for a run action.
 * - selection (explicit): requires non-empty selection; else empty + no-selection
 * - statement: lexical current statement; ambiguous → empty + ambiguous (no silent mis-exec)
 * - all: full editor text (even if ambiguous — user asked for all)
 * - default (scope omitted): selection if non-empty, else statement rules
 */
export function resolveRunSql(input: ResolveRunSqlInput): ResolveRunSqlResult {
  const dialect = normalizeDialect(input.dialect)
  const sql = input.sql ?? ''
  const selStart = Math.max(0, Math.min(input.selectionStart, sql.length))
  const selEnd = Math.max(0, Math.min(input.selectionEnd, sql.length))
  const hasSelection = selEnd > selStart && sql.slice(selStart, selEnd).trim().length > 0
  const explicit = input.scope !== undefined
  const scope: RunScope = input.scope ?? (hasSelection ? 'selection' : 'statement')

  if (scope === 'selection') {
    if (!hasSelection) {
      if (explicit) {
        return {
          sql: '',
          scope: 'selection',
          fallback: false,
          reason: 'no-selection',
        }
      }
      return {
        sql: '',
        scope: 'selection',
        fallback: false,
        reason: 'no-selection',
      }
    }
    return {
      sql: sql.slice(selStart, selEnd).trim(),
      scope: 'selection',
      fallback: false,
    }
  }

  if (scope === 'all') {
    const text = sql.trim()
    if (!text) return { sql: '', scope: 'all', fallback: false, reason: 'empty' }
    return { sql: text, scope: 'all', fallback: false }
  }

  // statement
  if (!sql.trim()) {
    return { sql: '', scope: 'statement', fallback: false, reason: 'empty' }
  }

  const { ambiguous } = splitSqlStatementsDetailed(sql, dialect)
  if (ambiguous) {
    return {
      sql: '',
      scope: 'statement',
      fallback: false,
      reason: 'ambiguous',
    }
  }

  const cursor = hasSelection ? selStart : selEnd
  const stmt = findStatementAtCursor(sql, cursor, dialect)
  if (!stmt || !stmt.text) {
    return {
      sql: '',
      scope: 'statement',
      fallback: false,
      reason: 'no-statement',
    }
  }
  return { sql: stmt.text, scope: 'statement', fallback: false }
}

/** Default primary run button: selection | statement | all */
export function defaultRunScope(
  hasSelection: boolean,
  canLocateStatement: boolean,
): RunScope {
  if (hasSelection) return 'selection'
  if (canLocateStatement) return 'statement'
  return 'all'
}

/** Whether current-statement run is safe for this SQL. */
export function canRunCurrentStatement(
  sql: string,
  cursor: number,
  dialect: SqlStatementDialect = 'mysql',
): boolean {
  if (!sql.trim()) return false
  if (isSqlLexicallyAmbiguous(sql, dialect)) return false
  return !!findStatementAtCursor(sql, cursor, dialect)
}
